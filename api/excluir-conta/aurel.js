'use strict';
const { makeHandler, storeConfig, http, authHeaders } = require('../_lib/conta');
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
    const adm = await rest('aurel_admins?select=user_id&limit=1&user_id=eq.' + encodeURIComponent(user.id));
    if (adm.ok) {
      const rows = await adm.json();
      if (Array.isArray(rows) && rows.length) { const e = new Error('admin'); e.code = 'conta_administrativa'; throw e; }
    } else if (!(await tableMissing(adm))) throw new Error('admins_' + adm.status);
    const membership = await rest('hub_memberships?select=loja_id&limit=1&user_id=eq.' + encodeURIComponent(user.id) + '&role=in.(admin,editor)');
    if (membership.ok) {
      const rows = await membership.json();
      if (Array.isArray(rows) && rows.length) { const e = new Error('admin_membership'); e.code = 'conta_administrativa'; throw e; }
    } else if (!(await tableMissing(membership))) throw new Error('membership_' + membership.status);

    // Preserva os registros transacionais, removendo os dados pessoais do cliente.
    const anonymize = {
      customer_user_id: null, customer_name: 'Cliente excluído', customer_email: 'anonimizado@example.invalid',
      cpf_last4: '0000', cep: '00000000', address_line: 'Dados removidos', address_number: '0',
      complement: '', neighborhood: 'Removido', city: 'Removido', state: 'NA',
    };
    const filters = ['customer_user_id=eq.' + encodeURIComponent(user.id)];
    if (user.email && !user.email.includes('*')) filters.push('customer_email=ilike.' + encodeURIComponent(likeEscape(user.email)));
    for (const f of filters) {
      const r = await rest('aurel_orders?' + f, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(anonymize),
      });
      if (!r.ok && !(await tableMissing(r))) throw new Error('orders_anonymize_' + r.status);
    }

    const del = await http(cfg.url + '/auth/v1/admin/users/' + encodeURIComponent(user.id), {
      method: 'DELETE', headers: authHeaders(cfg.service),
      body: JSON.stringify({ should_soft_delete: false }),
    });
    if (!del.ok && del.status !== 404) throw new Error('auth_delete_' + del.status);

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
    const orderCheck = await rest('aurel_orders?select=id&limit=1&or=(' +
      'customer_user_id.eq.' + encodeURIComponent(user.id) +
      ',customer_email.ilike.' + encodeURIComponent(likeEscape(user.email || '')) + ')');
    if (orderCheck.ok) {
      const rows = await orderCheck.json();
      if (Array.isArray(rows) && rows.length) throw new Error('orders_personal_data_remains');
    } else if (!(await tableMissing(orderCheck))) throw new Error('orders_check_' + orderCheck.status);
  },
});
