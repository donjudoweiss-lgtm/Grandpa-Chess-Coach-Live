// Grandpa Chess Coach — photo reading, step 2 of 2 (added Oct 10, 2026).
// A Netlify BACKGROUND function (the "-background" name does it): it may run up to 15 minutes,
// so Claude can study the photo carefully at full effort instead of rushing to beat Netlify's
// 30-second limit. The finished answer is saved where photo-job.mjs can hand it to the app.
// Uses the same ANTHROPIC_API_KEY environment variable as claude-analyze.js.
import { getStore } from '@netlify/blobs';
import usage from '../lib/usage.js';

const API_URL = process.env.GCC_TEST_API_URL || 'https://api.anthropic.com/v1/messages';

export default async (req) => {
  const store = getStore({ name: 'gcc-photo-reads', consistency: 'strong' });
  let jobId = '';
  try { jobId = (await req.json()).jobId || ''; } catch (e) {}
  if (!/^[a-z0-9-]{8,60}$/i.test(jobId)) return;
  const done = (obj) => store.setJSON('result-' + jobId, obj);
  if (await store.get('result-' + jobId)) return; // already finished (Netlify retried us)

  const job = await store.get('job-' + jobId, { type: 'json' });
  if (!job) return done({ status: 'error', error: 'Grandpa lost track of that picture. Please try again.' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return done({ status: 'error', error: 'This server is missing its Anthropic key (ANTHROPIC_API_KEY in Netlify).' });

  const extras = Array.isArray(job.extraImages) ? job.extraImages : [];
  const content = [];
  if (extras.length) content.push({ type: 'text', text: 'IMAGE 1:' });
  content.push({ type: 'image', source: { type: 'base64', media_type: job.imageMime, data: job.imageBase64 } });
  extras.forEach((x, i) => {
    content.push({ type: 'text', text: 'IMAGE ' + (i + 2) + ':' });
    content.push({ type: 'image', source: { type: 'base64', media_type: x.mime || 'image/jpeg', data: x.data } });
  });
  content.push({ type: 'text', text: job.prompt });
  const messages = [{ role: 'user', content }];
  const call = (body) => fetch(API_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  try {
    // build 153: Donald wants the board read as accurately as possible, so photos go to the strongest
    // model at high effort (slower and costs a little more). If that model is unavailable on this
    // account, fall back to the earlier Sonnet medium-effort reading so a picture is never lost.
    const strong = process.env.GCC_PHOTO_MODEL || 'claude-opus-5-5';
    let resp = await call({ model: strong, max_tokens: 32000, messages, output_config: { effort: 'high' } });
    if (resp.status === 400) {
      const peek = await resp.clone().text().catch(() => '');
      if (/output_config|effort/i.test(peek)) resp = await call({ model: strong, max_tokens: 32000, messages });
    }
    if (resp.status === 400 || resp.status === 404 || resp.status === 403 || resp.status === 529 || resp.status === 500) {
      resp = await call({ model: 'claude-sonnet-5', max_tokens: 16000, messages, output_config: { effort: 'medium' } });
      if (resp.status === 400) {
        const peek = await resp.clone().text().catch(() => '');
        if (/output_config|effort/i.test(peek)) resp = await call({ model: 'claude-sonnet-5', max_tokens: 16000, messages });
      }
    }
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      let msg = 'Claude request failed (HTTP ' + resp.status + ').';
      if (resp.status === 401) msg = 'Anthropic rejected the API key stored in ANTHROPIC_API_KEY.';
      if (resp.status === 429) msg = 'Grandpa is busy — please try the picture again in a moment.';
      if (/credit/i.test(t)) msg = 'Your Anthropic account may need billing credit added at console.anthropic.com.';
      return done({ status: 'error', error: msg });
    }
    const data = await resp.json();
    // build 154: count what this board reading cost (real token counts from Anthropic).
    const usedModel = data.model && /sonnet/.test(data.model) ? 'claude-sonnet-5' : (data.model && /opus/.test(data.model) ? 'claude-opus-5-5' : strong);
    await usage.record({ kind: extras.length ? 'read-video' : 'read-photo', model: usedModel, usage: data.usage,
      images: 1 + extras.length, cost: usage.anthropicCost(usedModel, data.usage), player: job.player });
    const block = Array.isArray(data.content) ? data.content.find((b) => b && b.type === 'text' && b.text) : null;
    if (!block) return done({ status: 'error', error: 'Grandpa could not make out the board. Please try another picture.' });
    await done({ status: 'done', text: block.text });
  } catch (e) {
    await done({ status: 'error', error: 'Server error: ' + e.message });
  } finally {
    try { await store.delete('job-' + jobId); } catch (e) {}
  }
};
