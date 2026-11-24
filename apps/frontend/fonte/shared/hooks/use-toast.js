import { html, useState } from '../../infraestrutura-react.js?v=20261124-equipes3';
import { ToastAlert } from '../../ui/components/primitives.js?v=20261124-equipes3';

/**
 * Hook compartilhado para substituir `window.alert()` por uma notificação
 * visual não bloqueante (ToastAlert), mantendo a mesma mensagem de texto.
 *
 * Uso:
 *   const { toast, showToast, ToastHost } = useToast();
 *   showToast('Registro salvo com sucesso.', 'success');
 *   // ... no JSX do componente:
 *   <${ToastHost} />
 */
// Bootstrap só define as variantes primary/secondary/success/danger/warning/info/light/dark
// (não existe "alert-error"). Mapeamos aliases comuns para a classe correta do ToastAlert.
const MAPA_TOM = {
  error: 'danger',
  erro: 'danger',
  sucesso: 'success',
  aviso: 'warning',
};

function normalizarTom(tom) {
  return MAPA_TOM[tom] || tom;
}

export function useToast(duracaoPadraoMs = 4000) {
  const [toast, setToast] = useState(null); // { mensagem, tom }

  const showToast = (mensagem, tom = 'info', duracaoMs = duracaoPadraoMs) => {
    setToast({ mensagem, tom: normalizarTom(tom) });
    if (duracaoMs) {
      window.setTimeout(() => {
        setToast((atual) => (atual && atual.mensagem === mensagem ? null : atual));
      }, duracaoMs);
    }
  };

  const hideToast = () => setToast(null);

  const ToastHost = () => (
    toast
      ? html`<${ToastAlert} message=${toast.mensagem} tone=${toast.tom} onClose=${hideToast} />`
      : null
  );

  return { toast, showToast, hideToast, ToastHost };
}
