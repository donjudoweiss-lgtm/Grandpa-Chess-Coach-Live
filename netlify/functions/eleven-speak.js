
// Grandpa Chess Coach — ElevenLabs relay
// This runs on Netlify's servers, not in the browser, so it isn't blocked by the
// cross-site rules that stop the iPad from talking to ElevenLabs directly.
// It needs one thing set up in Netlify: an environment variable named
// ELEVENLABS_API_KEY holding Don's ElevenLabs API key. The key never appears
// in this file and never reaches the iPad.

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed.' }) };
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'This server is missing its ElevenLabs key. In Netlify, go to Site configuration → Environment variables and add ELEVENLABS_API_KEY.' })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bad request body.' }) };
  }

  const text = payload.text;
  const voiceName = payload.voiceName;
  if (!text || !voiceName) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing text or voiceName.' }) };
  }

  try {
    const voicesResp = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey }
    });
    if (!voicesResp.ok) {
      const bodyText = await voicesResp.text().catch(() => '');
      let msg = 'Could not list ElevenLabs voices (HTTP ' + voicesResp.status + ').';
      if (voicesResp.status === 401) msg = 'ElevenLabs rejected the API key stored in this site\'s ELEVENLABS_API_KEY — it may be wrong or expired.';
      return { statusCode: 502, headers, body: JSON.stringify({ error: msg + ' ' + bodyText.slice(0, 200) }) };
    }
    const voicesData = await voicesResp.json();
    const voices = voicesData.voices || [];
    const match = voices.find(v => v.name && v.name.toLowerCase().trim() === String(voiceName).toLowerCase().trim());
    if (!match) {
      const names = voices.map(v => v.name).join(', ');
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'No ElevenLabs voice named "' + voiceName + '" was found. Your voices are: ' + (names || '(none)') + '.' })
      };
    }

    const speechResp = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + match.voice_id, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({ text: text, model_id: 'eleven_multilingual_v2' })
    });
    if (!speechResp.ok) {
      const bodyText = await speechResp.text().catch(() => '');
      let msg = 'ElevenLabs speech request failed (HTTP ' + speechResp.status + ').';
      if (speechResp.status === 401) msg = 'ElevenLabs rejected the API key while generating speech (401 Unauthorized).';
      if (speechResp.status === 422) msg = 'ElevenLabs rejected the request (422) — this can mean a plan limit was hit.';
      return { statusCode: 502, headers, body: JSON.stringify({ error: msg + ' ' + bodyText.slice(0, 200) }) };
    }

    const arrayBuffer = await speechResp.arrayBuffer();
    const audioBase64 = Buffer.from(arrayBuffer).toString('base64');

    return {
      statusCode: 200,
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify({ audio: audioBase64 })
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error: ' + e.message }) };
  }
};
