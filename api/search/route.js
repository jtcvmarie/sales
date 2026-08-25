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

    const visualMatches = searchJson.visual_matches || [];

    // 1. BASIC STRING EXTRACTION FOR EBAY SOLD
    // We grab the most basic title possible, strip out the junk, and keep only the first 4 words.
    let rawTitle = searchJson.knowledge_graph?.[0]?.title || visualMatches[0]?.title || searchJson.text_results?.[0]?.text || "Vinyl Record";
    let basicString = rawTitle.replace(/(eBay|Discogs|Popsike|Vinyl|LP|CD|Record|Album)/ig, '')
                              .replace(/\|.*/g, '')
                              .replace(/-.*/g, '')
                              .trim();
    let textQuery = basicString.split(/\s+/).slice(0, 4).join(" "); 

    // 2. DISCOGS API LOGIC
    const discogsLinks = visualMatches.filter(m => m.link.toLowerCase().includes('discogs.com')).slice(0, 5);
    const discogsMatches = await Promise.all(discogsLinks.map(async (match) => {
        let discogsData = { have:'--', want:'--', rating:'--', ratingsCount:'--', lastSold:'--', low:'--', median:'--', high:'--', debug: 'PENDING' };
        
        const idMatch = match.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
        if (idMatch) {
            let id = idMatch[1];
            let headers = { 'User-Agent': 'RecordLens/1.0' };
            if (process.env.DISCOGS_TOKEN) {
                headers['Authorization'] = `Discogs token=${process.env.DISCOGS_TOKEN}`;
            }
            
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
                    discogsData.rating = rData.community?.rating?.average ?? '--';
                    discogsData.ratingsCount = rData.community?.rating?.count ?? '--';
                    discogsData.debug = 'API_OK';
                } else {
                    discogsData.debug = `REL_ERROR_${relRes.status}`;
                }
                
                const priceRes = await fetch(`https://api.discogs.com/marketplace/price_suggestions/${id}`, { headers });
                if (priceRes.ok) {
                    const pData = await priceRes.json();
                    const fmt = v => v ? `$${v.toFixed(2)}` : '--';
                    discogsData.low = fmt(pData["Good (G)"]?.value);
                    discogsData.median = fmt(pData["Very Good Plus (VG+)"]?.value);
                    discogsData.high = fmt(pData["Near Mint (NM or M-)"]?.value);
                } else {
                    discogsData.debug += ` | PRICE_ERROR_${priceRes.status}`;
                }
            } catch(e) {
                discogsData.debug = 'API_CRASH';
            }
        } else {
            discogsData.debug = 'NO_ID_FOUND';
        }
        return { ...match, discogsData };
    }));

    // 3. EBAY ACTIVE LENS MATCHES
    const ebayActiveMatches = visualMatches.filter(m => m.link.toLowerCase().includes('ebay.com')).slice(0, 6);

    // 4. EBAY SOLD SERPAPI FETCH
    let ebaySoldResults = [];
    if (textQuery) {
        try {
            const soldRes = await fetch(`https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1&api_key=${process.env.SERPAPI_KEY}`);
            const soldJson = await soldRes.json();
            ebaySoldResults = (soldJson.organic_results || []).slice(0, 10);
        } catch(e) {}
    }

    return NextResponse.json({ discogsMatches, ebayActiveMatches, ebaySoldResults, textQuery });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
