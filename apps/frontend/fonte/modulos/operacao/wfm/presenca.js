import { html, useCallback, useEffect, useMemo, useState } from '../../../infraestrutura-react.js';
import { EmptyState, LoadingState } from '../../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../../ui/icone.js';
import {
  lancarPresencaLoteWfm,
  lancarPresencaWfm,
  lerEscalaWfm,
  listarAtestadosWfm,
  listarPresencasWfm,
  registrarAtestadoWfm,
} from '../../../services/api/wfm.js';
import { ROTULO_STATUS_PRESENCA, SIGLA_PRESENCA } from './comum.js';

// Presença: Supervisor (própria equipe) e Control Desk (operações vinculadas). Trabalha-se por SEMANA.
// Sem prazo para lançar ou corrigir (regra do RH); tudo fica em auditoria. Atestado guarda só período,
// tipo e quem validou — o arquivo do atestado NUNCA é armazenado (dado de saúde).

const TIPOS_ATESTADO = { MEDICO: 'Médico', ACOMPANHAMENTO: 'Acompanhamento de familiar', DOACAO_SANGUE: 'Doação de sangue', OUTRO: 'Outro' };
const ORIGEM_AUTOMATICA = 'Automática (1º login)'; // mesmo texto gravado pelo backend no primeiro login do dia
const SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const paraIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const somar = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const segundaDe = (d) => somar(d, -((d.getDay() + 6) % 7));
const br = (iso) => iso.split('-').reverse().join('/');

export function TelaPresenca({ controlador, operacao, showToast }) {
  const [ancora, setAncora] = useState(() => new Date());
  const [dados, setDados] = useState(null);
  const [presencas, setPresencas] = useState({});
  const [automaticas, setAutomaticas] = useState({});
  const [atestados, setAtestados] = useState([]);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState('todos'); // todos | faltas | atestados
  const [busca, setBusca] = useState('');
  const [form, setForm] = useState({ id_operador: '', data_ini: '', data_fim: '', tipo: 'MEDICO' });
  const [lote, setLote] = useState({ data: '', status: 'PRESENTE', excecoes: {}, marcar: '' });
  const [ocupado, setOcupado] = useState(false);
  const [verLote, setVerLote] = useState(false);
  const [verAtestados, setVerAtestados] = useState(false);
  const pode = controlador.possuiPermissao('wfm.presenca.lancar');

  const segunda = segundaDe(ancora);
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => paraIso(somar(segunda, i))), [ancora]);
  const meses = useMemo(() => [...new Set(dias.map((d) => d.slice(0, 7)))], [dias]);

  const carregar = useCallback(async () => {
    if (!operacao) return;
    setErro('');
    try {
      const escalas = await Promise.all(meses.map((m) => lerEscalaWfm(operacao, m)));
      const pres = await Promise.all(meses.map((m) => listarPresencasWfm(operacao, m)));
      setDados({
        operadores: escalas[0].operadores,
        turnos: Object.fromEntries(escalas[0].turnos.map((t) => [t.id_turno, t])),
        itens: Object.fromEntries(escalas.flatMap((e) => e.itens).map((i) => [`${i.id_operador}:${i.data}`, i])),
      });
      setPresencas(Object.fromEntries(pres.flatMap((p) => p.itens).map((p) => [`${p.id_operador}:${p.data}`, p.status])));
      setAutomaticas(Object.fromEntries(pres.flatMap((p) => p.itens).filter((p) => p.lancado_por === ORIGEM_AUTOMATICA).map((p) => [`${p.id_operador}:${p.data}`, true])));
      if (pode) {
        const ats = await Promise.all(meses.map((m) => listarAtestadosWfm(operacao, m).catch(() => ({ itens: [] }))));
        setAtestados([...new Map(ats.flatMap((a) => a.itens).map((a) => [a.id_atestado, a])).values()]);
      }
    } catch (e) { setDados(null); setErro(e?.message || 'Não foi possível carregar a presença.'); }
  }, [operacao, meses.join(','), pode]);
  useEffect(() => { setDados(null); carregar(); }, [carregar]);
  useEffect(() => { setLote((l) => ({ ...l, data: dias.includes(l.data) ? l.data : (dias.includes(paraIso(new Date())) ? paraIso(new Date()) : dias[0]), excecoes: {} })); }, [dias.join(',')]);

  const nomes = useMemo(() => Object.fromEntries((dados?.operadores || []).map((o) => [o.id_usuario, o.nome])), [dados]);
  if (erro) return html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  if (!dados) return html`<${LoadingState} titulo="Carregando a presença" />`;

  const escalado = (id, d) => dados.turnos[dados.itens[`${id}:${d}`]?.id_turno]?.tipo === 'TRABALHO';
  const statusDe = (id, d) => presencas[`${id}:${d}`] || '';
  const operadores = dados.operadores.filter((o) => (!busca || o.nome.toLowerCase().includes(busca.toLowerCase()))
    && (filtro === 'todos' || dias.some((d) => statusDe(o.id_usuario, d) === (filtro === 'faltas' ? 'FALTA' : 'ATESTADO')
      || (filtro === 'faltas' && statusDe(o.id_usuario, d) === 'FALTA_JUSTIFICADA'))));
  // Escalado até hoje e sem presença lançada = quem não logou no dia: pendente de confirmação por Supervisor/CD.
  const hoje = paraIso(new Date());
  const pendentes = dados.operadores.flatMap((o) => dias.filter((d) => d <= hoje && escalado(o.id_usuario, d) && !statusDe(o.id_usuario, d)).map((d) => ({ op: o, d })));
  const escaladosDoDia = dados.operadores.filter((o) => escalado(o.id_usuario, lote.data));

  const lancar = async (idOperador, data, status) => {
    if (!status) return;
    try { await lancarPresencaWfm({ operacao, id_operador: idOperador, data, status }); setPresencas((p) => ({ ...p, [`${idOperador}:${data}`]: status })); setAutomaticas((a) => ({ ...a, [`${idOperador}:${data}`]: false })); }
    catch (e) { showToast?.(e?.message || 'Não foi possível lançar a presença.', 'error'); }
  };
  const aplicarLote = async () => {
    const excecoes = Object.keys(lote.excecoes).filter((k) => lote.excecoes[k]).map(Number);
    setOcupado(true);
    try {
      const r = await lancarPresencaLoteWfm({ operacao, data: lote.data, status: lote.status, excecoes });
      if (lote.marcar) await Promise.all(excecoes.map((id) => lancarPresencaWfm({ operacao, id_operador: id, data: lote.data, status: lote.marcar })));
      showToast?.(`${r.aplicados} operador(es) com ${ROTULO_STATUS_PRESENCA[lote.status].toLowerCase()}${excecoes.length ? `; ${excecoes.length} exceção(ões) preservada(s)` : ''}.`, 'success');
      setLote({ ...lote, excecoes: {}, marcar: '' });
      await carregar();
    } catch (e) { showToast?.(e?.message || 'Não foi possível aplicar a presença.', 'error'); } finally { setOcupado(false); }
  };
  const registrarAtestado = async (e) => {
    e.preventDefault();
    try {
      await registrarAtestadoWfm({ operacao, ...form, id_operador: Number(form.id_operador) });
      showToast?.('Atestado registrado.', 'success');
      setForm({ id_operador: '', data_ini: '', data_fim: '', tipo: 'MEDICO' });
      await carregar();
    } catch (err) { showToast?.(err?.message || 'Não foi possível registrar o atestado.', 'error'); }
  };

  if (!dados.operadores.length) return html`<${EmptyState} icon="groups" title="Nenhum operador" text="Não há operadores visíveis para você nesta operação." />`;
  const contagemExc = Object.values(lote.excecoes).filter(Boolean).length;

  return html`
    <section class="mon-card wfm-escala">
      <div class="wfm-cabecalho">
        <div><h3>Presença da semana</h3><p class="mon-muted">${br(dias[0])} a ${br(dias[6])}</p></div>
        <div class="wfm-acoes-cab">
          <button type="button" class="btn btn-outline-secondary btn-sm" aria-label="Semana anterior" onClick=${() => setAncora(somar(ancora, -7))}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('chevron_left')}</span></button>
          <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setAncora(new Date())}>Esta semana</button>
          <button type="button" class="btn btn-outline-secondary btn-sm" aria-label="Próxima semana" onClick=${() => setAncora(somar(ancora, 7))}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('chevron_right')}</span></button>
        </div>
      </div>

      ${pode ? html`<div class="wfm-ferramentas"><button type="button" class=${`btn btn-sm ${verLote ? 'btn-primary' : 'btn-outline-secondary'}`} aria-expanded=${verLote} onClick=${() => setVerLote(!verLote)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('fact_check')}</span>Presença em lote</button>
        <button type="button" class=${`btn btn-sm ${verAtestados ? 'btn-primary' : 'btn-outline-secondary'}`} aria-expanded=${verAtestados} onClick=${() => setVerAtestados(!verAtestados)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Atestados${atestados.length ? ` (${atestados.length})` : ''}</button></div>` : null}

      ${pode && verLote ? html`
        <div class="wfm-form wfm-lote">
          <div class="wfm-lote-titulo"><h4>Presença em lote</h4>
            <p class="mon-muted">Aplique o status a todos os escalados do dia de uma vez. Marque abaixo quem <strong>não</strong> deve receber (faltou, está de atestado...).</p></div>
          <div class="wfm-lote-linha">
            <label class="mon-campo"><span>Dia</span><select class="form-select" value=${lote.data} onChange=${(e) => setLote({ ...lote, data: e.target.value, excecoes: {} })}>${dias.map((d, i) => html`<option key=${d} value=${d}>${SEMANA[i]} ${br(d).slice(0, 5)}</option>`)}</select></label>
            <label class="mon-campo"><span>Aplicar a todos</span><select class="form-select" value=${lote.status} onChange=${(e) => setLote({ ...lote, status: e.target.value })}>${Object.entries(ROTULO_STATUS_PRESENCA).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></label>
            <label class="mon-campo"><span>Quem ficou de fora, marcar como</span><select class="form-select" value=${lote.marcar} onChange=${(e) => setLote({ ...lote, marcar: e.target.value })}><option value="">Não alterar</option>${['FALTA', 'FALTA_JUSTIFICADA', 'ATESTADO'].map((k) => html`<option key=${k} value=${k}>${ROTULO_STATUS_PRESENCA[k]}</option>`)}</select></label>
            <button type="button" class="btn btn-primary wfm-lote-botao" disabled=${ocupado || !escaladosDoDia.length || escaladosDoDia.length === contagemExc} onClick=${aplicarLote}>${ROTULO_STATUS_PRESENCA[lote.status]} para ${escaladosDoDia.length - contagemExc} operador(es)</button>
          </div>
          ${escaladosDoDia.length ? html`
            <div class="wfm-lote-excecoes">
              <strong class="wfm-rotulo-sm">Exceto (${contagemExc} de ${escaladosDoDia.length} escalados em ${br(lote.data).slice(0, 5)})</strong>
              <div class="wfm-excecoes">${escaladosDoDia.map((o) => html`<label key=${o.id_usuario} class=${`wfm-excecao ${lote.excecoes[o.id_usuario] ? 'is-marcada' : ''}`}><input type="checkbox" checked=${!!lote.excecoes[o.id_usuario]} onChange=${() => setLote({ ...lote, excecoes: { ...lote.excecoes, [o.id_usuario]: !lote.excecoes[o.id_usuario] } })} /><span>${o.nome}</span>${statusDe(o.id_usuario, lote.data) ? html`<small class=${`wfm-pres wfm-pres-${statusDe(o.id_usuario, lote.data).toLowerCase()}`}>${SIGLA_PRESENCA[statusDe(o.id_usuario, lote.data)]}</small>` : null}</label>`)}</div>
            </div>` : html`<p class="mon-muted">Ninguém da sua equipe está escalado em ${br(lote.data)}.</p>`}
        </div>` : null}

      ${pode && pendentes.length ? html`
        <div class="wfm-form wfm-pendentes" role="region" aria-label="Presenças pendentes de confirmação">
          <div class="wfm-lote-titulo"><h4>Pendentes de confirmação (${pendentes.length})</h4>
            <p class="mon-muted">Escalados que não logaram no Conecta no dia. Dê a presença ou marque a falta.</p></div>
          <ul class="wfm-pendentes-lista">${pendentes.map(({ op, d }) => html`<li key=${`${op.id_usuario}:${d}`}>
            <span class="lp-trunca" title=${op.nome}>${op.nome}</span><small class="mon-muted">${br(d).slice(0, 5)}</small>
            <button type="button" class="btn btn-sm btn-outline-secondary" onClick=${() => lancar(op.id_usuario, d, 'PRESENTE')}>Dar presença</button>
            <button type="button" class="btn btn-sm btn-outline-secondary" onClick=${() => lancar(op.id_usuario, d, 'FALTA')}>Marcar falta</button></li>`)}</ul>
        </div>` : null}

      <div class="wfm-filtros-escala">
        <label class="mon-campo"><span>Mostrar</span><select class="form-select" value=${filtro} onChange=${(e) => setFiltro(e.target.value)}><option value="todos">Todos os operadores</option><option value="faltas">Só quem faltou na semana</option><option value="atestados">Só quem está de atestado</option></select></label>
        <label class="mon-campo"><span>Buscar operador</span><input class="form-control" value=${busca} onInput=${(e) => setBusca(e.target.value)} placeholder="Nome" /></label>
        <span class="wfm-contagem">${operadores.length} de ${dados.operadores.length} operador(es)</span>
        <span class="wfm-legenda-pres">${Object.entries(SIGLA_PRESENCA).map(([k, s]) => html`<span key=${k}><span class=${`wfm-pres wfm-pres-${k.toLowerCase()}`}>${s}</span>${ROTULO_STATUS_PRESENCA[k]}</span>`)}</span>
      </div>
      <div class="wfm-grade-wrap" role="region" aria-label="Presença da semana" tabindex="0">
        <table class="wfm-grade wfm-grade--sem-sel wfm-grade--semana">
          <thead><tr><th class="wfm-col-nome">Operador</th>${dias.map((d, i) => html`<th key=${d} class=${`wfm-col-dia ${i > 4 ? 'is-fds' : ''}`}><span>${d.slice(8)}</span><small>${SEMANA[i]}</small></th>`)}</tr></thead>
          <tbody>${operadores.map((op) => html`<tr key=${op.id_usuario}><th class="wfm-col-nome" scope="row"><span class="wfm-nome">${op.nome}</span></th>
            ${dias.map((d, i) => { const valor = statusDe(op.id_usuario, d); const esc = escalado(op.id_usuario, d);
              return html`<td key=${d} class=${`${i > 4 ? 'is-fds' : ''} ${esc ? 'is-escalada' : ''}`} title=${automaticas[`${op.id_usuario}:${d}`] ? 'Presença automática (primeiro login do dia)' : esc ? 'Escalado neste dia' : 'Sem escala de trabalho neste dia'}>
                ${pode ? html`<select class=${`wfm-select wfm-pres-${valor.toLowerCase()}`} aria-label=${`${op.nome}, ${br(d)}`} value=${valor} onChange=${(e) => lancar(op.id_usuario, d, e.target.value)}><option value="">${esc ? '·' : '—'}</option>${Object.entries(SIGLA_PRESENCA).map(([k, s]) => html`<option key=${k} value=${k}>${s}</option>`)}</select>`
                  : html`<span class=${`wfm-pres wfm-pres-${valor.toLowerCase()}`}>${SIGLA_PRESENCA[valor] || '·'}</span>`}</td>`; })}</tr>`)}</tbody>
        </table>
      </div>
    </section>

    ${pode && verAtestados ? html`
      <section class="mon-card">
        <h3>Atestados</h3>
        <p class="mon-muted">Registra período, tipo e quem validou.</p>
        <form class="wfm-linha-form" onSubmit=${registrarAtestado}>
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
          <tbody>${atestados.map((a) => html`<tr key=${a.id_atestado}><td>${nomes[a.id_operador] || a.id_operador}</td><td>${br(a.data_ini)} a ${br(a.data_fim)}</td><td>${TIPOS_ATESTADO[a.tipo] || a.tipo}</td><td>${a.validado_por}</td></tr>`)}</tbody></table></div>` : null}
      </section>` : null}`;
}
