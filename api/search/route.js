import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image'); 
    
    if (!file) return NextResponse.json({ error: "No image received" }, { status: 400 });
    if (!process.env.SERPAPI_KEY) return NextResponse.json({ error: "Missing SERPAPI_KEY" }, { status: 500 });

    // 1. Upload to SerpApi
    const uploadData = new FormData();
    uploadData.append('image', file);
    uploadData.append('api_key', process.env.SERPAPI_KEY);
    
    const uploadRes = await fetch('https://serpapi.com/image', { method: 'POST', body: uploadData });
    const uploadJson = await uploadRes.json();
    if (uploadJson.error) return NextResponse.json({ error: "SerpApi Error: " + uploadJson.error }, { status: 500 });
    
    // 2. Google Lens Search
    const searchRes = await fetch(`https://serpapi.com/search.json?engine=google_lens&image_id=${uploadJson.image_id}&api_key=${process.env.SERPAPI_KEY}`);
    const searchJson = await searchRes.json();
    if (searchJson.error) return NextResponse.json({ error: "Google Lens Error: " + searchJson.error }, { status: 500 });

    const visualMatches = searchJson.visual_matches || [];

    // 3. SIMPLE TEXT EXTRACTION (No aggressive deleting)
    let rawTitle = "";
    if (searchJson.knowledge_graph && searchJson.knowledge_graph.length > 0) {
        rawTitle = searchJson.knowledge_graph[0].title;
    } else if (visualMatches.length > 0) {
        rawTitle = visualMatches[0].title;
    } else if (searchJson.text_results && searchJson.text_results.length > 0) {
        rawTitle = searchJson.text_results[0].text;
    }
    
    // Just take the first 6 words to create a solid search query
    let textQuery = "Vinyl Record";
    if (rawTitle) {
        textQuery = rawTitle.replace(/\|.*/, '').replace(/-.*/, '').trim().split(/\s+/).slice(0, 6).join(" ");
    }

    // 4. PROCESS DISCOGS (Strict API Usage)
    const discogsLinks = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('discogs.com')).slice(0, 5);
    const discogsMatches = await Promise.all(discogsLinks.map(async (match) => {
        let discogsData = { have:'--', want:'--', rating:'--', ratingsCount:'--', lastSold:'API Hidden', low:'--', median:'--', high:'--', debug: 'OK' };
        
        if (process.env.DISCOGS_TOKEN) {
            const idMatch = match.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
            if (idMatch) {
                let releaseId = idMatch[1];
                const headers = { 'User-Agent': 'RecordLens/1.0', 'Authorization': `Discogs token=${process.env.DISCOGS_TOKEN}` };
                
                try {
                    // Check if it's a master release
                    if (match.link.includes('/master/')) {
                        const mRes = await fetch(`https://api.discogs.com/masters/${releaseId}`, { headers });
                        if (mRes.ok) {
                            const mJson = await mRes.json();
                            releaseId = mJson.main_release;
                        }
                    }
                    
                    // Fetch Community Stats
                    const relRes = await fetch(`https://api.discogs.com/releases/${releaseId}`, { headers });
                    if (relRes.ok) {
                        const rData = await relRes.json();
                        discogsData.have = rData.community?.have ?? '--';
                        discogsData.want = rData.community?.want ?? '--';
                        discogsData.rating = rData.community?.rating?.average ?? '--';
                        discogsData.ratingsCount = rData.community?.rating?.count ?? '--';
                    } else {
                        discogsData.debug = `Data Error ${relRes.status}`;
                    }
                    
                    // Fetch Pricing
                    const priceRes = await fetch(`https://api.discogs.com/marketplace/price_suggestions/${releaseId}`, { headers });
                    if (priceRes.ok) {
                        const pData = await priceRes.json();
                        discogsData.low = pData["Good (G)"]?.value ? `$${pData["Good (G)"].value.toFixed(2)}` : '--';
                        discogsData.median = pData["Very Good Plus (VG+)"]?.value ? `$${pData["Very Good Plus (VG+)"].value.toFixed(2)}` : '--';
                        discogsData.high = pData["Near Mint (NM or M-)"]?.value ? `$${pData["Near Mint (NM or M-)"].value.toFixed(2)}` : '--';
                    } else {
                        discogsData.debug = `Price Error ${priceRes.status}`;
                    }
                } catch(e) {
                    discogsData.debug = 'API Crash';
                }
            } else {
                discogsData.debug = 'No ID Found';
            }
        } else {
            discogsData.debug = 'Missing Token';
        }
        return { ...match, discogsData };
    }));

    // 5. EBAY ACTIVE MATCHES
    const ebayActiveMatches = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('ebay.com')).slice(0, 6);

    // 6. EBAY SOLD MATCHES (Direct SerpApi fetch based on the textQuery)
    let ebaySoldResults = [];
    if (textQuery && textQuery !== "Vinyl Record") {
        try {
            const soldRes = await fetch(`https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1&api_key=${process.env.SERPAPI_KEY}`);
            const soldJson = await soldRes.json();
            if (soldJson.organic_results) {
                ebaySoldResults = soldJson.organic_results.slice(0, 8);
            }
        } catch(e) {
            console.error("eBay Sold Fetch Error", e);
        }
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
