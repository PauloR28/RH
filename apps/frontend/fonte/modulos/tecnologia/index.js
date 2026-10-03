import { html, useCallback, useEffect, useState } from '../../infraestrutura-react.js';
import { LoadingState, ModalPadrao, PageIntro, PainelRh } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import { useToast } from '../../shared/hooks/use-toast.js';
import { listarUsuarios } from '../../services/api/settings.js';
import {
  definirModuloAtivo,
  definirWfmParticipantes,
  lerWfmParticipantes,
  listarModulosTecnologia,
} from '../../services/api/modulos.js';
import { limparEstadoModulos, carregarAcessoModulos } from '../estado.js?v=20261003-modulos-c';
import { TELA_MODULOS_TECNOLOGIA, telaWfmParaTecnologia } from '../registro.js?v=20261003-modulos-c';

// Módulo Tecnologia — centro de administração do Conecta (wireframe aprovado, Etapa 6).
// 100% administração: usuários, perfis e permissões, operações, módulos, WFM de participantes, parâmetros, auditoria e a
// tela "Escalas e Plantões" emprestada do WFM (mesma tela e mesmas rotas, filtrada pela operação TI).

const DESCRICAO_MODULO = {
  core: 'Login, usuários, perfis, operações, notificações e autoatendimento.',
  rh: 'Currículos, Processos, Provas e gestão de Treinamentos.',
  operacao: 'Monitoria e Turnos e Plantões.',
  tecnologia: 'Esta administração.',
};

const TITULOS = {
  'screen-tecnologia': ['Administração do Conecta', 'Tudo o que governa o sistema, em um só lugar. Quem controla as permissões de qualquer módulo é a Tecnologia.'],
  [TELA_MODULOS_TECNOLOGIA]: ['Módulos', 'Ative ou desative módulos e decida a liberação do WFM para os participantes.'],
};

function Cartao({ titulo, children, className = '' }) {
  return html`<section class=${`tec-card ${className}`.trim()}><h3 class="tec-card-titulo">${titulo}</h3>${children}</section>`;
}

function Interruptor({ ligado, travado, rotulo, onChange }) {
  return html`
    <button type="button" role="switch" aria-checked=${ligado} aria-label=${rotulo} disabled=${travado}
      class=${`tec-switch ${ligado ? 'is-on' : ''}`.trim()} onClick=${onChange}></button>`;
}

export function PainelModulos({ podeEditar, showToast, aoMudar }) {
  const [modulos, setModulos] = useState(null);
  const [erro, setErro] = useState('');
  const [pendente, setPendente] = useState(null); // { chave, nome, ativo }
  const [justificativa, setJustificativa] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(() => {
    setErro('');
    listarModulosTecnologia().then(setModulos).catch((e) => setErro(e?.message || 'Não foi possível carregar os módulos.'));
  }, []);
  useEffect(carregar, [carregar]);

  const confirmar = async () => {
    setSalvando(true);
    try {
      await definirModuloAtivo(pendente.chave, pendente.ativo, justificativa);
      showToast(`Módulo ${pendente.nome} ${pendente.ativo ? 'ativado' : 'desativado'}.`, 'success');
      setPendente(null);
      setJustificativa('');
      limparEstadoModulos();
      carregarAcessoModulos();
      carregar();
      aoMudar?.();
    } catch (e) {
      showToast(e?.message || 'Não foi possível alterar o módulo.', 'error');
    } finally {
      setSalvando(false);
    }
  };

  return html`
    <${Cartao} titulo="Ativação de módulos" className="tec-card--grande">
      ${erro ? html`<div class="alert alert-warning" role="alert">${erro}</div>` : null}
      ${!modulos && !erro ? html`<${LoadingState} titulo="Carregando módulos" />` : null}
      ${(modulos || []).map((m) => html`
        <div class="tec-linha" key=${m.chave}>
          <div class="tec-linha-texto"><strong>${m.nome}</strong><small>${DESCRICAO_MODULO[m.chave] || ''}</small></div>
          ${m.protegido ? html`<span class="tec-pill">protegido</span>` : html`<span class=${`tec-pill ${m.ativo ? 'is-ok' : 'is-aviso'}`}>${m.ativo ? 'ativo' : 'desativado'}</span>`}
          <${Interruptor} ligado=${m.ativo} travado=${m.protegido || !podeEditar} rotulo=${`Módulo ${m.nome}`}
            onChange=${() => setPendente({ chave: m.chave, nome: m.nome, ativo: !m.ativo })} />
        </div>`)}
      <p class="tec-ajuda">Desligar um módulo esconde as telas e bloqueia as rotas dele no servidor. O app de treinamento (autoatendimento) continua funcionando. ${podeEditar ? '' : 'Você não tem permissão para alterar.'}</p>
      <${ModalPadrao} aberto=${Boolean(pendente)} titulo=${pendente ? `${pendente.ativo ? 'Ativar' : 'Desativar'} o módulo ${pendente.nome}?` : ''}
        subtitulo="A mudança vale para todos os usuários e fica registrada em auditoria." onClose=${() => setPendente(null)}>
        <div class="rh-details-body">
          ${pendente && !pendente.ativo ? html`<div class="alert alert-warning">Quem só usa este módulo perde o acesso às telas dele agora.</div>` : null}
          <label class="tec-campo"><span>Justificativa (opcional)</span>
            <input class="form-control" value=${justificativa} maxlength="400" onInput=${(e) => setJustificativa(e.target.value)} />
          </label>
        </div>
        <footer class="rh-modal-footer"><div class="rh-modal-footer-actions">
          <button type="button" class="btn btn-outline-secondary" onClick=${() => setPendente(null)}>Cancelar</button>
          <button type="button" class="btn btn-primary" disabled=${salvando} onClick=${confirmar}>${salvando ? 'Salvando…' : 'Confirmar'}</button>
        </div></footer>
      </${ModalPadrao}>
    </${Cartao}>`;
}

export function CartaoWfmParticipantes({ podeEditar, showToast, aoMudar }) {
  const [situacao, setSituacao] = useState(null);
  const [erro, setErro] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(() => {
    setErro('');
    lerWfmParticipantes().then(setSituacao).catch((e) => setErro(e?.message || 'Não foi possível ler a configuração do WFM.'));
  }, []);
  useEffect(carregar, [carregar]);

  const alvo = situacao ? !situacao.liberado : true;
  const confirmar = async () => {
    setSalvando(true);
    try {
      const nova = await definirWfmParticipantes(alvo, justificativa);
      setSituacao(nova);
      setConfirmando(false);
      setJustificativa('');
      showToast(alvo ? 'Turnos e Plantões liberado para os participantes.' : 'Turnos e Plantões fechado para os participantes.', 'success');
      aoMudar?.();
    } catch (e) {
      showToast(e?.message || 'Não foi possível alterar a liberação.', 'error');
    } finally {
      setSalvando(false);
    }
  };

  const doAmbiente = situacao?.origem === 'ambiente';
  return html`
    <${Cartao} titulo="WFM para participantes">
      <p class="tec-ajuda tec-ajuda--topo">Libera Turnos e Plantões para Operador, Técnico de TI e Qualidade (fase de teste).</p>
      ${erro ? html`<div class="alert alert-warning" role="alert">${erro}</div>` : null}
      ${!situacao && !erro ? html`<${LoadingState} titulo="Carregando" />` : null}
      ${situacao ? html`
        <div class="tec-linha">
          <div class="tec-linha-texto"><strong>${situacao.liberado ? 'Liberado' : 'Fechado'}</strong></div>
          <span class=${`tec-pill ${doAmbiente ? 'is-aviso' : ''}`.trim()}>${doAmbiente ? 'origem: variável de ambiente' : 'origem: banco'}</span>
        </div>
        <button type="button" class="btn btn-primary" disabled=${!podeEditar || !situacao.editavel} onClick=${() => setConfirmando(true)}>
          ${doAmbiente ? 'Controlado pelo ambiente' : situacao.liberado ? 'Fechar para participantes…' : 'Liberar para participantes…'}
        </button>
        ${doAmbiente ? html`<p class="tec-ajuda">A variável de ambiente RH_WFM_LIBERAR_PARTICIPANTES está definida e prevalece. Remova-a do ambiente para usar este botão.</p>` : null}
        <p class="tec-ajuda">Ao liberar, só esses perfis refazem o login. A alteração fica registrada em auditoria (quem, quando, de → para).</p>` : null}
      <${ModalPadrao} aberto=${confirmando} titulo=${alvo ? 'Liberar Turnos e Plantões?' : 'Fechar Turnos e Plantões?'}
        subtitulo="Esta ação é registrada em auditoria." onClose=${() => setConfirmando(false)}>
        <div class="rh-details-body">
          <p>${alvo ? 'Operador, Técnico de TI e Qualidade passam a acessar o WFM e precisarão entrar de novo.' : 'Operador, Técnico de TI e Qualidade perdem o acesso ao WFM imediatamente.'}</p>
          <label class="tec-campo"><span>Justificativa (opcional)</span>
            <input class="form-control" value=${justificativa} maxlength="400" placeholder="ex.: início do piloto com a equipe de atendimento" onInput=${(e) => setJustificativa(e.target.value)} />
          </label>
        </div>
        <footer class="rh-modal-footer"><div class="rh-modal-footer-actions">
          <button type="button" class="btn btn-outline-secondary" onClick=${() => setConfirmando(false)}>Cancelar</button>
          <button type="button" class="btn btn-primary" disabled=${salvando} onClick=${confirmar}>${salvando ? 'Salvando…' : 'Confirmar'}</button>
        </div></footer>
      </${ModalPadrao}>
    </${Cartao}>`;
}

const ATALHOS = [
  { tela: 'screen-settings-users', icone: 'group', titulo: 'Usuários', texto: 'Criar, editar, bloquear e redefinir senha. O perfil Administrador só é alterado por Administrador.' },
  { tela: 'screen-settings-profiles', icone: 'admin_panel_settings', titulo: 'Perfis e permissões', texto: 'Permissões de todos os módulos, agrupadas por módulo.' },
  { tela: 'screen-settings-operations', icone: 'apartment', titulo: 'Operações', texto: 'Cadastro, tema e logo por operação, vínculos.' },
  { tela: TELA_MODULOS_TECNOLOGIA, icone: 'grid_view', titulo: 'Módulos', texto: 'Ativar e desativar RH e Operação. Núcleo e Tecnologia são protegidos.' },
  { tela: 'screen-settings-administracao', icone: 'verified_user', titulo: 'Parâmetros e integrações', texto: 'Microsoft 365, SharePoint e e-mail. Segredos ficam no servidor, não na tela.' },
  { tela: 'screen-settings-modelos-email', icone: 'tune', titulo: 'Catálogos e modelos', texto: 'Modelos de e-mail, motivos de eliminação e etapas.' },
  { tela: 'screen-settings-lgpd', icone: 'shield_lock', titulo: 'LGPD e retenção', texto: 'Aviso de privacidade, retenção e anonimização.' },
  { tela: 'screen-settings-logs', icone: 'history_edu', titulo: 'Auditoria', texto: 'Logs de acesso e de alterações, exportação.' },
  { tela: 'wfm', icone: 'calendar_month', titulo: 'Escalas e Plantões (TI)', texto: 'Tela do WFM filtrada pela operação TI — a mesma tela, sem cópia.' },
];

function Indicadores({ modulos, usuarios, wfm }) {
  const configuraveis = (modulos || []).filter((m) => !m.protegido);
  const ativos = configuraveis.filter((m) => m.ativo).length;
  const usuariosAtivos = Array.isArray(usuarios) ? usuarios.filter((u) => String(u.status || '').toLowerCase() === 'ativo').length : null;
  const bloqueados = Array.isArray(usuarios) ? usuarios.filter((u) => String(u.status || '').toLowerCase() === 'bloqueado').length : 0;
  return html`
    <div class="tec-kpis">
      <div class="tec-kpi"><span>Módulos ativos</span><strong>${modulos ? `${ativos} de ${configuraveis.length}` : '—'}</strong><small>RH e Operação (Núcleo e Tecnologia são fixos)</small></div>
      <div class="tec-kpi"><span>Usuários ativos</span><strong>${usuariosAtivos ?? '—'}</strong><small>${usuariosAtivos === null ? '' : `${bloqueados} bloqueado(s)`}</small></div>
      <div class="tec-kpi"><span>WFM para participantes</span><strong>${wfm ? (wfm.liberado ? 'Liberado' : 'Fechado') : '—'}</strong><small>${wfm?.origem === 'ambiente' ? 'controlado pelo ambiente' : 'fase de teste'}</small></div>
    </div>`;
}

function Inicio({ controlador, showToast }) {
  const [modulos, setModulos] = useState(null);
  const [usuarios, setUsuarios] = useState(null);
  const [wfm, setWfm] = useState(null);
  const [versao, setVersao] = useState(0);
  const podeEditar = controlador.possuiPermissao('configuracoes.editar');

  useEffect(() => {
    let ativo = true;
    listarModulosTecnologia().then((r) => ativo && setModulos(r)).catch(() => {});
    lerWfmParticipantes().then((r) => ativo && setWfm(r)).catch(() => {});
    if (controlador.possuiPermissao('usuarios.visualizar')) {
      listarUsuarios().then((r) => ativo && setUsuarios(Array.isArray(r) ? r : r?.itens || [])).catch(() => {});
    }
    return () => { ativo = false; };
  }, [versao, controlador]);

  const irPara = (tela) => controlador.irParaTelaProtegida(tela === 'wfm' ? telaWfmParaTecnologia(controlador.podeAcessarTela) : tela);
  const atalhos = ATALHOS.filter((a) => (a.tela === 'wfm' ? telaWfmParaTecnologia(controlador.podeAcessarTela) : controlador.podeAcessarTela(a.tela)));
  const recarregar = () => setVersao((v) => v + 1);

  return html`
    <${Indicadores} modulos=${modulos} usuarios=${usuarios} wfm=${wfm} />
    <h3 class="tec-secao">Áreas de administração</h3>
    <div class="tec-tiles">
      ${atalhos.map((a) => html`
        <button type="button" class="tec-tile" key=${a.titulo} onClick=${() => irPara(a.tela)}>
          <span class="tec-tile-icone material-symbols-outlined" aria-hidden="true">${IconeSvg(a.icone)}</span>
          <span class="tec-tile-texto"><strong>${a.titulo}</strong><small>${a.texto}</small></span>
        </button>`)}
    </div>
    <div class="tec-linha-cartoes">
      <${PainelModulos} podeEditar=${podeEditar} showToast=${showToast} aoMudar=${recarregar} />
      <${CartaoWfmParticipantes} podeEditar=${podeEditar} showToast=${showToast} aoMudar=${recarregar} />
    </div>`;
}

export function TelaTecnologia({ controlador, telaAtual = 'screen-tecnologia' }) {
  const { showToast, ToastHost } = useToast();
  const [titulo, descricao] = TITULOS[telaAtual] || TITULOS['screen-tecnologia'];
  const podeEditar = controlador.possuiPermissao('configuracoes.editar');
  const recarregar = () => {};
  return html`
    <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Tecnologia" placeholderBusca="Buscar" controlador=${controlador}>
      <div class="tec-toast"><${ToastHost} /></div>
      <${PageIntro} kicker="Tecnologia" title=${titulo} description=${descricao} tourId=${null} />
      <div class="tec-shell">
        ${telaAtual === TELA_MODULOS_TECNOLOGIA
          ? html`<div class="tec-linha-cartoes">
              <${PainelModulos} podeEditar=${podeEditar} showToast=${showToast} aoMudar=${recarregar} />
              <${CartaoWfmParticipantes} podeEditar=${podeEditar} showToast=${showToast} aoMudar=${recarregar} />
            </div>`
          : html`<${Inicio} controlador=${controlador} showToast=${showToast} />`}
      </div>
    </${PainelRh}>`;
}

