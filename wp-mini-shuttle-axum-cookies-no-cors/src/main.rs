use axum::body::Body;
use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use reqwest::cookie::Jar;
use reqwest::{Client, Url};
use serde::Deserialize;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tracing::{info, instrument, warn};
use wp_mini_epub::{download_story_to_memory, AppError};

const CONCURRENT_CHAPTER_REQUESTS: usize = 10;
const APP_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

#[derive(Clone)]
struct AppState {
    anon_client: Arc<Client>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Cookie {
    name: String,
    value: String,
    domain: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateEpubRequest {
    story_id: u64,
    is_embed_images: bool,
    cookies: Option<Vec<Cookie>>,
}

struct MyError(AppError);

#[shuttle_runtime::main]
async fn main() -> shuttle_axum::ShuttleAxum {
    let cors = CorsLayer::permissive();

    let shared_client = Arc::new(
        Client::builder()
            .user_agent(APP_USER_AGENT)
            .cookie_store(true)
            .build()
            .expect("Failed to create reqwest client"),
    );

    let app_state = AppState {
        anon_client: shared_client,
    };

    let app = Router::new()
        .route("/generate-epub", post(generate_epub))
        .with_state(app_state)
        .layer(cors);

    Ok(app.into())
}

fn map_anyhow_error(e: anyhow::Error) -> AppError {
    if let Some(app_error) = e.downcast_ref::<AppError>() {
        return match app_error {
            AppError::AuthenticationFailed => AppError::AuthenticationFailed,
            AppError::NotLoggedIn => AppError::NotLoggedIn,
            AppError::LogoutFailed => AppError::LogoutFailed,
            AppError::StoryNotFound(id) => AppError::StoryNotFound(*id),
            AppError::MetadataFetchFailed => AppError::MetadataFetchFailed,
            AppError::DownloadFailed => AppError::DownloadFailed,
            AppError::ChapterProcessingFailed => AppError::ChapterProcessingFailed,
            AppError::EpubGenerationFailed => AppError::EpubGenerationFailed,
            AppError::IoError(_) => AppError::DownloadFailed,
        };
    }
    warn!("Unhandled error type: {:?}", e);
    AppError::DownloadFailed
}

#[instrument(skip(state, payload), fields(story_id = payload.story_id))]
async fn generate_epub(
    State(state): State<AppState>,
    Json(payload): Json<GenerateEpubRequest>,
) -> Result<Response, MyError> {
    // Determine if we have cookies to create an authenticated session
    let client = if let Some(cookies) = payload.cookies.as_ref().filter(|c| !c.is_empty()) {
        info!("Handling authenticated request with cookies");

        // 1. Create a new cookie jar for this request
        let jar = Arc::new(Jar::default());
        let wattpad_url = Url::parse("https://www.wattpad.com").unwrap();

        // 2. Populate the jar with cookies from the extension
        for cookie in cookies {
            if cookie.domain.contains("wattpad.com") {
                jar.add_cookie_str(&format!("{}={}", cookie.name, cookie.value), &wattpad_url);
            }
        }

        // 3. Build a new, temporary client with these specific cookies
        let auth_client = Client::builder()
            .cookie_provider(jar)
            .user_agent(APP_USER_AGENT)
            .build()
            .map_err(|_| MyError(AppError::DownloadFailed))?;

        Arc::new(auth_client)
    } else {
        info!("Handling anonymous request");
        state.anon_client.clone()
    };

    let epub_result = download_story_to_memory(
        &client,
        payload.story_id,
        payload.is_embed_images,
        CONCURRENT_CHAPTER_REQUESTS,
        None,
    )
    .await
    .map_err(map_anyhow_error)?;

    let epub_bytes = epub_result.epub_response;

    let utf8_name = format!("{}.epub", epub_result.sanitized_title);
    let encoded_name = utf8_percent_encode(&utf8_name, NON_ALPHANUMERIC).to_string();

    let content_disposition = format!(
        "attachment; filename=\"{}\"; filename*=UTF-8''{}",
        utf8_name, encoded_name
    );
    match Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/epub+zip")
        .header(header::CONTENT_DISPOSITION, content_disposition)
        .header(header::CONTENT_LENGTH, epub_bytes.len())
        .body(Body::from(epub_bytes))
    {
        Ok(response) => Ok(response),
        Err(_) => Err(MyError(AppError::EpubGenerationFailed)),
    }
}

impl From<AppError> for MyError {
    fn from(error: AppError) -> Self {
        MyError(error)
    }
}

impl IntoResponse for MyError {
    fn into_response(self) -> Response {
        let error = self.0;
        let (status, error_message) = match error {
            AppError::AuthenticationFailed => (StatusCode::UNAUTHORIZED, error.to_string()),
            AppError::NotLoggedIn => (StatusCode::UNAUTHORIZED, error.to_string()),
            AppError::LogoutFailed => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
            AppError::StoryNotFound(id) => (
                StatusCode::NOT_FOUND,
                format!("Story with ID {} could not be found", id),
            ),
            AppError::MetadataFetchFailed => (StatusCode::BAD_GATEWAY, error.to_string()),
            AppError::DownloadFailed => (StatusCode::BAD_GATEWAY, error.to_string()),
            AppError::ChapterProcessingFailed => {
                (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            }
            AppError::EpubGenerationFailed => {
                (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            }
            AppError::IoError(_) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
        };

        let body = Json(serde_json::json!({ "error": error_message }));
        (status, body).into_response()
    }
}
