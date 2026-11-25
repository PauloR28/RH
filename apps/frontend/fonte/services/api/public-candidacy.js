import { requisitar } from './core.js?v=20261125-acessos-salvar';

export async function lerPaginaPublicaCandidatura(slug) {
  return requisitar(
    `/public/candidatura/${encodeURIComponent(slug)}`,
    { method: 'GET' },
    { autenticado: false },
  );
}

export async function enviarCandidaturaPublica(slug, formData) {
  return requisitar(
    `/public/candidatura/${encodeURIComponent(slug)}/enviar`,
    {
      method: 'POST',
      body: formData,
    },
    { autenticado: false },
  );
}
