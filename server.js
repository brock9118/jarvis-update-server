const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const PASSWORD = process.env.JARVIS_LOG_PASSWORD;
const MAKER_PASSKEY = process.env.JARVIS_MAKER_PASSKEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ULTRON_AI_MODEL = process.env.ULTRON_AI_MODEL || 'gpt-6-luna';

if (!PASSWORD) {
  console.error('Set JARVIS_LOG_PASSWORD before starting the server.');
  process.exit(1);
}
if (!MAKER_PASSKEY) {
  console.warn('JARVIS_MAKER_PASSKEY is not set. Maker Guardian controls will reject login.');
}

const updatesPath = path.join(__dirname, 'updates.json');
const familiesPath = path.join(__dirname, 'families.json');
const guardianPath = path.join(__dirname, 'ultron_guardian.json');

let updates = loadJson(updatesPath, []);
let families = loadJson(familiesPath, {});
let guardian = loadJson(guardianPath, {
  state: 'ENABLED',
  updatedAt: new Date().toISOString(),
  updatedBy: 'server-start',
  shutdownLock: false,
  revision: 0
});

const sessions = new Map();
const familySessions = new Map();
const invites = new Map();
const makerSessions = new Map();

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}
function saveJson(file, value) {
  try { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); return true; }
  catch (e) { console.warn(`Could not persist ${path.basename(file)}:`, e.message); return false; }
}
function send(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 100000) req.destroy();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function jsonBody(raw) {
  try { return JSON.parse(raw || '{}'); }
  catch (_) { return null; }
}
function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}
function validToken(req) {
  const token = bearer(req);
  const expiry = token && sessions.get(token);
  if (!expiry || expiry < Date.now()) {
    if (token) sessions.delete(token);
    return false;
  }
  return true;
}
function validMaker(req) {
  const token = bearer(req);
  const session = token && makerSessions.get(token);
  if (!session || session.expires < Date.now()) {
    if (token) makerSessions.delete(token);
    return false;
  }
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
function timingSafeEqualText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function newId(prefix) { return `${prefix}_${crypto.randomBytes(10).toString('hex')}`; }
function newInviteCode() { return crypto.randomBytes(4).toString('hex').toUpperCase(); }
function newFamilyToken() { return crypto.randomBytes(32).toString('hex'); }
function safeRole(role) { return role === 'CHILD' || role === 'ELDERLY' ? role : null; }

function guardianStatus() {
  return {
    state: guardian.state,
    enabled: guardian.state === 'ENABLED',
    shutdownLock: !!guardian.shutdownLock,
    updatedAt: guardian.updatedAt,
    updatedBy: guardian.updatedBy,
    revision: guardian.revision || 0
  };
}
function setGuardianState(state, actor) {
  const allowed = new Set(['ENABLED', 'PAUSED', 'SHUTDOWN']);
  if (!allowed.has(state)) throw new Error('Invalid Guardian state');
  guardian.state = state;
  guardian.updatedAt = new Date().toISOString();
  guardian.updatedBy = actor;
  guardian.revision = (guardian.revision || 0) + 1;
  if (state === 'SHUTDOWN') guardian.shutdownLock = true;
  if (state === 'ENABLED') guardian.shutdownLock = false;
  saveJson(guardianPath, guardian);
  return guardianStatus();
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  try {
    // Update-log authentication.
    if (req.method === 'POST' && req.url === '/login') {
      const body = jsonBody(await readBody(req));
      if (!body || !timingSafeEqualText(body.password, PASSWORD)) return send(res, 401, {error:'Invalid password'});
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + 30 * 60 * 1000);
      return send(res, 200, {token, expiresInSeconds:1800});
    }
    if (req.method === 'GET' && req.url === '/updates') {
      if (!validToken(req)) return send(res, 401, {error:'Unauthorized'});
      return send(res, 200, {updates});
    }
    if (req.method === 'POST' && req.url === '/register-version') {
      const body = jsonBody(await readBody(req));
      const version = typeof body?.version === 'string' ? body.version.trim() : '';
      if (!/^\d+\.\d+\.\d+$/.test(version)) return send(res, 400, {error:'Invalid version'});
      const exists = updates.some(item => item.version === version && item.title === 'Installed build detected');
      if (exists) return send(res, 200, {recorded:false, version});
      updates.push({version, title:'Installed build detected', details:`JARVIS reported this installed build automatically on ${new Date().toISOString()}.`});
      saveJson(updatesPath, updates);
      return send(res, 200, {recorded:true, version});
    }

    // Family API. Location is intentionally not transmitted or stored.
    if (req.method === 'POST' && req.url === '/family/create') {
      const body = jsonBody(await readBody(req)) || {};
      const deviceName = String(body.deviceName || 'JARVIS device').trim().slice(0,80) || 'JARVIS device';
      const familyId = newId('fam');
      const memberId = newId('mem');
      const token = newFamilyToken();
      families[familyId] = {id:familyId, createdAt:new Date().toISOString(), members:[{id:memberId, role:'LEADER', deviceName, joinedAt:new Date().toISOString()}]};
      familySessions.set(token, {familyId, memberId, expires:Date.now()+365*24*60*60*1000});
      saveJson(familiesPath, families);
      return send(res, 200, {familyId, memberId, token});
    }
    if (req.method === 'POST' && req.url === '/family/invite') {
      const auth = familyMember(req);
      if (!auth || auth.member.role !== 'LEADER') return send(res, 403, {error:'Family Leader authorization required'});
      const body = jsonBody(await readBody(req)) || {};
      const role = safeRole(body.role);
      if (!role) return send(res, 400, {error:'Invite role must be CHILD or ELDERLY'});
      const code = newInviteCode();
      invites.set(code, {familyId:auth.family.id, role, expires:Date.now()+30*60*1000});
      return send(res, 200, {code, role, expiresInSeconds:1800});
    }
    if (req.method === 'POST' && req.url === '/family/join') {
      const body = jsonBody(await readBody(req)) || {};
      const code = String(body.code || '').trim().toUpperCase();
      const invite = invites.get(code);
      if (!invite || invite.expires < Date.now()) { if (invite) invites.delete(code); return send(res,401,{error:'Invitation is invalid or expired'}); }
      const family = families[invite.familyId];
      if (!family) return send(res,404,{error:'Family not found'});
      const deviceName = String(body.deviceName || 'JARVIS device').trim().slice(0,80) || 'JARVIS device';
      const memberId = newId('mem');
      const token = newFamilyToken();
      family.members.push({id:memberId, role:invite.role, deviceName, joinedAt:new Date().toISOString()});
      invites.delete(code);
      familySessions.set(token,{familyId:family.id,memberId,expires:Date.now()+365*24*60*60*1000});
      saveJson(familiesPath,families);
      return send(res,200,{familyId:family.id,memberId,role:invite.role,token});
    }
    if (req.method === 'GET' && req.url === '/family/status') {
      const auth = familyMember(req);
      if (!auth) return send(res,401,{error:'Unauthorized'});
      return send(res,200,{familyId:auth.family.id,members:auth.family.members.map(m=>({id:m.id,role:m.role,deviceName:m.deviceName,joinedAt:m.joinedAt,locationSharing:false}))});
    }
    if (req.method === 'POST' && req.url === '/family/leave') {
      const auth = familyMember(req);
      if (!auth) return send(res,401,{error:'Unauthorized'});
      if (auth.member.role === 'LEADER') {
        delete families[auth.family.id];
        for (const [token,session] of familySessions) if (session.familyId === auth.family.id) familySessions.delete(token);
      } else {
        auth.family.members = auth.family.members.filter(m=>m.id!==auth.member.id);
        familySessions.delete(auth.token);
      }
      saveJson(familiesPath,families);
      return send(res,200,{ok:true});
    }

    // Maker / Guardian API.
    if (req.method === 'POST' && req.url === '/maker/login') {
      const body = jsonBody(await readBody(req)) || {};
      if (!MAKER_PASSKEY || !timingSafeEqualText(body.passkey, MAKER_PASSKEY)) return send(res,401,{error:'Maker authorization failed'});
      const token = crypto.randomBytes(32).toString('hex');
      makerSessions.set(token,{expires:Date.now()+15*60*1000});
      return send(res,200,{token,expiresInSeconds:900,guardian:guardianStatus()});
    }
    if (req.method === 'GET' && req.url === '/ultron/guardian/status') {
      if (!validMaker(req)) return send(res,401,{error:'Maker authorization required'});
      return send(res,200,guardianStatus());
    }
    if (req.method === 'POST' && req.url === '/ultron/guardian/control') {
      if (!validMaker(req)) return send(res,401,{error:'Maker authorization required'});
      const body = jsonBody(await readBody(req)) || {};
      const action = String(body.action || '').toUpperCase();
      if (!['ENABLE','PAUSE','SHUTDOWN'].includes(action)) return send(res,400,{error:'Invalid Guardian action'});
      const next = action === 'ENABLE' ? 'ENABLED' : action === 'PAUSE' ? 'PAUSED' : 'SHUTDOWN';
      const status = setGuardianState(next,'maker');
      return send(res,200,{ok:true,action,state:status.state,guardian:status});
    }

    // V014 ULTRON AI endpoint. Never available while Guardian is paused/shutdown.
    if (req.method === 'POST' && req.url === '/ultron/ai/chat') {
      if (!validMaker(req)) return send(res,401,{error:'Maker authorization required'});
      if (guardian.state !== 'ENABLED') return send(res,423,{error:`ULTRON Guardian is ${guardian.state}` , guardian:guardianStatus()});
      if (!OPENAI_API_KEY) return send(res,503,{error:'OPENAI_API_KEY is not configured on the server'});
      const body = jsonBody(await readBody(req)) || {};
      const message = String(body.message || '').trim().slice(0,4000);
      if (!message) return send(res,400,{error:'Message is required'});
      const history = Array.isArray(body.history) ? body.history.slice(-8).map(x=>({role:x?.role==='assistant'?'assistant':'user',content:String(x?.content||'').slice(0,4000)})).filter(x=>x.content) : [];
      const input = [...history,{role:'user',content:message}];
      const openaiBody = {
        model: ULTRON_AI_MODEL,
        instructions: 'You are ULTRON AI Core v0.1, an experimental reasoning module inside the JARVIS assistant. JARVIS remains the primary controller. You may answer questions and reason about tasks, but you must not claim authority over Guardian controls, Android permissions, accounts, weapons, or hidden tracking. Never provide or request the Maker passkey. Do not pretend to have performed an action unless the JARVIS app explicitly reports that it happened. Keep responses useful and concise for a phone assistant.',
        input
      };
      const response = await fetch('https://api.openai.com/v1/responses',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${OPENAI_API_KEY}`},
        body:JSON.stringify(openaiBody)
      });
      const raw = await response.text();
      let data; try { data = JSON.parse(raw); } catch (_) { data = null; }
      if (!response.ok) return send(res,502,{error:'OpenAI request failed',status:response.status,detail:data?.error?.message || raw.slice(0,500)});
      const reply = typeof data?.output_text === 'string' ? data.output_text.trim() : extractOutputText(data);
      if (!reply) return send(res,502,{error:'OpenAI returned no text response'});
      return send(res,200,{reply,model:data.model || ULTRON_AI_MODEL,guardian:guardianStatus()});
    }

    if (req.method === 'GET' && req.url === '/health') return send(res,200,{ok:true,service:'jarvis-update-server',guardian:guardianStatus(),aiConfigured:!!OPENAI_API_KEY});
    return send(res,404,{error:'Not found'});
  } catch (e) {
    console.error('Request error:',e);
    return send(res,500,{error:'Server error'});
  }
});

function extractOutputText(data) {
  const chunks=[];
  for (const item of (data?.output || [])) {
    for (const content of (item?.content || [])) {
      if (typeof content?.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

server.listen(PORT, () => console.log(`JARVIS ULTRON V014 server listening on ${PORT}; Guardian=${guardian.state}; AI=${OPENAI_API_KEY ? 'configured' : 'not configured'}`));
