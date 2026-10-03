import { html, useCallback, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import {
  distribuirPausasWfm,
  fecharPeriodoWfm,
  lerEscalaWfm,
  listarVersoesEscalaWfm,
  publicarEscalaWfm,
  salvarItensEscalaWfm,
  validarEscalaWfm,
} from '../../services/api/wfm.js';
import { dataHora, infoDia, minutosParaHoras } from './comum.js';
import { PainelAprovacao } from './aprovacao.js';
import { MenuCompartilharEscala } from './compartilhar.js';
import { ModalConfigEscala } from './configuracao.js';
import { OutrasEscalas } from './outras.js';

// Escala mensal (Supervisor/Control Desk/Gestor editam; Qualidade lê; Operador lê a própria
// escala PUBLICADA). Toda validação (jornada, interjornada, pausas, DSR) roda no servidor;
// a tela só exibe o resultado. Conflito de edição concorrente volta como 409 e recarrega.

const ROTULO_PAUSA = { DESCANSO: 'Descanso', REFEICAO: 'Refeição', LANCHE: 'Lanche', OUTRA: 'Pausa' };
const DIAS_SEMANA_LONGO = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

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

function Celula({ turno, editavel, onPintar, onEntrar, titulo }) {
  const dica = turno ? `${titulo}: ${turno.nome}${turno.entrada ? ` · ${descreverTurno(turno)}` : ''}` : titulo;
  const conteudo = turno
    ? html`<span class="wfm-chip" style=${{ '--wfm-cor': turno.cor }}>${turno.codigo}</span>`
    : html`<span class="wfm-vazio wfm-dsr">DSR</span>`;
  if (!editavel) return html`<span title=${dica}>${conteudo}</span>`;
  return html`<button type="button" class="wfm-celula" aria-label=${dica} title=${dica} onMouseDown=${(e) => { e.preventDefault(); onPintar(); }} onMouseEnter=${onEntrar} onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPintar(); } }}>${conteudo}</button>`;
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
  const [pincel, setPincel] = useState(null); // {id}: null id = borracha
  const [arrastando, setArrastando] = useState(false);
  const [padrao, setPadrao] = useState(null); // {semana: [7 x id|''], sobrescrever}
  const [filtroEquipe, setFiltroEquipe] = useState('');
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
  useEffect(() => {
    const soltar = () => setArrastando(false);
    window.addEventListener('mouseup', soltar);
    return () => window.removeEventListener('mouseup', soltar);
  }, []);

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

  const pintar = (idOperador, data) => {
    if (!pincel) { showToast?.('Escolha um turno na paleta acima e depois clique nos dias.', 'info'); return; }
    mudar(idOperador, data, pincel.id);
  };
  // Operadores exibidos depois dos filtros (equipe, supervisor, nome).
  const visiveis = dados.operadores.filter((op) => (!filtroEquipe || String(op.id_equipe || '') === filtroEquipe)
    && (!filtroSup || (op.supervisores || []).some((s) => String(s.id_usuario) === filtroSup))
    && (!busca || op.nome.toLowerCase().includes(busca.toLowerCase())));
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
    alvos.forEach((op) => dados.dias.forEach((d) => {
      const [a, m, dia] = d.split('-').map(Number);
      const alvo = padrao.semana[(new Date(a, m - 1, dia).getDay() + 6) % 7];
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

  return html`
    <section class="mon-card wfm-escala">
      <div class="wfm-cabecalho">
        <div>
          <h3>${somentePropria ? 'Minha escala' : 'Escala mensal'}</h3>
          <p class="mon-muted">
            ${dados.status.versao_publicada ? `Versão publicada: ${dados.status.versao_publicada}` : 'Nenhuma versão publicada ainda'}
            ${fechada ? ` · Período fechado por ${dados.status.fechada_por || '—'} em ${dataHora(dados.status.fechada_em)}` : ''}
            ${somentePropria ? ' · Exibe sempre a última versão publicada.' : ''}
          </p>
        </div>
        <div class="wfm-acoes-cab">
          ${aoVoltarLista ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${aoVoltarLista}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('arrow_back')}</span>Escalas</button>` : null}
          ${fechada ? html`<span class="mon-badge mon-badge--info">Período fechado</span>` : null}
          ${!somentePropria && pode('wfm.escala.visualizar') ? html`<${MenuCompartilharEscala} operacao=${operacao} anoMes=${anoMes} dados=${dados} nomeOperacao=${dados.nome_escala || (contexto?.operacoes || []).find((o) => o.chave === operacao)?.nome || operacao} showToast=${showToast} aoVerMes=${aoVoltarDia} rotuloVer="Escala do dia" iconeVer="arrow_back" aoConfigurar=${!somenteLeitura && pode('wfm.cadastros.visualizar') ? () => setConfigurando(true) : undefined} />` : null}
        </div>
      </div>

      ${!somentePropria ? html`<${PainelAprovacao} operacao=${operacao} anoMes=${anoMes} aprovacao=${dados.aprovacao} onMudou=${carregar} showToast=${showToast} desabilitado=${totalPend > 0} />` : null}

      ${semItens ? html`<${EmptyState} icon="calendar_month" title="Nenhum operador" text="Não há operadores visíveis para você nesta operação." />` : html`
        <div class="wfm-filtros-escala">
          <label class="mon-campo"><span>Equipe</span><select class="form-select" value=${filtroEquipe} onChange=${(e) => setFiltroEquipe(e.target.value)}><option value="">Todas as equipes</option>${equipes.map(([id, nome]) => html`<option key=${id} value=${id}>${nome}</option>`)}</select></label>
          <label class="mon-campo"><span>Supervisor</span><select class="form-select" value=${filtroSup} onChange=${(e) => setFiltroSup(e.target.value)}><option value="">Todos os supervisores</option>${supervisores.map(([id, nome]) => html`<option key=${id} value=${id}>${nome}</option>`)}</select></label>
          <label class="mon-campo"><span>Buscar operador</span><input class="form-control" value=${busca} onInput=${(e) => setBusca(e.target.value)} placeholder="Nome" /></label>
          <span class="wfm-contagem">${visiveis.length} de ${dados.operadores.length} operador(es)</span>
        </div>
        ${editavel && dados.turnos.some((t) => t.ativo !== false && t.tipo !== 'FOLGA' && t.tipo !== 'DSR') ? html`
          <div class="wfm-paleta" role="toolbar" aria-label="Paleta de turnos">
            <span class="wfm-paleta-rotulo">1. Escolha o turno:</span>
            ${dados.turnos.filter((t) => t.ativo !== false).map((t) => html`<button key=${t.id_turno} type="button" class=${`wfm-paleta-item ${pincel?.id === t.id_turno ? 'is-ativo' : ''}`} onClick=${() => setPincel({ id: t.id_turno })} title=${t.nome + (t.entrada ? ' · ' + descreverTurno(t) : '')}>
              <span class="wfm-chip" style=${{ '--wfm-cor': t.cor }}>${t.codigo}</span><span>${t.entrada ? `${t.entrada}–${t.saida}` : t.nome}</span></button>`)}
            <button type="button" class=${`wfm-paleta-item ${pincel && pincel.id === null ? 'is-ativo' : ''}`} onClick=${() => setPincel({ id: null })}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('close')}</span><span>Borracha</span></button>
            <span class="wfm-paleta-rotulo">2. Clique ou arraste nos dias.</span>
            <span class="wfm-paleta-espaco"></span>
            <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setPadrao({ semana: ['', '', '', '', '', '', ''], sobrescrever: false })}>Padrão semanal para a equipe</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${limparTabela}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('delete')}</span>Limpar tabela</button>
          </div>` : null}
        ${padrao ? html`
          <div class="wfm-form">
            <h4>Padrão semanal — ${visiveis.filter((o) => selecionados[o.id_usuario]).length ? `${visiveis.filter((o) => selecionados[o.id_usuario]).length} operador(es) selecionado(s)` : `todos os ${visiveis.length} operador(es) exibidos`}</h4>
            <p class="mon-muted">Escolha o turno de cada dia da semana e aplique ao mês de todos de uma vez. Use os filtros para trabalhar uma equipe por vez ou marque as caixinhas para escolher operadores. Depois você ainda ajusta dia a dia.</p>
            <div class="wfm-padrao">${DIAS_SEMANA_LONGO.map((nome, i) => html`<label key=${nome} class="mon-campo"><span>${nome}</span>
              <select class="form-select" value=${padrao.semana[i]} onChange=${(e) => setPadrao({ ...padrao, semana: padrao.semana.map((v, j) => (j === i ? e.target.value : v)) })}>
                <option value="">—</option>${dados.turnos.filter((t) => t.ativo !== false).map((t) => html`<option key=${t.id_turno} value=${t.id_turno}>${t.codigo}${t.entrada ? ` ${t.entrada}–${t.saida}` : ''}</option>`)}</select></label>`)}</div>
            <label class="wfm-check"><input type="checkbox" checked=${programarPausas} onChange=${(e) => setProgramarPausas(e.target.checked)} /> Programar também as pausas dos dias aplicados (ao salvar)</label>
            <label class="wfm-check"><input type="checkbox" checked=${padrao.sobrescrever} onChange=${(e) => setPadrao({ ...padrao, sobrescrever: e.target.checked })} /> Sobrescrever dias que já têm turno</label>
            <div class="wfm-acoes"><button type="button" class="btn btn-primary btn-sm" onClick=${aplicarPadrao}>Aplicar ao mês</button><button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setPadrao(null)}>Cancelar</button></div>
          </div>` : null}
        <div class="wfm-grade-wrap" role="region" aria-label="Escala do mês" tabindex="0">
          <table class=${`wfm-grade ${editavel ? '' : 'wfm-grade--sem-sel'}`}>
            <thead>
              <tr>
                ${editavel ? html`<th class="wfm-col-sel"><input type="checkbox" aria-label="Selecionar todos os exibidos" checked=${todosSel} onChange=${() => setSelecionados(todosSel ? {} : Object.fromEntries(visiveis.map((o) => [o.id_usuario, true])))} /></th>` : null}
                <th class="wfm-col-nome">Operador</th>
                <th class="wfm-col-horas" title="Horas de trabalho no mês (inclui o que você ainda não salvou)">Horas</th>
                ${dados.dias.map((d) => {
                  const inf = infoDia(d);
                  const evs = eventosPorDia[d] || [];
                  return html`<th key=${d} class=${`wfm-col-dia ${inf.fimDeSemana ? 'is-fds' : ''} ${evs.length ? 'has-evento' : ''}`} title=${evs.map((e) => e.descricao).join(' · ')}>
                    <span>${inf.dia}</span><small>${inf.semana}</small>${evs.length ? html`<i class="wfm-ponto" aria-hidden="true"></i>` : null}
                  </th>`;
                })}
              </tr>
            </thead>
            <tbody>
              ${visiveis.map((op) => { const tot = totalDe(op.id_usuario); return html`
                <tr key=${op.id_usuario} class=${selecionados[op.id_usuario] ? 'is-selecionada' : ''}>
                  ${editavel ? html`<th class="wfm-col-sel"><input type="checkbox" aria-label=${`Selecionar ${op.nome}`} checked=${!!selecionados[op.id_usuario]} onChange=${() => alternarSel(op.id_usuario)} /></th>` : null}
                  <th class="wfm-col-nome" scope="row"><span class="wfm-nome">${op.nome}</span>${op.contratos?.length ? html`<small>${op.contratos[op.contratos.length - 1].codigo}${op.equipe ? ` · ${op.equipe}` : ''}</small>` : html`<small class="wfm-alerta-txt">sem jornada</small>`}</th>
                  <th class="wfm-col-horas" scope="row" title=${`${tot.dias} dia(s) de trabalho`}><strong>${minutosParaHoras(tot.min)}</strong><small>${tot.dias} dias</small></th>
                  ${dados.dias.map((d) => {
                    const chave = `${op.id_usuario}:${d}`;
                    const pend = chave in pendentes;
                    const viol = violacoesPorCelula[chave];
                    return html`<td key=${d} class=${`${infoDia(d).fimDeSemana ? 'is-fds' : ''} ${pend ? 'is-pendente' : ''} ${viol ? 'is-violacao' : ''}`.trim()} title=${viol ? viol.map((v) => v.mensagem).join('\n') : ''}>
                      <${Celula} turno=${turnosPorId[idTurnoDe(op.id_usuario, d)]} editavel=${editavel} titulo=${`${op.nome}, dia ${infoDia(d).dia}`} onPintar=${() => { setArrastando(true); pintar(op.id_usuario, d); }} onEntrar=${() => { if (arrastando && pincel) mudar(op.id_usuario, d, pincel.id); }} />
                    </td>`;
                  })}
                </tr>`; })}
            </tbody>
          </table>
        </div>
        <div class="wfm-legenda-detalhe">
          <h4>Legenda</h4>
          <div class="wfm-legenda-grade">${dados.turnos.map((t) => html`<div key=${t.id_turno} class="wfm-legenda-item"><span class="wfm-chip" style=${{ '--wfm-cor': t.cor }}>${t.codigo}</span><span class="wfm-legenda-corpo"><strong>${t.nome}</strong><small>${t.entrada ? `${t.entrada}–${t.saida} · ${minutosParaHoras(t.minutos || 0)}` : 'Sem horário'}</small></span></div>`)}</div>
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
    ${configurando ? html`<${ModalConfigEscala} operacao=${operacao} nomePadrao=${(contexto?.operacoes || []).find((o) => o.chave === operacao)?.nome || operacao} showToast=${showToast} onClose=${() => setConfigurando(false)} onSalvo=${() => { setConfigurando(false); carregar(); }} onMudouLista=${() => { setConfigurando(false); aoVoltarLista?.(); }} />` : null}`;
}
