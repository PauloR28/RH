import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import {
  atualizarTemplateDocumento,
  criarTemplateDocumento,
  excluirTemplateDocumento,
  gerarDocumentoPorTemplate,
  listarTemplatesDocumentos,
  listarVariaveisTemplatesDocumentos,
} from '../../servico-api.js';
import {
  atualizarDocumentoBiblioteca,
  criarDocumentoBiblioteca,
  excluirDocumentoBiblioteca,
  listarDocumentosBiblioteca,
} from '../../services/api/documentos-biblioteca.js';
import {
  EmptyState,
  ModalPadrao,
  PageIntro,
  PainelRh,
  SectionCard,
} from '../../ui/componentes-compartilhados.js';
import { TabelaVazia } from '../../shared/components/empty-table-row.js';
import { SkeletonTableRows } from '../../shared/components/skeleton.js';
import { IconeSvg } from '../../ui/icone.js';
import { GuiaProcessos } from '../ajuda/guia.js?v=20260921-ajuda';

const FORM_INICIAL = { id_template: '', titulo: '', corpo_texto: '', ativo: true };
const FORM_DOC_INICIAL = { id_documento: '', titulo: '', topico: '', area: '', descricao: '', url_arquivo: '', ativo: true };

export function TelaTemplatesDocumentos({ controlador }) {
  const [aba, setAba] = useState('guia');
  const [templates, setTemplates] = useState([]);
  const [variaveis, setVariaveis] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState('');

  const podeVerBiblioteca = controlador.possuiPermissao('documentos_biblioteca.visualizar');
  const podeEditarBiblioteca = controlador.possuiPermissao('documentos_biblioteca.editar');
  const [documentos, setDocumentos] = useState([]);
  const [carregandoDocs, setCarregandoDocs] = useState(podeVerBiblioteca);
  const [erroDocs, setErroDocs] = useState('');
  const [modalDocAberto, setModalDocAberto] = useState(false);
  const [formDoc, setFormDoc] = useState(FORM_DOC_INICIAL);
  const [salvandoDoc, setSalvandoDoc] = useState(false);
  const [erroFormDoc, setErroFormDoc] = useState('');
  const [topicosAbertos, setTopicosAbertos] = useState(() => new Set());

  const alternarTopico = (topico) => {
    setTopicosAbertos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(topico)) {
        proximo.delete(topico);
      } else {
        proximo.add(topico);
      }
      return proximo;
    });
  };

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    try {
      const [templatesResp, variaveisResp] = await Promise.all([
        listarTemplatesDocumentos(),
        listarVariaveisTemplatesDocumentos(),
      ]);
      setTemplates(Array.isArray(templatesResp) ? templatesResp : []);
      setVariaveis(Array.isArray(variaveisResp) ? variaveisResp : []);
    } catch (error) {
      setErro(error?.message || 'Não foi possível carregar os templates de documentos.');
    } finally {
      setCarregando(false);
    }
  };

  const carregarDocumentos = async () => {
    if (!podeVerBiblioteca) return;
    setCarregandoDocs(true);
    setErroDocs('');
    try {
      const resposta = await listarDocumentosBiblioteca();
      setDocumentos(Array.isArray(resposta) ? resposta : []);
    } catch (error) {
      setErroDocs(error?.message || 'Não foi possível carregar a biblioteca de documentos.');
    } finally {
      setCarregandoDocs(false);
    }
  };

  useEffect(() => {
    carregar();
    carregarDocumentos();
  }, []);

  // Abre o primeiro tópico por padrão assim que a biblioteca carrega, para
  // a tela não nascer com tudo recolhido.
  useEffect(() => {
    if (documentos.length && topicosAbertos.size === 0) {
      const primeiro = documentos[0]?.topico || 'Outros';
      setTopicosAbertos(new Set([primeiro]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentos]);

  const documentosPorTopico = useMemo(() => {
    const grupos = new Map();
    documentos.forEach((item) => {
      const chave = item.topico || 'Outros';
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(item);
    });
    return Array.from(grupos.entries()).sort(([a], [b]) => a.localeCompare(b, 'pt-BR'));
  }, [documentos]);

  const abrirNovoDoc = () => {
    setFormDoc(FORM_DOC_INICIAL);
    setErroFormDoc('');
    setModalDocAberto(true);
  };

  const abrirEdicaoDoc = (item) => {
    setFormDoc({
      id_documento: item.id_documento,
      titulo: item.titulo || '',
      topico: item.topico || '',
      area: item.area || '',
      descricao: item.descricao || '',
      url_arquivo: item.url_arquivo || '',
      ativo: !!item.ativo,
    });
    setErroFormDoc('');
    setModalDocAberto(true);
  };

  const fecharDoc = () => {
    setModalDocAberto(false);
    setFormDoc(FORM_DOC_INICIAL);
    setErroFormDoc('');
  };

  const salvarDoc = async () => {
    setErroFormDoc('');
    const payload = {
      titulo: formDoc.titulo.trim(),
      topico: formDoc.topico.trim(),
      area: formDoc.area.trim(),
      descricao: formDoc.descricao.trim(),
      url_arquivo: formDoc.url_arquivo.trim(),
      ativo: !!formDoc.ativo,
    };

    setSalvandoDoc(true);
    try {
      if (formDoc.id_documento) {
        await atualizarDocumentoBiblioteca(formDoc.id_documento, payload);
      } else {
        await criarDocumentoBiblioteca(payload);
      }
      fecharDoc();
      await carregarDocumentos();
    } catch (error) {
      setErroFormDoc(error?.message || 'Não foi possível salvar o documento.');
    } finally {
      setSalvandoDoc(false);
    }
  };

  const excluirDoc = async (item) => {
    if (!window.confirm(`Excluir o documento "${item.titulo}"?`)) return;
    try {
      await excluirDocumentoBiblioteca(item.id_documento);
      await carregarDocumentos();
    } catch (error) {
      setErroDocs(error?.message || 'Não foi possível excluir o documento.');
    }
  };

  const abrirNovo = () => {
    setForm(FORM_INICIAL);
    setErroForm('');
    setModalAberto(true);
  };

  const abrirEdicao = (item) => {
    setForm({
      id_template: item.id_template,
      titulo: item.titulo || '',
      corpo_texto: item.corpo_texto || '',
      ativo: !!item.ativo,
    });
    setErroForm('');
    setModalAberto(true);
  };

  const fechar = () => {
    setModalAberto(false);
    setForm(FORM_INICIAL);
    setErroForm('');
  };

  const salvar = async () => {
    setErroForm('');
    const payload = {
      titulo: form.titulo.trim(),
      corpo_texto: form.corpo_texto.trim(),
      ativo: !!form.ativo,
    };

    setSalvando(true);
    try {
      if (form.id_template) {
        await atualizarTemplateDocumento(form.id_template, payload);
      } else {
        await criarTemplateDocumento(payload);
      }
      fechar();
      await carregar();
    } catch (error) {
      setErroForm(error?.message || 'Não foi possível salvar o template.');
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async (item) => {
    if (!window.confirm(`Excluir o template "${item.titulo}"?`)) return;
    try {
      await excluirTemplateDocumento(item.id_template);
      await carregar();
    } catch (error) {
      setErro(error?.message || 'Não foi possível excluir o template.');
    }
  };

  const inserirVariavel = (variavel) => {
    setForm((atual) => ({ ...atual, corpo_texto: `${atual.corpo_texto}{{${variavel}}}` }));
  };

  const acoesTemplate = html`
    <button
      type="button"
      class="btn btn-primary btn-sm"
      onClick=${abrirNovo}
      disabled=${!controlador.possuiPermissao('documentos_templates.editar')}
    >
      <span class="material-symbols-outlined">${IconeSvg('add')}</span>
      Novo template
    </button>
  `;

  const acoesBiblioteca = podeEditarBiblioteca
    ? html`
        <button type="button" class="btn btn-primary btn-sm" onClick=${abrirNovoDoc}>
          <span class="material-symbols-outlined">${IconeSvg('add')}</span>
          Novo documento
        </button>
      `
    : null;

  return html`
    <${PainelRh}
      screenId="screen-settings-document-templates"
      navAtiva="screen-settings-document-templates"
      subtituloMarca="Central de Ajuda"
      placeholderBusca="Central de Ajuda"
      controlador=${controlador}
    >
      <${PageIntro}
        kicker="Configurações"
        title="Central de Ajuda"
        description="Guia de processos por sessão do Conecta, biblioteca de documentos e modelos de texto com variáveis {{variavel}} usados para gerar documentos a partir dos dados do candidato/processo."
      />

      <div class="mon-subnav ajuda-abas" role="tablist" aria-label="Seções da Central de Ajuda">
        <button type="button" role="tab" aria-selected=${aba === 'guia'} class=${`mon-subnav-btn ${aba === 'guia' ? 'is-active' : ''}`} onClick=${() => setAba('guia')}>
          <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('menu_book')}</span>Guia de processos
        </button>
        <button type="button" role="tab" aria-selected=${aba === 'documentos'} class=${`mon-subnav-btn ${aba === 'documentos' ? 'is-active' : ''}`} onClick=${() => setAba('documentos')}>
          <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('description')}</span>Documentos e modelos
        </button>
      </div>

      ${aba === 'guia' ? html`<${GuiaProcessos} controlador=${controlador} />` : html`
      ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}

      ${podeVerBiblioteca
      ? html`
            <${SectionCard}
              title="Biblioteca de documentos"
              description="Documentos e guias por tópico/área. Apenas administradores gerenciam esta lista."
              actions=${acoesBiblioteca}
              className="rh-section-card--flat"
            >
              ${erroDocs ? html`<div class="alert alert-warning">${erroDocs}</div>` : null}
              ${carregandoDocs
          ? html`<${SkeletonTableRows} colunas=${1} linhas=${2} />`
          : documentosPorTopico.length
            ? html`
                    <div class="c24-doc-library">
                      ${documentosPorTopico.map(
              ([topico, itens]) => {
                const aberto = topicosAbertos.has(topico);
                return html`
                          <div class=${`c24-doc-library-group ${aberto ? 'is-open' : ''}`.trim()} key=${topico}>
                            <button
                              type="button"
                              class="c24-doc-library-topic"
                              aria-expanded=${aberto}
                              onClick=${() => alternarTopico(topico)}
                            >
                              <span class="material-symbols-outlined c24-doc-library-topic-chevron">${IconeSvg('expand_more')}</span>
                              <h4>${topico}</h4>
                              <span class="c24-doc-library-topic-count">${itens.length}</span>
                            </button>
                            ${aberto
                  ? html`
                            <ul class="c24-doc-library-list">
                              ${itens.map(
                (item) => html`
                                  <li class="c24-doc-library-item" key=${item.id_documento}>
                                    <div class="c24-doc-library-item-main">
                                      <strong>${item.titulo}</strong>
                                      ${item.area ? html`<span class="rh-status-pill is-neutral">${item.area}</span>` : null}
                                      ${item.descricao ? html`<p>${item.descricao}</p>` : null}
                                    </div>
                                    <div class="c24-doc-library-item-actions">
                                      <a
                                        class="btn btn-outline-secondary btn-sm"
                                        href=${item.url_arquivo}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        <span class="material-symbols-outlined">${IconeSvg('download')}</span>
                                        Baixar documento
                                      </a>
                                      ${podeEditarBiblioteca
                    ? html`
                                            <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => abrirEdicaoDoc(item)}>
                                              <span class="material-symbols-outlined">${IconeSvg('edit')}</span>
                                            </button>
                                            <button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => excluirDoc(item)}>
                                              <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                                            </button>
                                          `
                    : null}
                                    </div>
                                  </li>
                                `,
              )}
                            </ul>
                          `
                  : null}
                          </div>
                        `;
              })}
                    </div>
                  `
            : html`
                    <${EmptyState}
                      title="Nenhum documento cadastrado"
                      text="Cadastre o primeiro documento da biblioteca (ex.: guia de configuração do Microsoft Entra ID para o SharePoint)."
                    />
                  `}
            </${SectionCard}>
          `
      : null}

      <${SectionCard} title="Modelos de documento" description="Modelos de texto gerados automaticamente a partir dos dados do candidato/processo." actions=${acoesTemplate} className="rh-section-card--flat">
        <div class="table-responsive">
          <table class="table align-middle rh-modern-history-table">
            <thead>
              <tr>
                <th>Título</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${carregando
      ? html`<${SkeletonTableRows} colunas=${3} linhas=${3} />`
      : templates.length
        ? templates.map(
          (item) => html`
                      <tr key=${item.id_template}>
                        <td><strong>${item.titulo}</strong></td>
                        <td>
                          <span class=${`rh-status-pill ${item.ativo ? 'is-finished' : ''}`}>
                            ${item.ativo ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                        <td class="d-flex gap-2">
                          <button
                            type="button"
                            class="btn btn-outline-secondary btn-sm"
                            onClick=${() => abrirEdicao(item)}
                          >
                            <span class="material-symbols-outlined">${IconeSvg('edit')}</span>
                            Editar
                          </button>
                          <button
                            type="button"
                            class="btn btn-outline-danger btn-sm"
                            onClick=${() => excluir(item)}
                          >
                            <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                            Excluir
                          </button>
                        </td>
                      </tr>
                    `,
        )
        : html`
                      <${TabelaVazia}
                        colunas=${3}
                        texto="Nenhum template de documento cadastrado."
                        icone="description"
                      />
                    `}
            </tbody>
          </table>
        </div>
      </${SectionCard}>
      `}

      <${ModalPadrao}
        aberto=${modalAberto}
        titulo=${form.id_template ? 'Editar template' : 'Novo template'}
        subtitulo="Use {{variavel}} no texto para inserir dados do candidato/processo automaticamente na geração."
        onClose=${fechar}
        className="rh-modal-dialog--lg"
      >
        <div class="rh-details-body">
          ${erroForm ? html`<div class="alert alert-warning">${erroForm}</div>` : null}

          <div class="rh-filter-field">
            <label>Título</label>
            <input
              class="form-control"
              value=${form.titulo}
              onInput=${(event) => setForm({ ...form, titulo: event.target.value })}
              placeholder="Ex.: Carta de admissão"
            />
          </div>

          <div class="row g-3">
            <div class="col-md-8">
              <div class="rh-filter-field">
                <label>Texto do template</label>
                <textarea
                  class="form-control"
                  rows="14"
                  value=${form.corpo_texto}
                  onInput=${(event) => setForm({ ...form, corpo_texto: event.target.value })}
                  placeholder="Ex.: Prezado(a) {{nome_candidato}}, informamos sua admissão para a vaga de {{vaga}}..."
                ></textarea>
              </div>
            </div>
            <div class="col-md-4">
              <div class="rh-filter-field">
                <label>Variáveis suportadas</label>
                <ul class="list-unstyled small d-flex flex-column gap-2" style=${{ maxHeight: '320px', overflowY: 'auto' }}>
                  ${variaveis.map(
      (item) => html`
                      <li key=${item.variavel}>
                        <button
                          type="button"
                          class="btn btn-outline-secondary btn-sm w-100 text-start"
                          onClick=${() => inserirVariavel(item.variavel)}
                          title=${item.descricao}
                        >
                          <code>{{${item.variavel}}}</code>
                          <div class="text-muted" style=${{ fontSize: '11px' }}>${item.descricao}</div>
                        </button>
                      </li>
                    `,
    )}
                </ul>
              </div>
            </div>
          </div>

          <label class="d-flex align-items-center gap-2">
            <input
              type="checkbox"
              checked=${form.ativo}
              onChange=${(event) => setForm({ ...form, ativo: !!event.target.checked })}
            />
            <span>Template ativo</span>
          </label>
        </div>

        <footer class="rh-modal-footer">
          <div class="rh-modal-footer-actions">
            <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${fechar}>
              Cancelar
            </button>
            <button
              type="button"
              class="btn btn-primary"
              disabled=${salvando || !form.titulo.trim() || !form.corpo_texto.trim()}
              onClick=${salvar}
            >
              ${salvando ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </footer>
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${modalDocAberto}
        titulo=${formDoc.id_documento ? 'Editar documento' : 'Novo documento'}
        subtitulo="Documento de referência para consulta e download (ex.: guias e manuais internos)."
        onClose=${fecharDoc}
      >
        <div class="rh-details-body">
          ${erroFormDoc ? html`<div class="alert alert-warning">${erroFormDoc}</div>` : null}

          <div class="rh-filter-field">
            <label>Título</label>
            <input
              class="form-control"
              value=${formDoc.titulo}
              onInput=${(event) => setFormDoc({ ...formDoc, titulo: event.target.value })}
              placeholder="Ex.: Como configurar o Microsoft Entra ID para o SharePoint"
            />
          </div>

          <div class="row g-3">
            <div class="col-md-6">
              <div class="rh-filter-field">
                <label>Tópico</label>
                <input
                  class="form-control"
                  value=${formDoc.topico}
                  onInput=${(event) => setFormDoc({ ...formDoc, topico: event.target.value })}
                  placeholder="Ex.: Integrações"
                />
              </div>
            </div>
            <div class="col-md-6">
              <div class="rh-filter-field">
                <label>Área (opcional)</label>
                <input
                  class="form-control"
                  value=${formDoc.area}
                  onInput=${(event) => setFormDoc({ ...formDoc, area: event.target.value })}
                  placeholder="Ex.: TI / Configurações"
                />
              </div>
            </div>
          </div>

          <div class="rh-filter-field">
            <label>Descrição (opcional)</label>
            <textarea
              class="form-control"
              rows="3"
              value=${formDoc.descricao}
              onInput=${(event) => setFormDoc({ ...formDoc, descricao: event.target.value })}
            ></textarea>
          </div>

          <div class="rh-filter-field">
            <label>Link do arquivo</label>
            <input
              class="form-control"
              value=${formDoc.url_arquivo}
              onInput=${(event) => setFormDoc({ ...formDoc, url_arquivo: event.target.value })}
              placeholder="Link do SharePoint/OneDrive ou outro repositório"
            />
          </div>

          <label class="d-flex align-items-center gap-2">
            <input
              type="checkbox"
              checked=${formDoc.ativo}
              onChange=${(event) => setFormDoc({ ...formDoc, ativo: !!event.target.checked })}
            />
            <span>Documento ativo</span>
          </label>
        </div>

        <footer class="rh-modal-footer">
          <div class="rh-modal-footer-actions">
            <button type="button" class="btn btn-outline-secondary" disabled=${salvandoDoc} onClick=${fecharDoc}>
              Cancelar
            </button>
            <button
              type="button"
              class="btn btn-primary"
              disabled=${salvandoDoc || !formDoc.titulo.trim() || !formDoc.topico.trim() || !formDoc.url_arquivo.trim()}
              onClick=${salvarDoc}
            >
              ${salvandoDoc ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </footer>
      </${ModalPadrao}>
    </${PainelRh}>
  `;
}

/**
 * Modal reutilizável: escolhe um template ativo, gera o documento para o
 * candidato/processo (id_registro em candidatos_processos) e mostra o texto
 * final com um botão de copiar. Não gera PDF nesta v1 — apenas texto puro.
 */
export function ModalGerarDocumento({ aberto, idRegistro, onClose }) {
  const [templates, setTemplates] = useState([]);
  const [templateSelecionado, setTemplateSelecionado] = useState('');
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setResultado(null);
    setErro('');
    setCopiado(false);
    listarTemplatesDocumentos()
      .then((dados) => {
        const ativos = (Array.isArray(dados) ? dados : []).filter((item) => item.ativo);
        setTemplates(ativos);
        if (ativos.length) setTemplateSelecionado(String(ativos[0].id_template));
      })
      .catch((error) => setErro(error?.message || 'Não foi possível carregar os templates.'));
  }, [aberto]);

  const gerar = async () => {
    if (!templateSelecionado || !idRegistro) return;
    setGerando(true);
    setErro('');
    try {
      const resposta = await gerarDocumentoPorTemplate({
        template_id: Number(templateSelecionado),
        id_registro: Number(idRegistro),
      });
      setResultado(resposta);
    } catch (error) {
      setErro(error?.message || 'Não foi possível gerar o documento.');
    } finally {
      setGerando(false);
    }
  };

  const copiar = async () => {
    if (!resultado?.texto_gerado) return;
    try {
      await navigator.clipboard.writeText(resultado.texto_gerado);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch (error) {
      setErro('Não foi possível copiar o texto automaticamente. Selecione e copie manualmente.');
    }
  };

  return html`
    <${ModalPadrao}
      aberto=${aberto}
      titulo="Gerar documento"
      subtitulo="Escolha um template ativo para gerar o texto do documento com os dados deste candidato."
      onClose=${onClose}
      className="rh-modal-dialog--lg"
    >
      <div class="rh-details-body">
        ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}

        <div class="d-flex gap-2 align-items-center">
          <select
            class="form-select"
            value=${templateSelecionado}
            onChange=${(event) => setTemplateSelecionado(event.target.value)}
          >
            ${templates.length
      ? templates.map(
        (item) => html`<option key=${item.id_template} value=${item.id_template}>${item.titulo}</option>`,
      )
      : html`<option value="">Nenhum template ativo cadastrado</option>`}
          </select>
          <button
            type="button"
            class="btn btn-primary text-nowrap"
            disabled=${gerando || !templateSelecionado}
            onClick=${gerar}
          >
            ${gerando ? 'Gerando...' : 'Gerar'}
          </button>
        </div>

        ${resultado
      ? html`
              <div class="rh-filter-field">
                <div class="d-flex justify-content-between align-items-center">
                  <label class="mb-0">Documento gerado</label>
                  <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${copiar}>
                    <span class="material-symbols-outlined">${IconeSvg('content_copy')}</span>
                    ${copiado ? 'Copiado!' : 'Copiar texto'}
                  </button>
                </div>
                <textarea class="form-control" rows="14" readOnly value=${resultado.texto_gerado}></textarea>
              </div>
            `
      : null}
      </div>

      <footer class="rh-modal-footer">
        <div class="rh-modal-footer-actions">
          <button type="button" class="btn btn-outline-secondary" onClick=${onClose}>
            Fechar
          </button>
        </div>
      </footer>
    </${ModalPadrao}>
  `;
}
