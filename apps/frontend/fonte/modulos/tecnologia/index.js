import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { PainelRh } from '../../ui/componentes-compartilhados.js';
import { AbasConsole, AtalhoLinha, AvisoConsole, CabecalhoConsole, CardResumoLink, GrupoAtalhos, PaginaConsole, idAba, idPainel } from '../../ui/components/console-primitivas.js?v=20261022-equipes';
import { ModalPadrao } from '../../ui/componentes-compartilhados.js';
import { useToast } from '../../shared/hooks/use-toast.js';
import { lerResumoTecnologia } from '../../services/api/modulos.js?v=20261005-redesign16';
import { montarHashDaTela } from '../../rotas.js';
import { TELA_MODULOS_TECNOLOGIA, funcaoLigada, telaWfmParaTecnologia } from '../registro.js?v=20261117-config2';
import { SecaoAtribuicao, SecaoFuncoes } from './modulos.js?v=20261112-modulo-unico2';
import { requisitar } from '../../services/api/core.js';
import { useInicioDoModulo } from '../../shared/tela-inicial.js?v=20261117-inicio';

// Módulo Tecnologia: centro de administração do Conecta. Início = 2 números + atalhos agrupados por assunto; Módulos = funções por
// módulo e atribuição. 100% administração: usuários, perfis, operações, módulos, parâmetros, auditoria e a tela "Escalas e Plantões" do WFM.
// Suporte TI está desativado no Conecta (rh_api/areas.py): não há card de chamados nem atalho para ele.

const TITULOS = {
  'screen-tecnologia': ['Administração do Conecta', 'Tudo o que governa o sistema, em um só lugar.'],
  [TELA_MODULOS_TECNOLOGIA]: ['Módulos', 'Configure as funções de cada módulo, ative ou desative módulos e atribua módulos a perfis ou pessoas.'],
};

// Atalhos agrupados por assunto. O destino de cada um é o mesmo de sempre; `wfm` resolve para a primeira tela de WFM que a pessoa pode abrir.
const GRUPOS_ATALHOS = [
  {
    rotulo: 'PESSOAS E ACESSO',
    itens: [
      { tela: 'screen-settings-users', icone: 'group', titulo: 'Usuários', texto: 'Criar, editar, bloquear e redefinir senha.' },
      { tela: 'screen-settings-acessos', icone: 'lock', titulo: 'Acessos', texto: 'Módulos, funções, alcance e permissões, num lugar só.' },
      { tela: 'screen-settings-operations', icone: 'apartment', titulo: 'Operação', texto: 'Cadastro, tema, logo e vínculos.' },
    ],
  },
  {
    rotulo: 'SISTEMA',
    itens: [
      { tela: 'screen-settings-conecta', icone: 'settings', titulo: 'Configurações do Conecta', texto: 'Integrações, catálogos, LGPD, ajuda, logs e notificações.' },
    ],
  },
  {
    rotulo: 'GOVERNANÇA E OPERAÇÃO',
    itens: [
      { tela: 'screen-settings-lgpd', icone: 'shield_lock', titulo: 'LGPD e retenção', texto: 'Aviso de privacidade e anonimização.' },
      { tela: 'screen-settings-logs', icone: 'history_edu', titulo: 'Auditoria', texto: 'Logs de acesso e de alterações.' },
      { tela: 'wfm', icone: 'calendar_month', titulo: 'Escalas e Plantões (TI)', texto: 'WFM filtrado pela operação TI.' },
    ],
  },
];

const ESTADO_BACKUP = { ok: ['Em dia', 'sucesso'], atrasado: ['Atrasado', 'atencao'], falha: ['Falhou', 'perigo'], sem_registro: ['Sem registro', 'atencao'] };

// Situação do sistema (Etapa 8): backup e inatividade, as mesmas leituras de Configurações › Backup e › Segurança.
function SituacaoSistema({ controlador }) {
  const [dados, setDados] = useState(null);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    let ativo = true;
    Promise.all([
      requisitar('/settings/backup', { method: 'GET' }).catch(() => null),
      requisitar('/settings/seguranca/inatividade/previa', { method: 'GET' }).catch(() => null),
    ]).then(([backup, previa]) => { if (ativo) { setDados({ backup, previa }); setFalhou(!backup && !previa); } });
    return () => { ativo = false; };
  }, []);
  const abrir = (tela) => () => controlador.irParaTelaProtegida(tela);
  const carregando = !dados;
  const [rotuloBackup, tomBackup] = ESTADO_BACKUP[dados?.backup?.estado] || ESTADO_BACKUP.sem_registro;
  const quando = dados?.backup?.ultimo?.fim ? new Date(dados.backup.ultimo.fim).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'sem backup no histórico';
  const previa = dados?.previa;
  return html`<div class="cx-resumos cx-resumos--duas">
    <${CardResumoLink} icone="cloud" tom="azul" rotulo="Backup" valor=${rotuloBackup} nota=${`Último: ${quando}`} notaTom=${tomBackup}
      acao="Ver backup" href=${montarHashDaTela('screen-settings-backup')} aoAbrir=${abrir('screen-settings-backup')} carregando=${carregando} falhou=${falhou || (dados && !dados.backup)} />
    <${CardResumoLink} icone="lock" tom="verde" rotulo="Inatividade (hoje)" valor=${previa ? `${previa.bloquear} a bloquear` : '—'}
      nota=${previa ? (previa.ativa ? `${previa.excluir} a excluir · ${previa.avisar} a avisar` : 'regra desligada') : ''} notaTom=${previa?.bloquear || previa?.excluir ? 'atencao' : 'sucesso'}
      acao="Ver segurança" href=${montarHashDaTela('screen-settings-seguranca')} aoAbrir=${abrir('screen-settings-seguranca')} carregando=${carregando} falhou=${falhou || (dados && !previa)} />
  </div>`;
}

function Inicio({ controlador }) {
  const [resumo, setResumo] = useState(null);
  const [falhou, setFalhou] = useState(false);
  // Blocos e atalhos escolhidos em Configurações › Início dos módulos (null = carregando; os atalhos já podem aparecer).
  const config = useInicioDoModulo('tecnologia');
  const blocos = config?.blocos || ['resumo', 'situacao', 'atalhos'];
  const ocultos = config?.atalhosOcultos || new Set();

  // Uma única chamada leve (contagens no servidor); os atalhos aparecem na hora, sem esperar os números.
  useEffect(() => {
    let ativo = true;
    lerResumoTecnologia().then((r) => ativo && setResumo(r)).catch(() => ativo && setFalhou(true));
    return () => { ativo = false; };
  }, []);

  const resolver = (tela) => (tela === 'wfm' ? (funcaoLigada('tecnologia', 'wfm') ? telaWfmParaTecnologia(controlador.podeAcessarTela) : '') : tela);
  const abrir = (tela) => () => controlador.irParaTelaProtegida(tela);
  const grupos = GRUPOS_ATALHOS
    .map((g) => ({ ...g, itens: g.itens.filter((i) => !ocultos.has(i.tela)).map((i) => ({ ...i, destino: resolver(i.tela) })).filter((i) => i.destino && controlador.podeAcessarTela(i.destino)) }))
    .filter((g) => g.itens.length);

  const total = resumo?.modulos_total;
  const ativos = resumo?.modulos_ativos;
  const todosAtivos = ativos === total;
  const carregando = !resumo && !falhou;
  const podeModulos = controlador.podeAcessarTela('screen-settings-acessos');
  const podeUsuarios = controlador.podeAcessarTela('screen-settings-users');

  const pedacos = {
    resumo: () => ((podeModulos || podeUsuarios) ? html`<div key="resumo" class="cx-resumos cx-resumos--duas">
        ${podeModulos ? html`<${CardResumoLink} icone="grid_view" tom="verde" rotulo="Módulos ativos" valor=${`${ativos} de ${total}`}
          nota=${todosAtivos ? 'todos ativos' : `${total - ativos} desativado(s)`} notaTom=${todosAtivos ? 'sucesso' : 'atencao'} acao="Ver acessos"
          href=${montarHashDaTela('screen-settings-acessos')} aoAbrir=${abrir('screen-settings-acessos')} carregando=${carregando} falhou=${falhou} />` : null}
        ${podeUsuarios ? html`<${CardResumoLink} icone="group" tom="azul" rotulo="Usuários ativos" valor=${`${resumo?.usuarios_ativos}`}
          nota=${`${resumo?.usuarios_bloqueados} bloqueado(s)`} acao="Ver usuários"
          href=${montarHashDaTela('screen-settings-users')} aoAbrir=${abrir('screen-settings-users')} carregando=${carregando} falhou=${falhou} />` : null}
      </div>` : null),
    situacao: () => (controlador.possuiPermissao('configuracoes.visualizar') ? html`<${SituacaoSistema} key="situacao" controlador=${controlador} />` : null),
    atalhos: () => (grupos.length ? html`<div key="atalhos" class="cx-grupos" style=${{ '--cx-colunas': Math.max(1, grupos.length) }}>
        ${grupos.map((g) => html`
          <${GrupoAtalhos} key=${g.rotulo} rotulo=${g.rotulo}>
            ${g.itens.map((i) => html`<${AtalhoLinha} key=${i.titulo} icone=${i.icone} nome=${i.titulo} descricao=${i.texto}
              href=${montarHashDaTela(i.destino)} aoAbrir=${abrir(i.destino)} />`)}
          </${GrupoAtalhos}>`)}
      </div>` : null),
  };

  return html`
    <${PaginaConsole} className="cx-adm">
      <${CabecalhoConsole} titulo=${TITULOS['screen-tecnologia'][0]} subtitulo=${TITULOS['screen-tecnologia'][1]} />
      ${blocos.map((id) => pedacos[id]?.() || null)}
    </${PaginaConsole}>`;
}

const ABAS_MODULOS = [
  { id: 'funcoes', rotulo: 'Módulos e funções', icone: 'grid_view' },
  { id: 'atribuicao', rotulo: 'Atribuição', icone: 'group' },
];
const AVISO_MODULOS = 'Cada módulo mostra no menu só as funções ligadas aqui. Desligar uma função não apaga dados nem muda permissões: só esconde o atalho naquele módulo. Toda mudança pede confirmação e fica registrada em auditoria.';

function TelaModulos({ podeEditar, showToast, controlador }) {
  const [secao, setSecao] = useState('funcoes');
  const [pendentes, setPendentes] = useState(0);
  const [saida, setSaida] = useState(null); // { tipo: 'aba', destino } | { tipo: 'rota', tela }

  // Com alterações não salvas: avisa ao trocar de aba, ao navegar pelo menu e ao fechar/recarregar a página.
  useEffect(() => {
    if (!pendentes) return undefined;
    const avisar = (ev) => { ev.preventDefault(); ev.returnValue = ''; };
    window.addEventListener('beforeunload', avisar);
    window.__conectaGuardaNavegacao = (tela) => { setSaida({ tipo: 'rota', tela }); return false; };
    return () => { window.removeEventListener('beforeunload', avisar); window.__conectaGuardaNavegacao = null; };
  }, [pendentes]);

  const pedirAba = (destino) => {
    if (destino === secao) return;
    if (pendentes > 0) setSaida({ tipo: 'aba', destino });
    else setSecao(destino);
  };
  const sairSemSalvar = () => {
    const alvo = saida;
    setSaida(null);
    setPendentes(0);
    window.__conectaGuardaNavegacao = null;
    if (alvo?.tipo === 'aba') setSecao(alvo.destino);
    else if (alvo?.tela) controlador.irParaTelaProtegida(alvo.tela);
  };

  const propsSecao = { podeEditar, showToast, aoMudar: () => {} };
  return html`
    <${PaginaConsole} className="cx-modulos">
      <${CabecalhoConsole} titulo=${TITULOS[TELA_MODULOS_TECNOLOGIA][0]} subtitulo=${TITULOS[TELA_MODULOS_TECNOLOGIA][1]}
        acoes=${html`<${AbasConsole} variante="segmentada" prefixo="modulos" rotulo="Seções de Módulos" itens=${ABAS_MODULOS} ativa=${secao} aoMudar=${pedirAba} />`} />
      ${secao === 'funcoes' ? html`<${AvisoConsole} suave=${true}>${AVISO_MODULOS}</${AvisoConsole}>` : null}
      <div class="cx-mod2-painel cx-cresce" role="tabpanel" id=${idPainel('modulos', secao)} aria-labelledby=${idAba('modulos', secao)}>
        ${secao === 'funcoes'
    ? html`<${SecaoFuncoes} ...${propsSecao} aoMudarPendentes=${setPendentes} aoIrParaAtribuicao=${() => pedirAba('atribuicao')} />`
    : html`<section class="cx-card cx-atrib"><div class="cx-card-corpo cx-atrib-corpo"><${SecaoAtribuicao} ...${propsSecao} /></div></section>`}
      </div>
    </${PaginaConsole}>
    <${ModalPadrao} aberto=${Boolean(saida)} titulo="Você tem alterações não salvas" subtitulo="Se sair agora, as alterações pendentes serão perdidas." onClose=${() => setSaida(null)}>
      <footer class="rh-modal-footer"><div class="rh-modal-footer-actions">
        <button type="button" class="btn btn-outline-secondary" onClick=${sairSemSalvar}>Sair sem salvar</button>
        <button type="button" class="btn btn-primary" onClick=${() => setSaida(null)}>Continuar editando</button>
      </div></footer>
    <//>`;
}

export function TelaTecnologia({ controlador, telaAtual = 'screen-tecnologia' }) {
  const { showToast, ToastHost } = useToast();
  const podeEditar = controlador.possuiPermissao('configuracoes.editar');
  return html`
    <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Tecnologia" placeholderBusca="Buscar" controlador=${controlador} buscaGlobal=${false}>
      <div class="tec-toast"><${ToastHost} /></div>
      ${telaAtual === TELA_MODULOS_TECNOLOGIA
    ? html`<${TelaModulos} podeEditar=${podeEditar} showToast=${showToast} controlador=${controlador} />`
    : html`<${Inicio} controlador=${controlador} />`}
    </${PainelRh}>`;
}
