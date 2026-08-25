import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image'); 
    
    if (!file) return NextResponse.json({ error: "No image received" }, { status: 400 });
    if (!process.env.SERPAPI_KEY) return NextResponse.json({ error: "Missing SERPAPI_KEY" }, { status: 500 });

    // 1. Google Lens Image Upload & Search
    const uploadData = new FormData();
    uploadData.append('image', file);
    uploadData.append('api_key', process.env.SERPAPI_KEY);
    
    const uploadRes = await fetch('https://serpapi.com/image', { method: 'POST', body: uploadData });
    const uploadJson = await uploadRes.json();
    if (uploadJson.error) return NextResponse.json({ error: "SerpApi Error: " + uploadJson.error }, { status: 500 });
    
    const searchRes = await fetch(`https://serpapi.com/search.json?engine=google_lens&image_id=${uploadJson.image_id}&api_key=${process.env.SERPAPI_KEY}`);
    const searchJson = await searchRes.json();
    if (searchJson.error) return NextResponse.json({ error: "Google Lens Error: " + searchJson.error }, { status: 500 });

    const allowedSites = ["discogs.com", "ebay.com", "popsike.com", "upcitemdb.com"];
    const matches = (searchJson.visual_matches || []).filter(match => allowedSites.some(s => match.link.toLowerCase().includes(s))).slice(0, 10);

    // 2. Safely Extract Text Query
    let textQuery = "";
    if (searchJson.knowledge_graph && searchJson.knowledge_graph.length > 0) {
      textQuery = searchJson.knowledge_graph[0].title;
    } else if (searchJson.text_results && searchJson.text_results.length > 0) {
      textQuery = searchJson.text_results.map(t => t.text).join(" ");
    } else if (matches.length > 0) {
      textQuery = matches[0].title.replace(/eBay|Discogs|Popsike/ig, '').replace(/\|.*/, '').trim();
    }

    // 3. Process Discogs Matches Using ONLY Your API Token
    const finalMatches = await Promise.all(matches.map(async (match) => {
      if (match.link.toLowerCase().includes('discogs.com')) {
        
        // This guarantees the grid object always exists, even if the API fails
        match.discogsData = { have:'--', want:'--', rating:'--', ratingsCount:'--', lastSold:'API Hidden', low:'--', median:'--', high:'--' };
        
        try {
          if (process.env.DISCOGS_TOKEN) {
            const headers = { 'User-Agent': 'RecordLens/1.0', 'Authorization': `Discogs token=${process.env.DISCOGS_TOKEN}` };
            let releaseId = null;
            
            const mRel = match.link.match(/\/(?:release|sell\/release)\/(\d+)/);
            const mMast = match.link.match(/\/master\/(\d+)/);
            
            if (mRel) releaseId = mRel[1];
            else if (mMast) {
               const mastRes = await fetch(`https://api.discogs.com/masters/${mMast[1]}`, { headers });
               if (mastRes.ok) {
                   const mastJson = await mastRes.json();
                   releaseId = mastJson.main_release;
               }
            }

            if (releaseId) {
               const [relRes, priceRes] = await Promise.all([
                 fetch(`https://api.discogs.com/releases/${releaseId}`, { headers }),
                 fetch(`https://api.discogs.com/marketplace/price_suggestions/${releaseId}`, { headers })
               ]);
               
               if (relRes.ok) {
                   const relJson = await relRes.json();
                   match.discogsData.have = relJson.community?.have ?? '--';
                   match.discogsData.want = relJson.community?.want ?? '--';
                   match.discogsData.rating = relJson.community?.rating?.average ?? '--';
                   match.discogsData.ratingsCount = relJson.community?.rating?.count ?? '--';
               }
               if (priceRes.ok) {
                   const priceJson = await priceRes.json();
                   match.discogsData.low = priceJson["Good (G)"]?.value ? `$${priceJson["Good (G)"].value.toFixed(2)}` : '--';
                   match.discogsData.median = priceJson["Very Good Plus (VG+)"]?.value ? `$${priceJson["Very Good Plus (VG+)"].value.toFixed(2)}` : '--';
                   match.discogsData.high = priceJson["Near Mint (NM or M-)"]?.value ? `$${priceJson["Near Mint (NM or M-)"].value.toFixed(2)}` : '--';
               }
            }
          }
        } catch (e) {
           console.error("Discogs API Error:", e);
        }
      }
      return match;
    }));

    // 4. Fetch eBay Sold using SerpApi
    let ebaySoldResults = [];
    if (textQuery) {
      try {
        const ebayUrl = `https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1&api_key=${process.env.SERPAPI_KEY}`;
        const ebayRes = await fetch(ebayUrl);
        const ebayJson = await ebayRes.json();
        if (ebayJson.organic_results) {
           ebaySoldResults = ebayJson.organic_results.slice(0, 10);
        }
      } catch(e) {
        console.error("eBay Sold API Error:", e);
      }
    }

    return NextResponse.json({ results: finalMatches, ebaySold: ebaySoldResults, textQuery });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
