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

    const allowedSites = ["discogs.com", "ebay.com", "popsike.com", "upcitemdb.com"];
    const matches = (searchJson.visual_matches || []).filter(match => allowedSites.some(s => match.link.toLowerCase().includes(s))).slice(0, 10);

    let textQuery = "";
    if (searchJson.knowledge_graph && searchJson.knowledge_graph.length > 0) {
      textQuery = searchJson.knowledge_graph[0].title;
    } else if (searchJson.text_results && searchJson.text_results.length > 0) {
      textQuery = searchJson.text_results.map(t => t.text).join(" ");
    } else if (matches.length > 0) {
      textQuery = matches[0].title.replace(/eBay|Discogs|Popsike/ig, '').replace(/\|.*/, '').trim();
    }

    // MAP OVER RESULTS AND ATTACH SCRAPED DATA EXPLICITLY
    const finalMatches = await Promise.all(matches.map(async (match) => {
      let discogsData = { have:'--', want:'--', rating:'--', ratingsCount:'--', lastSold:'--', low:'--', median:'--', high:'--' };
      let ebayPrice = null;

      // 1. Discogs Scraper
      if (match.link.toLowerCase().includes('discogs.com')) {
        try {
          // Attempt HTML Scrape First
          const res = await fetch(match.link, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
          const html = await res.text();
          const flatHTML = html.replace(/\r?\n|\r/g, '').replace(/\s+/g, ' ');
          const ex = (regex) => { const m = flatHTML.match(regex); return m ? m[1].replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, '').trim() : null; };
          
          const haveMatch = ex(/Have(?:<!-- -->)?:\s*<\/span>\s*<a[^>]*>([\d,]+)<\/a>/i);
          
          if (haveMatch) {
             discogsData = {
               have: haveMatch,
               want: ex(/Want(?:<!-- -->)?:\s*<\/span>\s*<a[^>]*>([\d,]+)<\/a>/i) || '--',
               rating: ex(/Avg Rating(?:<!-- -->)?:\s*<\/span>\s*<span>(.*?)<\/span>/i) || '--',
               ratingsCount: ex(/Ratings(?:<!-- -->)?:\s*<\/span>\s*<a[^>]*>([\d,]+)<\/a>/i) || '--',
               lastSold: ex(/Last Sold(?:<!-- -->)?:\s*<\/span>\s*<a[^>]*>.*?<time[^>]*>([^<]+)<\/time>/i) || ex(/Last Sold(?:<!-- -->)?:\s*<\/span>\s*<span>([^<]+)<\/span>/i) || '--',
               low: ex(/Low(?:<!-- -->)?:\s*<\/span>\s*<span>([^<]+)<\/span>/i) || '--',
               median: ex(/Median(?:<!-- -->)?:\s*<\/span>\s*<span>([^<]+)<\/span>/i) || '--',
               high: ex(/High(?:<!-- -->)?:\s*<\/span>\s*<span>([^<]+)<\/span>/i) || '--'
             };
          } else if (process.env.DISCOGS_TOKEN) {
             // Fallback to API if blocked
             const mRel = match.link.match(/\/(?:release|sell\/release)\/(\d+)/);
             if (mRel) {
                const h = { 'User-Agent': 'RecordLens/1.0', 'Authorization': `Discogs token=${process.env.DISCOGS_TOKEN}` };
                const [relRes, priceRes] = await Promise.all([
                   fetch(`https://api.discogs.com/releases/${mRel[1]}`, {headers: h}).then(r=>r.json()).catch(()=>({})),
                   fetch(`https://api.discogs.com/marketplace/price_suggestions/${mRel[1]}`, {headers: h}).then(r=>r.json()).catch(()=>({}))
                ]);
                discogsData.have = relRes.community?.have ?? '--';
                discogsData.want = relRes.community?.want ?? '--';
                discogsData.rating = relRes.community?.rating?.average ?? '--';
                discogsData.ratingsCount = relRes.community?.rating?.count ?? '--';
                discogsData.lastSold = "API Hidden";
                discogsData.low = priceRes["Good (G)"]?.value ? `$${priceRes["Good (G)"].value.toFixed(2)}` : '--';
                discogsData.median = priceRes["Very Good Plus (VG+)"]?.value ? `$${priceRes["Very Good Plus (VG+)"].value.toFixed(2)}` : '--';
                discogsData.high = priceRes["Near Mint (NM or M-)"]?.value ? `$${priceRes["Near Mint (NM or M-)"].value.toFixed(2)}` : '--';
             }
          }
        } catch (e) { console.error("Discogs Scrape Error", e); }
      }

      // 2. eBay Scraper
      if (match.link.toLowerCase().includes('ebay.com')) {
         try {
            const res = await fetch(match.link, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const html = await res.text();
            // Target the exact class you provided
            const priceMatch = html.match(/class="ux-textspans ux-textspans--BOLD"[^>]*>\s*(US\s*\$[\d,.]+)\s*<\/span>/i);
            if (priceMatch) {
               ebayPrice = priceMatch[1];
            }
         } catch(e) { console.error("eBay Scrape Error", e); }
      }

      // Create a brand new object to guarantee Next.js sends the data to your phone
      return {
         title: match.title,
         link: match.link,
         thumbnail: match.thumbnail,
         price: match.price, // original Lens price
         source: match.source,
         discogsData: discogsData,
         ebayPrice: ebayPrice
      };
    }));

    // FETCH EBAY SOLD
    let ebaySoldResults = [];
    if (textQuery) {
      try {
        const ebayUrl = `https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1&api_key=${process.env.SERPAPI_KEY}`;
        const ebayRes = await fetch(ebayUrl);
        const ebayJson = await ebayRes.json();
        ebaySoldResults = (ebayJson.organic_results || []).slice(0, 10);
      } catch(e) { console.error("eBay Sold Error", e); }
    }

    return NextResponse.json({ results: finalMatches, ebaySold: ebaySoldResults, textQuery });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
