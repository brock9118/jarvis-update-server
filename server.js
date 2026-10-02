const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const PASSWORD = process.env.JARVIS_LOG_PASSWORD;
if (!PASSWORD) {
  console.error('Set JARVIS_LOG_PASSWORD before starting the server.');
  process.exit(1);
}

const updates = JSON.parse(fs.readFileSync(path.join(__dirname, 'updates.json'), 'utf8'));
const sessions = new Map();

function send(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 10000) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function validToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return false;
  const token = header.slice(7);
  const expiry = sessions.get(token);
  if (!expiry || expiry < Date.now()) { sessions.delete(token); return false; }
  return true;
}
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}); return res.end();
  }
  try {
    if (req.method === 'POST' && req.url === '/login') {
      const body = JSON.parse(await readBody(req));
      if (typeof body.password !== 'string') return send(res, 401, {error:'Invalid password'});
      const a = Buffer.from(body.password); const b = Buffer.from(PASSWORD);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(res, 401, {error:'Invalid password'});
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + 30 * 60 * 1000);
      return send(res, 200, {token, expiresInSeconds:1800});
    }
    if (req.method === 'GET' && req.url === '/updates') {
      if (!validToken(req)) return send(res, 401, {error:'Unauthorized'});
      return send(res, 200, {updates});
    }
    send(res, 404, {error:'Not found'});
  } catch (e) { send(res, 400, {error:'Bad request'}); }
});
server.listen(PORT, () => console.log(`JARVIS update-log server listening on ${PORT}`));
