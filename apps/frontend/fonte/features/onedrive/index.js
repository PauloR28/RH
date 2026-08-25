import { html, useEffect, useMemo, useRef, useState } from '../../infraestrutura-react.js';
import {
  baixarArquivoOneDrive,
  criarPastaOneDrive,
  enviarArquivoOneDrive,
  excluirItemOneDrive,
  listarArquivosOneDrive,
  obterPreviewOneDrive,
} from '../../servico-api.js';
import { baixarBlob } from '../../utilitarios.js';
import {
  EmptyState,
  LoadingState,
  ModalConfirmacaoAcao,
  ModalPadrao,
  PageIntro,
  PainelRh,
  SectionCard,
  Table,
  ToastAlert,
} from '../../ui/componentes-compartilhados.js';
import { ModalComporEmail } from '../../shared/components/compose-email-modal.js';

const CHAVE_MODO_VISUALIZACAO = 'rh_onedrive_modo_visualizacao_v1';

const CATEGORIAS_EXTENSAO = [
  { valor: '', label: 'Todos os tipos de arquivo' },
  { valor: 'pdf', label: 'PDF', extensoes: ['pdf'], icone: 'picture_as_pdf' },
  { valor: 'documento', label: 'Documentos', extensoes: ['doc', 'docx', 'odt', 'rtf'], icone: 'description' },
  { valor: 'texto', label: 'Texto', extensoes: ['txt', 'md', 'csv'], icone: 'article' },
  { valor: 'planilha', label: 'Planilhas', extensoes: ['xls', 'xlsx', 'ods'], icone: 'table_chart' },
  { valor: 'apresentacao', label: 'Apresentações', extensoes: ['ppt', 'pptx', 'odp'], icone: 'slideshow' },
  { valor: 'imagem', label: 'Imagens', extensoes: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'], icone: 'image' },
  { valor: 'compactado', label: 'Compactados', extensoes: ['zip', 'rar', '7z'], icone: 'folder_zip' },
];

const EXTENSOES_VISUALIZAVEIS = ['txt', 'md', 'pdf', 'doc', 'docx'];

function obterExtensao(nomeArquivo) {
  const partes = String(nomeArquivo || '').split('.');
  return partes.length > 1 ? partes.pop().toLowerCase() : '';
}

function obterCategoriaExtensao(nomeArquivo) {
  const extensao = obterExtensao(nomeArquivo);
  const categoria = CATEGORIAS_EXTENSAO.find((item) => item.extensoes?.includes(extensao));
  return categoria?.valor || 'outro';
}

function Icone({ name, className = '' }) {
  return html`<span class=${`material-symbols-outlined ${className}`.trim()} aria-hidden="true">${name}</span>`;
}

function iconeDoItem(item) {
  if (item.tipo === 'pasta') return 'folder';
  const categoria = CATEGORIAS_EXTENSAO.find((entrada) => entrada.valor === obterCategoriaExtensao(item.nome));
  return categoria?.icone || 'insert_drive_file';
}

function formatarTamanho(bytes) {
  const valor = Number(bytes || 0);
  if (!valor) return '-';
  const unidades = ['B', 'KB', 'MB', 'GB'];
  let indice = 0;
  let restante = valor;
  while (restante >= 1024 && indice < unidades.length - 1) {
    restante /= 1024;
    indice += 1;
  }
  return `${restante.toFixed(restante >= 10 || indice === 0 ? 0 : 1)} ${unidades[indice]}`;
}

function formatarData(valor) {
  if (!valor) return '-';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '-';
  return data.toLocaleString('pt-BR');
}

function formatarDataCurta(valor) {
  if (!valor) return '-';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '-';
  return data.toLocaleDateString('pt-BR');
}

function lerModoVisualizacaoSalvo() {
  try {
    const valor = window.localStorage.getItem(CHAVE_MODO_VISUALIZACAO);
    if (['grade-grande', 'grade-pequena', 'lista'].includes(valor)) return valor;
  } catch (error) {
    // ignora falha de leitura do localStorage
  }
  return 'grade-grande';
}

function salvarModoVisualizacao(modo) {
  try {
    window.localStorage.setItem(CHAVE_MODO_VISUALIZACAO, modo);
  } catch (error) {
    // ignora falha de escrita no localStorage
  }
}

// Menu suspenso de ações do arquivo/pasta (substitui os ícones sempre visíveis
// por um botão "mais opções" que abre uma lista com ícone + rótulo por ação).
function MenuAcoesArquivo({ item, acoes = [] }) {
  const [aberto, setAberto] = useState(false);
  const [posicao, setPosicao] = useState(null);
  const [menuId] = useState(() => `rh-onedrive-menu-${Math.random().toString(36).slice(2)}`);
  const botaoRef = useRef(null);

  useEffect(() => {
    const fecharOutrosMenus = (event) => {
      if (event.detail !== menuId) setAberto(false);
    };
    window.addEventListener('rh-onedrive-menu-open', fecharOutrosMenus);
    return () => window.removeEventListener('rh-onedrive-menu-open', fecharOutrosMenus);
  }, [menuId]);

  useEffect(() => {
    if (!aberto) return undefined;
    const fechar = () => setAberto(false);
    const fecharComEsc = (event) => {
      if (event.key === 'Escape') {
        fechar();
        botaoRef.current?.focus();
      }
    };
    document.addEventListener('click', fechar);
    document.addEventListener('keydown', fecharComEsc);
    window.addEventListener('resize', fechar);
    window.addEventListener('scroll', fechar, true);
    return () => {
      document.removeEventListener('click', fechar);
      document.removeEventListener('keydown', fecharComEsc);
      window.removeEventListener('resize', fechar);
      window.removeEventListener('scroll', fechar, true);
    };
  }, [aberto]);

  if (!acoes.length) return null;

  const alternarMenu = (event) => {
    event.stopPropagation();
    if (!aberto) {
      window.dispatchEvent(new CustomEvent('rh-onedrive-menu-open', { detail: menuId }));
      const rect = event.currentTarget.getBoundingClientRect();
      const largura = 208;
      const altura = Math.min(260, 16 + acoes.length * 40);
      const topoAbaixo = rect.bottom + 6;
      const topo =
        topoAbaixo + altura > window.innerHeight - 8
          ? Math.max(8, rect.top - altura - 6)
          : topoAbaixo;
      setPosicao({
        top: `${topo}px`,
        left: `${Math.max(8, Math.min(window.innerWidth - largura - 8, rect.right - largura))}px`,
        width: `${largura}px`,
      });
    }
    setAberto((valor) => !valor);
  };

  const executarAcao = (event, acao) => {
    event.stopPropagation();
    setAberto(false);
    acao.onClick?.();
  };

  return html`
    <div class="rh-onedrive-menu-wrapper">
      <button
        ref=${botaoRef}
        type="button"
        class="rh-onedrive-menu-trigger"
        title="Mais opções"
        aria-label=${`Mais opções para ${item?.nome || 'item'}`}
        aria-haspopup="menu"
        aria-expanded=${aberto}
        onClick=${alternarMenu}
      >
        <${Icone} name="more_vert" />
      </button>
      ${aberto
        ? html`
            <div
              class="rh-onedrive-menu"
              role="menu"
              style=${posicao || {}}
              onClick=${(event) => event.stopPropagation()}
            >
              ${acoes.map(
                (acao) => html`
                  <button
                    key=${acao.key}
                    type="button"
                    role="menuitem"
                    class=${`rh-onedrive-menu-item ${acao.danger ? 'is-danger' : ''}`.trim()}
                    onClick=${(event) => executarAcao(event, acao)}
                  >
                    <${Icone} name=${acao.icon} />
                    <span>${acao.label}</span>
                  </button>
                `,
              )}
            </div>
          `
        : null}
    </div>
  `;
}

export function TelaOneDriveArquivos({ controlador }) {
  const [caminho, setCaminho] = useState('');
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [modalNovaPastaAberto, setModalNovaPastaAberto] = useState(false);
  const [nomeNovaPasta, setNomeNovaPasta] = useState('');
  const [salvandoPasta, setSalvandoPasta] = useState(false);
  const [enviandoArquivo, setEnviandoArquivo] = useState(false);
  const [itemParaExcluir, setItemParaExcluir] = useState(null);
  const [excluindo, setExcluindo] = useState(false);
  const [itemParaEnviarEmail, setItemParaEnviarEmail] = useState(null);
  const inputArquivoRef = useRef(null);

  const [busca, setBusca] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroExtensao, setFiltroExtensao] = useState('');
  const [filtroCriadoPor, setFiltroCriadoPor] = useState('');
  const [filtroDataCriacao, setFiltroDataCriacao] = useState('');
  const [filtroDataModificacao, setFiltroDataModificacao] = useState('');
  const [modoVisualizacao, setModoVisualizacao] = useState(lerModoVisualizacaoSalvo);

  const [itemVisualizando, setItemVisualizando] = useState(null);
  const [previewCarregando, setPreviewCarregando] = useState(false);
  const [previewErro, setPreviewErro] = useState('');
  const [previewTipo, setPreviewTipo] = useState('');
  const [previewConteudo, setPreviewConteudo] = useState('');
  const previewBlobUrlRef = useRef(null);

  const podeVisualizar = controlador?.possuiPermissao?.('onedrive.visualizar');
  const podeEnviar = controlador?.possuiPermissao?.('onedrive.upload');
  const podeExcluir = controlador?.possuiPermissao?.('onedrive.excluir');
  const podeComporEmail =
    controlador?.possuiPermissao?.('emails.enviar_modelo') ||
    controlador?.possuiPermissao?.('emails.enviar_livre');

  const carregarItens = async (caminhoAtual) => {
    setCarregando(true);
    setErro('');
    try {
      const resposta = await listarArquivosOneDrive(caminhoAtual);
      setItens(resposta?.items || []);
    } catch (error) {
      setErro(error?.message || 'Não foi possível carregar os arquivos do repositório M365.');
      setItens([]);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    if (!podeVisualizar) return;
    carregarItens(caminho);
  }, [caminho, podeVisualizar]);

  useEffect(() => {
    salvarModoVisualizacao(modoVisualizacao);
  }, [modoVisualizacao]);

  useEffect(() => {
    return () => {
      if (previewBlobUrlRef.current) {
        URL.revokeObjectURL(previewBlobUrlRef.current);
      }
    };
  }, []);

  const usuariosCriadores = useMemo(() => {
    const nomes = new Set();
    itens.forEach((item) => {
      if (item.criado_por) nomes.add(item.criado_por);
    });
    return Array.from(nomes).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [itens]);

  const itensFiltrados = useMemo(() => {
    const buscaNormalizada = busca.trim().toLowerCase();
    return itens.filter((item) => {
      if (buscaNormalizada && !item.nome.toLowerCase().includes(buscaNormalizada)) return false;
      if (filtroTipo && item.tipo !== filtroTipo) return false;
      if (filtroExtensao && (item.tipo === 'pasta' || obterCategoriaExtensao(item.nome) !== filtroExtensao)) {
        return false;
      }
      if (filtroCriadoPor && item.criado_por !== filtroCriadoPor) return false;
      if (filtroDataCriacao && item.criado_em?.slice(0, 10) !== filtroDataCriacao) return false;
      if (filtroDataModificacao && item.modificado_em?.slice(0, 10) !== filtroDataModificacao) return false;
      return true;
    });
  }, [itens, busca, filtroTipo, filtroExtensao, filtroCriadoPor, filtroDataCriacao, filtroDataModificacao]);

  const limparFiltros = () => {
    setBusca('');
    setFiltroTipo('');
    setFiltroExtensao('');
    setFiltroCriadoPor('');
    setFiltroDataCriacao('');
    setFiltroDataModificacao('');
  };

  const filtrosAtivos =
    Boolean(busca) ||
    Boolean(filtroTipo) ||
    Boolean(filtroExtensao) ||
    Boolean(filtroCriadoPor) ||
    Boolean(filtroDataCriacao) ||
    Boolean(filtroDataModificacao);

  if (!podeVisualizar) {
    return html`
      <${PainelRh} screenId="screen-onedrive-files" navAtiva="screen-onedrive-files" controlador=${controlador}>
        <${EmptyState}
          titulo="Sem acesso"
          descricao="Você não possui permissão para visualizar o repositório de arquivos M365."
        />
      </${PainelRh}>
    `;
  }

  const segmentosBreadcrumb = caminho ? caminho.split('/').filter(Boolean) : [];

  const abrirPasta = (nomePasta) => {
    limparFiltros();
    const novoCaminho = [caminho, nomePasta].filter(Boolean).join('/');
    setCaminho(novoCaminho);
  };

  const irParaSegmento = (indice) => {
    limparFiltros();
    setCaminho(segmentosBreadcrumb.slice(0, indice + 1).join('/'));
  };

  const criarPasta = async (event) => {
    event.preventDefault();
    if (!nomeNovaPasta.trim()) return;
    setSalvandoPasta(true);
    try {
      await criarPastaOneDrive(caminho, nomeNovaPasta.trim());
      setModalNovaPastaAberto(false);
      setNomeNovaPasta('');
      setMensagem('Pasta criada com sucesso.');
      await carregarItens(caminho);
    } catch (error) {
      setErro(error?.message || 'Não foi possível criar a pasta.');
    } finally {
      setSalvandoPasta(false);
    }
  };

  const enviarArquivoSelecionado = async (event) => {
    const arquivo = event.target.files?.[0];
    event.target.value = '';
    if (!arquivo) return;
    setEnviandoArquivo(true);
    setErro('');
    try {
      await enviarArquivoOneDrive(caminho, arquivo);
      setMensagem(`Arquivo "${arquivo.name}" enviado com sucesso.`);
      await carregarItens(caminho);
    } catch (error) {
      setErro(error?.message || 'Não foi possível enviar o arquivo.');
    } finally {
      setEnviandoArquivo(false);
    }
  };

  const baixarItem = async (item) => {
    const caminhoItem = [caminho, item.nome].filter(Boolean).join('/');
    try {
      const { blob, filename } = await baixarArquivoOneDrive(caminhoItem);
      baixarBlob(filename || item.nome, blob);
    } catch (error) {
      setErro(error?.message || 'Não foi possível baixar o arquivo.');
    }
  };

  const confirmarExclusao = async ({ justificativa }) => {
    if (!itemParaExcluir) return;
    const caminhoItem = [caminho, itemParaExcluir.nome].filter(Boolean).join('/');
    setExcluindo(true);
    try {
      await excluirItemOneDrive(caminhoItem, justificativa);
      setMensagem(`"${itemParaExcluir.nome}" excluído com sucesso.`);
      setItemParaExcluir(null);
      await carregarItens(caminho);
    } catch (error) {
      setErro(error?.message || 'Não foi possível excluir o item.');
    } finally {
      setExcluindo(false);
    }
  };

  const itemEhVisualizavel = (item) =>
    item.tipo !== 'pasta' && EXTENSOES_VISUALIZAVEIS.includes(obterExtensao(item.nome));

  const fecharVisualizacao = () => {
    setItemVisualizando(null);
    setPreviewErro('');
    setPreviewConteudo('');
    setPreviewTipo('');
    if (previewBlobUrlRef.current) {
      URL.revokeObjectURL(previewBlobUrlRef.current);
      previewBlobUrlRef.current = null;
    }
  };

  const abrirVisualizacao = async (item) => {
    if (!itemEhVisualizavel(item)) return;
    setItemVisualizando(item);
    setPreviewErro('');
    setPreviewConteudo('');
    setPreviewCarregando(true);
    const extensao = obterExtensao(item.nome);
    const caminhoItem = [caminho, item.nome].filter(Boolean).join('/');
    try {
      if (extensao === 'txt' || extensao === 'md') {
        const { blob } = await baixarArquivoOneDrive(caminhoItem);
        const texto = await blob.text();
        setPreviewTipo('texto');
        setPreviewConteudo(texto);
      } else if (extensao === 'pdf') {
        const { blob } = await baixarArquivoOneDrive(caminhoItem);
        const url = URL.createObjectURL(blob);
        previewBlobUrlRef.current = url;
        setPreviewTipo('pdf');
        setPreviewConteudo(url);
      } else {
        const resposta = await obterPreviewOneDrive(caminhoItem);
        setPreviewTipo('office');
        setPreviewConteudo(resposta?.url || '');
      }
    } catch (error) {
      setPreviewErro(error?.message || 'Não foi possível gerar a visualização deste arquivo.');
    } finally {
      setPreviewCarregando(false);
    }
  };

  // Lista de ações disponíveis para o item (dados, não HTML). A mesma lógica de
  // quais ações aparecem para qual arquivo/permissão é usada tanto na grade
  // (cards) quanto na lista (tabela) — só muda a forma de exibição, feita pelo
  // componente <MenuAcoesArquivo>, que renderiza isso como um menu suspenso.
  const acoesDoItem = (item) => {
    const acoes = [];

    if (itemEhVisualizavel(item)) {
      acoes.push({
        key: 'visualizar',
        label: 'Visualizar',
        icon: 'visibility',
        onClick: () => abrirVisualizacao(item),
      });
    }

    if (item.tipo !== 'pasta') {
      acoes.push({
        key: 'baixar',
        label: 'Baixar',
        icon: 'download',
        onClick: () => baixarItem(item),
      });
    }

    if (item.tipo !== 'pasta' && podeComporEmail) {
      acoes.push({
        key: 'email',
        label: 'Enviar por e-mail',
        icon: 'forward_to_inbox',
        onClick: () => setItemParaEnviarEmail(item),
      });
    }

    if (podeExcluir) {
      acoes.push({
        key: 'excluir',
        label: 'Excluir',
        icon: 'delete',
        danger: true,
        onClick: () => setItemParaExcluir(item),
      });
    }

    return acoes;
  };

  const abrirItem = (item) => {
    if (item.tipo === 'pasta') {
      abrirPasta(item.nome);
    } else if (itemEhVisualizavel(item)) {
      abrirVisualizacao(item);
    }
  };

  const colunas = [
    { key: 'nome', label: 'Nome' },
    { key: 'tamanho_bytes', label: 'Tamanho' },
    { key: 'criado_em', label: 'Criado em' },
    { key: 'modificado_em', label: 'Modificado em' },
    { key: 'criado_por', label: 'Criado por' },
    { key: 'acoes', label: 'Ações' },
  ];

  const renderCell = (item, coluna) => {
    if (coluna.key === 'nome') {
      return html`
        <button
          type="button"
          class="btn btn-link p-0 text-decoration-none"
          onClick=${() => abrirItem(item)}
        >
          <${Icone} name=${iconeDoItem(item)} /> ${item.nome}
        </button>
      `;
    }
    if (coluna.key === 'tamanho_bytes') {
      return item.tipo === 'pasta' ? '-' : formatarTamanho(item.tamanho_bytes);
    }
    if (coluna.key === 'criado_em') {
      return formatarData(item.criado_em);
    }
    if (coluna.key === 'modificado_em') {
      return formatarData(item.modificado_em);
    }
    if (coluna.key === 'criado_por') {
      return item.criado_por || '-';
    }
    if (coluna.key === 'acoes') {
      return html`
        <div class="d-flex justify-content-center">
          <${MenuAcoesArquivo} item=${item} acoes=${acoesDoItem(item)} />
        </div>
      `;
    }
    return null;
  };

  return html`
    <${PainelRh}
      screenId="screen-onedrive-files"
      navAtiva="screen-onedrive-files"
      controlador=${controlador}
      subtituloMarca="Plataforma de Recrutamento e Seleção"
    >
      <${PageIntro}
        kicker="Microsoft 365"
        title="Drive-Conecta"
        description="Repositório de documentos do RH, hospedado no SharePoint/OneDrive corporativo. Nada fica armazenado localmente no Conecta."
        actions=${html`
          <div class="d-flex gap-2">
            ${podeEnviar
              ? html`
                  <button type="button" class="btn btn-outline-secondary" onClick=${() => setModalNovaPastaAberto(true)}>
                    <${Icone} name="create_new_folder" /> Nova pasta
                  </button>
                  <button
                    type="button"
                    class="btn btn-primary"
                    disabled=${enviandoArquivo}
                    onClick=${() => inputArquivoRef.current?.click()}
                  >
                    <${Icone} name="upload" /> ${enviandoArquivo ? 'Enviando...' : 'Enviar arquivo'}
                  </button>
                  <input
                    ref=${inputArquivoRef}
                    type="file"
                    class="d-none"
                    onChange=${enviarArquivoSelecionado}
                  />
                `
              : null}
          </div>
        `}
      />

      ${mensagem ? html`<${ToastAlert} message=${mensagem} tone="success" onClose=${() => setMensagem('')} />` : null}
      ${erro ? html`<${ToastAlert} message=${erro} tone="danger" onClose=${() => setErro('')} />` : null}

      <${SectionCard}>
        <nav class="rh-breadcrumb mb-3">
          <button type="button" class="btn btn-link p-0 text-decoration-none" onClick=${() => {
            limparFiltros();
            setCaminho('');
          }}>
            <${Icone} name="home" /> Drive-Conecta
          </button>
          ${segmentosBreadcrumb.map(
            (segmento, indice) => html`
              <span key=${indice}> / </span>
              <button type="button" class="btn btn-link p-0 text-decoration-none" onClick=${() => irParaSegmento(indice)}>
                ${segmento}
              </button>
            `,
          )}
        </nav>

        <div class="rh-onedrive-toolbar">
          <label class="form-field rh-onedrive-search">
            <span class="form-label">Pesquisar</span>
            <input
              class="form-control"
              type="search"
              placeholder="Pesquisar por nome de arquivo ou pasta"
              value=${busca}
              onInput=${(event) => setBusca(event.target.value)}
            />
          </label>

          <div class="rh-onedrive-filters">
            <label class="form-field">
              <span class="form-label">Tipo</span>
              <select class="form-select" value=${filtroTipo} onChange=${(event) => setFiltroTipo(event.target.value)}>
                <option value="">Arquivos e pastas</option>
                <option value="pasta">Só pastas</option>
                <option value="arquivo">Só arquivos</option>
              </select>
            </label>
            <label class="form-field">
              <span class="form-label">Tipo de arquivo</span>
              <select
                class="form-select"
                value=${filtroExtensao}
                onChange=${(event) => setFiltroExtensao(event.target.value)}
              >
                ${CATEGORIAS_EXTENSAO.map(
                  (categoria) => html`<option key=${categoria.valor} value=${categoria.valor}>${categoria.label}</option>`,
                )}
              </select>
            </label>
            <label class="form-field">
              <span class="form-label">Criado por</span>
              <select
                class="form-select"
                value=${filtroCriadoPor}
                onChange=${(event) => setFiltroCriadoPor(event.target.value)}
              >
                <option value="">Todos os usuários</option>
                ${usuariosCriadores.map((nome) => html`<option key=${nome} value=${nome}>${nome}</option>`)}
              </select>
            </label>
            <label class="form-field">
              <span class="form-label">Data de criação</span>
              <input
                class="form-control"
                type="date"
                value=${filtroDataCriacao}
                onInput=${(event) => setFiltroDataCriacao(event.target.value)}
              />
            </label>
            <label class="form-field">
              <span class="form-label">Data de modificação</span>
              <input
                class="form-control"
                type="date"
                value=${filtroDataModificacao}
                onInput=${(event) => setFiltroDataModificacao(event.target.value)}
              />
            </label>
            ${filtrosAtivos
              ? html`
                  <button type="button" class="btn btn-outline-secondary align-self-end" onClick=${limparFiltros}>
                    Limpar filtros
                  </button>
                `
              : null}
          </div>

          <div class="rh-onedrive-view-toggle" role="group" aria-label="Modo de visualização">
            <button
              type="button"
              class=${modoVisualizacao === 'grade-grande' ? 'is-active' : ''}
              title="Grade grande"
              onClick=${() => setModoVisualizacao('grade-grande')}
            >
              <${Icone} name="grid_view" />
            </button>
            <button
              type="button"
              class=${modoVisualizacao === 'grade-pequena' ? 'is-active' : ''}
              title="Grade pequena"
              onClick=${() => setModoVisualizacao('grade-pequena')}
            >
              <${Icone} name="apps" />
            </button>
            <button
              type="button"
              class=${modoVisualizacao === 'lista' ? 'is-active' : ''}
              title="Lista (em pilha)"
              onClick=${() => setModoVisualizacao('lista')}
            >
              <${Icone} name="view_list" />
            </button>
          </div>
        </div>

        ${carregando
          ? html`<${LoadingState} titulo="Carregando arquivos" descricao="Consultando o Microsoft Graph." />`
          : itensFiltrados.length
            ? modoVisualizacao === 'lista'
              ? html`<${Table} columns=${colunas} rows=${itensFiltrados} rowKey="id" renderCell=${renderCell} />`
              : html`
                  <div class=${`rh-onedrive-grid ${modoVisualizacao === 'grade-pequena' ? 'rh-onedrive-grid--pequena' : ''}`}>
                    ${itensFiltrados.map(
                      (item) => html`
                        <div class="rh-onedrive-card" key=${item.id}>
                          <span class="rh-onedrive-card-icon"><${Icone} name=${iconeDoItem(item)} /></span>
                          <button type="button" class="rh-onedrive-card-nome" onClick=${() => abrirItem(item)}>
                            ${item.nome}
                          </button>
                          <span class="rh-onedrive-card-meta">
                            ${item.tipo === 'pasta' ? `${item.itens_na_pasta ?? 0} itens` : formatarTamanho(item.tamanho_bytes)}
                            · ${formatarDataCurta(item.modificado_em)}
                          </span>
                          <div class="rh-onedrive-card-actions">
                            <${MenuAcoesArquivo} item=${item} acoes=${acoesDoItem(item)} />
                          </div>
                        </div>
                      `,
                    )}
                  </div>
                `
            : html`
                <${EmptyState}
                  titulo=${filtrosAtivos ? 'Nenhum resultado para os filtros aplicados' : 'Pasta vazia'}
                  descricao=${filtrosAtivos
                    ? 'Ajuste a pesquisa ou os filtros para ver outros arquivos e pastas.'
                    : 'Nenhum arquivo ou pasta encontrado neste local.'}
                />
              `}
      </${SectionCard}>

      <${ModalPadrao}
        aberto=${modalNovaPastaAberto}
        titulo="Nova pasta"
        onClose=${() => setModalNovaPastaAberto(false)}
      >
        <form onSubmit=${criarPasta} class="d-flex flex-column gap-3">
          <label class="form-field">
            <span class="form-label">Nome da pasta</span>
            <input
              class="form-control"
              required
              value=${nomeNovaPasta}
              onInput=${(event) => setNomeNovaPasta(event.target.value)}
            />
          </label>
          <div class="d-flex justify-content-end gap-2">
            <button type="button" class="btn btn-outline-secondary" onClick=${() => setModalNovaPastaAberto(false)}>
              Cancelar
            </button>
            <button type="submit" class="btn btn-primary" disabled=${salvandoPasta}>
              ${salvandoPasta ? 'Criando...' : 'Criar pasta'}
            </button>
          </div>
        </form>
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${Boolean(itemVisualizando)}
        titulo=${itemVisualizando ? `Visualizar "${itemVisualizando.nome}"` : 'Visualizar arquivo'}
        onClose=${fecharVisualizacao}
      >
        ${previewCarregando
          ? html`<${LoadingState} titulo="Gerando visualização" descricao="Buscando o conteúdo do arquivo no Microsoft Graph." />`
          : previewErro
            ? html`<${EmptyState} titulo="Não foi possível visualizar" descricao=${previewErro} />`
            : previewTipo === 'texto'
              ? html`<pre class="rh-onedrive-preview-text">${previewConteudo}</pre>`
              : previewTipo === 'pdf'
                ? html`<iframe class="rh-onedrive-preview-frame" src=${previewConteudo} title="Visualização do PDF" />`
                : previewTipo === 'office'
                  ? html`<iframe class="rh-onedrive-preview-frame" src=${previewConteudo} title="Visualização do documento" />`
                  : null}
      </${ModalPadrao}>

      <${ModalConfirmacaoAcao}
        aberto=${Boolean(itemParaExcluir)}
        titulo=${`Excluir "${itemParaExcluir?.nome || ''}"`}
        descricao="Esta ação remove o item diretamente do SharePoint/OneDrive corporativo."
        consequencia=${itemParaExcluir?.tipo === 'pasta' ? 'Todo o conteúdo desta pasta também será excluído.' : ''}
        reversibilidade="Esta ação pode ser revertida pela Lixeira do SharePoint por tempo limitado, fora do Conecta."
        textoConfirmar="Excluir"
        tipo="perigo"
        carregando=${excluindo}
        onClose=${() => setItemParaExcluir(null)}
        onConfirm=${confirmarExclusao}
      />

      ${podeComporEmail
        ? html`
            <${ModalComporEmail}
              aberto=${Boolean(itemParaEnviarEmail)}
              controlador=${controlador}
              anexosIniciais=${itemParaEnviarEmail
                ? [{ caminho: [caminho, itemParaEnviarEmail.nome].filter(Boolean).join('/'), nome: itemParaEnviarEmail.nome }]
                : []}
              onClose=${() => setItemParaEnviarEmail(null)}
            />
          `
        : null}
    </${PainelRh}>
  `;
}
