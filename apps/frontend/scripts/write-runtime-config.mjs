// Gera runtime-config.js a partir de variáveis de ambiente do build (Cloudflare
// Pages injeta "Environment variables" configuradas no painel, por ambiente
// de produção/preview). ADITIVO: só entra em uso se o Build command do Pages
// for configurado para rodar este script; o runtime-config.js estático já
// existente continua funcionando sozinho em qualquer deploy que não rode
// este script (Docker/Caddy, backend servindo estático, etc.).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const env = process.env;

const config = {
  API_BASE_URL: env.API_BASE_URL || '',
  PUBLIC_CANDIDATE_BASE_URL: env.PUBLIC_CANDIDATE_BASE_URL || '',
  PROCESS_DOSSIER_AI_ENDPOINT: env.PROCESS_DOSSIER_AI_ENDPOINT || '',
  APP_ENV: env.APP_ENV || 'dev',
  APP_VERSION: env.APP_VERSION || '0.1.0',
};

const output = `window.RUNTIME_CONFIG = {
  ...(window.RUNTIME_CONFIG || {}),
  API_BASE_URL: ${JSON.stringify(config.API_BASE_URL)},
  PUBLIC_CANDIDATE_BASE_URL: ${JSON.stringify(config.PUBLIC_CANDIDATE_BASE_URL)},
  PROCESS_DOSSIER_AI_ENDPOINT: ${JSON.stringify(config.PROCESS_DOSSIER_AI_ENDPOINT)},
  APP_ENV: ${JSON.stringify(config.APP_ENV)},
  APP_VERSION: ${JSON.stringify(config.APP_VERSION)},
};

window.__RH_API_BASE__ = window.RUNTIME_CONFIG.API_BASE_URL || '';
window.__RH_PUBLIC_CANDIDATE_BASE_URL__ =
  window.RUNTIME_CONFIG.PUBLIC_CANDIDATE_BASE_URL || '';
window.__RH_PROCESS_DOSSIER_AI_ENDPOINT__ =
  window.RUNTIME_CONFIG.PROCESS_DOSSIER_AI_ENDPOINT || '';
`;

const target = fileURLToPath(new URL('../runtime-config.js', import.meta.url));
writeFileSync(target, output);
console.log(`runtime-config.js gerado (API_BASE_URL=${config.API_BASE_URL || '(mesma origem)'})`);
