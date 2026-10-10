import { html, useEffect, useRef, useState } from '../../../infraestrutura-react.js';
import { IconeSvg } from '../../../ui/icone.js';
import { lerMetaChamados } from '../../../services/api/chamados.js?v=20261005-redesign16';

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

// Mensagem padrão (WhatsApp, e-mail): título com número e status, descrição e o link para acompanhar.
export function textoCompartilhar(chamado) {
  const status = chamado.status_rotulo || ROTULO_STATUS[chamado.status] || 'Aberto';
  const descricao = String(chamado.descricao || chamado.titulo || '').trim();
  const resumo = descricao.length > 400 ? `${descricao.slice(0, 397)}...` : descricao;
  return `CHAMADO #${chamado.numero} - ${status}
Descrição: ${resumo}

Acompanhe: ${linkDoChamado(chamado.id)}`;
}

// Ícones de marca que não existem no conjunto do sistema (WhatsApp é o glifo oficial simplificado, preenchido com a cor do texto).
export function IconeWhatsApp() {
  return html`<svg class="chm-i-marca" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>`;
}
// No computador usa o WhatsApp Web e a MESMA aba nomeada ("whatsapp-conecta"): o segundo compartilhamento reaproveita a aba aberta
// pelo primeiro em vez de abrir outra. No celular, wa.me abre o aplicativo.
export const ABA_WHATSAPP = 'whatsapp-conecta';
const ehCelular = () => /Android|iPhone|iPad|iPod/i.test(window.navigator?.userAgent || '');
export const linkWhatsApp = (chamado) =>
  `${ehCelular() ? 'https://wa.me/' : 'https://web.whatsapp.com/send'}?text=${encodeURIComponent(textoCompartilhar(chamado))}`;
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
      <a class="chm-share chm-share--whatsapp" href=${linkWhatsApp(chamado)} target=${ABA_WHATSAPP} rel="noopener noreferrer" onClick=${aoEscolher}>
        <${IconeWhatsApp} />WhatsApp
      </a>
      <a class="chm-share chm-share--email" href=${linkEmail(chamado)} onClick=${aoEscolher}>
        <${Icone} nome="mail" />E-mail
      </a>
      <button type="button" class="chm-share chm-share--link" onClick=${copiar}><${Icone} nome="content_copy" />Copiar link</button>
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
      <button type="button" class="btn chm-btn-share" aria-haspopup="menu" aria-expanded=${aberto} onClick=${() => setAberto((v) => !v)}>
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

/** Indicador numérico em card (usado no Dashboard). */
export function Indicador({ icone, valor, rotulo, tom = '' }) {
  return html`
    <div class=${`chm-kpi ${tom ? `chm-kpi--${tom}` : ''}`.trim()}>
      <span class="chm-kpi-icone"><${Icone} nome=${icone} grande=${true} /></span>
      <div><strong>${valor ?? '—'}</strong><small>${rotulo}</small></div>
    </div>`;
}

/** Conteúdo do rodapé da DataTable: faixa "de–até de total" e os botões de página. */
export function RodapePaginacao({ pagina, tamanho, total, aoMudar }) {
  if (!total) return null;
  const ultima = Math.max(1, Math.ceil(total / tamanho));
  const de = (pagina - 1) * tamanho + 1;
  const ate = Math.min(total, pagina * tamanho);
  return html`
    <span>${de}–${ate} de ${total}</span>
    <div class="chm-paginacao-botoes">
      <button type="button" class="btn btn-sm btn-outline-secondary" disabled=${pagina <= 1} onClick=${() => aoMudar(pagina - 1)}>Anterior</button>
      <button type="button" class="btn btn-sm btn-outline-secondary" disabled=${pagina >= ultima} onClick=${() => aoMudar(pagina + 1)}>Próxima</button>
    </div>`;
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
