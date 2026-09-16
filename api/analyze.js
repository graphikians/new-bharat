// Vercel Serverless Function
// Receives a photo + optional GPS coordinates from the browser, asks Google
// Gemini (free tier) to analyze it, and returns a structured waste-assessment
// report as JSON.
// Needs one environment variable set in the Vercel project: GEMINI_API_KEY
// Get a free key at https://aistudio.google.com/apikey (no credit card needed)

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { imageBase64, mediaType, lat, lng } = req.body || {};

    if (!imageBase64) {
      res.status(400).json({ error: 'No image provided' });
      return;
    }

    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'Server is not configured — GEMINI_API_KEY missing.' });
      return;
    }

    let locLine = 'Location: not available for this photo.';
    if (lat != null && lng != null) {
      locLine = `GPS coordinates: ${lat}, ${lng} (Google Maps: https://www.google.com/maps?q=${lat},${lng})`;
    }

    // Reverse geocode (best-effort, never blocks the report if it fails)
    let detectedLocation = null;
    if (lat != null && lng != null) {
      try {
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`,
          {
            headers: {
              'User-Agent': 'NewBharat-SwachhBharat-Tool/1.0 (civic waste reporting app)',
              'Accept-Language': 'en',
            },
          }
        );
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          const addr = geoData.address || {};
          const area = addr.suburb || addr.neighbourhood || addr.village || '';
          const city = addr.city || addr.town || addr.municipality || addr.county || '';
          const state = addr.state || '';
          detectedLocation = {
            displayName: geoData.display_name || null,
            area: area || null,
            city: city || null,
            state: state || null,
          };
        }
      } catch (e) {
        // reverse geocoding is best-effort only
      }
    }

    const prompt = [
      'Tum ek Municipal Waste Assessment Officer ho jo Swachh Bharat Sundar Bharat mission ke liye',
      'field photo se ek waste assessment report banate ho.',
      '',
      'STRICT RULES:',
      '- Sirf jo photo mein clearly dikh raha hai usi ke basis par likho, kuch bhi imagine ya exaggerate mat karo.',
      '- Uncertain quantity/duration ke liye "approximately"/"estimated" jaisa qualifier use karo.',
      '- Health/impact projections general scientific waste-decomposition aur vector-borne-disease knowledge',
      '  par based hone chahiye — factual, credible tone, fear-mongering nahi.',
      '- complaintBody Hinglish/English mix mein formal ho, civic authority ko bhejne layak ho.',
      '',
      locLine,
      '',
      'Reply with ONLY a JSON object, no other text, no markdown fence, exactly these fields:',
      '{',
      '  "wasteType": string,',
      '  "volume": string,',
      '  "durationEstimate": string,',
      '  "severityLevel": number from 1 to 5,',
      '  "severityReason": string,',
      '  "impactNear": string (next 3-5 days if unaddressed),',
      '  "impactFar": string (next 15-30 days if unaddressed),',
      '  "risks": array of short strings,',
      '  "urgency": one of "Routine", "Priority", "Urgent",',
      '  "recommendedAction": string,',
      '  "complaintSubject": string,',
      '  "complaintBody": string (ready to send, include the location info above — coordinates or landmark — if present, else [LOCATION])',
      '}',
    ].join('\n');

    const apiRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: mediaType || 'image/jpeg', data: imageBase64 } },
                { text: prompt },
              ],
            },
          ],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      }
    );

    const data = await apiRes.json();

    if (!apiRes.ok) {
      res.status(apiRes.status).json({ error: (data && data.error && data.error.message) || 'AI service error' });
      return;
    }

    const candidate = (data.candidates || [])[0];
    const partsList = (candidate && candidate.content && candidate.content.parts) || [];
    const textBlock = partsList.find(function (p) { return typeof p.text === 'string'; });
    let raw = textBlock ? textBlock.text : '';
    let jsonStr = raw.trim();

    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1];

    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace > -1 && lastBrace > -1) jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      res.status(502).json({ error: 'AI response could not be read. Try again.', raw: raw.slice(0, 500) });
      return;
    }

    res.status(200).json(Object.assign({}, parsed, { detectedLocation }));
  } catch (err) {
    res.status(500).json({ error: (err && err.message) || 'Server error' });
  }
};
