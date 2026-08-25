import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image'); 
    
    if (!file) return NextResponse.json({ error: "No image received" }, { status: 400 });
    if (!process.env.SERPAPI_KEY) return NextResponse.json({ error: "Missing SERPAPI_KEY" }, { status: 500 });

    // 1. Google Lens Upload & Search
    const uploadData = new FormData();
    uploadData.append('image', file);
    uploadData.append('api_key', process.env.SERPAPI_KEY);
    
    const uploadRes = await fetch('https://serpapi.com/image', { method: 'POST', body: uploadData });
    const uploadJson = await uploadRes.json();
    
    const searchRes = await fetch(`https://serpapi.com/search.json?engine=google_lens&image_id=${uploadJson.image_id}&api_key=${process.env.SERPAPI_KEY}`);
    const searchJson = await searchRes.json();
    const visualMatches = searchJson.visual_matches || [];

    // 2. DISCOGS API FETCH
    let discogsMatches = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('discogs.com')).slice(0, 5);
    discogsMatches = await Promise.all(discogsMatches.map(async (match) => {
        let discogsData = { have:'--', want:'--', rating:'--', ratingsCount:'--', lastSold:'API Hidden', low:'--', median:'--', high:'--', debug: 'PENDING' };
        
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
                        discogsData.have = rData.community?.have ?? '--';
                        discogsData.want = rData.community?.want ?? '--';
                        discogsData.rating = rData.community?.rating?.average ?? '--';
                        discogsData.ratingsCount = rData.community?.rating?.count ?? '--';
                    }
                    
                    if (priceRes.ok) {
                        const pData = await priceRes.json();
                        const fmt = v => v ? `$${v.toFixed(2)}` : '--';
                        discogsData.low = fmt(pData["Good (G)"]?.value);
                        discogsData.median = fmt(pData["Very Good Plus (VG+)"]?.value);
                        discogsData.high = fmt(pData["Near Mint (NM or M-)"]?.value);
                        discogsData.debug = "API SUCCESS";
                    } else {
                        discogsData.debug = `Price Error ${priceRes.status}`;
                    }
                } catch(e) {
                    discogsData.debug = "API CRASH";
                }
            } else { discogsData.debug = "NO ID FOUND"; }
        } else { discogsData.debug = "NO TOKEN SAVED"; }
        
        return { title: match.title, link: match.link, thumbnail: match.thumbnail, discogsData };
    }));

    // 3. EBAY ACTIVE MATCHES
    let ebayActiveMatches = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('ebay.com')).slice(0, 6).map(match => {
         return {
             title: match.title, link: match.link, thumbnail: match.thumbnail,
             price: match.price?.raw || (match.price?.extracted_value ? `$${match.price.extracted_value}` : null)
         };
    });

    // 4. SMART TEXT QUERY & EBAY SOLD FETCH
    let rawTitle = searchJson.knowledge_graph?.[0]?.title || visualMatches[0]?.title || searchJson.text_results?.[0]?.text || "Vinyl Record";
    // Strips out all junk symbols and keeps the first 4 safe words
    let cleanQuery = rawTitle.replace(/eBay|Discogs|Popsike|Vinyl|LP|CD|Record|Album/ig, '')
                             .replace(/[^a-zA-Z0-9\s]/g, ' ')
                             .trim()
                             .split(/\s+/).filter(w => w.length > 0).slice(0, 4).join(" ");
    if (!cleanQuery) cleanQuery = "Vinyl Record";

    let ebaySoldResults = [];
    try {
        const soldRes = await fetch(`https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(cleanQuery)}&LH_Sold=1&LH_Complete=1&api_key=${process.env.SERPAPI_KEY}`);
        const soldJson = await soldRes.json();
        if (soldJson.organic_results) {
            ebaySoldResults = soldJson.organic_results.slice(0, 10).map(item => ({
                title: item.title, link: item.link, price: item.price?.raw || null, condition: item.condition || ""
            }));
        }
    } catch(e) {}

    return NextResponse.json({ discogsMatches, ebayActiveMatches, ebaySoldResults, textQuery: cleanQuery });
    
  } catch (error) {
    return NextResponse.json({ error: "Server error: " + error.message }, { status: 500 });
  }
}
