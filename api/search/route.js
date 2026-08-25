import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image'); 
    
    if (!file) return NextResponse.json({ error: "No image received" }, { status: 400 });
    if (!process.env.SERPAPI_KEY) return NextResponse.json({ error: "Missing SERPAPI_KEY" }, { status: 500 });

    // 1. LENS UPLOAD & TEXT EXTRACTION
    const serpApiUploadData = new FormData();
    serpApiUploadData.append('image', file);
    serpApiUploadData.append('api_key', process.env.SERPAPI_KEY);
    
    const uploadRes = await fetch('https://serpapi.com/image', { method: 'POST', body: serpApiUploadData });
    const uploadJson = await uploadRes.json();
    if (uploadJson.error) return NextResponse.json({ error: "SerpApi Error: " + uploadJson.error }, { status: 500 });
    
    const searchRes = await fetch(`https://serpapi.com/search.json?engine=google_lens&image_id=${uploadJson.image_id}&api_key=${process.env.SERPAPI_KEY}`);
    const searchJson = await searchRes.json();
    if (searchJson.error) return NextResponse.json({ error: "Google Lens Error: " + searchJson.error }, { status: 500 });

    let textQuery = "";
    if (searchJson.knowledge_graph && searchJson.knowledge_graph.length > 0) textQuery = searchJson.knowledge_graph[0].title;
    else if (searchJson.text_results && searchJson.text_results.length > 0) textQuery = searchJson.text_results.map(t => t.text).join(" ");
    else if (searchJson.knowledge_graph && searchJson.knowledge_graph.title) textQuery = searchJson.knowledge_graph.title;

    // 2. DISCOGS GRID FOR VISUAL MATCHES (API Powered)
    const allowedSites = ["discogs.com", "ebay.com", "popsike.com", "upcitemdb.com"];
    const visualMatches = searchJson.visual_matches || [];
    const curatedMatches = visualMatches.filter(match => allowedSites.some(site => match.link.toLowerCase().includes(site)));

    const finalMatches = await Promise.all(curatedMatches.map(async (match) => {
      let discogsData = { have: '--', want: '--', rating: '--', ratingsCount: '--', lastSold: 'API Restricted', low: '--', median: '--', high: '--' };
      if (match.link.toLowerCase().includes('discogs.com') && process.env.DISCOGS_TOKEN) {
        try {
          let releaseId = null;
          const mRel = match.link.match(/\/(?:release|sell\/release)\/(\d+)/);
          const mMast = match.link.match(/\/master\/(\d+)/);
          const headers = { 'User-Agent': 'RecordLens/1.0', 'Authorization': `Discogs token=${process.env.DISCOGS_TOKEN}` };

          if (mRel) releaseId = mRel[1];
          else if (mMast) {
             const masterRes = await fetch(`https://api.discogs.com/masters/${mMast[1]}`, { headers });
             const masterJson = await masterRes.json();
             releaseId = masterJson.main_release;
          }

          if (releaseId) {
             const relRes = await fetch(`https://api.discogs.com/releases/${releaseId}`, { headers });
             const relJson = await relRes.json();
             const priceRes = await fetch(`https://api.discogs.com/marketplace/price_suggestions/${releaseId}`, { headers });
             const priceJson = await priceRes.json();
             const fmt = (obj) => obj?.value ? `$${obj.value.toFixed(2)}` : '--';

             discogsData = {
               have: relJson.community?.have || '--', want: relJson.community?.want || '--',
               rating: relJson.community?.rating?.average ? `${relJson.community.rating.average} / 5` : '--',
               ratingsCount: relJson.community?.rating?.count || '--', lastSold: "API Restricted",
               low: fmt(priceJson["Good (G)"]), median: fmt(priceJson["Very Good Plus (VG+)"]), high: fmt(priceJson["Near Mint (NM or M-)"])
             };
          }
        } catch (e) { console.error(e); }
      }
      return { ...match, discogsData };
    }));

    // 3. TAMPERMONKEY APPRAISAL ENGINE (6-Sample Averages)
    let appraisal = {
      discogs: { val: null, link: textQuery ? `https://www.discogs.com/search?q=${encodeURIComponent(textQuery)}&type=all` : '#' },
      ebayActive: { val: null, link: textQuery ? `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(textQuery)}&_sacat=0&_from=R40` : '#' },
      ebaySold: { val: null, link: textQuery ? `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(textQuery)}&_sacat=0&_from=R40&rt=nc&LH_Sold=1` : '#' },
      popsike: { val: null, link: textQuery ? `https://www.popsike.com/php/quicksearch.php?searchtext=${encodeURIComponent(textQuery)}&sortord=dprice` : '#' }
    };
    
    let ebaySoldResults = []; // Saved for the bottom visual list

    if (textQuery) {
      const promises = [];

      // A. Discogs Average (Via API Search)
      promises.push((async () => {
         if(process.env.DISCOGS_TOKEN) {
            try {
               const searchRes = await fetch(`https://api.discogs.com/database/search?q=${encodeURIComponent(textQuery)}&per_page=1&type=release`, {headers: {'Authorization': `Discogs token=${process.env.DISCOGS_TOKEN}`}});
               const searchJson = await searchRes.json();
               if(searchJson.results && searchJson.results.length > 0) {
                  const priceRes = await fetch(`https://api.discogs.com/marketplace/price_suggestions/${searchJson.results[0].id}`, {headers: {'Authorization': `Discogs token=${process.env.DISCOGS_TOKEN}`}});
                  const priceJson = await priceRes.json();
                  if(priceJson["Very Good Plus (VG+)"]?.value) appraisal.discogs.val = priceJson["Very Good Plus (VG+)"].value;
               }
            } catch(e){}
         }
      })());

      // B. eBay Active Average (SerpApi - Top 6 limit)
      promises.push((async () => {
         try {
            const res = await fetch(`https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&api_key=${process.env.SERPAPI_KEY}`);
            const json = await res.json();
            let total = 0, count = 0;
            for(let item of (json.organic_results || [])) {
               if(item.price && item.price.extracted) {
                  total += item.price.extracted; count++;
                  if(count >= 6) break;
               }
            }
            if(count > 0) appraisal.ebayActive.val = total / count;
         } catch(e){}
      })());

      // C. eBay Sold Average & Visual List (SerpApi - Top 6 limit)
      promises.push((async () => {
         try {
            const res = await fetch(`https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&LH_Sold=1&LH_Complete=1&api_key=${process.env.SERPAPI_KEY}`);
            const json = await res.json();
            ebaySoldResults = (json.organic_results || []).slice(0, 10);
            let total = 0, count = 0;
            for(let item of ebaySoldResults) {
               if(item.price && item.price.extracted) {
                  total += item.price.extracted; count++;
                  if(count >= 6) break;
               }
            }
            if(count > 0) appraisal.ebaySold.val = total / count;
         } catch(e){}
      })());

      // D. Popsike HTML Scraper (Top 6 limit > $5)
      promises.push((async () => {
         try {
            const res = await fetch(appraisal.popsike.link, {headers:{'User-Agent':'Mozilla/5.0'}});
            const html = await res.text();
            const bTags = html.match(/<b>(.*?)<\/b>/g) || [];
            let total = 0, count = 0;
            for(let tag of bTags) {
               const cleanText = tag.replace(/<[^>]+>/g, '').replace(/[\s\u00A0]/g, '');
               const m = cleanText.match(/^[\$£€]?([0-9]+(,[0-9]{3})*(\.[0-9]{2})?)$/);
               if(m) {
                  const val = parseFloat(m[1].replace(/,/g, ""));
                  if(!isNaN(val) && val > 5) { total += val; count++; if(count >= 6) break; }
               }
            }
            if(count > 0) appraisal.popsike.val = total / count;
         } catch(e){}
      })());

      await Promise.all(promises);
    }

    return NextResponse.json({ results: finalMatches, ebaySold: ebaySoldResults, textQuery: textQuery, appraisal: appraisal });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
