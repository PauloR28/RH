import { html, useEffect, useMemo, useRef, useState } from '../../infraestrutura-react.js';
import { PainelRh } from '../../ui/componentes-compartilhados.js';
import { Esqueleto, Estado, Ic, Janela, MenuAcoes, Segmento, Selo } from '../../ui/components/ds.js?v=20261106-wfm';
import { useToast } from '../../shared/hooks/use-toast.js';
import {
  arquivarPublicacaoMural,
  criarPublicacaoMural,
  excluirPublicacaoMural,
  listarAmbientesMural,
  listarMural,
  publicarMural,
  restaurarPublicacaoMural,
  atualizarPublicacaoMural,
  uploadImagemMural,
} from '../../services/api/mural.js';

// Mural (redesign Fase 15, fatia 4, amostra Q5 do lote 2): página do Mural (Início › Ver tudo) e a aba Mural de Equipes
// (`embutido`, com a API de escopo da equipe). Cabeçalho com voltar, "Mural" e "Nova publicação"; caixa com o filtro
// Publicados/Rascunhos/Arquivados (com contagem), busca, Tipo, Intranet e Cartões/Lista; grade de 3 cartões (capa, selos
// Fixado e tipo, ⋯, título, resumo em 2 linhas, data · quem e o envio por intranet). Janela "Nova publicação" de 800 px.
// Mesmas rotas e regras de antes (inclusive a publicação no SharePoint).

// API do Mural usada pela tela. O padrão é o Mural do RH (/mural); a aba Mural de Equipes injeta a versão com escopo
// da operação do supervisor (/equipes/mural).
export const API_MURAL_GLOBAL = {
  listar: listarMural,
  ambientes: listarAmbientesMural,
  criar: criarPublicacaoMural,
  atualizar: atualizarPublicacaoMural,
  arquivar: arquivarPublicacaoMural,
  restaurar: restaurarPublicacaoMural,
  publicar: publicarMural,
  excluir: excluirPublicacaoMural,
  upload: uploadImagemMural,
};

const CATEGORIAS_MURAL = ['Aviso', 'Comunicado', 'Evento', 'Campanha', 'Institucional'];
const TIPOS_PUBLICACAO = [['texto', 'Só texto'], ['imagem', 'Só imagem'], ['texto_imagem', 'Texto e imagem']];
const FORM_INICIAL = { titulo: '', resumo: '', conteudo_html: '', categoria: '', fixado: false, imagens: [], ambientes: [] };
const POR_PAGINA = 6;
const pad = (n) => String(n).padStart(2, '0');
// "08/11/2026 14:27" (sem segundos), para cartões e janelas.
const formatarDataHora = (valor) => { if (!valor) return '—'; const d = new Date(valor); return Number.isNaN(d.getTime()) ? String(valor) : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const montarConteudoSomenteImagem = (imagens) => (imagens || []).map((url) => `<img src="${url}" alt="" style="max-width:100%;border-radius:8px;margin:8px 0;" />`).join('');
function obterTextoPlano(conteudo) {
  if (typeof document === 'undefined') return String(conteudo || '').replace(/<[^>]+>/g, ' ');
  const elemento = document.createElement('div');
  elemento.innerHTML = String(conteudo || '');
  return elemento.textContent || elemento.innerText || '';
}
function obterResumoExibicao(publicacao) {
  const resumo = (publicacao.resumo || '').trim();
  if (resumo) return resumo;
  const texto = obterTextoPlano(publicacao.conteudo_html).trim();
  return texto.length > 220 ? `${texto.slice(0, 220)}…` : texto;
}
const limparHtmlVazio = (valor) => {
  const conteudo = String(valor || '').trim();
  return !conteudo || /^((<div><br><\/div>)|(<br\s*\/?>)|(&nbsp;)|\s)+$/i.test(conteudo) ? '' : conteudo;
};

// Envio por intranet: ✓ enviado (verde, abre no SharePoint) · ⚠ falhou (vermelho) · pendente.
function EnvioIntranet({ ambiente }) {
  const nome = ambiente.ambiente_nome || 'Intranet';
  if (ambiente.status_envio === 'enviado') {
    const conteudo = html`<${Ic} nome="check" />${nome}`;
    return ambiente.sharepoint_web_url
      ? html`<a class="c-mu-env c-mu-env--sucesso" href=${ambiente.sharepoint_web_url} target="_blank" rel="noopener noreferrer" title="Abrir no SharePoint">${conteudo}</a>`
      : html`<span class="c-mu-env c-mu-env--sucesso" title="Enviado">${conteudo}</span>`;
  }
  if (ambiente.status_envio === 'erro') return html`<span class="c-mu-env c-mu-env--perigo" title=${ambiente.mensagem_erro || 'Falhou'}><${Ic} nome="warning" />${nome}</span>`;
  return html`<span class="c-mu-env" title="Pendente"><${Ic} nome="clock" />${nome}</span>`;
}

// Editor de texto do Mural: N, I, S, listas, link e alinhamento (document.execCommand, como antes).
function EditorMural({ valor, onChange }) {
  const ref = useRef(null);
  const ultimo = useRef(null);
  useEffect(() => {
    if (!ref.current || valor === ultimo.current) return;
    if (ref.current.innerHTML !== (valor || '')) ref.current.innerHTML = valor || '';
  }, [valor]);
  const sincronizar = () => { if (!ref.current) return; const c = limparHtmlVazio(ref.current.innerHTML); ultimo.current = c; onChange(c); };
  const cmd = (comando, arg = null) => (ev) => { ev.preventDefault(); ref.current?.focus(); document.execCommand(comando, false, arg); sincronizar(); };
  const link = (ev) => {
    ev.preventDefault();
    const url = window.prompt('Endereço do link (https://…)');
    if (!url) return;
    ref.current?.focus();
    document.execCommand('createLink', false, /^https?:\/\//i.test(url) ? url : `https://${url}`);
    sincronizar();
  };
  const tamanho = (ev) => { const v = ev.target.value; if (!v) return; ref.current?.focus(); document.execCommand('fontSize', false, v); sincronizar(); ev.target.value = ''; };
  const botao = (titulo, conteudo, aoClicar) => html`<button type="button" title=${titulo} aria-label=${titulo} onMouseDown=${aoClicar}>${conteudo}</button>`;
  return html`<div class="c-mu-editor">
    <div class="c-mu-ferr" role="toolbar" aria-label="Formatação do texto">
      ${botao('Negrito', html`<b>N</b>`, cmd('bold'))}
      ${botao('Itálico', html`<i>I</i>`, cmd('italic'))}
      ${botao('Sublinhado', html`<u>S</u>`, cmd('underline'))}
      ${botao('Lista com marcadores', html`<${Ic} nome="list-bullets" />`, cmd('insertUnorderedList'))}
      ${botao('Lista numerada', html`<${Ic} nome="list-numbers" />`, cmd('insertOrderedList'))}
      ${botao('Link', html`<${Ic} nome="link" />`, link)}
      ${botao('Alinhar à esquerda', html`<${Ic} nome="text-align-left" />`, cmd('justifyLeft'))}
      ${botao('Centralizar', html`<${Ic} nome="text-align-center" />`, cmd('justifyCenter'))}
      <select class="c-entrada c-entrada--compacta c-mu-tam" aria-label="Tamanho da letra" value="" onChange=${tamanho}>
        <option value="">Tamanho</option><option value="2">12</option><option value="3">14</option><option value="4">16</option><option value="5">18</option><option value="6">24</option>
      </select>
    </div>
    <div ref=${ref} class="c-mu-texto" contentEditable="true" role="textbox" aria-multiline="true" aria-label="Conteúdo" spellcheck="true" suppressContentEditableWarning=${true}
      data-gramm="false" onInput=${sincronizar} onBlur=${sincronizar}></div>
  </div>`;
}

function Imagens({ imagens = [], onChange, disabled = false, upload, showToast }) {
  const [enviando, setEnviando] = useState(false);
  const entrada = useRef(null);
  const enviar = async (ev) => {
    const arquivo = ev.target.files?.[0];
    ev.target.value = '';
    if (!arquivo) return;
    setEnviando(true);
    try { const r = await upload(arquivo); onChange([...(imagens || []), r.url]); } catch (e) { showToast(e?.message || 'Não foi possível enviar a imagem.', 'danger'); } finally { setEnviando(false); }
  };
  return html`<div class="c-mu-imgs">
    ${imagens.map((url) => html`<span key=${url} class="c-mu-img" style=${{ position: 'relative', overflow: 'hidden', padding: 0 }}>
      <img src=${url} alt="" style=${{ width: '100%', height: '100%', objectFit: 'cover' }} />
      <button type="button" class="c-botao c-botao--secundario c-botao--icone c-botao--compacto" style=${{ position: 'absolute', top: '4px', right: '4px', width: '24px', height: '24px', minHeight: 0 }} aria-label="Remover imagem" title="Remover imagem" disabled=${disabled || null} onClick=${() => onChange(imagens.filter((x) => x !== url))}><${Ic} nome="x" /></button>
    </span>`)}
    <button type="button" class="c-mu-img--add" disabled=${disabled || enviando || null} onClick=${() => entrada.current?.click()}><${Ic} nome=${enviando ? 'hourglass' : 'plus'} /><small>${enviando ? 'Enviando…' : 'Adicionar'}</small></button>
    <input ref=${entrada} type="file" accept="image/png,image/jpeg" class="c-oculto" tabIndex="-1" aria-hidden="true" onChange=${enviar} />
  </div>`;
}

function Cartao({ publicacao: p, acoes, aoVer }) {
  const capa = p.imagens?.[0]?.url;
  return html`<article class=${`c-mu-cartao ${p.fixado ? 'c-mu-cartao--fixo' : ''}`.trim()}>
    ${capa ? html`<div class="c-mu-capa" style=${{ overflow: 'hidden' }}><img src=${capa} alt="" style=${{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>` : null}
    <div class="c-mu-topo">
      ${p.fixado ? html`<${Selo} tom="informacao" icone="flag">Fixado<//>` : null}
      ${p.categoria ? html`<${Selo} tom="neutro">${p.categoria}<//>` : null}
      ${p.status === 'rascunho' ? html`<${Selo} tom="neutro">Rascunho<//>` : p.status === 'arquivado' ? html`<${Selo} tom="neutro" icone="archive">Arquivado<//>` : null}
      <${MenuAcoes} rotulo=${`Ações de ${p.titulo}`} acoes=${acoes} />
    </div>
    <h3><a href="#" onClick=${(e) => { e.preventDefault(); aoVer(p); }}>${p.titulo}</a></h3>
    <p>${obterResumoExibicao(p)}</p>
    <div class="c-mu-pe">
      <span>${formatarDataHora(p.publicado_em || p.criado_em)}${p.criado_por ? ` · ${p.criado_por}` : ''}</span>
      ${(p.ambientes || []).length ? html`<span class="c-mu-amb">${p.ambientes.map((a) => html`<${EnvioIntranet} key=${a.id_ambiente} ambiente=${a} />`)}</span>` : null}
    </div>
  </article>`;
}

export function TelaMural({ controlador, embutido = false, api = API_MURAL_GLOBAL, rotuloAmbientes = 'Publicar também nas intranets (SharePoint)' }) {
  const { showToast, ToastHost } = useToast();
  const podeVisualizar = embutido ? true : controlador.possuiPermissao('mural.visualizar');
  const podeCriar = embutido ? true : controlador.possuiPermissao('mural.criar');
  const podeEditar = embutido ? true : controlador.possuiPermissao('mural.editar');
  const podeExcluir = embutido ? true : controlador.possuiPermissao('mural.excluir');

  const [carregando, setCarregando] = useState(true);
  const [publicacoes, setPublicacoes] = useState([]);
  const [contagens, setContagens] = useState({});
  const [ambientesDisponiveis, setAmbientesDisponiveis] = useState([]);
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroData, setFiltroData] = useState('');
  const [filtroAmbiente, setFiltroAmbiente] = useState('');
  const [busca, setBusca] = useState('');
  const [visualizacao, setVisualizacao] = useState('grade');
  const [limite, setLimite] = useState(POR_PAGINA);
  const [tipoPublicacao, setTipoPublicacao] = useState('texto_imagem');
  const [modalAberto, setModalAberto] = useState(false);
  const [publicacaoEmEdicao, setPublicacaoEmEdicao] = useState(null);
  const [form, setForm] = useState(FORM_INICIAL);
  const [salvando, setSalvando] = useState(false);
  const [publicacaoParaExcluir, setPublicacaoParaExcluir] = useState(null);
  const [publicacaoVisualizando, setPublicacaoVisualizando] = useState(null);

  const carregar = async (statusFiltro = filtroStatus) => {
    setCarregando(true);
    try {
      const [feed, ambientes, rascunhos, arquivados] = await Promise.allSettled([
        api.listar(statusFiltro),
        podeCriar || podeEditar ? api.ambientes() : Promise.resolve({ itens: [] }),
        podeEditar && statusFiltro !== 'rascunho' ? api.listar('rascunho') : Promise.resolve(null),
        podeEditar && statusFiltro !== 'arquivado' ? api.listar('arquivado') : Promise.resolve(null),
      ]);
      const itens = feed.status === 'fulfilled' ? feed.value?.itens || [] : [];
      setPublicacoes(itens);
      setAmbientesDisponiveis(ambientes.status === 'fulfilled' ? ambientes.value?.itens || [] : []);
      const n = (r) => (r.status === 'fulfilled' && r.value ? (r.value.itens || []).length : undefined);
      setContagens((c) => ({ ...c, [statusFiltro]: itens.length, ...(n(rascunhos) !== undefined ? { rascunho: n(rascunhos) } : {}), ...(n(arquivados) !== undefined ? { arquivado: n(arquivados) } : {}) }));
      if (feed.status === 'rejected') showToast(feed.reason?.message || 'Não foi possível carregar o Mural.', 'danger');
    } finally { setCarregando(false); }
  };

  useEffect(() => { if (podeVisualizar) { setLimite(POR_PAGINA); carregar(filtroStatus); } }, [filtroStatus]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const lista = publicacoes.filter((item) => {
      if (filtroCategoria && item.categoria !== filtroCategoria) return false;
      if (filtroData && String(item.publicado_em || item.criado_em || '').slice(0, 10) !== filtroData) return false;
      if (filtroAmbiente && !(item.ambientes || []).some((a) => String(a.id_ambiente) === filtroAmbiente)) return false;
      if (q && !`${item.titulo} ${item.resumo || ''} ${obterTextoPlano(item.conteudo_html)}`.toLowerCase().includes(q)) return false;
      return true;
    });
    return [...lista.filter((i) => i.fixado), ...lista.filter((i) => !i.fixado)];
  }, [publicacoes, filtroCategoria, filtroData, filtroAmbiente, busca]);
  const mostradas = filtradas.slice(0, limite);
  const filtrosAtivos = !!(filtroCategoria || filtroData || filtroAmbiente || busca.trim());

  const abrirNova = () => { setTipoPublicacao('texto_imagem'); setPublicacaoEmEdicao(null); setForm(FORM_INICIAL); setModalAberto(true); };
  const abrirEdicao = (p) => {
    setTipoPublicacao('texto_imagem');
    setPublicacaoEmEdicao(p);
    setForm({ titulo: p.titulo || '', resumo: p.resumo || '', conteudo_html: p.conteudo_html || '', categoria: p.categoria || '', fixado: !!p.fixado,
      imagens: (p.imagens || []).map((i) => i.url), ambientes: (p.ambientes || []).map((a) => a.id_ambiente) });
    setModalAberto(true);
  };
  const fecharModal = () => { if (!salvando) setModalAberto(false); };
  const alternarAmbiente = (id) => setForm((f) => ({ ...f, ambientes: f.ambientes.includes(id) ? f.ambientes.filter((x) => x !== id) : [...f.ambientes, id] }));

  const salvarPublicacao = async ({ publicarAgora = false } = {}) => {
    if (!form.titulo.trim()) { showToast('Informe o título da publicação.', 'warning'); return; }
    if (!form.categoria) { showToast('Selecione o tipo de aviso.', 'warning'); return; }
    if (tipoPublicacao === 'imagem' && !form.imagens.length) { showToast('Adicione ao menos uma imagem.', 'warning'); return; }
    if (tipoPublicacao !== 'imagem' && !obterTextoPlano(form.conteudo_html).trim()) { showToast('Escreva o conteúdo da publicação.', 'warning'); return; }
    const payload = tipoPublicacao === 'imagem' ? { ...form, conteudo_html: montarConteudoSomenteImagem(form.imagens) }
      : tipoPublicacao === 'texto' ? { ...form, imagens: [] } : form;
    setSalvando(true);
    try {
      const r = publicacaoEmEdicao ? await api.atualizar(publicacaoEmEdicao.id_publicacao, payload) : await api.criar(payload);
      if (publicarAgora) await api.publicar(r.id_publicacao, form.ambientes);
      showToast(publicarAgora ? 'Publicação enviada para as intranets.' : 'Rascunho salvo.', 'success');
      setModalAberto(false);
      await carregar();
    } catch (e) { showToast(e?.message || 'Não foi possível salvar a publicação.', 'danger'); } finally { setSalvando(false); }
  };

  const executar = async (fn, ok, falha) => { try { await fn(); if (ok) showToast(ok, 'success'); await carregar(); } catch (e) { showToast(e?.message || falha, 'danger'); } };
  const fixar = (p) => executar(() => api.atualizar(p.id_publicacao, { titulo: p.titulo, resumo: p.resumo, conteudo_html: p.conteudo_html, categoria: p.categoria, fixado: !p.fixado,
    imagens: (p.imagens || []).map((i) => i.url), ambientes: (p.ambientes || []).map((a) => a.id_ambiente) }), p.fixado ? 'Publicação desafixada.' : 'Publicação fixada no topo.', 'Não foi possível atualizar a publicação.');
  const publicarExistente = (p) => { const ids = (p.ambientes || []).map((a) => a.id_ambiente); return executar(() => api.publicar(p.id_publicacao, ids.length ? ids : ambientesDisponiveis.map((a) => a.id_ambiente)), 'Publicação enviada para as intranets.', 'Não foi possível publicar.'); };
  const confirmarExclusao = async () => {
    const p = publicacaoParaExcluir;
    if (!p) return;
    setPublicacaoParaExcluir(null);
    await executar(() => api.excluir(p.id_publicacao), 'Publicação excluída.', 'Não foi possível excluir.');
  };
  const acoesDe = (p) => {
    const lista = [{ label: 'Abrir', icon: 'eye', onClick: () => setPublicacaoVisualizando(p) }];
    if (podeEditar) {
      lista.push({ label: 'Editar', icon: 'pencil-simple', onClick: () => abrirEdicao(p) });
      lista.push({ label: p.fixado ? 'Desafixar' : 'Fixar no topo', icon: 'flag', onClick: () => fixar(p) });
      if (p.status !== 'publicado' || (p.ambientes || []).some((a) => a.status_envio !== 'enviado')) lista.push({ label: 'Publicar nas intranets', icon: 'paper-plane-tilt', onClick: () => publicarExistente(p) });
      lista.push(p.status === 'arquivado'
        ? { label: 'Restaurar', icon: 'arrow-counter-clockwise', onClick: () => executar(() => api.restaurar(p.id_publicacao), 'Publicação restaurada.', 'Não foi possível restaurar.') }
        : { label: 'Arquivar', icon: 'archive', onClick: () => executar(() => api.arquivar(p.id_publicacao), 'Publicação arquivada.', 'Não foi possível arquivar.') });
    }
    if (podeExcluir) lista.push({ label: 'Excluir', icon: 'trash', perigo: true, onClick: () => setPublicacaoParaExcluir(p) });
    return lista;
  };

  if (!podeVisualizar) {
    return html`<${PainelRh} screenId="screen-mural" navAtiva="screen-mural" subtituloMarca="Mural" placeholderBusca="Mural" controlador=${controlador}>
      <main class="c-pagina c-conteudo"><div class="c-tabela-caixa"><${Estado} icone="lock" titulo="Sem acesso" texto="Você não tem permissão para ver o Mural." /></div></main>
    </${PainelRh}>`;
  }

  const n = (s) => contagens[s];
  const opcoesStatus = podeEditar ? [['', 'Publicados', n('')], ['rascunho', 'Rascunhos', n('rascunho')], ['arquivado', 'Arquivados', n('arquivado')]] : null;
  const botaoNova = podeCriar ? html`<button type="button" class=${`c-botao c-botao--principal${embutido ? ' c-botao--compacto' : ''}`} onClick=${abrirNova}><${Ic} nome="plus" />Nova publicação</button>` : null;

  const caixa = html`<div class="c-tabela-caixa">
    <div class="c-filtros c-filtros--suave c-filtros--quebra">
      ${opcoesStatus ? html`<${Segmento} mini=${true} rotulo="Situação da publicação" valor=${filtroStatus} aoMudar=${setFiltroStatus} opcoes=${opcoesStatus} />` : null}
      <div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" /><input class="c-entrada c-entrada--compacta" type="search" placeholder="Buscar no Mural" aria-label="Buscar no Mural" value=${busca} onInput=${(e) => { setBusca(e.target.value); setLimite(POR_PAGINA); }} /></div>
      <select class="c-entrada c-entrada--compacta" aria-label="Tipo" value=${filtroCategoria} onChange=${(e) => { setFiltroCategoria(e.target.value); setLimite(POR_PAGINA); }}><option value="">Tipo: todos</option>${CATEGORIAS_MURAL.map((c) => html`<option key=${c} value=${c}>${c}</option>`)}</select>
      ${ambientesDisponiveis.length ? html`<select class="c-entrada c-entrada--compacta" aria-label="Intranet" value=${filtroAmbiente} onChange=${(e) => { setFiltroAmbiente(e.target.value); setLimite(POR_PAGINA); }}><option value="">Intranet: todas</option>${ambientesDisponiveis.map((a) => html`<option key=${a.id_ambiente} value=${String(a.id_ambiente)}>${a.nome}</option>`)}</select>` : null}
      <input class="c-entrada c-entrada--compacta" type="date" aria-label="Data" title="Data da publicação" value=${filtroData} onChange=${(e) => { setFiltroData(e.target.value); setLimite(POR_PAGINA); }} />
      ${filtrosAtivos ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => { setFiltroCategoria(''); setFiltroData(''); setFiltroAmbiente(''); setBusca(''); }}>Limpar</button>` : null}
      <div class="c-segmento c-segmento--mini c-fim" role="group" aria-label="Ver como">${[['grade', 'Cartões', 'squares-four'], ['lista', 'Lista', 'list']].map(([v, r, ic]) => html`<button key=${v} type="button" class="c-botao c-botao--icone" aria-pressed=${visualizacao === v ? 'true' : 'false'} aria-label=${r} title=${r} onClick=${() => setVisualizacao(v)}><${Ic} nome=${ic} /></button>`)}</div>
      ${embutido ? botaoNova : null}
    </div>
    ${carregando ? html`<${Esqueleto} linhas=${6} />`
      : !filtradas.length ? html`<${Estado} icone="megaphone" titulo=${filtrosAtivos || filtroStatus ? 'Nenhuma publicação encontrada.' : 'Nenhuma publicação ainda.'}
          texto=${filtrosAtivos ? 'Nenhuma publicação corresponde aos filtros.' : 'Avisos e comunicados publicados aparecem aqui.'} rotuloAcao=${filtrosAtivos ? 'Limpar filtros' : undefined} aoAcao=${() => { setFiltroCategoria(''); setFiltroData(''); setFiltroAmbiente(''); setBusca(''); }} />`
      : visualizacao === 'grade'
        ? html`<div class="c-mu-grade">${mostradas.map((p) => html`<${Cartao} key=${p.id_publicacao} publicacao=${p} acoes=${acoesDe(p)} aoVer=${setPublicacaoVisualizando} />`)}</div>`
        : html`<table class="c-tabela c-mu-lista">
          <thead><tr><th scope="col" class="c-estica">Título</th><th scope="col">Tipo</th><th scope="col" class="c-col-opc">Quando</th><th scope="col">Intranets</th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead>
          <tbody>${mostradas.map((p) => html`<tr key=${p.id_publicacao} class="c-clicavel" onClick=${(e) => { if (!e.target.closest('button, a, .c-abre-menu')) setPublicacaoVisualizando(p); }}>
            <td class="c-estica" data-papel="titulo"><span class="c-duas"><span class="c-forte">${p.fixado ? html`<${Ic} nome="flag" /> ` : null}${p.titulo}</span><small>${obterResumoExibicao(p).slice(0, 90)}</small></span></td>
            <td data-papel="selo">${p.categoria ? html`<${Selo} tom="neutro">${p.categoria}<//>` : '—'}</td>
            <td class="c-col-opc c-secundario">${formatarDataHora(p.publicado_em || p.criado_em)}</td>
            <td data-papel="info" data-prioridade="1" data-primeira=""><span class="c-mu-amb">${(p.ambientes || []).length ? p.ambientes.map((a) => html`<${EnvioIntranet} key=${a.id_ambiente} ambiente=${a} />`) : html`<span class="c-secundario">—</span>`}</span></td>
            <td class="c-acoes" data-papel="acoes"><${MenuAcoes} rotulo=${`Ações de ${p.titulo}`} acoes=${acoesDe(p)} /></td>
          </tr>`)}</tbody>
        </table>`}
    ${!carregando && filtradas.length ? html`<div class="c-tabela-rodape"><span>${mostradas.length} de ${filtradas.length} ${{ '': 'publicados', rascunho: 'rascunhos', arquivado: 'arquivados' }[filtroStatus] || ''}</span>
      ${mostradas.length < filtradas.length ? html`<button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => setLimite((l) => l + POR_PAGINA)}>Mostrar mais</button>` : null}</div>` : null}
  </div>`;

  const janelas = html`
    ${modalAberto ? html`<${Janela} titulo=${publicacaoEmEdicao ? 'Editar publicação' : 'Nova publicação'} tamanho="grande" onClose=${fecharModal}
      rodape=${html`<button type="button" class="c-botao c-botao--secundario" style=${{ marginRight: 'auto' }} disabled=${salvando || null} onClick=${fecharModal}>Cancelar</button>
        <button type="button" class="c-botao c-botao--secundario" aria-busy=${salvando ? 'true' : null} disabled=${salvando || null} onClick=${() => salvarPublicacao({ publicarAgora: false })}>Salvar rascunho</button>
        <button type="button" class="c-botao c-botao--principal" aria-busy=${salvando ? 'true' : null} disabled=${salvando || null} onClick=${() => salvarPublicacao({ publicarAgora: true })}><${Ic} nome="paper-plane-tilt" />Publicar</button>`}>
      <div class="c-janela-corpo c-mu-form">
        <div class="c-campo"><span class="c-rotulo">Tipo</span><${Segmento} rotulo="Tipo da publicação" valor=${tipoPublicacao} aoMudar=${setTipoPublicacao} opcoes=${TIPOS_PUBLICACAO} /></div>
        <div class="c-mu-linha">
          <label class="c-campo" style=${{ flex: '1 1 0' }}><span class="c-rotulo">Título</span><input class="c-entrada" maxlength="200" value=${form.titulo} disabled=${salvando || null} onInput=${(e) => setForm({ ...form, titulo: e.target.value })} /></label>
          <label class="c-campo" style=${{ width: '200px', flex: 'none' }}><span class="c-rotulo">Tipo de aviso</span><select class="c-entrada" value=${form.categoria} disabled=${salvando || null} onChange=${(e) => setForm({ ...form, categoria: e.target.value })}>
            <option value="" disabled>Selecione</option>${CATEGORIAS_MURAL.map((c) => html`<option key=${c} value=${c}>${c}</option>`)}</select></label>
        </div>
        <label class="c-campo"><span class="c-rotulo">Resumo <small>(opcional · aparece no cartão)</small></span><input class="c-entrada" maxlength="300" value=${form.resumo} disabled=${salvando || null} onInput=${(e) => setForm({ ...form, resumo: e.target.value })} /></label>
        ${tipoPublicacao !== 'imagem' ? html`<div class="c-campo"><span class="c-rotulo">Conteúdo</span><${EditorMural} valor=${form.conteudo_html} onChange=${(c) => setForm((f) => ({ ...f, conteudo_html: c }))} /></div>` : null}
        ${tipoPublicacao !== 'texto' ? html`<div class="c-campo"><span class="c-rotulo">Imagens <small>(PNG ou JPG)</small></span><${Imagens} upload=${api.upload} imagens=${form.imagens} disabled=${salvando} showToast=${showToast} onChange=${(imagens) => setForm((f) => ({ ...f, imagens }))} /></div>` : null}
        <label class="c-interruptor"><input type="checkbox" role="switch" checked=${form.fixado} disabled=${salvando || null} onChange=${(e) => setForm({ ...form, fixado: e.target.checked })} />Fixar no topo do Mural</label>
        <div class="c-campo"><span class="c-rotulo">${rotuloAmbientes}</span>
          ${ambientesDisponiveis.length ? html`<div class="c-mu-amb-lista">${ambientesDisponiveis.map((a) => html`<label key=${a.id_ambiente} class="c-marcar"><input type="checkbox" checked=${form.ambientes.includes(a.id_ambiente)} disabled=${salvando || null} onChange=${() => alternarAmbiente(a.id_ambiente)} /><span>${a.nome}${a.operacao_nome ? ` · ${a.operacao_nome}` : ''}</span></label>`)}</div>`
            : html`<span class="c-ajuda">Nenhuma intranet conectada ainda. Cadastre e teste um ambiente em Configurações › Administração › Parâmetros › SharePoint.</span>`}
        </div>
      </div>
    <//>` : null}

    ${publicacaoVisualizando ? html`<${Janela} titulo=${publicacaoVisualizando.titulo || ''} tamanho="grande" onClose=${() => setPublicacaoVisualizando(null)}
      rodape=${html`${podeEditar ? html`<button type="button" class="c-botao c-botao--secundario" style=${{ marginRight: 'auto' }} onClick=${() => { const p = publicacaoVisualizando; setPublicacaoVisualizando(null); abrirEdicao(p); }}><${Ic} nome="pencil-simple" />Editar</button>` : null}<button type="button" class="c-botao c-botao--secundario" onClick=${() => setPublicacaoVisualizando(null)}>Fechar</button>`}>
      <div class="c-janela-corpo">
        <div class="c-grupo">
          ${publicacaoVisualizando.fixado ? html`<${Selo} tom="informacao" icone="flag">Fixado<//>` : null}
          ${publicacaoVisualizando.categoria ? html`<${Selo} tom="neutro">${publicacaoVisualizando.categoria}<//>` : null}
          <span class="c-ajuda">${formatarDataHora(publicacaoVisualizando.publicado_em || publicacaoVisualizando.criado_em)}${publicacaoVisualizando.criado_por ? ` · ${publicacaoVisualizando.criado_por}` : ''}</span>
        </div>
        ${publicacaoVisualizando.imagens?.[0]?.url && !String(publicacaoVisualizando.conteudo_html || '').includes(publicacaoVisualizando.imagens[0].url) ? html`<img src=${publicacaoVisualizando.imagens[0].url} alt="" style=${{ maxWidth: '100%', borderRadius: 'var(--raio-medio)' }} />` : null}
        <div class="c-mu-texto" style=${{ padding: 0 }} dangerouslySetInnerHTML=${{ __html: publicacaoVisualizando.conteudo_html || '' }}></div>
        ${(publicacaoVisualizando.ambientes || []).length ? html`<div class="c-campo"><span class="c-rotulo">Enviado para</span><span class="c-mu-amb">${publicacaoVisualizando.ambientes.map((a) => html`<${EnvioIntranet} key=${a.id_ambiente} ambiente=${a} />`)}</span></div>` : null}
      </div>
    <//>` : null}

    ${publicacaoParaExcluir ? html`<${Janela} titulo="Excluir publicação" tamanho="pequena" onClose=${() => setPublicacaoParaExcluir(null)}
      rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => setPublicacaoParaExcluir(null)}>Cancelar</button><button type="button" class="c-botao c-botao--perigo" onClick=${confirmarExclusao}>Excluir</button>`}>
      <div class="c-janela-corpo"><p>Excluir "${publicacaoParaExcluir.titulo}"? Ela também sai das intranets (SharePoint). Não dá para desfazer.</p></div>
    <//>` : null}`;

  if (embutido) return html`<div class="c-embutido"><${ToastHost} />${caixa}${janelas}</div>`;
  return html`<${PainelRh} screenId="screen-mural" navAtiva="screen-mural" subtituloMarca="Mural" placeholderBusca="Mural" controlador=${controlador}>
    <${ToastHost} />
    <main class="c-pagina c-conteudo">
      <div class="c-cab-linha">
        <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Voltar para Início" title="Voltar para Início" onClick=${() => (window.history.length > 1 ? window.history.back() : controlador.irParaMenu?.())}><${Ic} nome="arrow-left" /></button>
        <h1>Mural</h1>
        <span class="c-ajuda">Avisos para todos. Também podem ir para as intranets das operações.</span>
        ${botaoNova ? html`<div class="c-cab-dir">${botaoNova}</div>` : null}
      </div>
      ${caixa}
    </main>
    ${janelas}
  </${PainelRh}>`;
}
