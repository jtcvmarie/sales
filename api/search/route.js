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

    // 1. SAFE TEXT EXTRACTION (Fixed the "" bug)
    let rawTitle = searchJson.knowledge_graph?.[0]?.title || visualMatches[0]?.title || searchJson.text_results?.[0]?.text || "Vinyl Record";
    
    // Safely scrubs junk words without destroying hyphenated artist names
    let cleanText = rawTitle.replace(/(eBay|Discogs|Popsike|Vinyl|LP|CD|Record|Album)/ig, '')
                            .replace(/\|.*/g, '') // Kills SEO pipe strings
                            .replace(/\s+/g, ' ')
                            .trim();
    
    if (!cleanText || cleanText.length < 2) cleanText = "Record";
    let textQuery = cleanText.split(/\s+/).slice(0, 5).join(" "); 

    // 2. DISCOGS API LOGIC (Fixed the crash bug with m?.link)
    const discogsLinks = visualMatches.filter(m => m?.link?.toLowerCase().includes('discogs.com')).slice(0, 5);
    const discogsMatches = await Promise.all(discogsLinks.map(async (match) => {
        let discogsData = { have:'--', want:'--', rating:'--', ratingsCount:'--', lastSold:'--', low:'--', median:'--', high:'--', debug: 'PENDING' };
        
        try {
            // Attempt HTML scrape first (bypasses Seller Profile API blocks)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);
            const res = await fetch(match.link, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, signal: controller.signal });
            clearTimeout(timeoutId);
            
            const html = await res.text();
            const flatHTML = html.replace(/\r?\n|\r/g, '').replace(/\s+/g, ' ');
            const ex = (regex) => { const m = flatHTML.match(regex); return m ? m[1].replace(/<[^>]+>/g, '').trim() : null; };
            
            const haveMatch = ex(/Have(?:<!-- -->)?:\s*<\/span>\s*<a[^>]*>([\d,]+)<\/a>/i);
            if (haveMatch) {
               discogsData.have = haveMatch;
               discogsData.want = ex(/Want(?:<!-- -->)?:\s*<\/span>\s*<a[^>]*>([\d,]+)<\/a>/i) || '--';
               discogsData.rating = ex(/Avg Rating(?:<!-- -->)?:\s*<\/span>\s*<span>(.*?)<\/span>/i) || '--';
               discogsData.ratingsCount = ex(/Ratings(?:<!-- -->)?:\s*<\/span>\s*<a[^>]*>([\d,]+)<\/a>/i) || '--';
               discogsData.lastSold = ex(/Last Sold(?:<!-- -->)?:\s*<\/span>\s*<a[^>]*>.*?<time[^>]*>([^<]+)<\/time>/i) || ex(/Last Sold(?:<!-- -->)?:\s*<\/span>\s*<span>([^<]+)<\/span>/i) || '--';
               discogsData.low = ex(/Low(?:<!-- -->)?:\s*<\/span>\s*<span>([^<]+)<\/span>/i) || '--';
               discogsData.median = ex(/Median(?:<!-- -->)?:\s*<\/span>\s*<span>([^<]+)<\/span>/i) || '--';
               discogsData.high = ex(/High(?:<!-- -->)?:\s*<\/span>\s*<span>([^<]+)<\/span>/i) || '--';
               discogsData.debug = "SCRAPE_OK";
            } else {
               throw new Error("Scrape missed data");
            }
        } catch(e) {
            // Fallback to API if Scrape fails
            const idMatch = match.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
            if (idMatch && process.env.DISCOGS_TOKEN) {
                let id = idMatch[1];
                let headers = { 'User-Agent': 'RecordLens/1.0', 'Authorization': `Discogs token=${process.env.DISCOGS_TOKEN}` };
                
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
                } catch(err) {
                    discogsData.debug = 'API_CRASH';
                }
            } else {
                discogsData.debug = 'NO_TOKEN_OR_ID';
            }
        }
        return { ...match, discogsData };
    }));

    // 3. EBAY ACTIVE MATCHES (Fixed the crash bug with m?.link)
    const ebayActiveMatches = visualMatches.filter(m => m?.link?.toLowerCase().includes('ebay.com')).slice(0, 6);

    // 4. EBAY SOLD SERPAPI FETCH
    let ebaySoldResults = [];
    if (textQuery) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            const soldRes = await fetch(`https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1&api_key=${process.env.SERPAPI_KEY}`, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (soldRes.ok) {
                const soldJson = await soldRes.json();
                ebaySoldResults = (soldJson.organic_results || []).slice(0, 10);
            }
        } catch(e) {
            console.error("eBay Sold API Timeout");
        }
    }

    return NextResponse.json({ discogsMatches, ebayActiveMatches, ebaySoldResults, textQuery });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
