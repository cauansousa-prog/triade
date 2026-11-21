'use strict';
const { makeHandler, storeConfig, http, authHeaders } = require('../_lib/conta');

// Horizon Wear — projeto Supabase próprio. A chave pública é a mesma que o site da loja já expõe.
const DEFAULTS = {
  url: 'https://bzpanboiidrurjwuswlv.supabase.co',
  anon: 'sb_publishable_4NjZ_ORJeDYxfOoLWrdHjw_0iVQuUDr',
};

module.exports = makeHandler({
  id: 'horizon',
  config: () => storeConfig('HORIZON', DEFAULTS),
  // Exclusão atômica no próprio banco da Horizon: pedidos, pagamentos, reservas, endereços,
  // carrinho, favoritos, avaliações, perfil e a conta do Auth (função public.triade_delete_account).
  async deleteAccount(cfg, user) {
    const r = await http(cfg.url + '/rest/v1/rpc/triade_delete_account', {
      method: 'POST',
      headers: authHeaders(cfg.service),
      body: JSON.stringify({ p_user: user.id }),
    });
    if (r.ok) return;
    const text = await r.text().catch(() => '');
    const e = new Error('rpc_' + r.status);
    if (text.includes('conta_administrativa')) e.code = 'conta_administrativa';
    throw e;
  },
});
