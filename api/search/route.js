import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image'); 
    
    if (!file) return NextResponse.json({ error: "No image received" }, { status: 400 });
    if (!process.env.SERPAPI_KEY) return NextResponse.json({ error: "Missing SERPAPI_KEY" }, { status: 500 });

    const uploadData = new FormData();
    uploadData.append('image', file);
    uploadData.append('api_key', process.env.SERPAPI_KEY);
    
    const uploadRes = await fetch('https://serpapi.com/image', { method: 'POST', body: uploadData });
    const uploadJson = await uploadRes.json();
    if (uploadJson.error) return NextResponse.json({ error: "SerpApi Error: " + uploadJson.error }, { status: 500 });
    
    const searchRes = await fetch(`https://serpapi.com/search.json?engine=google_lens&image_id=${uploadJson.image_id}&api_key=${process.env.SERPAPI_KEY}`);
    const searchJson = await searchRes.json();
    if (searchJson.error) return NextResponse.json({ error: "Google Lens Error: " + searchJson.error }, { status: 500 });

    // 1. ALLOW NORMAL IMAGE SEARCH TO POPULATE
    const allowedSites = ["discogs.com", "ebay.com", "popsike.com", "upcitemdb.com"];
    const visualMatches = (searchJson.visual_matches || []).filter(match => match.link && allowedSites.some(s => match.link.toLowerCase().includes(s))).slice(0, 15);

    // 2. JUST TAKE THE FIRST 6 WORDS FOR EBAY SOLD
    let rawTitle = searchJson.knowledge_graph?.[0]?.title || visualMatches[0]?.title || searchJson.text_results?.[0]?.text || "";
    let textQuery = rawTitle ? rawTitle.split(/\s+/).slice(0, 6).join(" ") : "";

    // 3. PULL DISCOGS STATS (Strict API)
    const processedMatches = await Promise.all(visualMatches.map(async (match) => {
        let result = { title: match.title, link: match.link, thumbnail: match.thumbnail, price: match.price, source: match.source };
        
        if (match.link.toLowerCase().includes('discogs.com')) {
            result.discogsData = { have:'--', want:'--', rating:'--', ratingsCount:'--', lastSold:'--', low:'--', median:'--', high:'--' };
            if (process.env.DISCOGS_TOKEN) {
                const idMatch = match.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
                if (idMatch) {
                    let id = idMatch[1];
                    const headers = { 'User-Agent': 'RecordLens/1.0', 'Authorization': `Discogs token=${process.env.DISCOGS_TOKEN}` };
                    try {
                        if (match.link.includes('/master/')) {
                            const mRes = await fetch(`https://api.discogs.com/masters/${id}`, { headers });
                            if (mRes.ok) id = (await mRes.json()).main_release;
                        }
                        
                        const [relRes, priceRes] = await Promise.all([
                            fetch(`https://api.discogs.com/releases/${id}`, { headers }),
                            fetch(`https://api.discogs.com/marketplace/price_suggestions/${id}`, { headers })
                        ]);
                        
                        if (relRes.ok) {
                            const rData = await relRes.json();
                            result.discogsData.have = rData.community?.have ?? '--';
                            result.discogsData.want = rData.community?.want ?? '--';
                            result.discogsData.rating = rData.community?.rating?.average ?? '--';
                            result.discogsData.ratingsCount = rData.community?.rating?.count ?? '--';
                        }
                        if (priceRes.ok) {
                            const pData = await priceRes.json();
                            const fmt = v => v ? `$${v.toFixed(2)}` : '--';
                            result.discogsData.low = fmt(pData["Good (G)"]?.value);
                            result.discogsData.median = fmt(pData["Very Good Plus (VG+)"]?.value);
                            result.discogsData.high = fmt(pData["Near Mint (NM or M-)"]?.value);
                        }
                    } catch(e) { }
                }
            }
        }
        return result;
    }));

    // 4. RUN EBAY SOLD USING THE 6-WORD STRING
    let ebaySoldResults = [];
    if (textQuery) {
        try {
            const soldUrl = `https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1&api_key=${process.env.SERPAPI_KEY}`;
            const soldRes = await fetch(soldUrl);
            const soldJson = await soldRes.json();
            ebaySoldResults = (soldJson.organic_results || []).slice(0, 10);
        } catch(e) {}
    }

    return NextResponse.json({ results: processedMatches, ebaySold: ebaySoldResults, textQuery });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
