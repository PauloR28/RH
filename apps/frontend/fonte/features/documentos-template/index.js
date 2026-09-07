import { html, useEffect, useState } from '../../infraestrutura-react.js';
import {
  atualizarTemplateDocumento,
  criarTemplateDocumento,
  excluirTemplateDocumento,
  gerarDocumentoPorTemplate,
  listarTemplatesDocumentos,
  listarVariaveisTemplatesDocumentos,
} from '../../servico-api.js';
import {
  ModalPadrao,
  PageIntro,
  PainelRh,
  SectionCard,
} from '../../ui/componentes-compartilhados.js';
import { TabelaVazia } from '../../shared/components/empty-table-row.js';
import { SkeletonTableRows } from '../../shared/components/skeleton.js';
import { IconeSvg } from '../../ui/icone.js';

const FORM_INICIAL = { id_template: '', titulo: '', corpo_texto: '', ativo: true };

export function TelaTemplatesDocumentos({ controlador }) {
  const [templates, setTemplates] = useState([]);
  const [variaveis, setVariaveis] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState('');

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

  useEffect(() => {
    carregar();
  }, []);

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

  return html`
    <${PainelRh}
      screenId="screen-settings-document-templates"
      navAtiva="screen-settings-document-templates"
      subtituloMarca="Templates de documentos"
      placeholderBusca="Templates de documentos"
      controlador=${controlador}
      acaoPrimaria=${{
      label: 'Novo template',
      icon: 'add',
      onClick: abrirNovo,
      permissao: 'documentos_templates.editar',
    }}
    >
      <${PageIntro}
        kicker="Configurações"
        title="Templates de documentos"
        description="Cadastre modelos de texto com variáveis {{variavel}} para gerar documentos rapidamente a partir dos dados do candidato/processo."
      />

      ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}

      <${SectionCard} title="Templates cadastrados" className="rh-section-card--flat">
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
                          <span class=${`rh-chip ${item.ativo ? 'is-indicacao' : ''}`}>
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
