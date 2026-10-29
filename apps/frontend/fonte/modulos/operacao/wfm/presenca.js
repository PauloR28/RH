import { html, useCallback, useEffect, useMemo, useRef, useState } from '../../../infraestrutura-react.js';
import { EmptyState } from '../../../ui/componentes-compartilhados.js';
import { EsqueletoLinhas } from '../../../ui/components/console-primitivas.js?v=20261022-equipes';
import { PainelFlutuante, Stepper } from '../../../ui/components/modulo-primitivas.js?v=20261023-ajustes';
import {
  lancarPresencaLoteWfm,
  lancarPresencaWfm,
  lerEscalaWfm,
  listarAtestadosWfm,
  listarPresencasWfm,
  pendenciasPresencaWfm,
  registrarAtestadoWfm,
} from '../../../services/api/wfm.js?v=20261026-trocas';
import { ROTULO_STATUS_PRESENCA, SIGLA_PRESENCA } from './comum.js';
import { Icone } from './escala-ui.js?v=20261023-ajustes';

// Presença: Supervisor (própria equipe) e Control Desk (operações vinculadas). Trabalha-se por SEMANA.
// Sem prazo para lançar ou corrigir (regra do RH); tudo fica em auditoria. Atestado guarda só período,
// tipo e quem validou — o arquivo do atestado NUNCA é armazenado (dado de saúde).
// Layout: quadro da semana à esquerda e pendências de confirmação à direita. O total de pendências vem do servidor.

const TIPOS_ATESTADO = { MEDICO: 'Médico', ACOMPANHAMENTO: 'Acompanhamento de familiar', DOACAO_SANGUE: 'Doação de sangue', OUTRO: 'Outro' };
const ORIGEM_AUTOMATICA = 'Automática (1º login)'; // mesmo texto gravado pelo backend no primeiro login do dia
const SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const paraIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const somar = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const segundaDe = (d) => somar(d, -((d.getDay() + 6) % 7));
const br = (iso) => iso.split('-').reverse().join('/');
const SIGLA_CLASSE = { PRESENTE: 'p', FALTA: 'f', FALTA_JUSTIFICADA: 'fj', ATESTADO: 'at', SERVICO_EXTERNO: 'se', DAY_OFF: 'do', FOLGA_COMP_BH: 'fb', FOLGA: 'fl', FERIAS: 'fe' };

export function TelaPresenca({ controlador, operacao, showToast, aoMudarPendencias }) {
  const [ancora, setAncora] = useState(() => new Date());
  const [dados, setDados] = useState(null);
  const [presencas, setPresencas] = useState({});
  const [automaticas, setAutomaticas] = useState({});
  const [atestados, setAtestados] = useState([]);
  const [pend, setPend] = useState({ total: 0, itens: [] });
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState('todos'); // todos | faltas | atestados
  const [busca, setBusca] = useState('');
  const [form, setForm] = useState({ id_operador: '', data_ini: '', data_fim: '', tipo: 'MEDICO' });
  const [lote, setLote] = useState({ data: '', status: 'PRESENTE', excecoes: {}, marcar: '' });
  const [ocupado, setOcupado] = useState(false);
  const [verLote, setVerLote] = useState(false);
  const [verAtestados, setVerAtestados] = useState(false);
  const [gavetaPend, setGavetaPend] = useState(false);
  const listaRef = useRef(null);
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
        const p = await pendenciasPresencaWfm(operacao, dias[0], dias[6]).catch(() => ({ total: 0, itens: [] }));
        setPend({ total: Number(p.total) || 0, itens: p.itens || [] });
      }
    } catch (e) { setDados(null); setErro(e?.message || 'Não foi possível carregar a presença.'); }
  }, [operacao, meses.join(','), dias.join(','), pode]);
  useEffect(() => { setDados(null); carregar(); }, [carregar]);
  useEffect(() => { setLote((l) => ({ ...l, data: dias.includes(l.data) ? l.data : (dias.includes(paraIso(new Date())) ? paraIso(new Date()) : dias[0]), excecoes: {} })); }, [dias.join(',')]);
  // O selo da aba Presença acompanha o total do título do painel.
  useEffect(() => { if (dados) aoMudarPendencias?.(pend.total); }, [pend.total, !!dados]);
  useEffect(() => () => aoMudarPendencias?.(null), []);

  const nomes = useMemo(() => Object.fromEntries((dados?.operadores || []).map((o) => [o.id_usuario, o.nome])), [dados]);
  if (erro) return html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  if (!dados) return html`<section class="mo-card-escala" aria-busy="true" aria-label="Carregando a presença"><${EsqueletoLinhas} linhas=${10} altura=${40} /></section>`;

  const escalado = (id, d) => dados.turnos[dados.itens[`${id}:${d}`]?.id_turno]?.tipo === 'TRABALHO';
  const statusDe = (id, d) => presencas[`${id}:${d}`] || '';
  const operadores = dados.operadores.filter((o) => (!busca || o.nome.toLowerCase().includes(busca.toLowerCase()))
    && (filtro === 'todos' || dias.some((d) => statusDe(o.id_usuario, d) === (filtro === 'faltas' ? 'FALTA' : 'ATESTADO')
      || (filtro === 'faltas' && statusDe(o.id_usuario, d) === 'FALTA_JUSTIFICADA'))));
  const hoje = paraIso(new Date());
  const escaladosDoDia = dados.operadores.filter((o) => escalado(o.id_usuario, lote.data));
  const semana = `${br(dias[0])} a ${br(dias[6])}`;

  // Lançamento de uma célula (select) ou de uma pendência: o quadro, a lista, o título e o selo andam juntos.
  const lancar = async (idOperador, data, status) => {
    if (!status) return;
    const chave = `${idOperador}:${data}`;
    const antes = { status: presencas[chave], automatica: automaticas[chave], pend };
    const naLista = pend.itens.findIndex((p) => p.id_operador === idOperador && p.data === data);
    setPresencas((p) => ({ ...p, [chave]: status }));
    setAutomaticas((a) => ({ ...a, [chave]: false }));
    if (naLista >= 0) setPend((p) => ({ total: Math.max(0, p.total - 1), itens: p.itens.filter((_, i) => i !== naLista) }));
    try { await lancarPresencaWfm({ operacao, id_operador: idOperador, data, status }); return true; }
    catch (e) {
      setPresencas((p) => { const n = { ...p }; if (antes.status) n[chave] = antes.status; else delete n[chave]; return n; });
      setAutomaticas((a) => ({ ...a, [chave]: antes.automatica }));
      setPend(antes.pend);
      showToast?.(e?.message || 'Não foi possível lançar a presença.', 'error');
      return false;
    }
  };
  const resolverPendencia = async (p, status) => {
    const i = pend.itens.indexOf(p);
    if (!(await lancar(p.id_operador, p.data, status))) return;
    // O foco vai para a próxima linha, não para o topo da página.
    setTimeout(() => { const linhas = listaRef.current?.querySelectorAll('.mo-pend-lin') || []; (linhas[Math.min(i, linhas.length - 1)]?.querySelector('button') || listaRef.current)?.focus?.(); }, 0);
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

  // Conteúdo de uma célula do quadro: "—" (fora da escala), ponto vermelho (pendente), ponto cinza (ainda vai chegar) ou chip.
  const marca = (valor, esc, d) => {
    if (valor) return html`<span class=${`mo-pres mo-pres--${SIGLA_CLASSE[valor]}`} aria-hidden="true">${SIGLA_PRESENCA[valor]}</span>`;
    if (!esc) return html`<span class="mo-pres-nada" aria-hidden="true">—</span>`;
    return html`<span class=${`mo-ponto-pres ${d <= hoje ? 'is-pendente' : ''}`} aria-hidden="true"></span>`;
  };
  const textoCelula = (valor, esc, d) => (valor ? ROTULO_STATUS_PRESENCA[valor].toLowerCase() : !esc ? 'sem escala' : d <= hoje ? 'pendente' : 'sem lançamento');

  return html`
    <div class="mo-contexto cx-fixo">
      <${Stepper} rotulo="Presença da semana" valor=${semana} rotuloAnterior="Semana anterior" rotuloProximo="Próxima semana" aoAnterior=${() => setAncora(somar(ancora, -7))} aoProximo=${() => setAncora(somar(ancora, 7))} />
      <button type="button" class="mo-btn mo-btn--neutro mo-btn--46" onClick=${() => setAncora(new Date())}>Esta semana</button>
      ${pode ? html`<button type="button" class="mo-btn mo-btn--neutro mo-btn--46 mo-pend-abrir" aria-expanded=${gavetaPend} aria-controls="mo-pend" onClick=${() => setGavetaPend(!gavetaPend)}>Pendentes de confirmação (${pend.total})</button>` : null}
      ${pode ? html`<div class="mo-contexto-fim">
        <button type="button" class=${`mo-btn mo-btn--prim mo-btn--46 ${verLote ? 'is-ativo' : ''}`} aria-expanded=${verLote} aria-controls="mo-painel-lote" onClick=${() => { setVerLote(!verLote); setVerAtestados(false); }}><${Icone} nome="fact_check" />Presença em lote</button>
        <button type="button" class=${`mo-btn mo-btn--sec mo-btn--46 ${verAtestados ? 'is-ativo' : ''}`} aria-expanded=${verAtestados} aria-controls="mo-painel-atestados" onClick=${() => { setVerAtestados(!verAtestados); setVerLote(false); }}><${Icone} nome="add" />Atestados${atestados.length ? ` (${atestados.length})` : ''}</button>
      </div>` : null}
    </div>

    <div class=${`mo-presenca cx-cresce ${pode ? 'tem-pend' : ''}`}>
      <section class="mo-card-escala mo-semana-card" aria-label="Presença da semana">
        <div class="mo-barra mo-barra--filtros cx-fixo">
          <label class="mo-filtro"><span>Mostrar</span><select class="ea-campo ea-select" value=${filtro} onChange=${(e) => setFiltro(e.target.value)}><option value="todos">Todos os operadores</option><option value="faltas">Só quem faltou na semana</option><option value="atestados">Só quem está de atestado</option></select></label>
          <div class="ea-busca"><label class="visually-hidden" for="mo-busca-pres">Buscar operador</label><span class="ea-busca-icone" aria-hidden="true"><${Icone} nome="search" /></span>
            <input id="mo-busca-pres" type="search" class="ea-campo" placeholder="Buscar operador" value=${busca} onInput=${(e) => setBusca(e.target.value)} /></div>
          <span class="ea-contagem" aria-live="polite">${operadores.length} de ${dados.operadores.length} operador(es)</span>
        </div>
        <div class="mo-rolagem mo-semana-rolagem cx-cresce" role="region" aria-label="Presença da semana" tabindex="0">
          <table class="mo-semana">
            <thead><tr><th scope="col" class="mo-semana-op">OPERADOR</th>${dias.map((d, i) => html`<th key=${d} scope="col" class=${`mo-semana-dia ${d === hoje ? 'is-hoje' : ''} ${i === 6 ? 'is-dom' : ''}`}><span class="ea-dia-num">${d.slice(8)}</span><small>${SEMANA[i]}</small></th>`)}</tr></thead>
            <tbody>${operadores.length ? operadores.map((op) => html`<tr key=${op.id_usuario}><th scope="row" class="mo-semana-op"><span class="mo-trunca" title=${op.nome}>${op.nome}</span></th>
              ${dias.map((d, i) => { const valor = statusDe(op.id_usuario, d); const esc = escalado(op.id_usuario, d);
                const aria = `${op.nome}, ${br(d).slice(0, 5)}, ${textoCelula(valor, esc, d)}`;
                return html`<td key=${d} class=${`mo-semana-cel ${d === hoje ? 'is-hoje' : ''} ${i === 6 ? 'is-dom' : ''}`} title=${automaticas[`${op.id_usuario}:${d}`] ? 'Presença automática (primeiro login do dia)' : esc ? 'Escalado neste dia' : 'Sem escala de trabalho neste dia'}>
                  ${marca(valor, esc, d)}
                  ${pode ? html`<select class="mo-semana-sel" aria-label=${aria} value=${valor} onChange=${(e) => lancar(op.id_usuario, d, e.target.value)}><option value="">${esc ? '·' : '—'}</option>${Object.entries(SIGLA_PRESENCA).map(([k, s]) => html`<option key=${k} value=${k}>${s} · ${ROTULO_STATUS_PRESENCA[k]}</option>`)}</select>` : html`<span class="visually-hidden">${aria}</span>`}</td>`; })}</tr>`)
              : html`<tr><td class="ea-vazio" colspan="8">Nenhum operador encontrado com estes filtros.</td></tr>`}</tbody>
          </table>
        </div>
        <div class="mo-legenda-pres cx-fixo">
          ${Object.entries(SIGLA_PRESENCA).map(([k, s]) => html`<span key=${k} class="mo-legenda-item"><span class=${`mo-pres mo-pres--${SIGLA_CLASSE[k]}`} aria-hidden="true">${s}</span>${ROTULO_STATUS_PRESENCA[k]}</span>`)}
          <span class="mo-legenda-item"><span class="mo-ponto-pres is-pendente" aria-hidden="true"></span>Pendente</span>
          ${pode ? html`<span class="mo-legenda-dica">Clique numa célula para lançar</span>` : null}
        </div>
      </section>

      ${pode ? html`<aside id="mo-pend" class=${`mo-pend ${gavetaPend ? 'is-aberta' : ''}`} aria-label="Pendentes de confirmação">
        <header class="mo-pend-cab">
          <span class="mo-pend-ponto" aria-hidden="true"></span>
          <div><h2>Pendentes de confirmação (${pend.total})</h2><p>Escalados que não logaram no Conecta no dia. Dê presença ou marque a falta.</p></div>
          <button type="button" class="mo-painel-x mo-pend-fechar" aria-label="Fechar" title="Fechar" onClick=${() => setGavetaPend(false)}><${Icone} nome="close" /></button>
          <span class="visually-hidden" role="status" aria-live="polite">${pend.total} pendências de confirmação</span>
        </header>
        <ul class="mo-pend-lista" ref=${listaRef} tabindex="-1">${pend.itens.length ? pend.itens.map((p) => html`<li key=${`${p.id_operador}:${p.data}`} class="mo-pend-lin">
          <span class="mo-trunca mo-pend-nome" title=${p.nome}>${p.nome}</span><small class="mo-pend-data">${br(p.data).slice(0, 5)}</small>
          <button type="button" class="mo-btn mo-btn--30 mo-btn--ok" aria-label=${`Dar presença para ${p.nome}, ${br(p.data).slice(0, 5)}`} onClick=${() => resolverPendencia(p, 'PRESENTE')}><span class="mo-pend-longo">Dar presença</span><span class="mo-pend-curto" aria-hidden="true"><${Icone} nome="check" />Presença</span></button>
          <button type="button" class="mo-btn mo-btn--30 mo-btn--erro" aria-label=${`Marcar falta para ${p.nome}, ${br(p.data).slice(0, 5)}`} onClick=${() => resolverPendencia(p, 'FALTA')}><span class="mo-pend-longo">Marcar falta</span><span class="mo-pend-curto" aria-hidden="true"><${Icone} nome="close" />Falta</span></button>
        </li>`) : html`<li class="mo-pend-vazio">Nenhuma pendência de confirmação.</li>`}</ul>
      </aside>` : null}

      ${pode && verLote ? html`<${PainelFlutuante} id="mo-painel-lote" posicao="cima" largura=${760} titulo="Presença em lote" aoFechar=${() => setVerLote(false)}>
        <div class="wfm-form mo-padrao">
          <p class="mon-muted">Aplique o status a todos os escalados do dia de uma vez. Marque abaixo quem <strong>não</strong> deve receber (faltou, está de atestado...).</p>
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
        </div>
      <//>` : null}

      ${pode && verAtestados ? html`<${PainelFlutuante} id="mo-painel-atestados" posicao="cima" largura=${760} titulo="Atestados" aoFechar=${() => setVerAtestados(false)}>
        <div class="mo-padrao">
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
            <button type="submit" class="btn btn-primary"><${Icone} nome="add" />Registrar</button>
          </form>
          ${atestados.length ? html`<table class="mo-tabela"><thead><tr><th scope="col">Operador</th><th scope="col">Período</th><th scope="col">Tipo</th><th scope="col">Validado por</th></tr></thead>
            <tbody>${atestados.map((a) => html`<tr key=${a.id_atestado}><td>${nomes[a.id_operador] || a.id_operador}</td><td>${br(a.data_ini)} a ${br(a.data_fim)}</td><td>${TIPOS_ATESTADO[a.tipo] || a.tipo}</td><td>${a.validado_por}</td></tr>`)}</tbody></table>` : null}
        </div>
      <//>` : null}
    </div>`;
}
