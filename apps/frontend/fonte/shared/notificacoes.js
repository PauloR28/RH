import { useEffect, useState } from '../infraestrutura-react.js';
import {
  lerProcessos,
  lerEntrevistas,
  lerCandidatosProcessos,
  listarSolicitacoesAlteracaoEmailApi,
} from '../app/controlador-aplicacao.js';
import { listarNotificacoes } from '../services/api/notifications.js';
import { listarOperacoes } from '../services/api/operations.js';
import { listarUsuarios } from '../services/api/settings.js';

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
    id: 'critico',
    label: 'Configuração pendente',
    cor: '#c23b4d',
    descricao: 'Itens que o Administrador precisa configurar (ex.: após "Limpar o Conecta").',
  },
];

const CHAVE_PREFERENCIAS = 'c24_notificacoes_categorias';
const CHAVE_CORES_PERSONALIZADAS = 'c24_notificacoes_cores';

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

function montarItensTreinamentos(notificacoesTreinamento) {
  return (Array.isArray(notificacoesTreinamento) ? notificacoesTreinamento : [])
    .slice(0, LIMITE_ITENS_POR_CATEGORIA)
    .map((item) => ({
      id: `treinamento-${item.id_notificacao}`,
      categoria: 'treinamentos',
      texto: item.titulo && item.mensagem ? `${item.titulo}: ${item.mensagem}` : item.titulo || item.mensagem || 'Notificação da Central de Treinamentos',
    }));
}

export function useResumoNotificacoes(controlador) {
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const autenticado = Boolean(controlador?.estado?.autenticado);

  useEffect(() => {
    let ativo = true;

    if (!autenticado) {
      setItens([]);
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
        notificacoesTreinamento,
        operacoes,
        usuarios,
      ] = await Promise.all([
        lerProcessos().catch(() => []),
        lerEntrevistas().catch(() => []),
        lerCandidatosProcessos().catch(() => []),
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
        ...montarItensTreinamentos(notificacoesTreinamento),
        ...(ehAdministrador ? montarItensConfiguracaoCritica({ operacoes, usuarios }) : []),
      ].filter((item) => preferencias[item.categoria] !== false);

      setItens(resultado);
      setCarregando(false);
    };

    carregar().catch(() => {
      if (ativo) setCarregando(false);
    });

    return () => {
      ativo = false;
    };
  }, [autenticado]);

  return { itens, carregando };
}
