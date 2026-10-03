import { html, useEffect, useState } from '../../../infraestrutura-react.js';
import { IconeSvg } from '../../../ui/icone.js';
import { gestaoEscalasWfm } from '../../../services/api/wfm.js';
import { foraDeRascunho } from './escalas.js';

// Outras escalas do mês, na visão do Gestor: só aparece se houver outra escala ATIVA que já saiu de rascunho
// (enviada para aprovação, aprovada ou publicada). Um clique troca a escala exibida. `versao` força recarregar.

const ESTADO = {
  RASCUNHO: ['Rascunho', 'mon-badge--nula'],
  EM_APROVACAO: ['Em aprovação', 'mon-badge--pendente'],
  APROVADA: ['Aprovada', 'mon-badge--ok'],
};

export function OutrasEscalas({ anoMes, operacao, versao, onEscolher }) {
  const [itens, setItens] = useState(null);
  useEffect(() => {
    let ativo = true;
    gestaoEscalasWfm(anoMes).then((r) => { if (ativo) setItens((r.itens || []).filter((e) => e.ativa && foraDeRascunho(e))); }).catch(() => { if (ativo) setItens([]); });
    return () => { ativo = false; };
  }, [anoMes, versao]);
  const outras = (itens || []).filter((e) => e.chave !== operacao);
  if (!outras.length) return null;
  return html`
    <section class="mon-card wfm-outras" aria-label="Outras escalas">
      <h3>Outras escalas</h3>
      <div class="wfm-outras-lista">
        ${outras.map((e) => {
          const [rotulo, classe] = e.declinada ? ['Declinada', 'mon-badge--critico'] : (ESTADO[e.aprovacao] || ESTADO.RASCUNHO);
          return html`<button key=${e.chave} type="button" class="wfm-outra" onClick=${() => onEscolher(e.chave)}>
            <span class="wfm-outra-nome">${e.nome}</span>
            <small>${e.nome !== e.operacao ? `${e.operacao} · ` : ''}${e.escalados} escalado(s)${e.versao_publicada ? ` · v${e.versao_publicada} publicada` : ' · não publicada'}</small>
            <span class=${`mon-badge ${classe}`}>${e.fechada ? 'Fechada' : rotulo}</span>
            <span class="material-symbols-outlined wfm-outra-seta" aria-hidden="true">${IconeSvg('chevron_right')}</span>
          </button>`;
        })}
      </div>
    </section>`;
}
