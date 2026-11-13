import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import { ToggleSwitch } from '../../ui/components/primitives.js';
import { IconeSvg } from '../../ui/icone.js';
import {
  BLOCOS_TELA_INICIAL,
  PERFIS_INICIO_POR_SESSOES,
  atalhosDoInicioPorPerfil,
  configTelaInicialPadrao,
  listarTelaInicialPerfis,
  salvarTelaInicialPerfil,
} from '../../shared/tela-inicial.js?v=20261111-atalhos-ocultos';

// Perfis e Permissões > [perfil] > Tela inicial: quais blocos aparecem na Início
// do perfil e em que ordem. Só esconde/reordena: um bloco sem a permissão da área
// continua oculto, e a tela avisa isso.
export function PainelTelaInicialPerfil({ perfil, permissoes = [], podeEditar = false }) {
  const [configs, setConfigs] = useState(null);
  const [draft, setDraft] = useState([]);
  const [ocultosDraft, setOcultosDraft] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const perfilId = perfil?.id || '';
  const porSessoes = PERFIS_INICIO_POR_SESSOES.has(perfilId);

  useEffect(() => {
    let ativo = true;
    listarTelaInicialPerfis()
      .then((dados) => { if (ativo) setConfigs(dados || {}); })
      .catch((error) => { if (ativo) setErro(error?.message || 'Não foi possível carregar a tela inicial.'); });
    return () => { ativo = false; };
  }, []);

  const original = useMemo(() => {
    const salvo = configs?.perfis?.[perfilId];
    return (salvo?.blocos || configTelaInicialPadrao().blocos).map((item) => ({ ...item }));
  }, [configs, perfilId]);

  const ocultosOriginal = useMemo(() => [...(configs?.perfis?.[perfilId]?.atalhos_ocultos || [])], [configs, perfilId]);

  useEffect(() => {
    setDraft(original);
    setOcultosDraft(ocultosOriginal);
  }, [original, ocultosOriginal]);
  // A mensagem de "salvo" some só ao trocar de perfil (antes sumia logo depois de salvar).
  useEffect(() => { setMensagem(''); }, [perfilId]);

  const catalogo = new Map(BLOCOS_TELA_INICIAL.map((bloco) => [bloco.id, bloco]));
  const temPermissao = (bloco) => !bloco?.permissao || permissoes.includes(bloco.permissao);
  const alterado = JSON.stringify(draft) !== JSON.stringify(original)
    || JSON.stringify([...ocultosDraft].sort()) !== JSON.stringify([...ocultosOriginal].sort());

  const mover = (indice, direcao) => {
    const destino = indice + direcao;
    if (destino < 0 || destino >= draft.length) return;
    const proximo = draft.slice();
    [proximo[indice], proximo[destino]] = [proximo[destino], proximo[indice]];
    setDraft(proximo);
  };
  const alternar = (indice) => setDraft(draft.map((item, i) => (i === indice ? { ...item, visivel: !item.visivel } : item)));

  const salvar = async () => {
    setSalvando(true);
    setErro('');
    try {
      const resultado = await salvarTelaInicialPerfil(perfilId, draft, ocultosDraft);
      setConfigs((atual) => ({ ...(atual || {}), perfis: { ...(atual?.perfis || {}), [perfilId]: { blocos: resultado.blocos, atalhos_ocultos: resultado.atalhos_ocultos || [] } } }));
      setMensagem('Tela inicial salva. Vale no próximo acesso dos usuários deste perfil.');
    } catch (error) {
      setErro(error?.message || 'Não foi possível salvar a tela inicial.');
    } finally {
      setSalvando(false);
    }
  };

  // Início por sessões (item 9 da lista de 10/11/2026, opção B): o interruptor só esconde o atalho
  // do Início; a pessoa continua abrindo a seção pelo menu. Liberar ou bloquear a seção é na aba Sessões.
  if (porSessoes) {
    if (!configs && !erro) return html`<p class="text-muted small mb-0">Carregando…</p>`;
    const atalhos = atalhosDoInicioPorPerfil(perfilId, permissoes);
    const alternarAtalho = (id) => setOcultosDraft((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
    return html`
      <div class="settings-home-config">
        <p class="text-muted small">
          Escolha quais atalhos aparecem no Início de <strong>${perfil?.nome || 'este perfil'}</strong>. Desligar só tira o atalho
          do Início: a pessoa continua abrindo a seção pelo menu. Para liberar ou bloquear a seção, use a aba de sessões.
        </p>
        ${erro ? html`<div class="alert alert-danger">${erro}</div>` : null}
        ${mensagem ? html`<div class="alert alert-success">${mensagem}</div>` : null}
        ${atalhos.length ? html`
          <ol class="settings-home-config-list">
            ${atalhos.map((atalho) => {
              const visivel = !ocultosDraft.includes(atalho.id);
              return html`
                <li key=${atalho.id} class=${`settings-home-config-item ${visivel ? '' : 'is-off'}`.trim()}>
                  <${ToggleSwitch} checked=${visivel} disabled=${!podeEditar} onChange=${() => alternarAtalho(atalho.id)} />
                  <span class="settings-home-config-label">
                    <strong>${atalho.label}</strong>
                    ${!visivel ? html`<small class="text-muted">Fora do Início. Continua no menu.</small>` : null}
                  </span>
                </li>`;
            })}
          </ol>` : html`<p class="text-muted small mb-0">Nenhuma sessão liberada: o Início ficará sem atalhos.</p>`}
        <div class="settings-card-actions">
          <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${!podeEditar || salvando || !ocultosDraft.length} onClick=${() => setOcultosDraft([])}>
            Mostrar todos
          </button>
          <button type="button" class="btn btn-primary btn-sm" disabled=${!podeEditar || salvando || !alterado} onClick=${salvar}>
            ${salvando ? 'Salvando...' : 'Salvar tela inicial'}
          </button>
        </div>
        ${!podeEditar ? html`<p class="text-muted small mt-2 mb-0">Use "Editar configurações padrão" para alterar.</p>` : null}
      </div>`;
  }
  if (!configs && !erro) return html`<p class="text-muted small mb-0">Carregando…</p>`;

  return html`
    <div class="settings-home-config">
      <p class="text-muted small">
        Escolha os blocos da tela inicial de <strong>${perfil?.nome}</strong> e a ordem deles. Um bloco só aparece se o perfil
        tiver a permissão da área — esta configuração pode esconder, mas nunca liberar uma área.
      </p>
      ${erro ? html`<div class="alert alert-danger">${erro}</div>` : null}
      ${mensagem ? html`<div class="alert alert-success">${mensagem}</div>` : null}
      <ol class="settings-home-config-list">
        ${draft.map((item, indice) => {
          const bloco = catalogo.get(item.id);
          if (!bloco) return null;
          const liberado = temPermissao(bloco);
          return html`
            <li key=${item.id} class=${`settings-home-config-item ${item.visivel && liberado ? '' : 'is-off'}`.trim()}>
              <${ToggleSwitch} checked=${item.visivel} disabled=${!podeEditar} onChange=${() => alternar(indice)} />
              <span class="settings-home-config-label">
                <strong>${bloco.label}</strong>
                ${!liberado ? html`<small class="text-warning">Sem permissão da área neste perfil — não aparece.</small>` : null}
                ${bloco.id === 'sessoes' ? html`<small class="text-muted">Aparece sozinho quando o perfil não tem blocos de recrutamento.</small>` : null}
              </span>
              <span class="settings-home-config-moves">
                <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${!podeEditar || indice === 0} aria-label="Subir" onClick=${() => mover(indice, -1)}>
                  <span class="material-symbols-outlined">${IconeSvg('arrow_upward')}</span>
                </button>
                <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${!podeEditar || indice === draft.length - 1} aria-label="Descer" onClick=${() => mover(indice, 1)}>
                  <span class="material-symbols-outlined">${IconeSvg('arrow_downward')}</span>
                </button>
              </span>
            </li>
          `;
        })}
      </ol>
      <p class="text-muted small">
        Blocos de topo (atalhos, indicadores, suas áreas) ficam no alto; os demais se dividem em duas colunas
        (Caixa de CV, Movimentações e Mural à esquerda; Entrevistas, Provas e Processos à direita), na ordem acima.
      </p>
      <div class="settings-card-actions">
        <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${!podeEditar || salvando} onClick=${() => setDraft(configTelaInicialPadrao().blocos)}>
          Voltar ao padrão
        </button>
        <button type="button" class="btn btn-primary btn-sm" disabled=${!podeEditar || salvando || !alterado} onClick=${salvar}>
          ${salvando ? 'Salvando...' : 'Salvar tela inicial'}
        </button>
      </div>
      ${!podeEditar ? html`<p class="text-muted small mt-2 mb-0">Use "Editar configurações padrão" para alterar.</p>` : null}
    </div>
  `;
}
