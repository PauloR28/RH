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
import {
  listarInfraestruturaCredenciais,
  listarParametrosSistema,
  resetarDadosConecta,
  salvarParametroSistema,
} from '../../services/api/sistema.js';

const MODULOS_DISPONIVEIS = [
  {
    tela: 'screen-settings-users',
    icone: 'person',
    titulo: 'Usuários',
    descricao: 'Criação de usuários, vínculo com operação e nível de acesso.',
    permissao: 'usuarios.visualizar',
  },
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
    tela: 'screen-settings-catalog',
    icone: 'inventory_2',
    titulo: 'Catálogos',
    descricao: 'Listas e regras reutilizáveis do sistema (motivos, status, modelos de e-mail).',
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

const FORM_PARAMETRO_INICIAL = {
  chave: '',
  descricao: '',
  valor: '',
  categoria: 'geral',
  mascarado: false,
};

const RESET_FRASE_CONFIRMACAO = 'LIMPAR CONECTA';

const GRUPOS_PARAMETRO = [
  { chave: 'sharepoint', label: 'SharePoint', icone: 'cloud_sync' },
  { chave: 'email', label: 'E-mail', icone: 'mail' },
  { chave: 'onedrive', label: 'OneDrive', icone: 'cloud' },
  { chave: 'outros', label: 'Outros', icone: 'tune' },
];

function classificarGrupoParametro(categoria) {
  const valor = String(categoria || '').toLowerCase();
  if (valor.includes('sharepoint') || valor.includes('intranet')) return 'sharepoint';
  if (valor.includes('email') || valor.includes('smtp')) return 'email';
  if (valor.includes('onedrive')) return 'onedrive';
  return 'outros';
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
  const [feedback, setFeedback] = useState('');
  const [erroCarregamento, setErroCarregamento] = useState('');

  const [modalNovoAberto, setModalNovoAberto] = useState(false);
  const [formNovo, setFormNovo] = useState(FORM_PARAMETRO_INICIAL);
  const [salvandoNovo, setSalvandoNovo] = useState(false);
  const [erroNovo, setErroNovo] = useState('');

  const [parametroEditando, setParametroEditando] = useState(null);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [erroEdicao, setErroEdicao] = useState('');

  const [modalResetAberto, setModalResetAberto] = useState(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podeVerConfiguracoes]);

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

  const confirmarResetConecta = async ({ justificativa }) => {
    const digitado = String(justificativa || '').trim().toUpperCase();
    if (digitado !== RESET_FRASE_CONFIRMACAO) {
      setErroReset(`Digite exatamente "${RESET_FRASE_CONFIRMACAO}" para confirmar.`);
      return;
    }
    setResetando(true);
    setErroReset('');
    try {
      await resetarDadosConecta(digitado);
      setModalResetAberto(false);
      setFeedback('Conecta zerado com sucesso. Recarregue a página para começar a reconfigurar o sistema.');
    } catch (error) {
      setErroReset(error?.message || 'Não foi possível limpar os dados do Conecta.');
    } finally {
      setResetando(false);
    }
  };

  const infraSharepoint = infra?.sharepoint;
  const infraEmail = infra?.email_smtp;

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
                        Cadastre abaixo cada intranet/site do SharePoint que recebe publicações do Conecta (uma linha por intranet).
                      </p>
                    `
          : null}
                ${grupo.chave === 'email'
          ? html`
                      <div class="rh-def-list mb-3">
                        ${carregandoInfra
              ? html`<p class="text-muted mb-0">Carregando status da integração...</p>`
              : html`
                                <${LinhaDef} label="Host SMTP" valor=${infraEmail?.host} />
                                <${LinhaDef}
                                  label="Senha SMTP"
                                  valor=${infraEmail?.senha_configurada ? 'Configurada' : ''}
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

                ${modoEdicaoParametros && podeEditarConfiguracoes
          ? html`
                      <button
                        type="button"
                        class="btn btn-outline-primary btn-sm mt-3"
                        onClick=${() => {
              setFormNovo({ ...FORM_PARAMETRO_INICIAL, categoria: grupo.chave === 'outros' ? 'geral' : grupo.chave });
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
      subtituloMarca="Administração do Conecta"
      placeholderBusca="Administração"
      controlador=${controlador}
    >
      <${PageIntro}
        kicker="Configurações"
        title="Administração"
        description=""
      />

      ${feedback ? html`<div class="alert alert-success">${feedback}</div>` : null}
      ${erroCarregamento ? html`<div class="alert alert-danger">${erroCarregamento}</div>` : null}

      <${Tabs}
        tabs=${[
        { key: 'modulos', label: 'Módulos' },
        ...(podeVerConfiguracoes ? [{ key: 'parametros', label: 'Parâmetros' }] : []),
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
                title="Parâmetros"
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
                  Apaga todos os dados operacionais (usuários exceto administradores, processos,
                  candidatos, provas, treinamentos, operações) — não pode ser desfeito.
                </p>
                <button type="button" class="btn btn-danger" onClick=${() => {
          setErroReset('');
          setModalResetAberto(true);
        }}>
                  <span class="material-symbols-outlined">${IconeSvg('delete_forever')}</span>
                  Limpar o Conecta
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

      <${ModalConfirmacaoAcao}
        aberto=${modalResetAberto}
        titulo="Limpar o Conecta"
        descricao="Esta ação apaga os dados operacionais do Conecta e não pode ser desfeita."
        consequencia="Usuários (exceto administradores), processos seletivos, candidatos, banco de talentos, provas, treinamentos, slots/agendamentos, operações e trilhas pré-definidas serão removidos."
        reversibilidade="Não é possível desfazer esta ação depois de confirmada."
        labelJustificativa=${`Digite "${RESET_FRASE_CONFIRMACAO}" para confirmar`}
        justificativaObrigatoria=${true}
        textoConfirmar="Limpar dados agora"
        tipo="destrutivo"
        carregando=${resetando}
        erro=${erroReset}
        onClose=${() => setModalResetAberto(false)}
        onConfirm=${confirmarResetConecta}
      />
    </${PainelRh}>
  `;
}
