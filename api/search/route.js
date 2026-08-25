import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image'); 
    
    if (!file) return NextResponse.json({ error: "No image received" }, { status: 400 });
    if (!process.env.SERPAPI_KEY) return NextResponse.json({ error: "Missing SERPAPI_KEY" }, { status: 500 });

    const serpapiKey = process.env.SERPAPI_KEY;
    const discogsToken = process.env.DISCOGS_TOKEN;

    // 1. Upload to SerpApi
    const uploadData = new FormData();
    uploadData.append('image', file);
    uploadData.append('api_key', serpapiKey);
    
    const uploadRes = await fetch('https://serpapi.com/image', { method: 'POST', body: uploadData });
    const uploadJson = await uploadRes.json();
    if (uploadJson.error) return NextResponse.json({ error: "SerpApi Upload Error: " + uploadJson.error }, { status: 500 });
    
    // 2. Google Lens Search
    const searchRes = await fetch(`https://serpapi.com/search.json?engine=google_lens&image_id=${uploadJson.image_id}&api_key=${serpapiKey}`);
    const searchJson = await searchRes.json();
    if (searchJson.error) return NextResponse.json({ error: "Google Lens Error: " + searchJson.error }, { status: 500 });

    // 3. UNBREAKABLE TEXT EXTRACTION
    let textQuery = "Vinyl Record";
    try {
        let rawTitle = searchJson.knowledge_graph?.[0]?.title || searchJson.visual_matches?.[0]?.title || searchJson.text_results?.[0]?.text;
        if (rawTitle) {
            // Just swap hyphens and pipes for spaces, then take the first 5 words. No aggressive deleting.
            let cleaned = rawTitle.replace(/[-|]/g, ' ').replace(/[^a-zA-Z0-9\s]/g, '').trim();
            let words = cleaned.split(/\s+/).filter(w => w.length > 0);
            if (words.length > 0) {
                textQuery = words.slice(0, 5).join(' ');
            }
        }
    } catch(e) {
        textQuery = "Vinyl Record";
    }

    // 4. EXPLICITLY SEPARATE MATCHES
    let discogsMatches = [];
    let ebayActiveMatches = [];
    
    const visualMatches = searchJson.visual_matches || [];
    for (let i = 0; i < visualMatches.length; i++) {
        let match = visualMatches[i];
        if (!match.link) continue;
        
        let linkStr = match.link.toLowerCase();
        if (linkStr.includes('discogs.com') && discogsMatches.length < 5) {
            discogsMatches.push({ title: match.title, link: match.link, thumbnail: match.thumbnail });
        }
        if (linkStr.includes('ebay.com') && ebayActiveMatches.length < 6) {
            ebayActiveMatches.push({ 
                title: match.title, 
                link: match.link, 
                thumbnail: match.thumbnail, 
                price: match.price?.raw || (match.price?.extracted_value ? `$${match.price.extracted_value}` : null) 
            });
        }
    }

    // 5. FETCH DISCOGS STATS SAFELY
    for (let i = 0; i < discogsMatches.length; i++) {
        let dMatch = discogsMatches[i];
        dMatch.discogsData = { have:'--', want:'--', rating:'--', ratingsCount:'--', lastSold:'API Hidden', low:'--', median:'--', high:'--', debug: 'PENDING' };
        
        try {
            if (!discogsToken) {
                dMatch.discogsData.debug = "NO DISCOGS TOKEN SAVED";
                continue;
            }

            let idMatch = dMatch.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
            if (!idMatch) {
                dMatch.discogsData.debug = "NO ID IN URL";
                continue;
            }

            let id = idMatch[1];
            let headers = { 'User-Agent': 'RecordLens/1.0', 'Authorization': `Discogs token=${discogsToken}` };
            
            if (dMatch.link.includes('/master/')) {
                let mRes = await fetch(`https://api.discogs.com/masters/${id}`, { headers });
                if (mRes.ok) {
                    let mJson = await mRes.json();
                    id = mJson.main_release;
                }
            }

            let [relRes, priceRes] = await Promise.all([
                fetch(`https://api.discogs.com/releases/${id}`, { headers }),
                fetch(`https://api.discogs.com/marketplace/price_suggestions/${id}`, { headers })
            ]);

            if (relRes.ok) {
                let rData = await relRes.json();
                dMatch.discogsData.have = rData.community?.have ?? '--';
                dMatch.discogsData.want = rData.community?.want ?? '--';
                dMatch.discogsData.rating = rData.community?.rating?.average ?? '--';
                dMatch.discogsData.ratingsCount = rData.community?.rating?.count ?? '--';
            }

            if (priceRes.ok) {
                let pData = await priceRes.json();
                const fmt = v => v ? `$${v.toFixed(2)}` : '--';
                dMatch.discogsData.low = fmt(pData["Good (G)"]?.value);
                dMatch.discogsData.median = fmt(pData["Very Good Plus (VG+)"]?.value);
                dMatch.discogsData.high = fmt(pData["Near Mint (NM or M-)"]?.value);
                dMatch.discogsData.debug = "SUCCESS";
            } else {
                dMatch.discogsData.debug = `Price Error ${priceRes.status}`;
            }
        } catch(e) {
            dMatch.discogsData.debug = `Crash: ${e.message}`;
        }
    }

    // 6. FETCH EBAY SOLD
    let ebaySoldResults = [];
    try {
        let soldUrl = `https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1&api_key=${serpapiKey}`;
        let soldRes = await fetch(soldUrl);
        let soldJson = await soldRes.json();
        if (soldJson.organic_results) {
            ebaySoldResults = soldJson.organic_results.slice(0, 10).map(item => ({
                title: item.title, link: item.link, price: item.price?.raw || null, condition: item.condition || ""
            }));
        }
    } catch(e) {
        console.error("eBay Sold Error");
    }

    return NextResponse.json({
        discogsMatches,
        ebayActiveMatches,
        ebaySoldResults,
        textQuery
    });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
