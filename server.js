const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const PASSWORD = process.env.JARVIS_LOG_PASSWORD;
const MAKER_PASSKEY = process.env.JARVIS_MAKER_PASSKEY;
if (!PASSWORD || !MAKER_PASSKEY) {
  console.error('Set JARVIS_LOG_PASSWORD before starting the server.');
  process.exit(1);
}

const updatesPath = path.join(__dirname, 'updates.json');
const familiesPath = path.join(__dirname, 'families.json');
let updates = JSON.parse(fs.readFileSync(updatesPath, 'utf8'));
let families = fs.existsSync(familiesPath) ? JSON.parse(fs.readFileSync(familiesPath, 'utf8')) : {};
const sessions = new Map();
const familySessions = new Map();
const invites = new Map();
const guardianPath = path.join(__dirname, 'ultron_guardian.json');
let guardian = fs.existsSync(guardianPath) ? JSON.parse(fs.readFileSync(guardianPath, 'utf8')) : {state:'ENABLED', updatedAt:null, reason:'default'};
const makerSessions = new Map();

function saveFamilies() {
  try { fs.writeFileSync(familiesPath, JSON.stringify(families, null, 2) + '\n'); }
  catch (e) { console.warn('Could not persist family data:', e.message); }
}
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
function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}
function validToken(req) {
  const token = bearer(req);
  const expiry = token && sessions.get(token);
  if (!expiry || expiry < Date.now()) { if (token) sessions.delete(token); return false; }
  return true;
}
function familyMember(req) {
  const token = bearer(req);
  const session = token && familySessions.get(token);
  if (!session || session.expires < Date.now()) {
    if (token) familySessions.delete(token);
    return null;
  }
  const family = families[session.familyId];
  const member = family && family.members.find(m => m.id === session.memberId);
  return family && member ? { token, session, family, member } : null;
}
function newId(prefix) { return `${prefix}_${crypto.randomBytes(10).toString('hex')}`; }
function newInviteCode() { return crypto.randomBytes(4).toString('hex').toUpperCase(); }
function newFamilyToken() { return crypto.randomBytes(32).toString('hex'); }
function saveGuardian() { try { fs.writeFileSync(guardianPath, JSON.stringify(guardian, null, 2) + '\n'); } catch (e) { console.warn('Could not persist Guardian state:', e.message); } }
function validMaker(req) { const token = bearer(req); const expiry = token && makerSessions.get(token); if (!expiry || expiry < Date.now()) { if (token) makerSessions.delete(token); return false; } return true; }
function safeRole(role) { return role === 'CHILD' || role === 'ELDERLY' ? role : null; }

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}); return res.end();
  }
  try {
    // Existing password-protected update log API.
    if (req.method === 'POST' && req.url === '/login') {
      const body = JSON.parse(await readBody(req));
      if (typeof body.password !== 'string') return send(res, 401, {error:'Invalid password'});
      const a = Buffer.from(body.password); const b = Buffer.from(PASSWORD);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(res, 401, {error:'Invalid password'});
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + 30 * 60 * 1000);
      return send(res, 200, {token, expiresInSeconds:1800});
    }
    if (req.method === 'POST' && req.url === '/register-version') {
      const body = JSON.parse(await readBody(req));
      const version = typeof body.version === 'string' ? body.version.trim() : '';
      if (!/^\d+\.\d+\.\d+$/.test(version)) return send(res, 400, {error:'Invalid version'});
      const exists = updates.some(item => item.version === version && item.title === 'Installed build detected');
      if (exists) return send(res, 200, {recorded:false, version});
      updates.push({version, title:'Installed build detected', details:`JARVIS reported this installed build automatically on ${new Date().toISOString()}.`});
      try { fs.writeFileSync(updatesPath, JSON.stringify(updates, null, 2) + '\n'); } catch (e) { console.warn('Could not persist update history:', e.message); }
      return send(res, 200, {recorded:true, version});
    }
    if (req.method === 'GET' && req.url === '/updates') {
      if (!validToken(req)) return send(res, 401, {error:'Unauthorized'});
      return send(res, 200, {updates});
    }

    // Maker-only ULTRON Guardian. The Maker passkey is never sent to or stored in the APK.
    if (req.method === 'POST' && req.url === '/maker/login') {
      const body = JSON.parse(await readBody(req));
      const supplied = Buffer.from(String(body.passkey || '')); const expected = Buffer.from(MAKER_PASSKEY);
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return send(res, 401, {error:'Maker authorization failed'});
      const token = crypto.randomBytes(32).toString('hex'); makerSessions.set(token, Date.now() + 15 * 60 * 1000);
      return send(res, 200, {token, expiresInSeconds:900});
    }
    if (req.method === 'GET' && req.url === '/ultron/guardian/status') {
      return send(res, 200, {state: guardian.state, updatedAt: guardian.updatedAt, reason: guardian.reason});
    }
    if (req.method === 'POST' && req.url === '/ultron/guardian/control') {
      if (!validMaker(req)) return send(res, 401, {error:'Maker authorization required'});
      const body = JSON.parse(await readBody(req)); const action = String(body.action || '').toUpperCase();
      const allowed = new Set(['PAUSE','SHUTDOWN','ENABLE']); if (!allowed.has(action)) return send(res, 400, {error:'Invalid Guardian action'});
      guardian = {state: action === 'ENABLE' ? 'ENABLED' : action, updatedAt:new Date().toISOString(), reason: action === 'SHUTDOWN' ? 'Maker emergency shutdown' : 'Maker control'};
      saveGuardian();
      return send(res, 200, {ok:true, ...guardian});
    }

    // V008 family API. Location is intentionally not transmitted or stored.
    if (req.method === 'POST' && req.url === '/family/create') {
      const body = JSON.parse(await readBody(req));
      const deviceName = String(body.deviceName || 'JARVIS device').trim().slice(0, 80) || 'JARVIS device';
      const familyId = newId('fam');
      const memberId = newId('mem');
      const token = newFamilyToken();
      families[familyId] = {
        id: familyId,
        createdAt: new Date().toISOString(),
        members: [{ id: memberId, role: 'LEADER', deviceName, joinedAt: new Date().toISOString() }]
      };
      familySessions.set(token, {familyId, memberId, expires: Date.now() + 365 * 24 * 60 * 60 * 1000});
      saveFamilies();
      return send(res, 200, {familyId, memberId, token});
    }
    if (req.method === 'POST' && req.url === '/family/invite') {
      const auth = familyMember(req);
      if (!auth || auth.member.role !== 'LEADER') return send(res, 403, {error:'Family Leader authorization required'});
      const body = JSON.parse(await readBody(req));
      const role = safeRole(body.role);
      if (!role) return send(res, 400, {error:'Invite role must be CHILD or ELDERLY'});
      const code = newInviteCode();
      invites.set(code, {familyId: auth.family.id, role, expires: Date.now() + 30 * 60 * 1000});
      return send(res, 200, {code, role, expiresInSeconds:1800});
    }
    if (req.method === 'POST' && req.url === '/family/join') {
      const body = JSON.parse(await readBody(req));
      const code = String(body.code || '').trim().toUpperCase();
      const invite = invites.get(code);
      if (!invite || invite.expires < Date.now()) { if (invite) invites.delete(code); return send(res, 401, {error:'Invitation is invalid or expired'}); }
      const family = families[invite.familyId];
      if (!family) return send(res, 404, {error:'Family not found'});
      const deviceName = String(body.deviceName || 'JARVIS device').trim().slice(0, 80) || 'JARVIS device';
      const memberId = newId('mem');
      const token = newFamilyToken();
      family.members.push({id: memberId, role: invite.role, deviceName, joinedAt: new Date().toISOString()});
      invites.delete(code); // one-time invite
      familySessions.set(token, {familyId: family.id, memberId, expires: Date.now() + 365 * 24 * 60 * 60 * 1000});
      saveFamilies();
      return send(res, 200, {familyId: family.id, memberId, role: invite.role, token});
    }
    if (req.method === 'GET' && req.url === '/family/status') {
      const auth = familyMember(req);
      if (!auth) return send(res, 401, {error:'Unauthorized'});
      return send(res, 200, {
        familyId: auth.family.id,
        members: auth.family.members.map(m => ({id:m.id, role:m.role, deviceName:m.deviceName, joinedAt:m.joinedAt, locationSharing:false}))
      });
    }
    if (req.method === 'POST' && req.url === '/family/leave') {
      const auth = familyMember(req);
      if (!auth) return send(res, 401, {error:'Unauthorized'});
      if (auth.member.role === 'LEADER') {
        delete families[auth.family.id];
        for (const [token, session] of familySessions) if (session.familyId === auth.family.id) familySessions.delete(token);
      } else {
        auth.family.members = auth.family.members.filter(m => m.id !== auth.member.id);
        familySessions.delete(auth.token);
      }
      saveFamilies();
      return send(res, 200, {ok:true});
    }

    send(res, 404, {error:'Not found'});
  } catch (e) { send(res, 400, {error:'Bad request'}); }
});
server.listen(PORT, () => console.log(`JARVIS update-log/family server listening on ${PORT}`));
