import { html, useCallback, useEffect, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import { definirCapacidadePausasWfm, distribuirPausasWfm, lerPausasDiaWfm, salvarPausasWfm } from '../../services/api/wfm.js';

// Escala de pausas: cada operador escalado tem 3 pausas por dia (2 de 10 min e 1 de 20 min), todas
// contadas como jornada. A quantidade de operadores em pausa ao mesmo tempo é da operação (alerta, não bloqueio).
// Pausas emergenciais (banheiro, feedback...) não entram aqui.

const ROTULO = { DESCANSO: 'Descanso', REFEICAO: 'Refeição' };
const paraIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const doIso = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
const br = (iso) => iso.split('-').reverse().join('/');
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function TelaPausas({ controlador, operacao, anoMes, showToast }) {
  const [dia, setDia] = useState(() => {
    const hoje = paraIso(new Date());
    return hoje.startsWith(anoMes) ? hoje : `${anoMes}-01`;
  });
  const [dados, setDados] = useState(null);
  const [edicao, setEdicao] = useState({});      // id_operador -> pausas editadas
  const [capacidade, setCapacidade] = useState('');
  const [sobrescrever, setSobrescrever] = useState(false);
  const [escopo, setEscopo] = useState('dia'); // 'dia' | 'semana' | 'mes'
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const podeEditar = controlador.possuiPermissao('wfm.escala.editar');
  const podeCapacidade = controlador.possuiPermissao('wfm.cadastros.editar');

  useEffect(() => { if (!dia.startsWith(anoMes)) setDia(`${anoMes}-01`); }, [anoMes]);

  const carregar = useCallback(async () => {
    if (!operacao) return;
    setErro('');
    try {
      const d = await lerPausasDiaWfm(operacao, dia);
      setDados(d);
      setCapacidade(String(d.capacidade));
      setEdicao({});
    } catch (e) { setDados(null); setErro(e?.message || 'Não foi possível carregar as pausas.'); }
  }, [operacao, dia]);
  useEffect(() => { setDados(null); carregar(); }, [carregar]);

  const executar = async (fn, sucesso) => {
    setOcupado(true);
    try { await fn(); showToast?.(sucesso, 'success'); await carregar(); } catch (e) { showToast?.(e?.message || 'Não foi possível concluir.', 'error'); } finally { setOcupado(false); }
  };

  if (erro) return html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  if (!dados) return html`<${LoadingState} titulo="Carregando as pausas" />`;

  const mover = (n) => { const d = doIso(dia); d.setDate(d.getDate() + n); setDia(paraIso(d)); };
  const pausasDe = (op) => edicao[op.id_operador] || op.pausas;
  const mudar = (op, ordem, campo, valor) => {
    const base = pausasDe(op).map((p) => ({ ...p }));
    setEdicao({ ...edicao, [op.id_operador]: base.map((p) => (p.ordem === ordem ? { ...p, [campo]: valor } : p)) });
  };
  const iniciar = (op) => setEdicao({ ...edicao, [op.id_operador]: dados.pausas_padrao.map((p) => ({ ordem: p.ordem, tipo: p.tipo, inicio: op.turno.entrada, duracao_min: p.duracao_min })) });
  const alteradas = Object.keys(edicao).length;

  const salvar = () => executar(
    () => salvarPausasWfm({ operacao, data: dia, itens: Object.entries(edicao).map(([id, pausas]) => ({ id_operador: Number(id), pausas })) }),
    'Pausas salvas.',
  );
  // Período atingido: o dia, a semana (seg–dom) ou o mês, sempre dentro do mês aberto.
  const periodo = () => {
    const [a, m] = anoMes.split('-').map(Number);
    const ultimo = paraIso(new Date(a, m, 0));
    if (escopo === 'mes') return [`${anoMes}-01`, ultimo];
    const base = doIso(dia);
    const seg = new Date(base); seg.setDate(seg.getDate() - ((base.getDay() + 6) % 7));
    const dom = new Date(seg); dom.setDate(dom.getDate() + 6);
    return [paraIso(seg) < `${anoMes}-01` ? `${anoMes}-01` : paraIso(seg), paraIso(dom) > ultimo ? ultimo : paraIso(dom)];
  };
  const distribuir = async () => {
    if (escopo === 'dia') {
      return executar(() => distribuirPausasWfm({ operacao, data: dia, sobrescrever }), 'Pausas distribuídas respeitando o limite de operadores em pausa ao mesmo tempo.');
    }
    const [ini, fim] = periodo();
    setOcupado(true);
    try {
      const r = await distribuirPausasWfm({ operacao, data: ini, data_fim: fim, sobrescrever });
      showToast?.(`Pausas programadas em ${r.dias_programados} dia(s) (${r.operadores} operador(es))${r.dias_pulados ? `; ${r.dias_pulados} dia(s) sem alteração` : ''}.`, 'success');
      await carregar();
    } catch (e) { showToast?.(e?.message || 'Não foi possível distribuir as pausas.', 'error'); } finally { setOcupado(false); }
  };
  const salvarCapacidade = () => executar(
    () => definirCapacidadePausasWfm({ operacao, pausas_simultaneas: Number(capacidade) }),
    'Limite de operadores em pausa atualizado.',
  );
  const d = doIso(dia);
  const maxOcup = Math.max(1, dados.capacidade, ...dados.ocupacao.map((o) => o.qtd));

  return html`
    <section class="mon-card wfm-escala">
      <div class="wfm-cabecalho">
        <div><h3>Escala de pausas</h3>
          <p class="mon-muted">${SEMANA[d.getDay()]}, ${br(dia)} · cada operador escalado tem 3 pausas: 2 de 10 min e 1 de 20 min (contam como jornada).</p></div>
        <div class="wfm-acoes-cab">
          <button type="button" class="btn btn-outline-secondary btn-sm" aria-label="Dia anterior" onClick=${() => mover(-1)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('chevron_left')}</span></button>
          <input class="form-control wfm-data" type="date" value=${dia} min=${`${anoMes}-01`} onChange=${(e) => e.target.value && setDia(e.target.value)} />
          <button type="button" class="btn btn-outline-secondary btn-sm" aria-label="Próximo dia" onClick=${() => mover(1)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('chevron_right')}</span></button>
        </div>
      </div>

      <div class="wfm-pausas-config">
        <label class="mon-campo"><span>Operadores em pausa ao mesmo tempo (limite da operação)</span>
          <input class="form-control" type="number" min="1" max="200" disabled=${!podeCapacidade} value=${capacidade} onInput=${(e) => setCapacidade(e.target.value)} /></label>
        ${podeCapacidade ? html`<button type="button" class="btn btn-outline-secondary btn-sm" disabled=${ocupado || Number(capacidade) === dados.capacidade} onClick=${salvarCapacidade}>Salvar limite</button>` : null}
        <p class="mon-muted">Operações pequenas costumam usar 1 por vez; operações grandes, cerca de 4 (recomendado, não é um limite rígido: exceder gera um alerta).</p>
      </div>

      ${dados.excedentes.length ? html`<div class="wfm-validacao is-alerta" role="status"><strong>Mais operadores em pausa do que o limite</strong>
        <ul>${dados.excedentes.map((x, i) => html`<li key=${i}>${x.inicio}–${x.fim}: ${x.qtd} em pausa (limite ${x.capacidade})</li>`)}</ul></div>` : null}

      ${!dados.operadores.length ? html`<${EmptyState} icon="schedule" title="Ninguém escalado neste dia" text="As pausas são programadas para quem tem turno de trabalho no dia. Monte a escala de turnos primeiro." />` : html`
        ${podeEditar ? html`<div class="wfm-acoes">
          <label class="wfm-campo"><span>Aplicar em</span><select class="form-select" value=${escopo} onChange=${(e) => setEscopo(e.target.value)}><option value="dia">Só este dia</option><option value="semana">Toda a semana</option><option value="mes">Todo o mês</option></select></label>
          <button type="button" class="btn btn-primary" disabled=${ocupado} onClick=${distribuir}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('schedule')}</span>Distribuir pausas automaticamente</button>
          <label class="wfm-check"><input type="checkbox" checked=${sobrescrever} onChange=${(e) => setSobrescrever(e.target.checked)} /> Refazer também quem já tem pausas (${dados.operadores.length - dados.sem_pausa_programada} de ${dados.operadores.length})</label>
        </div>` : null}
        <div class="mon-tabela-wrap"><table class="mon-tabela wfm-tabela-pausas"><thead><tr><th>Operador</th><th>Turno</th>
          ${dados.pausas_padrao.map((p) => html`<th key=${p.ordem}>Pausa ${p.ordem} · ${ROTULO[p.tipo]} ${p.duracao_min} min</th>`)}</tr></thead><tbody>
          ${dados.operadores.map((op) => { const pausas = pausasDe(op); return html`<tr key=${op.id_operador} class=${edicao[op.id_operador] ? 'is-pendente' : ''}>
            <td><strong>${op.nome}</strong>${op.erros.length ? html`<small class="wfm-alerta-txt">${op.erros[0]}</small>` : null}</td>
            <td>${op.turno.codigo} <small class="wfm-sub">${op.turno.entrada}–${op.turno.saida}</small></td>
            ${dados.pausas_padrao.map((padrao) => { const p = pausas.find((x) => x.ordem === padrao.ordem);
              return html`<td key=${padrao.ordem}>${p ? (podeEditar
                ? html`<input class="form-control wfm-hora" type="time" aria-label=${`${op.nome}, pausa ${padrao.ordem}`} value=${p.inicio} onInput=${(e) => mudar(op, padrao.ordem, 'inicio', e.target.value)} />`
                : html`<strong>${p.inicio}</strong>`) : (podeEditar && padrao.ordem === 1 ? html`<button type="button" class="wfm-link" onClick=${() => iniciar(op)}>Definir manualmente</button>` : html`<span class="mon-muted">—</span>`)}</td>`; })}
          </tr>`; })}
        </tbody></table></div>
        ${podeEditar && alteradas ? html`<div class="wfm-acoes"><button type="button" class="btn btn-primary" disabled=${ocupado} onClick=${salvar}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('check')}</span>Salvar pausas (${alteradas})</button><button type="button" class="btn btn-outline-secondary" onClick=${() => setEdicao({})}>Descartar</button></div>` : null}

        ${dados.ocupacao.length ? html`<div class="wfm-legenda-detalhe"><h4>Operadores em pausa por faixa de 30 minutos (pico)</h4>
          <div class="wfm-ocupacao">${dados.ocupacao.map((o) => html`<div key=${o.hora} class=${`wfm-ocupacao-barra ${o.qtd > dados.capacidade ? 'is-excesso' : ''}`} title=${`${o.hora}: ${o.qtd} em pausa`}>
            <span style=${{ height: `${Math.max(8, (o.qtd / maxOcup) * 64)}px` }}></span><small>${o.hora}</small></div>`)}</div></div>` : null}`}
    </section>`;
}
