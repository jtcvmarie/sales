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
    // HELPER: Indestructible eBay Sold Scraper
    // ==========================================
    async function fetchEbaySold(queryStr, apiKey) {
      if (!queryStr || !queryStr.trim()) return { results: [], notice: null };
      let results = [];
      let notice = null;

      try {
        const soldUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(queryStr)}&LH_Sold=1&LH_Complete=1`;
        const res = await fetch(soldUrl, { headers: botHeaders });
        const html = await res.text();
        
        // Detect eBay's "Fewer Words" fallback
        if (html.match(/Matching fewer words/i) || html.match(/removed some search terms/i)) {
            notice = "No exact matches found. Displaying results for fewer words:";
        }

        // Split by the core info block (bypasses random layout changes)
        const blocks = html.split(/class="s-item__info/i).slice(1);
        
        for (let block of blocks) {
          if (block.toLowerCase().includes('shop on ebay')) continue;
          
          let titleMatch = block.match(/<div[^>]*s-item__title[^>]*>([\s\S]*?)<\/div>/i);
          if (!titleMatch) continue;
          // Strip nested tags like 'New Listing' spans
          let title = titleMatch[1].replace(/<[^>]+>/g, '').replace(/New Listing/i, '').trim();

          let linkMatch = block.match(/href="([^"]+)"/i);
          let link = linkMatch ? linkMatch[1].split('?')[0] : "";

          let priceMatch = block.match(/<span[^>]*s-item__price[^>]*>([\s\S]*?)<\/span>/i);
          let price = priceMatch ? priceMatch[1].replace(/<[^>]+>/g, '').trim() : "";

          let dateMatch = block.match(/<div[^>]*s-item__title--tag[^>]*>([\s\S]*?)<\/div>/i) || 
                          block.match(/<div[^>]*s-item__caption--tag[^>]*>([\s\S]*?)<\/div>/i) || 
                          block.match(/<span[^>]*POSITIVE[^>]*>([\s\S]*?)<\/span>/i);
          let date = dateMatch ? dateMatch[1].replace(/<[^>]+>/g, '').trim() : "";

          if (title && link) results.push({ title, link, price, condition: date });
          if (results.length >= 15) break;
        }
      } catch (e) {}

      // FALLBACK: If Vercel is blocked by Captcha, use SerpApi's Sold engine
      if (results.length === 0 && apiKey) {
        try {
          const serpUrl = `https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(queryStr)}&LH_Sold=1&LH_Complete=1&api_key=${apiKey}`;
          const serpRes = await fetch(serpUrl);
          const serpJson = await serpRes.json();
          if (serpJson.organic_results) {
            results = serpJson.organic_results.slice(0, 15).map(item => ({
              title: item.title, link: item.link, price: item.price?.raw || null, condition: item.condition || "Sold"
            }));
          }
        } catch(e) {}
      }

      return { results, notice };
    }

    // ==========================================
    // ROUTE 1: Dedicated eBay Sold-Only Request
    // ==========================================
    if (soldOnlyQuery) {
      const soldData = await fetchEbaySold(soldOnlyQuery, serpapiKey);
      return NextResponse.json({ ebaySoldResults: soldData.results, soldNotice: soldData.notice });
    }

    if (!serpapiKey) return NextResponse.json({ error: "Missing SERPAPI_KEY" }, { status: 500 });

    let textQuery = "Vinyl Record";
    let discogsLinks = [];
    let ebayLinks = [];

    // ==========================================
    // ROUTE 2: Image Upload (Google Lens)
    // ==========================================
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
    // ==========================================
    // ROUTE 3: Manual Text Search (Discogs + eBay)
    // ==========================================
    else if (manualQuery) {
      textQuery = manualQuery;
      
      if (discogsToken) {
        try {
          const dRes = await fetch(`https://api.discogs.com/database/search?q=${encodeURIComponent(textQuery)}&type=release&per_page=15`, {
            headers: { 'User-Agent': 'RecordLens/6.0', 'Authorization': `Discogs token=${discogsToken}` }
          });
          if (dRes.ok) {
            const dJson = await dRes.json();
            discogsLinks = (dJson.results || []).map(r => ({ link: `https://www.discogs.com/release/${r.id}`, title: r.title, thumbnail: r.thumb }));
          }
        } catch (e) {}
      }
      
      try {
        const eRes = await fetch(`https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&api_key=${serpapiKey}`);
        if (eRes.ok) {
          const eJson = await eRes.json();
          if (eJson.organic_results) {
            ebayLinks = eJson.organic_results.slice(0, 6).map(r => ({ link: r.link, title: r.title, thumbnail: r.thumbnail, price: { raw: r.price?.raw } }));
          }
        }
      } catch (e) {}
    } else {
      return NextResponse.json({ error: "No query provided" }, { status: 400 });
    }

    // ==========================================
    // Concurrent Data Fetching
    // ==========================================

    // TASK 1: Discogs Have & Want Stats
    const discogsTask = Promise.all(discogsLinks.map(async (match) => {
      let discogsData = { have: '--', want: '--' };
      if (discogsToken) {
        const idMatch = match.link.match(/\/(?:release|master|sell\/(?:release|item|history))\/(\d+)/i);
        if (idMatch) {
          let id = idMatch[1];
          const headers = { 'User-Agent': 'RecordLens/6.0', 'Authorization': `Discogs token=${discogsToken}` };
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

    // TASK 2: eBay Active HTML Scraper
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
            const backupMatch = html.match(/class="ux-textspans ux-textspans--BOLD"[^>]*>\s*([A-Z£€]*\s*\$?\s*[\d,.]+)\s*<\/span>/i) ||
                                html.match(/id="prcIsum_bidPrice"[^>]*>\s*([A-Z£€]*\s*\$?\s*[\d,.]+)/i);
            if (backupMatch) price = backupMatch[1].trim();
          }
        } catch (e) {}
      }
      return { title: m.title, link: m.link, thumbnail: m.thumbnail, price };
    }));

    // TASK 3: eBay Sold Fetch
    const ebaySoldTask = fetchEbaySold(textQuery, serpapiKey);

    const [discogsMatches, ebayActiveMatches, soldData] = await Promise.all([ discogsTask, ebayActiveTask, ebaySoldTask ]);

    return NextResponse.json({ 
        discogsMatches, 
        ebayActiveMatches, 
        ebaySoldResults: soldData.results, 
        soldNotice: soldData.notice,
        textQuery 
    });
    
  } catch (error) {
    return NextResponse.json({ error: "Server error: " + error.message }, { status: 500 });
  }
}
