'use strict';
const { makeHandler, storeConfig, http, authHeaders } = require('../_lib/conta');

// Aurel Gym — projeto Supabase próprio. A chave publicável é a mesma que o site da loja já expõe.
const DEFAULTS = {
  url: 'https://tfoljlaubarztsuurctt.supabase.co',
  anon: 'sb_publishable_NUQsSijBCU9cpGoS4FJ13w_Cw4KkzfO',
};

const MISSING_TABLE = new Set(['PGRST205', '42P01']);
async function tableMissing(r) {
  if (r.status !== 404 && r.status !== 400) return false;
  try { const j = await r.clone().json(); return MISSING_TABLE.has(j && j.code); } catch { return false; }
}
function likeEscape(s) { return s.replace(/[\\%_]/g, '\\$&'); }

module.exports = makeHandler({
  id: 'aurel',
  config: () => storeConfig('AUREL', DEFAULTS),
  async deleteAccount(cfg, user) {
    const rest = (path, init) => http(cfg.url + '/rest/v1/' + path, { ...init, headers: authHeaders(cfg.service, init && init.headers) });

    // 1) Contas administrativas não são excluídas por esta página pública.
    const adm = await rest('aurel_admins?select=user_id&limit=1&user_id=eq.' + encodeURIComponent(user.id));
    if (adm.ok) {
      const rows = await adm.json();
      if (Array.isArray(rows) && rows.length) { const e = new Error('admin'); e.code = 'conta_administrativa'; throw e; }
    } else if (!(await tableMissing(adm))) throw new Error('admins_' + adm.status);

    // 2) Pedidos com dados pessoais (por conta e por e-mail), se a tabela existir.
    const filters = ['customer_user_id=eq.' + encodeURIComponent(user.id)];
    if (!user.email.includes('*')) filters.push('customer_email=ilike.' + encodeURIComponent(likeEscape(user.email)));
    for (const f of filters) {
      const d = await rest('aurel_orders?' + f, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (!d.ok && !(await tableMissing(d))) throw new Error('orders_' + d.status);
    }

    // 3) Conta do Auth. As tabelas profiles, favorites e cart_items removem as linhas por cascata.
    const del = await http(cfg.url + '/auth/v1/admin/users/' + encodeURIComponent(user.id), {
      method: 'DELETE',
      headers: authHeaders(cfg.service),
      body: JSON.stringify({ should_soft_delete: false }),
    });
    if (!del.ok && del.status !== 404) throw new Error('auth_delete_' + del.status);

    // 4) Conferência: nada pode ter sobrado nas tabelas do cliente.
    for (const t of ['profiles?id', 'favorites?user_id', 'cart_items?user_id']) {
      const chk = await rest(t + '=eq.' + encodeURIComponent(user.id) + '&select=*&limit=1');
      if (chk.ok) {
        const rows = await chk.json();
        if (Array.isArray(rows) && rows.length) {
          const x = await rest(t + '=eq.' + encodeURIComponent(user.id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
          if (!x.ok) throw new Error('residuo_' + x.status);
        }
      } else if (!(await tableMissing(chk))) throw new Error('chk_' + chk.status);
    }
  },
});
