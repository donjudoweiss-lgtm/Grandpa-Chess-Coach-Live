// Grandpa Chess Coach — usage counter (build 154, Oct 12 2026).
// Every board reading, coaching answer and spoken sentence leaves one tiny record here, with the
// real token counts Anthropic reports and the number of characters spoken, so Donald can see what
// each player actually costs. Records live in Netlify Blobs (store "gcc-usage"), one per event,
// under ev/<YYYY-MM-DD New York date>/... Recording never slows down or breaks the app: any
// failure is only logged.
// Loaded only when first needed, so a problem here can never stop Grandpa from talking or reading.
let blobs = null;
function lib() { if (!blobs) blobs = require('@netlify/blobs'); return blobs; }

// Dollars per million tokens [input, output] — Anthropic's published prices (Oct 2026).
const PRICES = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5': [2, 10] };
// Dollars per 1,000 characters spoken. ElevenLabs Creator plan: $22 for 121,000 credits ≈ $0.18 per
// 1,000 credits; the "flash" voice uses half a credit per character. Override with GCC_VOICE_PER_1K.
const VOICE_PER_1K = { eleven_flash_v2_5: 0.09, eleven_multilingual_v2: 0.18 };

function anthropicCost(model, usage) {
  const p = PRICES[model] || PRICES['claude-sonnet-5'];
  const u = usage || {};
  const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1;
  return (inTok * p[0] + (u.output_tokens || 0) * p[1]) / 1e6;
}
function voiceCost(model, chars) {
  const env = parseFloat(process.env.GCC_VOICE_PER_1K || '');
  const per = isFinite(env) && env > 0 ? env : (VOICE_PER_1K[model] || 0.18);
  return (chars || 0) / 1000 * per;
}
function cleanPlayer(p) {
  p = p || {};
  const id = String(p.id || 'unknown').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'unknown';
  const name = String(p.name || '').replace(/[<>]/g, '').trim().slice(0, 40);
  return { id, name };
}
function nyDay(d) { return (d || new Date()).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); }

async function record(evt, lambdaEvent) {
  try {
    const B = lib();
    if (lambdaEvent && B.connectLambda) { try { B.connectLambda(lambdaEvent); } catch (e) {} }
    const store = B.getStore('gcc-usage');
    const now = new Date();
    const key = 'ev/' + nyDay(now) + '/' + now.getTime() + '-' + Math.random().toString(36).slice(2, 8);
    const player = cleanPlayer(evt.player);
    await store.setJSON(key, {
      at: now.toISOString(), kind: evt.kind, model: evt.model || '',
      player: player.id, name: player.name,
      inTok: (evt.usage && evt.usage.input_tokens) || 0, outTok: (evt.usage && evt.usage.output_tokens) || 0,
      chars: evt.chars || 0, images: evt.images || 0,
      cost: Math.round((evt.cost || 0) * 1e5) / 1e5
    });
  } catch (e) { console.log('usage record failed:', e && e.message); }
}
module.exports = { record, anthropicCost, voiceCost, nyDay, cleanPlayer, PRICES };
