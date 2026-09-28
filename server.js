#!/usr/bin/env node
/* «Яшил белбоғ» — оддий сервер (ташқи кутубхонасиз, Node.js 18+).
 *  - index.html ва ёнидаги статик файлларни беради
 *  - /api/om/forecast ва /api/om/air — Open-Meteo'га прокси + кеш:
 *    бир вақтда 100 киши кирса ҳам Open-Meteo'га 10 дақиқада фақат битта сўров кетади
 *  - /healthz — сервер ишлаётганини текшириш
 *
 *  Ишга тушириш:  PORT=5174 node server.js
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = +process.env.PORT || 5174;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.resolve(process.env.ROOT || __dirname);
const CACHE_MS = (+process.env.CACHE_MIN || 10) * 60000;
const UPSTREAM = {
  forecast: process.env.OM_FORECAST_URL || 'https://api.open-meteo.com/v1/forecast',
  air: process.env.OM_AIR_URL || 'https://air-quality-api.open-meteo.com/v1/air-quality'
};
// Мижоз юбориши мумкин бўлган параметрлар (бошқаси рад этилади)
const ALLOWED = new Set(['latitude', 'longitude', 'current', 'hourly', 'daily', 'past_days', 'forecast_days',
  'timezone', 'wind_speed_unit', 'temperature_unit', 'precipitation_unit', 'domains']);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
const PUBLIC_EXT = new Set(Object.keys(TYPES));
const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' };

const cache = new Map();      // калит → { at, status, body }
const inflight = new Map();   // бир хил сўровлар бир вақтда келса — битта upstream сўров

function log(...a) { console.log(new Date().toISOString(), ...a); }

function send(req, res, status, body, headers = {}) {
  const h = { ...SECURITY, ...headers };
  const text = /^(text|application\/json|image\/svg)/.test(h['Content-Type'] || '');
  if (text && body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    body = zlib.gzipSync(body); h['Content-Encoding'] = 'gzip'; h['Vary'] = 'Accept-Encoding';
  }
  h['Content-Length'] = body.length;
  res.writeHead(status, h);
  res.end(req.method === 'HEAD' ? undefined : body);
}
const sendJSON = (req, res, status, obj, extra = {}) =>
  send(req, res, status, Buffer.from(JSON.stringify(obj)), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });

function cleanQuery(search) {
  const inp = new URLSearchParams(search), out = new URLSearchParams();
  for (const [k, v] of inp) {
    if (!ALLOWED.has(k)) throw new Error('рухсат этилмаган параметр: ' + k);
    if (v.length > 600) throw new Error('параметр жуда узун: ' + k);
    out.append(k, v);
  }
  if (!out.get('latitude') || !out.get('longitude')) throw new Error('latitude ва longitude керак');
  return out.toString();
}

async function upstream(kind, qs) {
  const key = kind + '?' + qs;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit, cached: true };
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(UPSTREAM[kind] + '?' + qs, { signal: ctl.signal, headers: { 'User-Agent': 'yashil-belbog/1.0' } });
      const body = Buffer.from(await r.arrayBuffer());
      const entry = { at: Date.now(), status: r.status, body };
      if (r.ok) {
        cache.set(key, entry);
        if (cache.size > 200) cache.delete(cache.keys().next().value);
      } else log('upstream', kind, r.status);
      return entry;
    } catch (e) {
      // Open-Meteo вақтинча жавоб бермаса — эскирган кешни бериш, бўш жавобдан яхши
      if (hit) { log('upstream failed, serving stale', kind, e.message); return { ...hit, stale: true }; }
      throw e;
    } finally { clearTimeout(to); inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

async function handleApi(req, res, url) {
  const kind = url.pathname.slice('/api/om/'.length);
  if (!UPSTREAM[kind]) return sendJSON(req, res, 404, { error: true, reason: 'номаълум манба' });
  let qs;
  try { qs = cleanQuery(url.search); } catch (e) { return sendJSON(req, res, 400, { error: true, reason: e.message }); }
  try {
    const r = await upstream(kind, qs);
    return send(req, res, r.status, r.body, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Cache': r.stale ? 'STALE' : r.cached ? 'HIT' : 'MISS'
    });
  } catch (e) {
    log('upstream error', kind, e.message);
    return sendJSON(req, res, 502, { error: true, reason: 'Open-Meteo жавоб бермади: ' + (e.name === 'AbortError' ? 'вақт тугади' : e.message) });
  }
}

function handleStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return send(req, res, 400, Buffer.from('Bad request'), { 'Content-Type': 'text/plain' }); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, '.' + rel);
  const ext = path.extname(file).toLowerCase();
  // фақат ROOT ичидаги, рухсат этилган турдаги файллар; яширин файллар ва server.js берилмайди
  if (!file.startsWith(ROOT + path.sep) || !PUBLIC_EXT.has(ext) || rel.split('/').some(p => p.startsWith('.')) || file === __filename) {
    return send(req, res, 404, Buffer.from('Not found'), { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  fs.readFile(file, (err, data) => {
    if (err) return send(req, res, 404, Buffer.from('Not found'), { 'Content-Type': 'text/plain; charset=utf-8' });
    // платформага «прокси бор» деб белгилаш: мижоз Open-Meteo'га шу сервер орқали мурожаат қилади
    if (ext === '.html') data = Buffer.from(data.toString('utf8').replace(/<head>/i, '<head>\n<meta name="yb-proxy" content="1">'));
    send(req, res, 200, data, { 'Content-Type': TYPES[ext], 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400' });
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, Buffer.from('Method not allowed'), { 'Content-Type': 'text/plain', Allow: 'GET, HEAD' });
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return send(req, res, 400, Buffer.from('Bad request'), { 'Content-Type': 'text/plain' }); }
  if (url.pathname === '/healthz') return sendJSON(req, res, 200, { ok: true, uptime: Math.round(process.uptime()), cache: cache.size });
  if (url.pathname.startsWith('/api/om/')) return handleApi(req, res, url);
  return handleStatic(req, res, url);
});

if (typeof fetch !== 'function') { console.error('Node.js 18 ёки янгироқ версия керак (ҳозир: ' + process.version + ')'); process.exit(1); }
server.listen(PORT, HOST, () => log(`«Яшил белбоғ» ишламоқда: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (папка: ${ROOT})`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { log('тўхтатилмоқда…'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
