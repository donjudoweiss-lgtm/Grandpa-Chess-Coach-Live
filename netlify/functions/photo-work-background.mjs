// Grandpa Chess Coach — photo reading, step 2 of 2 (added Oct 10, 2026).
// A Netlify BACKGROUND function (the "-background" name does it): it may run up to 15 minutes,
// so Claude can study the photo carefully at full effort instead of rushing to beat Netlify's
// 30-second limit. The finished answer is saved where photo-job.mjs can hand it to the app.
// Uses the same ANTHROPIC_API_KEY environment variable as claude-analyze.js.
import { getStore } from '@netlify/blobs';

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

  const messages = [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: job.imageMime, data: job.imageBase64 } },
    { type: 'text', text: job.prompt }
  ] }];
  const call = (body) => fetch(API_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  try {
    // Full-effort look — this is how Grandpa read photos before the Oct 7 speed change.
    let resp = await call({ model: 'claude-sonnet-5', max_tokens: 16000, messages, output_config: { effort: 'high' } });
    if (resp.status === 400) {
      const peek = await resp.clone().text().catch(() => '');
      if (/output_config|effort/i.test(peek)) resp = await call({ model: 'claude-sonnet-5', max_tokens: 16000, messages });
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
    const block = Array.isArray(data.content) ? data.content.find((b) => b && b.type === 'text' && b.text) : null;
    if (!block) return done({ status: 'error', error: 'Grandpa could not make out the board. Please try another picture.' });
    await done({ status: 'done', text: block.text });
  } catch (e) {
    await done({ status: 'error', error: 'Server error: ' + e.message });
  } finally {
    try { await store.delete('job-' + jobId); } catch (e) {}
  }
};
