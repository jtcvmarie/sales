import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image'); 
    const manualQuery = formData.get('query'); 
    const soldOnlyQuery = formData.get('soldQuery'); // For dedicated sold searches

    const serpapiKey = process.env.SERPAPI_KEY;
    const discogsToken = process.env.DISCOGS_TOKEN;
    const botHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36' };

    // ==========================================
    // HELPER: Scrape eBay Sold Listings Directly
    // ==========================================
    async function fetchEbaySold(queryStr) {
      if (!queryStr || !queryStr.trim()) return [];
      try {
        const soldUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(queryStr)}&LH_Sold=1&LH_Complete=1`;
        const res = await fetch(soldUrl, { headers: botHeaders });
        const html = await res.text();
        
        const items = html.split(/<li[^>]*class="[^"]*s-item[^"]*"[^>]*>/i).slice(1, 12);
        const results = [];
        for (let item of items) {
          if (item.toLowerCase().includes('shop on ebay')) continue;
          
          let titleMatch = item.match(/<div[^>]*class="[^"]*s-item__title[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
          let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : "";

          let linkMatch = item.match(/href="([^"]+)"/i);
          let link = linkMatch ? linkMatch[1].split('?')[0] : "";

          let priceMatch = item.match(/<span[^>]*class="[^"]*s-item__price[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
          let price = priceMatch ? priceMatch[1].replace(/<[^>]+>/g, '').trim() : "";

          let dateMatch = item.match(/<span[^>]*class="[^"]*POSITIVE[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
          let date = dateMatch ? dateMatch[1].replace(/<[^>]+>/g, '').trim() : "";

          if (title && link) results.push({ title, link, price, condition: date });
        }
        return results;
      } catch (e) {
        return [];
      }
    }

    // ==========================================
    // ROUTE 1: Dedicated eBay Sold-Only Request
    // ==========================================
    if (soldOnlyQuery) {
      const soldResults = await fetchEbaySold(soldOnlyQuery);
      return NextResponse.json({ ebaySoldResults: soldResults });
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

      // Cap Discogs to max 15 results
      discogsLinks = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('discogs.com')).slice(0, 15);
      ebayLinks = visualMatches.filter(m => m.link && m.link.toLowerCase().includes('ebay.com')).slice(0, 6);
    } 
    // ==========================================
    // ROUTE 3: Manual Text Search (Discogs + eBay)
    // ==========================================
    else if (manualQuery) {
      textQuery = manualQuery;
      
      // Query Discogs database sorted by relevance (up to 15 results)
      if (discogsToken) {
        try {
          const dRes = await fetch(`https://api.discogs.com/database/search?q=${encodeURIComponent(textQuery)}&type=release&per_page=15`, {
            headers: { 'User-Agent': 'RecordLens/5.0', 'Authorization': `Discogs token=${discogsToken}` }
          });
          if (dRes.ok) {
            const dJson = await dRes.json();
            discogsLinks = (dJson.results || []).map(r => ({
              link: `https://www.discogs.com/release/${r.id}`,
              title: r.title,
              thumbnail: r.thumb
            }));
          }
        } catch (e) {}
      }
      
      // Query eBay Active Listings
      try {
        const eRes = await fetch(`https://serpapi.com/search.json?engine=ebay&_nkw=${encodeURIComponent(textQuery)}&api_key=${serpapiKey}`);
        if (eRes.ok) {
          const eJson = await eRes.json();
          if (eJson.organic_results) {
            ebayLinks = eJson.organic_results.slice(0, 6).map(r => ({
              link: r.link,
              title: r.title,
              thumbnail: r.thumbnail,
              price: { raw: r.price?.raw }
            }));
          }
        }
      } catch (e) {}
    } else {
      return NextResponse.json({ error: "No image or query provided" }, { status: 400 });
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
          const headers = { 'User-Agent': 'RecordLens/5.0', 'Authorization': `Discogs token=${discogsToken}` };
          
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
    const ebaySoldTask = fetchEbaySold(textQuery);

    const [discogsMatches, ebayActiveMatches, ebaySoldResults] = await Promise.all([
      discogsTask, 
      ebayActiveTask, 
      ebaySoldTask
    ]);

    return NextResponse.json({ discogsMatches, ebayActiveMatches, ebaySoldResults, textQuery });
    
  } catch (error) {
    return NextResponse.json({ error: "Server error: " + error.message }, { status: 500 });
  }
}
