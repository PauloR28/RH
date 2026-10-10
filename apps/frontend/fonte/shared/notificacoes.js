import { useEffect, useState } from '../infraestrutura-react.js';
import {
  lerProcessos,
  lerEntrevistas,
  lerCandidatosProcessos,
  listarSolicitacoesAlteracaoEmailApi,
} from '../app/controlador-aplicacao.js';
import {
  excluirTodasNotificacoes,
  listarNotificacoes,
  marcarNotificacaoLida,
  obterEstadoNotificacoesUsuario,
  registrarEstadoNotificacoesUsuario,
} from '../services/api/notifications.js?v=20260927-estado-usuario';
import { listarOperacoes } from '../services/api/operations.js';
import { listarUsuarios } from '../services/api/settings.js';
import { lerSessaoAutenticacao } from '../services/api/core.js';

import { AREA_SUPORTE_TI, AREA_TREINAMENTOS, areaAtiva } from './areas.js';

export const CATEGORIAS_NOTIFICACAO = [
  {
    id: 'entrevistas',
    label: 'Entrevistas e Banco de Talentos',
    cor: '#f89501',
    descricao: 'Avisos de entrevistas agendadas para os próximos dias e movimentações no banco de talentos.',
  },
  {
    id: 'processos',
    label: 'Processos Seletivos',
    cor: '#053c6c',
    descricao: 'Abertura, atualização e encerramento de vagas e processos seletivos.',
  },
  {
    id: 'provas',
    label: 'Provas',
    cor: '#3f9a23',
    descricao: 'Provas geradas, respondidas ou aguardando correção.',
  },
  {
    id: 'problemas',
    label: 'Problemas',
    cor: '#f80101',
    descricao: 'Pendências e alertas que precisam da sua atenção, como candidatos travados numa etapa.',
  },
  {
    id: 'administracao',
    label: 'Administração',
    cor: '#65176c',
    descricao: 'Avisos administrativos do sistema, como alterações de configuração e auditoria.',
  },
  {
    id: 'treinamentos',
    label: 'Central de Treinamentos',
    cor: '#0f8a5f',
    descricao: 'Treinamento aplicado, concluído, com chamada pendente ou encerrado sem chamada.',
  },
  {
    id: 'monitoria',
    label: 'Monitoria',
    cor: '#c23b4d',
    descricao: 'Contestações, réplicas, feedbacks e atualizações das monitorias do seu escopo.',
  },
  {
    id: 'chamados',
    label: 'Suporte TI',
    cor: '#086fca',
    descricao: 'Novos chamados, mensagens, mudanças de status, validação e alertas de SLA do Suporte TI.',
  },
  {
    id: 'wfm',
    label: 'Turnos e Plantões',
    cor: '#0b6e4f',
    descricao: 'Pedidos e decisões de troca de escala, escalas enviadas para aprovação, declinadas e publicadas.',
  },
  {
    id: 'critico',
    label: 'Configuração pendente',
    cor: '#c23b4d',
    descricao: 'Itens que o Administrador precisa configurar (ex.: após "Limpar o Conecta").',
  },
];

const CHAVE_PREFERENCIAS = 'c24_notificacoes_categorias';
const CHAVE_CORES_PERSONALIZADAS = 'c24_notificacoes_cores';
// "Lida"/"excluída" das notificações montadas aqui no front (entrevistas,
// processos, problemas...). A fonte da verdade é o servidor
// (/notificacoes/estado-usuario, QA T2-NOT-03: antes o que era lido em um
// navegador reaparecia em outro); o localStorage fica como cópia local para a
// tela responder na hora e para migrar o que já estava marcado neste navegador.
const CHAVE_NOTIF_LIDAS_LOCAIS = 'c24_notificacoes_lidas_locais';
const CHAVE_NOTIF_OCULTAS = 'c24_notificacoes_ocultas';

// Cópia local separada por usuário (vários usuários podem usar o mesmo navegador).
function chaveDoUsuario(chaveBase) {
  const usuario = String(lerSessaoAutenticacao()?.usuario || '').trim().toLowerCase();
  return usuario ? `${chaveBase}:${usuario}` : chaveBase;
}

// Marcas antigas (sem usuário) são levadas para o usuário logado uma única vez.
function migrarChavesLegadas() {
  try {
    [CHAVE_NOTIF_LIDAS_LOCAIS, CHAVE_NOTIF_OCULTAS].forEach((chaveBase) => {
      const legado = localStorage.getItem(chaveBase);
      const destino = chaveDoUsuario(chaveBase);
      if (legado === null || destino === chaveBase) return;
      if (localStorage.getItem(destino) === null) localStorage.setItem(destino, legado);
      localStorage.removeItem(chaveBase);
    });
  } catch (error) {
    // Best-effort.
  }
}

function lerConjuntoStorage(chaveBase) {
  const chave = chaveDoUsuario(chaveBase);
  try {
    const bruto = JSON.parse(localStorage.getItem(chave) || '[]');
    return new Set(Array.isArray(bruto) ? bruto : []);
  } catch (error) {
    return new Set();
  }
}

function gravarConjuntoStorage(chaveBase, conjunto) {
  const chave = chaveDoUsuario(chaveBase);
  try {
    localStorage.setItem(chave, JSON.stringify(Array.from(conjunto)));
  } catch (error) {
    // Preferência é best-effort; se o storage falhar, o estado só não persiste entre sessões.
  }
}

export function lerCoresNotificacao() {
  let salvo = {};
  try {
    salvo = JSON.parse(localStorage.getItem(CHAVE_CORES_PERSONALIZADAS) || '{}');
  } catch (error) {
    salvo = {};
  }

  return CATEGORIAS_NOTIFICACAO.reduce((acumulado, categoria) => {
    acumulado[categoria.id] = salvo[categoria.id] || categoria.cor;
    return acumulado;
  }, {});
}

export function salvarCorNotificacao(categoriaId, cor) {
  const cores = lerCoresNotificacao();
  cores[categoriaId] = cor;
  try {
    localStorage.setItem(CHAVE_CORES_PERSONALIZADAS, JSON.stringify(cores));
  } catch (error) {
    // Preferência é best-effort; se o storage falhar, a cor padrão continua valendo.
  }
  return cores;
}
const JANELA_ENTREVISTAS_PROXIMAS_MS = 1000 * 60 * 60 * 48;
const LIMITE_ITENS_POR_CATEGORIA = 5;

export function lerPreferenciasNotificacao() {
  let salvo = {};
  try {
    salvo = JSON.parse(localStorage.getItem(CHAVE_PREFERENCIAS) || '{}');
  } catch (error) {
    salvo = {};
  }

  return CATEGORIAS_NOTIFICACAO.reduce((acumulado, categoria) => {
    acumulado[categoria.id] = salvo[categoria.id] !== false;
    return acumulado;
  }, {});
}

export function salvarPreferenciasNotificacao(preferencias) {
  try {
    localStorage.setItem(CHAVE_PREFERENCIAS, JSON.stringify(preferencias || {}));
  } catch (error) {
    // Preferência é best-effort; se o storage falhar, mantemos o padrão (tudo ativo).
  }
}

function montarItensEntrevistas(entrevistas) {
  const agora = Date.now();
  return (Array.isArray(entrevistas) ? entrevistas : [])
    .filter((item) => {
      const dataBruta = item?.data_entrevista;
      if (!dataBruta) return false;
      const timestamp = new Date(dataBruta).getTime();
      return Number.isFinite(timestamp) && timestamp >= agora && timestamp - agora <= JANELA_ENTREVISTAS_PROXIMAS_MS;
    })
    .slice(0, LIMITE_ITENS_POR_CATEGORIA)
    .map((item) => ({
      id: `entrevista-${item.id_entrevista || item.id_slot || Math.random()}`,
      categoria: 'entrevistas',
      texto: `Entrevista de ${item.nome_candidato || 'candidato'} agendada${item.vaga ? ` — ${item.vaga}` : ''}`,
    }));
}

function montarItensProcessos(processos) {
  return (Array.isArray(processos) ? processos : [])
    .filter((item) => String(item?.status || '').toLowerCase().includes('aberto'))
    .slice(0, LIMITE_ITENS_POR_CATEGORIA)
    .map((item) => ({
      id: `processo-${item.id_processo || item.id_processo_ref || Math.random()}`,
      categoria: 'processos',
      texto: `Processo aberto: ${item.vaga || item.id_processo_ref || item.id_processo || 'sem nome'}`,
    }));
}

function montarItensProblemas(candidatosProcessos) {
  return (Array.isArray(candidatosProcessos) ? candidatosProcessos : [])
    .filter((item) => /pend[êe]ncia|pendente/i.test(String(item?.status_fluxo || item?.etapa_pipeline || item?.status || '')))
    .slice(0, LIMITE_ITENS_POR_CATEGORIA)
    .map((item) => ({
      id: `pendencia-${item.id_registro || Math.random()}`,
      categoria: 'problemas',
      texto: `Pendência com ${item.nome_candidato || item.nome || 'candidato'}`,
    }));
}

function montarItensAdministracao(solicitacoesEmail) {
  return (Array.isArray(solicitacoesEmail) ? solicitacoesEmail : [])
    .slice(0, LIMITE_ITENS_POR_CATEGORIA)
    .map((item) => ({
      id: `solicitacao-email-${item.id}`,
      categoria: 'administracao',
      texto: `${item.nome_usuario || item.login_usuario || 'Usuário'} pediu alteração de e-mail para ${item.email_novo}`,
    }));
}

function montarItensConfiguracaoCritica({ operacoes, usuarios }) {
  const itens = [];

  if (!Array.isArray(operacoes) || operacoes.length === 0) {
    itens.push({
      id: 'critico-operacoes',
      categoria: 'critico',
      texto: 'Nenhuma operação cadastrada — configure em Configurações → Operações.',
    });
  }

  const usuariosNaoAdministradores = (Array.isArray(usuarios) ? usuarios : []).filter(
    (usuario) => String(usuario?.perfil || usuario?.perfil_id || '').toLowerCase() !== 'administrador',
  );
  if (usuariosNaoAdministradores.length === 0) {
    itens.push({
      id: 'critico-usuarios',
      categoria: 'critico',
      texto: 'Nenhum usuário cadastrado além do administrador — configure em Configurações → Usuários.',
    });
  }

  return itens;
}

const LIMITE_NOTIFICACOES_PERSISTIDAS = 20;
const PREFIXO_ID_PERSISTIDA = 'notificacao-';

export const ehCategoriaMonitoria = (categoria) => String(categoria || '').startsWith('monitoria');

// Categoria de notificação pertence a uma área inativa (Suporte TI / Treinamentos na fase de teste)?
// (o servidor grava as de treinamento como treinamento_aplicado, treinamento_pendente_chamada etc.; as de chamados como 'chamados')
const categoriaDeAreaInativa = (categoria) =>
  (categoria === 'chamados' && !areaAtiva(AREA_SUPORTE_TI)) || (String(categoria || '').startsWith('treinamento') && !areaAtiva(AREA_TREINAMENTOS));

/** Categorias que o usuário pode configurar (esconde as de áreas inativas). */
export const categoriasNotificacaoVisiveis = () => CATEGORIAS_NOTIFICACAO.filter((c) => !categoriaDeAreaInativa(c.id));

// Notificações gravadas no servidor (dbo.notificacoes): Central de Treinamentos e Monitoria.
// A de Monitoria mostra só o resumo ("Fulano abriu uma contestação na monitoria #X").
function montarItensPersistidos(notificacoes) {
  return (Array.isArray(notificacoes) ? notificacoes : [])
    .filter((item) => !categoriaDeAreaInativa(item.categoria))
    .slice(0, LIMITE_NOTIFICACOES_PERSISTIDAS)
    .map((item) => {
      const monitoria = ehCategoriaMonitoria(item.categoria);
      const chamado = item.categoria === 'chamados';
      const wfm = item.categoria === 'wfm';
      const treinamento = String(item.categoria || '').startsWith('treinamento');
      return {
        id: `${PREFIXO_ID_PERSISTIDA}${item.id_notificacao}`,
        // Categorias sem tela própria (LGPD, usuário criado...) caem em Administração, não mais em Treinamentos.
        categoria: monitoria ? 'monitoria' : chamado ? 'chamados' : wfm ? 'wfm' : treinamento ? 'treinamentos' : 'administracao',
        persistida: true,
        caminho: chamado && item.entidade_id ? `/suporte-ti/chamado/${encodeURIComponent(item.entidade_id)}` : '',
        texto: monitoria
          ? item.mensagem || item.titulo || 'Atualização de monitoria'
          : wfm
            ? item.titulo && item.mensagem ? `${item.titulo}: ${item.mensagem}` : item.titulo || item.mensagem || 'Atualização de Turnos e Plantões'
          : chamado
            ? item.titulo && item.mensagem ? `${item.titulo}: ${item.mensagem}` : item.titulo || item.mensagem || 'Atualização do Suporte TI'
            : item.titulo && item.mensagem ? `${item.titulo}: ${item.mensagem}` : item.titulo || item.mensagem || 'Notificação da Central de Treinamentos',
      };
    });
}

// Alertas (bolinha vermelha) da Monitoria: notificações não lidas do usuário, por tipo.
export function resumirAlertasMonitoria(notificacoes) {
  const resumo = { total: 0, contestacoes: 0, feedback: 0, minhas: 0 };
  (Array.isArray(notificacoes) ? notificacoes : []).forEach((item) => {
    if (!ehCategoriaMonitoria(item.categoria) || item.lida) return;
    resumo.total += 1;
    if (item.categoria === 'monitoria_contestacao' || item.categoria === 'monitoria_replica') resumo.contestacoes += 1;
    else if (item.categoria === 'monitoria_feedback_pendente') resumo.feedback += 1;
    else resumo.minhas += 1;
  });
  return resumo;
}

const INTERVALO_ALERTAS_MS = 60 * 1000;

export function useAlertasMonitoria(controlador, gatilho = 0) {
  const [resumo, setResumo] = useState({ total: 0, contestacoes: 0, feedback: 0, minhas: 0 });
  const autenticado = Boolean(controlador?.estado?.autenticado);
  const permitido = Boolean(controlador?.possuiPermissao?.('notificacoes.visualizar'));

  useEffect(() => {
    if (!autenticado || !permitido) return undefined;
    let ativo = true;
    const buscar = () => listarNotificacoes(true)
      .then((lista) => { if (ativo) setResumo(resumirAlertasMonitoria(lista)); })
      .catch(() => {});
    buscar();
    const timer = setInterval(buscar, INTERVALO_ALERTAS_MS);
    return () => { ativo = false; clearInterval(timer); };
  }, [autenticado, permitido, gatilho]);

  return resumo;
}

export function useResumoNotificacoes(controlador) {
  const [itensBrutos, setItensBrutos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [, forcarAtualizacaoLocal] = useState(0);
  const autenticado = Boolean(controlador?.estado?.autenticado);

  // Estado lida/oculta do servidor: carrega uma vez por sessão e envia ao servidor
  // o que só este navegador conhecia (migração do localStorage antigo).
  useEffect(() => {
    if (!autenticado) return undefined;
    let ativo = true;
    migrarChavesLegadas();
    obterEstadoNotificacoesUsuario()
      .then((estado) => {
        if (!ativo || !estado) return;
        const lidasLocais = lerConjuntoStorage(CHAVE_NOTIF_LIDAS_LOCAIS);
        const ocultasLocais = lerConjuntoStorage(CHAVE_NOTIF_OCULTAS);
        const lidasServidor = new Set(Array.isArray(estado.lidas) ? estado.lidas : []);
        const ocultasServidor = new Set(Array.isArray(estado.ocultas) ? estado.ocultas : []);
        const lidasSoLocais = Array.from(lidasLocais).filter((chave) => !lidasServidor.has(chave));
        const ocultasSoLocais = Array.from(ocultasLocais).filter((chave) => !ocultasServidor.has(chave));
        if (lidasSoLocais.length || ocultasSoLocais.length) {
          registrarEstadoNotificacoesUsuario({
            lidas: lidasSoLocais.slice(-500),
            ocultas: ocultasSoLocais.slice(-500),
          }).catch(() => {});
        }
        lidasServidor.forEach((chave) => lidasLocais.add(chave));
        ocultasServidor.forEach((chave) => ocultasLocais.add(chave));
        gravarConjuntoStorage(CHAVE_NOTIF_LIDAS_LOCAIS, lidasLocais);
        gravarConjuntoStorage(CHAVE_NOTIF_OCULTAS, ocultasLocais);
        forcarAtualizacaoLocal((valor) => valor + 1);
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, [autenticado]);

  useEffect(() => {
    let ativo = true;

    if (!autenticado) {
      setItensBrutos([]);
      setCarregando(false);
      return undefined;
    }

    setCarregando(true);
    const podeVerSolicitacoesEmail = Boolean(controlador?.possuiPermissao?.('usuarios.alterar_email'));

    const podeVerNotificacoesTreinamento = Boolean(controlador?.possuiPermissao?.('notificacoes.visualizar'));
    const ehAdministrador = controlador?.estado?.perfilUsuario === 'administrador';

    const carregar = async () => {
      const [
        processos,
        entrevistas,
        candidatosProcessos,
        solicitacoesEmail,
        notificacoesPersistidas,
        operacoes,
        usuarios,
      ] = await Promise.all([
        // Só busca o que o perfil pode ver (operador, por exemplo, não vê
        // processos nem entrevistas: antes eram 3 requisições com 403 a cada tela).
        controlador?.possuiPermissao?.('vagas.visualizar') ? lerProcessos().catch(() => []) : Promise.resolve([]),
        controlador?.possuiPermissao?.('entrevistas.visualizar') ? lerEntrevistas().catch(() => []) : Promise.resolve([]),
        controlador?.possuiPermissao?.('candidatos.visualizar') ? lerCandidatosProcessos().catch(() => []) : Promise.resolve([]),
        podeVerSolicitacoesEmail
          ? listarSolicitacoesAlteracaoEmailApi().then((valor) => valor?.solicitacoes || []).catch(() => [])
          : Promise.resolve([]),
        podeVerNotificacoesTreinamento ? listarNotificacoes(true).catch(() => []) : Promise.resolve([]),
        ehAdministrador ? listarOperacoes().catch(() => []) : Promise.resolve([]),
        ehAdministrador ? listarUsuarios().then((valor) => valor?.usuarios || valor || []).catch(() => []) : Promise.resolve([]),
      ]);
      if (!ativo) return;

      const preferencias = lerPreferenciasNotificacao();
      const resultado = [
        ...montarItensEntrevistas(entrevistas),
        ...montarItensProcessos(processos),
        ...montarItensProblemas(candidatosProcessos),
        ...montarItensAdministracao(solicitacoesEmail),
        ...montarItensPersistidos(notificacoesPersistidas),
        ...(ehAdministrador ? montarItensConfiguracaoCritica({ operacoes, usuarios }) : []),
      ].filter((item) => preferencias[item.categoria] !== false);

      setItensBrutos(resultado);
      setCarregando(false);
    };

    carregar().catch(() => {
      if (ativo) setCarregando(false);
    });

    // Notificações do servidor (ex.: contestação aberta) chegam com o usuário já logado:
    // reconsulta só elas, sem refazer as demais categorias.
    const timer = podeVerNotificacoesTreinamento
      ? setInterval(() => {
        listarNotificacoes(true).then((lista) => {
          if (!ativo) return;
          const preferencias = lerPreferenciasNotificacao();
          const persistidas = montarItensPersistidos(lista).filter((item) => preferencias[item.categoria] !== false);
          setItensBrutos((atual) => [...atual.filter((item) => !item.persistida), ...persistidas]);
        }).catch(() => {});
      }, INTERVALO_ALERTAS_MS)
      : null;

    return () => {
      ativo = false;
      if (timer) clearInterval(timer);
    };
  }, [autenticado]);

  const ocultas = lerConjuntoStorage(CHAVE_NOTIF_OCULTAS);
  const lidasLocais = lerConjuntoStorage(CHAVE_NOTIF_LIDAS_LOCAIS);
  const itens = itensBrutos
    .filter((item) => !ocultas.has(item.id))
    .map((item) => ({
      ...item,
      // As notificações do servidor só são buscadas não-lidas (listarNotificacoes(true)),
      // então qualquer item presente aqui já é, por definição, não lido.
      lida: item.persistida ? false : lidasLocais.has(item.id),
    }));

  const marcarComoLida = async (item) => {
    if (!item || item.lida) return;
    if (item.persistida) {
      const idReal = String(item.id).replace(PREFIXO_ID_PERSISTIDA, '');
      try {
        await marcarNotificacaoLida(idReal);
      } catch (error) {
        // Best-effort: se a chamada falhar, o item volta a aparecer no próximo carregamento.
      }
      setItensBrutos((atual) => atual.filter((existente) => existente.id !== item.id));
      return;
    }
    const conjunto = lerConjuntoStorage(CHAVE_NOTIF_LIDAS_LOCAIS);
    conjunto.add(item.id);
    gravarConjuntoStorage(CHAVE_NOTIF_LIDAS_LOCAIS, conjunto);
    forcarAtualizacaoLocal((valor) => valor + 1);
    registrarEstadoNotificacoesUsuario({ lidas: [item.id] }).catch(() => {});
  };

  const excluirTodas = async () => {
    try {
      await excluirTodasNotificacoes();
    } catch (error) {
      // Best-effort: mesmo se a exclusão no servidor falhar, ocultamos localmente.
    }
    const conjunto = lerConjuntoStorage(CHAVE_NOTIF_OCULTAS);
    itens.forEach((item) => conjunto.add(item.id));
    gravarConjuntoStorage(CHAVE_NOTIF_OCULTAS, conjunto);
    const ocultarNoServidor = itens.filter((item) => !item.persistida).map((item) => item.id);
    if (ocultarNoServidor.length) {
      registrarEstadoNotificacoesUsuario({ ocultas: ocultarNoServidor.slice(0, 500) }).catch(() => {});
    }
    setItensBrutos((atual) => atual.filter((item) => !item.persistida));
    forcarAtualizacaoLocal((valor) => valor + 1);
  };

  return { itens, carregando, marcarComoLida, excluirTodas };
}
