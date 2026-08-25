import { NextResponse } from 'next/server';

// Helper to prevent Vercel from hanging forever
const fetchWithTimeout = async (url, options = {}, timeoutMs = 2500) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, { ...options, signal: controller.signal });
  clearTimeout(id);
  return response;
};

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

    const allowedSites = ["discogs.com", "ebay.com", "popsike.com", "upcitemdb.com"];
    const matches = (searchJson.visual_matches || []).filter(match => allowedSites.some(s => match.link.toLowerCase().includes(s))).slice(0, 8);

    // FIX: Smarter Text Extraction so eBay Sold doesn't get 0 results
    let textQuery = "";
    if (searchJson.knowledge_graph && searchJson.knowledge_graph.length > 0) {
      textQuery = searchJson.knowledge_graph[0].title;
    } else if (searchJson.text_results && searchJson.text_results.length > 0) {
      textQuery = searchJson.text_results.map(t => t.text).join(" ");
    } else if (matches.length > 0) {
      // If it has to steal the title, it limits it to the first 4 words so eBay can actually find it
      let rawTitle = matches[0].title.replace(/- eBay.*/i, '').replace(/- Discogs.*/i, '').replace(/\|.*/g, '').trim();
      textQuery = rawTitle.split(/\s+/).slice(0, 4).join(" ");
    }

    // CONCURRENT SCRAPING WITH TIMEOUTS
    const finalMatches = await Promise.all(matches.map(async (match) => {
      let result = { title: match.title, link: match.link, thumbnail: match.thumbnail, price: match.price, source: match.source };

      // 1. DISCOGS
      if (match.link.toLowerCase().includes('discogs.com')) {
        result.discogsData = { have:'--', want:'--', rating:'--', ratingsCount:'--', lastSold:'--', low:'--', median:'--', high:'--' };
        try {
          // Try HTML Scrape first
          const res = await fetchWithTimeout(match.link, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 2000);
          const html = await res.text();
          const flatHTML = html.replace(/\r?\n|\r/g, '').replace(/\s+/g, ' ');
          const ex = (regex) => { const m = flatHTML.match(regex); return m ? m[1].replace(/<[^>]+>/g, '').trim() : null; };
          
          const haveMatch = ex(/Have(?:<!-- -->)?:\s*<\/span>\s*<a[^>]*>([\d,]+)<\/a>/i);
          if (haveMatch) {
             result.discogsData.have = haveMatch;
             result.discogsData.want = ex(/Want(?:<!-- -->)?:\s*<\/span>\s*<a[^>]*>([\d,]+)<\/a>/i) || '--';
             result.discogsData.rating = ex(/Avg Rating(?:<!-- -->)?:\s*<\/span>\s*<span>(.*?)<\/span>/i) || '--';
             result.discogsData.ratingsCount = ex(/Ratings(?:<!-- -->)?:\s*<\/span>\s*<a[^>]*>([\d,]+)<\/a>/i) || '--';
             result.discogsData.lastSold = ex(/Last Sold(?:<!-- -->)?:\s*<\/span>\s*<a[^>]*>.*?<time[^>]*>([^<]+)<\/time>/i) || '--';
             result.discogsData.low = ex(/Low(?:<!-- -->)?:\s*<\/span>\s*<span>([^<]+)<\/span>/i) || '--';
             result.discogsData.median = ex(/Median(?:<!-- -->)?:\s*<\/span>\s*<span>([^<]+)<\/span>/i) || '--';
             result.discogsData.high = ex(/High(?:<!-- -->)?:\s*<\/span>\s*<span>([^<]+)<\/span>/i) || '--';
          } else {
             throw new Error("Scrape blocked");
          }
        } catch (e) {
          // Fallback to API if HTML was blocked
          if (process.env.DISCOGS_TOKEN) {
             try {
               const mRel = match.link.match(/\/(?:release|sell\/release|sell\/item)\/(\d+)/i) || match.link.match(/\/master\/(\d+)/i);
               if (mRel) {
                  const h = { 'User-Agent': 'RecordLens/1.0', 'Authorization': `Discogs token=${process.env.DISCOGS_TOKEN}` };
                  const [relRes, priceRes] = await Promise.all([
                     fetchWithTimeout(`https://api.discogs.com/releases/${mRel[1]}`, {headers: h}, 2000).then(r=>r.json()).catch(()=>({})),
                     fetchWithTimeout(`https://api.discogs.com/marketplace/price_suggestions/${mRel[1]}`, {headers: h}, 2000).then(r=>r.json()).catch(()=>({}))
                  ]);
                  result.discogsData.have = relRes.community?.have ?? '--';
                  result.discogsData.want = relRes.community?.want ?? '--';
                  result.discogsData.rating = relRes.community?.rating?.average ?? '--';
                  result.discogsData.ratingsCount = relRes.community?.rating?.count ?? '--';
                  result.discogsData.lastSold = 'API Hidden';
                  result.discogsData.low = priceRes["Good (G)"]?.value ? `$${priceRes["Good (G)"].value.toFixed(2)}` : '--';
                  result.discogsData.median = priceRes["Very Good Plus (VG+)"]?.value ? `$${priceRes["Very Good Plus (VG+)"].value.toFixed(2)}` : '--';
                  result.discogsData.high = priceRes["Near Mint (NM or M-)"]?.value ? `$${priceRes["Near Mint (NM or M-)"].value.toFixed(2)}` : '--';
               }
             } catch(err) {}
          }
        }
      }

      // 2. EBAY SCRAPER RESTORED
      if (match.link.toLowerCase().includes('ebay.com')) {
         try {
            const res = await fetchWithTimeout(match.link, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 2000);
            const html = await res.text();
            const priceMatch = html.match(/class="ux-textspans ux-textspans--BOLD"[^>]*>\s*(US\s*\$[\d,.]+)\s*<\/span>/i);
            if (priceMatch) result.ebayPrice = priceMatch[1];
         } catch(e) {}
      }

      return result;
    }));

    // FETCH EBAY SOLD
    let ebaySoldResults = [];
    if (textQuery) {
      try {
        const ebayUrl = `https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1&api_key=${process.env.SERPAPI_KEY}`;
        const ebayRes = await fetchWithTimeout(ebayUrl, {}, 4000);
        const ebayJson = await ebayRes.json();
        ebaySoldResults = (ebayJson.organic_results || []).slice(0, 10);
      } catch(e) { console.error(e); }
    }

    return NextResponse.json({ results: finalMatches, ebaySold: ebaySoldResults, textQuery });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
