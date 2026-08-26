import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image'); 
    
    if (!file) return NextResponse.json({ error: "No image received" }, { status: 400 });
    if (!process.env.SERPAPI_KEY) return NextResponse.json({ error: "Missing SERPAPI_KEY" }, { status: 500 });

    const serpapiKey = process.env.SERPAPI_KEY;
    const discogsToken = process.env.DISCOGS_TOKEN;
    const botHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36' };

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
    let cleanText = rawTitle.replace(/[-|—–]/g, ' ')
                            .replace(/[^a-zA-Z0-9\s]/g, '')
                            .replace(/\s+/g, ' ')
                            .trim();
    let textQuery = cleanText.split(' ').slice(0, 5).join(' ');
    if (!textQuery) textQuery = "Vinyl Record";

    // 4. Process Discogs Matches
    let discogsMatches = [];
    const discogsLinks = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('discogs.com')).slice(0, 5);
    
    for (let match of discogsLinks) {
        let discogsData = { have: '--', want: '--', rating: '--', ratingsCount: '--', lastSold: 'API Hidden (Captcha Blocked)', low: '--', median: '--', high: '--', debug: 'PENDING' };
        
        if (discogsToken) {
            const idMatch = match.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
            if (idMatch) {
                let id = idMatch[1];
                const headers = { 'User-Agent': 'RecordLens/1.0', 'Authorization': `Discogs token=${discogsToken}` };
                
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
                        
                        // Explicitly label the fallback active price so it isn't confused with historical low
                        if (rData.lowest_price) {
                            discogsData.low = `$${rData.lowest_price.toFixed(2)} (Current Active Low)`;
                        }
                        discogsData.debug = "SUCCESS (API Data)";
                    }

                    if (priceRes.ok) {
                        const pData = await priceRes.json();
                        const fmt = v => v ? `$${v.toFixed(2)}` : null;
                        
                        // Overwrite with Suggested Pricing algorithm if available
                        discogsData.low = fmt(pData["Good (G)"]?.value) || discogsData.low; 
                        discogsData.median = fmt(pData["Very Good Plus (VG+)"]?.value) || '--';
                        discogsData.high = fmt(pData["Near Mint (NM or M-)"]?.value) || '--';
                        
                    } else if (priceRes.status === 404) {
                        discogsData.median = "No API Price Data";
                        discogsData.high = "No API Price Data";
                        discogsData.debug = "SUCCESS (Note: Discogs API has 0 price suggestions for this release)";
                    } else if (priceRes.status === 500) {
                        discogsData.median = "API Crash";
                        discogsData.high = "API Crash";
                        discogsData.debug = "WARNING: Discogs Server crashed when checking this specific ID (Error 500)";
                    } else {
                        discogsData.debug += ` | Pricing API Error ${priceRes.status}`;
                    }
                } catch (err) {}
            }
        }
        discogsMatches.push({ title: match.title, link: match.link, thumbnail: match.thumbnail, discogsData });
    }

    // 5. Process eBay Active Matches (Advanced Multi-Pattern Scraper)
    let ebayActiveMatches = [];
    const ebayLinks = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('ebay.com')).slice(0, 5);
    
    for (let m of ebayLinks) {
        let price = m.price?.raw || (m.price?.extracted_value ? `$${m.price.extracted_value}` : null);
        
        // Force scrape if price is missing OR if it's a mobile link
        if (!price || m.link.includes('ebay.io')) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000); 
                // Using standard browser headers helps prevent eBay from serving an empty mobile shell
                const res = await fetch(m.link, { headers: botHeaders, signal: controller.signal });
                clearTimeout(timeoutId);
                const html = await res.text();
                
                // 1. Meta Tag (Most reliable for Buy It Now)
                const metaPrice = html.match(/itemprop="price" content="([^"]+)"/i);
                if (metaPrice) {
                    price = `$${metaPrice[1]}`;
                } else {
                    // 2. Fallback Regex patterns for Auctions, Mobile layouts, and UK/Canada currencies
                    const mobileMatch = html.match(/class="main-price-with-shipping"[^>]*>\s*([A-Z£€]*\s*\$?\s*[\d,.]+)/i);
                    const bidMatch = html.match(/id="prcIsum_bidPrice"[^>]*>\s*([A-Z£€]*\s*\$?\s*[\d,.]+)/i);
                    const standardMatch = html.match(/class="ux-textspans ux-textspans--BOLD"[^>]*>\s*([A-Z£€]*\s*\$?\s*[\d,.]+)\s*<\/span>/i);
                    
                    const found = mobileMatch || bidMatch || standardMatch;
                    if (found) price = found[1].trim();
                }
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
