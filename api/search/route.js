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

    // 2. IRONCLAD TEXT EXTRACTION (Guarantees eBay Sold runs)
    let textQuery = "";
    if (searchJson.knowledge_graph && searchJson.knowledge_graph.length > 0) {
      textQuery = searchJson.knowledge_graph[0].title;
    } else if (matches.length > 0) {
      // If Lens fails to extract text, steal the title of the first match and clean it up
      textQuery = matches[0].title.replace(/- eBay.*/i, '').replace(/- Discogs.*/i, '').replace(/\|.*/g, '').trim();
    } else if (searchJson.text_results && searchJson.text_results.length > 0) {
      textQuery = searchJson.text_results[0].text;
    }

    // 3. FAST, PARALLEL API CALLS (No HTML Scraping allowed)
    const fetchDiscogsStats = async (link) => {
       let discogsData = { have:'--', want:'--', rating:'--', ratingsCount:'--', lastSold:'API Hidden', low:'--', median:'--', high:'--' };
       if (!process.env.DISCOGS_TOKEN) return discogsData;

       try {
          let releaseId = null;
          // Grabs ID whether it is a normal release, a sell page, or a master page
          const mRel = link.match(/\/(?:release|sell\/release|sell\/item)\/(\d+)/);
          const mMast = link.match(/\/master\/(\d+)/);
          const headers = { 'User-Agent': 'RecordLens/1.0', 'Authorization': `Discogs token=${process.env.DISCOGS_TOKEN}` };

          if (mRel) {
              releaseId = mRel[1];
          } else if (mMast) {
              const mastRes = await fetch(`https://api.discogs.com/masters/${mMast[1]}`, { headers });
              if(mastRes.ok) {
                  const mastJson = await mastRes.json();
                  releaseId = mastJson.main_release;
              }
          }

          if (releaseId) {
             const [relRes, priceRes] = await Promise.all([
                fetch(`https://api.discogs.com/releases/${releaseId}`, {headers}),
                fetch(`https://api.discogs.com/marketplace/price_suggestions/${releaseId}`, {headers})
             ]);
             
             if (relRes.ok) {
                const relJson = await relRes.json();
                discogsData.have = relJson.community?.have ?? '--';
                discogsData.want = relJson.community?.want ?? '--';
                discogsData.rating = relJson.community?.rating?.average ?? '--';
                discogsData.ratingsCount = relJson.community?.rating?.count ?? '--';
             }
             if (priceRes.ok) {
                const priceJson = await priceRes.json();
                const fmt = (val) => val ? `$${val.toFixed(2)}` : '--';
                discogsData.low = fmt(priceJson["Good (G)"]?.value);
                discogsData.median = fmt(priceJson["Very Good Plus (VG+)"]?.value);
                discogsData.high = fmt(priceJson["Near Mint (NM or M-)"]?.value);
             }
          }
       } catch(e) { console.error("Discogs API error"); }
       return discogsData;
    };

    // Process Discogs active matches
    const finalMatchesPromise = Promise.all(matches.map(async (match) => {
      let finalMatch = { title: match.title, link: match.link, thumbnail: match.thumbnail, price: match.price, source: match.source };
      if (match.link.toLowerCase().includes('discogs.com')) {
          finalMatch.discogsData = await fetchDiscogsStats(match.link);
      }
      return finalMatch;
    }));

    // Fetch eBay Sold items via SerpApi eBay Engine
    const fetchEbaySoldPromise = (async () => {
       if (!textQuery) return [];
       try {
          const res = await fetch(`https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1&api_key=${process.env.SERPAPI_KEY}`);
          const json = await res.json();
          return (json.organic_results || []).slice(0, 10);
       } catch(e) { return []; }
    })();

    // Await both processing tasks at the exact same time for maximum speed
    const [finalMatches, ebaySoldResults] = await Promise.all([finalMatchesPromise, fetchEbaySoldPromise]);

    return NextResponse.json({ results: finalMatches, ebaySold: ebaySoldResults, textQuery });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
