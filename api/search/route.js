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
    if (uploadJson.error) return NextResponse.json({ error: "SerpApi Upload Error: " + uploadJson.error }, { status: 500 });
    
    // 2. Google Lens Search
    const searchRes = await fetch(`https://serpapi.com/search.json?engine=google_lens&image_id=${uploadJson.image_id}&api_key=${serpapiKey}`);
    const searchJson = await searchRes.json();
    if (searchJson.error) return NextResponse.json({ error: "Google Lens Error: " + searchJson.error }, { status: 500 });

    // 3. Isolate ONLY Discogs Matches
    const visualMatches = searchJson.visual_matches || [];
    const discogsLinks = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('discogs.com')).slice(0, 10);

    // 4. Fetch Discogs Stats with Strict Error Logging
    const discogsMatches = await Promise.all(discogsLinks.map(async (match) => {
      let discogsData = { have: '--', want: '--', rating: '--', ratingsCount: '--', low: '--', median: '--', high: '--', debug: 'PENDING' };
      
      if (!discogsToken) {
        discogsData.debug = "ERROR: Missing DISCOGS_TOKEN in Vercel environment variables.";
      } else {
        // Extract Discogs ID from URL
        const idMatch = match.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
        
        if (!idMatch) {
          discogsData.debug = "ERROR: Could not find a valid Discogs ID in the URL.";
        } else {
          let id = idMatch[1];
          try {
            const headers = { 'User-Agent': 'RecordLens/2.0', 'Authorization': `Discogs token=${discogsToken}` };
            
            // If it's a master release, find the main release ID first
            if (match.link.includes('/master/')) {
              const mRes = await fetch(`https://api.discogs.com/masters/${id}`, { headers });
              if (!mRes.ok) {
                discogsData.debug = `Master API Error: ${mRes.status}`;
              } else {
                const mJson = await mRes.json();
                id = mJson.main_release;
              }
            }

            // Fetch Release Stats and Pricing concurrently
            const [relRes, priceRes] = await Promise.all([
              fetch(`https://api.discogs.com/releases/${id}`, { headers }),
              fetch(`https://api.discogs.com/marketplace/price_suggestions/${id}`, { headers })
            ]);

            let errors = [];

            if (relRes.ok) {
              const rData = await relRes.json();
              discogsData.have = rData.community?.have ?? '--';
              discogsData.want = rData.community?.want ?? '--';
              discogsData.rating = rData.community?.rating?.average ?? '--';
              discogsData.ratingsCount = rData.community?.rating?.count ?? '--';
            } else {
              errors.push(`Release Data Error ${relRes.status}`);
            }

            if (priceRes.ok) {
              const pData = await priceRes.json();
              const fmt = v => v ? `$${v.toFixed(2)}` : '--';
              discogsData.low = fmt(pData["Good (G)"]?.value);
              discogsData.median = fmt(pData["Very Good Plus (VG+)"]?.value);
              discogsData.high = fmt(pData["Near Mint (NM or M-)"]?.value);
            } else {
              errors.push(`Pricing Error ${priceRes.status} (Is Seller Profile complete?)`);
            }

            discogsData.debug = errors.length > 0 ? `API REJECTED: ${errors.join(" | ")}` : "SUCCESS";

          } catch (err) {
            discogsData.debug = `API CRASH: ${err.message}`;
          }
        }
      }

      return { 
        title: match.title || "Unknown Title", 
        link: match.link || "#", 
        thumbnail: match.thumbnail || "", 
        discogsData 
      };
    }));

    return NextResponse.json({ discogsMatches });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
