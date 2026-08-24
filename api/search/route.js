import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    // 1. Receive the image from the PWA frontend
    const formData = await request.formData();
    const file = formData.get('image'); 
    
    // 2. Upload the image directly to SerpApi to generate an image_id
    const serpApiUploadData = new FormData();
    serpApiUploadData.append('image', file);
    serpApiUploadData.append('api_key', process.env.SERPAPI_KEY);
    
    const uploadRes = await fetch('https://serpapi.com/image', {
      method: 'POST',
      body: serpApiUploadData
    });
    const uploadJson = await uploadRes.json();
    
    if (uploadJson.error) throw new Error(uploadJson.error);
    const imageId = uploadJson.image_id;

    // 3. Perform the Google Lens Search using the new image_id
    const searchRes = await fetch(`https://serpapi.com/search.json?engine=google_lens&image_id=${imageId}&api_key=${process.env.SERPAPI_KEY}`);
    const searchJson = await searchRes.json();
    
    // 4. The Curation Layer
    const allowedSites = ["wikipedia.org", "target.com", "amazon.com"]; // Put your curated sites here
    const visualMatches = searchJson.visual_matches || [];
    
    // Filter the results so it only returns links from your approved list
    const curatedMatches = visualMatches.filter(match => {
      return allowedSites.some(site => match.link.includes(site));
    });

    // 5. Send only the curated list back to the user's phone
    return NextResponse.json({ results: curatedMatches });
    
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to process image" }, { status: 500 });
  }
}
