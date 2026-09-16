import { html, useEffect, useState } from '../../infraestrutura-react.js';
import {
  EmptyState,
  ModalConfirmacaoAcao,
  ModalPadrao,
  PageIntro,
  PainelRh,
  SectionCard,
} from '../../ui/componentes-compartilhados.js';
import { Badge, ToggleSwitch } from '../../ui/components/primitives.js';
import { IconeSvg } from '../../ui/icone.js';
import {
  atualizarItemConfiguracao,
  criarItemConfiguracao,
  desativarItemConfiguracao,
  excluirItemConfiguracao,
  listarCatalogoConfiguracoes,
} from '../../services/api/settings.js';

// Correções.txt item 5: LGPD e Retenção, Motivos de Eliminação, Modelos de
// E-mail e Etapas do Processo saem do switcher interno de Operações e viram
// páginas próprias — mas continuam lendo/gravando as MESMAS tabelas de
// catálogo genérico já usadas por Operações (settings.catalog/{tipo}), já
// que nenhuma tem FK ou schema especial (ver auditoria antes desta rodada).
// Este componente é compartilhado pelas 4 páginas para não duplicar o
// CRUD de lista+formulário quatro vezes.

function dividirCsv(valor) {
  return String(valor || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizarLista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function formInicial(config) {
  const base = { id_item: '', nome: '', descricao: '', ativo: true };
  config.camposExtras.forEach((campo) => {
    base[campo.chave] = campo.inicial ?? '';
  });
  return base;
}

export function TelaCatalogoDedicado({ controlador, config }) {
  const podeEditar = controlador.possuiPermissao(config.permissaoEditar || 'configuracoes.editar');
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [feedback, setFeedback] = useState('');
  const [form, setForm] = useState(() => formInicial(config));
  const [salvando, setSalvando] = useState(false);
  const [itemRemover, setItemRemover] = useState(null);
  const [removendo, setRemovendo] = useState(false);
  const [itemExcluir, setItemExcluir] = useState(null);
  const [excluindo, setExcluindo] = useState(false);
  const [modalFormAberto, setModalFormAberto] = useState(false);

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    try {
      const resultado = await listarCatalogoConfiguracoes();
      const secao = (resultado?.sections || []).find((item) => item.tipo === config.tipo);
      const lista = Array.isArray(secao?.items) ? secao.items : [];
      setItens(config.ordenar ? config.ordenar(lista) : lista);
    } catch (error) {
      setErro(error?.message || 'Não foi possível carregar os itens.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(''), 4000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const limparForm = () => setForm(formInicial(config));

  const abrirNovo = () => {
    limparForm();
    setErro('');
    setModalFormAberto(true);
  };

  const editarItem = (item) => {
    const preenchido = {
      id_item: item.id_item,
      nome: item.nome || '',
      descricao: item.descricao || '',
      ativo: Boolean(item.ativo),
    };
    config.camposExtras.forEach((campo) => {
      preenchido[campo.chave] = campo.doPayload
        ? campo.doPayload(item.payload || {})
        : (item.payload || {})[campo.chave] ?? campo.inicial ?? '';
    });
    setForm(preenchido);
    setErro('');
    setModalFormAberto(true);
  };

  const alternarAtivo = async (item) => {
    setErro('');
    try {
      await atualizarItemConfiguracao(config.tipo, item.id_item, {
        chave: item.chave,
        nome: item.nome,
        descricao: item.descricao,
        categoria: item.categoria || config.tipo,
        payload: item.payload || {},
        ativo: !item.ativo,
        justificativa: `${item.ativo ? 'Desativado' : 'Ativado'} em ${config.titulo}.`,
      });
      setFeedback(`${config.rotuloItem || 'Item'} ${item.ativo ? 'desativado' : 'ativado'}.`);
      await carregar();
    } catch (error) {
      setErro(error?.message || 'Não foi possível alterar o status deste item.');
    }
  };

  const confirmarExclusao = async ({ justificativa }) => {
    if (!itemExcluir) return;
    setExcluindo(true);
    try {
      await excluirItemConfiguracao(config.tipo, itemExcluir.id_item, justificativa);
      setItemExcluir(null);
      setFeedback(`${config.rotuloItem || 'Item'} excluído.`);
      await carregar();
    } catch (error) {
      setErro(error?.message || 'Não foi possível excluir este item.');
    } finally {
      setExcluindo(false);
    }
  };

  const salvar = async (event) => {
    event.preventDefault();
    if (!form.nome.trim()) {
      setErro('Informe um nome.');
      return;
    }
    setSalvando(true);
    setErro('');
    try {
      let payload = {};
      config.camposExtras.forEach((campo) => {
        payload[campo.chave] = campo.paraPayload ? campo.paraPayload(form[campo.chave]) : form[campo.chave];
      });
      if (config.payloadExtra) {
        payload = { ...payload, ...config.payloadExtra(form, { itens }) };
      }
      const data = {
        chave: String(form.nome || '')
          .trim()
          .toUpperCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^A-Z0-9]+/g, '_')
          .replace(/^_+|_+$/g, ''),
        nome: form.nome,
        descricao: form.descricao,
        categoria: config.tipo,
        payload,
        ativo: form.ativo,
        justificativa: form.id_item ? `${config.rotuloItem || 'Item'} atualizado em ${config.titulo}.` : `${config.rotuloItem || 'Item'} criado em ${config.titulo}.`,
      };
      if (form.id_item) {
        await atualizarItemConfiguracao(config.tipo, form.id_item, data);
        setFeedback(`${config.rotuloItem || 'Item'} atualizado com sucesso.`);
      } else {
        await criarItemConfiguracao(config.tipo, data);
        setFeedback(`${config.rotuloItem || 'Item'} criado com sucesso.`);
      }
      limparForm();
      setModalFormAberto(false);
      await carregar();
    } catch (error) {
      setErro(error?.message || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const confirmarRemocao = async ({ justificativa }) => {
    if (!itemRemover) return;
    setRemovendo(true);
    try {
      await desativarItemConfiguracao(config.tipo, itemRemover.id_item, justificativa);
      setItemRemover(null);
      setFeedback(`${config.rotuloItem || 'Item'} arquivado.`);
      await carregar();
    } catch (error) {
      setErro(error?.message || 'Não foi possível arquivar este item.');
    } finally {
      setRemovendo(false);
    }
  };

  const mover = config.podeReordenar
    ? async (item, direcao) => {
      const indice = itens.findIndex((atual) => atual.id_item === item.id_item);
      const alvo = indice + direcao;
      if (alvo < 0 || alvo >= itens.length) return;
      const atual = itens[indice];
      const vizinho = itens[alvo];
      const ordemAtual = atual.payload?.ordem ?? indice;
      const ordemVizinho = vizinho.payload?.ordem ?? alvo;
      setSalvando(true);
      setErro('');
      try {
        await atualizarItemConfiguracao(config.tipo, atual.id_item, {
          chave: atual.chave,
          nome: atual.nome,
          descricao: atual.descricao,
          categoria: atual.categoria || config.tipo,
          ativo: atual.ativo,
          payload: { ...atual.payload, ordem: ordemVizinho },
          justificativa: `Reordenado em ${config.titulo}.`,
        });
        await atualizarItemConfiguracao(config.tipo, vizinho.id_item, {
          chave: vizinho.chave,
          nome: vizinho.nome,
          descricao: vizinho.descricao,
          categoria: vizinho.categoria || config.tipo,
          ativo: vizinho.ativo,
          payload: { ...vizinho.payload, ordem: ordemAtual },
          justificativa: `Reordenado em ${config.titulo}.`,
        });
        await carregar();
      } catch (error) {
        setErro(error?.message || 'Não foi possível reordenar.');
      } finally {
        setSalvando(false);
      }
    }
    : null;

  const acoesTopo = podeEditar
    ? html`
        <button type="button" class="btn btn-primary" onClick=${abrirNovo}>
          <${IconeSvgSpan} name="add" /> Adicionar ${config.rotuloItem || 'item'}
        </button>
      `
    : null;

  return html`
    <${PainelRh} screenId=${config.screenId} navAtiva=${config.navAtiva} controlador=${controlador} placeholderBusca=${config.titulo}>
      <${PageIntro} kicker=${config.kicker || 'Configurações'} title=${config.titulo} description=${config.descricao || ''} actions=${acoesTopo} />

      ${feedback ? html`<div class="alert alert-success">${feedback}</div>` : null}
      ${erro ? html`<div class="alert alert-danger">${erro}</div>` : null}

      <${ModalPadrao}
        aberto=${modalFormAberto}
        titulo=${form.id_item ? `Editar ${config.rotuloItem || 'item'}` : `${config.generoFeminino ? 'Nova' : 'Novo'} ${config.rotuloItem || 'item'}`}
        onClose=${() => { setModalFormAberto(false); limparForm(); setErro(''); }}
      >
        <form class="c24-form-grid" onSubmit=${salvar}>
          <label>
            <span>Nome</span>
            <input
              class="form-control"
              required
              disabled=${!podeEditar}
              value=${form.nome}
              onInput=${(event) => setForm((valor) => ({ ...valor, nome: event.target.value }))}
            />
          </label>
          <label class="users-toggle-row">
            <span>${form.ativo ? 'Ativo' : 'Inativo'}</span>
            <${ToggleSwitch}
              checked=${form.ativo}
              disabled=${!podeEditar}
              onChange=${() => setForm((valor) => ({ ...valor, ativo: !valor.ativo }))}
            />
          </label>
          <label class="is-wide">
            <span>Descrição</span>
            <textarea
              class="form-control"
              rows="2"
              disabled=${!podeEditar}
              value=${form.descricao}
              onInput=${(event) => setForm((valor) => ({ ...valor, descricao: event.target.value }))}
            ></textarea>
          </label>
          ${config.camposExtras.map(
      (campo) => html`
              <label class=${campo.wide ? 'is-wide' : ''} key=${campo.chave}>
                <span>${campo.label}</span>
                ${campo.tipo === 'textarea'
          ? html`
                      <textarea
                        class="form-control"
                        rows=${campo.linhas || 3}
                        disabled=${!podeEditar}
                        placeholder=${campo.placeholder || ''}
                        value=${form[campo.chave]}
                        onInput=${(event) => setForm((valor) => ({ ...valor, [campo.chave]: event.target.value }))}
                      ></textarea>
                    `
          : html`
                      <input
                        class="form-control"
                        type=${campo.tipo === 'url' ? 'url' : 'text'}
                        disabled=${!podeEditar}
                        placeholder=${campo.placeholder || ''}
                        value=${form[campo.chave]}
                        onInput=${(event) => setForm((valor) => ({ ...valor, [campo.chave]: event.target.value }))}
                      />
                    `}
                ${campo.helper ? html`<small class="text-muted">${campo.helper}</small>` : null}
              </label>
            `,
    )}
          ${config.variaveisDisponiveis?.length
      ? html`
                <div class="is-wide rh-variable-hint">
                  <span class="rh-variable-hint-label">Variáveis disponíveis (clique para inserir no corpo do e-mail):</span>
                  <div class="rh-variable-hint-chips">
                    ${config.variaveisDisponiveis.map(
          (variavel) => html`
                        <button
                          type="button"
                          class="rh-variable-chip"
                          disabled=${!podeEditar}
                          title=${variavel.label}
                          onClick=${() =>
              setForm((valor) => ({
                ...valor,
                [config.campoInsercaoVariavel]: `${valor[config.campoInsercaoVariavel] || ''}{${variavel.chave}}`,
              }))}
                        >
                          {${variavel.chave}}
                        </button>
                      `,
        )}
                  </div>
                </div>
              `
      : null}
          <footer class="settings-form-footer is-wide">
            <button type="submit" class="btn btn-primary" disabled=${salvando || !podeEditar}>
              <${IconeSvgSpan} name="check" /> ${salvando ? 'Salvando...' : 'Salvar'}
            </button>
            <button type="button" class="btn btn-outline-secondary" onClick=${() => { setModalFormAberto(false); limparForm(); }}>Cancelar</button>
          </footer>
        </form>
      </${ModalPadrao}>

      <${SectionCard} title="Itens cadastrados" className="rh-section-card--flat">
        ${carregando
      ? html`<p class="text-muted mb-0">Carregando...</p>`
      : itens.length
        ? html`
                <div class="table-responsive">
                  <table class="table rh-table-compact align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Nome</th>
                        <th>Descrição</th>
                        <th>Ativo</th>
                        <th class="text-end">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${itens.map(
          (item, indice) => html`
                          <tr key=${item.id_item}>
                            <td>${item.nome}</td>
                            <td>${item.descricao || '-'}</td>
                            <td>
                              ${config.podeExcluir
              ? html`
                                    <${ToggleSwitch}
                                      checked=${Boolean(item.ativo)}
                                      disabled=${!podeEditar}
                                      onChange=${() => alternarAtivo(item)}
                                    />
                                  `
              : html`<${Badge} label=${item.ativo ? 'Ativo' : 'Inativo'} tone=${item.ativo ? 'success' : 'secondary'} />`}
                            </td>
                            <td class="text-end">
                              ${podeEditar
              ? html`
                                    <div class="rh-row-actions-inline">
                                      ${mover
                ? html`
                                            <button
                                              type="button"
                                              class="btn btn-outline-secondary btn-sm"
                                              title="Mover para cima"
                                              disabled=${indice === 0}
                                              onClick=${() => mover(item, -1)}
                                            >
                                              <span class="material-symbols-outlined">${IconeSvg('arrow_upward')}</span>
                                            </button>
                                            <button
                                              type="button"
                                              class="btn btn-outline-secondary btn-sm"
                                              title="Mover para baixo"
                                              disabled=${indice === itens.length - 1}
                                              onClick=${() => mover(item, 1)}
                                            >
                                              <span class="material-symbols-outlined">${IconeSvg('arrow_downward')}</span>
                                            </button>
                                          `
                : null}
                                      <button
                                        type="button"
                                        class="btn btn-outline-secondary btn-sm"
                                        title="Editar"
                                        onClick=${() => editarItem(item)}
                                      >
                                        <span class="material-symbols-outlined">${IconeSvg('edit')}</span>
                                      </button>
                                      ${config.podeExcluir
                ? html`
                                            <button
                                              type="button"
                                              class="btn btn-outline-danger btn-sm"
                                              title="Excluir"
                                              onClick=${() => setItemExcluir(item)}
                                            >
                                              <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                                            </button>
                                          `
                : html`
                                            <button
                                              type="button"
                                              class="btn btn-outline-danger btn-sm"
                                              title="Arquivar"
                                              disabled=${!item.ativo}
                                              onClick=${() => setItemRemover(item)}
                                            >
                                              <span class="material-symbols-outlined">${IconeSvg('archive')}</span>
                                            </button>
                                          `}
                                    </div>
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
        : html`
                <${EmptyState}
                  icon="inventory_2"
                  title="Sem itens"
                  text=${`Cadastre o primeiro item em "${config.titulo}".`}
                />
              `}
      </${SectionCard}>

      <${ModalConfirmacaoAcao}
        aberto=${Boolean(itemRemover)}
        titulo=${`Arquivar ${config.rotuloItem || 'item'}`}
        descricao=${`Deseja arquivar "${itemRemover?.nome || ''}"?`}
        consequencia="O item deixa de aparecer como opção ativa, mas pode ser reativado depois (não é removido fisicamente)."
        reversibilidade="É possível reativar este item a qualquer momento."
        textoConfirmar="Arquivar"
        tipo="destrutivo"
        carregando=${removendo}
        onClose=${() => setItemRemover(null)}
        onConfirm=${confirmarRemocao}
      />

      <${ModalConfirmacaoAcao}
        aberto=${Boolean(itemExcluir)}
        titulo=${`Excluir ${config.rotuloItem || 'item'}`}
        descricao=${`Deseja excluir "${itemExcluir?.nome || ''}" definitivamente?`}
        consequencia="O item é removido por completo do catálogo. Registros que já usaram este valor no passado não são alterados, mas ele deixa de existir como opção daqui pra frente."
        reversibilidade="Esta ação não pode ser desfeita."
        textoConfirmar="Excluir"
        tipo="destrutivo"
        carregando=${excluindo}
        onClose=${() => setItemExcluir(null)}
        onConfirm=${confirmarExclusao}
      />
    </${PainelRh}>
  `;
}

function IconeSvgSpan({ name }) {
  return html`<span class="material-symbols-outlined">${IconeSvg(name)}</span>`;
}

const CONFIG_LGPD = {
  tipo: 'lgpd',
  screenId: 'screen-settings-lgpd',
  navAtiva: 'screen-settings-lgpd',
  titulo: 'LGPD e Retenção',
  descricao: 'Documentação de proteção de dados e política de retenção da empresa.',
  rotuloItem: 'documento',
  camposExtras: [
    {
      chave: 'link_documento',
      label: 'Link do documento',
      tipo: 'url',
      wide: true,
      placeholder: 'https://...',
      helper: 'Link do arquivo hospedado no SharePoint, OneDrive ou Drive-Conecta — mesmo padrão já usado na Central de Documentos (sem upload direto de arquivo).',
    },
  ],
};

const CONFIG_MOTIVOS_ELIMINACAO = {
  tipo: 'motivos_eliminacao',
  screenId: 'screen-settings-motivos-eliminacao',
  navAtiva: 'screen-settings-motivos-eliminacao',
  titulo: 'Motivos de Eliminação',
  descricao: 'Motivos usados ao eliminar um candidato de um processo seletivo.',
  rotuloItem: 'motivo',
  podeExcluir: true,
  camposExtras: [
    {
      chave: 'sub_causas_texto',
      label: 'Sub-causas (opcional)',
      tipo: 'text',
      wide: true,
      placeholder: 'Separadas por vírgula. Ex.: Não atendeu ligação, Cancelou por WhatsApp, Não justificou',
      helper: 'Aparecem como detalhamento opcional ao eliminar um candidato com este motivo.',
      inicial: '',
      doPayload: (payload) => normalizarLista(payload.sub_causas).join(', '),
      paraPayload: (valor) => dividirCsv(valor),
    },
  ],
};

const CONFIG_MODELOS_EMAIL = {
  tipo: 'modelos_email',
  screenId: 'screen-settings-modelos-email',
  navAtiva: 'screen-settings-modelos-email',
  titulo: 'Modelos de E-mail',
  descricao: 'Modelos prontos, selecionáveis sempre que uma mensagem for enviada por e-mail no Conecta.',
  rotuloItem: 'modelo',
  podeExcluir: true,
  campoInsercaoVariavel: 'corpo_html',
  variaveisDisponiveis: [
    { chave: 'nome_candidato', label: 'Nome do candidato' },
    { chave: 'vaga', label: 'Vaga/processo seletivo' },
    { chave: 'dia', label: 'Dia da entrevista/convocação' },
    { chave: 'horario', label: 'Horário da entrevista/convocação' },
    { chave: 'local', label: 'Local da entrevista' },
    { chave: 'empresa', label: 'Nome da empresa' },
  ],
  camposExtras: [
    { chave: 'assunto', label: 'Assunto', tipo: 'text', wide: true, placeholder: 'Assunto padrão do e-mail' },
    {
      chave: 'corpo_html',
      label: 'Corpo do e-mail',
      tipo: 'textarea',
      wide: true,
      linhas: 8,
      placeholder: 'Texto do e-mail. Use variáveis como {nome_candidato}, {dia} e {horario} — elas são preenchidas manualmente ou, quando o modelo é usado em resposta a um processo seletivo, automaticamente com os dados do candidato.',
      helper: 'As variáveis usam chave simples: {nome_candidato}, {dia}, {horario}. Veja a lista completa abaixo.',
    },
  ],
};

const CONFIG_ETAPAS = {
  tipo: 'etapas',
  screenId: 'screen-settings-etapas',
  navAtiva: 'screen-settings-etapas',
  titulo: 'Etapas do Processo',
  descricao: 'Etapas disponíveis para compor um processo seletivo, na ordem em que devem ser exibidas.',
  rotuloItem: 'etapa',
  generoFeminino: true,
  podeReordenar: true,
  ordenar: (lista) => [...lista].sort((a, b) => Number(a.payload?.ordem ?? 0) - Number(b.payload?.ordem ?? 0)),
  payloadExtra: (form, { itens }) => ({
    ordem: form.id_item
      ? itens.find((item) => String(item.id_item) === String(form.id_item))?.payload?.ordem ?? itens.length
      : itens.length,
  }),
  camposExtras: [],
};

function TelaEmConstrucao({ controlador, screenId, navAtiva, titulo }) {
  return html`
    <${PainelRh} screenId=${screenId} navAtiva=${navAtiva} controlador=${controlador} placeholderBusca=${titulo}>
      <${PageIntro} kicker="Configurações" title=${titulo} description="" />
      <${EmptyState}
        icon="construction"
        title="Página ainda em construção"
        text="Em breve novas atualizações."
      />
    </${PainelRh}>
  `;
}

// Correções.txt item 6: LGPD e Retenção desativada (página + link no menu).
export function TelaLgpd({ controlador }) {
  return html`
    <${TelaEmConstrucao}
      controlador=${controlador}
      screenId=${CONFIG_LGPD.screenId}
      navAtiva=${CONFIG_LGPD.navAtiva}
      titulo=${CONFIG_LGPD.titulo}
    />
  `;
}

export function TelaMotivosEliminacao({ controlador }) {
  return html`<${TelaCatalogoDedicado} controlador=${controlador} config=${CONFIG_MOTIVOS_ELIMINACAO} />`;
}

export function TelaModelosEmail({ controlador }) {
  return html`<${TelaCatalogoDedicado} controlador=${controlador} config=${CONFIG_MODELOS_EMAIL} />`;
}

// Correções.txt item 3: Etapas do processo travada até novo aviso.
export function TelaEtapasProcesso({ controlador }) {
  return html`
    <${TelaEmConstrucao}
      controlador=${controlador}
      screenId=${CONFIG_ETAPAS.screenId}
      navAtiva=${CONFIG_ETAPAS.navAtiva}
      titulo=${CONFIG_ETAPAS.titulo}
    />
  `;
}
