import { IconeSvg } from '../icone.js';

﻿import {
  html,
  useEffect,
  useRef,
  useState,
} from '../../infraestrutura-react.js';
import {
  baixarModeloExcel,
  converterArrayBufferParaBase64,
  formatarDocumentoRichText,
  obterCapacidadesDaTarefa,
  validarArquivoExcel,
} from '../../regras-prova.js';
import { useToast } from '../../shared/hooks/use-toast.js';

function escaparHtml(valor) {
  return String(valor || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function normalizarConteudoRichText(valor) {
  const conteudo = String(valor || '');
  if (!conteudo.trim()) return '';

  if (/<\/?[a-z][\s\S]*>/i.test(conteudo)) {
    return conteudo;
  }

  return escaparHtml(conteudo).replace(/\n/g, '<br>');
}

function limparHtmlVazio(valor) {
  const conteudo = String(valor || '').trim();
  if (
    !conteudo ||
    /^((<div><br><\/div>)|(<br\s*\/?>)|(&nbsp;)|\s)+$/i.test(conteudo)
  ) {
    return '';
  }
  return conteudo;
}

function obterTextoPlanoRichText(valor) {
  const conteudo = String(valor || '');
  if (typeof document === 'undefined') {
    return conteudo.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const elemento = document.createElement('div');
  elemento.innerHTML = conteudo;
  return elemento.textContent || elemento.innerText || '';
}

function limitarConteudoRichText(valor, limiteCaracteres = 0) {
  const limite = Number(limiteCaracteres || 0);
  const texto = obterTextoPlanoRichText(valor);
  if (!limite || texto.length <= limite) {
    return {
      content: valor,
      text: texto,
      truncated: false,
    };
  }

  const text = texto.slice(0, limite);
  return {
    content: escaparHtml(text).replace(/\n/g, '<br>'),
    text,
    truncated: true,
  };
}

export function EditorTextoRich({
  valor,
  onChange,
  limiteCaracteres = 0,
  textoAjuda = '',
  mostrarContador = true,
}) {
  const editorRef = useRef(null);
  const ultimoValorEmitido = useRef(null);
  const limite = Number(limiteCaracteres || 0);
  const caracteresUsados = obterTextoPlanoRichText(valor).length;

  useEffect(() => {
    if (!editorRef.current) return;
    // Correções.txt item 11: reescrever innerHTML a cada digitação destrói o
    // Range do contentEditable e joga o cursor pro início do texto. Só
    // reescrevemos quando a mudança de `valor` NÃO veio do próprio editor
    // (ex.: troca de questão, resposta carregada do servidor) — quando o
    // valor recebido é exatamente o que este editor acabou de emitir via
    // onInput, o DOM já está correto e não deve ser tocado.
    if (valor === ultimoValorEmitido.current) return;
    const valorSeguro = normalizarConteudoRichText(valor);
    if (editorRef.current.innerHTML !== valorSeguro) {
      editorRef.current.innerHTML = valorSeguro;
    }
  }, [valor]);

  const aplicarComando = (comando, valor = null) => (event) => {
    event.preventDefault();
    if (!editorRef.current) return;
    editorRef.current.focus();
    formatarDocumentoRichText(comando, valor);
    sincronizarConteudo();
  };

  const alterarTamanhoFonte = (event) => {
    const valor = event.target.value;
    if (!valor || !editorRef.current) return;
    editorRef.current.focus();
    formatarDocumentoRichText('fontSize', valor);
    sincronizarConteudo();
  };

  const sincronizarConteudo = () => {
    if (!editorRef.current) return;
    const conteudo = limparHtmlVazio(editorRef.current.innerHTML);
    const limitado = limitarConteudoRichText(conteudo, limite);
    if (limitado.truncated) {
      editorRef.current.innerHTML = limitado.content;
    }
    ultimoValorEmitido.current = limitado.content;
    onChange(limitado.content);
  };

  return html`
    <div class="rh-editor-card">
      <label class="form-label fw-semibold" for="word-answer-textarea">
        Digite sua resposta
      </label>
      
      <div class="rh-editor-toolbar">
        <button
          type="button"
          class="rh-editor-toolbar-btn"
          title="Negrito"
          aria-label="Aplicar negrito"
          onMouseDown=${aplicarComando('bold')}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          class="rh-editor-toolbar-btn"
          title="Italico"
          aria-label="Aplicar italico"
          onMouseDown=${aplicarComando('italic')}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          class="rh-editor-toolbar-btn"
          title="Sublinhado"
          aria-label="Aplicar sublinhado"
          onMouseDown=${aplicarComando('underline')}
        >
          <u>U</u>
        </button>
        <button
          type="button"
          class="rh-editor-toolbar-btn"
          title="Tachado"
          aria-label="Aplicar tachado"
          onMouseDown=${aplicarComando('strikeThrough')}
        >
          <s>S</s>
        </button>
        <select
          class="rh-editor-font-size"
          title="Tamanho da fonte"
          aria-label="Tamanho da fonte"
          onChange=${alterarTamanhoFonte}
          value=""
        >
          <option value="">Tamanho</option>
          <option value="2">12</option>
          <option value="3">14</option>
          <option value="4">16</option>
          <option value="5">18</option>
          <option value="6">24</option>
        </select>
        <span class="rh-editor-toolbar-divider" aria-hidden="true"></span>
        <button
          type="button"
          class="rh-editor-toolbar-btn"
          title="Alinhar a esquerda"
          aria-label="Alinhar a esquerda"
          onMouseDown=${aplicarComando('justifyLeft')}
        >
          <span class="material-symbols-outlined">${IconeSvg('format_align_left')}</span>
        </button>
        <button
          type="button"
          class="rh-editor-toolbar-btn"
          title="Centralizar"
          aria-label="Centralizar"
          onMouseDown=${aplicarComando('justifyCenter')}
        >
          <span class="material-symbols-outlined">${IconeSvg('format_align_center')}</span>
        </button>
        <button
          type="button"
          class="rh-editor-toolbar-btn"
          title="Alinhar a direita"
          aria-label="Alinhar a direita"
          onMouseDown=${aplicarComando('justifyRight')}
        >
          <span class="material-symbols-outlined">${IconeSvg('format_align_right')}</span>
        </button>
        <button
          type="button"
          class="rh-editor-toolbar-btn"
          title="Justificar"
          aria-label="Justificar"
          onMouseDown=${aplicarComando('justifyFull')}
        >
          <span class="material-symbols-outlined">${IconeSvg('format_align_justify')}</span>
        </button>
        <span class="rh-editor-toolbar-divider" aria-hidden="true"></span>
        <button
          type="button"
          class="rh-editor-toolbar-btn"
          title="Lista com marcadores"
          aria-label="Lista com marcadores"
          onMouseDown=${aplicarComando('insertUnorderedList')}
        >
          <span class="material-symbols-outlined">${IconeSvg('format_list_bulleted')}</span>
        </button>
        <button
          type="button"
          class="rh-editor-toolbar-btn"
          title="Lista numerada"
          aria-label="Lista numerada"
          onMouseDown=${aplicarComando('insertOrderedList')}
        >
          <span class="material-symbols-outlined">${IconeSvg('format_list_numbered')}</span>
        </button>
      </div>
      <div
        ref=${editorRef}
        id="word-answer-textarea"
        class="form-control word-editor"
        contentEditable="true"
        data-placeholder="Escreva sua resposta aqui..."
        spellcheck="true"
        suppressContentEditableWarning=${true}
        onInput=${sincronizarConteudo}
        onBlur=${sincronizarConteudo}
      ></div>
    </div>
  `;
}

export function PerguntaGrupoCompacto({ questao, resposta, onChange }) {
  const selecoes = resposta?.selections || {};
  const itens = Array.isArray(questao.items)
    ? questao.items
    : Array.isArray(questao.itens)
      ? questao.itens
      : [];

  const selecionar = (item, indiceOpcao) => {
    onChange({
      type: 'compact_choice_group',
      selections: {
        ...selecoes,
        [String(item.id)]: indiceOpcao,
      },
    });
  };

  return html`
    <div class="compact-choice-list">
      ${itens.map(
    (item, indiceItem) => html`
          <fieldset
            key=${`${questao.questionBankId || questao.title}-${item.id || indiceItem}`}
            class="compact-choice-item"
          >
            <legend>
              <span>${indiceItem + 1}</span>
              ${item.enunciado}
            </legend>
            <div class="compact-choice-options">
              ${(item.options || []).map(
    (opcao, indiceOpcao) => html`
                  <label
                    key=${`${item.id}-${indiceOpcao}`}
                    class=${`compact-choice-option ${selecoes[String(item.id)] === indiceOpcao ? 'is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name=${`compact-${questao.questionBankId || questao.title}-${item.id}`}
                      checked=${selecoes[String(item.id)] === indiceOpcao}
                      onChange=${() => selecionar(item, indiceOpcao)}
                    />
                    <span>${String.fromCharCode(65 + indiceOpcao)}</span>
                    <strong>${opcao}</strong>
                  </label>
                `,
  )}
            </div>
          </fieldset>
        `,
  )}
    </div>
  `;
}

export function PerguntaMultipla({ questao, resposta, onChange }) {
  const selecionado = resposta?.selected;

  return html`
    <div class="rh-option-list">
      ${questao.options.map(
    (opcao, indice) => html`
          <label
            key=${`${questao.title}-${indice}`}
            class=${`rh-option-card ${selecionado === indice ? 'is-selected' : ''}`}
          >
            <input
              class="form-check-input"
              type="radio"
              name="mcq"
              checked=${selecionado === indice}
              onChange=${() => onChange(indice)}
            />
            <span class="exam-option-letter"
              >${String.fromCharCode(65 + indice)}</span
            >
            <span class="exam-option-text">${opcao}</span>
          </label>
        `,
  )}
    </div>
  `;
}

export function PerguntaExcel({ questao, resposta, nomeCandidato, onChange }) {
  const inputRef = useRef(null);
  const [processando, setProcessando] = useState(false);
  const { showToast, ToastHost } = useToast();

  const baixarArquivoBase = async () => {
    try {
      await baixarModeloExcel(questao.taskId, nomeCandidato || 'candidato');
    } catch (error) {
      showToast(
        error?.message ||
        'Não foi possível localizar o arquivo-base da prova de Excel.',
        'error',
      );
    }
  };

  const processarUpload = async (event) => {
    const arquivo = event.target.files?.[0];
    if (!arquivo) return;

    setProcessando(true);

    try {
      const respostaValidada = await validarArquivoExcel(
        questao.taskId,
        arquivo,
        questao.points,
      );
      onChange({
        ...respostaValidada,
        contentBase64: converterArrayBufferParaBase64(
          respostaValidada.uploadedArrayBuffer,
        ),
      });
    } catch (error) {
      onChange({
        type: 'excel_external',
        uploaded: false,
        validation: null,
        statusText: 'Não foi possível ler o arquivo enviado.',
        statusClass: 'excel-status-error',
      });
    } finally {
      setProcessando(false);
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  return html`
    <div class="excel-card">
      <${ToastHost} />
      <div class="row g-4">
        <div class="col-lg-7">
          <div class="excel-step">
            <h4>O que será avaliado</h4>
            <ul class="muted-list">
              ${obterCapacidadesDaTarefa(questao.taskId).map(
    (item, indice) => html`<li key=${indice}>${item}</li>`,
  )}
            </ul>
          </div>

          <button
            type="button"
            class="btn btn-success"
            onClick=${baixarArquivoBase}
          >
            Baixar arquivo .xlsx
          </button>
        </div>

        <div class="col-lg-5">
          <div class="excel-upload-box">
            <label class="form-label fw-semibold"
              >Enviar arquivo respondido</label
            >
            <input
              ref=${inputRef}
              class="upload-hidden-input"
              type="file"
              accept=".xlsx,.xls,.xlsm"
              onChange=${processarUpload}
            />
            <div class="d-grid gap-2">
              <button
                type="button"
                class="btn btn-outline-secondary"
                disabled=${processando}
                onClick=${() => inputRef.current?.click()}
              >
                ${processando ? 'Processando arquivo...' : 'Selecionar arquivo'}
              </button>
            </div>
            <span class="upload-file-name">
              ${resposta?.filename
      ? `Arquivo selecionado: ${resposta.filename}`
      : 'Nenhum arquivo selecionado.'}
            </span>
            <div class=${`${resposta?.statusClass || 'text-muted'} mt-2`}>
              ${resposta?.statusText || 'Nenhum arquivo enviado ainda.'}
            </div>
           
            <div class="small text-muted mt-2">
              Formatos aceitos: .xlsx, .xls e .xlsm
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
