import {useEffect, useState} from 'react'
import crxLogo from '../assets/logo.png'
import './App.css'

export default function App() {

    const [isValidPage, setIsValidPage] = useState<boolean | null>(null)
    const [storyId, setStoryId] = useState<string | null>(null);
    const [embedImages, setEmbedImages] = useState(true)
    const [isLoading, setIsLoading] = useState(false)

    useEffect(() => {
        // We define an async function to handle URL checking
        const checkUrl = async () => {
            if (chrome.tabs) {
                // Use a promise-based approach for cleaner async/await syntax
                const tabs = await chrome.tabs.query({active: true, currentWindow: true});
                const url = tabs[0]?.url ?? '';

                const wattpadStoryRegex = /^https?:\/\/(?:www\.)?wattpad\.com\/story\/(\d+)-.*/;
                const wattpadStoryPartRegex = /^https?:\/\/(?:www\.)?wattpad\.com\/(\d+)/;

                const storyMatch = url.match(wattpadStoryRegex);
                const storyPartMatch = url.match(wattpadStoryPartRegex);

                // Check for the story ID in the correct capture group (index 1)
                if (storyMatch && storyMatch[1]) {
                    const directStoryId = storyMatch[1];
                    console.log("✅ Direct Story URL found. Story ID:", directStoryId);
                    setIsValidPage(true);
                    setStoryId(directStoryId);

                } else if (storyPartMatch && storyPartMatch[1]) {
                    const partId = storyPartMatch[1];
                    console.log("🔍 Story Part URL found. Extracted Part ID:", partId);

                    const requestUrl = `https://www.wattpad.com/api/v3/story_parts/${partId}?fields=groupId`;
                    console.log("➡️ Making API Request to URL:", requestUrl);

                    try {
                        const response = await fetch(requestUrl, {
                            headers: {
                                'User-Agent': navigator.userAgent
                            }
                        });

                        if (!response.ok) {
                            const errorBody = await response.text().catch(() => "Could not read error body.");
                            console.error(`WP API failed with status: ${response.status}`);
                            console.error("WP API Error Response Body:", errorBody);
                            throw new Error(`WP API failed with status: ${response.status}.`);
                        }

                        const data = await response.json();
                        console.log("WP API Success Response:", data);

                        if (data && data.groupId) {
                            setIsValidPage(true);
                            setStoryId(data.groupId);
                        } else {
                            setIsValidPage(false);
                        }
                    } catch (error) {
                        console.error("Failed to resolve story part ID:", error);
                        setIsValidPage(false);
                    }
                } else {
                    setIsValidPage(false);
                }
            } else {
                // Fallback for development remains the same
                setIsValidPage(true);
                setStoryId("123456789"); // Example ID for testing
            }
        };

        checkUrl();
    }, []); // This effect runs once when the component mounts

    const handleDownload = async () => {
        setIsLoading(true);

        try {
            // Fetch the EPUB file data from backend
            const apiEndpoint = 'https://crx-0-2-6-novn.shuttle.app/generate-epub';
            const cookies = await chrome.cookies.getAll({domain: 'wattpad.com'});

            const response = await fetch(apiEndpoint, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    storyId: Number(storyId),
                    isEmbedImages: embedImages,
                    cookies: cookies,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                throw new Error(`API Error: ${errorData?.error || response.statusText}`);
            }

            // Use the <a> tag trick to trigger the download with the correct filename
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);

            // Extract filename from Content-Disposition header
            const disposition = response.headers.get('Content-Disposition');
            let filename: string | null = null;

            if (disposition) {
                // Try UTF-8 variant first
                const utf8Match = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
                if (utf8Match && utf8Match[1]) {
                    try {
                        filename = decodeURIComponent(utf8Match[1]);
                    } catch {
                        filename = utf8Match[1];
                    }
                } else {
                    // Fallback to normal filename=
                    const match = disposition.match(/filename="?([^"]+)"?/);
                    if (match && match[1]) filename = match[1];
                }
            }

            // If still nothing, fallback.
            if (!filename) filename = `story-${storyId}.epub`;

            const link = document.createElement('a');
            link.href = url;
            link.download = filename; // Ensure the correct filename
            document.body.appendChild(link);
            link.click();

            // Clean up the temporary elements and URL
            link.parentNode?.removeChild(link);
            window.URL.revokeObjectURL(url);

        } catch (error) {
            console.error('Download failed:', error);
            alert('An error occurred during the download.');
        } finally {
            setIsLoading(false);
        }
    };

    if (isValidPage === null) {
        return (
            <main className="container">
                <p>Loading...</p>
            </main>
        )
    }

    return (
        <main className="container">
            {isValidPage ? (
                <div className="functional-ui">
                    <img src={crxLogo} className="logo" alt="logo"/>
                    <h2>WattDownload</h2>
                    <div className="settings">
                        <label htmlFor="embed-toggle">Embed Images</label>
                        <label className="switch">
                            <input
                                id="embed-toggle"
                                type="checkbox"
                                checked={embedImages}
                                onChange={() => setEmbedImages(!embedImages)}
                                disabled={isLoading}
                            />
                            <span className="slider"></span>
                        </label>
                    </div>
                    <button onClick={handleDownload} disabled={isLoading}>
                        {isLoading ? 'Processing...' : 'Download Story'}
                    </button>
                </div>
            ) : (
                <div className="invalid-page-ui">
                    <img src={crxLogo} className="logo" alt="logo"/>
                    <h3>Not a WP Story</h3>
                    <p>Navigate to a story page on wattpad.com to begin.</p>
                </div>
            )}
        </main>
    )
}