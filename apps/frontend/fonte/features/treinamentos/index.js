import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import {
  atualizarAgendaTreinamento,
  atualizarTrilhaOnboarding,
  criarTrilhaOnboarding,
  excluirAtribuicaoTreinamento,
  excluirTrilhaOnboarding,
  liberarVagasTreinamento,
  listarAtribuicoesTreinamento,
  listarCandidatosLiberacaoTreinamento,
  listarTreinamentosProcesso,
  listarTrilhasOnboarding,
  relatorioConclusaoOperacao,
  relatorioPresencaColaborador,
  relatorioTreinamentosStatus,
  salvarPresencaTreinamento,
} from '../../servico-api.js?v=20260906-central-treinamentos';
import { listarOperacoes } from '../../services/api/operations.js';
import {
  ModalPadrao,
  PageIntro,
  PainelRh,
  SectionCard,
} from '../../ui/componentes-compartilhados.js';
import { TabelaVazia } from '../../shared/components/empty-table-row.js';
import { SkeletonTableRows } from '../../shared/components/skeleton.js';
import { IconeSvg } from '../../ui/icone.js';

const CATEGORIAS_TREINAMENTO = ['LGPD', 'Segurança da Informação', 'Tecnologia', 'Operações', 'Onboarding', 'Produto', 'Outro'];
const MODALIDADES_TREINAMENTO = [
  { value: '', label: 'Não definida' },
  { value: 'presencial', label: 'Presencial' },
  { value: 'virtual', label: 'Virtual' },
  { value: 'hibrido', label: 'Híbrido' },
];
const TIPOS_CONTEUDO = [
  { value: '', label: 'Somente checklist' },
  { value: 'video', label: 'Vídeo' },
  { value: 'texto', label: 'Texto' },
  { value: 'slide', label: 'Slide' },
  { value: 'link', label: 'Link (ex.: intranet/SharePoint)' },
];
// Editáveis manualmente no modal "Editar treinamento". "Pendente de chamada" e
// "Encerrado sem chamada" (abaixo) são estados automáticos do job de
// escalonamento (plano técnico §6) — não aparecem como opção manual.
const STATUS_ATRIBUICAO_EDITAVEL = [
  { value: 'em_andamento', label: 'Em andamento' },
  { value: 'concluido', label: 'Concluído' },
  { value: 'cancelado', label: 'Cancelado' },
  { value: 'aplicado', label: 'Aplicado' },
];
const STATUS_ATRIBUICAO = [
  ...STATUS_ATRIBUICAO_EDITAVEL,
  { value: 'pendente_chamada', label: 'Pendente de chamada' },
  { value: 'encerrado_sem_chamada', label: 'Encerrado sem chamada' },
];
const STATUS_TOM = {
  em_andamento: '',
  concluido: 'is-indicacao',
  cancelado: 'is-eliminado',
  aplicado: 'is-indicacao',
  pendente_chamada: 'is-alerta',
  encerrado_sem_chamada: 'is-critico',
};

const METODOS_LOGIN_TREINAMENTO = [
  { value: '', label: 'Não definido' },
  { value: 'microsoft', label: 'Microsoft' },
  { value: 'telefone', label: 'Telefone' },
  { value: 'email', label: 'E-mail' },
  { value: 'nome', label: 'Nome' },
];

const SLIDE_INICIAL = { titulo: '', texto: '' };
const ITEM_INICIAL = { titulo: '', descricao: '', obrigatorio: true, tipo_conteudo: '', conteudo_url: '' };
const FORM_TRILHA_INICIAL = {
  id_trilha: '',
  nome: '',
  descricao: '',
  ativo: true,
  categoria: 'Onboarding',
  id_operacao: '',
  modalidade: '',
  local_padrao: '',
  itens: [],
  slides: [],
};
const FORM_AGENDAR_INICIAL = {
  id_onboarding: '',
  data_prevista: '',
  local: '',
  ministrante: '',
};
const FORM_EDITAR_TREINAMENTO_INICIAL = {
  id_onboarding: '',
  status: 'em_andamento',
  acesso_plataforma: false,
  metodo_login: '',
};

function normalizarItensParaEnvio(itens) {
  return itens.map((item, index) => ({
    titulo: item.titulo.trim(),
    descricao: (item.descricao || '').trim(),
    ordem: index,
    obrigatorio: !!item.obrigatorio,
    tipo_conteudo: item.tipo_conteudo || '',
    conteudo_url: (item.conteudo_url || '').trim(),
  }));
}

function formatarDataHora(valor) {
  if (!valor) return '-';
  try {
    return new Date(valor).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch (error) {
    return valor;
  }
}

const REGEX_DIACRITICOS_TREINO = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');

function normalizarBuscaTreino(valor) {
  const semAcento = String(valor || '').normalize('NFD').replace(REGEX_DIACRITICOS_TREINO, '');
  return semAcento.toLowerCase().trim();
}

function paraInputDatetimeLocal(valor) {
  if (!valor) return '';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '';
  const offset = data.getTimezoneOffset();
  const local = new Date(data.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

export function TelaTreinamentos({ controlador, telaAtual = 'screen-training-trilhas' }) {
  const abaAtiva = telaAtual === 'screen-training-manage' ? 'gestao' : telaAtual === 'screen-training-assignments' ? 'atribuicoes' : 'trilhas';
  const podeEditar = controlador?.possuiPermissao?.('onboarding.editar');
  const podeCriar = controlador?.possuiPermissao?.('onboarding.criar');

  const [trilhas, setTrilhas] = useState([]);
  const [operacoes, setOperacoes] = useState([]);
  const [atribuicoes, setAtribuicoes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const [modalTrilhaAberto, setModalTrilhaAberto] = useState(false);
  const [formTrilha, setFormTrilha] = useState(FORM_TRILHA_INICIAL);
  const [salvandoTrilha, setSalvandoTrilha] = useState(false);
  const [erroTrilha, setErroTrilha] = useState('');

  const [excluindoTrilhaId, setExcluindoTrilhaId] = useState(null);

  const [modalAgendarAberto, setModalAgendarAberto] = useState(false);
  const [formAgendar, setFormAgendar] = useState(FORM_AGENDAR_INICIAL);
  const [salvandoAgenda, setSalvandoAgenda] = useState(false);
  const [erroAgenda, setErroAgenda] = useState('');

  const [modalEditarTreinamentoAberto, setModalEditarTreinamentoAberto] = useState(false);
  const [formEditarTreinamento, setFormEditarTreinamento] = useState(FORM_EDITAR_TREINAMENTO_INICIAL);

  const [presencasPendentes, setPresencasPendentes] = useState({});
  const [salvandoPresenca, setSalvandoPresenca] = useState(false);

  const [treinamentoEmAndamento, setTreinamentoEmAndamento] = useState(null);
  const [slideAtual, setSlideAtual] = useState(0);

  const [treinamentosProcesso, setTreinamentosProcesso] = useState([]);
  const [modalLiberarAberto, setModalLiberarAberto] = useState(false);
  const [treinamentoProcessoSelecionado, setTreinamentoProcessoSelecionado] = useState(null);
  const [candidatosParaLiberar, setCandidatosParaLiberar] = useState([]);
  const [candidatosSelecionados, setCandidatosSelecionados] = useState([]);
  const [salvandoLiberacao, setSalvandoLiberacao] = useState(false);
  const [erroLiberacao, setErroLiberacao] = useState('');

  const [relatorioStatus, setRelatorioStatus] = useState([]);
  const [relatorioPresenca, setRelatorioPresenca] = useState([]);
  const [relatorioConclusao, setRelatorioConclusao] = useState([]);
  const [carregandoRelatorios, setCarregandoRelatorios] = useState(false);

  const carregarTrilhas = async () => {
    try {
      const dados = await listarTrilhasOnboarding();
      setTrilhas(Array.isArray(dados) ? dados : []);
    } catch (error) {
      setErro(error?.message || 'Não foi possível carregar os treinamentos.');
    }
  };

  const carregarAtribuicoes = async () => {
    try {
      const dados = await listarAtribuicoesTreinamento();
      setAtribuicoes(Array.isArray(dados) ? dados : []);
    } catch (error) {
      setErro(error?.message || 'Não foi possível carregar as atribuições de treinamento.');
    }
  };

  const carregarOperacoes = async () => {
    try {
      const dados = await listarOperacoes();
      setOperacoes(Array.isArray(dados) ? dados : []);
    } catch (error) {
      // A lista de operações é auxiliar (filtro); segue sem quebrar a tela.
    }
  };

  const carregarTreinamentosProcesso = async () => {
    try {
      const dados = await listarTreinamentosProcesso();
      setTreinamentosProcesso(Array.isArray(dados) ? dados : []);
    } catch (error) {
      // Seção auxiliar — não bloqueia o restante da tela.
    }
  };

  const carregarTudo = async () => {
    setCarregando(true);
    setErro('');
    await Promise.all([carregarTrilhas(), carregarAtribuicoes(), carregarOperacoes(), carregarTreinamentosProcesso()]);
    setCarregando(false);
  };

  useEffect(() => {
    carregarTudo();
  }, []);

  useEffect(() => {
    if (abaAtiva !== 'gestao') return;
    setCarregandoRelatorios(true);
    Promise.all([
      relatorioTreinamentosStatus().catch(() => []),
      relatorioPresencaColaborador().catch(() => []),
      relatorioConclusaoOperacao().catch(() => []),
    ])
      .then(([status, presenca, conclusao]) => {
        setRelatorioStatus(Array.isArray(status) ? status : []);
        setRelatorioPresenca(Array.isArray(presenca) ? presenca : []);
        setRelatorioConclusao(Array.isArray(conclusao) ? conclusao : []);
      })
      .finally(() => setCarregandoRelatorios(false));
  }, [abaAtiva]);

  const nomeOperacao = (idOperacao) =>
    operacoes.find((operacao) => String(operacao.id_item) === String(idOperacao))?.nome || '';

  const irParaAba = (aba) => {
    controlador.irParaTelaProtegida(
      aba === 'atribuicoes'
        ? 'screen-training-assignments'
        : aba === 'gestao'
          ? 'screen-training-manage'
          : 'screen-training-trilhas',
    );
  };

  // -- Trilhas -----------------------------------------------------------

  const abrirNovaTrilha = () => {
    setFormTrilha({ ...FORM_TRILHA_INICIAL, itens: [{ ...ITEM_INICIAL }] });
    setErroTrilha('');
    setModalTrilhaAberto(true);
  };

  const abrirEdicaoTrilha = (trilha) => {
    let slides = [];
    try {
      const conteudo = JSON.parse(trilha.conteudo_json || '{}');
      slides = Array.isArray(conteudo.slides) ? conteudo.slides : [];
    } catch (error) {
      slides = [];
    }
    setFormTrilha({
      id_trilha: trilha.id_trilha,
      nome: trilha.nome || '',
      descricao: trilha.descricao || '',
      ativo: !!trilha.ativo,
      categoria: trilha.categoria || 'Onboarding',
      id_operacao: trilha.id_operacao || '',
      modalidade: trilha.modalidade || '',
      local_padrao: trilha.local_padrao || '',
      itens: (trilha.itens || []).map((item) => ({
        titulo: item.titulo || '',
        descricao: item.descricao || '',
        obrigatorio: !!item.obrigatorio,
        tipo_conteudo: item.tipo_conteudo || '',
        conteudo_url: item.conteudo_url || '',
      })),
      slides: slides.map((slide) => ({ titulo: slide.titulo || '', texto: slide.texto || '' })),
    });
    setErroTrilha('');
    setModalTrilhaAberto(true);
  };

  const adicionarSlideTrilha = () => {
    setFormTrilha((atual) => ({ ...atual, slides: [...atual.slides, { ...SLIDE_INICIAL }] }));
  };

  const atualizarSlideTrilha = (index, campo, valor) => {
    setFormTrilha((atual) => ({
      ...atual,
      slides: atual.slides.map((slide, idx) => (idx === index ? { ...slide, [campo]: valor } : slide)),
    }));
  };

  const removerSlideTrilha = (index) => {
    setFormTrilha((atual) => ({ ...atual, slides: atual.slides.filter((_, idx) => idx !== index) }));
  };

  const fecharModalTrilha = () => {
    setModalTrilhaAberto(false);
    setFormTrilha(FORM_TRILHA_INICIAL);
    setErroTrilha('');
  };

  const atualizarItemTrilha = (index, campo, valor) => {
    setFormTrilha((atual) => ({
      ...atual,
      itens: atual.itens.map((item, idx) => (idx === index ? { ...item, [campo]: valor } : item)),
    }));
  };

  const adicionarItemTrilha = () => {
    setFormTrilha((atual) => ({ ...atual, itens: [...atual.itens, { ...ITEM_INICIAL }] }));
  };

  const removerItemTrilha = (index) => {
    setFormTrilha((atual) => ({ ...atual, itens: atual.itens.filter((_, idx) => idx !== index) }));
  };

  const moverItemTrilha = (index, direcao) => {
    setFormTrilha((atual) => {
      const novoIndex = index + direcao;
      if (novoIndex < 0 || novoIndex >= atual.itens.length) return atual;
      const itens = [...atual.itens];
      const [item] = itens.splice(index, 1);
      itens.splice(novoIndex, 0, item);
      return { ...atual, itens };
    });
  };

  const itensTrilhaValidos = formTrilha.itens.every((item) => item.titulo.trim());

  const salvarTrilha = async () => {
    setErroTrilha('');
    if (!formTrilha.nome.trim()) {
      setErroTrilha('Informe o nome do treinamento.');
      return;
    }
    if (!itensTrilhaValidos) {
      setErroTrilha('Informe o título de todos os módulos do treinamento.');
      return;
    }

    const payload = {
      nome: formTrilha.nome.trim(),
      descricao: formTrilha.descricao.trim(),
      ativo: !!formTrilha.ativo,
      categoria: formTrilha.categoria,
      id_operacao: formTrilha.id_operacao ? Number(formTrilha.id_operacao) : null,
      modalidade: formTrilha.modalidade,
      local_padrao: formTrilha.local_padrao.trim(),
      itens: normalizarItensParaEnvio(formTrilha.itens),
      conteudo_json: JSON.stringify({
        slides: formTrilha.slides
          .filter((slide) => slide.titulo.trim() || slide.texto.trim())
          .map((slide) => ({ titulo: slide.titulo.trim(), texto: slide.texto.trim() })),
      }),
    };

    setSalvandoTrilha(true);
    try {
      if (formTrilha.id_trilha) {
        await atualizarTrilhaOnboarding(formTrilha.id_trilha, payload);
      } else {
        await criarTrilhaOnboarding(payload);
      }
      fecharModalTrilha();
      await carregarTrilhas();
    } catch (error) {
      setErroTrilha(error?.message || 'Não foi possível salvar o treinamento.');
    } finally {
      setSalvandoTrilha(false);
    }
  };

  const excluirTrilhaCadastrada = async (item) => {
    if (!window.confirm(`Excluir definitivamente o treinamento "${item.nome}"? Esta ação não pode ser desfeita.`)) return;
    setErro('');
    setExcluindoTrilhaId(item.id_trilha);
    try {
      await excluirTrilhaOnboarding(item.id_trilha);
      await carregarTrilhas();
    } catch (error) {
      setErro(error?.message || 'Não foi possível excluir este treinamento.');
    } finally {
      setExcluindoTrilhaId(null);
    }
  };

  // -- Atribuições: Agendar / Editar / Encerrar ---------------------------

  const abrirAgendar = (atribuicao) => {
    setFormAgendar({
      id_onboarding: atribuicao.id_onboarding,
      data_prevista: paraInputDatetimeLocal(atribuicao.data_prevista),
      local: atribuicao.local || '',
      ministrante: atribuicao.ministrante || '',
    });
    setErroAgenda('');
    setModalAgendarAberto(true);
  };

  const fecharModalAgendar = () => {
    setModalAgendarAberto(false);
    setFormAgendar(FORM_AGENDAR_INICIAL);
    setErroAgenda('');
  };

  const salvarAgendamento = async () => {
    setSalvandoAgenda(true);
    setErroAgenda('');
    try {
      await atualizarAgendaTreinamento(formAgendar.id_onboarding, {
        data_prevista: formAgendar.data_prevista ? new Date(formAgendar.data_prevista).toISOString() : null,
        local: formAgendar.local.trim(),
        ministrante: formAgendar.ministrante.trim(),
      });
      fecharModalAgendar();
      await carregarAtribuicoes();
    } catch (error) {
      setErroAgenda(error?.message || 'Não foi possível salvar a agenda do treinamento.');
    } finally {
      setSalvandoAgenda(false);
    }
  };

  const abrirEditarTreinamento = (atribuicao) => {
    setFormEditarTreinamento({
      id_onboarding: atribuicao.id_onboarding,
      status: atribuicao.status || 'em_andamento',
      acesso_plataforma: !!atribuicao.acesso_plataforma,
      metodo_login: atribuicao.metodo_login || '',
    });
    setErroAgenda('');
    setModalEditarTreinamentoAberto(true);
  };

  const fecharModalEditarTreinamento = () => {
    setModalEditarTreinamentoAberto(false);
    setFormEditarTreinamento(FORM_EDITAR_TREINAMENTO_INICIAL);
  };

  const salvarEdicaoTreinamento = async () => {
    setSalvandoAgenda(true);
    setErroAgenda('');
    try {
      const atribuicaoAtual = atribuicoes.find((item) => String(item.id_onboarding) === String(formEditarTreinamento.id_onboarding));
      await atualizarAgendaTreinamento(formEditarTreinamento.id_onboarding, {
        data_prevista: atribuicaoAtual?.data_prevista || null,
        local: atribuicaoAtual?.local || '',
        ministrante: atribuicaoAtual?.ministrante || '',
        status: formEditarTreinamento.status,
        acesso_plataforma: !!formEditarTreinamento.acesso_plataforma,
        metodo_login: formEditarTreinamento.metodo_login,
      });
      fecharModalEditarTreinamento();
      await carregarAtribuicoes();
    } catch (error) {
      setErroAgenda(error?.message || 'Não foi possível salvar as configurações do treinamento.');
    } finally {
      setSalvandoAgenda(false);
    }
  };

  const encerrarTreinamentoColaborador = async (atribuicao) => {
    if (!window.confirm(`Encerrar/excluir o treinamento "${atribuicao.trilha_nome}" de ${atribuicao.nome_candidato || 'colaborador'}?`)) return;
    try {
      await excluirAtribuicaoTreinamento(atribuicao.id_onboarding);
      await carregarAtribuicoes();
    } catch (error) {
      setErro(error?.message || 'Não foi possível encerrar o treinamento.');
    }
  };

  // -- Lista de presença ---------------------------------------------------

  const alternarPresencaPendente = (idOnboarding, presente) => {
    setPresencasPendentes((atual) => ({ ...atual, [idOnboarding]: presente }));
  };

  const salvarListaPresenca = async () => {
    const presencas = Object.entries(presencasPendentes).map(([id_onboarding, presente]) => ({
      id_onboarding: Number(id_onboarding),
      presente,
    }));
    if (!presencas.length) return;
    setSalvandoPresenca(true);
    try {
      await salvarPresencaTreinamento(presencas);
      setPresencasPendentes({});
      await carregarAtribuicoes();
    } catch (error) {
      setErro(error?.message || 'Não foi possível salvar a lista de presença.');
    } finally {
      setSalvandoPresenca(false);
    }
  };

  // -- Começar Treinamento (ministrante) -----------------------------------

  const podeComecarTreinamento = (atribuicao) => {
    if (!atribuicao.data_prevista) return false;
    const nomeUsuario = normalizarBuscaTreino(controlador?.estado?.nomeUsuarioAutenticado || '');
    const ministrante = normalizarBuscaTreino(atribuicao.ministrante || '');
    if (!ministrante || !nomeUsuario || !ministrante.includes(nomeUsuario)) return false;
    const agora = Date.now();
    const previsto = new Date(atribuicao.data_prevista).getTime();
    const duasHoras = 2 * 60 * 60 * 1000;
    return agora >= previsto - duasHoras && agora <= previsto + duasHoras;
  };

  const comecarTreinamento = (atribuicao) => {
    const trilha = trilhas.find((item) => String(item.id_trilha) === String(atribuicao.trilha_id));
    let slides = [];
    try {
      const conteudo = JSON.parse(trilha?.conteudo_json || '{}');
      slides = Array.isArray(conteudo.slides) ? conteudo.slides : [];
    } catch (error) {
      slides = [];
    }
    setSlideAtual(0);
    setTreinamentoEmAndamento({ atribuicao, slides });
  };

  // -- Treinamentos por processo (AGUARDANDO PROCESSO / ABERTO) -----------

  const abrirLiberarVagas = async (treinamentoProcesso) => {
    setTreinamentoProcessoSelecionado(treinamentoProcesso);
    setCandidatosSelecionados([]);
    setErroLiberacao('');
    setModalLiberarAberto(true);
    try {
      const dados = await listarCandidatosLiberacaoTreinamento(treinamentoProcesso.id_processo_treinamento);
      setCandidatosParaLiberar(Array.isArray(dados) ? dados : []);
    } catch (error) {
      setErroLiberacao(error?.message || 'Não foi possível carregar os candidatos aprovados deste processo.');
    }
  };

  const fecharModalLiberar = () => {
    setModalLiberarAberto(false);
    setTreinamentoProcessoSelecionado(null);
    setCandidatosParaLiberar([]);
    setCandidatosSelecionados([]);
  };

  const alternarCandidatoLiberacao = (idRegistro) => {
    setCandidatosSelecionados((atual) =>
      atual.includes(idRegistro) ? atual.filter((item) => item !== idRegistro) : [...atual, idRegistro],
    );
  };

  const confirmarLiberacaoVagas = async () => {
    if (!treinamentoProcessoSelecionado || !candidatosSelecionados.length) return;
    setSalvandoLiberacao(true);
    setErroLiberacao('');
    try {
      await liberarVagasTreinamento(treinamentoProcessoSelecionado.id_processo_treinamento, candidatosSelecionados);
      fecharModalLiberar();
      await Promise.all([carregarTreinamentosProcesso(), carregarAtribuicoes()]);
    } catch (error) {
      setErroLiberacao(error?.message || 'Não foi possível liberar as vagas selecionadas.');
    } finally {
      setSalvandoLiberacao(false);
    }
  };

  const trilhasAtivas = useMemo(() => trilhas.filter((trilha) => trilha.ativo), [trilhas]);

  const renderTrilhas = () => html`
    ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}
    <${SectionCard} title="Treinamentos" className="rh-section-card--flat">
      <div class="table-responsive">
        <table class="table align-middle rh-modern-history-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Categoria</th>
              <th>Operação</th>
              <th>Modalidade</th>
              <th>Módulos</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            ${carregando
      ? html`<${SkeletonTableRows} colunas=${7} linhas=${3} />`
      : trilhas.length
        ? trilhas.map(
          (item) => html`
                    <tr key=${item.id_trilha}>
                      <td>
                        <strong>${item.nome}</strong>
                        ${item.descricao ? html`<div class="text-muted small">${item.descricao}</div>` : null}
                      </td>
                      <td>${item.categoria || 'Onboarding'}</td>
                      <td>${nomeOperacao(item.id_operacao) || 'Todas'}</td>
                      <td>${MODALIDADES_TREINAMENTO.find((m) => m.value === item.modalidade)?.label || '-'}</td>
                      <td>${(item.itens || []).length} módulo(s)</td>
                      <td>
                        <span class=${`rh-chip ${item.ativo ? 'is-indicacao' : ''}`}>
                          ${item.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td>
                        <div class="d-flex gap-2">
                          <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => abrirEdicaoTrilha(item)}>
                            <span class="material-symbols-outlined">${IconeSvg('edit')}</span>
                            Editar
                          </button>
                          <button
                            type="button"
                            class="btn btn-outline-danger btn-sm"
                            disabled=${excluindoTrilhaId === item.id_trilha}
                            onClick=${() => excluirTrilhaCadastrada(item)}
                          >
                            <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                            ${excluindoTrilhaId === item.id_trilha ? 'Excluindo...' : 'Excluir'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  `,
        )
        : html`<${TabelaVazia} colunas=${7} texto="Nenhum treinamento cadastrado." icone="school" />`}
          </tbody>
        </table>
      </div>
    </${SectionCard}>
  `;

  const renderAtribuicoes = () => html`
    ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}
    <${SectionCard}
      title="Colaboradores em treinamento"
      className="rh-section-card--flat"
      description="Quem está fazendo o quê, quando e onde — marque a presença ao final de cada treinamento aplicado."
      actions=${Object.keys(presencasPendentes).length
      ? html`
              <button type="button" class="btn btn-primary btn-sm" disabled=${salvandoPresenca} onClick=${salvarListaPresenca}>
                <span class="material-symbols-outlined">${IconeSvg('how_to_reg')}</span>
                ${salvandoPresenca ? 'Salvando...' : `Salvar presença (${Object.keys(presencasPendentes).length})`}
              </button>
            `
      : null}
    >
      <div class="table-responsive">
        <table class="table align-middle rh-modern-history-table">
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Treinamento</th>
              <th>Progresso</th>
              <th>Data prevista</th>
              <th>Local</th>
              <th>Ministrante</th>
              <th>Status</th>
              <th>Presença</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            ${carregando
      ? html`<${SkeletonTableRows} colunas=${9} linhas=${3} />`
      : atribuicoes.length
        ? atribuicoes.map(
          (item) => html`
                    <tr key=${item.id_onboarding}>
                      <td>
                        <strong>${item.nome_candidato || `Registro ${item.id_registro}`}</strong>
                        ${item.vaga ? html`<div class="text-muted small">${item.vaga}</div>` : null}
                      </td>
                      <td>
                        ${item.trilha_nome}
                        <div class="text-muted small">${item.trilha_categoria || 'Onboarding'}</div>
                      </td>
                      <td>${item.itens_concluidos}/${item.total_itens} (${item.percentual_concluido}%)</td>
                      <td>${formatarDataHora(item.data_prevista)}</td>
                      <td>${item.local || '-'}</td>
                      <td>${item.ministrante || '-'}</td>
                      <td>
                        <span class=${`rh-chip ${STATUS_TOM[item.status] || ''}`}>
                          ${STATUS_ATRIBUICAO.find((s) => s.value === item.status)?.label || item.status}
                        </span>
                      </td>
                      <td>
                        <select
                          class="form-select form-select-sm"
                          disabled=${!podeEditar}
                          value=${presencasPendentes[item.id_onboarding] === undefined
          ? (item.presenca || '')
          : (presencasPendentes[item.id_onboarding] ? 'presente' : 'falta')}
                          onChange=${(event) => alternarPresencaPendente(item.id_onboarding, event.target.value === 'presente')}
                        >
                          <option value="">-</option>
                          <option value="presente">Presente</option>
                          <option value="falta">Falta</option>
                        </select>
                      </td>
                      <td>
                        <div class="d-flex flex-wrap gap-2">
                          <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${!podeEditar} onClick=${() => abrirAgendar(item)} title="Agendar">
                            <span class="material-symbols-outlined">${IconeSvg('event')}</span>
                          </button>
                          <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${!podeEditar} onClick=${() => abrirEditarTreinamento(item)} title="Editar">
                            <span class="material-symbols-outlined">${IconeSvg('edit')}</span>
                          </button>
                          <button type="button" class="btn btn-outline-danger btn-sm" disabled=${!podeEditar} onClick=${() => encerrarTreinamentoColaborador(item)} title="Encerrar">
                            <span class="material-symbols-outlined">${IconeSvg('stop_circle')}</span>
                          </button>
                          ${podeComecarTreinamento(item)
          ? html`
                                <button type="button" class="btn btn-primary btn-sm" onClick=${() => comecarTreinamento(item)}>
                                  <span class="material-symbols-outlined">${IconeSvg('play_circle')}</span>
                                  Começar treinamento
                                </button>
                              `
          : null}
                        </div>
                      </td>
                    </tr>
                  `,
        )
        : html`<${TabelaVazia} colunas=${9} texto="Nenhum colaborador em treinamento no momento." icone="assignment_ind" />`}
          </tbody>
        </table>
      </div>
    </${SectionCard}>
  `;

  const renderTreinamentosProcesso = () => html`
    <${SectionCard}
      title="Treinamentos por processo seletivo"
      className="rh-section-card--flat mt-4"
      description="Vagas de treinamento vinculadas a processos abertos — libere antes do encerramento quando já houver aprovados prontos para treinar."
    >
      <div class="table-responsive">
        <table class="table align-middle rh-modern-history-table">
          <thead>
            <tr>
              <th>Processo</th>
              <th>Treinamento</th>
              <th>Aguardando processo</th>
              <th>Aberto</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            ${treinamentosProcesso.length
      ? treinamentosProcesso.map(
        (item) => html`
                    <tr key=${item.id_processo_treinamento}>
                      <td>
                        <strong>${item.vaga}</strong>
                        <div class="text-muted small">${item.id_processo} · ${item.processo_status}</div>
                      </td>
                      <td>${item.trilha_nome}</td>
                      <td>
                        ${item.vagas_bloqueadas > 0
            ? html`<span class="rh-chip">AGUARDANDO PROCESSO (${item.vagas_bloqueadas})</span>`
            : html`<span class="text-muted">-</span>`}
                      </td>
                      <td>
                        ${item.vagas_liberadas > 0
            ? html`<span class="rh-chip is-indicacao">ABERTO (${item.vagas_liberadas})</span>`
            : html`<span class="text-muted">-</span>`}
                      </td>
                      <td>
                        <button
                          type="button"
                          class="btn btn-outline-primary btn-sm"
                          disabled=${!podeEditar || item.vagas_bloqueadas <= 0}
                          onClick=${() => abrirLiberarVagas(item)}
                        >
                          <span class="material-symbols-outlined">${IconeSvg('lock_open')}</span>
                          Liberar vagas
                        </button>
                      </td>
                    </tr>
                  `,
      )
      : html`<${TabelaVazia} colunas=${5} texto="Nenhum treinamento vinculado a processo seletivo no momento." icone="fact_check" />`}
          </tbody>
        </table>
      </div>
    </${SectionCard}>
  `;

  const renderGestao = () => html`
    <${SectionCard}
      title="Relatórios de treinamentos aplicados x pendentes x encerrados sem chamada"
      className="rh-section-card--flat mb-4"
      description="Edição de treinamentos e histórico de presença ficam nas abas Treinamentos/Atribuições acima."
    >
      <div class="table-responsive">
        <table class="table align-middle rh-modern-history-table">
          <thead>
            <tr>
              <th>Treinamento</th>
              <th>Status</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${carregandoRelatorios
      ? html`<${SkeletonTableRows} colunas=${3} linhas=${3} />`
      : relatorioStatus.length
        ? relatorioStatus.map(
          (linha, index) => html`
                    <tr key=${index}>
                      <td>${linha.trilha_nome}</td>
                      <td><span class=${`rh-chip ${STATUS_TOM[linha.status] || ''}`}>${STATUS_ATRIBUICAO.find((s) => s.value === linha.status)?.label || linha.status}</span></td>
                      <td>${linha.total}</td>
                    </tr>
                  `,
        )
        : html`<${TabelaVazia} colunas=${3} texto="Sem dados ainda." icone="bar_chart" />`}
          </tbody>
        </table>
      </div>
    </${SectionCard}>

    <${SectionCard} title="Presença/participação por colaborador" className="rh-section-card--flat mb-4">
      <div class="table-responsive">
        <table class="table align-middle rh-modern-history-table">
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Total de treinamentos</th>
              <th>Presenças</th>
              <th>Faltas</th>
              <th>Pendências</th>
            </tr>
          </thead>
          <tbody>
            ${carregandoRelatorios
      ? html`<${SkeletonTableRows} colunas=${5} linhas=${3} />`
      : relatorioPresenca.length
        ? relatorioPresenca.map(
          (linha) => html`
                    <tr key=${linha.id_registro}>
                      <td>${linha.nome_candidato}</td>
                      <td>${linha.total_treinamentos}</td>
                      <td>${linha.presencas}</td>
                      <td>${linha.faltas}</td>
                      <td>${linha.pendencias}</td>
                    </tr>
                  `,
        )
        : html`<${TabelaVazia} colunas=${5} texto="Sem dados ainda." icone="how_to_reg" />`}
          </tbody>
        </table>
      </div>
    </${SectionCard}>

    <${SectionCard}
      title="Taxa de conclusão por operação"
      className="rh-section-card--flat mb-4"
      description="Relatório extra (baixo custo, alto valor para o RH acompanhar por operação)."
    >
      <div class="table-responsive">
        <table class="table align-middle rh-modern-history-table">
          <thead>
            <tr>
              <th>Operação</th>
              <th>Atribuições</th>
              <th>Aplicadas</th>
              <th>Encerradas sem chamada</th>
              <th>Taxa de conclusão</th>
            </tr>
          </thead>
          <tbody>
            ${carregandoRelatorios
      ? html`<${SkeletonTableRows} colunas=${5} linhas=${3} />`
      : relatorioConclusao.length
        ? relatorioConclusao.map(
          (linha) => html`
                    <tr key=${linha.id_operacao}>
                      <td>${linha.operacao_nome}</td>
                      <td>${linha.total_atribuicoes}</td>
                      <td>${linha.aplicadas}</td>
                      <td>${linha.encerradas_sem_chamada}</td>
                      <td>${linha.taxa_conclusao_pct}%</td>
                    </tr>
                  `,
        )
        : html`<${TabelaVazia} colunas=${5} texto="Sem dados ainda." icone="percent" />`}
          </tbody>
        </table>
      </div>
    </${SectionCard}>

    ${controlador?.possuiPermissao?.('onboarding.configurar_acesso')
      ? html`
          <${SectionCard} title="Configuração de acesso" className="rh-section-card--flat">
            <p class="rh-section-card-description mb-2">
              Quem pode criar/gerenciar treinamentos é definido pelas permissões de papel, na mesma tela usada para o
              resto do Conecta.
            </p>
            <button type="button" class="btn btn-outline-primary btn-sm" onClick=${() => controlador.irParaTelaProtegida('screen-settings-profiles')}>
              <span class="material-symbols-outlined">${IconeSvg('admin_panel_settings')}</span>
              Ir para Configurações → Segurança
            </button>
          </${SectionCard}>
        `
      : null}
  `;

  return html`
    <${PainelRh}
      screenId="screen-training"
      navAtiva=${telaAtual === 'screen-training-assignments' || telaAtual === 'screen-training-manage' ? telaAtual : 'screen-training-trilhas'}
      subtituloMarca="Treinamentos"
      placeholderBusca="Treinamentos"
      controlador=${controlador}
      acoesTopo=${html`
        ${podeCriar
      ? html`
              <button type="button" class="btn btn-primary rh-modern-primary-btn" onClick=${() => controlador.irParaTelaProtegida('screen-training-create')}>
                <span class="material-symbols-outlined">${IconeSvg('add')}</span>
                Criar Treinamento
              </button>
            `
      : null}
      `}
      acaoPrimaria=${abaAtiva === 'trilhas'
      ? { label: 'Novo treinamento', icon: 'add', onClick: abrirNovaTrilha, permissao: 'onboarding.editar' }
      : null}
    >
      <${PageIntro}
        kicker="Processos"
        title="Treinamentos"
      />

      <div class="c24-tabs" style=${{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
        <button type="button" class=${`c24-pill-tab ${abaAtiva === 'trilhas' ? 'is-active' : ''}`} onClick=${() => irParaAba('trilhas')}>
          <span class="material-symbols-outlined">${IconeSvg('school')}</span>
          Treinamentos
        </button>
        <button type="button" class=${`c24-pill-tab ${abaAtiva === 'atribuicoes' ? 'is-active' : ''}`} onClick=${() => irParaAba('atribuicoes')}>
          <span class="material-symbols-outlined">${IconeSvg('assignment_ind')}</span>
          Atribuições
        </button>
      </div>

      ${abaAtiva === 'trilhas'
      ? renderTrilhas()
      : abaAtiva === 'gestao'
        ? renderGestao()
        : html`${renderAtribuicoes()}${renderTreinamentosProcesso()}`}

      <${ModalPadrao}
        aberto=${modalTrilhaAberto}
        titulo=${formTrilha.id_trilha ? 'Editar treinamento' : 'Novo treinamento'}
        subtitulo="Monte os módulos (vídeo, texto, slide ou link) que serão aplicados ao iniciar o treinamento de um colaborador."
        onClose=${fecharModalTrilha}
        className="rh-modal-dialog--lg"
      >
        <div class="rh-details-body">
          ${erroTrilha ? html`<div class="alert alert-warning">${erroTrilha}</div>` : null}

          <div class="rh-filter-field">
            <label>Nome do treinamento</label>
            <input
              class="form-control"
              value=${formTrilha.nome}
              onInput=${(event) => setFormTrilha({ ...formTrilha, nome: event.target.value })}
              placeholder="Ex.: Onboarding CRF, Segurança da Informação"
            />
          </div>

          <div class="row g-2">
            <div class="col-md-4">
              <div class="rh-filter-field">
                <label>Categoria</label>
                <select
                  class="form-select"
                  value=${formTrilha.categoria}
                  onChange=${(event) => setFormTrilha({ ...formTrilha, categoria: event.target.value })}
                >
                  ${CATEGORIAS_TREINAMENTO.map((categoria) => html`<option key=${categoria} value=${categoria}>${categoria}</option>`)}
                </select>
              </div>
            </div>
            <div class="col-md-4">
              <div class="rh-filter-field">
                <label>Operação (opcional)</label>
                <select
                  class="form-select"
                  value=${formTrilha.id_operacao}
                  onChange=${(event) => setFormTrilha({ ...formTrilha, id_operacao: event.target.value })}
                >
                  <option value="">Todas as operações</option>
                  ${operacoes.map((operacao) => html`<option key=${operacao.id_item} value=${operacao.id_item}>${operacao.nome}</option>`)}
                </select>
              </div>
            </div>
            <div class="col-md-4">
              <div class="rh-filter-field">
                <label>Modalidade</label>
                <select
                  class="form-select"
                  value=${formTrilha.modalidade}
                  onChange=${(event) => setFormTrilha({ ...formTrilha, modalidade: event.target.value })}
                >
                  ${MODALIDADES_TREINAMENTO.map((opcao) => html`<option key=${opcao.value} value=${opcao.value}>${opcao.label}</option>`)}
                </select>
              </div>
            </div>
          </div>

          <div class="rh-filter-field">
            <label>Local padrão (opcional)</label>
            <input
              class="form-control"
              value=${formTrilha.local_padrao}
              onInput=${(event) => setFormTrilha({ ...formTrilha, local_padrao: event.target.value })}
              placeholder="Ex.: Sala de treinamento 2, ou link da sala virtual"
            />
          </div>

          <div class="rh-filter-field">
            <label>Descrição (opcional)</label>
            <textarea
              class="form-control"
              rows="2"
              value=${formTrilha.descricao}
              onInput=${(event) => setFormTrilha({ ...formTrilha, descricao: event.target.value })}
            ></textarea>
          </div>

          <label class="d-flex align-items-center gap-2">
            <input
              type="checkbox"
              checked=${formTrilha.ativo}
              onChange=${(event) => setFormTrilha({ ...formTrilha, ativo: !!event.target.checked })}
            />
            <span>Treinamento ativo</span>
          </label>

          <div class="rh-filter-field">
            <label>Módulos do treinamento</label>
            ${formTrilha.itens.map(
      (item, index) => html`
                <div key=${index} class="rh-section-card rh-section-card--flat" style=${{ padding: '12px', marginBottom: '8px' }}>
                  <div class="row g-2 align-items-start">
                    <div class="col-md-5">
                      <input
                        class="form-control"
                        placeholder="Título do módulo"
                        value=${item.titulo}
                        onInput=${(event) => atualizarItemTrilha(index, 'titulo', event.target.value)}
                      />
                    </div>
                    <div class="col-md-4">
                      <select
                        class="form-select"
                        value=${item.tipo_conteudo}
                        onChange=${(event) => atualizarItemTrilha(index, 'tipo_conteudo', event.target.value)}
                      >
                        ${TIPOS_CONTEUDO.map((opcao) => html`<option key=${opcao.value} value=${opcao.value}>${opcao.label}</option>`)}
                      </select>
                    </div>
                    <div class="col-md-3 d-flex gap-2">
                      <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => moverItemTrilha(index, -1)} title="Mover para cima">
                        <span class="material-symbols-outlined">${IconeSvg('arrow_upward')}</span>
                      </button>
                      <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => moverItemTrilha(index, 1)} title="Mover para baixo">
                        <span class="material-symbols-outlined">${IconeSvg('arrow_downward')}</span>
                      </button>
                    </div>
                  </div>
                  <div class="row g-2 mt-1">
                    <div class="col-md-6">
                      <input
                        class="form-control"
                        placeholder="Descrição (opcional)"
                        value=${item.descricao}
                        onInput=${(event) => atualizarItemTrilha(index, 'descricao', event.target.value)}
                      />
                    </div>
                    <div class="col-md-6">
                      <input
                        class="form-control"
                        placeholder="Link do conteúdo (vídeo, slide, intranet/SharePoint...)"
                        value=${item.conteudo_url}
                        onInput=${(event) => atualizarItemTrilha(index, 'conteudo_url', event.target.value)}
                        disabled=${!item.tipo_conteudo}
                      />
                    </div>
                  </div>
                  <div class="d-flex align-items-center justify-content-between mt-2">
                    <label class="d-flex align-items-center gap-2 mb-0">
                      <input
                        type="checkbox"
                        checked=${item.obrigatorio}
                        onChange=${(event) => atualizarItemTrilha(index, 'obrigatorio', !!event.target.checked)}
                      />
                      <span>Módulo obrigatório</span>
                    </label>
                    <button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => removerItemTrilha(index)}>
                      <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                      Remover
                    </button>
                  </div>
                </div>
              `,
    )}
            <button type="button" class="btn btn-outline-primary btn-sm" onClick=${adicionarItemTrilha}>
              <span class="material-symbols-outlined">${IconeSvg('add')}</span>
              Adicionar módulo
            </button>
          </div>

          <div class="rh-filter-field">
            <label>Conteúdo apresentado em "Começar Treinamento" (slides)</label>
            <p class="text-muted small mb-2">
              Cada slide vira uma tela do curso online que o ministrante apresenta ao iniciar o treinamento.
            </p>
            ${formTrilha.slides.map(
      (slide, index) => html`
                <div key=${index} class="rh-section-card rh-section-card--flat" style=${{ padding: '12px', marginBottom: '8px' }}>
                  <div class="row g-2">
                    <div class="col-md-11">
                      <input
                        class="form-control mb-2"
                        placeholder="Título do slide"
                        value=${slide.titulo}
                        onInput=${(event) => atualizarSlideTrilha(index, 'titulo', event.target.value)}
                      />
                      <textarea
                        class="form-control"
                        rows="2"
                        placeholder="Texto/script do slide"
                        value=${slide.texto}
                        onInput=${(event) => atualizarSlideTrilha(index, 'texto', event.target.value)}
                      ></textarea>
                    </div>
                    <div class="col-md-1">
                      <button type="button" class="btn btn-outline-danger btn-sm" aria-label="Remover slide" onClick=${() => removerSlideTrilha(index)}>
                        <span class="material-symbols-outlined">${IconeSvg('close')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              `,
    )}
            <button type="button" class="btn btn-outline-primary btn-sm" onClick=${adicionarSlideTrilha}>
              <span class="material-symbols-outlined">${IconeSvg('add')}</span>
              Adicionar slide
            </button>
          </div>
        </div>

        <footer class="rh-modal-footer">
          <div class="rh-modal-footer-actions">
            <button type="button" class="btn btn-outline-secondary" disabled=${salvandoTrilha} onClick=${fecharModalTrilha}>
              Cancelar
            </button>
            <button
              type="button"
              class="btn btn-primary"
              disabled=${salvandoTrilha || !formTrilha.nome.trim() || !itensTrilhaValidos}
              onClick=${salvarTrilha}
            >
              ${salvandoTrilha ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </footer>
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${modalAgendarAberto}
        titulo="Agendar treinamento"
        subtitulo="Dia, horário, local e quem vai aplicar o treinamento."
        onClose=${fecharModalAgendar}
      >
        <div class="rh-details-body">
          ${erroAgenda ? html`<div class="alert alert-warning">${erroAgenda}</div>` : null}

          <div class="rh-filter-field">
            <label>Data e horário previstos</label>
            <input
              type="datetime-local"
              class="form-control"
              value=${formAgendar.data_prevista}
              onInput=${(event) => setFormAgendar({ ...formAgendar, data_prevista: event.target.value })}
            />
          </div>

          <div class="rh-filter-field">
            <label>Local (sala)</label>
            <input
              class="form-control"
              value=${formAgendar.local}
              onInput=${(event) => setFormAgendar({ ...formAgendar, local: event.target.value })}
              placeholder="Ex.: Sala 2, ou link da videochamada"
            />
          </div>

          <div class="rh-filter-field">
            <label>Quem vai aplicar o treinamento</label>
            <input
              class="form-control"
              value=${formAgendar.ministrante}
              onInput=${(event) => setFormAgendar({ ...formAgendar, ministrante: event.target.value })}
              placeholder="Nome do ministrante"
            />
          </div>
        </div>

        <footer class="rh-modal-footer">
          <div class="rh-modal-footer-actions">
            <button type="button" class="btn btn-outline-secondary" disabled=${salvandoAgenda} onClick=${fecharModalAgendar}>
              Cancelar
            </button>
            <button type="button" class="btn btn-primary" disabled=${salvandoAgenda} onClick=${salvarAgendamento}>
              ${salvandoAgenda ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </footer>
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${modalEditarTreinamentoAberto}
        titulo="Editar treinamento"
        subtitulo="Conteúdo aplicado, status e acesso ao aplicativo/plataforma auxiliar."
        onClose=${fecharModalEditarTreinamento}
      >
        <div class="rh-details-body">
          ${erroAgenda ? html`<div class="alert alert-warning">${erroAgenda}</div>` : null}

          <div class="rh-filter-field">
            <label>Status</label>
            <select
              class="form-select"
              value=${formEditarTreinamento.status}
              onChange=${(event) => setFormEditarTreinamento({ ...formEditarTreinamento, status: event.target.value })}
            >
              ${STATUS_ATRIBUICAO_EDITAVEL.map((opcao) => html`<option key=${opcao.value} value=${opcao.value}>${opcao.label}</option>`)}
            </select>
          </div>

          <label class="d-flex align-items-center gap-2">
            <input
              type="checkbox"
              checked=${formEditarTreinamento.acesso_plataforma}
              onChange=${(event) => setFormEditarTreinamento({ ...formEditarTreinamento, acesso_plataforma: !!event.target.checked })}
            />
            <span>Colaborador terá acesso ao aplicativo/plataforma auxiliar</span>
          </label>

          ${formEditarTreinamento.acesso_plataforma
      ? html`
              <div class="rh-filter-field">
                <label>Forma de login</label>
                <select
                  class="form-select"
                  value=${formEditarTreinamento.metodo_login}
                  onChange=${(event) => setFormEditarTreinamento({ ...formEditarTreinamento, metodo_login: event.target.value })}
                >
                  ${METODOS_LOGIN_TREINAMENTO.map((opcao) => html`<option key=${opcao.value} value=${opcao.value}>${opcao.label}</option>`)}
                </select>
              </div>
            `
      : null}
        </div>

        <footer class="rh-modal-footer">
          <div class="rh-modal-footer-actions">
            <button type="button" class="btn btn-outline-secondary" disabled=${salvandoAgenda} onClick=${fecharModalEditarTreinamento}>
              Cancelar
            </button>
            <button type="button" class="btn btn-primary" disabled=${salvandoAgenda} onClick=${salvarEdicaoTreinamento}>
              ${salvandoAgenda ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </footer>
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${modalLiberarAberto}
        titulo="Liberar vagas de treinamento"
        subtitulo=${treinamentoProcessoSelecionado ? `${treinamentoProcessoSelecionado.trilha_nome} — ${treinamentoProcessoSelecionado.vaga}` : ''}
        onClose=${fecharModalLiberar}
      >
        <div class="rh-details-body">
          ${erroLiberacao ? html`<div class="alert alert-warning">${erroLiberacao}</div>` : null}
          <p class="text-muted small">
            Escolha quais candidatos aprovados já podem começar o treinamento agora. As vagas restantes continuam
            com a tag "Aguardando processo" até o encerramento da vaga.
          </p>
          ${candidatosParaLiberar.length
      ? candidatosParaLiberar.map(
        (candidato) => html`
                <label key=${candidato.id_registro} class="d-flex align-items-center gap-2 mb-2">
                  <input
                    type="checkbox"
                    checked=${candidatosSelecionados.includes(candidato.id_registro)}
                    onChange=${() => alternarCandidatoLiberacao(candidato.id_registro)}
                  />
                  <span>${candidato.nome_candidato}</span>
                </label>
              `,
      )
      : html`<p class="text-muted small mb-0">Nenhum candidato aprovado disponível para liberar ainda.</p>`}
        </div>
        <footer class="rh-modal-footer">
          <div class="rh-modal-footer-actions">
            <button type="button" class="btn btn-outline-secondary" disabled=${salvandoLiberacao} onClick=${fecharModalLiberar}>
              Cancelar
            </button>
            <button
              type="button"
              class="btn btn-primary"
              disabled=${salvandoLiberacao || !candidatosSelecionados.length}
              onClick=${confirmarLiberacaoVagas}
            >
              ${salvandoLiberacao ? 'Liberando...' : `Liberar ${candidatosSelecionados.length || ''} vaga(s)`}
            </button>
          </div>
        </footer>
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${!!treinamentoEmAndamento}
        titulo="Começar treinamento"
        subtitulo=${treinamentoEmAndamento?.atribuicao?.trilha_nome || ''}
        onClose=${() => setTreinamentoEmAndamento(null)}
        className="rh-modal-dialog--lg"
      >
        ${treinamentoEmAndamento
      ? html`
              <div class="rh-details-body">
                ${treinamentoEmAndamento.slides.length
        ? html`
                      <div class="rh-section-card rh-section-card--flat" style=${{ padding: '20px' }}>
                        <div class="d-flex justify-content-between align-items-center mb-2">
                          <strong>${treinamentoEmAndamento.slides[slideAtual]?.titulo || `Slide ${slideAtual + 1}`}</strong>
                          <span class="text-muted small">${slideAtual + 1} / ${treinamentoEmAndamento.slides.length}</span>
                        </div>
                        <p style=${{ whiteSpace: 'pre-wrap' }}>${treinamentoEmAndamento.slides[slideAtual]?.texto || ''}</p>
                        <div class="progress" style=${{ height: '8px' }}>
                          <div
                            class="progress-bar"
                            style=${{ width: `${Math.round(((slideAtual + 1) / treinamentoEmAndamento.slides.length) * 100)}%` }}
                          ></div>
                        </div>
                        <div class="d-flex justify-content-between mt-3">
                          <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${slideAtual === 0} onClick=${() => setSlideAtual((atual) => Math.max(0, atual - 1))}>
                            Anterior
                          </button>
                          <button
                            type="button"
                            class="btn btn-primary btn-sm"
                            disabled=${slideAtual >= treinamentoEmAndamento.slides.length - 1}
                            onClick=${() => setSlideAtual((atual) => Math.min(treinamentoEmAndamento.slides.length - 1, atual + 1))}
                          >
                            Próximo
                          </button>
                        </div>
                      </div>
                    `
        : html`<p class="text-muted">Este treinamento ainda não tem slides/script cadastrados — cadastre em "Editar treinamento".</p>`}
                <p class="text-muted small mt-3">
                  Ao final da apresentação, use "Presença" na lista de colaboradores para marcar quem assistiu.
                </p>
              </div>
            `
      : null}
        <footer class="rh-modal-footer">
          <button type="button" class="btn btn-outline-secondary" onClick=${() => setTreinamentoEmAndamento(null)}>
            Fechar
          </button>
        </footer>
      </${ModalPadrao}>
    </${PainelRh}>
  `;
}
