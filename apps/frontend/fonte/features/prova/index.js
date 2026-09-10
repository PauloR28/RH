import { IconeSvg } from '../../ui/icone.js';

﻿import { html, useEffect, useMemo, useState } from '../infraestrutura-react.js';
import {
  OPCOES_OPERACOES,
  OPCOES_TRILHAS_PROVA,
  OPCOES_VAGAS_PROVA,
  SUGESTOES_NIVEL_POR_VAGA,
  montarProvaPorBlueprint,
  resolverBlueprintProva,
} from '../../perguntas.js';
import {
  atualizarEntrevista,
  lerEntrevistas,
  lerProcessos,
  navegarParaTela,
} from '../../app/controlador-aplicacao.js';
import {
  formatarDataHora,
  formatarNotaVisual,
  formatarTempoRestante,
  montarDescricaoFluxo,
  obterClasseEtapaResultado,
} from '../../shared/helpers-visuais.js';
import {
  EditorTextoRich,
  EmptyState,
  MetricGrid,
  ModalPadrao,
  PageIntro,
  PainelRh,
  PerguntaExcel,
  PerguntaGrupoCompacto,
  PerguntaMultipla,
  SectionCard,
} from '../../ui/componentes-compartilhados.js';
import { CHAVE_REQUISITO_BUSCA } from '../../ui/busca-global.js';
import {
  encontrarProcessoPorReferencia,
  obterChaveProcesso,
  obterReferenciaProcesso,
} from '../../shared/process-reference.js';
import {
  NIVEIS_PERSONALIZACAO,
  PERFIS_OPERACAO,
  STATUS_PERSONALIZACAO,
  TIPOS_ATENDIMENTO_PERSONALIZACAO,
  gerarPersonalizacaoProva,
  inferirPerfilAtendimentoPersonalizacao,
  registrarHistoricoPersonalizacao,
} from './services/personalizacao-inteligente.js';
import { isProcessClosed } from '../../shared/process-flow.js';

const STATUS_CANDIDATOS_AGENDADOS = new Set(['Agendado', 'Confirmado']);
const OPCAO_OUTRO = 'Outro';

function normalizarTexto(valor) {
  return String(valor || '').trim();
}

function obterValorCandidato(candidato = {}, chaves = []) {
  for (const chave of chaves) {
    const valor = candidato?.[chave];
    if (Array.isArray(valor)) {
      const textoLista = valor.map(normalizarTexto).filter(Boolean).join(', ');
      if (textoLista) return textoLista;
      continue;
    }
    const texto = normalizarTexto(valor);
    if (texto) return texto;
  }
  return '';
}

function juntarValoresCandidato(...valores) {
  return Array.from(new Set(valores.map(normalizarTexto).filter(Boolean))).join(' • ');
}

function formatarDataImpressao(valor) {
  const texto = normalizarTexto(valor);
  if (!texto) return '';
  const data = new Date(texto);
  return Number.isNaN(data.getTime()) ? texto : data.toLocaleDateString('pt-BR');
}

function montarLinhasInformacoesCandidato(candidato = {}) {
  const endereco = juntarValoresCandidato(
    obterValorCandidato(candidato, ['endereco', 'logradouro', 'address']),
    obterValorCandidato(candidato, ['numero', 'numero_endereco']),
    obterValorCandidato(candidato, ['bairro']),
  );
  const cidadeEstado = juntarValoresCandidato(
    obterValorCandidato(candidato, ['cidade', 'municipio']),
    obterValorCandidato(candidato, ['estado', 'uf']),
  );
  const indicacaoTipo = obterValorCandidato(candidato, ['tipo_indicacao', 'indicacao_tipo']);
  const indicacao = candidato.eh_indicacao
    ? juntarValoresCandidato('Sim', indicacaoTipo)
    : indicacaoTipo || obterValorCandidato(candidato, ['indicacao', 'indicado_por']);

  return [
    { label: 'Idade', value: obterValorCandidato(candidato, ['idade']) },
    { label: 'Nascimento', value: formatarDataImpressao(obterValorCandidato(candidato, ['data_nascimento', 'nascimento'])) },
    { label: 'Sexo', value: obterValorCandidato(candidato, ['sexo', 'genero']) },
    { label: 'CPF', value: obterValorCandidato(candidato, ['cpf']) },
    { label: 'Telefone', value: obterValorCandidato(candidato, ['telefone', 'telefone_acesso']) },
    { label: 'Celular/WhatsApp', value: juntarValoresCandidato(
      obterValorCandidato(candidato, ['celular']),
      obterValorCandidato(candidato, ['whatsapp']),
    ) },
    { label: 'E-mail', value: obterValorCandidato(candidato, ['email', 'email_acesso']) },
    { label: 'Endereço', value: endereco },
    { label: 'CEP', value: obterValorCandidato(candidato, ['cep']) },
    { label: 'Cidade/Estado', value: cidadeEstado },
    { label: 'Escolaridade', value: obterValorCandidato(candidato, ['escolaridade']) },
    { label: 'Formação', value: obterValorCandidato(candidato, ['formacao', 'formação']) },
    { label: 'Curso', value: obterValorCandidato(candidato, ['curso']) },
    { label: 'Instituição', value: obterValorCandidato(candidato, ['instituicao', 'instituição']) },
    { label: 'Processo', value: obterValorCandidato(candidato, ['id_processo_ref', 'id_processo', 'processo']) },
    { label: 'Cargo/Vaga', value: obterValorCandidato(candidato, ['role', 'vaga', 'cargo']) },
    { label: 'Nível', value: obterValorCandidato(candidato, ['level', 'nivel', 'nivel_prova']) },
    { label: 'Área/Trilha', value: obterValorCandidato(candidato, ['track', 'trilha', 'area', 'area_prova']) },
    { label: 'Cliente/Operação', value: obterValorCandidato(candidato, ['operacao', 'operação', 'cliente', 'setor_cliente']) },
    { label: 'Indicação', value: indicacao },
    { label: 'Indicador', value: obterValorCandidato(candidato, ['nome_indicador', 'indicador']) },
    { label: 'Cadastro', value: formatarDataImpressao(obterValorCandidato(candidato, ['data_cadastro', 'criado_em'])) },
    { label: 'Atualização', value: formatarDataImpressao(obterValorCandidato(candidato, ['ultima_atualizacao', 'atualizado_em'])) },
    { label: 'Situação', value: obterValorCandidato(candidato, ['status_candidato', 'status_fluxo', 'status']) },
  ].filter((campo) => campo.value);
}

function obterPercentualEtapaImpressao(etapa = {}) {
  const valor = Number(etapa.percent);
  if (!Number.isFinite(valor)) return 0;
  return valor <= 1 ? valor * 100 : valor;
}

function obterStatusEtapaImpressao(etapa = {}) {
  if (Number(etapa.pendings || 0) > 0) return 'Pendente';
  const percentual = obterPercentualEtapaImpressao(etapa);
  if (percentual >= 70) return 'Bom desempenho';
  if (percentual >= 50) return 'Em análise';
  return 'Atenção';
}

function montarCompetenciasObservadas(resumoEtapas = []) {
  return (Array.isArray(resumoEtapas) ? resumoEtapas : [])
    .filter((etapa) => normalizarTexto(etapa?.label))
    .slice()
    .sort((primeira, segunda) => obterPercentualEtapaImpressao(segunda) - obterPercentualEtapaImpressao(primeira))
    .map((etapa) => {
      const percentual = obterPercentualEtapaImpressao(etapa);
      const prefixo = percentual >= 70
        ? 'Boa capacidade em'
        : percentual >= 50
          ? 'Desempenho em desenvolvimento em'
          : 'Ponto de desenvolvimento em';
      return `${prefixo} ${etapa.label} (${formatarNotaVisual(percentual, 0)}%)`;
    });
}

function obterAderenciaVagaImpressao(candidato = {}, notaFinal = 0) {
  const aderenciaInformada = obterValorCandidato(candidato, [
    'aderencia_vaga',
    'aderencia',
    'afinidade_percentual',
  ]);
  const valorInformado = Number(aderenciaInformada.replace('%', '').replace(',', '.'));
  const valorBase = Number.isFinite(valorInformado)
    ? valorInformado
    : Number(notaFinal) * 10;
  const percentual = valorBase <= 10 ? valorBase * 10 : valorBase;
  return Number.isFinite(percentual)
    ? `${formatarNotaVisual(Math.max(0, Math.min(100, percentual)), 0)}%`
    : '-';
}

function obterItensOrdenacaoQuestao(questao) {
  const itens = Array.isArray(questao?.itensOrdenacao)
    ? questao.itensOrdenacao
    : Array.isArray(questao?.itens_ordenacao)
      ? questao.itens_ordenacao
      : [];

  return itens.map((item) => normalizarTexto(item)).filter(Boolean);
}

function DescricaoQuestao({ questao }) {
  const itensOrdenacao = obterItensOrdenacaoQuestao(questao);
  if (!itensOrdenacao.length) {
    return html`<p class="exam-question-description">${questao.description}</p>`;
  }

  const contexto = normalizarTexto(questao.contextoCandidato);
  const enunciado = normalizarTexto(
    questao.enunciadoQuestao || questao.enunciadoCandidato || questao.description,
  );
  const instrucoes = normalizarTexto(questao.instrucaoCandidato);

  return html`
    <div class="exam-question-description">
      ${contexto ? html`<p>${contexto}</p>` : null}
      ${enunciado ? html`<p>${enunciado}</p>` : null}
      <ul class="exam-question-order-list">
        ${itensOrdenacao.map(
          (item) => html`<li key=${item}>${item}</li>`,
        )}
      </ul>
      ${instrucoes ? html`<p>${instrucoes}</p>` : null}
    </div>
  `;
}

function validarEmailContato(valor) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizarTexto(valor));
}

function validarTelefoneContato(valor) {
  const digitos = normalizarTexto(valor).replace(/\D/g, '');
  return digitos.length >= 10 && digitos.length <= 13;
}

function primeiroValorLista(lista = []) {
  return Array.isArray(lista) ? normalizarTexto(lista[0]) : '';
}

function montarListaComOutro(lista = [], outro = '') {
  return [
    ...lista.filter((item) => item !== OPCAO_OUTRO),
    normalizarTexto(outro),
  ].filter(Boolean);
}

function normalizarBusca(valor) {
  return normalizarTexto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizarValorTrilhaProva(valor) {
  const chave = normalizarBusca(valor);
  if (!chave) return '';
  if (chave.includes('comercial')) return 'comercial';
  if (chave.includes('financeiro')) return 'financeiro';
  if (chave.includes('rh')) return 'rh';
  if (chave.includes('ti')) return 'ti';
  if (chave.includes('adm') || chave.includes('gestao')) return 'adm';
  if (chave.includes('operacao') || chave.includes('padrao')) return 'operacao';
  return chave;
}

function obterOpcaoVaga(label) {
  const chave = normalizarBusca(label);
  return (
    OPCOES_VAGAS_PROVA.find((opcao) => normalizarBusca(opcao.label) === chave) ||
    null
  );
}

function aplicarConfiguracaoDaVaga(formulario = {}, vaga = '') {
  const opcao = obterOpcaoVaga(vaga);
  const nivelSugerido = SUGESTOES_NIVEL_POR_VAGA[vaga] || opcao?.level || '';
  const trilhaSugerida = normalizarValorTrilhaProva(opcao?.track || '');

  return {
    ...formulario,
    vaga,
    nivel: nivelSugerido || formulario.nivel,
    trilha: trilhaSugerida || formulario.trilha,
  };
}

function montarIdentificadorCandidatoAgendado(candidato) {
  return (
    normalizarTexto(candidato?.id_entrevista) ||
    normalizarTexto(candidato?.id_registro) ||
    normalizarTexto(candidato?.id_teste)
  );
}

function deduplicarCandidatosAgendados(lista) {
  const mapa = new Map();

  (Array.isArray(lista) ? lista : []).forEach((item) => {
    const chave =
      montarIdentificadorCandidatoAgendado(item) ||
      `${normalizarTexto(item?.nome_candidato)}::${normalizarTexto(item?.id_processo_ref || item?.id_processo)}`;
    if (chave && !mapa.has(chave)) {
      mapa.set(chave, item);
    }
  });

  return Array.from(mapa.values());
}

function ModalAcessoAdministrativo({
  aberto,
  acao = '',
  controlador,
  onClose,
  onLiberado,
}) {
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [autenticando, setAutenticando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setUsuario('');
    setSenha('');
    setErro('');
    setAutenticando(false);
  }, [aberto]);

  if (!aberto) return null;

  const confirmar = async () => {
    if (!usuario.trim() || !senha) {
      setErro('Informe login e senha do RH/administrador.');
      return;
    }

    setAutenticando(true);
    setErro('');
    const resultado = await controlador.autenticarAcessoAdministrativo(
      usuario,
      senha,
    );
    setAutenticando(false);

    if (!resultado?.ok) {
      setErro(resultado?.mensagem || 'Usuário ou senha inválidos.');
      return;
    }

    onLiberado();
  };

  return html`
    <${ModalPadrao}
      aberto=${aberto}
      titulo="Acesso restrito"
      subtitulo="Acesso restrito. Informe as credenciais do RH/administrador para continuar."
      onClose=${onClose}
    >
      <div class="rh-details-body">
        ${acao ? html`<p class="text-muted mb-3">${acao}</p>` : null}
        <div class="row g-3">
          <div class="col-md-12">
            <label class="form-label">Login</label>
            <input
              class="form-control"
              value=${usuario}
              autocomplete="username"
              onInput=${(event) => setUsuario(event.target.value)}
            />
          </div>
          <div class="col-md-12">
            <label class="form-label">Senha</label>
            <input
              class="form-control"
              type="password"
              value=${senha}
              autocomplete="current-password"
              onInput=${(event) => setSenha(event.target.value)}
              onKeyDown=${(event) => {
                if (event.key === 'Enter') confirmar();
              }}
            />
          </div>
        </div>
        ${erro ? html`<div class="alert alert-danger mt-3 mb-0">${erro}</div>` : null}
      </div>
      <footer class="rh-modal-footer">
        <button
          type="button"
          class="btn btn-outline-secondary"
          disabled=${autenticando}
          onClick=${onClose}
        >
          Cancelar
        </button>
        <button
          type="button"
          class="btn btn-primary"
          disabled=${autenticando}
          onClick=${confirmar}
        >
          ${autenticando ? 'Validando...' : 'Continuar'}
        </button>
      </footer>
    </${ModalPadrao}>
  `;
}

export function TelaConfiguracao({ controlador }) {
  const [processosAbertos, setProcessosAbertos] = useState([]);
  const [candidatosAgendados, setCandidatosAgendados] = useState([]);
  const [atualizandoCandidatoAgendado, setAtualizandoCandidatoAgendado] =
    useState(false);
  const [erro, setErro] = useState('');
  const [requisitoBuscado, setRequisitoBuscado] = useState(null);
  const [formulario, setFormulario] = useState(() => ({
    processo:
      controlador.estado.processoSelecionado ||
      (controlador.estado.candidato.id_processo_ref ||
      controlador.estado.candidato.id_processo
        ? controlador.estado.candidato.id_processo_ref ||
          controlador.estado.candidato.id_processo
        : ''),
    candidatoAgendado: montarIdentificadorCandidatoAgendado(
      controlador.estado.candidato,
    ),
    vaga: controlador.estado.candidato.role || '',
    nivel: controlador.estado.candidato.level || '',
    trilha:
      controlador.estado.candidato.track &&
      controlador.estado.candidato.track !== 'automatico'
        ? controlador.estado.candidato.track
        : '',
    operacao: '',
    tempo: controlador.estado.candidato.time || 40,
    candidatoNome: controlador.estado.candidato.name || '',
    candidatoEmail: controlador.estado.candidato.email || '',
    candidatoTelefone: controlador.estado.candidato.whatsapp || '',
  }));
  const [personalizacao, setPersonalizacao] = useState(() => ({
    ativada: false,
    operacao: '',
    clientesOperacoes: [],
    clienteOutro: '',
    tiposAtendimento: [],
    tipoAtendimentoOutro: '',
    situacaoPratica: '',
    perfilOperacao: PERFIS_OPERACAO.find((perfil) => perfil.id === 'call_center')?.id || PERFIS_OPERACAO[0].id,
    nivelPersonalizacao: NIVEIS_PERSONALIZACAO[1].id,
    status: STATUS_PERSONALIZACAO.NAO_PERSONALIZADA,
    questoes: [],
    alertas: [],
    historico: null,
  }));

  useEffect(() => {
    (async () => {
      try {
        const lista = await lerProcessos();
        const abertos = (Array.isArray(lista) ? lista : []).filter(
          (processo) => !isProcessClosed(processo),
        );
        setProcessosAbertos(abertos);
      } catch (error) {
        setErro(
          error?.message ||
            'Não foi possível carregar os processos seletivos abertos.',
        );
      }
    })();
  }, []);

  useEffect(() => {
    try {
      const bruto = sessionStorage.getItem(CHAVE_REQUISITO_BUSCA);
      if (!bruto) return;

      setRequisitoBuscado(JSON.parse(bruto));
      sessionStorage.removeItem(CHAVE_REQUISITO_BUSCA);
    } catch (error) {
      sessionStorage.removeItem(CHAVE_REQUISITO_BUSCA);
    }
  }, []);

  useEffect(() => {
    if (!formulario.vaga) return;
    setFormulario((anterior) => {
      const proximo = aplicarConfiguracaoDaVaga(anterior, anterior.vaga);
      return anterior.nivel === proximo.nivel && anterior.trilha === proximo.trilha
        ? anterior
        : proximo;
    });
  }, [formulario.vaga]);

  const processoSelecionado = useMemo(() => {
    if (!formulario.processo || formulario.processo === 'PROCESSO_UNICO') {
      return null;
    }

    return (
      encontrarProcessoPorReferencia(processosAbertos, formulario.processo) ||
      processosAbertos.find(
        (processo) =>
          normalizarTexto(processo.id_processo) ===
          normalizarTexto(formulario.processo),
      ) ||
      null
    );
  }, [formulario.processo, processosAbertos]);

  useEffect(() => {
    if (!processoSelecionado) {
      setCandidatosAgendados([]);
      setFormulario((anterior) =>
        anterior.candidatoAgendado
          ? { ...anterior, candidatoAgendado: '' }
          : anterior,
      );
      return;
    }

    const referenciaProcesso = obterReferenciaProcesso(processoSelecionado);
    const vagaProcesso = normalizarTexto(processoSelecionado.vaga);
    const trilhaProcesso =
      normalizarValorTrilhaProva(processoSelecionado.trilha) ||
      normalizarValorTrilhaProva(obterOpcaoVaga(vagaProcesso)?.track || '');
    const nivelProcesso = SUGESTOES_NIVEL_POR_VAGA[vagaProcesso] || '';

    setFormulario((anterior) => {
      const proximoFormulario = { ...anterior };
      let mudou = false;

      if (
        referenciaProcesso &&
        normalizarTexto(anterior.processo) !== referenciaProcesso
      ) {
        proximoFormulario.processo = referenciaProcesso;
        mudou = true;
      }

      if (vagaProcesso && normalizarTexto(anterior.vaga) !== vagaProcesso) {
        proximoFormulario.vaga = vagaProcesso;
        mudou = true;
      }

      if (nivelProcesso && normalizarTexto(anterior.nivel) !== nivelProcesso) {
        proximoFormulario.nivel = nivelProcesso;
        mudou = true;
      }

      if (trilhaProcesso && normalizarTexto(anterior.trilha) !== trilhaProcesso) {
        proximoFormulario.trilha = trilhaProcesso;
        mudou = true;
      }

      if (
        processoSelecionado.operacao &&
        normalizarTexto(anterior.operacao) !== normalizarTexto(processoSelecionado.operacao)
      ) {
        proximoFormulario.operacao = processoSelecionado.operacao;
        mudou = true;
      }

      return mudou ? proximoFormulario : anterior;
    });
    setPersonalizacao((anterior) => ({
      ...anterior,
      operacao: anterior.operacao,
      questoes: [],
      alertas: [],
      historico: null,
      status: anterior.ativada
        ? STATUS_PERSONALIZACAO.PENDENTE
        : STATUS_PERSONALIZACAO.NAO_PERSONALIZADA,
    }));
  }, [processoSelecionado]);

  useEffect(() => {
    let ativo = true;

    if (!processoSelecionado) {
      return undefined;
    }

    (async () => {
      try {
        const lista = await lerEntrevistas({
          idProcesso: obterReferenciaProcesso(processoSelecionado),
        });
        if (!ativo) return;

        const candidatosFiltrados = deduplicarCandidatosAgendados(
          (Array.isArray(lista) ? lista : []).filter((item) =>
            STATUS_CANDIDATOS_AGENDADOS.has(
              normalizarTexto(item.status_entrevista),
            ),
          ),
        );
        setCandidatosAgendados(candidatosFiltrados);
        setFormulario((anterior) => {
          if (!anterior.candidatoAgendado) {
            return anterior;
          }

          const aindaExiste = candidatosFiltrados.some(
            (item) =>
              montarIdentificadorCandidatoAgendado(item) ===
              anterior.candidatoAgendado,
          );
          return aindaExiste
            ? anterior
            : { ...anterior, candidatoAgendado: '' };
        });
      } catch (error) {
        if (!ativo) return;
        setCandidatosAgendados([]);
        setErro(
          error?.message ||
            'Não foi possível carregar os candidatos agendados deste processo.',
        );
      }
    })();

    return () => {
      ativo = false;
    };
  }, [processoSelecionado]);

  const candidatoAgendadoSelecionado = useMemo(
    () =>
      candidatosAgendados.find(
        (item) =>
          montarIdentificadorCandidatoAgendado(item) ===
          formulario.candidatoAgendado,
      ) || null,
    [candidatosAgendados, formulario.candidatoAgendado],
  );

  const blueprint = useMemo(() => {
    if (!formulario.vaga || !formulario.nivel) return null;
    return resolverBlueprintProva(
      formulario.vaga,
      formulario.nivel,
      formulario.trilha || '',
    );
  }, [formulario]);

  const montarConfiguracaoPersonalizacao = () => {
    const clientes = montarListaComOutro(
      personalizacao.clientesOperacoes,
      personalizacao.clienteOutro,
    );
    const tiposAtendimento = montarListaComOutro(
      personalizacao.tiposAtendimento,
      personalizacao.tipoAtendimentoOutro,
    );
    const trilha =
      formulario.trilha ||
      processoSelecionado?.trilha ||
      obterOpcaoVaga(formulario.vaga)?.track ||
      '';

    return {
      operacao: clientes.join(', '),
      cliente: clientes.join(', '),
      clientesOperacoes: clientes,
      vaga: formulario.vaga,
      trilha,
      nivelProva: formulario.nivel || blueprint?.level || '',
      blueprintLabel: blueprint?.label || '',
      perfilOperacao: inferirPerfilAtendimentoPersonalizacao({
        clientes,
        tipos: tiposAtendimento,
        area: trilha,
        vaga: formulario.vaga,
      }) || personalizacao.perfilOperacao,
      tiposAtendimento,
      nivelPersonalizacao: personalizacao.nivelPersonalizacao,
      situacaoPratica: personalizacao.situacaoPratica,
      usuario:
        controlador.estado.nomeUsuarioAutenticado ||
        controlador.estado.usuarioAutenticado ||
        'RH',
    };
  };

  const camposPersonalizacaoPreenchidos = (configuracao) =>
    Boolean(
      normalizarTexto(configuracao.operacao) &&
        (configuracao.tiposAtendimento || []).length &&
        normalizarTexto(configuracao.nivelPersonalizacao),
    );

  const montarHistoricoFallbackPersonalizacao = (
    configuracao,
    questoesBase,
    mensagem,
  ) => ({
    id: `${Date.now()}-fallback`,
    acao: 'fallback_personalizacao_automatica',
    operacao: configuracao.operacao,
    cliente: configuracao.cliente,
    vaga: configuracao.vaga,
    trilha: configuracao.trilha,
    nivel_prova: configuracao.nivelProva,
    blueprint_label: configuracao.blueprintLabel,
    perfil_atendimento:
      PERFIS_OPERACAO.find((perfil) => perfil.id === configuracao.perfilOperacao)
        ?.label || configuracao.perfilOperacao,
    nivel_personalizacao:
      NIVEIS_PERSONALIZACAO.find(
        (nivel) => nivel.id === configuracao.nivelPersonalizacao,
      )?.label || configuracao.nivelPersonalizacao,
    usuario: configuracao.usuario,
    data_hora: new Date().toISOString(),
    mecanismo: 'template_local_fallback',
    total_questoes: questoesBase.length,
    alertas: [mensagem],
  });

  const gerarPersonalizacaoAutomatica = () => {
    const configuracao = montarConfiguracaoPersonalizacao();
    const questoesBase = montarProvaPorBlueprint(blueprint);

    try {
      const resultado = gerarPersonalizacaoProva(questoesBase, configuracao);
      const historico = {
        ...(resultado.historico || {}),
        status_publicacao: STATUS_PERSONALIZACAO.PUBLICADA,
        publicada_em: new Date().toISOString(),
      };
      registrarHistoricoPersonalizacao(historico);
      setPersonalizacao((anterior) => ({
        ...anterior,
        status: STATUS_PERSONALIZACAO.PUBLICADA,
        questoes: resultado.questoes,
        alertas: resultado.alertas,
        historico,
      }));

      return {
        enabled: true,
        status: STATUS_PERSONALIZACAO.PUBLICADA,
        configuracao,
        questoes: resultado.questoes,
        alertas: resultado.alertas,
        historico,
      };
    } catch (error) {
      const mensagem =
        error?.message ||
        'Não foi possível personalizar todas as questões automaticamente. A prova continuará com as questões originais nos itens não personalizados.';
      const historico = montarHistoricoFallbackPersonalizacao(
        configuracao,
        questoesBase,
        mensagem,
      );
      registrarHistoricoPersonalizacao(historico);
      setPersonalizacao((anterior) => ({
        ...anterior,
        status: STATUS_PERSONALIZACAO.ERRO,
        questoes: questoesBase,
        alertas: [mensagem],
        historico,
      }));

      return {
        enabled: true,
        status: STATUS_PERSONALIZACAO.ERRO,
        configuracao,
        questoes: questoesBase,
        alertas: [mensagem],
        historico,
      };
    }
  };

  const prosseguir = () => {
    if (!formulario.vaga || !formulario.nivel || !formulario.tempo) {
      setErro('Preencha os campos da configuração para prosseguir.');
      return;
    }

    if (!formulario.processo) {
      setErro('Selecione o processo seletivo para prosseguir.');
      return;
    }

    if (!formulario.trilha) {
      setErro('Selecione a Área/Trilha para prosseguir.');
      return;
    }

    const processoUnico = formulario.processo === 'PROCESSO_UNICO';
    if (processoUnico) {
      const nome = normalizarTexto(formulario.candidatoNome);
      const email = normalizarTexto(formulario.candidatoEmail);
      const telefone = normalizarTexto(formulario.candidatoTelefone);
      if (!nome || !email || !telefone) {
        setErro('Processo único exige nome completo, e-mail e telefone do candidato.');
        return;
      }
      if (!validarEmailContato(email)) {
        setErro('Informe um e-mail válido para o candidato do Processo único.');
        return;
      }
      if (!validarTelefoneContato(telefone)) {
        setErro('Informe um telefone válido para o candidato do Processo único.');
        return;
      }
    }

    let personalizacaoProva = null;
    if (personalizacao.ativada) {
      if (!blueprint) {
        setErro('Selecione uma combinação válida de vaga, nível e trilha.');
        return;
      }

      const configuracao = montarConfiguracaoPersonalizacao();
      if (!camposPersonalizacaoPreenchidos(configuracao)) {
        setErro(
          'Preencha os campos obrigatórios da Personalização Inteligente antes de prosseguir.',
        );
        return;
      }

      personalizacaoProva = gerarPersonalizacaoAutomatica();
    }

    setErro('');
    const candidatoProcessoUnico =
      formulario.processo === 'PROCESSO_UNICO'
        ? {
            nome_candidato: normalizarTexto(formulario.candidatoNome),
            email: normalizarTexto(formulario.candidatoEmail),
            telefone: normalizarTexto(formulario.candidatoTelefone),
            whatsapp: normalizarTexto(formulario.candidatoTelefone),
            status_entrevista: 'Apto para prova',
          }
        : candidatoAgendadoSelecionado;

    controlador.configurarFluxo({
      role: formulario.vaga,
      level: formulario.nivel,
      track: formulario.trilha || '',
      time: Number(formulario.tempo),
      processId: formulario.processo,
      scheduledCandidate: candidatoProcessoUnico,
      personalizacaoProva,
    });
  };

  const selecionarCandidatoAgendado = async (event) => {
    const identificador = event.target.value;
    setFormulario((anterior) => ({
      ...anterior,
      candidatoAgendado: identificador,
    }));

    if (!identificador) {
      return;
    }

    const candidato = candidatosAgendados.find(
      (item) => montarIdentificadorCandidatoAgendado(item) === identificador,
    );
    if (!candidato?.id_entrevista) {
      return;
    }

    if (normalizarTexto(candidato.status_entrevista) === 'Compareceu') {
      return;
    }

    setAtualizandoCandidatoAgendado(true);
    setErro('');

    try {
      await atualizarEntrevista(candidato.id_entrevista, {
        status_entrevista: 'Compareceu',
        id_processo_ref:
          obterReferenciaProcesso(processoSelecionado) ||
          normalizarTexto(candidato.id_processo_ref || candidato.id_processo),
      });
      setCandidatosAgendados((anterior) =>
        anterior.map((item) =>
          montarIdentificadorCandidatoAgendado(item) === identificador
            ? { ...item, status_entrevista: 'Compareceu' }
            : item,
        ),
      );
    } catch (error) {
      setErro(
        error?.message ||
          'Não foi possível atualizar o status do candidato para Compareceu.',
      );
    } finally {
      setAtualizandoCandidatoAgendado(false);
    }
  };

  return html`
    <${PainelRh}
      screenId="screen-config"
      navAtiva="screen-config"
      subtituloMarca="Configuração da prova"
      placeholderBusca="Configuração do fluxo da prova"
      controlador=${controlador}
      acaoPrimaria=${{
        label: 'Iniciar teste',
        permissao: 'provas.enviar',
        onClick: () => controlador.iniciarNovoFluxo(),
      }}
    >
      <${PageIntro}
        kicker="Console • Configuração"
        title="Configuração da prova"
        description="Selecione perfil, nível, trilha e processo sem alterar o roteamento hash nem a integração existente."
      />

      ${
        requisitoBuscado
          ? html`
            <${SectionCard}
              title="Requisito localizado na busca"
              description=${`${requisitoBuscado.blueprintLabel || 'Blueprint'} • ${requisitoBuscado.stageLabel || 'Etapa'}`}
            >
              <div class="rh-inline-alert mb-0">
                <strong>${requisitoBuscado.titulo || 'Requisito'}</strong>
                <div>${requisitoBuscado.descricao || 'Sem descrição adicional.'}</div>
              </div>
            </${SectionCard}>
          `
          : null
      }

      <${SectionCard}
        title="Parâmetros da avaliação"
        description="Todos os campos abaixo alimentam o mesmo estado global já utilizado pelo sistema."
        tourId="config-parameters"
      >
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label">Processo seletivo</label>
            <select
              class="form-select rh-flow-input"
              value=${formulario.processo}
              onChange=${(event) =>
                setFormulario({
                  ...formulario,
                  processo: event.target.value,
                  candidatoAgendado: '',
                })}
            >
              <option value="">Selecione...</option>
              <option value="PROCESSO_UNICO">Processo único</option>
              ${processosAbertos.map(
                (processo) => html`
                  <option
                    key=${obterChaveProcesso(processo)}
                    value=${obterReferenciaProcesso(processo)}
                  >
                    ${`${processo.id_processo} • ${processo.vaga} • ${processo.operacao || processo.trilha || '-'} • ${processo.data_encerramento || '-'}`}
                  </option>
                `,
              )}
            </select>
          </div>

          <div class="col-md-6">
            <label class="form-label">Candidato agendado</label>
            <select
              class="form-select rh-flow-input"
              value=${formulario.candidatoAgendado}
              disabled=${!processoSelecionado || atualizandoCandidatoAgendado}
              onChange=${selecionarCandidatoAgendado}
            >
              <option value="">Opcional</option>
              ${candidatosAgendados.map(
                (candidato) => html`
                  <option
                    key=${montarIdentificadorCandidatoAgendado(candidato)}
                    value=${montarIdentificadorCandidatoAgendado(candidato)}
                  >
                    ${`${candidato.nome_candidato || '-'} • ${formatarDataHora(candidato.data_entrevista)} • ${candidato.status_entrevista || 'Agendado'}`}
                  </option>
                `,
              )}
            </select>
            <div class="form-text">
              ${
                processoSelecionado
                  ? atualizandoCandidatoAgendado
                    ? 'Atualizando o status do candidato para Compareceu...'
                    : 'Ao selecionar um candidato agendado, o nome será preenchido automaticamente e a agenda operacional será atualizada para Compareceu.'
                  : 'Selecione um processo para listar os candidatos com entrevista agendada.'
              }
            </div>
          </div>

          ${formulario.processo === 'PROCESSO_UNICO'
            ? html`
                <div class="col-md-6">
                  <label class="form-label">Nome completo do candidato</label>
                  <input
                    class="form-control rh-flow-input"
                    value=${formulario.candidatoNome}
                    onInput=${(event) =>
                      setFormulario({
                        ...formulario,
                        candidatoNome: event.target.value,
                      })}
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">E-mail do candidato</label>
                  <input
                    class="form-control rh-flow-input"
                    type="email"
                    value=${formulario.candidatoEmail}
                    onInput=${(event) =>
                      setFormulario({
                        ...formulario,
                        candidatoEmail: event.target.value,
                      })}
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Telefone do candidato</label>
                  <input
                    class="form-control rh-flow-input"
                    inputmode="tel"
                    value=${formulario.candidatoTelefone}
                    onInput=${(event) =>
                      setFormulario({
                        ...formulario,
                        candidatoTelefone: event.target.value,
                      })}
                  />
                </div>
              `
            : null}

          <div class="col-md-6">
            <label class="form-label">Perfil da vaga</label>
            <select
              class="form-select rh-flow-input"
              value=${formulario.vaga}
              onChange=${(event) =>
                setFormulario((anterior) =>
                  aplicarConfiguracaoDaVaga(anterior, event.target.value))}
            >
              <option value="">Selecione...</option>
              ${OPCOES_VAGAS_PROVA.map(
                (opcao) => html`
                  <option key=${opcao.label} value=${opcao.label}>
                    ${opcao.label}
                  </option>
                `,
              )}
            </select>
          </div>

          <div class="col-md-6">
            <label class="form-label">Nível da prova</label>
            <select
              class="form-select rh-flow-input"
              value=${formulario.nivel}
              onChange=${(event) =>
                setFormulario({ ...formulario, nivel: event.target.value })}
            >
              <option value="">Selecione...</option>
              <option value="1">Nível 1 - Jovem Aprendiz</option>
              <option value="2">Nível 2 - Operador / Estagiário / Suporte Técnico Júnior</option>
              <option value="3">
                Nível 3 - Supervisor / Control Desk / Suporte Técnico Pleno
              </option>
              <option value="4">Nível 4 - Planejamento / Suporte Técnico Sênior / TI</option>
            </select>
          </div>

          <div class="col-md-6">
            <label class="form-label">Área / Trilha</label>
            <select
              class="form-select rh-flow-input"
              value=${formulario.trilha}
              onChange=${(event) =>
                setFormulario({ ...formulario, trilha: event.target.value })}
            >
              <option value="">Selecione...</option>
              ${OPCOES_TRILHAS_PROVA.map(
                (opcao) => html`
                  <option key=${opcao.value} value=${opcao.value}>
                    ${opcao.label}
                  </option>
                `,
              )}
            </select>
          </div>

          <div class="col-md-6">
            <label class="form-label">Tempo total (minutos)</label>
            <input
              class="form-control rh-flow-input"
              type="number"
              min="5"
              max="180"
              value=${formulario.tempo}
              onInput=${(event) =>
                setFormulario({ ...formulario, tempo: event.target.value })}
            />
          </div>
        </div>

        <div class="rh-flow-preview mt-4">
          <div class="rh-flow-preview-icon">
            <span class="material-symbols-outlined">${IconeSvg('info')}</span>
          </div>
          <div>
            <div class="fw-semibold mb-1">
              ${blueprint?.label || 'Fluxo que será aplicado'}
            </div>
            <div class="text-muted small">${montarDescricaoFluxo(blueprint)}</div>
          </div>
        </div>

        <div class="border rounded-2 p-3 mt-4 generated-personalization-box">
          <div class="d-flex align-items-start justify-content-between gap-3 flex-wrap">
            <label class="form-check m-0">
              <input
                class="form-check-input"
                type="checkbox"
                checked=${personalizacao.ativada}
                onChange=${(event) =>
                  setPersonalizacao({
                    ...personalizacao,
                    ativada: event.target.checked,
                    status: event.target.checked
                      ? STATUS_PERSONALIZACAO.PENDENTE
                      : STATUS_PERSONALIZACAO.NAO_PERSONALIZADA,
                    ...(!event.target.checked
                      ? {
                          operacao: '',
                          clientesOperacoes: [],
                          clienteOutro: '',
                          tiposAtendimento: [],
                          tipoAtendimentoOutro: '',
                          situacaoPratica: '',
                        }
                      : {}),
                    questoes: [],
                    alertas: [],
                    historico: null,
                  })}
              />
              <span class="form-check-label fw-semibold">
                Desejo personalizar esta prova por operação/cliente
              </span>
            </label>
            <span class="rh-status-pill">${personalizacao.status}</span>
          </div>
          <div class="form-text mt-2">
            Opcional. Desmarcado, o sistema gera uma prova padrão com base em vaga, área, nível, etapas e regras existentes.
          </div>

          ${personalizacao.ativada
            ? html`
                <div class="row g-3 mt-1">
                  <div class="col-md-6">
                    <label class="form-label">Cliente/Operação</label>
                    <select
                      class="form-select"
                      value=${primeiroValorLista(personalizacao.clientesOperacoes)}
                      onChange=${(event) =>
                        setPersonalizacao({
                          ...personalizacao,
                          clientesOperacoes: event.target.value ? [event.target.value] : [],
                          status: STATUS_PERSONALIZACAO.PENDENTE,
                          questoes: [],
                          alertas: [],
                          historico: null,
                        })}
                    >
                      <option value="">Selecione...</option>
                      ${[...OPCOES_OPERACOES, OPCAO_OUTRO].map(
                        (operacao) => html`
                          <option key=${operacao} value=${operacao}>
                            ${operacao}
                          </option>
                        `,
                      )}
                    </select>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Tipo de atendimento</label>
                    <select
                      class="form-select"
                      value=${primeiroValorLista(personalizacao.tiposAtendimento)}
                      onChange=${(event) =>
                        setPersonalizacao({
                          ...personalizacao,
                          tiposAtendimento: event.target.value ? [event.target.value] : [],
                          status: STATUS_PERSONALIZACAO.PENDENTE,
                          questoes: [],
                          alertas: [],
                          historico: null,
                        })}
                    >
                      <option value="">Selecione...</option>
                      ${TIPOS_ATENDIMENTO_PERSONALIZACAO.map(
                        (tipo) => html`
                          <option key=${tipo} value=${tipo}>
                            ${tipo}
                          </option>
                        `,
                      )}
                    </select>
                  </div>
                  ${personalizacao.clientesOperacoes.includes(OPCAO_OUTRO)
                    ? html`
                        <div class="col-md-6">
                          <label class="form-label">Outro cliente/operação</label>
                          <input
                            class="form-control"
                            value=${personalizacao.clienteOutro}
                            onInput=${(event) =>
                              setPersonalizacao({
                                ...personalizacao,
                                clienteOutro: event.target.value,
                                status: STATUS_PERSONALIZACAO.PENDENTE,
                                questoes: [],
                                alertas: [],
                                historico: null,
                              })}
                          />
                        </div>
                      `
                    : null}
                  ${personalizacao.tiposAtendimento.includes(OPCAO_OUTRO)
                    ? html`
                        <div class="col-md-6">
                          <label class="form-label">Outro tipo de atendimento</label>
                          <input
                            class="form-control"
                            value=${personalizacao.tipoAtendimentoOutro}
                            onInput=${(event) =>
                              setPersonalizacao({
                                ...personalizacao,
                                tipoAtendimentoOutro: event.target.value,
                                status: STATUS_PERSONALIZACAO.PENDENTE,
                                questoes: [],
                                alertas: [],
                                historico: null,
                              })}
                          />
                        </div>
                      `
                    : null}
                  <div class="col-md-6">
                    <label class="form-label">Nível de personalização</label>
                    <select
                      class="form-select"
                      value=${personalizacao.nivelPersonalizacao}
                      onChange=${(event) =>
                        setPersonalizacao({
                          ...personalizacao,
                          nivelPersonalizacao: event.target.value,
                          status: STATUS_PERSONALIZACAO.PENDENTE,
                          questoes: [],
                          alertas: [],
                          historico: null,
                        })}
                    >
                      ${NIVEIS_PERSONALIZACAO.map(
                        (nivel) => html`
                          <option key=${nivel.id} value=${nivel.id}>
                            ${nivel.label}: ${nivel.descricao}
                          </option>
                        `,
                      )}
                    </select>
                  </div>
                  <div class="col-md-12">
                    <label class="form-label">Situação prática da operação</label>
                    <textarea
                      class="form-control"
                      rows="2"
                      placeholder="Ex.: Paciente entra em contato com dúvida sobre agendamento e demonstra preocupação com o tratamento."
                      value=${personalizacao.situacaoPratica}
                      onInput=${(event) =>
                        setPersonalizacao({
                          ...personalizacao,
                          situacaoPratica: event.target.value,
                          status: STATUS_PERSONALIZACAO.PENDENTE,
                          questoes: [],
                          alertas: [],
                          historico: null,
                        })}
                    ></textarea>
                    <div class="form-text">
                      Opcional, mas recomendado. Ajuda a criar situações realistas sem transformar a prova em treinamento interno.
                    </div>
                  </div>
                </div>

                ${personalizacao.alertas.length
                  ? html`
                      <div class="alert alert-warning mt-3 mb-0">
                        ${personalizacao.alertas.slice(0, 3).join(' ')}
                      </div>
                    `
                  : null}
              `
            : null}
        </div>

        ${erro ? html`<div class="alert alert-danger mt-4">${erro}</div>` : null}

        <div class="rh-form-footer rh-form-footer--sticky">
          <button
            type="button"
            class="btn btn-outline-secondary"
            onClick=${() => controlador.irParaMenu()}
          >
            Voltar ao menu
          </button>
          <button
            type="button"
            class="btn btn-success btn-lg"
            onClick=${prosseguir}
          >
            Prosseguir
          </button>
        </div>
      </${SectionCard}>
    </${PainelRh}>
  `;
}

export function TelaCandidato({ controlador }) {
  const [nome, setNome] = useState(controlador.estado.candidato.name || '');
  const [email, setEmail] = useState(controlador.estado.candidato.email || '');
  const [whatsapp, setWhatsapp] = useState(
    controlador.estado.candidato.whatsapp || '',
  );
  const [erro, setErro] = useState('');
  const [salvandoContato, setSalvandoContato] = useState(false);
  const regrasCandidato = Array.isArray(controlador.regrasCandidato)
    ? controlador.regrasCandidato
    : [];

  useEffect(() => {
    setNome(controlador.estado.candidato.name || '');
    setEmail(controlador.estado.candidato.email || '');
    setWhatsapp(controlador.estado.candidato.whatsapp || '');
  }, [
    controlador.estado.candidato.name,
    controlador.estado.candidato.email,
    controlador.estado.candidato.whatsapp,
  ]);

  const iniciar = async () => {
    setSalvandoContato(true);
    setErro('');
    try {
      const dadosContato = { name: nome, email, whatsapp };
      controlador.atualizarDadosContatoCandidato(dadosContato);
      const confirmacao =
        await controlador.confirmarDadosContatoCandidato(dadosContato);
      if (!confirmacao.ok) {
        setErro(confirmacao.mensagem);
        return;
      }

      const resultado = controlador.iniciarProva(
        confirmacao.dados.name,
        confirmacao.dados,
      );
      if (!resultado.ok) {
        setErro(resultado.mensagem);
        return;
      }
    } catch (error) {
      setErro(
        error?.message ||
          'Não foi possível confirmar seus dados. Verifique as informações e tente novamente.',
      );
    } finally {
      setSalvandoContato(false);
    }
  };

  return html`
    <section class="active screen" id="screen-candidate">
      <div class="rh-standalone-page">
        <div class="rh-candidate-layout">
          <aside class="rh-candidate-side-card">
            <h2 class="h5 fw-bold mb-2">Confirme seus dados</h2>
            <p class="text-muted small mb-3">
              Nome, e-mail e WhatsApp serão usados pelo RH para identificar sua
              prova e acompanhar o processo seletivo.
            </p>
            <label
              class="form-label small text-uppercase fw-bold text-muted mb-2"
            >
              Nome completo
            </label>
            <div class="rh-candidate-name-shell">
              <input
                class="form-control rh-flow-input"
                placeholder="Ex: João Augusto da Silva"
                value=${nome}
                onInput=${(event) => {
                  setNome(event.target.value);
                  controlador.atualizarDadosContatoCandidato({
                    name: event.target.value,
                    email,
                    whatsapp,
                  });
                }}
                type="text"
              />
              <span class="material-symbols-outlined">${IconeSvg('badge')}</span>
            </div>

            <div class="rh-candidate-contact-grid">
              <div>
                <label
                  class="form-label small text-uppercase fw-bold text-muted mb-2"
                >
                  E-mail
                </label>
                <input
                  class="form-control rh-flow-input"
                  placeholder="nome@email.com"
                  value=${email}
                  onInput=${(event) => {
                    setEmail(event.target.value);
                    controlador.atualizarDadosContatoCandidato({
                      name: nome,
                      email: event.target.value,
                      whatsapp,
                    });
                  }}
                  type="email"
                />
              </div>
              <div>
                <label
                  class="form-label small text-uppercase fw-bold text-muted mb-2"
                >
                  WhatsApp
                </label>
                <input
                  class="form-control rh-flow-input"
                  placeholder="(11) 99999-9999"
                  value=${whatsapp}
                  onInput=${(event) => {
                    setWhatsapp(event.target.value);
                    controlador.atualizarDadosContatoCandidato({
                      name: nome,
                      email,
                      whatsapp: event.target.value,
                    });
                  }}
                  type="tel"
                />
              </div>
            </div>

            <div class="rh-candidate-summary-card mt-4">
              <h3 class="h6 fw-bold mb-3">Etapas e critérios</h3>
              <ul class="candidate-summary-list">
                ${regrasCandidato.map(
                  (item) => html`
                    <li key=${item.key}>
                      <strong>${item.label}</strong>
                      <span>${item.description}</span>
                    </li>
                  `,
                )}
              </ul>
            </div>
          </aside>

          <section class="rh-candidate-main-card">
            <h2 class="h3 fw-bold mb-2">Instruções ao candidato</h2>
            <p class="text-muted mb-4">
              Leia atentamente as orientações antes de iniciar a prova.
            </p>

            <div class="rh-instruction-grid">
              <article class="rh-instruction-card">
                <h3>Antes de começar</h3>
                <ul class="rules-list">
                  <li>
                    Confira se nome, e-mail e WhatsApp estão corretos antes de
                    iniciar a avaliação.
                  </li>
                  <li>
                    Leia todas as orientações da tela e siga somente as instruções passadas pelo
                    responsável do RH.
                  </li>
                  <li>
                    Mantenha aberto apenas o que for necessário para realizar a prova. Evite
                    abas, arquivos ou consultas que não tenham sido autorizados.
                  </li>
                  <li>
                    Em exercícios de Excel, baixe o arquivo base, edite a sua própria cópia e
                    envie a versão respondida quando solicitado.
                  </li>
                  <li>
                    Em exercícios de texto, responda com clareza, organização e cuidado com
                    ortografia, pontuação e formatação.
                  </li>
                  <li>
                    O cronômetro será iniciado ao começar a prova. Organize seu tempo antes de
                    avançar.
                  </li>
                  <li>
                    Caso perceba qualquer problema técnico antes do início, avise o responsável
                    pela aplicação imediatamente.
                  </li>
                </ul>
              </article>
              <article class="rh-instruction-card">
                <h3>Durante a prova</h3>
                <ul class="rules-list">
                  <li>
                    Responda com atenção: algumas questões avaliam conhecimento, outras avaliam
                    raciocínio, escrita, organização e prática.
                  </li>
                  <li>
                    O tempo de prova é controlado pelo sistema. Ao finalizar o prazo, a
                    avaliação poderá ser encerrada pelo responsável.
                  </li>
                  <li>
                    Não atualize a página, não feche o navegador e não utilize o botão voltar do
                    navegador durante a avaliação.
                  </li>
                  <li>
                    Salve ou anexe os arquivos solicitados somente nos campos indicados. Arquivos
                    enviados fora do local correto podem não ser considerados.
                  </li>
                  <li>
                    Em questões práticas, organize o material como faria em uma rotina real de
                    trabalho: nomeie, formate e revise antes de concluir.
                  </li>
                  <li>
                    Se houver travamento, queda de energia, erro no arquivo ou outra dificuldade
                    técnica, comunique imediatamente o responsável pela aplicação.
                  </li>
                  <li>
                    Ao terminar, revise o que for possível e finalize somente quando tiver
                    certeza de que deseja encerrar a avaliação.
                  </li>
                  <li>
                    Depois da finalização, o resultado ficará disponível apenas para análise
                    interna do RH.
                  </li>
                </ul>
              </article>
            </div>

            ${
              erro
                ? html`<div class="alert alert-danger mt-4">${erro}</div>`
                : null
            }

            <div class="rh-candidate-footer">
              <div class="rh-candidate-disclaimer">
                <span class="material-symbols-outlined">${IconeSvg('info')}</span>
                <span>
                  Ao iniciar, você confirma seus dados de contato e concorda
                  com as orientações da avaliação.
                </span>
              </div>
              <div class="d-flex gap-2 flex-wrap">
                <button
                  type="button"
                  class="btn btn-outline-secondary"
                  onClick=${() =>
                    controlador.irParaTelaProtegida('screen-config')}
                >
                  Voltar
                </button>
                <button
                  type="button"
                  class="btn btn-success btn-lg"
                  onClick=${iniciar}
                  disabled=${salvandoContato}
                >
                  ${salvandoContato ? 'Confirmando...' : 'Confirmar e iniciar prova'}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  `;
}

function respostaPossuiConteudo(questao, resposta) {
  const tipo = questao?.type;
  if (tipo === 'multiple') {
    return resposta?.selected !== null && resposta?.selected !== undefined && resposta?.selected !== '';
  }
  if (tipo === 'compact_choice_group') {
    const itens = Array.isArray(questao?.items)
      ? questao.items
      : Array.isArray(questao?.itens)
        ? questao.itens
        : [];
    const selecoes = resposta?.selections || {};
    return (
      itens.length > 0 &&
      itens.every((item) => {
        const chave = String(item.id || '');
        return selecoes[chave] !== null && selecoes[chave] !== undefined;
      })
    );
  }
  if (tipo === 'excel_external') {
    return Boolean(resposta?.uploaded && resposta?.filename);
  }
  if (tipo === 'word') {
    const texto = String(resposta?.content || resposta?.text || '')
      .replace(/<[^>]*>/g, '')
      .trim();
    return texto.length > 0;
  }
  return Boolean(resposta);
}

export function TelaProva({ controlador }) {
  const [confirmarEncerramento, setConfirmarEncerramento] = useState(false);
  const [confirmarExcelAusente, setConfirmarExcelAusente] = useState(null);
  const [confirmarFinalizacao, setConfirmarFinalizacao] = useState(false);
  const [erroFinalizacao, setErroFinalizacao] = useState('');
  const indiceAtual = controlador.estado.indiceAtual;
  const questaoAtual = controlador.estado.questoes[indiceAtual];
  const respostaAtual = controlador.estado.respostas[indiceAtual] || null;

  useEffect(() => {
    if (
      controlador.estado.provaFinalizada &&
      controlador.estado.modoFinalizacao === 'desistencia'
    ) {
      controlador.exigirNovoLogin();
    }
  }, [controlador.estado.provaFinalizada, controlador.estado.modoFinalizacao]);

  if (!questaoAtual) {
    return html`
      <section class="active screen" id="screen-exam">
        <div class="container py-5">
          <div class="alert alert-warning mb-0">
            Nenhuma questão foi carregada para esta prova.
          </div>
        </div>
      </section>
    `;
  }

  const progresso =
    ((indiceAtual + 1) / Math.max(1, controlador.estado.questoes.length)) * 100;

  const estagiosProva = Array.from(
    new Set(controlador.estado.questoes.map((item) => item?.stage || 'Etapa')),
  );
  const estagioAtualIndice = estagiosProva.indexOf(questaoAtual.stage || 'Etapa');
  const numeroEstagioAtual = estagioAtualIndice >= 0 ? estagioAtualIndice + 1 : null;
  const estagiosConcluidos = numeroEstagioAtual ? numeroEstagioAtual - 1 : 0;
  const questoesRespondidas = controlador.estado.questoes.filter((item, indice) =>
    respostaPossuiConteudo(item, controlador.estado.respostas[indice]),
  ).length;

  const voltar = () => {
    if (indiceAtual > 0) {
      controlador.definirIndiceAtual(indiceAtual - 1);
    }
  };

  const confirmarEnvioFinal = () => {
    setConfirmarFinalizacao(false);
    const resultado = controlador.encerrarProva('Finalizado');
    if (!resultado?.ok) {
      if (resultado?.tipo === 'excel_nao_enviado') {
        setConfirmarExcelAusente(resultado);
        setErroFinalizacao('');
        return;
      }
      setErroFinalizacao(
        resultado?.mensagem ||
          'Não foi possível finalizar a prova com as respostas atuais.',
      );
      return;
    }

    setErroFinalizacao('');
  };

  const avancar = () => {
    if (indiceAtual < controlador.estado.questoes.length - 1) {
      setErroFinalizacao('');
      controlador.definirIndiceAtual(indiceAtual + 1);
      return;
    }

    setErroFinalizacao('');
    setConfirmarFinalizacao(true);
  };

  const atualizarRespostaDiscursiva = (conteudo) => {
    setErroFinalizacao('');
    controlador.atualizarResposta(indiceAtual, {
      type: 'word',
      content: conteudo,
    });
  };

  const atualizarRespostaObjetiva = (selected) => {
    setErroFinalizacao('');
    controlador.atualizarResposta(indiceAtual, {
      type: 'multiple',
      selected,
    });
  };

  const atualizarRespostaGrupoCompacto = (resposta) => {
    setErroFinalizacao('');
    controlador.atualizarResposta(indiceAtual, resposta);
  };

  return html`
    <section class="active screen" id="screen-exam">
      <${ModalPadrao}
        aberto=${confirmarEncerramento}
        titulo="Confirmar encerramento"
        subtitulo="Ao encerrar a prova agora, o candidato será marcado como Desistente e eliminado do processo. Deseja continuar?"
        onClose=${() => setConfirmarEncerramento(false)}
      >
        <div class="rh-details-body">
          <div class="alert alert-warning mb-0">
            Ao confirmar, não será exigido Excel nem conclusão das etapas restantes.
          </div>
        </div>
        <footer class="rh-modal-footer">
          <button
            type="button"
            class="btn btn-outline-secondary"
            onClick=${() => setConfirmarEncerramento(false)}
          >
            Continuar prova
          </button>
          <button
            type="button"
            class="btn btn-danger"
            onClick=${() => {
              setConfirmarEncerramento(false);
              const resultado = controlador.encerrarProva(
                'Desistente',
                { modo: 'desistencia' },
              );
              if (!resultado?.ok) {
                setErroFinalizacao(
                  resultado?.mensagem ||
                    'Não foi possível encerrar a prova com as respostas atuais.',
                );
                return;
              }
              setErroFinalizacao('');
            }}
          >
            Encerrar prova
          </button>
        </footer>
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${!!confirmarExcelAusente}
        titulo="Excel não enviado"
        subtitulo="A etapa de Excel pode ser finalizada com nota zero se o candidato decidir continuar."
        onClose=${() => setConfirmarExcelAusente(null)}
      >
        <div class="rh-details-body">
          <div class="alert alert-warning mb-0">
            Você ainda não enviou a prova de Excel. Essa etapa receberá nota zero e impactará sua nota final. Deseja finalizar mesmo assim?
          </div>
        </div>
        <footer class="rh-modal-footer">
          <button
            type="button"
            class="btn btn-outline-secondary"
            onClick=${() => {
              setConfirmarExcelAusente(null);
              const indiceExcel = Number(confirmarExcelAusente?.indice);
              if (!Number.isNaN(indiceExcel)) {
                controlador.definirIndiceAtual(indiceExcel);
              }
            }}
          >
            Voltar e enviar Excel
          </button>
          <button
            type="button"
            class="btn btn-primary"
            onClick=${() => {
              setConfirmarExcelAusente(null);
              const resultado = controlador.encerrarProva('Finalizado', {
                permitirExcelZero: true,
              });
              if (!resultado?.ok) {
                setErroFinalizacao(
                  resultado?.mensagem ||
                    'Não foi possível finalizar a prova com as respostas atuais.',
                );
                return;
              }
              setErroFinalizacao('');
            }}
          >
            Finalizar mesmo assim
          </button>
        </footer>
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${confirmarFinalizacao}
        titulo="Confirmar envio da prova"
        subtitulo=${`Você respondeu ${questoesRespondidas} de ${controlador.estado.questoes.length} questões.`}
        onClose=${() => setConfirmarFinalizacao(false)}
      >
        <div class="rh-details-body">
          <div class="alert alert-info mb-0">
            Após confirmar o envio, não será possível alterar as respostas. Revise antes de enviar.
          </div>
        </div>
        <footer class="rh-modal-footer">
          <button
            type="button"
            class="btn btn-outline-secondary"
            onClick=${() => setConfirmarFinalizacao(false)}
          >
            Revisar respostas
          </button>
          <button
            type="button"
            class="btn btn-primary"
            onClick=${confirmarEnvioFinal}
          >
            Confirmar e enviar
          </button>
        </footer>
      </${ModalPadrao}>

      <div class="exam-screen-shell">
        <header class="exam-screen-header">
          <div class="exam-screen-header-inner">
            <div class="exam-screen-brand">
              <img
                alt="Central 24h"
                class="exam-screen-logo"
                src="/estilos/logo_conecta_padrao.png"
              />
              <div class="exam-screen-brand-copy">
                <span class="exam-screen-caption">Prova em andamento</span>
                <div class="exam-screen-candidate">
                  Candidato:
                  <strong>${controlador.estado.candidato.name || ''}</strong>
                </div>
              </div>
            </div>

            <div class="exam-screen-toolbar">
              <span class="exam-stage-badge">${questaoAtual.stage}</span>
              <div class="exam-timer-shell">
                <span class="material-symbols-outlined">${IconeSvg('timer')}</span>
                <div>${formatarTempoRestante(controlador.estado.segundosRestantes)}</div>
              </div>
            </div>
          </div>

          <div class="exam-progress-track">
            <div
              class="exam-progress-fill"
              style=${{ width: `${progresso}%` }}
            ></div>
          </div>
          <div class="exam-progress-meta">
            <span>${numeroEstagioAtual ? `Etapa ${numeroEstagioAtual} de ${estagiosProva.length}` : 'Prova em andamento'}</span>
            <span>${estagiosConcluidos} de ${estagiosProva.length} etapas concluídas</span>
          </div>
        </header>

        <div class="exam-screen-content">
          <div class="exam-question-card">
            <span class="exam-question-kicker">
              ${`Questão ${indiceAtual + 1} de ${controlador.estado.questoes.length}`}
            </span>
            <h3 class="exam-question-title">${questaoAtual.title}</h3>
            <${DescricaoQuestao} questao=${questaoAtual} />
          </div>

          <div class="exam-dynamic-area">
            ${
              questaoAtual.type === 'word'
                ? html`
                    <${EditorTextoRich}
                      valor=${respostaAtual?.content || ''}
                      onChange=${atualizarRespostaDiscursiva}
                    />
                  `
                : null
            }
            ${
              questaoAtual.type === 'multiple'
                ? html`
                    <${PerguntaMultipla}
                      questao=${questaoAtual}
                      resposta=${respostaAtual}
                      onChange=${atualizarRespostaObjetiva}
                    />
                  `
                : null
            }
            ${
              questaoAtual.type === 'compact_choice_group'
                ? html`
                    <${PerguntaGrupoCompacto}
                      questao=${questaoAtual}
                      resposta=${respostaAtual}
                      onChange=${atualizarRespostaGrupoCompacto}
                    />
                  `
                : null
            }
            ${
              questaoAtual.type === 'excel_external'
                ? html`
                    <${PerguntaExcel}
                      questao=${questaoAtual}
                      resposta=${respostaAtual}
                      nomeCandidato=${controlador.estado.candidato.name}
                      onChange=${(resposta) => {
                        setErroFinalizacao('');
                        controlador.atualizarResposta(indiceAtual, resposta);
                      }}
                    />
                  `
                : null
            }
          </div>
        </div>

        ${
          erroFinalizacao
            ? html`
                <div class="container pb-3">
                  <div class="alert alert-danger mb-0">${erroFinalizacao}</div>
                </div>
              `
            : null
        }

        <footer class="exam-screen-footer">
          <div class="exam-screen-footer-actions">
            <button
              type="button"
              class="btn exam-nav-btn exam-nav-btn-secondary"
              disabled=${indiceAtual === 0}
              onClick=${voltar}
            >
              Anterior
            </button>
          </div>

          <div class="exam-screen-footer-actions">
            <button
              type="button"
              class="btn exam-nav-btn exam-nav-btn-danger"
              onClick=${() => {
                setErroFinalizacao('');
                setConfirmarEncerramento(true);
              }}
            >
              Encerrar agora
            </button>
            <button
              type="button"
              class="btn exam-nav-btn exam-nav-btn-primary"
              onClick=${avancar}
            >
              ${
                indiceAtual === controlador.estado.questoes.length - 1
                  ? 'Finalizar'
                  : 'Proxima'
              }
            </button>
          </div>
        </footer>
      </div>
    </section>
  `;
}

export function TelaConclusao({ controlador }) {
  const [alertaSalvar, setAlertaSalvar] = useState('');
  const [tipoSalvar, setTipoSalvar] = useState('info');
  const [acaoRestrita, setAcaoRestrita] = useState(null);
  const modoDesistencia = controlador.estado.modoFinalizacao === 'desistencia';

  useEffect(() => {
    if (controlador.estado.resultadoSalvo) {
      setTipoSalvar('success');
      setAlertaSalvar('Resultado salvo com sucesso.');
    }
  }, [controlador.estado.resultadoSalvo]);

  useEffect(() => {
    if (modoDesistencia && !controlador.estado.resultadoSalvo && !controlador.estado.salvandoResultado) {
      salvar();
    }
  }, [modoDesistencia, controlador.estado.resultadoSalvo, controlador.estado.salvandoResultado]);

  const salvar = async () => {
    setTipoSalvar('info');
    setAlertaSalvar('Salvando resultado no sistema...');

    const retorno = await controlador.salvarResultado();
    if (!retorno?.ok) {
      setTipoSalvar('danger');
      setAlertaSalvar(
        retorno?.mensagem ||
          'Não foi possível salvar a prova no servidor. Verifique a API e tente novamente.',
      );
      return;
    }

    setTipoSalvar('success');
    setAlertaSalvar('Resultado salvo com sucesso.');
  };

  const acessarResultado = () => {
    setAcaoRestrita({
      descricao: 'Confirme as credenciais para abrir o resultado detalhado.',
      executar: () => navegarParaTela('screen-result'),
    });
  };

  const retornarMenu = () => {
    setAcaoRestrita({
      descricao: 'Confirme as credenciais para retornar ao menu interno do RH.',
      executar: () => controlador.irParaMenu(),
    });
  };

  return html`
    <section class="active screen" id="screen-thanks">
      <${ModalAcessoAdministrativo}
        aberto=${!!acaoRestrita}
        acao=${acaoRestrita?.descricao || ''}
        controlador=${controlador}
        onClose=${() => setAcaoRestrita(null)}
        onLiberado=${() => {
          const executar = acaoRestrita?.executar;
          setAcaoRestrita(null);
          if (typeof executar === 'function') {
            window.setTimeout(executar, 0);
          }
        }}
      />
      <div class="rh-finish-screen">
        <div class="rh-finish-shell">
          <div class="rh-finish-badge">${modoDesistencia ? 'Desistente' : 'Concluído'}</div>
          <!-- <div class="rh-finish-icon-wrap">
            <div class="rh-finish-icon">OK</div>
          </div> -->
          <h2 class="rh-finish-title">
            ${modoDesistencia
              ? 'Prova encerrada antes da conclusão.'
              : 'Avaliação finalizada com sucesso!'}
          </h2>
          <p class="rh-finish-subtitle">
            ${modoDesistencia
              ? 'Candidato marcado como Desistente e eliminado do processo.'
              : 'A prova foi encerrada e o resultado pode ser salvo no sistema para registro definitivo.'}
          </p>

          <div class="rh-finish-info-grid">
            <article
              class="rh-finish-info-card rh-finish-info-card-save is-required"
            >
              <div class="rh-finish-info-icon is-blue">
                <span class="material-symbols-outlined">${IconeSvg('task_alt')}</span>
              </div>
              <h3>${modoDesistencia ? 'Registro de desistência' : 'Finalização obrigatória'}</h3>
              <p>
                ${modoDesistencia
                  ? 'A desistência está sendo registrada sem exigir entrega de Excel ou etapas pendentes.'
                  : 'Para concluir corretamente esta avaliação, é obrigatório salvar o resultado no sistema.'}
              </p>
              <br />
              <button
                type="button"
                class="btn rh-finish-save-btn"
                disabled=${controlador.estado.salvandoResultado ||
                controlador.estado.resultadoSalvo}
                onClick=${salvar}
              >
                ${controlador.estado.salvandoResultado
                  ? 'Salvando...'
                  : controlador.estado.resultadoSalvo
                    ? 'Resultado salvo'
                    : modoDesistencia
                      ? 'Registrar desistência'
                      : 'Salvar resultado'}
              </button>
            </article>

            <article class="rh-finish-info-card is-soft">
              <div class="rh-finish-info-icon is-gold">
                <span class="material-symbols-outlined">${IconeSvg('trending_up')}</span>
              </div>
              <h3>${modoDesistencia ? 'Acesso bloqueado' : 'Próximos passos'}</h3>
              <p>
                ${modoDesistencia
                  ? 'Para voltar, abrir resultado ou retornar ao menu, será necessário informar login e senha novamente.'
                  : 'O RH receberá o registro salvo e poderá continuar a análise do candidato nas telas de gestão.'}
              </p>
            </article>
          </div>

          ${alertaSalvar
            ? html`
                <div class=${`alert rh-finish-alert alert-${tipoSalvar} mt-3`}>
                  ${alertaSalvar}
                </div>
              `
            : null}

          <div class="d-flex justify-content-center mt-3 no-print">
            <button
              type="button"
              class="btn btn-outline-secondary"
              onClick=${retornarMenu}
            >
              Retornar ao menu
            </button>
          </div>

          <div class="rh-finish-access-card no-print">
            <div class="rh-finish-access-icon">
              <span class="material-symbols-outlined">${IconeSvg('lock')}</span>
            </div>
            <div class="rh-finish-access-title">Acesso restrito RH</div>
            <p class="rh-finish-access-text">
              O resultado detalhado permanece restrito a usuários autenticados
              no sistema.
            </p>
            <button
              type="button"
              class="btn rh-finish-access-btn"
              onClick=${acessarResultado}
            >
              Abrir resultado
            </button>
          </div>
        </div>
      </div>
    </section>
  `;
}

export function TelaResultado({ controlador }) {
  const estado = controlador.estado;
  const dataGeracao = new Date().toLocaleString('pt-BR');
  const identificador = estado.idResultadoAtual || 'Não salvo';
  const linhasInformacoesCandidato = montarLinhasInformacoesCandidato(estado.candidato);
  const competenciasObservadas = montarCompetenciasObservadas(estado.resumoEtapas);
  const aderenciaVaga = obterAderenciaVagaImpressao(
    estado.candidato,
    estado.notaFinalPonderada,
  );
  const nomeCandidato = obterValorCandidato(estado.candidato, ['name', 'nome_candidato', 'nome']) || '-';
  const [acaoRestrita, setAcaoRestrita] = useState(null);

  return html`
    <section class="active screen" id="screen-result">
      <${ModalAcessoAdministrativo}
        aberto=${!!acaoRestrita}
        acao=${acaoRestrita?.descricao || ''}
        controlador=${controlador}
        onClose=${() => setAcaoRestrita(null)}
        onLiberado=${() => {
          const executar = acaoRestrita?.executar;
          setAcaoRestrita(null);
          if (typeof executar === 'function') {
            window.setTimeout(executar, 0);
          }
        }}
      />
      <div class="rh-result-screen">
        <aside class="rh-result-sidebar no-print">
          <div class="rh-result-sidebar-title">
            <span class="material-symbols-outlined">${IconeSvg('assignment_turned_in')}</span>
            <div>
              <strong>Avaliação técnica</strong>
              <span>${`ID: ${identificador}`}</span>
            </div>
          </div>
          <nav class="rh-result-nav">
            <button type="button" class="rh-result-nav-btn is-active">
              Pontuação
            </button>
          </nav>
          <button
            type="button"
            class="btn rh-result-export-btn"
            onClick=${() => window.print()}
          >
            Imprimir resultado
          </button>
        </aside>

        <div class="rh-result-main">
          <div class="rh-result-topnav no-print">
            <div class="rh-result-topnav-links">
              <span class="is-active">Avaliações</span>
            </div>
            <div class="rh-result-topnav-actions">
              <button
                type="button"
                class="btn btn-primary"
                onClick=${() => controlador.baixarPacoteAtual()}
              >
                Baixar prova
              </button>
              <button
                type="button"
                class="btn btn-outline-secondary"
                onClick=${() =>
                  setAcaoRestrita({
                    descricao: 'Confirme as credenciais para voltar ao menu interno do RH.',
                    executar: () => controlador.irParaMenu(),
                  })}
              >
                Menu principal
              </button>
            </div>
          </div>

          <div class="rh-result-content card app-card">
            <div class="card-body p-4">
              <div class="print-page">
                <div class="rh-result-header">
                  <div>
                    <h2 class="rh-result-title">Resultado da avaliação</h2>
                    <p class="rh-result-subtitle">
                      Relatório consolidado em ${dataGeracao}
                    </p>
                  </div>
                  <span class="rh-result-status-badge no-print">
                    ${estado.statusFinalizacao || 'Finalizado'}
                  </span>
                </div>

                <div class="rh-result-summary-grid">
                  <div class="rh-result-candidate-card">
                    <div class="rh-result-candidate-name">
                      ${estado.candidato.name || '-'}
                    </div>
                    <div class="rh-result-candidate-role">
                      ${estado.candidato.role || '-'}
                    </div>
                    <div class="rh-result-candidate-meta">
                      <span class="rh-result-meta-pill">${`ID ${identificador}`}</span>
                      <span class="rh-result-meta-pill">
                        ${`${estado.candidato.level || '-'} • ${controlador.blueprint?.label || '-'}`}
                      </span>
                      <span class="rh-result-meta-pill">
                        ${estado.candidato.id_processo || 'Processo individual'}
                      </span>
                    </div>
                  </div>
                  <div class="rh-result-score-card">
                    <div class="rh-result-score-label">Nota final</div>
                    <div class="rh-result-score-value">
                      ${formatarNotaVisual(estado.notaFinalPonderada, 2)}
                    </div>
                  </div>
                </div>

                <div class="rh-result-body-grid">
                  <section class="rh-result-stage-panel">
                    <div class="rh-result-panel-head">
                      <h3>Pontuação por etapa</h3>
                      <span>Peso total: 100%</span>
                    </div>
                    <div class="rh-stage-grid">
                      ${(estado.resumoEtapas || []).map(
                        (etapa) => html`
                          <article
                            key=${etapa.key}
                            class="rh-stage-result-card"
                          >
                            <div class="rh-stage-result-top">
                              <div class="text-muted">${etapa.label}</div>
                              <span class="weight-badge"
                                >${`Peso ${etapa.weight}%`}</span
                              >
                            </div>
                            <strong
                              >${`${etapa.questionCount} item(ns) avaliados`}</strong
                            >
                            <div
                              class=${`stage-card-score ${obterClasseEtapaResultado(etapa.percent)}`}
                            >
                              ${`${etapa.rawScore}/${etapa.rawMax}`}
                            </div>
                            <div class="small text-muted mt-1">
                              ${`Aproveitamento: ${formatarNotaVisual(
                                Number(etapa.percent || 0) * 100,
                                1,
                              )}% • Nota ponderada: ${formatarNotaVisual(
                                etapa.weightedScore,
                                2,
                              )}`}
                            </div>
                            ${etapa.pendings
                              ? html`
                                  <div class="small text-muted mt-2">
                                    ${`Pendências de revisão: ${etapa.pendings}`}
                                  </div>
                                `
                              : null}
                          </article>
                        `,
                      )}
                    </div>
                  </section>

                  <aside class="rh-result-side-stack">
                    <${SectionCard}
                      title="Observações do RH"
                      className="rh-section-card--flat"
                    >
                      <textarea
                        class="form-control"
                        rows="7"
                        placeholder="Digite observações sobre desempenho, postura, tempo, comportamento, pontos fortes e pontos de atenção."
                        value=${estado.observacaoRh || ''}
                        onInput=${(event) =>
                          controlador.atualizarObservacaoRh(event.target.value)}
                      ></textarea>
                    </${SectionCard}>

                    <${SectionCard}
                      title="Pendências"
                      className="rh-section-card--flat"
                    >
                      ${
                        (estado.pendenciasManuais || []).length
                          ? html`
                              <div class="rh-result-pending-list">
                                ${(estado.pendenciasManuais || []).map(
                                  (item, indice) => html`
                                    <div key=${indice} class="mb-3">
                                      <strong>
                                        ${item.title ||
                                        item.q?.title ||
                                        'Item para revisao'}
                                      </strong>
                                      ${item.completedTasks?.length
                                        ? html`
                                            <div class="small text-muted mt-2">
                                              ${item.completedTasks.map(
                                                (linha, indiceLinha) => html`
                                                  <div key=${indiceLinha}>
                                                    ${linha}
                                                  </div>
                                                `,
                                              )}
                                            </div>
                                          `
                                        : null}
                                      ${item.answerKey?.length
                                        ? html`
                                            <div class="small text-muted mt-2">
                                              ${item.answerKey.map(
                                                (linha, indiceLinha) => html`
                                                  <div key=${indiceLinha}>
                                                    ${linha}
                                                  </div>
                                                `,
                                              )}
                                            </div>
                                          `
                                        : null}
                                      ${item.notes?.length
                                        ? html`
                                            <div class="small text-muted mt-2">
                                              ${item.notes.map(
                                                (linha, indiceLinha) => html`
                                                  <div key=${indiceLinha}>
                                                    ${linha}
                                                  </div>
                                                `,
                                              )}
                                            </div>
                                          `
                                        : null}
                                    </div>
                                  `,
                                )}
                              </div>
                            `
                          : html`
                              <${EmptyState}
                                title="Sem pendências"
                                text="Não há pendências de revisão registradas para esta prova."
                              />
                            `
                      }
                    </${SectionCard}>
                  </aside>
                </div>

                <${SectionCard}
                  title="Resumo complementar"
                  className="rh-section-card--flat"
                >
                  <${MetricGrid}
                    items=${[
                      {
                        label: 'Pontuação bruta',
                        value: `${estado.totalScore}/${estado.totalMax}`,
                      },
                      {
                        label: 'Etapas avaliadas',
                        value: (estado.resumoEtapas || []).length,
                      },
                      {
                        label: 'Status final',
                        value: estado.statusFinalizacao || 'Finalizado',
                      },
                    ]}
                  />
                </${SectionCard}>
              </div>

              <div class="print-only-result">
                <article class="print-candidate-sheet">
                  <header class="print-candidate-header">
                    <div>
                      <span class="print-candidate-kicker">Relatório de avaliação</span>
                      <h1>${nomeCandidato}</h1>
                    </div>
                    <div class="print-candidate-issued">
                      <strong>Conecta Provas</strong>
                      <span>${dataGeracao}</span>
                    </div>
                  </header>

                  <section class="print-candidate-section">
                    <h2>Informações gerais</h2>
                    ${linhasInformacoesCandidato.length
                      ? html`
                          <div class="print-candidate-info-grid">
                            ${linhasInformacoesCandidato.map(
                              (campo) => html`
                                <div class="print-candidate-info" key=${campo.label}>
                                  <span>${campo.label}</span>
                                  <strong>${campo.value}</strong>
                                </div>
                              `,
                            )}
                          </div>
                        `
                      : html`<div class="print-candidate-empty">Dados complementares não informados.</div>`}
                  </section>

                  <section class="print-candidate-section print-candidate-results">
                    <div class="print-candidate-results-head">
                      <h2>Resultados</h2>
                      <div>
                        <span>Nota geral</span>
                        <strong>${formatarNotaVisual(estado.notaFinalPonderada, 2)}</strong>
                      </div>
                    </div>
                    ${(estado.resumoEtapas || []).length
                      ? html`
                          <table class="print-candidate-results-table">
                            <thead>
                              <tr>
                                <th>Etapa</th>
                                <th>Status</th>
                                <th>Nota</th>
                                <th>Peso</th>
                                <th>Resultado</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${(estado.resumoEtapas || []).map(
                                (etapa) => html`
                                  <tr key=${etapa.key}>
                                    <td>${etapa.label || '-'}</td>
                                    <td>${obterStatusEtapaImpressao(etapa)}</td>
                                    <td>${formatarNotaVisual(etapa.weightedScore, 2)}</td>
                                    <td>${formatarNotaVisual(etapa.weight, 0)}%</td>
                                    <td>${`${etapa.rawScore ?? 0}/${etapa.rawMax ?? 0} • ${formatarNotaVisual(obterPercentualEtapaImpressao(etapa), 0)}%`}</td>
                                  </tr>
                                `,
                              )}
                            </tbody>
                          </table>
                        `
                      : html`<div class="print-candidate-empty">Não há etapas avaliadas para esta prova.</div>`}
                    <div class="print-candidate-adherence">
                      <span>Aderência à vaga</span>
                      <strong>${aderenciaVaga}</strong>
                    </div>
                  </section>

                  <section class="print-candidate-section print-candidate-competencies">
                    <h2>Competências observadas</h2>
                    <ul>
                      ${(competenciasObservadas.length
                        ? competenciasObservadas
                        : ['Sem competências consolidadas para esta prova.']).map(
                        (competencia) => html`<li key=${competencia}>${competencia}</li>`,
                      )}
                    </ul>
                  </section>

                  <section class="print-candidate-section">
                    <h2>Observação do RH</h2>
                    <div class="print-candidate-observation">${(estado.observacaoRh || '').trim()}</div>
                  </section>
                </article>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}
