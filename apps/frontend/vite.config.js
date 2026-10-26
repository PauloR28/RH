// @ts-check
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Vite como ferramenta OPCIONAL de build/dev para o frontend do Conecta.
 *
 * IMPORTANTE — compatibilidade: o modo de produção suportado por padrão
 * continua sendo o atual (arquivos estáticos servidos diretamente pelo
 * backend FastAPI, sem etapa de build — ver apps/backend/rh_api/main.py e
 * apps/frontend/README.md). Este arquivo é ADITIVO: ninguém é obrigado a
 * rodar Vite para o app funcionar. Ele só entra em cena para quem
 * explicitamente rodar `npm run dev` (dev server com hot-reload) ou
 * `npm run build` (bundle otimizado opcional em dist/, que hoje não é
 * consumido por nenhum fluxo de produção).
 *
 * O código-fonte em fonte/ usa apenas imports relativos (./x.js, ../x.js,
 * incluindo React/ReactDOM/htm vendorizados em vendor/ — achado S-21) ou
 * URLs absolutas de CDN para as demais bibliotecas (Bootstrap, SheetJS) —
 * nenhum "bare specifier" que dependa de bundler/import map — por isso o
 * Vite consegue processar o grafo de módulos sem que nenhum import precise
 * ser reescrito.
 */

// Porta padrão do backend Python (rh_api). Ver run.py e
// apps/backend/rh_api/config.py (RH_API_HOST/RH_API_PORT, padrão
// 127.0.0.1:8000). Ajustável via variável de ambiente ao rodar `npm run dev`.
const BACKEND_PORT = Number(process.env.VITE_BACKEND_PORT || 8000);
const BACKEND_URL = process.env.VITE_BACKEND_URL || `http://127.0.0.1:${BACKEND_PORT}`;

// Prefixos de rota conhecidos da API (routers em apps/backend/rh_api/routers/,
// nenhum deles usa um prefixo comum tipo "/api"). O frontend navega por hash
// (#/tela, ver fonte/rotas.js), então nenhuma rota de tela do SPA colide com
// estes prefixos — apenas chamadas fetch/XHR reais batem nestes caminhos.
//
// Limitação conhecida: se uma rota de backend nova for criada com um
// prefixo fora desta lista, o proxy do modo dev não vai encaminhá-la
// automaticamente — é só adicionar o prefixo aqui. Isso não afeta o modo
// de produção padrão (estático, sem Vite), só a experiência de dev server.
const API_PATH_PREFIXES = [
  'auth',
  'celebratory-dates',
  'curriculos-ia',
  'curriculos',
  'analises-curriculo-ia',
  'disc',
  'disc-api',
  'document-templates',
  'email-inbox',
  'fit-cultural',
  'fit-cultural-api',
  'conecta-provas-api',
  'onboarding',
  'policies',
  'raciocinio-logico',
  'raciocinio-logico-api',
  'settings',
  'candidate-analytics',
  'reports',
  'candidate-pipeline',
  'processes',
  'process-candidates',
  'history',
  'answer-files',
  'api',
  'health',
  'ready',
  'version',
  'interviews',
  'interview-slots',
  'generated-exams',
  'public',
];

// Vite trata chaves de proxy iniciadas com "^" como RegExp (via
// `new RegExp(key)`), então uma única entrada cobre todos os prefixos acima.
const API_PROXY_PATTERN = `^/(${API_PATH_PREFIXES.join('|')})(/|$)`;

/**
 * O CSS do Conecta continua servido como está (estilos/estilos.css + @imports com ?v=): empacotá-lo aqui descartava os
 * @import com query string e mudaria a ordem da cascata. Estes dois plugins tiram o <link> do CSS do processamento do
 * Vite e o devolvem intacto no index.html gerado.
 */
const guardados = [];
const CSS_LINK = /<link\s[^>]*href="\/estilos\/(?:estilos|bootstrap-[\d.]+\.min)\.css[^"]*"[^>]*>/g;
const separarCssFonte = {
  name: 'conecta-separar-css-fonte',
  transformIndexHtml: {
    order: 'pre',
    handler: (html) => html.replace(CSS_LINK, (m) => { guardados.push(m); return `<!--CONECTA_CSS_${guardados.length - 1}-->`; }),
  },
};

/**
 * No build, junta os 20 @import de estilos.css em UM arquivo com hash no nome (cache longo): são 20 requisicoes a menos
 * no carregamento, o que pesa muito em rede lenta/VPN. A ordem dos @import (= a cascata) e o conteudo sao preservados;
 * os 3 url() relativos viram absolutos (/estilos/...). Em dev (npm run dev) nada muda.
 */
let cssJuntado = null;
function juntarCss() {
  const dir = resolve(__dirname, 'estilos');
  const raiz = readFileSync(resolve(dir, 'estilos.css'), 'utf8');
  const bootstrap = readdirSync(dir).find((f) => /^bootstrap-[\d.]+\.min\.css$/.test(f));
  const partes = bootstrap ? [readFileSync(resolve(dir, bootstrap), 'utf8')] : [];
  for (const m of raiz.matchAll(/@import\s+url\((['"]?)\.\/([^'")?]+)(?:\?[^'")]*)?\1\)\s*;/g)) {
    const css = readFileSync(resolve(dir, m[2]), 'utf8');
    partes.push(css.replace(/url\((['"]?)\.\/(?![a-z]+:)/g, 'url($1/estilos/'));
  }
  const resto = raiz.replace(/@import[^;]*;/g, '');
  const conteudo = `${partes.join('\n')}\n${resto}`;
  const hash = createHash('sha256').update(conteudo).digest('hex').slice(0, 10);
  return { nome: `estilos-${hash}.css`, conteudo };
}

const devolverCssFonte = {
  name: 'conecta-devolver-css-fonte',
  transformIndexHtml: {
    order: 'post',
    handler: (html, ctx) => html.replace(/<!--CONECTA_CSS_(\d+)-->/g, (_, i) => {
      if (!ctx || !ctx.bundle) return guardados[Number(i)];
      // Bootstrap + estilos.css viram o mesmo arquivo: o 1o placeholder leva o <link>, os demais saem.
      if (cssJuntado) return '';
      cssJuntado = juntarCss();
      return `<link href="/bundle/${cssJuntado.nome}" rel="stylesheet" />`;
    }),
  },
  closeBundle() {
    if (!cssJuntado) return;
    writeFileSync(resolve(__dirname, 'dist', 'bundle', cssJuntado.nome), cssJuntado.conteudo);
  },
};

export default defineConfig({
  plugins: [separarCssFonte, devolverCssFonte],

  // Raiz do projeto Vite = pasta onde fica o index.html atual do frontend.
  root: __dirname,
  publicDir: false, // 'data' e outros diretórios já são servidos pelo backend; evita duplicar cópias.

  build: {
    // Saída isolada e claramente identificável — não conflita com os
    // arquivos-fonte servidos hoje (fonte/, estilos/, index.html na raiz).
    // O backend não lê nada de dist/; é só um artefato opcional.
    outDir: 'dist',
    // /bundle (e não /assets) para não colidir com nenhuma rota do backend; os arquivos têm hash no nome e
    // saem com cache longo quando o backend roda com RH_FRONTEND_BUNDLE=1 (ver apps/backend/rh_api/main.py).
    assetsDir: 'bundle',
    emptyOutDir: true,
    // O código-fonte usa top-level await (ex.: fonte/banco-questoes.js, ao
    // carregar o JSON do banco de questões). O target padrão do esbuild
    // (~ES2020, alinhado a navegadores mais antigos) não suporta essa
    // sintaxe. O app já roda hoje via <script type="module">, ou seja, só
    // em navegadores modernos que já suportam top-level await nativamente
    // — então usar 'esnext' aqui apenas alinha o alvo do build ao que o
    // app sem-build já exige, sem introduzir nenhuma incompatibilidade nova.
    target: 'esnext',
  },

  server: {
    port: 5173,
    proxy: {
      [API_PROXY_PATTERN]: {
        target: BACKEND_URL,
        changeOrigin: true,
      },
    },
  },
});
