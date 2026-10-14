import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { PainelRh } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import { PageHeader, PageShell, SettingsLayout } from '../../ui/components/layout-primitivas.js?v=20261005-redesign16';
import { useToast } from '../../shared/hooks/use-toast.js';
import { useChamadosNaoLidos } from '../../shared/chamados-nao-lidos.js?v=20261006-areas-inativas';
import { lerResumoTecnologia } from '../../services/api/modulos.js?v=20261005-redesign16';
import { TELA_MODULOS_TECNOLOGIA, TELAS_SUPORTE_TI, funcaoLigada, telaWfmParaTecnologia } from '../registro.js?v=20261014-funcoes';
import { SecaoAtribuicao, SecaoFuncoes } from './modulos.js?v=20261014-funcoes3';

// Módulo Tecnologia: centro de administração do Conecta. Início = indicadores + atalhos (tiles); Módulos = funções por módulo e atribuição.
// 100% administração: usuários, perfis, operações, módulos, parâmetros, auditoria, Suporte TI e a tela "Escalas e Plantões" do WFM.

const TITULOS = {
  'screen-tecnologia': ['Administração do Conecta', 'Tudo o que governa o sistema, em um só lugar.'],
  [TELA_MODULOS_TECNOLOGIA]: ['Módulos', 'Configure as funções de cada módulo, ative ou desative módulos e atribua módulos a perfis ou pessoas.'],
};

const ATALHOS = [
  { tela: 'suporte', icone: 'support_agent', titulo: 'Suporte TI', texto: 'Chamados, fila, indicadores e configurações.' },
  { tela: 'screen-settings-users', icone: 'group', titulo: 'Usuários', texto: 'Criar, editar, bloquear e redefinir senha.' },
  { tela: 'screen-settings-profiles', icone: 'admin_panel_settings', titulo: 'Perfis e permissões', texto: 'Permissões de todos os módulos.' },
  { tela: 'screen-settings-operations', icone: 'apartment', titulo: 'Operações', texto: 'Cadastro, tema, logo e vínculos.' },
  { tela: TELA_MODULOS_TECNOLOGIA, icone: 'grid_view', titulo: 'Módulos', texto: 'Funções de cada módulo e atribuição de acesso.' },
  { tela: 'screen-settings-administracao', icone: 'verified_user', titulo: 'Parâmetros e integrações', texto: 'Microsoft 365, SharePoint e e-mail.' },
  { tela: 'screen-settings-modelos-email', icone: 'tune', titulo: 'Catálogos e modelos', texto: 'Modelos de e-mail, motivos e etapas.' },
  { tela: 'screen-settings-lgpd', icone: 'shield_lock', titulo: 'LGPD e retenção', texto: 'Aviso de privacidade e anonimização.' },
  { tela: 'screen-settings-logs', icone: 'history_edu', titulo: 'Auditoria', texto: 'Logs de acesso e de alterações.' },
  { tela: 'wfm', icone: 'calendar_month', titulo: 'Escalas e Plantões (TI)', texto: 'WFM filtrado pela operação TI.' },
];

function Indicadores({ resumo }) {
  const n = (valor) => (valor === null || valor === undefined ? '—' : valor);
  return html`
    <div class="tec-kpis">
      <div class="tec-kpi"><span>Módulos ativos</span><strong>${resumo ? `${resumo.modulos_ativos} de ${resumo.modulos_total}` : '—'}</strong></div>
      <div class="tec-kpi"><span>Usuários ativos</span><strong>${n(resumo?.usuarios_ativos)}</strong><small>${resumo ? `${resumo.usuarios_bloqueados} bloqueado(s)` : ''}</small></div>
      <div class="tec-kpi"><span>Chamados abertos</span><strong>${n(resumo?.chamados_abertos)}</strong></div>
    </div>`;
}

function Inicio({ controlador }) {
  const [resumo, setResumo] = useState(null);
  const naoLidos = useChamadosNaoLidos(controlador);

  // Uma única chamada leve (contagens no servidor); os atalhos aparecem na hora, sem esperar os números.
  useEffect(() => {
    let ativo = true;
    lerResumoTecnologia().then((r) => ativo && setResumo(r)).catch(() => {});
    return () => { ativo = false; };
  }, []);

  const telaSuporte = TELAS_SUPORTE_TI.find((t) => controlador.podeAcessarTela(t)) || '';
  const resolver = (tela) => (tela === 'wfm' ? telaWfmParaTecnologia(controlador.podeAcessarTela) : tela === 'suporte' ? telaSuporte : tela);
  const atalhos = ATALHOS.filter((a) => {
    if ((a.tela === 'suporte' || a.tela === 'wfm') && !funcaoLigada('tecnologia', a.tela)) return false;
    const destino = resolver(a.tela);
    return destino && controlador.podeAcessarTela(destino);
  });

  return html`
    <${Indicadores} resumo=${resumo} />
    <div class="tec-tiles">
      ${atalhos.map((a) => html`
        <button type="button" class="tec-tile" key=${a.titulo} onClick=${() => controlador.irParaTelaProtegida(resolver(a.tela))}>
          <span class="tec-tile-icone material-symbols-outlined" aria-hidden="true">${IconeSvg(a.icone)}</span>
          <span class="tec-tile-texto"><strong>${a.titulo}</strong><small>${a.texto}</small></span>
          ${a.tela === 'suporte' && naoLidos > 0 ? html`<span class="tec-dot" role="status" aria-label=${`${naoLidos} notificação(ões) de chamados não lida(s)`}></span>` : null}
        </button>`)}
    </div>`;
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
      <${PageShell}>
        <${PageHeader} titulo=${titulo} subtitulo=${descricao} />
        ${telaAtual === TELA_MODULOS_TECNOLOGIA
          ? html`<${TelaModulos} podeEditar=${podeEditar} showToast=${showToast} />`
          : html`<${Inicio} controlador=${controlador} />`}
      <//>
    </${PainelRh}>`;
}
