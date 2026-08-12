const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'server-data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const RESET_FILE = path.join(DATA_DIR, 'resets.json');
const HTML_FILE = path.join(__dirname, 'index_corrigido.html');
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID || '';
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID || '';
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || '';
const EMAILJS_FROM_NAME = process.env.EMAILJS_FROM_NAME || 'Vila Real Futsal';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'gleuber.andrade@outlook.com';
const ADMIN_USER = process.env.ADMIN_USER || 'gleuber';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MIGRATION_KEY = process.env.MIGRATION_KEY || '';

fs.mkdirSync(DATA_DIR, { recursive: true });
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8'); }
let users = readJson(USERS_FILE, []);
if (ADMIN_PASSWORD && !users.some(u => u.email && u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase())) {
  users.unshift({id:'admin',nome:'Administrador',email:ADMIN_EMAIL.toLowerCase(),perfil:'Administrador',usuario:ADMIN_USER,passwordHash:hashPassword(ADMIN_PASSWORD),status:'aprovado',criadoEm:new Date().toISOString()});
  writeJson(USERS_FILE, users);
}
let sessions = readJson(SESSIONS_FILE, {});
let resets = readJson(RESET_FILE, {});

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
function sanitizeUser(u) {
  const { passwordHash, ...safe } = u;
  return safe;
}
function json(res, status, body) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); }
function body(req) { return new Promise((resolve, reject) => { let s=''; req.on('data', c => { s += c; if (s.length > 1e6) req.destroy(); }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch(e) { reject(e); } }); req.on('error', reject); }); }
function token() { return crypto.randomBytes(32).toString('hex'); }
function code() { return String(crypto.randomInt(100000, 1000000)); }
function authUser(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  const t = h.slice(7); const s = sessions[t];
  if (!s || s.expiresAt < Date.now()) { if (s) { delete sessions[t]; writeJson(SESSIONS_FILE, sessions); } return null; }
  return users.find(u => u.id === s.userId) || null;
}
async function sendEmail({to, name, subject, message, type='sistema', usuario='', resetCode=''}) {
  if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY) return false;
  const payload = {
    service_id: EMAILJS_SERVICE_ID,
    template_id: EMAILJS_TEMPLATE_ID,
    user_id: EMAILJS_PUBLIC_KEY,
    template_params: {
      to_email: to, to_name: name || 'Usuário', from_name: EMAILJS_FROM_NAME,
      subject, assunto: subject, mensagem: message, tipo_email: type,
      usuario, nova_senha: '', senha: '', codigo_recuperacao: resetCode,
      sistema: 'Vila Real Futsal'
    }
  };
  const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  return r.ok;
}
function nextUsername() { let n = users.reduce((m,u) => Math.max(m, Number(String(u.usuario||'').replace(/\D/g,'')) || 0), 1) + 1; return 'user' + String(n).padStart(4,'0'); }

async function api(req, res, pathname) {
  try {
    if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, {ok:true, service:'Vila Real Auth', emailConfigured:!!(EMAILJS_SERVICE_ID&&EMAILJS_TEMPLATE_ID&&EMAILJS_PUBLIC_KEY)});

    if (req.method === 'POST' && pathname === '/api/auth/register') {
      const b = await body(req); const {nome,email,perfil,senha} = b;
      if (!nome || !email || !perfil || !senha) return json(res,400,{ok:false,error:'Dados obrigatórios ausentes.'});
      if (!/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&]).{6,}$/.test(senha)) return json(res,400,{ok:false,error:'Senha deve ter mínimo 6 caracteres, letra, número e caractere especial.'});
      if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) return json(res,409,{ok:false,error:'Este e-mail já está cadastrado.'});
      const u = {id:'user_'+crypto.randomUUID(), nome, email:email.toLowerCase(), perfil, usuario:nextUsername(), passwordHash:hashPassword(senha), status:'pendente', criadoEm:new Date().toISOString()};
      users.push(u); writeJson(USERS_FILE, users);
      if (process.env.AUTO_EMAIL_REGISTER !== 'false') await sendEmail({to:email,name:nome,subject:'Solicitação de cadastro recebida - Vila Real Futsal',message:`Olá ${nome},\n\nSua solicitação foi recebida e aguarda aprovação do administrador.\n\nUsuário: ${u.usuario}\nPerfil: ${perfil}`,type:'cadastro_automatico',usuario:u.usuario});
      if (ADMIN_EMAIL && process.env.AUTO_EMAIL_ADMIN !== 'false') await sendEmail({to:ADMIN_EMAIL,name:'Administrador',subject:'Nova solicitação de cadastro - Vila Real Futsal',message:`Nova solicitação de cadastro.\n\nNome: ${nome}\nE-mail: ${email}\nPerfil: ${perfil}\nUsuário: ${u.usuario}`,type:'nova_solicitacao',usuario:u.usuario});
      return json(res,201,{ok:true,user:sanitizeUser(u)});
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const b = await body(req); const login = String(b.login||'').toLowerCase(); const senha = String(b.senha||'');
      const u = users.find(x => x.usuario.toLowerCase()===login || x.email.toLowerCase()===login);
      if (!u) return json(res,401,{ok:false,error:'Usuário ou senha inválidos.'});
      if (u.status !== 'aprovado') return json(res,403,{ok:false,error:u.status==='pendente'?'Cadastro aguardando aprovação.':'Cadastro rejeitado.'});
      if (!verifyPassword(senha,u.passwordHash)) return json(res,401,{ok:false,error:'Usuário ou senha inválidos.'});
      const t = token(); sessions[t]={userId:u.id,expiresAt:Date.now()+1000*60*60*12}; writeJson(SESSIONS_FILE,sessions);
      return json(res,200,{ok:true,token:t,user:sanitizeUser(u)});
    }

    if (req.method === 'POST' && pathname === '/api/auth/recovery/request') {
      const b = await body(req); const email = String(b.email||'').trim().toLowerCase();
      const u = users.find(x=>x.email.toLowerCase()===email);
      // Resposta genérica para não revelar se o e-mail existe.
      if (!u || u.status !== 'aprovado') return json(res,200,{ok:true,message:'Se o e-mail estiver cadastrado, um código de recuperação será enviado.'});
      const c = code(); const salt = crypto.randomBytes(16).toString('hex'); const codeHash = crypto.scryptSync(c,salt,32).toString('hex');
      resets[email]={salt,codeHash,expiresAt:Date.now()+15*60*1000,attempts:0}; writeJson(RESET_FILE,resets);
      const sent = await sendEmail({to:u.email,name:u.nome,subject:'Código de recuperação de senha - Vila Real Futsal',message:`Olá ${u.nome},\n\nSeu código de recuperação é: ${c}\n\nEle expira em 15 minutos. Se você não solicitou esta recuperação, ignore esta mensagem.`,type:'recuperacao_codigo',resetCode:c});
      if (!sent) return json(res,503,{ok:false,error:'Não foi possível enviar o e-mail de recuperação. Verifique a configuração de e-mail do servidor.'});
      return json(res,200,{ok:true,message:'Código de recuperação enviado para o e-mail cadastrado.'});
    }

    if (req.method === 'POST' && pathname === '/api/auth/recovery/reset') {
      const b = await body(req); const email=String(b.email||'').trim().toLowerCase(); const c=String(b.codigo||'').trim(); const senha=String(b.novaSenha||'');
      if (!/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&]).{6,}$/.test(senha)) return json(res,400,{ok:false,error:'Nova senha inválida.'});
      const r=resets[email]; const u=users.find(x=>x.email.toLowerCase()===email);
      if (!u || !r || r.expiresAt<Date.now()) return json(res,400,{ok:false,error:'Código inválido ou expirado.'});
      if (++r.attempts > 5) { delete resets[email]; writeJson(RESET_FILE,resets); return json(res,429,{ok:false,error:'Muitas tentativas. Solicite um novo código.'}); }
      const actual=crypto.scryptSync(c,r.salt,32).toString('hex');
      if (!crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(r.codeHash,'hex'))) { writeJson(RESET_FILE,resets); return json(res,400,{ok:false,error:'Código inválido ou expirado.'}); }
      u.passwordHash=hashPassword(senha); writeJson(USERS_FILE,users); delete resets[email]; writeJson(RESET_FILE,resets);
      await sendEmail({to:u.email,name:u.nome,subject:'Senha alterada - Vila Real Futsal',message:`Olá ${u.nome},\n\nSua senha foi alterada com sucesso.\n\nSe você não realizou esta alteração, entre em contato com o administrador imediatamente.`,type:'recuperacao_confirmacao'});
      return json(res,200,{ok:true,message:'Senha alterada com sucesso.'});
    }

    const me = authUser(req);
    if (req.method === 'POST' && pathname === '/api/auth/approve') {
      if (!me || me.perfil !== 'Administrador') return json(res,403,{ok:false,error:'Acesso negado.'});
      const b=await body(req); const u=users.find(x=>x.id===b.userId); if(!u) return json(res,404,{ok:false,error:'Usuário não encontrado.'});
      u.status='aprovado'; writeJson(USERS_FILE,users);
      if (process.env.AUTO_EMAIL_APPROVAL !== 'false') await sendEmail({to:u.email,name:u.nome,subject:'Cadastro aprovado - Vila Real Futsal',message:`Olá ${u.nome},\n\nSeu cadastro foi aprovado.\n\nUsuário: ${u.usuario}\nAcesse o sistema e utilize a senha criada no cadastro.`,type:'aprovacao',usuario:u.usuario});
      return json(res,200,{ok:true,user:sanitizeUser(u)});
    }
    if (req.method === 'POST' && pathname === '/api/auth/reject') {
      if (!me || me.perfil !== 'Administrador') return json(res,403,{ok:false,error:'Acesso negado.'});
      const b=await body(req); const u=users.find(x=>x.id===b.userId); if(!u) return json(res,404,{ok:false,error:'Usuário não encontrado.'});
      u.status='rejeitado'; writeJson(USERS_FILE,users);
      return json(res,200,{ok:true,user:sanitizeUser(u)});
    }

    if (req.method === 'POST' && pathname === '/api/email/send') {
      if (!me || me.perfil !== 'Administrador') return json(res,403,{ok:false,error:'Acesso negado.'});
      const b=await body(req); if(!b.to||!b.subject||!b.message) return json(res,400,{ok:false,error:'Destinatário, assunto e mensagem são obrigatórios.'});
      const sent=await sendEmail({to:b.to,name:b.nome,subject:b.subject,message:b.message,type:'resposta_manual'});
      return sent ? json(res,200,{ok:true}) : json(res,503,{ok:false,error:'Falha no envio do e-mail.'});
    }

    if (req.method === 'POST' && pathname === '/api/auth/migrate') {
      if (!MIGRATION_KEY || req.headers['x-migration-key'] !== MIGRATION_KEY) return json(res,403,{ok:false,error:'Migração não autorizada.'});
      const b=await body(req); if(!Array.isArray(b.users)) return json(res,400,{ok:false,error:'Lista de usuários inválida.'});
      const map = new Map(users.map(u=>[u.email.toLowerCase(),u]));
      for (const x of b.users) {
        if (!x.email || !x.senha) continue;
        const u = map.get(x.email.toLowerCase()) || {id:x.id||'user_'+crypto.randomUUID(),nome:x.nome||'Usuário',email:x.email.toLowerCase(),usuario:x.usuario||nextUsername(),perfil:x.perfil||'Usuário'};
        Object.assign(u,{nome:x.nome||u.nome,email:x.email.toLowerCase(),usuario:x.usuario||u.usuario,perfil:x.perfil||u.perfil,status:x.status||'aprovado',passwordHash:hashPassword(x.senha)});
        const idx=users.findIndex(y=>y.id===u.id); if(idx>=0) users[idx]=u; else users.push(u);
      }
      writeJson(USERS_FILE,users); return json(res,200,{ok:true,migrated:users.length});
    }

    return json(res,404,{ok:false,error:'Rota não encontrada.'});
  } catch(e) { console.error(e); return json(res,500,{ok:false,error:'Erro interno do servidor.'}); }
}

const server=http.createServer(async (req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(url.pathname.startsWith('/api/')) return api(req,res,url.pathname);
  if(req.method==='GET' && (url.pathname==='/' || url.pathname==='/index_corrigido.html')) { res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); return fs.createReadStream(HTML_FILE).pipe(res); }
  if(req.method==='GET' && url.pathname==='/health') { res.writeHead(200,{'Content-Type':'text/plain'}); return res.end('OK'); }
  res.writeHead(404); res.end('Not found');
});
server.listen(PORT,HOST,()=>console.log(`Vila Real Futsal: http://${HOST}:${PORT}`));
