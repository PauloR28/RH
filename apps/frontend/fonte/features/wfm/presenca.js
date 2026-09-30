import { html, useCallback, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import {
  lancarPresencaWfm,
  lerEscalaWfm,
  listarAtestadosWfm,
  listarPresencasWfm,
  registrarAtestadoWfm,
} from '../../services/api/wfm.js';
import { ROTULO_STATUS_PRESENCA, SIGLA_PRESENCA, infoDia } from './comum.js';

// Presença: Supervisor (própria equipe) e Control Desk (operações vinculadas). Sem prazo para
// lançar ou corrigir (regra do RH); tudo fica em auditoria. Atestado guarda só período, tipo e
// quem validou — o arquivo do atestado NUNCA é armazenado (dado de saúde).

const TIPOS_ATESTADO = { MEDICO: 'Médico', ACOMPANHAMENTO: 'Acompanhamento de familiar', DOACAO_SANGUE: 'Doação de sangue', OUTRO: 'Outro' };

export function TelaPresenca({ controlador, operacao, anoMes, showToast }) {
  const [dados, setDados] = useState(null);
  const [presencas, setPresencas] = useState({});
  const [atestados, setAtestados] = useState([]);
  const [erro, setErro] = useState('');
  const [form, setForm] = useState({ id_operador: '', data_ini: '', data_fim: '', tipo: 'MEDICO' });
  const pode = controlador.possuiPermissao('wfm.presenca.lancar');

  const carregar = useCallback(async () => {
    if (!operacao) return;
    setErro('');
    try {
      const [escala, pres] = await Promise.all([lerEscalaWfm(operacao, anoMes), listarPresencasWfm(operacao, anoMes)]);
      setDados(escala);
      setPresencas(Object.fromEntries((pres.itens || []).map((p) => [`${p.id_operador}:${p.data}`, p.status])));
      if (pode) listarAtestadosWfm(operacao, anoMes).then((r) => setAtestados(r.itens || [])).catch(() => setAtestados([]));
    } catch (e) {
      setDados(null);
      setErro(e?.message || 'Não foi possível carregar a presença.');
    }
  }, [operacao, anoMes, pode]);
  useEffect(() => { setDados(null); carregar(); }, [carregar]);

  const nomes = useMemo(() => Object.fromEntries((dados?.operadores || []).map((o) => [o.id_usuario, o.nome])), [dados]);

  if (erro) return html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  if (!dados) return html`<${LoadingState} titulo="Carregando a presença" />`;

  const lancar = async (idOperador, data, status) => {
    if (!status) return;
    try {
      await lancarPresencaWfm({ operacao, id_operador: idOperador, data, status });
      setPresencas((p) => ({ ...p, [`${idOperador}:${data}`]: status }));
    } catch (e) {
      showToast?.(e?.message || 'Não foi possível lançar a presença.', 'error');
    }
  };

  const registrarAtestado = async (e) => {
    e.preventDefault();
    try {
      await registrarAtestadoWfm({ operacao, ...form, id_operador: Number(form.id_operador) });
      showToast?.('Atestado registrado (somente período, tipo e validador).', 'success');
      setForm({ id_operador: '', data_ini: '', data_fim: '', tipo: 'MEDICO' });
      await carregar();
    } catch (err) {
      showToast?.(err?.message || 'Não foi possível registrar o atestado.', 'error');
    }
  };

  if (!dados.operadores.length) return html`<${EmptyState} icon="groups" title="Nenhum operador" text="Não há operadores visíveis para você nesta operação." />`;

  return html`
    <section class="mon-card wfm-escala">
      <div class="wfm-cabecalho"><div><h3>Presença</h3>
        <p class="mon-muted">Sem prazo para lançar ou corrigir. Cada lançamento é auditado. ${Object.entries(SIGLA_PRESENCA).map(([k, s]) => `${s} = ${ROTULO_STATUS_PRESENCA[k]}`).join(' · ')}</p></div></div>
      <div class="wfm-grade-wrap" role="region" aria-label="Presença do mês" tabindex="0">
        <table class="wfm-grade">
          <thead><tr><th class="wfm-col-nome">Operador</th>
            ${dados.dias.map((d) => { const i = infoDia(d); return html`<th key=${d} class=${`wfm-col-dia ${i.fimDeSemana ? 'is-fds' : ''}`}><span>${i.dia}</span><small>${i.semana}</small></th>`; })}
          </tr></thead>
          <tbody>
            ${dados.operadores.map((op) => html`<tr key=${op.id_usuario}>
              <th class="wfm-col-nome" scope="row">${op.nome}</th>
              ${dados.dias.map((d) => {
                const valor = presencas[`${op.id_usuario}:${d}`] || '';
                return html`<td key=${d} class=${infoDia(d).fimDeSemana ? 'is-fds' : ''}>
                  ${pode ? html`<select class=${`wfm-select wfm-pres-${valor.toLowerCase()}`} aria-label=${`${op.nome}, dia ${infoDia(d).dia}`} value=${valor} onChange=${(e) => lancar(op.id_usuario, d, e.target.value)}>
                    <option value="">—</option>
                    ${Object.entries(SIGLA_PRESENCA).map(([k, s]) => html`<option key=${k} value=${k}>${s}</option>`)}
                  </select>` : html`<span class=${`wfm-pres wfm-pres-${valor.toLowerCase()}`}>${SIGLA_PRESENCA[valor] || '·'}</span>`}
                </td>`;
              })}
            </tr>`)}
          </tbody>
        </table>
      </div>
    </section>

    ${pode ? html`
      <section class="mon-card">
        <h3>Atestados</h3>
        <p class="mon-muted">Registra apenas período, tipo e quem validou. Não anexe nem digite o conteúdo do atestado: é dado de saúde e não é armazenado.</p>
        <form class="mon-linha-form" onSubmit=${registrarAtestado}>
          <label class="mon-campo"><span>Operador</span>
            <select class="form-select" required value=${form.id_operador} onChange=${(e) => setForm({ ...form, id_operador: e.target.value })}>
              <option value="">Selecione</option>${dados.operadores.map((o) => html`<option key=${o.id_usuario} value=${o.id_usuario}>${o.nome}</option>`)}
            </select></label>
          <label class="mon-campo"><span>Início</span><input class="form-control" type="date" required value=${form.data_ini} onChange=${(e) => setForm({ ...form, data_ini: e.target.value, data_fim: form.data_fim || e.target.value })} /></label>
          <label class="mon-campo"><span>Fim</span><input class="form-control" type="date" required value=${form.data_fim} onChange=${(e) => setForm({ ...form, data_fim: e.target.value })} /></label>
          <label class="mon-campo"><span>Tipo</span>
            <select class="form-select" value=${form.tipo} onChange=${(e) => setForm({ ...form, tipo: e.target.value })}>
              ${Object.entries(TIPOS_ATESTADO).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}
            </select></label>
          <button type="submit" class="btn btn-primary"><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Registrar</button>
        </form>
        ${atestados.length ? html`<div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Operador</th><th>Período</th><th>Tipo</th><th>Validado por</th></tr></thead>
          <tbody>${atestados.map((a) => html`<tr key=${a.id_atestado}><td>${nomes[a.id_operador] || a.id_operador}</td><td>${a.data_ini.split('-').reverse().join('/')} a ${a.data_fim.split('-').reverse().join('/')}</td><td>${TIPOS_ATESTADO[a.tipo] || a.tipo}</td><td>${a.validado_por}</td></tr>`)}</tbody></table></div>` : null}
      </section>` : null}`;
}
