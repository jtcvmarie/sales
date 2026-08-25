'use client'
import { useState } from 'react';

export default function Home() {
  const [results, setResults] = useState([]);
  const [ebaySold, setEbaySold] = useState([]);
  const [textQuery, setTextQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [copySuccess, setCopySuccess] = useState(false);

  const shrinkImage = (file) => { /* ... keeps your existing canvas compression ... */
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxSize = 800; let width = img.width; let height = img.height;
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

    setLoading(true); setErrorMsg(""); setResults([]); setEbaySold([]); setTextQuery("");
    
    try {
      const smallFile = await shrinkImage(file);
      const formData = new FormData(); formData.append('image', smallFile);
      const res = await fetch('/api/search', { method: 'POST', body: formData });
      
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) throw new Error(`Server returned a ${res.status} Error.`);
      
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      setResults(data.results || []);
      setEbaySold(data.ebaySold || []);
      setTextQuery(data.textQuery || "");
    } catch (error) {
      setErrorMsg("Something went wrong: " + error.message);
    } finally {
      setLoading(false); 
    }
  };

  // --- STATS CALCULATOR ---
  const calculateStats = (items, platform) => {
    let prices = [];
    if (platform === 'lens') {
      prices = items.map(i => i.price?.extracted_value).filter(p => p != null);
    } else if (platform === 'ebay-sold') {
      prices = items.map(i => i.price?.extracted).filter(p => p != null);
    }
    if (prices.length === 0) return null;
    const total = prices.reduce((a, b) => a + b, 0);
    return { avg: (total / prices.length).toFixed(2), low: Math.min(...prices).toFixed(2), high: Math.max(...prices).toFixed(2), count: prices.length };
  };

  const activeDiscogsStats = calculateStats(results.filter(r => r.link.includes('discogs.com')), 'lens');
  const activeEbayStats = calculateStats(results.filter(r => r.link.includes('ebay.com')), 'lens');
  const soldEbayStats = calculateStats(ebaySold, 'ebay-sold');

  return (
    <main style={{ padding: '15px', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto' }}>
      <h2>Record Lens</h2>
      
      <input type="file" accept="image/*" capture="environment" onChange={handleCapture} style={{ padding: '10px', fontSize: '16px', marginBottom: '15px', width: '100%' }} />
      
      {loading && <p>Scanning web and fetching comps...</p>}
      {errorMsg && <p style={{ color: 'red' }}>{errorMsg}</p>}
      
      {/* TEXT EXTRACTOR */}
      {textQuery && !loading && (
        <div style={{ padding: '15px', backgroundColor: '#f0f0f0', borderRadius: '8px', marginBottom: '20px' }}>
          <p style={{ margin: '0 0 5px 0', fontSize: '12px', color: 'gray' }}>Detected Text:</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '16px' }}>{textQuery}</strong>
            <button onClick={() => { navigator.clipboard.writeText(textQuery); setCopySuccess(true); setTimeout(() => setCopySuccess(false), 2000); }}
              style={{ padding: '8px', backgroundColor: '#000', color: '#fff', border: 'none', borderRadius: '5px' }}>
              {copySuccess ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {/* 1. ACTIVE LENS MATCHES */}
      {results.length > 0 && <h3>Active Marketplace Matches</h3>}
      <ul style={{ padding: 0, listStyle: 'none' }}>
        {results.map((item, i) => (
          <li key={i} style={{ marginBottom: '20px', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>
            <a href={item.link} target="_blank" rel="noreferrer" style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>{item.title}</a>
            {item.price && <span style={{ fontWeight: 'bold', color: 'green', marginRight: '10px' }}>{item.price.currency}{item.price.extracted_value}</span>}
            <span style={{ fontSize: '12px', color: 'gray' }}>Source: {item.source}</span>
            
            {/* THE DISCOGS 4x2 GRID PLACEHOLDER */}
            {item.link.includes('discogs.com') && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px', fontSize: '11px', backgroundColor: '#fafafa', padding: '10px', borderRadius: '4px', marginTop: '10px', border: '1px solid #ddd' }}>
                <div><strong>Have:</strong> (Need API)</div>
                <div><strong>Want:</strong> (Need API)</div>
                <div><strong>Avg Rating:</strong> --</div>
                <div><strong>Ratings:</strong> --</div>
                <div><strong>Last Sold:</strong> --</div>
                <div><strong>Low:</strong> --</div>
                <div><strong>Median:</strong> --</div>
                <div><strong>High:</strong> --</div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* 2. EBAY SOLD LISTINGS */}
      {ebaySold.length > 0 && (
        <>
          <h3 style={{ color: '#8b0000', marginTop: '30px' }}>eBay Sold Comps</h3>
          <ul style={{ padding: 0, listStyle: 'none' }}>
            {ebaySold.map((item, i) => (
              <li key={i} style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#fff5f5', borderRadius: '5px' }}>
                <a href={item.link} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: '14px', marginBottom: '5px' }}>{item.title}</a>
                {item.price && <span style={{ fontWeight: 'bold', color: 'green', marginRight: '10px' }}>{item.price.raw}</span>}
                <span style={{ fontSize: '12px', color: '#8b0000', fontWeight: 'bold' }}>SOLD</span>
                {item.condition && <span style={{ fontSize: '12px', color: 'gray', marginLeft: '10px' }}>{item.condition}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* 3. MARKET SUMMARY INSIGHTS */}
      {(activeDiscogsStats || activeEbayStats || soldEbayStats) && (
        <div style={{ marginTop: '40px', padding: '15px', backgroundColor: '#eef2ff', borderRadius: '8px', border: '1px solid #c7d2fe' }}>
          <h3 style={{ margin: '0 0 15px 0', fontSize: '16px' }}>Pricing Summary</h3>
          <div style={{ fontSize: '14px', lineHeight: '1.6' }}>
            {soldEbayStats && <div style={{ borderBottom: '1px solid #c7d2fe', paddingBottom: '8px', marginBottom: '8px' }}><strong>eBay Sold ({soldEbayStats.count}):</strong> Avg ${soldEbayStats.avg} <span style={{ color: 'gray', fontSize: '12px' }}>(Low: ${soldEbayStats.low} | High: ${soldEbayStats.high})</span></div>}
            {activeEbayStats && <div style={{ borderBottom: '1px solid #c7d2fe', paddingBottom: '8px', marginBottom: '8px' }}><strong>eBay Active ({activeEbayStats.count}):</strong> Avg ${activeEbayStats.avg} <span style={{ color: 'gray', fontSize: '12px' }}>(Low: ${activeEbayStats.low} | High: ${activeEbayStats.high})</span></div>}
            {activeDiscogsStats && <div><strong>Discogs Active ({activeDiscogsStats.count}):</strong> Avg ${activeDiscogsStats.avg} <span style={{ color: 'gray', fontSize: '12px' }}>(Low: ${activeDiscogsStats.low} | High: ${activeDiscogsStats.high})</span></div>}
          </div>
        </div>
      )}
    </main>
  );
}
