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

    // 1. The Strict Domain Filter
    const allowedSites = ["discogs.com", "ebay.com", "popsike.com", "upcitemdb.com"];
    const visualMatches = searchJson.visual_matches || [];
    
    const curatedMatches = visualMatches.filter(match => {
      // .toLowerCase() guarantees it catches "eBay.com" and "ebay.com"
      return allowedSites.some(site => match.link.toLowerCase().includes(site)); 
    });

    // 2. Extract the Text/Entity for the Copy Button
    let textQuery = "";
    if (searchJson.knowledge_graph && searchJson.knowledge_graph.length > 0) {
      textQuery = searchJson.knowledge_graph[0].title; // e.g., Album Title
    } else if (searchJson.text_results && searchJson.text_results.length > 0) {
      textQuery = searchJson.text_results.map(t => t.text).join(" "); // e.g., Barcode Numbers
    } else if (searchJson.knowledge_graph && searchJson.knowledge_graph.title) {
      textQuery = searchJson.knowledge_graph.title;
    }

    return NextResponse.json({ 
      results: curatedMatches,
      textQuery: textQuery 
    });
    
  } catch (error) {
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
