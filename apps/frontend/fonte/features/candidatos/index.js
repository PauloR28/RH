import {
  html,
  useEffect,
  useMemo,
  useState,
} from '../../infraestrutura-react.js';
import {
  atualizarPerfilCandidato,
  atualizarStatusCandidato,
  atualizarStatusCandidatoAvulso,
  analisarCvCandidatoInscrito,
  baixarCvCandidato,
  criarBancoTalentos,
  criarCandidatoNoProcesso,
  lerBancoTalentos,
  lerCandidatosProcessos,
  lerEntrevistas,
  lerFichaCandidato,
  lerHistorico,
  lerProcessos,
  removerBancoTalentos,
  uploadCvCandidato,
  usarCandidatoDoBancoTalentos,
} from '../../servico-api.js?v=20260721-exam-analytics-2';
import { baixarBlob, obterItensPaginados } from '../../utilitarios.js';
import {
  LoadingState,
  MetricGrid,
  ModalPadrao,
  PageIntro,
  PainelRh,
  SectionCard,
  Tabs,
  TabPanel,
} from '../../ui/componentes-compartilhados.js';
import { useToast } from '../../shared/hooks/use-toast.js';
import { ModalAprovacaoCandidato } from '../../shared/components/approval-modal.js';
import { TabelaVazia } from '../../shared/components/empty-table-row.js';
import { SkeletonTableRows } from '../../shared/components/skeleton.js';
import { PainelOnboardingCandidato } from '../onboarding/index.js';
import { PainelResultadoDisc } from '../disc/index.js';
import { PainelResultadoFitCultural } from '../fit-cultural/index.js';
import { PainelResultadoRaciocinio } from '../raciocinio-logico/index.js';
import { ModalGerarDocumento } from '../documentos-template/index.js';
import {
  CANDIDATE_STATUS_ANALYSIS,
  CANDIDATE_STATUS_APPROVED,
  CANDIDATE_STATUS_ELIMINATED,
  CANDIDATE_STATUS_TALENT_BANK,
  canonicalizeCandidateStatus,
  getCandidateActionState,
  getCandidateVisibleStatus,
  isProcessClosed,
} from '../../shared/process-flow.js';
import { abrirBlobEmNovaGuia } from '../../shared/browser-utils.js';
import {
  formatarDataHora,
  obterClasseFaixaNota,
  obterClasseStatusEntrevista,
  obterClasseStatusProcesso,
} from '../../shared/helpers-visuais.js';
import { obterReferenciaProcesso } from '../../shared/process-reference.js';
import { PainelAnaliseCurriculoIa } from './analise-curriculo-ia.js';
import { IconeSvg } from '../../ui/icone.js';

function normalizarTexto(valor) {
  return String(valor || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function mascararEmailContato(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return '-';
  const [usuario, dominio] = texto.split('@');
  if (!usuario || !dominio) return '***';
  const prefixoUsuario = usuario.slice(0, Math.min(2, usuario.length));
  const partesDominio = dominio.split('.');
  const dominioBase = partesDominio.shift() || '';
  const sufixoDominio = partesDominio.length ? `.${partesDominio.join('.')}` : '';
  return `${prefixoUsuario}${'*'.repeat(Math.max(3, usuario.length - prefixoUsuario.length))}@${dominioBase.slice(0, 1)}***${sufixoDominio}`;
}

function mascararTelefoneContato(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (!digitos) return '-';
  if (digitos.length <= 4) return '****';
  const ultimos = digitos.slice(-4);
  const ddd = digitos.length >= 10 ? `(${digitos.slice(-11, -9)}) ` : '';
  return `${ddd}*****-${ultimos}`;
}

const MENSAGEM_CANDIDATO_APROVADO_BLOQUEADO =
  'Este candidato já foi aprovado. Para alterar sua situação, será necessário um novo cadastro ou atualização manual.';
const MENSAGEM_PROCESSO_ENCERRADO_BLOQUEADO =
  'Processo encerrado. Movimentações não são permitidas.';
const CHAVE_DETALHE_CANDIDATO_RH = 'rh_candidate_detail';
const TAMANHO_PAGINA_CANDIDATOS_CENTRAL = 10;
const CLASSIFICACOES_RH_CANDIDATO = [
  'Indicado',
  'Indicado com restrições',
  'Contraindicado',
];

function isCandidatoIndicacao(candidato) {
  return Boolean(candidato?.eh_indicacao) ||
    Boolean(String(candidato?.tipo_indicacao || '').trim());
}

function isCandidatoManualmenteQualificado(candidato) {
  const origem = normalizarTexto(candidato?.origem);
  const origemRotulo = normalizarTexto(candidato?.origem_rotulo);
  const observacao = normalizarTexto(candidato?.observacao_rh);
  return Boolean(
    candidato?.manual_override ||
    candidato?.qualificacao_manual ||
    origem.includes('uso manual rh') ||
    origemRotulo.includes('uso manual rh') ||
    observacao.includes('utilizado manualmente pelo rh'),
  );
}

function montarTagsOperacionaisCandidato(candidato) {
  return [
    isCandidatoManualmenteQualificado(candidato)
      ? {
        chave: 'manualmente-qualificado',
        label: 'Manualmente Qualificado',
        className: 'candidate-manual-qualified-chip',
      }
      : null,
    isCandidatoIndicacao(candidato)
      ? {
        chave: 'indicacao',
        label: 'Indicação',
        className: 'candidate-indication-chip',
      }
      : null,
  ].filter(Boolean);
}

function candidatoEstaAprovado(candidato) {
  return (
    canonicalizeCandidateStatus(candidato?.status_visivel || candidato?.status_candidato) ===
    CANDIDATE_STATUS_APPROVED
  );
}

function obterEstadoAcoesCentral(candidato) {
  if (!candidato) {
    return getCandidateActionState(null);
  }

  if (candidato.acoes_fluxo) {
    return candidato.acoes_fluxo;
  }

  if (candidato.origem_cadastro === 'banco') {
    return {
      ...getCandidateActionState(
        { ...candidato, status_candidato: CANDIDATE_STATUS_TALENT_BANK },
        '',
      ),
      canAttach: true,
      canUseFromTalentBank: true,
    };
  }

  return getCandidateActionState(candidato, candidato.status_processo || '');
}

function possuiReferenciaProcessoReal(candidato) {
  const referencia = String(
    candidato?.id_processo_ref ||
    candidato?.id_processo ||
    candidato?.processo_nome ||
    '',
  ).trim();

  if (!referencia) return false;
  return ![
    '-',
    'sem processo',
    'sem processo vinculado',
    'processo unico',
    'processo_unico',
  ].includes(normalizarTexto(referencia));
}

// Peso visual hierárquico do KPI "Status atual" (rodada 2 de promt.txt):
// eliminado/não-qualificado chama atenção (encerramento), análise/agendado/
// banco de talentos pedem acompanhamento, aprovado é uma conclusão positiva.
const PESO_METRICA_POR_STATUS_CANDIDATO = {
  'is-eliminated': 'rh-metric-card--is-critical',
  'is-not-qualified': 'rh-metric-card--is-critical',
  'is-analysis': 'rh-metric-card--is-attention',
  'is-scheduled': 'rh-metric-card--is-attention',
  'is-talent': 'rh-metric-card--is-attention',
  'is-approved': 'rh-metric-card--is-positive',
  'is-highlight': 'rh-metric-card--is-neutral',
};

function candidatoPodeAtrelar(candidato) {
  const estadoAcoes = obterEstadoAcoesCentral(candidato);
  if (candidato?.origem_cadastro === 'banco') {
    return estadoAcoes.canUseFromTalentBank;
  }

  if (estadoAcoes.processClosed || estadoAcoes.isFinalized) {
    return false;
  }

  if (candidato?.origem_cadastro === 'processo') {
    return false;
  }

  if (possuiReferenciaProcessoReal(candidato)) {
    return false;
  }

  return estadoAcoes.canAttach;
}

function renderizarAcoesCandidatoCentral({
  candidato,
  salvando,
  onDetalhes,
  onEditar,
  onAprovar,
  onEliminar,
  onBanco,
  onAtrelar,
  controlador,
}) {
  const estadoAcoes = obterEstadoAcoesCentral(candidato);
  const podeAprovar = controlador?.possuiPermissao?.('candidatos.aprovar_final');
  const podeEliminar = controlador?.possuiPermissao?.('candidatos.eliminar');
  const podeMover = controlador?.possuiPermissao?.('candidatos.mover_etapa');
  const podeCriar = controlador?.possuiPermissao?.('candidatos.criar');
  const podeEditar = controlador?.possuiAlgumaPermissao?.(
    'candidatos.editar',
    'candidatos.editar_basico',
    'candidatos.editar_admissional',
  );
  const acoes = [
    {
      valor: 'detalhes',
      label: 'Ver detalhes',
      executar: () => onDetalhes(candidato),
    },
  ];

  if (podeEditar && candidato?.id_teste && typeof onEditar === 'function') {
    acoes.push({
      valor: 'editar',
      label: 'Editar',
      executar: () => onEditar(candidato),
    });
  }

  if (estadoAcoes.canApprove && podeAprovar) {
    acoes.push({
      valor: 'aprovar',
      label: 'Aprovar',
      disabled: salvando,
      executar: () => onAprovar(candidato),
    });
  }

  if (
    estadoAcoes.canSendToTalentBank &&
    candidato.origem_cadastro !== 'banco' &&
    candidato.id_teste &&
    podeMover
  ) {
    acoes.push({
      valor: 'banco',
      label: 'Enviar ao Banco',
      disabled: salvando,
      executar: () => onBanco(candidato),
    });
  }

  if (candidatoPodeAtrelar(candidato) && podeCriar) {
    acoes.push({
      valor: 'atrelar',
      label: 'Adicionar a processo seletivo',
      disabled: salvando,
      executar: () => onAtrelar(candidato),
    });
  }

  if (estadoAcoes.canEliminate && podeEliminar) {
    acoes.push({
      valor: 'descartar',
      label: 'Descartar',
      disabled: salvando,
      executar: () => onEliminar(candidato),
    });
  }

  return html`
    <select
      class="form-select form-select-sm candidate-row-action-select"
      aria-label=${`Ações para ${candidato.nome_candidato || 'candidato'}`}
      value=""
      onChange=${(event) => {
      const acaoSelecionada = acoes.find(
        (acao) => acao.valor === event.target.value,
      );
      event.target.value = '';
      if (!acaoSelecionada || acaoSelecionada.disabled) return;
      acaoSelecionada.executar();
    }}
    >
      <option value="">Ações</option>
      ${acoes.map(
      (acao) => html`
          <option key=${acao.valor} value=${acao.valor} disabled=${!!acao.disabled}>
            ${acao.label}
          </option>
        `,
    )}
    </select>
  `;
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
    </div>
  `;
}

function renderizarAcoesRapidasDetalhe({
  detalhe,
  salvando,
  onAprovar,
  onEliminar,
  onBanco,
  onEditar,
  onAtrelar,
  controlador,
  mostrarEditar = true,
}) {
  const estadoAcoes = obterEstadoAcoesCentral(detalhe);
  const podeAprovar = controlador?.possuiPermissao?.('candidatos.aprovar_final');
  const podeEliminar = controlador?.possuiPermissao?.('candidatos.eliminar');
  const podeMover = controlador?.possuiPermissao?.('candidatos.mover_etapa');
  const podeEditarPermissao = controlador?.possuiAlgumaPermissao?.(
    'candidatos.editar',
    'candidatos.editar_basico',
    'candidatos.editar_admissional',
  );
  const podeCriar = controlador?.possuiPermissao?.('candidatos.criar');
  const podeEditar =
    mostrarEditar &&
    podeEditarPermissao &&
    !estadoAcoes.processClosed &&
    !estadoAcoes.isFinalized &&
    detalhe?.id_teste;
  const temMovimentacao =
    (estadoAcoes.canApprove && podeAprovar) ||
    (estadoAcoes.canEliminate && podeEliminar) ||
    (estadoAcoes.canSendToTalentBank &&
      detalhe.origem_cadastro !== 'banco' &&
      detalhe.id_teste &&
      podeMover) ||
    (candidatoPodeAtrelar(detalhe) && podeCriar) ||
    podeEditar;

  if (!temMovimentacao) {
    return html`
      <span class="text-muted">
        ${estadoAcoes.processClosed
        ? MENSAGEM_PROCESSO_ENCERRADO_BLOQUEADO
        : 'Sem ações pendentes para este candidato.'}
      </span>
    `;
  }

  return html`
    <div class="rh-modal-footer-actions">
      ${estadoAcoes.canApprove && podeAprovar
      ? html`
            <button
              type="button"
              class="btn btn-outline-success"
              disabled=${salvando}
              onClick=${() => onAprovar(detalhe)}
            >
              Aprovar
            </button>
          `
      : null}
      ${estadoAcoes.canEliminate && podeEliminar
      ? html`
            <button
              type="button"
              class="btn btn-outline-danger"
              disabled=${salvando}
              onClick=${() => onEliminar(detalhe)}
            >
              Eliminar
            </button>
          `
      : null}
      ${estadoAcoes.canSendToTalentBank &&
      detalhe.origem_cadastro !== 'banco' &&
      detalhe.id_teste &&
      podeMover
      ? html`
            <button
              type="button"
              class="btn btn-outline-warning"
              disabled=${salvando}
              onClick=${() => onBanco(detalhe)}
            >
              Banco de Talentos
            </button>
          `
      : null}
      ${podeEditar
      ? html`
            <button
              type="button"
              class="btn btn-outline-secondary"
              disabled=${salvando}
              onClick=${() => onEditar(detalhe)}
            >
              Editar
            </button>
          `
      : null}
      ${candidatoPodeAtrelar(detalhe) && podeCriar
      ? html`
            <button
              type="button"
              class="btn btn-outline-primary"
              disabled=${salvando}
              onClick=${() => onAtrelar(detalhe)}
            >
              Adicionar a processo seletivo
            </button>
          `
      : null}
    </div>
  `;
}

function montarChaveCandidato(item) {
  const idTeste = String(item?.id_teste || '').trim();
  const nome = normalizarTexto(item?.nome_candidato || item?.nome || '');
  const processo = String(
    item?.id_processo_ref || item?.id_processo || '',
  ).trim();

  if (idTeste) return `teste:${idTeste}`;
  return `nome:${nome}:processo:${processo}`;
}

function obterNotaCandidato(item) {
  return (
    item?.pontuacao_final ||
    item?.nota_final ||
    item?.score_final ||
    item?.pontuacao ||
    '-'
  );
}

function tentarParseJsonCandidato(valor) {
  if (!valor || typeof valor !== 'string') return valor;
  const texto = valor.trim();
  if (!/^[\[{]/.test(texto)) return valor;
  try {
    return JSON.parse(texto);
  } catch (error) {
    return valor;
  }
}

function formatarNumeroCandidato(valor, fallback = '-') {
  const numero = Number(String(valor ?? '').replace(',', '.'));
  if (!Number.isFinite(numero)) return fallback;
  return numero.toFixed(1).replace('.', ',');
}

function obterEtapasDaProvaCandidato(item = {}) {
  const etapas = tentarParseJsonCandidato(item.etapas_json || item.resumo_etapas_json);
  if (Array.isArray(etapas)) {
    return etapas
      .filter((etapa) => etapa && typeof etapa === 'object')
      .map((etapa) => {
        const rawScore = etapa.rawScore ?? etapa.score;
        const rawMax = etapa.rawMax ?? etapa.max;
        const nota = rawScore !== undefined && rawMax
          ? `${formatarNumeroCandidato(rawScore)}/${formatarNumeroCandidato(rawMax)}`
          : formatarNumeroCandidato(etapa.weightedScore ?? etapa.nota, obterNotaCandidato(item));
        return {
          etapa: etapa.label || etapa.stage || etapa.key || 'Etapa',
          nota,
          analise: `Resultado consolidado da etapa ${etapa.label || etapa.key || 'avaliada'}, com ${etapa.questionCount || etapa.questoes || 'as'} questão(ões) consideradas.`,
        };
      });
  }

  return [{
    etapa: item.trilha || item.nivel || 'Prova',
    nota: obterNotaCandidato(item),
    analise: 'Resultado geral da prova registrado para consulta do RH.',
  }];
}

function montarTextoEtapasProvaCandidato(item = {}) {
  return obterEtapasDaProvaCandidato(item)
    .map((etapa) => `${etapa.etapa}: ${etapa.nota}\nAnálise: ${etapa.analise}`)
    .join('\n\n');
}

function obterContatoPrincipal(item) {
  return item?.email || item?.telefone || item?.whatsapp || '';
}

function obterClassificacaoCandidato(item) {
  return item?.classificacao || item?.classificacao_slug || '';
}

function obterDataCandidato(item) {
  return (
    item?.data_movimentacao ||
    item?.data_prova ||
    item?.data_iso ||
    item?.created_at ||
    item?.data_criacao ||
    ''
  );
}

function resolverRotuloOrigem(item, fallback) {
  return item?.origem || fallback;
}

function candidatoEhIndicacao(candidato) {
  return normalizarTexto(candidato?.origem || candidato?.origem_rotulo || '').includes('indicacao');
}

function renderizarOrigemComIndicacao(candidato) {
  if (!candidatoEhIndicacao(candidato)) {
    return candidato?.origem_rotulo || '-';
  }

  const indicadoPor = String(candidato?.indicado_por || '').trim();
  return html`
    <span class="rh-chip is-indicacao">
      ${indicadoPor ? `Indicação — ${indicadoPor}` : 'Indicação'}
    </span>
  `;
}

function obterOrigemBancoTalentos(candidato) {
  if (candidato?.id_processo || candidato?.id_processo_ref) {
    return candidato?.origem_rotulo || 'Processo seletivo';
  }

  return candidato?.origem_rotulo || 'Processo Unico';
}

function obterVagaBancoTalentos(candidato) {
  return candidato?.vaga || obterOrigemBancoTalentos(candidato) || 'Processo Unico';
}

function obterProcessoPorReferencia(processosPorReferencia, referencia) {
  const chave = String(referencia || '').trim();
  if (!chave || !processosPorReferencia) return null;

  if (processosPorReferencia instanceof Map) {
    return processosPorReferencia.get(chave) || null;
  }

  if (Array.isArray(processosPorReferencia)) {
    return processosPorReferencia.find((processo) =>
      [
        obterReferenciaProcesso(processo),
        processo?.id_processo_ref,
        processo?.id_processo,
      ].some((valor) => String(valor || '').trim() === chave),
    ) || null;
  }

  if (typeof processosPorReferencia === 'object') {
    return processosPorReferencia[chave] || null;
  }

  return null;
}

function montarCandidatoDeProcesso(item, processosPorReferencia) {
  const processoReferencia = String(
    item.id_processo_ref || item.id_processo || '',
  ).trim();
  const processo =
    obterProcessoPorReferencia(processosPorReferencia, processoReferencia) ||
    obterProcessoPorReferencia(
      processosPorReferencia,
      String(item.id_processo || '').trim(),
    ) ||
    null;
  const statusProcesso = processo?.status || item.status_processo || '';
  const estadoAcoes = getCandidateActionState(
    {
      ...item,
      status_processo: statusProcesso,
    },
    statusProcesso,
  );

  return {
    ...item,
    origem_cadastro: 'processo',
    origem_rotulo: resolverRotuloOrigem(item, 'Processo seletivo'),
    chave: montarChaveCandidato(item),
    nome_candidato: item.nome_candidato || '-',
    status_visivel: estadoAcoes.visibleStatus,
    id_processo_ref: processoReferencia,
    status_processo: statusProcesso,
    processo_nome: processo?.id_processo || item.id_processo || '-',
    vaga: item.vaga || processo?.vaga || '-',
    nota_exibicao: obterNotaCandidato(item),
    classificacao_exibicao: obterClassificacaoCandidato(item),
    data_exibicao: obterDataCandidato(item),
    email: item.email || '',
    telefone: item.telefone || '',
    whatsapp: item.whatsapp || '',
    cidade: item.cidade || '',
    bairro: item.bairro || '',
    cv_disponivel: !!item.cv_disponivel,
    cv_nome_arquivo: item.cv_nome_arquivo || '',
    contato_principal: obterContatoPrincipal(item),
    acoes_fluxo: {
      ...estadoAcoes,
      canAttach: false,
    },
    pode_movimentar: estadoAcoes.canMoveCandidate,
    pode_atrelar: false,
    id_registro_processo: item.id_registro,
  };
}

function montarCandidatoDoBanco(item) {
  const estadoAcoes = {
    ...getCandidateActionState(
      { ...item, status_candidato: CANDIDATE_STATUS_TALENT_BANK },
      '',
    ),
    canAttach: true,
    canUseFromTalentBank: true,
  };

  return {
    ...item,
    origem_cadastro: 'banco',
    origem_rotulo: resolverRotuloOrigem(item, 'Banco de Talentos'),
    chave: montarChaveCandidato(item),
    nome_candidato: item.nome_candidato || '-',
    status_visivel: CANDIDATE_STATUS_TALENT_BANK,
    id_processo_ref: item.id_processo_ref || item.id_processo || '',
    processo_nome: item.id_processo || 'Sem processo vinculado',
    vaga: item.vaga || '-',
    nota_exibicao: obterNotaCandidato(item),
    classificacao_exibicao: obterClassificacaoCandidato(item),
    data_exibicao: obterDataCandidato(item),
    email: item.email || '',
    telefone: item.telefone || '',
    whatsapp: item.whatsapp || '',
    cidade: item.cidade || '',
    bairro: item.bairro || '',
    cv_disponivel: !!item.cv_disponivel,
    cv_nome_arquivo: item.cv_nome_arquivo || '',
    contato_principal: obterContatoPrincipal(item),
    status_processo: '',
    acoes_fluxo: estadoAcoes,
    pode_movimentar: false,
    pode_atrelar: true,
    id_banco: item.id_banco,
  };
}

function montarCandidatoDoHistorico(item) {
  const possuiProcesso = possuiReferenciaProcessoReal(item);
  const statusHistorico = canonicalizeCandidateStatus(
    item.status_candidato || item.status,
  );
  const estadoHistorico = getCandidateActionState(
    { ...item, status_candidato: statusHistorico },
    '',
  );
  const statusVisivel =
    estadoHistorico.isFinalized
      ? statusHistorico
      : possuiProcesso
        ? 'Em processo'
        : 'Sem processo vinculado';
  const estadoAcoes = getCandidateActionState(
    { ...item, status_candidato: statusVisivel },
    '',
  );
  const podeAtrelar = !possuiProcesso && estadoAcoes.canAttach;

  return {
    ...item,
    origem_cadastro: 'historico',
    origem_rotulo: resolverRotuloOrigem(item, 'Histórico de prova'),
    chave: montarChaveCandidato(item),
    nome_candidato: item.nome_candidato || '-',
    status_visivel: statusVisivel,
    id_processo_ref: item.id_processo_ref || item.id_processo || '',
    processo_nome: item.id_processo || 'Sem processo vinculado',
    vaga: item.vaga || '-',
    nota_exibicao: obterNotaCandidato(item),
    classificacao_exibicao: obterClassificacaoCandidato(item),
    data_exibicao: obterDataCandidato(item),
    email: item.email || '',
    telefone: item.telefone || '',
    whatsapp: item.whatsapp || '',
    cidade: item.cidade || '',
    bairro: item.bairro || '',
    cv_disponivel: !!item.cv_disponivel,
    cv_nome_arquivo: item.cv_nome_arquivo || '',
    contato_principal: obterContatoPrincipal(item),
    acoes_fluxo: {
      ...estadoAcoes,
      canAttach: podeAtrelar,
    },
    pode_movimentar: false,
    pode_atrelar: podeAtrelar,
  };
}

function resumirStatus(candidatos) {
  const resumo = {
    total: candidatos.length,
    aprovados: 0,
    eliminados: 0,
    analise: 0,
    processo: 0,
    banco: 0,
  };

  candidatos.forEach((candidato) => {
    const status = normalizarTexto(candidato.status_visivel);

    if (status.includes('aprovado')) {
      resumo.aprovados += 1;
    } else if (status.includes('eliminado') || status.includes('reprovado')) {
      resumo.eliminados += 1;
    } else if (status.includes('banco')) {
      resumo.banco += 1;
    } else if (
      candidato.origem_cadastro === 'processo' ||
      status.includes('processo') ||
      status.includes('agendado') ||
      status.includes('confirmado') ||
      status.includes('compareceu')
    ) {
      resumo.processo += 1;
    } else {
      resumo.analise += 1;
    }
  });

  return resumo;
}

function SelectProcesso({ processos, valor, onChange, disabled = false }) {
  return html`
    <select
      class="form-select"
      value=${valor}
      disabled=${disabled}
      onChange=${(event) => onChange(event.target.value)}
    >
      <option value="">Selecione um processo aberto</option>
      ${processos.map((processo) => {
    const referencia = obterReferenciaProcesso(processo);
    const rotulo = [
      processo.id_processo || processo.nome || 'Processo',
      processo.vaga ? `| Vaga: ${processo.vaga}` : '',
      processo.operacao || processo.cliente
        ? `| ${processo.operacao || processo.cliente}`
        : '',
      processo.data_criacao ? `| Início: ${processo.data_criacao}` : '',
      processo.data_encerramento ? `| Enc.: ${processo.data_encerramento}` : '',
      processo.quantidade_vagas || processo.vagas
        ? `| Vagas: ${processo.vagas_preenchidas || 0}/${processo.quantidade_vagas || processo.vagas}`
        : '',
      processo.status ? `| ${processo.status}` : '',
    ]
      .filter(Boolean)
      .join(' ');

    return html`
          <option key=${referencia} value=${referencia}>${rotulo}</option>
        `;
  })}
    </select>
  `;
}

function listaParaTexto(valor) {
  if (Array.isArray(valor)) return valor.join(', ');
  return String(valor || '');
}

function textoParaLista(valor) {
  return String(valor || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function valorFichaOuNaoInformado(valor) {
  return String(valor || '').trim() || 'Não informado';
}

function montarFormularioPerfil(candidato) {
  return {
    nome_candidato: candidato?.nome_candidato || '',
    email: candidato?.email || '',
    telefone: candidato?.telefone || '',
    whatsapp: candidato?.whatsapp || '',
    endereco: candidato?.endereco || '',
    cidade: candidato?.cidade || '',
    bairro: candidato?.bairro || '',
    data_nascimento: candidato?.data_nascimento || '',
    escolaridade: candidato?.escolaridade || '',
    possui_experiencia: candidato?.possui_experiencia || '',
    musica: candidato?.musica || '',
    prato: candidato?.prato || '',
    futebol: candidato?.futebol || '',
    time: candidato?.time || '',
    rede_social: candidato?.rede_social || '',
    observacao_rh: candidato?.observacao_rh || '',
    classificacao_indicacao: candidato?.classificacao_indicacao || '',
    justificativa_indicacao: candidato?.justificativa_indicacao || '',
    habilidades: listaParaTexto(candidato?.habilidades || []),
    tags: listaParaTexto(candidato?.tags || []),
  };
}

function montarAnaliseBreveTestes(estados) {
  const frases = [];

  const disc = estados.disc?.resultado?.resultado;
  const percentuaisDisc = disc?.perfil?.percentuais || {};
  if (disc) {
    const dimensaoDominante = Object.entries(percentuaisDisc).sort(([, a], [, b]) => (b || 0) - (a || 0))[0];
    if (dimensaoDominante) {
      frases.push(`Perfil DISC predominante: ${LABEL_DIMENSAO_DISC[dimensaoDominante[0]] || dimensaoDominante[0]} (${dimensaoDominante[1] || 0}%).`);
    }
    const aderencia = disc?.aderencia_call_center;
    if (aderencia?.percentual_aderencia != null) {
      frases.push(`Aderência ao perfil Call Center: ${aderencia.percentual_aderencia}% (${aderencia.faixa || 'não classificada'}).`);
    }
  }

  const fitCultural = estados.fitCultural?.resultado;
  if (fitCultural?.score_geral != null) {
    const faixa = fitCultural.score_geral >= 70 ? 'alto alinhamento' : fitCultural.score_geral >= 40 ? 'alinhamento moderado' : 'baixo alinhamento';
    frases.push(`Fit Cultural: ${fitCultural.score_geral}% — ${faixa} com os valores da empresa.`);
  }

  const raciocinio = estados.raciocinio?.resultado?.resultado;
  if (raciocinio?.nota != null) {
    frases.push(`Raciocínio Lógico: nota ${raciocinio.nota} (${raciocinio.acertos ?? 0}/${raciocinio.total_questoes ?? 0} acertos).`);
  }

  return frases.join(' ');
}

const LABEL_DIMENSAO_DISC = { D: 'Dominância', I: 'Influência', S: 'Estabilidade', C: 'Conformidade' };

function RotuloCampo({ texto, valor, obrigatorio = true }) {
  const vazio = obrigatorio && !String(valor ?? '').trim();
  return html`
    <label class=${`form-label${vazio ? ' is-vazio' : ''}`}>
      ${texto}
      ${vazio ? html`<span class="form-label-flag" title="Campo vazio ou incompleto">Vazio</span>` : null}
    </label>
  `;
}

function aplicarDadosFichaAoCandidato(candidato, ficha) {
  if (!ficha?.candidato) return candidato || {};
  const dados = ficha.candidato || {};
  const avaliacao = ficha.avaliacao_rh || {};
  const curriculo = dados.curriculo || {};
  const processos = Array.isArray(ficha.processos) ? ficha.processos : [];
  const processoComIndicacao = processos.find(isCandidatoIndicacao) || {};
  const processoManual = processos.find(isCandidatoManualmenteQualificado) || {};

  return {
    ...(candidato || {}),
    nome_candidato: dados.nome_candidato || candidato?.nome_candidato || '',
    email: dados.email || candidato?.email || '',
    telefone: dados.telefone || candidato?.telefone || '',
    whatsapp: dados.whatsapp || candidato?.whatsapp || '',
    endereco: dados.endereco || candidato?.endereco || '',
    cidade: dados.cidade || candidato?.cidade || '',
    bairro: dados.bairro || candidato?.bairro || '',
    data_nascimento: dados.data_nascimento || candidato?.data_nascimento || '',
    idade: dados.idade || candidato?.idade || '',
    escolaridade: dados.escolaridade || candidato?.escolaridade || '',
    possui_experiencia: dados.possui_experiencia || candidato?.possui_experiencia || '',
    musica: dados.musica || candidato?.musica || '',
    prato: dados.prato || candidato?.prato || '',
    futebol: dados.futebol || candidato?.futebol || '',
    time: dados.time || candidato?.time || '',
    rede_social: dados.rede_social || candidato?.rede_social || '',
    observacao_rh:
      avaliacao.observacoes !== undefined
        ? avaliacao.observacoes || ''
        : candidato?.observacao_rh || '',
    classificacao_indicacao:
      avaliacao.classificacao || candidato?.classificacao_indicacao || '',
    justificativa_indicacao:
      avaliacao.justificativa || candidato?.justificativa_indicacao || '',
    cv_disponivel:
      curriculo.disponivel !== undefined
        ? !!curriculo.disponivel
        : !!candidato?.cv_disponivel,
    cv_nome_arquivo:
      curriculo.nome_arquivo || candidato?.cv_nome_arquivo || '',
    cv_score_final:
      dados.nota_curriculo || candidato?.cv_score_final || '',
    nota_exibicao:
      dados.nota_curriculo || candidato?.nota_exibicao || '',
    classificacao_exibicao:
      dados.status_curriculo || candidato?.classificacao_exibicao || '',
    eh_indicacao:
      Boolean(candidato?.eh_indicacao) || Boolean(processoComIndicacao.eh_indicacao),
    tipo_indicacao:
      candidato?.tipo_indicacao || processoComIndicacao.tipo_indicacao || '',
    origem:
      candidato?.origem || processoManual.origem || '',
    origem_rotulo:
      candidato?.origem_rotulo || processoManual.origem || '',
  };
}

function mesmoCandidato(item, candidato) {
  const idItem = String(item?.id_teste || '').trim();
  const idCandidato = String(candidato?.id_teste || '').trim();
  if (idItem && idCandidato && idItem === idCandidato) return true;

  const nomeItem = normalizarTexto(item?.nome_candidato || item?.nome || '');
  const nomeCandidato = normalizarTexto(candidato?.nome_candidato || '');
  return Boolean(nomeItem && nomeCandidato && nomeItem === nomeCandidato);
}

function obterDataEvento(item) {
  return (
    item?.data_entrevista ||
    item?.data_movimentacao ||
    item?.data_prova ||
    item?.data_iso ||
    item?.data_exibicao ||
    item?.data ||
    item?.criado_em ||
    item?.data_criacao ||
    ''
  );
}

function ordenarEventosDecrescente(a, b) {
  return String(obterDataEvento(b)).localeCompare(String(obterDataEvento(a)));
}

function montarDossieCandidato(candidato, fontes) {
  const processos = (fontes.candidatosProcessos || [])
    .filter((item) => mesmoCandidato(item, candidato))
    .sort(ordenarEventosDecrescente);
  const provas = (fontes.historico || [])
    .filter((item) => mesmoCandidato(item, candidato))
    .sort(ordenarEventosDecrescente);
  const entrevistas = (fontes.entrevistas || [])
    .filter((item) => mesmoCandidato(item, candidato))
    .sort(ordenarEventosDecrescente);
  const bancoTalentos = (fontes.bancoTalentos || [])
    .filter((item) => mesmoCandidato(item, candidato))
    .sort(ordenarEventosDecrescente);

  const alertas = [];
  if (!candidato.contato_principal) {
    alertas.push('Sem contato principal consolidado.');
  }
  if (!candidato.cv_disponivel) {
    alertas.push('Sem CV anexado ao cadastro consolidado.');
  }
  if (
    normalizarTexto(candidato.status_visivel) === 'qualificado' &&
    !entrevistas.length
  ) {
    alertas.push('Candidato qualificado ainda sem entrevista interna agendada.');
  }
  if (entrevistas.some((item) => normalizarTexto(item.status_entrevista) === 'faltou')) {
    alertas.push('Existe registro de falta em entrevista.');
  }
  if (!alertas.length) {
    alertas.push('Nenhum alerta crítico encontrado.');
  }

  const historicoCompleto = [
    ...processos.map((item) => ({
      tipo: 'Processo',
      data: obterDataEvento(item),
      descricao: `${item.id_processo || '-'} | ${item.vaga || '-'} | ${item.status_candidato || '-'}`,
    })),
    ...provas.map((item) => ({
      tipo: 'Prova',
      data: obterDataEvento(item),
      descricao: `${item.vaga || '-'} | nota ${obterNotaCandidato(item)} | ${item.status || '-'}`,
    })),
    ...entrevistas.map((item) => ({
      tipo: 'Entrevista',
      data: obterDataEvento(item),
      descricao: `${item.id_processo || '-'} | ${item.status_entrevista || '-'} | ${item.observacoes_rh || 'Sem observações.'}`,
    })),
    ...bancoTalentos.map((item) => ({
      tipo: 'Banco de Talentos',
      data: obterDataEvento(item),
      descricao: `${item.vaga || '-'} | ${item.origem || '-'}`,
    })),
  ].sort(ordenarEventosDecrescente);

  return {
    processos,
    provas,
    entrevistas,
    bancoTalentos,
    alertas,
    historicoCompleto,
  };
}

function escaparHtml(valor) {
  return String(valor || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderizarLinhasFicha(itens, colunas) {
  if (!itens.length) {
    return `<tr><td colspan="${colunas.length}">Sem registros.</td></tr>`;
  }

  return itens
    .map(
      (item) => `
        <tr>
          ${colunas
          .map((coluna) => `<td>${escaparHtml(coluna.valor(item))}</td>`)
          .join('')}
        </tr>
      `,
    )
    .join('');
}

function abrirFichaImpressao(candidato, dossie, notificar = null) {
  const janela = window.open('', '_blank');
  if (!janela) {
    if (notificar) {
      notificar('Não foi possível abrir a ficha para impressão.', 'error');
    } else {
      window.alert('Não foi possível abrir a ficha para impressão.');
    }
    return;
  }
  const ficha = dossie || {
    alertas: [],
    processos: [],
    provas: [],
    entrevistas: [],
    historicoCompleto: [],
  };

  const htmlFicha = `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <title>Dossiê do candidato</title>
        <style>
          body { font-family: Arial, sans-serif; color: #172033; margin: 32px; }
          h1 { font-size: 24px; margin: 0 0 6px; }
          h2 { font-size: 15px; margin: 22px 0 8px; border-bottom: 1px solid #d8dee9; padding-bottom: 4px; }
          p { margin: 3px 0; }
          table { border-collapse: collapse; width: 100%; margin-top: 8px; }
          th, td { border: 1px solid #d8dee9; padding: 7px; font-size: 12px; vertical-align: top; }
          th { background: #f5f7fb; text-align: left; }
          .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 18px; margin-top: 14px; }
          .alerta { background: #fff7e6; border: 1px solid #f2c46d; padding: 8px; margin: 4px 0; }
          @media print { body { margin: 16mm; } button { display: none; } }
        </style>
      </head>
      <body>
        <button onclick="window.print()">Imprimir / salvar dossiê</button>
        <h1>${escaparHtml(candidato.nome_candidato || 'Candidato')}</h1>
        <p>Dossiê consolidado do candidato</p>
        <div class="grid">
          <p><strong>Status:</strong> ${escaparHtml(candidato.status_visivel || '-')}</p>
          <p><strong>Processo:</strong> ${escaparHtml(candidato.processo_nome || '-')}</p>
          <p><strong>Vaga:</strong> ${escaparHtml(candidato.vaga || '-')}</p>
          <p><strong>Nota/score:</strong> ${escaparHtml(candidato.nota_exibicao || '-')}</p>
          <p><strong>Classificação:</strong> ${escaparHtml(candidato.classificacao_exibicao || '-')}</p>
          <p><strong>Email:</strong> ${escaparHtml(candidato.email || '-')}</p>
          <p><strong>Telefone:</strong> ${escaparHtml(candidato.telefone || candidato.whatsapp || '-')}</p>
          <p><strong>CV:</strong> ${escaparHtml(candidato.cv_nome_arquivo || 'Sem CV anexado')}</p>
          <p><strong>Classificação do RH:</strong> ${escaparHtml(candidato.classificacao_indicacao || '-')}</p>
        </div>

        <h2>Avaliação do RH</h2>
        <p><strong>Justificativa / observações do RH:</strong> ${escaparHtml(candidato.justificativa_indicacao || candidato.observacao_rh || '-')}</p>

        <h2>Alertas</h2>
        ${ficha.alertas.map((alerta) => `<div class="alerta">${escaparHtml(alerta)}</div>`).join('')}

        <h2>Processos</h2>
        <table>
          <thead><tr><th>Processo</th><th>Vaga</th><th>Status</th><th>Score</th><th>Data</th></tr></thead>
          <tbody>
            ${renderizarLinhasFicha(ficha.processos, [
    { valor: (item) => item.id_processo || '-' },
    { valor: (item) => item.vaga || '-' },
    { valor: (item) => item.status_candidato || '-' },
    { valor: (item) => obterNotaCandidato(item) },
    { valor: (item) => formatarDataHora(obterDataEvento(item)) },
  ])}
          </tbody>
        </table>

        <h2>Provas</h2>
        <table>
          <thead><tr><th>ID</th><th>Vaga</th><th>Nota geral</th><th>Análise por etapa</th><th>Data</th></tr></thead>
          <tbody>
            ${renderizarLinhasFicha(ficha.provas, [
    { valor: (item) => item.id_teste || '-' },
    { valor: (item) => item.vaga || '-' },
    { valor: (item) => obterNotaCandidato(item) },
    { valor: (item) => montarTextoEtapasProvaCandidato(item) },
    { valor: (item) => formatarDataHora(obterDataEvento(item)) },
  ])}
          </tbody>
        </table>

      </body>
    </html>
  `;

  janela.document.open();
  janela.document.write(htmlFicha);
  janela.document.close();
  janela.focus();
}

export function TelaDetalhesCandidato({ controlador }) {
  const { showToast, ToastHost } = useToast();
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [fontes, setFontes] = useState({
    historico: [],
    candidatosProcessos: [],
    bancoTalentos: [],
    entrevistas: [],
  });
  const [candidato, setCandidato] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(CHAVE_DETALHE_CANDIDATO_RH) || '{}');
    } catch (error) {
      return {};
    }
  });
  const [formPerfil, setFormPerfil] = useState(() => montarFormularioPerfil(candidato));
  const [salvando, setSalvando] = useState(false);
  const [processosAbertos, setProcessosAbertos] = useState([]);
  const [modalVinculoAberto, setModalVinculoAberto] = useState(false);
  const [processoSelecionado, setProcessoSelecionado] = useState('');
  const [salvandoVinculo, setSalvandoVinculo] = useState(false);
  const [camposPerfilAlterados, setCamposPerfilAlterados] = useState({});
  const [arquivoCvFicha, setArquivoCvFicha] = useState(null);
  const [enviandoCvFicha, setEnviandoCvFicha] = useState(false);
  const [analisandoCvFicha, setAnalisandoCvFicha] = useState(false);
  const [abaDetalheAtiva, setAbaDetalheAtiva] = useState('geral');

  const carregar = async ({ forcar = false } = {}) => {
    setCarregando(true);
    setErro('');
    try {
      const [historicoResp, candidatosResp, bancoResp, entrevistasResp, processosResp] =
        await Promise.allSettled([
          lerHistorico(),
          lerCandidatosProcessos({ forcar }),
          lerBancoTalentos({ forcar }),
          lerEntrevistas(),
          lerProcessos({ forcar }),
        ]);
      const historico = historicoResp.status === 'fulfilled' && Array.isArray(historicoResp.value) ? historicoResp.value : [];
      const candidatosProcessos = candidatosResp.status === 'fulfilled' && Array.isArray(candidatosResp.value) ? candidatosResp.value : [];
      const bancoTalentos = bancoResp.status === 'fulfilled' && Array.isArray(bancoResp.value) ? bancoResp.value : [];
      const entrevistas = entrevistasResp.status === 'fulfilled' && Array.isArray(entrevistasResp.value) ? entrevistasResp.value : [];
      const processos = processosResp.status === 'fulfilled' && Array.isArray(processosResp.value) ? processosResp.value : [];
      const processosPorReferencia = processos.reduce((mapa, processo) => {
        const referencia = obterReferenciaProcesso(processo);
        if (referencia) mapa.set(referencia, processo);
        if (processo.id_processo) {
          mapa.set(String(processo.id_processo), processo);
        }
        return mapa;
      }, new Map());
      const candidatosUnificados = [
        ...historico.map(montarCandidatoDoHistorico),
        ...bancoTalentos.map(montarCandidatoDoBanco),
        ...candidatosProcessos.map((item) => montarCandidatoDeProcesso(item, processosPorReferencia)),
      ];
      const base = candidato || {};
      const atualizado = candidatosUnificados.find((item) => mesmoCandidato(item, base)) || base;
      let consolidado = { ...base, ...atualizado };
      if (consolidado.id_teste) {
        const ficha = await lerFichaCandidato(consolidado.id_teste).catch(() => null);
        if (ficha) {
          consolidado = aplicarDadosFichaAoCandidato(consolidado, ficha);
        }
      }

      setFontes({ historico, candidatosProcessos, bancoTalentos, entrevistas });
      setProcessosAbertos(processos.filter((processo) => !isProcessClosed(processo)));
      setCandidato(consolidado);
      setFormPerfil(montarFormularioPerfil(consolidado));
      setCamposPerfilAlterados({});
      sessionStorage.setItem(CHAVE_DETALHE_CANDIDATO_RH, JSON.stringify(consolidado));
    } catch (error) {
      setErro(error?.message || 'Não foi possível carregar os detalhes do candidato.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const dossie = useMemo(
    () => montarDossieCandidato(candidato || {}, fontes),
    [candidato, fontes],
  );
  const eventosAvaliacao = dossie.provas.flatMap((item) =>
    obterEtapasDaProvaCandidato(item).map((etapa) => ({
      tipo: 'Prova realizada',
      data: obterDataEvento(item),
      processo: item.id_processo || item.vaga,
      resultado: etapa.etapa + ': ' + etapa.nota,
      observacao: etapa.analise,
    })),
  );

  const atualizarCampo = (campo, valor) => {
    setFormPerfil((atual) => ({ ...atual, [campo]: valor }));
    setCamposPerfilAlterados((atual) => ({ ...atual, [campo]: true }));
    setErro('');
    setMensagem('');
  };

  const salvar = async () => {
    if (!candidato?.id_teste) {
      setErro('Este candidato ainda não possui ID de prova para edição consolidada.');
      return;
    }
    setSalvando(true);
    setErro('');
    setMensagem('');
    try {
      const payload = {
        nome_candidato: formPerfil.nome_candidato || candidato.nome_candidato || '',
        email: formPerfil.email,
        telefone: formPerfil.telefone,
        whatsapp: formPerfil.whatsapp,
        endereco: formPerfil.endereco,
        cidade: formPerfil.cidade,
        bairro: formPerfil.bairro,
        data_nascimento: formPerfil.data_nascimento,
        escolaridade: formPerfil.escolaridade,
        possui_experiencia: formPerfil.possui_experiencia,
        musica: formPerfil.musica,
        prato: formPerfil.prato,
        futebol: formPerfil.futebol,
        time: formPerfil.time,
        rede_social: formPerfil.rede_social,
        classificacao_indicacao: formPerfil.classificacao_indicacao,
        justificativa_indicacao: formPerfil.justificativa_indicacao,
        habilidades: textoParaLista(formPerfil.habilidades),
        tags: textoParaLista(formPerfil.tags),
      };
      if (camposPerfilAlterados.observacao_rh) {
        payload.observacao_rh = formPerfil.observacao_rh;
      }
      const resultado = await atualizarPerfilCandidato(candidato.id_teste, payload);
      const atualizado = {
        ...candidato,
        ...payload,
        ...(resultado?.candidato || {}),
        habilidades: resultado?.candidato?.habilidades || payload.habilidades,
        tags: resultado?.candidato?.tags || payload.tags,
      };
      setCandidato(atualizado);
      setFormPerfil(montarFormularioPerfil(atualizado));
      setCamposPerfilAlterados({});
      sessionStorage.setItem(CHAVE_DETALHE_CANDIDATO_RH, JSON.stringify(atualizado));
      setMensagem('Dados do candidato atualizados com sucesso.');
    } catch (error) {
      setErro(error?.message || 'Não foi possível salvar as alterações do candidato.');
    } finally {
      setSalvando(false);
    }
  };

  const abrirCurriculo = async () => {
    if (!candidato?.id_teste || !candidato?.cv_disponivel) {
      showToast('Não há currículo disponível para este candidato.', 'warning');
      return;
    }
    try {
      const arquivo = await baixarCvCandidato(candidato.id_teste);
      abrirBlobEmNovaGuia(arquivo.blob);
    } catch (error) {
      setErro(error?.message || 'Não foi possível abrir o currículo do candidato.');
    }
  };

  const enviarCvFicha = async () => {
    if (!candidato?.id_teste) {
      setErro('Este candidato ainda não possui ID para anexar currículo.');
      return;
    }
    if (!arquivoCvFicha) {
      setErro('Selecione um CV para adicionar.');
      return;
    }

    const extensao = `.${String(arquivoCvFicha.name || '').split('.').pop() || ''}`.toLowerCase();
    if (!['.pdf', '.doc', '.docx'].includes(extensao)) {
      setErro('Formato de currículo não suportado. Envie PDF, DOC ou DOCX.');
      return;
    }

    setEnviandoCvFicha(true);
    setErro('');
    setMensagem('');
    try {
      const formData = new FormData();
      formData.append('arquivo', arquivoCvFicha);
      await uploadCvCandidato(candidato.id_teste, formData);
      setArquivoCvFicha(null);
      setMensagem('CV adicionado à ficha do candidato.');
      await carregar();
    } catch (error) {
      setErro(error?.message || 'Não foi possível adicionar o CV.');
    } finally {
      setEnviandoCvFicha(false);
    }
  };

  const analisarCvFicha = async () => {
    if (!candidato?.id_teste) {
      setErro('Este candidato ainda não possui ID para análise de CV.');
      return;
    }
    if (!candidato?.cv_disponivel && !arquivoCvFicha) {
      setErro('Adicione um CV antes de analisar.');
      return;
    }

    setAnalisandoCvFicha(true);
    setErro('');
    setMensagem('');
    try {
      if (arquivoCvFicha) {
        const formData = new FormData();
        formData.append('arquivo', arquivoCvFicha);
        await uploadCvCandidato(candidato.id_teste, formData);
        setArquivoCvFicha(null);
      }
      const resultado = await analisarCvCandidatoInscrito(candidato.id_teste, {
        id_processo: candidato.id_processo_ref || candidato.id_processo || '',
      });
      setMensagem(
        `CV analisado. Classificação: ${resultado?.classificacao || '-'} | Score: ${resultado?.score ?? '-'}.`,
      );
      await carregar();
    } catch (error) {
      setErro(error?.message || 'Não foi possível analisar o CV.');
    } finally {
      setAnalisandoCvFicha(false);
    }
  };

  const abrirModalVinculo = () => {
    if (!candidatoPodeAtrelar(candidato)) {
      showToast('Este candidato não possui ações pendentes para vínculo.', 'warning');
      return;
    }
    if (!processosAbertos.length) {
      showToast('Nenhum processo seletivo aberto encontrado.', 'warning');
      return;
    }
    setProcessoSelecionado('');
    setModalVinculoAberto(true);
  };

  const candidatoJaVinculadoAoProcessoFicha = () => {
    if (!processoSelecionado) return false;

    const idTeste = String(candidato?.id_teste || '').trim();
    const email = normalizarTexto(candidato?.email || '');
    const telefones = [candidato?.telefone, candidato?.whatsapp]
      .map((valor) => String(valor || '').replace(/\D/g, ''))
      .filter(Boolean);

    return (fontes.candidatosProcessos || []).some((item) => {
      const mesmaReferencia =
        String(item.id_processo_ref || item.id_processo || '').trim() ===
        String(processoSelecionado || '').trim();
      if (!mesmaReferencia) return false;

      const mesmoId = idTeste && String(item.id_teste || '').trim() === idTeste;
      const mesmoEmail = email && normalizarTexto(item.email || '') === email;
      const telefonesItem = [item.telefone, item.whatsapp]
        .map((valor) => String(valor || '').replace(/\D/g, ''))
        .filter(Boolean);
      const mesmoTelefone =
        telefones.length &&
        telefonesItem.some((telefone) => telefones.includes(telefone));

      return Boolean(mesmoId || mesmoEmail || mesmoTelefone);
    });
  };

  const confirmarVinculoProcesso = async () => {
    if (!processoSelecionado) {
      showToast('Selecione um processo seletivo aberto.', 'warning');
      return;
    }

    const processo = processosAbertos.find(
      (item) => obterReferenciaProcesso(item) === processoSelecionado,
    );
    if (!processo) {
      showToast('Processo selecionado não encontrado.', 'warning');
      return;
    }

    if (candidatoJaVinculadoAoProcessoFicha()) {
      showToast('Este candidato já está vinculado a este processo seletivo.', 'warning');
      return;
    }

    setSalvandoVinculo(true);
    setErro('');
    setMensagem('');
    try {
      if (candidato?.origem_cadastro === 'banco' && candidato?.id_banco) {
        await usarCandidatoDoBancoTalentos(candidato.id_banco, {
          id_processo: processo.id_processo || '',
          id_processo_ref: processoSelecionado,
          origem: 'Ficha do candidato',
        });
      } else {
        await criarCandidatoNoProcesso({
          id_processo: processo.id_processo || '',
          id_processo_ref: processoSelecionado,
          id_teste: candidato.id_teste || '',
          nome_candidato: candidato.nome_candidato || '',
          vaga: candidato.vaga || processo.vaga || '',
          status_candidato: CANDIDATE_STATUS_ANALYSIS,
          pontuacao_final:
            candidato.pontuacao_final ||
            candidato.nota_final ||
            candidato.nota_exibicao ||
            '',
          data_prova:
            candidato.data_prova ||
            candidato.data_iso ||
            candidato.data_exibicao ||
            new Date().toISOString(),
          origem: 'Ficha do candidato',
        });
      }

      setModalVinculoAberto(false);
      setProcessoSelecionado('');
      setMensagem('Candidato vinculado ao processo seletivo.');
      await carregar();
    } catch (error) {
      setErro(error?.message || 'Não foi possível adicionar o candidato ao processo seletivo.');
    } finally {
      setSalvandoVinculo(false);
    }
  };

  return html`
    <${PainelRh}
      screenId="screen-candidate-details"
      navAtiva="screen-candidates"
      subtituloMarca="Detalhes do candidato"
      placeholderBusca="Buscar candidatos"
      controlador=${controlador}
      acaoPrimaria=${{
        label: salvando ? 'Salvando...' : 'Salvar alterações',
        icon: 'save',
        onClick: salvar,
        disabled: salvando,
      }}
    >
      <${ToastHost} />
      <${PageIntro}
        kicker="Central de candidatos"
        title=${candidato?.nome_candidato || 'Detalhes do Candidato'}
      />

      ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}
      ${mensagem ? html`<div class="alert alert-success">${mensagem}</div>` : null}
      ${carregando
      ? html`
            <${LoadingState}
              titulo="Carregando candidato"
              descricao="Buscando ficha, histórico e vínculos do candidato."
            />
          `
      : null}

      <${Tabs}
        tabs=${[
          { key: 'geral', label: 'Informações gerais' },
          { key: 'provas', label: 'Provas e testes' },
        ]}
        activeKey=${abaDetalheAtiva}
        onChange=${setAbaDetalheAtiva}
      />

      <${TabPanel} tabKey="geral" activeKey=${abaDetalheAtiva}>
      <${MetricGrid}
        items=${[
      {
        label: 'Status atual',
        value: candidato.status_visivel || candidato.status_candidato || '-',
        variant: PESO_METRICA_POR_STATUS_CANDIDATO[
          obterClasseStatusProcesso(candidato.status_visivel || candidato.status_candidato)
        ] || 'rh-metric-card--is-neutral',
      },
      { label: 'Score do CV', value: candidato.nota_exibicao || candidato.cv_score_final || '-', variant: 'rh-metric-card--is-neutral' },
      { label: 'Score Conecta', value: candidato.score_conecta || candidato.score_final || candidato.nota_exibicao || '-', variant: 'rh-metric-card--is-neutral' },
      { label: 'Processo atual', value: candidato.processo_nome || candidato.id_processo_ref || candidato.id_processo || '-', variant: 'rh-metric-card--is-neutral' },
    ]}
      />
      ${montarTagsOperacionaisCandidato(candidato).length
      ? html`
            <div class="rh-chip-wrap candidate-tag-row candidate-sheet-tag-row">
              ${montarTagsOperacionaisCandidato(candidato).map(
        (tag) => html`
                  <span key=${`ficha-${tag.chave}`} class=${`rh-chip ${tag.className}`}>
                    ${tag.label}
                  </span>
                `,
      )}
            </div>
          `
      : null}

      <${SectionCard} title="Dados pessoais e contato" className="rh-section-card--flat">
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label">Nome completo</label>
            <input class="form-control" value=${formPerfil.nome_candidato} onInput=${(event) => atualizarCampo('nome_candidato', event.target.value)} />
          </div>
          <div class="col-md-3">
            <label class="form-label">E-mail</label>
            <input class="form-control" value=${formPerfil.email} onInput=${(event) => atualizarCampo('email', event.target.value)} />
          </div>
          <div class="col-md-3">
            <label class="form-label">Telefone</label>
            <input class="form-control" value=${formPerfil.telefone} onInput=${(event) => atualizarCampo('telefone', event.target.value)} />
          </div>
          <div class="col-md-3">
            <label class="form-label">WhatsApp</label>
            <input class="form-control" value=${formPerfil.whatsapp} onInput=${(event) => atualizarCampo('whatsapp', event.target.value)} />
          </div>
          <div class="col-md-6">
            <label class="form-label">Endereço</label>
            <input class="form-control" value=${formPerfil.endereco} onInput=${(event) => atualizarCampo('endereco', event.target.value)} />
          </div>
          <div class="col-md-3">
            <label class="form-label">Cidade</label>
            <input class="form-control" value=${formPerfil.cidade} onInput=${(event) => atualizarCampo('cidade', event.target.value)} />
          </div>
          <div class="col-md-3">
            <label class="form-label">Bairro</label>
            <input class="form-control" value=${formPerfil.bairro} onInput=${(event) => atualizarCampo('bairro', event.target.value)} />
          </div>
          <div class="col-md-3">
            <label class="form-label">Data de nascimento</label>
            <input type="date" class="form-control" value=${formPerfil.data_nascimento} onInput=${(event) => atualizarCampo('data_nascimento', event.target.value)} />
          </div>
          <div class="col-md-3">
            <label class="form-label">Idade</label>
            <input class="form-control" readonly value=${candidato.idade ? `${candidato.idade} anos` : 'Não informado'} />
          </div>
          <div class="col-md-3">
            <label class="form-label">Escolaridade</label>
            <input class="form-control" value=${formPerfil.escolaridade} onInput=${(event) => atualizarCampo('escolaridade', event.target.value)} />
          </div>
          <div class="col-md-3">
            <label class="form-label">Possui experiência</label>
            <select class="form-select" value=${formPerfil.possui_experiencia} onChange=${(event) => atualizarCampo('possui_experiencia', event.target.value)}>
              <option value="">Não informado</option>
              <option value="Sim">Sim</option>
              <option value="Nao">Não</option>
            </select>
          </div>
          <div class="col-md-3">
            <label class="form-label">Status atual</label>
            <input class="form-control" readonly value=${candidato.status_visivel || candidato.status_candidato || '-'} />
          </div>
          <div class="col-md-3">
            <label class="form-label">Classificação do RH</label>
            <select
              class="form-select"
              value=${formPerfil.classificacao_indicacao}
              onChange=${(event) => atualizarCampo('classificacao_indicacao', event.target.value)}
            >
              <option value="">Não definida</option>
              ${CLASSIFICACOES_RH_CANDIDATO.map(
        (opcao) => html`<option key=${opcao} value=${opcao}>${opcao}</option>`,
      )}
            </select>
          </div>
        </div>
      </${SectionCard}>

      <${SectionCard} title="Pesquisa cultural" className="rh-section-card--flat">
        <div class="row g-3">
          <div class="col-md-4">
            <label class="form-label">Música</label>
            <input class="form-control" placeholder=${valorFichaOuNaoInformado(candidato.musica)} value=${formPerfil.musica} onInput=${(event) => atualizarCampo('musica', event.target.value)} />
          </div>
          <div class="col-md-4">
            <label class="form-label">Prato</label>
            <input class="form-control" placeholder=${valorFichaOuNaoInformado(candidato.prato)} value=${formPerfil.prato} onInput=${(event) => atualizarCampo('prato', event.target.value)} />
          </div>
          <div class="col-md-4">
            <label class="form-label">Futebol</label>
            <input class="form-control" placeholder=${valorFichaOuNaoInformado(candidato.futebol)} value=${formPerfil.futebol} onInput=${(event) => atualizarCampo('futebol', event.target.value)} />
          </div>
          <div class="col-md-4">
            <label class="form-label">Time</label>
            <input class="form-control" placeholder=${valorFichaOuNaoInformado(candidato.time)} value=${formPerfil.time} onInput=${(event) => atualizarCampo('time', event.target.value)} />
          </div>
          <div class="col-md-8">
            <label class="form-label">Rede social</label>
            <input class="form-control" placeholder=${valorFichaOuNaoInformado(candidato.rede_social)} value=${formPerfil.rede_social} onInput=${(event) => atualizarCampo('rede_social', event.target.value)} />
          </div>
        </div>
      </${SectionCard}>

      <${SectionCard} title="Currículo, notas e análises" className="rh-section-card--flat">
        <div class="row g-3">
          <div class="col-md-3"><strong>Currículo</strong><div>${candidato.cv_nome_arquivo || 'Sem CV anexado'}</div></div>
          <div class="col-md-3"><strong>Score do CV</strong><div>${candidato.nota_exibicao || '-'}</div></div>
          <div class="col-md-3"><strong>Balanceamento das notas</strong><div>${candidato.classificacao_exibicao || '-'}</div></div>
          <div class="col-md-3"><strong>Decisão final</strong><div>${candidato.decisao_final || candidato.status_visivel || '-'}</div></div>
          <div class="col-12">
            <div class="candidate-cv-action-row">
              ${candidato.cv_disponivel
      ? html`
                    <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${abrirCurriculo}>
                      <span class="material-symbols-outlined">${IconeSvg('description')}</span>
                      Ver CV
                    </button>
                  `
      : html`
                    <label class="process-cv-picker candidate-cv-picker">
                      <input
                        key=${arquivoCvFicha?.name || 'cv-ficha-vazio'}
                        type="file"
                        class="process-cv-native-input"
                        accept=".pdf,.doc,.docx"
                        disabled=${enviandoCvFicha || analisandoCvFicha}
                        onChange=${(event) => setArquivoCvFicha(event.target.files?.[0] || null)}
                      />
                      <span class="material-symbols-outlined">${IconeSvg('upload_file')}</span>
                      <span class="process-cv-picker-copy">
                        <strong>Adicionar CV</strong>
                        <small title=${arquivoCvFicha?.name || ''}>
                          ${arquivoCvFicha?.name || 'Nenhum arquivo selecionado'}
                        </small>
                      </span>
                    </label>
                    <button
                      type="button"
                      class="btn btn-outline-primary btn-sm"
                      disabled=${!arquivoCvFicha || enviandoCvFicha || analisandoCvFicha}
                      onClick=${enviarCvFicha}
                    >
                      <span class="material-symbols-outlined">${IconeSvg('upload')}</span>
                      ${enviandoCvFicha ? 'Adicionando...' : 'Adicionar CV'}
                    </button>
                  `}
              <button
                type="button"
                class="btn btn-primary btn-sm"
                disabled=${analisandoCvFicha || enviandoCvFicha || (!candidato.cv_disponivel && !arquivoCvFicha)}
                onClick=${analisarCvFicha}
              >
                <span class="material-symbols-outlined">${IconeSvg('auto_awesome')}</span>
                ${analisandoCvFicha ? 'Analisando...' : 'Analisar CV'}
              </button>
            </div>
          </div>
        </div>
      </${SectionCard}>

      <${PainelAnaliseCurriculoIa}
        candidato=${candidato}
        podeAnalisar=${controlador?.possuiPermissao?.('candidatos.avaliar_curriculo')}
      />
      </${TabPanel}>

      <${TabPanel} tabKey="provas" activeKey=${abaDetalheAtiva}>
      <${SectionCard} title="Resultados da prova" className="rh-section-card--flat">
        <div class="table-responsive">
          <table class="table align-middle rh-modern-history-table">
            <thead><tr><th>Tipo</th><th>Data</th><th>Processo</th><th>Resultado</th><th>Observações</th></tr></thead>
            <tbody>
              ${eventosAvaliacao.length
      ? eventosAvaliacao.map(
        (item) => html`
                      <tr key=${`${item.tipo}-${item.data}-${item.processo}`}>
                        <td>${item.tipo}</td>
                        <td>${formatarDataHora(item.data)}</td>
                        <td>${item.processo || '-'}</td>
                        <td>${item.resultado || '-'}</td>
                        <td>${item.observacao || '-'}</td>
                      </tr>
                    `,
      )
      : html`<${TabelaVazia} colunas=${5} texto="Sem resultado de prova registrado." />`}
            </tbody>
          </table>
        </div>
      </${SectionCard}>

      <${SectionCard} title="Testes complementares" className="rh-section-card--flat">
        <div class="row g-4">
          <div class="col-md-4">
            <strong>Perfil DISC</strong>
            <div style=${{ marginTop: '8px' }}>
              <${PainelResultadoDisc} idTeste=${candidato.id_teste} />
            </div>
          </div>
          <div class="col-md-4">
            <strong>Fit Cultural</strong>
            <div style=${{ marginTop: '8px' }}>
              <${PainelResultadoFitCultural} candidatoProcessoId=${candidato.id_registro_processo} />
            </div>
          </div>
          <div class="col-md-4">
            <strong>Raciocínio Lógico</strong>
            <div style=${{ marginTop: '8px' }}>
              <${PainelResultadoRaciocinio} idTeste=${candidato.id_teste} />
            </div>
          </div>
        </div>
      </${SectionCard}>

      <${SectionCard} title="Levantamentos, pontos e observações do RH" className="rh-section-card--flat">
        <div class="row g-3">
          <div class="col-md-4">
            <strong>Levantamentos feitos pelo Conecta</strong>
            <div class="rh-cell-stack">${(candidato.habilidades || []).length ? candidato.habilidades.map((item) => html`<span key=${item}>${item}</span>`) : html`<span>Sem levantamentos registrados.</span>`}</div>
          </div>
          <div class="col-md-4">
            <strong>Pontos fortes</strong>
            <div class="rh-cell-stack">${(candidato.tags || []).length ? candidato.tags.map((item) => html`<span key=${item}>${item}</span>`) : html`<span>Sem pontos fortes registrados.</span>`}</div>
          </div>
          <div class="col-md-4">
            <strong>Alertas críticos e pontos de atenção</strong>
            <div class="rh-cell-stack">${dossie.alertas.map((item) => html`<span key=${item}>${item}</span>`)}</div>
          </div>
          <div class="col-md-6">
            <label class="form-label">Análises feitas pelo Conecta</label>
            <textarea class="form-control" rows="3" value=${formPerfil.habilidades} onInput=${(event) => atualizarCampo('habilidades', event.target.value)}></textarea>
          </div>
          <div class="col-md-6">
            <label class="form-label">Observações</label>
            <textarea class="form-control" rows="3" value=${formPerfil.observacao_rh} onInput=${(event) => atualizarCampo('observacao_rh', event.target.value)}></textarea>
          </div>
          <div class="col-12">
            <label class="form-label">Justificativa / observações do RH</label>
            <textarea class="form-control" rows="3" value=${formPerfil.justificativa_indicacao} onInput=${(event) => atualizarCampo('justificativa_indicacao', event.target.value)}></textarea>
          </div>
        </div>
      </${SectionCard}>
      </${TabPanel}>

      <footer class="rh-form-footer rh-form-footer--sticky">
        <span class="rh-form-footer-hint">
          ${salvando ? 'Salvando alterações...' : 'Revise os dados antes de salvar.'}
        </span>
        <div class="rh-form-footer-secondary-actions">
          <button
            type="button"
            class="btn btn-outline-secondary btn-sm"
            onClick=${() =>
      window.history.length > 1
        ? window.history.back()
        : controlador.irParaTelaProtegida('screen-candidates')}
          >
            <span class="material-symbols-outlined">${IconeSvg('arrow_back')}</span>
            Voltar
          </button>
          <button
            type="button"
            class="btn btn-outline-secondary btn-sm"
            onClick=${() => controlador.irParaTelaProtegida('screen-candidates')}
          >
            <span class="material-symbols-outlined">${IconeSvg('groups')}</span>
            Lista geral de candidatos
          </button>
          <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => abrirFichaImpressao(candidato, dossie, showToast)}>
            Baixar ficha
          </button>
          ${candidatoPodeAtrelar(candidato) && controlador?.possuiPermissao?.('candidatos.criar')
      ? html`
                <button
                  type="button"
                  class="btn btn-outline-secondary btn-sm"
                  disabled=${salvandoVinculo}
                  onClick=${abrirModalVinculo}
                >
                  Adicionar a processo seletivo
                </button>
              `
      : null}
        </div>
      </footer>

      <${ModalPadrao}
        aberto=${modalVinculoAberto}
        titulo=${`Adicionar a processo seletivo | ${candidato?.nome_candidato || 'Candidato'}`}
        subtitulo="Selecione um processo seletivo aberto para vincular este candidato."
        onClose=${() => {
      setModalVinculoAberto(false);
      setProcessoSelecionado('');
    }}
      >
        <div class="rh-details-body">
          <${MetricGrid}
            items=${[
      { label: 'Candidato', value: candidato?.nome_candidato || '-' },
      { label: 'Vaga atual', value: candidato?.vaga || '-' },
      { label: 'Origem', value: candidato?.origem_rotulo || 'Ficha do candidato' },
    ]}
          />
          <div class="rh-filter-field">
            <label>Processo seletivo</label>
            ${processosAbertos.length
      ? html`
                  <${SelectProcesso}
                    processos=${processosAbertos}
                    valor=${processoSelecionado}
                    disabled=${salvandoVinculo}
                    onChange=${setProcessoSelecionado}
                  />
                `
      : html`<div class="alert alert-warning mb-0">Nenhum processo seletivo aberto encontrado.</div>`}
          </div>
        </div>
        <footer class="rh-modal-footer">
          <div class="rh-modal-footer-actions">
            <button
              type="button"
              class="btn btn-outline-secondary"
              disabled=${salvandoVinculo}
              onClick=${() => {
      setModalVinculoAberto(false);
      setProcessoSelecionado('');
    }}
            >
              Cancelar
            </button>
            <button
              type="button"
              class="btn btn-primary"
              disabled=${salvandoVinculo || !processoSelecionado}
              onClick=${confirmarVinculoProcesso}
            >
              ${salvandoVinculo ? 'Salvando...' : 'Confirmar vínculo'}
            </button>
          </div>
        </footer>
      </${ModalPadrao}>
    </${PainelRh}>
  `;
}

export function TelaCandidatos({ controlador }) {
  const { showToast, ToastHost } = useToast();
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [candidatos, setCandidatos] = useState([]);
  const [processosAbertos, setProcessosAbertos] = useState([]);
  const [fontesDossie, setFontesDossie] = useState({
    historico: [],
    candidatosProcessos: [],
    bancoTalentos: [],
    entrevistas: [],
  });
  const [filtros, setFiltros] = useState({
    busca: '',
    status: '',
    origem: '',
  });
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [paginaCandidatos, setPaginaCandidatos] = useState(1);
  const [detalhe, setDetalhe] = useState(null);
  const [resultadosTestesDetalhe, setResultadosTestesDetalhe] = useState({ disc: null, fitCultural: null, raciocinio: null });
  const [candidatoEditando, setCandidatoEditando] = useState(null);
  const [formPerfil, setFormPerfil] = useState(montarFormularioPerfil(null));
  const [camposPerfilAlterados, setCamposPerfilAlterados] = useState({});
  const [arquivoCvDetalhe, setArquivoCvDetalhe] = useState(null);
  const [enviandoCvDetalhe, setEnviandoCvDetalhe] = useState(false);
  const [analisandoCvDetalhe, setAnalisandoCvDetalhe] = useState(false);
  const [candidatoParaAtrelar, setCandidatoParaAtrelar] = useState(null);
  const [origemAtrelamento, setOrigemAtrelamento] = useState('Central de Candidatos');
  const [indicadoPorAtrelamento, setIndicadoPorAtrelamento] = useState('');
  const [processoSelecionado, setProcessoSelecionado] = useState('');
  const [aprovacaoSelecionada, setAprovacaoSelecionada] = useState(null);
  const [modalGerarDocumentoAberto, setModalGerarDocumentoAberto] = useState(false);
  const [salvandoAprovacao, setSalvandoAprovacao] = useState(false);
  const [mensagemSucesso, setMensagemSucesso] = useState('');

  const abrirCurriculo = async (candidato) => {
    if (!candidato?.id_teste || !candidato?.cv_disponivel) {
      showToast('Não há currículo disponível para este candidato.', 'warning');
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

  const enviarCvDetalhe = async () => {
    if (!detalhe?.id_teste) {
      setErro('Este candidato ainda não possui ID para anexar currículo.');
      return;
    }
    if (!arquivoCvDetalhe) {
      setErro('Selecione um CV para adicionar.');
      return;
    }

    const extensao = `.${String(arquivoCvDetalhe.name || '').split('.').pop() || ''}`.toLowerCase();
    if (!['.pdf', '.doc', '.docx'].includes(extensao)) {
      setErro('Formato de currículo não suportado. Envie PDF, DOC ou DOCX.');
      return;
    }

    setEnviandoCvDetalhe(true);
    setErro('');
    setMensagemSucesso('');
    try {
      const formData = new FormData();
      formData.append('arquivo', arquivoCvDetalhe);
      await uploadCvCandidato(detalhe.id_teste, formData);
      setArquivoCvDetalhe(null);
      setMensagemSucesso('CV adicionado à ficha do candidato.');
      const ficha = await lerFichaCandidato(detalhe.id_teste).catch(() => null);
      if (ficha) {
        const atualizado = aplicarDadosFichaAoCandidato(detalhe, ficha);
        setDetalhe(atualizado);
        setFormPerfil(montarFormularioPerfil(atualizado));
      }
      await carregar();
    } catch (error) {
      setErro(error?.message || 'Não foi possível adicionar o CV.');
    } finally {
      setEnviandoCvDetalhe(false);
    }
  };

  const analisarCvDetalhe = async () => {
    if (!detalhe?.id_teste) {
      setErro('Este candidato ainda não possui ID para análise de CV.');
      return;
    }
    if (!detalhe?.cv_disponivel && !arquivoCvDetalhe) {
      setErro('Adicione um CV antes de analisar.');
      return;
    }

    setAnalisandoCvDetalhe(true);
    setErro('');
    setMensagemSucesso('');
    try {
      if (arquivoCvDetalhe) {
        const formData = new FormData();
        formData.append('arquivo', arquivoCvDetalhe);
        await uploadCvCandidato(detalhe.id_teste, formData);
        setArquivoCvDetalhe(null);
      }
      const resultado = await analisarCvCandidatoInscrito(detalhe.id_teste, {
        id_processo: detalhe.id_processo_ref || detalhe.id_processo || '',
      });
      setMensagemSucesso(
        `CV analisado. Classificação: ${resultado?.classificacao || '-'} | Score: ${resultado?.score ?? '-'}.`,
      );
      const ficha = await lerFichaCandidato(detalhe.id_teste).catch(() => null);
      if (ficha) {
        const atualizado = aplicarDadosFichaAoCandidato(detalhe, ficha);
        setDetalhe(atualizado);
        setFormPerfil(montarFormularioPerfil(atualizado));
      }
      await carregar();
    } catch (error) {
      setErro(error?.message || 'Não foi possível analisar o CV.');
    } finally {
      setAnalisandoCvDetalhe(false);
    }
  };

  const abrirTelaDetalhesCandidato = async (candidato) => {
    let candidatoDetalhe = candidato || {};
    if (candidatoDetalhe.id_teste) {
      const ficha = await lerFichaCandidato(candidatoDetalhe.id_teste).catch(() => null);
      if (ficha) {
        candidatoDetalhe = aplicarDadosFichaAoCandidato(candidatoDetalhe, ficha);
      }
    }
    sessionStorage.setItem(
      CHAVE_DETALHE_CANDIDATO_RH,
      JSON.stringify(candidatoDetalhe || {}),
    );
    setDetalhe(candidatoDetalhe || null);
    setFormPerfil(montarFormularioPerfil(candidatoDetalhe));
    setCamposPerfilAlterados({});
    setArquivoCvDetalhe(null);
  };

  const carregar = async ({ forcar = false } = {}) => {
    setCarregando(true);
    setErro('');

    try {
      const resultados = await Promise.allSettled([
        lerHistorico(),
        lerCandidatosProcessos({ forcar }),
        lerBancoTalentos({ forcar }),
        lerProcessos({ forcar }),
        lerEntrevistas(),
      ]);

      const historico =
        resultados[0].status === 'fulfilled' && Array.isArray(resultados[0].value)
          ? resultados[0].value
          : [];
      const candidatosProcessos =
        resultados[1].status === 'fulfilled' && Array.isArray(resultados[1].value)
          ? resultados[1].value
          : [];
      const bancoTalentos =
        resultados[2].status === 'fulfilled' && Array.isArray(resultados[2].value)
          ? resultados[2].value
          : [];
      const processos =
        resultados[3].status === 'fulfilled' && Array.isArray(resultados[3].value)
          ? resultados[3].value
          : [];
      const entrevistas =
        resultados[4].status === 'fulfilled' && Array.isArray(resultados[4].value)
          ? resultados[4].value
          : [];

      const falhas = resultados
        .filter((item) => item.status === 'rejected')
        .map((item) => item.reason);

      if (
        falhas.length &&
        !historico.length &&
        !candidatosProcessos.length &&
        !bancoTalentos.length &&
        !processos.length &&
        !entrevistas.length
      ) {
        setErro(
          falhas[0]?.message ||
          'Não foi possível carregar a página de candidatos.',
        );
      }

      const processosPorReferencia = new Map();
      processos.forEach((processo) => {
        const referencia = obterReferenciaProcesso(processo);
        if (referencia) processosPorReferencia.set(referencia, processo);
        if (processo.id_processo) {
          processosPorReferencia.set(String(processo.id_processo), processo);
        }
      });

      const abertos = processos.filter((processo) => !isProcessClosed(processo));

      const mapa = new Map();

      historico.forEach((item) => {
        const candidato = montarCandidatoDoHistorico(item);
        mapa.set(candidato.chave, candidato);
      });

      bancoTalentos.forEach((item) => {
        const candidato = montarCandidatoDoBanco(item);
        mapa.set(candidato.chave, candidato);
      });

      candidatosProcessos.forEach((item) => {
        const candidato = montarCandidatoDeProcesso(
          item,
          processosPorReferencia,
        );
        mapa.set(candidato.chave, candidato);
      });

      const lista = Array.from(mapa.values()).sort((a, b) =>
        String(b.data_exibicao || '').localeCompare(
          String(a.data_exibicao || ''),
        ),
      );

      setCandidatos(lista);
      setProcessosAbertos(abertos);
      setFontesDossie({
        historico,
        candidatosProcessos,
        bancoTalentos,
        entrevistas,
      });
    } catch (error) {
      setErro(
        error?.message || 'Não foi possível carregar a página de candidatos.',
      );
      setCandidatos([]);
      setProcessosAbertos([]);
      setFontesDossie({
        historico: [],
        candidatosProcessos: [],
        bancoTalentos: [],
        entrevistas: [],
      });
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const candidatosFiltrados = useMemo(() => {
    const busca = normalizarTexto(filtros.busca);
    const statusFiltro = normalizarTexto(filtros.status);
    const origemFiltro = normalizarTexto(filtros.origem);

    return candidatos.filter((candidato) => {
      const textoBusca = normalizarTexto(
        [
          candidato.nome_candidato,
          candidato.email,
          candidato.telefone,
          candidato.whatsapp,
          candidato.vaga,
          candidato.processo_nome,
          candidato.id_processo,
          candidato.id_teste,
          candidato.status_visivel,
          candidato.origem_rotulo,
          candidato.classificacao_exibicao,
          candidato.classificacao_indicacao,
          candidato.justificativa_indicacao,
          candidato.cidade,
          candidato.bairro,
        ].join(' '),
      );

      const status = normalizarTexto(candidato.status_visivel);
      const origem = normalizarTexto(candidato.origem_cadastro);

      const bateBusca = !busca || textoBusca.includes(busca);
      const bateStatus = !statusFiltro || status.includes(statusFiltro);
      const bateOrigem = !origemFiltro || origem === origemFiltro;

      return bateBusca && bateStatus && bateOrigem;
    });
  }, [candidatos, filtros]);
  const candidatosPaginados = useMemo(
    () =>
      obterItensPaginados(
        candidatosFiltrados,
        paginaCandidatos,
        TAMANHO_PAGINA_CANDIDATOS_CENTRAL,
      ),
    [candidatosFiltrados, paginaCandidatos],
  );

  const resumo = useMemo(
    () => resumirStatus(candidatosFiltrados),
    [candidatosFiltrados],
  );
  const dossieDetalhe = useMemo(
    () => (detalhe ? montarDossieCandidato(detalhe, fontesDossie) : null),
    [detalhe, fontesDossie],
  );

  useEffect(() => {
    setPaginaCandidatos(1);
  }, [filtros, candidatos.length]);

  const aplicarStatus = async (candidato, status, dadosAprovacao = {}) => {
    if (!candidato) return;

    if (candidatoEstaAprovado(candidato)) {
      showToast(MENSAGEM_CANDIDATO_APROVADO_BLOQUEADO, 'warning');
      return;
    }

    const estadoAcoes = obterEstadoAcoesCentral(candidato);
    const statusSeguro = canonicalizeCandidateStatus(status);

    if (estadoAcoes.processClosed) {
      showToast(MENSAGEM_PROCESSO_ENCERRADO_BLOQUEADO, 'warning');
      return;
    }

    if (
      (statusSeguro === CANDIDATE_STATUS_APPROVED && !estadoAcoes.canApprove) ||
      (statusSeguro === CANDIDATE_STATUS_ELIMINATED && !estadoAcoes.canEliminate) ||
      (statusSeguro === CANDIDATE_STATUS_TALENT_BANK &&
        !estadoAcoes.canSendToTalentBank)
    ) {
      showToast('Este candidato não possui ações pendentes para esta movimentação.', 'warning');
      return;
    }

    if (candidato.origem_cadastro === 'banco') {
      if (status === CANDIDATE_STATUS_ELIMINATED) {
        const confirmar = window.confirm(
          `Deseja remover ${candidato.nome_candidato} do Banco de Talentos?`,
        );
        if (!confirmar) return;

        setSalvando(true);
        setErro('');
        setMensagemSucesso('');

        try {
          await removerBancoTalentos(candidato.id_banco);
          setDetalhe(null);
          await carregar();
        } catch (error) {
          setErro(
            error?.message ||
            'Não foi possível remover o candidato do Banco de Talentos.',
          );
        } finally {
          setSalvando(false);
        }

        return;
      }

      showToast(
        'Este candidato está no Banco de Talentos. Para aprovar, primeiro atrele-o a um processo seletivo.',
        'warning',
      );
      return;
    }

    if (!candidato.id_registro_processo) {
      if (
        status !== CANDIDATE_STATUS_ELIMINATED &&
        status !== CANDIDATE_STATUS_APPROVED
      ) {
        showToast(
          'Este candidato ainda não possui vínculo operacional com um processo. Atrele-o a um processo antes de aprovar.',
          'warning',
        );
        return;
      }

      if (!candidato.id_teste) {
        showToast('Este candidato não possui ID de prova para eliminação.', 'warning');
        return;
      }

      const confirmarEliminacao = window.confirm(
        `Deseja alterar o status de ${candidato.nome_candidato} para "${status}"?`,
      );
      if (!confirmarEliminacao) return;

      setSalvando(true);
      setErro('');
      setMensagemSucesso('');

      try {
        await atualizarStatusCandidatoAvulso(candidato.id_teste, {
          status_candidato: status,
          data_movimentacao: new Date().toISOString(),
          ...(status === CANDIDATE_STATUS_APPROVED ? dadosAprovacao : {}),
        });

        setDetalhe(null);
        setMensagemSucesso('Status do candidato atualizado com sucesso.');
        await carregar();
      } catch (error) {
        setErro(
          error?.message || 'Não foi possível atualizar o status do candidato.',
        );
      } finally {
        setSalvando(false);
      }
      return;
    }

    const aprovacaoConfirmadaNoModal =
      status === CANDIDATE_STATUS_APPROVED &&
      String(dadosAprovacao?.mensagem_aprovacao || '').trim();
    if (!aprovacaoConfirmadaNoModal) {
      const confirmar = window.confirm(
        `Deseja alterar o status de ${candidato.nome_candidato} para "${status}"?`,
      );
      if (!confirmar) return;
    }

    setSalvando(true);
    setErro('');
    setMensagemSucesso('');

    try {
      await atualizarStatusCandidato(candidato.id_registro_processo, {
        status_candidato: status,
        data_movimentacao: new Date().toISOString(),
        ...(status === CANDIDATE_STATUS_APPROVED ? dadosAprovacao : {}),
      });

      setDetalhe(null);
      setMensagemSucesso(
        status === CANDIDATE_STATUS_TALENT_BANK
          ? 'Candidato enviado para o Banco de Talentos com sucesso.'
          : 'Status do candidato atualizado com sucesso.',
      );
      await carregar();
    } catch (error) {
      setErro(
        status === CANDIDATE_STATUS_TALENT_BANK
          ? 'Não foi possível enviar o candidato para o Banco de Talentos. Verifique os dados do candidato e tente novamente.'
          : error?.message || 'Não foi possível atualizar o status do candidato.',
      );
    } finally {
      setSalvando(false);
    }
  };

  const abrirEdicaoCandidato = (candidato) => {
    if (!candidato?.id_teste) {
      showToast('Este candidato não possui ID de prova para edição.', 'warning');
      return;
    }

    setCandidatoEditando(candidato);
    setFormPerfil(montarFormularioPerfil(candidato));
    setCamposPerfilAlterados({});
  };

  const atualizarCampoPerfil = (campo, valor) => {
    setFormPerfil((anterior) => ({
      ...anterior,
      [campo]: valor,
    }));
    setCamposPerfilAlterados((anterior) => ({
      ...anterior,
      [campo]: true,
    }));
  };

  const salvarPerfilCandidato = async () => {
    const candidatoAlvo = candidatoEditando || detalhe;
    if (!candidatoAlvo?.id_teste) return;

    setSalvando(true);
    setErro('');
    setMensagemSucesso('');

    try {
      const payload = {
        nome_candidato:
          formPerfil.nome_candidato || candidatoAlvo.nome_candidato || '',
        email: formPerfil.email,
        telefone: formPerfil.telefone,
        whatsapp: formPerfil.whatsapp,
        endereco: formPerfil.endereco,
        cidade: formPerfil.cidade,
        bairro: formPerfil.bairro,
        data_nascimento: formPerfil.data_nascimento,
        escolaridade: formPerfil.escolaridade,
        possui_experiencia: formPerfil.possui_experiencia,
        musica: formPerfil.musica,
        prato: formPerfil.prato,
        futebol: formPerfil.futebol,
        time: formPerfil.time,
        rede_social: formPerfil.rede_social,
        classificacao_indicacao: formPerfil.classificacao_indicacao,
        justificativa_indicacao: formPerfil.justificativa_indicacao,
        habilidades: textoParaLista(formPerfil.habilidades),
        tags: textoParaLista(formPerfil.tags),
      };
      if (camposPerfilAlterados.observacao_rh) {
        payload.observacao_rh = formPerfil.observacao_rh;
      }

      const resultado = await atualizarPerfilCandidato(
        candidatoAlvo.id_teste,
        payload,
      );
      const perfilAtualizado = resultado?.candidato || {};
      const atualizado = {
        ...candidatoAlvo,
        ...payload,
        ...perfilAtualizado,
        habilidades: perfilAtualizado.habilidades || payload.habilidades,
        tags: perfilAtualizado.tags || payload.tags,
        contato_principal:
          perfilAtualizado.email ||
          payload.email ||
          perfilAtualizado.telefone ||
          payload.telefone ||
          perfilAtualizado.whatsapp ||
          payload.whatsapp ||
          '',
      };

      if (candidatoEditando) {
        setCandidatoEditando(null);
      }
      setFormPerfil(montarFormularioPerfil(atualizado));
      setCamposPerfilAlterados({});
      setMensagemSucesso('Dados do candidato atualizados com sucesso.');
      setDetalhe((atual) =>
        atual && String(atual.id_teste || '') === String(candidatoAlvo.id_teste || '')
          ? { ...atual, ...atualizado }
          : atual,
      );
      await carregar();
    } catch (error) {
      setErro(
        error?.message || 'Não foi possível atualizar os dados do candidato.',
      );
    } finally {
      setSalvando(false);
    }
  };

  const enviarParaBanco = async (candidato) => {
    if (!candidato?.id_teste) {
      showToast('Este candidato não possui ID de prova para Banco de Talentos.', 'warning');
      return;
    }

    if (candidato.origem_cadastro === 'banco') {
      showToast('Este candidato já está no Banco de Talentos.', 'warning');
      return;
    }

    if (candidatoEstaAprovado(candidato)) {
      showToast(MENSAGEM_CANDIDATO_APROVADO_BLOQUEADO, 'warning');
      return;
    }

    const estadoAcoes = obterEstadoAcoesCentral(candidato);
    if (estadoAcoes.processClosed) {
      showToast(MENSAGEM_PROCESSO_ENCERRADO_BLOQUEADO, 'warning');
      return;
    }
    if (!estadoAcoes.canSendToTalentBank) {
      showToast('Este candidato não possui ações pendentes para envio ao Banco de Talentos.', 'warning');
      return;
    }

    if (candidato.origem_cadastro === 'processo') {
      await aplicarStatus(candidato, CANDIDATE_STATUS_TALENT_BANK);
      return;
    }

    const confirmar = window.confirm(
      `Deseja enviar ${candidato.nome_candidato} para o Banco de Talentos?`,
    );
    if (!confirmar) return;

    setSalvando(true);
    setErro('');
    setMensagemSucesso('');

    try {
      const origemBanco = obterOrigemBancoTalentos(candidato);
      const resultadoBanco = await criarBancoTalentos({
        id_teste: candidato.id_teste || '',
        id_processo: candidato.id_processo || '',
        id_processo_ref: candidato.id_processo_ref || '',
        nome_candidato: candidato.nome_candidato || '',
        vaga: obterVagaBancoTalentos(candidato),
        pontuacao_final:
          candidato.pontuacao_final ||
          candidato.nota_final ||
          candidato.nota_exibicao ||
          '',
        data_movimentacao: new Date().toISOString(),
        origem: origemBanco,
        email: candidato.email || '',
        telefone: candidato.telefone || '',
        whatsapp: candidato.whatsapp || '',
        cidade: candidato.cidade || '',
        bairro: candidato.bairro || '',
        codigo_acesso: candidato.codigo_acesso || candidato.codigo_cp || '',
      });

      setDetalhe(null);
      setMensagemSucesso(
        resultadoBanco?.already_exists
          ? 'Este candidato já está no Banco de Talentos.'
          : 'Candidato enviado para o Banco de Talentos com sucesso.',
      );
      await carregar();
    } catch (error) {
      setErro('Não foi possível enviar o candidato para o Banco de Talentos. Verifique os dados do candidato e tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const abrirAprovacao = (candidato) => {
    if (candidatoEstaAprovado(candidato)) {
      showToast(MENSAGEM_CANDIDATO_APROVADO_BLOQUEADO, 'warning');
      return;
    }

    const estadoAcoes = obterEstadoAcoesCentral(candidato);
    if (estadoAcoes.processClosed) {
      showToast(MENSAGEM_PROCESSO_ENCERRADO_BLOQUEADO, 'warning');
      return;
    }

    if (!estadoAcoes.canApprove) {
      showToast('A aprovação não está disponível para o status atual deste candidato.', 'warning');
      return;
    }

    setAprovacaoSelecionada(candidato);
  };

  const confirmarAprovacao = async (dadosAprovacao) => {
    if (!aprovacaoSelecionada) return;

    setSalvandoAprovacao(true);
    try {
      await aplicarStatus(
        aprovacaoSelecionada,
        CANDIDATE_STATUS_APPROVED,
        dadosAprovacao,
      );
      setAprovacaoSelecionada(null);
    } finally {
      setSalvandoAprovacao(false);
    }
  };

  const abrirAtrelar = (candidato, origem = 'Central de Candidatos') => {
    if (candidatoEstaAprovado(candidato)) {
      showToast(MENSAGEM_CANDIDATO_APROVADO_BLOQUEADO, 'warning');
      return;
    }

    if (!processosAbertos.length) {
      showToast('Nenhum processo seletivo aberto encontrado.', 'warning');
      return;
    }

    const estadoAcoes = obterEstadoAcoesCentral(candidato);
    if (estadoAcoes.processClosed) {
      showToast(MENSAGEM_PROCESSO_ENCERRADO_BLOQUEADO, 'warning');
      return;
    }
    if (!candidatoPodeAtrelar(candidato)) {
      showToast('Este candidato não possui ações pendentes para vínculo.', 'warning');
      return;
    }

    setCandidatoParaAtrelar(candidato);
    setOrigemAtrelamento(origem);
    setProcessoSelecionado('');
  };

  const candidatoJaVinculadoAoProcessoSelecionado = () => {
    if (!candidatoParaAtrelar || !processoSelecionado) {
      return false;
    }

    if (
      String(candidatoParaAtrelar.id_processo_ref || '').trim() ===
      String(processoSelecionado || '').trim() &&
      candidatoParaAtrelar.origem_cadastro === 'processo'
    ) {
      return true;
    }

    const idTeste = String(candidatoParaAtrelar.id_teste || '').trim();
    const email = normalizarTexto(candidatoParaAtrelar.email || '');
    const telefones = [
      candidatoParaAtrelar.telefone,
      candidatoParaAtrelar.whatsapp,
    ]
      .map((valor) => String(valor || '').replace(/\D/g, ''))
      .filter(Boolean);

    return candidatos.some(
      (item) => {
        if (
          item.origem_cadastro !== 'processo' ||
          String(item.id_processo_ref || '').trim() !==
          String(processoSelecionado || '').trim()
        ) {
          return false;
        }

        const mesmoId =
          idTeste && String(item.id_teste || '').trim() === idTeste;
        const mesmoEmail =
          email && normalizarTexto(item.email || '') === email;
        const telefonesItem = [item.telefone, item.whatsapp]
          .map((valor) => String(valor || '').replace(/\D/g, ''))
          .filter(Boolean);
        const mesmoTelefone =
          telefones.length &&
          telefonesItem.some((telefone) => telefones.includes(telefone));

        return Boolean(mesmoId || mesmoEmail || mesmoTelefone);
      },
    );
  };

  const confirmarAtrelar = async () => {
    if (!candidatoParaAtrelar || !processoSelecionado) {
      showToast('Selecione um processo seletivo aberto.', 'warning');
      return;
    }

    const processo = processosAbertos.find(
      (item) => obterReferenciaProcesso(item) === processoSelecionado,
    );
    if (!processo) {
      showToast('Processo selecionado não encontrado.', 'warning');
      return;
    }

    if (candidatoJaVinculadoAoProcessoSelecionado()) {
      showToast('Este candidato já está vinculado a este processo seletivo.', 'warning');
      return;
    }

    if (origemAtrelamento === 'Indicação' && !indicadoPorAtrelamento.trim()) {
      window.alert('Informe o nome de quem indicou o candidato.');
      return;
    }

    const confirmar = window.confirm(
      `Deseja adicionar ${candidatoParaAtrelar.nome_candidato} ao processo ${processo.id_processo || 'selecionado'}?`,
    );
    if (!confirmar) return;

    setSalvando(true);
    setErro('');

    try {
      if (candidatoParaAtrelar.origem_cadastro === 'banco') {
        await usarCandidatoDoBancoTalentos(candidatoParaAtrelar.id_banco, {
          id_processo: processo.id_processo || '',
          id_processo_ref: processoSelecionado,
          origem: origemAtrelamento,
        });
      } else {
        await criarCandidatoNoProcesso({
          id_registro:
            candidatoParaAtrelar.origem_cadastro === 'processo'
              ? candidatoParaAtrelar.id_registro_processo
              : undefined,
          id_processo: processo.id_processo || '',
          id_processo_ref: processoSelecionado,
          id_teste: candidatoParaAtrelar.id_teste || '',
          nome_candidato: candidatoParaAtrelar.nome_candidato || '',
          vaga: candidatoParaAtrelar.vaga || processo.vaga || '',
          status_candidato: CANDIDATE_STATUS_ANALYSIS,
          pontuacao_final:
            candidatoParaAtrelar.pontuacao_final ||
            candidatoParaAtrelar.nota_final ||
            '',
          data_prova:
            candidatoParaAtrelar.data_prova ||
            candidatoParaAtrelar.data_iso ||
            new Date().toISOString(),
          origem:
            origemAtrelamento === 'Indicação'
              ? 'Indicação'
              : origemAtrelamento === 'Ficha do candidato'
                ? 'Ficha do candidato'
                : candidatoParaAtrelar.origem_cadastro === 'historico'
                  ? 'Histórico'
                  : 'Candidatos',
          indicado_por:
            origemAtrelamento === 'Indicação' ? indicadoPorAtrelamento.trim() : '',
        });
      }

      setCandidatoParaAtrelar(null);
      setOrigemAtrelamento('Central de Candidatos');
      setIndicadoPorAtrelamento('');
      setProcessoSelecionado('');
      setDetalhe(null);
      await carregar();
    } catch (error) {
      setErro(
        error?.message || 'Não foi possível adicionar o candidato ao processo seletivo.',
      );
    } finally {
      setSalvando(false);
    }
  };

  return html`
    <${PainelRh}
      screenId="screen-candidates"
      navAtiva="screen-candidates"
      subtituloMarca="Candidatos"
      placeholderBusca="Gestão centralizada de candidatos"
      controlador=${controlador}
    >
      <${ToastHost} />
      <${PageIntro}
        kicker="Console | Candidatos"
        title="Central de candidatos"
        actions=${html`
          <button
            type="button"
            class="btn btn-outline-primary"
            disabled=${carregando || salvando}
            onClick=${() => carregar({ forcar: true })}
          >
            <span class="material-symbols-outlined">${IconeSvg('refresh')}</span>
            Atualizar
          </button>
        `}
      />

      ${erro ? html`<div class="rh-inline-alert">${erro}</div>` : null}
      ${mensagemSucesso
      ? html`<div class="alert alert-success">${mensagemSucesso}</div>`
      : null}

      <${SectionCard} title="Resumo geral">
        <${MetricGrid}
          items=${[
      { label: 'Total filtrado', value: resumo.total, variant: 'rh-metric-card--is-neutral' },
      { label: 'Aprovados', value: resumo.aprovados, variant: 'rh-metric-card--is-positive' },
      { label: 'Eliminados', value: resumo.eliminados, variant: 'rh-metric-card--is-neutral' },
      { label: 'Em análise', value: resumo.analise, variant: 'rh-metric-card--is-attention' },
      { label: 'Em processo', value: resumo.processo, variant: 'rh-metric-card--is-neutral' },
      { label: 'Banco de Talentos', value: resumo.banco, variant: 'rh-metric-card--is-neutral' },
    ]}
        />
      </${SectionCard}>

      <${SectionCard} className="process-filter-panel">
        <div class="rh-filter-bar">
          <div class="rh-filter-bar-search">
            <span class="material-symbols-outlined">${IconeSvg('search')}</span>
            <input
              type="search"
              placeholder="Nome, e-mail, vaga, processo, status..."
              value=${filtros.busca}
              onInput=${(event) => setFiltros({ ...filtros, busca: event.target.value })}
            />
          </div>

          <button
            type="button"
            class="rh-filter-toggle"
            aria-expanded=${filtrosAbertos}
            onClick=${() => setFiltrosAbertos(!filtrosAbertos)}
          >
            <span class="material-symbols-outlined">${IconeSvg('tune')}</span>
            Filtros
            ${(filtros.status ? 1 : 0) + (filtros.origem ? 1 : 0) > 0
      ? html`<span class="rh-filter-count">${(filtros.status ? 1 : 0) + (filtros.origem ? 1 : 0)}</span>`
      : null}
          </button>

          ${filtros.status
      ? html`
              <span class="rh-filter-chip">
                Status: ${{
        aprovado: 'Aprovados', eliminado: 'Eliminados', analise: 'Em análise',
        processo: 'Em processo', banco: 'Banco de Talentos',
      }[filtros.status] || filtros.status}
                <button type="button" aria-label="Remover filtro de status" onClick=${() => setFiltros({ ...filtros, status: '' })}>×</button>
              </span>
            `
      : null}
          ${filtros.origem
      ? html`
              <span class="rh-filter-chip">
                Origem: ${{
        processo: 'Processo seletivo', banco: 'Banco de Talentos', historico: 'Histórico de prova',
      }[filtros.origem] || filtros.origem}
                <button type="button" aria-label="Remover filtro de origem" onClick=${() => setFiltros({ ...filtros, origem: '' })}>×</button>
              </span>
            `
      : null}
        </div>

        ${filtrosAbertos
      ? html`
            <div class="rh-filter-panel-expanded">
              <div class="rh-filter-grid">
                <div class="rh-filter-field">
                  <label>Status</label>
                  <select
                    class="form-select"
                    value=${filtros.status}
                    onChange=${(event) => setFiltros({ ...filtros, status: event.target.value })}
                  >
                    <option value="">Todos</option>
                    <option value="aprovado">Aprovados</option>
                    <option value="eliminado">Eliminados</option>
                    <option value="analise">Em análise</option>
                    <option value="processo">Em processo</option>
                    <option value="banco">Banco de Talentos</option>
                  </select>
                </div>

                <div class="rh-filter-field">
                  <label>Origem</label>
                  <select
                    class="form-select"
                    value=${filtros.origem}
                    onChange=${(event) => setFiltros({ ...filtros, origem: event.target.value })}
                  >
                    <option value="">Todas</option>
                    <option value="processo">Processo seletivo</option>
                    <option value="banco">Banco de Talentos</option>
                    <option value="historico">Histórico de prova</option>
                  </select>
                </div>
              </div>
            </div>
          `
      : null}
      </${SectionCard}>

      <${SectionCard} title="Lista geral de candidatos">
        ${html`
              <div class="table-responsive">
                <table class="table align-middle rh-modern-history-table candidate-list-table">
                  <thead>
                    <tr>
                      <th>Candidato</th>
                      <th>Localização</th>
                      <th>Vaga / Processo</th>
                      <th class="text-end">Nota</th>
                      <th>Status</th>
                      <th>Origem</th>
                      <th class="text-end">Data</th>
                      <th class="text-end">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${carregando
                      ? html`<${SkeletonTableRows} colunas=${8} linhas=${6} />`
                      : candidatosFiltrados.length
                      ? candidatosPaginados.itens.map(
                          (candidato) => {
                            const tagsOperacionais = montarTagsOperacionaisCandidato(candidato);
                            const localizacao = [candidato.cidade, candidato.bairro].filter(Boolean).join(' · ');
                            return html`
                            <tr key=${candidato.chave} class="c24-fade-in">
                              <td>
                                <strong>${candidato.nome_candidato || '-'}</strong>
                                <div class="text-muted small">${candidato.id_teste || '-'}</div>
                                <div class="text-muted small">
                                  ${mascararEmailContato(candidato.email)} · ${mascararTelefoneContato(candidato.telefone || candidato.whatsapp)}
                                </div>
                                ${tagsOperacionais.length
                  ? html`
                                      <div class="rh-chip-wrap candidate-tag-row">
                                        ${tagsOperacionais.map(
                    (tag) => html`
                                            <span
                                              key=${`${candidato.chave}-${tag.chave}`}
                                              class=${`rh-chip ${tag.className}`}
                                            >
                                              ${tag.label}
                                            </span>
                                          `,
                  )}
                                      </div>
                                    `
                  : null}
                              </td>
                              <td>${localizacao || '-'}</td>
                              <td>
                                <div>${candidato.vaga || '-'}</div>
                                <div class="text-muted small">
                                  ${candidato.processo_nome || candidato.id_processo_ref || candidato.id_processo || '-'}
                                </div>
                              </td>
                              <td class="text-end">
                                ${candidato.nota_exibicao
                  ? html`
                                      <span class=${`candidate-score-badge num ${obterClasseFaixaNota(candidato.nota_exibicao)}`}>
                                        ${candidato.nota_exibicao}
                                      </span>
                                      <div class="text-muted small">${candidato.classificacao_exibicao || ''}</div>
                                    `
                  : '-'}
                              </td>
                              <td>
                                <span
                                  class=${`rh-status-pill ${obterClasseStatusEntrevista(
                    candidato.status_visivel,
                  )}`}
                                >
                                  ${candidato.status_visivel || '-'}
                                </span>
                              </td>
                              <td>${renderizarOrigemComIndicacao(candidato)}</td>
                              <td class="text-end num">${formatarDataHora(candidato.data_exibicao)}</td>
                              <td class="text-end">
                                <div class="candidate-row-actions">
                                  ${candidato.cv_disponivel &&
                  controlador.possuiPermissao('candidatos.baixar_curriculo')
                  ? html`
                                      <button
                                        type="button"
                                        class="btn btn-sm btn-outline-secondary candidate-cv-btn"
                                        title="Ver currículo"
                                        onClick=${() => abrirCurriculo(candidato)}
                                      >
                                        <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('description')}</span>
                                      </button>
                                    `
                  : html`<span class="candidate-cv-missing" title="Sem currículo anexado">
                                      <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('description')}</span>
                                    </span>`}
                                  ${renderizarAcoesCandidatoCentral({
                    candidato,
                    salvando,
                    onDetalhes: abrirTelaDetalhesCandidato,
                    onEditar: abrirEdicaoCandidato,
                    onAprovar: abrirAprovacao,
                    onEliminar: (item) =>
                      aplicarStatus(
                        item,
                        CANDIDATE_STATUS_ELIMINATED,
                      ),
                    onBanco: enviarParaBanco,
                    onAtrelar: (item) =>
                      abrirAtrelar(item, 'Central de Candidatos'),
                    controlador,
                  })}
                                </div>
                              </td>
                            </tr>
                          `;
            },
          )
          : html`
                          <${TabelaVazia}
                            colunas=${8}
                            texto="Nenhum candidato encontrado."
                            icone="person_search"
                          />
                        `}
                  </tbody>
                </table>
              </div>
              <${PaginacaoCompacta}
                paginaAtual=${candidatosPaginados.paginaAtual}
                totalPaginas=${candidatosPaginados.totalPaginas}
                totalItens=${candidatosPaginados.totalItens}
                tamanhoPagina=${TAMANHO_PAGINA_CANDIDATOS_CENTRAL}
                itensNaPagina=${candidatosPaginados.itens.length}
                onChange=${setPaginaCandidatos}
              />
            `}
      </${SectionCard}>

      <${ModalPadrao}
        aberto=${!!detalhe}
        titulo=${`Ficha do candidato | ${detalhe?.nome_candidato || 'Candidato'}`}
        subtitulo="Dados consolidados, avaliação do RH e ações operacionais."
        className="candidate-sheet-dialog"
        onClose=${() => {
      setDetalhe(null);
      setArquivoCvDetalhe(null);
    }}
      >
        ${detalhe
      ? html`
              <div class="rh-details-body">
                <${MetricGrid}
                  items=${[
                    {
                      label: 'Candidato',
                      value: detalhe.nome_candidato || '-',
                    },
                    {
                      label: 'Vaga',
                      value: detalhe.vaga || '-',
                    },
                    {
                      label: 'Processo',
                      value: detalhe.processo_nome || '-',
                    },
                    {
                      label: 'Status',
                      value: detalhe.status_visivel || '-',
                    },
                    {
                      label: 'Email',
                      value: detalhe.email || '-',
                    },
                    {
                      label: 'Telefone',
                      value: detalhe.telefone || detalhe.whatsapp || '-',
                    },
                    {
                      label: 'Origem',
                      value: renderizarOrigemComIndicacao(detalhe),
                    },
                    {
                      label: 'Cidade',
                      value: detalhe.cidade || '-',
                    },
                    {
                      label: 'Bairro',
                      value: detalhe.bairro || '-',
                    },
                    {
                      label: 'Nota',
                      value: detalhe.nota_exibicao || '-',
                    },
                    {
                      label: 'Classificação',
                      value: detalhe.classificacao_exibicao || '-',
                    },
                    {
                      label: 'ID da prova',
                      value: detalhe.id_teste || '-',
                    },
                    {
                      label: 'ID processo ref',
                      value: detalhe.id_processo_ref || detalhe.id_processo || '-',
                    },
                    {
                      label: 'Data',
                      value: formatarDataHora(detalhe.data_exibicao),
                    },
                  ]}
                />
                ${montarTagsOperacionaisCandidato(detalhe).length
          ? html`
                      <div class="rh-chip-wrap candidate-tag-row candidate-sheet-tag-row">
                        ${montarTagsOperacionaisCandidato(detalhe).map(
            (tag) => html`
                            <span key=${`detalhe-${tag.chave}`} class=${`rh-chip ${tag.className}`}>
                              ${tag.label}
                            </span>
                          `,
          )}
                      </div>
                    `
          : null}

                <${SectionCard}
                  title="Dados pessoais e avaliação do RH"
                  description="Campos editáveis da ficha do candidato."
                  className="rh-section-card--flat candidate-sheet-section"
                >
                  <div class="row g-2">
                    <div class="col-md-6">
                      <${RotuloCampo} texto="Nome completo" valor=${formPerfil.nome_candidato} />
                      <input
                        class="form-control"
                        value=${formPerfil.nome_candidato}
                        onInput=${(event) => atualizarCampoPerfil('nome_candidato', event.target.value)}
                      />
                    </div>
                    <div class="col-md-6">
                      <${RotuloCampo} texto="E-mail" valor=${formPerfil.email} />
                      <input
                        class="form-control"
                        value=${formPerfil.email}
                        onInput=${(event) => atualizarCampoPerfil('email', event.target.value)}
                      />
                    </div>
                    <div class="col-md-3">
                      <${RotuloCampo} texto="Telefone" valor=${formPerfil.telefone || formPerfil.whatsapp} />
                      <input
                        class="form-control"
                        value=${formPerfil.telefone}
                        onInput=${(event) => atualizarCampoPerfil('telefone', event.target.value)}
                      />
                    </div>
                    <div class="col-md-3">
                      <${RotuloCampo} texto="WhatsApp" valor=${formPerfil.whatsapp || formPerfil.telefone} />
                      <input
                        class="form-control"
                        value=${formPerfil.whatsapp}
                        onInput=${(event) => atualizarCampoPerfil('whatsapp', event.target.value)}
                      />
                    </div>
                    <div class="col-md-6">
                      <${RotuloCampo} texto="Endereço" valor=${formPerfil.endereco} obrigatorio=${false} />
                      <input
                        class="form-control"
                        value=${formPerfil.endereco}
                        onInput=${(event) => atualizarCampoPerfil('endereco', event.target.value)}
                      />
                    </div>
                    <div class="col-md-3">
                      <${RotuloCampo} texto="Cidade" valor=${formPerfil.cidade} obrigatorio=${false} />
                      <input
                        class="form-control"
                        value=${formPerfil.cidade}
                        onInput=${(event) => atualizarCampoPerfil('cidade', event.target.value)}
                      />
                    </div>
                    <div class="col-md-3">
                      <${RotuloCampo} texto="Bairro" valor=${formPerfil.bairro} obrigatorio=${false} />
                      <input
                        class="form-control"
                        value=${formPerfil.bairro}
                        onInput=${(event) => atualizarCampoPerfil('bairro', event.target.value)}
                      />
                    </div>
                    <div class="col-md-3">
                      <${RotuloCampo} texto="Data de nascimento" valor=${formPerfil.data_nascimento} obrigatorio=${false} />
                      <input
                        type="date"
                        class="form-control"
                        value=${formPerfil.data_nascimento}
                        onInput=${(event) => atualizarCampoPerfil('data_nascimento', event.target.value)}
                      />
                    </div>
                    <div class="col-md-3">
                      <label class="form-label">Idade</label>
                      <input class="form-control" readonly value=${detalhe.idade ? `${detalhe.idade} anos` : 'Não informado'} />
                    </div>
                    <div class="col-md-3">
                      <${RotuloCampo} texto="Escolaridade" valor=${formPerfil.escolaridade} obrigatorio=${false} />
                      <input
                        class="form-control"
                        value=${formPerfil.escolaridade}
                        onInput=${(event) => atualizarCampoPerfil('escolaridade', event.target.value)}
                      />
                    </div>
                    <div class="col-md-3">
                      <label class="form-label">Possui experiência</label>
                      <select
                        class="form-select"
                        value=${formPerfil.possui_experiencia}
                        onChange=${(event) => atualizarCampoPerfil('possui_experiencia', event.target.value)}
                      >
                        <option value="">Não informado</option>
                        <option value="Sim">Sim</option>
                        <option value="Nao">Não</option>
                      </select>
                    </div>
                    <div class="col-md-4">
                      <label class="form-label">Classificação do RH</label>
                      <select
                        class="form-select"
                        value=${formPerfil.classificacao_indicacao}
                        onChange=${(event) => atualizarCampoPerfil('classificacao_indicacao', event.target.value)}
                      >
                        <option value="">Não definida</option>
                        ${CLASSIFICACOES_RH_CANDIDATO.map(
            (opcao) => html`<option key=${opcao} value=${opcao}>${opcao}</option>`,
          )}
                      </select>
                    </div>
                    <div class="col-md-8">
                      <label class="form-label">Justificativa / observações do RH</label>
                      <textarea
                        class="form-control"
                        rows="2"
                        value=${formPerfil.justificativa_indicacao}
                        onInput=${(event) => atualizarCampoPerfil('justificativa_indicacao', event.target.value)}
                      ></textarea>
                    </div>
                  </div>
                </${SectionCard}>

                <${SectionCard}
                  title="Pesquisa cultural"
                  className="rh-section-card--flat candidate-sheet-section"
                >
                  <div class="row g-2">
                    <div class="col-md-4">
                      <label class="form-label">Música</label>
                      <input class="form-control" value=${formPerfil.musica} onInput=${(event) => atualizarCampoPerfil('musica', event.target.value)} />
                    </div>
                    <div class="col-md-4">
                      <label class="form-label">Prato</label>
                      <input class="form-control" value=${formPerfil.prato} onInput=${(event) => atualizarCampoPerfil('prato', event.target.value)} />
                    </div>
                    <div class="col-md-4">
                      <label class="form-label">Futebol</label>
                      <input class="form-control" value=${formPerfil.futebol} onInput=${(event) => atualizarCampoPerfil('futebol', event.target.value)} />
                    </div>
                    <div class="col-md-4">
                      <label class="form-label">Time</label>
                      <input class="form-control" value=${formPerfil.time} onInput=${(event) => atualizarCampoPerfil('time', event.target.value)} />
                    </div>
                    <div class="col-md-8">
                      <label class="form-label">Rede social</label>
                      <input class="form-control" value=${formPerfil.rede_social} onInput=${(event) => atualizarCampoPerfil('rede_social', event.target.value)} />
                    </div>
                  </div>

                  ${(resultadosTestesDetalhe.disc?.possuiResultado || resultadosTestesDetalhe.fitCultural?.possuiResultado || resultadosTestesDetalhe.raciocinio?.possuiResultado)
            ? html`
                        <div class="candidate-sheet-test-results">
                          <span class="candidate-sheet-test-results-title">Resultados de testes complementares</span>
                          <p class="candidate-sheet-test-results-analysis">${montarAnaliseBreveTestes(resultadosTestesDetalhe)}</p>
                        </div>
                      `
            : null}
                  <div style=${{ display: resultadosTestesDetalhe.disc?.possuiResultado ? 'block' : 'none' }}>
                    <${PainelResultadoDisc}
                      idTeste=${detalhe.id_teste}
                      aoCarregar=${(estado) => setResultadosTestesDetalhe((atual) => ({ ...atual, disc: estado }))}
                    />
                  </div>
                  <div style=${{ display: resultadosTestesDetalhe.fitCultural?.possuiResultado ? 'block' : 'none' }}>
                    <${PainelResultadoFitCultural}
                      candidatoProcessoId=${detalhe.id_registro_processo}
                      aoCarregar=${(estado) => setResultadosTestesDetalhe((atual) => ({ ...atual, fitCultural: estado }))}
                    />
                  </div>
                  <div style=${{ display: resultadosTestesDetalhe.raciocinio?.possuiResultado ? 'block' : 'none' }}>
                    <${PainelResultadoRaciocinio}
                      idTeste=${detalhe.id_teste}
                      aoCarregar=${(estado) => setResultadosTestesDetalhe((atual) => ({ ...atual, raciocinio: estado }))}
                    />
                  </div>
                </${SectionCard}>

                <${SectionCard}
                  title="Contexto complementar"
                  description="Informações de contato, entrevista e observações já consolidadas no sistema."
                  className="rh-section-card--flat"
                >
                  <div class="row g-3">
                    <div class="col-md-6">
                      <div><strong>Contato principal:</strong> ${detalhe.contato_principal || '-'}</div>
                      <div><strong>Status entrevista:</strong> ${detalhe.status_entrevista || '-'}</div>
                      <div><strong>Data entrevista:</strong> ${formatarDataHora(detalhe.data_entrevista)}</div>
                      <div><strong>Currículo:</strong> ${detalhe.cv_nome_arquivo || 'Sem arquivo anexado.'}</div>
                    </div>
                    <div class="col-md-6">
                      <div><strong>Tags:</strong> ${(detalhe.tags || []).join(', ') || '-'}</div>
                      <div><strong>Habilidades:</strong> ${(detalhe.habilidades || []).join(', ') || '-'}</div>
                      <div><strong>Observação RH:</strong> ${detalhe.observacao_rh || '-'}</div>
                    </div>
                  </div>
                </${SectionCard}>

                <${SectionCard}
                  title="Currículo"
                  description="CV, score, classificação e leitura operacional consolidada."
                  className="rh-section-card--flat"
                >
                  <div class="row g-3 mb-3">
                    <div class="col-md-4">
                      <strong>Score:</strong> ${detalhe.nota_exibicao || '-'}
                    </div>
                    <div class="col-md-4">
                      <strong>Classificação:</strong> ${detalhe.classificacao_exibicao || '-'}
                    </div>
                    <div class="col-md-4">
                      <strong>Arquivo:</strong> ${detalhe.cv_nome_arquivo || 'Sem CV anexado.'}
                    </div>
                  </div>
                  <div class="rh-modal-footer-actions">
                    ${detalhe.cv_disponivel
          ? html`
                          <button
                            type="button"
                            class="btn btn-outline-secondary"
                            onClick=${() => abrirCurriculo(detalhe)}
                          >
                            <span class="material-symbols-outlined">${IconeSvg('description')}</span>
                            Visualizar ou baixar CV
                          </button>
                        `
          : html`
                          <label class="process-cv-picker candidate-cv-picker">
                            <input
                              key=${arquivoCvDetalhe?.name || 'cv-detalhe-vazio'}
                              type="file"
                              class="process-cv-native-input"
                              accept=".pdf,.doc,.docx"
                              disabled=${enviandoCvDetalhe || analisandoCvDetalhe}
                              onChange=${(event) => setArquivoCvDetalhe(event.target.files?.[0] || null)}
                            />
                            <span class="material-symbols-outlined">${IconeSvg('upload_file')}</span>
                            <span class="process-cv-picker-copy">
                              <strong>Adicionar CV</strong>
                              <small title=${arquivoCvDetalhe?.name || ''}>
                                ${arquivoCvDetalhe?.name || 'Nenhum arquivo selecionado'}
                              </small>
                            </span>
                          </label>
                          <button
                            type="button"
                            class="btn btn-outline-primary"
                            disabled=${!arquivoCvDetalhe || enviandoCvDetalhe || analisandoCvDetalhe}
                            onClick=${enviarCvDetalhe}
                          >
                            <span class="material-symbols-outlined">${IconeSvg('upload')}</span>
                            ${enviandoCvDetalhe ? 'Adicionando...' : 'Adicionar CV'}
                          </button>
                        `}
                    <button
                      type="button"
                      class="btn btn-primary"
                      disabled=${analisandoCvDetalhe || enviandoCvDetalhe || (!detalhe.cv_disponivel && !arquivoCvDetalhe)}
                      onClick=${analisarCvDetalhe}
                    >
                      <span class="material-symbols-outlined">${IconeSvg('auto_awesome')}</span>
                      ${analisandoCvDetalhe ? 'Analisando...' : 'Analisar CV'}
                    </button>
                  </div>
                </${SectionCard}>

                <${SectionCard}
                  title="Alertas"
                  description="Pontos que o RH deve verificar antes da decisão."
                  className="rh-section-card--flat"
                >
                  <div class="rh-cell-stack">
                    ${(dossieDetalhe?.alertas || []).map(
            (alerta) => html`<span key=${alerta}>${alerta}</span>`,
          )}
                  </div>
                </${SectionCard}>

                <${SectionCard}
                  title="Processos"
                  description="Participações do candidato em processos seletivos."
                  className="rh-section-card--flat"
                >
                  <div class="table-responsive">
                    <table class="table align-middle rh-modern-history-table">
                      <thead>
                        <tr>
                          <th>Processo</th>
                          <th>Vaga</th>
                          <th>Status</th>
                          <th>Score</th>
                          <th>Data</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${dossieDetalhe?.processos?.length
          ? dossieDetalhe.processos.map(
            (item) => html`
                                <tr key=${`${item.id_registro || item.id_teste || item.id_processo}-${obterDataEvento(item)}`}>
                                  <td>${item.id_processo || '-'}</td>
                                  <td>${item.vaga || '-'}</td>
                                  <td>${item.status_candidato || '-'}</td>
                                  <td>${obterNotaCandidato(item)}</td>
                                  <td>${formatarDataHora(obterDataEvento(item))}</td>
                                </tr>
                              `,
          )
          : html`<${TabelaVazia} colunas=${5} texto="Sem processos vinculados." />`}
                      </tbody>
                    </table>
                  </div>
                </${SectionCard}>

                <${SectionCard}
                  title="Provas"
                  description="Notas e análises por etapa encontradas."
                  className="rh-section-card--flat"
                >
                  <div class="table-responsive">
                    <table class="table align-middle rh-modern-history-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Vaga</th>
                          <th>Nota geral</th>
                          <th>An�lise por etapa</th>
                          <th>Data</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${dossieDetalhe?.provas?.length
          ? dossieDetalhe.provas.map(
            (item) => html`
                                <tr key=${`${item.id_teste || item.nome_candidato}-${obterDataEvento(item)}`}>
                                  <td>${item.id_teste || '-'}</td>
                                  <td>${item.vaga || '-'}</td>
                                  <td>${obterNotaCandidato(item)}</td>
                                  <td>${montarTextoEtapasProvaCandidato(item)}</td>
                                  <td>${formatarDataHora(obterDataEvento(item))}</td>
                                </tr>
                              `,
          )
          : html`<${TabelaVazia} colunas=${5} texto="Sem provas encontradas." />`}
                      </tbody>
                    </table>
                  </div>
                </${SectionCard}>

                <${SectionCard}
                  title="Ações rápidas"
                  description="As mesmas movimentações continuam disponíveis nas telas antigas. Esta página apenas centraliza atalhos."
                  className="rh-section-card--flat"
                >
                  ${renderizarAcoesRapidasDetalhe({
                    detalhe,
                    salvando,
                    onAprovar: abrirAprovacao,
                    onEliminar: (item) =>
                      aplicarStatus(item, CANDIDATE_STATUS_ELIMINATED),
                    onBanco: enviarParaBanco,
                    onEditar: abrirEdicaoCandidato,
                    onAtrelar: (item) =>
                      abrirAtrelar(item, 'Ficha do candidato'),
                    controlador,
                    mostrarEditar: false,
                  })}
                  ${detalhe?.id_registro_processo && controlador?.possuiPermissao?.('documentos_templates.visualizar')
                    ? html`
                        <button
                          type="button"
                          class="btn btn-outline-secondary btn-sm mt-2"
                          onClick=${() => setModalGerarDocumentoAberto(true)}
                        >
                          <span class="material-symbols-outlined">${IconeSvg('description')}</span>
                          Gerar documento
                        </button>
                      `
                    : null}
                </${SectionCard}>

                ${detalhe?.id_registro_processo && controlador?.possuiPermissao?.('onboarding.visualizar')
                  ? html`
                      <${SectionCard}
                        title="Onboarding"
                        description="Inicie ou acompanhe o checklist de integração deste candidato."
                        className="rh-section-card--flat"
                      >
                        <${PainelOnboardingCandidato}
                          idRegistro=${detalhe.id_registro_processo}
                          controlador=${controlador}
                          vagaCandidato=${detalhe.vaga}
                        />
                      </${SectionCard}>
                    `
                  : null}
              </div>

              <footer class="rh-modal-footer">
                <button
                  type="button"
                  class="btn btn-primary"
                  disabled=${salvando || !detalhe?.id_teste}
                  onClick=${salvarPerfilCandidato}
                >
                  ${salvando ? 'Salvando...' : 'Salvar alterações'}
                </button>
                <button
                  type="button"
                  class="btn btn-outline-primary"
                  onClick=${() => abrirFichaImpressao(detalhe, dossieDetalhe, showToast)}
                >
                  Baixar ficha
                </button>
                <button
                  type="button"
                  class="btn btn-primary"
                  onClick=${() => setDetalhe(null)}
                >
                  Fechar
                </button>
              </footer>
            `
      : null}
      </${ModalPadrao}>

      <${ModalGerarDocumento}
        aberto=${modalGerarDocumentoAberto}
        idRegistro=${detalhe?.id_registro_processo}
        onClose=${() => setModalGerarDocumentoAberto(false)}
      />

      <${ModalPadrao}
        aberto=${!!candidatoEditando}
        titulo=${`Editar candidato | ${candidatoEditando?.nome_candidato || 'Candidato'}`}
        subtitulo="Atualize os dados cadastrais e complementares do candidato."
        onClose=${() => setCandidatoEditando(null)}
      >
        ${candidatoEditando
      ? html`
              <div class="row g-3">
                <div class="col-md-6">
                  <label class="form-label">Nome do candidato</label>
                  <input
                    class="form-control"
                    value=${formPerfil.nome_candidato}
                    onInput=${(event) =>
          atualizarCampoPerfil('nome_candidato', event.target.value)}
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">E-mail</label>
                  <input
                    class="form-control"
                    value=${formPerfil.email}
                    onInput=${(event) => atualizarCampoPerfil('email', event.target.value)}
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Telefone</label>
                  <input
                    class="form-control"
                    value=${formPerfil.telefone}
                    onInput=${(event) => atualizarCampoPerfil('telefone', event.target.value)}
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">WhatsApp</label>
                  <input
                    class="form-control"
                    value=${formPerfil.whatsapp}
                    onInput=${(event) => atualizarCampoPerfil('whatsapp', event.target.value)}
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Endereço</label>
                  <input
                    class="form-control"
                    value=${formPerfil.endereco}
                    onInput=${(event) => atualizarCampoPerfil('endereco', event.target.value)}
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Cidade</label>
                  <input
                    class="form-control"
                    value=${formPerfil.cidade}
                    onInput=${(event) => atualizarCampoPerfil('cidade', event.target.value)}
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Bairro</label>
                  <input
                    class="form-control"
                    value=${formPerfil.bairro}
                    onInput=${(event) => atualizarCampoPerfil('bairro', event.target.value)}
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Classificação do RH</label>
                  <select
                    class="form-select"
                    value=${formPerfil.classificacao_indicacao}
                    onChange=${(event) =>
          atualizarCampoPerfil('classificacao_indicacao', event.target.value)}
                  >
                    <option value="">Não definida</option>
                    ${CLASSIFICACOES_RH_CANDIDATO.map(
            (opcao) => html`<option key=${opcao} value=${opcao}>${opcao}</option>`,
          )}
                  </select>
                </div>
                <div class="col-md-6">
                  <label class="form-label">Escolaridade</label>
                  <input
                    class="form-control"
                    value=${formPerfil.escolaridade}
                    onInput=${(event) => atualizarCampoPerfil('escolaridade', event.target.value)}
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Possui experiência</label>
                  <select
                    class="form-select"
                    value=${formPerfil.possui_experiencia}
                    onChange=${(event) => atualizarCampoPerfil('possui_experiencia', event.target.value)}
                  >
                    <option value="">Não informado</option>
                    <option value="Sim">Sim</option>
                    <option value="Nao">Não</option>
                  </select>
                </div>
                <div class="col-md-6">
                  <label class="form-label">Música</label>
                  <input class="form-control" value=${formPerfil.musica} onInput=${(event) => atualizarCampoPerfil('musica', event.target.value)} />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Prato</label>
                  <input class="form-control" value=${formPerfil.prato} onInput=${(event) => atualizarCampoPerfil('prato', event.target.value)} />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Futebol</label>
                  <input class="form-control" value=${formPerfil.futebol} onInput=${(event) => atualizarCampoPerfil('futebol', event.target.value)} />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Time</label>
                  <input class="form-control" value=${formPerfil.time} onInput=${(event) => atualizarCampoPerfil('time', event.target.value)} />
                </div>
                <div class="col-12">
                  <label class="form-label">Rede social</label>
                  <input class="form-control" value=${formPerfil.rede_social} onInput=${(event) => atualizarCampoPerfil('rede_social', event.target.value)} />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Habilidades</label>
                  <input
                    class="form-control"
                    placeholder="Separe por virgula"
                    value=${formPerfil.habilidades}
                    onInput=${(event) => atualizarCampoPerfil('habilidades', event.target.value)}
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Tags</label>
                  <input
                    class="form-control"
                    placeholder="Separe por virgula"
                    value=${formPerfil.tags}
                    onInput=${(event) => atualizarCampoPerfil('tags', event.target.value)}
                  />
                </div>
                <div class="col-12">
                  <label class="form-label">Observações</label>
                  <textarea
                    class="form-control"
                    rows="4"
                    value=${formPerfil.observacao_rh}
                    onInput=${(event) =>
          atualizarCampoPerfil('observacao_rh', event.target.value)}
                  ></textarea>
                </div>
                <div class="col-12">
                  <label class="form-label">Justificativa / observações do RH</label>
                  <textarea
                    class="form-control"
                    rows="3"
                    value=${formPerfil.justificativa_indicacao}
                    onInput=${(event) =>
          atualizarCampoPerfil('justificativa_indicacao', event.target.value)}
                  ></textarea>
                </div>
              </div>

              <footer class="rh-modal-footer">
                <button
                  type="button"
                  class="btn btn-outline-secondary"
                  disabled=${salvando}
                  onClick=${() => setCandidatoEditando(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  class="btn btn-primary"
                  disabled=${salvando}
                  onClick=${salvarPerfilCandidato}
                >
                  ${salvando ? 'Salvando...' : 'Salvar alterações'}
                </button>
              </footer>
            `
      : null}
      </${ModalPadrao}>

      <${ModalAprovacaoCandidato}
        aberto=${!!aprovacaoSelecionada}
        candidato=${aprovacaoSelecionada}
        processo=${processosAbertos.find(
        (processo) =>
          obterReferenciaProcesso(processo) ===
          String(aprovacaoSelecionada?.id_processo_ref || '').trim(),
      )}
        salvando=${salvandoAprovacao}
        onClose=${() => setAprovacaoSelecionada(null)}
        onConfirm=${confirmarAprovacao}
      />

      <${ModalPadrao}
        aberto=${!!candidatoParaAtrelar}
        titulo=${`Adicionar a processo seletivo | ${candidatoParaAtrelar?.nome_candidato || 'Candidato'
    }`}
        subtitulo="Selecione um processo seletivo aberto para vincular este candidato."
        onClose=${() => {
          setCandidatoParaAtrelar(null);
          setOrigemAtrelamento('Central de Candidatos');
          setIndicadoPorAtrelamento('');
          setProcessoSelecionado('');
        }}
      >
        <div class="rh-details-body">
          <${MetricGrid}
            items=${[
      {
        label: 'Candidato',
        value: candidatoParaAtrelar?.nome_candidato || '-',
      },
      {
        label: 'Vaga atual',
        value: candidatoParaAtrelar?.vaga || '-',
      },
      {
        label: 'Origem',
        value: candidatoParaAtrelar?.origem_rotulo || '-',
      },
    ]}
          />

          <div class="rh-filter-field">
            <label>Processo seletivo</label>
            ${processosAbertos.length
      ? html`
                  <${SelectProcesso}
                    processos=${processosAbertos}
                    valor=${processoSelecionado}
                    disabled=${salvando}
                    onChange=${setProcessoSelecionado}
                  />
                `
      : html`<div class="alert alert-warning mb-0">Nenhum processo seletivo aberto encontrado.</div>`}
          </div>

          ${candidatoParaAtrelar?.origem_cadastro !== 'banco'
            ? html`
                <div class="rh-filter-field">
                  <label>Origem do cadastro</label>
                  <select
                    class="form-select"
                    value=${origemAtrelamento}
                    disabled=${salvando}
                    onChange=${(event) => setOrigemAtrelamento(event.target.value)}
                  >
                    <option value="Central de Candidatos">Central de Candidatos</option>
                    <option value="Indicação">Indicação</option>
                  </select>
                </div>
              `
            : null}

          ${origemAtrelamento === 'Indicação' && candidatoParaAtrelar?.origem_cadastro !== 'banco'
            ? html`
                <div class="rh-filter-field">
                  <label>Indicado por</label>
                  <input
                    class="form-control"
                    value=${indicadoPorAtrelamento}
                    disabled=${salvando}
                    placeholder="Nome do colaborador que indicou"
                    onInput=${(event) => setIndicadoPorAtrelamento(event.target.value)}
                  />
                </div>
              `
            : null}
        </div>

        <footer class="rh-modal-footer">
          <div class="rh-modal-footer-actions">
            <button
              type="button"
              class="btn btn-outline-secondary"
              disabled=${salvando}
              onClick=${() => {
                setCandidatoParaAtrelar(null);
                setOrigemAtrelamento('Central de Candidatos');
                setIndicadoPorAtrelamento('');
                setProcessoSelecionado('');
              }}
            >
              Cancelar
            </button>

            <button
              type="button"
              class="btn btn-primary"
              disabled=${salvando ||
                !processoSelecionado ||
                (origemAtrelamento === 'Indicação' && !indicadoPorAtrelamento.trim())}
              onClick=${confirmarAtrelar}
            >
              ${salvando ? 'Salvando...' : 'Confirmar vínculo'}
            </button>
          </div>
        </footer>
      </${ModalPadrao}>
    </${PainelRh}>
  `;
}
