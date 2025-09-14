import { useState, useEffect } from 'react'
import crxLogo from '../assets/logo.png'
import './App.css'

export default function App() {

  const [isValidPage, setIsValidPage] = useState<boolean | null>(null)
  const [storyId, setStoryId] = useState<string | null>(null);
  const [embedImages, setEmbedImages] = useState(true)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const url = tabs[0]?.url ?? '';
        const wattpadStoryRegex = /^https?:\/\/(www\.)?wattpad\.com\/story\/(\d+)/;
        const match = url.match(wattpadStoryRegex);

        if (match && match[2]) {
          setIsValidPage(true);
          setStoryId(match[2]);
        } else {
          setIsValidPage(false);
        }
      });
    } else {
      // Fallback for development
      setIsValidPage(true);
      setStoryId("123456789"); // Example ID for testing
    }
  }, [])

  const handleDownload = async () => {
    setIsLoading(true)

    const apiEndpoint = 'https://YOUR_BACKEND_URL_HERE/generate-epub';
    
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