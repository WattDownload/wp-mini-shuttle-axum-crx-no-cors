import { useState, useEffect } from 'react'
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
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
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
              console.error(`Wattpad API failed with status: ${response.status}`);
              console.error("Wattpad API Error Response Body:", errorBody);
              throw new Error(`Wattpad API failed with status: ${response.status}.`);
            }

            const data = await response.json();
            console.log("Wattpad API Success Response:", data);

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
    setIsLoading(true)

    const apiEndpoint = 'https://YOUR_BACKEND_DOMAIN_HERE/generate-epub';
    
    try {
      const cookies = await chrome.cookies.getAll({ domain: 'wattpad.com' })

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          storyId: Number(storyId),
          isEmbedImages: embedImages,
          cookies: cookies,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const errorMessage = errorData?.error || response.statusText;
        throw new Error(`API Error: ${errorMessage}`);
      }


      // 1. Get the raw file data from the response as a Blob.
      const blob = await response.blob();

      // 2. Create a temporary local URL for the data.
      const url = URL.createObjectURL(blob);

      // 3. Construct the filename directly on the frontend.
      const filename = `story_${storyId}.epub`;

      // 4. Use the chrome.downloads API with the blob URL and our filename.
      chrome.downloads.download({
        url: url,
        filename: filename, // Uses self-constructed filename
      }, () => {
        // 5. Revoke the temporary URL to free up memory.
        URL.revokeObjectURL(url);
      });

    } catch (error) {
      console.error('Download failed:', error)
      alert('An error occurred during the download.');
    } finally {
      setIsLoading(false)
    }
  }

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
          <img src={crxLogo} className="logo" alt="logo" />
          <h2>Wattpad Downloader</h2>
          <div className="settings">
            <label htmlFor="embed-toggle">Embed Images</label>
            <label className="switch">
              <input
                id="embed-toggle"
                type="checkbox"
                checked={embedImages}
                onChange={() => setEmbedImages(!embedImages)}
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
          <img src={crxLogo} className="logo" alt="logo" />
          <h3>Not a Wattpad Story</h3>
          <p>Navigate to a story page on wattpad.com to begin.</p>
        </div>
      )}
    </main>
  )
}