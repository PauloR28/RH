import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import {
  atualizarTrilhaOnboarding,
  baixarPdfSlideTreinamento,
  buscarCandidatosTreinamento,
  criarTrilhaOnboarding,
  excluirAtribuicaoTreinamento,
  excluirTrilhaOnboarding,
  iniciarOnboardingCandidato,
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
import { vincularTrilhaProcesso } from '../../services/api/onboarding.js';
import { CHAVE_TRILHA_EDICAO } from './wizard.js';
import { lerProcessos } from '../../services/api/processes.js';
import {
  MinistrantePicker,
  ModalPadrao,
  PageIntro,
  PainelRh,
  SectionCard,
} from '../../ui/componentes-compartilhados.js';
import { MenuAcoesProcesso } from '../../ui/components/menu-acoes.js';
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
  // Preservados sem UI própria neste modal — ver normalizarItensParaEnvio.
  texto_encerramento: '',
  saiba_mais_treinamento: null,
};
const FORM_PARTICIPANTE_INICIAL = {
  data_prevista: '',
  local: '',
  ministrante: '',
  ministrante_email: '',
  enviar_lembrete_calendario: false,
};

// Correções.txt (10/set/2026): este modal edita só nome/categoria/módulos
// básicos da trilha — não reabre o wizard rico (Saiba+, seções com imagem,
// tabela). Sem round-trip desses campos aqui, salvar pela tela de edição
// apagava conteúdo criado no wizard (o backend faz upsert por id_item e
// sobrescreve as colunas ricas com o que vier no payload — ver
// apps/backend/rh_api/repositories/onboarding.py, update_onboarding_trilha).
function normalizarItensParaEnvio(itens) {
  return itens.map((item, index) => ({
    id_item: item.id_item || null,
    titulo: item.titulo.trim(),
    descricao: (item.descricao || '').trim(),
    ordem: index,
    obrigatorio: !!item.obrigatorio,
    tipo_conteudo: item.tipo_conteudo || '',
    conteudo_url: (item.conteudo_url || '').trim(),
    subtitulo: item.subtitulo || '',
    texto_principal: item.texto_principal || '',
    dica_texto: item.dica_texto || '',
    tabela: item.tabela || null,
    saiba_mais: item.saiba_mais || [],
    secoes: item.secoes || [],
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
  const abaAtiva = telaAtual === 'screen-training-manage'
    ? 'gestao'
    : telaAtual === 'screen-training-assignments'
      ? 'atribuicoes'
      : telaAtual === 'screen-training-mine'
        ? 'meus-treinamentos'
        : 'trilhas';
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

  // Adicionar treinamento a um processo seletivo já aberto (Correções.txt,
  // pedido do RH 10/set/2026) — reaproveita a vinculação processo/treinamento
  // que já existe para processos criados com treinamentos pré-selecionados.
  const [modalVincularProcessoAberto, setModalVincularProcessoAberto] = useState(false);
  const [trilhaVincular, setTrilhaVincular] = useState(null);
  const [processosAbertos, setProcessosAbertos] = useState([]);
  const [carregandoProcessosAbertos, setCarregandoProcessosAbertos] = useState(false);
  const [processoSelecionadoVinculo, setProcessoSelecionadoVinculo] = useState('');
  const [salvandoVinculoProcesso, setSalvandoVinculoProcesso] = useState(false);
  const [erroVinculoProcesso, setErroVinculoProcesso] = useState('');

  // Adicionar participante avulso a um treinamento já cadastrado, sem
  // depender de processo seletivo (Correções.txt, pedido do RH 10/set/2026):
  // busca manual de candidato + ministrante/data/local, usando a mesma rota
  // que o wizard de criação já usa (POST /candidatos/iniciar).
  const [modalParticipanteAberto, setModalParticipanteAberto] = useState(false);
  const [trilhaParticipante, setTrilhaParticipante] = useState(null);
  const [buscaParticipante, setBuscaParticipante] = useState('');
  const [resultadosParticipante, setResultadosParticipante] = useState([]);
  const [buscandoParticipante, setBuscandoParticipante] = useState(false);
  const [participanteSelecionado, setParticipanteSelecionado] = useState(null);
  const [formParticipante, setFormParticipante] = useState(FORM_PARTICIPANTE_INICIAL);
  const [salvandoParticipante, setSalvandoParticipante] = useState(false);
  const [erroParticipante, setErroParticipante] = useState('');
  const [mensagemParticipante, setMensagemParticipante] = useState('');

  // Agendar treinamento (Correções.txt, 17/set/2026): item novo no catálogo —
  // igual a "Adicionar participante" (busca candidato + dia/local/ministrante),
  // mas com a opção de já vincular a trilha a um processo seletivo aberto no
  // mesmo modal, sem precisar abrir "Adicionar a processo seletivo" à parte.
  const [modalAgendarTreinamentoAberto, setModalAgendarTreinamentoAberto] = useState(false);
  const [trilhaAgendarTreinamento, setTrilhaAgendarTreinamento] = useState(null);
  const [buscaAgendarParticipante, setBuscaAgendarParticipante] = useState('');
  const [resultadosAgendarParticipante, setResultadosAgendarParticipante] = useState([]);
  const [buscandoAgendarParticipante, setBuscandoAgendarParticipante] = useState(false);
  const [participanteAgendarSelecionado, setParticipanteAgendarSelecionado] = useState(null);
  const [formAgendarTreinamento, setFormAgendarTreinamento] = useState(FORM_PARTICIPANTE_INICIAL);
  const [vincularProcessoAoAgendar, setVincularProcessoAoAgendar] = useState(false);
  const [processosAgendarAbertos, setProcessosAgendarAbertos] = useState([]);
  const [carregandoProcessosAgendar, setCarregandoProcessosAgendar] = useState(false);
  const [processoAgendarSelecionado, setProcessoAgendarSelecionado] = useState('');
  const [salvandoAgendarTreinamento, setSalvandoAgendarTreinamento] = useState(false);
  const [erroAgendarTreinamento, setErroAgendarTreinamento] = useState('');
  const [mensagemAgendarTreinamento, setMensagemAgendarTreinamento] = useState('');

  const [presencasPendentes, setPresencasPendentes] = useState({});
  const [salvandoPresenca, setSalvandoPresenca] = useState(false);

  const [treinamentoEmAndamento, setTreinamentoEmAndamento] = useState(null);
  const [slideAtual, setSlideAtual] = useState(0);
  // Correções.txt (rodada 16/set/2026): "Iniciar" passa a mostrar o slide
  // enviado na criação do treinamento (pptx_pdf_path), buscado autenticado e
  // virando blob local — ver nota em services/api/onboarding.js.
  const [pdfSlideUrl, setPdfSlideUrl] = useState('');
  const [carregandoPdfSlide, setCarregandoPdfSlide] = useState(false);
  const [erroPdfSlide, setErroPdfSlide] = useState('');

  // "Meus treinamentos" (visão do Supervisor/ministrante) e a marcação de
  // presença de uma ocorrência, com opção de adicionar alguém que não
  // estava na lista original de convocados.
  const [modalPresencaAberto, setModalPresencaAberto] = useState(false);
  const [grupoPresencaAtivo, setGrupoPresencaAtivo] = useState(null);

  const [modalProximosTreinosAberto, setModalProximosTreinosAberto] = useState(false);
  const [trilhaProximosTreinos, setTrilhaProximosTreinos] = useState(null);

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

  // Edição do conteúdo da trilha (módulos, textos, imagens, dica, saiba+)
  // agora abre o wizard de criação em modo edição, que já tem a UI completa
  // para isso — o modal pequeno abaixo (modalTrilhaAberto/formTrilha) ficou
  // sem chamador. Ver CHAVE_TRILHA_EDICAO em wizard.js.
  const abrirEdicaoTrilha = (trilha) => {
    sessionStorage.setItem(CHAVE_TRILHA_EDICAO, String(trilha.id_trilha));
    controlador.irParaTelaProtegida('screen-training-create');
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
      texto_encerramento: formTrilha.texto_encerramento || '',
      saiba_mais_treinamento: formTrilha.saiba_mais_treinamento || null,
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

  // -- Adicionar treinamento a um processo seletivo já aberto -------------

  const abrirVincularProcesso = async (trilha) => {
    setTrilhaVincular(trilha);
    setProcessoSelecionadoVinculo('');
    setErroVinculoProcesso('');
    setModalVincularProcessoAberto(true);
    setCarregandoProcessosAbertos(true);
    try {
      const dados = await lerProcessos({ forcar: true });
      const lista = Array.isArray(dados) ? dados : [];
      setProcessosAbertos(
        lista.filter((processo) => !normalizarBuscaTreino(processo.status).includes('encerrad') && !normalizarBuscaTreino(processo.status).includes('cancelad')),
      );
    } catch (error) {
      setErroVinculoProcesso(error?.message || 'Não foi possível carregar os processos seletivos abertos.');
    } finally {
      setCarregandoProcessosAbertos(false);
    }
  };

  const fecharModalVincularProcesso = () => {
    setModalVincularProcessoAberto(false);
    setTrilhaVincular(null);
    setProcessosAbertos([]);
    setProcessoSelecionadoVinculo('');
    setErroVinculoProcesso('');
  };

  const salvarVinculoProcesso = async () => {
    if (!trilhaVincular || !processoSelecionadoVinculo) {
      setErroVinculoProcesso('Selecione um processo seletivo.');
      return;
    }
    setSalvandoVinculoProcesso(true);
    setErroVinculoProcesso('');
    try {
      await vincularTrilhaProcesso(trilhaVincular.id_trilha, processoSelecionadoVinculo);
      fecharModalVincularProcesso();
      await carregarTreinamentosProcesso();
    } catch (error) {
      setErroVinculoProcesso(error?.message || 'Não foi possível vincular o treinamento a este processo.');
    } finally {
      setSalvandoVinculoProcesso(false);
    }
  };

  // -- Adicionar participante avulso (sem processo seletivo) --------------

  const abrirAdicionarParticipante = (trilha, prefill = null) => {
    setTrilhaParticipante(trilha);
    setBuscaParticipante('');
    setResultadosParticipante([]);
    setParticipanteSelecionado(null);
    setFormParticipante({
      ...FORM_PARTICIPANTE_INICIAL,
      local: prefill?.local ?? (trilha.local_padrao || ''),
      // Correções.txt (rodada 16/set/2026): "Presença" de uma ocorrência já
      // agendada precisa adicionar o colaborador NA MESMA ocorrência (data/
      // ministrante), não deixar em branco para o RH preencher de novo.
      data_prevista: prefill?.data_prevista ?? '',
      ministrante: prefill?.ministrante ?? trilha.ministrante_padrao ?? '',
      ministrante_email: prefill?.ministrante_email ?? trilha.ministrante_padrao_email ?? '',
    });
    setErroParticipante('');
    setMensagemParticipante('');
    setModalParticipanteAberto(true);
  };

  const fecharModalParticipante = () => {
    setModalParticipanteAberto(false);
    setTrilhaParticipante(null);
    setBuscaParticipante('');
    setResultadosParticipante([]);
    setParticipanteSelecionado(null);
    setFormParticipante(FORM_PARTICIPANTE_INICIAL);
    setErroParticipante('');
  };

  useEffect(() => {
    if (!modalParticipanteAberto || participanteSelecionado) return undefined;
    const termo = buscaParticipante.trim();
    setBuscandoParticipante(true);
    const timer = setTimeout(async () => {
      try {
        const resultados = await buscarCandidatosTreinamento(termo);
        setResultadosParticipante(Array.isArray(resultados) ? resultados : []);
      } catch (error) {
        setResultadosParticipante([]);
      } finally {
        setBuscandoParticipante(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [buscaParticipante, modalParticipanteAberto, participanteSelecionado]);

  const selecionarParticipante = (candidato) => {
    setParticipanteSelecionado(candidato);
    setResultadosParticipante([]);
  };

  const trocarParticipanteSelecionado = () => {
    setParticipanteSelecionado(null);
    setBuscaParticipante('');
  };

  const confirmarAdicaoParticipante = async () => {
    if (!participanteSelecionado || !trilhaParticipante) {
      setErroParticipante('Busque e selecione um candidato antes de salvar.');
      return;
    }
    setSalvandoParticipante(true);
    setErroParticipante('');
    try {
      await iniciarOnboardingCandidato({
        id_registro: participanteSelecionado.id_registro,
        trilha_id: trilhaParticipante.id_trilha,
        data_prevista: formParticipante.data_prevista ? new Date(formParticipante.data_prevista).toISOString() : null,
        local: formParticipante.local.trim(),
        ministrante: formParticipante.ministrante.trim(),
        ministrante_email: formParticipante.ministrante_email.trim(),
        enviar_lembrete_calendario: !!formParticipante.enviar_lembrete_calendario,
      });
      setMensagemParticipante(`${participanteSelecionado.nome_candidato} foi adicionado a "${trilhaParticipante.nome}" e já pode acessar o treinamento.`);
      await Promise.all([carregarAtribuicoes(), carregarTrilhas()]);
      setParticipanteSelecionado(null);
      setBuscaParticipante('');
      setFormParticipante({ ...FORM_PARTICIPANTE_INICIAL, local: trilhaParticipante.local_padrao || '' });
    } catch (error) {
      setErroParticipante(error?.message || 'Não foi possível adicionar este candidato ao treinamento.');
    } finally {
      setSalvandoParticipante(false);
    }
  };

  // -- Agendar treinamento (catálogo) --------------------------------------

  const abrirAgendarTreinamento = (trilha) => {
    setTrilhaAgendarTreinamento(trilha);
    setBuscaAgendarParticipante('');
    setResultadosAgendarParticipante([]);
    setParticipanteAgendarSelecionado(null);
    setFormAgendarTreinamento({
      ...FORM_PARTICIPANTE_INICIAL,
      local: trilha.local_padrao || '',
      ministrante: trilha.ministrante_padrao || '',
      ministrante_email: trilha.ministrante_padrao_email || '',
    });
    setVincularProcessoAoAgendar(false);
    setProcessosAgendarAbertos([]);
    setProcessoAgendarSelecionado('');
    setErroAgendarTreinamento('');
    setMensagemAgendarTreinamento('');
    setModalAgendarTreinamentoAberto(true);
  };

  const fecharModalAgendarTreinamento = () => {
    setModalAgendarTreinamentoAberto(false);
    setTrilhaAgendarTreinamento(null);
    setResultadosAgendarParticipante([]);
    setParticipanteAgendarSelecionado(null);
    setFormAgendarTreinamento(FORM_PARTICIPANTE_INICIAL);
    setVincularProcessoAoAgendar(false);
    setErroAgendarTreinamento('');
  };

  useEffect(() => {
    if (!modalAgendarTreinamentoAberto || participanteAgendarSelecionado) return undefined;
    const termo = buscaAgendarParticipante.trim();
    setBuscandoAgendarParticipante(true);
    const timer = setTimeout(async () => {
      try {
        const resultados = await buscarCandidatosTreinamento(termo);
        setResultadosAgendarParticipante(Array.isArray(resultados) ? resultados : []);
      } catch (error) {
        setResultadosAgendarParticipante([]);
      } finally {
        setBuscandoAgendarParticipante(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [buscaAgendarParticipante, modalAgendarTreinamentoAberto, participanteAgendarSelecionado]);

  useEffect(() => {
    if (!vincularProcessoAoAgendar || processosAgendarAbertos.length || carregandoProcessosAgendar) return undefined;
    setCarregandoProcessosAgendar(true);
    (async () => {
      try {
        const dados = await lerProcessos({ forcar: true });
        const lista = Array.isArray(dados) ? dados : [];
        setProcessosAgendarAbertos(
          lista.filter((processo) => !normalizarBuscaTreino(processo.status).includes('encerrad') && !normalizarBuscaTreino(processo.status).includes('cancelad')),
        );
      } catch (error) {
        setErroAgendarTreinamento(error?.message || 'Não foi possível carregar os processos seletivos abertos.');
      } finally {
        setCarregandoProcessosAgendar(false);
      }
    })();
    return undefined;
  }, [vincularProcessoAoAgendar]);

  const confirmarAgendarTreinamento = async () => {
    if (!participanteAgendarSelecionado || !trilhaAgendarTreinamento) {
      setErroAgendarTreinamento('Busque e selecione um candidato antes de salvar.');
      return;
    }
    if (vincularProcessoAoAgendar && !processoAgendarSelecionado) {
      setErroAgendarTreinamento('Selecione um processo seletivo ou desmarque a opção de vincular.');
      return;
    }
    setSalvandoAgendarTreinamento(true);
    setErroAgendarTreinamento('');
    try {
      await iniciarOnboardingCandidato({
        id_registro: participanteAgendarSelecionado.id_registro,
        trilha_id: trilhaAgendarTreinamento.id_trilha,
        data_prevista: formAgendarTreinamento.data_prevista ? new Date(formAgendarTreinamento.data_prevista).toISOString() : null,
        local: formAgendarTreinamento.local.trim(),
        ministrante: formAgendarTreinamento.ministrante.trim(),
        ministrante_email: formAgendarTreinamento.ministrante_email.trim(),
        enviar_lembrete_calendario: !!formAgendarTreinamento.enviar_lembrete_calendario,
      });
      if (vincularProcessoAoAgendar && processoAgendarSelecionado) {
        await vincularTrilhaProcesso(trilhaAgendarTreinamento.id_trilha, processoAgendarSelecionado);
      }
      setMensagemAgendarTreinamento(`${participanteAgendarSelecionado.nome_candidato} foi agendado(a) em "${trilhaAgendarTreinamento.nome}".`);
      await Promise.all([carregarAtribuicoes(), carregarTrilhas(), carregarTreinamentosProcesso()]);
      setParticipanteAgendarSelecionado(null);
      setBuscaAgendarParticipante('');
      setFormAgendarTreinamento({ ...FORM_PARTICIPANTE_INICIAL, local: trilhaAgendarTreinamento.local_padrao || '' });
      setVincularProcessoAoAgendar(false);
      setProcessoAgendarSelecionado('');
    } catch (error) {
      setErroAgendarTreinamento(error?.message || 'Não foi possível agendar este treinamento.');
    } finally {
      setSalvandoAgendarTreinamento(false);
    }
  };

  // -- Atribuições: Encerrar ------------------------------------------------
  // Correções.txt (17/set/2026): "Agendar"/"Editar" removidos desta lista —
  // uma vez iniciado/realizado o treinamento do colaborador, não faz mais
  // sentido reagendar ou alterar. O agendamento agora nasce no catálogo,
  // ver "Agendar treinamento" em MenuAcoesProcesso da aba Treinamentos.

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

  const dentroJanelaInicio = (dataPrevista) => {
    if (!dataPrevista) return false;
    const agora = Date.now();
    const previsto = new Date(dataPrevista).getTime();
    const duasHoras = 2 * 60 * 60 * 1000;
    return agora >= previsto - duasHoras && agora <= previsto + duasHoras;
  };

  const podeComecarTreinamento = (atribuicao) => {
    if (!atribuicao.data_prevista) return false;
    const nomeUsuario = normalizarBuscaTreino(controlador?.estado?.nomeUsuarioAutenticado || '');
    const ministrante = normalizarBuscaTreino(atribuicao.ministrante || '');
    if (!ministrante || !nomeUsuario || !ministrante.includes(nomeUsuario)) return false;
    return dentroJanelaInicio(atribuicao.data_prevista);
  };

  const carregarSlideTextoTrilha = (trilha) => {
    try {
      const conteudo = JSON.parse(trilha?.conteudo_json || '{}');
      return Array.isArray(conteudo.slides) ? conteudo.slides : [];
    } catch (error) {
      return [];
    }
  };

  const comecarTreinamento = async (atribuicao) => {
    const trilha = trilhas.find((item) => String(item.id_trilha) === String(atribuicao.trilha_id));
    setSlideAtual(0);
    setPdfSlideUrl('');
    setErroPdfSlide('');
    const temSlideEnviado = !!trilha?.pptx_pdf_path;
    setTreinamentoEmAndamento({
      atribuicao,
      slides: temSlideEnviado ? [] : carregarSlideTextoTrilha(trilha),
    });
    if (!temSlideEnviado) return;
    setCarregandoPdfSlide(true);
    try {
      const arquivo = await baixarPdfSlideTreinamento(trilha.id_trilha);
      setPdfSlideUrl(URL.createObjectURL(arquivo.blob));
    } catch (error) {
      setErroPdfSlide('Não foi possível carregar o slide enviado — mostrando o roteiro em texto, se houver.');
      setTreinamentoEmAndamento({ atribuicao, slides: carregarSlideTextoTrilha(trilha) });
    } finally {
      setCarregandoPdfSlide(false);
    }
  };

  const fecharTreinamentoEmAndamento = () => {
    if (pdfSlideUrl) URL.revokeObjectURL(pdfSlideUrl);
    setTreinamentoEmAndamento(null);
    setPdfSlideUrl('');
    setErroPdfSlide('');
  };

  // -- "Meus treinamentos" (agrupa atribuições da mesma ocorrência: mesma
  // trilha, data, local e ministrante) e presença --------------------------

  const chaveOcorrencia = (item) =>
    `${item.trilha_id}|${item.data_prevista || ''}|${item.local || ''}|${item.ministrante || ''}`;

  const nomeUsuarioAtual = normalizarBuscaTreino(controlador?.estado?.nomeUsuarioAutenticado || '');

  const meusTreinamentos = useMemo(() => {
    const grupos = new Map();
    atribuicoes.forEach((item) => {
      const ministrante = normalizarBuscaTreino(item.ministrante || '');
      if (!ministrante || !nomeUsuarioAtual || !ministrante.includes(nomeUsuarioAtual)) return;
      if (!item.data_prevista) return;
      if (!['pendente_chamada', 'em_andamento'].includes(item.status)) return;
      const chave = chaveOcorrencia(item);
      if (!grupos.has(chave)) {
        grupos.set(chave, {
          chave,
          trilha_id: item.trilha_id,
          trilha_nome: item.trilha_nome,
          data_prevista: item.data_prevista,
          local: item.local,
          ministrante: item.ministrante,
          participantes: [],
        });
      }
      grupos.get(chave).participantes.push(item);
    });
    return Array.from(grupos.values()).sort(
      (a, b) => new Date(a.data_prevista) - new Date(b.data_prevista),
    );
  }, [atribuicoes, nomeUsuarioAtual]);

  const meusTreinamentosHoje = useMemo(() => {
    const hoje = new Date();
    return meusTreinamentos.filter((grupo) => {
      const data = new Date(grupo.data_prevista);
      return (
        data.getFullYear() === hoje.getFullYear() &&
        data.getMonth() === hoje.getMonth() &&
        data.getDate() === hoje.getDate()
      );
    });
  }, [meusTreinamentos]);

  const abrirPresencaOcorrencia = (grupo) => {
    setGrupoPresencaAtivo(grupo);
    setModalPresencaAberto(true);
  };

  const fecharModalPresenca = () => {
    setModalPresencaAberto(false);
    setGrupoPresencaAtivo(null);
  };

  // Mantém a lista de participantes do modal de presença em dia depois de
  // adicionar alguém que não estava convocado originalmente.
  useEffect(() => {
    if (!modalPresencaAberto || !grupoPresencaAtivo) return;
    const participantesAtuais = atribuicoes.filter(
      (item) => chaveOcorrencia(item) === grupoPresencaAtivo.chave,
    );
    if (participantesAtuais.length !== grupoPresencaAtivo.participantes.length) {
      setGrupoPresencaAtivo((atual) => (atual ? { ...atual, participantes: participantesAtuais } : atual));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atribuicoes, modalPresencaAberto]);

  const irParaPresencaDoTreinamentoEmAndamento = () => {
    const atribuicao = treinamentoEmAndamento?.atribuicao;
    if (!atribuicao) return;
    const grupo = {
      chave: chaveOcorrencia(atribuicao),
      trilha_id: atribuicao.trilha_id,
      trilha_nome: atribuicao.trilha_nome,
      data_prevista: atribuicao.data_prevista,
      local: atribuicao.local,
      ministrante: atribuicao.ministrante,
      participantes: atribuicoes.filter((item) => chaveOcorrencia(item) === chaveOcorrencia(atribuicao)),
    };
    fecharTreinamentoEmAndamento();
    abrirPresencaOcorrencia(grupo);
  };

  // -- "Próximos treinos" (Ações da trilha, qualquer ministrante) ---------

  const abrirProximosTreinos = (trilha) => {
    const grupos = new Map();
    atribuicoes
      .filter(
        (item) =>
          String(item.trilha_id) === String(trilha.id_trilha) &&
          item.data_prevista &&
          ['pendente_chamada', 'em_andamento'].includes(item.status),
      )
      .forEach((item) => {
        const chave = `${item.data_prevista}|${item.local || ''}|${item.ministrante || ''}`;
        if (!grupos.has(chave)) {
          grupos.set(chave, {
            data_prevista: item.data_prevista,
            local: item.local,
            ministrante: item.ministrante,
            alunos: 0,
          });
        }
        grupos.get(chave).alunos += 1;
      });
    setTrilhaProximosTreinos({
      trilha,
      ocorrencias: Array.from(grupos.values()).sort((a, b) => new Date(a.data_prevista) - new Date(b.data_prevista)),
    });
    setModalProximosTreinosAberto(true);
  };

  const fecharModalProximosTreinos = () => {
    setModalProximosTreinosAberto(false);
    setTrilhaProximosTreinos(null);
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
                        <span class=${`rh-status-pill ${item.ativo ? 'is-finished' : ''}`}>
                          ${item.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td>
                        <${MenuAcoesProcesso}
                          label="Ações"
                          acoes=${[
              {
                label: 'Próximos treinos',
                icon: 'event',
                title: 'Ver dia, horário, ministrante e número de alunos das próximas ocorrências agendadas',
                onClick: () => abrirProximosTreinos(item),
              },
              {
                label: 'Agendar treinamento',
                icon: 'event_available',
                disabled: !podeEditar,
                title: 'Agendar dia, local e ministrante para um novo aluno, com opção de já vincular a um processo seletivo',
                onClick: () => abrirAgendarTreinamento(item),
              },
              {
                label: 'Adicionar participante',
                icon: 'person_add',
                disabled: !podeEditar,
                title: 'Adicionar um candidato a este treinamento sem precisar de um processo seletivo',
                onClick: () => abrirAdicionarParticipante(item),
              },
              {
                label: 'Adicionar a processo seletivo',
                icon: 'link',
                disabled: !podeEditar,
                title: 'Vincular este treinamento a um processo seletivo já aberto',
                onClick: () => abrirVincularProcesso(item),
              },
              {
                label: 'Editar',
                icon: 'edit',
                disabled: !podeEditar,
                onClick: () => abrirEdicaoTrilha(item),
              },
              { separator: true },
              {
                label: excluindoTrilhaId === item.id_trilha ? 'Excluindo...' : 'Excluir',
                icon: 'delete',
                danger: true,
                disabled: !podeEditar || excluindoTrilhaId === item.id_trilha,
                onClick: () => excluirTrilhaCadastrada(item),
              },
            ]}
                        />
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

  // Correções.txt (rodada 16/set/2026): tela inicial do Supervisor —
  // "Meus treinamentos" (o que ele dá/vai dar) + um resumo do dia, com
  // Ações "Iniciar" e "Presença" por ocorrência agendada.
  const renderMeusTreinamentos = () => html`
    ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}
    <${SectionCard}
      title="Hoje"
      className="rh-section-card--flat"
      description="Treinamentos que você vai dar hoje — só o horário e o nome, sem o restante da agenda do Conecta."
    >
      ${carregando
      ? html`<${SkeletonTableRows} colunas=${3} linhas=${2} />`
      : meusTreinamentosHoje.length
        ? html`
              <ul class="rh-simple-list">
                ${meusTreinamentosHoje.map(
              (grupo) => html`
                    <li key=${grupo.chave} class="d-flex align-items-center justify-content-between gap-3 py-2">
                      <div>
                        <strong>${new Date(grupo.data_prevista).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong>
                        <span class="ms-2">${grupo.trilha_nome}</span>
                        <div class="text-muted small">${grupo.local || 'Local não informado'} · ${grupo.participantes.length} aluno(s)</div>
                      </div>
                      <div class="d-flex gap-2">
                        ${dentroJanelaInicio(grupo.data_prevista)
                  ? html`
                            <button type="button" class="btn btn-primary btn-sm" onClick=${() => comecarTreinamento(grupo.participantes[0])}>
                              <span class="material-symbols-outlined">${IconeSvg('play_circle')}</span>
                              Iniciar
                            </button>
                          `
                  : null}
                        <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => abrirPresencaOcorrencia(grupo)}>
                          <span class="material-symbols-outlined">${IconeSvg('how_to_reg')}</span>
                          Presença
                        </button>
                      </div>
                    </li>
                  `,
            )}
              </ul>
            `
        : html`<p class="text-muted small mb-0">Sem compromissos de treinamento hoje.</p>`}
    </${SectionCard}>

    <${SectionCard}
      title="Meus treinamentos"
      className="rh-section-card--flat mt-4"
      description="Treinamentos cadastrados e agendados para você dar, com data, hora e local."
    >
      <div class="table-responsive">
        <table class="table align-middle rh-modern-history-table">
          <thead>
            <tr>
              <th>Treinamento</th>
              <th>Data/hora</th>
              <th>Local</th>
              <th>Alunos</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            ${carregando
      ? html`<${SkeletonTableRows} colunas=${5} linhas=${3} />`
      : meusTreinamentos.length
        ? meusTreinamentos.map(
          (grupo) => html`
                    <tr key=${grupo.chave}>
                      <td><strong>${grupo.trilha_nome}</strong></td>
                      <td>${formatarDataHora(grupo.data_prevista)}</td>
                      <td>${grupo.local || '-'}</td>
                      <td>${grupo.participantes.length}</td>
                      <td>
                        <${MenuAcoesProcesso}
                          label="Ações"
                          acoes=${[
                {
                  label: 'Iniciar',
                  icon: 'play_circle',
                  disabled: !dentroJanelaInicio(grupo.data_prevista),
                  title: dentroJanelaInicio(grupo.data_prevista)
                    ? 'Abrir o treinamento e apresentar o slide'
                    : 'Disponível a partir de 2h antes do horário agendado',
                  onClick: () => comecarTreinamento(grupo.participantes[0]),
                },
                {
                  label: 'Presença',
                  icon: 'how_to_reg',
                  title: 'Marcar presença ou adicionar alguém que não estava na lista',
                  onClick: () => abrirPresencaOcorrencia(grupo),
                },
              ]}
                        />
                      </td>
                    </tr>
                  `,
        )
        : html`<${TabelaVazia} colunas=${5} texto="Nenhum treinamento agendado para você no momento." icone="school" />`}
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
        : html`<${TabelaVazia} colunas=${5} texto="Sem dados ainda." icone="bar_chart" />`}
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
      navAtiva=${['screen-training-assignments', 'screen-training-manage', 'screen-training-mine'].includes(telaAtual) ? telaAtual : 'screen-training-trilhas'}
      subtituloMarca="Treinamentos"
      placeholderBusca="Treinamentos"
      controlador=${controlador}
      acoesTopo=${html`
        ${podeCriar
        ? html`
              <button
                type="button"
                class="btn btn-primary rh-modern-primary-btn"
                onClick=${() => {
                  sessionStorage.removeItem(CHAVE_TRILHA_EDICAO);
                  controlador.irParaTelaProtegida('screen-training-create');
                }}
              >
                <span class="material-symbols-outlined">${IconeSvg('add')}</span>
                Criar Treinamento
              </button>
            `
        : null}
      `}
    >
      <${PageIntro}
        kicker="Processos"
        title="Treinamentos"
      />

      

      ${abaAtiva === 'trilhas'
      ? renderTrilhas()
      : abaAtiva === 'gestao'
        ? renderGestao()
        : abaAtiva === 'meus-treinamentos'
          ? renderMeusTreinamentos()
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
        aberto=${modalVincularProcessoAberto}
        titulo="Adicionar a processo seletivo"
        subtitulo=${trilhaVincular ? `Vincular "${trilhaVincular.nome}" a um processo seletivo já aberto.` : ''}
        onClose=${fecharModalVincularProcesso}
      >
        <div class="rh-details-body">
          ${erroVinculoProcesso ? html`<div class="alert alert-warning">${erroVinculoProcesso}</div>` : null}

          <div class="rh-filter-field">
            <label>Processo seletivo</label>
            ${carregandoProcessosAbertos
      ? html`<p class="text-muted small mb-0">Carregando processos abertos...</p>`
      : html`
                  <select
                    class="form-select"
                    value=${processoSelecionadoVinculo}
                    onChange=${(event) => setProcessoSelecionadoVinculo(event.target.value)}
                  >
                    <option value="">Selecione um processo...</option>
                    ${processosAbertos.map(
        (processo) => html`
                        <option key=${processo.id_processo} value=${processo.id_processo}>
                          ${processo.vaga} — ${processo.id_processo} (${processo.status})
                        </option>
                      `,
      )}
                  </select>
                `}
            ${!carregandoProcessosAbertos && !processosAbertos.length
      ? html`<small class="text-muted">Nenhum processo seletivo aberto no momento.</small>`
      : null}
          </div>
        </div>

        <footer class="rh-modal-footer">
          <div class="rh-modal-footer-actions">
            <button type="button" class="btn btn-outline-secondary" disabled=${salvandoVinculoProcesso} onClick=${fecharModalVincularProcesso}>
              Cancelar
            </button>
            <button
              type="button"
              class="btn btn-primary"
              disabled=${salvandoVinculoProcesso || !processoSelecionadoVinculo}
              onClick=${salvarVinculoProcesso}
            >
              ${salvandoVinculoProcesso ? 'Vinculando...' : 'Vincular treinamento'}
            </button>
          </div>
        </footer>
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${modalAgendarTreinamentoAberto}
        titulo="Agendar treinamento"
        subtitulo=${trilhaAgendarTreinamento ? `Dia, local e ministrante para "${trilhaAgendarTreinamento.nome}".` : ''}
        onClose=${fecharModalAgendarTreinamento}
      >
        <div class="rh-details-body training-modal-form">
          ${erroAgendarTreinamento ? html`<div class="alert alert-warning">${erroAgendarTreinamento}</div>` : null}
          ${mensagemAgendarTreinamento ? html`<div class="alert alert-success">${mensagemAgendarTreinamento}</div>` : null}

          <div class="rh-filter-field">
            <label>Quem vai receber o treinamento</label>
            ${participanteAgendarSelecionado
      ? html`
                  <div class="training-participant-picked">
                    <span class="material-symbols-outlined">${IconeSvg('person')}</span>
                    <div>
                      <strong>${participanteAgendarSelecionado.nome_candidato}</strong>
                      ${participanteAgendarSelecionado.vaga ? html`<small>${participanteAgendarSelecionado.vaga}</small>` : null}
                    </div>
                    <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setParticipanteAgendarSelecionado(null)}>
                      Trocar
                    </button>
                  </div>
                `
      : html`
                  <input
                    class="form-control"
                    placeholder="Buscar candidato por nome..."
                    value=${buscaAgendarParticipante}
                    onInput=${(event) => setBuscaAgendarParticipante(event.target.value)}
                  />
                  <div class="training-participant-results">
                    ${buscandoAgendarParticipante
          ? html`<p class="text-muted small mb-0">Buscando...</p>`
          : resultadosAgendarParticipante.length
            ? resultadosAgendarParticipante.map(
              (candidato) => html`
                              <button
                                type="button"
                                key=${candidato.id_registro}
                                class="training-participant-result"
                                onClick=${() => { setParticipanteAgendarSelecionado(candidato); setResultadosAgendarParticipante([]); }}
                              >
                                <strong>${candidato.nome_candidato}</strong>
                                <small>${candidato.vaga || 'Sem vaga vinculada'} ${candidato.status_candidato ? `· ${candidato.status_candidato}` : ''}</small>
                              </button>
                            `,
            )
            : html`<p class="text-muted small mb-0">Nenhum candidato encontrado.</p>`}
                  </div>
                `}
          </div>

          <div class="rh-filter-field">
            <label>Dia e horário</label>
            <input
              type="datetime-local"
              class="form-control"
              value=${formAgendarTreinamento.data_prevista}
              onInput=${(event) => setFormAgendarTreinamento({ ...formAgendarTreinamento, data_prevista: event.target.value })}
            />
          </div>

          <div class="rh-filter-field">
            <label>Local</label>
            <input
              class="form-control"
              value=${formAgendarTreinamento.local}
              onInput=${(event) => setFormAgendarTreinamento({ ...formAgendarTreinamento, local: event.target.value })}
              placeholder="Ex.: Sala 2, ou link da videochamada"
            />
          </div>

          <div class="rh-filter-field">
            <label>Quem vai aplicar o treinamento</label>
            <${MinistrantePicker}
              nome=${formAgendarTreinamento.ministrante}
              placeholder="Nome do ministrante"
              onChange=${(nomeSelecionado, emailSelecionado) =>
                setFormAgendarTreinamento({
                  ...formAgendarTreinamento,
                  ministrante: nomeSelecionado,
                  ministrante_email: emailSelecionado,
                  enviar_lembrete_calendario: emailSelecionado ? formAgendarTreinamento.enviar_lembrete_calendario : false,
                })}
            />
          </div>

          <label class="d-flex align-items-center gap-2">
            <input
              type="checkbox"
              disabled=${!formAgendarTreinamento.ministrante_email}
              checked=${formAgendarTreinamento.enviar_lembrete_calendario}
              onChange=${(event) => setFormAgendarTreinamento({ ...formAgendarTreinamento, enviar_lembrete_calendario: !!event.target.checked })}
            />
            <span>
              Adicionar lembrete no calendário do ministrante
              ${!formAgendarTreinamento.ministrante_email ? html`<span class="text-muted"> (escolha um usuário do sistema acima)</span>` : null}
            </span>
          </label>

          <label class="d-flex align-items-center gap-2">
            <input
              type="checkbox"
              checked=${vincularProcessoAoAgendar}
              onChange=${(event) => setVincularProcessoAoAgendar(!!event.target.checked)}
            />
            <span>Adicionar o processo seletivo</span>
          </label>

          ${vincularProcessoAoAgendar
      ? html`
              <div class="rh-filter-field">
                <label>Processo seletivo</label>
                <select
                  class="form-select"
                  value=${processoAgendarSelecionado}
                  onChange=${(event) => setProcessoAgendarSelecionado(event.target.value)}
                  disabled=${carregandoProcessosAgendar}
                >
                  <option value="">${carregandoProcessosAgendar ? 'Carregando...' : 'Selecione um processo'}</option>
                  ${processosAgendarAbertos.map(
                    (processo) => html`<option key=${processo.id_processo} value=${processo.id_processo}>${processo.vaga || processo.titulo || processo.id_processo}</option>`,
                  )}
                </select>
              </div>
            `
      : null}
        </div>

        <footer class="rh-modal-footer">
          <div class="rh-modal-footer-actions">
            <button type="button" class="btn btn-outline-secondary" disabled=${salvandoAgendarTreinamento} onClick=${fecharModalAgendarTreinamento}>
              Cancelar
            </button>
            <button type="button" class="btn btn-primary" disabled=${salvandoAgendarTreinamento} onClick=${confirmarAgendarTreinamento}>
              ${salvandoAgendarTreinamento ? 'Salvando...' : 'Agendar'}
            </button>
          </div>
        </footer>
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${modalParticipanteAberto}
        titulo="Adicionar participante"
        subtitulo=${trilhaParticipante ? `Liberar "${trilhaParticipante.nome}" para um candidato — não precisa de processo seletivo.` : ''}
        onClose=${fecharModalParticipante}
      >
        <div class="rh-details-body training-modal-form">
          ${erroParticipante ? html`<div class="alert alert-warning">${erroParticipante}</div>` : null}
          ${mensagemParticipante ? html`<div class="alert alert-success">${mensagemParticipante}</div>` : null}

          <div class="rh-filter-field">
            <label>Candidato</label>
            ${participanteSelecionado
      ? html`
                  <div class="training-participant-picked">
                    <span class="material-symbols-outlined">${IconeSvg('person')}</span>
                    <div>
                      <strong>${participanteSelecionado.nome_candidato}</strong>
                      ${participanteSelecionado.vaga ? html`<small>${participanteSelecionado.vaga}</small>` : null}
                    </div>
                    <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${trocarParticipanteSelecionado}>
                      Trocar
                    </button>
                  </div>
                `
      : html`
                  <input
                    class="form-control"
                    placeholder="Buscar candidato por nome..."
                    value=${buscaParticipante}
                    onInput=${(event) => setBuscaParticipante(event.target.value)}
                  />
                  <div class="training-participant-results">
                    ${buscandoParticipante
          ? html`<p class="text-muted small mb-0">Buscando...</p>`
          : resultadosParticipante.length
            ? resultadosParticipante.map(
              (candidato) => html`
                              <button
                                type="button"
                                key=${candidato.id_registro}
                                class="training-participant-result"
                                onClick=${() => selecionarParticipante(candidato)}
                              >
                                <strong>${candidato.nome_candidato}</strong>
                                <small>${candidato.vaga || 'Sem vaga vinculada'} ${candidato.status_candidato ? `· ${candidato.status_candidato}` : ''}</small>
                              </button>
                            `,
            )
            : html`<p class="text-muted small mb-0">Nenhum candidato encontrado.</p>`}
                  </div>
                `}
          </div>

          <div class="rh-filter-field">
            <label>Data e horário previstos (opcional)</label>
            <input
              type="datetime-local"
              class="form-control"
              value=${formParticipante.data_prevista}
              onInput=${(event) => setFormParticipante({ ...formParticipante, data_prevista: event.target.value })}
            />
          </div>

          <div class="rh-filter-field">
            <label>Local</label>
            <input
              class="form-control"
              value=${formParticipante.local}
              onInput=${(event) => setFormParticipante({ ...formParticipante, local: event.target.value })}
              placeholder="Ex.: Sala 2, ou link da videochamada"
            />
          </div>

          <div class="rh-filter-field">
            <label>Quem vai aplicar o treinamento</label>
            <${MinistrantePicker}
              nome=${formParticipante.ministrante}
              placeholder="Nome do ministrante"
              onChange=${(nomeSelecionado, emailSelecionado) =>
                setFormParticipante({
                  ...formParticipante,
                  ministrante: nomeSelecionado,
                  ministrante_email: emailSelecionado,
                  enviar_lembrete_calendario: emailSelecionado ? formParticipante.enviar_lembrete_calendario : false,
                })}
            />
          </div>

          <label class="d-flex align-items-center gap-2">
            <input
              type="checkbox"
              disabled=${!formParticipante.ministrante_email}
              checked=${formParticipante.enviar_lembrete_calendario}
              onChange=${(event) => setFormParticipante({ ...formParticipante, enviar_lembrete_calendario: !!event.target.checked })}
            />
            <span>
              Adicionar lembrete no calendário do ministrante
              ${!formParticipante.ministrante_email ? html`<span class="text-muted"> (escolha um usuário do sistema acima)</span>` : null}
            </span>
          </label>
        </div>

        <footer class="rh-modal-footer">
          <div class="rh-modal-footer-actions">
            <button type="button" class="btn btn-outline-secondary" disabled=${salvandoParticipante} onClick=${fecharModalParticipante}>
              Concluir
            </button>
            <button
              type="button"
              class="btn btn-primary"
              disabled=${salvandoParticipante || !participanteSelecionado}
              onClick=${confirmarAdicaoParticipante}
            >
              <span class="material-symbols-outlined">${IconeSvg('person_add')}</span>
              ${salvandoParticipante ? 'Adicionando...' : 'Adicionar ao treinamento'}
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
        onClose=${fecharTreinamentoEmAndamento}
        className="rh-modal-dialog--lg"
      >
        ${treinamentoEmAndamento
      ? html`
              <div class="rh-details-body">
                ${carregandoPdfSlide
          ? html`<p class="text-muted">Carregando o slide enviado...</p>`
          : pdfSlideUrl
            ? html`
                      <iframe
                        src=${pdfSlideUrl}
                        title="Slide do treinamento"
                        style=${{ width: '100%', height: '65vh', border: '1px solid var(--color-border)', borderRadius: '8px' }}
                      ></iframe>
                    `
            : treinamentoEmAndamento.slides.length
              ? html`
                      <div class="rh-section-card rh-section-card--flat" style=${{ padding: '20px' }}>
                        ${erroPdfSlide ? html`<div class="alert alert-warning">${erroPdfSlide}</div>` : null}
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
              : html`<p class="text-muted">Este treinamento ainda não tem slide enviado nem script cadastrado — cadastre em "Editar treinamento".</p>`}
                <p class="text-muted small mt-3">
                  Ao final da apresentação, use "Ir para presença" para marcar quem assistiu.
                </p>
              </div>
            `
      : null}
        <footer class="rh-modal-footer">
          <div class="rh-modal-footer-actions">
            <button type="button" class="btn btn-outline-secondary" onClick=${fecharTreinamentoEmAndamento}>
              Fechar
            </button>
            <button type="button" class="btn btn-primary" onClick=${irParaPresencaDoTreinamentoEmAndamento}>
              <span class="material-symbols-outlined">${IconeSvg('how_to_reg')}</span>
              Ir para presença
            </button>
          </div>
        </footer>
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${modalPresencaAberto}
        titulo="Presença"
        subtitulo=${grupoPresencaAtivo ? `${grupoPresencaAtivo.trilha_nome} · ${formatarDataHora(grupoPresencaAtivo.data_prevista)}` : ''}
        onClose=${fecharModalPresenca}
      >
        ${grupoPresencaAtivo
      ? html`
              <div class="rh-details-body">
                <p class="text-muted small">
                  Marque quem esteve presente. Também é possível adicionar alguém que não estava na lista original de
                  convocados, mas participou do treinamento.
                </p>
                <div class="table-responsive">
                  <table class="table align-middle rh-modern-history-table">
                    <thead>
                      <tr>
                        <th>Colaborador</th>
                        <th>Presença</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${grupoPresencaAtivo.participantes.map(
          (item) => html`
                          <tr key=${item.id_onboarding}>
                            <td>${item.nome_candidato || `Registro ${item.id_registro}`}</td>
                            <td>
                              <select
                                class="form-select form-select-sm"
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
                          </tr>
                        `,
        )}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  class="btn btn-outline-primary btn-sm"
                  onClick=${() => {
          const trilha = trilhas.find((t) => String(t.id_trilha) === String(grupoPresencaAtivo.trilha_id))
            || { id_trilha: grupoPresencaAtivo.trilha_id, nome: grupoPresencaAtivo.trilha_nome };
          abrirAdicionarParticipante(trilha, {
            local: grupoPresencaAtivo.local || '',
            data_prevista: paraInputDatetimeLocal(grupoPresencaAtivo.data_prevista),
            ministrante: grupoPresencaAtivo.ministrante || '',
          });
        }}
                >
                  <span class="material-symbols-outlined">${IconeSvg('person_add')}</span>
                  Adicionar colaborador não convocado
                </button>
              </div>
            `
      : null}
        <footer class="rh-modal-footer">
          <div class="rh-modal-footer-actions">
            <button type="button" class="btn btn-outline-secondary" onClick=${fecharModalPresenca}>
              Fechar
            </button>
            <button
              type="button"
              class="btn btn-primary"
              disabled=${salvandoPresenca || !Object.keys(presencasPendentes).length}
              onClick=${async () => {
          await salvarListaPresenca();
          fecharModalPresenca();
        }}
            >
              ${salvandoPresenca ? 'Salvando...' : 'Salvar presença e finalizar'}
            </button>
          </div>
        </footer>
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${modalProximosTreinosAberto}
        titulo="Próximos treinos"
        subtitulo=${trilhaProximosTreinos?.trilha?.nome || ''}
        onClose=${fecharModalProximosTreinos}
      >
        ${trilhaProximosTreinos
      ? html`
              <div class="rh-details-body">
                ${trilhaProximosTreinos.ocorrencias.length
          ? html`
                      <div class="table-responsive">
                        <table class="table align-middle rh-modern-history-table">
                          <thead>
                            <tr>
                              <th>Data/hora</th>
                              <th>Local</th>
                              <th>Ministrante</th>
                              <th>Alunos</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${trilhaProximosTreinos.ocorrencias.map(
              (ocorrencia, index) => html`
                                <tr key=${index}>
                                  <td>${formatarDataHora(ocorrencia.data_prevista)}</td>
                                  <td>${ocorrencia.local || '-'}</td>
                                  <td>${ocorrencia.ministrante || '-'}</td>
                                  <td>${ocorrencia.alunos}</td>
                                </tr>
                              `,
            )}
                          </tbody>
                        </table>
                      </div>
                    `
          : html`<p class="text-muted small mb-0">Nenhuma ocorrência agendada para este treinamento no momento.</p>`}
              </div>
            `
      : null}
        <footer class="rh-modal-footer">
          <button type="button" class="btn btn-outline-secondary" onClick=${fecharModalProximosTreinos}>
            Fechar
          </button>
        </footer>
      </${ModalPadrao}>
    </${PainelRh}>
  `;
}
