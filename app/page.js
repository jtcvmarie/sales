'use client'
import { useState } from 'react';

export default function Home() {
  const [discogs, setDiscogs] = useState([]);
  const [ebayActive, setEbayActive] = useState([]);
  const [ebaySold, setEbaySold] = useState([]);
  const [textQuery, setTextQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
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
    setLoading(true); setErrorMsg(""); setDiscogs([]); setEbayActive([]); setEbaySold([]); setTextQuery("");
    
    try {
      const smallFile = await shrinkImage(file);
      const formData = new FormData(); formData.append('image', smallFile);
      
      const res = await fetch('/api/search', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      setDiscogs(Array.isArray(data.discogs) ? data.discogs : []);
      setEbayActive(Array.isArray(data.ebayActive) ? data.ebayActive : []);
      setEbaySold(Array.isArray(data.ebaySold) ? data.ebaySold : []);
      setTextQuery(data.textQuery || "");
    } catch (error) { 
      setErrorMsg("Something went wrong: " + error.message); 
    } finally { 
      setLoading(false); 
    }
  };

  const safeDiscogs = Array.isArray(discogs) ? discogs : [];
  const safeEbayActive = Array.isArray(ebayActive) ? ebayActive : [];
  const safeEbaySold = Array.isArray(ebaySold) ? ebaySold : [];

  const ebaySoldDirectUrl = textQuery ? `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(textQuery)}&_sacat=0&_from=R40&rt=nc&LH_Sold=1` : '#';

  return (
    <main style={{ padding: '15px', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto', backgroundColor: '#fff' }}>
      <h2 style={{ borderBottom: '2px solid black', paddingBottom: '10px' }}>Record Lens V10</h2>
      
      <input type="file" accept="image/*" capture="environment" onChange={handleCapture} style={{ padding: '10px', fontSize: '16px', marginBottom: '15px', width: '100%', backgroundColor: '#f9f9f9', border: '1px solid #ccc', borderRadius: '5px' }} />
      
      {loading && <p style={{ fontWeight: 'bold', color: '#0070f3' }}>Scanning artwork & querying secure APIs...</p>}
      {errorMsg && <p style={{ color: 'red', fontWeight: 'bold' }}>{errorMsg}</p>}
      
      {/* 1. CLEANED TEXT (Used for eBay Searches) */}
      {textQuery && !loading && (
        <div style={{ padding: '15px', backgroundColor: '#f0f0f0', borderRadius: '8px', marginBottom: '20px' }}>
          <p style={{ margin: '0 0 5px 0', fontSize: '12px', color: 'gray' }}>eBay Direct Search Query:</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '16px' }}>{textQuery}</strong>
            <button onClick={() => { navigator.clipboard.writeText(textQuery); setCopySuccess(true); setTimeout(() => setCopySuccess(false), 2000); }}
              style={{ padding: '8px 12px', backgroundColor: '#000', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
              {copySuccess ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {/* 2. DISCOGS SECTION */}
      {safeDiscogs.length > 0 && (
        <div style={{ marginBottom: '40px' }}>
          <h3 style={{ backgroundColor: '#333', color: 'white', padding: '10px 15px', borderRadius: '4px', margin: '0 0 15px 0' }}>Discogs Matches</h3>
          {safeDiscogs.map((item, i) => {
            if (!item) return null;
            return (
              <div key={i} style={{ marginBottom: '20px', borderBottom: '2px solid #eee', paddingBottom: '20px' }}>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                  {item?.thumbnail ? <img src={item.thumbnail} alt="match" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} /> : <div style={{ width: '80px', height: '80px', backgroundColor: '#eee', borderRadius: '4px', flexShrink: 0 }} />}
                  <div style={{ flex: 1 }}>
                    <a href={item?.link || '#'} target="_blank" rel="noreferrer" style={{ display: 'block', fontWeight: 'bold', fontSize: '15px', marginBottom: '5px' }}>{item?.title || 'Unknown Title'}</a>
                    <div style={{ fontSize: '12px', color: 'gray' }}>Source: Discogs</div>
                  </div>
                </div>
                
                {/* DISCOGS 4x2 GRID */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px', backgroundColor: '#fafafa', padding: '12px', borderRadius: '6px', marginTop: '15px', border: '1px solid #e0e0e0' }}>
                  <div><span style={{color: 'gray'}}>Have:</span> <strong>{item?.discogsData?.have || '--'}</strong></div>
                  <div><span style={{color: 'gray'}}>Want:</span> <strong>{item?.discogsData?.want || '--'}</strong></div>
                  <div><span style={{color: 'gray'}}>Avg Rating:</span> <strong>{item?.discogsData?.rating || '--'}</strong></div>
                  <div><span style={{color: 'gray'}}>Ratings:</span> <strong>{item?.discogsData?.ratingsCount || '--'}</strong></div>
                  <div><span style={{color: 'gray'}}>Last Sold:</span> <strong style={{color: '#8b0000'}}>{item?.discogsData?.lastSold || '--'}</strong></div>
                  <div><span style={{color: 'gray'}}>Low:</span> <strong>{item?.discogsData?.low || '--'}</strong></div>
                  <div><span style={{color: 'gray'}}>Median:</span> <strong style={{color: String(item?.discogsData?.median || '').includes('Error') ? 'red' : 'black'}}>{item?.discogsData?.median || '--'}</strong></div>
                  <div><span style={{color: 'gray'}}>High:</span> <strong>{item?.discogsData?.high || '--'}</strong></div>
                </div>
                
                {/* DIAGNOSTIC SCANNER: Exposes API errors */}
                {item?.discogsData?.debug && (
                   <div style={{ color: '#d93025', fontSize: '12px', marginTop: '10px', fontWeight: 'bold' }}>
                      API DIAGNOSTIC: {item.discogsData.debug}
                   </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 3. EBAY ACTIVE SECTION (Powered by Direct Search) */}
      {safeEbayActive.length > 0 && (
        <div style={{ marginBottom: '40px' }}>
          <h3 style={{ backgroundColor: '#0064d2', color: 'white', padding: '10px 15px', borderRadius: '4px', margin: '0 0 15px 0' }}>eBay Active</h3>
          {safeEbayActive.map((item, i) => {
            if (!item) return null;
            return (
              <div key={i} style={{ marginBottom: '15px', borderBottom: '1px solid #eee', paddingBottom: '15px' }}>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                  {item?.thumbnail ? <img src={item.thumbnail} alt="match" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} /> : <div style={{ width: '80px', height: '80px', backgroundColor: '#eee', borderRadius: '4px', flexShrink: 0 }} />}
                  <div style={{ flex: 1 }}>
                    <a href={item?.link || '#'} target="_blank" rel="noreferrer" style={{ display: 'block', fontWeight: 'bold', fontSize: '14px', marginBottom: '5px' }}>{item?.title || 'Unknown Title'}</a>
                    <div style={{ fontWeight: 'bold', color: 'green', fontSize: '16px', marginBottom: '3px' }}>
                      {item?.price?.raw || 'N/A'}
                    </div>
                    <div style={{ fontSize: '12px', color: 'gray' }}>Source: eBay Direct</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 4. EBAY SOLD SECTION (Powered by Direct Search) */}
      {(safeEbaySold.length > 0 || textQuery) && (
        <div style={{ marginBottom: '40px', borderTop: '4px solid #8b0000', paddingTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h3 style={{ margin: 0, color: '#8b0000' }}>eBay Sold History</h3>
            <a href={ebaySoldDirectUrl} target="_blank" rel="noreferrer" style={{ fontSize: '13px', color: '#0064d2', textDecoration: 'none', fontWeight: 'bold', border: '1px solid #0064d2', padding: '5px 10px', borderRadius: '4px' }}>
              View All Sold →
            </a>
          </div>
          
          {safeEbaySold.length === 0 && <p style={{ fontSize: '14px', color: 'gray' }}>No recent sold history found for "{textQuery}".</p>}
          
          {safeEbaySold.map((item, i) => {
            if (!item) return null;
            return (
              <div key={i} style={{ marginBottom: '12px', padding: '12px', backgroundColor: '#fff5f5', borderRadius: '6px', border: '1px solid #fcdcdc' }}>
                <a href={item?.link || '#'} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: '14px', marginBottom: '8px', color: '#333', textDecoration: 'none' }}>{item?.title || 'Unknown Title'}</a>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {item?.price?.raw && <span style={{ fontWeight: 'bold', color: 'green', fontSize: '16px', marginRight: '10px' }}>{item.price.raw}</span>}
                  <span style={{ fontSize: '11px', color: 'white', backgroundColor: '#8b0000', padding: '2px 6px', borderRadius: '3px', fontWeight: 'bold' }}>SOLD</span>
                  {item?.condition && <span style={{ fontSize: '12px', color: 'gray', marginLeft: 'auto' }}>{item.condition}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

    </main>
  );
}
