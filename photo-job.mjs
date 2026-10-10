// Grandpa Chess Coach — photo reading, step 1 of 2 (added Oct 10, 2026).
// Netlify stops a normal request after about 30 seconds, but a careful reading of a chess photo
// takes longer. So this function only SAVES the photo and starts the reading in the background
// (photo-work-background.mjs, which may run up to 15 minutes). The app then asks this same
// function every few seconds "is it ready yet?" until Grandpa's answer is there.
//   POST  {prompt, imageBase64, imageMime}  ->  {jobId}
//   GET   ?id=<jobId>                       ->  {status:'pending'} | {status:'done', text} | {status:'error', error}
import { getStore } from '@netlify/blobs';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};
const reply = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers });

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers });
  const store = getStore({ name: 'gcc-photo-reads', consistency: 'strong' });
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const id = url.searchParams.get('id') || '';
    if (!/^[a-z0-9-]{8,60}$/i.test(id)) return reply(400, { status: 'error', error: 'Bad job id.' });
    const result = await store.get('result-' + id, { type: 'json' });
    if (result) return reply(200, result);
    const started = await store.get('job-' + id, { type: 'json' });
    if (!started) return reply(200, { status: 'error', error: 'Grandpa lost track of that picture. Please try again.' });
    return reply(200, { status: 'pending' });
  }

  if (req.method !== 'POST') return reply(405, { status: 'error', error: 'Method not allowed.' });
  let payload;
  try { payload = await req.json(); } catch (e) { return reply(400, { status: 'error', error: 'Bad request body.' }); }
  if (!payload || !payload.prompt || !payload.imageBase64) return reply(400, { status: 'error', error: 'Missing photo.' });

  const jobId = crypto.randomUUID();
  await store.setJSON('job-' + jobId, {
    prompt: String(payload.prompt),
    imageBase64: String(payload.imageBase64),
    imageMime: payload.imageMime || 'image/jpeg',
    at: Date.now()
  });
  const start = await fetch(new URL('/.netlify/functions/photo-work-background', url.origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId })
  }).catch((e) => ({ ok: false, status: 0, statusText: String(e) }));
  if (!start.ok && start.status !== 202) {
    return reply(502, { status: 'error', error: 'Could not start the photo reading (' + start.status + ').' });
  }
  return reply(200, { jobId });
};
