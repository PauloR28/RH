import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import {
  enviarEmail,
  listarArquivosOneDrive,
  listarModelosEmail,
} from '../../servico-api.js';
import { ModalPadrao, ToastAlert } from '../../ui/componentes-compartilhados.js';

const PADRAO_VARIAVEL = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;

function extrairVariaveis(...textos) {
  const nomes = new Set();
  textos.forEach((texto) => {
    Array.from(String(texto || '').matchAll(PADRAO_VARIAVEL)).forEach((match) => {
      nomes.add(match[1]);
    });
  });
  return Array.from(nomes);
}

function escaparHtml(valor) {
  return String(valor || '').replace(/[&<>"']/g, (caractere) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[caractere]);
}

function renderizarPreview(texto, variaveis, { escapar = false } = {}) {
  return String(texto || '').replace(PADRAO_VARIAVEL, (match, nome) => {
    if (!(nome in variaveis)) return match;
    return escapar ? escaparHtml(variaveis[nome]) : variaveis[nome];
  });
}

function listaParaTexto(lista) {
  return Array.isArray(lista) ? lista.join(', ') : '';
}

function textoParaLista(texto) {
  return String(texto || '')
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function SeletorArquivoOneDrive({ anexos, onAdicionar }) {
  const [caminho, setCaminho] = useState('');
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    listarArquivosOneDrive(caminho)
      .then((resposta) => {
        if (!cancelado) setItens(resposta?.items || []);
      })
      .catch((error) => {
        if (!cancelado) setErro(error?.message || 'Não foi possível listar os arquivos do OneDrive.');
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [caminho]);

  const segmentos = caminho ? caminho.split('/').filter(Boolean) : [];
  const jaAnexado = (nome) => anexos.some((item) => item.caminho === [caminho, nome].filter(Boolean).join('/'));

  return html`
    <div class="rh-onedrive-picker">
      <nav class="rh-breadcrumb mb-2">
        <button type="button" class="btn btn-link btn-sm p-0" onClick=${() => setCaminho('')}>Repositório do RH</button>
        ${segmentos.map(
          (segmento, indice) => html`
            <span key=${indice}> / </span>
            <button
              type="button"
              class="btn btn-link btn-sm p-0"
              onClick=${() => setCaminho(segmentos.slice(0, indice + 1).join('/'))}
            >
              ${segmento}
            </button>
          `,
        )}
      </nav>
      ${erro ? html`<${ToastAlert} message=${erro} tone="danger" onClose=${() => setErro('')} />` : null}
      ${carregando
        ? html`<p class="text-muted small">Carregando...</p>`
        : html`
            <ul class="list-group rh-onedrive-picker-list">
              ${itens.map(
                (item) => html`
                  <li key=${item.id} class="list-group-item d-flex justify-content-between align-items-center">
                    ${item.tipo === 'pasta'
                      ? html`
                          <button
                            type="button"
                            class="btn btn-link p-0 text-decoration-none"
                            onClick=${() => setCaminho([caminho, item.nome].filter(Boolean).join('/'))}
                          >
                            <span class="material-symbols-outlined" aria-hidden="true">folder</span> ${item.nome}
                          </button>
                        `
                      : html`<span><span class="material-symbols-outlined" aria-hidden="true">description</span> ${item.nome}</span>`}
                    ${item.tipo !== 'pasta'
                      ? html`
                          <button
                            type="button"
                            class="btn btn-outline-primary btn-sm"
                            disabled=${jaAnexado(item.nome)}
                            onClick=${() =>
                              onAdicionar({
                                caminho: [caminho, item.nome].filter(Boolean).join('/'),
                                nome: item.nome,
                              })}
                          >
                            ${jaAnexado(item.nome) ? 'Anexado' : 'Anexar'}
                          </button>
                        `
                      : null}
                  </li>
                `,
              )}
              ${!itens.length ? html`<li class="list-group-item text-muted small">Pasta vazia.</li>` : null}
            </ul>
          `}
    </div>
  `;
}

export function ModalComporEmail({
  aberto,
  onClose,
  controlador,
  destinatariosIniciais = [],
  anexosIniciais = [],
  onEnviado = null,
}) {
  const podeUsarModelo = controlador?.possuiPermissao?.('emails.enviar_modelo');
  const podeEnviarLivre = controlador?.possuiPermissao?.('emails.enviar_livre');
  const podeVerOneDrive = controlador?.possuiPermissao?.('onedrive.visualizar');

  const [modelos, setModelos] = useState([]);
  const [idModelo, setIdModelo] = useState('');
  const [destinatarios, setDestinatarios] = useState('');
  const [copia, setCopia] = useState('');
  const [assuntoLivre, setAssuntoLivre] = useState('');
  const [corpoLivre, setCorpoLivre] = useState('');
  const [variaveis, setVariaveis] = useState({});
  const [anexos, setAnexos] = useState([]);
  const [mostrarSeletorArquivo, setMostrarSeletorArquivo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!aberto) return;
    setDestinatarios(listaParaTexto(destinatariosIniciais));
    setCopia('');
    setIdModelo('');
    setAssuntoLivre('');
    setCorpoLivre('');
    setVariaveis({});
    setAnexos(anexosIniciais || []);
    setErro('');
    setMostrarSeletorArquivo(false);
    if (podeUsarModelo) {
      listarModelosEmail()
        .then((resposta) => setModelos(resposta?.items || []))
        .catch(() => setModelos([]));
    }
  }, [aberto]);

  const modeloSelecionado = useMemo(
    () => modelos.find((item) => String(item.id_item) === String(idModelo)) || null,
    [modelos, idModelo],
  );

  useEffect(() => {
    if (!modeloSelecionado) return;
    const nomesVariaveis = extrairVariaveis(modeloSelecionado.assunto, modeloSelecionado.corpo_html);
    setVariaveis((atual) => {
      const proximo = {};
      nomesVariaveis.forEach((nome) => {
        proximo[nome] = atual[nome] || '';
      });
      return proximo;
    });
  }, [modeloSelecionado]);

  if (!aberto) return null;

  const usandoModelo = Boolean(idModelo);
  const assuntoPreview = usandoModelo
    ? renderizarPreview(modeloSelecionado?.assunto, variaveis)
    : assuntoLivre;
  const corpoPreview = usandoModelo
    ? renderizarPreview(modeloSelecionado?.corpo_html, variaveis, { escapar: true })
    : corpoLivre;

  const enviar = async (event) => {
    event.preventDefault();
    const listaDestinatarios = textoParaLista(destinatarios);
    if (!listaDestinatarios.length) {
      setErro('Informe ao menos um destinatário.');
      return;
    }
    if (!corpoPreview.trim()) {
      setErro('O corpo do e-mail não pode ficar vazio.');
      return;
    }
    setEnviando(true);
    setErro('');
    try {
      await enviarEmail({
        destinatarios: listaDestinatarios,
        copia: textoParaLista(copia),
        id_modelo: usandoModelo ? Number(idModelo) : null,
        assunto: assuntoLivre,
        corpo_html: corpoLivre,
        variaveis,
        anexos_onedrive: anexos.map((item) => item.caminho),
      });
      onEnviado?.();
      onClose?.();
    } catch (error) {
      setErro(error?.message || 'Não foi possível enviar o e-mail.');
    } finally {
      setEnviando(false);
    }
  };

  return html`
    <${ModalPadrao} aberto=${aberto} titulo="Compor e-mail" subtitulo="Enviado via Microsoft 365" onClose=${onClose} className="rh-compose-email-modal">
      <form onSubmit=${enviar} class="d-flex flex-column gap-3">
        ${erro ? html`<${ToastAlert} message=${erro} tone="danger" onClose=${() => setErro('')} />` : null}

        <label class="form-field">
          <span class="form-label">Destinatários</span>
          <input
            class="form-control"
            required
            placeholder="fulano@empresa.com, ciclano@empresa.com"
            value=${destinatarios}
            onInput=${(event) => setDestinatarios(event.target.value)}
          />
        </label>

        <label class="form-field">
          <span class="form-label">Cópia (CC)</span>
          <input class="form-control" value=${copia} onInput=${(event) => setCopia(event.target.value)} />
        </label>

        ${podeUsarModelo
          ? html`
              <label class="form-field">
                <span class="form-label">Modelo de e-mail</span>
                <select class="form-select" value=${idModelo} onChange=${(event) => setIdModelo(event.target.value)}>
                  <option value="">${podeEnviarLivre ? 'Escrever e-mail livre' : 'Selecione um modelo'}</option>
                  ${modelos.map(
                    (modelo) => html`<option key=${modelo.id_item} value=${modelo.id_item}>${modelo.nome}</option>`,
                  )}
                </select>
              </label>
            `
          : null}

        ${usandoModelo
          ? html`
              <div class="rh-compose-email-variables">
                ${Object.keys(variaveis).length
                  ? Object.keys(variaveis).map(
                      (nome) => html`
                        <label class="form-field" key=${nome}>
                          <span class="form-label">${nome}</span>
                          <input
                            class="form-control"
                            value=${variaveis[nome]}
                            onInput=${(event) => setVariaveis({ ...variaveis, [nome]: event.target.value })}
                          />
                        </label>
                      `,
                    )
                  : html`<p class="text-muted small">Este modelo não possui variáveis.</p>`}
              </div>
              <label class="form-field">
                <span class="form-label">Pré-visualização do assunto</span>
                <input class="form-control" disabled value=${assuntoPreview} />
              </label>
              <label class="form-field">
                <span class="form-label">Pré-visualização do corpo</span>
                <div class="form-control rh-compose-email-preview" dangerouslySetInnerHTML=${{ __html: corpoPreview }}></div>
              </label>
            `
          : podeEnviarLivre
            ? html`
                <label class="form-field">
                  <span class="form-label">Assunto</span>
                  <input
                    class="form-control"
                    required
                    value=${assuntoLivre}
                    onInput=${(event) => setAssuntoLivre(event.target.value)}
                  />
                </label>
                <label class="form-field">
                  <span class="form-label">Corpo (HTML)</span>
                  <textarea
                    class="form-control"
                    rows="6"
                    required
                    value=${corpoLivre}
                    onInput=${(event) => setCorpoLivre(event.target.value)}
                  ></textarea>
                </label>
              `
            : html`<p class="text-muted small">Selecione um modelo de e-mail para continuar.</p>`}

        ${podeVerOneDrive
          ? html`
              <div class="rh-compose-email-attachments">
                <div class="d-flex justify-content-between align-items-center">
                  <span class="form-label mb-0">Anexos do OneDrive</span>
                  <button
                    type="button"
                    class="btn btn-outline-secondary btn-sm"
                    onClick=${() => setMostrarSeletorArquivo((atual) => !atual)}
                  >
                    ${mostrarSeletorArquivo ? 'Fechar seleção' : 'Escolher arquivo'}
                  </button>
                </div>
                ${anexos.length
                  ? html`
                      <ul class="list-group mt-2">
                        ${anexos.map(
                          (item) => html`
                            <li key=${item.caminho} class="list-group-item d-flex justify-content-between align-items-center">
                              ${item.nome}
                              <button
                                type="button"
                                class="btn btn-outline-danger btn-sm"
                                onClick=${() => setAnexos(anexos.filter((atual) => atual.caminho !== item.caminho))}
                              >
                                Remover
                              </button>
                            </li>
                          `,
                        )}
                      </ul>
                    `
                  : null}
                ${mostrarSeletorArquivo
                  ? html`
                      <${SeletorArquivoOneDrive}
                        anexos=${anexos}
                        onAdicionar=${(item) => setAnexos([...anexos, item])}
                      />
                    `
                  : null}
              </div>
            `
          : null}

        <div class="d-flex justify-content-end gap-2">
          <button type="button" class="btn btn-outline-secondary" onClick=${onClose}>Cancelar</button>
          <button type="submit" class="btn btn-primary" disabled=${enviando || (!podeUsarModelo && !podeEnviarLivre)}>
            ${enviando ? 'Enviando...' : 'Enviar e-mail'}
          </button>
        </div>
      </form>
    </${ModalPadrao}>
  `;
}
