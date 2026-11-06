import { html, useCallback, useEffect, useMemo, useRef, useState } from '../../../infraestrutura-react.js';
import {
  lancarPresencaLoteWfm,
  lancarPresencaWfm,
  lerEscalaWfm,
  listarAtestadosWfm,
  listarPresencasWfm,
  pendenciasPresencaWfm,
  registrarAtestadoWfm,
} from '../../../services/api/wfm.js?v=20261104-leitura';
import { ROTULO_STATUS_PRESENCA, SIGLA_PRESENCA, rotuloPresenca, siglaPresenca } from './comum.js?v=20261104-leitura';
import { Campo, Esqueleto, Estado, Faixa, Ic, Janela, Navegar } from '../../../ui/components/ds.js?v=20261106-wfm';

// Presença (redesign Fase 15, amostra "Presença" da Fase 12): Supervisor (própria equipe) e Control Desk (operações
// vinculadas). Trabalha-se por SEMANA. Sem prazo para lançar ou corrigir (regra do RH); tudo fica em auditoria.
// Atestado guarda só período, tipo e quem validou — o arquivo do atestado NUNCA é armazenado (dado de saúde).
// O total de pendências vem do servidor.

const TIPOS_ATESTADO = { MEDICO: 'Médico', ACOMPANHAMENTO: 'Acompanhamento de familiar', DOACAO_SANGUE: 'Doação de sangue', OUTRO: 'Outro' };
const ORIGEM_AUTOMATICA = 'Automática (1º login)'; // mesmo texto gravado pelo backend no primeiro login do dia
const SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const paraIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const somar = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const segundaDe = (d) => somar(d, -((d.getDay() + 6) % 7));
const br = (iso) => iso.split('-').reverse().join('/');
// Sigla da grade (DEC-056): a sigla carrega o sentido, a cor só reforça.
const TOM_SIGLA = { PRESENTE: 'sucesso', FALTA: 'perigo', FALTA_JUSTIFICADA: 'atencao', ATESTADO: 'informacao' };
const PRINCIPAIS = ['PRESENTE', 'FALTA', 'FALTA_JUSTIFICADA', 'ATESTADO'];

export function TelaPresenca({ controlador, operacao, showToast, aoMudarPendencias }) {
  const [ancora, setAncora] = useState(() => new Date());
  const [dados, setDados] = useState(null);
  const [presencas, setPresencas] = useState({});
  const [automaticas, setAutomaticas] = useState({});
  const [atestados, setAtestados] = useState([]);
  const [pend, setPend] = useState({ total: 0, itens: [] });
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState('todos'); // todos | pendentes | faltas | atestados
  const [busca, setBusca] = useState('');
  const [form, setForm] = useState({ id_operador: '', data_ini: '', data_fim: '', tipo: 'MEDICO' });
  const [lote, setLote] = useState({ data: '', status: 'PRESENTE', excecoes: {}, marcar: '' });
  const [ocupado, setOcupado] = useState(false);
  const [verLote, setVerLote] = useState(false);
  const [verAtestados, setVerAtestados] = useState(false);
  const [verPendencias, setVerPendencias] = useState(false);
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
  // O selo de Presença na sub-barra acompanha o total da semana mostrada.
  useEffect(() => { if (dados) aoMudarPendencias?.(pend.total); }, [pend.total, !!dados]);
  useEffect(() => () => aoMudarPendencias?.(null), []);

  const nomes = useMemo(() => Object.fromEntries((dados?.operadores || []).map((o) => [o.id_usuario, o.nome])), [dados]);
  const semana = `${br(dias[0]).slice(0, 5)} a ${br(dias[6])}`;
  const cabecalho = html`<div class="c-cab-linha"><h1>Presença</h1>
    ${pode && dados ? html`<div class="c-cab-dir">
      <button type="button" class="c-botao c-botao--secundario" aria-expanded=${verAtestados ? 'true' : 'false'} onClick=${() => { setVerAtestados(true); setVerLote(false); }}><${Ic} nome="file-text" />Atestados${atestados.length ? ` (${atestados.length})` : ''}</button>
      <button type="button" class="c-botao c-botao--principal" aria-expanded=${verLote ? 'true' : 'false'} onClick=${() => { setVerLote(true); setVerAtestados(false); }}><${Ic} nome="list-checks" />Presença em lote</button>
    </div>` : null}</div>`;
  if (erro) return html`<main class="c-pagina c-conteudo">${cabecalho}<div class="c-tabela-caixa"><${Estado} titulo=${erro} rotuloAcao="Tentar de novo" aoAcao=${carregar} /></div></main>`;
  if (!dados) return html`<main class="c-pagina c-conteudo" aria-busy="true">${cabecalho}<div class="c-tabela-caixa"><${Esqueleto} linhas=${8} /></div></main>`;

  const escalado = (id, d) => dados.turnos[dados.itens[`${id}:${d}`]?.id_turno]?.tipo === 'TRABALHO';
  const statusDe = (id, d) => presencas[`${id}:${d}`] || '';
  const hoje = paraIso(new Date());
  const pendentesDaSemana = new Set(pend.itens.map((p) => p.id_operador));
  const operadores = dados.operadores.filter((o) => (!busca || o.nome.toLowerCase().includes(busca.toLowerCase()))
    && (filtro === 'todos'
      || (filtro === 'pendentes' && pendentesDaSemana.has(o.id_usuario))
      || (filtro !== 'pendentes' && dias.some((d) => statusDe(o.id_usuario, d) === (filtro === 'faltas' ? 'FALTA' : 'ATESTADO')
        || (filtro === 'faltas' && statusDe(o.id_usuario, d) === 'FALTA_JUSTIFICADA')))));
  const escaladosDoDia = dados.operadores.filter((o) => escalado(o.id_usuario, lote.data));

  // Lançamento de uma célula ou de uma pendência: a grade, a lista, o total e o selo andam juntos.
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
    setTimeout(() => { const linhas = listaRef.current?.querySelectorAll('tbody tr') || []; (linhas[Math.min(i, linhas.length - 1)]?.querySelector('button') || listaRef.current)?.focus?.(); }, 0);
  };
  const aplicarLote = async () => {
    const excecoes = Object.keys(lote.excecoes).filter((k) => lote.excecoes[k]).map(Number);
    setOcupado(true);
    try {
      const r = await lancarPresencaLoteWfm({ operacao, data: lote.data, status: lote.status, excecoes });
      if (lote.marcar) await Promise.all(excecoes.map((id) => lancarPresencaWfm({ operacao, id_operador: id, data: lote.data, status: lote.marcar })));
      showToast?.(`${r.aplicados} operador(es) com ${rotuloPresenca(lote.status).toLowerCase()}${excecoes.length ? `; ${excecoes.length} exceção(ões) preservada(s)` : ''}.`, 'success');
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

  if (!dados.operadores.length) return html`<main class="c-pagina c-conteudo">${cabecalho}<div class="c-tabela-caixa"><${Estado} icone="users" titulo="Nenhum operador" texto="Não há operadores visíveis para você nesta operação." /></div></main>`;
  const contagemExc = Object.values(lote.excecoes).filter(Boolean).length;

  // Célula: sigla (lançado), "—" âmbar (escalado, dia já chegou, sem lançamento), "—"/"DSR" apagado (futuro / sem escala).
  const marca = (valor, esc, d) => {
    if (valor) return html`<span class=${`c-sigla c-selo--${TOM_SIGLA[valor] || 'neutro'}`} title=${rotuloPresenca(valor)}>${siglaPresenca(valor)}</span>`;
    if (!esc) return html`<span class="c-futuro" title="Sem escala de trabalho neste dia">DSR</span>`;
    if (d <= hoje) return html`<span class="c-pendente" title="Sem lançamento">—</span>`;
    return html`<span class="c-futuro" title="Ainda não chegou">—</span>`;
  };
  const textoCelula = (valor, esc, d) => (valor ? rotuloPresenca(valor).toLowerCase() : !esc ? 'sem escala' : d <= hoje ? 'pendente' : 'sem lançamento');
  const presentesNoDia = (d) => {
    const esc = dados.operadores.filter((o) => escalado(o.id_usuario, d));
    return { presentes: esc.filter((o) => statusDe(o.id_usuario, d) === 'PRESENTE').length, total: esc.length };
  };

  return html`
    <main class="c-pagina c-conteudo">
      ${cabecalho}
      ${pode && pend.total ? html`<${Faixa} tom="atencao" icone="warning"
        acao=${html`<button type="button" class="c-botao c-botao--secundario c-botao--compacto" aria-expanded=${verPendencias ? 'true' : 'false'} onClick=${() => setVerPendencias((v) => !v)}>${verPendencias ? 'Esconder' : 'Resolver pendências'}</button>`}>
        <b>${pend.total} ${pend.total === 1 ? 'lançamento pendente' : 'lançamentos pendentes'}</b> nesta semana: escalados que não logaram no Conecta no dia.
      <//>` : null}
      ${pode && pend.total && verPendencias ? html`<section class="c-cartao" aria-labelledby="wfm-pend-titulo">
        <div class="c-cartao-cab"><h2 id="wfm-pend-titulo">Pendentes de confirmação</h2><span class="c-nota" role="status" aria-live="polite">${pend.total} pendência(s)</span></div>
        <div class="c-tabela-caixa" ref=${listaRef} tabindex="-1">
          <table class="c-tabela"><thead><tr><th scope="col" class="c-estica">Colaborador</th><th scope="col">Dia</th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead>
            <tbody>${pend.itens.map((p) => html`<tr key=${`${p.id_operador}:${p.data}`}>
              <td class="c-estica c-forte">${p.nome}</td><td class="c-secundario">${br(p.data).slice(0, 5)}</td>
              <td class="c-acoes"><div class="c-grupo">
                <button type="button" class="c-botao c-botao--secundario c-botao--compacto" aria-label=${`Marcar falta para ${p.nome}, ${br(p.data).slice(0, 5)}`} onClick=${() => resolverPendencia(p, 'FALTA')}>Marcar falta</button>
                <button type="button" class="c-botao c-botao--principal c-botao--compacto" aria-label=${`Dar presença para ${p.nome}, ${br(p.data).slice(0, 5)}`} onClick=${() => resolverPendencia(p, 'PRESENTE')}><${Ic} nome="check" />Dar presença</button>
              </div></td></tr>`)}</tbody></table>
        </div>
      </section>` : null}
      <div class="c-tabela-caixa">
        <div class="c-filtros c-filtros--suave">
          <${Navegar} grupo="Semana" rotulo=${semana} rotuloAnterior="Semana anterior" rotuloProximo="Próxima semana" aoAnterior=${() => setAncora(somar(ancora, -7))} aoProximo=${() => setAncora(somar(ancora, 7))} />
          <button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => setAncora(new Date())}>Esta semana</button>
          <div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" /><input class="c-entrada c-entrada--compacta" type="search" placeholder="Buscar colaborador" aria-label="Buscar colaborador" value=${busca} onInput=${(e) => setBusca(e.target.value)} /></div>
          <select class="c-entrada c-entrada--compacta" aria-label="Situação" value=${filtro} onChange=${(e) => setFiltro(e.target.value)}>
            <option value="todos">Todos os colaboradores</option>
            ${pode ? html`<option value="pendentes">Só pendentes</option>` : null}
            <option value="faltas">Só quem faltou na semana</option>
            <option value="atestados">Só quem está de atestado</option>
          </select>
          <span class="c-contador" aria-live="polite">${operadores.length} de ${dados.operadores.length}</span>
        </div>
        <table class="c-tabela c-tabela--fixa c-semana c-presenca">
          <thead><tr><th scope="col" class="c-col-nome">Colaborador</th>${dias.map((d, i) => html`<th key=${d} scope="col" class=${`c-dia-sem ${d === hoje ? 'c-hoje' : ''}`}>${SEMANA[i]} ${br(d).slice(0, 5)}</th>`)}</tr></thead>
          <tbody>${operadores.length ? operadores.map((op) => html`<tr key=${op.id_usuario}><td class="c-forte c-col-nome">${op.nome}</td>
            ${dias.map((d) => {
    const valor = statusDe(op.id_usuario, d); const esc = escalado(op.id_usuario, d);
    const aria = `${op.nome}, ${br(d).slice(0, 5)}, ${textoCelula(valor, esc, d)}`;
    return html`<td key=${d} class=${`c-dia-sem ${d === hoje ? 'c-hoje' : ''} ${pode ? 'c-celula-lanca' : ''}`} title=${automaticas[`${op.id_usuario}:${d}`] ? 'Presença automática (primeiro login do dia)' : null}>
                ${marca(valor, esc, d)}
                ${pode ? html`<select class="c-celula-sel" aria-label=${aria} value=${valor} onChange=${(e) => lancar(op.id_usuario, d, e.target.value)}><option value="">${esc ? 'Sem lançamento' : 'Sem escala'}</option>${Object.entries(SIGLA_PRESENCA).map(([k, s]) => html`<option key=${k} value=${k}>${s} · ${ROTULO_STATUS_PRESENCA[k]}</option>`)}</select>` : html`<span class="c-oculto">${aria}</span>`}
              </td>`;
  })}</tr>`)
    : html`<tr><td colspan="8"><${Estado} titulo="Nenhum colaborador com estes filtros." rotuloAcao="Limpar filtros" aoAcao=${() => { setBusca(''); setFiltro('todos'); }} /></td></tr>`}</tbody>
          <tfoot><tr><td>Presentes no dia</td>${dias.map((d) => {
    const { presentes, total } = presentesNoDia(d);
    const falta = d <= hoje && total > 0 && presentes < total;
    return html`<td key=${d} class=${`c-dia-sem ${d === hoje ? 'c-hoje' : ''} ${falta ? 'c-falta' : ''}`}>${total ? html`${presentes}<small> de ${total}</small>` : '—'}</td>`;
  })}</tr></tfoot>
        </table>
        <div class="c-legenda">
          ${PRINCIPAIS.map((k) => html`<span key=${k}><span class=${`c-sigla c-selo--${TOM_SIGLA[k]}`}>${SIGLA_PRESENCA[k]}</span>${ROTULO_STATUS_PRESENCA[k]}</span>`)}
          <span><span class="c-pendente">—</span>Sem lançamento</span>
          ${pode ? html`<span class="c-legenda-fim">Clique no dia para lançar · outras ${Object.keys(SIGLA_PRESENCA).length - PRINCIPAIS.length} siglas no menu</span>` : null}
        </div>
      </div>
    </main>

    ${pode && verLote ? html`<${Janela} titulo="Presença em lote" tamanho="grande" onClose=${() => setVerLote(false)}
      rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => setVerLote(false)}>Fechar</button>
        <button type="button" class="c-botao c-botao--principal" aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || !escaladosDoDia.length || escaladosDoDia.length === contagemExc || null} onClick=${aplicarLote}>${rotuloPresenca(lote.status)} para ${escaladosDoDia.length - contagemExc} colaborador(es)</button>`}>
      <div class="c-janela-corpo">
        <p>Aplique o status a todos os escalados do dia de uma vez. Marque abaixo quem <b>não</b> deve receber (faltou, está de atestado...).</p>
        <div class="c-form" style=${{ '--colunas': 3 }}>
          <${Campo} rotulo="Dia"><select class="c-entrada" value=${lote.data} onChange=${(e) => setLote({ ...lote, data: e.target.value, excecoes: {} })}>${dias.map((d, i) => html`<option key=${d} value=${d}>${SEMANA[i]} ${br(d).slice(0, 5)}</option>`)}</select><//>
          <${Campo} rotulo="Aplicar a todos"><select class="c-entrada" value=${lote.status} onChange=${(e) => setLote({ ...lote, status: e.target.value })}>${Object.entries(ROTULO_STATUS_PRESENCA).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
          <${Campo} rotulo="Quem ficou de fora, marcar como"><select class="c-entrada" value=${lote.marcar} onChange=${(e) => setLote({ ...lote, marcar: e.target.value })}><option value="">Não alterar</option>${['FALTA', 'FALTA_JUSTIFICADA', 'ATESTADO'].map((k) => html`<option key=${k} value=${k}>${ROTULO_STATUS_PRESENCA[k]}</option>`)}</select><//>
        </div>
        ${escaladosDoDia.length ? html`<fieldset class="c-lote-excecoes">
            <legend class="c-rotulo">Exceto (${contagemExc} de ${escaladosDoDia.length} escalados em ${br(lote.data).slice(0, 5)})</legend>
            <div class="c-lote-lista">${escaladosDoDia.map((o) => html`<label key=${o.id_usuario} class="c-marcar"><input type="checkbox" checked=${!!lote.excecoes[o.id_usuario]} onChange=${() => setLote({ ...lote, excecoes: { ...lote.excecoes, [o.id_usuario]: !lote.excecoes[o.id_usuario] } })} /><span>${o.nome}</span>${statusDe(o.id_usuario, lote.data) ? html`<span class=${`c-sigla c-selo--${TOM_SIGLA[statusDe(o.id_usuario, lote.data)] || 'neutro'}`}>${siglaPresenca(statusDe(o.id_usuario, lote.data))}</span>` : null}</label>`)}</div>
          </fieldset>` : html`<p class="c-ajuda">Ninguém da sua equipe está escalado em ${br(lote.data)}.</p>`}
      </div>
    <//>` : null}

    ${pode && verAtestados ? html`<${Janela} titulo="Atestados" tamanho="grande" onClose=${() => setVerAtestados(false)}>
      <div class="c-janela-corpo">
        <p>Registra período, tipo e quem validou. O arquivo do atestado não é guardado.</p>
        <form class="c-form" style=${{ '--colunas': 4 }} onSubmit=${registrarAtestado}>
          <${Campo} rotulo="Colaborador"><select class="c-entrada" required value=${form.id_operador} onChange=${(e) => setForm({ ...form, id_operador: e.target.value })}>
            <option value="">Selecione</option>${dados.operadores.map((o) => html`<option key=${o.id_usuario} value=${o.id_usuario}>${o.nome}</option>`)}
          </select><//>
          <${Campo} rotulo="Início"><input class="c-entrada" type="date" required value=${form.data_ini} onChange=${(e) => setForm({ ...form, data_ini: e.target.value, data_fim: form.data_fim || e.target.value })} /><//>
          <${Campo} rotulo="Fim"><input class="c-entrada" type="date" required value=${form.data_fim} onChange=${(e) => setForm({ ...form, data_fim: e.target.value })} /><//>
          <${Campo} rotulo="Tipo"><select class="c-entrada" value=${form.tipo} onChange=${(e) => setForm({ ...form, tipo: e.target.value })}>
            ${Object.entries(TIPOS_ATESTADO).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}
          </select><//>
          <div class="c-cheio c-grupo c-grupo--fim"><button type="submit" class="c-botao c-botao--principal"><${Ic} nome="plus" />Registrar atestado</button></div>
        </form>
        ${atestados.length ? html`<div class="c-tabela-caixa"><table class="c-tabela"><thead><tr><th scope="col">Colaborador</th><th scope="col">Período</th><th scope="col">Tipo</th><th scope="col" class="c-estica">Validado por</th></tr></thead>
          <tbody>${atestados.map((a) => html`<tr key=${a.id_atestado}><td class="c-forte">${nomes[a.id_operador] || a.id_operador}</td><td>${br(a.data_ini)} a ${br(a.data_fim)}</td><td>${TIPOS_ATESTADO[a.tipo] || a.tipo}</td><td class="c-estica c-secundario">${a.validado_por}</td></tr>`)}</tbody></table></div>` : null}
      </div>
    <//>` : null}`;
}
