'use client'
import { useState } from 'react';

export default function Home() {
  const [results, setResults] = useState([]);
  const [ebaySold, setEbaySold] = useState([]);
  const [textQuery, setTextQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [copySuccess, setCopySuccess] = useState(false);

  const shrinkImage = (file) => { /* Keeping original compression */
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
    setLoading(true); setErrorMsg(""); setResults([]); setEbaySold([]); setTextQuery("");
    
    try {
      const smallFile = await shrinkImage(file);
      const formData = new FormData(); formData.append('image', smallFile);
      const res = await fetch('/api/search', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      setResults(data.results || []);
      setEbaySold(data.ebaySold || []);
      setTextQuery(data.textQuery || "");
    } catch (error) { setErrorMsg("Something went wrong: " + error.message); } 
    finally { setLoading(false); }
  };

  // --- SECTIONS ---
  const discogsActive = results.filter(r => r.link.includes('discogs.com'));
  const ebayActive = results.filter(r => r.link.includes('ebay.com'));
  const otherActive = results.filter(r => !r.link.includes('discogs.com') && !r.link.includes('ebay.com'));

  // --- PRICING SUMMARY MATH ---
  const calculateStats = (items, platform) => {
    let prices = [];
    if (platform === 'lens') prices = items.map(i => i.price?.extracted_value).filter(p => p != null);
    else if (platform === 'ebay-sold') prices = items.map(i => i.price?.extracted).filter(p => p != null);
    else if (platform === 'discogs') {
      prices = items.map(i => {
         if (i.price?.extracted_value) return i.price.extracted_value;
         if (i.discogsData?.median && i.discogsData.median !== '--') return parseFloat(i.discogsData.median.replace(/[^0-9.]/g, ''));
         return null;
      }).filter(p => !isNaN(p) && p != null);
    }
    if (prices.length === 0) return null;
    const total = prices.reduce((a, b) => a + b, 0);
    return { avg: (total / prices.length).toFixed(2), low: Math.min(...prices).toFixed(2), high: Math.max(...prices).toFixed(2), count: prices.length };
  };

  const discogsStats = calculateStats(discogsActive, 'discogs');
  const activeEbayStats = calculateStats(ebayActive, 'lens');
  const soldEbayStats = calculateStats(ebaySold, 'ebay-sold');

  // --- REUSABLE RESULT CARD ---
  const ResultCard = ({ item }) => (
    <div style={{ marginBottom: '20px', borderBottom: '1px solid #ddd', paddingBottom: '15px' }}>
      <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
        {/* Forces the image to always be present */}
        {item.thumbnail ? (
          <img src={item.thumbnail} alt="match" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
        ) : (
          <div style={{ width: '80px', height: '80px', backgroundColor: '#eee', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#999', flexShrink: 0 }}>No Image</div>
        )}
        <div style={{ flex: 1 }}>
          <a href={item.link} target="_blank" rel="noreferrer" style={{ display: 'block', fontWeight: 'bold', fontSize: '15px', marginBottom: '5px' }}>{item.title}</a>
          
          {/* Green Price - Fallback to Discogs median if Lens missed the price */}
          {item.price ? (
             <div style={{ fontWeight: 'bold', color: 'green', marginBottom: '5px' }}>{item.price.currency}{item.price.extracted_value}</div>
          ) : (item.discogsData?.median && item.discogsData.median !== '--' && (
             <div style={{ fontWeight: 'bold', color: 'green', marginBottom: '5px' }}>{item.discogsData.median} <span style={{fontSize: '11px', color: 'gray'}}>(Median)</span></div>
          ))}
          <div style={{ fontSize: '12px', color: 'gray' }}>Source: {item.source}</div>
        </div>
      </div>

      {/* DISCOGS 4x2 GRID - Guaranteed to render if it is a Discogs link */}
      {item.discogsData && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', backgroundColor: '#fafafa', padding: '12px', borderRadius: '6px', marginTop: '12px', border: '1px solid #e0e0e0' }}>
          <div><strong>Have:</strong> <span style={{color: '#0056b3'}}>{item.discogsData.have}</span></div>
          <div><strong>Want:</strong> <span style={{color: '#d93025'}}>{item.discogsData.want}</span></div>
          <div><strong>Avg Rating:</strong> {item.discogsData.rating}</div>
          <div><strong>Ratings:</strong> {item.discogsData.ratingsCount}</div>
          <div><strong>Last Sold:</strong> <span style={{color: '#8b0000'}}>{item.discogsData.lastSold}</span></div>
          <div><strong>Low:</strong> {item.discogsData.low}</div>
          <div><strong>Median:</strong> {item.discogsData.median}</div>
          <div><strong>High:</strong> {item.discogsData.high}</div>
        </div>
      )}
    </div>
  );

  return (
    <main style={{ padding: '15px', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto', backgroundColor: '#fff' }}>
      <h2 style={{ borderBottom: '2px solid black', paddingBottom: '10px' }}>Record Lens</h2>
      
      <input type="file" accept="image/*" capture="environment" onChange={handleCapture} style={{ padding: '10px', fontSize: '16px', marginBottom: '15px', width: '100%', backgroundColor: '#f9f9f9', border: '1px solid #ccc', borderRadius: '5px' }} />
      
      {loading && <p style={{ fontWeight: 'bold', color: '#0070f3' }}>Scanning artwork & fetching market data...</p>}
      {errorMsg && <p style={{ color: 'red' }}>{errorMsg}</p>}
      
      {/* 1. EXTRACTED TEXT */}
      {textQuery && !loading && (
        <div style={{ padding: '15px', backgroundColor: '#f0f0f0', borderRadius: '8px', marginBottom: '20px' }}>
          <p style={{ margin: '0 0 5px 0', fontSize: '12px', color: 'gray' }}>Detected Text / Barcode:</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '16px' }}>{textQuery}</strong>
            <button onClick={() => { navigator.clipboard.writeText(textQuery); setCopySuccess(true); setTimeout(() => setCopySuccess(false), 2000); }}
              style={{ padding: '8px', backgroundColor: '#000', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
              {copySuccess ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {/* 2. DISCOGS SECTION */}
      {discogsActive.length > 0 && (
        <div style={{ marginBottom: '30px' }}>
          <h3 style={{ backgroundColor: '#333', color: 'white', padding: '8px 12px', borderRadius: '4px' }}>Discogs Matches</h3>
          {discogsActive.map((item, i) => <ResultCard key={i} item={item} />)}
        </div>
      )}

      {/* 3. EBAY ACTIVE SECTION */}
      {ebayActive.length > 0 && (
        <div style={{ marginBottom: '30px' }}>
          <h3 style={{ backgroundColor: '#0064d2', color: 'white', padding: '8px 12px', borderRadius: '4px' }}>eBay Active</h3>
          {ebayActive.map((item, i) => <ResultCard key={i} item={item} />)}
        </div>
      )}

      {/* 4. EBAY SOLD SECTION */}
      {ebaySold.length > 0 && (
        <div style={{ marginBottom: '30px' }}>
          <h3 style={{ backgroundColor: '#8b0000', color: 'white', padding: '8px 12px', borderRadius: '4px' }}>eBay Sold History</h3>
          {ebaySold.map((item, i) => (
            <div key={i} style={{ marginBottom: '15px', padding: '12px', backgroundColor: '#fff5f5', borderRadius: '5px', border: '1px solid #fcdcdc' }}>
              <a href={item.link} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: '14px', marginBottom: '5px', fontWeight: 'bold' }}>{item.title}</a>
              {item.price && <span style={{ fontWeight: 'bold', color: 'green', marginRight: '10px' }}>{item.price.raw}</span>}
              <span style={{ fontSize: '12px', color: '#8b0000', fontWeight: 'bold' }}>SOLD</span>
              {item.condition && <span style={{ fontSize: '12px', color: 'gray', marginLeft: '10px' }}>{item.condition}</span>}
            </div>
          ))}
        </div>
      )}

      {/* 5. OTHER SITES (Popsike, UPCItemDB) */}
      {otherActive.length > 0 && (
        <div style={{ marginBottom: '30px' }}>
          <h3 style={{ backgroundColor: '#555', color: 'white', padding: '8px 12px', borderRadius: '4px' }}>Other Marketplaces</h3>
          {otherActive.map((item, i) => <ResultCard key={i} item={item} />)}
        </div>
      )}

      {/* 6. PRICING SUMMARY (Now fixes missing Discogs prices) */}
      {(discogsStats || activeEbayStats || soldEbayStats) && (
        <div style={{ marginTop: '40px', padding: '15px', backgroundColor: '#eef2ff', borderRadius: '8px', border: '1px solid #c7d2fe' }}>
          <h3 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#3730a3' }}>Pricing Summary</h3>
          <div style={{ fontSize: '14px', lineHeight: '1.6' }}>
            {soldEbayStats && <div style={{ borderBottom: '1px solid #c7d2fe', paddingBottom: '8px', marginBottom: '8px' }}><strong>eBay Sold ({soldEbayStats.count}):</strong> Avg ${soldEbayStats.avg} <span style={{ color: 'gray', fontSize: '12px' }}>(Low: ${soldEbayStats.low} | High: ${soldEbayStats.high})</span></div>}
            {activeEbayStats && <div style={{ borderBottom: '1px solid #c7d2fe', paddingBottom: '8px', marginBottom: '8px' }}><strong>eBay Active ({activeEbayStats.count}):</strong> Avg ${activeEbayStats.avg} <span style={{ color: 'gray', fontSize: '12px' }}>(Low: ${activeEbayStats.low} | High: ${activeEbayStats.high})</span></div>}
            {discogsStats && <div><strong>Discogs Estimates ({discogsStats.count}):</strong> Avg ${discogsStats.avg} <span style={{ color: 'gray', fontSize: '12px' }}>(Low: ${discogsStats.low} | High: ${discogsStats.high})</span></div>}
          </div>
        </div>
      )}
    </main>
  );
}
