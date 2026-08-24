import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image'); 
    
    if (!file) {
      return NextResponse.json({ error: "No image received by Vercel server" }, { status: 400 });
    }

    // 1. Check if Vercel has the API key
    if (!process.env.SERPAPI_KEY) {
      return NextResponse.json({ error: "Vercel is missing your SERPAPI_KEY in its environment variables." }, { status: 500 });
    }

    // 2. Upload to SerpApi
    const serpApiUploadData = new FormData();
    serpApiUploadData.append('image', file);
    serpApiUploadData.append('api_key', process.env.SERPAPI_KEY);
    
    const uploadRes = await fetch('https://serpapi.com/image', {
      method: 'POST',
      body: serpApiUploadData
    });
    const uploadJson = await uploadRes.json();
    
    // Return SerpApi's exact error if they reject it
    if (uploadJson.error) {
      return NextResponse.json({ error: "SerpApi Error: " + uploadJson.error }, { status: 500 });
    }
    
    const imageId = uploadJson.image_id;

    // 3. Search Google Lens
    const searchRes = await fetch(`https://serpapi.com/search.json?engine=google_lens&image_id=${imageId}&api_key=${process.env.SERPAPI_KEY}`);
    const searchJson = await searchRes.json();
    
    if (searchJson.error) {
       return NextResponse.json({ error: "Google Lens Error: " + searchJson.error }, { status: 500 });
    }

    const allowedSites = ["wikipedia.org", "target.com", "amazon.com"]; // Change these to your sites later
    const visualMatches = searchJson.visual_matches || [];
    
    const curatedMatches = visualMatches.filter(match => {
      return allowedSites.some(site => match.link.includes(site));
    });

    return NextResponse.json({ results: curatedMatches });
    
  } catch (error) {
    // Catch any other random crashes
    return NextResponse.json({ error: "Server crashed: " + error.message }, { status: 500 });
  }
}
