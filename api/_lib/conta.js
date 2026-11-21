'use strict';
/**
 * Exclusão de conta do Tríade.
 * Cada loja usa SOMENTE as suas próprias credenciais (URL + chave pública + service_role).
 * Nenhuma credencial é lida de arquivos públicos nem enviada ao navegador.
 * A senha é validada pelo Auth do Supabase da loja e nunca é gravada nem registrada em log.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_ACCOUNT = 5;
const MAX_FAILS_PER_IP = 20;
const failures = new Map(); // melhor esforço (por instância); o Auth do Supabase também limita tentativas

function recent(key) {
  const now = Date.now();
  const list = (failures.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(key, list); else failures.delete(key);
  return list;
}
function blocked(ip, acct) {
  return recent('ip:' + ip).length >= MAX_FAILS_PER_IP || recent('acct:' + acct).length >= MAX_FAILS_PER_ACCOUNT;
}
function registerFailure(ip, acct) {
  for (const k of ['ip:' + ip, 'acct:' + acct]) {
    const list = recent(k); list.push(Date.now()); failures.set(k, list);
  }
  if (failures.size > 5000) for (const k of failures.keys()) recent(k);
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string') { try { return JSON.parse(b); } catch { return null; } }
  return null;
}

function authHeaders(key, extra) {
  const h = { apikey: key, 'Content-Type': 'application/json', ...(extra || {}) };
  if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key; // chaves novas (sb_secret_...) só usam apikey
  return h;
}

async function http(url, options) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
}

function storeConfig(prefix, defaults) {
  return {
    url: (process.env[prefix + '_SUPABASE_URL'] || defaults.url || '').replace(/\/+$/, ''),
    anon: process.env[prefix + '_SUPABASE_ANON_KEY'] || defaults.anon || '',
    service: process.env[prefix + '_SUPABASE_SERVICE_ROLE_KEY'] || '',
  };
}

/** Valida e-mail + senha no Auth da loja. Retorna { id, email, accessToken }. */
async function signIn(cfg, email, password) {
  const r = await http(cfg.url + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: cfg.anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (r.status === 429) { const e = new Error('rate'); e.code = 'muitas_tentativas'; throw e; }
  if (r.status === 400 || r.status === 401 || r.status === 422) { const e = new Error('cred'); e.code = 'credenciais'; throw e; }
  if (!r.ok) { const e = new Error('auth_' + r.status); e.code = 'falha'; throw e; }
  const j = await r.json();
  if (!j || !j.access_token || !j.user || !j.user.id) { const e = new Error('auth_resp'); e.code = 'falha'; throw e; }
  return { id: j.user.id, email: j.user.email || email, accessToken: j.access_token };
}

async function revokeSession(cfg, accessToken) {
  try {
    await http(cfg.url + '/auth/v1/logout?scope=local', {
      method: 'POST',
      headers: { apikey: cfg.anon, Authorization: 'Bearer ' + accessToken },
    });
  } catch { /* melhor esforço: a sessão expira sozinha */ }
}

/** Confere no Auth (admin) que o usuário realmente deixou de existir. */
async function assertUserGone(cfg, id) {
  const r = await http(cfg.url + '/auth/v1/admin/users/' + encodeURIComponent(id), { headers: authHeaders(cfg.service) });
  if (r.status === 404) return;
  const e = new Error('ainda_existe_' + r.status); e.code = 'falha'; throw e;
}

function makeHandler(store) {
  return async function handler(req, res) {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { ok: false, code: 'metodo' }); }

    const origin = req.headers.origin;
    if (origin) {
      let host = '';
      try { host = new URL(origin).host; } catch { /* inválida */ }
      if (host !== req.headers.host) return send(res, 403, { ok: false, code: 'origem' });
    }

    const cfg = store.config();
    if (!cfg.url || !cfg.anon || !cfg.service) {
      console.error('[excluir-conta:' + store.id + '] configuração ausente');
      return send(res, 503, { ok: false, code: 'indisponivel' });
    }

    const body = readBody(req);
    const email = body && typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = body && typeof body.password === 'string' ? body.password : '';
    const action = body && body.action;
    if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email) || email.length > 254 || !password || password.length > 200
        || (action !== 'verify' && action !== 'delete')
        || (action === 'delete' && body.confirm !== 'EXCLUIR')) {
      return send(res, 400, { ok: false, code: 'requisicao' });
    }

    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'ip').split(',')[0].trim();
    const acct = store.id + ':' + email;
    if (blocked(ip, acct)) return send(res, 429, { ok: false, code: 'muitas_tentativas' });

    let session;
    try {
      session = await signIn(cfg, email, password);
    } catch (e) {
      if (e.code === 'credenciais') { registerFailure(ip, acct); return send(res, 401, { ok: false, code: 'credenciais' }); }
      if (e.code === 'muitas_tentativas') return send(res, 429, { ok: false, code: 'muitas_tentativas' });
      console.error('[excluir-conta:' + store.id + '] erro no login:', e.message);
      return send(res, 502, { ok: false, code: 'falha' });
    }

    if (action === 'verify') {
      await revokeSession(cfg, session.accessToken);
      return send(res, 200, { ok: true });
    }

    try {
      await store.deleteAccount(cfg, { id: session.id, email: session.email });
      await assertUserGone(cfg, session.id);
      return send(res, 200, { ok: true });
    } catch (e) {
      console.error('[excluir-conta:' + store.id + '] exclusão não concluída:', e.code || '', e.message);
      if (e.code === 'conta_administrativa') return send(res, 403, { ok: false, code: 'conta_administrativa' });
      return send(res, 500, { ok: false, code: 'falha' });
    }
  };
}

module.exports = { makeHandler, storeConfig, http, authHeaders, _test: { failures, blocked, registerFailure } };
