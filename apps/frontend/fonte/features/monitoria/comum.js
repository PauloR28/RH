import { html, useCallback, useEffect, useRef, useState } from '../../infraestrutura-react.js';
import { IconeSvg } from '../../ui/icone.js';
import { lerContextoMonitoria } from '../../services/api/monitoria.js';

// Vertente Monitoria — peças compartilhadas pelas telas (tags, badges, formatação,
// carregamento do contexto do usuário: operações visíveis, tema, vínculos).

export const STATUS_INFO = {
  REALIZADA: { rotulo: 'Monitoria realizada', classe: 'info' },
  FEEDBACK_PENDENTE: { rotulo: 'Feedback pendente', classe: 'pendente' },
  FEEDBACK_APLICADO: { rotulo: 'Feedback aplicado', classe: 'info' },
  AGUARDANDO_CONFIRMACAO: { rotulo: 'Aguardando confirmação/contestação', classe: 'pendente' },
  CONFIRMADA: { rotulo: 'Confirmada', classe: 'ok' },
  CONTESTADA: { rotulo: 'Contestada', classe: 'pendente' },
  REANALISE: { rotulo: 'Em reanálise', classe: 'pendente' },
  ANULADA: { rotulo: 'Anulada', classe: 'nula' },
  FINALIZADA: { rotulo: 'Finalizada', classe: 'ok' },
};

export const RESPOSTAS = [
  { valor: 'SIM', rotulo: 'SIM', classe: 'is-sim' },
  { valor: 'NAO', rotulo: 'NÃO', classe: 'is-nao' },
  { valor: 'NCG', rotulo: 'NCG', classe: 'is-ncg' },
  { valor: 'NA', rotulo: 'N/A', classe: 'is-na' },
];

// Etiqueta do andamento da contestação, conforme quem olha: o operador vê "Em contestação",
// os demais perfis "Contestada"; ao dar baixa (monitoria finalizada/anulada) vira "Contestação encerrada".
export function etiquetaContestacao({ status, contestada = false, perfil = '' }) {
  if (['CONTESTADA', 'REANALISE'].includes(status)) {
    return { rotulo: perfil === 'operador' ? 'Em contestação' : 'Contestada', classe: 'pendente' };
  }
  if (contestada && ['CONFIRMADA', 'ANULADA', 'FINALIZADA'].includes(status)) return { rotulo: 'Contestação encerrada', classe: 'ok' };
  return null;
}

export function BadgeStatus({ status, rotulo, perfil = '', contestada = false }) {
  const etiqueta = etiquetaContestacao({ status, contestada, perfil });
  if (etiqueta) return html`<span class=${`mon-badge mon-badge--${etiqueta.classe}`}>${etiqueta.rotulo}</span>`;
  const info = STATUS_INFO[status] || { rotulo: rotulo || status, classe: '' };
  return html`<span class=${`mon-badge ${info.classe ? `mon-badge--${info.classe}` : ''}`}>${rotulo || info.rotulo}</span>`;
}

export function TagOperacao({ chave, nome, contexto }) {
  const operacao = (contexto?.operacoes || []).find((item) => item.chave === chave);
  const cor = operacao?.cor_primaria || '';
  return html`
    <span class="mon-tag" title=${`Operação ${nome || chave}`} style=${cor ? { '--tag-cor': cor } : null}>
      ${nome || operacao?.nome || chave}
    </span>
  `;
}

export function TagsMonitoria({ item }) {
  return html`
    ${item.possui_ncg ? html`<span class="mon-tag mon-tag--ncg" title="Não Conformidade Grave: nota zerada">NCG</span>` : null}
    ${item.anulada ? html`<span class="mon-tag mon-tag--anulada" title="Fora dos indicadores; mantida no histórico">Anulada</span>` : null}
  `;
}

export function BadgeSla({ sla }) {
  if (!sla) return null;
  if (sla.estado === 'VENCIDO') {
    return html`<span class="mon-sla mon-sla--vencido">Vencido há ${formatarHoras(sla.atraso_h)}</span>`;
  }
  if (sla.estado === 'PROXIMO_DO_VENCIMENTO') {
    return html`<span class="mon-sla mon-sla--proximo">Vence em ${formatarHoras(sla.restante_h)}</span>`;
  }
  if (sla.estado === 'DENTRO_DO_PRAZO') {
    return html`<span class="mon-sla mon-sla--dentro">${formatarHoras(sla.restante_h)} restantes</span>`;
  }
  return null;
}

export function formatarHoras(horas) {
  const total = Number(horas) || 0;
  if (total < 1) return `${Math.max(1, Math.round(total * 60))} min`;
  if (total < 48) return `${Math.floor(total)} h`;
  return `${Math.floor(total / 24)} d ${Math.floor(total % 24)} h`;
}

export function formatarNota(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  return Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatarData(valor) {
  if (!valor) return '—';
  const data = new Date(String(valor).length === 10 ? `${valor}T00:00:00` : valor);
  if (Number.isNaN(data.getTime())) return String(valor);
  return data.toLocaleDateString('pt-BR');
}

export function formatarDataHoraCurta(valor) {
  if (!valor) return '—';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return String(valor);
  return data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function baixarArquivo({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'arquivo';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function hoje() {
  return new Date().toISOString().slice(0, 10);
}

export function useContextoMonitoria() {
  const [contexto, setContexto] = useState(null);
  const [erro, setErro] = useState('');
  const carregar = useCallback(async () => {
    try {
      setContexto(await lerContextoMonitoria());
      setErro('');
    } catch (error) {
      setErro(error?.message || 'Não foi possível carregar o contexto da Monitoria.');
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);
  return { contexto, erro, recarregar: carregar };
}

export function SelectOperacao({ contexto, valor, onChange, todas = true, rotuloTodas = 'Todas as operações', desabilitado = false }) {
  const operacoes = contexto?.operacoes || [];
  return html`
    <select class="form-select" value=${valor} disabled=${desabilitado} onChange=${(e) => onChange(e.target.value)}>
      ${todas ? html`<option value="">${rotuloTodas}</option>` : null}
      ${operacoes.map((op) => html`<option key=${op.chave} value=${op.chave} disabled=${!op.ativo}>${op.nome}${op.ativo ? '' : ' (inativa)'}</option>`)}
    </select>
  `;
}

// Botão dropdown "Exportar" (ou outro menu curto de ações): fecha ao clicar fora ou com Esc.
export function BotaoExportar({ rotulo = 'Exportar', opcoes = [], desabilitado = false }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (raiz.current && !raiz.current.contains(e.target)) setAberto(false); };
    const esc = (e) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);
  return html`
    <div class="mon-dropdown" ref=${raiz}>
      <button type="button" class="btn btn-outline-primary mon-dropdown-btn" aria-haspopup="menu" aria-expanded=${aberto} disabled=${desabilitado} onClick=${() => setAberto(!aberto)}>
        <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('download')}</span>${rotulo}
        <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(aberto ? 'expand_less' : 'expand_more')}</span>
      </button>
      ${aberto ? html`
        <div class="mon-dropdown-menu" role="menu">
          ${opcoes.map((o) => html`<button key=${o.rotulo} type="button" role="menuitem" onClick=${() => { setAberto(false); o.onSelecionar(); }}>${o.rotulo}</button>`)}
        </div>` : null}
    </div>`;
}

// Dropdown com caixas de seleção (vários valores). Fecha ao clicar fora ou com Esc.
// `opcoes`: [{ valor, rotulo, desabilitado? }]; `valores`: lista dos valores marcados.
export function SelectMultiplo({ opcoes = [], valores = [], onChange, placeholder = 'Selecione…', vazio = 'Nenhuma opção disponível.', desabilitado = false, limite = 0, rotulo = '' }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (raiz.current && !raiz.current.contains(e.target)) setAberto(false); };
    const esc = (e) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);
  const marcadas = opcoes.filter((o) => valores.includes(o.valor));
  const resumo = !marcadas.length ? placeholder : marcadas.length <= 2 ? marcadas.map((o) => o.rotulo).join(', ') : `${marcadas.length} selecionados`;
  const alternar = (valor, marcado) => onChange(marcado ? [...valores, valor] : valores.filter((v) => v !== valor));
  return html`
    <div class="mon-multi" ref=${raiz}>
      <button type="button" class=${`form-select mon-multi-btn ${marcadas.length ? '' : 'is-vazio'}`} aria-haspopup="listbox" aria-expanded=${aberto}
        aria-label=${rotulo || undefined} disabled=${desabilitado} onClick=${() => setAberto(!aberto)}>${resumo}</button>
      ${aberto ? html`
        <div class="mon-multi-menu" role="listbox" aria-multiselectable="true">
          ${opcoes.length ? opcoes.map((o) => {
            const marcado = valores.includes(o.valor);
            const bloqueadaPeloLimite = limite > 0 && !marcado && valores.length >= limite;
            return html`<label key=${o.valor} class=${`mon-multi-item ${o.desabilitado || bloqueadaPeloLimite ? 'is-desabilitado' : ''}`}>
              <input type="checkbox" checked=${marcado} disabled=${o.desabilitado || bloqueadaPeloLimite} onChange=${(e) => alternar(o.valor, e.target.checked)} /><span>${o.rotulo}</span></label>`;
          }) : html`<span class="mon-multi-vazio">${vazio}</span>`}
        </div>` : null}
    </div>`;
}
