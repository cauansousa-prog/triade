# Tríade

Entrada única para duas lojas independentes:

| Loja | Endereço | Código-fonte |
| --- | --- | --- |
| Horizon Wear | https://horizonwear.vercel.app | `cauansousa-prog/horizon.wear` |
| Aurel Gym | https://aurelgymjk.vercel.app | `kauasouza2527-ui/aurelgymJ` |

## Como funciona

- `public/index.html` é a tela de entrada. É a única pasta publicada na Vercel (`vercel.json` → `outputDirectory: public`).
- Ao escolher uma loja, ela abre dentro da própria página, sem trocar a URL do Tríade. As duas ficam carregadas e dá para alternar pela barra superior.
- Cada loja continua rodando na sua própria implantação, com o seu próprio banco Supabase, suas chaves e sua autenticação. O Tríade não guarda dados nem credenciais.

## Isolamento

Cada loja é carregada de uma origem diferente, então `localStorage`, sessão e cookies de uma não se misturam com os da outra. Nenhuma variável de ambiente é necessária neste projeto.

## Regras

- Não altere o código das lojas por aqui.
- Nunca coloque chaves secretas (service role, tokens de pagamento) neste repositório.
