import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image'); 
    
    if (!file) return NextResponse.json({ error: "No image received" }, { status: 400 });
    if (!process.env.SERPAPI_KEY) return NextResponse.json({ error: "Missing SERPAPI_KEY" }, { status: 500 });

    // 1. Lens API Upload & Search
    const serpApiUploadData = new FormData();
    serpApiUploadData.append('image', file);
    serpApiUploadData.append('api_key', process.env.SERPAPI_KEY);
    
    const uploadRes = await fetch('https://serpapi.com/image', { method: 'POST', body: serpApiUploadData });
    const uploadJson = await uploadRes.json();
    if (uploadJson.error) return NextResponse.json({ error: "SerpApi Error: " + uploadJson.error }, { status: 500 });
    
    const searchRes = await fetch(`https://serpapi.com/search.json?engine=google_lens&image_id=${uploadJson.image_id}&api_key=${process.env.SERPAPI_KEY}`);
    const searchJson = await searchRes.json();
    if (searchJson.error) return NextResponse.json({ error: "Google Lens Error: " + searchJson.error }, { status: 500 });

    const allowedSites = ["discogs.com", "ebay.com", "popsike.com", "upcitemdb.com"];
    const visualMatches = searchJson.visual_matches || [];
    const curatedMatches = visualMatches.filter(match => allowedSites.some(site => match.link.toLowerCase().includes(site)));

    // 2. The Discogs API Interceptor
    const finalMatches = await Promise.all(curatedMatches.map(async (match) => {
      let discogsData = null;
      
      if (match.link.includes('discogs.com/release/') && process.env.DISCOGS_TOKEN) {
        try {
          const urlParts = match.link.split('/');
          const releaseIdString = urlParts[urlParts.indexOf('release') + 1];
          const releaseId = releaseIdString.split('-')[0];
          const headers = { 'User-Agent': 'RecordLens/1.0' };
          
          // Fetch Community Stats
          const releaseRes = await fetch(`https://api.discogs.com/releases/${releaseId}?token=${process.env.DISCOGS_TOKEN}`, { headers });
          const releaseJson = await releaseRes.json();
          
          // Fetch Suggested Prices based on Condition
          const priceRes = await fetch(`https://api.discogs.com/marketplace/price_suggestions/${releaseId}?token=${process.env.DISCOGS_TOKEN}`, { headers });
          const priceJson = await priceRes.json();
          
          const formatPrice = (obj) => obj?.value ? `$${obj.value.toFixed(2)}` : '--';

          discogsData = {
            have: releaseJson.community?.have || 0,
            want: releaseJson.community?.want || 0,
            rating: releaseJson.community?.rating?.average || '--',
            ratingsCount: releaseJson.community?.rating?.count || 0,
            lastSold: "API Restricted", // Discogs blocks historic dates
            low: formatPrice(priceJson["Good (G)"]),
            median: formatPrice(priceJson["Very Good Plus (VG+)"]),
            high: formatPrice(priceJson["Near Mint (NM or M-)"])
          };
        } catch (e) { console.error("Discogs Fetch Error", e); }
      }
      return { ...match, discogsData };
    }));

    // 3. Text Extraction & eBay Sold Comps
    let textQuery = "";
    if (searchJson.knowledge_graph && searchJson.knowledge_graph.length > 0) {
      textQuery = searchJson.knowledge_graph[0].title;
    } else if (searchJson.text_results && searchJson.text_results.length > 0) {
      textQuery = searchJson.text_results.map(t => t.text).join(" ");
    } else if (searchJson.knowledge_graph && searchJson.knowledge_graph.title) {
      textQuery = searchJson.knowledge_graph.title;
    }

    let ebaySoldResults = [];
    if (textQuery) {
      const ebayUrl = `https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1&api_key=${process.env.SERPAPI_KEY}`;
      const ebayRes = await fetch(ebayUrl);
      const ebayJson = await ebayRes.json();
      ebaySoldResults = (ebayJson.organic_results || []).slice(0, 5); 
    }

    return NextResponse.json({ results: finalMatches, ebaySold: ebaySoldResults, textQuery: textQuery });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
