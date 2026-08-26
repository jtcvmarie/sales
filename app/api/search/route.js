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

    // 3. 10-Word Text Extraction
    let rawTitle = searchJson.knowledge_graph?.[0]?.title || visualMatches[0]?.title || "Vinyl Record";
    let cleanText = rawTitle.replace(/[-|—–]/g, ' ')
                            .replace(/[^a-zA-Z0-9\s]/g, '')
                            .replace(/\s+/g, ' ')
                            .trim();
    let textQuery = cleanText.split(' ').slice(0, 10).join(' ');
    if (!textQuery) textQuery = "Vinyl Record";

    const discogsLinks = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('discogs.com')).slice(0, 5);
    const ebayLinks = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('ebay.com')).slice(0, 5);

    // TASK 1: DISCOGS DATA
    const discogsTask = Promise.all(discogsLinks.map(async (match) => {
        let discogsData = { have: '--', want: '--', rating: '--', ratingsCount: '--', low: '--', high: '--', debug: '' };
        
        if (discogsToken) {
            const idMatch = match.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
            if (idMatch) {
                let id = idMatch[1];
                const headers = { 'User-Agent': 'RecordLens/3.0', 'Authorization': `Discogs token=${discogsToken}` };
                
                try {
                    if (match.link.includes('/master/')) {
                        const mRes = await fetch(`https://api.discogs.com/masters/${id}`, { headers });
                        if (mRes.ok) id = (await mRes.json()).main_release;
                    }

                    const releaseFetch = fetch(`https://api.discogs.com/releases/${id}`, { headers }).then(r => r.ok ? r.json() : null).catch(() => null);
                    
                    const abortScrape = new AbortController();
                    const timeoutScrape = setTimeout(() => abortScrape.abort(), 1500); 
                    const marketFetch = fetch(`https://www.discogs.com/sell/release/${id}?sort=price%2Cdesc`, { headers: botHeaders, signal: abortScrape.signal })
                        .then(r => r.text())
                        .catch(() => null)
                        .finally(() => clearTimeout(timeoutScrape));

                    const [rData, marketHtml] = await Promise.all([releaseFetch, marketFetch]);

                    if (rData) {
                        discogsData.have = rData.community?.have ?? '--';
                        discogsData.want = rData.community?.want ?? '--';
                        discogsData.rating = rData.community?.rating?.average ?? '--';
                        discogsData.ratingsCount = rData.community?.rating?.count ?? '--';
                        if (rData.lowest_price) discogsData.low = `$${rData.lowest_price.toFixed(2)}`;
                    }

                    if (marketHtml) {
                        // Expanded regex to catch multiple class variations Discogs uses
                        const highMatch = marketHtml.match(/class="(?:item_price|price)"[^>]*>\s*([A-Z£€]*\s*\$?\s*[\d,.]+)/i) || marketHtml.match(/<span class="price">([A-Z£€]*\s*\$?\s*[\d,.]+)/i);
                        if (highMatch) discogsData.high = highMatch[1].trim();
                    }
                } catch (err) {}
            }
        }
        return { title: match.title, link: match.link, thumbnail: match.thumbnail, discogsData };
    }));

    // TASK 2: EBAY ACTIVE
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
                    const cur = html.match(/itemprop="priceCurrency" content="([^"]+)"/i);
                    price = cur ? `${cur[1]} ${metaPrice[1]}` : `$${metaPrice[1]}`;
                } else {
                    const backupMatch = html.match(/class="ux-textspans ux-textspans--BOLD"[^>]*>\s*([A-Z£€]*\s*\$?\s*[\d,.]+)\s*<\/span>/i) ||
                                      html.match(/id="prcIsum_bidPrice"[^>]*>\s*([A-Z£€]*\s*\$?\s*[\d,.]+)/i) ||
                                      html.match(/class="main-price-with-shipping"[^>]*>\s*([A-Z£€]*\s*\$?\s*[\d,.]+)/i);
                    if (backupMatch) price = backupMatch[1].trim();
                }
            } catch(e) {}
        }
        return { title: m.title, link: m.link, thumbnail: m.thumbnail, price };
    }));

    const [discogsMatches, ebayActiveMatches] = await Promise.all([discogsTask, ebayActiveTask]);
    return NextResponse.json({ discogsMatches, ebayActiveMatches, textQuery });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
