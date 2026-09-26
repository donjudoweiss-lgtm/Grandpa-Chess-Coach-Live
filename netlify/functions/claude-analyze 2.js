// Grandpa Chess Coach — Claude relay (vision + analysis)
// This runs on Netlify's servers, not in the browser, so it works on the real website
// the same way the "Ask Claude" feature works inside a Claude.ai page.
// It needs one thing set up in Netlify: an environment variable named
// ANTHROPIC_API_KEY holding Don's Anthropic API key. The key never appears
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'This server is missing its Anthropic key. In Netlify, go to Site configuration → Environment variables and add ANTHROPIC_API_KEY.' })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bad request body.' }) };
  }

  const prompt = payload.prompt;
  const imageBase64 = payload.imageBase64;
  const imageMime = payload.imageMime || 'image/jpeg';
  const chatMessages = payload.messages;

  let messages;
  if (Array.isArray(chatMessages) && chatMessages.length) {
    // Multi-turn chat: [{role,content},...] sent straight through, same shape the app already builds.
    messages = chatMessages.map(function (m) {
      return { role: m.role, content: m.content };
    });
  } else if (prompt) {
    const contentBlocks = [];
    if (imageBase64) {
      contentBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: imageMime, data: imageBase64 }
      });
    }
    contentBlocks.push({ type: 'text', text: prompt });
    messages = [{ role: 'user', content: contentBlocks }];
  } else {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing prompt or messages.' }) };
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        messages: messages
      })
    });

    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => '');
      let msg = 'Claude request failed (HTTP ' + resp.status + ').';
      if (resp.status === 401) msg = 'Anthropic rejected the API key stored in this site’s ANTHROPIC_API_KEY — it may be wrong or expired.';
      if (resp.status === 429) msg = 'Anthropic rate-limited this request — try again in a moment.';
      if (resp.status === 400 && /credit/i.test(bodyText)) msg = 'Your Anthropic account may need billing credit added at console.anthropic.com.';
      return { statusCode: 502, headers, body: JSON.stringify({ error: msg + ' ' + bodyText.slice(0, 300) }) };
    }

    const data = await resp.json();
    // Claude can return several content blocks (e.g. a "thinking" block followed by a
    // "text" block) — grab the first one that actually has text, not just content[0].
    let text = '';
    if (Array.isArray(data.content)) {
      const textBlock = data.content.find(function (b) { return b && b.type === 'text' && b.text; });
      if (textBlock) text = textBlock.text;
    }
    if (!text) {
      // Nothing usable came back — include why, so the app can show something useful
      // instead of a bare "(empty response)".
      return {
        statusCode: 200,
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
        body: JSON.stringify({
          text: '',
          debug: 'stop_reason=' + (data.stop_reason || '?') + ' content_types=' + (Array.isArray(data.content) ? data.content.map(function (b) { return b && b.type; }).join(',') : typeof data.content)
        })
      };
    }

    return {
      statusCode: 200,
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify({ text: text })
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error: ' + e.message }) };
  }
};
