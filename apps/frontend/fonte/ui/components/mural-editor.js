import { html, useEffect, useRef } from '../../infraestrutura-react.js';
import { formatarDocumentoRichText } from '../../regras-prova.js';
import { IconeSvg } from '../icone.js';

function limparHtmlVazio(valor) {
  const conteudo = String(valor || '').trim();
  if (!conteudo || /^((<div><br><\/div>)|(<br\s*\/?>)|(&nbsp;)|\s)+$/i.test(conteudo)) {
    return '';
  }
  return conteudo;
}

/**
 * Editor rico do Mural: mesma base (document.execCommand) e visual do
 * editor de resposta das provas Word (ui/components/exam-fields.js). Upload
 * de imagem NÃO fica aqui — vive num uploader separado, fora da caixa de
 * texto (ver UploaderImagensMural em features/mural/index.js), por pedido
 * do RH e para reduzir a área de botões coladas na caixa de texto.
 */
export function EditorMural({ valor, onChange }) {
  const editorRef = useRef(null);
  const ultimoValorEmitido = useRef(null);

  useEffect(() => {
    if (!editorRef.current) return;
    if (valor === ultimoValorEmitido.current) return;
    if (editorRef.current.innerHTML !== (valor || '')) {
      editorRef.current.innerHTML = valor || '';
    }
  }, [valor]);

  const sincronizarConteudo = () => {
    if (!editorRef.current) return;
    const conteudo = limparHtmlVazio(editorRef.current.innerHTML);
    ultimoValorEmitido.current = conteudo;
    onChange(conteudo);
  };

  const aplicarComando = (comando, argumento = null) => (event) => {
    event.preventDefault();
    if (!editorRef.current) return;
    editorRef.current.focus();
    formatarDocumentoRichText(comando, argumento);
    sincronizarConteudo();
  };

  const alterarTamanhoFonte = (event) => {
    const tamanho = event.target.value;
    if (!tamanho || !editorRef.current) return;
    editorRef.current.focus();
    formatarDocumentoRichText('fontSize', tamanho);
    sincronizarConteudo();
  };

  return html`
    <div class="rh-editor-card mural-editor">
      <div class="rh-editor-toolbar">
        <button type="button" tabIndex="-1" class="rh-editor-toolbar-btn" title="Negrito" onMouseDown=${aplicarComando('bold')}>
          <strong>B</strong>
        </button>
        <button type="button" tabIndex="-1" class="rh-editor-toolbar-btn" title="Itálico" onMouseDown=${aplicarComando('italic')}>
          <em>I</em>
        </button>
        <button type="button" tabIndex="-1" class="rh-editor-toolbar-btn" title="Sublinhado" onMouseDown=${aplicarComando('underline')}>
          <u>U</u>
        </button>
        <select
          class="rh-editor-font-size"
          title="Tamanho da fonte"
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
        <button type="button" tabIndex="-1" class="rh-editor-toolbar-btn" title="Alinhar à esquerda" onMouseDown=${aplicarComando('justifyLeft')}>
          <span class="material-symbols-outlined">${IconeSvg('format_align_left')}</span>
        </button>
        <button type="button" tabIndex="-1" class="rh-editor-toolbar-btn" title="Centralizar" onMouseDown=${aplicarComando('justifyCenter')}>
          <span class="material-symbols-outlined">${IconeSvg('format_align_center')}</span>
        </button>
        <button type="button" tabIndex="-1" class="rh-editor-toolbar-btn" title="Lista com marcadores" onMouseDown=${aplicarComando('insertUnorderedList')}>
          <span class="material-symbols-outlined">${IconeSvg('format_list_bulleted')}</span>
        </button>
        <button type="button" tabIndex="-1" class="rh-editor-toolbar-btn" title="Lista numerada" onMouseDown=${aplicarComando('insertOrderedList')}>
          <span class="material-symbols-outlined">${IconeSvg('format_list_numbered')}</span>
        </button>
      </div>
      <div
        ref=${editorRef}
        class="form-control word-editor mural-editor-body"
        contentEditable="true"
        data-placeholder="Escreva o comunicado aqui..."
        spellcheck="true"
        suppressContentEditableWarning=${true}
        data-gramm="false"
        data-gramm_editor="false"
        data-enable-grammarly="false"
        onInput=${sincronizarConteudo}
        onBlur=${sincronizarConteudo}
      ></div>
    </div>
  `;
}
