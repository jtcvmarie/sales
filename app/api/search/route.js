import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image'); 
    const manualQuery = formData.get('query'); 

    const serpapiKey = process.env.SERPAPI_KEY;
    const discogsToken = process.env.DISCOGS_TOKEN;
    const botHeaders = { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
    };

    if (!serpapiKey) return NextResponse.json({ error: "Missing SERPAPI_KEY" }, { status: 500 });

    let textQuery = "Vinyl Record";
    let discogsLinks = [];
    let ebayLinks = [];

    // ==========================================
    // ROUTE 1: Image Upload (Google Lens)
    // ==========================================
    if (file) {
      const uploadData = new FormData();
      uploadData.append('image', file);
      uploadData.append('api_key', serpapiKey);
      
      const uploadRes = await fetch('https://serpapi.com/image', { method: 'POST', body: uploadData });
      const uploadJson = await uploadRes.json();
      
      const searchRes = await fetch(`https://serpapi.com/search.json?engine=google_lens&image_id=${uploadJson.image_id}&api_key=${serpapiKey}`);
      const searchJson = await searchRes.json();
      const visualMatches = searchJson.visual_matches || [];

      let rawTitle = searchJson.knowledge_graph?.[0]?.title || visualMatches[0]?.title || "Vinyl Record";
      let cleanText = rawTitle.replace(/[-|—–]/g, ' ').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
      textQuery = cleanText.split(' ').slice(0, 10).join(' ') || "Vinyl Record";

      discogsLinks = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('discogs.com')).slice(0, 15);
      ebayLinks = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('ebay.com')).slice(0, 10);
    } 
    // ==========================================
    // ROUTE 2: Manual Text Search
    // ==========================================
    else if (manualQuery) {
      textQuery = manualQuery;
      
      const dPromise = discogsToken ? fetch(`https://api.discogs.com/database/search?q=${encodeURIComponent(textQuery)}&type=release&per_page=15`, {
        headers: { 'User-Agent': 'RecordLens/17.0', 'Authorization': `Discogs token=${discogsToken}` }
      }).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null);
      
      const ePromise = fetch(`https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&api_key=${serpapiKey}`)
        .then(r => r.ok ? r.json() : null).catch(() => null);

      const [dJson, eJson] = await Promise.all([dPromise, ePromise]);

      if (dJson && dJson.results) {
          discogsLinks = dJson.results.map(r => ({ link: `https://www.discogs.com/release/${r.id}`, title: r.title, thumbnail: r.thumb }));
      }
      if (eJson && eJson.organic_results) {
          ebayLinks = eJson.organic_results.slice(0, 10).map(r => ({ 
              link: r.link, 
              title: r.title, 
              thumbnail: r.thumbnail, 
              price: { raw: r.price?.raw },
              shipping: r.shipping || "" 
          }));
      }
    } else {
      return NextResponse.json({ error: "No image or query provided" }, { status: 400 });
    }

    // ==========================================
    // SIMULTANEOUS DATA PROCESSING
    // ==========================================

    const discogsTask = Promise.all(discogsLinks.map(async (match) => {
      let discogsData = { have: '--', want: '--', activeLow: '--', label: '--', format: '--', country: '--', released: '--' };
      if (discogsToken) {
        const idMatch = match.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
        if (idMatch) {
          let id = idMatch[1];
          const headers = { 'User-Agent': 'RecordLens/17.0', 'Authorization': `Discogs token=${discogsToken}` };
          try {
            if (match.link.includes('/master/')) {
              const mRes = await fetch(`https://api.discogs.com/masters/${id}`, { headers });
              if (mRes.ok) id = (await mRes.json()).main_release;
            }
            const relRes = await fetch(`https://api.discogs.com/releases/${id}`, { headers });
            if (relRes.ok) {
              const rData = await relRes.json();
              
              discogsData.have = rData.community?.have ?? '--';
              discogsData.want = rData.community?.want ?? '--';
              if (rData.lowest_price) discogsData.activeLow = `$${rData.lowest_price.toFixed(2)}`;
              
              discogsData.country = rData.country || '--';
              discogsData.released = rData.year || rData.released || '--';
              
              if (rData.labels && rData.labels.length > 0) {
                  let labelStr = rData.labels[0].name || '';
                  let catno = rData.labels[0].catno || '';
                  if (labelStr && catno && catno !== 'none') discogsData.label = `${labelStr} – ${catno}`;
                  else if (labelStr) discogsData.label = labelStr;
              }
              
              if (rData.formats && rData.formats.length > 0) {
                  let fmt = rData.formats[0];
                  let fmtArr = [];
                  if (fmt.name) fmtArr.push(fmt.name);
                  if (fmt.descriptions) fmtArr.push(...fmt.descriptions);
                  if (fmt.text) fmtArr.push(fmt.text);
                  if (fmtArr.length > 0) discogsData.format = fmtArr.join(', ');
              }
            }
          } catch (err) {}
        }
      }
      return { title: match.title, link: match.link, thumbnail: match.thumbnail, discogsData };
    }));

    const ebayActiveTask = Promise.all(ebayLinks.map(async (m) => {
      let price = m.price?.raw || (m.price?.extracted_value ? `$${m.price.extracted_value}` : null);
      let shipping = m.shipping || "";
      
      if (!price || !shipping || m.link.includes('ebay.io')) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 1200); 
          const res = await fetch(m.link, { headers: botHeaders, signal: controller.signal });
          clearTimeout(timeoutId);
          const html = await res.text();
          
          if (!price) {
              const metaPrice = html.match(/itemprop="price" content="([^"]+)"/i);
              if (metaPrice) price = `$${metaPrice[1]}`;
              else {
                const backupMatch = html.match(/class="ux-textspans ux-textspans--BOLD"[^>]*>\s*([A-Z£€]*\s*\$?\s*[\d,.]+)\s*<\/span>/i) || html.match(/id="prcIsum_bidPrice"[^>]*>\s*([A-Z£€]*\s*\$?\s*[\d,.]+)/i);
                if (backupMatch) price = backupMatch[1].trim();
              }
          }
          
          if (!shipping) {
              const shipMatch = html.match(/>\s*(Free shipping|Free Shipping)\s*</i) || 
                                html.match(/>\s*(\+\s*\$[\d.]+\s*shipping)\s*</i) || 
                                html.match(/class="ux-textspans ux-textspans--SECONDARY ux-textspans--BOLD"[^>]*>([^<]*(?:shipping|Shipping))<\/span>/i) || 
                                html.match(/id="fshippingCost"[^>]*>([^<]+)<\/span>/i);
              if (shipMatch) shipping = shipMatch[1].replace(/<[^>]+>/g, '').trim();
          }

        } catch (e) {}
      }
      return { title: m.title, link: m.link, thumbnail: m.thumbnail, price, shipping };
    }));

    const [discogsMatches, ebayActiveMatches] = await Promise.all([ discogsTask, ebayActiveTask ]);

    return NextResponse.json({ discogsMatches, ebayActiveMatches, textQuery });
    
  } catch (error) {
    return NextResponse.json({ error: "Server error: " + error.message }, { status: 500 });
  }
}
