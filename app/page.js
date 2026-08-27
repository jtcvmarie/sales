'use client'
import { useState, useEffect } from 'react';

export default function Home() {
  const [discogs, setDiscogs] = useState([]);
  const [ebayActive, setEbayActive] = useState([]);
  
  const [mainQuery, setMainQuery] = useState("");
  const [soldQuery, setSoldQuery] = useState("");
  
  const [loadingMain, setLoadingMain] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("Fetching market data...");
  const [errorMsg, setErrorMsg] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  // Layout View Toggles
  const [showMarketLow, setShowMarketLow] = useState(true);
  const [showDiscogs, setShowDiscogs] = useState(true);
  const [showEbay, setShowEbay] = useState(true);

  // Collapsible Section States
  const [isDiscogsOpen, setIsDiscogsOpen] = useState(true);
  const [isEbayActiveOpen, setIsEbayActiveOpen] = useState(true);
  const [isEbaySoldOpen, setIsEbaySoldOpen] = useState(true);

  // Inject barcode library dynamically to keep app lightweight
  useEffect(() => {
    if (!document.getElementById('html5-qrcode-script')) {
      const script = document.createElement('script');
      script.id = 'html5-qrcode-script';
      script.src = "https://unpkg.com/html5-qrcode";
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

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
    setLoadingStatus("Scanning barcode...");
    setErrorMsg(""); 
    setHasSearched(false);
    
    setIsDiscogsOpen(true);
    setIsEbayActiveOpen(true);
    setIsEbaySoldOpen(true);
    
    try {
      const smallFile = await shrinkImage(file);
      let barcodeText = "";

      // 1. ATTEMPT FRONTEND BARCODE SCAN (Lightning Fast)
      if (window.Html5Qrcode) {
        try {
          const html5QrCode = new window.Html5Qrcode("hidden-barcode-reader");
          const decodedText = await html5QrCode.scanFile(smallFile, true);
          if (decodedText) {
             setLoadingStatus(`UPC Found: ${decodedText}. Querying database...`);
             const upcRes = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${decodedText}`);
             if (upcRes.ok) {
                 const upcJson = await upcRes.json();
                 if (upcJson.items && upcJson.items.length > 0) {
                     barcodeText = upcJson.items[0].title;
                 }
             }
          }
        } catch (scanErr) {
          // Normal behavior for album cover photos. Proceed to Google Lens.
        }
      }

      const formData = new FormData(); 

      // 2. ROUTE BASED ON BARCODE SUCCESS
      if (barcodeText) {
         setLoadingStatus(`Found: "${barcodeText}". Loading markets...`);
         formData.append('barcodeQuery', barcodeText);
      } else {
         setLoadingStatus("Scanning album artwork via Google Lens...");
         formData.append('image', smallFile);
      }
      
      const res = await fetch('/api/search', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`Server returned status ${res.status}`);
      
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      setDiscogs(data.discogsMatches || []);
      setEbayActive(data.ebayActiveMatches || []);
      
      setMainQuery(data.textQuery || barcodeText || "");
      setSoldQuery(data.textQuery || barcodeText || "");
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
    setLoadingStatus("Fetching market data...");
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

  const renderFormat = (fmtStr) => {
    if (!fmtStr || typeof fmtStr !== 'string' || fmtStr === '--') return '--';
    const formatKeywords = ['vinyl', 'lp', '45', '78', '33', 'shellac', 'cassette', '7"', '10"', '12"', 'cd'];
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

  const discogsDirectUrl = mainQuery ? `https://www.discogs.com/search?q=${encodeURIComponent(mainQuery)}&type=release` : '#';
  const ebayActiveDirectUrl = mainQuery ? `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(mainQuery)}` : '#';
  const ebaySoldDirectUrl = soldQuery ? `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(soldQuery)}&LH_Sold=1&LH_Complete=1` : '#';

  return (
    <main style={{ padding: '15px', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto', backgroundColor: '#fff', paddingBottom: '100px' }}>
      <h2 style={{ borderBottom: '2px solid black', paddingBottom: '10px', marginBottom: '15px' }}>Record Lens V51</h2>
      
      {/* Required for HTML5-QRCode to process image files invisibly */}
      <div id="hidden-barcode-reader" style={{ display: 'none' }}></div>

      <input type="file" accept="image/*" capture="environment" onChange={handleCapture} style={{ padding: '10px', fontSize: '16px', marginBottom: '15px', width: '100%', backgroundColor: '#f9f9f9', border: '1px solid #ccc', borderRadius: '5px' }} />
      
      {/* GLOBAL SEARCH BAR */}
      <div style={{ marginBottom: '15px', display: 'flex', gap: '8px' }}>
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

      {/* VIEW TOGGLE CHECKBOXES */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '25px', fontSize: '14px', fontWeight: 'bold', color: '#444', backgroundColor: '#f5f5f5', padding: '10px 15px', borderRadius: '6px', border: '1px solid #ddd' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={showMarketLow} onChange={(e) => setShowMarketLow(e.target.checked)} style={{ width: '16px', height: '16px' }} /> Market Low
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={showDiscogs} onChange={(e) => setShowDiscogs(e.target.checked)} style={{ width: '16px', height: '16px' }} /> Discogs
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={showEbay} onChange={(e) => setShowEbay(e.target.checked)} style={{ width: '16px', height: '16px' }} /> eBay
        </label>
      </div>

      {loadingMain && <p style={{ fontWeight: 'bold', color: '#0070f3', marginBottom: '20px' }}>{loadingStatus}</p>}
      {errorMsg && <p style={{ color: 'red', fontWeight: 'bold', backgroundColor: '#fee', padding: '10px', borderRadius: '4px', marginBottom: '20px' }}>{errorMsg}</p>}
      
      {/* 1. DISCOGS SECTION */}
      {hasSearched && showDiscogs && (
        <div style={{ marginBottom: '40px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', backgroundColor: '#222', padding: '10px 15px', borderRadius: '4px' }}>
            <div onClick={() => setIsDiscogsOpen(!isDiscogsOpen)} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <h3 style={{ margin: 0, color: 'white' }}>Discogs Matches</h3>
              <span style={{ fontSize: '18px', fontWeight: 'bold', color: 'white' }}>{isDiscogsOpen ? '–' : '+'}</span>
            </div>
            <a href={discogsDirectUrl} target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: 'white', textDecoration: 'none', fontWeight: 'bold', border: '1px solid white', padding: '4px 8px', borderRadius: '4px' }}>
              View All on Discogs →
            </a>
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
                  <div key={i} style={{ marginBottom: '20px', borderBottom: '1px solid #eee', paddingBottom: '15px' }}>
                    
                    <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                      {item.thumbnail ? (
                        <img src={item.thumbnail} alt="match" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: '80px', height: '80px', backgroundColor: '#eee', borderRadius: '4px', flexShrink: 0 }} />
                      )}
                      
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <a href={item.link} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'left', fontWeight: 'bold', fontSize: '14px', marginBottom: '8px', color: '#0056b3', textDecoration: 'none', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                          {String(item.title || "")}
                        </a>
                        
                        <div style={{ marginTop: 'auto', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', marginBottom: '4px', gap: '4px', width: '100%' }}>
                          <div /> 
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'nowrap' }}>
                            <div style={{ backgroundColor: '#eaf4ea', border: '1px solid #c8e6c9', borderRadius: '4px', padding: '4px 10px', fontSize: '13px', whiteSpace: 'nowrap' }}>
                              <span style={{ color: '#2e7d32', fontWeight: 'bold' }}>Have:</span> <strong style={{ fontSize: '14px', color: '#1b5e20' }}>{dData.have}</strong>
                            </div>
                            <div style={{ backgroundColor: '#fff3e0', border: '1px solid #ffe0b2', borderRadius: '4px', padding: '4px 10px', fontSize: '13px', whiteSpace: 'nowrap' }}>
                              <span style={{ color: '#e65100', fontWeight: 'bold' }}>Want:</span> <strong style={{ fontSize: '14px', color: '#b71c1c' }}>{dData.want}</strong>
                            </div>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            {showMarketLow && dData.activeLow !== '--' && (
                               <div style={{ backgroundColor: '#e3f2fd', border: '1px solid #bbdefb', borderRadius: '4px', padding: '1px 6px', whiteSpace: 'nowrap' }}>
                                 <strong style={{ fontSize: '11px', color: '#0d47a1' }}>{dData.activeLow}</strong>
                               </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div style={{ fontSize: '12px', color: '#333', marginTop: '10px' }}>
                      {dData.format && dData.format !== '--' && (
                        <div style={{ marginBottom: '2px', textAlign: 'left' }}>
                          <span style={{ color: '#4527a0', fontWeight: 'bold' }}>Format:</span> {renderFormat(dData.format)}
                        </div>
                      )}
                      
                      <div style={{ display: 'flex', gap: '15px', flexWrap: 'nowrap', overflow: 'hidden', whiteSpace: 'nowrap', textAlign: 'left' }}>
                        {dData.label && dData.label !== '--' && (
                          <div><span style={{ color: '#4527a0', fontWeight: 'bold' }}>Label:</span> {String(dData.label)}</div>
                        )}
                        {dData.country && dData.country !== '--' && (
                          <div><span style={{ color: '#4527a0', fontWeight: 'bold' }}>Country:</span> {String(dData.country)}</div>
                        )}
                        {dData.released && dData.released !== '--' && (
                          <div><span style={{ color: '#4527a0', fontWeight: 'bold' }}>Released:</span> {String(dData.released)}</div>
                        )}
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
      {hasSearched && showEbay && (
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
                  
                  <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt="match" style={{ width: '70px', height: '70px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: '70px', height: '70px', backgroundColor: '#eee', borderRadius: '4px', flexShrink: 0 }} />
                    )}
                    
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <a href={item.link} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'left', fontWeight: 'bold', fontSize: '14px', marginBottom: '6px', textDecoration: 'none', color: '#333', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                        {String(item.title || "")}
                      </a>
                      
                      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: 'auto', marginBottom: '2px' }}>
                        <span style={{ fontWeight: 'bold', color: item.price ? 'green' : '#666', fontSize: '15px' }}>
                          {typeof item.price === 'string' && item.price ? item.price : "View on eBay"}
                        </span>
                        {typeof item.shipping === 'string' && item.shipping && (
                          <span style={{ fontSize: '12px', color: '#777' }}>{item.shipping}</span>
                        )}
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
      {hasSearched && showEbay && (
        <div style={{ marginBottom: '40px', borderTop: '4px solid #8b0000', paddingTop: '20px' }}>
          <div onClick={() => setIsEbaySoldOpen(!isEbaySoldOpen)} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px', backgroundColor: '#8b0000', padding: '10px 15px', borderRadius: '4px', cursor: 'pointer' }}>
            <h3 style={{ margin: 0, color: 'white' }}>eBay Sold History</h3>
            <span style={{ fontSize: '18px', fontWeight: 'bold', color: 'white' }}>{isEbaySoldOpen ? '–' : '+'}</span>
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
