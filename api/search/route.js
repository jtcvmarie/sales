import { NextResponse } from 'next/server';

// Prevents Vercel from timing out and crashing the app
const fetchWithTimeout = async (url, options = {}, timeoutMs = 2500) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
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
    const matches = (searchJson.visual_matches || []).filter(match => match?.link && allowedSites.some(s => match.link.toLowerCase().includes(s))).slice(0, 10);

    // FIX: Gentle Text Extraction that doesn't destroy the query
    let rawText = searchJson.knowledge_graph?.[0]?.title || "";
    if (!rawText) rawText = searchJson.text_results?.map(t => t?.text || "").join(" ") || "";
    if (!rawText && matches.length > 0) rawText = matches[0]?.title || "";
    
    let textQuery = "";
    if (rawText) {
       textQuery = String(rawText)
           .replace(/(eBay|Discogs|Popsike|Vinyl|LP|CD|Record|Album)/ig, '')
           .replace(/\|.*/g, '') // Removes SEO junk after pipes
           .replace(/\s*-\s*(eBay|Discogs).*$/i, '') // Only removes trailing site names
           .replace(/\s+/g, ' ').trim();
       
       // Keeps a healthy 6 words for a solid eBay Sold search
       textQuery = textQuery.split(/\s+/).slice(0, 6).join(" ");
    }

    // PROCESS ALL VISUAL MATCHES
    const finalMatches = await Promise.all(matches.map(async (match) => {
      let result = { title: match.title, link: match.link, thumbnail: match.thumbnail, price: match.price, source: match.source };

      // 1. DISCOGS LOGIC
      if (match.link.toLowerCase().includes('discogs.com')) {
        result.discogsData = { have:'--', want:'--', rating:'--', ratingsCount:'--', lastSold:'--', low:'--', median:'--', high:'--', debug: '' };
        try {
          // Attempt HTML Scrape First (Because it works well for the 8 stats)
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
             result.discogsData.lastSold = ex(/Last Sold(?:<!-- -->)?:\s*<\/span>\s*<a[^>]*>.*?<time[^>]*>([^<]+)<\/time>/i) || ex(/Last Sold(?:<!-- -->)?:\s*<\/span>\s*<span>([^<]+)<\/span>/i) || '--';
             result.discogsData.low = ex(/Low(?:<!-- -->)?:\s*<\/span>\s*<span>([^<]+)<\/span>/i) || '--';
             result.discogsData.median = ex(/Median(?:<!-- -->)?:\s*<\/span>\s*<span>([^<]+)<\/span>/i) || '--';
             result.discogsData.high = ex(/High(?:<!-- -->)?:\s*<\/span>\s*<span>([^<]+)<\/span>/i) || '--';
             result.discogsData.debug = "HTML_OK";
          } else {
             throw new Error("HTML Blocked");
          }
        } catch (e) {
          // Fallback to API Token
          if (process.env.DISCOGS_TOKEN) {
             try {
               const idMatch = match.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
               if (idMatch) {
                  let releaseId = idMatch[1];
                  const h = { 'User-Agent': 'RecordLens/1.1', 'Authorization': `Discogs token=${process.env.DISCOGS_TOKEN}` };

                  if (match.link.includes('/master/')) {
                     const mRes = await fetchWithTimeout(`https://api.discogs.com/masters/${releaseId}`, { headers: h }, 2000);
                     if (mRes.ok) {
                        const mJson = await mRes.json();
                        releaseId = mJson.main_release;
                     }
                  }

                  const [relRes, priceRes] = await Promise.all([
                     fetchWithTimeout(`https://api.discogs.com/releases/${releaseId}`, {headers: h}, 2000).then(r=>r.json()).catch(()=>({})),
                     fetchWithTimeout(`https://api.discogs.com/marketplace/price_suggestions/${releaseId}`, {headers: h}, 2000).then(r=>r.json()).catch(()=>({}))
                  ]);

                  result.discogsData.have = relRes.community?.have ?? '--';
                  result.discogsData.want = relRes.community?.want ?? '--';
                  result.discogsData.rating = relRes.community?.rating?.average ?? '--';
                  result.discogsData.ratingsCount = relRes.community?.rating?.count ?? '--';
                  result.discogsData.lastSold = 'API Hidden';
                  result.discogsData.low = priceRes["Good (G)"]?.value ? `$${priceRes["Good (G)"].value.toFixed(2)}` : '--';
                  result.discogsData.median = priceRes["Very Good Plus (VG+)"]?.value ? `$${priceRes["Very Good Plus (VG+)"].value.toFixed(2)}` : '--';
                  result.discogsData.high = priceRes["Near Mint (NM or M-)"]?.value ? `$${priceRes["Near Mint (NM or M-)"].value.toFixed(2)}` : '--';
                  result.discogsData.debug = "API_FALLBACK_OK";
               }
             } catch(err) { result.discogsData.debug = "API_TIMEOUT"; }
          } else { result.discogsData.debug = "NO_TOKEN"; }
        }
      }

      // 2. EBAY LOGIC (Your exact class scraper)
      if (match.link.toLowerCase().includes('ebay.com')) {
         try {
            const res = await fetchWithTimeout(match.link, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 2000);
            const html = await res.text();
            const flatHTML = html.replace(/\r?\n|\r/g, '').replace(/\s+/g, ' ');
            const priceMatch = flatHTML.match(/class="ux-textspans ux-textspans--BOLD"[^>]*>\s*(US\s*\$[\d,.]+)\s*<\/span>/i);
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
