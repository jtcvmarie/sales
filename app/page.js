'use client'
import { useState } from 'react';

export default function Home() {
  const [discogs, setDiscogs] = useState([]);
  const [ebayActive, setEbayActive] = useState([]);
  
  // Independent Search Strings
  const [mainQuery, setMainQuery] = useState("");
  const [soldQuery, setSoldQuery] = useState("");
  
  // UI States
  const [loadingMain, setLoadingMain] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  // Collapsible Section States
  const [isDiscogsOpen, setIsDiscogsOpen] = useState(true);
  const [isEbayActiveOpen, setIsEbayActiveOpen] = useState(true);
  const [isEbaySoldOpen, setIsEbaySoldOpen] = useState(true);

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
    
    setLoadingMain(true); 
    setErrorMsg(""); 
    setHasSearched(false);
    
    // Auto-open sections on new scan
    setIsDiscogsOpen(true);
    setIsEbayActiveOpen(true);
    setIsEbaySoldOpen(true);
    
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
      
      setMainQuery(data.textQuery || "");
      setSoldQuery(data.textQuery || "");
      setHasSearched(true);
    } catch (error) { 
      setErrorMsg("Error: " + error.message); 
    } finally { 
      setLoadingMain(false); 
    }
  };

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
      setSoldQuery(data.textQuery || mainQuery);
      setHasSearched(true);
    } catch (error) {
      setErrorMsg("Error: " + error.message);
    } finally {
      setLoadingMain(false);
    }
  };

  // Custom Colorizer for Media Formats
  const renderFormat = (fmtStr) => {
    if (!fmtStr || fmtStr === '--') return '--';
    const formatKeywords = ['vinyl', 'lp', '45', '78', '33', 'shellac'];
    const parts = fmtStr.split(', ');
    
    return parts.map((part, i) => {
      const isMedia = formatKeywords.some(k => part.toLowerCase().includes(k));
      return (
        <span key={i}>
          {isMedia ? <span style={{ color: '#d84315', fontWeight: 'bold' }}>{part}</span> : part}
          {i < parts.length - 1 ? ', ' : ''}
        </span>
      );
    });
  };

  const ebayActiveDirectUrl = mainQuery ? `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(mainQuery)}` : '#';
  const ebaySoldDirectUrl = soldQuery ? `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(soldQuery)}&LH_Sold=1&LH_Complete=1` : '#';

  return (
    <main style={{ padding: '15px', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto', backgroundColor: '#fff', paddingBottom: '100px' }}>
      <h2 style={{ borderBottom: '2px solid black', paddingBottom: '10px' }}>Record Lens V42</h2>
      
      <input type="file" accept="image/*" capture="environment" onChange={handleCapture} style={{ padding: '10px', fontSize: '16px', marginBottom: '12px', width: '100%', backgroundColor: '#f9f9f9', border: '1px solid #ccc', borderRadius: '5px' }} />
      
      {/* GLOBAL SEARCH BAR */}
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
      
      {/* 1. DISCOGS SECTION */}
      {hasSearched && (
        <div style={{ marginBottom: '40px' }}>
          <div 
            onClick={() => setIsDiscogsOpen(!isDiscogsOpen)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#222', color: 'white', padding: '10px 15px', borderRadius: '4px', margin: '0 0 15px 0', cursor: 'pointer' }}
          >
            <h3 style={{ margin: 0 }}>Discogs Matches ({discogs.length})</h3>
            <span style={{ fontSize: '18px', fontWeight: 'bold' }}>{isDiscogsOpen ? '–' : '+'}</span>
          </div>
          
          {isDiscogsOpen && (
            discogs.length === 0 ? (
              <div style={{ padding: '15px', backgroundColor: '#fafafa', border: '1px solid #ddd', borderRadius: '6px' }}>
                <p style={{ margin: 0, fontSize: '14px', color: '#555' }}>0 Discogs matches found.</p>
              </div>
            ) : (
              discogs.map((item, i) => {
                const dData = item.discogsData || { have: '--', want: '--', activeLow: '--', label: '--', format: '--', country: '--', released: '--' };
                
                return (
                  <div key={i} style={{ marginBottom: '20px', borderBottom: '1px solid #eee', paddingBottom: '20px' }}>
                    <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                      {item.thumbnail ? (
                        <img src={item.thumbnail} alt="match" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: '80px', height: '80px', backgroundColor: '#eee', borderRadius: '4px', flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1 }}>
                        <a href={item.link} target="_blank" rel="noreferrer" style={{ display: 'block', fontWeight: 'bold', fontSize: '15px', marginBottom: '8px', color: '#0056b3', textDecoration: 'none', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                          {item.title}
                        </a>
                        
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' }}>
                          <div style={{ backgroundColor: '#eaf4ea', border: '1px solid #c8e6c9', borderRadius: '4px', padding: '4px 10px', fontSize: '13px' }}>
                            <span style={{ color: '#2e7d32', fontWeight: 'bold' }}>Have:</span> <strong style={{ fontSize: '14px', color: '#1b5e20' }}>{dData.have}</strong>
                          </div>
                          <div style={{ backgroundColor: '#fff3e0', border: '1px solid #ffe0b2', borderRadius: '4px', padding: '4px 10px', fontSize: '13px' }}>
                            <span style={{ color: '#e65100', fontWeight: 'bold' }}>Want:</span> <strong style={{ fontSize: '14px', color: '#b71c1c' }}>{dData.want}</strong>
                          </div>
                          {dData.activeLow !== '--' && (
                             <div style={{ backgroundColor: '#e3f2fd', border: '1px solid #bbdefb', borderRadius: '4px', padding: '4px 10px', fontSize: '13px' }}>
                               <span style={{ color: '#1565c0', fontWeight: 'bold' }}>Low:</span> <strong style={{ fontSize: '14px', color: '#0d47a1' }}>{dData.activeLow}</strong>
                             </div>
                          )}
                        </div>

                        {/* DEEP METADATA SUBTEXT */}
                        <div style={{ fontSize: '12px', color: '#444', lineHeight: '1.5' }}>
                          {dData.label && dData.label !== '--' && (
                            <div><span style={{ color: '#4527a0', fontWeight: 'bold' }}>Label:</span> {dData.label}</div>
                          )}
                          {dData.format && dData.format !== '--' && (
                            <div><span style={{ color: '#4527a0', fontWeight: 'bold' }}>Format:</span> {renderFormat(dData.format)}</div>
                          )}
                          {dData.country && dData.country !== '--' && (
                            <div><span style={{ color: '#4527a0', fontWeight: 'bold' }}>Country:</span> {dData.country}</div>
                          )}
                          {dData.released && dData.released !== '--' && (
                            <div><span style={{ color: '#4527a0', fontWeight: 'bold' }}>Released:</span> {dData.released}</div>
                          )}
                        </div>
                        
                      </div>
                    </div>
                  </div>
                );
              })
            )
          )}
        </div>
      )}

      {/* 2. EBAY ACTIVE SECTION */}
      {hasSearched && (
        <div style={{ marginBottom: '40px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', backgroundColor: '#0064d2', padding: '10px 15px', borderRadius: '4px' }}>
            <div onClick={() => setIsEbayActiveOpen(!isEbayActiveOpen)} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <h3 style={{ margin: 0, color: 'white' }}>eBay Active Matches</h3>
              <span style={{ fontSize: '18px', fontWeight: 'bold', color: 'white' }}>{isEbayActiveOpen ? '–' : '+'}</span>
            </div>
            <a href={ebayActiveDirectUrl} target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: 'white', textDecoration: 'none', fontWeight: 'bold', border: '1px solid white', padding: '4px 8px', borderRadius: '4px' }}>
              View All on eBay →
            </a>
          </div>
          
          {isEbayActiveOpen && (
            ebayActive.length === 0 ? (
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
                      <a href={item.link} target="_blank" rel="noreferrer" style={{ display: 'block', fontWeight: 'bold', fontSize: '14px', marginBottom: '4px', textDecoration: 'none', color: '#333', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                        {item.title}
                      </a>
                      <div style={{ fontWeight: 'bold', color: item.price ? 'green' : '#666', fontSize: '15px' }}>
                        {item.price || "View on eBay"}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )
          )}
        </div>
      )}

      {/* 3. EBAY SOLD GATEWAY */}
      {hasSearched && (
        <div style={{ marginBottom: '40px', borderTop: '4px solid #8b0000', paddingTop: '20px' }}>
          <div onClick={() => setIsEbaySoldOpen(!isEbaySoldOpen)} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px', cursor: 'pointer' }}>
            <h3 style={{ margin: 0, color: '#8b0000' }}>eBay Sold History</h3>
            <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#8b0000' }}>{isEbaySoldOpen ? '–' : '+'}</span>
          </div>

          {isEbaySoldOpen && (
            <div style={{ padding: '15px', backgroundColor: '#fcf2f2', borderRadius: '6px', border: '1px solid #f5c6cb' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#721c24', fontWeight: 'bold' }}>Verify Sold Market Pricing:</p>
              
              <input 
                type="text" 
                value={soldQuery} 
                onChange={(e) => setSoldQuery(e.target.value)} 
                placeholder="Edit query for sold search..."
                style={{ width: '100%', padding: '12px', fontSize: '15px', borderRadius: '4px', border: '1px solid #d9534f', marginBottom: '12px', boxSizing: 'border-box' }}
              />
              
              <a 
                href={ebaySoldDirectUrl} 
                target="_blank" 
                rel="noreferrer" 
                style={{ display: 'block', textAlign: 'center', padding: '12px', backgroundColor: '#8b0000', color: '#fff', textDecoration: 'none', borderRadius: '5px', fontWeight: 'bold', fontSize: '15px' }}
              >
                View Sold Listings on eBay →
              </a>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
