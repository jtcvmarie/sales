'use client'
import { useState } from 'react';

export default function Home() {
  const [discogs, setDiscogs] = useState([]);
  const [ebayActive, setEbayActive] = useState([]);
  const [ebaySold, setEbaySold] = useState([]);
  
  // Independent Search Strings
  const [mainQuery, setMainQuery] = useState("");
  const [soldQuery, setSoldQuery] = useState("");
  
  const [loadingMain, setLoadingMain] = useState(false);
  const [loadingSold, setLoadingSold] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

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

  // Image Upload Trigger
  const handleCapture = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setLoadingMain(true); 
    setErrorMsg(""); 
    setHasSearched(false);
    
    try {
      const smallFile = await shrinkImage(file);
      const formData = new FormData(); 
      formData.append('image', smallFile);
      
      const res = await fetch('/api/search', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`Server returned status ${res.status}`);
      
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      setDiscogs(data.discogsMatches || []);
      setEbayActive(data.ebayActiveMatches || []);
      setEbaySold(data.ebaySoldResults || []);
      setMainQuery(data.textQuery || "");
      setSoldQuery(data.textQuery || "");
      setHasSearched(true);
      
    } catch (error) { 
      setErrorMsg("Error: " + error.message); 
    } finally { 
      setLoadingMain(false); 
    }
  };

  // Main Text Search (Discogs + eBay Active + Default Sold)
  const handleMainSearch = async () => {
    if (!mainQuery.trim()) return;
    
    setLoadingMain(true);
    setErrorMsg("");
    setHasSearched(false);

    try {
      const formData = new FormData();
      formData.append('query', mainQuery);
      
      const res = await fetch('/api/search', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`Server returned status ${res.status}`);
      
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      setDiscogs(data.discogsMatches || []);
      setEbayActive(data.ebayActiveMatches || []);
      setEbaySold(data.ebaySoldResults || []);
      setSoldQuery(data.textQuery || mainQuery);
      setHasSearched(true);
    } catch (error) {
      setErrorMsg("Error: " + error.message);
    } finally {
      setLoadingMain(false);
    }
  };

  // Independent eBay Sold Search
  const handleSoldSearch = async () => {
    if (!soldQuery.trim()) return;
    
    setLoadingSold(true);
    try {
      const formData = new FormData();
      formData.append('soldQuery', soldQuery);
      
      const res = await fetch('/api/search', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`Server returned status ${res.status}`);
      
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      setEbaySold(data.ebaySoldResults || []);
    } catch (error) {
      alert("Sold Search Error: " + error.message);
    } finally {
      setLoadingSold(false);
    }
  };

  const ebaySoldDirectUrl = soldQuery ? `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(soldQuery)}&_sacat=0&_from=R40&rt=nc&LH_Sold=1` : '#';

  return (
    <main style={{ padding: '15px', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto', backgroundColor: '#fff', paddingBottom: '100px' }}>
      <h2 style={{ borderBottom: '2px solid black', paddingBottom: '10px' }}>Record Lens V31</h2>
      
      <input type="file" accept="image/*" capture="environment" onChange={handleCapture} style={{ padding: '10px', fontSize: '16px', marginBottom: '12px', width: '100%', backgroundColor: '#f9f9f9', border: '1px solid #ccc', borderRadius: '5px' }} />
      
      {/* 1. MAIN GLOBAL SEARCH BAR (Discogs & eBay Active) */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '8px' }}>
        <input 
          type="text" 
          value={mainQuery} 
          onChange={(e) => setMainQuery(e.target.value)} 
          placeholder="Main search (Discogs & eBay Active)..."
          style={{ flex: 1, padding: '10px', fontSize: '15px', borderRadius: '4px', border: '1px solid #aaa' }}
        />
        <button 
          onClick={handleMainSearch}
          disabled={loadingMain}
          style={{ padding: '10px 18px', backgroundColor: '#222', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          Search
        </button>
      </div>

      {loadingMain && <p style={{ fontWeight: 'bold', color: '#0070f3' }}>Fetching market data...</p>}
      {errorMsg && <p style={{ color: 'red', fontWeight: 'bold', backgroundColor: '#fee', padding: '10px', borderRadius: '4px' }}>{errorMsg}</p>}
      
      {/* 2. DISCOGS SECTION (Up to 15 Results with Emphasized Want & Have) */}
      {hasSearched && (
        <div style={{ marginBottom: '40px' }}>
          <h3 style={{ backgroundColor: '#222', color: 'white', padding: '10px 15px', borderRadius: '4px', margin: '0 0 15px 0' }}>
            Discogs Matches ({discogs.length})
          </h3>
          
          {discogs.length === 0 ? (
            <div style={{ padding: '15px', backgroundColor: '#fafafa', border: '1px solid #ddd', borderRadius: '6px' }}>
              <p style={{ margin: 0, fontSize: '14px', color: '#555' }}>0 Discogs matches found.</p>
            </div>
          ) : (
            discogs.map((item, i) => {
              const dData = item.discogsData || { have: '--', want: '--' };
              
              return (
                <div key={i} style={{ marginBottom: '15px', borderBottom: '1px solid #eee', paddingBottom: '15px' }}>
                  <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt="match" style={{ width: '70px', height: '70px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: '70px', height: '70px', backgroundColor: '#eee', borderRadius: '4px', flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1 }}>
                      <a href={item.link} target="_blank" rel="noreferrer" style={{ display: 'block', fontWeight: 'bold', fontSize: '14px', marginBottom: '8px', color: '#0056b3', textDecoration: 'none' }}>
                        {item.title}
                      </a>
                      
                      {/* EMPHASIZED HAVE & WANT STATS */}
                      <div style={{ display: 'flex', gap: '12px' }}>
                        <div style={{ backgroundColor: '#eaf4ea', border: '1px solid #c8e6c9', borderRadius: '4px', padding: '4px 10px', fontSize: '13px' }}>
                          <span style={{ color: '#2e7d32', fontWeight: 'bold' }}>Have:</span> <strong style={{ fontSize: '14px', color: '#1b5e20' }}>{dData.have}</strong>
                        </div>
                        <div style={{ backgroundColor: '#fff3e0', border: '1px solid #ffe0b2', borderRadius: '4px', padding: '4px 10px', fontSize: '13px' }}>
                          <span style={{ color: '#e65100', fontWeight: 'bold' }}>Want:</span> <strong style={{ fontSize: '14px', color: '#b71c1c' }}>{dData.want}</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 3. EBAY ACTIVE SECTION */}
      {hasSearched && (
        <div style={{ marginBottom: '40px' }}>
          <h3 style={{ backgroundColor: '#0064d2', color: 'white', padding: '10px 15px', borderRadius: '4px', margin: '0 0 15px 0' }}>eBay Active Matches</h3>
          
          {ebayActive.length === 0 ? (
            <div style={{ padding: '15px', backgroundColor: '#fafafa', border: '1px solid #ddd', borderRadius: '6px' }}>
              <p style={{ margin: 0, fontSize: '14px', color: '#555' }}>0 active eBay links found.</p>
            </div>
          ) : (
            ebayActive.map((item, i) => (
              <div key={i} style={{ marginBottom: '12px', borderBottom: '1px solid #eee', paddingBottom: '12px' }}>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt="match" style={{ width: '70px', height: '70px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: '70px', height: '70px', backgroundColor: '#eee', borderRadius: '4px', flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <a href={item.link} target="_blank" rel="noreferrer" style={{ display: 'block', fontWeight: 'bold', fontSize: '14px', marginBottom: '4px', textDecoration: 'none', color: '#333' }}>
                      {item.title}
                    </a>
                    <div style={{ fontWeight: 'bold', color: item.price ? 'green' : '#666', fontSize: '15px' }}>
                      {item.price || "View on eBay"}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 4. SEPARATE EBAY SOLD SEARCH SECTION */}
      {hasSearched && (
        <div style={{ marginBottom: '40px', borderTop: '4px solid #8b0000', paddingTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h3 style={{ margin: 0, color: '#8b0000' }}>eBay Sold History</h3>
            <a href={ebaySoldDirectUrl} target="_blank" rel="noreferrer" style={{ fontSize: '13px', color: '#0064d2', textDecoration: 'none', fontWeight: 'bold', border: '1px solid #0064d2', padding: '4px 8px', borderRadius: '4px' }}>
              View All on eBay →
            </a>
          </div>

          {/* DEDICATED INDEPENDENT EBAY SOLD SEARCH BAR */}
          <div style={{ marginBottom: '20px', padding: '12px', backgroundColor: '#fcf2f2', borderRadius: '6px', border: '1px solid #f5c6cb' }}>
            <p style={{ margin: '0 0 6px 0', fontSize: '12px', color: '#721c24', fontWeight: 'bold' }}>Edit Sold Search Query:</p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="text" 
                value={soldQuery} 
                onChange={(e) => setSoldQuery(e.target.value)} 
                placeholder="Custom eBay sold query..."
                style={{ flex: 1, padding: '10px', fontSize: '14px', borderRadius: '4px', border: '1px solid #d9534f' }}
              />
              <button 
                onClick={handleSoldSearch}
                disabled={loadingSold}
                style={{ padding: '10px 14px', backgroundColor: '#8b0000', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', whiteSpace: 'nowrap' }}
              >
                {loadingSold ? "Searching..." : "Search Sold"}
              </button>
            </div>
          </div>

          {ebaySold.length === 0 ? (
            <div style={{ padding: '20px', backgroundColor: '#fff5f5', border: '1px solid #fcdcdc', borderRadius: '6px', textAlign: 'center' }}>
              <p style={{ fontSize: '14px', color: '#8b0000', margin: 0, fontWeight: 'bold' }}>No Sold Results Found.</p>
            </div>
          ) : (
            ebaySold.map((item, i) => (
              <div key={i} style={{ marginBottom: '10px', padding: '10px', backgroundColor: '#fff5f5', borderRadius: '6px', border: '1px solid #fcdcdc' }}>
                <a href={item.link} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: '13px', marginBottom: '6px', color: '#333', textDecoration: 'none' }}>
                  {item.title}
                </a>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {item.price && <span style={{ fontWeight: 'bold', color: 'green', fontSize: '15px', marginRight: '10px' }}>{item.price}</span>}
                  <span style={{ fontSize: '11px', color: 'white', backgroundColor: '#8b0000', padding: '2px 5px', borderRadius: '3px', fontWeight: 'bold' }}>SOLD</span>
                  {item.condition && <span style={{ fontSize: '12px', color: 'gray', marginLeft: 'auto' }}>{item.condition}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </main>
  );
}
