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
    if (uploadJson.error) return NextResponse.json({ error: "SerpApi Error: " + uploadJson.error }, { status: 500 });
    
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

    // 4. Process Discogs Matches (Strictly limited to 5)
    let discogsMatches = [];
    const discogsLinks = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('discogs.com')).slice(0, 5);
    
    for (let match of discogsLinks) {
        let discogsData = { have: '--', want: '--', rating: '--', ratingsCount: '--', lastSold: 'API Hidden', low: '--', median: '--', high: '--', debug: 'PENDING' };
        
        if (!discogsToken) {
            discogsData.debug = "ERROR: Missing DISCOGS_TOKEN in Vercel Environment Variables";
        } else {
            const idMatch = match.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
            if (!idMatch) {
                discogsData.debug = "ERROR: No valid Release ID found in URL";
            } else {
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
                        discogsData.debug = "SUCCESS";
                    } else {
                        discogsData.debug = `ERROR: Release API rejected (Status ${relRes.status})`;
                    }

                    if (priceRes.ok) {
                        const pData = await priceRes.json();
                        const fmt = v => v ? `$${v.toFixed(2)}` : '--';
                        discogsData.low = fmt(pData["Good (G)"]?.value);
                        discogsData.median = fmt(pData["Very Good Plus (VG+)"]?.value);
                        discogsData.high = fmt(pData["Near Mint (NM or M-)"]?.value);
                    } else {
                        discogsData.debug += ` | Pricing API Error ${priceRes.status}`;
                    }
                } catch (err) {
                    discogsData.debug = `ERROR: API Crash - ${err.message}`;
                }
            }
        }
        
        discogsMatches.push({
            title: match.title, link: match.link, thumbnail: match.thumbnail, discogsData
        });
    }

    // 5. Process eBay Active Matches
    let ebayActiveMatches = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('ebay.com')).slice(0, 5).map(m => ({
        title: m.title, link: m.link, thumbnail: m.thumbnail, price: m.price?.raw || (m.price?.extracted_value ? `$${m.price.extracted_value}` : null)
    }));

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
