// Sessão sem uso (Configurações › Segurança, Etapa 7b): depois de N minutos parado, o Conecta sai sozinho.
// Avisa X minutos antes, com botão para continuar. Os números vêm da tela Segurança (GET /settings/seguranca/sessao).
import { html, useEffect, useRef, useState } from '../../infraestrutura-react.js?v=20261124-equipes4';
import { requisitar } from '../../services/api/core.js?v=20261124-equipes4';

const EVENTOS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
// Várias abas abertas: o uso numa aba vale para todas (senão a aba de fundo derrubaria quem está trabalhando na outra).
const CHAVE = 'conecta.ultimoUso';
const gravar = (t) => { try { window.localStorage.setItem(CHAVE, String(t)); } catch { /* sem storage */ } };
const lerGravado = () => { try { return Number(window.localStorage.getItem(CHAVE)) || 0; } catch { return 0; } };

export function SessaoOciosa({ controlador }) {
  const autenticado = Boolean(controlador?.estado?.autenticado);
  const [config, setConfig] = useState(null);
  const [avisando, setAvisando] = useState(false);
  const ultimo = useRef(Date.now());

  useEffect(() => {
    if (!autenticado) { setConfig(null); return undefined; }
    let vivo = true;
    requisitar('/settings/seguranca/sessao', { method: 'GET' }).then((d) => { if (vivo) setConfig(d); }).catch(() => {});
    return () => { vivo = false; };
  }, [autenticado]);

  useEffect(() => {
    if (!autenticado || !config?.ociosa_minutos) return undefined;
    const tocar = () => { const t = Date.now(); if (t - ultimo.current > 5000) gravar(t); ultimo.current = t; };
    EVENTOS.forEach((ev) => window.addEventListener(ev, tocar, { passive: true }));
    ultimo.current = Date.now();
    const limite = config.ociosa_minutos * 60000;
    const aviso = Math.min(config.aviso_minutos || 0, config.ociosa_minutos - 1) * 60000;
    const relogio = window.setInterval(() => {
      const parado = Date.now() - Math.max(ultimo.current, lerGravado());
      if (parado >= limite) { window.clearInterval(relogio); controlador.sair(); return; }
      setAvisando(aviso > 0 && parado >= limite - aviso);
    }, 15000);
    return () => { window.clearInterval(relogio); EVENTOS.forEach((ev) => window.removeEventListener(ev, tocar)); };
  }, [autenticado, config]);

  if (!avisando) return null;
  return html`<div class="c-faixa c-faixa--atencao" role="alert" style=${{ position: 'fixed', right: '16px', bottom: '16px', zIndex: 2000, maxWidth: '360px' }}>
    <div class="c-faixa-txt"><p>Você está sem usar o Conecta. Ele vai sair sozinho em instantes.</p></div>
    <button type="button" class="c-botao c-botao--principal c-botao--compacto" onClick=${() => { ultimo.current = Date.now(); gravar(ultimo.current); setAvisando(false); }}>Continuar</button>
  </div>`;
}
