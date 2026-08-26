'use client'
import { useState } from 'react';

export default function Home() {
  const [discogs, setDiscogs] = useState([]);
  const [ebayActive, setEbayActive] = useState([]);
  const [ebaySold, setEbaySold] = useState([]);
  const [textQuery, setTextQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const shrinkImage = (file) => { 
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image(); img.onload = () => {
          const canvas = document.createElement('canvas'); const maxSize = 800; let width = img.width; let height = img.height;
          if (width > height && width > maxSize) { height *= maxSize / width; width = maxSize; } else if (height > maxSize) { width *= maxSize / height; height = maxSize; }
          canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height);
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
    setEbayActive([]);
    setEbaySold([]); 
    setTextQuery(""); 
    setHasSearched(false);
    
    try {
      const smallFile = await shrinkImage(file);
      const formData = new FormData(); formData.append('image', smallFile);
      
      const res = await fetch('/api/search', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`Server returned status ${res.status}`);
      
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      setDiscogs(Array.isArray(data.discogsMatches) ? data.discogsMatches : []);
      setEbayActive(Array.isArray(data.ebayActiveMatches) ? data.ebayActiveMatches : []);
      setEbaySold(Array.isArray(data.ebaySoldResults) ? data.ebaySoldResults : []);
      setTextQuery(data.textQuery || "");
      setHasSearched(true);
      
    } catch (error) { 
      setErrorMsg("Error: " + error.message); 
    } finally { 
      setLoading(false); 
    }
  };

  const ebaySoldDirectUrl = textQuery ? `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(textQuery)}&_sacat=0&_from=R40&rt=nc&LH_Sold=1` : '#';

  return (
    <main style={{ padding: '15px', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto', backgroundColor: '#fff', paddingBottom: '100px' }}>
      <h2 style={{ borderBottom: '2px solid black', paddingBottom: '10px' }}>Record Lens V28</h2>
      
      <input type="file" accept="image/*" capture="environment" onChange={handleCapture} style={{ padding: '10px', fontSize: '16px', marginBottom: '15px', width: '100%', backgroundColor: '#f9f9f9', border: '1px solid #ccc', borderRadius: '5px' }} />
      
      {loading && <p style={{ fontWeight: 'bold', color: '#0070f3' }}>Scanning artwork & rapidly pulling active markets...</p>}
      {errorMsg && <p style={{ color: 'red', fontWeight: 'bold', backgroundColor: '#fee', padding: '10px', borderRadius: '4px' }}>{errorMsg}</p>}
      
      {/* 1. DISCOGS SECTION */}
      {hasSearched && (
        <div style={{ marginBottom: '40px' }}>
          <h3 style={{ backgroundColor: '#333', color: 'white', padding: '10px 15px', borderRadius: '4px', margin: '0 0 15px 0' }}>Discogs Matches</h3>
          
          {discogs.length === 0 ? (
            <div style={{ padding: '15px', backgroundColor: '#fafafa', border: '1px solid #ddd', borderRadius: '6px' }}>
               <p style={{ margin: 0, fontSize: '14px', color: '#555' }}>Google Lens found 0 Discogs links for this image.</p>
            </div>
          ) : (
            discogs.map((item, i) => {
              const dData = item.discogsData || { have:'--', want:'--', rating:'--', ratingsCount:'--', low:'--', high:'--', debug: '' };
              
              return (
                <div key={i} style={{ marginBottom: '20px', borderBottom: '2px solid #eee', paddingBottom: '20px' }}>
                  <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                    {item.thumbnail ? <img src={item.thumbnail} alt="match" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} /> : <div style={{ width: '80px', height: '80px', backgroundColor: '#eee', borderRadius: '4px', flexShrink: 0 }} />}
                    <div style={{ flex: 1 }}>
                      <a href={item.link} target="_blank" rel="noreferrer" style={{ display: 'block', fontWeight: 'bold', fontSize: '15px', marginBottom: '5px' }}>{item.title}</a>
                      <div style={{ fontSize: '12px', color: 'gray' }}>Source: Discogs</div>
                    </div>
                  </div>
                  
                  {/* DISCOGS NEW COMPACT GRID (Active Prices Only) */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px', backgroundColor: '#fafafa', padding: '12px', borderRadius: '6px', marginTop: '15px', border: '1px solid #e0e0e0' }}>
                    <div><span style={{color: 'gray'}}>Have:</span> <strong>{dData.have}</strong></div>
                    <div><span style={{color: 'gray'}}>Want:</span> <strong>{dData.want}</strong></div>
                    <div><span style={{color: 'gray'}}>Avg Rating:</span> <strong>{dData.rating}</strong></div>
                    <div><span style={{color: 'gray'}}>Ratings:</span> <strong>{dData.ratingsCount}</strong></div>
                    <div><span style={{color: 'gray'}}>Active Low:</span> <strong style={{color: 'green'}}>{dData.low}</strong></div>
                    <div><span style={{color: 'gray'}}>Active High:</span> <strong style={{color: '#8b0000'}}>{dData.high}</strong></div>
                  </div>
                  
                  {/* ERROR OUTPUT (Only shows if there is a real error) */}
                  {dData.debug && dData.debug.includes("ERROR") && (
                     <div style={{ color: '#d93025', fontSize: '11px', marginTop: '10px', fontWeight: 'bold', padding: '8px', backgroundColor: '#ffe6e6', borderRadius: '4px' }}>
                        API DIAGNOSTIC: {dData.debug}
                     </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* 2. EBAY ACTIVE SECTION */}
      {hasSearched && (
        <div style={{ marginBottom: '40px' }}>
          <h3 style={{ backgroundColor: '#0064d2', color: 'white', padding: '10px 15px', borderRadius: '4px', margin: '0 0 15px 0' }}>eBay Active Matches</h3>
          
          {ebayActive.length === 0 ? (
             <div style={{ padding: '15px', backgroundColor: '#fafafa', border: '1px solid #ddd', borderRadius: '6px' }}>
               <p style={{ margin: 0, fontSize: '14px', color: '#555' }}>Google Lens found 0 active eBay links.</p>
            </div>
          ) : (
            ebayActive.map((item, i) => (
              <div key={i} style={{ marginBottom: '15px', borderBottom: '1px solid #eee', paddingBottom: '15px' }}>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                  {item.thumbnail ? <img src={item.thumbnail} alt="match" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} /> : <div style={{ width: '80px', height: '80px', backgroundColor: '#eee', borderRadius: '4px', flexShrink: 0 }} />}
                  <div style={{ flex: 1 }}>
                    <a href={item.link} target="_blank" rel="noreferrer" style={{ display: 'block', fontWeight: 'bold', fontSize: '14px', marginBottom: '5px' }}>{item.title}</a>
                    
                    <div style={{ fontWeight: 'bold', color: item.price ? 'green' : '#666', fontSize: '16px', marginBottom: '3px' }}>
                      {item.price || "View on eBay"}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 3. EBAY SOLD SECTION */}
      {hasSearched && (
        <div style={{ marginBottom: '40px', borderTop: '4px solid #8b0000', paddingTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h3 style={{ margin: 0, color: '#8b0000' }}>eBay Sold History</h3>
            <a href={ebaySoldDirectUrl} target="_blank" rel="noreferrer" style={{ fontSize: '13px', color: '#0064d2', textDecoration: 'none', fontWeight: 'bold', border: '1px solid #0064d2', padding: '5px 10px', borderRadius: '4px' }}>
              View All Sold →
            </a>
          </div>
          
          {ebaySold.length === 0 ? (
             <div style={{ padding: '20px', backgroundColor: '#fff5f5', border: '1px solid #fcdcdc', borderRadius: '6px', textAlign: 'center' }}>
               <p style={{ fontSize: '14px', color: '#8b0000', margin: 0, fontWeight: 'bold' }}>No Sold Results Found.</p>
            </div>
          ) : (
            ebaySold.map((item, i) => (
              <div key={i} style={{ marginBottom: '12px', padding: '12px', backgroundColor: '#fff5f5', borderRadius: '6px', border: '1px solid #fcdcdc' }}>
                <a href={item.link} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: '14px', marginBottom: '8px', color: '#333', textDecoration: 'none' }}>{item.title}</a>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {item.price && <span style={{ fontWeight: 'bold', color: 'green', fontSize: '16px', marginRight: '10px' }}>{item.price}</span>}
                  <span style={{ fontSize: '11px', color: 'white', backgroundColor: '#8b0000', padding: '2px 6px', borderRadius: '3px', fontWeight: 'bold' }}>SOLD</span>
                  {item.condition && <span style={{ fontSize: '12px', color: 'gray', marginLeft: 'auto' }}>{item.condition}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 4. STRING SEARCH AND COPY AT THE BOTTOM */}
      {hasSearched && (
        <div style={{ padding: '20px', backgroundColor: '#eef2f5', borderRadius: '8px', marginTop: '20px', border: '1px solid #cddde6' }}>
          <p style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#555', fontWeight: 'bold' }}>Generated 10-Word Search Query:</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '16px', color: '#000', wordBreak: 'break-word', paddingRight: '15px' }}>
              {textQuery}
            </span>
            <button 
              onClick={() => { 
                navigator.clipboard.writeText(textQuery); 
                setCopySuccess(true); 
                setTimeout(() => setCopySuccess(false), 2000); 
              }}
              style={{ padding: '10px 16px', backgroundColor: '#0070f3', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap' }}
            >
              {copySuccess ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
