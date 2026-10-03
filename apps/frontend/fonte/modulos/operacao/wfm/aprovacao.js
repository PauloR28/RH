import { html, useEffect, useState } from '../../../infraestrutura-react.js';
import { IconeSvg } from '../../../ui/icone.js';
import {
  aprovarEscalaWfm,
  cancelarEnvioEscalaWfm,
  declinarEscalaWfm,
  enviarAprovacaoEscalaWfm,
} from '../../../services/api/wfm.js';
import { dataHora } from './comum.js';

// Aprovação da escala antes de publicar: Rascunho -> Em aprovação -> Aprovada -> (publicar).
// Gestor ou Supervisor aprovam (nunca a própria escala; o Analista de TI é o gestor único do TI e aprova a sua).
// Declinar exige justificativa e devolve a escala à edição de quem a enviou. Regras e escopo vivem no servidor.

const ROTULO = { RASCUNHO: 'Rascunho', EM_APROVACAO: 'Em aprovação', APROVADA: 'Aprovada' };
const TOM = { RASCUNHO: 'mon-badge--nula', EM_APROVACAO: 'mon-badge--pendente', APROVADA: 'mon-badge--ok' };

export function PainelAprovacao({ operacao, anoMes, aprovacao, onMudou, showToast, desabilitado = false }) {
  const [declinando, setDeclinando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aprovadaVisivel, setAprovadaVisivel] = useState(true);
  const estadoAtual = aprovacao?.estado;
  // O aviso "Aprovada" é temporário: some sozinho; volta a ser visível se o estado mudar.
  useEffect(() => {
    setAprovadaVisivel(true);
    if (estadoAtual !== 'APROVADA') return undefined;
    const t = setTimeout(() => setAprovadaVisivel(false), 6000);
    return () => clearTimeout(t);
  }, [estadoAtual, operacao, anoMes]);
  if (!aprovacao || !aprovacao.exige) return null;
  if (aprovacao.estado === 'APROVADA' && !aprovadaVisivel) return null;
  const corpo = { operacao, ano_mes: anoMes };

  const executar = async (fn, sucesso) => {
    setOcupado(true);
    try {
      const r = await fn();
      // Aprovar já publica; se a publicação não coube ao aprovador, o servidor devolve o aviso.
      if (r && r.estado === 'APROVADA') {
        if (r.publicada) showToast?.(`Escala aprovada e publicada (v${r.versao}).`, 'success');
        else showToast?.(`Escala aprovada. Não foi publicada automaticamente: ${r.aviso || 'publique manualmente.'}`, 'warning');
      } else showToast?.(sucesso, 'success');
      setDeclinando(false);
      setMotivo('');
      await onMudou?.();
    } catch (e) {
      showToast?.(e?.message || 'Não foi possível concluir.', 'error');
      await onMudou?.();
    } finally { setOcupado(false); }
  };
  const bloqueado = ocupado || desabilitado;

  let mensagem;
  if (aprovacao.estado === 'EM_APROVACAO') {
    mensagem = `Aguardando aprovação ${aprovacao.aprovadores_configurados ? 'dos aprovadores configurados' : 'do Gestor ou Supervisor'}. Enviada por ${aprovacao.enviado_por || '—'} em ${dataHora(aprovacao.enviado_em)}. A edição fica bloqueada até a decisão.`;
  } else if (aprovacao.estado === 'APROVADA') {
    mensagem = `Aprovada por ${aprovacao.decidido_por || '—'} em ${dataHora(aprovacao.decidido_em)}. A aprovação publica a escala.`;
  } else if (aprovacao.declinada) {
    mensagem = `Declinada por ${aprovacao.decidido_por || '—'} em ${dataHora(aprovacao.decidido_em)}. Corrija${aprovacao.enviado_por ? ` (enviada por ${aprovacao.enviado_por})` : ''} e envie novamente.`;
  } else if (aprovacao.invalidada) {
    mensagem = 'A escala foi alterada depois do envio/aprovação: envie novamente para aprovação.';
  } else {
    mensagem = '';
  }

  return html`
    <div class=${`wfm-aprovacao is-${aprovacao.estado.toLowerCase()} ${aprovacao.declinada ? 'is-declinada' : ''}`} role="status">
      <div class="wfm-aprovacao-topo">
        <span class=${`mon-badge ${aprovacao.declinada ? 'mon-badge--critico' : TOM[aprovacao.estado]}`}>${aprovacao.declinada ? 'Declinada' : ROTULO[aprovacao.estado]}</span>
        ${mensagem ? html`<span class="wfm-aprovacao-texto">${mensagem}</span>` : html`<span class="wfm-aprovacao-texto"></span>`}
        <span class="wfm-aprovacao-acoes">
          ${aprovacao.pode_enviar ? html`<button type="button" class="btn btn-primary btn-sm" disabled=${bloqueado} onClick=${() => executar(() => enviarAprovacaoEscalaWfm(corpo), 'Escala enviada para aprovação.')}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('send')}</span>Enviar para aprovação</button>` : null}
          ${aprovacao.pode_aprovar ? html`<button type="button" class="btn btn-primary btn-sm" disabled=${bloqueado} onClick=${() => executar(() => aprovarEscalaWfm(corpo), 'Escala aprovada. Já pode ser publicada.')}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('check_circle')}</span>Aprovar</button>` : null}
          ${aprovacao.pode_declinar ? html`<button type="button" class="btn btn-outline-danger btn-sm" disabled=${bloqueado} onClick=${() => setDeclinando(!declinando)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('cancel')}</span>Declinar</button>` : null}
          ${aprovacao.pode_cancelar ? html`<button type="button" class="btn btn-outline-secondary btn-sm" disabled=${bloqueado} onClick=${() => executar(() => cancelarEnvioEscalaWfm(corpo), 'Envio cancelado. A escala voltou a rascunho.')}>Cancelar envio</button>` : null}
        </span>
      </div>
      ${aprovacao.declinada && aprovacao.motivo ? html`<p class="wfm-aprovacao-motivo"><strong>Justificativa:</strong> ${aprovacao.motivo}</p>` : null}
      ${declinando ? html`
        <div class="wfm-aprovacao-declinar">
          <label class="mon-campo"><span>Justificativa do declínio (obrigatória)</span>
            <input class="form-control" maxlength="400" value=${motivo} onInput=${(e) => setMotivo(e.target.value)} placeholder="Explique o que precisa ser corrigido" />
          </label>
          <button type="button" class="btn btn-danger btn-sm" disabled=${bloqueado || motivo.trim().length < 3} onClick=${() => executar(() => declinarEscalaWfm({ ...corpo, justificativa: motivo }), 'Escala declinada e devolvida para edição.')}>Confirmar declínio</button>
          <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => { setDeclinando(false); setMotivo(''); }}>Voltar</button>
        </div>` : null}
    </div>`;
}
