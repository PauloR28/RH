import { html, useCallback, useEffect, useMemo, useState } from '../../../infraestrutura-react.js';
import { EmptyState, LoadingState } from '../../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../../ui/icone.js';
import {
  distribuirPausasWfm,
  fecharPeriodoWfm,
  lerEscalaWfm,
  listarVersoesEscalaWfm,
  publicarEscalaWfm,
  salvarItensEscalaWfm,
  validarEscalaWfm,
} from '../../../services/api/wfm.js';
import { dataHora, infoDia, minutosParaHoras } from './comum.js';
import { PainelAprovacao } from './aprovacao.js?v=20261007-admin-escala';
import { MenuCompartilharEscala, textoLegivel } from './compartilhar.js?v=20261007-admin-escala';
import { ModalConfigEscala } from './configuracao.js';
import { OutrasEscalas } from './outras.js';
import { GavetaAjusteDia } from './ajuste.js';
import { BarraSelecao, CheckTodos, FiltrosCompactos, Icone, LegendaTurnos, SeletorVisao, TituloEscala, doIso, paraIso, semAcento } from './escala-ui.js';

// Escala mensal (Supervisor/Control Desk/Gestor editam; Qualidade lê; Operador lê a própria
// escala PUBLICADA). Toda validação (jornada, interjornada, pausas, DSR) roda no servidor;
// a tela só exibe o resultado. Conflito de edição concorrente volta como 409 e recarrega.

const ROTULO_PAUSA = { DESCANSO: 'Descanso', REFEICAO: 'Refeição', LANCHE: 'Lanche', OUTRA: 'Pausa' };
const DIAS_SEMANA_LONGO = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const SEMANA_NOME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function horaMais(entrada, minutos) {
  const [h, m] = entrada.split(':').map(Number);
  const total = (h * 60 + m + minutos) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// "08:00–14:00 · Descanso 09:30 (10 min) · Refeição 11:00 (20 min)"
export function descreverTurno(t) {
  if (!t.entrada) return t.nome;
  const pausas = (t.pausas || []).map((p) => `${ROTULO_PAUSA[p.tipo] || 'Pausa'} ${horaMais(t.entrada, p.offset_min)} (${p.duracao_min} min)`);
  return [`${t.entrada}–${t.saida}`, ...pausas].join(' · ');
}

// Dropdown com caixinhas dos dias da semana + "Todos os dias".
function SeletorDias({ dias, aoMudar }) {
  const [aberto, setAberto] = useState(false);
  const todos = dias.every(Boolean);
  const marcados = DIAS_SEMANA_LONGO.filter((_, i) => dias[i]);
  const rotulo = todos ? 'Todos os dias' : marcados.length ? marcados.join(', ') : 'Escolher dias';
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (!e.target.closest?.('.wfm-dias-dd')) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);
  return html`<div class="wfm-dias-dd">
    <button type="button" class="form-select wfm-dias-btn" aria-haspopup="true" aria-expanded=${aberto} onClick=${() => setAberto(!aberto)}><span class="wfm-trunca">${rotulo}</span></button>
    ${aberto ? html`<div class="wfm-dias-menu" role="group" aria-label="Dias da semana">
      <label class="wfm-dias-item wfm-dias-todos"><input type="checkbox" checked=${todos} onChange=${() => aoMudar(dias.map(() => !todos))} /> Atribuir a todos os dias</label>
      ${DIAS_SEMANA_LONGO.map((nome, i) => html`<label class="wfm-dias-item" key=${nome}><input type="checkbox" checked=${dias[i]} onChange=${() => aoMudar(dias.map((v, j) => (j === i ? !v : v)))} /> ${nome}</label>`)}
    </div>` : null}
  </div>`;
}

export function TelaEscala({ controlador, contexto, operacao, anoMes, showToast, somentePropria = false, somenteLeitura = false, aoVoltarDia, aoVoltarLista, aoTrocarEscala }) {
  const [dados, setDados] = useState(null);
  const [configurando, setConfigurando] = useState(false);
  const [erro, setErro] = useState('');
  const [validacao, setValidacao] = useState(null);
  const [pendentes, setPendentes] = useState({});
  const [justificativa, setJustificativa] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [versoes, setVersoes] = useState([]);
  const [gaveta, setGaveta] = useState(null); // { id, nome, data } da célula com a gaveta "Ajustar dia" aberta
  const [foco, setFoco] = useState({ r: 0, c: 0 }); // célula com tabindex 0 (navegação por setas)
  const [limite, setLimite] = useState(50);
  const [turnoMassa, setTurnoMassa] = useState('');
  const [padrao, setPadrao] = useState(null); // {regras: [{turno, dias: [7 x bool]}], sobrescrever}
  const [filtroEquipe, setFiltroEquipe] = useState('');
  const [filtroCargo, setFiltroCargo] = useState('');
  const [filtroSup, setFiltroSup] = useState('');
  const [busca, setBusca] = useState('');
  const [selecionados, setSelecionados] = useState({});
  const [programarPausas, setProgramarPausas] = useState(false); // ao salvar, programa as pausas dos dias alterados

  const pode = (p) => controlador.possuiPermissao(p);

  const carregar = useCallback(async () => {
    if (!operacao) return;
    setErro('');
    try {
      const d = await lerEscalaWfm(operacao, anoMes);
      setDados(d);
      setPendentes({});
      if (!somentePropria && pode('wfm.escala.visualizar')) {
        validarEscalaWfm(operacao, anoMes).then(setValidacao).catch(() => setValidacao(null));
        listarVersoesEscalaWfm(operacao, anoMes).then((r) => setVersoes(r.itens || [])).catch(() => setVersoes([]));
      }
    } catch (e) {
      setDados(null);
      setErro(e?.message || 'Não foi possível carregar a escala.');
    }
  }, [operacao, anoMes, somentePropria]);

  useEffect(() => { setDados(null); carregar(); }, [carregar]);
  const turnosPorId = useMemo(() => Object.fromEntries((dados?.turnos || []).map((t) => [t.id_turno, t])), [dados]);
  const itensPorChave = useMemo(() => Object.fromEntries((dados?.itens || []).map((i) => [`${i.id_operador}:${i.data}`, i])), [dados]);
  const eventosPorDia = useMemo(() => {
    const mapa = {};
    (dados?.eventos || []).forEach((ev) => (dados?.dias || []).forEach((d) => {
      if (d >= ev.data_ini && d <= ev.data_fim) (mapa[d] = mapa[d] || []).push(ev);
    }));
    return mapa;
  }, [dados]);
  const violacoesPorCelula = useMemo(() => {
    const mapa = {};
    (validacao?.violacoes || []).forEach((v) => { (mapa[`${v.id_operador}:${v.data}`] = mapa[`${v.id_operador}:${v.data}`] || []).push(v); });
    return mapa;
  }, [validacao]);

  if (erro) return html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  if (!dados) return html`<${LoadingState} titulo="Carregando a escala" />`;

  const fechada = dados.status.fechada;
  const editavel = dados.pode_editar && !somentePropria && !somenteLeitura;
  const totalPend = Object.keys(pendentes).length;
  const exigeJustFechada = fechada && editavel;

  const mudar = (idOperador, data, idTurno) => {
    const chave = `${idOperador}:${data}`;
    const atual = itensPorChave[chave]?.id_turno ?? null;
    setPendentes((p) => {
      const novo = { ...p };
      if (idTurno === atual) delete novo[chave];
      else novo[chave] = { id_operador: idOperador, data, id_turno: idTurno, versao_linha: itensPorChave[chave]?.versao_linha ?? null };
      return novo;
    });
  };

  // Operadores exibidos depois dos filtros (equipe, supervisor, nome).
  const visiveis = dados.operadores.filter((op) => (!filtroEquipe || String(op.id_equipe || '') === filtroEquipe)
    && (!filtroSup || (op.supervisores || []).some((s) => String(s.id_usuario) === filtroSup))
    && (!filtroCargo || (op.cargo || '') === filtroCargo)
    && (!busca || semAcento(op.nome).includes(semAcento(busca.trim()))));
  const cargos = [...new Set(dados.operadores.map((o) => o.cargo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const equipes = [...new Map(dados.operadores.filter((o) => o.id_equipe).map((o) => [o.id_equipe, o.equipe])).entries()];
  const supervisores = [...new Map(dados.operadores.flatMap((o) => o.supervisores || []).map((s) => [s.id_usuario, s.nome])).entries()];
  const idTurnoDe = (idOp, d) => {
    const chave = `${idOp}:${d}`;
    return chave in pendentes ? pendentes[chave].id_turno : itensPorChave[chave]?.id_turno ?? null;
  };
  // Horas do mês do operador, já contando o que você pintou e ainda não salvou.
  const totalDe = (idOp) => dados.dias.reduce((acc, d) => {
    const t = turnosPorId[idTurnoDe(idOp, d)];
    return t?.tipo === 'TRABALHO' ? { min: acc.min + (t.minutos || 0), dias: acc.dias + 1 } : acc;
  }, { min: 0, dias: 0 });
  const alvosDoPadrao = () => (visiveis.filter((o) => selecionados[o.id_usuario]).length ? visiveis.filter((o) => selecionados[o.id_usuario]) : visiveis);
  const aplicarPadrao = () => {
    const alvos = alvosDoPadrao();
    // Cada regra (turno + dias da semana) vale para os dias marcados; se duas regras marcarem o mesmo dia, a última vence.
    const turnoDoDia = Array(7).fill('');
    padrao.regras.forEach((r) => { if (r.turno !== '') r.dias.forEach((marcado, i) => { if (marcado) turnoDoDia[i] = r.turno; }); });
    if (turnoDoDia.every((t) => t === '')) { showToast?.('Escolha um turno e marque ao menos um dia da semana.', 'info'); return; }
    alvos.forEach((op) => dados.dias.forEach((d) => {
      const [a, m, dia] = d.split('-').map(Number);
      const alvo = turnoDoDia[(new Date(a, m - 1, dia).getDay() + 6) % 7];
      if (alvo === '' || (!padrao.sobrescrever && idTurnoDe(op.id_usuario, d) !== null)) return;
      mudar(op.id_usuario, d, Number(alvo));
    }));
    showToast?.(`Padrão aplicado a ${alvos.length} operador(es). Revise e clique em "Salvar alterações".`, 'success');
    setPadrao(null);
  };
  const limparTabela = () => {
    const alvos = visiveis.filter((o) => dados.dias.some((d) => idTurnoDe(o.id_usuario, d) !== null));
    if (!alvos.length) { showToast?.('Não há turnos para limpar nos operadores exibidos.', 'info'); return; }
    if (!window.confirm(`Limpar a escala de ${alvos.length} operador(es) exibido(s) neste mês? Nada é apagado até você salvar.`)) return;
    alvos.forEach((o) => dados.dias.forEach((d) => { if (idTurnoDe(o.id_usuario, d) !== null) mudar(o.id_usuario, d, null); }));
  };
  const alternarSel = (id) => setSelecionados((s0) => ({ ...s0, [id]: !s0[id] }));
  const todosSel = visiveis.length > 0 && visiveis.every((o) => selecionados[o.id_usuario]);

  const executar = async (fn, sucesso) => {
    setOcupado(true);
    try {
      const r = await fn();
      if (sucesso) showToast?.(typeof sucesso === 'function' ? sucesso(r) : sucesso, 'success');
      return r;
    } catch (e) {
      showToast?.(e?.message || 'Não foi possível concluir a operação.', 'error');
      await carregar();
      return null;
    } finally {
      setOcupado(false);
    }
  };

  const salvar = async () => {
    const datasComTurno = [...new Set(Object.values(pendentes).filter((x) => x.id_turno !== null).map((x) => x.data))].sort();
    const r = await executar(
      () => salvarItensEscalaWfm({ operacao, ano_mes: anoMes, itens: Object.values(pendentes), justificativa }),
      (x) => `${x.alteradas} alteração(ões) salva(s).`,
    );
    if (r) {
      setJustificativa('');
      if (programarPausas && datasComTurno.length) {
        let feitos = 0;
        for (const d of datasComTurno) { try { const x = await distribuirPausasWfm({ operacao, data: d }); if (x.operadores) feitos += 1; } catch { /* dia fechado ou sem escalados */ } }
        showToast?.(`Pausas programadas em ${feitos} dia(s).`, 'success');
        setProgramarPausas(false);
      }
      await carregar();
    }
  };
  const publicar = async () => {
    const r = await executar(
      () => publicarEscalaWfm({ operacao, ano_mes: anoMes, justificativa }),
      (x) => `Escala publicada (versão ${x.versao}).`,
    );
    if (r) { setJustificativa(''); await carregar(); }
  };
  const fechar = async () => {
    if (!window.confirm('Fechar o período? Depois disso só o Gestor/RH pode corrigir, com justificativa.')) return;
    const r = await executar(() => fecharPeriodoWfm({ operacao, ano_mes: anoMes }), 'Período fechado.');
    if (r) await carregar();
  };

  const semItens = !dados.operadores.length;
  const bloqueio = validacao?.bloqueio;
  const duro = validacao?.bloqueio_duro;
  const podePublicarComViolacao = pode('wfm.escala.publicar_com_violacao');
  const publicarBloqueado = ocupado || totalPend > 0 || duro || (bloqueio && !podePublicarComViolacao)
    || ((bloqueio || exigeJustFechada) && !justificativa.trim())
    || (!fechada && dados.aprovacao?.estado !== 'APROVADA');

  // ---- apresentação (administração da escala): totais, seleção, legenda e navegação da matriz ----
  const selecionadosVis = visiveis.filter((o) => selecionados[o.id_usuario]);
  const mostradas = visiveis.slice(0, limite);
  const hojeIso = paraIso(new Date());
  const nomeOperacao = dados.nome_escala || (contexto?.operacoes || []).find((o) => o.chave === operacao)?.nome || operacao;
  const operadoresEscalados = dados.operadores.filter((o) => dados.dias.some((d) => turnosPorId[idTurnoDe(o.id_usuario, d)]?.tipo === 'TRABALHO')).length;
  const turnosOrdenados = dados.turnos.filter((t) => t.tipo !== 'DSR' && t.ativo !== false && t.tipo !== 'FOLGA');
  const padraoDisponivel = editavel && dados.turnos.some((t) => t.ativo !== false && t.tipo !== 'FOLGA' && t.tipo !== 'DSR');
  const idsUsados = new Set();
  dados.operadores.forEach((o) => dados.dias.forEach((d) => { const id = idTurnoDe(o.id_usuario, d); if (id !== null && id !== undefined) idsUsados.add(id); }));
  const turnosDoMes = dados.turnos.filter((t) => idsUsados.has(t.id_turno) && t.tipo !== 'DSR');
  const alternarTodos = () => setSelecionados(selecionadosVis.length === visiveis.length ? {} : Object.fromEntries(visiveis.map((o) => [o.id_usuario, true])));
  const focoR = Math.min(foco.r, Math.max(mostradas.length - 1, 0));
  const abrirGaveta = (op, d) => setGaveta({ id: op.id_usuario, nome: op.nome, data: d });

  // Aplicar turno (barra em massa): troca o turno dos dias de TRABALHO dos selecionados; DSR/folga ficam como estão. Fica pendente até salvar.
  const aplicarTurnoMassa = () => {
    if (turnoMassa === '') { showToast?.('Escolha o turno que será atribuído.', 'info'); return; }
    let dias = 0;
    selecionadosVis.forEach((op) => dados.dias.forEach((d) => {
      if (turnosPorId[idTurnoDe(op.id_usuario, d)]?.tipo !== 'TRABALHO') return;
      mudar(op.id_usuario, d, Number(turnoMassa));
      dias += 1;
    }));
    showToast?.(`Turno aplicado a ${selecionadosVis.length} operador(es) em ${dias} dia(s) de trabalho (DSR preservado). Revise e clique em "Salvar alterações".`, 'success');
  };
  // Setas movem o foco entre as células (tabindex móvel); Enter/Espaço abrem a gaveta pelo próprio botão.
  const aoTeclarGrade = (e) => {
    const alvo = e.target.closest?.('[data-r]');
    if (!alvo) return;
    let r = Number(alvo.dataset.r); let c = Number(alvo.dataset.c);
    if (e.key === 'ArrowRight') c += 1;
    else if (e.key === 'ArrowLeft') c -= 1;
    else if (e.key === 'ArrowDown') r += 1;
    else if (e.key === 'ArrowUp') r -= 1;
    else if (e.key === 'Home') c = 0;
    else if (e.key === 'End') c = dados.dias.length - 1;
    else return;
    e.preventDefault();
    r = Math.max(0, Math.min(mostradas.length - 1, r)); c = Math.max(0, Math.min(dados.dias.length - 1, c));
    e.currentTarget.querySelector(`[data-r="${r}"][data-c="${c}"]`)?.focus();
  };
  const menuAcoes = !somentePropria && pode('wfm.escala.visualizar')
    ? html`<${MenuCompartilharEscala} operacao=${operacao} anoMes=${anoMes} dados=${dados} nomeOperacao=${nomeOperacao} showToast=${showToast} aoVerMes=${aoVoltarDia} rotuloVer="Escala do dia" iconeVer="arrow_back" aoConfigurar=${!somenteLeitura && pode('wfm.cadastros.visualizar') ? () => setConfigurando(true) : undefined} aoLimpar=${editavel && dados.operadores.length ? limparTabela : undefined} />`
    : null;

  return html`
    <section class="mon-card wfm-escala ea-raiz">
      <${TituloEscala} nome=${nomeOperacao} escalados=${operadoresEscalados} emDsr=${dados.operadores.length - operadoresEscalados} versao=${dados.status.versao_publicada} aoVoltarLista=${aoVoltarLista} menu=${menuAcoes} />

      <div class="ea-nav">
        <div class="ea-nav-esq">
          <${SeletorVisao} visao="mes" aoDia=${aoVoltarDia} />
          ${!somentePropria ? html`<${PainelAprovacao} operacao=${operacao} anoMes=${anoMes} aprovacao=${dados.aprovacao} onMudou=${carregar} showToast=${showToast} desabilitado=${totalPend > 0} compacto />` : null}
        </div>
        ${padraoDisponivel ? html`<button type="button" class=${`btn btn-outline-primary ea-btn-44 ea-btn-padrao ${padrao ? 'is-ativo' : ''}`} aria-expanded=${!!padrao} onClick=${() => setPadrao(padrao ? null : { regras: [{ turno: '', dias: Array(7).fill(false) }], sobrescrever: false })}><${Icone} nome="calendar_month" />Padrão semanal</button>` : null}
      </div>

      ${semItens ? html`<${EmptyState} icon="calendar_month" title="Nenhum operador" text="Não há operadores visíveis para você nesta operação." />` : html`
        <${FiltrosCompactos} rotuloBusca="Buscar operador" busca=${busca} aoBuscar=${setBusca} contagem=${`${visiveis.length} de ${dados.operadores.length} operador(es)`}
          selects=${[
            { rotulo: 'Equipe', padrao: 'Equipe: todas', valor: filtroEquipe, aoMudar: setFiltroEquipe, largura: 'm', opcoes: equipes.map(([id, nome]) => [String(id), nome]) },
            { rotulo: 'Supervisor', padrao: 'Supervisor: todos', valor: filtroSup, aoMudar: setFiltroSup, largura: 'g', opcoes: supervisores.map(([id, nome]) => [String(id), nome]) },
            { rotulo: 'Cargo', padrao: 'Cargo: todos', valor: filtroCargo, aoMudar: setFiltroCargo, largura: 'p', opcoes: cargos.map((c) => [c, c]) },
          ]} />

        ${editavel && padraoDisponivel ? html`<${BarraSelecao} n=${selecionadosVis.length} aoLimpar=${() => setSelecionados({})}>
          <label class="visually-hidden" for="ea-turno-massa-mes">Turno a atribuir</label>
          <select id="ea-turno-massa-mes" class="ea-campo ea-select ea-select--turno ea-campo--massa" value=${turnoMassa} onChange=${(e) => setTurnoMassa(e.target.value)}>
            <option value="">Atribuir turno…</option>${turnosOrdenados.map((t) => html`<option key=${t.id_turno} value=${t.id_turno}>${t.nome}${t.entrada ? ` ${t.entrada}–${t.saida}` : ''}</option>`)}</select>
          <button type="button" class="ea-btn-sol" disabled=${turnoMassa === ''} onClick=${aplicarTurnoMassa}>Aplicar turno</button>
          <button type="button" class=${`ea-btn-ctn ${padrao ? 'is-ativo' : ''}`} aria-expanded=${!!padrao} onClick=${() => setPadrao(padrao ? null : { regras: [{ turno: '', dias: Array(7).fill(false) }], sobrescrever: false })}>Aplicar padrão semanal</button>
        <//>` : null}

        ${padrao ? html`
          <div class="wfm-form ea-painel-massa">
            <h4>Padrão semanal — ${selecionadosVis.length ? `${selecionadosVis.length} operador(es) selecionado(s)` : `todos os ${visiveis.length} operador(es) exibidos`}</h4>
            <p class="mon-muted">Escolha o turno e marque os dias da semana em que ele vale (ou "Atribuir a todos os dias"). Adicione outro turno para os demais dias. Depois você ainda ajusta dia a dia.</p>
            <div class="wfm-regras">
              ${padrao.regras.map((r, i) => html`<div class="wfm-regra" key=${i}>
                <label class="mon-campo"><span>Turno</span>
                  <select class="form-select" value=${r.turno} onChange=${(e) => setPadrao({ ...padrao, regras: padrao.regras.map((x, j) => (j === i ? { ...x, turno: e.target.value } : x)) })}>
                    <option value="">Escolher turno</option>${dados.turnos.filter((t) => t.ativo !== false).map((t) => html`<option key=${t.id_turno} value=${t.id_turno}>${t.codigo}${t.entrada ? ` ${t.entrada}–${t.saida}` : ''}</option>`)}</select></label>
                <div class="mon-campo"><span>Dias da semana</span>
                  <${SeletorDias} dias=${r.dias} aoMudar=${(dias) => setPadrao({ ...padrao, regras: padrao.regras.map((x, j) => (j === i ? { ...x, dias } : x)) })} /></div>
                ${padrao.regras.length > 1 ? html`<button type="button" class="btn btn-outline-secondary btn-sm wfm-regra-rm" aria-label="Remover este turno" onClick=${() => setPadrao({ ...padrao, regras: padrao.regras.filter((_, j) => j !== i) })}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('close')}</span></button>` : null}
              </div>`)}
            </div>
            <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setPadrao({ ...padrao, regras: [...padrao.regras, { turno: '', dias: Array(7).fill(false) }] })}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Outro turno</button>
            <label class="wfm-check"><input type="checkbox" checked=${programarPausas} onChange=${(e) => setProgramarPausas(e.target.checked)} /> Programar também as pausas dos dias aplicados (ao salvar)</label>
            <label class="wfm-check"><input type="checkbox" checked=${padrao.sobrescrever} onChange=${(e) => setPadrao({ ...padrao, sobrescrever: e.target.checked })} /> Sobrescrever dias que já têm turno</label>
            <div class="wfm-acoes"><button type="button" class="btn btn-primary btn-sm" onClick=${aplicarPadrao}>Aplicar ao mês</button><button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setPadrao(null)}>Cancelar</button></div>
          </div>` : null}

        <${LegendaTurnos} turnos=${turnosDoMes} />

        <div class="ea-mat">
          <div class="ea-mat-rolagem" role="region" aria-label="Escala do mês" tabindex="0">
            <div class="ea-grade" role="grid" aria-label="Escala do mês" aria-rowcount=${mostradas.length + 1} style=${{ '--ea-dias': dados.dias.length }} onKeyDown=${editavel ? aoTeclarGrade : undefined}>
              <div class="ea-g-lin ea-g-cab" role="row">
                <div class="ea-g-op" role="columnheader">
                  ${editavel ? html`<${CheckTodos} rotulo="Selecionar todos os operadores" total=${visiveis.length} marcados=${selecionadosVis.length} aoAlternar=${alternarTodos} />` : null}
                  <span class="ea-rotulo">OPERADOR</span>
                </div>
                <div class="ea-g-horas" role="columnheader"><span class="ea-rotulo" title="Horas de trabalho no mês (inclui o que você ainda não salvou)">HORAS</span></div>
                ${dados.dias.map((d) => {
                  const inf = infoDia(d);
                  const evs = eventosPorDia[d] || [];
                  return html`<div key=${d} role="columnheader" class=${`ea-g-dia ${inf.fimDeSemana ? 'is-fds' : ''} ${d === hojeIso ? 'is-hoje' : ''}`} title=${evs.map((e) => e.descricao).join(' · ') || undefined}>
                    <span class="ea-dia-num">${inf.dia}</span><span class="ea-dia-let">${inf.semana}</span>${evs.length ? html`<i class="wfm-ponto" aria-hidden="true"></i>` : null}
                  </div>`;
                })}
              </div>
              ${mostradas.map((op, r) => { const tot = totalDe(op.id_usuario); return html`
                <div key=${op.id_usuario} role="row" class=${`ea-g-lin ${selecionados[op.id_usuario] ? 'is-sel' : ''}`}>
                  <div class="ea-g-op" role="rowheader">
                    ${editavel ? html`<input type="checkbox" class="ea-check" aria-label=${`Selecionar ${op.nome}`} checked=${!!selecionados[op.id_usuario]} onChange=${() => alternarSel(op.id_usuario)} />` : null}
                    <span class="ea-nome" title=${op.nome}>${op.nome}</span>
                  </div>
                  <div class="ea-g-horas" role="gridcell" title=${`${tot.dias} dia(s) de trabalho`}><strong class="ea-num">${minutosParaHoras(tot.min)}</strong><small>${tot.dias} dias</small></div>
                  ${dados.dias.map((d, c) => {
                    const chave = `${op.id_usuario}:${d}`;
                    const pend = chave in pendentes;
                    const viol = violacoesPorCelula[chave];
                    const t = turnosPorId[idTurnoDe(op.id_usuario, d)];
                    const dsr = !t || t.tipo === 'DSR';
                    const inf = infoDia(d);
                    const rotulo = `${op.nome}, ${SEMANA_NOME[doIso(d).getDay()]} ${inf.dia}, ${dsr ? 'DSR' : t.nome}`;
                    const aberta = gaveta?.id === op.id_usuario && gaveta?.data === d;
                    const classe = `ea-cel ${dsr ? 'is-dsr' : ''} ${aberta ? 'is-aberta' : ''}`;
                    const estilo = !dsr && t.cor ? { '--ea-cor': t.cor, '--ea-fg': textoLegivel(t.cor) } : undefined;
                    return html`<div key=${d} role="gridcell" class=${`ea-g-cel ${inf.fimDeSemana ? 'is-fds' : ''} ${d === hojeIso ? 'is-hoje' : ''} ${pend ? 'is-pendente' : ''} ${viol ? 'is-violacao' : ''}`.trim()} title=${viol ? viol.map((v) => v.mensagem).join('\n') : undefined}>
                      ${editavel
                        ? html`<button type="button" class=${classe} style=${estilo} data-r=${r} data-c=${c} tabIndex=${r === focoR && c === Math.min(foco.c, dados.dias.length - 1) ? 0 : -1} aria-label=${rotulo} aria-haspopup="dialog" onFocus=${() => setFoco({ r, c })} onClick=${() => abrirGaveta(op, d)}>${dsr ? 'DSR' : t.codigo}</button>`
                        : html`<span class=${classe} style=${estilo} title=${rotulo}>${dsr ? 'DSR' : t.codigo}</span>`}
                    </div>`;
                  })}
                </div>`; })}
            </div>
          </div>
          <div class="ea-rodape">
            <span class="ea-muted" aria-live="polite">Mostrando ${mostradas.length} de ${visiveis.length} operadores${editavel ? ' · clique numa célula para ajustar o dia' : ''}</span>
            ${mostradas.length < visiveis.length ? html`<button type="button" class="btn btn-outline-secondary ea-btn-40" onClick=${() => setLimite((l) => l + 50)}>Mostrar mais</button>` : null}
          </div>
        </div>`}

      ${!somentePropria && validacao?.violacoes?.length ? html`
        <div class=${`wfm-validacao ${bloqueio ? 'is-bloqueio' : 'is-alerta'}`} role="status">
          <strong>${validacao.violacoes.length} violação(ões) de jornada</strong>
          ${duro ? html`<p>Bloqueio duro: corrija a escala para publicar.</p>` : bloqueio ? html`<p>${podePublicarComViolacao ? 'Você pode publicar com justificativa (fica registrada em auditoria).' : 'Não é possível publicar até corrigir. Somente o Gestor/RH publica com violação pendente.'}</p>` : null}
          <ul>${validacao.violacoes.slice(0, 40).map((v, i) => html`<li key=${i}><b>${v.operador}</b> · ${v.data.split('-').reverse().join('/')} · ${v.mensagem}${v.permite_override ? '' : ' (bloqueio duro)'}</li>`)}</ul>
        </div>` : null}

      ${editavel || (!somentePropria && pode('wfm.escala.publicar')) ? html`
        <div class="wfm-acoes">
          ${(bloqueio && podePublicarComViolacao) || exigeJustFechada || totalPend > 0 && fechada ? html`
            <label class="mon-campo wfm-just"><span>Justificativa ${exigeJustFechada || bloqueio ? '(obrigatória)' : ''}</span>
              <input class="form-control" maxlength="400" value=${justificativa} onInput=${(e) => setJustificativa(e.target.value)} placeholder=${exigeJustFechada ? 'Motivo da correção após o fechamento' : 'Motivo para publicar com violação pendente'} />
            </label>` : null}
          ${editavel ? html`<button type="button" class="btn btn-primary" disabled=${ocupado || totalPend === 0 || (fechada && !justificativa.trim())} onClick=${salvar}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('check')}</span>Salvar alterações${totalPend ? ` (${totalPend})` : ''}</button>` : null}
          ${totalPend ? html`<button type="button" class="btn btn-outline-secondary" onClick=${() => setPendentes({})}>Descartar</button>` : null}
          ${pode('wfm.escala.publicar') ? html`<button type="button" class="btn btn-outline-primary" disabled=${publicarBloqueado} title=${totalPend ? 'Salve as alterações antes de publicar.' : (!fechada && dados.aprovacao?.estado !== 'APROVADA') ? 'A escala precisa ser aprovada pelo Gestor ou Supervisor antes de publicar.' : ''} onClick=${publicar}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('event_available')}</span>Publicar nova versão</button>` : null}
          ${pode('wfm.escala.fechar') && !fechada ? html`<button type="button" class="btn btn-outline-secondary" disabled=${ocupado || !dados.status.versao_publicada} onClick=${fechar}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('lock')}</span>Fechar período</button>` : null}
        </div>` : null}

      ${!somentePropria && versoes.length ? html`
        <details class="wfm-versoes">
          <summary>Histórico de versões (${versoes.length})</summary>
          <div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Versão</th><th>Aprovada por</th><th>Publicada por</th><th>Em</th><th>Violação</th><th>Justificativa</th></tr></thead>
            <tbody>${versoes.map((v) => html`<tr key=${v.versao}><td>v${v.versao}</td><td>${v.aprovado_por || '—'}</td><td>${v.publicado_por || '—'}</td><td>${dataHora(v.publicado_em)}</td><td>${v.com_violacao ? 'Sim' : 'Não'}</td><td>${v.justificativa || '—'}</td></tr>`)}</tbody></table></div>
        </details>` : null}
    </section>
    ${somenteLeitura && !somentePropria ? html`<${OutrasEscalas} anoMes=${anoMes} operacao=${operacao} versao=${`${dados.aprovacao?.estado}:${dados.status?.versao_publicada}`} onEscolher=${(chave) => aoTrocarEscala?.(chave)} />` : null}
    ${gaveta && editavel ? html`<${GavetaAjusteDia} alvo=${gaveta} dados=${dados} operacao=${operacao} anoMes=${anoMes} fechada=${fechada} showToast=${showToast}
      bloqueio=${totalPend > 0 ? 'Há alterações não salvas na tela. Salve ou descarte antes de ajustar um dia.' : ''}
      aoFechar=${() => setGaveta(null)} aoSalvo=${(ok) => { if (ok) setGaveta(null); carregar(); }} />` : null}
    ${configurando ? html`<${ModalConfigEscala} operacao=${operacao} nomePadrao=${(contexto?.operacoes || []).find((o) => o.chave === operacao)?.nome || operacao} showToast=${showToast} onClose=${() => setConfigurando(false)} onSalvo=${() => { setConfigurando(false); carregar(); }} onMudouLista=${() => { setConfigurando(false); aoVoltarLista?.(); }} />` : null}`;
}
