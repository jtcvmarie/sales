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
    const matches = (searchJson.visual_matches || []).filter(match => allowedSites.some(s => match.link.toLowerCase().includes(s))).slice(0, 8);

    // GUARANTEE TEXT QUERY SO EBAY SOLD ALWAYS RUNS
    let textQuery = "";
    if (searchJson.knowledge_graph && searchJson.knowledge_graph.length > 0) {
      textQuery = searchJson.knowledge_graph[0].title;
    } else if (searchJson.text_results && searchJson.text_results.length > 0) {
      textQuery = searchJson.text_results.map(t => t.text).join(" ");
    } else if (matches.length > 0) {
      // Ultimate fallback: Steal the title from the first match
      textQuery = matches[0].title.replace(/eBay|Discogs|Popsike/ig, '').replace(/\|.*/, '').trim();
    }

    // THE AGGRESSIVE HTML SCRAPER
    const finalMatches = await Promise.all(matches.map(async (match) => {
      
      // 1. Discogs Exact HTML Scraper
      if (match.link.toLowerCase().includes('discogs.com')) {
        match.discogsData = { have:'--', want:'--', rating:'--', ratingsCount:'--', lastSold:'--', low:'--', median:'--', high:'--' };
        try {
          const res = await fetch(match.link, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
          const html = await res.text();
          
          // Flattens the HTML to kill invisible newlines so the regex works perfectly
          const flatHTML = html.replace(/\r?\n|\r/g, '').replace(/\s+/g, ' ');
          const ex = (regex) => { const m = flatHTML.match(regex); return m ? m[1].replace(/<!--.*?-->/g, '').trim() : null; };
          
          const have = ex(/Have(?:<!-- -->)?:\s*<\/span>\s*<a[^>]*>([\d,]+)<\/a>/i);
          if (have) {
             match.discogsData = {
               have: have,
               want: ex(/Want(?:<!-- -->)?:\s*<\/span>\s*<a[^>]*>([\d,]+)<\/a>/i) || '--',
               rating: ex(/Avg Rating(?:<!-- -->)?:\s*<\/span>\s*<span>(.*?)<\/span>/i) || '--',
               ratingsCount: ex(/Ratings(?:<!-- -->)?:\s*<\/span>\s*<a[^>]*>([\d,]+)<\/a>/i) || '--',
               lastSold: ex(/Last Sold(?:<!-- -->)?:\s*<\/span>\s*<a[^>]*>.*?<time[^>]*>([^<]+)<\/time>/i) || ex(/Last Sold(?:<!-- -->)?:\s*<\/span>\s*<span>([^<]+)<\/span>/i) || '--',
               low: ex(/Low(?:<!-- -->)?:\s*<\/span>\s*<span>([^<]+)<\/span>/i) || '--',
               median: ex(/Median(?:<!-- -->)?:\s*<\/span>\s*<span>([^<]+)<\/span>/i) || '--',
               high: ex(/High(?:<!-- -->)?:\s*<\/span>\s*<span>([^<]+)<\/span>/i) || '--'
             };
          } else if (process.env.DISCOGS_TOKEN) {
             // Fallback to API if Cloudflare blocked the HTML fetch
             const mRel = match.link.match(/\/(?:release|sell\/release)\/(\d+)/);
             if(mRel) {
                const h = { 'User-Agent': 'RecordLens/1.0', 'Authorization': `Discogs token=${process.env.DISCOGS_TOKEN}` };
                const [relRes, priceRes] = await Promise.all([
                   fetch(`https://api.discogs.com/releases/${mRel[1]}`, {headers: h}).then(r=>r.json()),
                   fetch(`https://api.discogs.com/marketplace/price_suggestions/${mRel[1]}`, {headers: h}).then(r=>r.json())
                ]);
                match.discogsData.have = relRes.community?.have || '--';
                match.discogsData.want = relRes.community?.want || '--';
                match.discogsData.rating = relRes.community?.rating?.average || '--';
                match.discogsData.low = priceRes["Good (G)"]?.value ? `$${priceRes["Good (G)"].value.toFixed(2)}` : '--';
                match.discogsData.median = priceRes["Very Good Plus (VG+)"]?.value ? `$${priceRes["Very Good Plus (VG+)"].value.toFixed(2)}` : '--';
                match.discogsData.high = priceRes["Near Mint (NM or M-)"]?.value ? `$${priceRes["Near Mint (NM or M-)"].value.toFixed(2)}` : '--';
             }
          }
        } catch (e) { console.error(e); }
      } 
      
      // 2. eBay Exact HTML Scraper
      if (match.link.toLowerCase().includes('ebay.com')) {
        try {
          const ebayRes = await fetch(match.link, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          const ebayHtml = await ebayRes.text();
          const flatEbay = ebayHtml.replace(/\r?\n|\r/g, '').replace(/\s+/g, ' ');
          
          // Targets your exact ux-textspans--BOLD classes
          const mainPrice = flatEbay.match(/class="ux-textspans ux-textspans--BOLD"[^>]*>\s*(US\s*\$[\d,.]+)\s*<\/span>/i);
          const shipPrice = flatEbay.match(/class="ux-textspans ux-textspans--BOLD"[^>]*>\s*(US\s*\$[\d,.]+)\s*<\/span>[^<]*shipping/i);
          
          if (mainPrice) match.ebayPrice = mainPrice[1];
          if (shipPrice) match.ebayShipping = shipPrice[1];
        } catch(e) {}
      }
      return match;
    }));

    // APPRAISAL MATH & EBAY SOLD FETCH
    let appraisal = { discogs: {val:null}, ebayActive: {val:null}, ebaySold: {val:null} };
    let ebaySoldResults = [];

    if (textQuery) {
      const promises = [];
      
      // Fetch eBay Sold
      promises.push(
         fetch(`https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1&api_key=${process.env.SERPAPI_KEY}`)
         .then(r => r.json())
         .then(json => {
            ebaySoldResults = (json.organic_results || []).slice(0, 10);
            let total = 0, count = 0;
            for(let item of ebaySoldResults) {
               if(item.price && item.price.extracted) { total += item.price.extracted; count++; if(count >= 6) break; }
            }
            if(count > 0) appraisal.ebaySold.val = total / count;
         }).catch(e=>console.error(e))
      );

      // Fetch eBay Active Avg
      promises.push(
         fetch(`https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&api_key=${process.env.SERPAPI_KEY}`)
         .then(r => r.json())
         .then(json => {
            let total = 0, count = 0;
            for(let item of (json.organic_results || [])) {
               if(item.price && item.price.extracted) { total += item.price.extracted; count++; if(count >= 6) break; }
            }
            if(count > 0) appraisal.ebayActive.val = total / count;
         }).catch(e=>console.error(e))
      );

      // Map Discogs Median
      const firstDiscogs = finalMatches.find(m => m.link.includes('discogs.com') && m.discogsData?.median && m.discogsData.median !== '--');
      if (firstDiscogs) appraisal.discogs.val = parseFloat(firstDiscogs.discogsData.median.replace(/[^0-9.]/g, ''));

      await Promise.all(promises);
    }

    return NextResponse.json({ results: finalMatches, ebaySold: ebaySoldResults, textQuery, appraisal });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
