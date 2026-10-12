// Grandpa Chess Coach — tester invite codes (build 155, Oct 12 2026).
// A tester opens their personal link (…/?invite=RUTH-4821). The app asks this function:
//   POST {code}  ->  {ok:true, code, name, start, expires, active, daysLeft}  or  {ok:false, reason}
// The 3-week clock starts the first time a code is used and is kept on the server (Netlify Blobs,
// store "gcc-invites"), so clearing the phone or switching devices does not restart it.
// The list of codes lives in netlify/lib/testers.json.
import { getStore } from '@netlify/blobs';
import testers from '../lib/testers.json';

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (obj, code) => new Response(JSON.stringify(obj), { status: code || 200, headers });

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers });
  if (req.method !== 'POST') return reply({ ok: false, reason: 'method' }, 405);
  let body = {};
  try { body = await req.json(); } catch (e) {}
  const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40);
  const entry = code && testers.codes && testers.codes[code];
  if (!entry) return reply({ ok: false, reason: 'unknown' });
  const days = entry.days || testers.days || 21;
  const store = getStore({ name: 'gcc-invites', consistency: 'strong' });
  let rec = await store.get('code-' + code, { type: 'json' }).catch(() => null);
  if (!rec || !rec.start) {
    rec = { start: Date.now(), uses: 0 };
  }
  rec.uses = (rec.uses || 0) + 1; rec.last = Date.now();
  try { await store.setJSON('code-' + code, rec); } catch (e) {}
  const expires = rec.start + days * 86400000;
  const now = Date.now();
  return reply({ ok: true, code, name: entry.name || '', start: rec.start, expires, days,
    active: now < expires, daysLeft: Math.max(0, Math.ceil((expires - now) / 86400000)) });
};
