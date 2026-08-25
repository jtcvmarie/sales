'use client'
import { useState } from 'react';

export default function Home() {
  const [results, setResults] = useState([]);
  const [textQuery, setTextQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [copySuccess, setCopySuccess] = useState(false);

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

    setLoading(true);
    setErrorMsg("");
    setResults([]);
    setTextQuery("");
    setCopySuccess(false);
    
    try {
      const smallFile = await shrinkImage(file);
      const formData = new FormData();
      formData.append('image', smallFile);

      const res = await fetch('/api/search', { method: 'POST', body: formData });
      
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
         throw new Error(`Server returned a ${res.status} Error instead of data. The API file is likely in the wrong folder!`);
      }
      
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      setResults(data.results || []);
      setTextQuery(data.textQuery || "");
    } catch (error) {
      console.error(error);
      setErrorMsg("Something went wrong: " + error.message);
    } finally {
      setLoading(false); 
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(textQuery);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000); // Resets the button text after 2 seconds
  };

  return (
    <main style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>My Lens Search V3</h1>
      
      <input 
        type="file" 
        accept="image/*" 
        capture="environment" 
        onChange={handleCapture} 
        style={{ padding: '10px', fontSize: '16px', marginBottom: '15px' }}
      />
      
      {loading && <p>Scanning the web (this takes a few seconds)...</p>}
      {errorMsg && <p style={{ color: 'red', fontWeight: 'bold' }}>{errorMsg}</p>}
      
      {textQuery && !loading && (
        <div style={{ padding: '15px', backgroundColor: '#f0f0f0', borderRadius: '8px', marginBottom: '20px' }}>
          <p style={{ margin: '0 0 10px 0', fontSize: '14px', color: 'gray' }}>Google Lens Detected:</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <strong style={{ fontSize: '18px' }}>{textQuery}</strong>
            <button 
              onClick={copyToClipboard}
              style={{ padding: '8px 12px', cursor: 'pointer', backgroundColor: '#0070f3', color: 'white', border: 'none', borderRadius: '5px' }}
            >
              {copySuccess ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}

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
      {results.length === 0 && !loading && !errorMsg && <p>No results found from your target sites.</p>}
    </main>
  );
}
