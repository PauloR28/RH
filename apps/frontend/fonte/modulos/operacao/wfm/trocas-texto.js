import { html, useState } from '../../../infraestrutura-react.js';

// Textos formais da troca de escala (pedido do operador e resumo do supervisor) e o diálogo de confirmação.
// Troca em sábado/domingo usa o texto de final de semana (jornada e folgas 100% trocadas).

const brIso = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const diaSemana = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d).getDay(); }; // 0 = domingo
const NOME_FIM_SEMANA = { 6: 'sábado', 0: 'domingo' };
const maiusc = (n) => String(n || '').trim().toUpperCase();

// Datas da troca: "10/11/2026" ou, quando cada um assume o dia do outro, "10/11/2026 x 12/11/2026".
const rotuloDatas = (dataA, dataB) => (dataB && dataB !== dataA ? `${brIso(dataA)} x ${brIso(dataB)}` : brIso(dataA));
const fimDeSemana = (dataA, dataB) => [dataA, dataB].filter(Boolean).find((d) => NOME_FIM_SEMANA[diaSemana(d)] !== undefined);

export function textoTrocaOperador({ dataA, dataB, nomeA, nomeB, horario }) {
  const par = `${maiusc(nomeA)} x ${maiusc(nomeB)}`;
  const fds = fimDeSemana(dataA, dataB);
  if (fds) {
    return `Informamos a seguinte troca de escala entre os colaboradores para este final de semana (${NOME_FIM_SEMANA[diaSemana(fds)]}, ${rotuloDatas(dataA, dataB)}):\n\n${par}\n\n`
      + 'Ressalto estar cientes de que a alteração contempla 100% dos respectivos horários e possíveis folgas, devendo a jornada ser cumprida em sua totalidade.';
  }
  return `Formalizo a troca de escala agendada para, ${rotuloDatas(dataA, dataB)}, no horário: ${horario}, referente aos colaboradores abaixo:\n${par}\n`
    + 'Ressalto que todos os envolvidos deverão estar cientes de que devem cumprir 100% da escala e das demandas do respectivo parceiro de troca.\n'
    + 'Além disso, ressalto que estou ciente de que fui orientado a utilizar a posição de trabalho (layout) correspondente e a garantir previamente o acesso a todas as senhas e autenticações MFA, evitando atrasos ou impedimentos no log no início da operação.';
}

export function textoTrocaSupervisor({ dataA, dataB, nomeA, nomeB }) {
  const par = `${maiusc(nomeA)} x ${maiusc(nomeB)}`;
  const fds = fimDeSemana(dataA, dataB);
  if (fds) {
    return `Informamos a seguinte troca de escala entre os colaboradores para este final de semana (${NOME_FIM_SEMANA[diaSemana(fds)]}, ${rotuloDatas(dataA, dataB)}):\n- ${par}\n`
      + 'Ressaltamos que todos os colaboradores envolvidos estão cientes de que a alteração contempla 100% dos respectivos horários e possíveis folgas, devendo a jornada ser cumprida em sua totalidade.';
  }
  return `Formalizo a troca de escala agendada para, ${rotuloDatas(dataA, dataB)}, referente aos colaboradores abaixo:\n${par}\n`
    + 'Ressalto que todos os envolvidos estão cientes de que devem cumprir 100% da escala e das demandas do respectivo parceiro de troca.\n'
    + 'Além disso, os colaboradores foram orientados a utilizar a posição de trabalho (layout) correspondente e a garantir previamente o acesso a todas as senhas e autenticações MFA, evitando atrasos ou impedimentos no log no início da operação.';
}

// Abre o WhatsApp (reaproveita a janela/aba "conecta-whatsapp" se já existir) com a mensagem pronta para colar no grupo.
export const abrirWhatsapp = (texto) => window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`, 'conecta-whatsapp');

// Confirmação do supervisor ao aprovar: mostra o resumo e permite compartilhar no WhatsApp. `onConfirmar` roda a aprovação.
export function ModalResumoTroca({ texto, onConfirmar, onClose, ocupado }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { /* sem permissão da área de transferência */ }
  };
  return html`<div class="rh-modal-overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="mc-modal c24-fade-in" role="dialog" aria-modal="true" aria-labelledby="tr-resumo-titulo">
      <header class="mc-modal-cab"><div><h3 id="tr-resumo-titulo">Resumo e confirmação da troca</h3><p>Confira a mensagem antes de aprovar.</p></div>
        <button type="button" class="mc-fechar" aria-label="Fechar" onClick=${onClose}>×</button></header>
      <pre class="tr-resumo-texto">${texto}</pre>
      <div class="wfm-acoes">
        <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => abrirWhatsapp(texto)}>Compartilhar no WhatsApp</button>
        <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${copiar}>${copiado ? 'Mensagem copiada' : 'Copiar mensagem'}</button>
      </div>
      <footer class="mc-modal-rodape">
        <button type="button" class="btn btn-outline-secondary" onClick=${onClose}>Voltar</button>
        <button type="button" class="btn btn-primary" disabled=${ocupado} onClick=${onConfirmar}>${ocupado ? 'Aprovando…' : 'Confirmar aprovação'}</button>
      </footer>
    </div>
  </div>`;
}
