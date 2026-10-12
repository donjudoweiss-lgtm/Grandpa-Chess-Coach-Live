// Grandpa Chess Coach — what it costs, per player (build 154, Oct 12 2026).
// Open  /.netlify/functions/usage-report          → a plain page for Donald (last 7 days)
//       /.netlify/functions/usage-report?days=30  → last 30 days
//       add &format=json                            → the same numbers as data (for the morning report)
// If the Netlify environment variable GCC_REPORT_KEY is set, the address must also include &key=<that value>.
import { getStore } from '@netlify/blobs';
import usage from '../lib/usage.js';

const KIND_LABEL = { 'read-video': 'board readings (video)', 'read-photo': 'board readings (photo)', 'read-quick': 'quick photo readings', coach: 'coaching answers', voice: 'spoken sentences' };
const money = (x) => '$' + (x || 0).toFixed(2);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default async (req) => {
  const url = new URL(req.url);
  const need = process.env.GCC_REPORT_KEY;
  if (need && url.searchParams.get('key') !== need) return new Response('Not allowed.', { status: 403 });
  const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days') || '7', 10) || 7));
  const store = getStore('gcc-usage');
  const now = Date.now();
  const dayList = [];
  for (let i = days - 1; i >= 0; i--) dayList.push(usage.nyDay(new Date(now - i * 86400000)));

  const players = {}; const byDay = {}; const total = { cost: 0, n: 0 };
  for (const day of dayList) {
    byDay[day] = { cost: 0, n: 0 };
    let blobs = [];
    try { blobs = (await store.list({ prefix: 'ev/' + day + '/' })).blobs || []; } catch (e) {}
    const evs = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' }).catch(() => null)));
    for (const e of evs) {
      if (!e) continue;
      const p = players[e.player] || (players[e.player] = { id: e.player, name: '', cost: 0, kinds: {}, chars: 0, first: e.at, last: e.at, days: new Set() });
      if (e.name) p.name = e.name;
      p.cost += e.cost || 0; p.chars += e.chars || 0; p.kinds[e.kind] = (p.kinds[e.kind] || 0) + 1;
      p.kindCost = p.kindCost || {}; p.kindCost[e.kind] = (p.kindCost[e.kind] || 0) + (e.cost || 0);
      if (e.at < p.first) p.first = e.at; if (e.at > p.last) p.last = e.at; p.days.add(day);
      byDay[day].cost += e.cost || 0; byDay[day].n++; total.cost += e.cost || 0; total.n++;
    }
  }
  const list = Object.values(players).sort((a, b) => b.cost - a.cost).map((p) => ({
    id: p.id, name: p.name || '(no name yet)', cost: +p.cost.toFixed(4), activeDays: p.days.size,
    perMonthIfLikeThis: +(p.cost / days * 30).toFixed(2), counts: p.kinds,
    costByKind: Object.fromEntries(Object.entries(p.kindCost || {}).map(([k, v]) => [k, +v.toFixed(4)])), voiceChars: p.chars
  }));
  const out = { days, from: dayList[0], to: dayList[dayList.length - 1], totalCost: +total.cost.toFixed(4), events: total.n,
    averagePerPlayer: list.length ? +(total.cost / list.length).toFixed(4) : 0, players: list,
    byDay: Object.fromEntries(Object.entries(byDay).map(([d, v]) => [d, { cost: +v.cost.toFixed(4), events: v.n }])),
    note: 'Anthropic costs use the real token counts on each answer. Voice cost is an estimate from the ElevenLabs plan price. Website, domain and Stripe fees are not included.' };
  if (url.searchParams.get('format') === 'json') return Response.json(out, { headers: { 'Cache-Control': 'no-store' } });

  const rows = list.map((p) => `<tr><td>${esc(p.name)}</td><td>${Object.entries(p.counts).map(([k, n]) => `${n} ${esc(KIND_LABEL[k] || k)} (${money(p.costByKind[k])})`).join('<br>')}</td><td><b>${money(p.cost)}</b></td><td>${money(p.perMonthIfLikeThis)}</td></tr>`).join('') || '<tr><td colspan="4">Nothing recorded yet. Play a game on the Test site, then reload this page.</td></tr>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>What Grandpa costs</title>
<style>body{font-family:Georgia,serif;background:#F8F4EA;color:#231A10;margin:0;padding:16px;font-size:18px}h1{color:#2F5233;font-size:26px;margin:0 0 6px}p{line-height:1.45}
table{border-collapse:collapse;width:100%;background:#fff;border:2px solid #C9A227}td,th{border-bottom:1px solid #e4d9bd;padding:10px;text-align:left;vertical-align:top}th{background:#2F5233;color:#fff}
.big{font-size:28px;color:#2F5233;font-weight:bold}.box{background:#fff;border:2px solid #C9A227;border-radius:12px;padding:12px 14px;margin:12px 0}</style></head><body>
<h1>What Grandpa costs to run</h1><p>${esc(out.from)} to ${esc(out.to)} (${days} days) · <a href="?days=7">7 days</a> · <a href="?days=30">30 days</a></p>
<div class="box">Total: <span class="big">${money(out.totalCost)}</span> for ${list.length} player${list.length === 1 ? '' : 's'} · average <b>${money(out.averagePerPlayer)}</b> per player</div>
<table><tr><th>Player</th><th>What Grandpa did</th><th>Cost</th><th>Per month at this pace</th></tr>${rows}</table>
<p style="font-size:15px">${esc(out.note)}</p></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
};
