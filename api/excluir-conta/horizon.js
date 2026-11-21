'use strict';
const { makeHandler, storeConfig, http, authHeaders } = require('../_lib/conta');

// Horizon Wear — projeto Supabase próprio. A chave pública é a mesma que o site da loja já expõe.
const DEFAULTS = {
  url: 'https://bzpanboiidrurjwuswlv.supabase.co',
  anon: 'sb_publishable_4NjZ_ORJeDYxfOoLWrdHjw_0iVQuUDr',
};

module.exports = makeHandler({
  id: 'horizon',
  requiresServiceRole: false,
  config: () => storeConfig('HORIZON', DEFAULTS),
  // Usa a sessão recém-autenticada do próprio usuário; não depende de service_role.
  async deleteAccount(cfg, user) {
    const r = await http(cfg.url + '/rest/v1/rpc/triade_delete_my_account', {
      method: 'POST',
      headers: {
        apikey: cfg.anon,
        Authorization: 'Bearer ' + user.accessToken,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      const e = new Error('rpc_' + r.status);
      if (text.includes('conta_administrativa')) e.code = 'conta_administrativa';
      throw e;
    }
    return { verified: true };
  },
});
