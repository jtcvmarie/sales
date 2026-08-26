import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image'); 
    
    if (!file) return NextResponse.json({ error: "No image received" }, { status: 400 });
    if (!process.env.SERPAPI_KEY) return NextResponse.json({ error: "Missing SERPAPI_KEY" }, { status: 500 });

    // 1. Upload Image to SerpApi
    const uploadData = new FormData();
    uploadData.append('image', file);
    uploadData.append('api_key', process.env.SERPAPI_KEY);
    
    const uploadRes = await fetch('https://serpapi.com/image', { method: 'POST', body: uploadData });
    const uploadJson = await uploadRes.json();
    if (uploadJson.error) return NextResponse.json({ error: "SerpApi Error: " + uploadJson.error }, { status: 500 });
    
    // 2. Google Lens Search (Classic)
    const searchRes = await fetch(`https://serpapi.com/search.json?engine=google_lens&image_id=${uploadJson.image_id}&api_key=${process.env.SERPAPI_KEY}`);
    const searchJson = await searchRes.json();
    if (searchJson.error) return NextResponse.json({ error: "Google Lens Error: " + searchJson.error }, { status: 500 });

    const allowedSites = ["discogs.com", "ebay.com", "popsike.com", "upcitemdb.com"];
    const matches = (searchJson.visual_matches || []).filter(match => {
        if (!match.link) return false;
        return allowedSites.some(s => match.link.toLowerCase().includes(s));
    }).slice(0, 12);

    // 3. Classic Simple Text Extraction
    let rawTitle = "";
    if (searchJson.knowledge_graph && searchJson.knowledge_graph.length > 0) {
      rawTitle = searchJson.knowledge_graph[0].title;
    } else if (matches.length > 0) {
      rawTitle = matches[0].title;
    } else if (searchJson.text_results && searchJson.text_results.length > 0) {
      rawTitle = searchJson.text_results.map(t => t.text).join(" ");
    }

    // Safely trim standard junk (like " - eBay" or pipes) and take 5 words
    let textQuery = "Vinyl Record";
    if (rawTitle) {
      let clean = rawTitle.replace(/(- eBay|- Discogs|\|).*/gi, '').trim();
      textQuery = clean.split(/\s+/).slice(0, 5).join(" ");
    }

    // 4. Process Matches (Discogs API & Lens Prices)
    const finalMatches = await Promise.all(matches.map(async (match) => {
      let result = { 
        title: match.title, 
        link: match.link, 
        thumbnail: match.thumbnail, 
        price: match.price, 
        source: match.source 
      };

      if (match.link.toLowerCase().includes('discogs.com')) {
        result.discogsData = { have:'--', want:'--', rating:'--', ratingsCount:'--', lastSold:'API Hidden', low:'--', median:'--', high:'--', debug: 'PENDING' };
        
        if (!process.env.DISCOGS_TOKEN) {
           result.discogsData.debug = "ERROR: NO DISCOGS TOKEN";
        } else {
           const mRel = match.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
           if (mRel) {
              let id = mRel[1];
              const h = { 'User-Agent': 'RecordLens/1.0', 'Authorization': `Discogs token=${process.env.DISCOGS_TOKEN}` };
              try {
                 if (match.link.includes('/master/')) {
                    const mRes = await fetch(`https://api.discogs.com/masters/${id}`, { headers: h });
                    if (mRes.ok) id = (await mRes.json()).main_release;
                 }
                 const [relRes, priceRes] = await Promise.all([
                    fetch(`https://api.discogs.com/releases/${id}`, { headers: h }),
                    fetch(`https://api.discogs.com/marketplace/price_suggestions/${id}`, { headers: h })
                 ]);

                 if (relRes.ok) {
                    const rData = await relRes.json();
                    result.discogsData.have = rData.community?.have ?? '--';
                    result.discogsData.want = rData.community?.want ?? '--';
                    result.discogsData.rating = rData.community?.rating?.average ?? '--';
                    result.discogsData.ratingsCount = rData.community?.rating?.count ?? '--';
                 } else {
                    result.discogsData.debug = `Release API Error ${relRes.status}`;
                 }

                 if (priceRes.ok) {
                    const pData = await priceRes.json();
                    const fmt = v => v ? `$${v.toFixed(2)}` : '--';
                    result.discogsData.low = fmt(pData["Good (G)"]?.value);
                    result.discogsData.median = fmt(pData["Very Good Plus (VG+)"]?.value);
                    result.discogsData.high = fmt(pData["Near Mint (NM or M-)"]?.value);
                    if(result.discogsData.debug === 'PENDING') result.discogsData.debug = "SUCCESS";
                 } else {
                    result.discogsData.debug = `Price API Error ${priceRes.status}`;
                 }
              } catch (e) { result.discogsData.debug = `Crash: ${e.message}`; }
           } else { result.discogsData.debug = "ERROR: NO ID IN URL"; }
        }
      }
      return result;
    }));

    // 5. Fetch eBay Sold Results
    let ebaySoldResults = [];
    if (textQuery) {
      try {
        const soldUrl = `https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1&api_key=${process.env.SERPAPI_KEY}`;
        const soldRes = await fetch(soldUrl);
        const soldJson = await soldRes.json();
        if (soldJson.organic_results) ebaySoldResults = soldJson.organic_results.slice(0, 10);
      } catch(e) {}
    }

    return NextResponse.json({ results: finalMatches, ebaySold: ebaySoldResults, textQuery });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
