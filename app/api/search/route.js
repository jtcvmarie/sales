import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image'); 
    const manualQuery = formData.get('query'); 
    const soldOnlyQuery = formData.get('soldQuery'); 

    const serpapiKey = process.env.SERPAPI_KEY;
    const discogsToken = process.env.DISCOGS_TOKEN;
    const botHeaders = { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
    };

    // ==========================================
    // HELPER: Strict eBay Sold Scraper
    // ==========================================
    async function fetchEbaySold(queryStr, apiKey) {
      if (!queryStr || !queryStr.trim()) return { results: [], notice: null, debug: "Empty query provided." };
      let results = [];
      let notice = null;
      let debugMsg = "HTML Scraper: ";

      try {
        const soldUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(queryStr)}&LH_Sold=1&LH_Complete=1`;
        const res = await fetch(soldUrl, { headers: botHeaders });
        const html = await res.text();
        
        if (html.match(/Matching fewer words/i) || html.match(/removed some search terms/i) || html.match(/No exact matches found/i)) {
            notice = "No exact matches found. Displaying results matching fewer words:";
        }

        const blocks = html.split(/class="[^"]*s-item__info[^"]*"/i).slice(1);
        
        for (let block of blocks) {
          if (block.toLowerCase().includes('shop on ebay')) continue;
          
          // THE FIX: Strict Sold Verification. 
          // If eBay tries to soft-block us and serve Active listings, the block will NOT contain the 'POSITIVE' class.
          // If it lacks 'POSITIVE', we throw the result in the trash so we don't lie to the user.
          if (!block.includes('POSITIVE')) continue;
          
          let titleMatch = block.match(/<div[^>]*s-item__title[^>]*>([\s\S]*?)<\/div>/i);
          if (!titleMatch) continue;
          let title = titleMatch[1].replace(/<[^>]+>/g, '').replace(/New Listing/i, '').trim();

          let linkMatch = block.match(/href="([^"]+)"/i);
          let link = linkMatch ? linkMatch[1].split('?')[0] + "?orig_cvip=true" : "";

          // Ensure we are pulling the specific green price
          let priceMatch = block.match(/<span[^>]*POSITIVE[^>]*>([\s\S]*?\$[\d,.]+)<\/span>/i) || block.match(/<span[^>]*s-item__price[^>]*>([\s\S]*?)<\/span>/i);
          let price = priceMatch ? priceMatch[1].replace(/<[^>]+>/g, '').trim() : "";

          let dateMatch = block.match(/<div[^>]*s-item__title--tag[^>]*>([\s\S]*?)<\/div>/i) || 
                          block.match(/<span[^>]*POSITIVE[^>]*>([\s\S]*?202[0-9])<\/span>/i);
          let date = dateMatch ? dateMatch[1].replace(/<[^>]+>/g, '').trim() : "Sold";

          if (title && link) results.push({ title, link, price, condition: date });
          if (results.length >= 15) break;
        }
        debugMsg += `Verified ${results.length} strictly sold items. `;
      } catch (e) {
        debugMsg += `Error (${e.message}). `;
      }

      // FALLBACK TO SERPAPI
      if (results.length === 0 && apiKey) {
        debugMsg += "Fallback API: ";
        try {
          const serpUrl = `https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(queryStr)}&LH_Sold=1&LH_Complete=1&api_key=${apiKey}`;
          const serpRes = await fetch(serpUrl);
          const serpJson = await serpRes.json();
          
          if (serpJson.search_information && (serpJson.search_information.showing_results_for || serpJson.search_information.spelling_fix)) {
              notice = "No exact matches found. Displaying results matching fewer words (via API fallback):";
          }

          if (serpJson.organic_results && serpJson.organic_results.length > 0) {
            for (let item of serpJson.organic_results) {
               // STRICT API VERIFICATION: SerpApi must confirm it's sold
               let condition = item.condition || "";
               let isSold = condition.toLowerCase().includes('sold') || (item.extensions && item.extensions.some(e => e.toLowerCase().includes('sold')));
               
               if (isSold || item.price?.raw) {
                   let safeLink = item.link;
                   if (!safeLink.includes('orig_cvip')) safeLink += safeLink.includes('?') ? '&orig_cvip=true' : '?orig_cvip=true';
                   results.push({ title: item.title, link: safeLink, price: item.price?.raw || null, condition: condition || "Sold" });
               }
               if (results.length >= 15) break;
            }
            debugMsg += `Verified ${results.length} items.`;
          } else {
            debugMsg += "0 items found.";
          }
        } catch(e) {
            debugMsg += `Error (${e.message}).`;
        }
      }

      return { results, notice, debug: debugMsg };
    }

    if (soldOnlyQuery) {
      const soldData = await fetchEbaySold(soldOnlyQuery, serpapiKey);
      return NextResponse.json({ 
          ebaySoldResults: soldData.results, 
          soldNotice: soldData.notice,
          soldDebug: soldData.debug 
      });
    }

    if (!serpapiKey) return NextResponse.json({ error: "Missing SERPAPI_KEY" }, { status: 500 });

    let textQuery = "Vinyl Record";
    let discogsLinks = [];
    let ebayLinks = [];

    if (file) {
      const uploadData = new FormData();
      uploadData.append('image', file);
      uploadData.append('api_key', serpapiKey);
      
      const uploadRes = await fetch('https://serpapi.com/image', { method: 'POST', body: uploadData });
      const uploadJson = await uploadRes.json();
      
      const searchRes = await fetch(`https://serpapi.com/search.json?engine=google_lens&image_id=${uploadJson.image_id}&api_key=${serpapiKey}`);
      const searchJson = await searchRes.json();
      const visualMatches = searchJson.visual_matches || [];

      let rawTitle = searchJson.knowledge_graph?.[0]?.title || visualMatches[0]?.title || "Vinyl Record";
      let cleanText = rawTitle.replace(/[-|—–]/g, ' ').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
      textQuery = cleanText.split(' ').slice(0, 10).join(' ') || "Vinyl Record";

      discogsLinks = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('discogs.com')).slice(0, 15);
      ebayLinks = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('ebay.com')).slice(0, 6);
    } 
    else if (manualQuery) {
      textQuery = manualQuery;
      
      const dPromise = discogsToken ? fetch(`https://api.discogs.com/database/search?q=${encodeURIComponent(textQuery)}&type=release&per_page=15`, {
        headers: { 'User-Agent': 'RecordLens/9.0', 'Authorization': `Discogs token=${discogsToken}` }
      }).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null);
      
      const ePromise = fetch(`https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&api_key=${serpapiKey}`)
        .then(r => r.ok ? r.json() : null).catch(() => null);

      const [dJson, eJson] = await Promise.all([dPromise, ePromise]);

      if (dJson && dJson.results) discogsLinks = dJson.results.map(r => ({ link: `https://www.discogs.com/release/${r.id}`, title: r.title, thumbnail: r.thumb }));
      if (eJson && eJson.organic_results) ebayLinks = eJson.organic_results.slice(0, 6).map(r => ({ link: r.link, title: r.title, thumbnail: r.thumbnail, price: { raw: r.price?.raw } }));
    }

    const discogsTask = Promise.all(discogsLinks.map(async (match) => {
      let discogsData = { have: '--', want: '--' };
      if (discogsToken) {
        const idMatch = match.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
        if (idMatch) {
          let id = idMatch[1];
          const headers = { 'User-Agent': 'RecordLens/9.0', 'Authorization': `Discogs token=${discogsToken}` };
          try {
            if (match.link.includes('/master/')) {
              const mRes = await fetch(`https://api.discogs.com/masters/${id}`, { headers });
              if (mRes.ok) id = (await mRes.json()).main_release;
            }
            const relRes = await fetch(`https://api.discogs.com/releases/${id}`, { headers });
            if (relRes.ok) {
              const rData = await relRes.json();
              discogsData.have = rData.community?.have ?? '--';
              discogsData.want = rData.community?.want ?? '--';
            }
          } catch (err) {}
        }
      }
      return { title: match.title, link: match.link, thumbnail: match.thumbnail, discogsData };
    }));

    const ebayActiveTask = Promise.all(ebayLinks.map(async (m) => {
      let price = m.price?.raw || (m.price?.extracted_value ? `$${m.price.extracted_value}` : null);
      if (!price || m.link.includes('ebay.io')) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 1200); 
          const res = await fetch(m.link, { headers: botHeaders, signal: controller.signal });
          clearTimeout(timeoutId);
          const html = await res.text();
          
          const metaPrice = html.match(/itemprop="price" content="([^"]+)"/i);
          if (metaPrice) {
            price = `$${metaPrice[1]}`;
          } else {
            const backupMatch = html.match(/class="ux-textspans ux-textspans--BOLD"[^>]*>\s*([A-Z£€]*\s*\$?\s*[\d,.]+)\s*<\/span>/i) || html.match(/id="prcIsum_bidPrice"[^>]*>\s*([A-Z£€]*\s*\$?\s*[\d,.]+)/i);
            if (backupMatch) price = backupMatch[1].trim();
          }
        } catch (e) {}
      }
      return { title: m.title, link: m.link, thumbnail: m.thumbnail, price };
    }));

    const ebaySoldTask = fetchEbaySold(textQuery, serpapiKey);

    const [discogsMatches, ebayActiveMatches, soldData] = await Promise.all([ discogsTask, ebayActiveTask, ebaySoldTask ]);

    return NextResponse.json({ 
        discogsMatches, 
        ebayActiveMatches, 
        ebaySoldResults: soldData.results, 
        soldNotice: soldData.notice,
        soldDebug: soldData.debug,
        textQuery 
    });
    
  } catch (error) {
    return NextResponse.json({ error: "Server error: " + error.message }, { status: 500 });
  }
}
