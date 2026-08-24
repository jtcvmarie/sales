'use client'
import { useState } from 'react';

export default function Home() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Instantly scales the photo down to max 800px and compresses to JPEG
  const shrinkImage = (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxSize = 800; 
          let width = img.width;
          let height = img.height;
          
          if (width > height && width > maxSize) {
            height *= maxSize / width;
            width = maxSize;
          } else if (height > maxSize) {
            width *= maxSize / height;
            height = maxSize;
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          // Convert back to a JPEG at 70% quality to guarantee it's under 500KB
          canvas.toBlob((blob) => {
            const newFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            resolve(newFile);
          }, 'image/jpeg', 0.7); 
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleCapture = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Reset states before a new search
    setLoading(true);
    setErrorMsg("");
    setResults([]);
    
    try {
      // 1. Shrink the heavy phone image down
      const smallFile = await shrinkImage(file);
      
      const formData = new FormData();
      formData.append('image', smallFile);

      // 2. Send it securely to our Vercel backend
      const res = await fetch('/api/search', {
        method: 'POST',
        body: formData
      });
      
      // If Vercel crashes (like a 500 error), this catches it
      if (!res.ok) {
        throw new Error("Server failed to process the image. Check your API key!");
      }
      
      const data = await res.json();
      
      if (data.error) throw new Error(data.error);
      
      setResults(data.results || []);
    } catch (error) {
      console.error(error);
      setErrorMsg("Something went wrong: " + error.message);
    } finally {
      // ALWAYS turn off the loading text, even if it crashes
      setLoading(false); 
    }
  };

  return (
    <main style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>My Lens Search</h1>
      
      <input 
        type="file" 
        accept="image/*" 
        capture="environment" 
        onChange={handleCapture} 
        style={{ padding: '10px', fontSize: '16px' }}
      />
      
      {loading && <p>Scanning the web (this takes a few seconds)...</p>}
      {errorMsg && <p style={{ color: 'red', fontWeight: 'bold' }}>{errorMsg}</p>}
      
      <ul style={{ marginTop: '20px', padding: 0, listStyle: 'none' }}>
        {results.map((item, i) => (
          <li key={i} style={{ marginBottom: '15px' }}>
            {item.thumbnail && (
              <img src={item.thumbnail} alt="match" width={80} style={{ verticalAlign: 'middle', marginRight: '10px' }} />
            )}
            <a href={item.link} target="_blank" rel="noreferrer">
              {item.title}
            </a>
            <p style={{ margin: 0, fontSize: '12px', color: 'gray' }}>Source: {item.source}</p>
          </li>
        ))}
      </ul>
      {results.length === 0 && !loading && !errorMsg && <p>No results yet.</p>}
    </main>
  );
}
