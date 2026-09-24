import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import {
  EmptyState,
  LoadingState,
  ModalConfirmacaoAcao,
  ModalPadrao,
  PageIntro,
  PainelRh,
  SectionCard,
} from '../../ui/componentes-compartilhados.js';
import { EditorMural } from '../../ui/components/mural-editor.js';
import { MenuAcoesProcesso } from '../../ui/components/menu-acoes.js';
import { IconeSvg } from '../../ui/icone.js';
import { formatarDataHora } from '../../shared/helpers-visuais.js';
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

const CATEGORIAS_MURAL = ['Aviso', 'Comunicado', 'Evento', 'Campanha', 'Institucional'];

// Prompt.txt (23/set/2026): um emoji fixo por categoria, sempre antes do texto,
// para identificar o tipo de postagem de longe no feed do Mural.
const EMOJI_CATEGORIA_MURAL = {
  Aviso: '⚠️',
  Comunicado: '📢',
  Evento: '🗓️',
  Campanha: '👍',
  Institucional: '📜',
};

function rotuloCategoriaMural(categoria) {
  const emoji = EMOJI_CATEGORIA_MURAL[categoria];
  return emoji ? `${emoji} ${categoria}` : categoria;
}

const TIPOS_PUBLICACAO = [
  {
    id: 'texto',
    label: 'Somente texto',
    icon: 'article',
    descricao: 'Um aviso ou comunicado só com texto formatado.',
  },
  {
    id: 'imagem',
    label: 'Somente imagem',
    icon: 'image',
    descricao: 'Uma ou mais imagens, sem corpo de texto.',
  },
  {
    id: 'texto_imagem',
    label: 'Texto + imagem',
    icon: 'slideshow',
    descricao: 'Texto formatado com imagens anexadas.',
  },
];

const FORM_INICIAL = {
  titulo: '',
  resumo: '',
  conteudo_html: '',
  categoria: '',
  fixado: false,
  imagens: [],
  ambientes: [],
};

function montarConteudoSomenteImagem(imagens) {
  return (imagens || [])
    .map((url) => `<img src="${url}" alt="" style="max-width:100%;border-radius:8px;margin:8px 0;" />`)
    .join('');
}

function UploaderImagensMural({ imagens = [], onChange, disabled = false }) {
  const [enviando, setEnviando] = useState(false);
  const { showToast, ToastHost } = useToast();

  const enviarImagem = async (event) => {
    const arquivo = event.target.files?.[0];
    event.target.value = '';
    if (!arquivo) return;
    setEnviando(true);
    try {
      const resultado = await uploadImagemMural(arquivo);
      onChange([...(imagens || []), resultado.url]);
    } catch (error) {
      showToast(error?.message || 'Não foi possível enviar a imagem.', 'danger');
    } finally {
      setEnviando(false);
    }
  };

  const removerImagem = (url) => {
    onChange((imagens || []).filter((item) => item !== url));
  };

  return html`
    <div class="mural-uploader">
      <${ToastHost} />
      ${imagens.length
        ? html`
            <div class="mural-uploader-grid">
              ${imagens.map(
                (url) => html`
                  <div key=${url} class="mural-uploader-item">
                    <img src=${url} alt="" />
                    <button
                      type="button"
                      class="mural-uploader-remove"
                      title="Remover imagem"
                      disabled=${disabled}
                      onClick=${() => removerImagem(url)}
                    >
                      <span class="material-symbols-outlined">${IconeSvg('close')}</span>
                    </button>
                  </div>
                `,
              )}
            </div>
          `
        : null}
      <label class=${`btn btn-outline-secondary mural-uploader-btn ${disabled || enviando ? 'is-disabled' : ''}`}>
        <span class="material-symbols-outlined">${IconeSvg('upload')}</span>
        ${enviando ? 'Enviando…' : 'Adicionar imagem'}
        <input
          type="file"
          accept="image/png,image/jpeg"
          style=${{ display: 'none' }}
          disabled=${disabled || enviando}
          onChange=${enviarImagem}
        />
      </label>
    </div>
  `;
}

function obterTextoPlano(html) {
  if (typeof document === 'undefined') return String(html || '').replace(/<[^>]+>/g, ' ');
  const elemento = document.createElement('div');
  elemento.innerHTML = String(html || '');
  return elemento.textContent || elemento.innerText || '';
}

function obterResumoExibicao(publicacao) {
  const resumo = (publicacao.resumo || '').trim();
  if (resumo) return resumo;
  const texto = obterTextoPlano(publicacao.conteudo_html).trim();
  return texto.length > 220 ? `${texto.slice(0, 220)}…` : texto;
}

function StatusEnvioBadge({ ambiente }) {
  const mapa = {
    enviado: { tom: 'success', texto: 'Enviado' },
    erro: { tom: 'danger', texto: 'Falhou' },
    pendente: { tom: 'muted', texto: 'Pendente' },
  };
  const info = mapa[ambiente.status_envio] || mapa.pendente;
  const rotulo = html`${ambiente.ambiente_nome || 'Intranet'} · ${info.texto}`;
  if (ambiente.status_envio === 'enviado' && ambiente.sharepoint_web_url) {
    return html`
      <a
        class=${`rh-status-pill mural-ambiente-pill mural-ambiente-pill--${info.tom} mural-ambiente-pill--link`}
        href=${ambiente.sharepoint_web_url}
        target="_blank"
        rel="noopener noreferrer"
        title="Abrir esta publicação no SharePoint"
      >
        ${rotulo}
      </a>
    `;
  }
  return html`
    <span
      class=${`rh-status-pill mural-ambiente-pill mural-ambiente-pill--${info.tom}`}
      title=${ambiente.mensagem_erro || ''}
    >
      ${rotulo}
    </span>
  `;
}

function PublicacaoCard({ publicacao, podeEditar, podeExcluir, modoLista = false, onVisualizar, onEditar, onFixar, onPublicar, onArquivar, onRestaurar, onExcluir }) {
  const capa = publicacao.imagens?.[0]?.url;
  const acoes = [{ key: 'visualizar', label: 'Visualizar', icon: 'visibility', onClick: () => onVisualizar(publicacao) }];
  if (podeEditar) {
    acoes.push({ key: 'editar', label: 'Editar', icon: 'edit', onClick: () => onEditar(publicacao) });
    acoes.push({
      key: 'fixar',
      label: publicacao.fixado ? 'Desafixar' : 'Fixar no topo',
      icon: 'flag',
      onClick: () => onFixar(publicacao),
    });
    if (publicacao.status !== 'publicado' || (publicacao.ambientes || []).some((item) => item.status_envio !== 'enviado')) {
      acoes.push({ key: 'publicar', label: 'Publicar nas intranets', icon: 'publish', onClick: () => onPublicar(publicacao) });
    }
    if (publicacao.status === 'arquivado') {
      acoes.push({ key: 'restaurar', label: 'Restaurar', icon: 'restart_alt', onClick: () => onRestaurar(publicacao) });
    } else {
      acoes.push({ key: 'arquivar', label: 'Arquivar', icon: 'archive', onClick: () => onArquivar(publicacao) });
    }
  }
  if (podeExcluir) {
    acoes.push({ key: 'excluir', label: 'Excluir', icon: 'delete', danger: true, onClick: () => onExcluir(publicacao) });
  }

  return html`
    <article class=${`mural-post-card ${modoLista ? 'mural-post-card--lista' : ''}`}>
      ${capa ? html`<img class="mural-post-cover" src=${capa} alt="" onClick=${() => onVisualizar(publicacao)} />` : null}
      <div class="mural-post-body">
        <div class="mural-post-head">
          <div class="mural-post-tags">
            ${publicacao.fixado ? html`<span class="rh-status-pill mural-pin-pill"><span class="material-symbols-outlined">${IconeSvg('flag')}</span>Fixado</span>` : null}
            ${publicacao.categoria ? html`<span class="rh-status-pill">${rotuloCategoriaMural(publicacao.categoria)}</span>` : null}
            ${publicacao.status === 'rascunho' ? html`<span class="rh-status-pill mural-ambiente-pill--muted">Rascunho</span>` : null}
            ${publicacao.status === 'arquivado' ? html`<span class="rh-status-pill mural-ambiente-pill--muted">Arquivado</span>` : null}
          </div>
          ${acoes.length ? html`<${MenuAcoesProcesso} ariaLabel="Ações da publicação" acoes=${acoes} />` : null}
        </div>
        <h3 class="mural-post-title" onClick=${() => onVisualizar(publicacao)}>${publicacao.titulo}</h3>
        <p class="mural-post-excerpt" onClick=${() => onVisualizar(publicacao)}>${obterResumoExibicao(publicacao)}</p>
        <div class="mural-post-footer">
          <span class="mural-post-date">${formatarDataHora(publicacao.publicado_em || publicacao.criado_em)}</span>
          ${(publicacao.ambientes || []).length
            ? html`<div class="mural-post-ambientes">${publicacao.ambientes.map((ambiente) => html`<${StatusEnvioBadge} key=${ambiente.id_ambiente} ambiente=${ambiente} />`)}</div>`
            : null}
        </div>
      </div>
    </article>
  `;
}

export function TelaMural({ controlador }) {
  const { showToast, ToastHost } = useToast();
  const podeVisualizar = controlador.possuiPermissao('mural.visualizar');
  const podeCriar = controlador.possuiPermissao('mural.criar');
  const podeEditar = controlador.possuiPermissao('mural.editar');
  const podeExcluir = controlador.possuiPermissao('mural.excluir');

  const [carregando, setCarregando] = useState(true);
  const [publicacoes, setPublicacoes] = useState([]);
  const [ambientesDisponiveis, setAmbientesDisponiveis] = useState([]);
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroData, setFiltroData] = useState('');
  const [filtroAmbiente, setFiltroAmbiente] = useState('');
  const [visualizacao, setVisualizacao] = useState('grade');
  const [seletorTipoAberto, setSeletorTipoAberto] = useState(false);
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
      const [resultadoFeed, resultadoAmbientes] = await Promise.allSettled([
        listarMural(statusFiltro),
        podeCriar || podeEditar ? listarAmbientesMural() : Promise.resolve({ itens: [] }),
      ]);
      setPublicacoes(resultadoFeed.status === 'fulfilled' ? resultadoFeed.value?.itens || [] : []);
      setAmbientesDisponiveis(resultadoAmbientes.status === 'fulfilled' ? resultadoAmbientes.value?.itens || [] : []);
    } catch (error) {
      showToast(error?.message || 'Não foi possível carregar o Mural.', 'danger');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    if (podeVisualizar) carregar(filtroStatus);
  }, [filtroStatus]);

  const publicacoesFiltradas = useMemo(() => {
    return publicacoes.filter((item) => {
      if (filtroCategoria && item.categoria !== filtroCategoria) return false;
      if (filtroData) {
        const dataItem = String(item.publicado_em || item.criado_em || '').slice(0, 10);
        if (dataItem !== filtroData) return false;
      }
      if (filtroAmbiente) {
        const temAmbiente = (item.ambientes || []).some((ambiente) => String(ambiente.id_ambiente) === filtroAmbiente);
        if (!temAmbiente) return false;
      }
      return true;
    });
  }, [publicacoes, filtroCategoria, filtroData, filtroAmbiente]);

  const publicacoesFixadas = useMemo(() => publicacoesFiltradas.filter((item) => item.fixado), [publicacoesFiltradas]);
  const publicacoesRestantes = useMemo(() => publicacoesFiltradas.filter((item) => !item.fixado), [publicacoesFiltradas]);

  const limparFiltros = () => {
    setFiltroCategoria('');
    setFiltroData('');
    setFiltroAmbiente('');
  };

  const filtrosAtivos = !!(filtroCategoria || filtroData || filtroAmbiente);

  const abrirNovaPublicacao = () => {
    setSeletorTipoAberto(true);
  };

  const escolherTipoPublicacao = (tipo) => {
    setTipoPublicacao(tipo);
    setPublicacaoEmEdicao(null);
    setForm(FORM_INICIAL);
    setSeletorTipoAberto(false);
    setModalAberto(true);
  };

  const abrirEdicao = (publicacao) => {
    setTipoPublicacao('texto_imagem');
    setPublicacaoEmEdicao(publicacao);
    setForm({
      titulo: publicacao.titulo || '',
      resumo: publicacao.resumo || '',
      conteudo_html: publicacao.conteudo_html || '',
      categoria: publicacao.categoria || '',
      fixado: !!publicacao.fixado,
      imagens: (publicacao.imagens || []).map((imagem) => imagem.url),
      ambientes: (publicacao.ambientes || []).map((ambiente) => ambiente.id_ambiente),
    });
    setModalAberto(true);
  };

  const fecharModal = () => {
    if (salvando) return;
    setModalAberto(false);
  };

  const alternarAmbiente = (idAmbiente) => {
    setForm((atual) => {
      const jaSelecionado = atual.ambientes.includes(idAmbiente);
      return {
        ...atual,
        ambientes: jaSelecionado
          ? atual.ambientes.filter((id) => id !== idAmbiente)
          : [...atual.ambientes, idAmbiente],
      };
    });
  };

  const salvarPublicacao = async ({ publicarAgora = false } = {}) => {
    if (!form.titulo.trim()) {
      showToast('Informe o título da publicação.', 'warning');
      return;
    }
    if (!form.categoria) {
      showToast('Selecione a categoria da publicação.', 'warning');
      return;
    }
    if (tipoPublicacao === 'imagem' && !form.imagens.length) {
      showToast('Adicione ao menos uma imagem.', 'warning');
      return;
    }
    if (tipoPublicacao !== 'imagem' && !obterTextoPlano(form.conteudo_html).trim()) {
      showToast('Escreva o conteúdo da publicação.', 'warning');
      return;
    }
    const payload = tipoPublicacao === 'imagem'
      ? { ...form, conteudo_html: montarConteudoSomenteImagem(form.imagens) }
      : form;
    setSalvando(true);
    try {
      const resultado = publicacaoEmEdicao
        ? await atualizarPublicacaoMural(publicacaoEmEdicao.id_publicacao, payload)
        : await criarPublicacaoMural(payload);
      if (publicarAgora) {
        await publicarMural(resultado.id_publicacao, form.ambientes);
      }
      showToast(publicarAgora ? 'Publicação enviada para as intranets.' : 'Publicação salva.', 'success');
      setModalAberto(false);
      await carregar();
    } catch (error) {
      showToast(error?.message || 'Não foi possível salvar a publicação.', 'danger');
    } finally {
      setSalvando(false);
    }
  };

  const fixarPublicacao = async (publicacao) => {
    try {
      await atualizarPublicacaoMural(publicacao.id_publicacao, {
        titulo: publicacao.titulo,
        resumo: publicacao.resumo,
        conteudo_html: publicacao.conteudo_html,
        categoria: publicacao.categoria,
        fixado: !publicacao.fixado,
        imagens: (publicacao.imagens || []).map((imagem) => imagem.url),
        ambientes: (publicacao.ambientes || []).map((ambiente) => ambiente.id_ambiente),
      });
      await carregar();
    } catch (error) {
      showToast(error?.message || 'Não foi possível atualizar a publicação.', 'danger');
    }
  };

  const publicarExistente = async (publicacao) => {
    try {
      const idsAmbientes = (publicacao.ambientes || []).map((ambiente) => ambiente.id_ambiente);
      await publicarMural(publicacao.id_publicacao, idsAmbientes.length ? idsAmbientes : ambientesDisponiveis.map((a) => a.id_ambiente));
      showToast('Publicação enviada para as intranets.', 'success');
      await carregar();
    } catch (error) {
      showToast(error?.message || 'Não foi possível publicar.', 'danger');
    }
  };

  const arquivarExistente = async (publicacao) => {
    try {
      await arquivarPublicacaoMural(publicacao.id_publicacao);
      showToast('Publicação arquivada.', 'success');
      await carregar();
    } catch (error) {
      showToast(error?.message || 'Não foi possível arquivar.', 'danger');
    }
  };

  const restaurarExistente = async (publicacao) => {
    try {
      await restaurarPublicacaoMural(publicacao.id_publicacao);
      showToast('Publicação restaurada.', 'success');
      await carregar();
    } catch (error) {
      showToast(error?.message || 'Não foi possível restaurar.', 'danger');
    }
  };

  const confirmarExclusao = async () => {
    if (!publicacaoParaExcluir) return;
    try {
      await excluirPublicacaoMural(publicacaoParaExcluir.id_publicacao);
      showToast('Publicação excluída.', 'success');
      setPublicacaoParaExcluir(null);
      await carregar();
    } catch (error) {
      showToast(error?.message || 'Não foi possível excluir.', 'danger');
    }
  };

  if (!podeVisualizar) {
    return html`
      <${PainelRh} screenId="screen-mural" navAtiva="screen-mural" subtituloMarca="Mural" placeholderBusca="Mural" controlador=${controlador}>
        <${EmptyState} title="Sem acesso" text="Você não tem permissão para visualizar o Mural." />
      </${PainelRh}>
    `;
  }

  return html`
    <${PainelRh} screenId="screen-mural" navAtiva="screen-mural" subtituloMarca="Mural" placeholderBusca="Mural" controlador=${controlador}>
      <${ToastHost} />
      <${PageIntro}
        kicker="Gestão"
        title="Mural"
        description="Avisos e comunicados do RH, publicados aqui e (opcionalmente) nas intranets do SharePoint."
        actions=${podeCriar
          ? html`
              <button type="button" class="btn btn-primary" onClick=${abrirNovaPublicacao}>
                <span class="material-symbols-outlined">${IconeSvg('add')}</span>
                Nova publicação
              </button>
            `
          : null}
      />

      <div class="mural-toolbar">
        ${podeEditar
          ? html`
              <div class="mural-filtros" role="group" aria-label="Status da publicação">
                <button type="button" class=${`mural-filtro-btn ${filtroStatus === '' ? 'is-active' : ''}`} onClick=${() => setFiltroStatus('')}>Publicados</button>
                <button type="button" class=${`mural-filtro-btn ${filtroStatus === 'rascunho' ? 'is-active' : ''}`} onClick=${() => setFiltroStatus('rascunho')}>Rascunhos</button>
                <button type="button" class=${`mural-filtro-btn ${filtroStatus === 'arquivado' ? 'is-active' : ''}`} onClick=${() => setFiltroStatus('arquivado')}>Arquivados</button>
              </div>
            `
          : null}

        <span class="mural-toolbar-divider" aria-hidden="true"></span>

        <div class="mural-filtros-bar">
          <select
            class="form-select mural-filtro-select"
            aria-label="Filtrar por tipo de publicação"
            value=${filtroCategoria}
            onChange=${(event) => setFiltroCategoria(event.target.value)}
          >
            <option value="">Todos os tipos</option>
            ${CATEGORIAS_MURAL.map((categoria) => html`<option key=${categoria} value=${categoria}>${rotuloCategoriaMural(categoria)}</option>`)}
          </select>
          <input
            type="date"
            class="form-control mural-filtro-select"
            aria-label="Filtrar por data"
            value=${filtroData}
            onChange=${(event) => setFiltroData(event.target.value)}
          />
          <select
            class="form-select mural-filtro-select"
            aria-label="Filtrar por onde foi publicado"
            value=${filtroAmbiente}
            onChange=${(event) => setFiltroAmbiente(event.target.value)}
          >
            <option value="">Todas as intranets</option>
            ${ambientesDisponiveis.map((ambiente) => html`<option key=${ambiente.id_ambiente} value=${String(ambiente.id_ambiente)}>${ambiente.nome}</option>`)}
          </select>
          ${filtrosAtivos
            ? html`
                <button type="button" class="mural-filtro-limpar" title="Limpar filtros" onClick=${limparFiltros}>
                  <span class="material-symbols-outlined">${IconeSvg('filter_alt_off')}</span>
                </button>
              `
            : null}
        </div>

        <div class="mural-visualizacao-toggle" role="group" aria-label="Modo de visualização">
          <button
            type="button"
            class=${`mural-visualizacao-btn ${visualizacao === 'grade' ? 'is-active' : ''}`}
            title="Visualização em grade"
            onClick=${() => setVisualizacao('grade')}
          >
            <span class="material-symbols-outlined">${IconeSvg('grid_view')}</span>
          </button>
          <button
            type="button"
            class=${`mural-visualizacao-btn ${visualizacao === 'lista' ? 'is-active' : ''}`}
            title="Visualização em lista"
            onClick=${() => setVisualizacao('lista')}
          >
            <span class="material-symbols-outlined">${IconeSvg('view_list')}</span>
          </button>
        </div>
      </div>

      ${carregando
        ? html`<${LoadingState} titulo="Carregando Mural" descricao="Buscando publicações." />`
        : html`
            <${SectionCard} title="Publicações" className="rh-section-card--flat mural-feed-card">
              ${publicacoesFiltradas.length
                ? html`
                    <div class=${`mural-feed mural-feed--${visualizacao}`}>
                      ${[...publicacoesFixadas, ...publicacoesRestantes].map(
                        (publicacao) => html`
                          <${PublicacaoCard}
                            key=${publicacao.id_publicacao}
                            publicacao=${publicacao}
                            podeEditar=${podeEditar}
                            podeExcluir=${podeExcluir}
                            modoLista=${visualizacao === 'lista'}
                            onVisualizar=${setPublicacaoVisualizando}
                            onEditar=${abrirEdicao}
                            onFixar=${fixarPublicacao}
                            onPublicar=${publicarExistente}
                            onArquivar=${arquivarExistente}
                            onRestaurar=${restaurarExistente}
                            onExcluir=${setPublicacaoParaExcluir}
                          />
                        `,
                      )}
                    </div>
                  `
                : html`
                    <${EmptyState}
                      title=${filtrosAtivos || filtroStatus ? 'Nenhuma publicação encontrada' : 'Nenhuma publicação ainda'}
                      text=${filtrosAtivos
                        ? 'Nenhuma publicação corresponde aos filtros selecionados.'
                        : 'Avisos, comunicados, fotos e vídeos publicados pelo RH aparecem aqui como um feed.'}
                    />
                  `}
            </${SectionCard}>
          `}

      <${ModalPadrao}
        aberto=${seletorTipoAberto}
        titulo="Nova publicação"
        subtitulo="Como vai ser essa publicação?"
        onClose=${() => setSeletorTipoAberto(false)}
        className="mural-modal mural-tipo-modal"
      >
        <div class="mural-tipo-opcoes">
          ${TIPOS_PUBLICACAO.map(
            (tipo) => html`
              <button key=${tipo.id} type="button" class="mural-tipo-opcao" onClick=${() => escolherTipoPublicacao(tipo.id)}>
                <span class="material-symbols-outlined">${IconeSvg(tipo.icon)}</span>
                <strong>${tipo.label}</strong>
                <span>${tipo.descricao}</span>
              </button>
            `,
          )}
        </div>
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${modalAberto}
        titulo=${publicacaoEmEdicao ? 'Editar publicação' : 'Nova publicação'}
        onClose=${fecharModal}
        className="mural-modal"
      >
        <div class="mural-form">
          <label class="form-field">
            <span class="form-label">Título</span>
            <input
              class="form-control"
              value=${form.titulo}
              disabled=${salvando}
              onInput=${(event) => setForm({ ...form, titulo: event.target.value })}
            />
          </label>
          <div class="mural-form-row">
            <label class="form-field">
              <span class="form-label">Categoria *</span>
              <select
                class="form-select"
                value=${form.categoria}
                disabled=${salvando}
                required
                onChange=${(event) => setForm({ ...form, categoria: event.target.value })}
              >
                <option value="" disabled>Selecione</option>
                ${CATEGORIAS_MURAL.map((categoria) => html`<option key=${categoria} value=${categoria}>${rotuloCategoriaMural(categoria)}</option>`)}
              </select>
            </label>
            <label class="form-field mural-form-pin">
              <span class="form-label">${' '}</span>
              <label class="settings-toggle-line">
                <input
                  type="checkbox"
                  checked=${form.fixado}
                  disabled=${salvando}
                  onChange=${(event) => setForm({ ...form, fixado: event.target.checked })}
                />
                <span>Fixar no topo do Mural</span>
              </label>
            </label>
          </div>
          <label class="form-field">
            <span class="form-label">Resumo (opcional)</span>
            <input
              class="form-control"
              placeholder="Aparece no feed antes de abrir a publicação completa"
              value=${form.resumo}
              disabled=${salvando}
              onInput=${(event) => setForm({ ...form, resumo: event.target.value })}
            />
          </label>
          ${tipoPublicacao !== 'imagem'
            ? html`
                <label class="form-field">
                  <span class="form-label">Conteúdo</span>
                  <${EditorMural}
                    valor=${form.conteudo_html}
                    onChange=${(conteudo) => setForm((atual) => ({ ...atual, conteudo_html: conteudo }))}
                  />
                </label>
              `
            : null}

          ${tipoPublicacao !== 'texto'
            ? html`
                <div class="form-field">
                  <span class="form-label">${tipoPublicacao === 'imagem' ? 'Imagens' : 'Imagens anexadas'}</span>
                  <${UploaderImagensMural}
                    imagens=${form.imagens}
                    disabled=${salvando}
                    onChange=${(imagens) => setForm((atual) => ({ ...atual, imagens }))}
                  />
                </div>
              `
            : null}

          <div class="mural-form-ambientes">
            <span class="form-label">Publicar também nestas intranets (SharePoint)</span>
            ${ambientesDisponiveis.length
              ? html`
                  <div class="mural-ambientes-grid">
                    ${ambientesDisponiveis.map(
                      (ambiente) => html`
                        <label key=${ambiente.id_ambiente} class="settings-toggle-line">
                          <input
                            type="checkbox"
                            checked=${form.ambientes.includes(ambiente.id_ambiente)}
                            disabled=${salvando}
                            onChange=${() => alternarAmbiente(ambiente.id_ambiente)}
                          />
                          <span>${ambiente.nome}${ambiente.operacao_nome ? ` · ${ambiente.operacao_nome}` : ''}</span>
                        </label>
                      `,
                    )}
                  </div>
                `
              : html`<p class="text-muted small mb-0">Nenhuma intranet conectada ainda — cadastre e teste um ambiente em Configurações › Administração › Parâmetros › SharePoint.</p>`}
          </div>
        </div>
        <footer class="rh-modal-footer">
          <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${fecharModal}>Cancelar</button>
          <button type="button" class="btn btn-outline-primary" disabled=${salvando} onClick=${() => salvarPublicacao({ publicarAgora: false })}>
            ${salvando ? 'Salvando...' : 'Salvar rascunho'}
          </button>
          <button type="button" class="btn btn-primary" disabled=${salvando} onClick=${() => salvarPublicacao({ publicarAgora: true })}>
            ${salvando ? 'Publicando...' : 'Publicar agora'}
          </button>
        </footer>
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${!!publicacaoVisualizando}
        titulo=${publicacaoVisualizando?.titulo || ''}
        onClose=${() => setPublicacaoVisualizando(null)}
        className="mural-modal mural-view-modal"
      >
        ${publicacaoVisualizando
          ? html`
              <div class="mural-view">
                <div class="mural-view-meta">
                  ${publicacaoVisualizando.categoria ? html`<span class="rh-status-pill">${rotuloCategoriaMural(publicacaoVisualizando.categoria)}</span>` : null}
                  ${publicacaoVisualizando.fixado ? html`<span class="rh-status-pill mural-pin-pill"><span class="material-symbols-outlined">${IconeSvg('flag')}</span>Fixado</span>` : null}
                  <span class="mural-post-date">${formatarDataHora(publicacaoVisualizando.publicado_em || publicacaoVisualizando.criado_em)}</span>
                </div>
                ${publicacaoVisualizando.imagens?.[0]?.url
                  ? html`<img class="mural-view-cover" src=${publicacaoVisualizando.imagens[0].url} alt="" />`
                  : null}
                <div class="mural-view-content" dangerouslySetInnerHTML=${{ __html: publicacaoVisualizando.conteudo_html || '' }}></div>
                ${(publicacaoVisualizando.ambientes || []).length
                  ? html`
                      <div class="mural-view-ambientes">
                        <span class="form-label">Enviado para</span>
                        <div class="mural-post-ambientes">
                          ${publicacaoVisualizando.ambientes.map((ambiente) => html`<${StatusEnvioBadge} key=${ambiente.id_ambiente} ambiente=${ambiente} />`)}
                        </div>
                      </div>
                    `
                  : null}
              </div>
            `
          : null}
      </${ModalPadrao}>

      <${ModalConfirmacaoAcao}
        aberto=${!!publicacaoParaExcluir}
        titulo="Excluir publicação"
        descricao=${`Tem certeza que deseja excluir "${publicacaoParaExcluir?.titulo || ''}"? Esta ação não pode ser desfeita.`}
        tipo="destrutivo"
        textoConfirmar="Excluir"
        onClose=${() => setPublicacaoParaExcluir(null)}
        onConfirm=${confirmarExclusao}
      />
    </${PainelRh}>
  `;
}
