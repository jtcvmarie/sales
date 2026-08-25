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

    // --- HTML CLEANER HELPERS ---
    const cleanHTML = (str) => {
       if (!str) return '--';
       return str.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, '').trim();
    };
    const getStat = (html, statName) => {
       let parts = html.split(`>${statName}<!-- -->:</span>`);
       if (parts.length < 2) parts = html.split(`>${statName}:</span>`);
       if (parts.length < 2) return '--';
       return cleanHTML(parts[1].split('</li>')[0]);
    };

    // --- AGGRESSIVE SCRAPER ---
    const finalMatches = await Promise.all(curatedMatches.map(async (match) => {
      
      // 1. DISCOGS SCRAPER
      if (match.link.toLowerCase().includes('discogs.com')) {
        try {
          const res = await fetch(match.link, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
          const html = await res.text();
          
          match.discogsData = {
            have: getStat(html, 'Have'),
            want: getStat(html, 'Want'),
            rating: getStat(html, 'Avg Rating'),
            ratingsCount: getStat(html, 'Ratings'),
            lastSold: getStat(html, 'Last Sold'),
            low: getStat(html, 'Low'),
            median: getStat(html, 'Median'),
            high: getStat(html, 'High')
          };
        } catch (e) { console.error("Discogs Error", e); }
      } 
      
      // 2. EBAY SCRAPER
      if (match.link.toLowerCase().includes('ebay.com')) {
        try {
          const ebayRes = await fetch(match.link, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
          const ebayHtml = await ebayRes.text();
          
          // Uses your exact provided HTML classes to force price extraction
          const priceMatch = ebayHtml.match(/<span class="ux-textspans ux-textspans--BOLD">([^<]*\$[0-9,.]+[^<]*)<\/span>/);
          const strikeMatch = ebayHtml.match(/<span class="ux-textspans ux-textspans--STRIKETHROUGH">([^<]*\$[0-9,.]+[^<]*)<\/span>/);
          const shipMatch = ebayHtml.match(/<span class="ux-textspans ux-textspans--BOLD">([^<]*shipping[^<]*)<\/span>/i);

          match.ebayPrice = priceMatch ? priceMatch[1] : (match.price ? `${match.price.currency}${match.price.extracted_value}` : '--');
          match.ebayStrike = strikeMatch ? strikeMatch[1] : null;
          match.ebayShipping = shipMatch ? shipMatch[1] : null;
        } catch(e) {}
      }

      return match;
    }));

    // --- TEXT EXTRACTION & EBAY SOLD COMP FETCH ---
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
