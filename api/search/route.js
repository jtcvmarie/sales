import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image'); 
    
    if (!file) return NextResponse.json({ error: "No image received" }, { status: 400 });
    if (!process.env.SERPAPI_KEY) return NextResponse.json({ error: "Missing SERPAPI_KEY" }, { status: 500 });

    const serpapiKey = process.env.SERPAPI_KEY;
    const discogsToken = process.env.DISCOGS_TOKEN;

    // 1. Google Lens Upload & Search
    const uploadData = new FormData();
    uploadData.append('image', file);
    uploadData.append('api_key', serpapiKey);
    
    const uploadRes = await fetch('https://serpapi.com/image', { method: 'POST', body: uploadData });
    const uploadJson = await uploadRes.json();
    if (uploadJson.error) return NextResponse.json({ error: "SerpApi Error: " + uploadJson.error }, { status: 500 });
    
    const searchRes = await fetch(`https://serpapi.com/search.json?engine=google_lens&image_id=${uploadJson.image_id}&api_key=${serpapiKey}`);
    const searchJson = await searchRes.json();
    if (searchJson.error) return NextResponse.json({ error: "Google Lens Error: " + searchJson.error }, { status: 500 });

    const visualMatches = searchJson.visual_matches || [];

    // 2. TEXT EXTRACTION (Restored to trusted logic for eBay Sold)
    let rawTitle = searchJson.knowledge_graph?.[0]?.title || visualMatches[0]?.title || searchJson.text_results?.[0]?.text || "";
    let cleanStr = rawTitle.replace(/eBay|Discogs|Popsike|Vinyl|LP|CD|Record|Album/ig, '')
                           .replace(/[-|—]/g, ' ')
                           .replace(/[^a-zA-Z0-9\s]/g, '')
                           .trim();
    let textQuery = cleanStr.split(/\s+/).filter(w => w.length > 0).slice(0, 5).join(' ');

    // 3. SEPARATE MATCHES (Discogs & eBay Active)
    let discogsMatches = [];
    let ebayActiveMatches = [];

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

    // 4. PULL DISCOGS STATS WITH SPECIFIC ERROR DIAGNOSTICS
    for (let i = 0; i < discogsMatches.length; i++) {
        let dMatch = discogsMatches[i];
        dMatch.discogsData = { have:'--', want:'--', rating:'--', ratingsCount:'--', lastSold:'--', low:'--', median:'--', high:'--', debug: 'PROCESSING' };
        
        if (!discogsToken) {
            dMatch.discogsData.debug = "Status: Missing DISCOGS_TOKEN in Vercel settings";
            continue;
        }

        let idMatch = dMatch.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
        if (!idMatch) {
            dMatch.discogsData.debug = "Status: Could not find Release ID in Discogs URL";
            continue;
        }

        let releaseId = idMatch[1];
        let headers = { 'User-Agent': 'RecordLens/1.0', 'Authorization': `Discogs token=${discogsToken}` };

        try {
            if (dMatch.link.includes('/master/')) {
                let mRes = await fetch(`https://api.discogs.com/masters/${releaseId}`, { headers });
                if (!mRes.ok) throw new Error(`Master API Rejected (Status ${mRes.status})`);
                let mJson = await mRes.json();
                releaseId = mJson.main_release;
            }

            let [relRes, priceRes] = await Promise.all([
                fetch(`https://api.discogs.com/releases/${releaseId}`, { headers }),
                fetch(`https://api.discogs.com/marketplace/price_suggestions/${releaseId}`, { headers })
            ]);

            if (!relRes.ok) throw new Error(`Release API Rejected (Status ${relRes.status})`);
            let rData = await relRes.json();
            dMatch.discogsData.have = rData.community?.have ?? '--';
            dMatch.discogsData.want = rData.community?.want ?? '--';
            dMatch.discogsData.rating = rData.community?.rating?.average ?? '--';
            dMatch.discogsData.ratingsCount = rData.community?.rating?.count ?? '--';

            if (!priceRes.ok) throw new Error(`Price API Rejected (Status ${priceRes.status} - Check Discogs Seller Profile)`);
            let pData = await priceRes.json();
            const fmt = v => v ? `$${v.toFixed(2)}` : '--';
            dMatch.discogsData.low = fmt(pData["Good (G)"]?.value);
            dMatch.discogsData.median = fmt(pData["Very Good Plus (VG+)"]?.value);
            dMatch.discogsData.high = fmt(pData["Near Mint (NM or M-)"]?.value);
            dMatch.discogsData.debug = "SUCCESS";

        } catch (err) {
            dMatch.discogsData.debug = `Status: ${err.message}`;
        }
    }

    // 5. FETCH EBAY SOLD
    let ebaySoldResults = [];
    if (textQuery) {
        try {
            let soldUrl = `https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1&api_key=${serpapiKey}`;
            let soldRes = await fetch(soldUrl);
            let soldJson = await soldRes.json();
            if (soldJson.organic_results) {
                ebaySoldResults = soldJson.organic_results.slice(0, 10).map(item => ({
                    title: item.title, link: item.link, price: item.price?.raw || null, condition: item.condition || ""
                }));
            }
        } catch(e) {}
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
