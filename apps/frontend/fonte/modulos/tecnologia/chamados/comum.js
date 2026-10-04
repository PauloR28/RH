import { html, useEffect, useRef, useState } from '../../../infraestrutura-react.js';
import { IconeSvg } from '../../../ui/icone.js';
import { lerMetaChamados } from '../../../services/api/chamados.js';

// Chamados (Suporte TI) — peças comuns: ícone, pills, datas, SLA, navegação, compartilhamento.
// Estados e cores usam os tokens do Conecta (success/warning/danger/info); sem tela de personalização de tags.

export const TELA_LISTA = 'screen-chamados';
export const TELA_NOVO = 'screen-chamados-novo';
export const TELA_FILA = 'screen-chamados-fila';
export const TELA_DASHBOARD = 'screen-chamados-dashboard';
export const TELA_CONFIG = 'screen-chamados-config';
export const TELA_DETALHE = 'screen-chamados-detalhe';

export const ABAS_CHAMADOS = [
  { tela: TELA_LISTA, rotulo: 'Chamados', icone: 'inbox' },
  { tela: TELA_FILA, rotulo: 'Fila', icone: 'build' },
  { tela: TELA_DASHBOARD, rotulo: 'Dashboard', icone: 'bar_chart' },
  { tela: TELA_CONFIG, rotulo: 'Configurações', icone: 'settings' },
];

export const ROTULO_URGENCIA = { baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica' };
export const ORDEM_URGENCIA = ['baixa', 'media', 'alta', 'critica'];
const TOM_URGENCIA = { critica: 'bad', alta: 'bad', media: 'warn', baixa: 'neutral' };
export const ROTULO_STATUS = {
  aberto: 'Aberto',
  em_andamento: 'Em andamento',
  aguardando_solicitante: 'Aguardando solicitante',
  resolvido: 'Resolvido',
  encerrado: 'Encerrado',
  cancelado: 'Cancelado',
};
const TOM_STATUS = { aberto: 'neutral', em_andamento: 'info', aguardando_solicitante: 'warn', resolvido: 'ok', encerrado: 'neutral', cancelado: 'neutral' };

export function Icone({ nome, grande = false }) {
  return html`<span class=${`material-symbols-outlined chm-i ${grande ? 'chm-i--l' : ''}`.trim()} aria-hidden="true">${IconeSvg(nome)}</span>`;
}

export function Pill({ tom = 'neutral', children, semPonto = false }) {
  return html`<span class=${`chm-pill chm-pill--${tom} ${semPonto ? 'chm-pill--sem-ponto' : ''}`.trim()}>${children}</span>`;
}

export const PillUrgencia = ({ urgencia }) => html`<${Pill} tom=${TOM_URGENCIA[urgencia] || 'neutral'}>${ROTULO_URGENCIA[urgencia] || urgencia}</${Pill}>`;
export const PillStatus = ({ status, rotulo }) => html`<${Pill} tom=${TOM_STATUS[status] || 'neutral'}>${rotulo || ROTULO_STATUS[status] || status}</${Pill}>`;

export function Avatar({ nome = '', pequeno = false }) {
  const partes = String(nome).trim().split(/\s+/).filter(Boolean);
  const iniciais = ((partes[0]?.[0] || '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase() || '?';
  return html`<span class=${`chm-avatar ${pequeno ? 'chm-avatar--p' : ''}`.trim()} aria-hidden="true">${iniciais}</span>`;
}

// ---- datas (o backend manda UTC com "Z"; a tela mostra America/Sao_Paulo) ----
const FUSO = 'America/Sao_Paulo';
export function formatarDataHora(iso) {
  if (!iso) return '—';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export function formatarDataCompleta(iso) {
  if (!iso) return '—';
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? '—' : data.toLocaleString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function duracao(segundos) {
  const total = Math.max(0, Math.round(Math.abs(segundos) / 60));
  if (total < 60) return `${total} min`;
  const horas = Math.floor(total / 60);
  if (horas < 24) return `${horas} h${total % 60 ? ` ${total % 60} min` : ''}`;
  return `${Math.floor(horas / 24)} d${horas % 24 ? ` ${horas % 24} h` : ''}`;
}

export function tempoRelativo(iso) {
  if (!iso) return '—';
  const segundos = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(segundos)) return '—';
  if (segundos < 60) return 'agora';
  if (segundos < 86400 * 2) return `há ${duracao(segundos)}`;
  return formatarDataHora(iso);
}

/** Resumo do SLA para pills e células: { texto, tom } ou null quando o prazo não conta (resolvido, encerrado, cancelado). */
export function descreverSla(item) {
  const sla = item?.sla;
  if (!sla) return null;
  if (sla.pausado) return { texto: 'SLA pausado', tom: 'info', icone: 'pause_circle' };
  if (!sla.contando) return null;
  if (sla.vencido) return { texto: `Vencido há ${duracao(sla.restante_seg)}`, tom: 'bad', icone: 'warning' };
  if (sla.restante_seg < 3600) return { texto: `Vence em ${duracao(sla.restante_seg)}`, tom: 'warn', icone: 'schedule' };
  return { texto: `Vence em ${duracao(sla.restante_seg)}`, tom: 'neutral', icone: 'schedule' };
}

export function PillSla({ item }) {
  const sla = descreverSla(item);
  return sla ? html`<${Pill} tom=${sla.tom}>${sla.texto}</${Pill}>` : html`<span class="chm-muted">—</span>`;
}

// ---- navegação ----
export function irPara(caminho) {
  window.history.pushState(null, '', caminho);
  window.dispatchEvent(typeof PopStateEvent === 'function' ? new PopStateEvent('popstate') : new Event('popstate'));
}
export const irParaChamado = (id) => irPara(`/suporte-ti/chamado/${id}`);

// ---- metadados (categorias, urgências, limites, operações do usuário): carrega uma vez ----
let metaEmCache = null;
export function useMetaChamados() {
  const [meta, setMeta] = useState(metaEmCache);
  const [erro, setErro] = useState('');
  useEffect(() => {
    let ativo = true;
    lerMetaChamados()
      .then((dados) => { metaEmCache = dados; if (ativo) setMeta(dados); })
      .catch((e) => { if (ativo) setErro(e?.message || 'Não foi possível carregar os dados do Suporte TI.'); });
    return () => { ativo = false; };
  }, []);
  return { meta, erro };
}

export function useDebounce(valor, atrasoMs = 300) {
  const [debounced, setDebounced] = useState(valor);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(valor), atrasoMs);
    return () => window.clearTimeout(id);
  }, [valor, atrasoMs]);
  return debounced;
}

// ---- compartilhar (WhatsApp, e-mail, copiar link). Nada é enviado pelo servidor; a mensagem leva só número, título, urgência e link. ----
export const linkDoChamado = (id) => `${window.location.origin}/suporte-ti/chamado/${id}`;

export function textoCompartilhar(chamado) {
  const urgencia = ROTULO_URGENCIA[chamado.urgencia] || '';
  return `Chamado #${chamado.numero} aberto no Suporte TI: ${chamado.titulo}${urgencia ? ` (${urgencia})` : ''}. Acompanhe: ${linkDoChamado(chamado.id)}`;
}
export const linkWhatsApp = (chamado) => `https://wa.me/?text=${encodeURIComponent(textoCompartilhar(chamado))}`;
export const linkEmail = (chamado) =>
  `mailto:?subject=${encodeURIComponent(`Chamado #${chamado.numero} — Suporte TI`)}&body=${encodeURIComponent(textoCompartilhar(chamado))}`;

export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const campo = document.createElement('textarea');
    campo.value = texto;
    campo.style.position = 'fixed';
    campo.style.opacity = '0';
    document.body.appendChild(campo);
    campo.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(campo);
    return ok;
  }
}

export function AcoesCompartilhar({ chamado, showToast, aoEscolher = null }) {
  const copiar = async () => {
    const ok = await copiarTexto(linkDoChamado(chamado.id));
    showToast?.(ok ? 'Link copiado.' : 'Não foi possível copiar o link.', ok ? 'success' : 'error');
    aoEscolher?.();
  };
  return html`
    <div class="chm-compartilhar">
      <a class="btn btn-outline-secondary" href=${linkWhatsApp(chamado)} target="_blank" rel="noopener noreferrer" onClick=${aoEscolher}>
        <${Icone} nome="chat" />WhatsApp
      </a>
      <a class="btn btn-outline-secondary" href=${linkEmail(chamado)} onClick=${aoEscolher}>
        <${Icone} nome="mail" />E-mail
      </a>
      <button type="button" class="btn btn-outline-secondary" onClick=${copiar}><${Icone} nome="content_copy" />Copiar link</button>
    </div>`;
}

/** Botão "Compartilhar" com popover (usado no cabeçalho do detalhe). */
export function MenuCompartilhar({ chamado, showToast }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (evento) => { if (raiz.current && !raiz.current.contains(evento.target)) setAberto(false); };
    const esc = (evento) => { if (evento.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);
  return html`
    <div class="chm-pop" ref=${raiz}>
      <button type="button" class="btn btn-outline-secondary" aria-haspopup="menu" aria-expanded=${aberto} onClick=${() => setAberto((v) => !v)}>
        <${Icone} nome="share" />Compartilhar<${Icone} nome="expand_more" />
      </button>
      ${aberto ? html`<div class="chm-pop-menu" role="menu"><${AcoesCompartilhar} chamado=${chamado} showToast=${showToast} aoEscolher=${() => setAberto(false)} /></div>` : null}
    </div>`;
}

export function EstadoErro({ erro, aoTentar }) {
  return html`
    <div class="alert alert-warning chm-alerta" role="alert">
      <span>${erro}</span>
      ${aoTentar ? html`<button type="button" class="btn btn-sm btn-outline-secondary" onClick=${aoTentar}>Tentar de novo</button>` : null}
    </div>`;
}

export function AcessoRestrito({ controlador }) {
  return html`
    <section class="chm-card chm-restrito">
      <span class="chm-restrito-icone"><${Icone} nome="lock" grande=${true} /></span>
      <h3>Acesso restrito</h3>
      <p>Você não tem permissão para acessar este chamado. Se precisa reportar um problema, avise o seu supervisor.</p>
      <button type="button" class="btn btn-primary" onClick=${() => controlador.irParaMenu()}>Voltar ao início</button>
    </section>`;
}

export function Paginacao({ pagina, tamanho, total, aoMudar }) {
  if (total <= tamanho) return null;
  const ultima = Math.max(1, Math.ceil(total / tamanho));
  const de = (pagina - 1) * tamanho + 1;
  const ate = Math.min(total, pagina * tamanho);
  return html`
    <div class="chm-paginacao">
      <span class="chm-muted">${de}–${ate} de ${total}</span>
      <div class="chm-paginacao-botoes">
        <button type="button" class="btn btn-sm btn-outline-secondary" disabled=${pagina <= 1} onClick=${() => aoMudar(pagina - 1)}>Anterior</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" disabled=${pagina >= ultima} onClick=${() => aoMudar(pagina + 1)}>Próxima</button>
      </div>
    </div>`;
}

export function tamanhoLegivel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
