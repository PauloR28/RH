import {
  html,
  useEffect,
  useMemo,
  useRef,
  useState,
} from '../infraestrutura-react.js';
import {
  lerCandidatosProcessos,
  lerProcessos,
} from '../servico-api.js?v=20260721-exam-analytics-2';
import { montarIndiceRequisitosBusca } from '../perguntas.js';
import {
  CHAVE_PIPELINE_CANDIDATO,
  CHAVE_PIPELINE_PROCESSO,
  CHAVE_PROCESSO_DETALHE,
} from '../features/processos-estado.js';
import { IconeSvg } from './icone.js';
import { AREA_PROCESSOS, AREA_PROVAS, areaAtiva, telaEmAreaInativa } from '../shared/areas.js';

export const CHAVE_REQUISITO_BUSCA = 'rh_requisito_busca_atual';
export const CHAVE_COMANDO_NOVO_PROCESSO = 'rh_comando_novo_processo';

const PREFIXOS_COMANDO_NOVO_PROCESSO = ['novo processo', 'criar processo', 'abrir processo'];

function interpretarComando(query) {
  if (!areaAtiva(AREA_PROCESSOS)) return null;
  const termo = normalizarBusca(query);
  const prefixo = PREFIXOS_COMANDO_NOVO_PROCESSO.find((item) => termo.startsWith(item));
  if (!prefixo) return null;

  const resto = String(query || '').trim().slice(prefixo.length).trim();
  return {
    id: 'comando-novo-processo',
    tipo: 'comando',
    titulo: resto ? `Criar processo para "${resto}"` : 'Criar novo processo',
    descricao: 'Comando rápido — abre o formulário de criação já com a operação preenchida.',
    comando: 'novo-processo',
    argumento: resto,
  };
}

const PAGINAS_BUSCA = [
  {
    id: 'pagina-inicio',
    tela: 'screen-menu',
    titulo: 'Painel executivo do RH',
    descricao: 'Visão geral, atalhos e provas recentes.',
  },
  {
    id: 'pagina-historico',
    tela: 'screen-history',
    titulo: 'Histórico de provas',
    descricao: 'Consulta de resultados, filtros e detalhes salvos.',
  },
  {
    id: 'pagina-processos',
    tela: 'screen-processes',
    titulo: 'Processos seletivos',
    descricao: 'Gestão de processos, candidatos e encerramentos.',
  },
  {
    id: 'pagina-candidatos',
    tela: 'screen-candidates',
    titulo: 'Candidatos',
    descricao: 'Central de candidatos, status e vinculações rápidas.',
  },
  {
    id: 'pagina-pipeline',
    tela: 'screen-candidate-pipeline',
    titulo: 'Pipeline de candidatos',
    descricao: 'Kanban por etapa com persistência no backend.',
  },
  {
    id: 'pagina-entrevistas',
    tela: 'screen-interviews',
    titulo: 'Agenda de entrevistas',
    descricao: 'Agenda de entrevistas, status e mensagens base do RH.',
  },
  {
    id: 'pagina-analise',
    tela: 'screen-analysis-candidates',
    titulo: 'Análise de candidatos',
    descricao: 'Leitura analítica, afinidade e parecer final.',
  },
  {
    id: 'pagina-talentos',
    tela: 'screen-talent-bank',
    titulo: 'Banco de talentos',
    descricao: 'Reaproveitamento de candidatos.',
  },
  {
    id: 'pagina-configuracao',
    tela: 'screen-config',
    titulo: 'Configuração da prova',
    descricao: 'Parâmetros da avaliação e requisitos por vaga.',
  },
  {
    id: 'pagina-configuracoes',
    tela: 'screen-settings',
    titulo: 'Configurações do sistema',
    descricao: 'Usuários, perfis, permissões e logs de auditoria.',
  },
];

function normalizarBusca(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function montarTextoBusca(item) {
  return [
    item.titulo,
    item.descricao,
    item.meta,
    item.idProcesso,
    item.nomeCandidato,
    item.vaga,
    item.status,
    item.stageLabel,
    item.blueprintLabel,
  ]
    .filter(Boolean)
    .join(' ');
}

async function carregarIndiceBuscaGlobal() {
  // Área inativa = nenhuma requisição (antes eram 2 chamadas pesadas, com todos os processos e candidatos, na primeira busca).
  const [processos, candidatos] = areaAtiva(AREA_PROCESSOS)
    ? await Promise.all([lerProcessos().catch(() => []), lerCandidatosProcessos().catch(() => [])])
    : [[], []];

  const requisitos = (areaAtiva(AREA_PROVAS) ? montarIndiceRequisitosBusca() : []).map((item) => ({
    id: `requisito-${item.id}`,
    tipo: 'requisito',
    titulo: item.title,
    descricao: item.description,
    meta: `${item.blueprintLabel} • ${item.stageLabel}`,
    blueprintLabel: item.blueprintLabel,
    stageLabel: item.stageLabel,
    questionType: item.questionType,
  }));

  return {
    paginas: PAGINAS_BUSCA.filter((item) => !telaEmAreaInativa(item.tela)).map((item) => ({
      id: item.id,
      tipo: 'pagina',
      titulo: item.titulo,
      descricao: item.descricao,
      tela: item.tela,
    })),
    processos: (Array.isArray(processos) ? processos : []).map((item) => ({
      id: `processo-${item.id_processo}`,
      tipo: 'processo',
      titulo: item.id_processo || 'Processo',
      descricao: `${item.vaga || '-'} • ${item.operacao || item.trilha || '-'} • ${item.status || '-'}`,
      meta: `Vagas ${item.vagas_preenchidas || 0}/${item.quantidade_vagas || 0}`,
      idProcesso: item.id_processo,
    })),
    candidatos: (Array.isArray(candidatos) ? candidatos : [])
      .filter((item) => String(item.id_processo || '').trim())
      .map((item) => ({
        id: `candidato-${item.id_registro}`,
        tipo: 'candidato',
        titulo: item.nome_candidato || 'Candidato',
        descricao: `${item.vaga || '-'} • ${item.id_processo || '-'} • ${item.status_candidato || '-'}`,
        meta: item.origem || '',
        idRegistro: item.id_registro,
        idProcesso: item.id_processo,
        nomeCandidato: item.nome_candidato,
        vaga: item.vaga,
        status: item.status_candidato,
      })),
    requisitos,
  };
}

function filtrarResultados(query, indice) {
  if (!indice) return [];

  const comando = interpretarComando(query);

  const termo = normalizarBusca(query);
  if (!termo) {
    return indice.paginas.slice(0, 5);
  }

  const colecoes = [
    ...indice.paginas,
    ...indice.processos,
    ...indice.candidatos,
    ...indice.requisitos,
  ];

  const resultadosTexto = colecoes
    .map((item) => ({
      ...item,
      _busca: normalizarBusca(montarTextoBusca(item)),
    }))
    .filter((item) => item._busca.includes(termo))
    .sort((a, b) => a._busca.indexOf(termo) - b._busca.indexOf(termo))
    .slice(0, 12);

  return comando ? [comando, ...resultadosTexto] : resultadosTexto;
}

function rotuloTipo(tipo) {
  if (tipo === 'comando') return 'Comando';
  if (tipo === 'pagina') return 'Página';
  if (tipo === 'processo') return 'Processo';
  if (tipo === 'candidato') return 'Candidato';
  return 'Requisito';
}

function selecionarResultado(resultado, controlador, limparBusca) {
  if (!resultado) return;

  if (resultado.tipo === 'comando' && resultado.comando === 'novo-processo') {
    sessionStorage.setItem(CHAVE_COMANDO_NOVO_PROCESSO, resultado.argumento || '');
    controlador.irParaTelaProtegida('screen-process-create');
    limparBusca();
    return;
  }

  if (resultado.tipo === 'pagina') {
    controlador.irParaTelaProtegida(resultado.tela);
    limparBusca();
    return;
  }

  if (resultado.tipo === 'processo') {
    sessionStorage.setItem(CHAVE_PROCESSO_DETALHE, resultado.idProcesso || '');
    sessionStorage.setItem(CHAVE_PIPELINE_PROCESSO, resultado.idProcesso || '');
    controlador.irParaTelaProtegida('screen-process-details');
    limparBusca();
    return;
  }

  if (resultado.tipo === 'candidato') {
    sessionStorage.setItem(CHAVE_PIPELINE_PROCESSO, resultado.idProcesso || '');
    sessionStorage.setItem(CHAVE_PIPELINE_CANDIDATO, String(resultado.idRegistro || ''));
    controlador.irParaTelaProtegida('screen-candidate-pipeline');
    limparBusca();
    return;
  }

  sessionStorage.setItem(CHAVE_REQUISITO_BUSCA, JSON.stringify(resultado));
  controlador.irParaTelaProtegida('screen-config');
  limparBusca();
}

export function BuscaGlobalTopbar({ placeholderBusca, controlador }) {
  const [termo, setTermo] = useState('');
  const [aberta, setAberta] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [indice, setIndice] = useState(null);
  const caixaRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const fecharAoClicarFora = (event) => {
      if (!caixaRef.current?.contains(event.target)) {
        setAberta(false);
      }
    };

    window.addEventListener('mousedown', fecharAoClicarFora);
    return () => window.removeEventListener('mousedown', fecharAoClicarFora);
  }, []);

  useEffect(() => {
    const acionarAtalho = (event) => {
      const teclaBusca = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      if (teclaBusca) {
        event.preventDefault();
        inputRef.current?.focus();
        setAberta(true);
        return;
      }
      if (event.key === 'Escape' && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
        setAberta(false);
      }
    };

    window.addEventListener('keydown', acionarAtalho);
    return () => window.removeEventListener('keydown', acionarAtalho);
  }, []);

  const garantirIndice = async () => {
    if (indice || carregando) return;

    setCarregando(true);
    try {
      setIndice(await carregarIndiceBuscaGlobal());
    } finally {
      setCarregando(false);
    }
  };

  const resultados = useMemo(() => filtrarResultados(termo, indice), [indice, termo]);

  const limparBusca = () => {
    setTermo('');
    setAberta(false);
  };

  return html`
    <div class="rh-global-search" ref=${caixaRef}>
      <div class="rh-modern-search-shell">
        <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('search')}</span>
        <label class="visually-hidden" for="rh-global-search-input">
          Pesquisar candidatos, processos e informações
        </label>
        <input
          id="rh-global-search-input"
          ref=${inputRef}
          type="text"
          aria-label="Pesquisar candidatos, processos e informações"
          placeholder=${placeholderBusca}
          value=${termo}
          onFocus=${async () => {
            setAberta(true);
            await garantirIndice();
          }}
          onInput=${async (event) => {
            setTermo(event.target.value);
            setAberta(true);
            await garantirIndice();
          }}
        />
        <kbd class="rh-global-search-shortcut" aria-hidden="true">
          ${/mac/i.test(navigator.platform || navigator.userAgent || '') ? '⌘K' : 'Ctrl+K'}
        </kbd>
      </div>

      ${aberta
        ? html`
            <div class="rh-global-search-panel">
              ${carregando
                ? html`<div class="rh-global-search-empty">Carregando indice de busca...</div>`
                : resultados.length
                  ? html`
                      ${resultados.map(
                        (resultado) => html`
                          <button
                            key=${resultado.id}
                            type="button"
                            class="rh-global-search-result"
                            onClick=${() =>
                              selecionarResultado(
                                resultado,
                                controlador,
                                limparBusca,
                              )}
                          >
                            <div class="rh-global-search-result-head">
                              <strong>${resultado.titulo}</strong>
                              <span class="rh-global-search-tag">
                                ${rotuloTipo(resultado.tipo)}
                              </span>
                            </div>
                            <p>${resultado.descricao || 'Sem descrição adicional.'}</p>
                            ${resultado.meta
                              ? html`<span class="rh-global-search-meta">${resultado.meta}</span>`
                              : null}
                          </button>
                        `,
                      )}
                    `
                  : html`
                      <div class="rh-global-search-empty">
                        Nenhum resultado encontrado para "${termo}".
                      </div>
                    `}
            </div>
          `
        : null}
    </div>
  `;
}
