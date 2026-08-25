'use client'
import { useState } from 'react';

export default function Home() {
  const [results, setResults] = useState([]);
  const [ebaySold, setEbaySold] = useState([]);
  const [appraisal, setAppraisal] = useState(null);
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
    setLoading(true); setErrorMsg(""); setResults([]); setEbaySold([]); setAppraisal(null); setTextQuery("");
    
    try {
      const smallFile = await shrinkImage(file);
      const formData = new FormData(); formData.append('image', smallFile);
      const res = await fetch('/api/search', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      setResults(data.results || []);
      setEbaySold(data.ebaySold || []);
      setAppraisal(data.appraisal || null);
      setTextQuery(data.textQuery || "");
    } catch (error) { setErrorMsg("Something went wrong: " + error.message); } 
    finally { setLoading(false); }
  };

  const discogsActive = results.filter(r => r.link.includes('discogs.com'));
  const ebayActive = results.filter(r => r.link.includes('ebay.com'));
  
  const calculateEstTotal = (app) => {
    const vals = [app.discogs.val, app.ebayActive.val, app.ebaySold.val, app.popsike.val].filter(v => v !== null);
    if (vals.length === 0) return '---';
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
  };

  return (
    <main style={{ padding: '15px', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto', backgroundColor: '#fff' }}>
      <h2 style={{ borderBottom: '2px solid black', paddingBottom: '10px' }}>Record Lens</h2>
      
      <input type="file" accept="image/*" capture="environment" onChange={handleCapture} style={{ padding: '10px', fontSize: '16px', marginBottom: '15px', width: '100%', backgroundColor: '#f9f9f9', border: '1px solid #ccc', borderRadius: '5px' }} />
      
      {loading && <p style={{ fontWeight: 'bold', color: '#0070f3' }}>Scanning artwork & pulling 6-sample averages...</p>}
      {errorMsg && <p style={{ color: 'red' }}>{errorMsg}</p>}
      
      {/* 1. TEXT EXTRACTOR */}
      {textQuery && !loading && (
        <div style={{ padding: '15px', backgroundColor: '#f0f0f0', borderRadius: '8px', marginBottom: '20px' }}>
          <p style={{ margin: '0 0 5px 0', fontSize: '12px', color: 'gray' }}>Google Lens Detected Text / Barcode:</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '16px' }}>{textQuery}</strong>
            <button onClick={() => { navigator.clipboard.writeText(textQuery); setCopySuccess(true); setTimeout(() => setCopySuccess(false), 2000); }}
              style={{ padding: '8px 12px', backgroundColor: '#000', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
              {copySuccess ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {/* 2. TAMPERMONKEY APPRAISAL OVERLAY UI */}
      {appraisal && (
        <div style={{ border: '1px solid #ccc', borderRadius: '8px', overflow: 'hidden', marginBottom: '30px', boxShadow: '0 4px 14px rgba(0,0,0,0.1)' }}>
          <div style={{ background: '#2a2a2a', color: '#fff', padding: '10px 15px', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>
            Appraisal & Listing Tool <span>(6-Sample Avg)</span>
          </div>
          <div style={{ padding: '15px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '15px' }}>
              <a href={appraisal.discogs.link} target="_blank" style={{ color: '#007bff', textDecoration: 'none', fontWeight: 'bold' }}>Discogs</a>
              <strong>{appraisal.discogs.val ? `$${appraisal.discogs.val.toFixed(2)}` : '---'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '15px' }}>
              <a href={appraisal.ebayActive.link} target="_blank" style={{ color: '#007bff', textDecoration: 'none', fontWeight: 'bold' }}>eBay Active</a>
              <strong>{appraisal.ebayActive.val ? `$${appraisal.ebayActive.val.toFixed(2)}` : '---'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '15px' }}>
              <a href={appraisal.ebaySold.link} target="_blank" style={{ color: '#007bff', textDecoration: 'none', fontWeight: 'bold' }}>eBay Sold</a>
              <strong>{appraisal.ebaySold.val ? `$${appraisal.ebaySold.val.toFixed(2)}` : '---'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px', fontSize: '15px' }}>
              <a href={appraisal.popsike.link} target="_blank" style={{ color: '#007bff', textDecoration: 'none', fontWeight: 'bold' }}>Popsike</a>
              <strong>{appraisal.popsike.val ? `$${appraisal.popsike.val.toFixed(2)}` : '---'}</strong>
            </div>
            <div style={{ borderTop: '1px solid #eee', paddingTop: '12px', textAlign: 'center', fontWeight: 'bold', fontSize: '18px' }}>
              EST. Total Value: <span style={{ color: '#28a745' }}>${calculateEstTotal(appraisal)}</span>
            </div>
          </div>
        </div>
      )}

      {/* 3. DISCOGS ACTIVE SECTION */}
      {discogsActive.length > 0 && (
        <div style={{ marginBottom: '40px' }}>
          <h3 style={{ backgroundColor: '#333', color: 'white', padding: '10px 15px', borderRadius: '4px', margin: '0 0 15px 0' }}>Discogs Matches</h3>
          {discogsActive.map((item, i) => (
            <div key={i} style={{ marginBottom: '20px', borderBottom: '2px solid #eee', paddingBottom: '20px' }}>
              <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                {item.thumbnail ? <img src={item.thumbnail} alt="match" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} /> : <div style={{ width: '80px', height: '80px', backgroundColor: '#eee', borderRadius: '4px', flexShrink: 0 }} />}
                <div style={{ flex: 1 }}>
                  <a href={item.link} target="_blank" rel="noreferrer" style={{ display: 'block', fontWeight: 'bold', fontSize: '15px', marginBottom: '5px' }}>{item.title}</a>
                  <div style={{ fontSize: '12px', color: 'gray' }}>Source: Discogs</div>
                </div>
              </div>
              
              {item.discogsData && item.link.includes('discogs.com') && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px', backgroundColor: '#fafafa', padding: '12px', borderRadius: '6px', marginTop: '15px', border: '1px solid #e0e0e0' }}>
                  <div><span style={{color: 'gray'}}>Have:</span> <strong>{item.discogsData.have}</strong></div>
                  <div><span style={{color: 'gray'}}>Want:</span> <strong>{item.discogsData.want}</strong></div>
                  <div><span style={{color: 'gray'}}>Avg Rating:</span> <strong>{item.discogsData.rating}</strong></div>
                  <div><span style={{color: 'gray'}}>Ratings:</span> <strong>{item.discogsData.ratingsCount}</strong></div>
                  <div><span style={{color: 'gray'}}>Last Sold:</span> <strong>{item.discogsData.lastSold}</strong></div>
                  <div><span style={{color: 'gray'}}>Low:</span> <strong>{item.discogsData.low}</strong></div>
                  <div><span style={{color: 'gray'}}>Median:</span> <strong>{item.discogsData.median}</strong></div>
                  <div><span style={{color: 'gray'}}>High:</span> <strong>{item.discogsData.high}</strong></div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 4. EBAY ACTIVE SECTION */}
      {ebayActive.length > 0 && (
        <div style={{ marginBottom: '40px' }}>
          <h3 style={{ backgroundColor: '#0064d2', color: 'white', padding: '10px 15px', borderRadius: '4px', margin: '0 0 15px 0' }}>eBay Active Matches</h3>
          {ebayActive.map((item, i) => (
            <div key={i} style={{ marginBottom: '15px', borderBottom: '1px solid #eee', paddingBottom: '15px' }}>
              <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                {item.thumbnail ? <img src={item.thumbnail} alt="match" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} /> : <div style={{ width: '80px', height: '80px', backgroundColor: '#eee', borderRadius: '4px', flexShrink: 0 }} />}
                <div style={{ flex: 1 }}>
                  <a href={item.link} target="_blank" rel="noreferrer" style={{ display: 'block', fontWeight: 'bold', fontSize: '14px', marginBottom: '5px' }}>{item.title}</a>
                  <div style={{ fontWeight: 'bold', color: 'green', fontSize: '16px', marginBottom: '3px' }}>
                    {item.price ? `${item.price.currency}${item.price.extracted_value}` : "Click to view price"}
                  </div>
                  <div style={{ fontSize: '12px', color: 'gray' }}>Source: eBay</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 5. EBAY SOLD SECTION */}
      {(ebaySold.length > 0 || textQuery) && (
        <div style={{ marginBottom: '40px', borderTop: '4px solid #8b0000', paddingTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h3 style={{ margin: 0, color: '#8b0000' }}>eBay Sold History</h3>
            <a href={appraisal?.ebaySold.link} target="_blank" rel="noreferrer" style={{ fontSize: '13px', color: '#0064d2', textDecoration: 'none', fontWeight: 'bold', border: '1px solid #0064d2', padding: '5px 10px', borderRadius: '4px' }}>
              View All Sold →
            </a>
          </div>
          
          {ebaySold.length === 0 && <p style={{ fontSize: '14px', color: 'gray' }}>No recent sold history found.</p>}
          
          {ebaySold.map((item, i) => (
            <div key={i} style={{ marginBottom: '12px', padding: '12px', backgroundColor: '#fff5f5', borderRadius: '6px', border: '1px solid #fcdcdc' }}>
              <a href={item.link} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: '14px', marginBottom: '8px', color: '#333', textDecoration: 'none' }}>{item.title}</a>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {item.price && <span style={{ fontWeight: 'bold', color: 'green', fontSize: '16px', marginRight: '10px' }}>{item.price.raw}</span>}
                <span style={{ fontSize: '11px', color: 'white', backgroundColor: '#8b0000', padding: '2px 6px', borderRadius: '3px', fontWeight: 'bold' }}>SOLD</span>
                {item.condition && <span style={{ fontSize: '12px', color: 'gray', marginLeft: 'auto' }}>{item.condition}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

    </main>
  );
}
