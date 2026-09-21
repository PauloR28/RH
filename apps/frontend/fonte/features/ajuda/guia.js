import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import { EmptyState, PageIntro, PainelRh } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import { listarGuia } from '../../services/api/monitoria.js';
import { GUIA_SESSOES } from './conteudo-guia.js';

// Central de Ajuda — guia de processos do Conecta organizado por sessão.

function sessaoVisivel(controlador, sessao) {
  if (sessao.admin) return controlador.estado?.perfilUsuario === 'administrador';
  if (!sessao.sessao) return true;
  const permissoes = controlador.estado?.permissoesUsuario || [];
  const usaChavesMestras = permissoes.some((p) => p.startsWith('sessao.'));
  return !usaChavesMestras || controlador.possuiPermissao(`sessao.${sessao.sessao}.acessar`);
}

const normalizar = (texto) => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function GuiaProcessos({ controlador }) {
  const [busca, setBusca] = useState('');
  const [abertas, setAbertas] = useState(() => new Set(['inicio']));
  const [topicosMonitoria, setTopicosMonitoria] = useState([]);
  const visiveis = useMemo(() => GUIA_SESSOES.filter((s) => sessaoVisivel(controlador, s)), [controlador.estado?.perfilUsuario, controlador.estado?.permissoesUsuario]);
  const veMonitoria = visiveis.some((s) => s.id === 'monitoria') && controlador.possuiPermissao('monitoria.visualizar');

  // Tópicos da Monitoria editáveis pelo Administrador (Configurações > Central de Monitoria).
  useEffect(() => {
    if (!veMonitoria) return;
    listarGuia()
      .then((r) => setTopicosMonitoria((r.itens || []).map((g) => ({ titulo: g.titulo, onde: 'Regras e prazos da Monitoria', texto: g.conteudo }))))
      .catch(() => setTopicosMonitoria([]));
  }, [veMonitoria]);

  const secoes = useMemo(() => {
    const termo = normalizar(busca.trim());
    return visiveis
      .map((s) => {
        const processos = s.id === 'monitoria' ? [...s.processos, ...topicosMonitoria] : s.processos;
        const filtrados = termo
          ? processos.filter((p) => normalizar(`${p.titulo} ${p.onde} ${(p.passos || []).join(' ')} ${p.texto || ''}`).includes(termo))
          : processos;
        return { ...s, processos: filtrados };
      })
      .filter((s) => s.processos.length);
  }, [visiveis, busca, topicosMonitoria]);

  const buscando = busca.trim().length > 0;
  const alternar = (id) => setAbertas((atual) => {
    const proximo = new Set(atual);
    if (proximo.has(id)) proximo.delete(id);
    else proximo.add(id);
    return proximo;
  });
  const total = secoes.reduce((soma, s) => soma + s.processos.length, 0);

  return html`
    <div class="ajuda-guia">
      <div class="ajuda-guia-topo">
        <label class="ajuda-busca">
          <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('search')}</span>
          <input class="form-control" type="search" placeholder="Buscar um processo (ex.: criar processo, feedback, senha)" value=${busca} onInput=${(e) => setBusca(e.target.value)} aria-label="Buscar no guia de processos" />
        </label>
        <span class="ajuda-guia-total">${total} processo(s) em ${secoes.length} sessão(ões)</span>
      </div>
      ${!secoes.length ? html`<${EmptyState} icon="search_off" title="Nada encontrado" text="Tente outra palavra ou limpe a busca." />` : html`
        <div class="ajuda-secoes">
          ${secoes.map((s) => {
            const aberta = buscando || abertas.has(s.id);
            return html`
              <section key=${s.id} class=${`ajuda-secao ${aberta ? 'is-aberta' : ''}`}>
                <button type="button" class="ajuda-secao-cab" aria-expanded=${aberta} onClick=${() => alternar(s.id)}>
                  <span class="ajuda-secao-icone material-symbols-outlined" aria-hidden="true">${IconeSvg(s.icone)}</span>
                  <span class="ajuda-secao-titulo"><strong>${s.titulo}</strong><small>${s.resumo}</small></span>
                  <span class="mon-badge">${s.processos.length}</span>
                  <span class="ajuda-secao-seta material-symbols-outlined" aria-hidden="true">${IconeSvg(aberta ? 'expand_less' : 'expand_more')}</span>
                </button>
                ${aberta ? html`
                  <div class="ajuda-secao-corpo">
                    ${s.processos.map((p, i) => html`
                      <details key=${`${s.id}-${i}`} class="ajuda-processo">
                        <summary><span>${p.titulo}</span><small>${p.onde}</small></summary>
                        ${p.passos ? html`<ol>${p.passos.map((passo, k) => html`<li key=${k}>${passo}</li>`)}</ol>` : html`<p class="ajuda-texto">${p.texto}</p>`}
                      </details>`)}
                  </div>` : null}
              </section>`;
          })}
        </div>`}
    </div>`;
}

// Tela da Central de Ajuda para todos os perfis (a versão do Administrador, com a
// biblioteca de documentos e os modelos, fica em Configurações).
export function TelaCentralAjuda({ controlador }) {
  return html`
    <${PainelRh} screenId="screen-help" navAtiva="screen-help" subtituloMarca="Central de Ajuda" placeholderBusca="Central de Ajuda" controlador=${controlador}>
      <${PageIntro} kicker="Ajuda" title="Central de Ajuda" description="Como fazer cada processo no Conecta, organizado por sessão." />
      <${GuiaProcessos} controlador=${controlador} />
    </${PainelRh}>`;
}
