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
    
    const searchRes = await fetch(`https://serpapi.com/search.json?engine=google_lens&image_id=${uploadJson.image_id}&api_key=${serpapiKey}`);
    const searchJson = await searchRes.json();
    const visualMatches = searchJson.visual_matches || [];

    // 2. TEXT EXTRACTION (Clean and Unbreakable)
    let rawTitle = searchJson.knowledge_graph?.[0]?.title || visualMatches[0]?.title || searchJson.text_results?.[0]?.text || "Vinyl Record";
    let textQuery = "Vinyl Record";
    
    if (rawTitle) {
        let cleaned = rawTitle.replace(/eBay|Discogs|Popsike|Vinyl|LP|CD|Record|Album/ig, '')
                              .replace(/[-|—]/g, ' ')
                              .replace(/[^a-zA-Z0-9\s]/g, '')
                              .trim();
        let words = cleaned.split(/\s+/).filter(w => w.length > 0);
        if (words.length > 0) textQuery = words.slice(0, 5).join(' ');
    }

    // 3. FORCE DISCOGS RESULTS
    let discogsMatches = [];
    const lensDiscogs = visualMatches.filter(m => m.link?.toLowerCase().includes('discogs.com')).slice(0, 4);
    
    // If Lens found Discogs links, use them. If Lens FAILED, force a direct text search to Discogs API!
    if (lensDiscogs.length > 0) {
        discogsMatches = lensDiscogs.map(m => ({ title: m.title, link: m.link, thumbnail: m.thumbnail, idMatch: m.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i) }));
    } else if (discogsToken && textQuery !== "Vinyl Record") {
        const dSearchRes = await fetch(`https://api.discogs.com/database/search?q=${encodeURIComponent(textQuery)}&type=release&per_page=4`, {
            headers: { 'User-Agent': 'RecordLens/1.0', 'Authorization': `Discogs token=${discogsToken}` }
        });
        if (dSearchRes.ok) {
            const dSearchJson = await dSearchRes.json();
            discogsMatches = (dSearchJson.results || []).map(r => ({
                title: r.title, link: `https://www.discogs.com/release/${r.id}`, thumbnail: r.thumb, idMatch: [null, r.id]
            }));
        }
    }

    // Fetch Discogs Pricing Stats for all found matches
    const finalDiscogs = await Promise.all(discogsMatches.map(async (d) => {
        let discogsData = { have:'--', want:'--', rating:'--', ratingsCount:'--', lastSold:'API Hidden', low:'--', median:'--', high:'--', debug: 'PENDING' };
        if (!discogsToken) {
            discogsData.debug = "NO TOKEN SAVED";
        } else if (d.idMatch) {
            let id = d.idMatch[1];
            try {
                let headers = { 'User-Agent': 'RecordLens/1.0', 'Authorization': `Discogs token=${discogsToken}` };
                if (d.link.includes('/master/')) {
                    let mRes = await fetch(`https://api.discogs.com/masters/${id}`, { headers });
                    if (mRes.ok) id = (await mRes.json()).main_release;
                }
                let [relRes, priceRes] = await Promise.all([
                    fetch(`https://api.discogs.com/releases/${id}`, { headers }),
                    fetch(`https://api.discogs.com/marketplace/price_suggestions/${id}`, { headers })
                ]);
                if (relRes.ok) {
                    let rData = await relRes.json();
                    discogsData.have = rData.community?.have ?? '--';
                    discogsData.want = rData.community?.want ?? '--';
                    discogsData.rating = rData.community?.rating?.average ?? '--';
                    discogsData.ratingsCount = rData.community?.rating?.count ?? '--';
                }
                if (priceRes.ok) {
                    let pData = await priceRes.json();
                    const fmt = v => v ? `$${v.toFixed(2)}` : '--';
                    discogsData.low = fmt(pData["Good (G)"]?.value);
                    discogsData.median = fmt(pData["Very Good Plus (VG+)"]?.value);
                    discogsData.high = fmt(pData["Near Mint (NM or M-)"]?.value);
                    discogsData.debug = "API OK";
                } else {
                    discogsData.debug = `API Error ${priceRes.status}`;
                }
            } catch(e) { discogsData.debug = "API Crash"; }
        } else { discogsData.debug = "NO ID FOUND"; }
        return { title: d.title, link: d.link, thumbnail: d.thumbnail, discogsData };
    }));

    // 4. FORCE EBAY ACTIVE RESULTS
    let ebayActiveMatches = visualMatches.filter(m => m.link?.toLowerCase().includes('ebay.com')).slice(0, 5).map(m => ({
        title: m.title, link: m.link, thumbnail: m.thumbnail, price: m.price?.raw || (m.price?.extracted_value ? `$${m.price.extracted_value}` : null)
    }));

    // If Lens failed to find eBay Active, force a direct eBay Search!
    if (ebayActiveMatches.length === 0 && textQuery !== "Vinyl Record") {
        try {
            const eActRes = await fetch(`https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&api_key=${serpapiKey}`);
            if (eActRes.ok) {
                const eActJson = await eActRes.json();
                ebayActiveMatches = (eActJson.organic_results || []).slice(0, 5).map(item => ({
                    title: item.title, link: item.link, thumbnail: item.thumbnail, price: item.price?.raw || null
                }));
            }
        } catch(e) {}
    }

    // 5. FORCE EBAY SOLD RESULTS
    let ebaySoldResults = [];
    if (textQuery && textQuery !== "Vinyl Record") {
        try {
            const eSoldRes = await fetch(`https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1&api_key=${serpapiKey}`);
            if (eSoldRes.ok) {
                const eSoldJson = await eSoldRes.json();
                ebaySoldResults = (eSoldJson.organic_results || []).slice(0, 10).map(item => ({
                    title: item.title, link: item.link, thumbnail: item.thumbnail, price: item.price?.raw || null, condition: item.condition || ""
                }));
            }
        } catch(e) {}
    }

    return NextResponse.json({ discogsMatches: finalDiscogs, ebayActiveMatches, ebaySoldResults, textQuery });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
