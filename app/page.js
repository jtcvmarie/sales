'use client'
import { useState } from 'react';

export default function Home() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleCapture = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    
    // Note: SerpApi has a 500KB file limit for direct uploads. 
    // In a production app, use the 'browser-image-compression' npm package right here to shrink the photo before sending.
    
    const formData = new FormData();
    formData.append('image', file);

    // Send the image to our secure Next.js backend
    const res = await fetch('/api/search', {
      method: 'POST',
      body: formData
    });
    
    const data = await res.json();
    setResults(data.results || []);
    setLoading(false);
  };

  return (
    <main style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>My Lens Search</h1>
      
      {/* THIS is the magic PWA camera input */}
      <input 
        type="file" 
        accept="image/*" 
        capture="environment" 
        onChange={handleCapture} 
        style={{ padding: '10px', fontSize: '16px' }}
      />
      
      {loading && <p>Scanning the web...</p>}
      
      <ul style={{ marginTop: '20px' }}>
        {results.map((item, i) => (
          <li key={i} style={{ marginBottom: '15px' }}>
            <img src={item.thumbnail} alt="match" width={80} style={{ verticalAlign: 'middle', marginRight: '10px' }} />
            <a href={item.link} target="_blank" rel="noreferrer">
              {item.title}
            </a>
            <p style={{ margin: 0, fontSize: '12px', color: 'gray' }}>Source: {item.source}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
