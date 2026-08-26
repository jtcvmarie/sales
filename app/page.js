'use client'
import { useState } from 'react';

export default function Home() {
  const [discogs, setDiscogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  const shrinkImage = (file) => { 
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image(); img.onload = () => {
          const canvas = document.createElement('canvas'); 
          const maxSize = 800; 
          let width = img.width; 
          let height = img.height;
          if (width > height && width > maxSize) { height *= maxSize / width; width = maxSize; } 
          else if (height > maxSize) { width *= maxSize / height; height = maxSize; }
          canvas.width = width; canvas.height = height; 
          const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() })), 'image/jpeg', 0.7); 
        }; img.src = event.target.result;
      }; reader.readAsDataURL(file);
    });
  };

  const handleCapture = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setLoading(true); 
    setErrorMsg(""); 
    setDiscogs([]); 
    setHasSearched(false);
    
    try {
      const smallFile = await shrinkImage(file);
      const formData = new FormData(); 
      formData.append('image', smallFile);
      
      const res = await fetch('/api/search', { method: 'POST', body: formData });
      
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Server returned status ${res.status}: ${errText.slice(0, 100)}`);
      }
      
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      setDiscogs(Array.isArray(data.discogsMatches) ? data.discogsMatches : []);
      setHasSearched(true);
      
    } catch (error) { 
      setErrorMsg("Error: " + error.message); 
    } finally { 
      setLoading(false); 
    }
  };

  return (
    <main style={{ padding: '15px', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto', backgroundColor: '#fff' }}>
      <h2 style={{ borderBottom: '2px solid black', paddingBottom: '10px' }}>Discogs Core V1</h2>
      
      <input type="file" accept="image/*" capture="environment" onChange={handleCapture} style={{ padding: '10px', fontSize: '16px', marginBottom: '15px', width: '100%', backgroundColor: '#f9f9f9', border: '1px solid #ccc', borderRadius: '5px' }} />
      
      {loading && <p style={{ fontWeight: 'bold', color: '#0070f3' }}>Scanning artwork & retrieving Discogs stats...</p>}
      {errorMsg && <p style={{ color: 'red', fontWeight: 'bold', backgroundColor: '#fee', padding: '10px', borderRadius: '4px' }}>{errorMsg}</p>}

      {/* DISCOGS RESULTS ONLY */}
      {hasSearched && (
        <div style={{ marginBottom: '40px' }}>
          <h3 style={{ backgroundColor: '#333', color: 'white', padding: '10px 15px', borderRadius: '4px', margin: '0 0 15px 0' }}>Discogs Matches</h3>
          
          {discogs.length === 0 ? (
            <div style={{ padding: '15px', backgroundColor: '#fafafa', border: '1px solid #ddd', borderRadius: '6px' }}>
               <p style={{ margin: 0, fontSize: '14px', color: '#555' }}>Google Lens found 0 Discogs links for this image.</p>
            </div>
          ) : (
            discogs.map((item, i) => {
              const dData = item.discogsData || { have:'--', want:'--', rating:'--', ratingsCount:'--', low:'--', median:'--', high:'--', debug: 'DATA_MISSING' };
              
              return (
                <div key={i} style={{ marginBottom: '20px', borderBottom: '2px solid #eee', paddingBottom: '20px' }}>
                  <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt="cover" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: '80px', height: '80px', backgroundColor: '#eee', borderRadius: '4px', flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1 }}>
                      <a href={item.link} target="_blank" rel="noreferrer" style={{ display: 'block', fontWeight: 'bold', fontSize: '15px', marginBottom: '5px', textDecoration: 'none', color: '#0056b3' }}>
                        {item.title}
                      </a>
                    </div>
                  </div>
                  
                  {/* STATS GRID */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px', backgroundColor: '#fafafa', padding: '12px', borderRadius: '6px', marginTop: '15px', border: '1px solid #e0e0e0' }}>
                    <div><span style={{ color: 'gray' }}>Have:</span> <strong>{dData.have}</strong></div>
                    <div><span style={{ color: 'gray' }}>Want:</span> <strong>{dData.want}</strong></div>
                    <div><span style={{ color: 'gray' }}>Avg Rating:</span> <strong>{dData.rating}</strong></div>
                    <div><span style={{ color: 'gray' }}>Ratings:</span> <strong>{dData.ratingsCount}</strong></div>
                    <div><span style={{ color: 'gray' }}>Low:</span> <strong>{dData.low}</strong></div>
                    <div><span style={{ color: 'gray' }}>Median:</span> <strong>{dData.median}</strong></div>
                    <div><span style={{ color: 'gray' }}>High:</span> <strong>{dData.high}</strong></div>
                  </div>
                  
                  {/* ERROR DECODER */}
                  {dData.debug !== "SUCCESS" && (
                    <div style={{ color: '#d93025', fontSize: '11px', marginTop: '10px', fontWeight: 'bold', padding: '8px', backgroundColor: '#ffe6e6', borderRadius: '4px', borderLeft: '3px solid #d93025' }}>
                      ⚠️ DIAGNOSTIC ERROR: {dData.debug}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </main>
  );
}
