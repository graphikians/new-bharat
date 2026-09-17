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
    const { images, lat, lng, language, accessCode } = req.body || {};

    // Optional access-code gate: set ACCESS_CODE in Vercel env vars to require
    // it. If ACCESS_CODE is not set, the app works open (no code needed).
    if (process.env.ACCESS_CODE && accessCode !== process.env.ACCESS_CODE) {
      res.status(403).json({ error: 'Galat ya missing access code. Settings mein sahi code daalo.' });
      return;
    }

    if (!Array.isArray(images) || images.length === 0 || !images[0].data) {
      res.status(400).json({ error: 'No image provided' });
      return;
    }
    if (images.length > 3) {
      res.status(400).json({ error: 'Maximum 3 photos allowed' });
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

    const langInstruction =
      language === 'en'
        ? 'Write every text field (wasteType, volume, durationEstimate, severityReason, impactNear, impactFar, risks, recommendedAction, complaintSubject, complaintBody) in clear, formal English.'
        : language === 'gu'
        ? 'Write every text field (wasteType, volume, durationEstimate, severityReason, impactNear, impactFar, risks, recommendedAction, complaintSubject, complaintBody) in natural Gujarati (Gujarati script), formal enough for a civic complaint but clear for an ordinary citizen to read.'
        : 'Write every text field (wasteType, volume, durationEstimate, severityReason, impactNear, impactFar, risks, recommendedAction, complaintSubject, complaintBody) in natural Hinglish (Hindi-English mix, Latin script) — the way an educated Indian citizen writes, not textbook Hindi and not pure English.';

    const multiImageNote =
      images.length > 1
        ? `\nMultiple photos of the SAME waste/site are provided (${images.length} images) — the first is a wider/full shot showing the overall area, the rest are close-ups showing more detail. Treat them as ONE incident and use ALL of them together to build a single, more accurate and detailed assessment (do not describe them as separate incidents).\n`
        : '';

    const prompt = [
      'Tum ek senior Municipal Waste Assessment Officer ho jo Swachh Bharat Sundar Bharat mission ke liye',
      'field photo se ek detailed, honest waste assessment report aur ek formal civic complaint banate ho.',
      multiImageNote,
      'STRICT RULES:',
      '- Sirf jo photo mein clearly dikh raha hai usi ke basis par likho, kuch bhi imagine mat karo.',
      '- Uncertain quantity/duration ke liye "approximately"/"estimated" qualifier use karo.',
      '- NO SUGAR-COATING: jo severity genuinely dikh rahi hai wahi likho — agar hazardous/severe hai to use "low" ya "minor"',
      '  mat bolo sirf politeness ke liye. Agar genuinely minor hai to use overstate bhi mat karo. Honest, direct, factual.',
      '- Har text field DETAILED hona chahiye — ek line ka generic jawab mat do. severityReason, impactNear, impactFar aur',
      '  recommendedAction kam se kam 2-3 specific sentences ke hone chahiye, generic waste-hazard boilerplate nahi —',
      '  jo is specific photo mein dikh raha hai usi ko reference karo (colors, materials, quantity, surroundings, etc).',
      '- Health/impact projections general scientific waste-decomposition aur vector-borne-disease knowledge par based',
      '  hone chahiye — factual aur specific, generic fear-mongering nahi, lekin genuine risk ko chhupao bhi mat.',
      '- complaintBody EK PERSUASIVE, FORMAL civic complaint hona chahiye jo authority ko turant action lene ke liye',
      '  convince kare: specific observed facts do, civic/public-health impact clearly state karo, Swachh Bharat Mission',
      '  ke under civic body ki responsibility ka reference do, aur ek clear time-bound action request karo',
      '  (jaise "within 48 hours" ya "at the earliest"). Polite lekin firm tone — request nahi, ek legitimate complaint.',
      '',
      langInstruction,
      '',
      locLine,
      '',
      'Reply with ONLY a JSON object, no other text, no markdown fence, exactly these fields:',
      '{',
      '  "wasteType": string,',
      '  "volume": string,',
      '  "durationEstimate": string,',
      '  "severityLevel": number from 1 to 5,',
      '  "severityReason": string (2-3 detailed sentences, specific to this photo),',
      '  "impactNear": string (2-3 detailed sentences — next 3-5 days if unaddressed),',
      '  "impactFar": string (2-3 detailed sentences — next 15-30 days if unaddressed),',
      '  "risks": array of short strings (specific, not generic),',
      '  "urgency": one of "Routine", "Priority", "Urgent",',
      '  "recommendedAction": string (2-3 detailed, specific sentences),',
      '  "complaintSubject": string (short, specific email subject line),',
      '  "complaintBody": string (a persuasive, formal, ready-to-send complaint as described above, 4-6 sentences,',
      '    include the location info above — coordinates or landmark — if present, else [LOCATION])',
      '}',
    ].join('\n');

    const imageParts = images.map((img) => ({
      inline_data: { mime_type: img.mediaType || 'image/jpeg', data: img.data },
    }));

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
              parts: [...imageParts, { text: prompt }],
            },
          ],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 2048 },
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
