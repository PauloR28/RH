import { html, useCallback, useEffect, useMemo, useState } from '../../../infraestrutura-react.js';
import { aplicarPausasWfm, definirCapacidadePausasWfm, distribuirPausasWfm, lerEscalaWfm, lerPausasDiaWfm, salvarPausasWfm } from '../../../services/api/wfm.js?v=20261104-leitura';
import { aMin, brData, deMin, doIso, paraIso, semAcento, useVisaoEquipes } from './escala-ui.js?v=20261104-leitura';
import { estadoEscala } from './escala.js?v=20261111-padrao';
import { Campo, Esqueleto, Estado, Faixa, Ic, JanelaForm, MenuAcoes, Navegar, Segmento, Selo } from '../../../ui/components/ds.js?v=20261106-wfm';

// Aba "Pausas" da escala (redesign Fase 15, amostra Q2 do lote 1): as 3 pausas de cada colaborador escalado no dia (2 de 10 min
// e 1 de 20 min, todas contadas como jornada). Tabela com o horário editável na linha + painel de 300 px na mesma caixa
// (1 Quem recebe · 2 Horários · 3 Máximo em pausa juntos, com o mini gráfico "Em pausa a cada 15 min"). Exceder o limite de
// pessoas em pausa ao mesmo tempo é aviso (não bloqueio). Mesmas rotas e regras de antes; só a tela mudou.

const SEMANA_CURTA_DIA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const SEMANA_CURTA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const TODOS_DIAS = [true, true, true, true, true, true, true];
const ROTULO_TIPO = { DESCANSO: 'Descanso', REFEICAO: 'Refeição' };
const PASSO = 5;
const FAIXA_GRAFICO = 15;

// Linha do tempo do turno em minutos desde 00:00 do dia em que ele começa (turno que vira a noite passa de 1440).
const janela = (turno) => { const ini = aMin(turno.entrada); const fim = aMin(turno.saida); return [ini, fim <= ini ? fim + 1440 : fim]; };
const desenrolar = (hhmm, ini) => { const t = aMin(hhmm); return t < ini ? t + 1440 : t; };

// Período atingido: só o dia, a semana (seg–dom) ou o mês inteiro, sempre dentro do mês aberto.
function periodoDe(escopo, dia, anoMes) {
  const [a, m] = anoMes.split('-').map(Number);
  const ultimo = paraIso(new Date(a, m, 0));
  if (escopo === 'dia') return [dia, dia];
  if (escopo === 'mes') return [`${anoMes}-01`, ultimo];
  const base = doIso(dia);
  const seg = new Date(base); seg.setDate(seg.getDate() - ((base.getDay() + 6) % 7));
  const dom = new Date(seg); dom.setDate(dom.getDate() + 6);
  const ini = paraIso(seg); const fim = paraIso(dom);
  return [ini < `${anoMes}-01` ? `${anoMes}-01` : ini, fim > ultimo ? ultimo : fim];
}

const diasEscolhidos = (escopo, dias) => (escopo === 'dia' ? null : dias.map((v, i) => (v ? i : null)).filter((i) => i !== null));

export function TelaEscalaPausas({ controlador, contexto, operacao, anoMes, showToast, aoDia, aoMes, aoVoltarLista, aoTrocarEscala, opcoesEscala = null }) {
  const [dia, setDia] = useState(() => { const hoje = paraIso(new Date()); return hoje.startsWith(anoMes) ? hoje : `${anoMes}-01`; });
  const [dados, setDados] = useState(null);
  const [escala, setEscala] = useState(null);
  const [erro, setErro] = useState('');
  const [edicao, setEdicao] = useState({});            // id_operador -> pausas editadas (pendentes de salvar)
  const [sel, setSel] = useState({});
  const [busca, setBusca] = useState('');
  const [filtroTurno, setFiltroTurno] = useState('');
  const [filtroEquipe, setFiltroEquipe] = useState('');
  const [filtroSup, setFiltroSup] = useState('');
  const [filtroHora, setFiltroHora] = useState('');
  const [rapido, setRapido] = useState('todos');       // 'todos' | 'sem' | 'nao'
  const [ocupado, setOcupado] = useState(false);
  const [duplicando, setDuplicando] = useState(null);  // colaborador de origem
  const ehSupervisor = controlador.estado?.perfilUsuario === 'supervisor';
  const [todasEquipes, setTodasEquipes] = useVisaoEquipes(ehSupervisor); // Supervisor: ver as pausas de todas as equipes (somente leitura)
  const podeEditar = controlador.possuiPermissao('wfm.escala.editar') && !todasEquipes;
  const podeCapacidade = controlador.possuiPermissao('wfm.cadastros.editar');

  useEffect(() => { if (!dia.startsWith(anoMes)) setDia(`${anoMes}-01`); }, [anoMes]);

  const carregar = useCallback(async () => {
    if (!operacao) return;
    setErro('');
    try {
      const d = await lerPausasDiaWfm(operacao, dia, todasEquipes);
      setDados(d); setEdicao({}); setSel({});
    } catch (e) { setDados(null); setErro(e?.message || 'Não foi possível carregar as pausas.'); }
  }, [operacao, dia, todasEquipes]);
  useEffect(() => { setDados(null); carregar(); }, [carregar]);
  useEffect(() => {
    let vivo = true;
    setEscala(null);
    lerEscalaWfm(operacao, anoMes).then((e) => { if (vivo) setEscala(e); }).catch(() => {});
    return () => { vivo = false; };
  }, [operacao, anoMes]);

  const executar = async (fn, sucesso) => {
    setOcupado(true);
    try {
      const r = await fn();
      showToast?.(typeof sucesso === 'function' ? sucesso(r) : sucesso, 'success');
      await carregar();
      return true;
    } catch (e) { showToast?.(e?.message || 'Não foi possível concluir.', 'error'); return false; } finally { setOcupado(false); }
  };

  const operadores = dados?.operadores || [];
  const semEscala = dados?.sem_escala || [];
  const capacidade = dados?.capacidade || 1;
  const pausasDe = (op) => edicao[op.id_operador] || op.pausas;
  const alteradas = Object.keys(edicao).length;

  // ---- filtros -----------------------------------------------------------------------------------------------
  const turnos = useMemo(() => [...new Map(operadores.map((o) => [o.turno.codigo, o.turno])).values()], [operadores]);
  const equipes = useMemo(() => [...new Map([...operadores, ...semEscala].filter((o) => o.id_equipe).map((o) => [o.id_equipe, o.equipe])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')), [operadores, semEscala]);
  const supervisores = useMemo(() => [...new Map([...operadores, ...semEscala].flatMap((o) => o.supervisores || []).map((s) => [s.id_usuario, s.nome])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')), [operadores, semEscala]);
  const horas = useMemo(() => [...new Set(operadores.flatMap((o) => (edicao[o.id_operador] || o.pausas).map((p) => p.inicio.slice(0, 2))))].sort(), [operadores, edicao]);
  const passaBasico = (o) => {
    const q = semAcento(busca);
    return (!q || semAcento(o.nome).includes(q)) && (!filtroEquipe || String(o.id_equipe) === filtroEquipe)
      && (!filtroSup || (o.supervisores || []).some((s) => String(s.id_usuario) === filtroSup));
  };
  const baseEscalados = useMemo(() => operadores.filter((o) => passaBasico(o) && (!filtroTurno || o.turno.codigo === filtroTurno)
    && (!filtroHora || (edicao[o.id_operador] || o.pausas).some((p) => p.inicio.slice(0, 2) === filtroHora))), [operadores, edicao, busca, filtroTurno, filtroEquipe, filtroSup, filtroHora]);
  const baseSem = useMemo(() => (filtroTurno || filtroHora ? [] : semEscala.filter(passaBasico)), [semEscala, busca, filtroTurno, filtroEquipe, filtroSup, filtroHora]);
  const nSem = baseEscalados.filter((o) => !(edicao[o.id_operador] || o.pausas).length).length;
  const nNao = baseEscalados.filter((o) => edicao[o.id_operador]).length;
  const visiveis = baseEscalados.filter((o) => rapido === 'todos' || (rapido === 'sem' ? !(edicao[o.id_operador] || o.pausas).length : !!edicao[o.id_operador]));
  const visiveisSem = rapido === 'todos' ? baseSem : [];

  // ---- ocupação (inclui o que está editado e ainda não salvo): alimenta o aviso, o mini gráfico e o selo de conflito ----
  const { ocup, excedentes, emConflito, faixa } = useMemo(() => {
    const mapa = new Map();
    let menor = Infinity; let maior = -Infinity;
    for (const o of operadores) {
      const [ini, fim] = janela(o.turno);
      menor = Math.min(menor, ini); maior = Math.max(maior, fim);
      for (const p of (edicao[o.id_operador] || o.pausas)) {
        if (!p.inicio) continue;
        const i = desenrolar(p.inicio, ini);
        for (let m = i - (i % PASSO); m < i + p.duracao_min; m += PASSO) if (m + PASSO > i) mapa.set(m, (mapa.get(m) || 0) + 1);
      }
    }
    const lim = dados?.capacidade || 1;
    const faixas = [];
    for (const [m, q] of [...mapa.entries()].sort((a, b) => a[0] - b[0])) {
      if (q <= lim) continue;
      const ult = faixas[faixas.length - 1];
      if (ult && ult.fim === m && ult.qtd === q) ult.fim = m + PASSO; else faixas.push({ ini: m, fim: m + PASSO, qtd: q });
    }
    const conflito = new Set();
    for (const o of operadores) {
      const [ini] = janela(o.turno);
      for (const p of (edicao[o.id_operador] || o.pausas)) {
        if (!p.inicio) continue;
        const i = desenrolar(p.inicio, ini);
        for (let m = i - (i % PASSO); m < i + p.duracao_min; m += PASSO) if ((mapa.get(m) || 0) > lim) conflito.add(`${o.id_operador}:${p.ordem}`);
      }
    }
    return { ocup: mapa, excedentes: faixas, emConflito: conflito, faixa: Number.isFinite(menor) ? [Math.floor(menor / 60) * 60, Math.ceil(maior / 60) * 60] : null };
  }, [operadores, edicao, dados]);
  const opsEmConflito = new Set([...emConflito].map((k) => k.split(':')[0])).size;

  const nomeEscala = escala?.nome_escala || opcoesEscala?.find(([c]) => c === operacao)?.[1] || (contexto?.operacoes || []).find((o) => o.chave === operacao)?.nome || operacao;
  const voltar = aoVoltarLista ? html`<button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Voltar para Escalas" title="Voltar para Escalas" onClick=${aoVoltarLista}><${Ic} nome="arrow-left" /></button>` : null;
  if (erro) return html`<main class="c-pagina c-conteudo"><div class="c-cab-linha">${voltar}<h1>${nomeEscala}</h1></div><div class="c-tabela-caixa"><${Estado} titulo=${erro} rotuloAcao="Tentar de novo" aoAcao=${carregar} /></div></main>`;
  if (!dados) return html`<main class="c-pagina c-conteudo" aria-busy="true"><div class="c-cab-linha">${voltar}<h1>${nomeEscala}</h1></div><div class="c-tabela-caixa"><${Esqueleto} linhas=${10} /></div></main>`;

  const mover = (n) => { const d = doIso(dia); d.setDate(d.getDate() + n); const iso = paraIso(d); if (iso.startsWith(anoMes)) setDia(iso); };
  const mudar = (op, ordem, valor) => {
    const base = pausasDe(op).map((p) => ({ ...p }));
    setEdicao({ ...edicao, [op.id_operador]: base.map((p) => (p.ordem === ordem ? { ...p, inicio: valor } : p)) });
  };
  const iniciar = (op) => setEdicao({ ...edicao, [op.id_operador]: dados.pausas_padrao.map((p) => ({ ordem: p.ordem, tipo: p.tipo, inicio: op.turno.entrada, duracao_min: p.duracao_min })) });
  const salvar = () => executar(
    () => salvarPausasWfm({ operacao, data: dia, itens: Object.entries(edicao).map(([id, pausas]) => ({ id_operador: Number(id), pausas })) }),
    'Pausas salvas.',
  );
  const alterarCapacidade = async (n) => {
    if (!podeCapacidade || n < 1 || n > 200 || n === capacidade) return;
    try { await definirCapacidadePausasWfm({ operacao, pausas_simultaneas: n }); setDados((d) => ({ ...d, capacidade: n })); }
    catch (e) { showToast?.(e?.message || 'Não foi possível alterar o limite.', 'error'); }
  };
  const distribuirConflito = async () => {
    if (alteradas && !window.confirm('Há alterações não salvas: distribuir recarrega a tela e as descarta. Continuar?')) return;
    const ids = operadores.filter((o) => o.pausas.length).map((o) => o.id_operador);
    await executar(() => distribuirPausasWfm({ operacao, data: dia, ids, sobrescrever: true }), 'Pausas distribuídas respeitando o limite de pessoas em pausa ao mesmo tempo.');
  };
  const marcados = visiveis.filter((o) => sel[o.id_operador]);
  const todosSel = visiveis.length > 0 && marcados.length === visiveis.length;
  const alternarTodos = () => setSel(todosSel ? {} : Object.fromEntries(visiveis.map((o) => [o.id_operador, true])));
  const d0 = doIso(dia);
  const hojeIso = paraIso(new Date());
  const totalColab = operadores.length + semEscala.length;
  const resumoAplicacao = (r) => `${r.pausas_gravadas} colaborador(es)/dia gravado(s) em ${r.dias_programados} dia(s)`
    + `${r.ignoradas ? `; ${r.ignoradas} fora do turno do dia (ignorado)` : ''}${r.mantidas ? `; ${r.mantidas} mantido(s) sem substituir` : ''}`
    + `${r.dias_com_excesso ? `. Atenção: ${r.dias_com_excesso} dia(s) passam do limite de ${r.capacidade} em pausa ao mesmo tempo.` : '.'}`;
  // "Aplicar" no dia aberto: as pausas ficam como alteração não salva (Salvar pausas grava); os demais períodos gravam no servidor.
  const enfileirar = (ids, pausas, sobrescrever) => {
    const novo = { ...edicao }; let ok = 0; let fora = 0; let mantidas = 0;
    for (const id of ids) {
      const op = operadores.find((o) => o.id_operador === id);
      if (!op) continue;
      if (!sobrescrever && pausasDe(op).length) { mantidas += 1; continue; }
      const [ini, fim] = janela(op.turno);
      if (!pausas.every((p) => { const m = desenrolar(p.inicio, ini); return m >= ini && m + p.duracao_min <= fim; })) { fora += 1; continue; }
      novo[id] = pausas.map((p) => ({ ...p })); ok += 1;
    }
    setEdicao(novo);
    showToast?.(`${ok} colaborador(es) com pausas definidas (não salvas)${fora ? `; ${fora} com horário fora do turno (ignorado)` : ''}${mantidas ? `; ${mantidas} mantido(s) sem substituir` : ''}.`, ok ? 'success' : 'error');
  };
  const nCols = dados.pausas_padrao.length;
  const colunas = (podeEditar ? 1 : 0) + 2 + nCols + 1 + (podeEditar ? 1 : 0);
  const [rotuloEstado, tomEstado, iconeEstado] = escala?.status ? estadoEscala(escala) : [];

  const rotulosRapidos = [['todos', 'Todos', baseEscalados.length + baseSem.length], ['sem', 'Sem pausas', nSem], ['nao', 'Não salvas', nNao]];

  return html`
    <main class="c-pagina c-conteudo">
      <div class="c-cab-linha c-cab-escala">
        ${voltar}
        <h1 title=${nomeEscala}>${nomeEscala}</h1>
        ${opcoesEscala && opcoesEscala.length > 1 && aoTrocarEscala ? html`<select class="c-entrada c-entrada--compacta c-trocar-escala" aria-label="Trocar de escala" value=${operacao} onChange=${(e) => aoTrocarEscala(e.target.value)}>${opcoesEscala.map(([v, r]) => html`<option key=${v} value=${v}>${r}</option>`)}</select>` : null}
        ${rotuloEstado ? html`<${Selo} tom=${tomEstado} icone=${iconeEstado}>${rotuloEstado}<//>` : null}
        <div class="c-cab-dir">
          <span class="c-ajuda">${operadores.length} escalado(s) · ${semEscala.length} sem escala no dia</span>
        </div>
      </div>

      ${excedentes.length ? html`<${Faixa} tom="atencao" icone="warning"
        acao=${podeEditar ? html`<button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${ocupado || null} onClick=${distribuirConflito}>Distribuir automático</button>` : null}>
        <b>${opsEmConflito} pessoa(s)</b> em pausa ao mesmo tempo acima do limite de ${capacidade}. Ajuste os horários ou deixe o sistema distribuir.<//>` : null}

      <div class="c-tabela-caixa c-pausas-caixa" role="region" aria-label="Pausas do dia">
        <div class="c-filtros c-filtros--suave c-filtros--quebra">
          <${Segmento} rotulo="Visão" valor="pausas" aoMudar=${(v) => { if (v === 'semana' || v === 'mes') aoMes?.(v); else if (v === 'dia') aoDia?.(); }}
            opcoes=${[['semana', 'Semana'], ['mes', 'Mês'], ...(aoDia ? [['dia', 'Do dia']] : []), ['pausas', 'Pausas']]} />
          <${Navegar} grupo="Dia" rotulo=${`${SEMANA_CURTA_DIA[d0.getDay()]}, ${brData(dia).slice(0, 5)}`} rotuloAnterior="Dia anterior" rotuloProximo="Próximo dia" aoAnterior=${() => mover(-1)} aoProximo=${() => mover(1)} />
          <button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${!hojeIso.startsWith(anoMes) || dia === hojeIso || null} onClick=${() => setDia(hojeIso)}>Hoje</button>
          <${Segmento} mini=${true} rotulo="Filtro rápido" valor=${rapido} aoMudar=${setRapido} opcoes=${rotulosRapidos} />
          <div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" /><input class="c-entrada c-entrada--compacta" type="search" placeholder="Buscar colaborador" aria-label="Buscar colaborador" value=${busca} onInput=${(e) => setBusca(e.target.value)} /></div>
          ${ehSupervisor ? html`<select class="c-entrada c-entrada--compacta" aria-label="Equipes exibidas" value=${todasEquipes ? 'todas' : ''} onChange=${(e) => setTodasEquipes(e.target.value === 'todas')}><option value="">Minha equipe</option><option value="todas">Todas as equipes</option></select>` : null}
          ${turnos.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Turno" value=${filtroTurno} onChange=${(e) => setFiltroTurno(e.target.value)}><option value="">Turno: todos</option>${turnos.map((t) => html`<option key=${t.codigo} value=${t.codigo}>${t.codigo} ${t.entrada}–${t.saida}</option>`)}</select>` : null}
          ${equipes.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Equipe" value=${filtroEquipe} onChange=${(e) => setFiltroEquipe(e.target.value)}><option value="">Equipe: todas</option>${equipes.map(([id, nome]) => html`<option key=${id} value=${String(id)}>${nome}</option>`)}</select>` : null}
          ${supervisores.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Supervisor" value=${filtroSup} onChange=${(e) => setFiltroSup(e.target.value)}><option value="">Supervisor: todos</option>${supervisores.map(([id, nome]) => html`<option key=${id} value=${String(id)}>${nome}</option>`)}</select>` : null}
          ${horas.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Horário da pausa" value=${filtroHora} onChange=${(e) => setFiltroHora(e.target.value)}><option value="">Horário: todos</option>${horas.map((h) => html`<option key=${h} value=${h}>${h}h</option>`)}</select>` : null}
          <span class="c-contador" aria-live="polite">${visiveis.length + visiveisSem.length} de ${totalColab}${todasEquipes ? ' · todas as equipes, somente leitura' : ''}</span>
        </div>

        ${!operadores.length && !semEscala.length
          ? html`<${Estado} icone="pause-circle" titulo="Ninguém neste dia" texto="Não há colaboradores nesta escala. Monte a escala de turnos primeiro." />`
          : html`<div class=${podeEditar ? 'c-pausas' : ''}>
            <table class="c-tabela c-tabela-digita" aria-label=${`Pausas de ${brData(dia)}`}>
              <thead><tr>
                ${podeEditar ? html`<th scope="col" style=${{ width: '40px' }}><label class="c-marcar"><input type="checkbox" aria-label="Selecionar todos os colaboradores" checked=${todosSel} disabled=${!visiveis.length || null}
                  ref=${(el) => { if (el) el.indeterminate = marcados.length > 0 && !todosSel; }} onChange=${alternarTodos} /></label></th>` : null}
                <th scope="col" class="c-estica">Colaborador</th><th scope="col">Turno</th>
                ${dados.pausas_padrao.map((p, i) => html`<th scope="col" key=${p.ordem} title=${`${ROTULO_TIPO[p.tipo] || 'Pausa'} · ${p.duracao_min} min`}>${i + 1}ª pausa</th>`)}
                <th scope="col">Situação</th>
                ${podeEditar ? html`<th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th>` : null}
              </tr></thead>
              <tbody>
                ${visiveis.map((op) => {
                  const pausas = pausasDe(op); const pend = !!edicao[op.id_operador]; const conf = pausas.some((p) => emConflito.has(`${op.id_operador}:${p.ordem}`));
                  return html`<tr key=${op.id_operador} class=${pend ? 'c-pausa-mudou' : ''} aria-selected=${sel[op.id_operador] ? 'true' : null}>
                    ${podeEditar ? html`<td><label class="c-marcar"><input type="checkbox" aria-label=${`Selecionar ${op.nome}`} checked=${!!sel[op.id_operador]} onChange=${() => setSel({ ...sel, [op.id_operador]: !sel[op.id_operador] })} /></label></td>` : null}
                    <td class="c-forte c-estica" title=${[op.equipe, (op.supervisores || []).map((s) => s.nome).join(', ')].filter(Boolean).join(' · ') || null}>${op.nome}${op.erros?.length ? html`<span class="c-ajuda c-tom-atencao" style=${{ display: 'block' }}>${op.erros[0]}</span>` : null}</td>
                    <td class="c-num-esq" title=${op.turno.dias_rotulo || null}>${op.turno.codigo} <span class="c-secundario">${op.turno.entrada}–${op.turno.saida}</span></td>
                    ${dados.pausas_padrao.map((padrao) => { const p = pausas.find((x) => x.ordem === padrao.ordem);
                      return html`<td key=${padrao.ordem}>${p
                        ? (podeEditar ? html`<input class=${`c-entrada c-entrada--compacta c-pausa-hora ${p.inicio ? '' : 'c-pausa-hora--vazia'}`} type="time" step="300" aria-label=${`${op.nome}, ${padrao.ordem}ª pausa`} value=${p.inicio} onInput=${(e) => mudar(op, padrao.ordem, e.target.value)} />` : html`<span class="c-num-esq">${p.inicio}</span>`)
                        : (podeEditar && padrao.ordem === 1 ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto c-dia-add" onClick=${() => iniciar(op)}>+ Definir</button>` : html`<span class="c-secundario">—</span>`)}</td>`; })}
                    <td>${conf ? html`<${Selo} tom="perigo">Acima do limite<//>` : pend ? html`<${Selo} tom="informacao">Não salva<//>` : !pausas.length ? html`<${Selo} tom="atencao">Sem pausa<//>` : null}</td>
                    ${podeEditar ? html`<td class="c-acoes"><${MenuAcoes} rotulo=${`Mais ações para ${op.nome}`} acoes=${[
                      { label: 'Duplicar para outros colaboradores', icon: 'copy', disabled: !pausas.length || pend, onClick: () => setDuplicando(op) },
                    ]} /></td>` : null}
                  </tr>`; })}
                ${visiveisSem.map((op) => html`<tr key=${`s${op.id_operador}`} data-sem-escala="">
                  ${podeEditar ? html`<td></td>` : null}
                  <td class="c-estica c-secundario">${op.nome}</td>
                  <td class="c-secundario" title=${op.motivo || null}>Sem escala</td>
                  <td class="c-secundario" colspan=${nCols}>${op.motivo || 'Sem escala · sem pausa'}</td>
                  <td></td>
                  ${podeEditar ? html`<td></td>` : null}
                </tr>`)}
                ${visiveis.length + visiveisSem.length ? null : html`<tr><td class="c-secundario" colspan=${colunas}>Nenhum colaborador com estes filtros.</td></tr>`}
              </tbody>
            </table>
            ${podeEditar ? html`<${PainelDefinir} dia=${dia} anoMes=${anoMes} dados=${dados} operadores=${operadores} semEscala=${semEscala} marcados=${marcados} turnos=${turnos} equipes=${equipes}
              ocupado=${ocupado} executar=${executar} operacao=${operacao} resumoAplicacao=${resumoAplicacao} enfileirar=${enfileirar}
              capacidade=${capacidade} podeCapacidade=${podeCapacidade} aoCapacidade=${alterarCapacidade} ocup=${ocup} faixa=${faixa} />` : null}
          </div>`}

        ${podeEditar ? html`<div class="c-caixa-rodape">
          <span class=${alteradas ? 'c-ajuda c-pendencias' : 'c-ajuda'} role="status">${alteradas ? `${alteradas} alteração(ões) não salva(s)` : 'Nenhuma alteração pendente'}</span>
          <span class="c-fim">
            <button type="button" class="c-botao c-botao--texto" disabled=${!alteradas || null} onClick=${() => setEdicao({})}>Descartar</button>
            <button type="button" class="c-botao c-botao--principal" aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || !alteradas || null} onClick=${salvar}>Salvar pausas (${alteradas})</button>
          </span>
        </div>` : null}
      </div>
    </main>

    ${duplicando ? html`<${ModalDuplicar} origem=${duplicando} pausas=${pausasDe(duplicando)} dia=${dia} anoMes=${anoMes} operadores=${operadores} operacao=${operacao}
      executar=${executar} resumoAplicacao=${resumoAplicacao} aoFechar=${() => setDuplicando(null)} />` : null}`;
}

const QUANDO = {
  escala: ['Aplicar na escala', 'Cada colaborador recebe as pausas só nos dias do seu turno (no mês aberto).'],
  dia: ['Só este dia', 'Fica como alteração não salva até você usar Salvar pausas.'],
  semana: ['Toda a semana', 'Segunda a domingo; quem não tem escala em um dia não recebe pausa nele.'],
  mes: ['Todo o mês', 'Do dia 1 ao último; quem não tem escala em um dia não recebe pausa nele.'],
  personalizar: ['Personalizar', 'Só os dias da semana marcados, no mês aberto e onde há escala.'],
};

// Painel ao lado (300 px, na mesma caixa): 1 Quem recebe · 2 Horários (e quando aplicar) · 3 Máximo em pausa juntos, com o
// mini gráfico "Em pausa a cada 15 min" (substitui a Visão macro). Quem está sem escala no dia fica fora.
function PainelDefinir({ dia, anoMes, dados, operadores, semEscala, marcados, turnos, equipes, ocupado, executar, operacao, resumoAplicacao, enfileirar, capacidade, podeCapacidade, aoCapacidade, ocup, faixa }) {
  const [horarios, setHorarios] = useState(() => dados.pausas_padrao.map(() => ''));
  const [alvo, setAlvo] = useState('selecionados'); // 'selecionados' | 'equipe' | 'turno'
  const [equipe, setEquipe] = useState('');
  const [turno, setTurno] = useState('');
  const [quando, setQuando] = useState('escala');
  const [dias, setDias] = useState([true, true, true, true, true, false, false]);
  const [sobrescrever, setSobrescrever] = useState(true);
  const ids = alvo === 'selecionados' ? marcados.map((o) => o.id_operador)
    : alvo === 'equipe' ? (equipe ? operadores.filter((o) => String(o.id_equipe) === equipe).map((o) => o.id_operador) : [])
      : (turno ? operadores.filter((o) => o.turno.codigo === turno).map((o) => o.id_operador) : []);
  const semNoAlvo = alvo === 'equipe' && equipe ? semEscala.filter((o) => String(o.id_equipe) === equipe).length : 0;
  const completo = horarios.every(Boolean);
  const [ano, mes] = anoMes.split('-').map(Number);
  const ultimo = paraIso(new Date(ano, mes, 0));
  const periodo = quando === 'dia' ? [dia, dia] : quando === 'semana' ? periodoDe('semana', dia, anoMes) : [`${anoMes}-01`, ultimo];
  const diasSemana = quando === 'personalizar' ? dias.map((v, i) => (v ? i : null)).filter((i) => i !== null) : null;
  const semDiasPersonalizados = quando === 'personalizar' && !diasSemana.length;
  const pausas = dados.pausas_padrao.map((p, i) => ({ ordem: p.ordem, tipo: p.tipo, inicio: horarios[i], duracao_min: p.duracao_min }));
  const semAlvo = !ids.length;
  const aplicar = () => {
    if (quando === 'dia') { enfileirar(ids, pausas, sobrescrever); return undefined; }
    return executar(() => aplicarPausasWfm({ operacao, data_ini: periodo[0], data_fim: periodo[1], ids, pausas, dias_semana: diasSemana, sobrescrever }), resumoAplicacao);
  };
  const distribuir = () => executar(
    () => distribuirPausasWfm({ operacao, data: periodo[0], ids, sobrescrever, ...(quando === 'dia' ? {} : { data_fim: periodo[1], dias_semana: diasSemana }) }),
    'Pausas distribuídas respeitando o limite de pessoas em pausa ao mesmo tempo.',
  );
  const ajuda = alvo === 'selecionados' ? (marcados.length ? `${marcados.length} selecionado(s) com escala.` : 'Marque as pessoas na tabela.')
    : alvo === 'equipe' ? (equipe ? `${ids.length} com escala${semNoAlvo ? ` (${semNoAlvo} sem escala ficam de fora)` : ''}.` : 'Escolha a equipe.')
      : (turno ? `${ids.length} com escala.` : 'Escolha o turno.');

  // Mini gráfico: maior número de pessoas em pausa em cada faixa de 15 min do dia (com o que ainda não foi salvo).
  const barras = [];
  if (faixa) for (let m = faixa[0]; m < faixa[1]; m += FAIXA_GRAFICO) { let q = 0; for (let k = m; k < m + FAIXA_GRAFICO; k += PASSO) q = Math.max(q, ocup.get(k) || 0); barras.push([m, q]); }
  const topo = Math.max(capacidade, ...barras.map(([, q]) => q), 1);
  const pico = barras.reduce((a, b) => (b[1] > a[1] ? b : a), [0, 0]);

  return html`<aside class="c-pausas-painel" aria-label="Definir pausas">
    <h3>Definir pausas</h3>
    <div>
      <p class="c-rotulo">1 · Quem recebe</p>
      <${Segmento} mini=${true} rotulo="Quem recebe os horários" valor=${alvo} aoMudar=${setAlvo} opcoes=${[['selecionados', 'Selecionados', marcados.length], ['equipe', 'Equipe'], ['turno', 'Turno']]} />
      ${alvo === 'equipe' ? html`<select class="c-entrada c-entrada--compacta" style=${{ width: '100%', marginTop: 'var(--espaco-2)' }} aria-label="Equipe" value=${equipe} onChange=${(e) => setEquipe(e.target.value)}><option value="">Escolha a equipe…</option>${equipes.map(([id, nome]) => html`<option key=${id} value=${id}>${nome}</option>`)}</select>` : null}
      ${alvo === 'turno' ? html`<select class="c-entrada c-entrada--compacta" style=${{ width: '100%', marginTop: 'var(--espaco-2)' }} aria-label="Turno" value=${turno} onChange=${(e) => setTurno(e.target.value)}><option value="">Escolha o turno…</option>${turnos.map((t) => html`<option key=${t.codigo} value=${t.codigo}>${t.codigo} · ${t.entrada}–${t.saida}</option>`)}</select>` : null}
      <p class=${`c-ajuda ${alvo === 'selecionados' && !marcados.length ? 'c-tom-atencao' : ''}`}>${ajuda}</p>
    </div>

    <div>
      <p class="c-rotulo">2 · Horários</p>
      <div class="c-pausas-horas">
        ${dados.pausas_padrao.map((p, i) => html`<label key=${p.ordem}><span title=${`${ROTULO_TIPO[p.tipo] || 'Pausa'} · ${p.duracao_min} min`}>${i + 1}ª · ${p.duracao_min} min</span>
          <input class=${`c-entrada c-entrada--compacta c-pausa-hora ${horarios[i] ? '' : 'c-pausa-hora--vazia'}`} type="time" step="300" value=${horarios[i]} onInput=${(e) => setHorarios(horarios.map((h, j) => (j === i ? e.target.value : h)))} /></label>`)}
      </div>
      <select class="c-entrada c-entrada--compacta" style=${{ width: '100%', marginTop: 'var(--espaco-2)' }} aria-label="Quando aplicar" title=${QUANDO[quando][1]} value=${quando} onChange=${(e) => setQuando(e.target.value)}>
        ${Object.entries(QUANDO).map(([id, [rotulo]]) => html`<option key=${id} value=${id}>${rotulo}</option>`)}</select>
      ${quando === 'personalizar' ? html`<div class="c-padrao-dias" role="group" aria-label="Dias da semana atingidos">${SEMANA_CURTA.map((nome, i) => html`<label key=${nome} class="c-marcar"><input type="checkbox" checked=${dias[i]} onChange=${() => setDias(dias.map((v, j) => (j === i ? !v : v)))} /><span>${nome}</span></label>`)}</div>` : null}
      <label class="c-marcar"><input type="checkbox" checked=${sobrescrever} onChange=${(e) => setSobrescrever(e.target.checked)} /><span>Substituir pausas já programadas</span></label>
    </div>

    <div>
      <p class="c-rotulo">3 · Máximo em pausa juntos</p>
      <span class="c-pausas-passo" role="group" aria-label="Máximo de pessoas em pausa ao mesmo tempo">
        <button type="button" class="c-botao c-botao--secundario c-botao--icone c-botao--compacto" aria-label="Diminuir o limite" title=${podeCapacidade ? 'Diminuir o limite' : 'Sem permissão para alterar o limite'} disabled=${!podeCapacidade || capacidade <= 1 || null} onClick=${() => aoCapacidade(capacidade - 1)}>−</button>
        <b aria-live="polite">${capacidade}</b>
        <button type="button" class="c-botao c-botao--secundario c-botao--icone c-botao--compacto" aria-label="Aumentar o limite" title=${podeCapacidade ? 'Aumentar o limite' : 'Sem permissão para alterar o limite'} disabled=${!podeCapacidade || capacidade >= 200 || null} onClick=${() => aoCapacidade(capacidade + 1)}><${Ic} nome="plus" /></button>
      </span>
      ${barras.length ? html`<div class="c-pausas-ocup">
        <small>Em pausa a cada 15 min</small>
        <div class="c-pausas-barras" role="img" aria-label=${`Pico de ${pico[1]} pessoa(s) em pausa às ${deMin(pico[0])}; limite ${capacidade}`}>
          ${barras.map(([m, q]) => html`<span key=${m} class=${q > capacidade ? 'c-pausas-cheio' : ''} style=${{ height: `${Math.max(q ? 8 : 0, (q / topo) * 100)}%` }} title=${`${deMin(m)}–${deMin(m + FAIXA_GRAFICO)}: ${q} em pausa${q > capacidade ? ' (acima do limite)' : ''}`}></span>`)}
        </div>
        <small>${deMin(faixa[0])} · pico ${pico[1]} às ${deMin(pico[0])} · ${deMin(faixa[1])}</small>
      </div>` : null}
    </div>

    <div class="c-pausas-acoes">
      <button type="button" class="c-botao c-botao--principal" disabled=${ocupado || semAlvo || !completo || semDiasPersonalizados || null} title=${semAlvo ? 'Escolha quem recebe os horários' : !completo ? 'Preencha os três horários' : null} onClick=${aplicar}>${alvo === 'selecionados' ? 'Aplicar aos selecionados' : `Aplicar a ${ids.length} colaborador(es)`}</button>
      <button type="button" class="c-botao c-botao--secundario" disabled=${ocupado || semAlvo || semDiasPersonalizados || null} onClick=${distribuir} title="Em vez de horários fixos, distribui as pausas respeitando o limite de pessoas em pausa juntas">Distribuir automático</button>
    </div>
  </aside>`;
}

// Duplicar as pausas de um colaborador para outros (neste dia, na semana ou no mês).
function ModalDuplicar({ origem, pausas, dia, anoMes, operadores, operacao, executar, resumoAplicacao, aoFechar }) {
  const [destinos, setDestinos] = useState({});
  const [busca, setBusca] = useState('');
  const [escopo, setEscopo] = useState('dia');
  const [dias, setDias] = useState(TODOS_DIAS);
  const [sobrescrever, setSobrescrever] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const q = semAcento(busca);
  const candidatos = operadores.filter((o) => o.id_operador !== origem.id_operador && (!q || semAcento(o.nome).includes(q)));
  const ids = Object.keys(destinos).filter((k) => destinos[k]).map(Number);
  const [ini, fim] = periodoDe(escopo, dia, anoMes);
  const enviar = async (ev) => {
    ev.preventDefault();
    if (!ids.length) return;
    setSalvando(true);
    const ok = await executar(() => aplicarPausasWfm({
      operacao, data_ini: ini, data_fim: fim, ids, dias_semana: diasEscolhidos(escopo, dias), sobrescrever,
      pausas: pausas.map((p) => ({ ordem: p.ordem, tipo: p.tipo, inicio: p.inicio, duracao_min: p.duracao_min })),
    }), resumoAplicacao);
    setSalvando(false);
    if (ok) aoFechar();
  };
  return html`<${JanelaForm} titulo=${`Duplicar pausas de ${origem.nome}`} onClose=${aoFechar} onSubmit=${enviar} salvando=${salvando} salvarRotulo=${`Duplicar para ${ids.length} colaborador(es)`}>
    <p class="c-ajuda">Copia ${pausas.map((p) => `${p.inicio} (${p.duracao_min} min)`).join(' · ')}. Em cada dia, só quem trabalha e tem o horário dentro do turno recebe as pausas.</p>
    <div class="c-com-icone c-com-icone--compacta"><${Ic} nome="magnifying-glass" /><input type="search" class="c-entrada c-entrada--compacta" placeholder="Buscar colaborador" aria-label="Buscar colaborador" value=${busca} onInput=${(e) => setBusca(e.target.value)} /></div>
    <div class="c-lote-lista" role="group" aria-label="Colaboradores de destino">${candidatos.map((o) => html`<label key=${o.id_operador} class="c-marcar"><input type="checkbox" checked=${!!destinos[o.id_operador]} onChange=${() => setDestinos({ ...destinos, [o.id_operador]: !destinos[o.id_operador] })} />
      <span>${o.nome} <span class="c-secundario">${o.turno.codigo} ${o.turno.entrada}–${o.turno.saida}</span></span></label>`)}
      ${candidatos.length ? null : html`<span class="c-ajuda">Nenhum colaborador encontrado.</span>`}</div>
    <${Campo} rotulo="Aplicar em"><select class="c-entrada" value=${escopo} onChange=${(e) => setEscopo(e.target.value)}>
      <option value="dia">Só este dia (${brData(dia).slice(0, 5)})</option><option value="semana">Toda a semana</option><option value="mes">Todo o mês</option></select><//>
    ${escopo !== 'dia' ? html`<fieldset class="c-padrao-dias"><legend class="c-rotulo">Dias da semana atingidos</legend>${SEMANA_CURTA.map((nome, i) => html`<label key=${nome} class="c-marcar"><input type="checkbox" checked=${dias[i]} onChange=${() => setDias(dias.map((v, j) => (j === i ? !v : v)))} /><span>${nome}</span></label>`)}</fieldset>` : null}
    <label class="c-marcar"><input type="checkbox" checked=${sobrescrever} onChange=${(e) => setSobrescrever(e.target.checked)} /><span>Substituir pausas já programadas</span></label>
  <//>`;
}
