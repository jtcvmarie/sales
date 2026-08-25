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

    // CRASH PROTECTOR: Safely fallback all text paths to guarantee strings
    let rawText = searchJson.knowledge_graph?.[0]?.title || "";
    if (!rawText) rawText = searchJson.text_results?.map(t => t?.text || "").join(" ") || "";
    if (!rawText && searchJson.visual_matches?.length > 0) rawText = searchJson.visual_matches[0]?.title || "";
    
    let textQuery = "";
    if (rawText) {
       textQuery = String(rawText)
           .replace(/eBay|Discogs|Popsike|Vinyl|LP|CD|Record|Album/ig, '')
           .replace(/\|.*/g, '')
           .replace(/-.*/g, '')
           .replace(/[^a-zA-Z0-9& ]/g, "")
           .trim();
       textQuery = textQuery.split(/\s+/).slice(0, 5).join(" ");
    }

    const allowedSites = ["discogs.com", "ebay.com", "popsike.com", "upcitemdb.com"];
    const matches = (searchJson.visual_matches || []).filter(match => match?.link && allowedSites.some(s => match.link.toLowerCase().includes(s))).slice(0, 6);

    // DISCOGS API FETCH
    const discogsMatches = matches.filter(m => m.link.toLowerCase().includes('discogs.com'));
    const processedDiscogs = await Promise.all(discogsMatches.map(async (match) => {
       let discogsData = { have: '--', want: '--', rating: '--', ratingsCount: '--', lastSold: 'API Hidden', low: '--', median: '--', high: '--', debug: '' };
       
       if (!process.env.DISCOGS_TOKEN) {
           discogsData.debug = "MISSING_DISCOGS_TOKEN_IN_VERCEL";
       } else {
           const idMatch = match.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
           if (idMatch) {
               const headers = { 'User-Agent': 'RecordLens/1.0', 'Authorization': `Discogs token=${process.env.DISCOGS_TOKEN}` };
               let releaseId = idMatch[1];
               
               try {
                   if (match.link.includes('/master/')) {
                       const mRes = await fetch(`https://api.discogs.com/masters/${releaseId}`, { headers });
                       if (mRes.ok) {
                           const mJson = await mRes.json();
                           releaseId = mJson.main_release;
                       }
                   }

                   const [relRes, priceRes] = await Promise.all([
                       fetch(`https://api.discogs.com/releases/${releaseId}`, { headers }),
                       fetch(`https://api.discogs.com/marketplace/price_suggestions/${releaseId}`, { headers })
                   ]);

                   if (relRes.ok) {
                       const rJson = await relRes.json();
                       discogsData.have = rJson.community?.have ?? '--';
                       discogsData.want = rJson.community?.want ?? '--';
                       discogsData.rating = rJson.community?.rating?.average ?? '--';
                       discogsData.ratingsCount = rJson.community?.rating?.count ?? '--';
                   } else {
                       discogsData.debug += `Data_Failed_${relRes.status} `;
                   }

                   if (priceRes.ok) {
                       const pJson = await priceRes.json();
                       discogsData.low = pJson["Good (G)"]?.value ? `$${pJson["Good (G)"].value.toFixed(2)}` : '--';
                       discogsData.median = pJson["Very Good Plus (VG+)"]?.value ? `$${pJson["Very Good Plus (VG+)"].value.toFixed(2)}` : '--';
                       discogsData.high = pJson["Near Mint (NM or M-)"]?.value ? `$${pJson["Near Mint (NM or M-)"].value.toFixed(2)}` : '--';
                   } else {
                       discogsData.debug += `Pricing_Failed_${priceRes.status}`;
                   }
               } catch(e) {
                   discogsData.debug = "API_CRASH";
               }
           } else {
               discogsData.debug = "NO_ID_IN_URL";
           }
       }
       return { title: match.title, link: match.link, thumbnail: match.thumbnail, source: match.source, discogsData };
    }));

    // EBAY DIRECT SEARCHES
    let ebayActive = [];
    let ebaySold = [];
    
    if (textQuery) {
       try {
           const [activeRes, soldRes] = await Promise.all([
               fetch(`https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&api_key=${process.env.SERPAPI_KEY}`),
               fetch(`https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1&api_key=${process.env.SERPAPI_KEY}`)
           ]);
           
           if (activeRes.ok) {
               const activeJson = await activeRes.json();
               ebayActive = Array.isArray(activeJson.organic_results) ? activeJson.organic_results.slice(0, 6) : [];
           }
           if (soldRes.ok) {
               const soldJson = await soldRes.json();
               ebaySold = Array.isArray(soldJson.organic_results) ? soldJson.organic_results.slice(0, 6) : [];
           }
       } catch(e) {}
    }

    return NextResponse.json({ discogs: processedDiscogs, ebayActive, ebaySold, textQuery });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
