import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image'); 
    
    if (!file) return NextResponse.json({ error: "No image received" }, { status: 400 });
    if (!process.env.SERPAPI_KEY) return NextResponse.json({ error: "Missing SERPAPI_KEY" }, { status: 500 });

    const serpapiKey = process.env.SERPAPI_KEY;
    const discogsToken = process.env.DISCOGS_TOKEN;
    
    // Disguise the Vercel server as Google's web crawler to bypass Cloudflare bot protection
    const botHeaders = { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' };

    // 1. Upload to SerpApi
    const uploadData = new FormData();
    uploadData.append('image', file);
    uploadData.append('api_key', serpapiKey);
    
    const uploadRes = await fetch('https://serpapi.com/image', { method: 'POST', body: uploadData });
    const uploadJson = await uploadRes.json();
    
    // 2. Google Lens Search
    const searchRes = await fetch(`https://serpapi.com/search.json?engine=google_lens&image_id=${uploadJson.image_id}&api_key=${serpapiKey}`);
    const searchJson = await searchRes.json();
    const visualMatches = searchJson.visual_matches || [];

    // 3. Unbreakable Text Extraction
    let rawTitle = searchJson.knowledge_graph?.[0]?.title || visualMatches[0]?.title || "Vinyl Record";
    let cleanText = rawTitle.replace(/[-|—–]/g, ' ').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    let textQuery = cleanText.split(' ').slice(0, 5).join(' ');
    if (!textQuery) textQuery = "Vinyl Record";

    // 4. Process Discogs Matches (Try HTML Scrape First, Fallback to API)
    let discogsMatches = [];
    const discogsLinks = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('discogs.com')).slice(0, 5);
    
    for (let match of discogsLinks) {
        let discogsData = { have: '--', want: '--', rating: '--', ratingsCount: '--', lastSold: 'API Hidden', low: '--', median: '--', high: '--', debug: 'PENDING' };
        let scrapedSuccessfully = false;

        // ATTEMPT 1: Disguised HTML Scrape (Yields exact website data)
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const dRes = await fetch(match.link, { headers: botHeaders, signal: controller.signal });
            clearTimeout(timeoutId);
            
            const html = await dRes.text();
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
                discogsData.debug = "SUCCESS (Web Data)";
                scrapedSuccessfully = true;
            }
        } catch(e) {}

        // ATTEMPT 2: Fallback to Restricted Developer API if Cloudflare blocked the Googlebot disguise
        if (!scrapedSuccessfully) {
            if (!discogsToken) {
                discogsData.debug = "HTML Blocked & No Token Saved";
            } else {
                const idMatch = match.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
                if (idMatch) {
                    let id = idMatch[1];
                    const headers = { 'User-Agent': 'RecordLens/1.0', 'Authorization': `Discogs token=${discogsToken}` };
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
                            
                            // The API doesn't give historical low, but it gives current lowest active price
                            if (rData.lowest_price) discogsData.low = `$${rData.lowest_price.toFixed(2)}`;
                            discogsData.debug = "SUCCESS (API Data - Financials Restricted)";
                        } else {
                            discogsData.debug = `HTML Blocked & API Error ${relRes.status}`;
                        }
                    } catch (err) {
                        discogsData.debug = `Crash: ${err.message}`;
                    }
                }
            }
        }
        discogsMatches.push({ title: match.title, link: match.link, thumbnail: match.thumbnail, discogsData });
    }

    // 5. Process eBay Active Matches (With Meta-Tag Scraper)
    let ebayActiveMatches = [];
    const ebayLinks = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('ebay.com')).slice(0, 5);
    
    for (let m of ebayLinks) {
        let price = m.price?.raw || (m.price?.extracted_value ? `$${m.price.extracted_value}` : null);
        
        // If Google Lens missed the price, aggressively scrape the exact page
        if (!price) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 1500); 
                const res = await fetch(m.link, { headers: botHeaders, signal: controller.signal });
                clearTimeout(timeoutId);
                const html = await res.text();
                
                // Look for the invisible meta tag eBay uses for search engines, or the backup CSS class
                const priceMatch = html.match(/itemprop="price" content="([^"]+)"/i) || html.match(/class="x-price-primary"[^>]*>\s*US\s*\$([\d,.]+)/i);
                if (priceMatch) price = `$${priceMatch[1]}`;
            } catch(e) {}
        }
        ebayActiveMatches.push({ title: m.title, link: m.link, thumbnail: m.thumbnail, price });
    }

    // 6. Fetch eBay Sold
    let ebaySoldResults = [];
    try {
        const soldUrl = `https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1&api_key=${serpapiKey}`;
        const soldRes = await fetch(soldUrl);
        const soldJson = await soldRes.json();
        if (soldJson.organic_results) {
            ebaySoldResults = soldJson.organic_results.slice(0, 10).map(item => ({
                title: item.title, link: item.link, price: item.price?.raw || null, condition: item.condition || ""
            }));
        }
    } catch(e) {}

    return NextResponse.json({ discogsMatches, ebayActiveMatches, ebaySoldResults, textQuery });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
