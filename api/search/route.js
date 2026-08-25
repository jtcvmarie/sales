import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image'); 
    
    if (!file) return NextResponse.json({ error: "No image received" }, { status: 400 });
    if (!process.env.SERPAPI_KEY) return NextResponse.json({ error: "Missing SERPAPI_KEY environment variable" }, { status: 500 });

    const serpapiKey = process.env.SERPAPI_KEY;
    const discogsToken = process.env.DISCOGS_TOKEN;

    // 1. Upload Image to SerpApi
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

    const visualMatches = searchJson.visual_matches || [];

    // 3. Clean Text Extraction (Hyphen-safe)
    let rawTitle = searchJson.knowledge_graph?.[0]?.title || visualMatches[0]?.title || searchJson.text_results?.[0]?.text || "Vinyl Record";
    let cleanQuery = String(rawTitle)
      .replace(/eBay|Discogs|Popsike|Vinyl|LP|CD|Record|Album/ig, '')
      .replace(/[-|—]/g, ' ')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .trim();

    let textQuery = cleanQuery.split(/\s+/).filter(w => w.length > 0).slice(0, 5).join(' ');
    if (!textQuery || textQuery.length < 2) textQuery = "Vinyl Record";

    // 4. Process Discogs Matches
    const discogsLinks = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('discogs.com')).slice(0, 5);
    const discogsMatches = await Promise.all(discogsLinks.map(async (match) => {
      let discogsData = { have: '--', want: '--', rating: '--', ratingsCount: '--', lastSold: 'API Hidden', low: '--', median: '--', high: '--', debug: 'PENDING' };
      
      if (!discogsToken) {
        discogsData.debug = "MISSING_DISCOGS_TOKEN";
        return { title: match.title, link: match.link, thumbnail: match.thumbnail, discogsData };
      }

      const idMatch = match.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
      if (!idMatch) {
        discogsData.debug = "NO_ID_IN_URL";
        return { title: match.title, link: match.link, thumbnail: match.thumbnail, discogsData };
      }

      let releaseId = idMatch[1];
      const headers = { 'User-Agent': 'RecordLens/1.0', 'Authorization': `Discogs token=${discogsToken}` };

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
          const rData = await relRes.json();
          discogsData.have = rData.community?.have ?? '--';
          discogsData.want = rData.community?.want ?? '--';
          discogsData.rating = rData.community?.rating?.average ?? '--';
          discogsData.ratingsCount = rData.community?.rating?.count ?? '--';
        }

        if (priceRes.ok) {
          const pData = await priceRes.json();
          const fmt = v => (v ? `$${v.toFixed(2)}` : '--');
          discogsData.low = fmt(pData["Good (G)"]?.value);
          discogsData.median = fmt(pData["Very Good Plus (VG+)"]?.value);
          discogsData.high = fmt(pData["Near Mint (NM or M-)"]?.value);
          discogsData.debug = "SUCCESS";
        } else {
          discogsData.debug = `Price Error (${priceRes.status})`;
        }
      } catch (err) {
        discogsData.debug = `API Crash: ${err.message}`;
      }

      return { title: match.title, link: match.link, thumbnail: match.thumbnail, discogsData };
    }));

    // 5. Process eBay Active Matches
    const ebayActiveMatches = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('ebay.com')).slice(0, 6).map(match => ({
      title: match.title || "eBay Listing",
      link: match.link || "#",
      thumbnail: match.thumbnail || "",
      price: match.price?.raw || (match.price?.extracted_value ? `$${match.price.extracted_value}` : null)
    }));

    // 6. Fetch eBay Sold
    let ebaySoldResults = [];
    if (textQuery) {
      try {
        const soldUrl = `https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1&api_key=${serpapiKey}`;
        const soldRes = await fetch(soldUrl);
        const soldJson = await soldRes.json();
        if (soldJson.organic_results) {
          ebaySoldResults = soldJson.organic_results.slice(0, 10).map(item => ({
            title: item.title,
            link: item.link,
            price: item.price?.raw || null,
            condition: item.condition || ""
          }));
        }
      } catch (e) {}
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
