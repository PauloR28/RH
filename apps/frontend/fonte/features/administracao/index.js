import { html, useEffect, useState } from '../../infraestrutura-react.js';
import {
  EmptyState,
  ModalConfirmacaoAcao,
  ModalPadrao,
  PageIntro,
  PainelRh,
  SectionCard,
  Tabs,
  TabPanel,
} from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import { MenuAcoesProcesso } from '../../ui/components/menu-acoes.js';
import { ToggleSwitch } from '../../ui/components/primitives.js';
import {
  atualizarAmbienteSharePoint,
  excluirAmbienteSharePoint,
  listarAmbientesSharePoint,
  listarCategoriasReset,
  listarInfraestruturaCredenciais,
  listarParametrosSistema,
  resetarDadosConecta,
  salvarParametroSistema,
  testarAmbienteSharePoint,
} from '../../services/api/sistema.js';
import { listarOperacoes } from '../../services/api/operations.js';

// Redesign 10/set/2026 (achado transversal nº3): mesmo padrão contorno+
// ponto (rh-status-pill) usado em administracao/novo-ambiente.js.
const STATUS_BADGE_AMBIENTE = {
  conectado: { label: 'Conectado', classe: 'is-finished' },
  pendente: { label: 'Pendente de teste', classe: 'is-pending' },
  erro: { label: 'Erro na conexão', classe: 'is-unsaved' },
};

const MODULOS_DISPONIVEIS = [
  {
    tela: 'screen-settings-profiles',
    icone: 'admin_panel_settings',
    titulo: 'Perfis e permissões',
    descricao: 'Regras de acesso por perfil (Administrador, Gestor, RH, Supervisor).',
    permissao: 'configuracoes.visualizar',
  },
  {
    tela: 'screen-settings-operations',
    icone: 'apartment',
    titulo: 'Operações',
    descricao: 'Cadastro de operações e produtos usados em processos, provas e treinamentos.',
    permissao: 'configuracoes.visualizar',
  },
  {
    tela: 'screen-settings-logs',
    icone: 'history_edu',
    titulo: 'Logs',
    descricao: 'Trilha de auditoria das ações realizadas no Conecta.',
    permissao: 'logs.visualizar',
  },
];

const FORM_AMBIENTE_INICIAL = {
  operacao_id: '',
  nome: '',
  site_url: '',
  biblioteca_destino: '',
};

const FORM_PARAMETRO_INICIAL = {
  chave: '',
  descricao: '',
  valor: '',
  categoria: 'geral',
  mascarado: false,
};

const RESET_FRASE_CONFIRMACAO = 'LIMPAR CONECTA';

const GRUPOS_PARAMETRO = [
  { chave: 'sharepoint', label: 'SharePoint', icone: 'sync' },
  { chave: 'email', label: 'E-mail', icone: 'mail' },
  { chave: 'onedrive', label: 'OneDrive', icone: 'cloud' },
];

function classificarGrupoParametro(categoria) {
  const valor = String(categoria || '').toLowerCase();
  if (valor.includes('sharepoint') || valor.includes('intranet')) return 'sharepoint';
  if (valor.includes('email') || valor.includes('smtp')) return 'email';
  if (valor.includes('onedrive')) return 'onedrive';
  return '';
}

function LinhaDef({ label, valor, indefinido = 'Não configurado', mascarado = false }) {
  return html`
    <div class="rh-def-row">
      <span>${label}</span>
      <strong>
        ${mascarado ? html`<span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('lock')}</span>` : null}
        ${valor || html`<em>${indefinido}</em>`}
      </strong>
    </div>
  `;
}

function ModalEditarParametro({ parametro, onClose, onSave, salvando, erro }) {
  const [valor, setValor] = useState('');
  const [confirmo, setConfirmo] = useState(false);
  const [revelarValor, setRevelarValor] = useState(false);

  useEffect(() => {
    if (parametro) {
      setValor(parametro.valor || '');
      setConfirmo(false);
      setRevelarValor(false);
    }
  }, [parametro]);

  if (!parametro) return null;

  return html`
    <${ModalPadrao}
      aberto=${Boolean(parametro)}
      titulo="Editar parâmetro"
      subtitulo=${parametro.descricao || parametro.chave}
      onClose=${salvando ? () => null : onClose}
    >
      <div class="rh-action-modal-body">
        <label class="form-label">Chave</label>
        <input type="text" class="form-control mb-3" value=${parametro.chave} disabled />

        <label class="form-label">Valor</label>
        <div class="input-group mb-3">
          <input
            type=${parametro.mascarado && !revelarValor ? 'password' : 'text'}
            class="form-control"
            value=${valor}
            disabled=${salvando}
            onInput=${(event) => setValor(event.target.value)}
          />
          ${parametro.mascarado
      ? html`
                <button
                  type="button"
                  class="btn btn-outline-secondary"
                  onClick=${() => setRevelarValor((v) => !v)}
                >
                  <span class="material-symbols-outlined">${IconeSvg(revelarValor ? 'visibility_off' : 'visibility')}</span>
                </button>
              `
      : null}
        </div>

        <div class="form-check">
          <input
            class="form-check-input"
            type="checkbox"
            id="rh-confirma-edicao-parametro"
            checked=${confirmo}
            disabled=${salvando}
            onChange=${(event) => setConfirmo(event.target.checked)}
          />
          <label class="form-check-label" for="rh-confirma-edicao-parametro">
            Tenho certeza que quero alterar este parâmetro.
          </label>
        </div>
        ${erro ? html`<div class="alert alert-danger mt-3 mb-0">${erro}</div>` : null}
      </div>
      <footer class="rh-modal-footer">
        <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${onClose}>
          Cancelar
        </button>
        <button
          type="button"
          class="btn btn-primary"
          disabled=${salvando || !confirmo}
          onClick=${() => onSave(valor)}
        >
          ${salvando ? 'Salvando...' : 'Salvar'}
        </button>
      </footer>
    </${ModalPadrao}>
  `;
}

export function TelaAdministracao({ controlador }) {
  const modulosVisiveis = MODULOS_DISPONIVEIS.filter(
    (item) => !item.permissao || controlador?.possuiPermissao?.(item.permissao),
  );
  const podeVerConfiguracoes = Boolean(controlador?.possuiPermissao?.('configuracoes.visualizar'));
  const podeEditarConfiguracoes = Boolean(controlador?.possuiPermissao?.('configuracoes.editar'));
  const ehAdministrador = controlador?.estado?.perfilUsuario === 'administrador';

  const [parametros, setParametros] = useState([]);
  const [carregandoParametros, setCarregandoParametros] = useState(true);
  const [infra, setInfra] = useState(null);
  const [carregandoInfra, setCarregandoInfra] = useState(true);
  const [ambientesSharepoint, setAmbientesSharepoint] = useState([]);
  const [carregandoAmbientes, setCarregandoAmbientes] = useState(true);
  const [operacoesAmbiente, setOperacoesAmbiente] = useState([]);
  const [ambienteEditando, setAmbienteEditando] = useState(null);
  const [formEdicaoAmbiente, setFormEdicaoAmbiente] = useState(FORM_AMBIENTE_INICIAL);
  const [salvandoEdicaoAmbiente, setSalvandoEdicaoAmbiente] = useState(false);
  const [erroEdicaoAmbiente, setErroEdicaoAmbiente] = useState('');
  const [testandoAmbienteId, setTestandoAmbienteId] = useState(null);
  const [ambienteRemover, setAmbienteRemover] = useState(null);
  const [removendoAmbiente, setRemovendoAmbiente] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [erroCarregamento, setErroCarregamento] = useState('');

  const [modalNovoAberto, setModalNovoAberto] = useState(false);
  const [formNovo, setFormNovo] = useState(FORM_PARAMETRO_INICIAL);
  const [salvandoNovo, setSalvandoNovo] = useState(false);
  const [erroNovo, setErroNovo] = useState('');

  const [parametroEditando, setParametroEditando] = useState(null);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [erroEdicao, setErroEdicao] = useState('');

  const [categoriasReset, setCategoriasReset] = useState([]);
  const [carregandoCategoriasReset, setCarregandoCategoriasReset] = useState(false);
  const [modalCategoriasResetAberto, setModalCategoriasResetAberto] = useState(false);
  const [categoriasResetSelecionadas, setCategoriasResetSelecionadas] = useState({});
  const [categoriasResetDesbloqueadas, setCategoriasResetDesbloqueadas] = useState(false);

  const [modalResetAberto, setModalResetAberto] = useState(false);
  const [senhaReset, setSenhaReset] = useState('');
  const [resetando, setResetando] = useState(false);
  const [erroReset, setErroReset] = useState('');

  const [abaAdminAtiva, setAbaAdminAtiva] = useState('modulos');
  const [modoEdicaoParametros, setModoEdicaoParametros] = useState(false);
  const [categoriaAberta, setCategoriaAberta] = useState(null);

  useEffect(() => {
    if (!modoEdicaoParametros) return undefined;
    const avisarSaida = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', avisarSaida);
    return () => window.removeEventListener('beforeunload', avisarSaida);
  }, [modoEdicaoParametros]);

  const trocarAbaAdmin = (chave) => {
    if (modoEdicaoParametros) {
      setFeedback('');
      setErroCarregamento('Finalize a edição dos Parâmetros (Concluir ou Cancelar) antes de mudar de aba.');
      return;
    }
    setErroCarregamento('');
    setAbaAdminAtiva(chave);
  };

  const carregarParametros = async () => {
    setCarregandoParametros(true);
    try {
      const resultado = await listarParametrosSistema();
      setParametros(Array.isArray(resultado?.itens) ? resultado.itens : []);
    } catch (error) {
      setErroCarregamento(error?.message || 'Não foi possível carregar os parâmetros do Conecta.');
    } finally {
      setCarregandoParametros(false);
    }
  };

  useEffect(() => {
    if (!podeVerConfiguracoes) return;
    carregarParametros();
    (async () => {
      setCarregandoInfra(true);
      try {
        const resultado = await listarInfraestruturaCredenciais();
        setInfra(resultado);
      } catch (error) {
        setErroCarregamento(error?.message || 'Não foi possível carregar o status das integrações.');
      } finally {
        setCarregandoInfra(false);
      }
    })();
    carregarAmbientesSharepoint();
    listarOperacoes()
      .then((resultado) => setOperacoesAmbiente(Array.isArray(resultado) ? resultado : resultado?.itens || []))
      .catch(() => setOperacoesAmbiente([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podeVerConfiguracoes]);

  const carregarAmbientesSharepoint = async () => {
    setCarregandoAmbientes(true);
    try {
      const resultado = await listarAmbientesSharePoint();
      setAmbientesSharepoint(Array.isArray(resultado?.itens) ? resultado.itens : []);
    } catch (error) {
      setErroCarregamento(error?.message || 'Não foi possível carregar os ambientes cadastrados.');
    } finally {
      setCarregandoAmbientes(false);
    }
  };

  const abrirEdicaoAmbiente = (ambiente) => {
    setAmbienteEditando(ambiente);
    setFormEdicaoAmbiente({
      operacao_id: ambiente.operacao_id ? String(ambiente.operacao_id) : '',
      nome: ambiente.nome || '',
      site_url: ambiente.site_url || '',
      biblioteca_destino: ambiente.biblioteca_destino || '',
    });
    setErroEdicaoAmbiente('');
  };

  const salvarEdicaoAmbiente = async () => {
    if (!ambienteEditando) return;
    if (!formEdicaoAmbiente.nome.trim() || !formEdicaoAmbiente.site_url.trim()) {
      setErroEdicaoAmbiente('Informe o nome do ambiente e a URL do site do SharePoint.');
      return;
    }
    setSalvandoEdicaoAmbiente(true);
    setErroEdicaoAmbiente('');
    try {
      await atualizarAmbienteSharePoint(ambienteEditando.id_ambiente, {
        nome: formEdicaoAmbiente.nome.trim(),
        operacao_id: formEdicaoAmbiente.operacao_id ? Number(formEdicaoAmbiente.operacao_id) : null,
        site_url: formEdicaoAmbiente.site_url.trim(),
        biblioteca_destino: formEdicaoAmbiente.biblioteca_destino.trim(),
      });
      setAmbienteEditando(null);
      setFeedback('Ambiente atualizado. Teste a conexão novamente para validar as novas credenciais.');
      await carregarAmbientesSharepoint();
    } catch (error) {
      setErroEdicaoAmbiente(error?.message || 'Não foi possível atualizar este ambiente.');
    } finally {
      setSalvandoEdicaoAmbiente(false);
    }
  };

  const testarAmbienteExistente = async (ambiente) => {
    setTestandoAmbienteId(ambiente.id_ambiente);
    setErroCarregamento('');
    try {
      const teste = await testarAmbienteSharePoint(ambiente.id_ambiente);
      setFeedback(
        teste?.success
          ? `Conexão com "${ambiente.nome}" validada com sucesso.`
          : `Não foi possível validar "${ambiente.nome}": ${teste?.mensagem || 'verifique a URL informada.'}`,
      );
      await carregarAmbientesSharepoint();
    } catch (error) {
      setErroCarregamento(error?.message || 'Não foi possível testar a conexão deste ambiente.');
    } finally {
      setTestandoAmbienteId(null);
    }
  };

  const confirmarRemocaoAmbiente = async ({ justificativa }) => {
    if (!ambienteRemover) return;
    setRemovendoAmbiente(true);
    try {
      await excluirAmbienteSharePoint(ambienteRemover.id_ambiente, justificativa);
      setAmbienteRemover(null);
      setFeedback('Ambiente removido.');
      await carregarAmbientesSharepoint();
    } catch (error) {
      setErroCarregamento(error?.message || 'Não foi possível remover este ambiente.');
    } finally {
      setRemovendoAmbiente(false);
    }
  };

  const salvarNovoParametro = async () => {
    if (!formNovo.chave.trim()) {
      setErroNovo('Informe uma chave para o parâmetro.');
      return;
    }
    setSalvandoNovo(true);
    setErroNovo('');
    try {
      await salvarParametroSistema(formNovo.chave.trim(), {
        valor: formNovo.valor,
        categoria: formNovo.categoria || 'geral',
        descricao: formNovo.descricao,
        mascarado: formNovo.mascarado,
      });
      setModalNovoAberto(false);
      setFormNovo(FORM_PARAMETRO_INICIAL);
      setFeedback('Parâmetro criado com sucesso.');
      await carregarParametros();
    } catch (error) {
      setErroNovo(error?.message || 'Não foi possível criar o parâmetro.');
    } finally {
      setSalvandoNovo(false);
    }
  };

  const salvarEdicaoParametro = async (novoValor) => {
    if (!parametroEditando) return;
    setSalvandoEdicao(true);
    setErroEdicao('');
    try {
      await salvarParametroSistema(parametroEditando.chave, {
        valor: novoValor,
        categoria: parametroEditando.categoria,
        descricao: parametroEditando.descricao,
        mascarado: parametroEditando.mascarado,
      });
      setParametroEditando(null);
      setFeedback('Parâmetro atualizado com sucesso.');
      await carregarParametros();
    } catch (error) {
      setErroEdicao(error?.message || 'Não foi possível atualizar o parâmetro.');
    } finally {
      setSalvandoEdicao(false);
    }
  };

  const abrirModalCategoriasReset = async () => {
    setErroReset('');
    setCategoriasResetDesbloqueadas(false);
    setModalCategoriasResetAberto(true);
    if (categoriasReset.length) return;
    setCarregandoCategoriasReset(true);
    try {
      const resultado = await listarCategoriasReset();
      const itens = Array.isArray(resultado?.categorias) ? resultado.categorias : [];
      setCategoriasReset(itens);
      setCategoriasResetSelecionadas(
        Object.fromEntries(itens.map((item) => [item.chave, true])),
      );
    } catch (error) {
      setErroCarregamento(error?.message || 'Não foi possível carregar as categorias da Zona de risco.');
    } finally {
      setCarregandoCategoriasReset(false);
    }
  };

  const avancarParaConfirmacaoReset = () => {
    const selecionadas = Object.entries(categoriasResetSelecionadas).filter(([, marcado]) => marcado);
    if (!selecionadas.length) {
      setErroReset('Selecione ao menos uma categoria de dados para limpar.');
      return;
    }
    setModalCategoriasResetAberto(false);
    setSenhaReset('');
    setErroReset('');
    setModalResetAberto(true);
  };

  const confirmarResetConecta = async ({ justificativa }) => {
    const digitado = String(justificativa || '').trim().toUpperCase();
    if (digitado !== RESET_FRASE_CONFIRMACAO) {
      setErroReset(`Digite exatamente "${RESET_FRASE_CONFIRMACAO}" para confirmar.`);
      return;
    }
    if (!senhaReset) {
      setErroReset('Digite sua senha para confirmar que é você quem está realizando esta ação.');
      return;
    }
    const categorias = Object.entries(categoriasResetSelecionadas)
      .filter(([, marcado]) => marcado)
      .map(([chave]) => chave);
    setResetando(true);
    setErroReset('');
    try {
      await resetarDadosConecta({ confirmacao: digitado, senha: senhaReset, categorias });
      setModalResetAberto(false);
      setSenhaReset('');
      setFeedback('Dados selecionados removidos com sucesso. Recarregue a página para continuar.');
    } catch (error) {
      setErroReset(error?.message || 'Não foi possível limpar os dados do Conecta.');
    } finally {
      setResetando(false);
    }
  };

  const infraSharepoint = infra?.sharepoint;
  const infraEmail = infra?.email_smtp;
  const infraEmailInbox = infra?.email_inbox;

  const renderizarGrupoParametro = (grupo) => {
    const itensGrupo = parametros.filter((item) => classificarGrupoParametro(item.categoria) === grupo.chave);
    const aberto = categoriaAberta === grupo.chave;
    return html`
      <div class="rh-admin-accordion" key=${grupo.chave}>
        <button
          type="button"
          class="rh-admin-accordion-header"
          aria-expanded=${aberto}
          onClick=${() => setCategoriaAberta(aberto ? null : grupo.chave)}
        >
          <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(grupo.icone)}</span>
          <span class="rh-admin-accordion-title">${grupo.label}</span>
          <span class="rh-admin-accordion-count">${itensGrupo.length}</span>
          <span class="material-symbols-outlined rh-admin-accordion-chevron" aria-hidden="true">
            ${IconeSvg(aberto ? 'expand_less' : 'expand_more')}
          </span>
        </button>
        ${aberto
      ? html`
              <div class="rh-admin-accordion-body">
                ${grupo.chave === 'sharepoint'
          ? html`
                      <div class="rh-def-list mb-3">
                        ${carregandoInfra
              ? html`<p class="text-muted mb-0">Carregando status da integração...</p>`
              : html`
                                <${LinhaDef} label="Tenant ID" valor=${infraSharepoint?.tenant_id} mascarado=${true} />
                                <${LinhaDef} label="Client ID" valor=${infraSharepoint?.client_id} mascarado=${true} />
                                <${LinhaDef}
                                  label="Client secret"
                                  valor=${infraSharepoint?.client_secret_configurado ? 'Configurado' : ''}
                                  mascarado=${true}
                                />
                                <${LinhaDef} label="Escopo" valor=${infraSharepoint?.scope} />
                              `}
                      </div>
                      <p class="rh-admin-hint">
                        Cada linha abaixo é um "ambiente": a ligação entre o Conecta e a intranet (site SharePoint)
                        de uma operação, usada pelo Mural para publicar simultaneamente.
                      </p>
                      ${carregandoAmbientes
              ? html`<p class="text-muted mb-0">Carregando ambientes...</p>`
              : ambientesSharepoint.length
                ? html`
                              <div class="table-responsive mb-3">
                                <table class="table rh-table-compact align-middle mb-0">
                                  <thead>
                                    <tr>
                                      <th>Nome</th>
                                      <th>Operação</th>
                                      <th>Site</th>
                                      <th>Status</th>
                                      ${modoEdicaoParametros && podeEditarConfiguracoes ? html`<th></th>` : null}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    ${ambientesSharepoint.map((ambiente) => {
                    const infoStatus = STATUS_BADGE_AMBIENTE[ambiente.status] || STATUS_BADGE_AMBIENTE.pendente;
                    return html`
                                        <tr key=${ambiente.id_ambiente}>
                                          <td>${ambiente.nome}</td>
                                          <td>${ambiente.operacao_nome || html`<em>Sem operação</em>`}</td>
                                          <td><code>${ambiente.hostname}${ambiente.site_path}</code></td>
                                          <td>
                                            <span class=${`rh-status-pill ${infoStatus.classe}`}>${infoStatus.label}</span>
                                            ${ambiente.status === 'erro' && ambiente.ultima_mensagem_teste
                        ? html`<div class="form-text mb-0">${ambiente.ultima_mensagem_teste}</div>`
                        : null}
                                          </td>
                                          ${modoEdicaoParametros && podeEditarConfiguracoes
                        ? html`
                                                <td class="text-end">
                                                  <${MenuAcoesProcesso}
                                                    ariaLabel="Ações do ambiente"
                                                    acoes=${[
                            {
                              key: 'editar',
                              label: 'Editar conexão',
                              icon: 'edit',
                              onClick: () => abrirEdicaoAmbiente(ambiente),
                            },
                            {
                              key: 'testar',
                              label: testandoAmbienteId === ambiente.id_ambiente ? 'Testando...' : 'Testar novamente',
                              icon: 'sync',
                              disabled: testandoAmbienteId === ambiente.id_ambiente,
                              onClick: () => testarAmbienteExistente(ambiente),
                            },
                            {
                              key: 'excluir',
                              label: 'Excluir conexão',
                              icon: 'delete',
                              danger: true,
                              onClick: () => setAmbienteRemover(ambiente),
                            },
                          ]}
                                                  />
                                                </td>
                                              `
                        : null}
                                        </tr>
                                      `;
                  })}
                                  </tbody>
                                </table>
                              </div>
                            `
                : html`<p class="text-muted small mb-3">Nenhum ambiente cadastrado ainda.</p>`}
                    `
          : null}
                ${grupo.chave === 'email'
          ? html`
                      <div class="rh-def-list mb-3">
                        ${carregandoInfra
              ? html`<p class="text-muted mb-0">Carregando status da integração...</p>`
              : html`
                                <${LinhaDef} label="Envio habilitado (SMTP)" valor=${infraEmail?.habilitado ? 'Sim' : 'Não'} />
                                <${LinhaDef} label="Host SMTP" valor=${infraEmail?.host} />
                                <${LinhaDef} label="Porta SMTP" valor=${infraEmail?.porta ? String(infraEmail.porta) : ''} />
                                <${LinhaDef} label="Usuário SMTP" valor=${infraEmail?.usuario} mascarado=${true} />
                                <${LinhaDef}
                                  label="Senha SMTP"
                                  valor=${infraEmail?.senha_configurada ? 'Configurada' : ''}
                                  mascarado=${true}
                                />
                                <${LinhaDef} label="Remetente" valor=${infraEmail?.remetente} />
                                <${LinhaDef} label="Usa TLS" valor=${infraEmail?.usa_tls ? 'Sim' : 'Não'} />
                                <${LinhaDef} label="Usa SSL" valor=${infraEmail?.usa_ssl ? 'Sim' : 'Não'} />
                              `}
                      </div>
                      <p class="rh-admin-hint">Caixa de entrada (recebimento de currículos por e-mail):</p>
                      <div class="rh-def-list mb-3">
                        ${carregandoInfra
              ? html`<p class="text-muted mb-0">Carregando status da integração...</p>`
              : html`
                                <${LinhaDef} label="Recebimento habilitado" valor=${infraEmailInbox?.habilitado ? 'Sim' : 'Não'} />
                                <${LinhaDef} label="Protocolo" valor=${infraEmailInbox?.protocolo} />
                                <${LinhaDef} label="Provedor" valor=${infraEmailInbox?.provedor} />
                                <${LinhaDef} label="Endereço monitorado" valor=${infraEmailInbox?.endereco} mascarado=${true} />
                                <${LinhaDef} label="Caixa" valor=${infraEmailInbox?.caixa} />
                                <${LinhaDef} label="Tenant ID (Graph)" valor=${infraEmailInbox?.tenant_id} mascarado=${true} />
                                <${LinhaDef} label="Client ID (Graph)" valor=${infraEmailInbox?.client_id} mascarado=${true} />
                                <${LinhaDef}
                                  label="Client secret (Graph)"
                                  valor=${infraEmailInbox?.client_secret_configurado ? 'Configurado' : ''}
                                  mascarado=${true}
                                />
                              `}
                      </div>
                    `
          : null}
                ${grupo.chave === 'onedrive'
          ? html`
                      <p class="rh-admin-hint">
                        O OneDrive usa o mesmo aplicativo Microsoft (Graph) configurado em SharePoint — nenhuma credencial adicional é necessária aqui.
                      </p>
                    `
          : null}

                ${carregandoParametros
          ? html`<p class="text-muted mb-0">Carregando parâmetros...</p>`
          : itensGrupo.length
            ? html`
                      <div class="table-responsive">
                        <table class="table rh-table-compact align-middle mb-0">
                          <thead>
                            <tr>
                              <th>Chave</th>
                              <th>Descrição</th>
                              <th>Valor</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            ${itensGrupo.map(
              (item) => html`
                                <tr key=${item.chave}>
                                  <td><code>${item.chave}</code></td>
                                  <td>${item.descricao || '-'}</td>
                                  <td>${item.mascarado ? '••••••••' : item.valor || '-'}</td>
                                  <td class="text-end">
                                    ${modoEdicaoParametros && podeEditarConfiguracoes
                  ? html`
                                          <button
                                            type="button"
                                            class="btn btn-outline-secondary btn-sm"
                                            onClick=${() => setParametroEditando(item)}
                                          >
                                            <span class="material-symbols-outlined">${IconeSvg('lock')}</span>
                                            Editar
                                          </button>
                                        `
                  : null}
                                  </td>
                                </tr>
                              `,
            )}
                          </tbody>
                        </table>
                      </div>
                    `
            : html`<p class="text-muted small mb-0">Nenhum parâmetro cadastrado nesta categoria ainda.</p>`}

                ${modoEdicaoParametros && podeEditarConfiguracoes && grupo.chave === 'sharepoint'
          ? html`
                      <button
                        type="button"
                        class="btn btn-outline-primary btn-sm mt-3"
                        onClick=${() => controlador.irParaTelaProtegida('screen-settings-sharepoint-ambiente')}
                      >
                        <span class="material-symbols-outlined">${IconeSvg('link')}</span>
                        Adicionar ambiente
                      </button>
                    `
          : null}
                ${modoEdicaoParametros && podeEditarConfiguracoes && grupo.chave === 'email'
          ? html`
                      <button
                        type="button"
                        class="btn btn-outline-primary btn-sm mt-3"
                        onClick=${() => {
              setFormNovo({ ...FORM_PARAMETRO_INICIAL, categoria: grupo.chave });
              setErroNovo('');
              setModalNovoAberto(true);
            }}
                      >
                        <span class="material-symbols-outlined">${IconeSvg('add')}</span>
                        Novo parâmetro
                      </button>
                    `
          : null}
              </div>
            `
      : null}
      </div>
    `;
  };

  return html`
    <${PainelRh}
      screenId="screen-settings-administracao"
      navAtiva="screen-settings-administracao"
      subtituloMarca="Parâmetros do Conecta"
      placeholderBusca="Parâmetros"
      controlador=${controlador}
    >
      <${PageIntro}
        kicker="Configurações"
        title="Parâmetros"
        description=""
      />

      ${feedback ? html`<div class="alert alert-success">${feedback}</div>` : null}
      ${erroCarregamento ? html`<div class="alert alert-danger">${erroCarregamento}</div>` : null}

      <${Tabs}
        tabs=${[
        { key: 'modulos', label: 'Módulos' },
        ...(podeVerConfiguracoes ? [{ key: 'parametros', label: 'Conectores Externos' }] : []),
        ...(ehAdministrador ? [{ key: 'risco', label: 'Zona de risco' }] : []),
      ]}
        activeKey=${abaAdminAtiva}
        onChange=${trocarAbaAdmin}
      />

      <${TabPanel} tabKey="modulos" activeKey=${abaAdminAtiva}>
        <${SectionCard} title="Módulos administrativos" className="rh-section-card--flat">
          <div class="rh-admin-module-list">
            ${modulosVisiveis.length
      ? modulosVisiveis.map(
        (item) => html`
                  <button
                    key=${item.tela}
                    type="button"
                    class="rh-admin-module-row"
                    onClick=${() => controlador.irParaTelaProtegida(item.tela)}
                  >
                    <span class="material-symbols-outlined rh-admin-module-icon" aria-hidden="true">${IconeSvg(item.icone)}</span>
                    <span class="rh-admin-module-copy">
                      <strong>${item.titulo}</strong>
                      <small>${item.descricao}</small>
                    </span>
                    <span class="material-symbols-outlined rh-admin-module-arrow" aria-hidden="true">${IconeSvg('chevron_right')}</span>
                  </button>
                `,
      )
      : html`<p class="text-muted mb-0">Você não possui permissão para acessar módulos administrativos.</p>`}
          </div>
        </${SectionCard}>
      </${TabPanel}>

      ${podeVerConfiguracoes
      ? html`
            <${TabPanel} tabKey="parametros" activeKey=${abaAdminAtiva}>
              <${SectionCard}
                title="Conectores Externos"
                className="rh-section-card--flat"
                actions=${podeEditarConfiguracoes
          ? modoEdicaoParametros
            ? html`
                          <div class="rh-admin-edit-actions">
                            <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setModoEdicaoParametros(false)}>
                              Cancelar
                            </button>
                            <button type="button" class="btn btn-primary btn-sm" onClick=${() => setModoEdicaoParametros(false)}>
                              Concluir edição
                            </button>
                          </div>
                        `
            : html`
                          <button type="button" class="btn btn-outline-primary btn-sm" onClick=${() => setModoEdicaoParametros(true)}>
                            <span class="material-symbols-outlined">${IconeSvg('edit')}</span>
                            Editar
                          </button>
                        `
          : null}
              >
                <p class="rh-admin-hint">
                  Configurações de negócio (SharePoint, e-mail, OneDrive, intranets) que antes dependiam do código, organizadas por integração. Segredos do <code>.env</code> ficam só no servidor.
                </p>
                ${modoEdicaoParametros
          ? html`<p class="rh-admin-edit-banner">Modo de edição ativo — conclua ou cancele para navegar para outra aba.</p>`
          : null}

                <div class="rh-admin-param-groups">
                  ${GRUPOS_PARAMETRO.map(renderizarGrupoParametro)}
                </div>
              </${SectionCard}>
            </${TabPanel}>
          `
      : null}

      ${ehAdministrador
      ? html`
            <${TabPanel} tabKey="risco" activeKey=${abaAdminAtiva}>
              <${SectionCard} title="Zona de risco" className="rh-section-card--flat rh-danger-zone">
                <p class="rh-admin-hint">
                  Remove permanentemente os dados operacionais do Conecta que você escolher abaixo —
                  não pode ser desfeito. Você poderá revisar e alterar exatamente o que será apagado
                  antes de confirmar.
                </p>
                <button type="button" class="btn btn-danger" onClick=${abrirModalCategoriasReset}>
                  <span class="material-symbols-outlined">${IconeSvg('delete_forever')}</span>
                  Aplicar
                </button>
              </${SectionCard}>
            </${TabPanel}>
          `
      : null}

      <${ModalEditarParametro}
        parametro=${parametroEditando}
        onClose=${() => setParametroEditando(null)}
        onSave=${salvarEdicaoParametro}
        salvando=${salvandoEdicao}
        erro=${erroEdicao}
      />

      <${ModalPadrao}
        aberto=${modalNovoAberto}
        titulo="Novo parâmetro"
        subtitulo="Configuração de negócio do Conecta — não use para segredos de infraestrutura."
        onClose=${salvandoNovo ? () => null : () => setModalNovoAberto(false)}
      >
        <div class="rh-action-modal-body">
          <label class="form-label">Chave</label>
          <input
            type="text"
            class="form-control mb-3"
            placeholder="ex.: sharepoint.site_url"
            value=${formNovo.chave}
            disabled=${salvandoNovo}
            onInput=${(event) => setFormNovo((valor) => ({ ...valor, chave: event.target.value }))}
          />
          <label class="form-label">Descrição</label>
          <input
            type="text"
            class="form-control mb-3"
            value=${formNovo.descricao}
            disabled=${salvandoNovo}
            onInput=${(event) => setFormNovo((valor) => ({ ...valor, descricao: event.target.value }))}
          />
          <label class="form-label">Valor</label>
          <input
            type="text"
            class="form-control mb-3"
            value=${formNovo.valor}
            disabled=${salvandoNovo}
            onInput=${(event) => setFormNovo((valor) => ({ ...valor, valor: event.target.value }))}
          />
          <div class="form-check mb-2">
            <input
              class="form-check-input"
              type="checkbox"
              id="rh-novo-parametro-mascarado"
              checked=${formNovo.mascarado}
              disabled=${salvandoNovo}
              onChange=${(event) => setFormNovo((valor) => ({ ...valor, mascarado: event.target.checked }))}
            />
            <label class="form-check-label" for="rh-novo-parametro-mascarado">
              Mascarar valor na listagem (para dados sensíveis não-infra)
            </label>
          </div>
          ${erroNovo ? html`<div class="alert alert-danger mt-2 mb-0">${erroNovo}</div>` : null}
        </div>
        <footer class="rh-modal-footer">
          <button type="button" class="btn btn-outline-secondary" disabled=${salvandoNovo} onClick=${() => setModalNovoAberto(false)}>
            Cancelar
          </button>
          <button type="button" class="btn btn-primary" disabled=${salvandoNovo} onClick=${salvarNovoParametro}>
            ${salvandoNovo ? 'Salvando...' : 'Salvar'}
          </button>
        </footer>
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${Boolean(ambienteEditando)}
        titulo="Editar conexão"
        subtitulo="Altere o nome, a operação vinculada ou a URL do site do SharePoint desta intranet."
        onClose=${salvandoEdicaoAmbiente ? () => null : () => setAmbienteEditando(null)}
      >
        <div class="rh-action-modal-body">
          <label class="form-label">Operação vinculada</label>
          <select
            class="form-select mb-3"
            value=${formEdicaoAmbiente.operacao_id}
            disabled=${salvandoEdicaoAmbiente}
            onChange=${(event) => setFormEdicaoAmbiente((valor) => ({ ...valor, operacao_id: event.target.value }))}
          >
            <option value="">Selecione a operação (opcional)</option>
            ${operacoesAmbiente.map(
        (operacao) => html`
                <option key=${operacao.id_item} value=${operacao.id_item}>${operacao.nome}</option>
              `,
      )}
          </select>

          <label class="form-label">Nome do ambiente</label>
          <input
            type="text"
            class="form-control mb-3"
            value=${formEdicaoAmbiente.nome}
            disabled=${salvandoEdicaoAmbiente}
            onInput=${(event) => setFormEdicaoAmbiente((valor) => ({ ...valor, nome: event.target.value }))}
          />

          <label class="form-label">URL do site SharePoint</label>
          <input
            type="text"
            class="form-control mb-1"
            placeholder="https://suaempresa.sharepoint.com/sites/NomeDoSite"
            value=${formEdicaoAmbiente.site_url}
            disabled=${salvandoEdicaoAmbiente}
            onInput=${(event) => setFormEdicaoAmbiente((valor) => ({ ...valor, site_url: event.target.value }))}
          />
          <p class="form-text mb-3">Cole a URL completa do site, como aparece no navegador.</p>

          <label class="form-label">Biblioteca/pasta de destino (opcional)</label>
          <input
            type="text"
            class="form-control mb-1"
            value=${formEdicaoAmbiente.biblioteca_destino}
            disabled=${salvandoEdicaoAmbiente}
            onInput=${(event) => setFormEdicaoAmbiente((valor) => ({ ...valor, biblioteca_destino: event.target.value }))}
          />
          <p class="form-text mb-0">
            Alterar a URL invalida o último teste de conexão — use "Testar novamente" depois de salvar.
          </p>
          ${erroEdicaoAmbiente ? html`<div class="alert alert-danger mt-2 mb-0">${erroEdicaoAmbiente}</div>` : null}
        </div>
        <footer class="rh-modal-footer">
          <button type="button" class="btn btn-outline-secondary" disabled=${salvandoEdicaoAmbiente} onClick=${() => setAmbienteEditando(null)}>
            Cancelar
          </button>
          <button type="button" class="btn btn-primary" disabled=${salvandoEdicaoAmbiente} onClick=${salvarEdicaoAmbiente}>
            ${salvandoEdicaoAmbiente ? 'Salvando...' : 'Salvar'}
          </button>
        </footer>
      </${ModalPadrao}>

      <${ModalConfirmacaoAcao}
        aberto=${Boolean(ambienteRemover)}
        titulo="Remover ambiente"
        descricao=${`Deseja remover o ambiente "${ambienteRemover?.nome || ''}"?`}
        consequencia="O Mural deixará de publicar nesta intranet até que um novo ambiente seja cadastrado."
        reversibilidade="É possível cadastrar este ambiente novamente a qualquer momento."
        textoConfirmar="Remover ambiente"
        tipo="destrutivo"
        carregando=${removendoAmbiente}
        onClose=${() => setAmbienteRemover(null)}
        onConfirm=${confirmarRemocaoAmbiente}
      />

      <${ModalPadrao}
        aberto=${modalCategoriasResetAberto}
        titulo="Aplicar — o que será removido"
        subtitulo="Revise o que será apagado. Use Alterar seleção para escolher exatamente o que remover."
        onClose=${() => setModalCategoriasResetAberto(false)}
        className="rh-action-modal rh-action-modal--destrutivo"
      >
        <div class="rh-action-modal-body">
          ${carregandoCategoriasReset
      ? html`<p class="text-muted mb-0">Carregando categorias...</p>`
      : html`
                <div class="rh-reset-category-toolbar">
                  <span class="text-muted small">
                    ${categoriasResetDesbloqueadas
            ? 'Selecione as categorias que serão removidas.'
            : 'Por padrão, tudo é removido. Clique em "Alterar seleção" para escolher.'}
                  </span>
                  <button
                    type="button"
                    class="btn btn-outline-secondary btn-sm"
                    onClick=${() => setCategoriasResetDesbloqueadas((atual) => !atual)}
                  >
                    <span class="material-symbols-outlined">${IconeSvg(categoriasResetDesbloqueadas ? 'lock' : 'edit')}</span>
                    ${categoriasResetDesbloqueadas ? 'Concluir seleção' : 'Alterar seleção'}
                  </button>
                </div>
                <ul class="rh-reset-category-list">
                  ${categoriasReset.map(
        (categoria) => html`
                      <li key=${categoria.chave} class=${`rh-reset-category-item ${categoriasResetSelecionadas[categoria.chave] ? 'is-active' : ''}`.trim()}>
                        <${ToggleSwitch}
                          checked=${Boolean(categoriasResetSelecionadas[categoria.chave])}
                          disabled=${!categoriasResetDesbloqueadas}
                          onChange=${() =>
              setCategoriasResetSelecionadas((atual) => ({
                ...atual,
                [categoria.chave]: !atual[categoria.chave],
              }))}
                        />
                        <span class="settings-permission-copy">
                          <strong>${categoria.label}</strong>
                          ${categoria.total_tabelas != null
            ? html`<small>${categoria.total_tabelas} tabela(s)</small>`
            : null}
                        </span>
                      </li>
                    `,
      )}
                </ul>
              `}
          ${erroReset ? html`<div class="alert alert-danger mt-3 mb-0">${erroReset}</div>` : null}
        </div>
        <footer class="rh-modal-footer">
          <button type="button" class="btn btn-outline-secondary" onClick=${() => setModalCategoriasResetAberto(false)}>
            Cancelar
          </button>
          <button type="button" class="btn btn-danger" onClick=${avancarParaConfirmacaoReset}>
            Aplicar
          </button>
        </footer>
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${modalResetAberto}
        titulo="Confirme sua identidade"
        subtitulo="Esta ação não pode ser desfeita. Confirme digitando a frase abaixo e sua senha."
        onClose=${resetando ? () => null : () => setModalResetAberto(false)}
        className="rh-action-modal rh-action-modal--destrutivo"
      >
        <${FormularioConfirmacaoReset}
          resetando=${resetando}
          erro=${erroReset}
          senha=${senhaReset}
          onSenha=${setSenhaReset}
          onConfirm=${confirmarResetConecta}
        />
      </${ModalPadrao}>
    </${PainelRh}>
  `;
}

function FormularioConfirmacaoReset({ resetando, erro, senha, onSenha, onConfirm }) {
  const [frase, setFrase] = useState('');

  return html`
    <div class="rh-action-modal-body">
      <p class="rh-action-modal-consequence">
        Os dados das categorias selecionadas serão removidos permanentemente. Certifique-se de que é
        realmente você o Administrador realizando esta ação.
      </p>
      <label class="form-label" for="rh-reset-frase">Digite "${RESET_FRASE_CONFIRMACAO}" para confirmar</label>
      <input
        id="rh-reset-frase"
        class="form-control mb-3"
        value=${frase}
        disabled=${resetando}
        onInput=${(event) => setFrase(event.target.value)}
      />
      <label class="form-label" for="rh-reset-senha">Sua senha</label>
      <input
        id="rh-reset-senha"
        type="password"
        class="form-control mb-1"
        value=${senha}
        disabled=${resetando}
        onInput=${(event) => onSenha(event.target.value)}
        autocomplete="current-password"
      />
      ${erro ? html`<div class="alert alert-danger mt-3 mb-0">${erro}</div>` : null}
    </div>
    <footer class="rh-modal-footer">
      <button
        type="button"
        class="btn btn-danger"
        disabled=${resetando}
        onClick=${() => onConfirm({ justificativa: frase })}
      >
        ${resetando ? 'Aplicando...' : 'Aplicar agora'}
      </button>
    </footer>
  `;
}
