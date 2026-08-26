import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { query } = await request.json();
    if (!query) return NextResponse.json({ error: "No query provided" }, { status: 400 });

    // Directly constructs the true eBay Sold URL
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`;
    const botHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36' };
    
    const res = await fetch(url, { headers: botHeaders });
    const html = await res.text();

    // Split the HTML into individual item blocks
    const itemBlocks = html.split('s-item__wrapper').slice(1, 12);
    const results = [];
    
    for (const block of itemBlocks) {
        // Look for the title, link, and the POSITIVE (green) price tag which denotes a sold item
        const titleMatch = block.match(/<div class="s-item__title">.*?<span[^>]*>(.*?)<\/span>/i) || block.match(/<div class="s-item__title"><span[^>]*>(.*?)<\/span>/i);
        const linkMatch = block.match(/href="([^"]+)"/i);
        const priceMatch = block.match(/<span class="s-item__price">.*?<span class="POSITIVE">([^<]+)<\/span>/i) || block.match(/<span class="s-item__price">.*?<span[^>]*>([^<]+)<\/span>/i);
        const dateMatch = block.match(/<span class="POSITIVE">([^<]+202[0-9])<\/span>/i) || block.match(/<div class="s-item__title--tag">.*?<span class="POSITIVE">([^<]+)<\/span>/i);
        
        if (titleMatch && linkMatch) {
            let title = titleMatch[1].replace(/<!--.*?-->/g, '').trim();
            if (title.toLowerCase().includes('shop on')) continue; // Skip ad artifacts
            
            let price = priceMatch ? priceMatch[1].replace(/<!--.*?-->/g, '').trim() : "Sold";
            let date = dateMatch ? dateMatch[1].replace(/<!--.*?-->/g, '').trim() : "";
            
            results.push({ 
                title, 
                link: linkMatch[1].split('?')[0], // Cleans up giant tracking URLs
                price, 
                condition: date 
            });
        }
    }

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
