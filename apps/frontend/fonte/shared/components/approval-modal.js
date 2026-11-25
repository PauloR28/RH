import {
  html,
  useEffect,
  useState,
} from '../../infraestrutura-react.js?v=20261125-deploy';
import { ModalPadrao } from '../../ui/componentes-compartilhados.js?v=20261125-deploy';

export const DOCUMENTOS_APROVACAO_PADRAO = [
  'RG',
  'CPF',
  'Comprovante de residência',
  'Carteira de trabalho',
  'Título de eleitor',
  'Certificado de reservista, se aplicável',
  'Comprovante de escolaridade',
  'Certidão de nascimento ou casamento',
  'Foto 3x4',
  'Dados bancários',
  'PIS/PASEP, se possuir',
  'Carteira de vacinação, se necessário',
  'Documento para exame admissional',
  'Outros documentos solicitados pelo RH',
];

const TIPOS_ANEXO_APROVACAO = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
]);
const EXTENSOES_ANEXO_APROVACAO = new Set(['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg']);
const TAMANHO_MAXIMO_ANEXO = 10 * 1024 * 1024;

function formatarDataComparecimento(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return '_data_comparecimento_';

  const partes = texto.split('-');
  if (partes.length !== 3) return texto;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

export function montarListaDocumentos(documentos) {
  const selecionados = Array.isArray(documentos) ? documentos.filter(Boolean) : [];
  if (!selecionados.length) return '_lista_documentos_';
  return selecionados.map((documento) => `- ${documento}`).join('\n');
}

export function montarMensagemAprovacaoPadrao({
  candidato,
  processo = null,
  dataComparecimento = '',
  documentos = [],
} = {}) {
  const nome = candidato?.nome_candidato || candidato?.nome || 'candidato(a)';
  const vaga = processo?.vaga || candidato?.vaga || '_nome da vaga_';
  const data = formatarDataComparecimento(dataComparecimento);
  const lista = montarListaDocumentos(documentos);

  return `Parabéns ${nome}! Você foi aprovado em nosso processo seletivo para a vaga de ${vaga}.

Compareça à empresa no dia ${data} levando os seguintes documentos:

${lista}

Endereço: Rua Victor Civita, 77 - Bloco 1, 3° Andar.

Em anexo, encaminhamos o documento necessário para apresentação no exame admissional.`;
}

export function atualizarDocumentosNaMensagem(mensagemAtual, documentos) {
  const lista = montarListaDocumentos(documentos);
  const mensagem = String(mensagemAtual || '');

  if (mensagem.includes('_lista_documentos_')) {
    return mensagem.replace('_lista_documentos_', lista);
  }

  const padrao = /(levando os seguintes documentos:\s*\n)([\s\S]*?)(\n\s*Endereço:)/i;
  if (padrao.test(mensagem)) {
    return mensagem.replace(padrao, `$1\n${lista}\n$3`);
  }

  return `${mensagem.trim()}\n\nDocumentos selecionados:\n${lista}`;
}

function atualizarDataNaMensagem(mensagemAtual, dataComparecimento) {
  const data = formatarDataComparecimento(dataComparecimento);
  const mensagem = String(mensagemAtual || '');

  if (mensagem.includes('_data_comparecimento_')) {
    return mensagem.replace('_data_comparecimento_', data);
  }

  return mensagem;
}

function validarAnexoAprovacao(arquivo) {
  if (!arquivo) return '';

  const extensao = String(arquivo.name || '').split('.').pop()?.toLowerCase() || '';
  const tipo = String(arquivo.type || '').toLowerCase();

  if (!EXTENSOES_ANEXO_APROVACAO.has(extensao)) {
    return 'Formato de anexo não suportado. Envie PDF, DOC, DOCX, PNG, JPG ou JPEG.';
  }

  if (tipo && !TIPOS_ANEXO_APROVACAO.has(tipo)) {
    return 'Tipo de arquivo inválido para anexo de aprovação.';
  }

  if (arquivo.size > TAMANHO_MAXIMO_ANEXO) {
    return 'O anexo da aprovação deve ter no máximo 10 MB.';
  }

  return '';
}

function lerArquivoComoBase64(arquivo) {
  if (!arquivo) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => {
      const resultado = String(leitor.result || '');
      resolve(resultado.includes(',') ? resultado.split(',', 2)[1] : resultado);
    };
    leitor.onerror = () => reject(new Error('Não foi possível ler o anexo selecionado.'));
    leitor.readAsDataURL(arquivo);
  });
}

export function ModalAprovacaoCandidato({
  aberto,
  candidato,
  processo = null,
  salvando = false,
  enviandoCanal = '',
  onClose,
  onConfirm,
  onSendWhatsApp,
  onSendEmail,
}) {
  const [dataComparecimento, setDataComparecimento] = useState('');
  const [documentos, setDocumentos] = useState([]);
  const [mensagem, setMensagem] = useState('');
  const [mensagemEditada, setMensagemEditada] = useState(false);
  const [anexo, setAnexo] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!aberto || !candidato) return;

    setDataComparecimento('');
    setDocumentos([]);
    setMensagem(montarMensagemAprovacaoPadrao({ candidato, processo }));
    setMensagemEditada(false);
    setAnexo(null);
    setErro('');
  }, [aberto, candidato, processo]);

  if (!aberto || !candidato) return null;

  const alterarDataComparecimento = (valor) => {
    setDataComparecimento(valor);
    setMensagem((atual) =>
      mensagemEditada
        ? atualizarDataNaMensagem(atual, valor)
        : montarMensagemAprovacaoPadrao({
            candidato,
            processo,
            dataComparecimento: valor,
            documentos,
          }),
    );
  };

  const alternarDocumento = (documento, marcado) => {
    const proximos = marcado
      ? [...documentos, documento]
      : documentos.filter((item) => item !== documento);
    setDocumentos(proximos);
    setMensagem((atual) =>
      atualizarDocumentosNaMensagem(
        mensagemEditada
          ? atual
          : montarMensagemAprovacaoPadrao({
              candidato,
              processo,
              dataComparecimento,
              documentos: proximos,
            }),
        proximos,
      ),
    );
  };

  const montarPayload = async () => {
    const mensagemFinal = String(mensagem || '').trim();
    if (!mensagemFinal) {
      setErro('Informe a mensagem de aprovação antes de confirmar.');
      return null;
    }

    const erroAnexo = validarAnexoAprovacao(anexo);
    if (erroAnexo) {
      setErro(erroAnexo);
      return null;
    }

    try {
      setErro('');
      const anexoBase64 = await lerArquivoComoBase64(anexo);
      return {
        mensagem_aprovacao: mensagemFinal,
        data_comparecimento_aprovacao: dataComparecimento || '',
        documentos_aprovacao: documentos,
        anexo_aprovacao_nome: anexo?.name || '',
        anexo_aprovacao_tipo: anexo?.type || '',
        anexo_aprovacao_tamanho: anexo?.size || 0,
        anexo_aprovacao_base64: anexoBase64 || '',
      };
    } catch (error) {
      setErro(error?.message || 'Não foi possível confirmar a aprovação.');
    }
  };

  const executarAcao = async (acao, mensagemErro) => {
    if (typeof acao !== 'function') return;

    try {
      const payload = await montarPayload();
      if (!payload) return;
      await acao(payload);
    } catch (error) {
      setErro(error?.message || mensagemErro);
    }
  };

  const confirmar = () =>
    executarAcao(onConfirm, 'Não foi possível confirmar a aprovação.');

  return html`
    <${ModalPadrao}
      aberto=${aberto}
      titulo="Aprovar candidato"
      subtitulo="Revise a mensagem, documentos e anexo antes de confirmar a aprovação."
      onClose=${onClose}
      className="rh-modal-dialog--wide"
    >
      <div class="rh-details-body">
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label">Candidato</label>
            <input
              class="form-control"
              readonly
              value=${candidato.nome_candidato || candidato.nome || ''}
            />
          </div>
          <div class="col-md-6">
            <label class="form-label">Data de comparecimento</label>
            <input
              class="form-control"
              type="date"
              value=${dataComparecimento}
              onInput=${(event) => alterarDataComparecimento(event.target.value)}
            />
          </div>

          <div class="col-md-12">
            <label class="form-label">Documentos solicitados</label>
            <div class="row g-2">
              ${DOCUMENTOS_APROVACAO_PADRAO.map(
                (documento) => html`
                  <label class="form-check col-md-6" key=${documento}>
                    <input
                      class="form-check-input"
                      type="checkbox"
                      checked=${documentos.includes(documento)}
                      onChange=${(event) =>
                        alternarDocumento(documento, event.target.checked)}
                    />
                    <span class="form-check-label">${documento}</span>
                  </label>
                `,
              )}
            </div>
          </div>

          <div class="col-md-12">
            <label class="form-label">Mensagem que será enviada</label>
            <textarea
              class="form-control"
              rows="9"
              value=${mensagem}
              onInput=${(event) => {
                setMensagemEditada(true);
                setMensagem(event.target.value);
              }}
            ></textarea>
          </div>

          <div class="col-md-12">
            <label class="form-label">Anexo da aprovação</label>
            <input
              class="form-control"
              type="file"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
              onChange=${(event) => {
                const arquivo = event.target.files?.[0] || null;
                const erroArquivo = validarAnexoAprovacao(arquivo);
                setErro(erroArquivo);
                setAnexo(erroArquivo ? null : arquivo);
              }}
            />
            <div class="form-text">
              Aceita PDF, DOC, DOCX, PNG, JPG e JPEG até 10 MB.
            </div>
          </div>
        </div>

        ${erro ? html`<div class="alert alert-danger mt-3 mb-0">${erro}</div>` : null}
      </div>

      <footer class="rh-modal-footer">
        <button
          type="button"
          class="btn btn-outline-secondary"
          disabled=${salvando || !!enviandoCanal}
          onClick=${onClose}
        >
          Cancelar
        </button>
        ${typeof onSendWhatsApp === 'function'
          ? html`
              <button
                type="button"
                class="btn btn-outline-success"
                disabled=${salvando || !!enviandoCanal}
                onClick=${() =>
                  executarAcao(
                    onSendWhatsApp,
                    'Não foi possível enviar a mensagem por WhatsApp.',
                  )}
              >
                ${enviandoCanal === 'whatsapp' ? 'Enviando...' : 'Enviar por WhatsApp'}
              </button>
            `
          : null}
        ${typeof onSendEmail === 'function'
          ? html`
              <button
                type="button"
                class="btn btn-outline-primary"
                disabled=${salvando || !!enviandoCanal}
                onClick=${() =>
                  executarAcao(
                    onSendEmail,
                    'Não foi possível enviar a mensagem por e-mail.',
                  )}
              >
                ${enviandoCanal === 'email' ? 'Enviando...' : 'Enviar por E-mail'}
              </button>
            `
          : null}
        <button
          type="button"
          class="btn btn-success"
          disabled=${salvando || !!enviandoCanal}
          onClick=${confirmar}
        >
          ${salvando ? 'Confirmando...' : 'Confirmar aprovação'}
        </button>
      </footer>
    </${ModalPadrao}>
  `;
}
