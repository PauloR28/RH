import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { PainelRh } from '../../ui/componentes-compartilhados.js';
import { PageHeader, PageShell, SettingsLayout } from '../../ui/components/layout-primitivas.js?v=20261005-redesign16';
import { AtalhoLinha, CabecalhoConsole, CardResumoLink, GrupoAtalhos, PaginaConsole } from '../../ui/components/console-primitivas.js?v=20261014-historico';
import { useToast } from '../../shared/hooks/use-toast.js';
import { lerResumoTecnologia } from '../../services/api/modulos.js?v=20261005-redesign16';
import { montarHashDaTela } from '../../rotas.js';
import { TELA_MODULOS_TECNOLOGIA, funcaoLigada, telaWfmParaTecnologia } from '../registro.js?v=20261014-funcoes';
import { SecaoAtribuicao, SecaoFuncoes } from './modulos.js?v=20261014-funcoes3';

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
      { tela: 'screen-settings-profiles', icone: 'admin_panel_settings', titulo: 'Perfis e permissões', texto: 'Permissões de todos os módulos.' },
      { tela: 'screen-settings-operations', icone: 'apartment', titulo: 'Operações', texto: 'Cadastro, tema, logo e vínculos.' },
    ],
  },
  {
    rotulo: 'SISTEMA',
    itens: [
      { tela: TELA_MODULOS_TECNOLOGIA, icone: 'grid_view', titulo: 'Módulos', texto: 'Funções de cada módulo e atribuição de acesso.' },
      { tela: 'screen-settings-administracao', icone: 'verified_user', titulo: 'Parâmetros e integrações', texto: 'Microsoft 365, SharePoint e e-mail.' },
      { tela: 'screen-settings-modelos-email', icone: 'tune', titulo: 'Catálogos e modelos', texto: 'Modelos de e-mail, motivos e etapas.' },
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

function Inicio({ controlador }) {
  const [resumo, setResumo] = useState(null);
  const [falhou, setFalhou] = useState(false);

  // Uma única chamada leve (contagens no servidor); os atalhos aparecem na hora, sem esperar os números.
  useEffect(() => {
    let ativo = true;
    lerResumoTecnologia().then((r) => ativo && setResumo(r)).catch(() => ativo && setFalhou(true));
    return () => { ativo = false; };
  }, []);

  const resolver = (tela) => (tela === 'wfm' ? (funcaoLigada('tecnologia', 'wfm') ? telaWfmParaTecnologia(controlador.podeAcessarTela) : '') : tela);
  const abrir = (tela) => () => controlador.irParaTelaProtegida(tela);
  const grupos = GRUPOS_ATALHOS
    .map((g) => ({ ...g, itens: g.itens.map((i) => ({ ...i, destino: resolver(i.tela) })).filter((i) => i.destino && controlador.podeAcessarTela(i.destino)) }))
    .filter((g) => g.itens.length);

  const total = resumo?.modulos_total;
  const ativos = resumo?.modulos_ativos;
  const todosAtivos = ativos === total;
  const carregando = !resumo && !falhou;
  const podeModulos = controlador.podeAcessarTela(TELA_MODULOS_TECNOLOGIA);
  const podeUsuarios = controlador.podeAcessarTela('screen-settings-users');

  return html`
    <${PaginaConsole} className="cx-adm">
      <${CabecalhoConsole} titulo=${TITULOS['screen-tecnologia'][0]} subtitulo=${TITULOS['screen-tecnologia'][1]} />
      <div class="cx-resumos cx-resumos--duas">
        ${podeModulos ? html`<${CardResumoLink} icone="grid_view" tom="verde" rotulo="Módulos ativos" valor=${`${ativos} de ${total}`}
          nota=${todosAtivos ? 'todos ativos' : `${total - ativos} desativado(s)`} notaTom=${todosAtivos ? 'sucesso' : 'atencao'} acao="Ver módulos"
          href=${montarHashDaTela(TELA_MODULOS_TECNOLOGIA)} aoAbrir=${abrir(TELA_MODULOS_TECNOLOGIA)} carregando=${carregando} falhou=${falhou} />` : null}
        ${podeUsuarios ? html`<${CardResumoLink} icone="group" tom="azul" rotulo="Usuários ativos" valor=${`${resumo?.usuarios_ativos}`}
          nota=${`${resumo?.usuarios_bloqueados} bloqueado(s)`} acao="Ver usuários"
          href=${montarHashDaTela('screen-settings-users')} aoAbrir=${abrir('screen-settings-users')} carregando=${carregando} falhou=${falhou} />` : null}
      </div>
      <div class="cx-grupos" style=${{ '--cx-colunas': Math.max(1, grupos.length) }}>
        ${grupos.map((g) => html`
          <${GrupoAtalhos} key=${g.rotulo} rotulo=${g.rotulo}>
            ${g.itens.map((i) => html`<${AtalhoLinha} key=${i.titulo} icone=${i.icone} nome=${i.titulo} descricao=${i.texto}
              href=${montarHashDaTela(i.destino)} aoAbrir=${abrir(i.destino)} />`)}
          </${GrupoAtalhos}>`)}
      </div>
    </${PaginaConsole}>`;
}

const SECOES_MODULOS = [
  { chave: 'funcoes', rotulo: 'Módulos e funções', icone: 'grid_view' },
  { chave: 'atribuicao', rotulo: 'Atribuição', icone: 'group' },
];

function TelaModulos({ podeEditar, showToast }) {
  const [secao, setSecao] = useState('funcoes');
  const props = { podeEditar, showToast, aoMudar: () => {} };
  return html`
    <${SettingsLayout} itens=${SECOES_MODULOS} ativo=${secao} aoMudar=${setSecao}>
      ${secao === 'funcoes' ? html`<${SecaoFuncoes} ...${props} />` : null}
      ${secao === 'atribuicao' ? html`<${SecaoAtribuicao} ...${props} />` : null}
    <//>`;
}

export function TelaTecnologia({ controlador, telaAtual = 'screen-tecnologia' }) {
  const { showToast, ToastHost } = useToast();
  const [titulo, descricao] = TITULOS[telaAtual] || TITULOS['screen-tecnologia'];
  const podeEditar = controlador.possuiPermissao('configuracoes.editar');
  return html`
    <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Tecnologia" placeholderBusca="Buscar" controlador=${controlador} buscaGlobal=${false}>
      <div class="tec-toast"><${ToastHost} /></div>
      ${telaAtual === TELA_MODULOS_TECNOLOGIA
    ? html`<${PageShell}>
          <${PageHeader} titulo=${titulo} subtitulo=${descricao} />
          <${TelaModulos} podeEditar=${podeEditar} showToast=${showToast} />
        <//>`
    : html`<${Inicio} controlador=${controlador} />`}
    </${PainelRh}>`;
}
