import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image'); 
    
    if (!file) return NextResponse.json({ error: "No image received" }, { status: 400 });
    if (!process.env.SERPAPI_KEY) return NextResponse.json({ error: "Missing SERPAPI_KEY" }, { status: 500 });

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

    // --- AGGRESSIVE DISCOGS EXTRACTOR ---
    const finalMatches = await Promise.all(curatedMatches.map(async (match) => {
      // Default grid so it ALWAYS shows up, even if the fetch fails
      let discogsData = { have: '--', want: '--', rating: '--', ratingsCount: '--', lastSold: '--', low: '--', median: '--', high: '--' };
      
      if (match.link.toLowerCase().includes('discogs.com')) {
        try {
          // Attempt 1: Scrape the actual HTML for true historical data
          const res = await fetch(match.link, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
          const html = await res.text();
          
          const extract = (regex) => { const m = html.match(regex); return m ? m[1] : null; };
          
          const htmlHave = extract(/Have(?:<!-- -->)?:.*?<a[^>]*>([\d,]+)<\/a>/);
          const htmlWant = extract(/Want(?:<!-- -->)?:.*?<a[^>]*>([\d,]+)<\/a>/);
          const htmlRating = extract(/Avg Rating(?:<!-- -->)?:.*?<span>([\d.]+\s*\/\s*5)/);
          const htmlRatingsCount = extract(/Ratings(?:<!-- -->)?:.*?<a[^>]*>([\d,]+)<\/a>/);
          const htmlLastSold = extract(/Last Sold(?:<!-- -->)?:.*?<time[^>]*>([^<]+)<\/time>/) || extract(/Last Sold(?:<!-- -->)?:.*?<a[^>]*>([^<]+)<\/a>/);
          const htmlLow = extract(/Low(?:<!-- -->)?:.*?<span>([^<]+)<\/span>/);
          const htmlMedian = extract(/Median(?:<!-- -->)?:.*?<span>([^<]+)<\/span>/);
          const htmlHigh = extract(/High(?:<!-- -->)?:.*?<span>([^<]+)<\/span>/);

          if (htmlHave || htmlMedian) {
             discogsData = {
                have: htmlHave || '--', want: htmlWant || '--', rating: htmlRating || '--', ratingsCount: htmlRatingsCount || '--',
                lastSold: htmlLastSold || '--', low: htmlLow || '--', median: htmlMedian || '--', high: htmlHigh || '--'
             };
          } else if (process.env.DISCOGS_TOKEN) {
             // Attempt 2: Fallback to the Discogs API if scraping was blocked
             let releaseId = null;
             const mRel = match.link.match(/\/(?:release|sell\/release)\/(\d+)/);
             const mMast = match.link.match(/\/master\/(\d+)/);
             
             if (mRel) releaseId = mRel[1];
             else if (mMast) {
                const masterRes = await fetch(`https://api.discogs.com/masters/${mMast[1]}`, { headers: { 'Authorization': `Discogs token=${process.env.DISCOGS_TOKEN}` } });
                const masterJson = await masterRes.json();
                releaseId = masterJson.main_release;
             }
             if (releaseId) {
                const headers = { 'Authorization': `Discogs token=${process.env.DISCOGS_TOKEN}` };
                const releaseRes = await fetch(`https://api.discogs.com/releases/${releaseId}`, { headers });
                const releaseJson = await releaseRes.json();
                const priceRes = await fetch(`https://api.discogs.com/marketplace/price_suggestions/${releaseId}`, { headers });
                const priceJson = await priceRes.json();
                const fmt = (obj) => obj?.value ? `$${obj.value.toFixed(2)}` : '--';
                
                discogsData = {
                  have: releaseJson.community?.have || '--', want: releaseJson.community?.want || '--',
                  rating: releaseJson.community?.rating?.average ? `${releaseJson.community.rating.average} / 5` : '--',
                  ratingsCount: releaseJson.community?.rating?.count || '--',
                  lastSold: "API Restricted", low: fmt(priceJson["Good (G)"]), median: fmt(priceJson["Very Good Plus (VG+)"]), high: fmt(priceJson["Near Mint (NM or M-)"])
                };
             }
          }
        } catch (e) { console.error("Discogs Error", e); }
      } else {
        discogsData = null; // Don't attach to eBay links
      }
      
      return { ...match, discogsData };
    }));

    let textQuery = "";
    if (searchJson.knowledge_graph && searchJson.knowledge_graph.length > 0) textQuery = searchJson.knowledge_graph[0].title;
    else if (searchJson.text_results && searchJson.text_results.length > 0) textQuery = searchJson.text_results.map(t => t.text).join(" ");
    else if (searchJson.knowledge_graph && searchJson.knowledge_graph.title) textQuery = searchJson.knowledge_graph.title;

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
