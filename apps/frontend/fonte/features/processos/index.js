import { IconeSvg } from '../../ui/icone.js';
import { MenuAcoesProcesso } from '../../ui/components/menu-acoes.js';

import {
  html,
  lazy,
  useEffect,
  useMemo,
  useState,
} from '../../infraestrutura-react.js';
import {
  TAMANHO_DETALHE_PROCESSO,
  agendarEntrevista,
  adicionarPreAnaliseAoProcesso,
  analisarCvCandidatoInscrito,
  analisarCvEmailRecebido,
  atualizarAnotacaoDossieProcesso,
  atualizarEntrevista,
  atualizarFichaCandidato,
  atualizarPerfilCandidato,
  atualizarPreAnaliseCv,
  atualizarProcesso,
  atualizarStatusCandidato,
  atualizarStatusCandidatoAvulso,
  analisarCvProcesso,
  baixarPacoteHistorico,
  baixarCvCandidato,
  criarBancoTalentos,
  carregarDetalhesProva,
  criarAnotacaoDossieProcesso,
  desativarLinkPublicoCandidatura,
  dispensarPreAnaliseCv,
  encerrarProcesso,
  pausarProcesso,
  enviarPreAnaliseParaBancoTalentos,
  enviarEmailAprovacao,
  gerarLinkPublicoCandidatura,
  lerEmailsRecebidosProcesso,
  lerAnotacoesDossieProcesso,
  lerBancoTalentos,
  lerCandidatosSugeridosProcesso,
  lerCandidatosProcessos,
  lerDetalheProcesso,
  lerEntrevistas,
  lerFichaCandidato,
  lerPreAnalisesCv,
  lerProcessos,
  listarMotivosEliminacao,
  lerScorecardCandidato,
  salvarScorecardCandidato,
  lerSlotsEntrevista,
  limparListaPreAnalisesCv,
  reconsiderarEliminacaoCandidato,
  registrarWhatsappAprovacao,
  registrarWhatsappContatoManual,
  uploadCvCandidato,
  usarCandidatoDoBancoTalentos,
  retomarProcesso,
  cancelarProcesso,
} from '../../app/controlador-aplicacao.js';
import {
  baixarBlob,
  formatarDataCurta,
  formatarDataParaInput,
  obterItensPaginados,
} from '../../utilitarios.js';
import {
  formatarDataHora,
  formatarDataNascimento,
  montarResumoAnaliticoCv,
  obterClasseStatusEntrevista,
  obterClasseStatusProcesso,
} from '../../shared/helpers-visuais.js';
import {
  abrirBlobEmNovaGuia,
  copiarTexto,
  montarUrlPublicaCandidatura,
  obterBasePublicaCandidatura,
  toDatetimeLocal,
} from '../../shared/browser-utils.js';
import { useToast } from '../../shared/hooks/use-toast.js';
import {
  ModalCompartilharVaga,
  montarTextoCompartilhamentoVaga,
} from '../../shared/components/share-job-modal.js?v=20260904-identidade-conecta';
import {
  DOCUMENTOS_APROVACAO_PADRAO,
  ModalAprovacaoCandidato,
  atualizarDocumentosNaMensagem,
} from '../../shared/components/approval-modal.js';
import {
  ModalEdicaoEntrevista,
} from '../../shared/components/interview-edit-modal.js';
import { TabelaVazia } from '../../shared/components/empty-table-row.js';
import { SkeletonTableRows } from '../../shared/components/skeleton.js';
import {
  CANDIDATE_STATUS_APPROVED,
  CANDIDATE_STATUS_ANALYSIS,
  CANDIDATE_STATUS_ATTENDED,
  CANDIDATE_STATUS_CONFIRMED,
  CANDIDATE_STATUS_ELIMINATED,
  CANDIDATE_STATUS_NOT_QUALIFIED,
  CANDIDATE_STATUS_PENDING_CONFIRMATION,
  CANDIDATE_STATUS_QUALIFIED,
  CANDIDATE_STATUS_RESCHEDULED,
  CANDIDATE_STATUS_SCHEDULED,
  CANDIDATE_STATUS_TALENT_BANK,
  CANDIDATE_STATUS_WITHDREW,
  canonicalizeCandidateStatus,
  getCandidateActionState,
  isActiveCandidateStatus,
  isProcessClosed,
} from '../../shared/process-flow.js';
import {
  quebrarListaTexto,
  validarFormularioEntrevista,
  validarFormularioProcesso,
} from '../../shared/validacoes.js';
import {
  encontrarProcessoPorReferencia,
  obterChaveProcesso,
  obterReferenciaProcesso,
  obterReferenciaProcessoDoCandidato,
} from '../../shared/process-reference.js';
import { CHAVE_DUPLICAR_PROCESSO, CHAVE_PROCESSO_DETALHE } from './state.js';
import { gerarAnaliseInteligenteProcesso } from '../../services/process-dossier-ai.js';
import {
  criarProvaGerada,
  cancelarProvaGerada,
  deletarProvaGerada,
  lerProvaGerada,
  reabrirProvaGerada,
} from '../../services/api/generated-exams.js?v=20260721-exam-analytics-2';
import { criarAplicacaoDisc } from '../../services/api/disc.js';
import { criarAplicacaoRaciocinio } from '../../services/api/raciocinio-logico.js';
import {
  OPCOES_OPERACOES,
  OPCOES_TRILHAS_PROCESSO,
} from '../../perguntas.js';
import { CabecalhoSecaoColapsavel } from './components/section-toggle.js';
import {
  LoadingState,
  MetricGrid,
  ModalConfirmacaoAcao,
  ModalDetalhesProva,
  ModalPadrao,
  PageIntro,
  PainelRh,
  ScoreRadarChart,
  SectionCard,
  ToastAlert,
} from '../../ui/componentes-compartilhados.js';

const MENSAGEM_CANDIDATO_APROVADO_BLOQUEADO =
  'Este candidato já foi aprovado. Para alterar sua situação, será necessário um novo cadastro ou atualização manual.';
const ModalGerarProva = lazy(() => import('../provas-geradas/index.js').then((modulo) => ({
  default: modulo.ModalGerarProva,
})));
const AVISO_URL_PUBLICA_NAO_CONFIGURADA =
  'URL pública ainda não configurada. Defina PUBLIC_CANDIDATE_BASE_URL no servidor para liberar inscrições externas.';
const CHAVE_DETALHE_CANDIDATO_RH = 'rh_candidate_detail';
const EXIBIR_PAGINA_PUBLICA_CANDIDATURA = false;
const EXIBIR_CANDIDATOS_INSCRITOS = false;
const TAMANHO_PAGINA_CANDIDATOS_DETALHE = 10;
const TAMANHO_PAGINA_APROVADOS_DETALHE = 5;
const TAMANHO_PAGINA_BANCO_TALENTOS_DETALHE = 5;
const TAMANHO_PAGINA_PRE_ANALISE_DETALHE = 5;
const TAMANHO_PAGINA_CVS_NAO_QUALIFICADOS = 5;
const TAMANHO_PAGINA_ENTREVISTAS_PROCESSO = 4;
const OPCOES_TEMPO_PAUSA_PROCESSO = [
  { value: '1_semana', label: '1 semana', dias: 7 },
  { value: '15_dias', label: '15 dias', dias: 15 },
  { value: '1_mes', label: '1 mês', meses: 1 },
  { value: '3_meses', label: '3 meses', meses: 3 },
  { value: 'indefinido', label: 'Indefinido' },
];
const TIPOS_INDICACAO_PROCESSO = [
  'Indicado',
  'Indicado com restrição',
  'Contraindicado',
];
const MOTIVOS_ELIMINACAO = [
  'Eliminado pela nota de corte',
  'Eliminado na entrevista',
  'Candidato não compareceu',
  'Optou por não prosseguir',
  'Baixa aderência a vaga',
  'Não atendeu aos requisitos',
  'Elimado pela baixa nota nas provas'
];
const ETAPAS_ELIMINACAO_ENTREVISTA = [
  'Com o Gestor do RH',
  'Com Supervisor',
  'Com Gestor da Área',
];
const REQUISITOS_PUBLICOS_PADRAO = [
  'Ensino médio completo ou formação compatível com a vaga.',
  'Experiência anterior em atividades relacionadas será considerada um diferencial.',
  'Boa comunicação verbal e escrita.',
  'Organização, responsabilidade e postura profissional.',
  'Facilidade para aprender sistemas, processos internos e rotinas operacionais.',
  'Disponibilidade para cumprir a jornada e os horários definidos pelo RH.',
];
const RESPONSABILIDADES_PUBLICAS_PADRAO = [
  'Executar as atividades da função conforme orientação da liderança.',
  'Atender demandas internas e externas com cordialidade, clareza e agilidade.',
  'Registrar informações de forma correta nos sistemas e controles definidos.',
  'Cumprir procedimentos, prazos, políticas internas e orientações do processo.',
  'Apoiar a equipe na manutenção da qualidade e continuidade das operações.',
];
const CLASSIFICACOES_FICHA_CANDIDATO = [
  'Indicado',
  'Indicado com restrições',
  'Contraindicado',
];
const STATUS_APTOS_GERAR_PROVA_PROCESSO = new Set([
  'agendado',
  'apto para prova',
  'em avaliacao',
  'em avaliação',
  'pendente de prova',
  'confirmado',
]);

function candidatoPodeGerarProva(candidato = {}, processoStatus = '') {
  if (isProcessClosed(processoStatus)) return false;
  const statusCandidato = normalizarTextoComparacao(
    candidato.status_fluxo ||
    candidato.status_candidato ||
    candidato.status_entrevista ||
    'Agendado',
  );
  return STATUS_APTOS_GERAR_PROVA_PROCESSO.has(statusCandidato);
}

function candidatoPodeSerAprovado(candidato = {}, estadoAcoes = null) {
  const estado = estadoAcoes || getCandidateActionState(candidato);
  if (estado.canApprove) return true;
  return Boolean(
    candidatoTemProvaConcluida(candidato) &&
    !estado.processClosed &&
    !estado.isFinalized,
  );
}

function candidatoPodeSerEliminadoNoProcesso(candidato = {}, estadoAcoes = null) {
  const estado = estadoAcoes || getCandidateActionState(candidato);
  const status = canonicalizeCandidateStatus(
    candidato?.status_fluxo ||
    candidato?.status_candidato ||
    estado.visibleStatus,
  );

  return (
    !estado.processClosed &&
    status !== CANDIDATE_STATUS_APPROVED &&
    isActiveCandidateStatus(status)
  );
}

function candidatoPodeIrParaBancoTalentos(candidato = {}, estadoAcoes = null, processoStatus = '') {
  const estado = estadoAcoes || getCandidateActionState(candidato, processoStatus);
  const status = canonicalizeCandidateStatus(
    candidato?.status_fluxo ||
    candidato?.status_candidato ||
    estado.visibleStatus,
  );

  return (
    !estado.processClosed &&
    !isProcessClosed(processoStatus) &&
    estado.isActive &&
    status !== CANDIDATE_STATUS_TALENT_BANK &&
    status !== CANDIDATE_STATUS_APPROVED &&
    status !== CANDIDATE_STATUS_ELIMINATED
  );
}

function obterMensagemOperacionalErro(error, fallback) {
  const mensagem = String(error?.message || '').trim();
  if (!mensagem) return fallback;

  if (/(traceback|stack|odbc|sql|syntax|exception|database|pyodbc)/i.test(mensagem)) {
    console.error(fallback, error);
    return fallback;
  }

  return mensagem;
}

function formatarValorFicha(valor, fallback = 'Não informado') {
  const texto = String(valor ?? '').trim();
  return texto || fallback;
}

function tentarParseJsonFicha(valor) {
  if (!valor || typeof valor !== 'string') return valor;
  const texto = valor.trim();
  if (!/^[\[{]/.test(texto)) return valor;
  try {
    return JSON.parse(texto);
  } catch (error) {
    return valor;
  }
}

function formatarNumeroFicha(valor, fallback = 'Não informado') {
  const numero = Number(String(valor ?? '').replace(',', '.'));
  if (!Number.isFinite(numero)) return fallback;
  return numero.toFixed(1).replace('.', ',');
}

function resultadoFichaEhEntrevista(item = {}) {
  return normalizarTextoComparacao(item.etapa || item.tipo || '').includes('entrevista');
}

function resultadoFichaEhCurriculo(item = {}) {
  return normalizarTextoComparacao(item.etapa || item.tipo || '').includes('curriculo');
}

function formatarPontuacaoResultadoFicha(item = {}) {
  const pontuacao = tentarParseJsonFicha(item.pontuacao);
  if (pontuacao && typeof pontuacao === 'object') {
    const score = pontuacao.score ?? pontuacao.rawScore ?? pontuacao.nota;
    const max = pontuacao.max ?? pontuacao.rawMax;
    if (score !== undefined && max !== undefined) {
      return `${formatarNumeroFicha(score, score)}/${formatarNumeroFicha(max, max)}`;
    }
  }
  return formatarValorFicha(item.pontuacao);
}

function montarAnaliseResultadoFicha(item = {}) {
  const etapa = formatarValorFicha(item.etapa, 'Etapa');
  const nota = formatarPontuacaoResultadoFicha(item);
  const status = formatarValorFicha(item.status);
  const questoes = Number(item.questoes || item.questionCount || 0);
  const partes = [
    `${etapa}: nota ${nota}.`,
    status !== 'Não informado' ? `Status: ${status}.` : '',
    questoes ? `Foram consideradas ${questoes} questão(ões) nesta etapa.` : '',
  ].filter(Boolean);
  if (normalizarTextoComparacao(etapa).includes('curriculo')) {
    partes.push('Análise de currículo registrada para apoiar a decisão do RH.');
  } else {
    partes.push('Resultado consolidado da etapa realizada, sem exibir gabarito ou critérios internos.');
  }
  return partes.join(' ');
}

function resultadosFichaVisiveis(resultados = []) {
  return (Array.isArray(resultados) ? resultados : [])
    .filter((item) => !resultadoFichaEhEntrevista(item));
}

function escaparHtmlFicha(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function montarFormularioFichaCandidato(ficha) {
  const candidato = ficha?.candidato || {};
  const avaliacao = ficha?.avaliacao_rh || {};

  return {
    nome_candidato: candidato.nome_candidato || '',
    email: candidato.email || '',
    telefone: candidato.telefone || '',
    whatsapp: candidato.whatsapp || '',
    cidade: candidato.cidade || '',
    bairro: candidato.bairro || '',
    observacao_rh: avaliacao.observacoes || '',
    classificacao: avaliacao.classificacao || '',
    justificativa: avaliacao.justificativa || '',
  };
}

function montarFichaParaImpressao(ficha, formulario) {
  const dadosFormulario = formulario || montarFormularioFichaCandidato(ficha);
  const classificacao = dadosFormulario.classificacao || '';

  return {
    ...(ficha || {}),
    candidato: {
      ...(ficha?.candidato || {}),
      nome_candidato: dadosFormulario.nome_candidato,
      email: dadosFormulario.email,
      telefone: dadosFormulario.telefone,
      whatsapp: dadosFormulario.whatsapp,
      cidade: dadosFormulario.cidade,
      bairro: dadosFormulario.bairro,
    },
    avaliacao_rh: {
      ...(ficha?.avaliacao_rh || {}),
      observacoes: dadosFormulario.observacao_rh,
      classificacao,
      classificacao_label: classificacao || 'Não definido',
      justificativa: dadosFormulario.justificativa,
    },
  };
}

function montarLinhasTabelaImpressao(itens, colunas, textoVazio) {
  if (!itens?.length) {
    return `
      <tr>
        <td colspan="${colunas.length}" class="muted">${escaparHtmlFicha(textoVazio)}</td>
      </tr>
    `;
  }

  return itens.map((item) => `
    <tr>
      ${colunas.map((coluna) => `
        <td>${escaparHtmlFicha(coluna.valor(item))}</td>
      `).join('')}
    </tr>
  `).join('');
}

function obterPrimeiroValorFicha(objetos = [], chaves = []) {
  for (const objeto of objetos) {
    for (const chave of chaves) {
      const valor = String(objeto?.[chave] ?? '').trim();
      if (valor) return valor;
    }
  }
  return '';
}

function juntarValoresFicha(...valores) {
  return Array.from(new Set(valores.map((valor) => String(valor || '').trim()).filter(Boolean))).join(' • ');
}

function montarCamposImpressaoFicha(candidato = {}, processos = []) {
  const processo = processos[0] || {};
  const endereco = juntarValoresFicha(
    obterPrimeiroValorFicha([candidato], ['endereco', 'logradouro']),
    obterPrimeiroValorFicha([candidato], ['numero', 'numero_endereco']),
    obterPrimeiroValorFicha([candidato], ['bairro']),
  );
  const indicacaoTipo = obterPrimeiroValorFicha([candidato, processo], ['tipo_indicacao']);
  const indicacao = processo.eh_indicacao
    ? juntarValoresFicha('Sim', indicacaoTipo)
    : indicacaoTipo || obterPrimeiroValorFicha([candidato], ['indicacao', 'indicado_por']);

  return [
    ['Idade', obterPrimeiroValorFicha([candidato], ['idade'])],
    ['Data de nascimento', obterPrimeiroValorFicha([candidato], ['data_nascimento', 'nascimento'])],
    ['Sexo', obterPrimeiroValorFicha([candidato], ['sexo', 'genero'])],
    ['CPF', obterPrimeiroValorFicha([candidato], ['cpf'])],
    ['Telefone', obterPrimeiroValorFicha([candidato], ['telefone'])],
    ['Celular', obterPrimeiroValorFicha([candidato], ['celular'])],
    ['WhatsApp', obterPrimeiroValorFicha([candidato], ['whatsapp'])],
    ['E-mail', obterPrimeiroValorFicha([candidato], ['email'])],
    ['Endereço', endereco],
    ['CEP', obterPrimeiroValorFicha([candidato], ['cep'])],
    ['Cidade', obterPrimeiroValorFicha([candidato], ['cidade'])],
    ['Estado', obterPrimeiroValorFicha([candidato], ['estado', 'uf'])],
    ['Escolaridade', obterPrimeiroValorFicha([candidato], ['escolaridade'])],
    ['Formação', obterPrimeiroValorFicha([candidato], ['formacao', 'formação'])],
    ['Curso', obterPrimeiroValorFicha([candidato], ['curso'])],
    ['Instituição', obterPrimeiroValorFicha([candidato], ['instituicao', 'instituição'])],
    ['Processo seletivo', obterPrimeiroValorFicha([processo], ['id_processo_ref', 'id_processo'])],
    ['Cargo/Vaga', obterPrimeiroValorFicha([processo, candidato], ['vaga', 'cargo'])],
    ['Cliente', obterPrimeiroValorFicha([candidato, processo], ['cliente'])],
    ['Operação', obterPrimeiroValorFicha([candidato, processo], ['operacao', 'operação'])],
    ['Indicação', indicacao],
    ['Nome do indicador', obterPrimeiroValorFicha([candidato], ['nome_indicador', 'indicador'])],
    ['Data de cadastro', obterPrimeiroValorFicha([candidato, processo], ['data_cadastro', 'data_inscricao'])],
    ['Última atualização', obterPrimeiroValorFicha([candidato], ['ultima_atualizacao', 'atualizado_em'])],
    ['Situação', obterPrimeiroValorFicha([processo, candidato], ['status', 'status_candidato', 'status_fluxo'])],
  ].filter(([, valor]) => String(valor || '').trim());
}

function obterPercentualResultadoFicha(item = {}) {
  const pontuacao = tentarParseJsonFicha(item.pontuacao);
  if (pontuacao && typeof pontuacao === 'object') {
    const score = Number(String(pontuacao.score ?? pontuacao.rawScore ?? pontuacao.nota ?? '').replace(',', '.'));
    const maximo = Number(String(pontuacao.max ?? pontuacao.rawMax ?? '').replace(',', '.'));
    if (Number.isFinite(score) && Number.isFinite(maximo) && maximo > 0) {
      return (score / maximo) * 100;
    }
  }

  const partes = String(formatarPontuacaoResultadoFicha(item)).split('/');
  const score = Number(String(partes[0] || '').replace(',', '.'));
  const maximo = Number(String(partes[1] || '').replace(',', '.'));
  return Number.isFinite(score) && Number.isFinite(maximo) && maximo > 0
    ? (score / maximo) * 100
    : null;
}

function montarCompetenciasImpressaoFicha(resultados = [], candidato = {}) {
  const competencias = (Array.isArray(resultados) ? resultados : [])
    .filter((item) => !resultadoFichaEhCurriculo(item))
    .map((item) => {
      const etapa = String(item?.etapa || '').trim();
      const percentual = obterPercentualResultadoFicha(item);
      if (!etapa) return '';
      if (percentual === null) return `Competência observada em ${etapa}.`;
      if (percentual >= 70) return `Boa capacidade em ${etapa}.`;
      if (percentual >= 50) return `Desempenho em desenvolvimento em ${etapa}.`;
      return `Ponto de desenvolvimento em ${etapa}.`;
    })
    .filter(Boolean);

  if (competencias.length) return Array.from(new Set(competencias));
  return Array.from(
    new Set(
      [
        ...(Array.isArray(candidato.qualidades_cv) ? candidato.qualidades_cv : []),
        ...(Array.isArray(candidato.skills) ? candidato.skills : []),
      ]
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  );
}

function obterNotaGeralImpressaoFicha(candidato = {}, resultados = []) {
  const direta = obterPrimeiroValorFicha([candidato], [
    'nota_prova',
    'pontuacao_final',
    'nota_final',
    'nota_curriculo',
  ]);
  return direta || formatarPontuacaoResultadoFicha(resultados[0] || {});
}

function imprimirFichaCandidato(ficha, formulario) {
  const fichaImpressao = montarFichaParaImpressao(ficha, formulario);
  const candidato = fichaImpressao.candidato || {};
  const avaliacao = fichaImpressao.avaliacao_rh || {};
  const processos = Array.isArray(fichaImpressao.processos)
    ? fichaImpressao.processos
    : [];
  const resultados = resultadosFichaVisiveis(fichaImpressao.resultados);
  const nome = formatarValorFicha(candidato.nome_candidato, 'Candidato');
  const dataGeracao = formatarDataHora(new Date().toISOString());
  const camposInformacoes = montarCamposImpressaoFicha(candidato, processos);
  const notaGeral = obterNotaGeralImpressaoFicha(candidato, resultados);
  const aderencia = String(candidato.aderencia_percentual ?? '').trim();
  const aderenciaFormatada = aderencia ? `${aderencia.replace('%', '')}%` : '-';
  const competencias = montarCompetenciasImpressaoFicha(resultados, candidato);
  const linhasInformacoes = camposInformacoes.length
    ? camposInformacoes.map(([rotulo, valor]) => {
      const valorFormatado = /data|atualização/i.test(rotulo)
        ? formatarDataHora(valor)
        : formatarValorFicha(valor);
      return `<div class="candidate-info-field"><span>${escaparHtmlFicha(rotulo)}</span><strong>${escaparHtmlFicha(valorFormatado)}</strong></div>`;
    }).join('')
    : '<div class="candidate-empty">Dados complementares não informados.</div>';
  const linhasResultados = resultados.length
    ? resultados.map((item) => {
      const peso = item.peso ?? item.weight ?? '';
      const resultado = String(
        item.resultado ||
        item.resultado_geral ||
        item.processo ||
        (item.questoes ? `${item.questoes} questão(ões)` : ''),
      ).trim();
      return `
        <tr>
          <td>${escaparHtmlFicha(formatarValorFicha(item.etapa))}</td>
          <td>${escaparHtmlFicha(formatarValorFicha(item.status))}</td>
          <td>${escaparHtmlFicha(formatarPontuacaoResultadoFicha(item))}</td>
          <td>${escaparHtmlFicha(formatarValorFicha(peso, '-'))}</td>
          <td>${escaparHtmlFicha(formatarValorFicha(resultado, '-'))}</td>
        </tr>
      `;
    }).join('')
    : '<tr><td colspan="5" class="candidate-empty">Nenhum resultado registrado.</td></tr>';
  const listaCompetencias = (competencias.length
    ? competencias
    : ['Sem competências consolidadas para esta avaliação.'])
    .map((item) => `<li>${escaparHtmlFicha(item)}</li>`)
    .join('');
  const janela = window.open('', '_blank');

  if (!janela) {
    throw new Error('Não foi possível abrir a janela de impressão. Verifique o bloqueador de pop-ups.');
  }

  const htmlImpressao = `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <title>Ficha Geral - ${escaparHtmlFicha(nome)}</title>
        <style>
          @page { size: A4; margin: 12mm; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            color: #172033;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 12px;
            line-height: 1.45;
          }
          .toolbar {
            display: flex;
            justify-content: flex-end;
            margin: 0 0 16px;
          }
          .toolbar button {
            border: 1px solid #1b5fc1;
            border-radius: 6px;
            background: #1b5fc1;
            color: #fff;
            padding: 8px 14px;
            /*font-weight: 700;*/
            cursor: pointer;
          }
          header {
            border-bottom: 2px solid #1b5fc1;
            padding-bottom: 12px;
            margin-bottom: 16px;
          }
          h1 {
            margin: 0 0 4px;
            font-size: 24px;
          }
          h2 {
            margin: 18px 0 8px;
            font-size: 15px;
            color: #1b5fc1;
          }
          .muted { color: #627085; }
          .grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px 18px;
          }
          .field strong {
            display: block;
            font-size: 10px;
            color: #627085;
            text-transform: uppercase;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 6px;
          }
          th, td {
            border: 1px solid #d8e0ec;
            padding: 7px;
            vertical-align: top;
            text-align: left;
          }
          th {
            background: #edf3fb;
            color: #172033;
          }
          .text-block {
            min-height: 38px;
            border: 1px solid #d8e0ec;
            border-radius: 6px;
            padding: 8px;
            white-space: pre-wrap;
          }
          .candidate-sheet { font-size: 10px; line-height: 1.28; }
          .candidate-sheet header {
            display: grid;
            grid-template-columns: 1fr auto;
            align-items: center;
            gap: 16px;
            margin: 0 0 12px;
            padding: 10px 12px;
            border: 1px solid #4b5563;
          }
          .candidate-sheet header h1 {
            margin: 3px 0 0;
            color: #111827;
            font-size: 20px;
            line-height: 1.1;
            text-align: center;
            overflow-wrap: anywhere;
          }
          .candidate-sheet header small,
          .candidate-sheet .field-label,
          .candidate-info-field span,
          .candidate-score span {
            display: block;
            color: #64748b;
            font-size: 8px;
            /*font-weight: 700;*/
            letter-spacing: .04em;
            text-transform: uppercase;
          }
          .candidate-issued { min-width: 110px; text-align: right; }
          .candidate-section { margin-top: 12px; break-inside: avoid; }
          .candidate-section h2 { margin: 0 0 5px; color: #111827; font-size: 11px; }
          .candidate-info-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            border-top: 1px solid #64748b;
            border-left: 1px solid #64748b;
          }
          .candidate-info-field {
            min-width: 0;
            min-height: 38px;
            padding: 5px 6px;
            border-right: 1px solid #94a3b8;
            border-bottom: 1px solid #94a3b8;
          }
          .candidate-info-field strong {
            display: block;
            margin-top: 3px;
            color: #111827;
            font-size: 9px;
            overflow-wrap: anywhere;
          }
          .candidate-results { border: 1px solid #64748b; }
          .candidate-results-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 5px 7px;
            border-bottom: 1px solid #64748b;
          }
          .candidate-results-head h2 { margin: 0; }
          .candidate-score { min-width: 85px; text-align: right; }
          .candidate-score strong { font-size: 17px; line-height: 1; }
          .candidate-results table { margin: 0; table-layout: fixed; }
          .candidate-results th, .candidate-results td { padding: 5px 6px; font-size: 9px; overflow-wrap: anywhere; }
          .candidate-results th { background: #f1f5f9; font-size: 8px; text-transform: uppercase; }
          .candidate-results th:nth-child(1) { width: 25%; }
          .candidate-results th:nth-child(2) { width: 18%; }
          .candidate-results th:nth-child(3), .candidate-results th:nth-child(4) { width: 11%; }
          .candidate-results th:nth-child(5) { width: 35%; }
          .candidate-adherence { display: flex; justify-content: flex-end; gap: 12px; padding: 6px 7px; border-top: 1px solid #64748b; /*font-weight: 700;*/ }
          .candidate-competencies { margin: 0; padding: 6px 10px 6px 24px; border: 1px solid #94a3b8; }
          .candidate-competencies li { margin: 0 0 3px; }
          .candidate-competencies li:last-child { margin-bottom: 0; }
          .candidate-observation { min-height: 112px; border: 1px solid #64748b; padding: 8px; white-space: pre-wrap; }
          .candidate-empty { padding: 8px; color: #64748b; }
          @media print {
            .toolbar { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="toolbar">
          <button type="button" onclick="window.print()">Imprimir / salvar PDF</button>
        </div>
        <main class="candidate-sheet">
          <header>
            <div>
              <small>Relatório de avaliação</small>
              <h1>${escaparHtmlFicha(nome)}</h1>
            </div>
            <div class="candidate-issued">
              <strong>Conecta Provas</strong>
              <small>${escaparHtmlFicha(dataGeracao)}</small>
            </div>
          </header>

          <section class="candidate-section">
            <h2>Informações gerais</h2>
            <div class="candidate-info-grid">${linhasInformacoes}</div>
          </section>

          <section class="candidate-section candidate-results">
            <div class="candidate-results-head">
              <h2>Resultados</h2>
              <div class="candidate-score">
                <span>Nota geral</span>
                <strong>${escaparHtmlFicha(formatarValorFicha(notaGeral, '-'))}</strong>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Etapa</th>
                  <th>Status</th>
                  <th>Nota</th>
                  <th>Peso</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>${linhasResultados}</tbody>
            </table>
            <div class="candidate-adherence"><span>Aderência à vaga</span><strong>${escaparHtmlFicha(aderenciaFormatada)}</strong></div>
          </section>

          <section class="candidate-section">
            <h2>Competências observadas</h2>
            <ul class="candidate-competencies">${listaCompetencias}</ul>
          </section>

          <section class="candidate-section">
            <h2>Observação do RH</h2>
            <div class="candidate-observation">${escaparHtmlFicha(avaliacao.observacoes || '')}</div>
          </section>
        </main>
        <script>
          window.addEventListener('load', function () {
            window.setTimeout(function () { window.print(); }, 200);
          });
        </script>
      </body>
    </html>
  `;

  janela.document.open();
  janela.document.write(htmlImpressao);
  janela.document.close();
}

function normalizarTextoComparacao(valor) {
  return String(valor || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function temValorProcesso(valor) {
  if (Array.isArray(valor)) return valor.some(temValorProcesso);
  return String(valor ?? '').trim() !== '';
}

function formatarValorResumoProcesso(valor) {
  if (Array.isArray(valor)) return valor.filter(temValorProcesso).join(', ');
  return String(valor ?? '').trim();
}

function obterItensTextoProcesso(valor) {
  if (Array.isArray(valor)) {
    return valor
      .filter((item) => !(typeof item === 'object' && item !== null && item.visivel === false))
      .map((item) => (typeof item === 'object' && item !== null ? item.texto : item))
      .filter(temValorProcesso)
      .map((item) => String(item).trim());
  }
  return quebrarListaTexto(valor);
}

function adicionarMesesData(data, meses) {
  const proxima = new Date(data.getTime());
  proxima.setMonth(proxima.getMonth() + meses);
  return proxima;
}

function calcularPrevisaoTerminoPausa(valor, base = new Date()) {
  const opcao = OPCOES_TEMPO_PAUSA_PROCESSO.find((item) => item.value === valor);
  if (!opcao || valor === 'indefinido') return '';
  const previsao = new Date(base.getTime());
  if (opcao.dias) previsao.setDate(previsao.getDate() + opcao.dias);
  const dataFinal = opcao.meses ? adicionarMesesData(base, opcao.meses) : previsao;
  return dataFinal.toISOString().slice(0, 19);
}

function obterRotuloTempoPausa(valor) {
  return OPCOES_TEMPO_PAUSA_PROCESSO.find((item) => item.value === valor)?.label || '';
}

function normalizarDigitosContato(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (digitos.startsWith('55') && [12, 13].includes(digitos.length)) {
    return digitos.slice(2);
  }
  return digitos;
}

function parseJsonProcessoSeguro(valor, fallback = null) {
  if (valor === null || valor === undefined || valor === '') return fallback;
  if (typeof valor === 'object') return valor;
  try {
    return JSON.parse(valor);
  } catch (error) {
    return fallback;
  }
}

function obterConfiguracoesProvaDoProcesso(processo) {
  const dados = parseJsonProcessoSeguro(processo?.configuracao_prova_json, null);
  const lista = Array.isArray(dados) ? dados : dados ? [dados] : [];
  return lista
    .filter((item) => item && typeof item === 'object')
    .map((item, indice) => ({
      ...item,
      id_configuracao: item.id_configuracao || item.id || `prova-processo-${indice + 1}`,
      nome: item.nome || item.configuracao?.blueprint_label || item.tipo_prova || `Prova ${indice + 1}`,
    }));
}

function validarContatoLiberacaoProva({ nome, email, telefone }) {
  if (!String(nome || '').trim()) return 'Informe o nome do candidato.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || '').trim())) {
    return 'Informe um e-mail válido para acesso do candidato.';
  }
  const digitos = normalizarDigitosContato(telefone);
  if (digitos.length < 10 || digitos.length > 13) {
    return 'Informe um telefone válido para acesso do candidato.';
  }
  return '';
}

function obterChaveCandidatoLiberacao(candidato = {}) {
  return String(
    candidato.id_registro ||
    candidato.id_teste ||
    candidato.email ||
    candidato.nome_candidato ||
    candidato.nome ||
    '',
  );
}

function montarPayloadLiberacaoProva({ candidato = {}, processo = {}, configuracao = {}, email = '', telefone = '' }) {
  const config = configuracao || {};
  const configInterna = config.configuracao || {};
  const processoRef = obterReferenciaProcesso(processo) || processo.id_processo || candidato.id_processo_ref || candidato.id_processo || '';
  const processoBase = processo.id_processo || String(processoRef).split('@@', 1)[0] || candidato.id_processo || '';
  const questoes = Array.isArray(config.questoes_snapshot) ? config.questoes_snapshot : [];
  const etapas = Array.isArray(config.etapas) ? config.etapas : [];
  const categorias = Array.isArray(config.categorias) ? config.categorias : [];
  const vaga = config.vaga || processo.vaga || candidato.vaga || '';
  const areaProva = config.area_prova || config.area || configInterna.area_prova || processo.trilha || '';
  const operacao = configInterna.operacao || config.operacao || processo.operacao || candidato.operacao || '';

  return {
    candidato_id: candidato.id_teste || '',
    id_teste: candidato.id_teste || '',
    id_registro: candidato.id_registro || null,
    id_entrevista: candidato.id_entrevista || null,
    id_processo: processoBase,
    id_processo_ref: processoRef,
    nome_candidato: candidato.nome_candidato || candidato.nome || '',
    email,
    telefone,
    whatsapp: candidato.whatsapp || telefone,
    cpf: candidato.cpf || '',
    cargo: vaga,
    vaga,
    area: areaProva,
    area_prova: areaProva,
    operacao,
    trilha: config.trilha || areaProva || processo.trilha || '',
    nivel: config.nivel || config.nivel_prova || '',
    tempo_total: Number(config.tempo_total || config.tempo_minutos || 40),
    tempo_minutos: Number(config.tempo_minutos || config.tempo_total || 40),
    quantidade_questoes: Number(config.quantidade_questoes || questoes.length),
    etapas,
    categorias,
    questoes_snapshot: questoes,
    personalizacao: config.personalizacao || configInterna.personalizacao || {},
    observacoes_internas_rh: config.observacoes_internas_rh || '',
    tom_prova: config.tom_prova || configInterna.personalizacao?.tom_prova || '',
    situacao_pratica_operacao:
      config.situacao_pratica_operacao ||
      configInterna.personalizacao?.situacao_pratica_operacao ||
      '',
    // Correções.txt item 9: lido em liberarProvaDoProcesso() para provisionar
    // automaticamente os testes complementares habilitados no processo.
    testes_complementares: config.testes_complementares || {},
    configuracao: {
      ...configInterna,
      origem_liberacao: 'processo_seletivo',
      configuracao_processo_id: config.id_configuracao,
      prova_processo_configurada_em: config.configurada_em || '',
      id_processo_ref: processoRef,
      tempo_total: Number(config.tempo_total || config.tempo_minutos || 40),
      tempo_minutos: Number(config.tempo_minutos || config.tempo_total || 40),
    },
  };
}

function candidatoBancoJaEstaNoProcesso(candidatoBanco, candidatosProcesso) {
  const idTeste = String(candidatoBanco?.id_teste || '').trim();
  const email = normalizarTextoComparacao(candidatoBanco?.email || '');
  const telefones = [candidatoBanco?.telefone, candidatoBanco?.whatsapp]
    .map(normalizarDigitosContato)
    .filter(Boolean);

  return (candidatosProcesso || []).some((candidato) => {
    const mesmoId = idTeste && String(candidato?.id_teste || '').trim() === idTeste;
    const mesmoEmail =
      email && normalizarTextoComparacao(candidato?.email || '') === email;
    const telefonesCandidato = [candidato?.telefone, candidato?.whatsapp]
      .map(normalizarDigitosContato)
      .filter(Boolean);
    const mesmoTelefone =
      telefones.length &&
      telefonesCandidato.some((telefone) => telefones.includes(telefone));

    return Boolean(mesmoId || mesmoEmail || mesmoTelefone);
  });
}

function formatarContatoBancoTalentos(candidato) {
  return (
    candidato?.email ||
    candidato?.telefone ||
    candidato?.whatsapp ||
    'Contato não informado'
  );
}

function formatarOpcaoBancoTalentos(candidato) {
  const score =
    candidato?.pontuacao_final ||
    candidato?.score_final ||
    candidato?.nota_exibicao ||
    '';
  return [
    candidato?.nome_candidato || 'Candidato sem nome',
    formatarContatoBancoTalentos(candidato),
    candidato?.vaga || candidato?.origem || 'Banco de Talentos',
    score ? `Score ${score}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
}

function montarPayloadIndicacao(formulario) {
  const ehIndicacao = !!formulario?.eh_indicacao;
  const tipoIndicacao = ehIndicacao
    ? String(formulario?.tipo_indicacao || '').trim()
    : '';
  return {
    eh_indicacao: ehIndicacao,
    tipo_indicacao: tipoIndicacao,
  };
}

function isCandidatoIndicacao(candidato) {
  return Boolean(candidato?.eh_indicacao) ||
    Boolean(String(candidato?.tipo_indicacao || '').trim());
}

function isCandidatoManualmenteQualificado(candidato) {
  const origem = normalizarTextoComparacao(candidato?.origem);
  const origemRotulo = normalizarTextoComparacao(candidato?.origem_rotulo);
  const observacao = normalizarTextoComparacao(candidato?.observacao_rh);
  return Boolean(
    candidato?.manual_override ||
    candidato?.qualificacao_manual ||
    origem.includes('uso manual rh') ||
    origemRotulo.includes('uso manual rh') ||
    observacao.includes('utilizado manualmente pelo rh'),
  );
}

function montarTagsOperacionaisCandidato(candidato) {
  const tags = [];
  if (isCandidatoManualmenteQualificado(candidato)) {
    tags.push({
      chave: 'manualmente-qualificado',
      label: 'Manualmente Qualificado',
      className: 'candidate-manual-qualified-chip',
    });
  }
  if (isCandidatoIndicacao(candidato)) {
    tags.push({
      chave: 'indicacao',
      label: 'Indicação',
      className: 'candidate-indication-chip',
    });
  }
  return tags;
}

function montarTagsOperacionaisFicha(ficha) {
  const candidatos = [
    ficha?.candidato || {},
    ...(Array.isArray(ficha?.processos) ? ficha.processos : []),
  ];
  return [
    candidatos.some(isCandidatoManualmenteQualificado)
      ? {
        chave: 'manualmente-qualificado',
        label: 'Manualmente Qualificado',
        className: 'candidate-manual-qualified-chip',
      }
      : null,
    candidatos.some(isCandidatoIndicacao)
      ? {
        chave: 'indicacao',
        label: 'Indicação',
        className: 'candidate-indication-chip',
      }
      : null,
  ].filter(Boolean);
}

function obterNotaProvaCandidato(candidato) {
  return (
    candidato?.nota_prova ||
    candidato?.pontuacao_final ||
    candidato?.nota_final ||
    candidato?.nota_exibicao ||
    ''
  );
}

function obterTagStatusProvaCandidato(candidato) {
  const statusBruto = String(
    candidato?.status_prova_gerada ||
    candidato?.status_prova ||
    '',
  ).trim();
  const status = normalizarTextoComparacao(statusBruto);

  if (!statusBruto && !candidato?.tem_prova_gerada && !candidatoTemProvaSalva(candidato)) {
    return { label: 'Sem prova', className: 'is-empty' };
  }

  if (status.includes('cancelad')) {
    return { label: 'Prova cancelada', className: 'is-cancelled' };
  }
  if (status.includes('finaliz') || status.includes('corrigid') || status.includes('concluid')) {
    return { label: 'Prova concluída', className: 'is-done' };
  }
  if (status.includes('andamento') || status.includes('iniciad') || status.includes('revisao')) {
    return { label: 'Prova em andamento', className: 'is-progress' };
  }
  if (
    status.includes('disponivel') ||
    status.includes('gerad') ||
    status.includes('aguardando candidato') ||
    status.includes('reabert')
  ) {
    return { label: 'Prova disponível', className: 'is-available' };
  }
  if (status.includes('pendente') || status.includes('expirad')) {
    return { label: 'Prova pendente', className: 'is-pending' };
  }
  if (candidatoTemProvaSalva(candidato)) {
    return { label: 'Prova concluída', className: 'is-done' };
  }

  return { label: 'Prova pendente', className: 'is-pending' };
}

function converterNumeroDossie(valor) {
  const texto = String(valor ?? '').replace(',', '.').trim();
  if (!texto || texto === '-') return null;
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
}

function formatarNumeroDossie(valor, fallback = '-') {
  const numero = converterNumeroDossie(valor);
  return numero === null ? fallback : numero.toFixed(1).replace('.', ',');
}

function obterScoreCvCandidato(candidato) {
  const possibilidades = [
    candidato?.cv_score_final,
    candidato?.score_curriculo,
    candidato?.nota_curriculo,
    candidato?.score_cv,
  ];
  return possibilidades.find(
    (valor) => valor !== null && valor !== undefined && String(valor).trim() !== '',
  ) ?? '';
}

function obterStatusDossie(candidato) {
  return (
    candidato?.status_fluxo ||
    candidato?.status_candidato ||
    candidato?.status ||
    'Não informado'
  );
}

function obterEtapaDossie(candidato, entrevistas = []) {
  const idTeste = String(candidato?.id_teste || '').trim();
  const idRegistro = String(candidato?.id_registro || '').trim();
  const entrevista = entrevistas.find((item) => {
    const mesmoTeste =
      idTeste && String(item?.id_teste || '').trim() === idTeste;
    const mesmoRegistro =
      idRegistro && String(item?.id_registro || '').trim() === idRegistro;
    return mesmoTeste || mesmoRegistro;
  });

  if (entrevista?.status_entrevista) return entrevista.status_entrevista;
  return candidato?.etapa_pipeline || obterStatusDossie(candidato);
}

function montarCandidatosDossie(candidatos = [], entrevistas = []) {
  return candidatos.map((candidato) => {
    const notaProva = converterNumeroDossie(obterNotaProvaCandidato(candidato));
    const scoreCv = converterNumeroDossie(obterScoreCvCandidato(candidato));
    const mediaBase = [notaProva, scoreCv].filter((valor) => valor !== null);
    const mediaGeral = mediaBase.length
      ? mediaBase.reduce((soma, valor) => soma + valor, 0) / mediaBase.length
      : null;

    return {
      id: String(candidato.id_registro || candidato.id_teste || ''),
      id_teste: candidato.id_teste || '',
      nome: candidato.nome_candidato || 'Candidato sem nome',
      processo:
        candidato.id_processo_ref ||
        candidato.id_processo ||
        candidato.vaga ||
        '',
      vaga: candidato.vaga || '',
      data:
        candidato.data_prova ||
        candidato.data_atualizacao_pipeline ||
        candidato.aprovado_em ||
        candidato.eliminado_em ||
        '',
      etapa: obterEtapaDossie(candidato, entrevistas),
      classificacao:
        candidato.cv_classificacao ||
        candidato.classificacao ||
        obterStatusDossie(candidato),
      status: obterStatusDossie(candidato),
      notaProva,
      scoreCv,
      mediaGeral,
      email: candidato.email || '',
      whatsapp: candidato.whatsapp || candidato.telefone || '',
      origem: formatarOrigemCandidato(candidato),
      raw: candidato,
    };
  });
}

function filtrarCandidatosDossie(candidatos = [], filtros = {}) {
  const processo = normalizarTextoComparacao(filtros.processo);
  const candidato = normalizarTextoComparacao(filtros.candidato);
  const etapa = normalizarTextoComparacao(filtros.etapa);
  const classificacao = normalizarTextoComparacao(filtros.classificacao);
  const status = normalizarTextoComparacao(filtros.status);
  const dataFiltro = String(filtros.data || '').trim();
  const notaMin = converterNumeroDossie(filtros.notaMin);
  const notaMax = converterNumeroDossie(filtros.notaMax);
  const scoreMin = converterNumeroDossie(filtros.scoreMin);
  const scoreMax = converterNumeroDossie(filtros.scoreMax);

  return candidatos.filter((item) => {
    const textoProcesso = normalizarTextoComparacao([item.processo, item.vaga].join(' '));
    const textoCandidato = normalizarTextoComparacao([item.nome, item.email, item.whatsapp].join(' '));
    const textoEtapa = normalizarTextoComparacao(item.etapa);
    const textoClassificacao = normalizarTextoComparacao(item.classificacao);
    const textoStatus = normalizarTextoComparacao(item.status);
    const dataItem = item.data ? formatarIsoDataLocal(item.data) : '';

    if (processo && !textoProcesso.includes(processo)) return false;
    if (candidato && !textoCandidato.includes(candidato)) return false;
    if (etapa && !textoEtapa.includes(etapa)) return false;
    if (classificacao && !textoClassificacao.includes(classificacao)) return false;
    if (status && !textoStatus.includes(status)) return false;
    if (dataFiltro && dataItem !== dataFiltro) return false;
    if (notaMin !== null && (item.notaProva === null || item.notaProva < notaMin)) return false;
    if (notaMax !== null && (item.notaProva === null || item.notaProva > notaMax)) return false;
    if (scoreMin !== null && (item.scoreCv === null || item.scoreCv < scoreMin)) return false;
    if (scoreMax !== null && (item.scoreCv === null || item.scoreCv > scoreMax)) return false;
    return true;
  });
}

function calcularEstatisticasDossie(candidatos = []) {
  const media = (valores) => {
    const validos = valores.filter((valor) => valor !== null);
    if (!validos.length) return null;
    return validos.reduce((soma, valor) => soma + valor, 0) / validos.length;
  };

  return {
    total: candidatos.length,
    avaliados: candidatos.filter(
      (item) => item.notaProva !== null || item.scoreCv !== null,
    ).length,
    mediaProva: media(candidatos.map((item) => item.notaProva)),
    mediaCv: media(candidatos.map((item) => item.scoreCv)),
    mediaGeral: media(candidatos.map((item) => item.mediaGeral)),
  };
}

function formatarOrigemCandidato(candidato) {
  const rotulo = String(candidato?.origem_rotulo || '').trim();
  if (rotulo) return rotulo;

  const origem = normalizarTextoComparacao(candidato?.origem);
  if (!origem) return 'Processo Único';
  if (origem.includes('pagina') && (origem.includes('candidatura') || origem.includes('inscricao'))) {
    return 'Página de inscrição';
  }
  if (origem.includes('pre analise') || origem.includes('pre-analise') || origem.includes('analise direta')) {
    return 'Análise direta do CV';
  }
  if (origem.includes('banco') && origem.includes('talento')) return 'Banco de Talentos';
  if (origem.includes('recebimento') && origem.includes('email')) return 'Recebimento de e-mail';
  if (origem.includes('processo unico') || origem.includes('processo_unico') || origem === 'prova') {
    return 'Processo Único';
  }
  return String(candidato?.origem || '-').trim() || '-';
}

function formatarHoraCurta(valor) {
  const data = new Date(String(valor || '').trim());
  if (Number.isNaN(data.getTime())) return '-';
  return data.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function criarDataLocalProcesso(valor) {
  if (valor instanceof Date) return new Date(valor);
  const texto = String(valor || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    const [ano, mes, dia] = texto.split('-').map(Number);
    return new Date(ano, mes - 1, dia);
  }
  const data = texto ? new Date(texto) : new Date();
  return Number.isNaN(data.getTime()) ? new Date() : data;
}

function formatarIsoDataLocal(valor) {
  const data = criarDataLocalProcesso(valor);
  if (Number.isNaN(data.getTime())) return '';
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function moverIsoDataLocal(valor, deslocamento) {
  const data = criarDataLocalProcesso(valor);
  data.setDate(data.getDate() + deslocamento);
  return formatarIsoDataLocal(data);
}

function gerarFaixaDiasCalendario(dataBase = new Date(), dataSelecionada = '') {
  const base = criarDataLocalProcesso(dataBase);
  if (Number.isNaN(base.getTime())) return [];
  const selecionada = dataSelecionada || formatarIsoDataLocal(base);

  return [-2, -1, 0, 1, 2].map((deslocamento) => {
    const data = new Date(base);
    data.setDate(base.getDate() + deslocamento);
    const chave = formatarIsoDataLocal(data);
    return {
      chave,
      mes: data.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase(),
      dia: data.toLocaleDateString('pt-BR', { day: '2-digit' }),
      semana: data.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase(),
      selecionado: chave === selecionada,
    };
  });
}

function obterValorDataHoraSlot(slot, campos) {
  const campoEncontrado = campos.find((campo) => String(slot?.[campo] || '').trim());
  const valor = String(slot?.[campoEncontrado] || '').trim();
  const data = String(slot?.data || slot?.date || slot?.dia || slot?.data_slot || '').trim();

  if (data && /^\d{2}:\d{2}/.test(valor)) {
    return `${data}T${valor}`;
  }

  return valor;
}

function obterIdSlotEntrevista(slot) {
  return slot?.id_slot ?? slot?.slot_id ?? slot?.id ?? slot?.id_entrevista_slot ?? '';
}

function obterDataInicioSlotEntrevista(slot) {
  const inicio = obterValorDataHoraSlot(slot, [
    'inicio',
    'data_inicio',
    'data_hora_inicio',
    'start',
    'start_time',
    'hora_inicio',
    'horario',
  ]);
  if (!inicio) return null;

  const data = new Date(inicio);
  return Number.isNaN(data.getTime()) ? null : data;
}

function obterDataFimSlotEntrevista(slot) {
  const fim = obterValorDataHoraSlot(slot, [
    'fim',
    'data_fim',
    'data_hora_fim',
    'end',
    'end_time',
    'hora_fim',
    'termino',
  ]);
  if (!fim) return null;

  const data = new Date(fim);
  return Number.isNaN(data.getTime()) ? null : data;
}

function obterVagasDisponiveisSlotEntrevista(slot) {
  const valor = [
    slot?.disponiveis,
    slot?.vagas_restantes,
    slot?.vagas_disponiveis,
    slot?.available_slots,
    slot?.capacidade_disponivel,
    slot?.capacity,
    slot?.capacidade,
  ].find((item) => item !== null && item !== undefined && String(item).trim() !== '');
  const numero = Number(valor ?? 1);
  return Number.isFinite(numero) ? numero : 1;
}

function obterMotivoEliminacao(candidato) {
  return String(candidato?.motivo_eliminacao || '').trim() || 'Motivo não informado';
}

function montarFormularioCandidato(candidato) {
  return {
    nome_candidato: candidato?.nome_candidato || '',
    email: candidato?.email || '',
    telefone: candidato?.telefone || '',
    whatsapp: candidato?.whatsapp || '',
    cidade: candidato?.cidade || '',
    bairro: candidato?.bairro || '',
  };
}

function candidatoTemProvaSalva(candidato) {
  const idTeste = String(candidato?.id_teste || '').trim();
  if (candidato?.prova_disponivel || candidato?.id_teste_prova) {
    return Boolean(idTeste || candidato?.id_teste_prova);
  }
  const origem = normalizarTextoComparacao(candidato?.origem);
  const nota = String(obterNotaProvaCandidato(candidato) || '').trim();

  return Boolean(
    idTeste &&
    !idTeste.toUpperCase().startsWith('CV-') &&
    nota &&
    (origem.includes('prova') || !origem.includes('pre-analise')),
  );
}

function obterEstadoConfirmacaoEntrevista(candidato = {}) {
  const dataEntrevista = new Date(String(candidato.data_entrevista || '').trim());
  if (Number.isNaN(dataEntrevista.getTime())) {
    return { disponivel: false, dataLiberacao: null };
  }
  const dataLiberacao = new Date(dataEntrevista.getTime() - 42 * 60 * 60 * 1000);
  return {
    disponivel: Date.now() >= dataLiberacao.getTime(),
    dataLiberacao,
  };
}

function montarMensagemConfirmacaoEntrevista(candidato = {}) {
  const nome = String(candidato.nome_candidato || 'candidato').trim();
  const data = formatarDataCurta(candidato.data_entrevista);
  const hora = formatarHoraCurta(candidato.data_entrevista);
  return `Olá ${nome}, você tem um horário marcado em nosso processo seletivo no dia ${data} às ${hora}. Podemos confirmar sua presença?`;
}

function obterIniciaisCandidato(nome = '') {
  const partes = String(nome || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!partes.length) return 'C';
  return `${partes[0]?.[0] || ''}${partes.length > 1 ? partes.at(-1)?.[0] || '' : ''}`
    .toUpperCase();
}

function obterNotaVisualCandidato(candidato = {}) {
  const possibilidades = [
    ['Nota final', candidato.nota_final],
    ['Nota prova', obterNotaProvaCandidato(candidato)],
    ['Nota entrevista', candidato.nota_entrevista],
    ['Nota currículo', obterScoreCvCandidato(candidato)],
    ['Nota geral', candidato.nota_geral || candidato.score_final],
  ];
  const encontrada = possibilidades.find(([, valor]) => converterNumeroDossie(valor) !== null);
  return encontrada
    ? { tipo: encontrada[0], valor: formatarNumeroDossie(encontrada[1]) }
    : { tipo: 'Sem avaliação', valor: '–' };
}

function obterAderenciaVisualCandidato(candidato = {}) {
  const valorDireto = String(
    candidato.aderencia ||
    candidato.classificacao_aderencia ||
    candidato.cv_classificacao ||
    candidato.classificacao ||
    '',
  ).trim();
  const normalizado = normalizarTextoComparacao(valorDireto);
  if (
    normalizado.includes('baixa') ||
    normalizado.includes('pouco qualificad') ||
    normalizado.includes('nao qualificad')
  ) {
    return { label: 'Baixa', className: 'is-low' };
  }
  if (normalizado.includes('media') || normalizado.includes('parcial')) {
    return { label: 'Média', className: 'is-medium' };
  }
  if (normalizado.includes('alta') || normalizado === 'qualificado') {
    return { label: 'Alta', className: 'is-high' };
  }
  const nota = converterNumeroDossie(
    candidato.nota_final || obterScoreCvCandidato(candidato) || obterNotaProvaCandidato(candidato),
  );
  if (nota !== null && nota >= 8) return { label: 'Alta', className: 'is-high' };
  if (nota !== null && nota < 6) return { label: 'Baixa', className: 'is-low' };
  return { label: 'Média', className: 'is-medium' };
}

function obterStatusVisualCandidato(candidato = {}) {
  if (candidatoTemProvaConcluida(candidato)) {
    return obterTagStatusProvaCandidato(candidato).label;
  }
  const statusEntrevista = canonicalizeCandidateStatus(candidato.status_entrevista || '');
  if (statusEntrevista === CANDIDATE_STATUS_PENDING_CONFIRMATION) {
    return 'Pendente confirmação';
  }
  if (statusEntrevista === CANDIDATE_STATUS_CONFIRMED) {
    return 'Entrevista confirmada';
  }
  if (statusEntrevista === CANDIDATE_STATUS_RESCHEDULED) {
    return 'Entrevista reagendada';
  }
  if (statusEntrevista === CANDIDATE_STATUS_SCHEDULED) {
    return 'Entrevista agendada';
  }
  return candidato.status_fluxo || candidato.status_candidato || 'Em análise RH';
}

function obterProximaAcaoVisual(candidato = {}) {
  const status = normalizarTextoComparacao(
    candidato.status_fluxo || candidato.status_candidato || candidato.status_entrevista,
  );
  if (status.includes('agendad') || status.includes('pendente')) return 'Agendar entrevista';
  if (status.includes('compareceu') || status.includes('decis')) return 'Registrar parecer';
  if (status.includes('aprovad')) return 'Enviar para contratação';
  if (status.includes('analise') || status.includes('qualificad')) return 'Avaliar CV';
  if (candidatoTemProvaSalva(candidato)) return 'Avaliar prova';
  return 'Acompanhar candidato';
}

function obterStatusClasseVisual(status = '') {
  const valor = normalizarTextoComparacao(status);
  if (valor.includes('aprov') || valor.includes('realiz') || valor.includes('conclu')) return 'is-success';
  if (valor.includes('reprov') || valor.includes('elimin') || valor.includes('cancel')) return 'is-danger';
  if (valor.includes('pend') || valor.includes('correc') || valor.includes('analise')) return 'is-warning';
  if (valor.includes('reagend') || valor.includes('andamento')) return 'is-pink';
  return 'is-info';
}

function candidatoTemProvaConcluida(candidato) {
  const status = normalizarTextoComparacao(
    candidato?.status_prova_gerada || candidato?.status_prova || '',
  );
  if (status.includes('finaliz') || status.includes('corrigid') || status.includes('concluid')) {
    return true;
  }

  const nota = String(obterNotaProvaCandidato(candidato) || '').trim();
  if (!nota) return false;

  const idTeste = String(candidato?.id_teste_prova || candidato?.id_teste || '').trim();
  const origem = normalizarTextoComparacao(candidato?.origem);
  return Boolean(
    idTeste &&
    !idTeste.toUpperCase().startsWith('CV-') &&
    (origem.includes('prova') || !origem.includes('pre-analise')),
  );
}

function obterIdProvaGeradaCandidato(candidato = {}) {
  const id = Number(candidato.id_prova_gerada || candidato.id_prova || 0);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function provaGeradaFoiIniciada(candidato = {}) {
  if (candidato.prova_iniciada_em || candidato.prova_finalizada_em) return true;
  const status = normalizarTextoComparacao(
    candidato.status_prova_gerada || candidato.status_prova || '',
  );
  return ['andamento', 'iniciad', 'revisao', 'finaliz', 'conclu', 'corrigid'].some(
    (termo) => status.includes(termo),
  );
}

function provaGeradaEstaCancelada(candidato = {}) {
  return normalizarTextoComparacao(
    candidato.status_prova_gerada || candidato.status_prova || '',
  ).includes('cancel');
}

function montarItensPublicosPadrao(textos) {
  return textos.map((texto) => ({ texto, visivel: true }));
}

function normalizarItensPublicos(valor, chave, textosPadrao) {
  const bruto = String(valor || '').trim();
  if (!bruto) return montarItensPublicosPadrao(textosPadrao);

  try {
    const parsed = JSON.parse(bruto);
    const lista = Array.isArray(parsed) ? parsed : parsed?.[chave];
    if (!Array.isArray(lista)) return montarItensPublicosPadrao(textosPadrao);
    return lista
      .map((item) => {
        if (typeof item === 'string') return { texto: item.trim(), visivel: true };
        return {
          texto: String(item?.texto || '').trim(),
          visivel: item?.visivel !== false,
        };
      })
      .filter((item) => item.texto);
  } catch (error) {
    const linhas = bruto
      .split(/\r?\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
    return linhas.length
      ? montarItensPublicosPadrao(linhas)
      : montarItensPublicosPadrao(textosPadrao);
  }
}

function serializarItensPublicos(chave, itens) {
  return JSON.stringify({
    [chave]: (itens || []).map((item) => ({
      texto: String(item.texto || '').trim(),
      visivel: item.visivel !== false,
    })),
  });
}

function isPreAnaliseNaoQualificada(item) {
  const valor = normalizarTextoComparacao(item?.classificacao || item?.classificacao_slug);
  return valor === 'nao qualificado' || valor === 'nao-qualificado';
}

function isPreAnaliseUtilizavelDireto(item) {
  return !isPreAnaliseNaoQualificada(item);
}

function obterRotuloQualificacaoCandidato(candidato) {
  if (isCandidatoManualmenteQualificado(candidato)) {
    return 'Manualmente Qualificado';
  }

  const classificacao = String(
    candidato?.cv_classificacao ||
    candidato?.classificacao_cv ||
    candidato?.status_curriculo ||
    candidato?.classificacao ||
    '',
  ).trim();

  if (classificacao) return classificacao;
  return 'Qualificado';
}

function obterContatoPreAnalise(item) {
  return (
    String(item?.email || '').trim() ||
    String(item?.whatsapp || item?.telefone || '').trim() ||
    '-'
  );
}

function obterMotivoNaoQualificacao(item) {
  const dados = lerProblemasCv(item);
  const problemas = Array.isArray(dados)
    ? dados
    : Array.isArray(dados?.problemas)
      ? dados.problemas
      : [];

  return (
    String(item?.motivo_nao_qualificacao || '').trim() ||
    String(dados?.justificativa || '').trim() ||
    problemas.slice(0, 2).join(' ') ||
    'Motivo não informado.'
  );
}

function lerProblemasCv(item) {
  try {
    const dados = JSON.parse(item?.problemas || '{}');
    return dados && typeof dados === 'object' ? dados : {};
  } catch (error) {
    return {};
  }
}

function montarCandidatoDeFluxo(candidato, processoStatus = '') {
  const estadoAcoes = getCandidateActionState(candidato, processoStatus);

  return {
    ...candidato,
    status_fluxo: estadoAcoes.visibleStatus,
    status_processo: processoStatus || candidato.status_processo || '',
    acoes_fluxo: estadoAcoes,
  };
}

const TIPOS_CONTATO_WHATSAPP = [
  { valor: 'contato_enviado', label: 'Contato enviado' },
  { valor: 'respondeu', label: 'Respondeu' },
  { valor: 'confirmou_entrevista', label: 'Confirmou entrevista' },
  { valor: 'cancelou_entrevista', label: 'Cancelou entrevista' },
  { valor: 'solicitou_reagendamento', label: 'Solicitou reagendamento' },
  { valor: 'observacao_livre', label: 'Observação livre' },
];

function obterReferenciaProcessoSeguro(processo) {
  return obterReferenciaProcesso(processo) || String(processo?.id_processo || '').trim();
}

function limparCodigoProcessoUsuario(valor) {
  return String(valor || '').split('@@')[0].trim();
}

function obterCodigoProcessoUsuario(processo) {
  return (
    limparCodigoProcessoUsuario(processo?.id_processo) ||
    limparCodigoProcessoUsuario(obterReferenciaProcessoSeguro(processo)) ||
    '-'
  );
}

function obterTooltipProcessoUsuario(processo) {
  return [
    obterCodigoProcessoUsuario(processo),
    processo?.vaga || '',
    processo?.data_criacao ? `Criado em ${formatarDataCurta(processo.data_criacao)}` : '',
  ]
    .filter(Boolean)
    .join(' • ');
}

function obterOpcoesTextoUnicas(itens = [], campo) {
  const valores = itens
    .map((item) => String(typeof campo === 'function' ? campo(item) : item?.[campo] || '').trim())
    .filter(Boolean);
  return Array.from(new Set(valores)).sort((a, b) =>
    a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }),
  );
}

function renderizarOpcoesFiltro(opcoes = [], rotuloTodos = 'Todos') {
  return html`
    <option value="">${rotuloTodos}</option>
    ${opcoes.map((opcao) => html`<option key=${opcao} value=${opcao}>${opcao}</option>`)}
  `;
}

function obterCandidatosDoProcesso(candidatos = [], processo) {
  const referencia = obterReferenciaProcessoSeguro(processo);
  const idProcesso = String(processo?.id_processo || '').trim();
  const idRef = String(processo?.id_processo_ref || '').trim();
  return candidatos.filter((candidato) => {
    const refCandidato = obterReferenciaProcessoDoCandidato(candidato);
    return (
      (referencia && refCandidato === referencia) ||
      (idRef && refCandidato === idRef) ||
      (idProcesso && String(candidato?.id_processo || '').trim() === idProcesso)
    );
  });
}

function obterEntrevistasDoProcesso(entrevistas = [], processo) {
  const referencia = obterReferenciaProcessoSeguro(processo);
  const idProcesso = String(processo?.id_processo || '').trim();
  const idRef = String(processo?.id_processo_ref || '').trim();
  return (Array.isArray(entrevistas) ? entrevistas : []).filter((entrevista) => {
    const refEntrevista = String(
      entrevista?.id_processo_ref ||
      entrevista?.id_processo ||
      entrevista?.processo ||
      '',
    ).trim();
    return (
      (referencia && refEntrevista === referencia) ||
      (idRef && refEntrevista === idRef) ||
      (idProcesso && refEntrevista === idProcesso)
    );
  });
}

function obterStatusProcessoClasse(status) {
  const statusNormalizado = normalizarTextoComparacao(status);
  if (statusNormalizado === 'pausado') return 'is-warning';
  if (statusNormalizado === 'cancelado' || statusNormalizado === 'encerrado') return 'is-unsaved';
  return 'is-finished';
}

function calcularProgressoProcesso(processo, candidatosProcesso = []) {
  const vagas = Number(processo?.quantidade_vagas || 0);
  const preenchidas = Number(processo?.vagas_preenchidas || 0);
  if (vagas > 0) {
    return Math.max(0, Math.min(100, Math.round((preenchidas / vagas) * 100)));
  }

  const aprovados = candidatosProcesso.filter(
    (candidato) =>
      canonicalizeCandidateStatus(
        candidato.status_fluxo || candidato.status_candidato,
      ) === CANDIDATE_STATUS_APPROVED,
  ).length;
  if (!candidatosProcesso.length) return 0;
  return Math.max(0, Math.min(100, Math.round((aprovados / candidatosProcesso.length) * 100)));
}

function obterDataValor(valor) {
  if (!valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

function calcularDuracaoProcesso(processo) {
  const inicio = obterDataValor(processo?.data_criacao);
  const fim =
    obterDataValor(processo?.data_encerramento_real) ||
    obterDataValor(processo?.encerrado_em) ||
    obterDataValor(processo?.data_encerramento);
  if (!inicio || !fim) return '-';
  const dias = Math.max(0, Math.ceil((fim.getTime() - inicio.getTime()) / 86400000));
  return dias === 1 ? '1 dia' : `${dias} dias`;
}

function obterResponsavelProcesso(processo, candidato = null) {
  return String(
    processo?.responsavel ||
    processo?.usuario_responsavel ||
    processo?.recrutador ||
    processo?.criado_por ||
    candidato?.usuario_responsavel ||
    '',
  ).trim() || 'Não informado';
}

function obterUltimaMovimentacaoProcesso(processo, candidatosProcesso = [], entrevistasProcesso = []) {
  const datas = [
    processo?.atualizado_em,
    processo?.data_atualizacao,
    processo?.data_criacao,
    ...candidatosProcesso.map(
      (candidato) =>
        candidato.data_movimentacao ||
        candidato.data_atualizacao_pipeline ||
        candidato.aprovado_em ||
        candidato.eliminado_em ||
        candidato.data_prova,
    ),
    ...entrevistasProcesso.map(
      (entrevista) =>
        entrevista.atualizado_em ||
        entrevista.criado_em ||
        entrevista.data_entrevista,
    ),
  ]
    .map(obterDataValor)
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime());

  return datas[0] ? formatarDataHora(datas[0].toISOString()) : '-';
}

function normalizarNumeroWhatsAppBrasil(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (digitos.length < 10 || digitos.length > 13) return '';
  return digitos.startsWith('55') ? digitos : `55${digitos}`;
}

function montarMensagemWhatsAppProcesso(candidato, processo = {}) {
  const nome = String(candidato?.nome_candidato || candidato?.nome || '').trim() || 'candidato';
  const vaga = String(candidato?.vaga || processo?.vaga || '').trim() || 'a vaga em andamento';
  return `Olá, ${nome}. Aqui é o RH da Central 24 Horas. Estamos entrando em contato sobre o processo seletivo ${vaga}.`;
}

function obterTempoPendente(candidato) {
  const dataBase = obterDataValor(
    candidato?.data_movimentacao ||
    candidato?.data_atualizacao_pipeline ||
    candidato?.data_prova,
  );
  if (!dataBase) return '-';
  const dias = Math.max(0, Math.floor((Date.now() - dataBase.getTime()) / 86400000));
  if (dias === 0) return 'Hoje';
  return dias === 1 ? '1 dia' : `${dias} dias`;
}

function renderizarResumoProcessoAberto({ processo, candidatosProcesso, entrevistasProcesso, onDetalhes }) {
  const progresso = calcularProgressoProcesso(processo, candidatosProcesso);
  const codigo = obterCodigoProcessoUsuario(processo);
  const vagasPreenchidas = Number(processo?.vagas_preenchidas || 0);
  const totalVagas = Number(processo?.quantidade_vagas || 0);
  return html`
    <article class="process-feature-card" key=${obterChaveProcesso(processo)}>
      <div class="process-feature-main">
        <div class="process-feature-heading">
          <h3 title=${processo.vaga || codigo}>${processo.vaga || codigo}</h3>
          <span class="process-feature-code" title=${obterTooltipProcessoUsuario(processo)}>
            ${codigo}
          </span>
          <span class="process-feature-status">${processo.status || 'Aberto'}</span>
        </div>
        <div class="process-feature-meta-grid">
          <span>
            <small>Candidatos</small>
            <strong><i class="material-symbols-outlined">${IconeSvg('groups')}</i>${candidatosProcesso.length}</strong>
          </span>
          <span>
            <small>Vagas</small>
            <strong><i class="material-symbols-outlined">${IconeSvg('tag')}</i>${vagasPreenchidas}/${totalVagas}</strong>
          </span>
          <span>
            <small>Abertura</small>
            <strong><i class="material-symbols-outlined">${IconeSvg('calendar_month')}</i>${formatarDataCurta(processo.data_criacao)}</strong>
          </span>
          <span>
            <small>Operação</small>
            <strong><i class="material-symbols-outlined">${IconeSvg('business_center')}</i>${processo.operacao || '-'}</strong>
          </span>
          <span>
            <small>Responsável</small>
            <strong class="is-primary"><i class="material-symbols-outlined">${IconeSvg('person')}</i>${obterResponsavelProcesso(processo)}</strong>
          </span>
        </div>
        <div class="process-feature-progress" aria-label=${`Progresso do preenchimento ${progresso}%`}>
          <div>
            <span>Progresso do preenchimento</span>
            <strong>${progresso}%</strong>
          </div>
          <i><span style=${{ width: `${progresso}%` }}></span></i>
        </div>
      </div>
      <div class="process-feature-actions">
        <button type="button" class="process-feature-detail-btn" onClick=${() => onDetalhes(processo)}>
          Ver Detalhes
          <span class="material-symbols-outlined">${IconeSvg('arrow_forward')}</span>
        </button>
      </div>
    </article>
  `;
}

function montarRegistrosRecentesProcessosAbertos({
  processosAbertos = [],
  candidatos = [],
  entrevistas = [],
}) {
  const refsAbertas = new Set(
    processosAbertos
      .map(obterReferenciaProcessoSeguro)
      .filter(Boolean),
  );
  const eventosCandidatos = candidatos
    .filter((candidato) => refsAbertas.has(obterReferenciaProcessoDoCandidato(candidato)))
    .map((candidato) => ({
      id: `cand-${candidato.id_registro || candidato.id_teste}`,
      titulo: candidato.nome_candidato || 'Candidato',
      descricao:
        candidato.movimentacoes ||
        candidato.status_fluxo ||
        candidato.status_candidato ||
        'Movimentação de candidato',
      data:
        candidato.data_movimentacao ||
        candidato.data_atualizacao_pipeline ||
        candidato.data_prova,
      icone: 'person_search',
    }));
  const eventosEntrevistas = (Array.isArray(entrevistas) ? entrevistas : [])
    .filter((entrevista) => refsAbertas.has(String(entrevista.id_processo_ref || entrevista.id_processo || '').trim()))
    .map((entrevista) => ({
      id: `ent-${entrevista.id_entrevista || entrevista.id_slot || entrevista.data_entrevista}`,
      titulo: entrevista.nome_candidato || 'Entrevista',
      descricao: entrevista.status_entrevista || 'Entrevista registrada',
      data: entrevista.atualizado_em || entrevista.criado_em || entrevista.data_entrevista,
      icone: 'event_available',
    }));

  return [...eventosCandidatos, ...eventosEntrevistas]
    .filter((item) => item.data)
    .sort((a, b) => {
      const dataA = obterDataValor(a.data)?.getTime() || 0;
      const dataB = obterDataValor(b.data)?.getTime() || 0;
      return dataB - dataA;
    })
    .slice(0, 8);
}

async function carregarDadosProcessos({ incluirEntrevistas = false, onProcessos = null } = {}) {
  const promessaProcessos = lerProcessos().then((lista) => {
    const processos = Array.isArray(lista) ? lista : [];
    if (typeof onProcessos === 'function') onProcessos(processos);
    return processos;
  });
  const chamadas = [
    promessaProcessos,
    lerCandidatosProcessos(),
    incluirEntrevistas ? lerEntrevistas({}) : Promise.resolve(null),
  ];
  const [resultadoProcessos, resultadoCandidatos, resultadoEntrevistas] =
    await Promise.allSettled(chamadas);
  const mensagensErro = [];

  if (resultadoProcessos.status !== 'fulfilled') {
    mensagensErro.push(
      resultadoProcessos.reason?.message ||
      'Não foi possível carregar os processos seletivos.',
    );
  }
  if (resultadoCandidatos.status !== 'fulfilled') {
    mensagensErro.push(
      resultadoCandidatos.reason?.message ||
      'Não foi possível carregar os candidatos vinculados.',
    );
  }

  return {
    processos:
      resultadoProcessos.status === 'fulfilled' && Array.isArray(resultadoProcessos.value)
        ? resultadoProcessos.value
        : [],
    candidatos:
      resultadoCandidatos.status === 'fulfilled' && Array.isArray(resultadoCandidatos.value)
        ? resultadoCandidatos.value
        : [],
    entrevistas:
      resultadoEntrevistas.status === 'fulfilled' && Array.isArray(resultadoEntrevistas.value)
        ? resultadoEntrevistas.value
        : null,
    erros: mensagensErro,
  };
}

function renderizarAcoesDoCandidato({
  candidato,
  onAtualizarStatus,
  onAprovar,
  onAgendarEntrevista,
  onGerarProva,
  onEditar,
  onFicha,
  fichaCarregandoId = '',
  controlador,
}) {
  const estadoAcoes = candidato.acoes_fluxo || getCandidateActionState(candidato);
  const podeAgendar = controlador?.possuiPermissao?.('entrevistas.criar');
  const podeGerarProva = controlador?.possuiPermissao?.('provas.criar') ||
    controlador?.possuiPermissao?.('provas.enviar');
  const podeAprovar = controlador?.possuiPermissao?.('candidatos.aprovar_final');
  const podeEliminar = controlador?.possuiPermissao?.('candidatos.eliminar');
  const podeMover = controlador?.possuiPermissao?.('candidatos.mover_etapa');
  const podeEnviarBancoTalentos = podeMover || podeEliminar;
  const podeEditar = controlador?.possuiAlgumaPermissao?.(
    'candidatos.editar',
    'candidatos.editar_basico',
    'candidatos.editar_admissional',
  );
  const botoes = [];
  const acoesSecundarias = [];

  if (
    !estadoAcoes.processClosed &&
    estadoAcoes.isActive &&
    candidatoPodeGerarProva(candidato, candidato.status_processo) &&
    typeof onGerarProva === 'function' &&
    podeGerarProva
  ) {
    botoes.push(html`
      <button
        type="button"
        class="btn btn-sm rh-action-btn btn-action btn-action-ghost is-primary"
        title="Liberar prova para o candidato"
        onClick=${() => onGerarProva(candidato)}
      >
        <span class="material-symbols-outlined">${IconeSvg('assignment_add')}</span>
        Liberar prova
      </button>
    `);
  }

  if (
    !estadoAcoes.processClosed &&
    estadoAcoes.isActive &&
    typeof onAgendarEntrevista === 'function' &&
    podeAgendar
  ) {
    botoes.push(
      html`
        <button
          type="button"
          class="btn btn-sm rh-action-btn btn-action btn-action-ghost is-primary"
          title="Agendar entrevista"
          onClick=${() => onAgendarEntrevista(candidato)}
        >
          <span class="material-symbols-outlined">${IconeSvg('event')}</span>
          Entrevista
        </button>
      `,
    );
  }

  if (estadoAcoes.canApprove && podeAprovar) {
    // Rodada 2 de promt.txt: no máximo 1 botão sólido por linha — "Aprovar" é
    // sempre a ação de maior valor de decisão quando disponível, por isso é a
    // única promovida a preenchimento sólido.
    botoes.push(
      html`
        <button
          type="button"
          class="btn btn-sm rh-action-btn btn-action btn-action-solid"
          title="Aprovar candidato"
          onClick=${() =>
          typeof onAprovar === 'function'
            ? onAprovar(candidato)
            : onAtualizarStatus(candidato, 'Aprovado')}
        >
          <span class="material-symbols-outlined">${IconeSvg('check_circle')}</span>
          Aprovar
        </button>
      `,
    );
  }

  if (estadoAcoes.canEliminate && podeEliminar) {
    // "Eliminar" nunca é promovido a sólido, mesmo quando é a única ação
    // disponível — ação destrutiva não deve ser o elemento mais chamativo
    // da linha por padrão de segurança de UX.
    botoes.push(
      html`
        <button
          type="button"
          class="btn btn-sm rh-action-btn btn-action btn-action-ghost is-danger"
          title="Eliminar candidato"
          onClick=${() => onAtualizarStatus(candidato, 'Eliminado')}
        >
          <span class="material-symbols-outlined">${IconeSvg('cancel')}</span>
          Eliminar
        </button>
      `,
    );
  }

  if (typeof onFicha === 'function') {
    acoesSecundarias.push({
      label: fichaCarregandoId === String(candidato.id_teste || '') ? 'Abrindo...' : 'Detalhes',
      title: 'Abrir detalhes completos do candidato',
      icon: 'badge',
      disabled: fichaCarregandoId === String(candidato.id_teste || ''),
      onClick: () => onFicha(candidato),
    });
  }

  if (
    candidatoPodeIrParaBancoTalentos(candidato, estadoAcoes, candidato.status_processo) &&
    podeEnviarBancoTalentos
  ) {
    acoesSecundarias.push({
      label: 'Enviar para Banco de Talentos',
      icon: 'inventory_2',
      onClick: () => onAtualizarStatus(candidato, 'Banco de Talentos'),
    });
  }

  if (estadoAcoes.canEdit && typeof onEditar === 'function' && podeEditar) {
    acoesSecundarias.push({
      label: 'Editar dados',
      icon: 'edit',
      onClick: () => onEditar(candidato),
    });
  }

  if (acoesSecundarias.length) {
    // Ações de baixa frequência (Detalhes/Banco/Editar) saem da linha e vão
    // para o menu "..." já existente, em vez de competir visualmente com a
    // decisão principal (Aprovar/Eliminar).
    botoes.push(html`
      <${MenuAcoesProcesso}
        acoes=${acoesSecundarias}
        ariaLabel="Mais ações do candidato"
      />
    `);
  }

  if (!botoes.length) {
    return html`
      <span class="text-muted">
        ${estadoAcoes.processClosed
        ? 'Processo encerrado. Movimentações não são permitidas.'
        : 'Sem ações disponíveis'}
      </span>
    `;
  }

  return html`<div class="rh-action-cluster">${botoes}</div>`;
}

function PaginacaoCompacta({
  paginaAtual = 1,
  totalPaginas = 1,
  totalItens = 0,
  tamanhoPagina = 1,
  itensNaPagina = 0,
  onChange,
}) {
  const total = Number(totalItens || 0);
  if (!total || total <= Math.max(1, Number(tamanhoPagina || 1))) return null;

  const totalPaginasSeguro = Math.max(1, Number(totalPaginas || 1));
  const paginaSegura = Math.min(Math.max(1, Number(paginaAtual || 1)), totalPaginasSeguro);
  const inicio = ((paginaSegura - 1) * Math.max(1, Number(tamanhoPagina || 1))) + 1;
  const fim = Math.min(total, inicio + Math.max(0, Number(itensNaPagina || 0)) - 1);
  const podeVoltar = paginaSegura > 1;
  const podeAvancar = paginaSegura < totalPaginasSeguro;

  return html`
    <div class="c24-pagination-bar">
      <span>Mostrando ${inicio}-${fim} de ${total}</span>
      ${totalPaginasSeguro > 1
      ? html`
            <div class="c24-pagination-actions">
              <button
                type="button"
                class="btn btn-outline-secondary btn-sm"
                disabled=${!podeVoltar}
                onClick=${() => podeVoltar && onChange?.(paginaSegura - 1)}
              >
                Anterior
              </button>
              <span class="c24-pagination-current">${paginaSegura} de ${totalPaginasSeguro}</span>
              <button
                type="button"
                class="btn btn-outline-secondary btn-sm"
                disabled=${!podeAvancar}
                onClick=${() => podeAvancar && onChange?.(paginaSegura + 1)}
              >
                Próximo
              </button>
            </div>
          `
      : null}
    </div>
  `;
}

function ModalLiberarProva({
  aberto,
  candidato,
  candidatosElegiveis = [],
  processo,
  onClose,
  onLiberar,
}) {
  const configuracoes = useMemo(
    () => obterConfiguracoesProvaDoProcesso(processo),
    [processo],
  );
  const [configuracaoSelecionadaId, setConfiguracaoSelecionadaId] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [candidatoSelecionadoId, setCandidatoSelecionadoId] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const opcoesCandidatos = useMemo(() => {
    const mapa = new Map();
    [candidato, ...(Array.isArray(candidatosElegiveis) ? candidatosElegiveis : [])]
      .filter(Boolean)
      .forEach((item) => {
        const chave = obterChaveCandidatoLiberacao(item);
        if (chave && !mapa.has(chave)) mapa.set(chave, item);
      });
    return Array.from(mapa.entries()).map(([id, item]) => ({ id, item }));
  }, [candidato, candidatosElegiveis]);

  useEffect(() => {
    if (!aberto) return;
    const candidatoInicial = opcoesCandidatos[0]?.item || candidato || null;
    setConfiguracaoSelecionadaId(configuracoes[0]?.id_configuracao || '');
    setCandidatoSelecionadoId(obterChaveCandidatoLiberacao(candidatoInicial));
    setEmail(candidatoInicial?.email || '');
    setTelefone(candidatoInicial?.telefone || candidatoInicial?.whatsapp || '');
    setErro('');
    setResultado(null);
    setSalvando(false);
  }, [aberto, candidato, configuracoes.length, opcoesCandidatos.length]);

  if (!aberto) return null;

  const configuracao = configuracoes.find(
    (item) => item.id_configuracao === configuracaoSelecionadaId,
  ) || configuracoes[0];
  const candidatoAtual =
    opcoesCandidatos.find((item) => item.id === candidatoSelecionadoId)?.item ||
    candidato ||
    {};
  const nome = candidatoAtual?.nome_candidato || candidatoAtual?.nome || '';
  const questoes = Array.isArray(configuracao?.questoes_snapshot)
    ? configuracao.questoes_snapshot
    : [];

  const selecionarCandidato = (event) => {
    const id = event.target.value;
    const selecionado = opcoesCandidatos.find((item) => item.id === id)?.item || {};
    setCandidatoSelecionadoId(id);
    setEmail(selecionado.email || '');
    setTelefone(selecionado.telefone || selecionado.whatsapp || '');
    setErro('');
  };

  const confirmar = async () => {
    if (!configuracao) {
      setErro('Este processo ainda não possui prova configurada.');
      return;
    }
    if (!questoes.length) {
      setErro('A prova configurada para este processo não possui questões válidas.');
      return;
    }
    const mensagemContato = validarContatoLiberacaoProva({ nome, email, telefone });
    if (mensagemContato) {
      setErro(mensagemContato);
      return;
    }

    setSalvando(true);
    setErro('');
    try {
      const payload = montarPayloadLiberacaoProva({
        candidato: candidatoAtual,
        processo,
        configuracao,
        email,
        telefone,
      });
      const resposta = await onLiberar(payload);
      setResultado(resposta);
    } catch (error) {
      setErro(error?.message || 'Não foi possível liberar a prova para o candidato.');
    } finally {
      setSalvando(false);
    }
  };

  return html`
    <${ModalPadrao}
      aberto=${aberto}
      titulo=${`Liberar prova | ${nome || 'Candidato'}`}
      subtitulo="Selecione uma prova já configurada neste processo e confirme a liberação ao candidato."
      className="process-release-exam-dialog"
      onClose=${onClose}
    >
      <div class="rh-details-body process-release-exam-body">
        ${!configuracoes.length
      ? html`
              <div class="process-release-empty">
                <span class="material-symbols-outlined">${IconeSvg('assignment_late')}</span>
                <h3>Nenhuma prova configurada para este processo</h3>
                <p>Configure a prova no fluxo de criação do processo seletivo antes de liberar para candidatos.</p>
              </div>
            `
      : html`
              <div class="process-release-grid">
                <section class="process-release-card">
                  <h3>Prova do processo</h3>
                  <label class="process-release-field">
                    <span>Configuração disponível</span>
                    <select
                      value=${configuracaoSelecionadaId}
                      disabled=${salvando || !!resultado}
                      onChange=${(event) => setConfiguracaoSelecionadaId(event.target.value)}
                    >
                      ${configuracoes.map(
        (item) => html`
                          <option key=${item.id_configuracao} value=${item.id_configuracao}>
                            ${item.nome}
                          </option>
                        `,
      )}
                    </select>
                  </label>
                  <div class="process-release-metrics">
                    ${[
          ['Vaga', configuracao?.vaga || processo?.vaga || '-'],
          ['Área', configuracao?.area_prova || configuracao?.area || processo?.trilha || '-'],
          ['Nível', configuracao?.nivel || '-'],
          ['Tempo', `${configuracao?.tempo_total || configuracao?.tempo_minutos || 40} min`],
          ['Questões', questoes.length || configuracao?.quantidade_questoes || '-'],
          ['Personalização', configuracao?.personalizacao?.enabled ? 'Ativada' : 'Padrão'],
        ].map(
          ([label, value]) => html`
                        <span key=${label}>
                          <strong>${label}</strong>
                          ${value}
                        </span>
                      `,
        )}
                  </div>
                </section>

                <section class="process-release-card">
                  <h3>Candidato e acesso</h3>
                  ${opcoesCandidatos.length > 1
          ? html`
                        <label class="process-release-field">
                          <span>Selecionar candidato</span>
                          <select
                            value=${candidatoSelecionadoId}
                            disabled=${salvando || !!resultado}
                            onChange=${selecionarCandidato}
                          >
                            ${opcoesCandidatos.map(
            ({ id, item }) => html`
                                <option key=${id} value=${id}>
                                  ${item.nome_candidato || item.nome || item.email || id}
                                </option>
                              `,
          )}
                          </select>
                        </label>
                      `
          : null}
                  <label class="process-release-field">
                    <span>Candidato</span>
                    <input readonly value=${nome || '-'} />
                  </label>
                  <label class="process-release-field">
                    <span>E-mail de acesso</span>
                    <input
                      value=${email}
                      disabled=${salvando || !!resultado}
                      onInput=${(event) => setEmail(event.target.value)}
                    />
                  </label>
                  <label class="process-release-field">
                    <span>Telefone de acesso</span>
                    <input
                      value=${telefone}
                      disabled=${salvando || !!resultado}
                      onInput=${(event) => setTelefone(event.target.value)}
                    />
                  </label>
                </section>
              </div>
            `}

        ${erro ? html`<div class="alert alert-danger">${erro}</div>` : null}
        ${resultado
      ? html`
              <div class="alert alert-success process-release-success">
                Prova liberada com sucesso. Código de acesso:
                <strong>${resultado.codigo_acesso || '-'}</strong>
              </div>
            `
      : null}
      </div>
      <footer class="rh-modal-footer">
        <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${onClose}>
          Fechar
        </button>
        <button
          type="button"
          class="btn btn-primary"
          disabled=${salvando || !!resultado || !configuracoes.length}
          onClick=${confirmar}
        >
          ${salvando ? 'Liberando...' : 'Confirmar liberação'}
        </button>
      </footer>
    </${ModalPadrao}>
  `;
}

function renderizarAcoesCompactasDoCandidato({
  candidato,
  onAtualizarStatus,
  onAprovar,
  onAgendarEntrevista,
  onGerarProva,
  onFicha,
  onDetalheProva,
  onCurriculo,
  onEnviarBancoTalentos,
  fichaCarregandoId = '',
  carregandoDetalhe = false,
  temProvaSalva = false,
  podeBaixarCv = false,
  controlador,
}) {
  const estadoAcoes = candidato.acoes_fluxo || getCandidateActionState(candidato);
  const podeAgendar = controlador?.possuiPermissao?.('entrevistas.criar');
  const podeGerarProva = controlador?.possuiPermissao?.('provas.criar') ||
    controlador?.possuiPermissao?.('provas.enviar');
  const podeAprovar = controlador?.possuiPermissao?.('candidatos.aprovar_final');
  const podeEliminar = controlador?.possuiPermissao?.('candidatos.eliminar');
  const podeMover = controlador?.possuiPermissao?.('candidatos.mover_etapa');
  const podeEnviarBancoTalentos = podeMover || podeEliminar;
  const statusProva = normalizarTextoComparacao(
    candidato?.status_prova_gerada || candidato?.status_prova || '',
  );
  const statusProvaIndicaRegistro = Boolean(
    statusProva &&
    ![
      'sem prova',
      'prova nao criada',
      'prova não criada',
      'nao criada',
      'não criada',
      'nao gerada',
      'não gerada',
    ].some((termo) => statusProva.includes(termo)),
  );
  const provaJaCriadaOuConcluida = Boolean(
    temProvaSalva ||
    candidato?.tem_prova_gerada ||
    candidato?.prova_disponivel ||
    candidato?.id_prova_gerada ||
    statusProvaIndicaRegistro,
  );
  const acoes = [];

  if (
    !estadoAcoes.processClosed &&
    estadoAcoes.isActive &&
    !provaJaCriadaOuConcluida &&
    candidatoPodeGerarProva(candidato, candidato.status_processo) &&
    typeof onGerarProva === 'function' &&
    podeGerarProva
  ) {
    acoes.push({
      valor: 'gerar-prova',
      label: 'Liberar prova',
      executar: () => onGerarProva(candidato),
    });
  }

  if (
    !estadoAcoes.processClosed &&
    estadoAcoes.isActive &&
    typeof onAgendarEntrevista === 'function' &&
    podeAgendar
  ) {
    acoes.push({
      valor: 'entrevista',
      label: 'Entrevista',
      executar: () => onAgendarEntrevista(candidato),
    });
  }

  if (temProvaSalva && typeof onDetalheProva === 'function') {
    acoes.push({
      valor: 'resultado',
      label: 'Resultado',
      disabled: carregandoDetalhe,
      executar: () => onDetalheProva(candidato),
    });
  }

  if (typeof onFicha === 'function') {
    acoes.push({
      valor: 'detalhes',
      label: fichaCarregandoId === String(candidato.id_teste || '') ? 'Abrindo...' : 'Detalhes',
      disabled: fichaCarregandoId === String(candidato.id_teste || ''),
      executar: () => onFicha(candidato),
    });
  }

  if (podeBaixarCv && typeof onCurriculo === 'function') {
    acoes.push({
      valor: 'ver-cv',
      label: 'Ver CV',
      executar: () => onCurriculo(candidato),
    });
  }

  if (estadoAcoes.canApprove && podeAprovar) {
    acoes.push({
      valor: 'aprovar',
      label: 'Aprovar candidato',
      executar: () =>
        typeof onAprovar === 'function'
          ? onAprovar(candidato)
          : onAtualizarStatus(candidato, 'Aprovado'),
    });
  }

  if (
    candidatoPodeIrParaBancoTalentos(candidato, estadoAcoes, candidato.status_processo) &&
    podeEnviarBancoTalentos
  ) {
    acoes.push({
      valor: 'banco-talentos',
      label: 'Enviar para Banco de Talentos',
      executar: () =>
        typeof onEnviarBancoTalentos === 'function'
          ? onEnviarBancoTalentos(candidato)
          : onAtualizarStatus(candidato, 'Banco de Talentos'),
    });
  }

  if (candidatoPodeSerEliminadoNoProcesso(candidato, estadoAcoes) && podeEliminar) {
    acoes.push({
      valor: 'eliminar',
      label: 'Eliminar candidato',
      danger: true,
      executar: () => onAtualizarStatus(candidato, 'Eliminado'),
    });
  }

  if (!acoes.length) {
    return html`
      <span class="text-muted">
        ${estadoAcoes.processClosed
        ? 'Processo encerrado. Movimentações não são permitidas.'
        : 'Sem ações disponíveis'}
      </span>
    `;
  }

  const executarAcao = (event) => {
    const valor = event.currentTarget.value;
    event.currentTarget.value = '';
    const acao = acoes.find((item) => item.valor === valor);
    if (!acao || acao.disabled) return;
    acao.executar?.();
  };

  return html`
    <label class="candidate-action-select-field">
      <span class="visually-hidden">Selecionar ação para ${candidato.nome_candidato || 'candidato'}</span>
      <select
        class="form-select form-select-sm candidate-action-select"
        value=""
        onChange=${executarAcao}
      >
        <option value="">Selecionar ação</option>
        ${acoes.map((acao) => html`
          <option
            key=${acao.valor}
            value=${acao.valor}
            disabled=${!!acao.disabled}
          >
            ${acao.label}
          </option>
        `)}
      </select>
    </label>
  `;
}

function obterEntrevistasConfirmadas(entrevistas = []) {
  return entrevistas.filter(
    (entrevista) =>
      canonicalizeCandidateStatus(entrevista?.status_entrevista) === CANDIDATE_STATUS_CONFIRMED,
  );
}

function PainelIndicacaoUso({
  formulario,
  salvando = false,
  onChange,
  onConfirmar,
  onCancelar,
}) {
  return html`
    <div class="process-indication-panel">
      <label class="process-indication-check">
        <input
          type="checkbox"
          checked=${!!formulario?.eh_indicacao}
          disabled=${salvando}
          onChange=${(event) =>
      onChange({
        eh_indicacao: !!event.target.checked,
        tipo_indicacao: event.target.checked
          ? formulario?.tipo_indicacao || ''
          : '',
      })}
        />
        <span class="process-cv-toggle-box" aria-hidden="true"></span>
        <span>É indicação?</span>
      </label>
      ${formulario?.eh_indicacao
      ? html`
            <select
              class="form-select form-select-sm process-indication-select"
              value=${formulario.tipo_indicacao || ''}
              disabled=${salvando}
              onChange=${(event) =>
          onChange({
            ...formulario,
            tipo_indicacao: event.target.value,
          })}
            >
              <option value="">Tipo de indicação</option>
              ${TIPOS_INDICACAO_PROCESSO.map(
            (opcao) => html`<option key=${opcao} value=${opcao}>${opcao}</option>`,
          )}
            </select>
          `
      : null}
      <button
        type="button"
        class="btn btn-sm btn-primary process-indication-confirm"
        disabled=${salvando}
        onClick=${onConfirmar}
      >
        Confirmar
      </button>
      <button
        type="button"
        class="btn btn-sm btn-outline-secondary process-indication-cancel"
        disabled=${salvando}
        onClick=${onCancelar}
      >
        Cancelar
      </button>
    </div>
  `;
}

function ModalFichaCandidato({
  ficha,
  formulario,
  salvando,
  erro,
  mensagem,
  onClose,
  onChange,
  onSave,
  onPrint,
  onAbrirCurriculo,
  arquivoCv,
  enviandoCv = false,
  analisandoCv = false,
  onArquivoCvChange,
  onAdicionarCv,
  onAnalisarCv,
  onEditar,
  onEliminar,
  onBanco,
  onAprovar,
  onNotaCompleta,
}) {
  if (!ficha) return null;

  const candidato = ficha.candidato || {};
  const curriculo = candidato.curriculo || {};
  const processos = Array.isArray(ficha.processos) ? ficha.processos : [];
  const resultados = resultadosFichaVisiveis(ficha.resultados);
  const timeline = Array.isArray(ficha.timeline) ? ficha.timeline : [];
  const processoPrincipal = processos[0] || {};
  const resultadosProva = resultados.filter((item) => {
    const etapa = normalizarTextoComparacao(item?.etapa || '');
    return !resultadoFichaEhCurriculo(item) && !etapa.includes('entrevista');
  });
  const numeroNota = (valor) => {
    if (valor === null || valor === undefined || valor === '') return null;
    const primeiro = String(valor).replace(',', '.').match(/-?\d+(?:\.\d+)?/)?.[0];
    const numero = Number(primeiro);
    return Number.isFinite(numero) ? numero : null;
  };
  const normalizarNotaDez = (valor) => {
    const numero = numeroNota(valor);
    if (numero === null) return null;
    const texto = String(valor || '');
    const maximo = Number(texto.replace(',', '.').match(/\/\s*(\d+(?:\.\d+)?)/)?.[1]);
    if (Number.isFinite(maximo) && maximo > 0) return Math.min(10, (numero / maximo) * 10);
    return numero > 10 ? Math.min(10, numero / 10) : Math.min(10, numero);
  };
  const notaCv = normalizarNotaDez(candidato.nota_curriculo);
  const notasProva = resultadosProva
    .map((item) => normalizarNotaDez(item.pontuacao))
    .filter((item) => item !== null);
  const notaProvas = notasProva.length
    ? notasProva.reduce((total, item) => total + item, 0) / notasProva.length
    : null;
  const notasGerais = [notaCv, notaProvas].filter((item) => item !== null);
  const notaGeral = notasGerais.length
    ? notasGerais.reduce((total, item) => total + item, 0) / notasGerais.length
    : null;
  const aderencia = numeroNota(candidato.aderencia_percentual);
  const aderenciaLabel = aderencia === null ? 'Não informado' : `${Math.round(aderencia)}%`;
  const classificacao = aderencia === null
    ? candidato.status_curriculo || curriculo.status || 'Não informado'
    : aderencia >= 75
      ? 'Alta aderência'
      : aderencia >= 50
        ? 'Média aderência'
        : 'Baixa aderência';
  const classeAderencia = aderencia === null ? 'is-neutral' : aderencia >= 75 ? 'is-high' : aderencia >= 50 ? 'is-medium' : 'is-low';
  const qualidades = Array.isArray(candidato.qualidades_cv) ? candidato.qualidades_cv.filter(Boolean) : [];
  const skills = Array.isArray(candidato.skills) ? candidato.skills.filter(Boolean) : [];
  const endereco = [candidato.endereco, candidato.numero].filter(Boolean).join(', ');
  const localidade = [candidato.bairro, candidato.cidade, candidato.cep].filter(Boolean).join(' · ');
  const socialItems = [
    ['linkedin', candidato.linkedin],
    ['photo_camera', candidato.instagram],
    ['language', candidato.portfolio],
  ].filter(([, link]) => link);
  const formatarNota = (valor) => valor === null ? '–' : valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return html`
    <${ModalPadrao}
      aberto=${true}
      titulo="Ficha do candidato"
      subtitulo="Informações consolidadas do processo seletivo."
      className="candidate-sheet-dialog candidate-sheet-dialog--profile"
      onClose=${onClose}
    >
      <div class="candidate-profile-page">
        <button type="button" class="candidate-profile-back" onClick=${onClose}>
          <span class="material-symbols-outlined">${IconeSvg('arrow_back')}</span>Voltar
        </button>
        ${erro
      ? html`<div class="alert alert-danger py-2">${erro}</div>`
      : null}
        ${mensagem
      ? html`<div class="alert alert-success py-2">${mensagem}</div>`
      : null}
        <div class="candidate-profile-layout">
          <aside class="candidate-profile-sidebar">
            <section class="candidate-profile-identity">
              <span class="candidate-profile-avatar material-symbols-outlined">${IconeSvg('person')}</span>
              <h2>${candidato.nome_candidato || 'Candidato'}</h2>
              <small>Processo seletivo</small>
              <strong>${processoPrincipal.vaga || 'Não informado'}</strong>
            </section>
            <section class="candidate-profile-side-card">
              <h3>Informações gerais</h3>
              <dl><dt>Endereço</dt><dd>${endereco || 'Não informado'}</dd><dd>${localidade || '–'}</dd><dt>Data de nascimento</dt><dd>${formatarDataNascimento(candidato.data_nascimento) || 'Não informado'}</dd><dt>Idade</dt><dd>${candidato.idade ? `${candidato.idade} anos` : 'Não informado'}</dd><dt>Escolaridade</dt><dd>${candidato.escolaridade || 'Não informado'}</dd></dl>
            </section>
            <section class="candidate-profile-side-card">
              <h3>Informações de contato</h3>
              <dl><dt>Email</dt><dd>${candidato.email || 'Não informado'}</dd><dt>Telefone</dt><dd>${candidato.telefone || 'Não informado'}</dd><dt>WhatsApp</dt><dd>${candidato.whatsapp || 'Não informado'}</dd></dl>
            </section>
            <section class="candidate-profile-side-card">
              <h3>Redes sociais</h3>
              ${socialItems.length ? html`<div class="candidate-profile-socials">${socialItems.map(([icon, link]) => html`<a href=${link} target="_blank" rel="noreferrer"><span class="material-symbols-outlined">${IconeSvg(icon)}</span></a>`)}</div>` : html`<p class="candidate-profile-uninformed">Não informado</p>`}
            </section>
          </aside>

          <main class="candidate-profile-main">
            <section class="candidate-complementary-card">
              <h2>Informações complementares</h2>
              <div class="candidate-info-row"><span>Nome da vaga</span><strong>${processoPrincipal.vaga || 'Não informado'}</strong></div>
              <div class="candidate-info-row"><span>Nota geral / Aderência</span><div class="candidate-score-composite"><b>${formatarNota(notaGeral)}</b><i>/</i><strong>${aderenciaLabel}</strong><small>de aderência à vaga</small></div></div>
              <div class="candidate-info-row"><span>Tag de qualificação</span><em class=${`candidate-fit-label ${classeAderencia}`}>${classificacao}</em></div>
              <div class="candidate-info-row"><span>Nota do CV</span><b class="candidate-score-badge is-blue">${formatarNota(notaCv)}</b></div>
              <div class="candidate-info-row"><span>Nota das provas</span><div class="candidate-proof-score"><b class="candidate-score-badge is-blue">${formatarNota(notaProvas)}</b>${resultadosProva.length ? html`<button type="button" onClick=${onNotaCompleta}>Ver nota completa <span class="material-symbols-outlined">${IconeSvg('chevron_right')}</span></button>` : html`<small>Candidato sem prova</small>`}</div></div>
              <div class="candidate-info-row candidate-info-row--list"><span>Qualidades analisadas do CV</span>${qualidades.length ? html`<ul>${qualidades.map((item) => html`<li key=${item}>${item}</li>`)}</ul>` : html`<strong>Não informado</strong>`}</div>
              <div class="candidate-info-row candidate-info-row--skills"><span>Skills</span>${skills.length ? html`<div>${skills.map((item) => html`<em key=${item}>${item}</em>`)}</div>` : html`<strong>Não informado</strong>`}</div>
              <div class="candidate-cv-inline-actions">
            ${curriculo.disponivel
      ? html`
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-secondary rh-action-btn"
                    disabled=${enviandoCv || analisandoCv}
                    onClick=${() =>
          onAbrirCurriculo({
            id_teste: candidato.id_teste || candidato.id,
            cv_disponivel: curriculo.disponivel,
          })}
                  >
                    <span class="material-symbols-outlined">${IconeSvg('description')}</span>
                    Ver CV
                  </button>
                `
      : html`
                  <label class="process-cv-picker candidate-cv-picker">
                    <input
                      key=${arquivoCv?.name || 'cv-ficha-processo-vazio'}
                      type="file"
                      class="process-cv-native-input"
                      accept=".pdf,.doc,.docx"
                      disabled=${enviandoCv || analisandoCv}
                      onChange=${(event) =>
          onArquivoCvChange(event.target.files?.[0] || null)}
                    />
                    <span class="material-symbols-outlined">${IconeSvg('upload_file')}</span>
                    <span class="process-cv-picker-copy">
                      <strong>Adicionar CV</strong>
                      <small title=${arquivoCv?.name || ''}>
                        ${arquivoCv?.name || 'Nenhum arquivo selecionado'}
                      </small>
                    </span>
                  </label>
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-primary rh-action-btn"
                    disabled=${!arquivoCv || enviandoCv || analisandoCv}
                    onClick=${onAdicionarCv}
                  >
                    <span class="material-symbols-outlined">${IconeSvg('upload')}</span>
                    ${enviandoCv ? 'Adicionando...' : 'Adicionar CV'}
                  </button>
                `}
            <button
              type="button"
              class="btn btn-sm btn-primary rh-action-btn"
              disabled=${analisandoCv || enviandoCv || (!curriculo.disponivel && !arquivoCv)}
              onClick=${onAnalisarCv}
            >
              <span class="material-symbols-outlined">${IconeSvg('auto_awesome')}</span>
              ${analisandoCv ? 'Analisando...' : 'Analisar CV'}
            </button>
              </div>
            </section>

            <section class="candidate-complementary-card candidate-timeline-card">
              <h2>Linha do tempo</h2>
              ${timeline.length
      ? html`
                    <div class="process-history-list">
                      ${timeline.map((evento, indice) => html`
                        <article key=${`${evento.tipo || 'evento'}-${indice}`}>
                          <span class="process-history-icon"><i class="material-symbols-outlined">${IconeSvg(evento.icone || 'circle')}</i></span>
                          <div>
                            <strong>${evento.titulo || 'Evento'}</strong>
                            <p>${evento.descricao || ''}</p>
                            <small>${formatarDataHora(evento.data)}</small>
                          </div>
                        </article>
                      `)}
                    </div>
                  `
      : html`<p class="candidate-profile-uninformed">Nenhum evento registrado até o momento.</p>`}
            </section>

            <section class="candidate-rh-notes-card">
              <div><h2>Observações do RH</h2><span class=${`candidate-rh-current-status ${formulario.classificacao ? 'is-defined' : ''}`}>${formulario.classificacao || 'Não definido'}</span></div>
              <textarea rows="4" placeholder="Registre observações sobre o candidato" value=${formulario.observacao_rh} onInput=${(event) => onChange('observacao_rh', event.target.value)}></textarea>
              <div class="candidate-rh-review-grid">
                ${CLASSIFICACOES_FICHA_CANDIDATO.map((opcao) => html`<label key=${opcao} class=${formulario.classificacao === opcao ? 'is-selected' : ''}><input type="radio" name="candidate-sheet-recommendation" checked=${formulario.classificacao === opcao} onChange=${() => onChange('classificacao', opcao)} />${opcao}</label>`)}
              </div>
              <textarea rows="2" placeholder="Justificativa do parecer" value=${formulario.justificativa} onInput=${(event) => onChange('justificativa', event.target.value)}></textarea>
              <footer><small>${candidato.ultima_atualizacao ? `Última atualização em ${formatarDataHora(candidato.ultima_atualizacao)}` : 'Última atualização não informada'}</small><button type="button" class="btn btn-sm btn-primary" disabled=${salvando} onClick=${onSave}>${salvando ? 'Salvando...' : 'Salvar observações'}</button></footer>
            </section>

            <footer class="candidate-profile-actions">
              <${MenuAcoesProcesso}
                label="Ações"
                icon="expand_more"
                ariaLabel="Ações da ficha do candidato"
                triggerClassName="btn btn-primary process-actions-trigger"
                acoes=${[
      { label: 'Aprovar', icon: 'check', onClick: onAprovar },
      { label: 'Editar candidato', icon: 'edit', onClick: onEditar },
      curriculo.disponivel
        ? {
          label: 'Ver currículo',
          icon: 'description',
          onClick: () =>
            onAbrirCurriculo({
              id_teste: candidato.id_teste || candidato.id,
              cv_disponivel: curriculo.disponivel,
            }),
        }
        : null,
      { label: 'Baixar ficha', icon: 'download', onClick: onPrint },
      typeof onBanco === 'function' ? { label: 'Enviar para banco de talentos', icon: 'inventory_2', onClick: onBanco } : null,
      { label: 'Eliminar', icon: 'delete', danger: true, onClick: onEliminar },
    ].filter(Boolean)}
              />
            </footer>
          </main>
        </div>
      </div>
    </${ModalPadrao}>
  `;
}

function ModalRegistroWhatsapp({
  candidato,
  formulario,
  salvando = false,
  erro = '',
  onClose,
  onChange,
  onSave,
}) {
  if (!candidato) return null;

  return html`
    <${ModalPadrao}
      aberto=${!!candidato}
      titulo="Registrar contato WhatsApp"
      subtitulo="Registro manual de contato. Esta ação não altera automaticamente o status do candidato."
      onClose=${onClose}
    >
      <div class="rh-details-body">
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label">Candidato</label>
            <input
              class="form-control"
              readonly
              value=${candidato.nome_candidato || candidato.nome || ''}
            />
          </div>
          <div class="col-md-6">
            <label class="form-label">Evento</label>
            <select
              class="form-select"
              value=${formulario.tipo_contato}
              onChange=${(event) => onChange('tipo_contato', event.target.value)}
            >
              ${TIPOS_CONTATO_WHATSAPP.map(
    (tipo) => html`
                  <option key=${tipo.valor} value=${tipo.valor}>
                    ${tipo.label}
                  </option>
                `,
  )}
            </select>
          </div>
          <div class="col-12">
            <label class="form-label">Mensagem pré-formatada</label>
            <textarea
              class="form-control"
              rows="4"
              readonly
              value=${formulario.mensagem}
            ></textarea>
          </div>
          <div class="col-12">
            <label class="form-label">Observação livre</label>
            <textarea
              class="form-control"
              rows="4"
              placeholder="Registre retorno do candidato, contexto ou próximo passo."
              value=${formulario.observacao}
              onInput=${(event) => onChange('observacao', event.target.value)}
            ></textarea>
          </div>
        </div>
        ${erro ? html`<div class="alert alert-danger mt-3 mb-0">${erro}</div>` : null}
      </div>
      <footer class="rh-modal-footer">
        <button
          type="button"
          class="btn btn-outline-secondary"
          disabled=${salvando}
          onClick=${onClose}
        >
          Cancelar
        </button>
        <button
          type="button"
          class="btn btn-primary"
          disabled=${salvando}
          onClick=${onSave}
        >
          ${salvando ? 'Registrando...' : 'Registrar contato'}
        </button>
      </footer>
    </${ModalPadrao}>
  `;
}

function SecaoDetalheExpansivel({
  aberto,
  titulo,
  description,
  className = '',
  tourId = '',
  onToggle,
  children,
}) {
  return html`
    <${SectionCard} className=${className} tourId=${tourId}>
      <div class="rh-section-card-header">
        <div>
          <${CabecalhoSecaoColapsavel}
            aberto=${aberto}
            titulo=${titulo}
            onClick=${onToggle}
          />
          ${description
      ? html`<p class="rh-section-card-description">${description}</p>`
      : null}
        </div>
      </div>
      ${aberto ? html`<div class="mt-3">${children}</div>` : null}
    </${SectionCard}>
  `;
}

function obterResponsavelEntrevistaProcesso(entrevista) {
  return String(
    entrevista?.responsavel ||
    entrevista?.responsavel_rh ||
    entrevista?.entrevistador ||
    entrevista?.usuario_responsavel ||
    entrevista?.criado_por ||
    '',
  ).trim();
}

function WidgetEntrevistasProcesso({
  entrevistas = [],
  carregando = false,
  onAbrirAgenda,
  onEditar,
}) {
  const [paginaEntrevistas, setPaginaEntrevistas] = useState(1);
  const entrevistasOrdenadas = useMemo(
    () =>
      [...(Array.isArray(entrevistas) ? entrevistas : [])].sort((a, b) => {
        const dataA = new Date(a?.data_entrevista || a?.criado_em || '').getTime() || 0;
        const dataB = new Date(b?.data_entrevista || b?.criado_em || '').getTime() || 0;
        return dataB - dataA;
      }),
    [entrevistas],
  );
  const entrevistasPaginadas = useMemo(
    () =>
      obterItensPaginados(
        entrevistasOrdenadas,
        paginaEntrevistas,
        TAMANHO_PAGINA_ENTREVISTAS_PROCESSO,
      ),
    [entrevistasOrdenadas, paginaEntrevistas],
  );

  useEffect(() => {
    setPaginaEntrevistas(1);
  }, [entrevistasOrdenadas.length]);

  return html`
    <${SectionCard}
      title="Entrevistas registradas"
      description=""
      className="process-interview-widget compact-dashboard-card"
      tourId="process-interviews"
      actions=${html`
        <button
          type="button"
          class="btn btn-outline-secondary btn-sm"
          onClick=${onAbrirAgenda}
        >
          Ver agenda completa
        </button>
          `}
    >
      ${carregando
      ? html`
            <${LoadingState}
              titulo="Carregando entrevistas"
              descricao="Sincronizando agenda e status do candidato."
            />
          `
      : entrevistasOrdenadas.length
        ? html`
              <div
                class=${`process-interview-table-shell ${entrevistasPaginadas.totalItens > TAMANHO_PAGINA_ENTREVISTAS_PROCESSO
            ? 'is-paginated'
            : ''
            }`.trim()}
              >
                <table class="table table-sm process-interviews-table mb-0">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Dia</th>
                      <th>Hora</th>
                      <th class="text-end">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                ${entrevistasPaginadas.itens.map(
              (entrevista) => html`
                    <tr key=${entrevista.id_entrevista}>
                      <td class="process-interview-name-cell">
                        <span class="process-interview-owner" title=${entrevista.nome_candidato || '-'}>
                          ${entrevista.nome_candidato || '-'}
                        </span>
                        ${entrevista.status_entrevista
                  ? html`
                              <span
                                class=${`rh-status-pill process-interview-status ${obterClasseStatusEntrevista(entrevista.status_entrevista)}`}
                                title=${`Status: ${entrevista.status_entrevista}`}
                              >
                                ${entrevista.status_entrevista}
                              </span>
                            `
                  : null}
                      </td>
                      <td>${formatarDataCurta(entrevista.data_entrevista)}</td>
                      <td>${formatarHoraCurta(entrevista.data_entrevista)}</td>
                      <td class="text-end">
                        <button
                          type="button"
                          class="btn btn-sm btn-outline-primary process-interview-edit-btn"
                          disabled=${isProcessClosed(entrevista.status_processo)}
                          title=${isProcessClosed(entrevista.status_processo) ? 'Processo encerrado' : 'Editar entrevista'}
                          onClick=${() => onEditar(entrevista)}
                        >
                          <span class="material-symbols-outlined">${IconeSvg('edit')}</span>
                          Editar
                        </button>
                      </td>
                    </tr>
                  `,
            )}
                  </tbody>
                </table>
              </div>
              <${PaginacaoCompacta}
                paginaAtual=${entrevistasPaginadas.paginaAtual}
                totalPaginas=${entrevistasPaginadas.totalPaginas}
                totalItens=${entrevistasPaginadas.totalItens}
                tamanhoPagina=${TAMANHO_PAGINA_ENTREVISTAS_PROCESSO}
                itensNaPagina=${entrevistasPaginadas.itens.length}
                onChange=${setPaginaEntrevistas}
              />
            `
        : html`
              <div class="c24-empty-state c24-empty-state-horizontal">
                <span class="material-symbols-outlined">${IconeSvg('calendar_month')}</span>
                <div>
                  <h3>Nenhuma entrevista registrada</h3>
                </div>
              </div>
            `}
    </${SectionCard}>
  `;
}

function DossieProcesso({
  processo,
  candidatos = [],
  candidatosFiltrados = [],
  estatisticas,
  filtros,
  onFiltroChange,
  onLimparFiltros,
  analise,
  anotacoes = [],
  formularioAnotacao,
  anotacaoEditandoId,
  salvandoAnotacao,
  erro,
  mensagem,
  onChangeAnotacao,
  onSelecionarCandidatoAnotacao,
  onSalvarAnotacao,
  onEditarAnotacao,
  onCancelarEdicao,
}) {
  const opcoesEtapa = Array.from(
    new Set(candidatos.map((item) => item.etapa).filter(Boolean)),
  );
  const opcoesClassificacao = Array.from(
    new Set(candidatos.map((item) => item.classificacao).filter(Boolean)),
  );
  const opcoesStatus = Array.from(
    new Set(candidatos.map((item) => item.status).filter(Boolean)),
  );
  const candidatosGrafico = candidatosFiltrados
    .filter(
      (item) =>
        item.notaProva !== null ||
        item.scoreCv !== null ||
        item.mediaGeral !== null,
    )
    .slice()
    .sort((a, b) => Number(b.mediaGeral || 0) - Number(a.mediaGeral || 0))
    .slice(0, 8);
  const largura = (valor) =>
    `${Math.max(4, Math.min(100, Number(valor || 0) * 10))}%`;

  return html`
    <div class="process-dossier-shell">
      ${erro ? html`<div class="alert alert-warning py-2">${erro}</div>` : null}
      ${mensagem ? html`<div class="alert alert-success py-2">${mensagem}</div>` : null}

      <${MetricGrid}
        items=${[
      { label: 'Candidatos avaliados', value: estatisticas?.avaliados || 0 },
      { label: 'Média da prova', value: formatarNumeroDossie(estatisticas?.mediaProva) },
      { label: 'Média do currículo', value: formatarNumeroDossie(estatisticas?.mediaCv) },
      { label: 'Média geral', value: formatarNumeroDossie(estatisticas?.mediaGeral) },
    ]}
      />

      <div class="process-dossier-filter-grid">
        <label>
          <span>Processo</span>
          <input
            class="form-control"
            value=${filtros.processo}
            placeholder=${processo?.id_processo || 'Filtrar processo'}
            onInput=${(event) => onFiltroChange('processo', event.target.value)}
          />
        </label>
        <label>
          <span>Candidato</span>
          <input
            class="form-control"
            value=${filtros.candidato}
            placeholder="Nome, e-mail ou WhatsApp"
            onInput=${(event) => onFiltroChange('candidato', event.target.value)}
          />
        </label>
        <label>
          <span>Data/dia</span>
          <input
            class="form-control"
            type="date"
            value=${filtros.data}
            onInput=${(event) => onFiltroChange('data', event.target.value)}
          />
        </label>
        <label>
          <span>Etapa</span>
          <select
            class="form-select"
            value=${filtros.etapa}
            onChange=${(event) => onFiltroChange('etapa', event.target.value)}
          >
            <option value="">Todas</option>
            ${opcoesEtapa.map(
      (item) => html`<option key=${item} value=${item}>${item}</option>`,
    )}
          </select>
        </label>
        <label>
          <span>Classificação</span>
          <select
            class="form-select"
            value=${filtros.classificacao}
            onChange=${(event) => onFiltroChange('classificacao', event.target.value)}
          >
            <option value="">Todas</option>
            ${opcoesClassificacao.map(
      (item) => html`<option key=${item} value=${item}>${item}</option>`,
    )}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select
            class="form-select"
            value=${filtros.status}
            onChange=${(event) => onFiltroChange('status', event.target.value)}
          >
            <option value="">Todos</option>
            ${opcoesStatus.map(
      (item) => html`<option key=${item} value=${item}>${item}</option>`,
    )}
          </select>
        </label>
        <label>
          <span>Nota mínima</span>
          <input
            class="form-control"
            type="number"
            min="0"
            max="10"
            step="0.1"
            value=${filtros.notaMin}
            onInput=${(event) => onFiltroChange('notaMin', event.target.value)}
          />
        </label>
        <label>
          <span>Nota máxima</span>
          <input
            class="form-control"
            type="number"
            min="0"
            max="10"
            step="0.1"
            value=${filtros.notaMax}
            onInput=${(event) => onFiltroChange('notaMax', event.target.value)}
          />
        </label>
        <label>
          <span>Score mínimo</span>
          <input
            class="form-control"
            type="number"
            min="0"
            max="10"
            step="0.1"
            value=${filtros.scoreMin}
            onInput=${(event) => onFiltroChange('scoreMin', event.target.value)}
          />
        </label>
        <label>
          <span>Score máximo</span>
          <input
            class="form-control"
            type="number"
            min="0"
            max="10"
            step="0.1"
            value=${filtros.scoreMax}
            onInput=${(event) => onFiltroChange('scoreMax', event.target.value)}
          />
        </label>
        <div class="process-dossier-filter-actions">
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary"
            onClick=${onLimparFiltros}
          >
            Limpar filtros
          </button>
        </div>
      </div>

      <div class="process-dossier-layout">
        <section class="process-dossier-panel">
          <header>
            <h4>Comparativo entre candidatos</h4>
            <span>${candidatosFiltrados.length} candidato(s)</span>
          </header>
          ${candidatosGrafico.length
      ? html`
                <div class="process-dossier-chart">
                  ${candidatosGrafico.map(
        (item) => html`
                      <article class="process-dossier-chart-row" key=${item.id || item.nome}>
                        <div class="process-dossier-chart-name">
                          <strong>${item.nome}</strong>
                          <small>${item.etapa || item.status}</small>
                        </div>
                        <div class="process-dossier-bars">
                          <span>
                            <i style=${{ width: largura(item.notaProva) }}></i>
                            Nota ${formatarNumeroDossie(item.notaProva)}
                          </span>
                          <span class="is-cv">
                            <i style=${{ width: largura(item.scoreCv) }}></i>
                            CV ${formatarNumeroDossie(item.scoreCv)}
                          </span>
                          <span class="is-average">
                            <i style=${{ width: largura(item.mediaGeral) }}></i>
                            Média ${formatarNumeroDossie(item.mediaGeral)}
                          </span>
                        </div>
                      </article>
                    `,
      )}
                </div>
              `
      : html`
                <div class="c24-empty-state">
                  <span class="material-symbols-outlined">${IconeSvg('bar_chart')}</span>
                  <h3>Ainda não há dados suficientes para o gráfico.</h3>
                  <p>Registre nota de prova ou score de currículo para comparar candidatos.</p>
                </div>
              `}
        </section>

        <section class="process-dossier-panel">
          <header>
            <h4>Análise inteligente</h4>
            <span>${analise?.disponivel ? 'IA integrada' : 'Fallback local'}</span>
          </header>
          <p class="process-dossier-ai-summary">
            ${analise?.resumo ||
    'Ainda não há dados suficientes para gerar o dossiê inteligente.'}
          </p>
          <div class="process-dossier-ai-grid">
            <div>
              <h5>Ranking analítico</h5>
              ${analise?.ranking?.length
      ? html`
                    <ol class="process-dossier-ranking">
                      ${analise.ranking.map(
        (item) => html`
                          <li key=${`${item.posicao}-${item.candidato}`}>
                            <span>${item.posicao}</span>
                            <strong>${item.candidato}</strong>
                            <small>Média ${item.media}</small>
                          </li>
                        `,
      )}
                    </ol>
                  `
      : html`<p class="text-muted mb-0">Sem ranking disponível.</p>`}
            </div>
            <div>
              <h5>Pontos de atenção</h5>
              <ul class="process-dossier-list">
                ${(analise?.pontos_atencao || []).slice(0, 4).map(
        (item) => html`<li key=${item}>${item}</li>`,
      )}
              </ul>
            </div>
          </div>
          <div class="process-dossier-ai-note">
            A análise organiza informações para apoiar o RH. A decisão final continua sendo humana.
          </div>
        </section>
      </div>

      <section class="process-dossier-panel">
        <header>
          <h4>Base consolidada</h4>
          <span>${candidatosFiltrados.length} registro(s)</span>
        </header>
        <div class="table-responsive">
          <table class="table align-middle rh-modern-history-table process-dossier-table">
            <thead>
              <tr>
                <th>Candidato</th>
                <th>Etapa</th>
                <th>Status</th>
                <th>Classificação</th>
                <th>Nota</th>
                <th>Score CV</th>
                <th>Média</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              ${candidatosFiltrados.length
      ? candidatosFiltrados.map(
        (item) => html`
                      <tr key=${item.id || item.nome}>
                        <td>
                          <strong>${item.nome}</strong>
                          <div class="small text-muted">${item.email || item.whatsapp || '-'}</div>
                        </td>
                        <td>${item.etapa || '-'}</td>
                        <td>${item.status || '-'}</td>
                        <td>${item.classificacao || '-'}</td>
                        <td>${formatarNumeroDossie(item.notaProva)}</td>
                        <td>${formatarNumeroDossie(item.scoreCv)}</td>
                        <td>${formatarNumeroDossie(item.mediaGeral)}</td>
                        <td>${formatarDataHora(item.data)}</td>
                      </tr>
                    `,
      )
      : html`
                    <${TabelaVazia}
                      colunas=${8}
                      texto="Nenhum candidato encontrado para os filtros selecionados."
                      icone="search_off"
                    />
                  `}
            </tbody>
          </table>
        </div>
      </section>

      <section class="process-dossier-panel">
        <header>
          <h4>Anotações do RH</h4>
          <span>${anotacoes.length} anotação(ões)</span>
        </header>
        <div class="process-dossier-notes-grid">
          <div class="process-dossier-note-form">
            <label class="form-label">Candidato relacionado</label>
            <select
              class="form-select"
              value=${formularioAnotacao.id_teste}
              onChange=${(event) => onSelecionarCandidatoAnotacao(event.target.value)}
            >
              <option value="">Processo geral</option>
              ${candidatos.map(
        (item) => html`
                  <option key=${item.id_teste || item.id} value=${item.id_teste || item.id || ''}>
                    ${item.nome}
                  </option>
                `,
      )}
            </select>
            <label class="form-label mt-3">Observação</label>
            <textarea
              class="form-control"
              rows="4"
              placeholder="Registre uma observação objetiva para o RH."
              value=${formularioAnotacao.texto}
              onInput=${(event) => onChangeAnotacao('texto', event.target.value)}
            ></textarea>
            <div class="d-flex gap-2 flex-wrap mt-3">
              <button
                type="button"
                class="btn btn-primary"
                disabled=${salvandoAnotacao}
                onClick=${onSalvarAnotacao}
              >
                ${salvandoAnotacao
      ? 'Salvando...'
      : anotacaoEditandoId
        ? 'Salvar edição'
        : 'Registrar anotação'}
              </button>
              ${anotacaoEditandoId
      ? html`
                    <button
                      type="button"
                      class="btn btn-outline-secondary"
                      disabled=${salvandoAnotacao}
                      onClick=${onCancelarEdicao}
                    >
                      Cancelar edição
                    </button>
                  `
      : null}
            </div>
          </div>
          <div class="process-dossier-note-list">
            ${anotacoes.length
      ? anotacoes.map(
        (item) => html`
                    <article class="process-dossier-note" key=${item.id_anotacao}>
                      <div>
                        <strong>${item.nome_candidato || 'Processo geral'}</strong>
                        <small>
                          ${formatarDataHora(item.atualizado_em || item.criado_em)}
                          ${item.usuario_responsavel
            ? ` • ${item.usuario_responsavel}`
            : ''}
                        </small>
                      </div>
                      <p>${item.texto}</p>
                      <button
                        type="button"
                        class="btn btn-sm btn-outline-secondary"
                        onClick=${() => onEditarAnotacao(item)}
                      >
                        Editar
                      </button>
                    </article>
                  `,
      )
      : html`
                  <div class="c24-empty-state">
                    <span class="material-symbols-outlined">${IconeSvg('edit_note')}</span>
                    <h3>Nenhuma anotação registrada para este processo.</h3>
                    <p>Use o campo ao lado para registrar contexto administrativo.</p>
                  </div>
                `}
          </div>
        </div>
      </section>
    </div>
  `;
}

export function TelaProcessos({ controlador }) {
  const { showToast, ToastHost } = useToast();
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [processos, setProcessos] = useState([]);
  const [candidatos, setCandidatos] = useState([]);
  const [entrevistas, setEntrevistas] = useState(null);
  const [filtros, setFiltros] = useState({
    vaga: '',
    operacao: '',
    notaCorte: '',
    status: '',
  });
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [edicao, setEdicao] = useState(null);
  const [processoParaEncerrar, setProcessoParaEncerrar] = useState('');
  const [aprovacaoSelecionada, setAprovacaoSelecionada] = useState(null);
  const [salvandoAprovacao, setSalvandoAprovacao] = useState(false);

  const carregar = async () => {
    setCarregando(true);
    setErro('');

    try {
      const dados = await carregarDadosProcessos({
        incluirEntrevistas: controlador?.possuiPermissao?.('entrevistas.visualizar'),
        onProcessos: (lista) => {
          setProcessos(lista);
          setCarregando(false);
        },
      });
      setProcessos(dados.processos);
      setCandidatos(dados.candidatos);
      setEntrevistas(dados.entrevistas);

      if (dados.erros.length) {
        setErro(dados.erros.join(' '));
      }
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const processosAbertos = useMemo(
    () =>
      processos
        .filter((processo) => !isProcessClosed(processo))
        .filter((processo) => {
          const vaga = String(processo.vaga || '').toLowerCase();
          const operacao = String(processo.operacao || '').toLowerCase();
          const usaNota = Number(processo.usa_nota_corte || 0) ? 'sim' : 'nao';
          const status = String(processo.status || '').toLowerCase();

          const matchVaga =
            !filtros.vaga || vaga.includes(filtros.vaga.toLowerCase());
          const matchOperacao =
            !filtros.operacao ||
            operacao.includes(filtros.operacao.toLowerCase());
          const matchNota =
            !filtros.notaCorte || usaNota === filtros.notaCorte;
          const matchStatus =
            !filtros.status || status.includes(filtros.status.toLowerCase());

          return matchVaga && matchOperacao && matchNota && matchStatus;
        }),
    [filtros, processos],
  );

  const processosEncerrados = useMemo(
    () =>
      processos.filter((processo) => isProcessClosed(processo)),
    [processos],
  );

  const processosPorId = useMemo(
    () =>
      processos.reduce((acc, processo) => {
        const referencia = obterReferenciaProcessoSeguro(processo);
        if (referencia) {
          acc[referencia] = processo;
        }
        return acc;
      }, {}),
    [processos],
  );

  const candidatosComFluxo = useMemo(
    () =>
      candidatos.map((candidato) => {
        const processo =
          processosPorId[obterReferenciaProcessoDoCandidato(candidato)];
        return montarCandidatoDeFluxo(candidato, processo?.status || '');
      }),
    [candidatos, processosPorId],
  );

  const candidatosComDecisaoPendente = useMemo(
    () =>
      candidatosComFluxo.filter(
        (candidato) =>
          candidato.acoes_fluxo?.canApprove ||
          candidato.acoes_fluxo?.canEliminate ||
          candidato.acoes_fluxo?.canSendToTalentBank,
      ),
    [candidatosComFluxo],
  );

  const processosEmAndamento = useMemo(
    () =>
      processosAbertos.filter((processo) =>
        obterCandidatosDoProcesso(candidatosComFluxo, processo).some((candidato) =>
          isActiveCandidateStatus(candidato.status_fluxo || candidato.status_candidato),
        ),
      ),
    [candidatosComFluxo, processosAbertos],
  );

  // Pedido do RH: lista breve (uma linha por processo) de processos abertos,
  // destacando quais têm candidatos aguardando decisão ("pendentes") — mais
  // compacta que os cards de "Processos Abertos em Destaque" abaixo.
  const processosAbertosResumoBreve = useMemo(
    () =>
      processosAbertos
        .map((processo) => {
          const candidatosDoProcesso = obterCandidatosDoProcesso(candidatosComFluxo, processo);
          const pendentes = candidatosDoProcesso.filter(
            (candidato) =>
              candidato.acoes_fluxo?.canApprove ||
              candidato.acoes_fluxo?.canEliminate ||
              candidato.acoes_fluxo?.canSendToTalentBank,
          ).length;
          return { processo, candidatos: candidatosDoProcesso.length, pendentes };
        })
        .sort((a, b) => b.pendentes - a.pendentes),
    [candidatosComFluxo, processosAbertos],
  );

  const entrevistasVinculadas = Array.isArray(entrevistas) ? entrevistas.length : null;

  const resumo = useMemo(
    () => ({
      totalProcessos: processos.length,
      abertos: processosAbertos.length,
      encerrados: processosEncerrados.length,
      emAndamento: processosEmAndamento.length,
      candidatosComDecisaoPendente: candidatosComDecisaoPendente.length,
      candidatosVinculados: candidatosComFluxo.length,
      entrevistasVinculadas,
    }),
    [
      processos.length,
      processosAbertos.length,
      processosEncerrados.length,
      processosEmAndamento.length,
      candidatosComDecisaoPendente.length,
      candidatosComFluxo.length,
      entrevistasVinculadas,
    ],
  );
  const opcoesVagaProcessos = useMemo(
    () => obterOpcoesTextoUnicas(processos, 'vaga'),
    [processos],
  );
  const opcoesOperacaoProcessos = useMemo(
    () => obterOpcoesTextoUnicas(processos, 'operacao'),
    [processos],
  );

  const atualizarStatus = async (
    candidatoOuRegistro,
    statusCandidato,
    idProcesso,
    dadosAprovacao = {},
  ) => {
    const registro =
      candidatoOuRegistro && typeof candidatoOuRegistro === 'object'
        ? candidatoOuRegistro.id_registro
        : candidatoOuRegistro;
    const idTeste =
      candidatoOuRegistro && typeof candidatoOuRegistro === 'object'
        ? candidatoOuRegistro.id_teste
        : '';
    const processo = encontrarProcessoPorReferencia(processos, idProcesso);
    const candidatoAtual = candidatos.find(
      (item) => Number(item.id_registro || 0) === Number(registro || 0),
    );
    const statusAtual = canonicalizeCandidateStatus(
      candidatoAtual?.status_fluxo || candidatoAtual?.status_candidato,
    );

    if (statusAtual === CANDIDATE_STATUS_APPROVED) {
      showToast(MENSAGEM_CANDIDATO_APROVADO_BLOQUEADO, 'warning');
      return;
    }

    if (isProcessClosed(processo)) {
      showToast('O processo seletivo está encerrado e não permite novas movimentações.', 'warning');
      return;
    }

    if (
      statusCandidato === 'Aprovado' &&
      Number(processo?.quantidade_vagas || 0) === 1
    ) {
      const confirmar = window.confirm(
        'Este processo possui apenas 1 vaga. Ao aprovar o candidato, o processo entrará automaticamente em "Em treinamento". Deseja continuar?',
      );
      if (!confirmar) return;
    }

    const dadosStatus = {
      status_candidato: statusCandidato,
      data_movimentacao: new Date().toISOString(),
      ...(statusCandidato === CANDIDATE_STATUS_APPROVED ? dadosAprovacao : {}),
    };

    if (!registro && !idTeste) {
      window.alert('Não foi possível identificar o candidato para atualizar o status.');
      return;
    }

    try {
      if (registro) {
        await atualizarStatusCandidato(registro, dadosStatus);
      } else {
        await atualizarStatusCandidatoAvulso(idTeste, dadosStatus);
      }
    } catch (error) {
      // Correções.txt (23/set/2026): antes disto, um erro aqui (ex.: 404 do
      // candidato avulso cujo histórico ainda não existe) ficava só no
      // console como promise rejeitada — "Eliminar"/"Enviar para Banco de
      // Talentos" pareciam não fazer nada. "Aprovar" não sofria porque abre
      // um modal antes de chegar aqui, o que já dá algum feedback visual.
      showToast(obterMensagemOperacionalErro(error, 'Não foi possível atualizar o status do candidato.'), 'danger');
      return;
    }

    await carregar();
  };

  const abrirAprovacao = (candidato) => {
    const processo = encontrarProcessoPorReferencia(
      processos,
      obterReferenciaProcessoDoCandidato(candidato),
    );
    const estadoAcoes = candidato?.acoes_fluxo || getCandidateActionState(candidato);

    if (estadoAcoes.processClosed || isProcessClosed(processo)) {
      showToast('Processo encerrado. Movimentações não são permitidas.', 'warning');
      return;
    }

    if (!estadoAcoes.canApprove) {
      showToast('A aprovação não está disponível para o status atual deste candidato.', 'warning');
      return;
    }

    setAprovacaoSelecionada({ candidato, processo });
  };

  const confirmarAprovacao = async (dadosAprovacao) => {
    if (!aprovacaoSelecionada?.candidato) return;

    setSalvandoAprovacao(true);
    try {
      const candidato = aprovacaoSelecionada.candidato;
      await atualizarStatus(
        candidato,
        CANDIDATE_STATUS_APPROVED,
        obterReferenciaProcessoDoCandidato(candidato),
        dadosAprovacao,
      );
      setAprovacaoSelecionada(null);
    } finally {
      setSalvandoAprovacao(false);
    }
  };

  const salvarEdicao = async () => {
    const mensagemErro = validarFormularioProcesso(
      {
        vaga: edicao?.vaga,
        quantidade: edicao?.quantidade_vagas,
        dataEncerramento: edicao?.data_encerramento,
        operacao: edicao?.operacao,
        trilha: edicao?.trilha,
        usaNotaCorte: Number(edicao?.usa_nota_corte || 0) === 1,
        notaCorte: edicao?.nota_corte,
        linkAgendamento: edicao?.link_agendamento || '',
      },
      { exigeOperacao: false, exigeTrilha: false, trilhaFixa: '' },
    );
    if (mensagemErro || !obterReferenciaProcesso(edicao)) {
      setErro(mensagemErro || 'Preencha os campos obrigatórios para editar o processo.');
      return;
    }

    await atualizarProcesso(obterReferenciaProcesso(edicao), {
      quantidade_vagas: Number(edicao.quantidade_vagas),
      data_encerramento: edicao.data_encerramento,
      operacao: edicao.operacao || '',
      trilha: edicao.trilha || '',
      usa_nota_corte: Number(edicao.usa_nota_corte || 0),
      nota_corte:
        edicao.nota_corte !== '' && edicao.nota_corte !== null
          ? Number(edicao.nota_corte)
          : null,
      status: edicao.status || 'Aberto',
      link_agendamento: edicao.link_agendamento || '',
      observacoes_publicas_vaga: edicao.observacoes_publicas_vaga || '',
      ia_analise_desabilitada: Number(edicao.ia_analise_desabilitada || 0),
    });

    setEdicao(null);
    await carregar();
  };

  const confirmarEncerramento = async () => {
    if (!processoParaEncerrar) return;
    await encerrarProcesso(processoParaEncerrar);
    setProcessoParaEncerrar('');
    await carregar();
  };

  const abrirDetalhe = (processo) => {
    sessionStorage.setItem(
      CHAVE_PROCESSO_DETALHE,
      obterReferenciaProcessoSeguro(processo),
    );
    controlador.irParaTelaProtegida('screen-process-details');
  };

  const duplicarProcesso = (processo) => {
    sessionStorage.setItem(
      CHAVE_DUPLICAR_PROCESSO,
      JSON.stringify({
        vaga: processo.vaga || '',
        operacao: processo.operacao || '',
        trilha: processo.trilha || '',
        usaNotaCorte: Boolean(Number(processo.usa_nota_corte || 0)),
        notaCorte: processo.nota_corte || '',
      }),
    );
    controlador.irParaTelaProtegida('screen-process-create');
  };

  const processoSelecionadoParaEncerramento = useMemo(
    () => encontrarProcessoPorReferencia(processos, processoParaEncerrar),
    [processoParaEncerrar, processos],
  );

  const contagemFiltrosSecundariosAtivos = [
    filtros.operacao,
    filtros.notaCorte,
    filtros.status,
  ].filter(Boolean).length;

  return html`
    <${PainelRh}
      screenId="screen-processes"
      navAtiva="screen-processes"
      subtituloMarca="Processos seletivos"
      placeholderBusca="Gerenciamento de processos e candidatos"
      controlador=${controlador}
      acaoPrimaria=${controlador.possuiPermissao('vagas.criar')
      ? {
        label: 'Criar Processo',
        icon: 'add',
        onClick: () => controlador.irParaTelaProtegida('screen-process-create'),
      }
      : null}
    >
      <${ToastHost} />
      <${PageIntro}
        kicker="Receptivo"
        title="Processos Seletivos"
        description="Gerencie processos, etapas, candidatos, entrevistas e decisões finais."
      />

      ${erro ? html`<div class="rh-inline-alert">${erro}</div>` : null}

      <${SectionCard} className="process-summary-cards">
        <${MetricGrid}
          items=${[
      {
        label: 'Abertos',
        value: resumo.abertos,
        variant: 'rh-metric-card--is-neutral',
      },
      {
        label: 'Encerrados',
        value: resumo.encerrados,
        variant: 'rh-metric-card--is-neutral',
        onClick: () => controlador.irParaTelaProtegida('screen-processes-closed'),
      },
      {
        label: 'Pendentes',
        value: resumo.candidatosComDecisaoPendente,
        helper: 'aguardando decisão do RH',
        variant: 'rh-metric-card--is-critical',
      },
      resumo.entrevistasVinculadas !== null
        ? {
          label: 'Agendadas',
          value: resumo.entrevistasVinculadas,
          variant: 'rh-metric-card--is-attention',
          onClick: () => controlador.irParaTelaProtegida('screen-interviews'),
        }
        : null,
    ].filter(Boolean)}
        />
      </${SectionCard}>

      <${SectionCard}
        title="Processos Abertos e Pendentes"
        
        className="process-brief-list-card"
      >
        ${processosAbertosResumoBreve.length
      ? html`
              <ul class="process-brief-list">
                ${processosAbertosResumoBreve.slice(0, 8).map(({ processo, candidatos, pendentes }) => html`
                  <li key=${obterChaveProcesso(processo)}>
                    <button type="button" class="process-brief-list-row" onClick=${() => abrirDetalhe(processo)}>
                      <span class="process-brief-list-name">${processo.vaga || obterCodigoProcessoUsuario(processo)}</span>
                      <span class="process-brief-list-meta">${candidatos} candidato${candidatos === 1 ? '' : 's'}</span>
                      ${pendentes
          ? html`<span class="process-brief-list-badge is-pending">${pendentes} pendente${pendentes === 1 ? '' : 's'}</span>`
          : html`<span class="process-brief-list-badge is-ok">Em dia</span>`}
                      <span class="material-symbols-outlined">${IconeSvg('chevron_right')}</span>
                    </button>
                  </li>
                `)}
              </ul>
              ${processosAbertosResumoBreve.length > 8
          ? html`<p class="process-brief-list-more">+${processosAbertosResumoBreve.length - 8} outros processos abertos.</p>`
          : null}
            `
      : html`<p class="text-muted">Nenhum processo aberto no momento.</p>`}
      </${SectionCard}>

      <${SectionCard}
        className="process-filter-panel"
        tourId="process-filters"
      >
        <div class="rh-filter-bar">
          <div class="rh-filter-bar-search">
            <span class="material-symbols-outlined">${IconeSvg('search')}</span>
            <input
              type="search"
              list="process-filtro-vaga-lista"
              placeholder="Buscar por vaga..."
              value=${filtros.vaga}
              onInput=${(event) => setFiltros({ ...filtros, vaga: event.target.value })}
            />
          </div>
          <datalist id="process-filtro-vaga-lista">
            ${opcoesVagaProcessos.map((opcao) => html`<option key=${opcao} value=${opcao} />`)}
          </datalist>

          <button
            type="button"
            class="rh-filter-toggle"
            aria-expanded=${filtrosAbertos}
            onClick=${() => setFiltrosAbertos(!filtrosAbertos)}
          >
            <span class="material-symbols-outlined">${IconeSvg('tune')}</span>
            Filtros
            ${contagemFiltrosSecundariosAtivos > 0
      ? html`<span class="rh-filter-count">${contagemFiltrosSecundariosAtivos}</span>`
      : null}
          </button>

          ${filtros.operacao
      ? html`
              <span class="rh-filter-chip">
                ${filtros.operacao}
                <button type="button" aria-label="Remover filtro de operação" onClick=${() => setFiltros({ ...filtros, operacao: '' })}>×</button>
              </span>
            `
      : null}
          ${filtros.notaCorte
      ? html`
              <span class="rh-filter-chip">
                Nota de corte: ${filtros.notaCorte === 'sim' ? 'Sim' : 'Não'}
                <button type="button" aria-label="Remover filtro de nota de corte" onClick=${() => setFiltros({ ...filtros, notaCorte: '' })}>×</button>
              </span>
            `
      : null}
          ${filtros.status
      ? html`
              <span class="rh-filter-chip">
                Status: ${filtros.status === 'aberto' ? 'Aberto' : 'Encerrado'}
                <button type="button" aria-label="Remover filtro de status" onClick=${() => setFiltros({ ...filtros, status: '' })}>×</button>
              </span>
            `
      : null}
        </div>

        ${filtrosAbertos
      ? html`
            <div class="rh-filter-panel-expanded">
              <div class="rh-filter-grid">
                <div class="rh-filter-field">
                  <label>Operação / Cliente</label>
                  <select
                    class="form-select"
                    value=${filtros.operacao}
                    onChange=${(event) =>
          setFiltros({ ...filtros, operacao: event.target.value })}
                  >
                    ${renderizarOpcoesFiltro(opcoesOperacaoProcessos, 'Operação / Cliente')}
                  </select>
                </div>
                <div class="rh-filter-field">
                  <label>Nota de corte</label>
                  <select
                    class="form-select"
                    value=${filtros.notaCorte}
                    onChange=${(event) =>
          setFiltros({ ...filtros, notaCorte: event.target.value })}
                  >
                    <option value="">Nota de corte</option>
                    <option value="sim">Sim</option>
                    <option value="nao">Não</option>
                  </select>
                </div>
                <div class="rh-filter-field">
                  <label>Status</label>
                  <select
                    class="form-select"
                    value=${filtros.status}
                    onChange=${(event) =>
          setFiltros({ ...filtros, status: event.target.value })}
                  >
                    <option value="">Status</option>
                    <option value="aberto">Aberto</option>
                    <option value="encerrado">Encerrado</option>
                  </select>
                </div>
              </div>
            </div>
          `
      : null}
      </${SectionCard}>

      <${SectionCard}
        title="Processos Abertos em Destaque"
        description="Acompanhamento compacto dos processos ativos com candidatos, progresso e responsável."
        className="process-progress-card"
        tourId="process-open-highlights"
      >
        ${processosAbertos.length
      ? html`
              <div class="active-process-list">
                ${processosAbertos.slice(0, 5).map((processo) => {
        const candidatosProcesso = obterCandidatosDoProcesso(candidatosComFluxo, processo);
        const entrevistasProcesso = obterEntrevistasDoProcesso(entrevistas || [], processo);
        return renderizarResumoProcessoAberto({
          processo,
          candidatosProcesso,
          entrevistasProcesso,
          onDetalhes: abrirDetalhe,
        });
      })}
              </div>
            `
      : html`
              <div class="c24-empty-state c24-empty-state-horizontal">
                <span class="material-symbols-outlined">${IconeSvg('folder_open')}</span>
                <div>
                  <h3>Nenhum processo aberto</h3>
                  <p>Quando houver processos ativos, eles aparecerão aqui.</p>
                </div>
              </div>
            `}
      </${SectionCard}>

      <section class="process-dashboard-section process-dashboard-decisions-section">
        <div class="process-dashboard-section-title">
          <h3>Decisões Finais Pendentes</h3>
        </div>
        ${candidatosComDecisaoPendente.length
      ? html`
              <div class="process-decision-card-list">
                ${candidatosComDecisaoPendente.map(
        (candidato) => html`
                    <article class="process-decision-card" key=${candidato.id_registro}>
                      <div>
                        <strong>${candidato.nome_candidato || '-'}</strong>
                        <span>${candidato.vaga || candidato.id_processo || '-'}</span>
                      </div>
                      <span class=${`process-candidate-status-badge ${obterClasseStatusProcesso(candidato.status_fluxo)}`}>
                        ${candidato.status_fluxo || '-'}
                      </span>
                      <div class="process-decision-actions">
                        ${renderizarAcoesDoCandidato({
          candidato,
          onAprovar: abrirAprovacao,
          onAtualizarStatus: (item, status) =>
            atualizarStatus(
              item,
              status,
              obterReferenciaProcessoDoCandidato(item),
            ),
          controlador,
        })}
                      </div>
                    </article>
                  `,
      )}
              </div>
            `
      : html`
              <div class="process-dashboard-empty">
                <span class="material-symbols-outlined">${IconeSvg('assignment_turned_in')}</span>
                <strong>Tudo em dia!</strong>
                <p>Nenhum candidato com decisão final pendente.</p>
              </div>
            `}
      </section>

      <${SectionCard}
        title="Gestão de Processos Seletivos"
        description="Funcionalidade existente preservada, com ações alinhadas e foco nos processos ativos."
        className="process-open-table-card"
        tourId="process-open-table"
      >
        <div class="table-responsive">
                <table class="table align-middle rh-modern-history-table">
                  <thead>
                    <tr>
                      <th>Processo</th>
                      <th>Vaga</th>
                      <th>Operação</th>
                      <th>Trilha</th>
                      <th>Nota de corte</th>
                      <th>Valor corte</th>
                      <th>Vagas</th>
                      <th>Encerramento</th>
                      <th>Link legado</th>
                      <th>Status</th>
                      <th class="text-end">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${carregando
      ? html`<${SkeletonTableRows} colunas=${11} linhas=${6} />`
      : processosAbertos.length
        ? processosAbertos.map(
          (processo) => html`
                              <tr key=${obterChaveProcesso(processo)} class="c24-fade-in">
                                <td class="process-code-cell">
                                  <strong title=${obterTooltipProcessoUsuario(processo)}>
                                    ${obterCodigoProcessoUsuario(processo)}
                                  </strong>
                                  ${processo.urgente
              ? html`<span class="process-urgent-badge" title="Botão Vaga Urgente: contratação urgente">Urgente</span>`
              : null}
                                  <span>${processo.data_criacao ? `Criado em ${formatarDataCurta(processo.data_criacao)}` : processo.vaga || '-'}</span>
                                </td>
                                <td>${processo.vaga || '-'}</td>
                                <td>${processo.operacao || '-'}</td>
                                <td>${processo.trilha || '-'}</td>
                                <td>${Number(processo.usa_nota_corte || 0) ? 'Sim' : 'Não'}</td>
                                <td>${processo.nota_corte || '-'}</td>
                                <td>
                                  <div>${`${processo.vagas_preenchidas || 0}/${processo.quantidade_vagas || 0}`}</div>
                                  <small class="text-muted">
                                    ${Number(processo.candidatos_concorrendo ?? processo.quantidade_candidatos ?? 0)}
                                    concorrendo
                                  </small>
                                </td>
                                <td>${processo.data_encerramento || '-'}</td>
                                <td>
                                  ${processo.link_agendamento
              ? html`
                                        <a
                                          href=${processo.link_agendamento}
                                          target="_blank"
                                          rel="noreferrer"
                                          class="rh-link-inline"
                                        >
                                          Abrir
                                        </a>
                                      `
              : 'Não informado'}
                                </td>
                                <td>
                                  <span class=${`rh-status-pill ${processo.status === 'Encerrado' ? 'is-neutral' : 'is-finished'}`}>
                                    ${processo.status || '-'}
                                  </span>
                                </td>
                                <td class="text-end">
                                  <div class="process-row-actions">
                                    <button
                                      type="button"
                                      class="btn btn-sm btn-outline-primary process-primary-action"
                                      onClick=${() => abrirDetalhe(processo)}
                                    >
                                      Detalhes
                                    </button>
                                    <${MenuAcoesProcesso}
                                      acoes=${[
              {
                label: 'Editar',
                icon: 'edit',
                onClick: () =>
                  setEdicao({
                    ...processo,
                    data_encerramento: formatarDataParaInput(
                      processo.data_encerramento,
                    ),
                  }),
              },
              controlador.possuiPermissao('vagas.criar')
                ? {
                  label: 'Duplicar processo',
                  icon: 'content_copy',
                  onClick: () => duplicarProcesso(processo),
                }
                : null,
              {
                label: 'Ver candidatos',
                icon: 'groups',
                onClick: () => abrirDetalhe(processo),
              },
              controlador.possuiPermissao('entrevistas.visualizar')
                ? {
                  label: 'Ver entrevistas',
                  icon: 'event_available',
                  onClick: () => controlador.irParaTelaProtegida('screen-interviews'),
                }
                : null,
              {
                label: 'Encerrar',
                icon: 'archive',
                danger: true,
                onClick: () =>
                  setProcessoParaEncerrar(
                    obterReferenciaProcesso(processo),
                  ),
              },
            ]}
                                    />
                                  </div>
                                </td>
                              </tr>
                            `,
        )
        : html`
                            <${TabelaVazia}
                              colunas=${11}
                              texto="Nenhum processo aberto encontrado."
                              icone="inbox"
                            />
                          `}
                  </tbody>
                </table>
              </div>
      </${SectionCard}>

      <${SectionCard}
        title="Decisões Finais Pendentes"
        description="Sempre visível para apoiar a decisão humana do RH sem alterar status automaticamente."
        className="process-decisions-fixed-card"
      >
        <div class="table-responsive">
                <table class="table align-middle rh-modern-history-table">
                  <thead>
                    <tr>
                      <th>Processo</th>
                      <th>Candidato</th>
                      <th>Vaga</th>
                      <th>Nota</th>
                      <th>Status</th>
                      <th class="text-end">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${candidatosComDecisaoPendente.length
      ? candidatosComDecisaoPendente.map(
        (candidato) => html`
                            <tr key=${candidato.id_registro}>
                              <td>${candidato.id_processo || '-'}</td>
                              <td>${candidato.nome_candidato || '-'}</td>
                              <td>${candidato.vaga || '-'}</td>
                              <td>${candidato.pontuacao_final || '-'}</td>
                              <td>
                                <span
                                  class=${`process-candidate-status-badge ${obterClasseStatusProcesso(candidato.status_fluxo)}`}
                                >
                                  ${candidato.status_fluxo || '-'}
                                </span>
                              </td>
                              <td class="text-end">
                                ${renderizarAcoesDoCandidato({
          candidato,
          onAprovar: abrirAprovacao,
          onAtualizarStatus: (item, status) =>
            atualizarStatus(
              item,
              status,
              obterReferenciaProcessoDoCandidato(item),
            ),
          controlador,
        })}
                              </td>
                            </tr>
                          `,
      )
      : html`
                          <${TabelaVazia}
                            colunas=${6}
                            texto="Nenhum candidato com decisão final pendente."
                          />
                        `}
                  </tbody>
                </table>
              </div>
      </${SectionCard}>

      <${ModalPadrao}
        aberto=${!!edicao}
        titulo="Editar processo"
        subtitulo="Ajuste as informações sem alterar a integração existente."
        onClose=${() => setEdicao(null)}
      >
        ${edicao
      ? html`
              <div class="rh-details-body">
                <div class="row g-3">
                  <div class="col-md-6">
                    <label class="form-label">Vaga</label>
                    <input class="form-control" readonly value=${edicao.vaga || ''} />
                  </div>
                  <div class="col-md-3">
                    <label class="form-label">Quantidade de vagas</label>
                    <input
                      class="form-control"
                      type="number"
                      min="1"
                      value=${edicao.quantidade_vagas || 0}
                      onInput=${(event) =>
          setEdicao({
            ...edicao,
            quantidade_vagas: event.target.value,
          })}
                    />
                  </div>
                  <div class="col-md-3">
                    <label class="form-label">Data de encerramento</label>
                    <input
                      class="form-control"
                      type="date"
                      value=${edicao.data_encerramento || ''}
                      onInput=${(event) =>
          setEdicao({
            ...edicao,
            data_encerramento: event.target.value,
          })}
                    />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Operação / Cliente</label>
                    <select
                      class="form-select"
                      value=${edicao.operacao || ''}
                      onChange=${(event) =>
          setEdicao({ ...edicao, operacao: event.target.value })}
                    >
                      <option value="">Selecione...</option>
                      ${OPCOES_OPERACOES.map(
            (operacao) => html`
                          <option key=${operacao} value=${operacao}>${operacao}</option>
                        `,
          )}
                    </select>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Área/Trilha</label>
                    <select
                      class="form-select"
                      value=${edicao.trilha || ''}
                      onChange=${(event) =>
          setEdicao({ ...edicao, trilha: event.target.value })}
                    >
                      <option value="">Selecione...</option>
                      ${OPCOES_TRILHAS_PROCESSO.map(
            (opcao) => html`
                          <option key=${opcao.value} value=${opcao.value}>
                            ${opcao.label}
                          </option>
                        `,
          )}
                    </select>
                  </div>
                  <div class="col-md-3">
                    <label class="form-label d-block mb-2">Nota de corte</label>
                    <div class="form-check form-switch pt-2">
                      <input
                        class="form-check-input"
                        type="checkbox"
                        checked=${Number(edicao.usa_nota_corte || 0) === 1}
                        onChange=${(event) =>
          setEdicao({
            ...edicao,
            usa_nota_corte: event.target.checked ? 1 : 0,
          })}
                      />
                    </div>
                  </div>
                  <div class="col-md-3">
                    <label class="form-label">Valor corte</label>
                    <input
                      class="form-control"
                      type="number"
                      step="0.1"
                      min="0"
                      max="10"
                      value=${edicao.nota_corte ?? ''}
                      disabled=${Number(edicao.usa_nota_corte || 0) !== 1}
                      onInput=${(event) =>
          setEdicao({ ...edicao, nota_corte: event.target.value })}
                    />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Status</label>
                    <select
                      class="form-select"
                      value=${edicao.status || 'Aberto'}
                      onChange=${(event) =>
          setEdicao({ ...edicao, status: event.target.value })}
                    >
                      <option value="Aberto">Aberto</option>
                      <option value="Encerrado">Encerrado</option>
                    </select>
                  </div>
                  <div class="col-md-12">
                    <label class="form-label">Link legado</label>
                    <input
                      class="form-control"
                      placeholder="https://..."
                      value=${edicao.link_agendamento || ''}
                      onInput=${(event) =>
          setEdicao({
            ...edicao,
            link_agendamento: event.target.value,
          })}
                    />
                  </div>
                  <div class="col-md-12">
                    <div class="form-check form-switch">
                      <input
                        class="form-check-input"
                        id="edicao-ia-analise-desabilitada"
                        type="checkbox"
                        checked=${Number(edicao.ia_analise_desabilitada || 0) === 1}
                        onChange=${(event) =>
          setEdicao({
            ...edicao,
            ia_analise_desabilitada: event.target.checked ? 1 : 0,
          })}
                      />
                      <label class="form-check-label" for="edicao-ia-analise-desabilitada">
                        Desabilitar análise de currículo por IA neste processo
                      </label>
                    </div>
                  </div>
                </div>
              </div>
              <footer class="rh-modal-footer">
                <button
                  type="button"
                  class="btn btn-outline-secondary"
                  onClick=${() => setEdicao(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  class="btn btn-primary"
                  onClick=${salvarEdicao}
                >
                  Salvar alterações
                </button>
              </footer>
            `
      : null}
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${!!processoParaEncerrar}
        titulo="Encerrar processo"
        subtitulo="Essa ação move o processo para a lista de encerrados."
        onClose=${() => setProcessoParaEncerrar('')}
      >
        <div class="rh-details-body">
          <div class="alert alert-warning mb-0">
            Deseja realmente encerrar o processo ${processoSelecionadoParaEncerramento?.id_processo || processoParaEncerrar || ''}?
          </div>
        </div>
        <footer class="rh-modal-footer">
          <button
            type="button"
            class="btn btn-outline-secondary"
            onClick=${() => setProcessoParaEncerrar('')}
          >
            Cancelar
          </button>
          <button
            type="button"
            class="btn btn-danger"
            onClick=${confirmarEncerramento}
          >
            Encerrar processo
          </button>
        </footer>
      </${ModalPadrao}>

      <${ModalAprovacaoCandidato}
        aberto=${!!aprovacaoSelecionada}
        candidato=${aprovacaoSelecionada?.candidato}
        processo=${aprovacaoSelecionada?.processo}
        salvando=${salvandoAprovacao}
        onClose=${() => setAprovacaoSelecionada(null)}
        onConfirm=${confirmarAprovacao}
      />
    </${PainelRh}>
  `;
}

export function TelaProcessosAbertos({ controlador }) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [processos, setProcessos] = useState([]);
  const [candidatos, setCandidatos] = useState([]);
  const [entrevistas, setEntrevistas] = useState(null);
  const [processoParaEncerrar, setProcessoParaEncerrar] = useState('');
  const [edicao, setEdicao] = useState(null);

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    try {
      const dados = await carregarDadosProcessos({
        incluirEntrevistas: controlador?.possuiPermissao?.('entrevistas.visualizar'),
        onProcessos: (lista) => {
          setProcessos(lista);
          setCarregando(false);
        },
      });
      setProcessos(dados.processos);
      setCandidatos(dados.candidatos);
      setEntrevistas(dados.entrevistas);
      if (dados.erros.length) setErro(dados.erros.join(' '));
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const processosAbertos = useMemo(
    () => processos.filter((processo) => !isProcessClosed(processo)),
    [processos],
  );
  const processosPorId = useMemo(
    () =>
      processos.reduce((acc, processo) => {
        const referencia = obterReferenciaProcessoSeguro(processo);
        if (referencia) acc[referencia] = processo;
        return acc;
      }, {}),
    [processos],
  );
  const candidatosComFluxo = useMemo(
    () =>
      candidatos.map((candidato) => {
        const processo =
          processosPorId[obterReferenciaProcessoDoCandidato(candidato)];
        return montarCandidatoDeFluxo(candidato, processo?.status || '');
      }),
    [candidatos, processosPorId],
  );
  const decisoesPendentes = useMemo(
    () =>
      candidatosComFluxo.filter(
        (candidato) =>
          candidato.acoes_fluxo?.canApprove ||
          candidato.acoes_fluxo?.canEliminate ||
          candidato.acoes_fluxo?.canSendToTalentBank,
      ),
    [candidatosComFluxo],
  );
  const hoje = formatarIsoDataLocal(new Date());
  const processosComEntrevistasHoje = Array.isArray(entrevistas)
    ? new Set(
      obterEntrevistasConfirmadas(entrevistas)
        .filter((entrevista) =>
          entrevista.data_entrevista &&
          formatarIsoDataLocal(entrevista.data_entrevista) === hoje,
        )
        .map((entrevista) => String(entrevista.id_processo_ref || entrevista.id_processo || '').trim())
        .filter(Boolean),
    ).size
    : null;
  const processosSemMovimentacao = processosAbertos.filter((processo) => {
    const candidatosProcesso = obterCandidatosDoProcesso(candidatosComFluxo, processo);
    const entrevistasProcesso = obterEntrevistasDoProcesso(entrevistas || [], processo);
    return !candidatosProcesso.length && !entrevistasProcesso.length;
  }).length;
  const candidatosEmAnalise = candidatosComFluxo.filter(
    (candidato) =>
      canonicalizeCandidateStatus(candidato.status_fluxo || candidato.status_candidato) ===
      CANDIDATE_STATUS_ANALYSIS,
  ).length;
  const registrosRecentes = montarRegistrosRecentesProcessosAbertos({
    processosAbertos,
    candidatos: candidatosComFluxo,
    entrevistas: entrevistas || [],
  });

  const abrirDetalhe = (processo) => {
    sessionStorage.setItem(CHAVE_PROCESSO_DETALHE, obterReferenciaProcessoSeguro(processo));
    controlador.irParaTelaProtegida('screen-process-details');
  };

  const duplicarProcesso = (processo) => {
    sessionStorage.setItem(
      CHAVE_DUPLICAR_PROCESSO,
      JSON.stringify({
        vaga: processo.vaga || '',
        operacao: processo.operacao || '',
        trilha: processo.trilha || '',
        usaNotaCorte: Boolean(Number(processo.usa_nota_corte || 0)),
        notaCorte: processo.nota_corte || '',
      }),
    );
    controlador.irParaTelaProtegida('screen-process-create');
  };

  const salvarEdicao = async () => {
    const mensagemErro = validarFormularioProcesso(
      {
        vaga: edicao?.vaga,
        quantidade: edicao?.quantidade_vagas,
        dataEncerramento: edicao?.data_encerramento,
        operacao: edicao?.operacao,
        trilha: edicao?.trilha,
        usaNotaCorte: Number(edicao?.usa_nota_corte || 0) === 1,
        notaCorte: edicao?.nota_corte,
        linkAgendamento: edicao?.link_agendamento || '',
      },
      { exigeOperacao: false, exigeTrilha: false, trilhaFixa: '' },
    );
    const referencia = obterReferenciaProcessoSeguro(edicao);
    if (mensagemErro || !referencia) {
      setErro(mensagemErro || 'Preencha os campos obrigatórios para editar o processo.');
      return;
    }

    await atualizarProcesso(referencia, {
      quantidade_vagas: Number(edicao.quantidade_vagas),
      data_encerramento: edicao.data_encerramento,
      operacao: edicao.operacao || '',
      trilha: edicao.trilha || '',
      usa_nota_corte: Number(edicao.usa_nota_corte || 0),
      nota_corte:
        edicao.nota_corte !== '' && edicao.nota_corte !== null
          ? Number(edicao.nota_corte)
          : null,
      status: edicao.status || 'Aberto',
      link_agendamento: edicao.link_agendamento || '',
      observacoes_publicas_vaga: edicao.observacoes_publicas_vaga || '',
      ia_analise_desabilitada: Number(edicao.ia_analise_desabilitada || 0),
    });

    setEdicao(null);
    await carregar();
  };

  const confirmarEncerramento = async () => {
    if (!processoParaEncerrar) return;
    await encerrarProcesso(processoParaEncerrar);
    setProcessoParaEncerrar('');
    await carregar();
  };

  const processoSelecionadoParaEncerramento = useMemo(
    () => encontrarProcessoPorReferencia(processos, processoParaEncerrar),
    [processoParaEncerrar, processos],
  );

  return html`
    <${PainelRh}
      screenId="screen-processes-open"
      navAtiva="screen-processes-open"
      subtituloMarca="Processos seletivos"
      placeholderBusca="Processos abertos"
      controlador=${controlador}
      acaoPrimaria=${{
      label: 'Novo processo',
      permissao: 'vagas.criar',
      onClick: () => controlador.irParaTelaProtegida('screen-process-create'),
    }}
    >
      <${PageIntro}
        kicker="Processos"
        title="Processos Abertos"
        description="Acompanhe processos ativos e ações pendentes."
      />
      ${erro ? html`<div class="rh-inline-alert">${erro}</div>` : null}

      <${SectionCard} title="Indicadores" className="open-processes-dashboard-card">
        <${MetricGrid}
          items=${[
      { label: 'Total de Processos Abertos', value: processosAbertos.length, icon: 'folder_open', variant: 'is-approved' },
      processosComEntrevistasHoje !== null
        ? { label: 'Entrevistas Hoje', value: processosComEntrevistasHoje, icon: 'today', variant: 'is-highlight' }
        : null,
      { label: 'Processos sem Movimentação', value: processosSemMovimentacao, icon: 'motion_photos_off' },
      { label: 'Decisões Pendentes', value: decisoesPendentes.length, icon: 'rule', variant: 'is-analysis' },
      { label: 'Candidatos em Análise', value: candidatosEmAnalise, icon: 'person_search' },
    ].filter(Boolean)}
        />
      </${SectionCard}>

      <${SectionCard}
        title="Lista Principal"
        description="Processos ativos com etapa, candidatos, entrevistas e última movimentação."
        className="open-processes-list-card"
      >
        <div class="table-responsive">
          <table class="table align-middle rh-modern-history-table process-wide-table">
            <thead>
              <tr>
                <th>Processo</th>
                <th>Vaga</th>
                <th>Status</th>
                <th>Etapa Atual</th>
                <th>Candidatos</th>
                <th>Entrevistas Confirmadas</th>
                <th>Última Movimentação</th>
                <th>Responsável</th>
                <th class="text-end">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${carregando
      ? html`<${SkeletonTableRows} colunas=${9} linhas=${6} />`
      : processosAbertos.length
        ? processosAbertos.map((processo) => {
          const candidatosProcesso = obterCandidatosDoProcesso(candidatosComFluxo, processo);
          const entrevistasProcesso = obterEntrevistasDoProcesso(entrevistas || [], processo);
          const entrevistasConfirmadasProcesso = obterEntrevistasConfirmadas(entrevistasProcesso);
          const etapaAtual =
            candidatosProcesso.find((item) => item.etapa_pipeline || item.status_fluxo)?.etapa_pipeline ||
            candidatosProcesso.find((item) => item.status_fluxo)?.status_fluxo ||
            '-';
          return html`
                        <tr key=${obterChaveProcesso(processo)}>
                          <td class="process-code-cell">
                            <strong title=${obterTooltipProcessoUsuario(processo)}>
                              ${obterCodigoProcessoUsuario(processo)}
                            </strong>
                            ${processo.urgente
              ? html`<span class="process-urgent-badge" title="Botão Vaga Urgente: contratação urgente">Urgente</span>`
              : null}
                            <span>${processo.data_criacao ? `Criado em ${formatarDataCurta(processo.data_criacao)}` : processo.vaga || '-'}</span>
                          </td>
                          <td>${processo.vaga || '-'}</td>
                          <td>
                            <span class=${`rh-status-pill ${obterStatusProcessoClasse(processo.status)}`}>
                              ${processo.status || 'Aberto'}
                            </span>
                          </td>
                          <td>${etapaAtual}</td>
                          <td>${candidatosProcesso.length}</td>
                          <td>${entrevistasConfirmadasProcesso.length}</td>
                          <td>${obterUltimaMovimentacaoProcesso(processo, candidatosProcesso, entrevistasProcesso)}</td>
                          <td>${obterResponsavelProcesso(processo)}</td>
                          <td class="text-end">
                            <div class="process-row-actions">
                              <button type="button" class="btn btn-sm btn-outline-primary process-primary-action" onClick=${() => abrirDetalhe(processo)}>
                                Ver Detalhes
                              </button>
                              <${MenuAcoesProcesso}
                                acoes=${[
              controlador.possuiPermissao('vagas.editar') ||
                controlador.possuiPermissao('vagas.editar_limitado') ||
                controlador.possuiPermissao('processos.editar')
                ? {
                  label: 'Editar',
                  icon: 'edit',
                  onClick: () => setEdicao({ ...processo }),
                }
                : null,
              controlador.possuiPermissao('vagas.criar')
                ? {
                  label: 'Duplicar processo',
                  icon: 'content_copy',
                  onClick: () => duplicarProcesso(processo),
                }
                : null,
              {
                label: 'Ver Candidatos',
                icon: 'groups',
                onClick: () => abrirDetalhe(processo),
              },
              controlador.possuiPermissao('entrevistas.visualizar')
                ? {
                  label: 'Ver Entrevistas',
                  icon: 'event_available',
                  onClick: () => controlador.irParaTelaProtegida('screen-interviews'),
                }
                : null,
              controlador.possuiPermissao('vagas.encerrar')
                ? {
                  label: 'Encerrar',
                  icon: 'archive',
                  danger: true,
                  onClick: () => setProcessoParaEncerrar(obterReferenciaProcessoSeguro(processo)),
                }
                : null,
            ]}
                              />
                            </div>
                          </td>
                        </tr>
                      `;
        })
        : html`<${TabelaVazia} colunas=${9} texto="Nenhum processo aberto encontrado." icone="inbox" />`}
            </tbody>
          </table>
        </div>
      </${SectionCard}>

      <${SectionCard}
        title="Registros Recentes"
        description="Eventos reais vindos de movimentações de candidatos e entrevistas dos processos abertos."
        className="open-processes-recent-card"
      >
        ${registrosRecentes.length
      ? html`
              <div class="rh-recent-grid process-recent-events-grid">
                ${registrosRecentes.map(
        (item) => html`
                    <article class="rh-recent-card" key=${item.id}>
                      <span class="rh-recent-avatar-wrap material-symbols-outlined">${IconeSvg(item.icone)}</span>
                      <span class="rh-recent-card-body">
                        <strong>${item.titulo}</strong>
                        <span>${item.descricao}</span>
                        <span>${formatarDataHora(item.data)}</span>
                      </span>
                    </article>
                  `,
      )}
              </div>
            `
      : html`
              <div class="c24-empty-state c24-empty-state-horizontal">
                <span class="material-symbols-outlined">${IconeSvg('history')}</span>
                <div>
                  <h3>Nenhum registro recente</h3>
                  <p>Sem histórico, logs ou eventos disponíveis para processos abertos.</p>
                </div>
              </div>
            `}
      </${SectionCard}>

      <${ModalPadrao}
        aberto=${!!edicao}
        titulo="Editar processo"
        subtitulo="Ajuste as informações sem alterar a integração existente."
        onClose=${() => setEdicao(null)}
      >
        ${edicao
      ? html`
              <div class="rh-details-body">
                <div class="row g-3">
                  <div class="col-md-6">
                    <label class="form-label">Vaga</label>
                    <input class="form-control" readonly value=${edicao.vaga || ''} />
                  </div>
                  <div class="col-md-3">
                    <label class="form-label">Quantidade de vagas</label>
                    <input
                      class="form-control"
                      type="number"
                      min="1"
                      value=${edicao.quantidade_vagas || 0}
                      onInput=${(event) =>
          setEdicao({ ...edicao, quantidade_vagas: event.target.value })}
                    />
                  </div>
                  <div class="col-md-3">
                    <label class="form-label">Data de encerramento</label>
                    <input
                      class="form-control"
                      type="date"
                      value=${edicao.data_encerramento || ''}
                      onInput=${(event) =>
          setEdicao({ ...edicao, data_encerramento: event.target.value })}
                    />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Operação / Cliente</label>
                    <select
                      class="form-select"
                      value=${edicao.operacao || ''}
                      onChange=${(event) => setEdicao({ ...edicao, operacao: event.target.value })}
                    >
                      <option value="">Selecione...</option>
                      ${OPCOES_OPERACOES.map(
            (operacao) => html`
                          <option key=${operacao} value=${operacao}>${operacao}</option>
                        `,
          )}
                    </select>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Área/Trilha</label>
                    <select
                      class="form-select"
                      value=${edicao.trilha || ''}
                      onChange=${(event) => setEdicao({ ...edicao, trilha: event.target.value })}
                    >
                      <option value="">Selecione...</option>
                      ${OPCOES_TRILHAS_PROCESSO.map(
            (opcao) => html`
                          <option key=${opcao.value} value=${opcao.value}>
                            ${opcao.label}
                          </option>
                        `,
          )}
                    </select>
                  </div>
                  <div class="col-md-3">
                    <label class="form-label d-block mb-2">Nota de corte</label>
                    <div class="form-check form-switch pt-2">
                      <input
                        class="form-check-input"
                        type="checkbox"
                        checked=${Number(edicao.usa_nota_corte || 0) === 1}
                        onChange=${(event) =>
          setEdicao({
            ...edicao,
            usa_nota_corte: event.target.checked ? 1 : 0,
          })}
                      />
                    </div>
                  </div>
                  <div class="col-md-3">
                    <label class="form-label">Valor corte</label>
                    <input
                      class="form-control"
                      type="number"
                      step="0.1"
                      min="0"
                      max="10"
                      value=${edicao.nota_corte ?? ''}
                      disabled=${Number(edicao.usa_nota_corte || 0) !== 1}
                      onInput=${(event) => setEdicao({ ...edicao, nota_corte: event.target.value })}
                    />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Status</label>
                    <select
                      class="form-select"
                      value=${edicao.status || 'Aberto'}
                      onChange=${(event) => setEdicao({ ...edicao, status: event.target.value })}
                    >
                      <option value="Aberto">Aberto</option>
                      <option value="Encerrado">Encerrado</option>
                    </select>
                  </div>
                  <div class="col-md-12">
                    <label class="form-label">Link legado</label>
                    <input
                      class="form-control"
                      placeholder="https://..."
                      value=${edicao.link_agendamento || ''}
                      onInput=${(event) =>
          setEdicao({ ...edicao, link_agendamento: event.target.value })}
                    />
                  </div>
                  <div class="col-md-12">
                    <div class="form-check form-switch">
                      <input
                        class="form-check-input"
                        id="edicao-aberta-ia-analise-desabilitada"
                        type="checkbox"
                        checked=${Number(edicao.ia_analise_desabilitada || 0) === 1}
                        onChange=${(event) =>
          setEdicao({
            ...edicao,
            ia_analise_desabilitada: event.target.checked ? 1 : 0,
          })}
                      />
                      <label class="form-check-label" for="edicao-aberta-ia-analise-desabilitada">
                        Desabilitar análise de currículo por IA neste processo
                      </label>
                    </div>
                  </div>
                </div>
              </div>
              <footer class="rh-modal-footer">
                <button type="button" class="btn btn-outline-secondary" onClick=${() => setEdicao(null)}>
                  Cancelar
                </button>
                <button type="button" class="btn btn-primary" onClick=${salvarEdicao}>
                  Salvar alterações
                </button>
              </footer>
            `
      : null}
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${!!processoParaEncerrar}
        titulo="Encerrar processo"
        subtitulo="Esta ação usa a rotina existente de encerramento."
        onClose=${() => setProcessoParaEncerrar('')}
      >
        <p>
          Deseja realmente encerrar o processo ${processoSelecionadoParaEncerramento?.id_processo || processoParaEncerrar || ''}?
        </p>
        <footer class="rh-modal-footer">
          <button type="button" class="btn btn-outline-secondary" onClick=${() => setProcessoParaEncerrar('')}>
            Cancelar
          </button>
          <button type="button" class="btn btn-danger" onClick=${confirmarEncerramento}>
            Encerrar
          </button>
        </footer>
      </${ModalPadrao}>
    </${PainelRh}>
  `;
}

export function TelaProcessosEncerrados({ controlador }) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [processos, setProcessos] = useState([]);
  const [candidatos, setCandidatos] = useState([]);
  const [filtros, setFiltros] = useState({
    vaga: '',
    periodo: '',
    status: '',
    responsavel: '',
  });

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    try {
      const dados = await carregarDadosProcessos({
        incluirEntrevistas: false,
        onProcessos: (lista) => {
          setProcessos(lista);
          setCarregando(false);
        },
      });
      setProcessos(dados.processos);
      setCandidatos(dados.candidatos);
      if (dados.erros.length) setErro(dados.erros.join(' '));
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const processosEncerrados = useMemo(
    () =>
      processos
        .filter((processo) => isProcessClosed(processo))
        .filter((processo) => {
          const textoVaga = normalizarTextoComparacao(processo.vaga);
          const textoStatus = normalizarTextoComparacao(processo.status);
          const textoResponsavel = normalizarTextoComparacao(obterResponsavelProcesso(processo));
          const dataEncerramento = String(
            processo.data_encerramento_real ||
            processo.encerrado_em ||
            processo.data_encerramento ||
            '',
          );
          if (filtros.vaga && !textoVaga.includes(normalizarTextoComparacao(filtros.vaga))) return false;
          if (filtros.status && !textoStatus.includes(normalizarTextoComparacao(filtros.status))) return false;
          if (filtros.responsavel && !textoResponsavel.includes(normalizarTextoComparacao(filtros.responsavel))) return false;
          if (filtros.periodo && !dataEncerramento.startsWith(filtros.periodo)) return false;
          return true;
        }),
    [filtros, processos],
  );
  const candidatosComFluxo = useMemo(
    () => candidatos.map((candidato) => montarCandidatoDeFluxo(candidato)),
    [candidatos],
  );
  const agora = new Date();
  const mesAtual = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  const encerradosNoMes = processosEncerrados.filter((processo) =>
    String(processo.data_encerramento_real || processo.encerrado_em || processo.data_encerramento || '').startsWith(mesAtual),
  ).length;
  const contratacoesFinais = candidatosComFluxo.filter(
    (candidato) =>
      canonicalizeCandidateStatus(candidato.status_fluxo || candidato.status_candidato) ===
      CANDIDATE_STATUS_APPROVED,
  ).length;
  const duracoes = processosEncerrados
    .map((processo) => {
      const inicio = obterDataValor(processo.data_criacao);
      const fim = obterDataValor(processo.data_encerramento_real || processo.encerrado_em || processo.data_encerramento);
      if (!inicio || !fim) return null;
      return Math.max(0, Math.ceil((fim.getTime() - inicio.getTime()) / 86400000));
    })
    .filter((valor) => valor !== null);
  const mediaDuracao = duracoes.length
    ? `${Math.round(duracoes.reduce((soma, valor) => soma + valor, 0) / duracoes.length)} dias`
    : null;
  const opcoesVagaProcessos = useMemo(
    () => obterOpcoesTextoUnicas(processos.filter((processo) => isProcessClosed(processo)), 'vaga'),
    [processos],
  );
  const opcoesStatusProcessos = useMemo(
    () => obterOpcoesTextoUnicas(processos.filter((processo) => isProcessClosed(processo)), 'status'),
    [processos],
  );

  const abrirDetalhe = (processo) => {
    sessionStorage.setItem(CHAVE_PROCESSO_DETALHE, obterReferenciaProcessoSeguro(processo));
    controlador.irParaTelaProtegida('screen-process-details');
  };

  const duplicarProcesso = (processo) => {
    sessionStorage.setItem(
      CHAVE_DUPLICAR_PROCESSO,
      JSON.stringify({
        vaga: processo.vaga || '',
        operacao: processo.operacao || '',
        trilha: processo.trilha || '',
        usaNotaCorte: Boolean(Number(processo.usa_nota_corte || 0)),
        notaCorte: processo.nota_corte || '',
      }),
    );
    controlador.irParaTelaProtegida('screen-process-create');
  };

  return html`
    <${PainelRh}
      screenId="screen-processes-closed"
      navAtiva="screen-processes-closed"
      subtituloMarca="Processos seletivos"
      placeholderBusca="Processos encerrados"
      controlador=${controlador}
    >
      <${PageIntro}
        kicker="Processos"
        title="Processos Encerrados"
        description="Consulte processos finalizados e histórico de encerramento."
      />
      ${erro ? html`<div class="rh-inline-alert">${erro}</div>` : null}

      <${SectionCard} title="Indicadores">
        <${MetricGrid}
          items=${[
      { label: 'Total Encerrado', value: processosEncerrados.length, icon: 'inventory_2', variant: 'is-eliminated' },
      { label: 'Encerrados no Mês', value: encerradosNoMes, icon: 'calendar_month' },
      { label: 'Contratações Finais', value: contratacoesFinais, icon: 'verified', variant: 'is-approved' },
      mediaDuracao ? { label: 'Média de Duração', value: mediaDuracao, icon: 'timer' } : null,
    ].filter(Boolean)}
        />
      </${SectionCard}>

      <${SectionCard} title="Filtros" className="process-filter-panel">
        <div class="rh-filter-grid rh-filter-grid--wide">
          <div class="rh-filter-field">
            <label>Vaga</label>
            <select
              class="form-select"
              value=${filtros.vaga}
              onChange=${(event) => setFiltros({ ...filtros, vaga: event.target.value })}
            >
              ${renderizarOpcoesFiltro(opcoesVagaProcessos)}
            </select>
          </div>
          <div class="rh-filter-field">
            <label>Período</label>
            <input class="form-control" type="month" value=${filtros.periodo} onInput=${(event) => setFiltros({ ...filtros, periodo: event.target.value })} />
          </div>
          <div class="rh-filter-field">
            <label>Status</label>
            <select
              class="form-select"
              value=${filtros.status}
              onChange=${(event) => setFiltros({ ...filtros, status: event.target.value })}
            >
              ${renderizarOpcoesFiltro(opcoesStatusProcessos)}
            </select>
          </div>
          <div class="rh-filter-field">
            <label>Responsável</label>
            <input class="form-control" value=${filtros.responsavel} onInput=${(event) => setFiltros({ ...filtros, responsavel: event.target.value })} />
          </div>
        </div>
      </${SectionCard}>

      <${SectionCard} title="Tabela">
        <div class="table-responsive">
          <table class="table align-middle rh-modern-history-table process-wide-table">
            <thead>
              <tr>
                <th>Processo</th>
                <th>Vaga</th>
                <th>Data de Abertura</th>
                <th>Data de Encerramento</th>
                <th>Duração</th>
                <th>Quantidade de Candidatos</th>
                <th>Aprovado Final</th>
                <th class="text-end">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${carregando
      ? html`<${SkeletonTableRows} colunas=${8} linhas=${6} />`
      : processosEncerrados.length
        ? processosEncerrados.map((processo) => {
          const candidatosProcesso = obterCandidatosDoProcesso(candidatosComFluxo, processo);
          const aprovados = candidatosProcesso.filter(
            (candidato) =>
              canonicalizeCandidateStatus(candidato.status_fluxo || candidato.status_candidato) ===
              CANDIDATE_STATUS_APPROVED,
          );
          return html`
                        <tr key=${obterChaveProcesso(processo)}>
                          <td class="process-code-cell">
                            <strong title=${obterTooltipProcessoUsuario(processo)}>
                              ${obterCodigoProcessoUsuario(processo)}
                            </strong>
                            ${processo.urgente
              ? html`<span class="process-urgent-badge" title="Botão Vaga Urgente: contratação urgente">Urgente</span>`
              : null}
                            <span>${processo.data_criacao ? `Criado em ${formatarDataCurta(processo.data_criacao)}` : processo.vaga || '-'}</span>
                          </td>
                          <td>${processo.vaga || '-'}</td>
                          <td>${formatarDataCurta(processo.data_criacao)}</td>
                          <td>${formatarDataCurta(processo.data_encerramento_real || processo.encerrado_em || processo.data_encerramento)}</td>
                          <td>${calcularDuracaoProcesso(processo)}</td>
                          <td>${candidatosProcesso.length}</td>
                          <td>${aprovados.map((item) => item.nome_candidato).filter(Boolean).join(', ') || '-'}</td>
                          <td class="text-end">
                            <div class="process-row-actions">
                              <button type="button" class="btn btn-sm btn-outline-primary process-primary-action" onClick=${() => abrirDetalhe(processo)}>
                                Ver Detalhes
                              </button>
                              <${MenuAcoesProcesso}
                                acoes=${[
              {
                label: 'Ver Dossiê',
                icon: 'article',
                onClick: () => abrirDetalhe(processo),
              },
              controlador.possuiPermissao('vagas.criar')
                ? {
                  label: 'Duplicar processo',
                  icon: 'content_copy',
                  onClick: () => duplicarProcesso(processo),
                }
                : null,
            ]}
                              />
                            </div>
                          </td>
                        </tr>
                      `;
        })
        : html`<${TabelaVazia} colunas=${8} texto="Nenhum processo encerrado encontrado." icone="inbox" />`}
            </tbody>
          </table>
        </div>
      </${SectionCard}>
    </${PainelRh}>
  `;
}

export function TelaProcessosDecisoesPendentes({ controlador }) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [processos, setProcessos] = useState([]);
  const [candidatos, setCandidatos] = useState([]);

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    try {
      const dados = await carregarDadosProcessos({
        incluirEntrevistas: false,
        onProcessos: (lista) => {
          setProcessos(lista);
          setCarregando(false);
        },
      });
      setProcessos(dados.processos);
      setCandidatos(dados.candidatos);
      if (dados.erros.length) setErro(dados.erros.join(' '));
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const processosPorId = useMemo(
    () =>
      processos.reduce((acc, processo) => {
        const referencia = obterReferenciaProcessoSeguro(processo);
        if (referencia) acc[referencia] = processo;
        return acc;
      }, {}),
    [processos],
  );
  const candidatosComFluxo = useMemo(
    () =>
      candidatos.map((candidato) => {
        const processo =
          processosPorId[obterReferenciaProcessoDoCandidato(candidato)];
        return montarCandidatoDeFluxo(candidato, processo?.status || '');
      }),
    [candidatos, processosPorId],
  );
  const pendentes = useMemo(
    () =>
      candidatosComFluxo.filter(
        (candidato) =>
          candidato.acoes_fluxo?.canApprove ||
          candidato.acoes_fluxo?.canEliminate ||
          candidato.acoes_fluxo?.canSendToTalentBank,
      ),
    [candidatosComFluxo],
  );
  const pendentesMaisTresDias = pendentes.filter((candidato) => {
    const data = obterDataValor(
      candidato.data_movimentacao ||
      candidato.data_atualizacao_pipeline ||
      candidato.data_prova,
    );
    return data && (Date.now() - data.getTime()) / 86400000 > 3;
  }).length;
  const processosPendentes = new Set(
    pendentes.map(obterReferenciaProcessoDoCandidato).filter(Boolean),
  ).size;
  const responsaveisPendentes = new Set(
    pendentes.map((candidato) => {
      const processo = processosPorId[obterReferenciaProcessoDoCandidato(candidato)] || {};
      return obterResponsavelProcesso(processo, candidato);
    }).filter((responsavel) => responsavel && responsavel !== 'Não informado'),
  ).size;

  const abrirDetalhe = (candidato) => {
    const processo = processosPorId[obterReferenciaProcessoDoCandidato(candidato)] || {};
    sessionStorage.setItem(
      CHAVE_PROCESSO_DETALHE,
      obterReferenciaProcessoSeguro(processo) || obterReferenciaProcessoDoCandidato(candidato),
    );
    controlador.irParaTelaProtegida('screen-process-details');
  };

  return html`
    <${PainelRh}
      screenId="screen-process-decisions"
      navAtiva="screen-process-decisions"
      subtituloMarca="Processos seletivos"
      placeholderBusca="Decisões pendentes"
      controlador=${controlador}
    >
      <${PageIntro}
        kicker="Processos"
        title="Decisões Pendentes"
      />
      ${erro ? html`<div class="rh-inline-alert">${erro}</div>` : null}

      <${SectionCard} title="Indicadores">
        <${MetricGrid}
          items=${[
      { label: 'Total Pendente', value: pendentes.length, icon: 'rule', variant: 'is-analysis' },
      { label: 'Pendentes há mais de 3 dias', value: pendentesMaisTresDias, icon: 'timer' },
      { label: 'Pendentes por Processo', value: processosPendentes, icon: 'folder_managed' },
      { label: 'Pendentes por Responsável', value: responsaveisPendentes, icon: 'supervisor_account' },
    ]}
        />
      </${SectionCard}>

      <${SectionCard} title="Lista Principal">
        <div class="table-responsive">
          <table class="table align-middle rh-modern-history-table process-wide-table">
            <thead>
              <tr>
                <th>Candidato</th>
                <th>Processo</th>
                <th>Vaga</th>
                <th>Responsável</th>
                <th>Tempo pendente</th>
                <th>Status</th>
                <th class="text-end">Ação</th>
              </tr>
            </thead>
            <tbody>
              ${carregando
      ? html`<${SkeletonTableRows} colunas=${7} linhas=${5} />`
      : pendentes.length
        ? pendentes.map((candidato) => {
          const processo = processosPorId[obterReferenciaProcessoDoCandidato(candidato)] || {};
          return html`
                        <tr key=${candidato.id_registro}>
                          <td>${candidato.nome_candidato || '-'}</td>
                          <td class="process-code-cell">
                            <strong title=${obterTooltipProcessoUsuario(processo)}>
                              ${obterCodigoProcessoUsuario(processo) !== '-'
              ? obterCodigoProcessoUsuario(processo)
              : limparCodigoProcessoUsuario(obterReferenciaProcessoDoCandidato(candidato)) || '-'}
                            </strong>
                            <span>${processo.data_criacao ? `Criado em ${formatarDataCurta(processo.data_criacao)}` : candidato.vaga || processo.vaga || '-'}</span>
                          </td>
                          <td>${candidato.vaga || processo.vaga || '-'}</td>
                          <td>${obterResponsavelProcesso(processo, candidato)}</td>
                          <td>${obterTempoPendente(candidato)}</td>
                          <td>
                            <span class=${`process-candidate-status-badge ${obterClasseStatusProcesso(candidato.status_fluxo)}`}>
                              ${candidato.status_fluxo || '-'}
                            </span>
                          </td>
                          <td class="text-end">
                            <button type="button" class="btn btn-sm btn-outline-primary" onClick=${() => abrirDetalhe(candidato)}>
                              Abrir detalhes
                            </button>
                          </td>
                        </tr>
                      `;
        })
        : html`<${TabelaVazia} colunas=${7} texto="Nenhuma decisão final pendente." icone="event_busy" />`}
            </tbody>
          </table>
        </div>
      </${SectionCard}>
    </${PainelRh}>
  `;
}

function ModalConfirmacaoEntrevista({
  candidato,
  mensagem,
  onMensagem,
  onClose,
  onEmail,
  onWhatsapp,
}) {
  return html`
    <${ModalPadrao}
      aberto=${!!candidato}
      titulo="Confirmar entrevista"
      subtitulo=${candidato?.nome_candidato || ''}
      onClose=${onClose}
    >
      ${candidato ? html`
        <div class="rh-details-body process-interview-confirmation-modal">
          <div class="process-friendly-notice">
            <span class="material-symbols-outlined">${IconeSvg('event_available')}</span>
            Entrevista em ${formatarDataCurta(candidato.data_entrevista)} às ${formatarHoraCurta(candidato.data_entrevista)}.
          </div>
          <label class="form-label">Mensagem</label>
          <textarea class="form-control" rows="6" value=${mensagem} onInput=${(event) => onMensagem(event.target.value)}></textarea>
          <p class="form-text">Você pode editar o texto antes de abrir o canal de envio.</p>
        </div>
        <footer class="rh-modal-footer">
          <button type="button" class="btn btn-outline-secondary" onClick=${onClose}>Cancelar</button>
          <button type="button" class="btn btn-outline-primary" disabled=${!candidato.email} onClick=${onEmail}>
            <span class="material-symbols-outlined">${IconeSvg('mail')}</span>Enviar por e-mail
          </button>
          <button type="button" class="btn btn-success" disabled=${!normalizarNumeroWhatsAppBrasil(candidato.whatsapp || candidato.telefone)} onClick=${onWhatsapp}>
            <span class="material-symbols-outlined">${IconeSvg('chat')}</span>Enviar por WhatsApp
          </button>
        </footer>
      ` : null}
    </${ModalPadrao}>
  `;
}

function ModalAnaliseCvProcesso({
  aberto,
  processoEncerrado,
  arquivoCv,
  guardarOriginal,
  analisando,
  erro,
  mensagem,
  onClose,
  onArquivo,
  onGuardarOriginal,
  onAnalisar,
}) {
  return html`
    <${ModalPadrao}
      aberto=${aberto}
      titulo="Adicionar candidato"
      subtitulo="Envie um currículo para análise e vinculação ao processo."
      className="process-preanalysis-modal-dialog"
      onClose=${onClose}
    >
      <div class="process-cv-modal-content">
        <div class="process-cv-modal-intro"><span class="material-symbols-outlined">${IconeSvg('document_scanner')}</span><div><strong>Analisar currículo</strong><p>Se o candidato for qualificado, ele entra em Candidatos no processo. Caso contrário, ficará disponível em CVs não qualificados para eventual uso manual pelo RH.</p></div></div>
        <label class=${`process-cv-picker ${processoEncerrado || analisando ? 'is-disabled' : ''}`.trim()}>
          <input key=${arquivoCv?.name || 'novo-cv-processo'} type="file" class="process-cv-native-input" accept=".pdf,.doc,.docx" disabled=${processoEncerrado || analisando} onChange=${(event) => onArquivo(event.target.files?.[0] || null)} />
          <span class="material-symbols-outlined">${IconeSvg('upload_file')}</span>
          <span class="process-cv-picker-copy"><strong>Selecionar CV</strong><small>${arquivoCv?.name || 'PDF, DOC ou DOCX'}</small></span>
        </label>
        <label class="process-cv-keep-original"><input type="checkbox" checked=${guardarOriginal} disabled=${analisando} onChange=${(event) => onGuardarOriginal(event.target.checked)} /><span class="process-cv-toggle-box" aria-hidden="true"></span><span>Guardar CV original</span></label>
        ${erro ? html`<div class="alert alert-warning mb-0">${erro}</div>` : null}
        ${mensagem ? html`<div class="alert alert-success mb-0">${mensagem}</div>` : null}
      </div>
      <footer class="rh-modal-footer"><button type="button" class="btn btn-outline-secondary" disabled=${analisando} onClick=${onClose}>Cancelar</button><button type="button" class="btn btn-primary" disabled=${processoEncerrado || analisando || !arquivoCv} onClick=${onAnalisar}><span class="material-symbols-outlined">${IconeSvg('auto_awesome')}</span>${processoEncerrado ? 'Processo encerrado' : analisando ? 'Analisando...' : 'Analisar e adicionar'}</button></footer>
    </${ModalPadrao}>
  `;
}

// Roadmap de expansao (respostas.txt): "Kanban de vagas com scorecard".
// Colunas = etapas reais do funil de selecao (rh_api/services/process_flow.py).
// Status operacionais de entrevista sem coluna propria (Pendente, Confirmado,
// Reagendado, Não respondeu, Cancelado, Faltou) entram na coluna "Agendado",
// que representa a etapa de entrevista como um todo. Desistente e Banco de
// talentos entram na coluna "Eliminado" (ambos encerram o fluxo sem
// aprovação). Decisão de produto documentada aqui por não haver uma coluna
// dedicada a cada status secundário no roadmap aprovado.
const COLUNAS_KANBAN_CANDIDATOS = [
  { status: CANDIDATE_STATUS_ANALYSIS, label: 'Em análise' },
  { status: CANDIDATE_STATUS_QUALIFIED, label: 'Qualificado' },
  { status: CANDIDATE_STATUS_SCHEDULED, label: 'Entrevista agendada' },
  { status: CANDIDATE_STATUS_ATTENDED, label: 'Compareceu' },
  { status: CANDIDATE_STATUS_APPROVED, label: 'Aprovado' },
  { status: CANDIDATE_STATUS_ELIMINATED, label: 'Eliminado' },
];

const CRITERIOS_SCORECARD_PADRAO = [
  'Comunicação',
  'Fit técnico',
  'Experiência relevante',
];

function obterColunaKanbanCandidato(candidato) {
  const status = canonicalizeCandidateStatus(
    candidato?.status_fluxo || candidato?.status_candidato,
  );

  if (COLUNAS_KANBAN_CANDIDATOS.some((coluna) => coluna.status === status)) {
    return status;
  }

  if (
    [
      CANDIDATE_STATUS_PENDING_CONFIRMATION,
      CANDIDATE_STATUS_CONFIRMED,
      CANDIDATE_STATUS_RESCHEDULED,
    ].includes(status)
  ) {
    return CANDIDATE_STATUS_SCHEDULED;
  }

  if ([CANDIDATE_STATUS_WITHDREW, CANDIDATE_STATUS_TALENT_BANK].includes(status)) {
    return CANDIDATE_STATUS_ELIMINATED;
  }

  return CANDIDATE_STATUS_ANALYSIS;
}

function calcularMediaScorecard(itensScorecard = []) {
  if (!itensScorecard.length) return null;
  const soma = itensScorecard.reduce((total, item) => total + (Number(item.nota) || 0), 0);
  return soma / itensScorecard.length;
}

function ModalScorecardCandidato({
  aberto,
  candidato,
  etapa,
  criterios,
  carregando,
  salvando,
  erro,
  onClose,
  onSalvar,
}) {
  const [notas, setNotas] = useState({});
  const [comentarios, setComentarios] = useState({});

  useEffect(() => {
    if (!aberto) return;
    const notasIniciais = {};
    const comentariosIniciais = {};
    (criterios || []).forEach((item) => {
      notasIniciais[item.criterio] = item.nota || 3;
      comentariosIniciais[item.criterio] = item.comentario || '';
    });
    setNotas(notasIniciais);
    setComentarios(comentariosIniciais);
  }, [aberto, candidato?.id_registro, JSON.stringify(criterios)]);

  const salvar = () => {
    const payload = {
      etapa_avaliada: etapa,
      criterios: CRITERIOS_SCORECARD_PADRAO.map((criterio) => ({
        criterio,
        nota: Number(notas[criterio]) || 3,
        comentario: comentarios[criterio] || '',
      })),
    };
    onSalvar(payload);
  };

  return html`
    <${ModalPadrao}
      aberto=${aberto}
      titulo="Scorecard do candidato"
      subtitulo=${`${candidato?.nome_candidato || 'Candidato'} • ${etapa || 'Etapa atual'}`}
      onClose=${onClose}
    >
      ${carregando
      ? html`<${LoadingState} titulo="Carregando scorecard" descricao="Buscando avaliações registradas para esta etapa." />`
      : html`
            <div class="process-scorecard-form">
              ${CRITERIOS_SCORECARD_PADRAO.map(
        (criterio) => html`
                  <div key=${criterio} class="process-scorecard-criterion">
                    <div class="process-scorecard-criterion-head">
                      <strong>${criterio}</strong>
                      <span class="process-scorecard-nota-valor">${notas[criterio] || 3}/5</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="5"
                      step="1"
                      value=${notas[criterio] || 3}
                      onInput=${(event) =>
            setNotas({ ...notas, [criterio]: Number(event.target.value) })}
                    />
                    <textarea
                      class="form-control"
                      rows="2"
                      placeholder="Comentário opcional"
                      value=${comentarios[criterio] || ''}
                      onInput=${(event) =>
            setComentarios({ ...comentarios, [criterio]: event.target.value })}
                    ></textarea>
                  </div>
                `,
      )}
              ${erro ? html`<div class="rh-inline-alert">${erro}</div>` : null}
            </div>
          `}
      <footer class="rh-modal-footer">
        <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${onClose}>
          Cancelar
        </button>
        <button type="button" class="btn btn-primary" disabled=${salvando || carregando} onClick=${salvar}>
          ${salvando ? 'Salvando...' : 'Salvar scorecard'}
        </button>
      </footer>
    </${ModalPadrao}>
  `;
}

function KanbanCandidatosProcesso({
  candidatos,
  processo,
  processoEncerrado,
  onMoverStatus,
  onAbrirAprovacao,
  onAbrirEliminacao,
}) {
  const [mediasScorecard, setMediasScorecard] = useState({});
  const [candidatoArrastado, setCandidatoArrastado] = useState(null);
  const [colunaEmHover, setColunaEmHover] = useState('');
  const [movendoId, setMovendoId] = useState('');
  const [toast, setToast] = useState(null);
  const [modalScorecard, setModalScorecard] = useState(null);
  const [historicoScorecard, setHistoricoScorecard] = useState([]);
  const [carregandoScorecard, setCarregandoScorecard] = useState(false);
  const [salvandoScorecard, setSalvandoScorecard] = useState(false);
  const [erroScorecard, setErroScorecard] = useState('');

  useEffect(() => {
    let cancelado = false;

    const carregarMedias = async () => {
      const ids = candidatos
        .map((item) => item.id_registro)
        .filter((id) => id !== undefined && id !== null);

      const resultados = await Promise.all(
        ids.map(async (id) => {
          try {
            const historico = await lerScorecardCandidato(id);
            return [id, calcularMediaScorecard(Array.isArray(historico) ? historico : [])];
          } catch (error) {
            return [id, null];
          }
        }),
      );

      if (cancelado) return;
      setMediasScorecard(Object.fromEntries(resultados));
    };

    if (candidatos.length) {
      carregarMedias();
    } else {
      setMediasScorecard({});
    }

    return () => {
      cancelado = true;
    };
  }, [candidatos]);

  const colunas = useMemo(
    () =>
      COLUNAS_KANBAN_CANDIDATOS.map((coluna) => ({
        ...coluna,
        itens: candidatos.filter(
          (candidato) => obterColunaKanbanCandidato(candidato) === coluna.status,
        ),
      })),
    [candidatos],
  );

  const iniciarArraste = (candidato) => {
    if (processoEncerrado) return;
    setCandidatoArrastado(candidato);
  };

  const finalizarArraste = () => {
    setCandidatoArrastado(null);
    setColunaEmHover('');
  };

  const soltarNaColuna = async (coluna) => {
    setColunaEmHover('');
    const candidato = candidatoArrastado;
    setCandidatoArrastado(null);
    if (!candidato || processoEncerrado) return;

    const colunaAtual = obterColunaKanbanCandidato(candidato);
    if (colunaAtual === coluna.status) return;

    const estadoAcoes = getCandidateActionState(candidato, processo?.status || '');
    if (!estadoAcoes.canMoveCandidate) {
      setToast({
        tom: 'warning',
        mensagem: 'Este candidato não permite movimentação no momento (processo encerrado ou fluxo finalizado).',
      });
      return;
    }

    if (coluna.status === CANDIDATE_STATUS_APPROVED) {
      onAbrirAprovacao?.(candidato);
      return;
    }

    if (coluna.status === CANDIDATE_STATUS_ELIMINATED) {
      onAbrirEliminacao?.(candidato);
      return;
    }

    const id = candidato.id_registro;
    setMovendoId(String(id));
    try {
      const sucesso = await onMoverStatus?.(id, coluna.status);
      if (!sucesso) {
        setToast({
          tom: 'danger',
          mensagem: 'Não foi possível mover o candidato para esta etapa. O card voltou para a coluna original.',
        });
      }
    } catch (error) {
      setToast({
        tom: 'danger',
        mensagem: error?.message || 'Não foi possível mover o candidato para esta etapa.',
      });
    } finally {
      setMovendoId('');
    }
  };

  const abrirScorecard = async (candidato) => {
    const etapa = obterColunaKanbanCandidato(candidato);
    const etapaLabel =
      COLUNAS_KANBAN_CANDIDATOS.find((coluna) => coluna.status === etapa)?.label || etapa;
    setModalScorecard({ candidato, etapa: etapaLabel });
    setCarregandoScorecard(true);
    setErroScorecard('');
    setHistoricoScorecard([]);

    try {
      const historico = await lerScorecardCandidato(candidato.id_registro);
      const registros = Array.isArray(historico) ? historico : [];
      const daEtapa = registros.filter((item) => item.etapa_avaliada === etapaLabel);
      setHistoricoScorecard(daEtapa.length ? daEtapa : registros);
    } catch (error) {
      setErroScorecard(error?.message || 'Não foi possível carregar o scorecard deste candidato.');
    } finally {
      setCarregandoScorecard(false);
    }
  };

  const salvarScorecard = async (payload) => {
    if (!modalScorecard?.candidato) return;
    setSalvandoScorecard(true);
    setErroScorecard('');

    try {
      await salvarScorecardCandidato(modalScorecard.candidato.id_registro, payload);
      setMediasScorecard((anterior) => ({
        ...anterior,
        [modalScorecard.candidato.id_registro]: calcularMediaScorecard(payload.criterios),
      }));
      setModalScorecard(null);
    } catch (error) {
      setErroScorecard(error?.message || 'Não foi possível salvar o scorecard.');
    } finally {
      setSalvandoScorecard(false);
    }
  };

  return html`
    <div class="process-kanban-wrap">
      ${toast
      ? html`
            <${ToastAlert}
              tone=${toast.tom === 'danger' ? 'danger' : 'warning'}
              message=${toast.mensagem}
              onClose=${() => setToast(null)}
            />
          `
      : null}
      <div class="process-kanban-board" data-tour-id="process-candidates-kanban">
        ${colunas.map(
        (coluna) => html`
            <section
              key=${coluna.status}
              class=${`process-kanban-column ${colunaEmHover === coluna.status ? 'is-drop-target' : ''}`}
              onDragOver=${(event) => {
            event.preventDefault();
            if (colunaEmHover !== coluna.status) setColunaEmHover(coluna.status);
          }}
              onDragLeave=${() => setColunaEmHover('')}
              onDrop=${(event) => {
            event.preventDefault();
            soltarNaColuna(coluna);
          }}
            >
              <header class="process-kanban-column-header">
                <strong>${coluna.label}</strong>
                <span class="process-kanban-column-count">${coluna.itens.length}</span>
              </header>
              <div class="process-kanban-column-body">
                ${coluna.itens.length
            ? coluna.itens.map((candidato) => {
              const id = String(candidato.id_registro || '');
              const media = mediasScorecard[candidato.id_registro];
              return html`
                        <article
                          key=${id}
                          class=${`process-kanban-card ${movendoId === id ? 'is-moving' : ''}`}
                          draggable=${!processoEncerrado}
                          onDragStart=${() => iniciarArraste(candidato)}
                          onDragEnd=${finalizarArraste}
                          onClick=${() => abrirScorecard(candidato)}
                          title="Clique para registrar o scorecard desta etapa"
                        >
                          <div class="process-kanban-card-head">
                            <span class="process-avatar">${obterIniciaisCandidato(candidato.nome_candidato)}</span>
                            <strong>${candidato.nome_candidato || '-'}</strong>
                          </div>
                          <div class="process-kanban-card-meta">
                            ${processo?.urgente
                  ? html`<span class="process-urgent-badge" title="Botão Vaga Urgente: contratação urgente">Urgente</span>`
                  : null}
                            <span class="process-kanban-score-badge" title="Média das notas do scorecard">
                              <span class="material-symbols-outlined">${IconeSvg('star')}</span>
                              ${media === null || media === undefined ? 'Sem scorecard' : media.toFixed(1)}
                            </span>
                          </div>
                        </article>
                      `;
            })
            : html`<div class="process-kanban-empty">Nenhum candidato nesta etapa.</div>`}
              </div>
            </section>
          `,
      )}
      </div>

      <${ModalScorecardCandidato}
        aberto=${Boolean(modalScorecard)}
        candidato=${modalScorecard?.candidato}
        etapa=${modalScorecard?.etapa}
        criterios=${historicoScorecard}
        carregando=${carregandoScorecard}
        salvando=${salvandoScorecard}
        erro=${erroScorecard}
        onClose=${() => setModalScorecard(null)}
        onSalvar=${salvarScorecard}
      />
    </div>
  `;
}

const PADRAO_MENCAO_ANOTACAO = /(?<!\w)@([a-zA-Z0-9_.-]{2,60})/g;

function renderizarTextoComMencoes(texto) {
  const valor = String(texto || '');
  if (!valor) return '';
  const partes = [];
  let ultimoIndice = 0;
  let contador = 0;
  valor.replace(PADRAO_MENCAO_ANOTACAO, (match, usuario, indice) => {
    if (indice > ultimoIndice) {
      partes.push(valor.slice(ultimoIndice, indice));
    }
    partes.push(html`<span class="dossier-note-mention" key=${`mencao-${contador++}`}>@${usuario}</span>`);
    ultimoIndice = indice + match.length;
    return match;
  });
  if (ultimoIndice < valor.length) {
    partes.push(valor.slice(ultimoIndice));
  }
  return partes;
}

function DetalhesProcessoRedesenhado({ model, state, actions }) {
  const {
    processo,
    candidatos,
    todosCandidatos,
    aprovados,
    reprovados,
    cvsNaoQualificados,
    cvsNaoQualificadosPaginacao,
    candidatosPagina,
    entrevistas,
    entrevistasPagina,
    provas,
    provasPagina,
    dossie,
    historico,
    bancoTalentos,
    bancoTalentosPagina,
    sugeridosProcesso,
    carregandoSugeridos,
    preAnalises,
    emails,
    requisitos,
    responsabilidades,
    resumo,
    processoEncerrado,
    anotacoesDossie,
    formularioAnotacaoDossie,
    anotacaoDossieEditandoId,
    salvandoAnotacaoDossie,
    erroDossie,
    mensagemDossie,
  } = model;
  const {
    aba,
    selecionados,
    buscaCandidatos,
    filtroStatusCandidatos,
    ordenacaoCandidatos,
    exibicaoCandidatos,
    visualizacaoCandidatos,
    filtrosEntrevistas,
    filtrosProvas,
    buscaTalentos,
    filtrosTalentos,
    subAbaEncontrar,
    resumoVagaAberto,
  } = state;
  const todosPaginaMarcados = candidatosPagina.itens.length > 0 &&
    candidatosPagina.itens.every((item) =>
      selecionados.includes(String(item.id_registro || item.id_teste || '')),
    );
  const hoje = formatarIsoDataLocal(new Date());
  const entrevistasHoje = entrevistas.filter((item) =>
    formatarIsoDataLocal(item.data_entrevista) === hoje,
  ).length;
  const provasConcluidas = todosCandidatos.filter(candidatoTemProvaConcluida).length;
  const decisoesPendentes = candidatos.filter((item) => {
    const status = normalizarTextoComparacao(item.status_fluxo || item.status_candidato);
    return status.includes('pendente') || status.includes('compareceu') || status.includes('decis');
  }).length;
  const datas = {
    publicacao: processo?.data_publicacao || processo?.data_criacao || processo?.criado_em,
    inscricao: processo?.data_limite_inscricao || processo?.data_encerramento,
    contratacao: processo?.data_prevista_contratacao || processo?.data_contratacao || processo?.data_admissao,
  };
  const abas = [
    ['candidatos', 'Candidatos no processo'],
    ['aprovados', `Aprovados (${aprovados.length})`],
    ['reprovados', `Reprovados (${reprovados.length})`],
    ['dossie', 'Dossiê do processo'],
    ['entrevistas', 'Entrevistas'],
    ['provas', 'Provas'],
    ['historico', 'Histórico'],
    ['encontrar', 'Encontrar candidatos'],
  ];
  const termoEncontrar = normalizarTextoComparacao(buscaTalentos);
  const cvsNaoQualificadosFiltrados = cvsNaoQualificados.filter((item) => {
    if (!termoEncontrar) return true;
    return [
      item.nome_candidato,
      item.email,
      item.telefone,
      item.nome_arquivo,
      item.classificacao,
      obterMotivoNaoQualificacao(item),
    ].map(normalizarTextoComparacao).join(' ').includes(termoEncontrar);
  });
  const secoesResumoVaga = [
    {
      titulo: 'Identificação da vaga',
      itens: [
        ['Publicação', formatarDataCurta(datas.publicacao)],
        ['Inscrições até', formatarDataCurta(datas.inscricao)],
        ['Contratação prevista', formatarDataCurta(datas.contratacao)],
        ['Cliente / operação', processo?.cliente || processo?.operacao],
        ['Área', processo?.area || processo?.trilha],
        ['Cargo', processo?.cargo || processo?.vaga],
        ['Quantidade de vagas', processo?.quantidade_vagas],
      ],
    },
    {
      titulo: 'Condições',
      itens: [
        ['Contratação', processo?.tipo_contratacao || processo?.regime_contratacao],
        ['Localidade', processo?.localidade || processo?.cidade],
        ['Modalidade', processo?.modalidade],
        ['Jornada / horário', processo?.jornada || processo?.horario],
        ['Salário / faixa', processo?.salario || processo?.faixa_salarial],
        ['Benefícios', processo?.beneficios],
      ],
    },
    {
      titulo: 'Fluxo seletivo',
      itens: [
        ['Etapas do processo', processo?.etapas_processo || processo?.etapas || resumo?.etapas],
      ],
    },
  ].map((secao) => ({
    ...secao,
    itens: secao.itens.filter(([, valor]) => temValorProcesso(valor) && formatarValorResumoProcesso(valor) !== '-'),
  })).filter((secao) => secao.itens.length);
  const requisitosResumo = requisitos.filter((item) => item.visivel !== false && temValorProcesso(item?.texto || item));
  const responsabilidadesResumo = responsabilidades.filter((item) => item.visivel !== false && temValorProcesso(item?.texto || item));
  const descricaoResumo = processo?.descricao_completa || processo?.descricao || processo?.observacoes_publicas_vaga;

  return html`
    <div class="process-details-page">
      <header class="process-header">
        <div class="process-header-main">
          <button type="button" class="process-back-button" aria-label="Voltar" onClick=${actions.voltar}>
            <span class="material-symbols-outlined">${IconeSvg('arrow_back')}</span>
          </button>
          <div>
            <h1>Detalhes do processo</h1>
            <div class="process-job-line">
              <h2>${processo?.vaga || 'Vaga não informada'}</h2>
              <span class=${`process-status-tag ${obterStatusClasseVisual(processo?.status)}`}>
                ${processo?.status || 'Aberto'}
              </span>
            </div>
            <div class="process-date-line">
              <span><i class="material-symbols-outlined">${IconeSvg('calendar_today')}</i>Publicada em ${formatarDataCurta(datas.publicacao)}</span>
              <span><i class="material-symbols-outlined">${IconeSvg('calendar_today')}</i>Inscrições até ${formatarDataCurta(datas.inscricao)}</span>
              <span><i class="material-symbols-outlined">${IconeSvg('calendar_today')}</i>Contratação até ${formatarDataCurta(datas.contratacao)}</span>
            </div>
          </div>
        </div>
        <div class="process-header-actions">
          ${actions.abrirResultadosAnaliticos
      ? html`
                <button type="button" class="btn btn-outline-primary" onClick=${actions.abrirResultadosAnaliticos}>
                  <span class="material-symbols-outlined">${IconeSvg('analytics')}</span>Resultados das provas
                </button>
              `
      : null}
          <button type="button" class="btn btn-outline-primary" onClick=${actions.voltar}>
            <span class="material-symbols-outlined">${IconeSvg('arrow_back')}</span>Voltar à vaga
          </button>
          <${MenuAcoesProcesso}
            acoes=${actions.acoesCabecalho || []}
            label="Ações"
            icon="expand_more"
            ariaLabel="Ações da vaga"
            className="process-header-actions-menu"
            triggerClassName="btn btn-primary process-actions-trigger"
          />
        </div>
      </header>

      <section class="process-summary-cards" aria-label="Resumo do processo">
        ${[
      ['groups', 'Candidatos no processo', candidatos.length, ''],
      ['calendar_month', 'Entrevistas hoje', entrevistasHoje, ''],
      ['assignment_turned_in', 'Provas concluídas', provasConcluidas, 'is-positive'],
      ['schedule', 'Decisões pendentes', decisoesPendentes, decisoesPendentes ? 'is-attention' : ''],
    ].map(([icon, label, value, peso]) => html`
          <article class=${`process-summary-card ${peso}`.trim()} key=${label}>
            <span class="process-summary-icon"><i class="material-symbols-outlined">${IconeSvg(icon)}</i></span>
            <div><span>${label}</span><strong>${value}</strong></div>
          </article>
        `)}
      </section>

      <nav class="process-tabs" aria-label="Seções do processo">
        ${abas.map(([valor, label]) => html`
          <button
            key=${valor}
            type="button"
            class=${aba === valor ? 'is-active' : ''}
            onClick=${() => actions.trocarAba(valor)}
          >${label}</button>
        `)}
      </nav>

      ${aba === 'candidatos' ? html`
        <section class="process-candidate-toolbar">
          <label class="process-search-control">
            <span class="material-symbols-outlined">${IconeSvg('search')}</span>
            <input
              value=${buscaCandidatos}
              placeholder="Buscar candidato, etapa ou palavra-chave"
              onInput=${(event) => actions.setBuscaCandidatos(event.target.value)}
            />
          </label>
          <select
            class="form-select process-compact-select"
            aria-label="Filtrar status"
            value=${filtroStatusCandidatos}
            onChange=${(event) => actions.setFiltroStatusCandidatos(event.target.value)}
          >
            <option value="">Todos os status</option>
            ${Array.from(new Set(candidatos.map((item) => item.status_fluxo || item.status_candidato).filter(Boolean))).map(
      (status) => html`<option key=${status} value=${status}>${status}</option>`,
    )}
          </select>
          <button type="button" class="btn btn-primary" onClick=${actions.aplicarFiltrosCandidatos}>
            <span class="material-symbols-outlined">${IconeSvg('filter_alt')}</span>Filtrar
          </button>
          <div class="process-view-toggle" role="group" aria-label="Alternar visualização">
            <button
              type="button"
              class=${visualizacaoCandidatos !== 'kanban' ? 'is-active' : ''}
              aria-pressed=${visualizacaoCandidatos !== 'kanban'}
              onClick=${() => actions.setVisualizacaoCandidatos('lista')}
            >
              <span class="material-symbols-outlined">${IconeSvg('view_list')}</span>Lista
            </button>
            <button
              type="button"
              class=${visualizacaoCandidatos === 'kanban' ? 'is-active' : ''}
              aria-pressed=${visualizacaoCandidatos === 'kanban'}
              onClick=${() => actions.setVisualizacaoCandidatos('kanban')}
            >
              <span class="material-symbols-outlined">${IconeSvg('view_kanban')}</span>Kanban
            </button>
          </div>
        </section>
        <section class="process-result-bar">
          <strong>${candidatos.length} resultados encontrados</strong>
          ${visualizacaoCandidatos === 'kanban' ? null : html`
            <div>
              <label>Ordenar por:
                <select value=${ordenacaoCandidatos} onChange=${(event) => actions.setOrdenacaoCandidatos(event.target.value)}>
                  <option value="nome">Nome</option><option value="nota">Nota</option><option value="status">Status</option>
                </select>
              </label>
              <label>Exibir:
                <select value=${exibicaoCandidatos} onChange=${(event) => actions.setExibicaoCandidatos(event.target.value)}>
                  <option value="todos">Todos</option><option value="com-prova">Com prova</option><option value="sem-prova">Sem prova</option>
                </select>
              </label>
            </div>
          `}
        </section>
      ` : null}

      ${aba === 'entrevistas' ? html`
        <section class="process-filter-bar process-filter-bar--interviews">
          <label><span>Nome</span><div class="process-input-icon"><i class="material-symbols-outlined">${IconeSvg('search')}</i><input value=${filtrosEntrevistas.nome} placeholder="Buscar candidato ou entrevistador" onInput=${(event) => actions.setFiltrosEntrevistas({ ...filtrosEntrevistas, nome: event.target.value })} /></div></label>
          <label><span>Status</span><select value=${filtrosEntrevistas.status} onChange=${(event) => actions.setFiltrosEntrevistas({ ...filtrosEntrevistas, status: event.target.value })}><option value="">Todos os status</option>${Array.from(new Set(model.entrevistasOriginais.map((item) => item.status_entrevista).filter(Boolean))).map((status) => html`<option key=${status} value=${status}>${status}</option>`)}</select></label>
          <label><span>Data</span><input type="date" value=${filtrosEntrevistas.data} onInput=${(event) => actions.setFiltrosEntrevistas({ ...filtrosEntrevistas, data: event.target.value })} /></label>
          <button type="button" class="btn btn-outline-primary" onClick=${actions.aplicarFiltrosEntrevistas}><span class="material-symbols-outlined">${IconeSvg('filter_alt')}</span>Filtros</button>
        </section>
      ` : null}

      ${aba === 'provas' ? html`
        <section class="process-filter-bar process-filter-bar--exams">
          <label><span>Nome</span><div class="process-input-icon"><i class="material-symbols-outlined">${IconeSvg('search')}</i><input value=${filtrosProvas.nome} placeholder="Buscar por nome do candidato" onInput=${(event) => actions.setFiltrosProvas({ ...filtrosProvas, nome: event.target.value })} /></div></label>
          <label><span>Status</span><select value=${filtrosProvas.status} onChange=${(event) => actions.setFiltrosProvas({ ...filtrosProvas, status: event.target.value })}><option value="">Todos os status</option><option>Prova disponível</option><option>Prova concluída</option><option>Prova em andamento</option><option>Prova pendente</option><option>Prova cancelada</option></select></label>
          <label><span>Nota</span><select value=${filtrosProvas.nota} onChange=${(event) => actions.setFiltrosProvas({ ...filtrosProvas, nota: event.target.value })}><option value="">Todas as notas</option><option value="com-nota">Com resultado</option><option value="aprovacao">7,0 ou mais</option><option value="abaixo">Abaixo de 7,0</option></select></label>
          <button type="button" class="btn btn-outline-primary" onClick=${actions.aplicarFiltrosProvas}><span class="material-symbols-outlined">${IconeSvg('filter_alt')}</span>Filtros</button>
          <button type="button" class="btn btn-primary" disabled=${model.processoEncerrado} onClick=${actions.abrirGeracaoProvaGeral}><span class="material-symbols-outlined">${IconeSvg('assignment_add')}</span>Liberar prova</button>
        </section>
      ` : null}

      <div class=${`process-tab-layout ${selecionados.length ? 'has-quick-actions' : ''}`}>
        <div class="process-tab-content">
          ${aba === 'candidatos' && visualizacaoCandidatos === 'kanban' ? html`
            <${KanbanCandidatosProcesso}
              candidatos=${candidatos}
              processo=${processo}
              processoEncerrado=${processoEncerrado}
              onMoverStatus=${actions.moverStatusCandidatoKanban}
              onAbrirAprovacao=${actions.abrirAprovacaoCandidato}
              onAbrirEliminacao=${actions.abrirEliminacaoCandidato}
            />
          ` : null}
          ${aba === 'candidatos' && visualizacaoCandidatos !== 'kanban' ? html`
            <div class="process-table-shell">
              <table class="process-table">
                <thead><tr><th class="is-check"><input type="checkbox" checked=${todosPaginaMarcados} onChange=${(event) => actions.selecionarPagina(event.target.checked)} /></th><th>Candidato</th><th>Notas / aderência</th><th>Status</th><th>Próxima ação</th></tr></thead>
                <tbody>
                  ${candidatosPagina.itens.length ? candidatosPagina.itens.map((candidato) => {
      const id = String(candidato.id_registro || candidato.id_teste || '');
      const nota = obterNotaVisualCandidato(candidato);
      const aderencia = obterAderenciaVisualCandidato(candidato);
      const status = obterStatusVisualCandidato(candidato);
      return html`<tr key=${id} class=${selecionados.includes(id) ? 'is-selected' : ''}>
                      <td class="is-check"><input type="checkbox" checked=${selecionados.includes(id)} onChange=${(event) => actions.selecionarCandidato(candidato, event.target.checked)} /></td>
                      <td><div class="process-candidate-cell"><span class="process-avatar">${obterIniciaisCandidato(candidato.nome_candidato)}</span><div>${candidatoTemProvaSalva(candidato) ? html`<button type="button" class="process-link-button process-candidate-name-link" onClick=${() => abrirDetalheProva(candidato)}>${candidato.nome_candidato || '-'}</button>` : html`<strong>${candidato.nome_candidato || '-'}</strong>`}<small>ID: ${candidato.id_registro || candidato.id_teste || '-'}</small></div></div></td>
                      <td><div class="process-score-cell"><div><strong>${nota.valor}</strong><small>${nota.tipo}</small></div><span class=${`process-fit-tag ${aderencia.className}`}>${aderencia.label}</span></div></td>
                      <td><span class=${`process-status-tag ${obterStatusClasseVisual(status)}`}>${status}</span></td>
                      <td><span class="process-next-action"><i class="material-symbols-outlined">${IconeSvg('arrow_circle_right')}</i>${obterProximaAcaoVisual(candidato)}</span></td>
                    </tr>`;
    }) : html`<tr><td colspan="5" class="process-empty-row">Nenhum candidato encontrado com os filtros informados.</td></tr>`}
                </tbody>
              </table>
              <${PaginacaoCompacta} paginaAtual=${candidatosPagina.paginaAtual} totalPaginas=${candidatosPagina.totalPaginas} totalItens=${candidatosPagina.totalItens} tamanhoPagina=${TAMANHO_PAGINA_CANDIDATOS_DETALHE} itensNaPagina=${candidatosPagina.itens.length} onChange=${actions.setPaginaCandidatos} />
            </div>
          ` : null}

          ${aba === 'aprovados' ? html`
            <div class="process-section-heading"><div><h3>Candidatos aprovados</h3><p>Candidatos com decisão final de aprovação neste processo.</p></div></div>
            <div class="process-table-shell"><table class="process-table"><thead><tr><th>Candidato</th><th>Nota final</th><th>Data de aprovação</th><th>Status</th><th class="is-menu"></th></tr></thead><tbody>
              ${aprovados.length ? aprovados.map((candidato) => html`<tr key=${candidato.id_registro || candidato.id_teste}><td><div class="process-candidate-cell"><span class="process-avatar">${obterIniciaisCandidato(candidato.nome_candidato)}</span><div><strong>${candidato.nome_candidato || '-'}</strong><small>ID: ${candidato.id_registro || candidato.id_teste || '-'}</small></div></div></td><td><strong>${obterNotaVisualCandidato(candidato).valor}</strong></td><td>${formatarDataHora(candidato.aprovado_em || candidato.data_atualizacao_pipeline)}</td><td><span class="process-status-tag is-success">Aprovado</span></td><td class="is-menu"><${MenuAcoesProcesso} acoes=${actions.acoesDaLinha(candidato)} /></td></tr>`) : html`<tr><td colspan="5" class="process-empty-row"><strong>Nenhum candidato aprovado até o momento.</strong><span>Os candidatos aprovados aparecerão aqui após a conclusão das etapas do processo.</span></td></tr>`}
            </tbody></table></div>
          ` : null}

          ${aba === 'reprovados' ? html`
            <div class="process-section-heading"><div><h3>Candidatos reprovados</h3><p>Somente candidatos que participaram do processo e foram eliminados ou desclassificados. Currículos que não chegaram a virar candidatos (CV não qualificado) ficam em <button type="button" class="process-link-button" onClick=${() => actions.trocarAba('candidatos')}>Candidatos no processo → CVs analisados não qualificados</button>, de onde ainda podem ser adicionados ao processo.</p></div></div>
            <div class="process-table-shell"><table class="process-table"><thead><tr><th>Candidato</th><th>Origem</th><th>Resultado</th><th>Motivo / análise</th><th>Status</th><th>Ação</th></tr></thead><tbody>
              ${reprovados.map((candidato) => { const desistente = canonicalizeCandidateStatus(candidato.status_fluxo || candidato.status_candidato) === CANDIDATE_STATUS_WITHDREW; return html`<tr key=${`reprovado-${candidato.id_registro || candidato.id_teste}`}><td><div class="process-candidate-cell"><span class="process-avatar">${obterIniciaisCandidato(candidato.nome_candidato)}</span><div><strong>${candidato.nome_candidato || '-'}</strong><small>ID: ${candidato.id_registro || candidato.id_teste || '-'}</small></div></div></td><td>${formatarOrigemCandidato(candidato)}</td><td>${obterNotaVisualCandidato(candidato).valor}</td><td>${candidato.motivo_eliminacao || (desistente ? 'Desistência do candidato' : candidato.observacao_rh) || 'Decisão registrada pelo RH'}</td><td><span class="process-status-tag is-danger">Eliminado</span></td><td><${MenuAcoesProcesso} acoes=${actions.acoesDaLinha(candidato)} /></td></tr>`; })}
              ${!reprovados.length ? html`<tr><td colspan="6" class="process-empty-row">Nenhum candidato reprovado neste processo.</td></tr>` : null}
            </tbody></table></div>
          ` : null}

          ${aba === 'entrevistas' ? html`
            <div class="process-table-shell"><table class="process-table"><thead><tr><th class="is-check"></th><th>Candidato</th><th>Data</th><th>Hora</th><th>Status</th><th class="is-menu"></th></tr></thead><tbody>
              ${entrevistasPagina.itens.length ? entrevistasPagina.itens.map((entrevista) => {
      const candidato = todosCandidatos.find((item) => Number(item.id_registro) === Number(entrevista.id_registro)) || entrevista;
      const id = String(candidato.id_registro || candidato.id_teste || '');
      return html`<tr key=${entrevista.id_entrevista || id}><td class="is-check"><input type="checkbox" checked=${selecionados.includes(id)} onChange=${(event) => actions.selecionarCandidato(candidato, event.target.checked)} /></td><td><div class="process-candidate-cell"><span class="process-avatar">${obterIniciaisCandidato(entrevista.nome_candidato)}</span><div><strong>${entrevista.nome_candidato || '-'}</strong><small>ID: ${entrevista.id_registro || entrevista.id_teste || '-'}</small></div></div></td><td><strong>${formatarDataCurta(entrevista.data_entrevista)}</strong><small class="process-cell-subtitle">${new Date(entrevista.data_entrevista).toLocaleDateString('pt-BR', { weekday: 'long' })}</small></td><td>${formatarHoraCurta(entrevista.data_entrevista)}</td><td><span class=${`process-status-tag ${obterStatusClasseVisual(entrevista.status_entrevista)}`}>${entrevista.status_entrevista || '-'}</span></td><td class="is-menu"><${MenuAcoesProcesso} acoes=${[{ label: 'Editar entrevista', icon: 'edit', onClick: () => actions.editarEntrevista(entrevista) }]} /></td></tr>`;
    }) : html`<tr><td colspan="6" class="process-empty-row">Nenhuma entrevista encontrada.</td></tr>`}
            </tbody></table><${PaginacaoCompacta} paginaAtual=${entrevistasPagina.paginaAtual} totalPaginas=${entrevistasPagina.totalPaginas} totalItens=${entrevistasPagina.totalItens} tamanhoPagina=${10} itensNaPagina=${entrevistasPagina.itens.length} onChange=${actions.setPaginaEntrevistas} /></div>
          ` : null}

          ${aba === 'provas' ? html`
            <div class="process-table-shell"><table class="process-table"><thead><tr><th class="is-check"></th><th>Candidato</th><th>Data de envio</th><th>Status</th><th>Nota / Resultado</th><th class="is-menu"></th></tr></thead><tbody>
              ${provasPagina.itens.length ? provasPagina.itens.map((candidato) => {
      const id = String(candidato.id_registro || candidato.id_teste || '');
      const status = obterTagStatusProvaCandidato(candidato);
      const nota = converterNumeroDossie(obterNotaProvaCandidato(candidato));
      return html`<tr key=${id}><td class="is-check"><input type="checkbox" checked=${selecionados.includes(id)} onChange=${(event) => actions.selecionarCandidato(candidato, event.target.checked)} /></td><td><div class="process-candidate-cell"><span class="process-avatar">${obterIniciaisCandidato(candidato.nome_candidato)}</span><div>${candidatoTemProvaSalva(candidato) ? html`<button type="button" class="process-link-button process-candidate-name-link" onClick=${() => abrirDetalheProva(candidato)}>${candidato.nome_candidato || '-'}</button>` : html`<strong>${candidato.nome_candidato || '-'}</strong>`}<small>ID: ${candidato.id_registro || candidato.id_teste || '-'}</small></div></div></td><td><strong>${formatarDataCurta(candidato.data_prova_gerada || candidato.data_prova_realizada || candidato.data_prova)}</strong><small class="process-cell-subtitle">${formatarHoraCurta(candidato.data_prova_gerada || candidato.data_prova_realizada || candidato.data_prova)}</small></td><td><span class=${`process-status-tag ${obterStatusClasseVisual(status.label)}`}>${status.label}</span></td><td><div class="process-result-cell"><strong>${nota === null ? '–' : `${formatarNumeroDossie(nota)} / 10,0`}</strong>${nota !== null ? html`<small>${Math.round(nota * 10)}%</small>` : null}</div></td><td class="is-menu"><${MenuAcoesProcesso} acoes=${actions.acoesDaLinha(candidato)} /></td></tr>`;
    }) : html`<tr><td colspan="6" class="process-empty-row">Nenhuma prova encontrada.</td></tr>`}
            </tbody></table><${PaginacaoCompacta} paginaAtual=${provasPagina.paginaAtual} totalPaginas=${provasPagina.totalPaginas} totalItens=${provasPagina.totalItens} tamanhoPagina=${10} itensNaPagina=${provasPagina.itens.length} onChange=${actions.setPaginaProvas} /></div>
          ` : null}

          ${aba === 'dossie' ? html`
            <div class="process-section-heading"><div><h3>Dossiê do processo</h3><p>Comparativo consolidado com os dados reais dos candidatos.</p></div></div>
            ${dossie.length >= 2 ? html`
              <div class="process-dossier-chart">
                <${SectionCard} title="Comparativo de notas por dimensão" className="process-dossier-chart-card">
                  <${ScoreRadarChart}
                    axes=${[
          { key: 'curriculo', label: 'Currículo' },
          { key: 'prova', label: 'Prova' },
          { key: 'entrevista', label: 'Entrevista' },
          { key: 'final', label: 'Nota final' },
        ]}
                    series=${dossie.slice(0, 4).map((item) => ({
          name: item.nome,
          values: {
            curriculo: (converterNumeroDossie(item.scoreCv) || 0) * 10,
            prova: (converterNumeroDossie(item.notaProva) || 0) * 10,
            entrevista: (converterNumeroDossie(item.raw?.nota_entrevista) || 0) * 10,
            final: (converterNumeroDossie(item.raw?.nota_final ?? item.mediaGeral) || 0) * 10,
          },
        }))}
                  />
                </${SectionCard}>
              </div>
            ` : null}
            <div class="process-table-shell"><table class="process-table process-dossier-table"><thead><tr><th>Candidato</th><th>Currículo</th><th>Prova</th><th>Entrevista</th><th>Nota final</th><th>Status</th><th>Parecer / observação</th><th>Decisão RH</th></tr></thead><tbody>
              ${dossie.length ? dossie.map((item) => html`<tr key=${item.id}><td><strong>${item.nome}</strong><small class="process-cell-subtitle">${item.email || '-'}</small></td><td>${formatarNumeroDossie(item.scoreCv)}</td><td>${formatarNumeroDossie(item.notaProva)}</td><td>${formatarNumeroDossie(item.raw?.nota_entrevista)}</td><td><strong>${formatarNumeroDossie(item.raw?.nota_final || item.mediaGeral)}</strong></td><td><span class=${`process-status-tag ${obterStatusClasseVisual(item.status)}`}>${item.status}</span></td><td>${item.raw?.parecer_rh || item.raw?.observacao_rh || '-'}</td><td>${item.raw?.decisao_rh || item.status || '-'}</td></tr>`) : html`<tr><td colspan="8" class="process-empty-row">O dossiê ainda não possui candidatos.</td></tr>`}
            </tbody></table></div>
            <section class="process-dossier-notes">
              <div><h4>Registrar parecer / observação</h4><p>O registro fica vinculado ao dossiê real deste processo.</p></div>
              ${erroDossie ? html`<div class="alert alert-warning">${erroDossie}</div>` : null}
              ${mensagemDossie ? html`<div class="alert alert-success">${mensagemDossie}</div>` : null}
              <div class="process-dossier-note-form">
                <select value=${formularioAnotacaoDossie.id_teste} onChange=${(event) => actions.selecionarCandidatoDossie(event.target.value)}>
                  <option value="">Parecer geral do processo</option>
                  ${dossie.map((item) => html`<option key=${item.id} value=${item.id_teste || item.id}>${item.nome}</option>`)}
                </select>
                <textarea rows="3" value=${formularioAnotacaoDossie.texto} placeholder="Registre o parecer do RH ou uma observação relevante. Use @usuario para mencionar alguém." onInput=${(event) => actions.atualizarCampoAnotacao('texto', event.target.value)}></textarea>
                <div><button type="button" class="btn btn-primary" disabled=${salvandoAnotacaoDossie} onClick=${actions.salvarAnotacao}>${salvandoAnotacaoDossie ? 'Salvando...' : anotacaoDossieEditandoId ? 'Atualizar parecer' : 'Salvar parecer'}</button>${anotacaoDossieEditandoId ? html`<button type="button" class="btn btn-outline-secondary" onClick=${actions.cancelarEdicaoAnotacao}>Cancelar</button>` : null}</div>
              </div>
              <div class="process-dossier-note-list">${anotacoesDossie.length ? anotacoesDossie.slice(0, 8).map((anotacao) => html`<article key=${anotacao.id_anotacao}><div><strong>${anotacao.nome_candidato || 'Processo'}</strong><p>${renderizarTextoComMencoes(anotacao.texto)}</p><small>${formatarDataHora(anotacao.atualizado_em || anotacao.criado_em)}</small></div><button type="button" class="process-link-button" onClick=${() => actions.editarAnotacao(anotacao)}>Editar</button></article>`) : html`<p class="process-empty-row">Nenhum parecer registrado.</p>`}</div>
            </section>
          ` : null}

          ${aba === 'historico' ? html`
            <div class="process-section-heading"><div><h3>Histórico do processo</h3><p>Movimentações registradas para candidatos, entrevistas e avaliações.</p></div></div>
            <div class="process-history-list">${historico.length ? historico.map((evento) => html`<article key=${evento.id}><span class="process-history-icon"><i class="material-symbols-outlined">${IconeSvg(evento.icone || 'history')}</i></span><div><strong>${evento.titulo}</strong><p>${evento.descricao}</p><small>${formatarDataHora(evento.data)}</small></div></article>`) : html`<div class="process-empty-row">Nenhuma movimentação registrada para este processo.</div>`}</div>
          ` : null}

          ${aba === 'encontrar' ? html`
            <div class="process-section-heading process-find-heading"><div><h3>Encontrar mais candidatos</h3><p>Analise novos currículos ou reutilize candidatos do Banco de Talentos.</p></div><div><button type="button" class="btn btn-outline-primary" onClick=${() => actions.trocarAba('candidatos')}>Voltar aos candidatos</button></div></div>
            <nav class="process-find-subtabs" aria-label="Fontes de candidatos"><button type="button" class=${subAbaEncontrar === 'cvs' ? 'is-active' : ''} onClick=${() => actions.setSubAbaEncontrar('cvs')}>CVs não qualificados <span>${cvsNaoQualificadosPaginacao.totalItens}</span></button><button type="button" class=${subAbaEncontrar === 'banco' ? 'is-active' : ''} onClick=${() => actions.setSubAbaEncontrar('banco')}>Banco de Talentos <span>${bancoTalentos.length}</span></button><button type="button" class=${subAbaEncontrar === 'sugeridos' ? 'is-active' : ''} onClick=${() => actions.setSubAbaEncontrar('sugeridos')}>Sugeridos para esta vaga <span>${sugeridosProcesso.length}</span></button></nav>

            ${subAbaEncontrar === 'cvs' ? html`
              <div class="process-find-toolbar"><label class="process-search-control"><span class="material-symbols-outlined">${IconeSvg('search')}</span><input value=${buscaTalentos} placeholder="Buscar por nome, e-mail, telefone ou arquivo" onInput=${(event) => actions.setBuscaTalentos(event.target.value)} /></label><strong>${cvsNaoQualificadosFiltrados.length} currículo(s)</strong></div>
              <div class="process-table-shell"><table class="process-table process-find-table"><thead><tr><th>Candidato</th><th>Contato</th><th>Nota</th><th>Classificação</th><th>Motivo da não qualificação</th><th>Ação</th></tr></thead><tbody>${cvsNaoQualificadosFiltrados.length ? cvsNaoQualificadosFiltrados.map((item) => html`<tr key=${item.id_pre_analise}><td><div class="process-candidate-cell"><span class="process-avatar">${obterIniciaisCandidato(item.nome_candidato || item.nome_arquivo)}</span><div><strong>${item.nome_candidato || 'Nome não identificado'}</strong><small>${item.nome_arquivo || '-'}</small></div></div></td><td>${item.email || item.telefone || item.whatsapp || '-'}</td><td><strong>${item.score_final ?? '-'} pts</strong></td><td><span class="process-status-tag is-danger">${item.classificacao || 'Não qualificado'}</span></td><td>${obterMotivoNaoQualificacao(item)}</td><td><button type="button" class="btn btn-sm btn-outline-primary" disabled=${Number(item.ja_adicionado_ao_processo || 0) === 1 || actions.usandoPreAnaliseId === String(item.id_pre_analise || '')} onClick=${() => actions.iniciarUsoPreAnalise(item)}>${Number(item.ja_adicionado_ao_processo || 0) === 1 ? 'Já utilizado' : 'Atrelar ao processo'}</button>${actions.preAnalisePendente === String(item.id_pre_analise || '') ? html`<${PainelIndicacaoUso} formulario=${actions.formIndicacaoPreAnalise} salvando=${actions.usandoPreAnaliseId === String(item.id_pre_analise || '')} onChange=${actions.setFormIndicacaoPreAnalise} onConfirmar=${() => actions.confirmarUsoPreAnalise(item)} onCancelar=${actions.cancelarUsoPreAnalise} />` : null}</td></tr>`) : html`<tr><td colspan="6" class="process-empty-row">Nenhum CV não qualificado encontrado.</td></tr>`}</tbody></table><${PaginacaoCompacta} paginaAtual=${cvsNaoQualificadosPaginacao.paginaAtual} totalPaginas=${cvsNaoQualificadosPaginacao.totalPaginas} totalItens=${cvsNaoQualificadosPaginacao.totalItens} tamanhoPagina=${TAMANHO_PAGINA_CVS_NAO_QUALIFICADOS} itensNaPagina=${cvsNaoQualificados.length} onChange=${actions.setPaginaCvsNaoQualificados} /></div>
              ${emails.length ? html`<section class="process-email-strip"><div><h4>E-mails relacionados</h4><span>Currículos recebidos que podem ser analisados e vinculados.</span></div><div>${emails.slice(0, 4).map((email) => html`<span key=${email.uid}><strong>${email.nome_candidato_possivel || email.remetente || '-'}</strong>${email.email_encontrado || email.assunto || '-'}</span>`)}</div></section>` : null}
            ` : null}

            ${subAbaEncontrar === 'banco' ? html`
              <section class="process-filter-bar process-talent-filters process-talent-filters--compact"><label><span>Busca</span><div class="process-input-icon"><i class="material-symbols-outlined">${IconeSvg('search')}</i><input value=${buscaTalentos} placeholder="Nome, contato, cargo ou tag" onInput=${(event) => actions.setBuscaTalentos(event.target.value)} /></div></label><label><span>Status</span><input value=${filtrosTalentos.status} placeholder="Todos" onInput=${(event) => actions.setFiltrosTalentos({ ...filtrosTalentos, status: event.target.value })} /></label><label><span>Área</span><input value=${filtrosTalentos.area} placeholder="Todas" onInput=${(event) => actions.setFiltrosTalentos({ ...filtrosTalentos, area: event.target.value })} /></label><label><span>Cargo</span><input value=${filtrosTalentos.cargo} placeholder="Todos" onInput=${(event) => actions.setFiltrosTalentos({ ...filtrosTalentos, cargo: event.target.value })} /></label><label><span>Indicação</span><select value=${filtrosTalentos.indicacao} onChange=${(event) => actions.setFiltrosTalentos({ ...filtrosTalentos, indicacao: event.target.value })}><option value="">Todas</option><option value="sim">Sim</option><option value="nao">Não</option></select></label></section>
              <div class="process-table-shell"><table class="process-table process-find-table"><thead><tr><th>Candidato</th><th>Contato</th><th>Cargo / origem</th><th>Pontuação</th><th>Situação</th><th>Ação</th></tr></thead><tbody>${bancoTalentosPagina.itens.length ? bancoTalentosPagina.itens.map((candidato) => { const vinculado = candidatoBancoJaEstaNoProcesso(candidato, todosCandidatos); return html`<tr key=${candidato.id_banco || candidato.id_teste}><td><div class="process-candidate-cell"><span class="process-avatar">${obterIniciaisCandidato(candidato.nome_candidato)}</span><div><strong>${candidato.nome_candidato || '-'}</strong><small>ID: ${candidato.id_teste || candidato.id_banco || '-'}</small></div></div></td><td>${candidato.email || candidato.telefone || candidato.whatsapp || '-'}</td><td><strong>${candidato.vaga || candidato.cargo || '-'}</strong><small class="process-cell-subtitle">${candidato.origem || 'Banco de Talentos'}</small></td><td>${candidato.pontuacao_final || candidato.nota_prova || '-'}</td><td><span class=${`process-status-tag ${vinculado ? 'is-warning' : 'is-info'}`}>${vinculado ? 'Já vinculado' : 'Disponível'}</span></td><td><button type="button" class="btn btn-sm btn-primary" disabled=${vinculado || actions.usandoTalento} onClick=${() => actions.iniciarUsoTalento(candidato)}>${vinculado ? 'Já no processo' : 'Atrelar ao processo'}</button>${actions.talentoPendente === String(candidato.id_banco || '') ? html`<${PainelIndicacaoUso} formulario=${actions.formIndicacaoTalento} salvando=${actions.usandoTalento} onChange=${actions.setFormIndicacaoTalento} onConfirmar=${actions.confirmarUsoTalento} onCancelar=${actions.cancelarUsoTalento} />` : null}</td></tr>`; }) : html`<tr><td colspan="6" class="process-empty-row">Nenhum candidato encontrado no Banco de Talentos.</td></tr>`}</tbody></table><${PaginacaoCompacta} paginaAtual=${bancoTalentosPagina.paginaAtual} totalPaginas=${bancoTalentosPagina.totalPaginas} totalItens=${bancoTalentosPagina.totalItens} tamanhoPagina=${TAMANHO_PAGINA_BANCO_TALENTOS_DETALHE} itensNaPagina=${bancoTalentosPagina.itens.length} onChange=${actions.setPaginaTalentos} /></div>
            ` : null}

            ${subAbaEncontrar === 'sugeridos' ? html`
              <div class="process-friendly-notice"><span class="material-symbols-outlined">${IconeSvg('auto_awesome')}</span>Cruza palavras-chave da vaga com o perfil de cada candidato do Banco de Talentos — sem custo, sem IA. Quem já está neste processo não aparece aqui.</div>
              ${carregandoSugeridos
          ? html`<div class="process-empty-row">Buscando sugestões para esta vaga...</div>`
          : html`<div class="process-table-shell"><table class="process-table process-find-table"><thead><tr><th>Candidato</th><th>Por que combina</th><th>Pontuação</th><th>Ação</th></tr></thead><tbody>${sugeridosProcesso.length ? sugeridosProcesso.map((candidato) => html`<tr key=${candidato.id_banco || candidato.id_teste}><td><div class="process-candidate-cell"><span class="process-avatar">${obterIniciaisCandidato(candidato.nome_candidato)}</span><div><strong>${candidato.nome_candidato || '-'}</strong><small>${candidato.vaga_anterior || candidato.origem || '-'}</small></div></div></td><td><small class="process-cell-subtitle">${candidato.motivo || '-'}</small></td><td><strong>${candidato.pontuacao_match ?? '-'}</strong></td><td><button type="button" class="btn btn-sm btn-primary" disabled=${actions.usandoTalento} onClick=${() => actions.iniciarUsoTalento(candidato)}>Atrelar ao processo</button>${actions.talentoPendente === String(candidato.id_banco || '') ? html`<${PainelIndicacaoUso} formulario=${actions.formIndicacaoTalento} salvando=${actions.usandoTalento} onChange=${actions.setFormIndicacaoTalento} onConfirmar=${actions.confirmarUsoTalento} onCancelar=${actions.cancelarUsoTalento} />` : null}</td></tr>`) : html`<tr><td colspan="4" class="process-empty-row">Nenhuma sugestão encontrada — tente ampliar os requisitos publicados da vaga.</td></tr>`}</tbody></table></div>`}
            ` : null}
          ` : null}
        </div>

        ${selecionados.length ? html`
          <aside class="quick-actions-panel"><h3>Ações rápidas</h3>${actions.acoesRapidas.map((acao) => html`<button key=${acao.label} type="button" class=${acao.danger ? 'is-danger' : acao.variant ? `is-${acao.variant}` : ''} disabled=${acao.disabled} title=${acao.title || acao.label} onClick=${acao.onClick}><span class="material-symbols-outlined">${IconeSvg(acao.icon)}</span>${acao.label}</button>`)}</aside>
        ` : null}
      </div>

      <${ModalPadrao} aberto=${resumoVagaAberto} titulo="Resumo da vaga" subtitulo=${processo?.vaga || ''} onClose=${actions.fecharResumoVaga}>
        <div class="process-job-modal">
          <div class="process-job-modal-title"><div><h3>${processo?.vaga || '-'}</h3><span class=${`process-status-tag ${obterStatusClasseVisual(processo?.status)}`}>${processo?.status || '-'}</span></div></div>
          ${secoesResumoVaga.map((secao) => html`
            <section key=${secao.titulo}>
              <h4>${secao.titulo}</h4>
              <div class="process-job-details-grid">
                ${secao.itens.map(([label, value]) => html`<div key=${label}><span>${label}</span><strong>${formatarValorResumoProcesso(value)}</strong></div>`)}
              </div>
            </section>
          `)}
          ${requisitosResumo.length ? html`<section><h4>Requisitos</h4><ul>${requisitosResumo.map((item, index) => html`<li key=${index}>${item.texto || item}</li>`)}</ul></section>` : null}
          ${responsabilidadesResumo.length ? html`<section><h4>Responsabilidades</h4><ul>${responsabilidadesResumo.map((item, index) => html`<li key=${index}>${item.texto || item}</li>`)}</ul></section>` : null}
          ${temValorProcesso(descricaoResumo) ? html`<section><h4>Descrição completa</h4><p>${descricaoResumo}</p></section>` : null}
        </div>
        <footer class="rh-modal-footer"><button type="button" class="btn btn-primary" onClick=${actions.fecharResumoVaga}>Fechar</button></footer>
      </${ModalPadrao}>
    </div>
  `;
}

export function TelaDetalhesProcesso({ controlador }) {
  const { showToast, ToastHost } = useToast();
  const idProcesso = sessionStorage.getItem(CHAVE_PROCESSO_DETALHE) || '';
  const [carregando, setCarregando] = useState(true);
  const [salvandoEntrevista, setSalvandoEntrevista] = useState(false);
  const [erro, setErro] = useState('');
  const [processo, setProcesso] = useState(null);
  const [edicaoProcesso, setEdicaoProcesso] = useState(null);
  const [salvandoProcesso, setSalvandoProcesso] = useState(false);
  const [resumo, setResumo] = useState(null);
  const [candidatos, setCandidatos] = useState([]);
  const [entrevistas, setEntrevistas] = useState([]);
  const [slotsEntrevista, setSlotsEntrevista] = useState([]);
  const [carregandoSlotsEntrevista, setCarregandoSlotsEntrevista] = useState(false);
  const [preAnalises, setPreAnalises] = useState([]);
  const [bancoTalentosProcesso, setBancoTalentosProcesso] = useState([]);
  const [sugeridosProcesso, setSugeridosProcesso] = useState([]);
  const [carregandoSugeridos, setCarregandoSugeridos] = useState(false);
  const [sugeridosCarregados, setSugeridosCarregados] = useState(false);
  const [buscaBancoTalentos, setBuscaBancoTalentos] = useState('');
  const [paginaBancoTalentos, setPaginaBancoTalentos] = useState(1);
  const [bancoTalentosSelecionado, setBancoTalentosSelecionado] = useState('');
  const [usoBancoTalentosPendente, setUsoBancoTalentosPendente] = useState(false);
  const [formIndicacaoBanco, setFormIndicacaoBanco] = useState({
    eh_indicacao: false,
    tipo_indicacao: '',
  });
  const [usandoBancoTalentos, setUsandoBancoTalentos] = useState(false);
  const [usoPreAnalisePendente, setUsoPreAnalisePendente] = useState('');
  const [formIndicacaoPreAnalise, setFormIndicacaoPreAnalise] = useState({
    eh_indicacao: false,
    tipo_indicacao: '',
  });
  const [usandoPreAnaliseId, setUsandoPreAnaliseId] = useState('');
  const [paginaPreAnalises, setPaginaPreAnalises] = useState(1);
  const [totalPaginasPreAnalises, setTotalPaginasPreAnalises] = useState(1);
  const [totalItensPreAnalises, setTotalItensPreAnalises] = useState(0);
  const [cvsNaoQualificados, setCvsNaoQualificados] = useState([]);
  const [paginaCvsNaoQualificados, setPaginaCvsNaoQualificados] = useState(1);
  const [totalPaginasCvsNaoQualificados, setTotalPaginasCvsNaoQualificados] = useState(1);
  const [totalItensCvsNaoQualificados, setTotalItensCvsNaoQualificados] = useState(0);
  const [classificacoesPreAnalises, setClassificacoesPreAnalises] = useState([]);
  const [filtrosPreAnalises, setFiltrosPreAnalises] = useState({
    nome: '',
    scoreMin: '',
    scoreMax: '',
    classificacao: '',
    mostrarOcultos: false,
  });
  const [emailsRecebidos, setEmailsRecebidos] = useState([]);
  const [statusEmailRecebido, setStatusEmailRecebido] = useState(null);
  const [avisosSecoes, setAvisosSecoes] = useState({});
  const [anotacoesDossie, setAnotacoesDossie] = useState([]);
  const [analiseDossie, setAnaliseDossie] = useState(null);
  const [erroDossie, setErroDossie] = useState('');
  const [mensagemDossie, setMensagemDossie] = useState('');
  const [salvandoAnotacaoDossie, setSalvandoAnotacaoDossie] = useState(false);
  const [anotacaoDossieEditandoId, setAnotacaoDossieEditandoId] = useState('');
  const [formularioAnotacaoDossie, setFormularioAnotacaoDossie] = useState({
    id_teste: '',
    nome_candidato: '',
    texto: '',
  });
  const [filtrosDossie, setFiltrosDossie] = useState({
    processo: '',
    candidato: '',
    data: '',
    etapa: '',
    classificacao: '',
    status: '',
    notaMin: '',
    notaMax: '',
    scoreMin: '',
    scoreMax: '',
  });
  const [carregandoEmails, setCarregandoEmails] = useState(false);
  const [analisandoEmailUid, setAnalisandoEmailUid] = useState('');
  const [arquivoCv, setArquivoCv] = useState(null);
  const [guardarCvOriginal, setGuardarCvOriginal] = useState(false);
  const [analisandoCv, setAnalisandoCv] = useState(false);
  const [erroPreAnaliseModal, setErroPreAnaliseModal] = useState('');
  const [mensagemPreAnaliseModal, setMensagemPreAnaliseModal] = useState('');
  const [preAnaliseSelecionada, setPreAnaliseSelecionada] = useState(null);
  const [candidatoEditando, setCandidatoEditando] = useState(null);
  const [formularioCandidato, setFormularioCandidato] = useState(
    montarFormularioCandidato(null),
  );
  const [fichaCandidatoSelecionada, setFichaCandidatoSelecionada] =
    useState(null);
  const [formularioFichaCandidato, setFormularioFichaCandidato] = useState(
    montarFormularioFichaCandidato(null),
  );
  const [camposFichaAlterados, setCamposFichaAlterados] = useState({});
  const [arquivoCvFicha, setArquivoCvFicha] = useState(null);
  const [enviandoCvFicha, setEnviandoCvFicha] = useState(false);
  const [analisandoCvFicha, setAnalisandoCvFicha] = useState(false);
  const [carregandoFichaCandidato, setCarregandoFichaCandidato] = useState('');
  const [salvandoFichaCandidato, setSalvandoFichaCandidato] = useState(false);
  const [erroFichaCandidato, setErroFichaCandidato] = useState('');
  const [mensagemFichaCandidato, setMensagemFichaCandidato] = useState('');
  const [visualizacaoCv, setVisualizacaoCv] = useState(null);
  const [resultadoAnaliseSelecionado, setResultadoAnaliseSelecionado] =
    useState(null);
  const [detalheProvaSelecionado, setDetalheProvaSelecionado] = useState(null);
  const [carregandoDetalheProva, setCarregandoDetalheProva] = useState('');
  const [contextoGeracaoProva, setContextoGeracaoProva] = useState(null);
  const [acaoProcessoSensivel, setAcaoProcessoSensivel] = useState(null);
  const [justificativaAcaoProcesso, setJustificativaAcaoProcesso] = useState('');
  const [tempoPausaProcesso, setTempoPausaProcesso] = useState('');
  const [erroAcaoProcesso, setErroAcaoProcesso] = useState('');
  const [acaoProvaSensivel, setAcaoProvaSensivel] = useState(null);
  const [candidatoReconsiderar, setCandidatoReconsiderar] = useState(null);
  const [reconsiderandoCandidato, setReconsiderandoCandidato] = useState(false);
  const [liberacaoProvaSelecionada, setLiberacaoProvaSelecionada] = useState(null);
  const [agendamentoSelecionado, setAgendamentoSelecionado] = useState(null);
  const [documentosEntrevista, setDocumentosEntrevista] = useState([]);
  const [aprovacaoSelecionada, setAprovacaoSelecionada] = useState(null);
  const [salvandoAprovacao, setSalvandoAprovacao] = useState(false);
  const [enviandoCanalAprovacao, setEnviandoCanalAprovacao] = useState('');
  const [eliminacaoSelecionada, setEliminacaoSelecionada] = useState(null);
  const [aprovacaoLoteSelecionados, setAprovacaoLoteSelecionados] = useState(null);
  const [aprovandoLote, setAprovandoLote] = useState(false);
  const [motivosEliminacaoCatalogo, setMotivosEliminacaoCatalogo] = useState([]);
  const [formularioEliminacao, setFormularioEliminacao] = useState({
    motivo_eliminacao: '',
    sub_causa_eliminacao: '',
    etapa_eliminacao: '',
    observacao_eliminacao: '',
  });
  const [erroEliminacao, setErroEliminacao] = useState('');
  const [entrevistaEdicao, setEntrevistaEdicao] = useState(null);
  const [salvandoEdicaoEntrevista, setSalvandoEdicaoEntrevista] = useState(false);
  const [formularioEdicaoEntrevista, setFormularioEdicaoEntrevista] = useState({
    id_slot: '',
    status_entrevista: CANDIDATE_STATUS_PENDING_CONFIRMATION,
    observacoes_rh: '',
    mensagem_personalizada: '',
  });
  const [formularioEntrevista, setFormularioEntrevista] = useState({
    id_registro: '',
    id_processo: '',
    id_processo_ref: '',
    id_slot: '',
    data_entrevista: '',
    status_entrevista: CANDIDATE_STATUS_PENDING_CONFIRMATION,
    link_agendamento: '',
    observacoes_rh: '',
    mensagem_personalizada: '',
    email: '',
    telefone: '',
    whatsapp: '',
  });
  const [mensagemEntrevistaEditada, setMensagemEntrevistaEditada] =
    useState(false);
  const [feedbackLinkPublico, setFeedbackLinkPublico] = useState('');
  const [modalCompartilharVagaAberto, setModalCompartilharVagaAberto] = useState(false);
  const [observacoesPublicasVaga, setObservacoesPublicasVaga] = useState('');
  const [requisitosPublicos, setRequisitosPublicos] = useState(() =>
    montarItensPublicosPadrao(REQUISITOS_PUBLICOS_PADRAO),
  );
  const [responsabilidadesPublicas, setResponsabilidadesPublicas] = useState(() =>
    montarItensPublicosPadrao(RESPONSABILIDADES_PUBLICAS_PADRAO),
  );
  const [salvandoObservacoesPublicas, setSalvandoObservacoesPublicas] =
    useState(false);
  const [buscaCandidatosProcesso, setBuscaCandidatosProcesso] = useState('');
  const [paginaCandidatosProcesso, setPaginaCandidatosProcesso] = useState(1);
  const [paginaCandidatosAprovados, setPaginaCandidatosAprovados] = useState(1);
  const [abaDetalheAtiva, setAbaDetalheAtiva] = useState('candidatos');
  const [subAbaEncontrar, setSubAbaEncontrar] = useState('cvs');

  useEffect(() => {
    if (subAbaEncontrar !== 'sugeridos' || sugeridosCarregados || !idProcesso) return;
    let cancelado = false;
    setCarregandoSugeridos(true);
    lerCandidatosSugeridosProcesso(idProcesso)
      .then((resultado) => {
        if (cancelado) return;
        setSugeridosProcesso(Array.isArray(resultado?.candidatos) ? resultado.candidatos : []);
        setSugeridosCarregados(true);
      })
      .catch(() => {
        if (!cancelado) setSugeridosCarregados(true);
      })
      .finally(() => {
        if (!cancelado) setCarregandoSugeridos(false);
      });
    return () => {
      cancelado = true;
    };
  }, [subAbaEncontrar, sugeridosCarregados, idProcesso]);
  const [resumoVagaAberto, setResumoVagaAberto] = useState(false);
  const [candidatosSelecionados, setCandidatosSelecionados] = useState([]);
  const [filtroStatusCandidatos, setFiltroStatusCandidatos] = useState('');
  const [ordenacaoCandidatos, setOrdenacaoCandidatos] = useState('nome');
  const [exibicaoCandidatos, setExibicaoCandidatos] = useState('todos');
  const [visualizacaoCandidatos, setVisualizacaoCandidatos] = useState('lista');
  const [paginaEntrevistasDetalhe, setPaginaEntrevistasDetalhe] = useState(1);
  const [filtrosEntrevistasDetalhe, setFiltrosEntrevistasDetalhe] = useState({
    nome: '',
    status: '',
    data: '',
  });
  const [paginaProvasDetalhe, setPaginaProvasDetalhe] = useState(1);
  const [filtrosProvasDetalhe, setFiltrosProvasDetalhe] = useState({
    nome: '',
    status: '',
    nota: '',
  });
  const [filtrosTalentosDetalhe, setFiltrosTalentosDetalhe] = useState({
    status: '',
    area: '',
    cargo: '',
    aderencia: '',
    indicacao: '',
  });
  const [modoDossieProcessoAberto, setModoDossieProcessoAberto] = useState(false);
  const [modalPreAnaliseAberto, setModalPreAnaliseAberto] = useState(false);
  const [whatsappSelecionado, setWhatsappSelecionado] = useState(null);
  const [formularioWhatsapp, setFormularioWhatsapp] = useState({
    tipo_contato: 'contato_enviado',
    observacao: '',
    mensagem: '',
  });
  const [registrandoWhatsapp, setRegistrandoWhatsapp] = useState(false);
  const [erroWhatsapp, setErroWhatsapp] = useState('');
  const [confirmacaoEntrevistaSelecionada, setConfirmacaoEntrevistaSelecionada] = useState(null);
  const [mensagemConfirmacaoEntrevista, setMensagemConfirmacaoEntrevista] = useState('');
  const [secoesExpandidas, setSecoesExpandidas] = useState({
    paginaPublica: false,
    recebimentoEmail: true,
    candidatosInscritos: true,
    dossieProcesso: true,
    bancoTalentos: true,
    preAnaliseCv: true,
    candidatosProcesso: true,
    cvsNaoQualificados: true,
    candidatosAprovados: true,
  });

  const alternarSecao = (chave) => {
    setSecoesExpandidas((anteriores) => ({
      ...anteriores,
      [chave]: !anteriores[chave],
    }));
  };

  useEffect(() => {
    if (!feedbackLinkPublico) return undefined;

    const timeout = window.setTimeout(() => setFeedbackLinkPublico(''), 3200);
    return () => window.clearTimeout(timeout);
  }, [feedbackLinkPublico]);

  useEffect(() => {
    if (!mensagemDossie) return undefined;

    const timeout = window.setTimeout(() => setMensagemDossie(''), 3600);
    return () => window.clearTimeout(timeout);
  }, [mensagemDossie]);

  const carregarEmailsDoProcesso = async () => {
    if (!idProcesso) return;
    setCarregandoEmails(true);
    try {
      const payload = await lerEmailsRecebidosProcesso(idProcesso, 12);
      setStatusEmailRecebido(payload || null);
      setEmailsRecebidos(Array.isArray(payload?.items) ? payload.items : []);
    } catch (error) {
      setStatusEmailRecebido({
        configured: false,
        message:
          error?.message ||
          'Recebimento de e-mail ainda não configurado ou indisponível no momento.',
      });
      setEmailsRecebidos([]);
    } finally {
      setCarregandoEmails(false);
    }
  };

  const aplicarDetalhePrincipal = (detalhe = {}) => {
    if (detalhe?.processo) {
      sessionStorage.setItem(
        CHAVE_PROCESSO_DETALHE,
        obterReferenciaProcesso(detalhe.processo),
      );
    }
    setProcesso(detalhe?.processo || null);
    setObservacoesPublicasVaga(
      detalhe?.processo?.observacoes_publicas_vaga || '',
    );
    setRequisitosPublicos(
      normalizarItensPublicos(
        detalhe?.processo?.requisitos_publicos,
        'requisitos',
        REQUISITOS_PUBLICOS_PADRAO,
      ),
    );
    setResponsabilidadesPublicas(
      normalizarItensPublicos(
        detalhe?.processo?.responsabilidades_publicas,
        'responsabilidades',
        RESPONSABILIDADES_PUBLICAS_PADRAO,
      ),
    );
    setResumo(detalhe?.resumo || null);
    setCandidatos(Array.isArray(detalhe?.candidatos) ? detalhe.candidatos : []);
  };

  const carregar = async (
    pagina = 1,
    filtrosCv = filtrosPreAnalises,
    paginaNaoQualificados = paginaCvsNaoQualificados,
  ) => {
    if (!idProcesso) {
      setErro('Processo não identificado.');
      setCarregando(false);
      return;
    }

    setCarregando(true);
    setErro('');
    setAvisosSecoes({});
    let detalhePrincipalCarregado = false;

    try {
      const promessaDetalhe = lerDetalheProcesso(idProcesso).then((detalhe) => {
        detalhePrincipalCarregado = true;
        aplicarDetalhePrincipal(detalhe || {});
        setCarregando(false);
        return detalhe;
      });
      const [
        resultadoDetalhe,
        resultadoPreAnalises,
        resultadoCvsNaoQualificados,
        resultadoEntrevistas,
        resultadoSlots,
        resultadoAnotacoesDossie,
        resultadoBancoTalentos,
      ] = await Promise.allSettled([
        promessaDetalhe,
        lerPreAnalisesCv(
          idProcesso,
          pagina,
          TAMANHO_PAGINA_PRE_ANALISE_DETALHE,
          filtrosCv,
        ),
        lerPreAnalisesCv(
          idProcesso,
          paginaNaoQualificados,
          TAMANHO_PAGINA_CVS_NAO_QUALIFICADOS,
          // Correções.txt item 1: um CV dispensado não pode sumir de vez — o
          // candidato precisa continuar aparecendo aqui (com aviso de que foi
          // dispensado) para que o RH ainda consiga atrelá-lo ao processo.
          { classificacao: 'Não qualificado', mostrarOcultos: true },
        ),
        lerEntrevistas({ idProcesso }),
        lerSlotsEntrevista({ idProcesso }),
        lerAnotacoesDossieProcesso(idProcesso),
        lerBancoTalentos(),
      ]);

      if (resultadoDetalhe.status !== 'fulfilled') {
        throw resultadoDetalhe.reason;
      }

      const detalhe = resultadoDetalhe.value || {};
      const listaPreAnalises =
        resultadoPreAnalises.status === 'fulfilled'
          ? resultadoPreAnalises.value
          : {};
      const listaCvsNaoQualificados =
        resultadoCvsNaoQualificados.status === 'fulfilled'
          ? resultadoCvsNaoQualificados.value
          : {};
      const listaEntrevistas =
        resultadoEntrevistas.status === 'fulfilled'
          ? resultadoEntrevistas.value
          : [];
      const listaSlots =
        resultadoSlots.status === 'fulfilled' ? resultadoSlots.value : [];
      const listaAnotacoesDossie =
        resultadoAnotacoesDossie.status === 'fulfilled'
          ? resultadoAnotacoesDossie.value
          : [];
      const listaBancoTalentos =
        resultadoBancoTalentos.status === 'fulfilled'
          ? resultadoBancoTalentos.value
          : [];
      const novosAvisos = {};

      if (resultadoPreAnalises.status !== 'fulfilled') {
        console.error('Erro ao carregar pré-análise do processo.', resultadoPreAnalises.reason);
        novosAvisos.preAnaliseCv =
          'Não foi possível carregar a pré-análise de CV agora.';
      }

      if (resultadoCvsNaoQualificados.status !== 'fulfilled') {
        console.error(
          'Erro ao carregar CVs não qualificados.',
          resultadoCvsNaoQualificados.reason,
        );
        novosAvisos.cvsNaoQualificados =
          'Não foi possível carregar os CVs não qualificados agora.';
      }

      if (resultadoEntrevistas.status !== 'fulfilled') {
        console.error('Erro ao carregar entrevistas do processo.', resultadoEntrevistas.reason);
        novosAvisos.entrevistas =
          'Não foi possível carregar as entrevistas agora.';
      }

      if (resultadoSlots.status !== 'fulfilled') {
        console.error('Erro ao carregar horários de entrevista.', resultadoSlots.reason);
        novosAvisos.entrevistas =
          novosAvisos.entrevistas ||
          'Não foi possível carregar os horários de entrevista agora.';
      }

      if (resultadoAnotacoesDossie.status !== 'fulfilled') {
        console.error(
          'Erro ao carregar anotações do dossiê.',
          resultadoAnotacoesDossie.reason,
        );
        novosAvisos.dossieProcesso =
          'Não foi possível carregar as anotações do dossiê agora.';
      }

      if (resultadoBancoTalentos.status !== 'fulfilled') {
        console.error(
          'Erro ao carregar Banco de Talentos.',
          resultadoBancoTalentos.reason,
        );
        novosAvisos.bancoTalentos =
          'Não foi possível carregar o Banco de Talentos agora.';
      }

      aplicarDetalhePrincipal(detalhe);
      setPreAnalises(
        Array.isArray(listaPreAnalises?.items) ? listaPreAnalises.items : [],
      );
      setPaginaPreAnalises(Number(listaPreAnalises?.page || 1));
      setTotalPaginasPreAnalises(Number(listaPreAnalises?.total_pages || 1));
      setTotalItensPreAnalises(Number(listaPreAnalises?.total_items || 0));
      setCvsNaoQualificados(
        Array.isArray(listaCvsNaoQualificados?.items)
          ? listaCvsNaoQualificados.items
          : [],
      );
      setPaginaCvsNaoQualificados(
        Number(listaCvsNaoQualificados?.page || 1),
      );
      setTotalPaginasCvsNaoQualificados(
        Number(listaCvsNaoQualificados?.total_pages || 1),
      );
      setTotalItensCvsNaoQualificados(
        Number(listaCvsNaoQualificados?.total_items || 0),
      );
      setClassificacoesPreAnalises(
        Array.isArray(listaPreAnalises?.classificacoes)
          ? listaPreAnalises.classificacoes
          : [],
      );
      setEntrevistas(Array.isArray(listaEntrevistas) ? listaEntrevistas : []);
      setSlotsEntrevista(Array.isArray(listaSlots) ? listaSlots : []);
      setAnotacoesDossie(
        Array.isArray(listaAnotacoesDossie) ? listaAnotacoesDossie : [],
      );
      setBancoTalentosProcesso(
        Array.isArray(listaBancoTalentos) ? listaBancoTalentos : [],
      );
      setAvisosSecoes(novosAvisos);
    } catch (error) {
      setErro(
        error.message || 'Não foi possível carregar o detalhe do processo.',
      );
    } finally {
      if (!detalhePrincipalCarregado) setCarregando(false);
    }
  };

  const carregarSlotsEntrevistaDoProcesso = async (referenciaProcesso = '') => {
    const filtroProcesso = String(
      referenciaProcesso || obterReferenciaProcesso(processo) || idProcesso || '',
    ).trim();

    setCarregandoSlotsEntrevista(true);
    try {
      const listaSlots = await lerSlotsEntrevista({ idProcesso: filtroProcesso });
      const slotsNormalizados = Array.isArray(listaSlots)
        ? listaSlots
        : Array.isArray(listaSlots?.slots)
          ? listaSlots.slots
          : Array.isArray(listaSlots?.data)
            ? listaSlots.data
            : [];
      setSlotsEntrevista(slotsNormalizados);
    } catch (error) {
      console.error('Erro ao carregar horários de entrevista.', error);
      setSlotsEntrevista([]);
      setErro(
        error?.message || 'Não foi possível carregar os horários de entrevista agora.',
      );
    } finally {
      setCarregandoSlotsEntrevista(false);
    }
  };

  useEffect(() => {
    carregar(1);
  }, []);

  const processoEncerrado = isProcessClosed(processo);
  const perfilUsuarioAtual = normalizarTextoComparacao(
    controlador?.estado?.perfilUsuario ||
    controlador?.estado?.perfilUsuarioNome ||
    controlador?.estado?.nivelPerfilUsuario ||
    controlador?.usuarioAtual?.perfil ||
    controlador?.usuarioAtual?.role ||
    '',
  );
  const podeAbrirDossieProcesso =
    perfilUsuarioAtual.includes('gestor') ||
    perfilUsuarioAtual.includes('administrador') ||
    perfilUsuarioAtual.includes('admin') ||
    controlador?.possuiPermissao?.('relatorios.visualizar');
  const basePublicaConfigurada = useMemo(
    () =>
      String(
        processo?.public_candidate_base_url || obterBasePublicaCandidatura(),
      ).trim(),
    [processo?.public_candidate_base_url],
  );
  const urlInternaCandidatura = useMemo(
    () =>
      processo?.link_publico_slug
        ? montarUrlPublicaCandidatura(processo.link_publico_slug)
        : '',
    [processo?.link_publico_slug],
  );
  const urlPublicaCandidatura = useMemo(
    () =>
      processo?.link_publico_slug && basePublicaConfigurada
        ? montarUrlPublicaCandidatura(
          processo.link_publico_slug,
          basePublicaConfigurada,
        )
        : '',
    [processo?.link_publico_slug, basePublicaConfigurada],
  );
  const linkPublicoAtivo = Boolean(processo?.link_publico_ativo) && !processoEncerrado;
  const statusPaginaPublica = !processo?.link_publico_slug
    ? 'Não gerada'
    : linkPublicoAtivo
      ? 'Ativa'
      : 'Inativa';
  const processoPausado = normalizarTextoComparacao(processo?.status) === 'pausado';
  const possuiAlgumaPermissao = (...permissoes) => {
    if (!controlador?.possuiPermissao) return true;
    return permissoes.some((permissao) => controlador.possuiPermissao(permissao));
  };
  const textoCompartilhamentoVaga = useMemo(
    () =>
      montarTextoCompartilhamentoVaga({
        processo,
        requisitos: requisitosPublicos,
        responsabilidades: responsabilidadesPublicas,
        url: urlPublicaCandidatura || urlInternaCandidatura || '',
      }),
    [
      processo,
      requisitosPublicos,
      responsabilidadesPublicas,
      urlPublicaCandidatura,
      urlInternaCandidatura,
    ],
  );

  const abrirEdicaoProcessoDetalhe = () => {
    if (!processo) return;
    setErro('');
    setEdicaoProcesso({
      ...processo,
      data_criacao: formatarDataParaInput(processo.data_criacao || processo.criado_em || ''),
      data_encerramento: formatarDataParaInput(processo.data_encerramento || ''),
    });
  };

  const atualizarCampoEdicaoProcesso = (campo, valor) => {
    setEdicaoProcesso((atual) => ({
      ...(atual || {}),
      [campo]: valor,
    }));
  };

  const salvarEdicaoProcessoDetalhe = async () => {
    if (!edicaoProcesso) return;

    const mensagemErro = validarFormularioProcesso(
      {
        vaga: edicaoProcesso.vaga,
        quantidade: edicaoProcesso.quantidade_vagas,
        dataEncerramento: edicaoProcesso.data_encerramento,
        operacao: edicaoProcesso.operacao,
        trilha: edicaoProcesso.trilha,
        usaNotaCorte: Number(edicaoProcesso.usa_nota_corte || 0) === 1,
        notaCorte: edicaoProcesso.nota_corte,
        linkAgendamento: edicaoProcesso.link_agendamento || '',
      },
      { exigeOperacao: false, exigeTrilha: false, trilhaFixa: '' },
    );
    const referenciaProcesso =
      obterReferenciaProcesso(edicaoProcesso) || obterReferenciaProcesso(processo) || idProcesso;

    if (mensagemErro || !referenciaProcesso) {
      setErro(mensagemErro || 'Preencha os campos obrigatórios para editar o processo.');
      return;
    }

    const payload = {
      vaga: edicaoProcesso.vaga || processo?.vaga || '',
      quantidade_vagas: Number(edicaoProcesso.quantidade_vagas || 0),
      data_encerramento: edicaoProcesso.data_encerramento || '',
      operacao: edicaoProcesso.operacao || '',
      trilha: edicaoProcesso.trilha || '',
      usa_nota_corte: Number(edicaoProcesso.usa_nota_corte || 0),
      nota_corte:
        edicaoProcesso.nota_corte !== '' && edicaoProcesso.nota_corte !== null
          ? Number(edicaoProcesso.nota_corte)
          : null,
      status: edicaoProcesso.status || 'Aberto',
      link_agendamento: edicaoProcesso.link_agendamento || '',
      observacoes_publicas_vaga: edicaoProcesso.observacoes_publicas_vaga || '',
      urgente: Boolean(edicaoProcesso.urgente),
    };

    setSalvandoProcesso(true);
    setErro('');
    try {
      const resultadoAtualizacao = await atualizarProcesso(referenciaProcesso, payload);
      setProcesso((atual) => ({
        ...(atual || {}),
        ...payload,
        urgente: resultadoAtualizacao?.urgente ?? payload.urgente,
      }));
      setEdicaoProcesso(null);
      await carregar(paginaPreAnalises, filtrosPreAnalises, paginaCvsNaoQualificados);
    } catch (error) {
      setErro(error?.message || 'Não foi possível salvar as alterações do processo.');
    } finally {
      setSalvandoProcesso(false);
    }
  };

  const solicitarAcaoProcessoDetalhe = (tipo) => {
    const referenciaProcesso =
      obterReferenciaProcesso(edicaoProcesso) || obterReferenciaProcesso(processo) || idProcesso;
    if (!referenciaProcesso) {
      setErro('Processo não identificado para alteração de status.');
      return;
    }
    setJustificativaAcaoProcesso('');
    setTempoPausaProcesso('');
    setErroAcaoProcesso('');
    setAcaoProcessoSensivel({ tipo, referenciaProcesso, processo });
  };

  const executarAcaoProcessoDetalhe = async () => {
    if (!acaoProcessoSensivel?.referenciaProcesso) return;
    const { tipo, referenciaProcesso } = acaoProcessoSensivel;
    const justificativa = justificativaAcaoProcesso.trim();
    if (justificativa.length < 10) {
      setErroAcaoProcesso('Informe uma justificativa com pelo menos 10 caracteres.');
      return;
    }
    if (tipo === 'pausar' && !tempoPausaProcesso) {
      setErroAcaoProcesso('Selecione por quanto tempo a vaga ficará pausada.');
      return;
    }
    setSalvandoProcesso(true);
    setErro('');
    setErroAcaoProcesso('');
    try {
      const previsaoTerminoPausa =
        tipo === 'pausar' ? calcularPrevisaoTerminoPausa(tempoPausaProcesso) : '';
      if (tipo === 'pausar') {
        await pausarProcesso(referenciaProcesso, {
          justificativa,
          tempo_pausa: tempoPausaProcesso,
          pausa_previsao_termino: previsaoTerminoPausa,
        });
      } else if (tipo === 'retomar') {
        await retomarProcesso(referenciaProcesso, { justificativa });
      } else if (tipo === 'cancelar') {
        await cancelarProcesso(referenciaProcesso, { justificativa });
      } else {
        await encerrarProcesso(referenciaProcesso, { justificativa });
      }
      const proximoStatus =
        tipo === 'pausar'
          ? 'Pausado'
          : tipo === 'retomar'
            ? 'Aberto'
            : tipo === 'cancelar'
              ? 'Cancelado'
              : 'Encerrado';
      setProcesso((atual) => ({
        ...(atual || {}),
        status: proximoStatus,
        justificativa_status: justificativa,
        tempo_pausa: tipo === 'pausar' ? tempoPausaProcesso : '',
        pausa_previsao_termino: tipo === 'pausar' ? previsaoTerminoPausa : '',
      }));
      setEdicaoProcesso(null);
      setAcaoProcessoSensivel(null);
      setJustificativaAcaoProcesso('');
      setTempoPausaProcesso('');
      await carregar(paginaPreAnalises, filtrosPreAnalises, paginaCvsNaoQualificados);
    } catch (error) {
      setErroAcaoProcesso(error?.message || 'Não foi possível alterar o status do processo.');
    } finally {
      setSalvandoProcesso(false);
    }
  };

  const candidatosComFluxo = useMemo(
    () =>
      candidatos.map((candidato) =>
        montarCandidatoDeFluxo(candidato, processo?.status || ''),
      ),
    [candidatos, processo?.status],
  );
  const candidatosInscritos = useMemo(
    () =>
      candidatosComFluxo.filter((candidato) => {
        const origem = normalizarTextoComparacao(candidato.origem);
        const status = canonicalizeCandidateStatus(
          candidato.status_fluxo || candidato.status_candidato,
        );
        return origem.includes('pagina de candidatura') && status === CANDIDATE_STATUS_ANALYSIS;
      }),
    [candidatosComFluxo],
  );
  const candidatosOperacionais = useMemo(
    () =>
      candidatosComFluxo.filter(
        (candidato) =>
          !candidatosInscritos.some(
            (inscrito) => Number(inscrito.id_registro || 0) === Number(candidato.id_registro || 0),
          ) &&
          isActiveCandidateStatus(candidato.status_fluxo || candidato.status_candidato),
      ),
    [candidatosComFluxo, candidatosInscritos],
  );
  const candidatosAprovados = useMemo(
    () =>
      candidatosComFluxo.filter(
        (candidato) =>
          canonicalizeCandidateStatus(
            candidato.status_fluxo || candidato.status_candidato,
          ) === CANDIDATE_STATUS_APPROVED,
      ),
    [candidatosComFluxo],
  );
  const candidatosAtivosDetalhe = useMemo(
    () => candidatosComFluxo.filter((candidato) => {
      const status = canonicalizeCandidateStatus(
        candidato.status_fluxo || candidato.status_candidato,
      );
      return isActiveCandidateStatus(status);
    }),
    [candidatosComFluxo],
  );
  const candidatosReprovadosDetalhe = useMemo(
    () => candidatosComFluxo.filter((candidato) => {
      const status = canonicalizeCandidateStatus(
        candidato.status_fluxo || candidato.status_candidato,
      );
      return status === CANDIDATE_STATUS_ELIMINATED
        || status === CANDIDATE_STATUS_WITHDREW;
    }),
    [candidatosComFluxo],
  );
  const bancoTalentosDisponiveis = useMemo(
    () =>
      bancoTalentosProcesso.filter(
        (candidatoBanco) =>
          !candidatoBancoJaEstaNoProcesso(candidatoBanco, candidatosComFluxo),
      ),
    [bancoTalentosProcesso, candidatosComFluxo],
  );
  const bancoTalentosTodosFiltrados = useMemo(() => {
    const termo = normalizarTextoComparacao(buscaBancoTalentos);
    return bancoTalentosProcesso.filter((candidatoBanco) => {
      const textoBusca = [
        candidatoBanco.nome_candidato,
        candidatoBanco.email,
        candidatoBanco.telefone,
        candidatoBanco.whatsapp,
        candidatoBanco.vaga,
        candidatoBanco.origem,
        candidatoBanco.id_teste,
        candidatoBanco.id_banco,
        candidatoBanco.tipo_indicacao,
        ...(Array.isArray(candidatoBanco.tags) ? candidatoBanco.tags : []),
        ...(Array.isArray(candidatoBanco.habilidades) ? candidatoBanco.habilidades : []),
      ]
        .map(normalizarTextoComparacao)
        .join(' ');
      const status = normalizarTextoComparacao(
        candidatoBanco.status || candidatoBanco.status_candidato || candidatoBanco.status_fluxo,
      );
      const area = normalizarTextoComparacao(
        candidatoBanco.area || candidatoBanco.trilha || candidatoBanco.operacao,
      );
      const cargo = normalizarTextoComparacao(candidatoBanco.vaga || candidatoBanco.cargo);
      const aderencia = normalizarTextoComparacao(
        candidatoBanco.aderencia || candidatoBanco.classificacao || candidatoBanco.cv_classificacao,
      );
      const indicacao = candidatoBanco.eh_indicacao ? 'sim' : 'nao';
      if (termo && !textoBusca.includes(termo)) return false;
      if (filtrosTalentosDetalhe.status && !status.includes(normalizarTextoComparacao(filtrosTalentosDetalhe.status))) return false;
      if (filtrosTalentosDetalhe.area && !area.includes(normalizarTextoComparacao(filtrosTalentosDetalhe.area))) return false;
      if (filtrosTalentosDetalhe.cargo && !cargo.includes(normalizarTextoComparacao(filtrosTalentosDetalhe.cargo))) return false;
      if (filtrosTalentosDetalhe.aderencia && !aderencia.includes(normalizarTextoComparacao(filtrosTalentosDetalhe.aderencia))) return false;
      if (filtrosTalentosDetalhe.indicacao && indicacao !== filtrosTalentosDetalhe.indicacao) return false;
      return true;
    });
  }, [bancoTalentosProcesso, buscaBancoTalentos, filtrosTalentosDetalhe]);
  const bancoTalentosDisponiveisFiltrados = useMemo(
    () => bancoTalentosTodosFiltrados.filter((candidatoBanco) =>
      !candidatoBancoJaEstaNoProcesso(candidatoBanco, candidatosComFluxo),
    ),
    [bancoTalentosTodosFiltrados, candidatosComFluxo],
  );
  const bancoTalentosPaginados = useMemo(
    () =>
      obterItensPaginados(
        bancoTalentosTodosFiltrados,
        paginaBancoTalentos,
        TAMANHO_PAGINA_BANCO_TALENTOS_DETALHE,
      ),
    [bancoTalentosTodosFiltrados, paginaBancoTalentos],
  );
  const candidatoBancoSelecionado = useMemo(
    () =>
      bancoTalentosDisponiveis.find(
        (candidatoBanco) =>
          String(candidatoBanco?.id_banco || '').trim() ===
          String(bancoTalentosSelecionado || '').trim(),
      ) || null,
    [bancoTalentosDisponiveis, bancoTalentosSelecionado],
  );
  const candidatosOperacionaisFiltrados = useMemo(() => {
    const termo = normalizarTextoComparacao(buscaCandidatosProcesso);
    if (!termo) return candidatosOperacionais;

    return candidatosOperacionais.filter((candidato) => {
      const origem = formatarOrigemCandidato(candidato);
      const localidade = [candidato.cidade, candidato.bairro]
        .map((valor) => String(valor || '').trim())
        .filter(Boolean)
        .join(' ');
      const textoBusca = [
        candidato.nome_candidato,
        candidato.vaga,
        candidato.id_registro,
        candidato.id_teste,
        candidato.id_candidato,
        candidato.status_fluxo,
        origem,
        localidade,
        ...(Array.isArray(candidato.tags) ? candidato.tags : []),
      ]
        .map(normalizarTextoComparacao)
        .join(' ');
      return textoBusca.includes(termo);
    });
  }, [buscaCandidatosProcesso, candidatosOperacionais]);
  const candidatosProcessoPaginados = useMemo(
    () =>
      obterItensPaginados(
        candidatosOperacionaisFiltrados,
        paginaCandidatosProcesso,
        TAMANHO_PAGINA_CANDIDATOS_DETALHE,
      ),
    [candidatosOperacionaisFiltrados, paginaCandidatosProcesso],
  );
  const candidatosAprovadosPaginados = useMemo(
    () =>
      obterItensPaginados(
        candidatosAprovados,
        paginaCandidatosAprovados,
        TAMANHO_PAGINA_APROVADOS_DETALHE,
      ),
    [candidatosAprovados, paginaCandidatosAprovados],
  );
  const candidatosDossie = useMemo(
    () => montarCandidatosDossie(candidatosComFluxo, entrevistas),
    [candidatosComFluxo, entrevistas],
  );
  const candidatosDossieFiltrados = useMemo(
    () => filtrarCandidatosDossie(candidatosDossie, filtrosDossie),
    [candidatosDossie, filtrosDossie],
  );
  const estatisticasDossie = useMemo(
    () => calcularEstatisticasDossie(candidatosDossieFiltrados),
    [candidatosDossieFiltrados],
  );
  const candidatosTabelaDetalhe = useMemo(() => {
    const termo = normalizarTextoComparacao(buscaCandidatosProcesso);
    const statusFiltro = normalizarTextoComparacao(filtroStatusCandidatos);
    const lista = candidatosAtivosDetalhe.filter((candidato) => {
      const status = normalizarTextoComparacao(
        candidato.status_fluxo || candidato.status_candidato || candidato.status_entrevista,
      );
      const texto = [
        candidato.nome_candidato,
        candidato.id_registro,
        candidato.id_teste,
        candidato.vaga,
        candidato.etapa_pipeline,
        candidato.status_fluxo,
        candidato.status_candidato,
        obterProximaAcaoVisual(candidato),
        ...(Array.isArray(candidato.tags) ? candidato.tags : []),
      ].map(normalizarTextoComparacao).join(' ');
      if (termo && !texto.includes(termo)) return false;
      if (statusFiltro && !status.includes(statusFiltro)) return false;
      const possuiProva = Boolean(
        candidato.tem_prova_gerada || candidato.prova_disponivel || candidatoTemProvaSalva(candidato),
      );
      if (exibicaoCandidatos === 'com-prova' && !possuiProva) return false;
      if (exibicaoCandidatos === 'sem-prova' && possuiProva) return false;
      return true;
    });
    return lista.sort((a, b) => {
      if (ordenacaoCandidatos === 'nota') {
        return Number(converterNumeroDossie(obterNotaVisualCandidato(b).valor) || 0) -
          Number(converterNumeroDossie(obterNotaVisualCandidato(a).valor) || 0);
      }
      if (ordenacaoCandidatos === 'status') {
        return String(a.status_fluxo || '').localeCompare(String(b.status_fluxo || ''), 'pt-BR');
      }
      return String(a.nome_candidato || '').localeCompare(String(b.nome_candidato || ''), 'pt-BR');
    });
  }, [
    buscaCandidatosProcesso,
    candidatosAtivosDetalhe,
    exibicaoCandidatos,
    filtroStatusCandidatos,
    ordenacaoCandidatos,
  ]);
  const candidatosTabelaPaginados = useMemo(
    () => obterItensPaginados(
      candidatosTabelaDetalhe,
      paginaCandidatosProcesso,
      TAMANHO_PAGINA_CANDIDATOS_DETALHE,
    ),
    [candidatosTabelaDetalhe, paginaCandidatosProcesso],
  );
  const entrevistasTabelaDetalhe = useMemo(() => {
    const termo = normalizarTextoComparacao(filtrosEntrevistasDetalhe.nome);
    const status = normalizarTextoComparacao(filtrosEntrevistasDetalhe.status);
    const candidatosPorRegistro = new Map(candidatosComFluxo.map((candidato) => [
      String(candidato.id_registro || ''),
      candidato,
    ]));
    const candidatosPorTeste = new Map(candidatosComFluxo.map((candidato) => [
      String(candidato.id_teste || ''),
      candidato,
    ]));
    return [...entrevistas]
      .filter((entrevista) => {
        const candidato = candidatosPorRegistro.get(String(entrevista.id_registro || ''))
          || candidatosPorTeste.get(String(entrevista.id_teste || ''));
        const statusEntrevista = canonicalizeCandidateStatus(entrevista.status_entrevista);
        const statusCandidato = canonicalizeCandidateStatus(
          candidato?.status_fluxo || candidato?.status_candidato || entrevista.status_candidato_processo,
        );
        if (
          [CANDIDATE_STATUS_ELIMINATED, CANDIDATE_STATUS_WITHDREW].includes(statusEntrevista)
          || [CANDIDATE_STATUS_ELIMINATED, CANDIDATE_STATUS_WITHDREW].includes(statusCandidato)
        ) return false;
        const texto = normalizarTextoComparacao([
          entrevista.nome_candidato,
          obterResponsavelEntrevistaProcesso(entrevista),
        ].join(' '));
        if (termo && !texto.includes(termo)) return false;
        if (status && !normalizarTextoComparacao(entrevista.status_entrevista).includes(status)) return false;
        if (
          filtrosEntrevistasDetalhe.data &&
          formatarIsoDataLocal(entrevista.data_entrevista) !== filtrosEntrevistasDetalhe.data
        ) return false;
        return true;
      })
      .sort((a, b) => (new Date(b.data_entrevista).getTime() || 0) - (new Date(a.data_entrevista).getTime() || 0));
  }, [candidatosComFluxo, entrevistas, filtrosEntrevistasDetalhe]);
  const entrevistasTabelaPaginadas = useMemo(
    () => obterItensPaginados(entrevistasTabelaDetalhe, paginaEntrevistasDetalhe, 10),
    [entrevistasTabelaDetalhe, paginaEntrevistasDetalhe],
  );
  const provasTabelaDetalhe = useMemo(() => {
    const termo = normalizarTextoComparacao(filtrosProvasDetalhe.nome);
    const statusFiltro = normalizarTextoComparacao(filtrosProvasDetalhe.status);
    return candidatosComFluxo
      .filter((candidato) => {
        const statusProva = obterTagStatusProvaCandidato(candidato).label;
        const nota = converterNumeroDossie(obterNotaProvaCandidato(candidato));
        if (termo && !normalizarTextoComparacao(candidato.nome_candidato).includes(termo)) return false;
        if (statusFiltro && !normalizarTextoComparacao(statusProva).includes(statusFiltro)) return false;
        if (filtrosProvasDetalhe.nota === 'com-nota' && nota === null) return false;
        if (filtrosProvasDetalhe.nota === 'aprovacao' && (nota === null || nota < 7)) return false;
        if (filtrosProvasDetalhe.nota === 'abaixo' && (nota === null || nota >= 7)) return false;
        return Boolean(
          candidato.tem_prova_gerada ||
          candidato.prova_disponivel ||
          candidato.status_prova ||
          candidato.status_prova_gerada ||
          nota !== null,
        );
      })
      .sort((a, b) => {
        const dataA = new Date(a.data_prova_gerada || a.data_prova_realizada || a.data_prova || '').getTime() || 0;
        const dataB = new Date(b.data_prova_gerada || b.data_prova_realizada || b.data_prova || '').getTime() || 0;
        return dataB - dataA;
      });
  }, [candidatosComFluxo, filtrosProvasDetalhe]);
  const provasTabelaPaginadas = useMemo(
    () => obterItensPaginados(provasTabelaDetalhe, paginaProvasDetalhe, 10),
    [paginaProvasDetalhe, provasTabelaDetalhe],
  );
  const candidatosSelecionadosDetalhe = useMemo(
    () => candidatosComFluxo.filter((candidato) =>
      candidatosSelecionados.includes(String(candidato.id_registro || candidato.id_teste || '')),
    ),
    [candidatosComFluxo, candidatosSelecionados],
  );
  const historicoDetalhe = useMemo(
    () => montarRegistrosRecentesProcessosAbertos({
      processosAbertos: processo ? [processo] : [],
      candidatos: candidatosComFluxo,
      entrevistas,
    }),
    [candidatosComFluxo, entrevistas, processo],
  );

  useEffect(() => {
    setPaginaCandidatosProcesso(1);
  }, [buscaCandidatosProcesso, candidatosAtivosDetalhe.length]);

  useEffect(() => {
    setPaginaCandidatosAprovados(1);
  }, [candidatosAprovados.length]);

  useEffect(() => {
    setPaginaBancoTalentos(1);
  }, [buscaBancoTalentos, bancoTalentosProcesso.length, filtrosTalentosDetalhe]);

  useEffect(() => {
    setPaginaEntrevistasDetalhe(1);
  }, [filtrosEntrevistasDetalhe]);

  useEffect(() => {
    setPaginaProvasDetalhe(1);
  }, [filtrosProvasDetalhe]);

  useEffect(() => {
    if (!bancoTalentosSelecionado) return;
    const aindaDisponivel = bancoTalentosDisponiveis.some(
      (candidatoBanco) =>
        String(candidatoBanco?.id_banco || '').trim() ===
        String(bancoTalentosSelecionado || '').trim(),
    );
    if (!aindaDisponivel) {
      setBancoTalentosSelecionado('');
      setUsoBancoTalentosPendente(false);
    }
  }, [bancoTalentosDisponiveis, bancoTalentosSelecionado]);

  const ajustarPaginacaoAposRemocao = (
    setTotalItens,
    setTotalPaginas,
    setPagina,
    tamanhoPagina,
  ) => {
    setTotalItens((totalAtual) => {
      const proximoTotal = Math.max(0, Number(totalAtual || 0) - 1);
      const proximoTotalPaginas = Math.max(1, Math.ceil(proximoTotal / tamanhoPagina));
      setTotalPaginas(proximoTotalPaginas);
      setPagina((paginaAtual) =>
        Math.min(Math.max(1, Number(paginaAtual || 1)), proximoTotalPaginas),
      );
      return proximoTotal;
    });
  };

  const removerPreAnaliseLocalmente = (idPreAnalise) => {
    const id = String(idPreAnalise || '').trim();
    if (!id) return;

    const existeNasPreAnalises = preAnalises.some(
      (item) => String(item?.id_pre_analise || '') === id,
    );
    const existeNosCvsNaoQualificados = cvsNaoQualificados.some(
      (item) => String(item?.id_pre_analise || '') === id,
    );
    const recarregarPreAnalises =
      existeNasPreAnalises && preAnalises.length <= 1 && paginaPreAnalises > 1;
    const recarregarCvsNaoQualificados =
      existeNosCvsNaoQualificados &&
      cvsNaoQualificados.length <= 1 &&
      paginaCvsNaoQualificados > 1;

    if (existeNasPreAnalises) {
      setPreAnalises((atuais) =>
        atuais.filter((item) => String(item?.id_pre_analise || '') !== id),
      );
      ajustarPaginacaoAposRemocao(
        setTotalItensPreAnalises,
        setTotalPaginasPreAnalises,
        setPaginaPreAnalises,
        TAMANHO_PAGINA_PRE_ANALISE_DETALHE,
      );
    }

    if (existeNosCvsNaoQualificados) {
      setCvsNaoQualificados((atuais) =>
        atuais.filter((item) => String(item?.id_pre_analise || '') !== id),
      );
      ajustarPaginacaoAposRemocao(
        setTotalItensCvsNaoQualificados,
        setTotalPaginasCvsNaoQualificados,
        setPaginaCvsNaoQualificados,
        TAMANHO_PAGINA_CVS_NAO_QUALIFICADOS,
      );
    }

    if (recarregarPreAnalises || recarregarCvsNaoQualificados) {
      void carregar(
        recarregarPreAnalises ? Math.max(1, paginaPreAnalises - 1) : paginaPreAnalises,
        filtrosPreAnalises,
        recarregarCvsNaoQualificados
          ? Math.max(1, paginaCvsNaoQualificados - 1)
          : paginaCvsNaoQualificados,
      );
    }
  };

  useEffect(() => {
    let ativo = true;

    gerarAnaliseInteligenteProcesso({
      processo,
      candidatos: candidatosDossieFiltrados,
      anotacoes: anotacoesDossie,
      gerado_em: new Date().toISOString(),
    }).then((resultado) => {
      if (ativo) setAnaliseDossie(resultado);
    });

    return () => {
      ativo = false;
    };
  }, [processo, candidatosDossieFiltrados, anotacoesDossie]);

  const encontrarAnaliseDoInscrito = (candidato) =>
    preAnalises.find((item) => {
      const emailAnalise = normalizarTextoComparacao(item.email);
      const emailCandidato = normalizarTextoComparacao(candidato.email);
      return emailAnalise && emailCandidato && emailAnalise === emailCandidato;
    }) ||
    (candidato.cv_id_pre_analise
      ? {
        id_pre_analise: candidato.cv_id_pre_analise,
        nome_candidato: candidato.nome_candidato,
        email: candidato.email,
        telefone: candidato.telefone,
        whatsapp: candidato.whatsapp,
        score_final: candidato.cv_score_final,
        classificacao: candidato.cv_classificacao,
        classificacao_slug: candidato.cv_classificacao_slug,
        problemas: candidato.cv_problemas,
      }
      : null);
  const slotsDisponiveisEntrevista = useMemo(
    () => {
      const agora = new Date();
      return slotsEntrevista.filter(
        (slot) => {
          const statusSlot = normalizarTextoComparacao(
            slot.status_calculado || slot.status_slot || slot.status || '',
          );
          const inicioSlot = obterDataInicioSlotEntrevista(slot);
          return (
            statusSlot !== 'bloqueado'
            && statusSlot !== 'lotado'
            && obterVagasDisponiveisSlotEntrevista(slot) > 0
            && inicioSlot
            && inicioSlot > agora
          );
        },
      );
    },
    [slotsEntrevista],
  );

  const formatarHorarioSlotEntrevista = (slot) => {
    if (!slot) return '-';

    const inicio = obterDataInicioSlotEntrevista(slot);
    const fim = obterDataFimSlotEntrevista(slot);
    const vagasDisponiveis = obterVagasDisponiveisSlotEntrevista(slot);
    const rotuloVagas =
      vagasDisponiveis === 1 ? 'vaga disponível' : 'vagas disponíveis';

    if (!inicio || !fim) {
      return `${formatarDataHora(slot.inicio)} até ${formatarDataHora(slot.fim)} — ${vagasDisponiveis} ${rotuloVagas}`;
    }

    const horaInicio = inicio.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const horaFim = fim.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });

    return `${inicio.toLocaleDateString('pt-BR')} - ${horaInicio} às ${horaFim} — ${vagasDisponiveis} ${rotuloVagas}`;
  };

  const montarDataEntrevistaIso = (slot) => {
    const data = obterDataInicioSlotEntrevista(slot);
    if (!data) return '';

    const pad = (value) => String(value).padStart(2, '0');
    return [
      data.getFullYear(),
      pad(data.getMonth() + 1),
      pad(data.getDate()),
    ].join('-') + `T${pad(data.getHours())}:${pad(data.getMinutes())}:00`;
  };

  const abrirCurriculo = async (candidato) => {
    if (!candidato?.id_teste || !candidato?.cv_disponivel) {
      setErro('Currículo não encontrado para este candidato.');
      return;
    }

    try {
      const arquivo = await baixarCvCandidato(candidato.id_teste);
      const tipo = String(arquivo?.contentType || '').toLowerCase();
      if (tipo.includes('pdf')) {
        abrirBlobEmNovaGuia(arquivo.blob);
        return;
      }

      baixarBlob(arquivo.filename || 'curriculo', arquivo.blob);
    } catch (error) {
      setErro(
        error?.message || 'Não foi possível abrir o currículo do candidato.',
      );
    }
  };

  const abrirWhatsappCandidato = (candidato) => {
    const numero = normalizarNumeroWhatsAppBrasil(
      candidato?.whatsapp || candidato?.telefone,
    );
    if (!numero) {
      setErro('O candidato não possui telefone/WhatsApp válido para contato.');
      return;
    }

    const mensagem = montarMensagemWhatsAppProcesso(candidato, processo);
    window.open(
      `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`,
      '_blank',
      'noopener,noreferrer',
    );
    setErroWhatsapp('');
    setFormularioWhatsapp({
      tipo_contato: 'contato_enviado',
      observacao: '',
      mensagem,
    });
    setWhatsappSelecionado(candidato);
  };

  const atualizarCampoWhatsapp = (campo, valor) => {
    setFormularioWhatsapp((atual) => ({
      ...atual,
      [campo]: valor,
    }));
    setErroWhatsapp('');
  };

  const salvarRegistroWhatsapp = async () => {
    if (!whatsappSelecionado?.id_registro) {
      setErroWhatsapp('Candidato sem registro para salvar o contato.');
      return;
    }

    setRegistrandoWhatsapp(true);
    setErroWhatsapp('');
    try {
      await registrarWhatsappContatoManual(
        whatsappSelecionado.id_registro,
        formularioWhatsapp,
      );
      setWhatsappSelecionado(null);
      await carregar(paginaPreAnalises);
    } catch (error) {
      setErroWhatsapp(error?.message || 'Não foi possível registrar o contato WhatsApp.');
    } finally {
      setRegistrandoWhatsapp(false);
    }
  };

  const abrirFichaCandidato = async (candidato) => {
    if (!candidato?.id_teste) {
      setErro('Candidato sem identificador para abrir a ficha.');
      return;
    }

    try {
      setErro('');
      setErroFichaCandidato('');
      setMensagemFichaCandidato('');
      setCarregandoFichaCandidato(String(candidato.id_teste));
      const ficha = await lerFichaCandidato(candidato.id_teste);
      setFichaCandidatoSelecionada(ficha);
      setFormularioFichaCandidato(montarFormularioFichaCandidato(ficha));
      setCamposFichaAlterados({});
      setArquivoCvFicha(null);
    } catch (error) {
      setErro(error?.message || 'Não foi possível carregar a ficha do candidato.');
    } finally {
      setCarregandoFichaCandidato('');
    }
  };

  const abrirDetalhesCandidatoCompleto = (candidato) => {
    sessionStorage.setItem(
      CHAVE_DETALHE_CANDIDATO_RH,
      JSON.stringify(candidato || {}),
    );
    controlador.irParaTelaProtegida('screen-candidate-details');
  };

  const atualizarCampoFichaCandidato = (campo, valor) => {
    setFormularioFichaCandidato((anterior) => ({
      ...anterior,
      [campo]: valor,
    }));
    setCamposFichaAlterados((anteriores) => ({
      ...anteriores,
      [campo]: true,
    }));
    setMensagemFichaCandidato('');
  };

  const salvarFichaCandidato = async () => {
    const idTeste = fichaCandidatoSelecionada?.candidato?.id_teste ||
      fichaCandidatoSelecionada?.candidato?.id;
    if (!idTeste) return;

    setSalvandoFichaCandidato(true);
    setErroFichaCandidato('');
    setMensagemFichaCandidato('');

    try {
      const payload = { ...formularioFichaCandidato };
      if (!camposFichaAlterados.observacao_rh) {
        delete payload.observacao_rh;
      }
      const fichaAtualizada = await atualizarFichaCandidato(idTeste, payload);
      setFichaCandidatoSelecionada(fichaAtualizada);
      setFormularioFichaCandidato(montarFormularioFichaCandidato(fichaAtualizada));
      setCamposFichaAlterados({});
      setMensagemFichaCandidato('Ficha salva com sucesso.');
      await carregar(paginaPreAnalises);
    } catch (error) {
      setErroFichaCandidato(error?.message || 'Não foi possível salvar a ficha do candidato.');
    } finally {
      setSalvandoFichaCandidato(false);
    }
  };

  const enviarCvFichaCandidato = async () => {
    const idTeste = fichaCandidatoSelecionada?.candidato?.id_teste ||
      fichaCandidatoSelecionada?.candidato?.id;
    if (!idTeste) {
      setErroFichaCandidato('Candidato sem identificador para anexar currículo.');
      return;
    }
    if (!arquivoCvFicha) {
      setErroFichaCandidato('Selecione um CV para adicionar.');
      return;
    }

    const extensao = `.${String(arquivoCvFicha.name || '').split('.').pop() || ''}`.toLowerCase();
    if (!['.pdf', '.doc', '.docx'].includes(extensao)) {
      setErroFichaCandidato('Formato de currículo não suportado. Envie PDF, DOC ou DOCX.');
      return;
    }

    setEnviandoCvFicha(true);
    setErroFichaCandidato('');
    setMensagemFichaCandidato('');
    try {
      const formData = new FormData();
      formData.append('arquivo', arquivoCvFicha);
      await uploadCvCandidato(idTeste, formData);
      const fichaAtualizada = await lerFichaCandidato(idTeste);
      setFichaCandidatoSelecionada(fichaAtualizada);
      setFormularioFichaCandidato(montarFormularioFichaCandidato(fichaAtualizada));
      setArquivoCvFicha(null);
      setMensagemFichaCandidato('CV adicionado à ficha do candidato.');
      await carregar(paginaPreAnalises, filtrosPreAnalises, paginaCvsNaoQualificados);
    } catch (error) {
      setErroFichaCandidato(error?.message || 'Não foi possível adicionar o CV.');
    } finally {
      setEnviandoCvFicha(false);
    }
  };

  const analisarCvFichaCandidato = async () => {
    const idTeste = fichaCandidatoSelecionada?.candidato?.id_teste ||
      fichaCandidatoSelecionada?.candidato?.id;
    const curriculoDisponivel = !!fichaCandidatoSelecionada?.candidato?.curriculo?.disponivel;
    if (!idTeste) {
      setErroFichaCandidato('Candidato sem identificador para análise de CV.');
      return;
    }
    if (!curriculoDisponivel && !arquivoCvFicha) {
      setErroFichaCandidato('Adicione um CV antes de analisar.');
      return;
    }

    setAnalisandoCvFicha(true);
    setErroFichaCandidato('');
    setMensagemFichaCandidato('');
    try {
      if (arquivoCvFicha) {
        const formData = new FormData();
        formData.append('arquivo', arquivoCvFicha);
        await uploadCvCandidato(idTeste, formData);
        setArquivoCvFicha(null);
      }
      const resultado = await analisarCvCandidatoInscrito(idTeste, {
        id_processo: obterReferenciaProcesso(processo) || idProcesso || '',
      });
      const fichaAtualizada = await lerFichaCandidato(idTeste);
      setFichaCandidatoSelecionada(fichaAtualizada);
      setFormularioFichaCandidato(montarFormularioFichaCandidato(fichaAtualizada));
      setMensagemFichaCandidato(
        `CV analisado. Classificação: ${resultado?.classificacao || '-'} | Score: ${resultado?.score ?? '-'}.`,
      );
      await carregar(paginaPreAnalises, filtrosPreAnalises, paginaCvsNaoQualificados);
    } catch (error) {
      setErroFichaCandidato(error?.message || 'Não foi possível analisar o CV.');
    } finally {
      setAnalisandoCvFicha(false);
    }
  };

  const imprimirFichaSelecionada = () => {
    try {
      imprimirFichaCandidato(fichaCandidatoSelecionada, formularioFichaCandidato);
    } catch (error) {
      setErroFichaCandidato(error?.message || 'Não foi possível imprimir a ficha do candidato.');
    }
  };

  const abrirDetalheProva = async (candidato) => {
    if (!candidatoTemProvaSalva(candidato)) {
      setErro('Este candidato ainda não possui prova salva neste processo.');
      return;
    }

    try {
      setErro('');
      const idTesteProva = candidato.id_teste_prova || candidato.id_teste;
      setCarregandoDetalheProva(String(candidato.id_registro || idTesteProva || ''));
      const detalhe = await carregarDetalhesProva(
        idTesteProva,
        obterReferenciaProcesso(processo) || idProcesso,
      );
      const processoAtualRef = String(obterReferenciaProcesso(processo) || idProcesso || '').trim();
      const processoProvaRef = String(
        detalhe?.linha?.id_processo_ref || detalhe?.linha?.id_processo || '',
      ).trim();

      if (
        processoAtualRef &&
        processoProvaRef &&
        processoAtualRef !== processoProvaRef &&
        processoAtualRef.split('@@', 1)[0] !== processoProvaRef
      ) {
        throw new Error('O resultado encontrado pertence a outro processo.');
      }

      setDetalheProvaSelecionado(detalhe);
    } catch (error) {
      setErro(error?.message || 'Não foi possível abrir o resultado da prova.');
    } finally {
      setCarregandoDetalheProva('');
    }
  };

  const abrirGeracaoProva = (candidato) => {
    if (processoEncerrado) {
      setErro('O processo seletivo está encerrado e não permite liberar novas provas.');
      return;
    }
    if (!candidatoPodeGerarProva(candidato, processo?.status || '')) {
      setErro('A prova pode ser liberada apenas para candidatos agendados, aptos ou pendentes de prova.');
      return;
    }
    setErro('');
    setLiberacaoProvaSelecionada({
      candidato,
      processo,
    });
  };

  const candidatosElegiveisParaProva = candidatosComFluxo.filter((candidato) => {
    const status = canonicalizeCandidateStatus(candidato.status_entrevista || '');
    return [
      CANDIDATE_STATUS_SCHEDULED,
      CANDIDATE_STATUS_CONFIRMED,
      CANDIDATE_STATUS_RESCHEDULED,
    ].includes(status) && !candidato.tem_prova_gerada;
  });

  const abrirGeracaoProvaGeral = () => {
    if (processoEncerrado) {
      setErro('O processo seletivo está encerrado e não permite liberar novas provas.');
      return;
    }
    if (!candidatosElegiveisParaProva.length) {
      setErro('Não há candidatos com entrevista agendada ou confirmada aptos para receber uma prova.');
      return;
    }
    setErro('');
    setLiberacaoProvaSelecionada({
      candidato: candidatosElegiveisParaProva[0],
      processo,
      candidatosElegiveis: candidatosElegiveisParaProva,
    });
  };

  const liberarProvaDoProcesso = async (payload) => {
    const resposta = await criarProvaGerada(payload);
    // Correções.txt item 9: testes complementares habilitados na criação do
    // processo são provisionados automaticamente junto com a prova — melhor
    // esforço (não bloqueia a liberação da prova se algum deles falhar).
    const testes = payload?.testes_complementares || {};
    const idTeste = payload?.id_teste || payload?.candidato_id;
    if (idTeste && testes.disc) {
      try {
        await criarAplicacaoDisc({ id_teste: idTeste });
      } catch (error) {
        console.warn('Não foi possível provisionar o teste DISC automaticamente.', error);
      }
    }
    if (idTeste && testes.raciocinio_logico) {
      try {
        await criarAplicacaoRaciocinio({ id_teste: idTeste });
      } catch (error) {
        console.warn('Não foi possível provisionar o teste de raciocínio lógico automaticamente.', error);
      }
    }
    await carregar(paginaPreAnalises, filtrosPreAnalises, paginaCvsNaoQualificados);
    return resposta;
  };

  const cancelarProvaDoCandidato = async (candidato) => {
    const idProva = obterIdProvaGeradaCandidato(candidato);
    if (!idProva) return;
    setAcaoProvaSensivel({ tipo: 'cancelar', candidato, idProva });
  };

  const reabrirProvaDoCandidato = async (candidato) => {
    const idProva = obterIdProvaGeradaCandidato(candidato);
    if (!idProva) return;
    setAcaoProvaSensivel({ tipo: 'reabrir', candidato, idProva });
  };

  const confirmarAcaoProva = async ({ justificativa }) => {
    if (!acaoProvaSensivel?.idProva) return;
    try {
      setErro('');
      if (acaoProvaSensivel.tipo === 'cancelar') {
        await cancelarProvaGerada(acaoProvaSensivel.idProva, { motivo: justificativa });
      } else {
        await reabrirProvaGerada(acaoProvaSensivel.idProva, {
          motivo: justificativa,
          manter_respostas: true,
        });
      }
      setAcaoProvaSensivel(null);
      await carregar(paginaPreAnalises, filtrosPreAnalises, paginaCvsNaoQualificados);
    } catch (error) {
      setErro(error?.message || 'Não foi possível alterar a prova.');
    }
  };

  const abrirReconsideracao = (candidato) => {
    if (processoEncerrado) {
      setErro('O processo seletivo está encerrado e não permite novas movimentações.');
      return;
    }
    setCandidatoReconsiderar(candidato);
  };

  const confirmarReconsideracao = async ({ justificativa }) => {
    if (!candidatoReconsiderar?.id_registro) return;
    try {
      setErro('');
      setReconsiderandoCandidato(true);
      await reconsiderarEliminacaoCandidato(candidatoReconsiderar.id_registro, { justificativa });
      setCandidatoReconsiderar(null);
      await carregar(paginaPreAnalises, filtrosPreAnalises, paginaCvsNaoQualificados);
      showToast('Eliminação reconsiderada. O candidato voltou para Em Análise.', 'success');
    } catch (error) {
      setErro(obterMensagemOperacionalErro(error, 'Não foi possível reconsiderar a eliminação do candidato.'));
    } finally {
      setReconsiderandoCandidato(false);
    }
  };

  const deletarProvaDoCandidato = async (candidato) => {
    const idProva = obterIdProvaGeradaCandidato(candidato);
    if (!idProva || !window.confirm('Deseja apagar definitivamente esta prova e seus resultados técnicos?')) return;
    try {
      setErro('');
      await deletarProvaGerada(idProva);
      setCandidatosSelecionados([]);
      await carregar(paginaPreAnalises, filtrosPreAnalises, paginaCvsNaoQualificados);
    } catch (error) {
      setErro(error?.message || 'Não foi possível deletar a prova.');
    }
  };

  const editarProvaDoCandidato = async (candidato) => {
    const idProva = obterIdProvaGeradaCandidato(candidato);
    if (!idProva || provaGeradaFoiIniciada(candidato)) return;
    try {
      setErro('');
      const provaEditar = await lerProvaGerada(idProva);
      setContextoGeracaoProva({ candidato, processo, provaEditar });
    } catch (error) {
      setErro(error?.message || 'Não foi possível carregar os parâmetros da prova.');
    }
  };

  const analisarCvInscrito = async (candidato) => {
    if (processoEncerrado) {
      setErro('O processo seletivo está encerrado e não permite novas movimentações.');
      return;
    }

    if (!candidato?.id_teste) {
      setErro('Candidato inscrito não identificado.');
      return;
    }

    try {
      setErro('');
      await analisarCvCandidatoInscrito(candidato.id_teste, {
        id_processo: obterReferenciaProcesso(processo) || idProcesso,
      });
      await carregar(1);
    } catch (error) {
      setErro(error?.message || 'Não foi possível analisar o CV deste candidato.');
    }
  };

  const gerarPaginaPublica = async () => {
    if (!processo) return;

    try {
      const resultado = await gerarLinkPublicoCandidatura(
        obterReferenciaProcesso(processo) || idProcesso,
      );
      await carregar(paginaPreAnalises);
      if (resultado?.url) {
        setFeedbackLinkPublico(
          resultado?.aviso_url_publica || 'Página pública gerada com sucesso.',
        );
      }
    } catch (error) {
      setErro(
        error?.message ||
        'Não foi possível gerar a página pública de candidatura.',
      );
    }
  };

  const copiarLinkPublico = async () => {
    if (!linkPublicoAtivo) return;
    if (!urlPublicaCandidatura) {
      setErro(AVISO_URL_PUBLICA_NAO_CONFIGURADA);
      return;
    }

    try {
      await copiarTexto(urlPublicaCandidatura);
      setFeedbackLinkPublico('Link público copiado.');
    } catch (error) {
      setErro('Não foi possível copiar o link público agora.');
    }
  };

  const abrirPaginaPublica = () => {
    const url = urlPublicaCandidatura || urlInternaCandidatura;
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const desativarPaginaPublica = async () => {
    if (!processo) return;
    if (!window.confirm('Deseja desativar o link público desta vaga?')) {
      return;
    }

    try {
      await desativarLinkPublicoCandidatura(
        obterReferenciaProcesso(processo) || idProcesso,
      );
      await carregar(paginaPreAnalises);
      setFeedbackLinkPublico('Link público desativado.');
    } catch (error) {
      setErro(
        error?.message ||
        'Não foi possível desativar o link público desta vaga.',
      );
    }
  };

  const salvarObservacoesPublicasVaga = async () => {
    if (!processo) return;

    try {
      setSalvandoObservacoesPublicas(true);
      await atualizarProcesso(obterReferenciaProcesso(processo) || idProcesso, {
        quantidade_vagas: Number(processo.quantidade_vagas || 0),
        data_encerramento: processo.data_encerramento || '',
        operacao: processo.operacao || '',
        trilha: processo.trilha || '',
        usa_nota_corte: Number(processo.usa_nota_corte || 0),
        nota_corte:
          processo.nota_corte !== '' && processo.nota_corte !== null
            ? Number(processo.nota_corte)
            : null,
        status: processo.status || 'Aberto',
        link_agendamento: processo.link_agendamento || '',
        observacoes_publicas_vaga: observacoesPublicasVaga,
        requisitos_publicos: serializarItensPublicos(
          'requisitos',
          requisitosPublicos,
        ),
        responsabilidades_publicas: serializarItensPublicos(
          'responsabilidades',
          responsabilidadesPublicas,
        ),
      });
      await carregar(paginaPreAnalises);
      setFeedbackLinkPublico('Configurações da página pública salvas.');
    } catch (error) {
      setErro(
        error?.message ||
        'Não foi possível salvar as configurações da página pública.',
      );
    } finally {
      setSalvandoObservacoesPublicas(false);
    }
  };

  useEffect(() => {
    let cancelado = false;
    listarMotivosEliminacao()
      .then((dados) => {
        if (!cancelado) setMotivosEliminacaoCatalogo(Array.isArray(dados) ? dados : []);
      })
      .catch(() => {
        // Falha silenciosa: o formulário de eliminação cai para a lista
        // estática de motivos (MOTIVOS_ELIMINACAO) se o catálogo não puder
        // ser carregado.
      });
    return () => {
      cancelado = true;
    };
  }, []);

  const motivosEliminacaoDisponiveis = motivosEliminacaoCatalogo.length
    ? motivosEliminacaoCatalogo.map((item) => item.nome)
    : MOTIVOS_ELIMINACAO;

  const subCausasEliminacaoDisponiveis = (() => {
    const item = motivosEliminacaoCatalogo.find(
      (entry) => entry.nome === formularioEliminacao.motivo_eliminacao,
    );
    return Array.isArray(item?.payload?.sub_causas) ? item.payload.sub_causas : [];
  })();

  const abrirEliminacao = (candidato) => {
    const estadoAcoes = candidato?.acoes_fluxo || getCandidateActionState(candidato, processo?.status || '');
    if (estadoAcoes.processClosed || processoEncerrado) {
      setErro('Processo encerrado. Movimentações não são permitidas.');
      return;
    }

    if (!candidatoPodeSerEliminadoNoProcesso(candidato, estadoAcoes)) {
      setErro('A eliminação não está disponível para o status atual deste candidato.');
      return;
    }

    setErroEliminacao('');
    setFormularioEliminacao({
      motivo_eliminacao: '',
      sub_causa_eliminacao: '',
      etapa_eliminacao: '',
      observacao_eliminacao: '',
    });
    setEliminacaoSelecionada(candidato);
  };

  const abrirEliminacaoSelecionados = () => {
    if (!candidatosSelecionadosDetalhe.length) return;
    if (candidatosSelecionadosDetalhe.length === 1) {
      abrirEliminacao(candidatosSelecionadosDetalhe[0]);
      return;
    }
    const candidatosValidos = candidatosSelecionadosDetalhe.filter((candidato) => {
      const estado = candidato?.acoes_fluxo || getCandidateActionState(candidato, processo?.status || '');
      return candidatoPodeSerEliminadoNoProcesso(candidato, estado);
    });
    if (!candidatosValidos.length) {
      setErro('Os candidatos selecionados não permitem eliminação no status atual.');
      return;
    }
    setErroEliminacao('');
    setFormularioEliminacao({ motivo_eliminacao: '', sub_causa_eliminacao: '', etapa_eliminacao: '', observacao_eliminacao: '' });
    setEliminacaoSelecionada({
      id_registro: '__lote__',
      nome_candidato: `${candidatosValidos.length} candidatos selecionados`,
      candidatos_lote: candidatosValidos,
    });
  };

  const abrirAprovacaoSelecionados = () => {
    if (candidatosSelecionadosDetalhe.length < 2) return;
    const candidatosValidos = candidatosSelecionadosDetalhe.filter((candidato) => {
      const estado = candidato?.acoes_fluxo || getCandidateActionState(candidato, processo?.status || '');
      return estado.canApprove;
    });
    if (!candidatosValidos.length) {
      setErro('Os candidatos selecionados não permitem aprovação no status atual.');
      return;
    }
    setErro('');
    setAprovacaoLoteSelecionados(candidatosValidos);
  };

  const confirmarAprovacaoLote = async () => {
    if (!aprovacaoLoteSelecionados?.length) return;
    setAprovandoLote(true);
    try {
      await Promise.all(
        aprovacaoLoteSelecionados.map((candidato) =>
          atualizarStatus(candidato.id_registro, CANDIDATE_STATUS_APPROVED, {}),
        ),
      );
      setCandidatosSelecionados([]);
      setAprovacaoLoteSelecionados(null);
    } catch (error) {
      setErro(error?.message || 'Não foi possível aprovar todos os candidatos selecionados.');
    } finally {
      setAprovandoLote(false);
    }
  };

  const atualizarStatus = async (idRegistro, status, dadosStatus = {}) => {
    const statusSeguro = String(status || '').trim();
    const candidatoAtual = candidatos.find(
      (item) => Number(item.id_registro || 0) === Number(idRegistro || 0),
    );
    const statusAtual = canonicalizeCandidateStatus(
      candidatoAtual?.status_fluxo || candidatoAtual?.status_candidato,
    );

    if (statusAtual === CANDIDATE_STATUS_APPROVED) {
      setErro(MENSAGEM_CANDIDATO_APROVADO_BLOQUEADO);
      return false;
    }

    if (processoEncerrado) {
      setErro('O processo seletivo está encerrado e não permite novas movimentações.');
      return false;
    }

    if (statusSeguro === 'Eliminado') {
      const motivoInformado = String(dadosStatus.motivo_eliminacao || '').trim();
      if (!motivoInformado) {
        abrirEliminacao(candidatoAtual || { id_registro: idRegistro });
        return false;
      }
    }

    try {
      await atualizarStatusCandidato(idRegistro, {
        status_candidato: statusSeguro,
        ...(statusSeguro === CANDIDATE_STATUS_APPROVED ? dadosStatus : {}),
        ...(statusSeguro === CANDIDATE_STATUS_ELIMINATED ? dadosStatus : {}),
      });
      await carregar(paginaPreAnalises);
      return true;
    } catch (error) {
      setErro(
        obterMensagemOperacionalErro(error, 'Não foi possível atualizar o status.'),
      );
      return false;
    }
  };

  const enviarCandidatoBancoTalentos = async (candidato) => {
    if (!candidato?.id_teste) {
      setErro('Candidato sem identificador de prova para envio ao Banco de Talentos.');
      return false;
    }
    if (processoEncerrado) {
      setErro('O processo seletivo está encerrado e não permite novas movimentações.');
      return false;
    }
    const confirmar = window.confirm(
      `Deseja enviar ${candidato.nome_candidato || 'este candidato'} para o Banco de Talentos e removê-lo deste processo?`,
    );
    if (!confirmar) return false;

    try {
      const resultado = await criarBancoTalentos({
        id_processo: processo?.id_processo || candidato.id_processo || '',
        id_processo_ref:
          obterReferenciaProcesso(processo) ||
          candidato.id_processo_ref ||
          candidato.id_processo ||
          '',
        id_teste: candidato.id_teste,
        nome_candidato: candidato.nome_candidato || '',
        email: candidato.email || '',
        telefone: candidato.telefone || '',
        whatsapp: candidato.whatsapp || candidato.telefone || '',
        cidade: candidato.cidade || '',
        bairro: candidato.bairro || '',
        vaga: candidato.vaga || processo?.vaga || '',
        pontuacao_final:
          candidato.pontuacao_final ||
          candidato.nota_prova ||
          candidato.nota_final ||
          candidato.nota_exibicao ||
          '',
        data_movimentacao: new Date().toISOString(),
        origem: candidato.origem || processo?.vaga || 'Processo seletivo',
        eh_indicacao: Boolean(candidato.eh_indicacao),
        tipo_indicacao: candidato.tipo_indicacao || '',
      });
      await carregar(paginaPreAnalises, filtrosPreAnalises, paginaCvsNaoQualificados);
      showToast(resultado?.message || 'Candidato enviado para o Banco de Talentos.', 'success');
      return true;
    } catch (error) {
      setErro(
        obterMensagemOperacionalErro(
          error,
          'Não foi possível enviar o candidato para o Banco de Talentos. Verifique os dados do candidato e tente novamente.',
        ),
      );
      return false;
    }
  };

  const confirmarEliminacao = async () => {
    if (!eliminacaoSelecionada?.id_registro) {
      setErroEliminacao('Não foi possível identificar o vínculo deste candidato com o processo para eliminação.');
      return;
    }

    const motivo = String(formularioEliminacao.motivo_eliminacao || '').trim();
    const etapa = String(formularioEliminacao.etapa_eliminacao || '').trim();
    if (!motivo) {
      setErroEliminacao('Selecione o motivo da eliminação.');
      return;
    }
    if (motivo === 'Eliminado na entrevista' && !etapa) {
      setErroEliminacao('Selecione em qual entrevista ocorreu a eliminação.');
      return;
    }

    const dadosEliminacao = {
      motivo_eliminacao: motivo,
      sub_causa_eliminacao: String(formularioEliminacao.sub_causa_eliminacao || '').trim(),
      etapa_eliminacao: motivo === 'Eliminado na entrevista' ? etapa : '',
      data_eliminacao: new Date().toISOString(),
      observacao_eliminacao: String(formularioEliminacao.observacao_eliminacao || '').trim(),
    };
    const lote = Array.isArray(eliminacaoSelecionada.candidatos_lote)
      ? eliminacaoSelecionada.candidatos_lote
      : [];
    if (lote.length) {
      try {
        await Promise.all(lote.map((candidato) =>
          atualizarStatusCandidato(candidato.id_registro, {
            status_candidato: CANDIDATE_STATUS_ELIMINATED,
            ...dadosEliminacao,
          }),
        ));
        setCandidatosSelecionados([]);
        await carregar(paginaPreAnalises);
      } catch (error) {
        setErroEliminacao(error?.message || 'Não foi possível eliminar todos os candidatos selecionados.');
        return;
      }
    } else {
      const eliminado = await atualizarStatus(
        eliminacaoSelecionada.id_registro,
        CANDIDATE_STATUS_ELIMINATED,
        dadosEliminacao,
      );
      if (!eliminado) return;
      setCandidatosSelecionados([]);
    }
    setEliminacaoSelecionada(null);
    setErroEliminacao('');
  };

  const abrirAprovacao = (candidato) => {
    const estadoAcoes = candidato?.acoes_fluxo || getCandidateActionState(candidato, processo?.status || '');
    if (estadoAcoes.processClosed || processoEncerrado) {
      setErro('Processo encerrado. Movimentações não são permitidas.');
      return;
    }

    if (!candidatoPodeSerAprovado(candidato, estadoAcoes)) {
      setErro('A aprovação não está disponível para o status atual deste candidato.');
      return;
    }

    setAprovacaoSelecionada(candidato);
  };

  const abrirAprovacaoPelaProva = (candidato) => {
    const status = canonicalizeCandidateStatus(
      candidato?.status_fluxo || candidato?.status_candidato,
    );
    if (processoEncerrado) {
      setErro('Processo encerrado. Movimentações não são permitidas.');
      return;
    }
    if ([CANDIDATE_STATUS_APPROVED, CANDIDATE_STATUS_ELIMINATED].includes(status)) {
      setErro('A decisão final deste candidato já foi registrada.');
      return;
    }
    setErro('');
    setAprovacaoSelecionada(candidato);
  };

  const confirmarAprovacao = async (dadosAprovacao) => {
    if (!aprovacaoSelecionada) return;

    setSalvandoAprovacao(true);
    try {
      const idTesteAprovado = String(aprovacaoSelecionada.id_teste || '').trim();
      const aprovado = await atualizarStatus(
        aprovacaoSelecionada.id_registro,
        CANDIDATE_STATUS_APPROVED,
        dadosAprovacao,
      );
      if (!aprovado) return;
      const idTesteFichaAberta = String(
        fichaCandidatoSelecionada?.candidato?.id_teste ||
        fichaCandidatoSelecionada?.candidato?.id ||
        '',
      ).trim();
      if (idTesteAprovado && idTesteFichaAberta === idTesteAprovado) {
        const fichaAtualizada = await lerFichaCandidato(idTesteAprovado).catch(() => null);
        if (fichaAtualizada) {
          setFichaCandidatoSelecionada(fichaAtualizada);
          setFormularioFichaCandidato(montarFormularioFichaCandidato(fichaAtualizada));
        }
      }
      setAprovacaoSelecionada(null);
    } finally {
      setSalvandoAprovacao(false);
    }
  };

  const enviarAprovacaoWhatsApp = async (dadosAprovacao) => {
    if (!aprovacaoSelecionada) return;
    const numero = normalizarNumeroWhatsAppBrasil(
      aprovacaoSelecionada.whatsapp || aprovacaoSelecionada.telefone || '',
    );
    if (!numero) {
      throw new Error('O candidato não possui número de WhatsApp cadastrado.');
    }

    setEnviandoCanalAprovacao('whatsapp');
    try {
      await registrarWhatsappAprovacao(aprovacaoSelecionada.id_registro, dadosAprovacao);
      window.open(
        `https://wa.me/${numero}?text=${encodeURIComponent(dadosAprovacao.mensagem_aprovacao || '')}`,
        '_blank',
        'noopener,noreferrer',
      );
    } finally {
      setEnviandoCanalAprovacao('');
    }
  };

  const enviarAprovacaoEmail = async (dadosAprovacao) => {
    if (!aprovacaoSelecionada) return;
    setEnviandoCanalAprovacao('email');
    try {
      await enviarEmailAprovacao(aprovacaoSelecionada.id_registro, {
        ...dadosAprovacao,
        assunto: `Aprovação no processo seletivo - ${processo?.vaga || aprovacaoSelecionada.vaga || ''}`,
      });
    } finally {
      setEnviandoCanalAprovacao('');
    }
  };

  const abrirModalPreAnalise = () => {
    setArquivoCv(null);
    setErroPreAnaliseModal('');
    setMensagemPreAnaliseModal('');
    setModalPreAnaliseAberto(true);
  };

  const fecharModalPreAnalise = () => {
    setModalPreAnaliseAberto(false);
    setArquivoCv(null);
    setErroPreAnaliseModal('');
    setMensagemPreAnaliseModal('');
  };

  const enviarCv = async () => {
    if (processoEncerrado) {
      setErroPreAnaliseModal('O processo seletivo está encerrado e não permite novas movimentações.');
      return;
    }

    if (!arquivoCv) {
      setErroPreAnaliseModal('Selecione um CV antes de analisar.');
      return;
    }

    const extensaoCv = `.${String(arquivoCv.name || '').split('.').pop() || ''}`.toLowerCase();
    if (!['.pdf', '.doc', '.docx'].includes(extensaoCv)) {
      setErroPreAnaliseModal('Formato de currículo não suportado. Envie um arquivo PDF, DOC ou DOCX.');
      return;
    }

    try {
      setAnalisandoCv(true);
      setErroPreAnaliseModal('');
      setMensagemPreAnaliseModal('');
      const formData = new FormData();
      formData.append('arquivo', arquivoCv);
      formData.append('guardar_cv_original', guardarCvOriginal ? '1' : '0');
      await analisarCvProcesso(idProcesso, formData);
      setArquivoCv(null);
      await carregar(1, filtrosPreAnalises, 1);
      setMensagemPreAnaliseModal(
        'CV analisado.',
      );
    } catch (error) {
      setErroPreAnaliseModal(
        obterMensagemOperacionalErro(error, 'Não foi possível analisar o CV agora.'),
      );
    } finally {
      setAnalisandoCv(false);
    }
  };

  const abrirReanalisePreAnalise = (item) => {
    if (processoEncerrado) {
      setErro('O processo seletivo está encerrado e não permite novas análises de CV.');
      return;
    }

    setArquivoCv(null);
    setGuardarCvOriginal(Boolean(item?.arquivo_original_base64));
    setErroPreAnaliseModal('');
    setMensagemPreAnaliseModal('');
    setModalPreAnaliseAberto(true);
  };

  const salvarEdicao = async () => {
    if (!preAnaliseSelecionada) return;
    if (processoEncerrado) {
      setErro('O processo seletivo está encerrado e não permite novas movimentações.');
      return;
    }

    try {
      await atualizarPreAnaliseCv(preAnaliseSelecionada.id_pre_analise, {
        nome_candidato: preAnaliseSelecionada.nome_candidato,
        email: preAnaliseSelecionada.email,
        telefone: preAnaliseSelecionada.telefone,
        whatsapp: preAnaliseSelecionada.whatsapp,
      });

      setPreAnaliseSelecionada(null);
      await carregar(paginaPreAnalises);
    } catch (error) {
      showToast(error.message || 'Não foi possível salvar a edição.', 'error');
    }
  };

  const abrirEdicaoCandidato = (candidato) => {
    const estadoAcoes =
      candidato?.acoes_fluxo || getCandidateActionState(candidato, processo?.status || '');
    if (estadoAcoes.processClosed || !estadoAcoes.canEdit) {
      setErro('Processo encerrado. Movimentações não são permitidas.');
      return;
    }
    if (!candidato?.id_teste) {
      setErro('Candidato sem identificador de prova para edição.');
      return;
    }

    setCandidatoEditando(candidato);
    setFormularioCandidato(montarFormularioCandidato(candidato));
  };

  const atualizarCampoCandidato = (campo, valor) => {
    setFormularioCandidato((anterior) => ({
      ...anterior,
      [campo]: valor,
    }));
  };

  const salvarEdicaoCandidato = async () => {
    if (!candidatoEditando?.id_teste) return;
    const estadoAcoes =
      candidatoEditando?.acoes_fluxo ||
      getCandidateActionState(candidatoEditando, processo?.status || '');
    if (estadoAcoes.processClosed || !estadoAcoes.canEdit) {
      setErro('Processo encerrado. Movimentações não são permitidas.');
      return;
    }

    try {
      await atualizarPerfilCandidato(candidatoEditando.id_teste, {
        ...formularioCandidato,
      });
      setCandidatoEditando(null);
      await carregar(paginaPreAnalises);
    } catch (error) {
      showToast(error.message || 'Não foi possível salvar os dados do candidato.', 'error');
    }
  };

  const excluirPreAnalise = async (idPreAnalise) => {
    if (processoEncerrado) {
      setErro('O processo seletivo está encerrado e não permite novas movimentações.');
      return false;
    }

    if (!window.confirm('Deseja dispensar esta pré-análise? O CV, a análise e o histórico serão preservados.')) {
      return false;
    }

    try {
      await dispensarPreAnaliseCv(idPreAnalise);
      removerPreAnaliseLocalmente(idPreAnalise);
      await carregar(paginaPreAnalises, filtrosPreAnalises, paginaCvsNaoQualificados);
      return true;
    } catch (error) {
      setErro(
        obterMensagemOperacionalErro(error, 'Não foi possível dispensar a pré-análise.'),
      );
      return false;
    }
  };

  const incluirNoProcesso = async (item, opcoes = {}) => {
    if (processoEncerrado) {
      setErro('O processo seletivo está encerrado e não permite novas movimentações.');
      return false;
    }

    if (Number(item?.ja_adicionado_ao_processo || 0) === 1) {
      setErro('Este candidato já está vinculado a este processo.');
      return false;
    }

    try {
      await adicionarPreAnaliseAoProcesso(item.id_pre_analise, opcoes);
      removerPreAnaliseLocalmente(item.id_pre_analise);
      await carregar(paginaPreAnalises, filtrosPreAnalises, paginaCvsNaoQualificados);
      return true;
    } catch (error) {
      setErro(
        obterMensagemOperacionalErro(error, 'Não foi possível adicionar ao processo.'),
      );
      return false;
    }
  };

  const utilizarCandidatoNaoQualificado = async (item) => {
    const confirmar = window.confirm(
      `Este candidato foi classificado como ${item.classificacao || 'Não qualificado'}, com score de ${item.score_final ?? '-'}. Deseja utilizar este candidato mesmo assim?`,
    );
    if (!confirmar) return;
    await incluirNoProcesso(item, {
      manual_override: true,
      motivo_override:
        'Utilizado manualmente pelo RH apesar da classificação automática.',
    });
  };

  const iniciarUsoPreAnalise = (item) => {
    if (processoEncerrado) {
      setErro('O processo seletivo está encerrado e não permite novas movimentações.');
      return;
    }

    if (Number(item?.ja_adicionado_ao_processo || 0) === 1) {
      setErro('Este candidato já está vinculado a este processo.');
      return;
    }

    setErro('');
    setUsoPreAnalisePendente(String(item?.id_pre_analise || ''));
    setFormIndicacaoPreAnalise({
      eh_indicacao: false,
      tipo_indicacao: '',
    });
  };

  const confirmarUsoPreAnalise = async (item) => {
    if (!item?.id_pre_analise) return;

    if (formIndicacaoPreAnalise.eh_indicacao && !formIndicacaoPreAnalise.tipo_indicacao) {
      setErro('Selecione o tipo de indicação.');
      return;
    }

    const opcoes = {
      ...montarPayloadIndicacao(formIndicacaoPreAnalise),
    };

    if (isPreAnaliseNaoQualificada(item)) {
      const confirmar = window.confirm(
        `Este candidato foi classificado como ${item.classificacao || 'Não qualificado'}, com score de ${item.score_final ?? '-'}. Deseja utilizar este candidato mesmo assim?`,
      );
      if (!confirmar) return;
      opcoes.manual_override = true;
      opcoes.motivo_override =
        'Utilizado manualmente pelo RH apesar da classificação automática.';
    }

    setUsandoPreAnaliseId(String(item.id_pre_analise));
    try {
      const sucesso = await incluirNoProcesso(item, opcoes);
      if (sucesso) {
        setUsoPreAnalisePendente('');
        setFormIndicacaoPreAnalise({
          eh_indicacao: false,
          tipo_indicacao: '',
        });
      }
    } finally {
      setUsandoPreAnaliseId('');
    }
  };

  const enviarPreAnaliseAoBancoTalentos = async (item) => {
    if (processoEncerrado) {
      setErro('O processo seletivo está encerrado e não permite novas movimentações.');
      return;
    }

    if (Number(item?.ja_adicionado_ao_processo || 0) === 1) {
      setErro('Este candidato já está vinculado a este processo.');
      return;
    }

    const confirmar = window.confirm(
      'Este candidato será enviado para o Banco de Talentos e poderá ser utilizado em outro processo. Deseja continuar?',
    );
    if (!confirmar) return;

    try {
      await enviarPreAnaliseParaBancoTalentos(item.id_pre_analise);
      removerPreAnaliseLocalmente(item.id_pre_analise);
      await carregar(paginaPreAnalises, filtrosPreAnalises, paginaCvsNaoQualificados);
    } catch (error) {
      setErro('Não foi possível enviar o candidato para o Banco de Talentos. Verifique os dados do candidato e tente novamente.');
    }
  };

  const iniciarUsoBancoTalentos = (candidatoBanco = candidatoBancoSelecionado) => {
    if (processoEncerrado) {
      setErro('O processo seletivo está encerrado e não permite novas movimentações.');
      return;
    }

    if (!candidatoBanco?.id_banco) {
      setErro('Selecione um candidato do Banco de Talentos.');
      return;
    }

    if (candidatoBancoJaEstaNoProcesso(candidatoBanco, candidatosComFluxo)) {
      setErro('Este candidato já está vinculado a este processo.');
      return;
    }

    setErro('');
    setBancoTalentosSelecionado(String(candidatoBanco.id_banco || ''));
    setUsoBancoTalentosPendente(true);
    setFormIndicacaoBanco({
      eh_indicacao: isCandidatoIndicacao(candidatoBanco),
      tipo_indicacao: candidatoBanco.tipo_indicacao || '',
    });
  };

  const confirmarUsoBancoTalentos = async () => {
    if (!candidatoBancoSelecionado?.id_banco) {
      setErro('Selecione um candidato do Banco de Talentos.');
      return;
    }

    if (formIndicacaoBanco.eh_indicacao && !formIndicacaoBanco.tipo_indicacao) {
      setErro('Selecione o tipo de indicação.');
      return;
    }

    const referenciaProcesso = obterReferenciaProcesso(processo) || idProcesso;
    setUsandoBancoTalentos(true);
    setErro('');
    try {
      await usarCandidatoDoBancoTalentos(candidatoBancoSelecionado.id_banco, {
        id_processo: String(processo?.id_processo || idProcesso || ''),
        id_processo_ref: referenciaProcesso,
        origem: 'Banco de Talentos',
        ...montarPayloadIndicacao(formIndicacaoBanco),
      });
      setBancoTalentosSelecionado('');
      setUsoBancoTalentosPendente(false);
      setFormIndicacaoBanco({
        eh_indicacao: false,
        tipo_indicacao: '',
      });
      await carregar(paginaPreAnalises, filtrosPreAnalises, paginaCvsNaoQualificados);
    } catch (error) {
      setErro(
        obterMensagemOperacionalErro(
          error,
          'Não foi possível utilizar o candidato do Banco de Talentos.',
        ),
      );
    } finally {
      setUsandoBancoTalentos(false);
    }
  };

  const aplicarFiltrosPreAnalise = async (novosFiltros = filtrosPreAnalises) => {
    setFiltrosPreAnalises(novosFiltros);
    await carregar(1, novosFiltros);
  };

  const limparFiltrosPreAnalise = async () => {
    const filtrosLimpos = {
      nome: '',
      scoreMin: '',
      scoreMax: '',
      classificacao: '',
      mostrarOcultos: false,
    };
    setFiltrosPreAnalises(filtrosLimpos);
    await carregar(1, filtrosLimpos);
  };

  const limparListaPreAnalise = async () => {
    const confirmar = window.confirm(
      'Esta ação apenas limpará a visualização da lista. Os currículos e históricos não serão excluídos.',
    );
    if (!confirmar) return;

    try {
      const filtrosAposLimpeza = { ...filtrosPreAnalises, mostrarOcultos: false };
      await limparListaPreAnalisesCv(obterReferenciaProcesso(processo) || idProcesso);
      setFiltrosPreAnalises(filtrosAposLimpeza);
      await carregar(1, filtrosAposLimpeza);
    } catch (error) {
      setErro(error?.message || 'Não foi possível limpar a visualização da pré-análise.');
    }
  };

  const atualizarFiltroDossie = (campo, valor) => {
    setFiltrosDossie((anteriores) => ({
      ...anteriores,
      [campo]: valor,
    }));
  };

  const limparFiltrosDossie = () => {
    setFiltrosDossie({
      processo: '',
      candidato: '',
      data: '',
      etapa: '',
      classificacao: '',
      status: '',
      notaMin: '',
      notaMax: '',
      scoreMin: '',
      scoreMax: '',
    });
  };

  const recarregarAnotacoesDossie = async () => {
    const referencia = obterReferenciaProcesso(processo) || idProcesso;
    if (!referencia) return;
    const lista = await lerAnotacoesDossieProcesso(referencia);
    setAnotacoesDossie(Array.isArray(lista) ? lista : []);
  };

  const atualizarCampoAnotacaoDossie = (campo, valor) => {
    setFormularioAnotacaoDossie((anterior) => ({
      ...anterior,
      [campo]: valor,
    }));
    setErroDossie('');
    setMensagemDossie('');
  };

  const selecionarCandidatoAnotacaoDossie = (idTeste) => {
    const candidato = candidatosDossie.find(
      (item) =>
        String(item.id_teste || item.id || '').trim() ===
        String(idTeste || '').trim(),
    );
    setFormularioAnotacaoDossie((anterior) => ({
      ...anterior,
      id_teste: idTeste,
      nome_candidato: candidato?.nome || '',
    }));
    setErroDossie('');
  };

  const cancelarEdicaoAnotacaoDossie = () => {
    setAnotacaoDossieEditandoId('');
    setFormularioAnotacaoDossie({
      id_teste: '',
      nome_candidato: '',
      texto: '',
    });
    setErroDossie('');
  };

  const editarAnotacaoDossie = (anotacao) => {
    setAnotacaoDossieEditandoId(String(anotacao?.id_anotacao || ''));
    setFormularioAnotacaoDossie({
      id_teste: anotacao?.id_teste || '',
      nome_candidato: anotacao?.nome_candidato || '',
      texto: anotacao?.texto || '',
    });
    setErroDossie('');
    setMensagemDossie('');
  };

  const salvarAnotacaoDossie = async () => {
    const texto = String(formularioAnotacaoDossie.texto || '').trim();
    if (!texto) {
      setErroDossie('Informe uma anotação antes de salvar.');
      return;
    }

    const referencia = obterReferenciaProcesso(processo) || idProcesso;
    if (!referencia) {
      setErroDossie('Processo não identificado para salvar a anotação.');
      return;
    }

    setSalvandoAnotacaoDossie(true);
    setErroDossie('');
    setMensagemDossie('');

    try {
      if (anotacaoDossieEditandoId) {
        await atualizarAnotacaoDossieProcesso(anotacaoDossieEditandoId, {
          texto,
        });
      } else {
        await criarAnotacaoDossieProcesso(referencia, {
          id_teste: formularioAnotacaoDossie.id_teste,
          nome_candidato: formularioAnotacaoDossie.nome_candidato,
          texto,
        });
      }
      cancelarEdicaoAnotacaoDossie();
      await recarregarAnotacoesDossie();
      setMensagemDossie('Anotação salva no dossiê.');
    } catch (error) {
      setErroDossie(error?.message || 'Não foi possível salvar a anotação do dossiê.');
    } finally {
      setSalvandoAnotacaoDossie(false);
    }
  };

  const analisarCvDoEmail = async (emailItem, anexo = null) => {
    if (processoEncerrado) {
      setErro('O processo seletivo está encerrado e não permite novas movimentações.');
      return;
    }

    if (!emailItem?.possui_anexo) {
      setErro('Sem anexo de CV neste e-mail.');
      return;
    }

    try {
      setErro('');
      setAnalisandoEmailUid(emailItem.uid);
      await analisarCvEmailRecebido(obterReferenciaProcesso(processo) || idProcesso, {
        uid: emailItem.uid,
        attachment_name: anexo?.nome || emailItem.nome_anexo || '',
      });
      await carregar(1);
      await carregarEmailsDoProcesso();
    } catch (error) {
      setErro(error?.message || 'Não foi possível analisar o CV recebido por e-mail.');
    } finally {
      setAnalisandoEmailUid('');
    }
  };

  const abrirAgendamento = (candidato) => {
    const estadoAcoes = candidato?.acoes_fluxo || getCandidateActionState(candidato, processo?.status || '');

    if (estadoAcoes.processClosed || !estadoAcoes.isActive) {
      setErro('Somente candidatos ativos em processo aberto podem seguir para agendamento.');
      return;
    }

    const referenciaProcesso =
      obterReferenciaProcesso(processo) ||
      obterReferenciaProcessoDoCandidato(candidato) ||
      idProcesso;
    const idProcessoVisual =
      processo?.id_processo ||
      candidato.id_processo ||
      '';

    setErro('');
    setSlotsEntrevista([]);
    setAgendamentoSelecionado(candidato);
    setDocumentosEntrevista([]);
    setFormularioEntrevista({
      id_registro: candidato.id_registro,
      id_processo: idProcessoVisual,
      id_processo_ref: referenciaProcesso,
      id_slot: '',
      data_entrevista: '',
      status_entrevista: CANDIDATE_STATUS_PENDING_CONFIRMATION,
      link_agendamento: '',
      observacoes_rh: '',
      mensagem_personalizada: '',
      email: candidato.email || '',
      telefone: candidato.telefone || '',
      whatsapp: candidato.whatsapp || candidato.telefone || '',
    });
    setMensagemEntrevistaEditada(false);
    carregarSlotsEntrevistaDoProcesso(referenciaProcesso);
  };

  const montarMensagemEntrevistaPadrao = (
    idSlot = formularioEntrevista.id_slot,
    documentos = documentosEntrevista,
  ) => {
    const nome = agendamentoSelecionado?.nome_candidato || 'candidato(a)';
    const vagaMensagem =
      processo?.vaga ||
      agendamentoSelecionado?.vaga ||
      'a vaga em andamento';
    const slot = slotsDisponiveisEntrevista.find(
      (item) => Number(obterIdSlotEntrevista(item)) === Number(idSlot),
    );
    if (!slot) {
      return atualizarDocumentosNaMensagem(
        `Olá ${nome}! Gostaríamos de convocá-lo para o nosso processo seletivo para a vaga de: ${vagaMensagem} no dia _data_ às _horário_.

Compareça levando os seguintes documentos:

_lista_documentos_

Nosso endereço fica na Rua Victor Civita, 77 - Bloco 1, 3° Andar. Se precisar de apoio, responda esta mensagem.`,
        documentos,
      );
    }

    const dataInicio = obterDataInicioSlotEntrevista(slot);
    const data = dataInicio.toLocaleDateString('pt-BR');
    const hora = dataInicio.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    return atualizarDocumentosNaMensagem(
      `Olá ${nome}! Gostaríamos de convocá-lo para o nosso processo seletivo para a vaga de: ${vagaMensagem} no dia ${data} às ${hora}.

Compareça levando os seguintes documentos:

_lista_documentos_

Nosso endereço fica na Rua Victor Civita, 77 - Bloco 1, 3° Andar. Se precisar de apoio, responda esta mensagem.`,
      documentos,
    );
  };

  const montarMensagemEntrevista = () => {
    const mensagemPersonalizada = String(formularioEntrevista.mensagem_personalizada || '').trim();
    return mensagemPersonalizada || montarMensagemEntrevistaPadrao();
  };

  const prepararDadosMensagemAgendamento = (canal = '') => {
    const mensagemErro = validarFormularioEntrevista({
      ...formularioEntrevista,
      exige_slot: true,
    });
    if (mensagemErro) {
      throw new Error(mensagemErro);
    }

    if (canal === 'whatsapp') {
      const numeroBase = normalizarNumeroWhatsAppBrasil(
        formularioEntrevista.whatsapp || formularioEntrevista.telefone || '',
      );
      if (!numeroBase) {
        throw new Error('O candidato não possui número de WhatsApp válido extraído do CV.');
      }
    }

    if (canal === 'email') {
      const emailDestino = String(formularioEntrevista.email || '').trim();
      if (!emailDestino) {
        throw new Error('O candidato não possui e-mail válido extraído do CV.');
      }
    }

    const slotSelecionado = slotsDisponiveisEntrevista.find(
      (item) =>
        Number(obterIdSlotEntrevista(item)) ===
        Number(formularioEntrevista.id_slot),
    );
    const dataEntrevista = montarDataEntrevistaIso(slotSelecionado);
    if (!dataEntrevista) {
      throw new Error('Selecione um horário válido para agendar a entrevista.');
    }

    const dataAgendada = new Date(dataEntrevista);
    if (Number.isNaN(dataAgendada.getTime()) || dataAgendada <= new Date()) {
      throw new Error('Selecione um horário futuro para agendar a entrevista.');
    }

    return {
      dataEntrevista,
      mensagem: montarMensagemEntrevista(),
    };
  };

  const abrirMensagemAgendamento = async (canal) => {
    if (processoEncerrado) {
      setErro('O processo seletivo está encerrado e não permite novas movimentações.');
      return;
    }

    setSalvandoEntrevista(true);
    setErro('');

    try {
      const { mensagem } = prepararDadosMensagemAgendamento(canal);

      if (canal === 'whatsapp') {
        const numeroBase = normalizarNumeroWhatsAppBrasil(
          formularioEntrevista.whatsapp || formularioEntrevista.telefone || '',
        );
        window.open(
          `https://wa.me/${numeroBase}?text=${encodeURIComponent(mensagem)}`,
          '_blank',
          'noopener,noreferrer',
        );
      }

      if (canal === 'email') {
        const emailDestino = String(formularioEntrevista.email || '').trim();
        const assunto = encodeURIComponent('Agendamento de entrevista');
        window.location.href = `mailto:${emailDestino}?subject=${assunto}&body=${encodeURIComponent(mensagem)}`;
      }

      await copiarTexto(mensagem).catch(() => null);
    } catch (error) {
      setErro(error?.message || 'Não foi possível abrir a mensagem de agendamento.');
    } finally {
      setSalvandoEntrevista(false);
    }
  };

  const alternarDocumentoEntrevista = (documento, marcado) => {
    const proximos = marcado
      ? [...documentosEntrevista, documento]
      : documentosEntrevista.filter((item) => item !== documento);
    setDocumentosEntrevista(proximos);
    setFormularioEntrevista((atual) => ({
      ...atual,
      mensagem_personalizada: mensagemEntrevistaEditada
        ? atualizarDocumentosNaMensagem(atual.mensagem_personalizada, proximos)
        : montarMensagemEntrevistaPadrao(atual.id_slot, proximos),
    }));
  };

  const salvarAgendamento = async () => {
    if (processoEncerrado) {
      setErro('O processo seletivo está encerrado e não permite novas movimentações.');
      return;
    }

    setSalvandoEntrevista(true);
    setErro('');

    try {
      const { dataEntrevista, mensagem: mensagemFinal } =
        prepararDadosMensagemAgendamento();
      const resultado = await agendarEntrevista({
        id_registro: Number(formularioEntrevista.id_registro),
        id_processo: formularioEntrevista.id_processo || '',
        id_processo_ref: formularioEntrevista.id_processo_ref || '',
        id_slot: Number(formularioEntrevista.id_slot),
        data_entrevista: dataEntrevista,
        status_entrevista: CANDIDATE_STATUS_PENDING_CONFIRMATION,
        link_agendamento: formularioEntrevista.link_agendamento || '',
        observacoes_rh: formularioEntrevista.observacoes_rh || '',
        mensagem_personalizada: mensagemFinal,
      });
      const mensagem = resultado?.mensagem_base || mensagemFinal;
      await copiarTexto(mensagem).catch(() => null);

      showToast('Entrevista registrada como pendente e mensagem copiada para a área de transferência.', 'success');

      setAgendamentoSelecionado(null);
      await carregar(paginaPreAnalises);
    } catch (error) {
      setErro(error?.message || 'Não foi possível agendar a entrevista.');
    } finally {
      setSalvandoEntrevista(false);
    }
  };

  const abrirEdicaoEntrevista = (entrevista) => {
    if (isProcessClosed(entrevista?.status_processo)) {
      setErro('O processo seletivo desta entrevista está encerrado e não permite atualização operacional.');
      return;
    }

    setEntrevistaEdicao(entrevista);
    setFormularioEdicaoEntrevista({
      id_slot: '',
      status_entrevista: entrevista.status_entrevista || CANDIDATE_STATUS_PENDING_CONFIRMATION,
      observacoes_rh: entrevista.observacoes_rh || '',
      mensagem_personalizada: entrevista.mensagem_personalizada || '',
    });
  };

  const salvarEdicaoEntrevista = async () => {
    if (!entrevistaEdicao) return;
    if (isProcessClosed(entrevistaEdicao.status_processo)) {
      setErro('O processo seletivo desta entrevista está encerrado e não permite atualização operacional.');
      return;
    }

    const mensagemErro = validarFormularioEntrevista({
      id_registro: entrevistaEdicao.id_registro,
      ...formularioEdicaoEntrevista,
    });
    if (mensagemErro) {
      setErro(mensagemErro);
      return;
    }

    setSalvandoEdicaoEntrevista(true);
    setErro('');
    try {
      const payload = {
        status_entrevista: formularioEdicaoEntrevista.status_entrevista,
        observacoes_rh: formularioEdicaoEntrevista.observacoes_rh,
        mensagem_personalizada: formularioEdicaoEntrevista.mensagem_personalizada,
      };
      if (formularioEdicaoEntrevista.id_slot) {
        payload.id_slot = Number(formularioEdicaoEntrevista.id_slot);
        if (Number(formularioEdicaoEntrevista.id_slot) !== Number(entrevistaEdicao.id_slot || 0)) {
          payload.status_entrevista = 'Reagendado';
        }
      }

      await atualizarEntrevista(entrevistaEdicao.id_entrevista, payload);
      setEntrevistaEdicao(null);
      await carregar(paginaPreAnalises);
    } catch (error) {
      setErro(error?.message || 'Não foi possível atualizar a entrevista selecionada.');
    } finally {
      setSalvandoEdicaoEntrevista(false);
    }
  };

  const trocarAbaDetalhe = (aba) => {
    setAbaDetalheAtiva(aba);
    setCandidatosSelecionados([]);
    setErro('');
  };

  const alternarSelecaoCandidato = (candidato, marcado) => {
    const id = String(candidato?.id_registro || candidato?.id_teste || '');
    if (!id) return;
    setCandidatosSelecionados((atuais) =>
      marcado
        ? Array.from(new Set([...atuais, id]))
        : atuais.filter((item) => item !== id),
    );
  };

  const alternarSelecaoPaginaCandidatos = (marcado) => {
    const idsPagina = candidatosTabelaPaginados.itens
      .map((candidato) => String(candidato.id_registro || candidato.id_teste || ''))
      .filter(Boolean);
    setCandidatosSelecionados((atuais) =>
      marcado
        ? Array.from(new Set([...atuais, ...idsPagina]))
        : atuais.filter((id) => !idsPagina.includes(id)),
    );
  };

  const compartilharVaga = async () => {
    setModalCompartilharVagaAberto(true);
  };

  const montarAcoesCabecalhoDetalhe = () => {
    const candidatoBloqueadoTitulo = processoPausado
      ? 'Esta vaga está pausada. Retome a vaga para adicionar candidatos.'
      : processoEncerrado
        ? 'Esta vaga não permite novas inclusões ou movimentações.'
        : '';
    return [
      possuiAlgumaPermissao('vagas.visualizar', 'processos.visualizar') ? {
        label: 'Compartilhar vaga',
        icon: 'share',
        onClick: compartilharVaga,
      } : null,
      possuiAlgumaPermissao('vagas.visualizar', 'processos.visualizar') ? {
        label: 'Ver resumo da vaga',
        icon: 'assignment',
        onClick: () => setResumoVagaAberto(true),
      } : null,
      possuiAlgumaPermissao('candidatos.criar', 'candidatos.editar') ? {
        label: 'Adicionar candidato',
        icon: 'person_add',
        disabled: processoEncerrado,
        title: candidatoBloqueadoTitulo || 'Analisar e adicionar candidato a esta vaga',
        onClick: abrirModalPreAnalise,
      } : null,
      possuiAlgumaPermissao('vagas.editar', 'processos.editar') ? {
        label: 'Editar vaga',
        icon: 'edit_square',
        onClick: abrirEdicaoProcessoDetalhe,
      } : null,
      { separator: true, key: 'status-actions' },
      possuiAlgumaPermissao('vagas.editar', 'processos.editar') ? {
        label: processoPausado ? 'Retomar vaga' : 'Pausar vaga',
        icon: processoPausado ? 'play_circle' : 'pause_circle',
        disabled: ['cancelado', 'encerrado'].includes(normalizarTextoComparacao(processo?.status)),
        onClick: () => solicitarAcaoProcessoDetalhe(processoPausado ? 'retomar' : 'pausar'),
      } : null,
      possuiAlgumaPermissao('vagas.encerrar') ? {
        label: 'Encerrar vaga',
        icon: 'lock',
        danger: true,
        disabled: ['cancelado', 'encerrado'].includes(normalizarTextoComparacao(processo?.status)),
        onClick: () => solicitarAcaoProcessoDetalhe('encerrar'),
      } : null,
    ];
  };

  const abrirDossieDoCandidato = (candidato) => {
    setFiltrosDossie((atuais) => ({
      ...atuais,
      candidato: candidato?.nome_candidato || '',
    }));
    setFormularioAnotacaoDossie((atual) => ({
      ...atual,
      id_teste: candidato?.id_teste || '',
      nome_candidato: candidato?.nome_candidato || '',
    }));
    trocarAbaDetalhe('dossie');
  };

  const abrirConfirmacaoEntrevista = (candidato) => {
    const estado = obterEstadoConfirmacaoEntrevista(candidato);
    if (!estado.disponivel) {
      setErro(
        `A confirmação ficará disponível em ${formatarDataHora(estado.dataLiberacao?.toISOString())}, 42 horas antes da entrevista.`,
      );
      return;
    }
    setErro('');
    setMensagemConfirmacaoEntrevista(montarMensagemConfirmacaoEntrevista(candidato));
    setConfirmacaoEntrevistaSelecionada(candidato);
  };

  const enviarConfirmacaoEntrevistaEmail = () => {
    const candidato = confirmacaoEntrevistaSelecionada;
    if (!candidato?.email) return;
    const assunto = `Confirmação de entrevista - ${processo?.vaga || 'Processo seletivo'}`;
    window.location.href = `mailto:${encodeURIComponent(candidato.email)}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(mensagemConfirmacaoEntrevista)}`;
  };

  const enviarConfirmacaoEntrevistaWhatsapp = async () => {
    const candidato = confirmacaoEntrevistaSelecionada;
    const numero = normalizarNumeroWhatsAppBrasil(candidato?.whatsapp || candidato?.telefone);
    if (!numero) return;
    window.open(
      `https://wa.me/${numero}?text=${encodeURIComponent(mensagemConfirmacaoEntrevista)}`,
      '_blank',
      'noopener,noreferrer',
    );
    if (candidato?.id_registro) {
      try {
        await registrarWhatsappContatoManual(candidato.id_registro, {
          tipo_contato: 'confirmacao_entrevista',
          observacao: 'Solicitação de confirmação de entrevista enviada pelo RH.',
          mensagem: mensagemConfirmacaoEntrevista,
        });
      } catch (error) {
        setErro(error?.message || 'A conversa foi aberta, mas não foi possível registrar o contato.');
      }
    }
  };

  // Correções.txt item 2: 3 botões em destaque para candidato com entrevista
  // agendada. "Confirmada" libera a prova automaticamente (reaproveitando o
  // mesmo fluxo de geração já usado em "Liberar prova" — a seleção de questões
  // é lógica de frontend, então a liberação automática abre o modal já pronto
  // em vez de disparar algo silencioso no backend); "Cancelada" abre a vaga do
  // slot (automático via _refresh_slot_status no backend) e elimina o
  // candidato para Reprovados; "Reagendar" reaproveita o modal de edição de
  // entrevista já existente.
  const confirmarEntrevistaCandidato = async (candidato) => {
    if (!candidato?.id_entrevista) return;
    try {
      setErro('');
      await atualizarEntrevista(candidato.id_entrevista, { status_entrevista: CANDIDATE_STATUS_CONFIRMED });
      await carregar(paginaPreAnalises, filtrosPreAnalises, paginaCvsNaoQualificados);
      showToast('Entrevista confirmada.', 'success');
      if (
        candidatoPodeGerarProva(candidato, processo?.status || '') &&
        !candidato?.tem_prova_gerada &&
        !candidatoTemProvaSalva(candidato)
      ) {
        abrirGeracaoProva({ ...candidato, status_entrevista: CANDIDATE_STATUS_CONFIRMED });
        showToast('Prova pronta para ser liberada — confirme os dados abaixo.', 'info');
      }
    } catch (error) {
      setErro(error?.message || 'Não foi possível confirmar a entrevista.');
    }
  };

  const cancelarEntrevistaCandidato = (candidato) => {
    if (!candidato?.id_entrevista) return;
    if (
      !window.confirm(
        'Cancelar esta entrevista também elimina o candidato do processo (ele será movido para Reprovados) e libera o horário do slot para outro candidato. Deseja continuar?',
      )
    ) {
      return;
    }
    (async () => {
      try {
        setErro('');
        await atualizarEntrevista(candidato.id_entrevista, { status_entrevista: 'Cancelado' });
        await carregar(paginaPreAnalises, filtrosPreAnalises, paginaCvsNaoQualificados);
        showToast('Entrevista cancelada: candidato movido para Reprovados e horário liberado.', 'info');
      } catch (error) {
        setErro(error?.message || 'Não foi possível cancelar a entrevista.');
      }
    })();
  };

  const reagendarEntrevistaCandidato = (candidato) => {
    if (!candidato?.id_entrevista) return;
    abrirEdicaoEntrevista({
      id_entrevista: candidato.id_entrevista,
      id_registro: candidato.id_registro,
      id_slot: candidato.id_slot || '',
      status_entrevista: candidato.status_entrevista || CANDIDATE_STATUS_PENDING_CONFIRMATION,
      status_processo: candidato.status_processo || processo?.status || '',
      observacoes_rh: candidato.observacoes_rh || '',
      mensagem_personalizada: candidato.mensagem_personalizada || '',
    });
  };

  const montarAcoesDaLinhaDetalhe = (candidato) => {
    const estadoAcoes = candidato?.acoes_fluxo || getCandidateActionState(candidato, processo?.status || '');
    const statusEntrevista = canonicalizeCandidateStatus(candidato?.status_entrevista || '');
    const confirmacaoEntrevista = obterEstadoConfirmacaoEntrevista(candidato);
    const provaConcluida = candidatoTemProvaConcluida(candidato);
    const entrevistaAgendadaAtiva = !provaConcluida && [
      CANDIDATE_STATUS_SCHEDULED,
      CANDIDATE_STATUS_CONFIRMED,
      CANDIDATE_STATUS_RESCHEDULED,
      CANDIDATE_STATUS_PENDING_CONFIRMATION,
    ].includes(statusEntrevista);
    const podeAprovar = candidatoPodeSerAprovado(candidato, estadoAcoes);
    const acoes = [
      candidato?.id_teste ? {
        label: 'Ver ficha do candidato',
        icon: 'badge',
        onClick: () => abrirFichaCandidato(candidato),
      } : null,
      !provaConcluida && estadoAcoes.isActive && !estadoAcoes.processClosed && controlador?.possuiPermissao?.('entrevistas.criar') ? {
        label: 'Agendar entrevista',
        icon: 'event',
        onClick: () => abrirAgendamento(candidato),
      } : null,
      !provaConcluida && statusEntrevista === CANDIDATE_STATUS_PENDING_CONFIRMATION ? {
        label: 'Confirmar entrevista',
        icon: confirmacaoEntrevista.disponivel ? 'mark_email_read' : 'lock_clock',
        disabled: !confirmacaoEntrevista.disponivel,
        title: confirmacaoEntrevista.disponivel
          ? 'Enviar solicitação de confirmação ao candidato'
          : `Disponível em ${formatarDataHora(confirmacaoEntrevista.dataLiberacao?.toISOString())}`,
        onClick: () => abrirConfirmacaoEntrevista(candidato),
      } : null,
      entrevistaAgendadaAtiva && !estadoAcoes.processClosed && statusEntrevista !== CANDIDATE_STATUS_CONFIRMED ? {
        label: 'Entrevista confirmada',
        icon: 'check_circle',
        variant: 'success',
        onClick: () => confirmarEntrevistaCandidato(candidato),
      } : null,
      entrevistaAgendadaAtiva && !estadoAcoes.processClosed ? {
        label: 'Entrevista cancelada',
        icon: 'event_busy',
        danger: true,
        onClick: () => cancelarEntrevistaCandidato(candidato),
      } : null,
      entrevistaAgendadaAtiva && !estadoAcoes.processClosed ? {
        label: 'Reagendar',
        icon: 'edit_calendar',
        variant: 'primary',
        onClick: () => reagendarEntrevistaCandidato(candidato),
      } : null,
      !provaConcluida && estadoAcoes.isActive && candidatoPodeGerarProva(candidato, processo?.status || '') &&
        !candidato?.tem_prova_gerada && !candidatoTemProvaSalva(candidato) ? {
        label: 'Liberar prova',
        icon: 'assignment_add',
        onClick: () => abrirGeracaoProva(candidato),
      } : null,
      candidatoTemProvaSalva(candidato) ? {
        label: 'Ver resultado da prova',
        icon: 'analytics',
        onClick: () => abrirDetalheProva(candidato),
      } : null,
      {
        label: 'Abrir dossiê',
        icon: 'folder_open',
        onClick: () => abrirDossieDoCandidato(candidato),
      },
      podeAprovar ? {
        label: 'Enviar para contratação',
        icon: 'task_alt',
        onClick: () => abrirAprovacao(candidato),
      } : null,
      candidatoPodeIrParaBancoTalentos(candidato, estadoAcoes, processo?.status || '') ? {
        label: 'Mover para Banco de Talentos',
        icon: 'inventory_2',
        onClick: () => enviarCandidatoBancoTalentos(candidato),
      } : null,
      candidatoPodeSerEliminadoNoProcesso(candidato, estadoAcoes) ? {
        label: 'Eliminar candidato',
        icon: 'person_remove',
        danger: true,
        onClick: () => abrirEliminacao(candidato),
      } : null,
      [CANDIDATE_STATUS_ELIMINATED, CANDIDATE_STATUS_NOT_QUALIFIED, CANDIDATE_STATUS_WITHDREW].includes(
        canonicalizeCandidateStatus(candidato?.status_fluxo || candidato?.status_candidato),
      ) && !estadoAcoes.processClosed && controlador?.possuiPermissao?.('candidatos.reverter_eliminacao') ? {
        label: 'Reconsiderar eliminação',
        icon: 'settings_backup_restore',
        onClick: () => abrirReconsideracao(candidato),
      } : null,
    ];
    return acoes.filter(Boolean);
  };

  const montarAcoesProvaDetalhe = (candidato) => {
    const idProva = obterIdProvaGeradaCandidato(candidato);
    const cancelada = provaGeradaEstaCancelada(candidato);
    const iniciada = provaGeradaFoiIniciada(candidato);
    const statusCandidato = canonicalizeCandidateStatus(
      candidato.status_fluxo || candidato.status_candidato,
    );
    return [
      idProva && candidatoTemProvaSalva(candidato) ? {
        label: 'Ver resultado da prova',
        icon: 'analytics',
        onClick: () => abrirDetalheProva(candidato),
      } : null,
      idProva && !cancelada ? {
        label: 'Cancelar prova',
        icon: 'cancel',
        danger: true,
        onClick: () => cancelarProvaDoCandidato(candidato),
      } : null,
      statusCandidato !== CANDIDATE_STATUS_APPROVED && statusCandidato !== CANDIDATE_STATUS_ELIMINATED ? {
        label: 'Aprovar candidato',
        icon: 'task_alt',
        onClick: () => abrirAprovacaoPelaProva(candidato),
      } : null,
      idProva && cancelada ? {
        label: 'Reabrir prova',
        icon: 'restart_alt',
        onClick: () => reabrirProvaDoCandidato(candidato),
      } : null,
      idProva ? {
        label: 'Deletar prova',
        icon: 'delete_forever',
        danger: true,
        onClick: () => deletarProvaDoCandidato(candidato),
      } : null,
      idProva && !iniciada ? {
        label: 'Editar prova',
        icon: 'edit_document',
        onClick: () => editarProvaDoCandidato(candidato),
      } : null,
    ].filter(Boolean);
  };

  const acoesRapidasDetalhe = candidatosSelecionadosDetalhe.length > 1
    ? [
      controlador.possuiPermissao('candidatos.aprovar_final')
        ? {
          label: 'Aprovar selecionados',
          icon: 'task_alt',
          onClick: abrirAprovacaoSelecionados,
        }
        : null,
      {
        label: 'Eliminar candidato',
        icon: 'person_remove',
        danger: true,
        onClick: abrirEliminacaoSelecionados,
      },
    ].filter(Boolean)
    : candidatosSelecionadosDetalhe.length === 1
      ? abaDetalheAtiva === 'provas'
        ? montarAcoesProvaDetalhe(candidatosSelecionadosDetalhe[0])
        : montarAcoesDaLinhaDetalhe(candidatosSelecionadosDetalhe[0])
      : [];
  const candidatoFichaOperacional = fichaCandidatoSelecionada
    ? candidatosComFluxo.find((item) =>
      String(item.id_teste || '') === String(
        fichaCandidatoSelecionada?.candidato?.id_teste || fichaCandidatoSelecionada?.candidato?.id || '',
      )) || fichaCandidatoSelecionada.candidato
    : null;

  if (carregando) {
    return html`
      <${PainelRh}
        screenId="screen-process-details"
        navAtiva="screen-processes"
        subtituloMarca="Detalhes do processo"
        placeholderBusca="Detalhes do processo"
        controlador=${controlador}
        acaoPrimaria=${{
        label: 'Voltar para processos',
        onClick: () => controlador.irParaTelaProtegida('screen-processes'),
      }}
        >
        <${ToastHost} />
        <${LoadingState}
          titulo="Carregando detalhes do processo"
          descricao="Buscando dados da vaga, candidatos, entrevistas e histórico."
        />
      </${PainelRh}>
    `;
  }

  if (modoDossieProcessoAberto) {
    return html`
      <${PainelRh}
        screenId="screen-process-details"
        navAtiva="screen-processes"
        subtituloMarca="Dossiê do processo"
        placeholderBusca="Dossiê do processo"
        controlador=${controlador}
        acaoPrimaria=${{
        label: 'Voltar aos detalhes',
        onClick: () => setModoDossieProcessoAberto(false),
      }}
        >
        <${ToastHost} />
        <${PageIntro}
          kicker="Processo seletivo"
          title="Dossiê do Processo"
        />
        <${DossieProcesso}
          processo=${processo}
          candidatos=${candidatosDossie}
          candidatosFiltrados=${candidatosDossieFiltrados}
          estatisticas=${estatisticasDossie}
          filtros=${filtrosDossie}
          onFiltroChange=${atualizarFiltroDossie}
          onLimparFiltros=${limparFiltrosDossie}
          analise=${analiseDossie}
          anotacoes=${anotacoesDossie}
          formularioAnotacao=${formularioAnotacaoDossie}
          anotacaoEditandoId=${anotacaoDossieEditandoId}
          salvandoAnotacao=${salvandoAnotacaoDossie}
          erro=${erroDossie}
          mensagem=${mensagemDossie}
          onChangeAnotacao=${atualizarCampoAnotacaoDossie}
          onSelecionarCandidatoAnotacao=${selecionarCandidatoAnotacaoDossie}
          onSalvarAnotacao=${salvarAnotacaoDossie}
          onEditarAnotacao=${editarAnotacaoDossie}
          onCancelarEdicao=${cancelarEdicaoAnotacaoDossie}
        />
      </${PainelRh}>
    `;
  }

  return html`
    <${PainelRh}
      screenId="screen-process-details"
      navAtiva="screen-processes"
      subtituloMarca="Detalhes do processo"
      placeholderBusca="Detalhes do processo"
      controlador=${controlador}
      acaoPrimaria=${{
      label: 'Gerenciar processos',
      onClick: () => controlador.irParaTelaProtegida('screen-processes'),
    }}
    >
      <${ToastHost} />
      <${DetalhesProcessoRedesenhado}
        model=${{
      processo,
      candidatos: candidatosAtivosDetalhe,
      todosCandidatos: candidatosComFluxo,
      aprovados: candidatosAprovados,
      reprovados: candidatosReprovadosDetalhe,
      cvsNaoQualificados,
      cvsNaoQualificadosPaginacao: {
        paginaAtual: paginaCvsNaoQualificados,
        totalPaginas: totalPaginasCvsNaoQualificados,
        totalItens: totalItensCvsNaoQualificados,
      },
      candidatosPagina: candidatosTabelaPaginados,
      entrevistas: entrevistasTabelaDetalhe,
      entrevistasOriginais: entrevistasTabelaDetalhe,
      entrevistasPagina: entrevistasTabelaPaginadas,
      provas: provasTabelaDetalhe,
      provasPagina: provasTabelaPaginadas,
      dossie: candidatosDossie,
      historico: historicoDetalhe,
      bancoTalentos: bancoTalentosTodosFiltrados,
      bancoTalentosPagina: bancoTalentosPaginados,
      talentosJaVinculados: Math.max(0, bancoTalentosProcesso.length - bancoTalentosDisponiveis.length),
      sugeridosProcesso,
      carregandoSugeridos,
      preAnalises,
      emails: emailsRecebidos,
      requisitos: requisitosPublicos,
      responsabilidades: responsabilidadesPublicas,
      resumo,
      processoEncerrado,
      anotacoesDossie,
      formularioAnotacaoDossie,
      anotacaoDossieEditandoId,
      salvandoAnotacaoDossie,
      erroDossie,
      mensagemDossie,
    }}
        state=${{
      aba: abaDetalheAtiva,
      selecionados: candidatosSelecionados,
      buscaCandidatos: buscaCandidatosProcesso,
      filtroStatusCandidatos,
      ordenacaoCandidatos,
      exibicaoCandidatos,
      visualizacaoCandidatos,
      filtrosEntrevistas: filtrosEntrevistasDetalhe,
      filtrosProvas: filtrosProvasDetalhe,
      buscaTalentos: buscaBancoTalentos,
      filtrosTalentos: filtrosTalentosDetalhe,
      subAbaEncontrar,
      resumoVagaAberto,
    }}
        actions=${{
      voltar: () => controlador.irParaTelaProtegida('screen-processes'),
      abrirResultadosAnaliticos: controlador.possuiPermissao('provas.visualizar')
        ? () => {
          const processoId = processo?.id_processo_ref || processo?.id_processo;
          if (!processoId) return;
          window.history.pushState(null, '', `/processos/${encodeURIComponent(processoId)}/resultados-analiticos`);
          const eventoNavegacao = typeof PopStateEvent === 'function'
            ? new PopStateEvent('popstate')
            : new Event('popstate');
          window.dispatchEvent(eventoNavegacao);
        }
        : null,
      compartilhar: compartilharVaga,
      abrirResumoVaga: () => setResumoVagaAberto(true),
      fecharResumoVaga: () => setResumoVagaAberto(false),
      acoesCabecalho: montarAcoesCabecalhoDetalhe(),
      trocarAba: trocarAbaDetalhe,
      setSubAbaEncontrar,
      abrirModalAnaliseCv: abrirModalPreAnalise,
      abrirCentralCandidatos: () => controlador.irParaTelaProtegida('screen-candidates'),
      setBuscaCandidatos: setBuscaCandidatosProcesso,
      setFiltroStatusCandidatos,
      setOrdenacaoCandidatos,
      setExibicaoCandidatos,
      setVisualizacaoCandidatos,
      moverStatusCandidatoKanban: atualizarStatus,
      abrirAprovacaoCandidato: abrirAprovacao,
      abrirEliminacaoCandidato: abrirEliminacao,
      aplicarFiltrosCandidatos: () => setPaginaCandidatosProcesso(1),
      selecionarCandidato: alternarSelecaoCandidato,
      selecionarPagina: alternarSelecaoPaginaCandidatos,
      setPaginaCandidatos: setPaginaCandidatosProcesso,
      setFiltrosEntrevistas: setFiltrosEntrevistasDetalhe,
      aplicarFiltrosEntrevistas: () => setPaginaEntrevistasDetalhe(1),
      setPaginaEntrevistas: setPaginaEntrevistasDetalhe,
      editarEntrevista: abrirEdicaoEntrevista,
      setFiltrosProvas: setFiltrosProvasDetalhe,
      aplicarFiltrosProvas: () => setPaginaProvasDetalhe(1),
      abrirGeracaoProvaGeral,
      setPaginaProvas: setPaginaProvasDetalhe,
      setBuscaTalentos: setBuscaBancoTalentos,
      setFiltrosTalentos: setFiltrosTalentosDetalhe,
      setPaginaTalentos: setPaginaBancoTalentos,
      setPaginaCvsNaoQualificados: (pagina) =>
        carregar(paginaPreAnalises, filtrosPreAnalises, pagina),
      iniciarUsoTalento: iniciarUsoBancoTalentos,
      confirmarUsoTalento: confirmarUsoBancoTalentos,
      cancelarUsoTalento: () => setUsoBancoTalentosPendente(false),
      usandoTalento: usandoBancoTalentos,
      talentoPendente: usoBancoTalentosPendente ? String(bancoTalentosSelecionado || '') : '',
      formIndicacaoTalento: formIndicacaoBanco,
      setFormIndicacaoTalento: setFormIndicacaoBanco,
      acoesDaLinha: montarAcoesDaLinhaDetalhe,
      acoesRapidas: acoesRapidasDetalhe,
      iniciarUsoPreAnalise,
      confirmarUsoPreAnalise,
      cancelarUsoPreAnalise: () => setUsoPreAnalisePendente(''),
      preAnalisePendente: usoPreAnalisePendente,
      usandoPreAnaliseId,
      formIndicacaoPreAnalise,
      setFormIndicacaoPreAnalise,
      selecionarCandidatoDossie: selecionarCandidatoAnotacaoDossie,
      atualizarCampoAnotacao: atualizarCampoAnotacaoDossie,
      salvarAnotacao: salvarAnotacaoDossie,
      editarAnotacao: editarAnotacaoDossie,
      cancelarEdicaoAnotacao: cancelarEdicaoAnotacaoDossie,
    }}
      />

      <${ModalConfirmacaoAcao}
        aberto=${Boolean(acaoProvaSensivel)}
        titulo=${acaoProvaSensivel?.tipo === 'cancelar' ? 'Cancelar prova' : 'Reabrir prova'}
        descricao=${`Candidato: ${acaoProvaSensivel?.candidato?.nome_candidato || 'não informado'}.`}
        consequencia=${acaoProvaSensivel?.tipo === 'cancelar'
      ? 'O cancelamento interromperá a disponibilidade da prova e será registrado em auditoria.'
      : 'A reabertura permitirá que a prova volte ao fluxo operacional.'}
        reversibilidade=${acaoProvaSensivel?.tipo === 'cancelar'
      ? 'Esta ação poderá ser revertida posteriormente por reabertura autorizada.'
      : 'Esta ação poderá ser revertida posteriormente por novo cancelamento autorizado.'}
        labelJustificativa=${acaoProvaSensivel?.tipo === 'cancelar'
      ? 'Justificativa do cancelamento'
      : 'Justificativa da reabertura'}
        justificativaObrigatoria=${true}
        textoConfirmar=${acaoProvaSensivel?.tipo === 'cancelar'
      ? 'Confirmar cancelamento'
      : 'Confirmar reabertura'}
        textoCancelar="Voltar"
        tipo=${acaoProvaSensivel?.tipo === 'cancelar' ? 'destrutivo' : 'aviso'}
        carregando=${false}
        erro=${erro}
        onClose=${() => setAcaoProvaSensivel(null)}
        onConfirm=${confirmarAcaoProva}
      />

      <${ModalConfirmacaoAcao}
        aberto=${Boolean(candidatoReconsiderar)}
        titulo="Reconsiderar eliminação"
        descricao=${`Candidato: ${candidatoReconsiderar?.nome_candidato || 'não informado'}.`}
        consequencia="O candidato voltará para o status Em Análise, na etapa de Triagem, e passa a concorrer normalmente neste processo novamente."
        reversibilidade="Esta ação fica registrada no histórico do candidato e pode ser seguida por uma nova eliminação, se necessário."
        labelJustificativa="Justificativa da reconsideração"
        justificativaObrigatoria=${true}
        textoConfirmar="Confirmar reconsideração"
        textoCancelar="Voltar"
        tipo="aviso"
        carregando=${reconsiderandoCandidato}
        erro=${erro}
        onClose=${reconsiderandoCandidato ? () => null : () => setCandidatoReconsiderar(null)}
        onConfirm=${confirmarReconsideracao}
      />

      <${ModalConfirmacaoAcao}
        aberto=${Boolean(aprovacaoLoteSelecionados)}
        titulo="Aprovar candidatos selecionados"
        descricao=${`${aprovacaoLoteSelecionados?.length || 0} candidato(s) serão aprovados.`}
        consequencia="Cada candidato passa para o status Aprovado neste processo. Comunicação por e-mail/WhatsApp continua sendo feita individualmente, pela ficha de cada candidato."
        textoConfirmar="Confirmar aprovação"
        textoCancelar="Voltar"
        tipo="aviso"
        carregando=${aprovandoLote}
        erro=${erro}
        onClose=${aprovandoLote ? () => null : () => setAprovacaoLoteSelecionados(null)}
        onConfirm=${confirmarAprovacaoLote}
      />

      <${ModalAnaliseCvProcesso}
        aberto=${modalPreAnaliseAberto}
        processoEncerrado=${processoEncerrado}
        arquivoCv=${arquivoCv}
        guardarOriginal=${guardarCvOriginal}
        analisando=${analisandoCv}
        erro=${erroPreAnaliseModal}
        mensagem=${mensagemPreAnaliseModal}
        onClose=${fecharModalPreAnalise}
        onArquivo=${setArquivoCv}
        onGuardarOriginal=${setGuardarCvOriginal}
        onAnalisar=${enviarCv}
      />

      <${ModalCompartilharVaga}
        aberto=${modalCompartilharVagaAberto}
        processo=${processo}
        texto=${textoCompartilhamentoVaga}
        requisitos=${requisitosPublicos}
        responsabilidades=${responsabilidadesPublicas}
        onClose=${() => setModalCompartilharVagaAberto(false)}
        onCopied=${() => setFeedbackLinkPublico('Texto da vaga copiado.')}
      />

      ${false ? html`
      <${PageIntro}
        kicker="Console • Processo seletivo"
        title="Detalhes do processo"
        actions=${html`
          <div class="process-detail-top-actions">
            ${podeAbrirDossieProcesso
          ? html`
                  <button
                    type="button"
                    class="btn btn-outline-primary btn-sm"
                    onClick=${() => setModoDossieProcessoAberto(true)}
                  >
                    <span class="material-symbols-outlined">${IconeSvg('clinical_notes')}</span>
                    Dossiê do Processo
                  </button>
                `
          : null}
            <button
              type="button"
              class="btn btn-outline-secondary btn-sm"
              disabled=${!processo}
              onClick=${abrirEdicaoProcessoDetalhe}
            >
              <span class="material-symbols-outlined">${IconeSvg('edit_square')}</span>
              Editar processo seletivo
            </button>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              disabled=${processoEncerrado}
              onClick=${abrirModalPreAnalise}
            >
              <span class="material-symbols-outlined">${IconeSvg('person_add')}</span>
              Adicionar candidato ao processo
            </button>
          </div>
        `}
      />

      ${erro ? html`<div class="alert alert-danger">${erro}</div>` : null}
      ${processoEncerrado
        ? html`
            <div class="rh-inline-alert">
              Processo encerrado. As movimentações operacionais de candidatos ficam bloqueadas.
            </div>
          `
        : null}

      <div class="process-detail-top-grid">
        <${SectionCard}
          title="Resumo do processo - Vaga"
          description=${processo
        ? `${processo.id_processo || '-'} • ${processo.vaga || '-'}`
        : 'Processo não localizado.'}
          className="process-summary-panel compact-dashboard-card"
          tourId="process-summary"
          actions=${html`
            <button
              type="button"
              class="btn btn-outline-secondary btn-sm"
              onClick=${() => controlador.irParaTelaProtegida('screen-processes')}
            >
              Voltar
            </button>
          `}
        >
          <div class="process-summary-grid">
            ${[
        {
          icon: 'flag',
          label: 'Status',
          value: processo?.status || '-',
        },
        {
          icon: 'work',
          label: 'Cargo/Vaga',
          value: processo?.vaga || '-',
        },
        {
          icon: 'groups',
          label: 'Vagas',
          value: processo?.quantidade_vagas || 0,
        },
        {
          icon: 'person_search',
          label: 'Candidatos no processo',
          value: candidatosOperacionais.length || 0,
        },
        {
          icon: 'verified',
          label: 'Aprovados',
          value: candidatosAprovados.length || 0,
        },
        {
          icon: 'event_available',
          label: 'Entrevistas registradas',
          value: entrevistas.length || resumo?.entrevistas || 0,
        },
        {
          icon: 'calendar_month',
          label: 'Abertura',
          value: formatarDataCurta(processo?.data_criacao),
        },
        {
          icon: 'event_busy',
          label: 'Encerramento',
          value: formatarDataCurta(processo?.data_encerramento),
        },
      ].map(
        (item) => html`
                <article class="process-summary-card summary-metric-card" key=${item.label}>
                  <span class="material-symbols-outlined summary-metric-icon">${IconeSvg(item.icon)}</span>
                  <div class="summary-metric-content">
                    <span class="summary-metric-label">${item.label}</span>
                    <strong class="summary-metric-value">${item.value}</strong>
                  </div>
                </article>
              `,
      )}
          </div>

          <div class="process-summary-secondary process-meta-row">
            <span class="process-meta-chip">
              <span>Operação</span>
              <strong>${processo?.operacao || '-'}</strong>
            </span>
            <span class="process-meta-chip">
              <span>Trilha</span>
              <strong>${processo?.trilha || '-'}</strong>
            </span>
            <span class="process-meta-chip">
              <span>Nota de corte</span>
              <strong>
                ${Number(processo?.usa_nota_corte || 0)
        ? processo?.nota_corte || '-'
        : 'Não'}
              </strong>
            </span>
            ${processo?.link_agendamento
        ? html`
                  <a
                    href=${processo.link_agendamento}
                    target="_blank"
                    rel="noreferrer"
                    class="process-meta-chip process-meta-link"
                  >
                    <span>Link legado</span>
                    <strong>Abrir link</strong>
                  </a>
                `
        : html`
                  <span class="process-meta-chip">
                    <span>Link legado</span>
                    <strong>Não informado</strong>
                  </span>
                `}
          </div>
        </${SectionCard}>

        <${WidgetEntrevistasProcesso}
          entrevistas=${entrevistas}
          carregando=${carregando}
          onAbrirAgenda=${() => controlador.irParaTelaProtegida('screen-interviews')}
          onEditar=${abrirEdicaoEntrevista}
        />
      </div>

      ${false ? html`<${SecaoDetalheExpansivel}
        aberto=${secoesExpandidas.dossieProcesso}
        titulo="Dossiê do Processo"
        description="Visão administrativa e analítica para comparar candidatos, registrar observações e preparar análise inteligente."
        className="process-dossier-section"
        tourId="process-dossier"
        onToggle=${() => alternarSecao('dossieProcesso')}
      >
        ${avisosSecoes.dossieProcesso
          ? html`<div class="alert alert-warning">${avisosSecoes.dossieProcesso}</div>`
          : null}
        <${DossieProcesso}
          processo=${processo}
          candidatos=${candidatosDossie}
          candidatosFiltrados=${candidatosDossieFiltrados}
          estatisticas=${estatisticasDossie}
          filtros=${filtrosDossie}
          onFiltroChange=${atualizarFiltroDossie}
          onLimparFiltros=${limparFiltrosDossie}
          analise=${analiseDossie}
          anotacoes=${anotacoesDossie}
          formularioAnotacao=${formularioAnotacaoDossie}
          anotacaoEditandoId=${anotacaoDossieEditandoId}
          salvandoAnotacao=${salvandoAnotacaoDossie}
          erro=${erroDossie}
          mensagem=${mensagemDossie}
          onChangeAnotacao=${atualizarCampoAnotacaoDossie}
          onSelecionarCandidatoAnotacao=${selecionarCandidatoAnotacaoDossie}
          onSalvarAnotacao=${salvarAnotacaoDossie}
          onEditarAnotacao=${editarAnotacaoDossie}
          onCancelarEdicao=${cancelarEdicaoAnotacaoDossie}
        />
      </${SecaoDetalheExpansivel}>` : null}

      ${EXIBIR_PAGINA_PUBLICA_CANDIDATURA
        ? html`<${SecaoDetalheExpansivel}
        aberto=${secoesExpandidas.paginaPublica}
        titulo="Página pública de candidatura"
        description="Gere um link exclusivo para esta vaga e acompanhe o status da página pública sem expor informações administrativas."
        onToggle=${() => alternarSecao('paginaPublica')}
      >
        <${MetricGrid}
          items=${[
            { label: 'Status', value: statusPaginaPublica },
            {
              label: 'Slug público',
              value: processo?.link_publico_slug || 'Ainda não gerado',
            },
            {
              label: 'Criado em',
              value: formatarDataHora(processo?.link_publico_criado_em),
            },
          ]}
        />

        <div class="row g-3 align-items-end mt-1">
          <div class="col-lg-8">
            <label class="form-label">Link público externo</label>
            <input
              class="form-control"
              readonly
              value=${processo?.link_publico_slug
            ? urlPublicaCandidatura || 'URL pública ainda não configurada.'
            : 'Gere a página para visualizar o link público.'}
            />
            <div class="form-text">
              ${urlPublicaCandidatura
            ? 'Link externo montado com PUBLIC_CANDIDATE_BASE_URL.'
            : AVISO_URL_PUBLICA_NAO_CONFIGURADA}
            </div>
            ${urlInternaCandidatura
            ? html`
                  <label class="form-label mt-3">Link interno</label>
                  <input
                    class="form-control"
                    readonly
                    value=${urlInternaCandidatura}
                  />
                `
            : null}
          </div>

          <div class="col-lg-4">
            <div class="d-flex flex-wrap gap-2 justify-content-lg-end">
              ${!processo?.link_publico_slug
            ? html`
                    <button
                      type="button"
                      class="btn btn-primary"
                      disabled=${processoEncerrado}
                      onClick=${gerarPaginaPublica}
                    >
                      Gerar página de CV
                    </button>
                  `
            : html`
                    <button
                      type="button"
                      class="btn btn-outline-secondary"
                      disabled=${!linkPublicoAtivo}
                      onClick=${copiarLinkPublico}
                    >
                      Copiar link
                    </button>
                    <button
                      type="button"
                      class="btn btn-outline-primary"
                      disabled=${!urlPublicaCandidatura && !urlInternaCandidatura}
                      onClick=${abrirPaginaPublica}
                    >
                      Abrir página
                    </button>
                    <button
                      type="button"
                      class="btn btn-outline-danger"
                      disabled=${!linkPublicoAtivo}
                      onClick=${desativarPaginaPublica}
                    >
                      Desativar link
                    </button>
                    ${!linkPublicoAtivo && !processoEncerrado
                ? html`
                          <button
                            type="button"
                            class="btn btn-primary"
                            onClick=${gerarPaginaPublica}
                          >
                            Gerar nova página
                          </button>
                        `
                : null}
                  `}
            </div>
          </div>
        </div>

        <div class="row g-3 mt-2">
          <div class="col-lg-6">
            <label class="form-label">Requisitos da vaga</label>
            <div class="d-grid gap-2">
              ${requisitosPublicos.map(
                  (item, indice) => html`
                  <label class="form-check" key=${`req-${indice}`}>
                    <input
                      class="form-check-input"
                      type="checkbox"
                      checked=${item.visivel !== false}
                      onChange=${(event) =>
                      setRequisitosPublicos((anteriores) =>
                        anteriores.map((atual, atualIndice) =>
                          atualIndice === indice
                            ? { ...atual, visivel: event.target.checked }
                            : atual,
                        ),
                      )}
                    />
                    <span class="form-check-label">${item.texto}</span>
                  </label>
                `,
                )}
            </div>
          </div>
          <div class="col-lg-6">
            <label class="form-label">Responsabilidades da vaga</label>
            <div class="d-grid gap-2">
              ${responsabilidadesPublicas.map(
                  (item, indice) => html`
                  <label class="form-check" key=${`resp-${indice}`}>
                    <input
                      class="form-check-input"
                      type="checkbox"
                      checked=${item.visivel !== false}
                      onChange=${(event) =>
                      setResponsabilidadesPublicas((anteriores) =>
                        anteriores.map((atual, atualIndice) =>
                          atualIndice === indice
                            ? { ...atual, visivel: event.target.checked }
                            : atual,
                        ),
                      )}
                    />
                    <span class="form-check-label">${item.texto}</span>
                  </label>
                `,
                )}
            </div>
          </div>
          <div class="col-12">
            <label class="form-label">Observações específicas da vaga</label>
            <textarea
              class="form-control"
              rows="4"
              placeholder="Ex.: Necessário ter disponibilidade para escala 6x1."
              value=${observacoesPublicasVaga}
              onInput=${(event) =>
            setObservacoesPublicasVaga(event.target.value)}
            ></textarea>
            <div class="form-text">
              Campo opcional exibido na página pública somente quando preenchido.
            </div>
          </div>
          <div class="col-12 text-end">
            <button
              type="button"
              class="btn btn-outline-primary"
              disabled=${salvandoObservacoesPublicas}
              onClick=${salvarObservacoesPublicasVaga}
            >
              ${salvandoObservacoesPublicas ? 'Salvando...' : 'Salvar configurações'}
            </button>
          </div>
        </div>

        ${feedbackLinkPublico
            ? html`<div class="alert alert-success mt-3 mb-0">${feedbackLinkPublico}</div>`
            : null}
      </${SecaoDetalheExpansivel}>`
        : null}

      ${false ? html`<${SecaoDetalheExpansivel}
        aberto=${secoesExpandidas.recebimentoEmail}
        titulo="Recebimento de e-mail"
        description="Caixa de entrada configurável para currículos recebidos por e-mail."
        onToggle=${() => alternarSecao('recebimentoEmail')}
      >
        <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-3">
          <div class="text-muted small">
            Endereço monitorado:
            ${statusEmailRecebido?.email_address || 'posilvahp7@gmail.com'}
          </div>
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary"
            disabled=${carregandoEmails}
            onClick=${carregarEmailsDoProcesso}
          >
            ${carregandoEmails ? 'Atualizando...' : 'Atualizar e-mails'}
          </button>
        </div>

        ${!statusEmailRecebido?.configured
          ? html`
              <div class="alert alert-warning">
                ${statusEmailRecebido?.message ||
            'Recebimento de e-mail ainda não configurado ou indisponível no momento.'}
              </div>
            `
          : null}

        <div class="table-responsive">
          <table class="table align-middle rh-modern-history-table">
            <thead>
              <tr>
                <th>Remetente</th>
                <th>Assunto / resumo</th>
                <th>Data</th>
                <th>Dados encontrados</th>
                <th>Anexo</th>
                <th>Status</th>
                <th class="text-end">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${emailsRecebidos.length
          ? emailsRecebidos.map((emailItem) => {
            const anexos = Array.isArray(emailItem?.anexos)
              ? emailItem.anexos
              : [];
            const anexosCv = anexos.filter((anexo) => anexo?.cv_compativel);
            const anexoPrincipal = anexosCv[0] || null;
            return html`
                      <tr key=${emailItem.uid}>
                        <td>
                          <strong>${emailItem.remetente || '-'}</strong>
                          <div class="small text-muted">${emailItem.email_encontrado || '-'}</div>
                        </td>
                        <td>
                          <div>${emailItem.assunto || '-'}</div>
                          <div class="small text-muted">${emailItem.resumo || '-'}</div>
                        </td>
                        <td>${formatarDataHora(emailItem.data_hora)}</td>
                        <td>
                          <div>${emailItem.nome_candidato_possivel || '-'}</div>
                          <div class="small text-muted">${emailItem.vaga_pretendida_possivel || '-'}</div>
                          <div class="small text-muted">${emailItem.telefone_encontrado || '-'}</div>
                        </td>
                        <td>
                          ${emailItem.possui_anexo
                ? html`
                                <div>${emailItem.nome_anexo || 'Anexo recebido'}</div>
                                <div class="small text-muted">
                                  ${anexosCv.length ? 'CV compatível' : 'Sem anexo de CV compatível'}
                                </div>
                              `
                : 'Sem anexo'}
                        </td>
                        <td>
                          <span class="process-candidate-status-badge is-pending">
                            ${emailItem.status_analise || 'Pendente'}
                          </span>
                        </td>
                        <td class="text-end">
                          <div class="rh-table-actions">
                            <button
                              type="button"
                              class="btn btn-sm btn-outline-dark rh-action-btn"
                              onClick=${() => setStatusEmailRecebido({
                  ...(statusEmailRecebido || {}),
                  message: emailItem.resumo || 'Sem corpo para exibir.',
                })}
                            >
                              <span class="material-symbols-outlined">${IconeSvg('visibility')}</span>
                              Detalhes
                            </button>
                            <button
                              type="button"
                              class="btn btn-sm btn-outline-primary rh-action-btn"
                              disabled=${processoEncerrado || !anexoPrincipal || analisandoEmailUid === emailItem.uid}
                              onClick=${() => analisarCvDoEmail(emailItem, anexoPrincipal)}
                            >
                              <span class="material-symbols-outlined">${IconeSvg('auto_awesome')}</span>
                              ${analisandoEmailUid === emailItem.uid ? 'Analisando...' : 'Analisar CV'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    `;
          })
          : html`
                    <${TabelaVazia}
                      colunas=${7}
                      texto=${carregandoEmails
              ? 'Carregando e-mails recebidos.'
              : 'Nenhum e-mail recebido para listar.'}
                      icone="mail"
                    />
                  `}
            </tbody>
          </table>
        </div>
      </${SecaoDetalheExpansivel}>` : null}

      ${EXIBIR_CANDIDATOS_INSCRITOS ? html`<${SecaoDetalheExpansivel}
        aberto=${secoesExpandidas.candidatosInscritos}
        titulo="Candidatos inscritos"
        description="Candidatos recebidos pela página pública Envie seu currículo, ainda em triagem pelo RH."
        tourId="process-public-applicants"
        onToggle=${() => alternarSecao('candidatosInscritos')}
      >
        <div class="table-responsive">
          <table class="table align-middle rh-modern-history-table">
            <thead>
              <tr>
                <th>Candidato</th>
                <th>Contato</th>
                <th>Localidade</th>
                <th>Inscrição</th>
                <th>Status / análise</th>
                <th>Score</th>
                <th class="text-end">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${candidatosInscritos.length
          ? candidatosInscritos.map((candidato) => {
            const analise = encontrarAnaliseDoInscrito(candidato);
            return html`
                      <tr key=${candidato.id_registro}>
                        <td>
                          <strong>${candidato.nome_candidato || '-'}</strong>
                          <div class="small text-muted">${candidato.vaga || '-'}</div>
                        </td>
                        <td>
                          <div>${candidato.email || '-'}</div>
                          <div class="small text-muted">
                            ${candidato.whatsapp || candidato.telefone || '-'}
                          </div>
                        </td>
                        <td>
                          <div>${candidato.cidade || '-'}</div>
                          <div class="small text-muted">${candidato.bairro || '-'}</div>
                        </td>
                        <td>${formatarDataHora(candidato.data_prova)}</td>
                        <td>
                          <span
                            class=${`process-candidate-status-badge ${obterClasseStatusProcesso(candidato.status_fluxo)}`}
                          >
                            ${analise?.classificacao || candidato.status_fluxo || '-'}
                          </span>
                          ${analise?.classificacao
                ? html`<div class="small text-muted mt-1">CV analisado</div>`
                : html`<div class="small text-muted mt-1">Aguardando análise</div>`}
                        </td>
                        <td>${analise?.score_final ?? '-'}</td>
                        <td class="text-end">
                          <div class="rh-table-actions">
                            <button
                              type="button"
                              class="btn btn-sm btn-outline-secondary"
                              onClick=${() => abrirCurriculo(candidato)}
                            >
                              Ver CV
                            </button>
                            <button
                              type="button"
                              class="btn btn-sm btn-outline-primary"
                              disabled=${processoEncerrado}
                              onClick=${() => analisarCvInscrito(candidato)}
                            >
                              ${processoEncerrado ? 'Processo encerrado' : 'Analisar CV'}
                            </button>
                            ${analise
                ? html`
                                  <button
                                    type="button"
                                    class="btn btn-sm btn-outline-dark"
                                    onClick=${() => setResultadoAnaliseSelecionado(analise)}
                                  >
                                    Resultado
                                  </button>
                                `
                : null}
                            ${analise &&
                isPreAnaliseNaoQualificada(analise) &&
                Number(analise.ja_adicionado_ao_processo || 1) !== 1 &&
                !processoEncerrado
                ? html`
                                  <button
                                    type="button"
                                    class="btn btn-sm btn-outline-warning"
                                    onClick=${() => utilizarCandidatoNaoQualificado(analise)}
                                  >
                                    Utilizar candidato
                                  </button>
                                  <button
                                    type="button"
                                    class="btn btn-sm btn-outline-secondary rh-action-btn"
                                    onClick=${() => enviarPreAnaliseAoBancoTalentos(analise)}
                                  >
                                    Banco de Talentos
                                  </button>
                                `
                : null}
                          </div>
                        </td>
                      </tr>
                    `;
          })
          : html`
                    <${TabelaVazia}
                      colunas=${7}
                      texto="Nenhum candidato inscrito pela página pública."
                      icone="person_search"
                    />
                  `}
            </tbody>
          </table>
        </div>
      </${SecaoDetalheExpansivel}>` : null}

      <${ModalPadrao}
        aberto=${modalPreAnaliseAberto}
        titulo="Adicionar candidato ao processo"
        subtitulo="Envie um CV para análise e vinculação automática conforme a qualificação."
        className="process-preanalysis-modal-dialog"
        onClose=${fecharModalPreAnalise}
      >
      <${SecaoDetalheExpansivel}
        aberto=${true}
        titulo="Adicionar candidato"
        description="Envie o CV para análise. Qualificados entram no processo; demais ficam em CVs analisados não qualificados."
        className="process-preanalysis-section"
        tourId="process-cv-preanalysis"
        onToggle=${() => null}
      >
        ${avisosSecoes.preAnaliseCv
        ? html`<div class="alert alert-warning">${avisosSecoes.preAnaliseCv}</div>`
        : null}
        <div class="process-cv-upload-row">
          <div class="process-cv-upload-field">
            <label class="form-label">Adicionar CV</label>
            <label class=${`process-cv-picker ${processoEncerrado || analisandoCv ? 'is-disabled' : ''}`.trim()}>
              <input
                key=${arquivoCv?.name || 'sem-cv-selecionado'}
                type="file"
                class="process-cv-native-input"
                accept=".pdf,.doc,.docx"
                disabled=${processoEncerrado || analisandoCv}
                onChange=${(event) => setArquivoCv(event.target.files?.[0] || null)}
              />
              <span class="material-symbols-outlined">${IconeSvg('upload_file')}</span>
              <span class="process-cv-picker-copy">
                <strong>Selecionar CV</strong>
                <small title=${arquivoCv?.name || ''}>
                  ${arquivoCv?.name || 'Nenhum arquivo selecionado'}
                </small>
              </span>
            </label>
          </div>
          <label class="process-cv-keep-original">
            <input
              type="checkbox"
              id="guardarCvOriginal"
              checked=${guardarCvOriginal}
              onChange=${(event) => setGuardarCvOriginal(!!event.target.checked)}
            />
            <span class="process-cv-toggle-box" aria-hidden="true"></span>
            <span>Guardar CV original</span>
          </label>
          <button
            type="button"
            class="btn btn-primary btn-sm process-cv-action-btn rh-action-btn"
            onClick=${enviarCv}
            disabled=${processoEncerrado || analisandoCv}
          >
            <span class="material-symbols-outlined">${IconeSvg('auto_awesome')}</span>
            ${processoEncerrado
        ? 'Processo encerrado'
        : analisandoCv
          ? 'Analisando...'
          : 'Analisar CV'}
          </button>
        </div>

        ${erroPreAnaliseModal
        ? html`<div class="alert alert-warning mt-3">${erroPreAnaliseModal}</div>`
        : null}
        ${mensagemPreAnaliseModal
        ? html`<div class="alert alert-success mt-3">${mensagemPreAnaliseModal}</div>`
        : null}
      </${SecaoDetalheExpansivel}>
      </${ModalPadrao}>

      <${SecaoDetalheExpansivel}
        aberto=${secoesExpandidas.bancoTalentos}
        titulo="Banco de Talentos"
        description="Selecione um candidato já disponível no Banco de Talentos para usar neste processo."
        className="process-talent-bank-section"
        tourId="process-talent-bank"
        onToggle=${() => alternarSecao('bancoTalentos')}
      >
        ${avisosSecoes.bancoTalentos
        ? html`<div class="alert alert-warning">${avisosSecoes.bancoTalentos}</div>`
        : null}
        ${bancoTalentosProcesso.length
        ? html`
              ${bancoTalentosDisponiveis.length
            ? html`
                    <div class="process-section-toolbar process-talent-bank-toolbar">
                      <label class="process-search-field" aria-label="Buscar candidato no Banco de Talentos">
                        <span class="material-symbols-outlined">${IconeSvg('search')}</span>
                        <input
                          class="form-control"
                          placeholder="Buscar no Banco de Talentos..."
                          value=${buscaBancoTalentos}
                          onInput=${(event) => setBuscaBancoTalentos(event.target.value)}
                        />
                      </label>
                      <span class="process-list-counter">
                        ${bancoTalentosDisponiveisFiltrados.length} de ${bancoTalentosDisponiveis.length}
                      </span>
                    </div>
                    ${bancoTalentosDisponiveisFiltrados.length
                ? html`
                            <div class="process-talent-bank-list">
                              ${bancoTalentosPaginados.itens.map((candidatoBanco) => {
                  const selecionado =
                    String(candidatoBanco.id_banco || '') ===
                    String(bancoTalentosSelecionado || '');
                  const tagsOperacionais = montarTagsOperacionaisCandidato(candidatoBanco);
                  const scoreBanco =
                    candidatoBanco.pontuacao_final ||
                    candidatoBanco.score_final ||
                    candidatoBanco.nota_exibicao ||
                    '-';

                  return html`
                                  <article
                                    class=${`process-talent-bank-row ${selecionado ? 'is-selected' : ''}`}
                                    key=${`banco-talentos-${candidatoBanco.id_banco}`}
                                  >
                                    <div class="process-talent-bank-person">
                                      <strong>${candidatoBanco.nome_candidato || 'Candidato sem nome'}</strong>
                                      <span>${formatarContatoBancoTalentos(candidatoBanco)}</span>
                                      ${tagsOperacionais.length
                      ? html`
                                            <div class="rh-chip-wrap candidate-tag-row">
                                              ${tagsOperacionais.map(
                        (tag) => html`
                                                  <span
                                                    key=${`banco-${candidatoBanco.id_banco}-${tag.chave}`}
                                                    class=${`rh-chip ${tag.className}`}
                                                  >
                                                    ${tag.label}
                                                  </span>
                                                `,
                      )}
                                            </div>
                                          `
                      : null}
                                    </div>
                                    <div class="process-talent-bank-meta">
                                      <span>
                                        <strong>Origem/vaga</strong>
                                        ${candidatoBanco.vaga || candidatoBanco.origem || 'Banco de Talentos'}
                                      </span>
                                      <span>
                                        <strong>Score</strong>
                                        ${scoreBanco}
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      class="btn btn-primary btn-sm rh-action-btn"
                                      disabled=${processoEncerrado || usandoBancoTalentos}
                                      onClick=${() => iniciarUsoBancoTalentos(candidatoBanco)}
                                    >
                                      <span class="material-symbols-outlined">${IconeSvg('person_add')}</span>
                                      ${usandoBancoTalentos && selecionado ? 'Utilizando...' : 'Utilizar'}
                                    </button>
                                  </article>
                                `;
                })}
                            </div>
                            <${PaginacaoCompacta}
                              paginaAtual=${bancoTalentosPaginados.paginaAtual}
                              totalPaginas=${bancoTalentosPaginados.totalPaginas}
                              totalItens=${bancoTalentosPaginados.totalItens}
                              tamanhoPagina=${TAMANHO_PAGINA_BANCO_TALENTOS_DETALHE}
                              itensNaPagina=${bancoTalentosPaginados.itens.length}
                              onChange=${setPaginaBancoTalentos}
                            />
                            ${usoBancoTalentosPendente && candidatoBancoSelecionado
                    ? html`
                                  <${PainelIndicacaoUso}
                                    formulario=${formIndicacaoBanco}
                                    salvando=${usandoBancoTalentos}
                                    onChange=${setFormIndicacaoBanco}
                                    onConfirmar=${confirmarUsoBancoTalentos}
                                    onCancelar=${() => setUsoBancoTalentosPendente(false)}
                                  />
                                `
                    : null}
                          `
                : html`
                            <div class="c24-empty-state c24-empty-state-horizontal process-empty-compact">
                              <span class="material-symbols-outlined">${IconeSvg('search_off')}</span>
                              <div>
                                <h3>Nenhum candidato encontrado</h3>
                                <p>Ajuste a busca para visualizar candidatos disponíveis do Banco de Talentos.</p>
                              </div>
                            </div>
                          `}
                  `
            : html`
                    <div class="c24-empty-state c24-empty-state-horizontal process-empty-compact">
                      <span class="material-symbols-outlined">${IconeSvg('check_circle')}</span>
                      <div>
                        <h3>Todos os candidatos disponíveis já estão vinculados</h3>
                        <p>Não há novos candidatos do Banco de Talentos para este processo agora.</p>
                      </div>
                    </div>
                  `}
            `
        : html`
              <div class="c24-empty-state c24-empty-state-horizontal process-empty-compact">
                <span class="material-symbols-outlined">${IconeSvg('groups')}</span>
                <div>
                  <h3>Nenhum candidato no Banco de Talentos</h3>
                  <p>Quando houver candidatos disponíveis, eles aparecerão aqui para seleção.</p>
                </div>
              </div>
            `}
      </${SecaoDetalheExpansivel}>

      <div class="process-main-grid">

      <div class="process-candidates-grid">
        <${SecaoDetalheExpansivel}
          aberto=${secoesExpandidas.candidatosProcesso}
          titulo="Candidatos no processo"
          description="As ações aparecem somente quando a etapa do candidato permite movimentação dentro do fluxo do RH."
          className="process-candidates-section"
          tourId="process-candidates"
          onToggle=${() => alternarSecao('candidatosProcesso')}
        >
        <div class="process-section-toolbar">
          <label class="process-search-field" aria-label="Buscar candidato no processo">
            <span class="material-symbols-outlined">${IconeSvg('search')}</span>
            <input
              class="form-control"
              placeholder="Buscar candidato..."
              value=${buscaCandidatosProcesso}
              onInput=${(event) => setBuscaCandidatosProcesso(event.target.value)}
            />
          </label>
          <span class="process-list-counter">
            ${candidatosOperacionaisFiltrados.length} de ${candidatosOperacionais.length}
          </span>
        </div>
        ${candidatosOperacionaisFiltrados.length
        ? html`
            <${PaginacaoCompacta}
              paginaAtual=${candidatosProcessoPaginados.paginaAtual}
              totalPaginas=${candidatosProcessoPaginados.totalPaginas}
              totalItens=${candidatosProcessoPaginados.totalItens}
              tamanhoPagina=${TAMANHO_PAGINA_CANDIDATOS_DETALHE}
              itensNaPagina=${candidatosProcessoPaginados.itens.length}
              onChange=${setPaginaCandidatosProcesso}
            />
            <div class="candidate-list process-candidate-list">
              ${candidatosProcessoPaginados.itens.map((candidato) => {
          const tagsCandidato = Array.isArray(candidato?.tags)
            ? candidato.tags
            : [];
          const nome = candidato.nome_candidato || '-';
          const origem = formatarOrigemCandidato(candidato);
          const idCandidato =
            candidato.id_registro ||
            candidato.id_teste ||
            candidato.id_candidato ||
            '-';
          const localidade = [candidato.cidade, candidato.bairro]
            .map((valor) => String(valor || '').trim())
            .filter(Boolean)
            .join(' / ') || '-';
          const qualificacao = obterRotuloQualificacaoCandidato(candidato);
          const manualmenteQualificado = isCandidatoManualmenteQualificado(candidato);
          const tagsOperacionais = montarTagsOperacionaisCandidato(candidato);
          const tagStatusProva = obterTagStatusProvaCandidato(candidato);
          const tagsMeta = manualmenteQualificado
            ? tagsOperacionais
            : tagsOperacionais.filter((tag) => tag.chave !== 'manualmente-qualificado');
          const temProvaConcluida = candidatoTemProvaConcluida(candidato);
          const carregandoDetalhe =
            carregandoDetalheProva ===
            String(candidato.id_registro || candidato.id_teste || '');
          const podeBaixarCv =
            candidato.cv_disponivel &&
            controlador.possuiPermissao('candidatos.baixar_curriculo');
          const idMenuCandidato = String(
            candidato.id_registro ||
            candidato.id_teste ||
            candidato.id_candidato ||
            '',
          );

          return html`
                  <article class="candidate-card process-candidate-card" key=${candidato.id_registro}>
                    <div class="candidate-main process-candidate-person">
                      <span class="candidate-avatar process-candidate-avatar">
                        ${String(nome).trim().slice(0, 2).toUpperCase()}
                      </span>
                      <div class="candidate-info">
                        <strong class="candidate-name">${nome}</strong>
                        <span class="candidate-role">${candidato.vaga || '-'}</span>
                        <div class="candidate-inline-meta">
                          <span class="candidate-id">ID: ${idCandidato}</span>
                          <span class="candidate-origin">Origem: ${origem}</span>
                          <span class="candidate-location">Localidade: ${localidade}</span>
                        </div>
                        ${tagsCandidato.length
              ? html`
                              <div class="rh-chip-wrap candidate-tag-row">
                                ${tagsCandidato.slice(0, 3).map(
                (tag) => html`
                                    <span key=${tag} class="rh-chip">${tag}</span>
                                  `,
              )}
                              </div>
                            `
              : null}
                        ${origem === 'Banco de Talentos' &&
              (candidato.processo_origem || candidato.id_processo_origem)
              ? html`
                              <span class="candidate-origin">
                                Processo anterior:
                                ${candidato.processo_origem || candidato.id_processo_origem}
                              </span>
                            `
              : null}
                      </div>
                    </div>

                    <div class="candidate-meta process-candidate-meta-grid">
                      <span class=${`candidate-status-chip process-candidate-status-badge d-flex align-items-center ${obterClasseStatusProcesso(candidato.status_fluxo)}`}>
                        ${candidato.status_fluxo || '-'}
                      </span>
                      ${manualmenteQualificado
              ? null
              : html`
                            <span class="candidate-meta-chip candidate-qualified-chip">
                              ${qualificacao}
                            </span>
                          `}
                      ${tagsMeta.map(
                (tag) => html`
                            <span
                              key=${`${idMenuCandidato}-${tag.chave}`}
                              class=${`candidate-meta-chip ${tag.className}`}
                            >
                              ${tag.label}
                            </span>
                          `,
              )}
                      <span class=${`candidate-meta-chip candidate-exam-status-chip ${tagStatusProva.className}`}>
                        ${tagStatusProva.label}
                      </span>
                      <span class="candidate-meta-chip">
                        Prova
                        <strong>${temProvaConcluida ? obterNotaProvaCandidato(candidato) : 'Sem prova'}</strong>
                      </span>
                      <span class="candidate-meta-chip">
                      ${candidato.cv_disponivel ? 'CV disponível' : 'Sem CV'}
                      </span>
                    </div>

                    <div class="candidate-actions process-candidate-actions">
                      ${renderizarAcoesCompactasDoCandidato({
                candidato,
                onAgendarEntrevista: abrirAgendamento,
                onGerarProva: abrirGeracaoProva,
                onAprovar: abrirAprovacao,
                onEditar: abrirEdicaoCandidato,
                onFicha: abrirDetalhesCandidatoCompleto,
                onDetalheProva: abrirDetalheProva,
                onCurriculo: abrirCurriculo,
                onEnviarBancoTalentos: enviarCandidatoBancoTalentos,
                fichaCarregandoId: carregandoFichaCandidato,
                carregandoDetalhe,
                temProvaSalva: temProvaConcluida,
                podeBaixarCv,
                onAtualizarStatus: (item, status) =>
                  atualizarStatus(
                    item.id_registro,
                    status,
                    obterReferenciaProcessoDoCandidato(item),
                  ),
                controlador,
              })}
                    </div>
                  </article>
                `;
        })}
            </div>
            <${PaginacaoCompacta}
              paginaAtual=${candidatosProcessoPaginados.paginaAtual}
              totalPaginas=${candidatosProcessoPaginados.totalPaginas}
              totalItens=${candidatosProcessoPaginados.totalItens}
              tamanhoPagina=${TAMANHO_PAGINA_CANDIDATOS_DETALHE}
              itensNaPagina=${candidatosProcessoPaginados.itens.length}
              onChange=${setPaginaCandidatosProcesso}
            />
          `
        : html`
            <div class="c24-empty-state c24-empty-state-horizontal">
              <span class="material-symbols-outlined">${IconeSvg('person_search')}</span>
              <div>
                <h3>${candidatosOperacionais.length ? 'Nenhum candidato encontrado' : 'Nenhum candidato vinculado'}</h3>
                <p>
                  ${candidatosOperacionais.length
            ? 'Ajuste a busca para visualizar os candidatos deste processo.'
            : 'Nenhum candidato vinculado a este processo.'}
                </p>
              </div>
            </div>
          `}
        </${SecaoDetalheExpansivel}>

        <${SecaoDetalheExpansivel}
          aberto=${secoesExpandidas.cvsNaoQualificados}
          titulo="CVs analisados não qualificados"
          description="Currículos já analisados que não seguiram automaticamente como candidatos qualificados."
          className="process-unqualified-cv-section"
          tourId="process-unqualified-cvs"
          onToggle=${() => alternarSecao('cvsNaoQualificados')}
        >
          ${avisosSecoes.cvsNaoQualificados
        ? html`<div class="alert alert-warning">${avisosSecoes.cvsNaoQualificados}</div>`
        : null}
          ${cvsNaoQualificados.length
        ? html`
                <div class="unqualified-cv-list">
                  ${cvsNaoQualificados.map((item) => {
          const contato = obterContatoPreAnalise(item);
          const motivo = obterMotivoNaoQualificacao(item);
          const podeQualificar =
            !processoEncerrado &&
            Number(item.ja_adicionado_ao_processo || 0) !== 1 &&
            isPreAnaliseNaoQualificada(item);

          return html`
                      <article class="unqualified-cv-row" key=${`cv-nao-qualificado-${item.id_pre_analise}`}>
                        <div class="unqualified-cv-main">
                          <span class="unqualified-cv-avatar">
                            ${String(item.nome_candidato || item.nome_arquivo || 'CV')
              .trim()
              .slice(0, 2)
              .toUpperCase()}
                          </span>
                          <div class="unqualified-cv-identity">
                            <strong>${item.nome_candidato || 'Nome não identificado'}</strong>
                            <span title=${contato}>${contato}</span>
                          </div>
                        </div>
                        <div class="unqualified-cv-details">
                          <span title=${item.nome_arquivo || ''}>
                            <strong>Arquivo</strong>
                            ${item.nome_arquivo || '-'}
                          </span>
                          <span>
                            <strong>Análise</strong>
                            ${formatarDataHora(item.criado_em)}
                          </span>
                          <span>
                            <strong>Resultado</strong>
                            <span class=${`cv-classification-badge ${item.classificacao_slug || ''}`}>
                              ${item.classificacao || 'Não qualificado'}
                            </span>
                            <em>${item.score_final ?? '-'} pts</em>
                            ${Number(item.oculto_na_lista || 0) === 1
              ? html`<em class="unqualified-cv-dismissed-tag">Dispensado</em>`
              : null}
                          </span>
                          <span class="unqualified-cv-reason" title=${motivo}>
                            <strong>Motivo</strong>
                            ${motivo}
                          </span>
                        </div>
                        <div class="unqualified-cv-actions process-preanalysis-actions">
                          <button
                            type="button"
                            class="btn btn-sm btn-outline-success process-icon-action"
                            title=${podeQualificar ? 'Utilizar' : 'Candidato já está no processo'}
                            aria-label="Utilizar"
                            disabled=${!podeQualificar ||
            usandoPreAnaliseId === String(item.id_pre_analise || '')}
                            onClick=${() => iniciarUsoPreAnalise(item)}
                          >
                            <span class="material-symbols-outlined">${IconeSvg('person_add')}</span>
                          </button>
                          <button
                            type="button"
                            class="btn btn-sm btn-outline-dark process-icon-action"
                            title="Resultado"
                            aria-label="Resultado"
                            onClick=${() => setResultadoAnaliseSelecionado(item)}
                          >
                            <span class="material-symbols-outlined">${IconeSvg('fact_check')}</span>
                          </button>
                          <button
                            type="button"
                            class="btn btn-sm btn-outline-danger process-icon-action"
                            title=${Number(item.oculto_na_lista || 0) === 1 ? 'Já dispensado' : 'Dispensar'}
                            aria-label="Dispensar"
                            disabled=${processoEncerrado ||
            Number(item.oculto_na_lista || 0) === 1 ||
            usandoPreAnaliseId === String(item.id_pre_analise || '')}
                            onClick=${() => excluirPreAnalise(item.id_pre_analise)}
                          >
                            <span class="material-symbols-outlined">${IconeSvg('person_remove')}</span>
                          </button>
                        </div>
                        ${usoPreAnalisePendente === String(item.id_pre_analise || '')
              ? html`
                              <${PainelIndicacaoUso}
                                formulario=${formIndicacaoPreAnalise}
                                salvando=${usandoPreAnaliseId === String(item.id_pre_analise || '')}
                                onChange=${setFormIndicacaoPreAnalise}
                                onConfirmar=${() => confirmarUsoPreAnalise(item)}
                                onCancelar=${() => setUsoPreAnalisePendente('')}
                              />
                            `
              : null}
                      </article>
                    `;
        })}
                </div>
                <${PaginacaoCompacta}
                  paginaAtual=${paginaCvsNaoQualificados}
                  totalPaginas=${totalPaginasCvsNaoQualificados}
                  totalItens=${totalItensCvsNaoQualificados}
                  tamanhoPagina=${TAMANHO_PAGINA_CVS_NAO_QUALIFICADOS}
                  itensNaPagina=${cvsNaoQualificados.length}
                  onChange=${(pagina) =>
            carregar(paginaPreAnalises, filtrosPreAnalises, pagina)}
                />
              `
        : html`
                <div class="c24-empty-state c24-empty-state-horizontal process-empty-compact">
                  <span class="material-symbols-outlined">${IconeSvg('description')}</span>
                  <div>
                    <h3>Nenhum CV analisado fora do processo até o momento.</h3>
                    <p>Quando a análise automática não qualificar um currículo, ele aparecerá aqui.</p>
                  </div>
                </div>
              `}
        </${SecaoDetalheExpansivel}>

        <${SecaoDetalheExpansivel}
          aberto=${secoesExpandidas.candidatosAprovados}
          titulo="Candidatos aprovados"
          description="Aprovados ficam fora do fluxo ativo e permanecem disponíveis para consulta, resultado e relatórios."
          className="process-approved-section"
          tourId="process-approved-candidates"
          onToggle=${() => alternarSecao('candidatosAprovados')}
        >
        ${candidatosAprovados.length
        ? html`
            <div class="approved-candidate-list">
              ${candidatosAprovadosPaginados.itens.map(
          (candidato) => {
            const tagsOperacionais = montarTagsOperacionaisCandidato(candidato);
            return html`
                  <article class="approved-candidate-card" key=${`aprovado-${candidato.id_registro}`}>
                    <div>
                      <strong>${candidato.nome_candidato || '-'}</strong>
                      <span>${candidato.vaga || '-'}</span>
                      ${tagsOperacionais.length
                ? html`
                              <div class="rh-chip-wrap candidate-tag-row">
                                ${tagsOperacionais.map(
                  (tag) => html`
                                    <span
                                      key=${`aprovado-${candidato.id_registro}-${tag.chave}`}
                                      class=${`rh-chip ${tag.className}`}
                                    >
                                      ${tag.label}
                                    </span>
                                  `,
                )}
                              </div>
                            `
                : null}
                    </div>
                    <div>
                      <span>Contato</span>
                      <strong>${candidato.email || '-'}</strong>
                      <small>${candidato.whatsapp || candidato.telefone || '-'}</small>
                    </div>
                    <div>
                      <span>Nota</span>
                      <strong>${obterNotaProvaCandidato(candidato) || 'Sem prova'}</strong>
                    </div>
                    <div>
                      <span>Data de aprovação</span>
                      <strong>
                        ${formatarDataHora(
                  candidato.aprovado_em ||
                  candidato.data_aprovacao ||
                  candidato.data_atualizacao_pipeline,
                )}
                      </strong>
                    </div>
                    <div class="approved-candidate-actions">
                      <button
                        type="button"
                        class="btn btn-sm btn-outline-primary"
                        disabled=${carregandoFichaCandidato === String(candidato.id_teste || '')}
                        onClick=${() => abrirDetalhesCandidatoCompleto(candidato)}
                      >
                        ${carregandoFichaCandidato === String(candidato.id_teste || '')
                ? 'Abrindo...'
                : 'Detalhes'}
                      </button>
                      ${candidatoTemProvaSalva(candidato)
                ? html`
                            <button
                              type="button"
                              class="btn btn-sm btn-outline-dark"
                              disabled=${carregandoDetalheProva ===
                  String(candidato.id_registro || candidato.id_teste || '')}
                              onClick=${() => abrirDetalheProva(candidato)}
                            >
                              Ver resultado
                            </button>
                          `
                : null}
                      ${candidato.cv_disponivel
                ? html`
                            <button
                              type="button"
                              class="btn btn-sm btn-outline-secondary"
                              onClick=${() => abrirCurriculo(candidato)}
                            >
                              Ver CV
                            </button>
                          `
                : null}
                    </div>
                  </article>
                `;
          },
        )}
            </div>
            <${PaginacaoCompacta}
              paginaAtual=${candidatosAprovadosPaginados.paginaAtual}
              totalPaginas=${candidatosAprovadosPaginados.totalPaginas}
              totalItens=${candidatosAprovadosPaginados.totalItens}
              tamanhoPagina=${TAMANHO_PAGINA_APROVADOS_DETALHE}
              itensNaPagina=${candidatosAprovadosPaginados.itens.length}
              onChange=${setPaginaCandidatosAprovados}
            />
          `
        : html`
            <div class="c24-empty-state">
              <span class="material-symbols-outlined">${IconeSvg('groups')}</span>
              <h3>Nenhum candidato aprovado neste processo.</h3>
              <p>Aprovados ficam disponíveis aqui para consulta e relatórios.</p>
            </div>
          `}
        </${SecaoDetalheExpansivel}>
      </div>
      </div>

      ` : null}

      <${ModalPadrao}
        aberto=${!!agendamentoSelecionado}
        titulo="Agendar entrevista"
        subtitulo="A entrevista será vinculada ao candidato e ao processo selecionado."
        onClose=${() => setAgendamentoSelecionado(null)}
      >
        ${agendamentoSelecionado
      ? html`
              <div class="rh-details-body">
                <div class="row g-3">
                  <div class="col-md-6">
                    <label class="form-label">Candidato</label>
                    <input
                      class="form-control"
                      readonly
                      value=${agendamentoSelecionado.nome_candidato || ''}
                    />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Processo</label>
                    <input
                      class="form-control"
                      readonly
                      value=${agendamentoSelecionado.id_processo || ''}
                    />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Vaga</label>
                    <input
                      class="form-control"
                      readonly
                      value=${agendamentoSelecionado.vaga || ''}
                    />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Status inicial</label>
                    <input
                      class="form-control"
                      readonly
                      value=${CANDIDATE_STATUS_PENDING_CONFIRMATION}
                    />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Horário disponível</label>
                    <select
                      class="form-select"
                      value=${formularioEntrevista.id_slot}
                      disabled=${carregandoSlotsEntrevista}
                      onChange=${(event) => {
          const idSlotSelecionado = event.target.value;
          setFormularioEntrevista({
            ...formularioEntrevista,
            id_slot: idSlotSelecionado,
            mensagem_personalizada: mensagemEntrevistaEditada
              ? formularioEntrevista.mensagem_personalizada
              : montarMensagemEntrevistaPadrao(idSlotSelecionado),
          });
        }}
                    >
                      ${carregandoSlotsEntrevista
          ? html`<option value="">Carregando horários...</option>`
          : slotsDisponiveisEntrevista.length
            ? html`<option value="">Selecione um slot</option>`
            : html`
                <option value="" disabled>
                  Nenhum horário disponível para este processo
                </option>
              `}
                      ${slotsDisponiveisEntrevista.map(
              (slot) => html`
                          <option
                            key=${obterIdSlotEntrevista(slot)}
                            value=${obterIdSlotEntrevista(slot)}
                          >
                            ${formatarHorarioSlotEntrevista(slot)}
                          </option>
                        `,
            )}
                    </select>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">WhatsApp extraído do CV</label>
                    <input
                      class="form-control"
                      placeholder="21999999999"
                      value=${formularioEntrevista.whatsapp || formularioEntrevista.telefone || ''}
                      onInput=${(event) =>
          setFormularioEntrevista({
            ...formularioEntrevista,
            whatsapp: event.target.value,
          })}
                    />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">E-mail extraído do CV</label>
                    <input
                      class="form-control"
                      placeholder="candidato@email.com"
                      value=${formularioEntrevista.email || ''}
                      onInput=${(event) =>
          setFormularioEntrevista({
            ...formularioEntrevista,
            email: event.target.value,
          })}
                    />
                  </div>
                  <div class="col-md-12">
                    <label class="form-label">Documentos solicitados</label>
                    <div class="row g-2">
                      ${DOCUMENTOS_APROVACAO_PADRAO.map(
            (documento) => html`
                          <label class="form-check col-md-6" key=${documento}>
                            <input
                              class="form-check-input"
                              type="checkbox"
                              checked=${documentosEntrevista.includes(documento)}
                              onChange=${(event) =>
                alternarDocumentoEntrevista(
                  documento,
                  event.target.checked,
                )}
                            />
                            <span class="form-check-label">${documento}</span>
                          </label>
                        `,
          )}
                    </div>
                  </div>
                  <div class="col-md-12">
                    <label class="form-label">Mensagem que será enviada</label>
                    <textarea
                      class="form-control"
                      rows="6"
                      value=${montarMensagemEntrevista()}
                      onInput=${(event) => {
          setMensagemEntrevistaEditada(true);
          setFormularioEntrevista({
            ...formularioEntrevista,
            mensagem_personalizada: event.target.value,
          });
        }}
                    ></textarea>
                    <div class="form-text">
                      Este texto será usado exatamente no envio.
                    </div>
                  </div>
                  <div class="col-md-12">
                    <label class="form-label">Observações RH</label>
                    <textarea
                      class="form-control"
                      rows="4"
                      value=${formularioEntrevista.observacoes_rh}
                      onInput=${(event) =>
          setFormularioEntrevista({
            ...formularioEntrevista,
            observacoes_rh: event.target.value,
          })}
                    ></textarea>
                  </div>
                </div>
              </div>
              <footer class="rh-modal-footer">
                <button
                  type="button"
                  class="btn btn-outline-secondary"
                  onClick=${() => setAgendamentoSelecionado(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  class="btn btn-outline-primary"
                  disabled=${salvandoEntrevista || processoEncerrado || !formularioEntrevista.id_slot}
                  onClick=${() => salvarAgendamento()}
                >
                  ${salvandoEntrevista ? 'Salvando...' : 'Salvar e copiar'}
                </button>
                <button
                  type="button"
                  class="btn btn-outline-primary"
                  disabled=${salvandoEntrevista || processoEncerrado || !formularioEntrevista.id_slot}
                  onClick=${() => abrirMensagemAgendamento('email')}
                >
                  ${salvandoEntrevista ? 'Abrindo...' : 'Enviar por e-mail'}
                </button>
                <button
                  type="button"
                  class="btn btn-success"
                  disabled=${salvandoEntrevista || processoEncerrado || !formularioEntrevista.id_slot}
                  onClick=${() => abrirMensagemAgendamento('whatsapp')}
                >
                  ${salvandoEntrevista
          ? 'Abrindo...'
          : processoEncerrado
            ? 'Processo encerrado'
            : 'Enviar por WhatsApp'}
                </button>
              </footer>
            `
      : null}
      </${ModalPadrao}>

      <${ModalAprovacaoCandidato}
        aberto=${!!aprovacaoSelecionada}
        candidato=${aprovacaoSelecionada}
        processo=${processo}
        salvando=${salvandoAprovacao}
        enviandoCanal=${enviandoCanalAprovacao}
        onClose=${() => setAprovacaoSelecionada(null)}
        onConfirm=${confirmarAprovacao}
        onSendWhatsApp=${enviarAprovacaoWhatsApp}
        onSendEmail=${enviarAprovacaoEmail}
      />

      <${ModalRegistroWhatsapp}
        candidato=${whatsappSelecionado}
        formulario=${formularioWhatsapp}
        salvando=${registrandoWhatsapp}
        erro=${erroWhatsapp}
        onClose=${() => {
      setWhatsappSelecionado(null);
      setErroWhatsapp('');
    }}
        onChange=${atualizarCampoWhatsapp}
        onSave=${salvarRegistroWhatsapp}
      />

      <${ModalConfirmacaoEntrevista}
        candidato=${confirmacaoEntrevistaSelecionada}
        mensagem=${mensagemConfirmacaoEntrevista}
        onMensagem=${setMensagemConfirmacaoEntrevista}
        onClose=${() => setConfirmacaoEntrevistaSelecionada(null)}
        onEmail=${enviarConfirmacaoEntrevistaEmail}
        onWhatsapp=${enviarConfirmacaoEntrevistaWhatsapp}
      />

      ${contextoGeracaoProva ? html`<${ModalGerarProva}
        aberto=${!!contextoGeracaoProva}
        contexto=${contextoGeracaoProva || {}}
        controlador=${controlador}
        onClose=${() => setContextoGeracaoProva(null)}
        onGerada=${async () => {
        await carregar(paginaPreAnalises);
      }}
      />` : null}

      <${ModalLiberarProva}
        aberto=${!!liberacaoProvaSelecionada}
        candidato=${liberacaoProvaSelecionada?.candidato || null}
        candidatosElegiveis=${liberacaoProvaSelecionada?.candidatosElegiveis || []}
        processo=${liberacaoProvaSelecionada?.processo || processo}
        onClose=${() => setLiberacaoProvaSelecionada(null)}
        onLiberar=${liberarProvaDoProcesso}
      />

      <${ModalPadrao}
        aberto=${!!edicaoProcesso}
        titulo="Editar vaga"
        subtitulo="Ajuste as configurações principais do processo."
        onClose=${() => setEdicaoProcesso(null)}
      >
        ${edicaoProcesso
      ? html`
              <div class="rh-details-body">
                <div class="row g-3">
                  <div class="col-md-4">
                    <label class="form-label">Código do processo</label>
                    <input
                      class="form-control"
                      readonly
                      value=${edicaoProcesso.id_processo || ''}
                    />
                  </div>
                  <div class="col-md-8">
                    <label class="form-label">Cargo/Vaga</label>
                    <input
                      class="form-control"
                      value=${edicaoProcesso.vaga || ''}
                      disabled=${salvandoProcesso}
                      onInput=${(event) =>
          atualizarCampoEdicaoProcesso('vaga', event.target.value)}
                    />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Operação</label>
                    <select
                      class="form-select"
                      value=${edicaoProcesso.operacao || ''}
                      disabled=${salvandoProcesso}
                      onChange=${(event) =>
          atualizarCampoEdicaoProcesso('operacao', event.target.value)}
                    >
                      <option value="">Selecione...</option>
                      ${OPCOES_OPERACOES.map(
            (operacao) => html`
                          <option key=${operacao} value=${operacao}>${operacao}</option>
                        `,
          )}
                    </select>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Área/Trilha</label>
                    <select
                      class="form-select"
                      value=${edicaoProcesso.trilha || ''}
                      disabled=${salvandoProcesso}
                      onChange=${(event) =>
          atualizarCampoEdicaoProcesso('trilha', event.target.value)}
                    >
                      <option value="">Selecione...</option>
                      ${OPCOES_TRILHAS_PROCESSO.map(
            (opcao) => html`
                          <option key=${opcao.value} value=${opcao.value}>
                            ${opcao.label}
                          </option>
                        `,
          )}
                    </select>
                  </div>
                  <div class="col-md-4">
                    <label class="form-label">Quantidade de vagas</label>
                    <input
                      class="form-control"
                      type="number"
                      min="1"
                      value=${edicaoProcesso.quantidade_vagas || 1}
                      disabled=${salvandoProcesso}
                      onInput=${(event) =>
          atualizarCampoEdicaoProcesso('quantidade_vagas', event.target.value)}
                    />
                  </div>
                  <div class="col-md-4">
                    <label class="form-label">Data de abertura</label>
                    <input
                      class="form-control"
                      type="date"
                      readonly
                      value=${edicaoProcesso.data_criacao || ''}
                    />
                  </div>
                  <div class="col-md-4">
                    <label class="form-label">Data de encerramento</label>
                    <input
                      class="form-control"
                      type="date"
                      value=${edicaoProcesso.data_encerramento || ''}
                      disabled=${salvandoProcesso}
                      onInput=${(event) =>
          atualizarCampoEdicaoProcesso('data_encerramento', event.target.value)}
                    />
                  </div>
                  <div class="col-md-4">
                    <label class="form-label d-block mb-2">Nota de corte</label>
                    <div class="form-check form-switch pt-2">
                      <input
                        class="form-check-input"
                        type="checkbox"
                        checked=${Number(edicaoProcesso.usa_nota_corte || 0) === 1}
                        disabled=${salvandoProcesso}
                        onChange=${(event) =>
          atualizarCampoEdicaoProcesso(
            'usa_nota_corte',
            event.target.checked ? 1 : 0,
          )}
                      />
                      <label class="form-check-label">Usar nota de corte</label>
                    </div>
                  </div>
                  <div class="col-md-4">
                    <label class="form-label d-block mb-2">Botão Vaga Urgente</label>
                    <div class="form-check form-switch pt-2" title="Em breve">
                      <input
                        class="form-check-input"
                        type="checkbox"
                        checked=${Boolean(edicaoProcesso.urgente)}
                        disabled
                        onChange=${(event) =>
          atualizarCampoEdicaoProcesso('urgente', event.target.checked)}
                      />
                      <label class="form-check-label">Vaga urgente</label>
                    </div>
                    <small class="form-text text-muted">
                      Em breve. Use apenas para emergências reais quando disponível — há um limite de vagas urgentes abertas ao mesmo tempo.
                    </small>
                  </div>
                  <div class="col-md-4">
                    <label class="form-label">Nota mínima</label>
                    <input
                      class="form-control"
                      type="number"
                      min="4"
                      max="10"
                      step="0.1"
                      value=${edicaoProcesso.nota_corte ?? ''}
                      disabled=${salvandoProcesso || Number(edicaoProcesso.usa_nota_corte || 0) !== 1}
                      onInput=${(event) =>
          atualizarCampoEdicaoProcesso('nota_corte', event.target.value)}
                    />
                  </div>
                  <div class="col-md-12">
                    <label class="form-label">Link de agendamento</label>
                    <input
                      class="form-control"
                      value=${edicaoProcesso.link_agendamento || ''}
                      disabled=${salvandoProcesso}
                      onInput=${(event) =>
          atualizarCampoEdicaoProcesso('link_agendamento', event.target.value)}
                    />
                  </div>
                </div>
              </div>
              <footer class="rh-modal-footer">
                <button
                  type="button"
                  class="btn btn-outline-secondary"
                  disabled=${salvandoProcesso}
                  onClick=${() => setEdicaoProcesso(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  class="btn btn-primary"
                  disabled=${salvandoProcesso}
                  onClick=${salvarEdicaoProcessoDetalhe}
                >
                  ${salvandoProcesso ? 'Salvando...' : 'Salvar alterações'}
                </button>
              </footer>
            `
      : null}
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${Boolean(acaoProcessoSensivel)}
        titulo=${acaoProcessoSensivel?.tipo === 'pausar'
      ? 'Pausar vaga'
      : acaoProcessoSensivel?.tipo === 'retomar'
        ? 'Retomar vaga'
        : acaoProcessoSensivel?.tipo === 'cancelar'
          ? 'Cancelar vaga'
          : 'Encerrar vaga'}
        subtitulo=${`Processo ${acaoProcessoSensivel?.processo?.id_processo || acaoProcessoSensivel?.referenciaProcesso || ''}.`}
        onClose=${() => {
      if (!salvandoProcesso) {
        setAcaoProcessoSensivel(null);
        setErroAcaoProcesso('');
      }
    }}
      >
        <div class="rh-details-body process-status-action-modal">
          <p>
            ${acaoProcessoSensivel?.tipo === 'pausar'
      ? 'A pausa bloqueia novas inclusões e movimentações operacionais até a vaga ser retomada.'
      : acaoProcessoSensivel?.tipo === 'retomar'
        ? 'A retomada libera novamente as movimentações operacionais da vaga.'
        : acaoProcessoSensivel?.tipo === 'cancelar'
          ? 'O cancelamento interrompe o processo sem excluir dados históricos.'
          : 'O encerramento finaliza a vaga e bloqueia novas movimentações.'}
          </p>
          ${acaoProcessoSensivel?.tipo === 'pausar'
      ? html`
                <label class="form-label">Tempo de pausa</label>
                <select
                  class="form-select"
                  value=${tempoPausaProcesso}
                  disabled=${salvandoProcesso}
                  onChange=${(event) => setTempoPausaProcesso(event.target.value)}
                >
                  <option value="">Selecione...</option>
                  ${OPCOES_TEMPO_PAUSA_PROCESSO.map((opcao) => html`
                    <option key=${opcao.value} value=${opcao.value}>${opcao.label}</option>
                  `)}
                </select>
                ${tempoPausaProcesso && tempoPausaProcesso !== 'indefinido'
          ? html`<small class="text-muted">Previsão de término: ${formatarDataCurta(calcularPrevisaoTerminoPausa(tempoPausaProcesso))}</small>`
          : null}
                ${tempoPausaProcesso === 'indefinido'
          ? html`<small class="text-muted">A vaga ficará pausada até retomada manual.</small>`
          : null}
              `
      : null}
          <label class="form-label">
            ${acaoProcessoSensivel?.tipo === 'pausar'
      ? 'Justificativa da pausa'
      : acaoProcessoSensivel?.tipo === 'retomar'
        ? 'Justificativa da retomada'
        : acaoProcessoSensivel?.tipo === 'cancelar'
          ? 'Justificativa do cancelamento'
          : 'Justificativa do encerramento'}
          </label>
          <textarea
            class="form-control"
            rows="4"
            value=${justificativaAcaoProcesso}
            disabled=${salvandoProcesso}
            placeholder="Informe o motivo desta ação"
            onInput=${(event) => setJustificativaAcaoProcesso(event.target.value)}
          ></textarea>
          ${erroAcaoProcesso || erro
      ? html`<div class="alert alert-danger">${erroAcaoProcesso || erro}</div>`
      : null}
        </div>
        <footer class="rh-modal-footer">
          <button
            type="button"
            class="btn btn-outline-secondary"
            disabled=${salvandoProcesso}
            onClick=${() => {
      setAcaoProcessoSensivel(null);
      setErroAcaoProcesso('');
    }}
          >
            Voltar
          </button>
          <button
            type="button"
            class=${`btn ${['cancelar', 'encerrar'].includes(acaoProcessoSensivel?.tipo) ? 'btn-danger' : 'btn-primary'}`}
            disabled=${salvandoProcesso}
            onClick=${executarAcaoProcessoDetalhe}
          >
            ${salvandoProcesso
      ? 'Processando...'
      : acaoProcessoSensivel?.tipo === 'pausar'
        ? 'Confirmar pausa'
        : acaoProcessoSensivel?.tipo === 'retomar'
          ? 'Confirmar retomada'
          : acaoProcessoSensivel?.tipo === 'cancelar'
            ? 'Confirmar cancelamento'
            : 'Confirmar encerramento'}
          </button>
        </footer>
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${!!eliminacaoSelecionada}
        titulo="Eliminar candidato"
        subtitulo="Informe o motivo antes de confirmar a eliminação."
        onClose=${() => setEliminacaoSelecionada(null)}
      >
        ${eliminacaoSelecionada
      ? html`
              <div class="rh-details-body">
                <div class="row g-3">
                  <div class="col-md-12">
                    <label class="form-label">Candidato</label>
                    <input
                      class="form-control"
                      readonly
                      value=${eliminacaoSelecionada.nome_candidato || ''}
                    />
                  </div>
                  <div class="col-md-12">
                    <label class="form-label">Motivo da eliminação</label>
                    <select
                      class="form-select"
                      value=${formularioEliminacao.motivo_eliminacao}
                      onChange=${(event) =>
          setFormularioEliminacao({
            ...formularioEliminacao,
            motivo_eliminacao: event.target.value,
            sub_causa_eliminacao: '',
            etapa_eliminacao:
              event.target.value === 'Eliminado na entrevista'
                ? formularioEliminacao.etapa_eliminacao
                : '',
          })}
                    >
                      <option value="">Selecione...</option>
                      ${motivosEliminacaoDisponiveis.map(
            (motivo) => html`
                          <option key=${motivo} value=${motivo}>${motivo}</option>
                        `,
          )}
                    </select>
                  </div>
                  ${subCausasEliminacaoDisponiveis.length
          ? html`
                        <div class="col-md-12">
                          <label class="form-label">Sub-causa (opcional)</label>
                          <select
                            class="form-select"
                            value=${formularioEliminacao.sub_causa_eliminacao}
                            onChange=${(event) =>
              setFormularioEliminacao({
                ...formularioEliminacao,
                sub_causa_eliminacao: event.target.value,
              })}
                          >
                            <option value="">Selecione...</option>
                            ${subCausasEliminacaoDisponiveis.map(
                (subCausa) => html`
                                  <option key=${subCausa} value=${subCausa}>${subCausa}</option>
                                `,
              )}
                          </select>
                        </div>
                      `
          : null}
                  ${formularioEliminacao.motivo_eliminacao === 'Eliminado na entrevista'
          ? html`
                        <div class="col-md-12">
                          <label class="form-label">Em qual entrevista?</label>
                          <select
                            class="form-select"
                            value=${formularioEliminacao.etapa_eliminacao}
                            onChange=${(event) =>
              setFormularioEliminacao({
                ...formularioEliminacao,
                etapa_eliminacao: event.target.value,
              })}
                          >
                            <option value="">Selecione...</option>
                            ${ETAPAS_ELIMINACAO_ENTREVISTA.map(
                (etapa) => html`
                                <option key=${etapa} value=${etapa}>${etapa}</option>
                              `,
              )}
                          </select>
                        </div>
                      `
          : null}
                  <div class="col-md-12">
                    <label class="form-label">Observação complementar (opcional)</label>
                    <textarea
                      class="form-control"
                      rows="2"
                      maxlength="300"
                      placeholder="Detalhe rápido para ajudar a auditar essa decisão depois, se precisar."
                      value=${formularioEliminacao.observacao_eliminacao}
                      onInput=${(event) =>
          setFormularioEliminacao({
            ...formularioEliminacao,
            observacao_eliminacao: event.target.value,
          })}
                    ></textarea>
                  </div>
                </div>
                ${erroEliminacao
          ? html`<div class="alert alert-warning mt-3 mb-0">${erroEliminacao}</div>`
          : null}
              </div>
              <footer class="rh-modal-footer">
                <button
                  type="button"
                  class="btn btn-outline-secondary"
                  onClick=${() => setEliminacaoSelecionada(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  class="btn btn-danger"
                  onClick=${confirmarEliminacao}
                >
                  Confirmar eliminação
                </button>
              </footer>
            `
      : null}
      </${ModalPadrao}>

      <${ModalEdicaoEntrevista}
        aberto=${!!entrevistaEdicao}
        entrevista=${entrevistaEdicao}
        formulario=${formularioEdicaoEntrevista}
        slotsDisponiveis=${slotsDisponiveisEntrevista}
        salvando=${salvandoEdicaoEntrevista}
        onClose=${() => setEntrevistaEdicao(null)}
        onChange=${setFormularioEdicaoEntrevista}
        onSave=${salvarEdicaoEntrevista}
      />

      <${ModalFichaCandidato}
        ficha=${fichaCandidatoSelecionada}
        formulario=${formularioFichaCandidato}
        salvando=${salvandoFichaCandidato}
        erro=${erroFichaCandidato}
        mensagem=${mensagemFichaCandidato}
        onClose=${() => {
      setFichaCandidatoSelecionada(null);
      setErroFichaCandidato('');
      setMensagemFichaCandidato('');
      setCamposFichaAlterados({});
      setArquivoCvFicha(null);
    }}
        onChange=${atualizarCampoFichaCandidato}
        onSave=${salvarFichaCandidato}
        onPrint=${imprimirFichaSelecionada}
        onAbrirCurriculo=${abrirCurriculo}
        arquivoCv=${arquivoCvFicha}
        enviandoCv=${enviandoCvFicha}
        analisandoCv=${analisandoCvFicha}
        onArquivoCvChange=${setArquivoCvFicha}
        onAdicionarCv=${enviarCvFichaCandidato}
        onAnalisarCv=${analisarCvFichaCandidato}
        onEditar=${() => {
      setFichaCandidatoSelecionada(null);
      abrirEdicaoCandidato(candidatoFichaOperacional);
    }}
        onEliminar=${() => {
      setFichaCandidatoSelecionada(null);
      abrirEliminacao(candidatoFichaOperacional);
    }}
        onBanco=${() => {
      setFichaCandidatoSelecionada(null);
      enviarCandidatoBancoTalentos(candidatoFichaOperacional);
    }}
        onAprovar=${() => {
      setFichaCandidatoSelecionada(null);
      abrirAprovacao(candidatoFichaOperacional);
    }}
        onNotaCompleta=${() => abrirDetalheProva(candidatoFichaOperacional)}
      />

      <${ModalPadrao}
        aberto=${!!candidatoEditando}
        titulo=${`Editar candidato | ${candidatoEditando?.nome_candidato || 'Candidato'}`}
        subtitulo="Atualize dados cadastrais sem alterar o vínculo com o processo."
        onClose=${() => setCandidatoEditando(null)}
      >
        ${candidatoEditando
      ? html`
              <div class="rh-details-body">
                <div class="row g-3">
                  <div class="col-md-6">
                    <label class="form-label">Nome</label>
                    <input
                      class="form-control"
                      value=${formularioCandidato.nome_candidato}
                      onInput=${(event) =>
          atualizarCampoCandidato('nome_candidato', event.target.value)}
                    />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">E-mail</label>
                    <input
                      class="form-control"
                      value=${formularioCandidato.email}
                      onInput=${(event) =>
          atualizarCampoCandidato('email', event.target.value)}
                    />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Telefone</label>
                    <input
                      class="form-control"
                      value=${formularioCandidato.telefone}
                      onInput=${(event) =>
          atualizarCampoCandidato('telefone', event.target.value)}
                    />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">WhatsApp</label>
                    <input
                      class="form-control"
                      value=${formularioCandidato.whatsapp}
                      onInput=${(event) =>
          atualizarCampoCandidato('whatsapp', event.target.value)}
                    />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Cidade</label>
                    <input
                      class="form-control"
                      value=${formularioCandidato.cidade}
                      onInput=${(event) =>
          atualizarCampoCandidato('cidade', event.target.value)}
                    />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Bairro</label>
                    <input
                      class="form-control"
                      value=${formularioCandidato.bairro}
                      onInput=${(event) =>
          atualizarCampoCandidato('bairro', event.target.value)}
                    />
                  </div>
                </div>
              </div>
              <footer class="rh-modal-footer">
                <button
                  type="button"
                  class="btn btn-outline-secondary"
                  onClick=${() => setCandidatoEditando(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  class="btn btn-primary"
                  onClick=${salvarEdicaoCandidato}
                >
                  Salvar
                </button>
              </footer>
            `
      : null}
      </${ModalPadrao}>

      <${ModalDetalhesProva}
        detalhe=${detalheProvaSelecionado}
        onClose=${() => setDetalheProvaSelecionado(null)}
        onDownload=${() =>
      detalheProvaSelecionado?.linha?.id_teste
        ? baixarPacoteHistorico(
          detalheProvaSelecionado.linha.id_teste,
          detalheProvaSelecionado.linha.nome_candidato,
        )
        : null}
      />

      <${ModalPadrao}
        aberto=${!!preAnaliseSelecionada}
        titulo="Editar pré-cadastro"
        subtitulo="Ajuste as informações extraídas do CV antes de seguir."
        onClose=${() => setPreAnaliseSelecionada(null)}
      >
        ${preAnaliseSelecionada
      ? html`
              <div class="rh-details-body">
                <div class="row g-3">
                  <div class="col-md-6">
                    <label class="form-label">Nome</label>
                    <input
                      class="form-control"
                      value=${preAnaliseSelecionada.nome_candidato || ''}
                      onInput=${(event) =>
          setPreAnaliseSelecionada({
            ...preAnaliseSelecionada,
            nome_candidato: event.target.value,
          })}
                    />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">E-mail</label>
                    <input
                      class="form-control"
                      value=${preAnaliseSelecionada.email || ''}
                      onInput=${(event) =>
          setPreAnaliseSelecionada({
            ...preAnaliseSelecionada,
            email: event.target.value,
          })}
                    />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Telefone</label>
                    <input
                      class="form-control"
                      value=${preAnaliseSelecionada.telefone || ''}
                      onInput=${(event) =>
          setPreAnaliseSelecionada({
            ...preAnaliseSelecionada,
            telefone: event.target.value,
          })}
                    />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">WhatsApp</label>
                    <input
                      class="form-control"
                      value=${preAnaliseSelecionada.whatsapp || ''}
                      onInput=${(event) =>
          setPreAnaliseSelecionada({
            ...preAnaliseSelecionada,
            whatsapp: event.target.value,
          })}
                    />
                  </div>
                </div>
              </div>
              <footer class="rh-modal-footer">
                <button
                  type="button"
                  class="btn btn-outline-secondary"
                  onClick=${() => setPreAnaliseSelecionada(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  class="btn btn-primary"
                  onClick=${salvarEdicao}
                >
                  Salvar
                </button>
              </footer>
            `
      : null}
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${!!visualizacaoCv}
        titulo="Visualização do CV"
        subtitulo="Texto bruto extraído do currículo."
        onClose=${() => setVisualizacaoCv(null)}
        className="cv-preview-dialog"
      >
        ${visualizacaoCv
      ? html`
              <div class="rh-details-body">
                <div class="cv-preview-box">
                  ${visualizacaoCv.texto_extraido || 'Sem conteúdo extraído.'}
                </div>
                ${visualizacaoCv.arquivo_original_base64
          ? html`
                      <div class="mt-3 text-end">
                        <button
                          type="button"
                          class="btn btn-outline-primary"
                          onClick=${() => {
              const link = document.createElement('a');
              link.href = `data:${visualizacaoCv.mime_type || 'application/octet-stream'};base64,${visualizacaoCv.arquivo_original_base64}`;
              link.download = visualizacaoCv.nome_arquivo || 'cv';
              link.click();
            }}
                        >
                          Baixar original
                        </button>
                      </div>
                    `
          : null}
              </div>
            `
      : null}
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${!!resultadoAnaliseSelecionado}
        titulo="Resultado da análise"
        subtitulo="Resumo analítico da classificação automática do CV."
        onClose=${() => setResultadoAnaliseSelecionado(null)}
      >
        ${resultadoAnaliseSelecionado
      ? html`
              <div class="rh-details-body">
                <${MetricGrid}
                  items=${[
          {
            label: 'Score',
            value: resultadoAnaliseSelecionado.score_final ?? '-',
          },
          {
            label: 'Classificação',
            value: html`
                        <span
                          class=${`cv-classification-badge ${resultadoAnaliseSelecionado.classificacao_slug || ''}`}
                        >
                          ${resultadoAnaliseSelecionado.classificacao || '-'}
                        </span>
                      `,
          },
        ]}
                />

                <${SectionCard}
                  title="Palavras-chave identificadas"
                  className="rh-section-card--flat"
                >
                  <div class="cv-preview-box">
                    ${(() => {
          try {
            const palavras = JSON.parse(
              resultadoAnaliseSelecionado.palavras_chave || '[]',
            );
            return Array.isArray(palavras) && palavras.length
              ? palavras.join(', ')
              : 'Nenhuma palavra-chave relevante foi identificada.';
          } catch (error) {
            return (
              resultadoAnaliseSelecionado.palavras_chave ||
              'Nenhuma palavra-chave relevante foi identificada.'
            );
          }
        })()}
                  </div>
                </${SectionCard}>

                <${SectionCard}
                  title="Pontos observados pelo sistema"
                  className="rh-section-card--flat"
                >
                  <div class="cv-preview-box">
                    ${(() => {
          const dados = lerProblemasCv(resultadoAnaliseSelecionado);
          const linhas = [
            ...(dados.pontos_fortes || []),
            ...(dados.problemas || []),
          ];
          return linhas.length
            ? linhas.join('\n')
            : resultadoAnaliseSelecionado.problemas ||
            'Nenhum problema crítico foi apontado.';
        })()}
                  </div>
                </${SectionCard}>

                <${SectionCard}
                  title="Experiências e competências"
                  className="rh-section-card--flat"
                >
                  <div class="cv-preview-box">
                    ${(() => {
          const dados = lerProblemasCv(resultadoAnaliseSelecionado);
          const competencias = dados.competencias || {};
          const experiencias = dados.experiencias || [];
          const linhas = [];
          if (dados.confianca_nome) {
            linhas.push(`Nome: ${dados.nome_detectado || resultadoAnaliseSelecionado.nome_candidato || '-'} (${dados.confianca_nome})`);
          }
          if (experiencias.length) {
            linhas.push(`Experiências: ${experiencias.join(' | ')}`);
          }
          if (competencias.comportamentais?.length) {
            linhas.push(`Comportamentais: ${competencias.comportamentais.join(', ')}`);
          }
          if (competencias.tecnicas?.length) {
            linhas.push(`Técnicas: ${competencias.tecnicas.join(', ')}`);
          }
          return linhas.length
            ? linhas.join('\n')
            : 'Sem experiências ou competências claras no texto extraído.';
        })()}
                  </div>
                </${SectionCard}>

                <${SectionCard}
                  title="Resumo analítico"
                  className="rh-section-card--flat"
                >
                  <div class="cv-preview-box">
                    ${lerProblemasCv(resultadoAnaliseSelecionado).justificativa ||
        montarResumoAnaliticoCv(resultadoAnaliseSelecionado)}
                  </div>
                </${SectionCard}>
                <div class="process-result-actions">
                  ${(resultadoAnaliseSelecionado.texto_extraido ||
          resultadoAnaliseSelecionado.arquivo_original_base64)
          ? html`
                        <button
                          type="button"
                          class="btn btn-outline-info btn-sm rh-action-btn"
                          onClick=${() => {
              setVisualizacaoCv(resultadoAnaliseSelecionado);
              setResultadoAnaliseSelecionado(null);
            }}
                        >
                          <span class="material-symbols-outlined">${IconeSvg('description')}</span>
                          Ver CV
                        </button>
                      `
          : null}
                  ${!processoEncerrado
          ? html`
                        <button
                          type="button"
                          class="btn btn-outline-secondary btn-sm rh-action-btn"
                          onClick=${() => {
              setPreAnaliseSelecionada({ ...resultadoAnaliseSelecionado });
              setResultadoAnaliseSelecionado(null);
            }}
                        >
                          <span class="material-symbols-outlined">${IconeSvg('edit')}</span>
                          Editar dados
                        </button>
                      `
          : null}
                  ${!processoEncerrado &&
          Number(resultadoAnaliseSelecionado.ja_adicionado_ao_processo || 0) !== 1
          ? html`
                        <button
                          type="button"
                          class="btn btn-outline-secondary btn-sm rh-action-btn"
                          onClick=${() => enviarPreAnaliseAoBancoTalentos(resultadoAnaliseSelecionado)}
                        >
                          <span class="material-symbols-outlined">${IconeSvg('inventory_2')}</span>
                          Banco de Talentos
                        </button>
                      `
          : null}
                </div>
              </div>
            `
      : null}
      </${ModalPadrao}>
    </${PainelRh}>
  `;
}
