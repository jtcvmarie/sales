import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image'); 
    
    if (!file) return NextResponse.json({ error: "No image received" }, { status: 400 });
    if (!process.env.SERPAPI_KEY) return NextResponse.json({ error: "Missing SERPAPI_KEY" }, { status: 500 });

    const serpapiKey = process.env.SERPAPI_KEY;
    const discogsToken = process.env.DISCOGS_TOKEN;

    const uploadData = new FormData();
    uploadData.append('image', file);
    uploadData.append('api_key', serpapiKey);
    
    const uploadRes = await fetch('https://serpapi.com/image', { method: 'POST', body: uploadData });
    const uploadJson = await uploadRes.json();
    if (uploadJson.error) return NextResponse.json({ error: "SerpApi Error: " + uploadJson.error }, { status: 500 });
    
    const searchRes = await fetch(`https://serpapi.com/search.json?engine=google_lens&image_id=${uploadJson.image_id}&api_key=${serpapiKey}`);
    const searchJson = await searchRes.json();
    if (searchJson.error) return NextResponse.json({ error: "Google Lens Error: " + searchJson.error }, { status: 500 });

    const allowedSites = ["discogs.com", "ebay.com", "popsike.com", "upcitemdb.com"];
    const visualMatches = (searchJson.visual_matches || []).filter(match => match.link && allowedSites.some(s => match.link.toLowerCase().includes(s))).slice(0, 10);

    // 1. SAFE TEXT EXTRACTION (Fixed the "" bug by replacing hyphens instead of deleting after them)
    let rawTitle = searchJson.knowledge_graph?.[0]?.title || visualMatches[0]?.title || searchJson.text_results?.[0]?.text || "Vinyl Record";
    let cleanStr = rawTitle.replace(/eBay|Discogs|Popsike|Vinyl|LP|CD|Record|Album/ig, '')
                           .replace(/[-|—]/g, ' ') // Swaps dashes and pipes for spaces so we don't lose the title
                           .replace(/\s+/g, ' ')
                           .trim();
    
    let textQuery = cleanStr.split(' ').slice(0, 5).join(' ');
    if (!textQuery || textQuery.length < 3) textQuery = "Vinyl Record";

    // 2. EXPLICIT OBJECT MAPPING TO PREVENT NEXT.JS FROM DROPPING DATA
    const finalMatches = await Promise.all(visualMatches.map(async (match) => {
        let discogsData = null;
        let ebayScrapedPrice = null;
        
        // --- DISCOGS API ---
        if (match.link.toLowerCase().includes('discogs.com')) {
            discogsData = { have:'--', want:'--', rating:'--', ratingsCount:'--', lastSold:'API Hidden', low:'--', median:'--', high:'--', debug: 'PROCESSING' };
            
            if (!discogsToken) {
                discogsData.debug = "ERROR: Missing DISCOGS_TOKEN in Vercel Env Variables";
            } else {
                const idMatch = match.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
                if (!idMatch) {
                    discogsData.debug = "ERROR: Could not find Discogs ID in URL";
                } else {
                    let id = idMatch[1];
                    try {
                        const headers = { 'User-Agent': 'RecordLens/1.0', 'Authorization': `Discogs token=${discogsToken}` };
                        
                        if (match.link.includes('/master/')) {
                            const mRes = await fetch(`https://api.discogs.com/masters/${id}`, { headers });
                            if (mRes.ok) id = (await mRes.json()).main_release;
                        }

                        const relRes = await fetch(`https://api.discogs.com/releases/${id}`, { headers });
                        if (!relRes.ok) {
                            discogsData.debug = `ERROR: Discogs API rejected Release (Status ${relRes.status})`;
                        } else {
                            const rData = await relRes.json();
                            discogsData.have = rData.community?.have ?? '--';
                            discogsData.want = rData.community?.want ?? '--';
                            discogsData.rating = rData.community?.rating?.average ?? '--';
                            discogsData.ratingsCount = rData.community?.rating?.count ?? '--';
                            discogsData.debug = "SUCCESS";
                        }

                        const priceRes = await fetch(`https://api.discogs.com/marketplace/price_suggestions/${id}`, { headers });
                        if (!priceRes.ok) {
                            discogsData.debug += ` | ERROR: Price API (Status ${priceRes.status})`;
                        } else {
                            const pData = await priceRes.json();
                            const fmt = v => v ? `$${v.toFixed(2)}` : '--';
                            discogsData.low = fmt(pData["Good (G)"]?.value);
                            discogsData.median = fmt(pData["Very Good Plus (VG+)"]?.value);
                            discogsData.high = fmt(pData["Near Mint (NM or M-)"]?.value);
                        }
                    } catch (e) {
                        discogsData.debug = `ERROR: API Crash - ${e.message}`;
                    }
                }
            }
        }

        // --- EBAY ACTIVE PRICE SCRAPER ---
        if (match.link.toLowerCase().includes('ebay.com')) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 1200); 
                const res = await fetch(match.link, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal });
                clearTimeout(timeoutId);
                const html = await res.text();
                const priceMatch = html.match(/class="ux-textspans ux-textspans--BOLD"[^>]*>\s*(US\s*\$[\d,.]+)\s*<\/span>/i);
                if (priceMatch) ebayScrapedPrice = priceMatch[1];
            } catch(e) {}
        }

        // Explicitly return every single key so Next.js cannot drop it
        return { 
            title: match.title || "Unknown", 
            link: match.link || "#", 
            thumbnail: match.thumbnail || "", 
            price: match.price || null, 
            source: match.source || "Unknown",
            discogsData: discogsData,
            ebayScrapedPrice: ebayScrapedPrice
        };
    }));

    // 3. RUN EBAY SOLD USING CLEANED TEXT
    let ebaySoldResults = [];
    try {
        const soldRes = await fetch(`https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1&api_key=${serpapiKey}`);
        const soldJson = await soldRes.json();
        ebaySoldResults = (soldJson.organic_results || []).slice(0, 10);
    } catch(e) {}

    return NextResponse.json({ results: finalMatches, ebaySold: ebaySoldResults, textQuery });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
