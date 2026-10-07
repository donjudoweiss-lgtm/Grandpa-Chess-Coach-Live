
// Grandpa Chess Coach — ElevenLabs relay
// This runs on Netlify's servers, not in the browser, so it isn't blocked by the
// cross-site rules that stop the iPad from talking to ElevenLabs directly.
// It needs one thing set up in Netlify: an environment variable named
// ELEVENLABS_API_KEY holding Don's ElevenLabs API key. The key never appears
// in this file and never reaches the iPad.
//
// Faster version (Oct 2026): the voice ID is remembered after the first lookup, so most
// requests make ONE trip to ElevenLabs instead of two. Same voice, same model
// (eleven_multilingual_v2), same settings — the sound is unchanged.

// Remembered between requests while Netlify keeps this helper "warm".
const voiceIdCache = {};

async function findVoiceId(apiKey, voiceName) {
  const key = String(voiceName).toLowerCase().trim();
  if (voiceIdCache[key]) return { id: voiceIdCache[key] };
  const voicesResp = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': apiKey }
  });
  if (!voicesResp.ok) {
    const bodyText = await voicesResp.text().catch(() => '');
    let msg = 'Could not list ElevenLabs voices (HTTP ' + voicesResp.status + ').';
    if (voicesResp.status === 401) msg = 'ElevenLabs rejected the API key stored in this site\'s ELEVENLABS_API_KEY — it may be wrong or expired.';
    return { error: msg + ' ' + bodyText.slice(0, 200), status: 502 };
  }
  const voicesData = await voicesResp.json();
  const voices = voicesData.voices || [];
  const match = voices.find(v => v.name && v.name.toLowerCase().trim() === key);
  if (!match) {
    const names = voices.map(v => v.name).join(', ');
    return { error: 'No ElevenLabs voice named "' + voiceName + '" was found. Your voices are: ' + (names || '(none)') + '.', status: 404 };
  }
  voiceIdCache[key] = match.voice_id;
  return { id: match.voice_id };
}

// Oct 2026: two voice models to choose from.
//  'fast' = eleven_flash_v2_5 — about half the credits, quicker, 32 languages (the default now)
//  'rich' = eleven_multilingual_v2 — the original, fullest sound
const VOICE_MODELS = { fast: 'eleven_flash_v2_5', rich: 'eleven_multilingual_v2' };
function speak(apiKey, voiceId, text, modelId) {
  return fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg'
    },
    body: JSON.stringify({ text: text, model_id: modelId || VOICE_MODELS.fast })
  });
}

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
  const modelId = VOICE_MODELS[payload.voiceModel] || VOICE_MODELS.fast;
  if (!text || !voiceName) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing text or voiceName.' }) };
  }

  try {
    let found = await findVoiceId(apiKey, voiceName);
    if (found.error) {
      return { statusCode: found.status, headers, body: JSON.stringify({ error: found.error }) };
    }

    let speechResp = await speak(apiKey, found.id, text, modelId);
    // If a remembered voice ID has gone stale (e.g. the voice was re-created), look it up fresh once.
    if (speechResp.status === 404 || speechResp.status === 400) {
      delete voiceIdCache[String(voiceName).toLowerCase().trim()];
      found = await findVoiceId(apiKey, voiceName);
      if (found.error) {
        return { statusCode: found.status, headers, body: JSON.stringify({ error: found.error }) };
      }
      speechResp = await speak(apiKey, found.id, text, modelId);
    }
    // If the fast voice model can't use this cloned voice, fall back to the rich model so Grandpa is never silent.
    let usedModel = modelId;
    if (!speechResp.ok && speechResp.status !== 401 && modelId !== VOICE_MODELS.rich) {
      const why = await speechResp.text().catch(() => '');
      console.log('fast voice failed, using rich voice instead:', speechResp.status, why.slice(0, 200));
      speechResp = await speak(apiKey, found.id, text, VOICE_MODELS.rich);
      usedModel = VOICE_MODELS.rich;
    }
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
      body: JSON.stringify({ audio: audioBase64, model: usedModel })
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error: ' + e.message }) };
  }
};
