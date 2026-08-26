import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image'); 
    const manualQuery = formData.get('query'); // Catches manual text edits!
    
    if (!process.env.SERPAPI_KEY) return NextResponse.json({ error: "Missing SERPAPI_KEY" }, { status: 500 });
    const serpapiKey = process.env.SERPAPI_KEY;
    const discogsToken = process.env.DISCOGS_TOKEN;
    const botHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

    let textQuery = "Vinyl Record";
    let discogsLinks = [];
    let ebayLinks = [];

    // ==========================================
    // MODE 1: IMAGE UPLOAD (Google Lens)
    // ==========================================
    if (file) {
        const uploadData = new FormData();
        uploadData.append('image', file);
        uploadData.append('api_key', serpapiKey);
        
        const uploadRes = await fetch('https://serpapi.com/image', { method: 'POST', body: uploadData });
        const uploadJson = await uploadRes.json();
        
        const searchRes = await fetch(`https://serpapi.com/search.json?engine=google_lens&image_id=${uploadJson.image_id}&api_key=${serpapiKey}`);
        const searchJson = await searchRes.json();
        const visualMatches = searchJson.visual_matches || [];

        let rawTitle = searchJson.knowledge_graph?.[0]?.title || visualMatches[0]?.title || "Vinyl Record";
        let cleanText = rawTitle.replace(/[-|—–]/g, ' ').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
        textQuery = cleanText.split(' ').slice(0, 10).join(' ') || "Vinyl Record";

        discogsLinks = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('discogs.com')).slice(0, 5);
        ebayLinks = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('ebay.com')).slice(0, 5);
    } 
    // ==========================================
    // MODE 2: MANUAL TEXT SEARCH
    // ==========================================
    else if (manualQuery) {
        textQuery = manualQuery;
        
        // Fetch Discogs Database via Text
        if (discogsToken) {
            try {
                const dRes = await fetch(`https://api.discogs.com/database/search?q=${encodeURIComponent(textQuery)}&type=release&per_page=5`, {
                    headers: { 'User-Agent': 'RecordLens/4.0', 'Authorization': `Discogs token=${discogsToken}` }
                });
                if (dRes.ok) {
                    const dJson = await dRes.json();
                    discogsLinks = dJson.results.map(r => ({ link: `https://www.discogs.com/release/${r.id}`, title: r.title, thumbnail: r.thumb }));
                }
            } catch(e) {}
        }
        
        // Fetch eBay Active via Text
        try {
            const eRes = await fetch(`https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&api_key=${serpapiKey}`);
            if (eRes.ok) {
                const eJson = await eRes.json();
                if (eJson.organic_results) {
                    ebayLinks = eJson.organic_results.slice(0, 5).map(r => ({ link: r.link, title: r.title, thumbnail: r.thumbnail, price: { raw: r.price?.raw } }));
                }
            }
        } catch(e) {}
    } else {
        return NextResponse.json({ error: "No image or query provided" }, { status: 400 });
    }

    // ==========================================
    // CONCURRENT DATA PROCESSING (Lightning Fast)
    // ==========================================

    // TASK 1: DISCOGS STATS (Combines Active Low + Historical Suggestions)
    const discogsTask = Promise.all(discogsLinks.map(async (match) => {
        let discogsData = { have: '--', want: '--', rating: '--', ratingsCount: '--', activeLow: '--', histLow: '--', histMed: '--', histHigh: '--', debug: '' };
        
        if (discogsToken) {
            const idMatch = match.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
            if (idMatch) {
                let id = idMatch[1];
                const headers = { 'User-Agent': 'RecordLens/4.0', 'Authorization': `Discogs token=${discogsToken}` };
                
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
                        if (rData.lowest_price) discogsData.activeLow = `$${rData.lowest_price.toFixed(2)}`;
                    }

                    if (priceRes.ok) {
                        const pData = await priceRes.json();
                        const fmt = v => v ? `$${v.toFixed(2)}` : '--';
                        discogsData.histLow = fmt(pData["Good (G)"]?.value);
                        discogsData.histMed = fmt(pData["Very Good Plus (VG+)"]?.value);
                        discogsData.histHigh = fmt(pData["Near Mint (NM or M-)"]?.value);
                    }
                } catch (err) {}
            }
        }
        return { title: match.title, link: match.link, thumbnail: match.thumbnail, discogsData };
    }));

    // TASK 2: EBAY ACTIVE SCRAPING
    const ebayActiveTask = Promise.all(ebayLinks.map(async (m) => {
        let price = m.price?.raw || (m.price?.extracted_value ? `$${m.price.extracted_value}` : null);
        if (!price || m.link.includes('ebay.io')) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 1200); 
                const res = await fetch(m.link, { headers: botHeaders, signal: controller.signal });
                clearTimeout(timeoutId);
                const html = await res.text();
                
                const metaPrice = html.match(/itemprop="price" content="([^"]+)"/i);
                if (metaPrice) {
                    price = `$${metaPrice[1]}`;
                } else {
                    const backupMatch = html.match(/class="ux-textspans ux-textspans--BOLD"[^>]*>\s*([A-Z£€]*\s*\$?\s*[\d,.]+)\s*<\/span>/i) || html.match(/id="prcIsum_bidPrice"[^>]*>\s*([A-Z£€]*\s*\$?\s*[\d,.]+)/i);
                    if (backupMatch) price = backupMatch[1].trim();
                }
            } catch(e) {}
        }
        return { title: m.title, link: m.link, thumbnail: m.thumbnail, price };
    }));

    // TASK 3: EBAY SOLD INDESTRUCTIBLE HTML SCRAPER
    const ebaySoldTask = (async () => {
        let results = [];
        try {
            const soldUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1`;
            const res = await fetch(soldUrl, { headers: botHeaders });
            const html = await res.text();
            
            // Slice the HTML by item blocks, ignore the first generic header block
            const items = html.split(/<li[^>]*class="[^"]*s-item[^"]*"[^>]*>/i).slice(1, 12);
            for (let item of items) {
                if (item.toLowerCase().includes('shop on ebay')) continue; // skip ads
                
                // Strip tags perfectly for title, link, price, and date
                let titleMatch = item.match(/<div[^>]*class="[^"]*s-item__title[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
                let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : "";

                let linkMatch = item.match(/href="([^"]+)"/i);
                let link = linkMatch ? linkMatch[1].split('?')[0] : "";

                let priceMatch = item.match(/<span[^>]*class="[^"]*s-item__price[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
                let price = priceMatch ? priceMatch[1].replace(/<[^>]+>/g, '').trim() : "";

                let dateMatch = item.match(/<span[^>]*class="[^"]*POSITIVE[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
                let date = dateMatch ? dateMatch[1].replace(/<[^>]+>/g, '').trim() : "";

                if (title && link) results.push({ title, link, price, condition: date });
            }
        } catch(e) {}
        return results;
    })();

    const [discogsMatches, ebayActiveMatches, ebaySoldResults] = await Promise.all([discogsTask, ebayActiveTask, ebaySoldTask]);
    return NextResponse.json({ discogsMatches, ebayActiveMatches, ebaySoldResults, textQuery });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
