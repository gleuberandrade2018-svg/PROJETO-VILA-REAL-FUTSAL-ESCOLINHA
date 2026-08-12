const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const INDEX_FILE = path.join(ROOT, 'index_corrigido.html');
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SSL_KEY = process.env.SSL_KEY_FILE;
const SSL_CERT = process.env.SSL_CERT_FILE;
const sessions = new Map();
const clients = new Set();

fs.mkdirSync(DATA_DIR, { recursive: true });

const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD || 'Opala77@2056';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt:')) return false;
  const [, salt, expected] = stored.split(':');
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
function publicUser(u) {
  if (!u) return null;
  const { senha, senhaHash, senhaInicial, ...safe } = u;
  return safe;
}
function sanitizeState(state) {
  return {
    ...state,
    usuarios: (state.usuarios || []).map(publicUser)
  };
}
function defaultState() {
  return {
    usuarios: [{
      id: 'admin', nome: 'Gleuber Andrade', email: 'gleuber.andrade@outlook.com', perfil: 'Administrador',
      usuario: 'gleuber', senhaHash: hashPassword(ADMIN_DEFAULT_PASSWORD), primeiroAcesso: false,
      permissoes: { alunos:true, presencas:true, carteirinhas:true, relatorios:true, notificacoes:true, backup:true, configuracoes:true, usuarios:true, excluirAlunos:true }
    }],
    alunos: [], presencas: [], notificacoes: [], whatsappMessages: [],
    config: {
      categorias:[{nome:'Sub-8',idadeMin:6,idadeMax:7},{nome:'Sub-10',idadeMin:8,idadeMax:9},{nome:'Sub-12',idadeMin:10,idadeMax:11},{nome:'Sub-14',idadeMin:12,idadeMax:13},{nome:'Sub-16',idadeMin:14,idadeMax:15},{nome:'Sub-18',idadeMin:16,idadeMax:17}],
      horariosCategoria:{}, diasTreino:'Segunda, Terça, Quarta, Quinta, Sexta', notifAutomatica:true,
      mensagemPadrao:'Prezado(a) responsável, seu filho(a) esteve presente no treino do Vila Real Futsal hoje!',
      senhaMaster:'', whatsappNumero:'111946359524', loginLogo:'', loginBg:'',
      loginPrimaryColor:'#d4a020', loginTextColor:'#0f1b2d', loginBoxBg:'#ffffff', loginLogoSize:80,
      loginTitle:'VILA REAL', loginSubtitle:'Futsal · Gestão de Presenças', emailjs:{serviceId:'',templateId:'',publicKey:''},
      botoes:{primaryBg:'#0f1b2d',primaryColor:'#ffffff',secondaryBg:'#d4a020',secondaryColor:'#0f1b2d',successBg:'#22c55e',successColor:'#ffffff',dangerBg:'#ef4444',dangerColor:'#ffffff',fontSize:13,paddingX:22,paddingY:10,borderRadius:10},
      cores:{primaria:'#0f1b2d',secundaria:'#d4a020',fundo:'#eef1f5',texto:'#0f1b2d'}
    }, proximoNumeroAluno:1, proximoNumeroUsuario:2
  };
}
function readState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}
function migrateState(state) {
  if (!state) return defaultState();
  state.usuarios = Array.isArray(state.usuarios) ? state.usuarios : [];
  for (const u of state.usuarios) {
    if (!u.permissoes) u.permissoes = {};
    delete u.permissoes.personalizar;
    if (!u.senhaHash && u.senha) {
      u.senhaHash = hashPassword(u.senha);
      delete u.senha;
    }
    if (!u.senhaHash && u.senhaInicial) {
      u.senhaHash = hashPassword(u.senhaInicial);
      delete u.senhaInicial;
    }
  }
  let admin = state.usuarios.find(u => u.id === 'admin');
  if (!admin) {
    const d = defaultState().usuarios[0];
    state.usuarios.unshift(d);
  }
  state.config = { ...defaultState().config, ...(state.config || {}), botoes:{...defaultState().config.botoes,...(state.config?.botoes||{})}, cores:{...defaultState().config.cores,...(state.config?.cores||{})} };
  return state;
}
function writeState(state) {
  const tmp = STATE_FILE + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, STATE_FILE);
}
function ensureState() {
  let state = migrateState(readState());
  const exists = fs.existsSync(STATE_FILE);
  if (!exists) writeState(state); else writeState(state); // also persists legacy migration
  return { state, initialized: exists };
}
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Credentials':'true'});
  res.end(body);
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0,i).trim()] = decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}
function sessionUser(req) {
  const sid = parseCookies(req).vila_real_sid;
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session || session.expires < Date.now()) { sessions.delete(sid); return null; }
  session.expires = Date.now() + SESSION_TTL_MS;
  const state = migrateState(readState());
  return state.usuarios.find(u => u.id === session.userId) || null;
}
function requireAuth(req,res) { const user = sessionUser(req); if (!user) { sendJSON(res,401,{error:'Sessão expirada ou não autenticada'}); return null; } return user; }
function requireAdmin(req,res) { const user = requireAuth(req,res); if (!user) return null; if (user.perfil !== 'Administrador') { sendJSON(res,403,{error:'Acesso restrito ao administrador'}); return null; } return user; }
function aplicarEstadoConformePermissao(incoming, existing, user) {
  if (user.perfil === 'Administrador') return mergeIncomingState(incoming, existing);
  const next = JSON.parse(JSON.stringify(existing));
  const permissoes = user.permissoes || {};
  const colecoes = {
    alunos:'alunos', presencas:'presencas', notificacoes:'notificacoes', whatsappMessages:'whatsappMessages'
  };
  for (const [permissao,chave] of Object.entries(colecoes)) {
    if (permissoes[permissao] === true && Array.isArray(incoming[chave])) next[chave] = incoming[chave];
  }
  if (permissoes.configuracoes === true && incoming.config) {
    // Configurações operacionais podem ser alteradas por quem recebeu essa permissão,
    // mas o layout global continua sob controle exclusivo do Administrador.
    const layoutKeys = new Set(['loginLogo','loginBg','loginPrimaryColor','loginTextColor','loginBoxBg','loginLogoSize','loginTitle','loginSubtitle','botoes','cores']);
    next.config = { ...next.config, ...incoming.config,
      botoes: next.config.botoes, cores: next.config.cores };
    for (const key of layoutKeys) next.config[key] = existing.config?.[key];
  }
  next.proximoNumeroAluno = Math.max(Number(existing.proximoNumeroAluno||1), Number(incoming.proximoNumeroAluno||1));
  next.proximoNumeroUsuario = Math.max(Number(existing.proximoNumeroUsuario||2), Number(incoming.proximoNumeroUsuario||2));
  return mergeIncomingState(next, existing);
}
function broadcast(state) {
  const msg = `data: ${JSON.stringify({type:'state-updated', data:sanitizeState(state), version:Date.now()})}\n\n`;
  for (const res of clients) { try { res.write(msg); } catch { clients.delete(res); } }
}
function readBody(req) {
  return new Promise((resolve,reject)=>{
    let body='';
    req.on('data', c => { body += c; if (body.length > 20*1024*1024) req.destroy(); });
    req.on('end', ()=>{ try { resolve(JSON.parse(body || '{}')); } catch(e){ reject(e); } });
    req.on('error', reject);
  });
}
function mergeIncomingState(incoming, existing) {
  const next = JSON.parse(JSON.stringify(incoming));
  next.usuarios = Array.isArray(next.usuarios) ? next.usuarios : [];
  const oldById = new Map((existing.usuarios || []).map(u => [u.id, u]));
  for (const u of next.usuarios) {
    const old = oldById.get(u.id);
    delete u.senha;
    if (u.senhaInicial) { u.senhaHash = hashPassword(u.senhaInicial); delete u.senhaInicial; }
    else if (old?.senhaHash) u.senhaHash = old.senhaHash;
    else if (u.senhaHash) u.senhaHash = u.senhaHash;
    else if (u.id === 'admin') u.senhaHash = hashPassword(ADMIN_DEFAULT_PASSWORD);
    delete u.permissoes?.personalizar;
  }
  return migrateState(next);
}

const server = http.createServer(async (req,res)=>{
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Credentials':'true'}); return res.end(); }

  if (url.pathname === '/api/public-config' && req.method === 'GET') {
    const {state} = ensureState();
    return sendJSON(res,200,{config:{...state.config, senhaMaster:undefined, emailjs:undefined}});
  }
  if (url.pathname === '/api/login' && req.method === 'POST') {
    try {
      const body = await readBody(req); const login = String(body.login || '').trim().toLowerCase(); const senha = String(body.senha || '');
      const {state} = ensureState();
      const user = state.usuarios.find(u => String(u.usuario||'').toLowerCase() === login || String(u.email||'').toLowerCase() === login);
      if (!user || !verifyPassword(senha, user.senhaHash)) return sendJSON(res,401,{error:'Usuário ou senha inválidos'});
      const sid = crypto.randomBytes(32).toString('hex'); sessions.set(sid,{userId:user.id,expires:Date.now()+SESSION_TTL_MS});
      res.setHeader('Set-Cookie',`vila_real_sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS/1000}`);
      return sendJSON(res,200,{ok:true,user:publicUser(user),data:sanitizeState(state)});
    } catch { return sendJSON(res,400,{error:'Requisição inválida'}); }
  }
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    const sid = parseCookies(req).vila_real_sid; if (sid) sessions.delete(sid);
    res.setHeader('Set-Cookie','vila_real_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return sendJSON(res,200,{ok:true});
  }
  if (url.pathname === '/api/state' && req.method === 'GET') {
    const user = requireAuth(req,res); if (!user) return;
    const {state} = ensureState(); return sendJSON(res,200,{data:sanitizeState(state),initialized:true,user:publicUser(user)});
  }
  if (url.pathname === '/api/state' && req.method === 'PUT') {
    const user = requireAuth(req,res); if (!user) return;
    try {
      const incoming = await readBody(req); if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.usuarios)) return sendJSON(res,400,{error:'Estado inválido'});
      const existing = ensureState().state; const next = aplicarEstadoConformePermissao(incoming, existing, user); writeState(next); broadcast(next);
      return sendJSON(res,200,{ok:true,data:sanitizeState(next)});
    } catch(e) { return sendJSON(res,400,{error:'JSON inválido'}); }
  }
  if (url.pathname === '/api/events' && req.method === 'GET') {
    const user = requireAuth(req,res); if (!user) return;
    res.writeHead(200, {'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','Access-Control-Allow-Origin':'*','Access-Control-Allow-Credentials':'true'});
    res.write(`retry: 2000\n\n`); clients.add(res);
    const heartbeat=setInterval(()=>{ try{res.write(': heartbeat\n\n');}catch{clearInterval(heartbeat);clients.delete(res);} },15000);
    req.on('close',()=>{clearInterval(heartbeat);clients.delete(res);}); return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    if (!fs.existsSync(INDEX_FILE)) return sendJSON(res,404,{error:'index_corrigido.html não encontrado'});
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}); return fs.createReadStream(INDEX_FILE).pipe(res);
  }
  const safe = path.normalize(url.pathname).replace(/^([.][.][\\/])+/, ''); const file = path.join(ROOT,safe);
  if (file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isFile()) return fs.createReadStream(file).pipe(res);
  sendJSON(res,404,{error:'Não encontrado'});
});

ensureState();
server.listen(PORT,()=>console.log(`Vila Real Futsal: http://localhost:${PORT}`));
