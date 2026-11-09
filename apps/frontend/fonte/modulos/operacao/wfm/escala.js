import { html, useCallback, useEffect, useMemo, useState } from '../../../infraestrutura-react.js';
import {
  aprovarEscalaWfm,
  cancelarEnvioEscalaWfm,
  declinarEscalaWfm,
  distribuirPausasWfm,
  enviarAprovacaoEscalaWfm,
  fecharPeriodoWfm,
  lerEscalaWfm,
  listarVersoesEscalaWfm,
  publicarEscalaWfm,
  salvarItensEscalaWfm,
  validarEscalaWfm,
} from '../../../services/api/wfm.js?v=20261104-leitura';
import { dataHora, falhaAo, infoDia, horasMin } from './comum.js?v=20261104-leitura';
import { MenuCompartilharEscala } from './compartilhar.js?v=20261106-wfm';
import { ModalConfigEscala } from './configuracao.js?v=20261104-leitura';
import { OutrasEscalas } from './outras.js?v=20261104-leitura';
import { GavetaAjusteDia } from './ajuste.js?v=20261104-leitura';
import { diaDoTurno, doIso, paraIso, semAcento, somarMes, useVisaoEquipes } from './escala-ui.js?v=20261104-leitura';
import { Campo, Esqueleto, Estado, Faixa, Ic, Janela, Navegar, Segmento, Selo } from '../../../ui/components/ds.js?v=20261106-wfm';
import { tomarFocoPessoa } from './foco-pessoa.js';

// Escala aberta (redesign Fase 15, amostra "Escala padrão" da Fase 12): visões Semana e Mês. Supervisor/Control Desk/
// Gestor editam; Qualidade lê; o Operador lê a própria escala PUBLICADA. Toda validação (jornada, interjornada, pausas,
// DSR) roda no servidor; a tela só exibe o resultado. Conflito de edição concorrente volta como 409 e recarrega.

const ROTULO_PAUSA = { DESCANSO: 'Descanso', REFEICAO: 'Refeição', LANCHE: 'Lanche', OUTRA: 'Pausa' };
const DIAS_SEMANA_LONGO = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const SEMANA_NOME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const SEMANA_CURTA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

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

// Estado da escala no cabeçalho (o caminho é Rascunho › Aprovação › Publicada › Fechada).
export function estadoEscala(dados) {
  const ap = dados.aprovacao;
  const v = dados.status.versao_publicada;
  if (dados.status.fechada) return ['Fechada', 'neutro', 'lock', ''];
  if (ap?.declinada) return ['Declinada', 'perigo', 'x-circle', 'Próximo passo: corrigir e enviar de novo'];
  if (ap?.estado === 'EM_APROVACAO') return ['Aguardando aprovação', 'atencao', 'hourglass', 'Edição bloqueada até a decisão'];
  if (ap?.estado === 'APROVADA') return [v ? `Publicada · v${v}` : 'Aprovada', 'sucesso', 'check-circle', ''];
  if (v) return [`Publicada · v${v}`, 'sucesso', 'check-circle', ap?.exige ? 'Alterações pedem nova aprovação' : ''];
  return ['Rascunho', 'neutro', 'pencil-simple', ap?.exige ? 'Próximo passo: aprovação' : 'Próximo passo: publicar'];
}

// Aprovação no cabeçalho: Enviar / Aprovar / Declinar (justificativa em janela) / Cancelar envio. Mesmas rotas de antes.
export function AcoesAprovacao({ operacao, anoMes, aprovacao, onMudou, showToast, desabilitado }) {
  const [declinando, setDeclinando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  if (!aprovacao?.exige) return null;
  const corpo = { operacao, ano_mes: anoMes };
  const executar = async (fn, sucesso) => {
    setOcupado(true);
    try {
      const r = await fn();
      // Aprovar já publica; se a publicação não coube ao aprovador, o servidor devolve o aviso.
      if (r && r.estado === 'APROVADA') {
        if (r.publicada) showToast?.(`Escala aprovada e publicada (v${r.versao}).`, 'success');
        else showToast?.(`Escala aprovada. Não foi publicada automaticamente: ${r.aviso || 'publique manualmente.'}`, 'warning');
      } else showToast?.(sucesso, 'success');
      setDeclinando(false); setMotivo('');
      await onMudou?.();
    } catch (e) {
      showToast?.(e?.message || 'Não foi possível concluir.', 'error');
      await onMudou?.();
    } finally { setOcupado(false); }
  };
  const bloq = ocupado || desabilitado || null;
  return html`
    ${aprovacao.pode_cancelar ? html`<button type="button" class="c-botao c-botao--secundario" disabled=${bloq} onClick=${() => executar(() => cancelarEnvioEscalaWfm(corpo), 'Envio cancelado. A escala voltou a rascunho.')}>Cancelar envio</button>` : null}
    ${aprovacao.pode_declinar ? html`<button type="button" class="c-botao c-botao--secundario" disabled=${bloq} onClick=${() => setDeclinando(true)}>Declinar</button>` : null}
    ${aprovacao.pode_aprovar ? html`<button type="button" class="c-botao c-botao--principal" disabled=${bloq} aria-busy=${ocupado ? 'true' : null} onClick=${() => executar(() => aprovarEscalaWfm(corpo), 'Escala aprovada. Já pode ser publicada.')}><${Ic} nome="check" />Aprovar</button>` : null}
    ${aprovacao.pode_enviar ? html`<button type="button" class="c-botao c-botao--principal" disabled=${bloq} aria-busy=${ocupado ? 'true' : null} title=${desabilitado ? 'Salve as alterações antes de enviar.' : null} onClick=${() => executar(() => enviarAprovacaoEscalaWfm(corpo), 'Escala enviada para aprovação.')}><${Ic} nome="send" />Enviar para aprovação</button>` : null}
    ${declinando ? html`<${Janela} titulo="Declinar escala" tamanho="pequena" onClose=${() => setDeclinando(false)}
      rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => setDeclinando(false)}>Voltar</button>
        <button type="button" class="c-botao c-botao--perigo" disabled=${bloq || motivo.trim().length < 3 || null} onClick=${() => executar(() => declinarEscalaWfm({ ...corpo, justificativa: motivo }), 'Escala declinada e devolvida para edição.')}>Confirmar declínio</button>`}>
      <div class="c-janela-corpo">
        <p>A escala volta para a edição de quem a enviou.</p>
        <${Campo} rotulo="O que precisa ser corrigido?" ajuda="Obrigatório (mínimo 3 letras).">
          <textarea class="c-entrada" maxlength="400" autofocus value=${motivo} onInput=${(e) => setMotivo(e.target.value)}></textarea>
        <//>
      </div>
    <//>` : null}`;
}

// Padrão semanal: turno + dias da semana (vários turnos possíveis). Fica pendente até "Salvar".
function JanelaPadrao({ padrao, setPadrao, turnos, alvoTexto, diasDoTurno, programarPausas, setProgramarPausas, aoAplicar }) {
  const mudarRegra = (i, campo, valor) => setPadrao({ ...padrao, regras: padrao.regras.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)) });
  return html`<${Janela} titulo="Padrão semanal" tamanho="grande" onClose=${() => setPadrao(null)}
    rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => setPadrao(null)}>Cancelar</button>
      <button type="button" class="c-botao c-botao--principal" onClick=${aoAplicar}>Aplicar ao mês</button>`}>
    <div class="c-janela-corpo">
      <p>Vale para ${alvoTexto}. Escolha o turno e marque os dias da semana em que ele vale; adicione outro turno para os demais dias. Depois você ainda ajusta dia a dia.</p>
      ${padrao.regras.map((r, i) => html`<div key=${i} class="c-padrao-regra">
        <${Campo} rotulo="Turno">
          <select class="c-entrada" value=${r.turno} onChange=${(e) => setPadrao({ ...padrao, regras: padrao.regras.map((x, j) => (j === i ? { ...x, turno: e.target.value, dias: diasDoTurno(e.target.value, x.dias) } : x)) })}>
            <option value="">Escolher turno</option>${turnos.map((t) => html`<option key=${t.id_turno} value=${t.id_turno}>${t.codigo}${t.entrada ? ` ${t.entrada}–${t.saida}` : ''}${t.nome && t.nome !== t.codigo ? ` · ${t.nome}` : ''}</option>`)}
          </select>
        <//>
        <fieldset class="c-padrao-dias">
          <legend class="c-rotulo">Dias da semana</legend>
          <label class="c-marcar"><input type="checkbox" checked=${r.dias.every(Boolean)} onChange=${() => mudarRegra(i, 'dias', r.dias.map(() => !r.dias.every(Boolean)))} /><span>Todos</span></label>
          ${DIAS_SEMANA_LONGO.map((nome, k) => html`<label key=${nome} class="c-marcar"><input type="checkbox" checked=${r.dias[k]} onChange=${() => mudarRegra(i, 'dias', r.dias.map((v, j) => (j === k ? !v : v)))} /><span>${nome}</span></label>`)}
        </fieldset>
        ${padrao.regras.length > 1 ? html`<button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Remover este turno" title="Remover este turno" onClick=${() => setPadrao({ ...padrao, regras: padrao.regras.filter((_, j) => j !== i) })}><${Ic} nome="x" /></button>` : null}
      </div>`)}
      <div><button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => setPadrao({ ...padrao, regras: [...padrao.regras, { turno: '', dias: Array(7).fill(false) }] })}><${Ic} nome="plus" />Outro turno</button></div>
      <label class="c-marcar"><input type="checkbox" checked=${programarPausas} onChange=${(e) => setProgramarPausas(e.target.checked)} /><span>Programar também as pausas dos dias aplicados (ao salvar)</span></label>
      <label class="c-marcar"><input type="checkbox" checked=${padrao.sobrescrever} onChange=${(e) => setPadrao({ ...padrao, sobrescrever: e.target.checked })} /><span>Sobrescrever dias que já têm turno</span></label>
    </div>
  <//>`;
}

// Semanas (seg–dom) do mês, para a visão Semana.
function semanasDoMes(dias) {
  const semanas = [];
  dias.forEach((d) => {
    const seg = (doIso(d).getDay() + 6) % 7;
    if (!semanas.length || seg === 0) semanas.push([]);
    semanas[semanas.length - 1].push(d);
  });
  return semanas;
}

export function TelaEscala({ controlador, contexto, operacao, anoMes, showToast, somentePropria = false, somenteLeitura = false, aoVoltarDia, aoPausas, aoVoltarLista, aoTrocarEscala, aoMudarMes, opcoesEscala = null, acessorio = null, visaoInicial = 'semana' }) {
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
  const [celSel, setCelSel] = useState(null); // { id, nome, data }: célula escolhida; liga a faixa de ajuste do dia
  const [verVersoes, setVerVersoes] = useState(false);
  const [verViolacoes, setVerViolacoes] = useState(false);
  const [turnoMassa, setTurnoMassa] = useState('');
  const [padrao, setPadrao] = useState(null); // {regras: [{turno, dias: [7 x bool]}], sobrescrever}
  const [filtroEquipe, setFiltroEquipe] = useState('');
  const [filtroCargo, setFiltroCargo] = useState('');
  const [filtroSup, setFiltroSup] = useState('');
  const [busca, setBusca] = useState(() => tomarFocoPessoa('escala-mes')); // vindo do Painel do dia: já filtrado pela pessoa
  const [selecionados, setSelecionados] = useState({});
  const [programarPausas, setProgramarPausas] = useState(false); // ao salvar, programa as pausas dos dias alterados
  const [visao, setVisao] = useState(visaoInicial); // semana | mes
  const [semanaIdx, setSemanaIdx] = useState(null); // null = a semana de hoje (ou a 1ª do mês)

  const pode = (p) => controlador.possuiPermissao(p);
  const [todasEquipes, setTodasEquipes] = useVisaoEquipes(!somentePropria && controlador.estado?.perfilUsuario === 'supervisor');

  const carregar = useCallback(async () => {
    if (!operacao) return;
    setErro('');
    try {
      const d = await lerEscalaWfm(operacao, anoMes, false, todasEquipes);
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
  }, [operacao, anoMes, somentePropria, todasEquipes]);

  useEffect(() => { setDados(null); carregar(); }, [carregar]);
  useEffect(() => { setSemanaIdx(null); }, [anoMes]);
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

  const nomeOperacao = dados?.nome_escala || (contexto?.operacoes || []).find((o) => o.chave === operacao)?.nome || operacao;
  const voltar = aoVoltarLista ? html`<button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Voltar para Escalas" title="Voltar para Escalas" onClick=${aoVoltarLista}><${Ic} nome="arrow-left" /></button>` : null;
  if (erro) return html`<main class="c-pagina c-conteudo"><div class="c-cab-linha">${voltar}<h1>${nomeOperacao}</h1></div><div class="c-tabela-caixa"><${Estado} titulo=${erro} rotuloAcao="Tentar de novo" aoAcao=${carregar} /></div></main>`;
  if (!dados) return html`<main class="c-pagina c-conteudo" aria-busy="true"><div class="c-cab-linha">${voltar}<h1>${nomeOperacao}</h1></div><div class="c-tabela-caixa"><${Esqueleto} linhas=${10} /></div></main>`;

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

  // Operadores exibidos depois dos filtros (equipe, supervisor, cargo, nome).
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
  // Ao escolher o turno no padrão semanal, os dias da semana dele já vêm marcados (dá para ajustar à mão: dia fora do turno fica como ajuste manual).
  const diasDoTurnoSelecionado = (idTurno, atuais) => {
    const t = turnosPorId[Number(idTurno)];
    if (!t || t.tipo !== 'TRABALHO' || !Array.isArray(t.weekdays) || atuais.some(Boolean)) return atuais;
    return Array.from({ length: 7 }, (_, i) => t.weekdays.includes(i));
  };
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
    showToast?.(`Padrão aplicado a ${alvos.length} operador(es). Revise e clique em "Salvar".`, 'success');
    setPadrao(null);
  };
  const limparTabela = () => {
    const alvos = visiveis.filter((o) => dados.dias.some((d) => idTurnoDe(o.id_usuario, d) !== null));
    if (!alvos.length) { showToast?.('Não há turnos para limpar nos operadores exibidos.', 'info'); return; }
    if (!window.confirm(`Limpar a escala de ${alvos.length} operador(es) exibido(s) neste mês? Nada é apagado até você salvar.`)) return;
    alvos.forEach((o) => dados.dias.forEach((d) => { if (idTurnoDe(o.id_usuario, d) !== null) mudar(o.id_usuario, d, null); }));
  };
  const alternarSel = (id) => setSelecionados((s0) => ({ ...s0, [id]: !s0[id] }));

  const executar = async (fn, sucesso, acao = 'concluir a operação') => {
    setOcupado(true);
    try {
      const r = await fn();
      if (sucesso) showToast?.(typeof sucesso === 'function' ? sucesso(r) : sucesso, 'success');
      return r;
    } catch (e) {
      showToast?.(falhaAo(acao, e), 'error');
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
      'salvar a escala',
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
      'publicar a escala',
    );
    if (r) { setJustificativa(''); await carregar(); }
  };
  const fechar = async () => {
    if (!window.confirm('Fechar o período? Depois disso só o Gestor/RH pode corrigir, com justificativa.')) return;
    const r = await executar(() => fecharPeriodoWfm({ operacao, ano_mes: anoMes }), 'Período fechado.', 'fechar o período');
    if (r) await carregar();
  };

  const semItens = !dados.operadores.length;
  const bloqueio = validacao?.bloqueio;
  const duro = validacao?.bloqueio_duro;
  const podePublicarComViolacao = pode('wfm.escala.publicar_com_violacao');
  const publicarBloqueado = ocupado || totalPend > 0 || duro || (bloqueio && !podePublicarComViolacao)
    || ((bloqueio || exigeJustFechada) && !justificativa.trim())
    || (!fechada && dados.aprovacao?.estado !== 'APROVADA');

  // ---- apresentação: semana/mês, seleção, legenda e navegação da grade ----
  const selecionadosVis = visiveis.filter((o) => selecionados[o.id_usuario]);
  const hojeIso = paraIso(new Date());
  const semanas = semanasDoMes(dados.dias);
  const idxHoje = semanas.findIndex((s) => s.includes(hojeIso));
  const idx = Math.min(semanaIdx ?? (idxHoje >= 0 ? idxHoje : 0), semanas.length - 1);
  const diasMostrados = visao === 'semana' ? semanas[idx] : dados.dias;
  const operadoresEscalados = dados.operadores.filter((o) => dados.dias.some((d) => turnosPorId[idTurnoDe(o.id_usuario, d)]?.tipo === 'TRABALHO')).length;
  const turnosOrdenados = dados.turnos.filter((t) => t.tipo !== 'DSR' && t.ativo !== false && t.tipo !== 'FOLGA');
  const padraoDisponivel = editavel && dados.turnos.some((t) => t.ativo !== false && t.tipo !== 'FOLGA' && t.tipo !== 'DSR');
  const idsUsados = new Set();
  dados.operadores.forEach((o) => dados.dias.forEach((d) => { const id = idTurnoDe(o.id_usuario, d); if (id !== null && id !== undefined) idsUsados.add(id); }));
  const turnosDoMes = dados.turnos.filter((t) => idsUsados.has(t.id_turno) && t.tipo !== 'DSR');
  const alternarTodos = () => setSelecionados(selecionadosVis.length === visiveis.length ? {} : Object.fromEntries(visiveis.map((o) => [o.id_usuario, true])));
  const focoR = Math.min(foco.r, Math.max(visiveis.length - 1, 0));
  const abrirGaveta = (op, d) => setGaveta({ id: op.id_usuario, nome: op.nome, data: d });

  // Aplicar turno (barra de seleção): troca o turno dos dias de TRABALHO dos selecionados; DSR/folga ficam como estão. Fica pendente até salvar.
  const aplicarTurnoMassa = () => {
    if (turnoMassa === '') { showToast?.('Escolha o turno que será atribuído.', 'info'); return; }
    let dias = 0; let fora = 0;
    const alvo = turnosPorId[Number(turnoMassa)];
    selecionadosVis.forEach((op) => dados.dias.forEach((d) => {
      if (turnosPorId[idTurnoDe(op.id_usuario, d)]?.tipo !== 'TRABALHO') return;
      // O turno só vale nos dias da semana dele: nos outros dias o operador segue com o turno que já tinha.
      if (!diaDoTurno(alvo, d)) { fora += 1; return; }
      mudar(op.id_usuario, d, Number(turnoMassa));
      dias += 1;
    }));
    showToast?.(`Turno aplicado a ${selecionadosVis.length} operador(es) em ${dias} dia(s) de trabalho (DSR preservado)${fora ? `; ${fora} dia(s) fora dos dias do turno (${alvo?.dias_rotulo || ''}) ficaram como estavam` : ''}. Revise e clique em "Salvar".`, 'success');
  };
  // Setas movem o foco entre as células (tabindex móvel); Enter/Espaço abrem o ajuste pelo próprio botão.
  const aoTeclarGrade = (e) => {
    const alvo = e.target.closest?.('[data-r]');
    if (!alvo) return;
    let r = Number(alvo.dataset.r); let c = Number(alvo.dataset.c);
    if (e.key === 'ArrowRight') c += 1;
    else if (e.key === 'ArrowLeft') c -= 1;
    else if (e.key === 'ArrowDown') r += 1;
    else if (e.key === 'ArrowUp') r -= 1;
    else if (e.key === 'Home') c = 0;
    else if (e.key === 'End') c = diasMostrados.length - 1;
    else return;
    e.preventDefault();
    r = Math.max(0, Math.min(visiveis.length - 1, r)); c = Math.max(0, Math.min(diasMostrados.length - 1, c));
    e.currentTarget.querySelector(`[data-r="${r}"][data-c="${c}"]`)?.focus();
  };

  // ---- ajuste do dia: a célula escolhida aceita um turno (fica pendente até "Salvar") ----
  const celulaEl = (c) => document.querySelector(`[data-id="${c.id}"][data-d="${c.data}"]`);
  const cancelarAjuste = () => { const c = celSel; setCelSel(null); if (c) setTimeout(() => celulaEl(c)?.focus(), 0); };
  const escolherTurno = (idTurno) => { if (celSel) mudar(celSel.id, celSel.data, idTurno); };
  const turnoDaSel = celSel ? idTurnoDe(celSel.id, celSel.data) : null;

  const aprov = dados.aprovacao;
  const aprovada = !!(aprov?.exige && aprov.estado === 'APROVADA');
  const precisaJust = (bloqueio && podePublicarComViolacao) || exigeJustFechada || (totalPend > 0 && fechada);
  const abrirPadrao = () => setPadrao(padrao ? null : { regras: [{ turno: '', dias: Array(7).fill(false) }], sobrescrever: false });
  const [rotuloEstado, tomEstado, iconeEstado, proximoPasso] = estadoEscala(dados);
  const podePublicarAqui = pode('wfm.escala.publicar') && !somenteLeitura && !(aprovada && dados.status.versao_publicada > 0 && totalPend === 0);
  const extrasMenu = [
    !somentePropria && versoes.length ? { label: `Histórico de versões (${versoes.length})`, icon: 'clock-counter-clockwise', onClick: () => setVerVersoes(true) } : null,
    pode('wfm.escala.fechar') && !fechada && !somenteLeitura ? { label: 'Fechar período', icon: 'lock', disabled: ocupado || !dados.status.versao_publicada, onClick: fechar } : null,
    padraoDisponivel ? { label: 'Aplicar padrão semanal', icon: 'calendar-dots', onClick: abrirPadrao } : null,
  ];
  const menuAcoes = !somentePropria && pode('wfm.escala.visualizar')
    ? html`<${MenuCompartilharEscala} novo=${true} extras=${extrasMenu} operacao=${operacao} anoMes=${anoMes} dados=${dados} nomeOperacao=${nomeOperacao} showToast=${showToast} aoVerMes=${aoVoltarDia} rotuloVer="Escala do dia" aoConfigurar=${!somenteLeitura && pode('wfm.cadastros.visualizar') ? () => setConfigurando(true) : undefined} aoLimpar=${editavel && dados.operadores.length ? limparTabela : undefined} />`
    : null;

  const moverSemana = (n) => {
    const novo = idx + n;
    if (novo < 0) { if (aoMudarMes) { aoMudarMes(somarMes(anoMes, -1)); setSemanaIdx(99); } return; }
    if (novo >= semanas.length) { if (aoMudarMes) { aoMudarMes(somarMes(anoMes, 1)); setSemanaIdx(0); } return; }
    setSemanaIdx(novo);
  };
  const rotuloPeriodo = visao === 'semana'
    ? `${diasMostrados[0].slice(8)}/${diasMostrados[0].slice(5, 7)} a ${diasMostrados[diasMostrados.length - 1].slice(8)}/${diasMostrados[diasMostrados.length - 1].slice(5, 7)}`
    : `${doIso(dados.dias[0]).toLocaleDateString('pt-BR', { month: 'long' })} de ${anoMes.slice(0, 4)}`;

  // Célula da grade: botão (quem edita) ou texto. Pendente = contorno tracejado; violação = canto vermelho.
  const celula = (op, d, r, c) => {
    const chave = `${op.id_usuario}:${d}`;
    const pend = chave in pendentes;
    const viol = violacoesPorCelula[chave];
    const t = turnosPorId[idTurnoDe(op.id_usuario, d)];
    const dsr = !t || t.tipo === 'DSR';
    const evs = eventosPorDia[d] || [];
    const manual = !dsr && (pend ? !diaDoTurno(t, d) : !!itensPorChave[chave]?.manual);
    const rotulo = `${op.nome}, ${SEMANA_NOME[doIso(d).getDay()]} ${infoDia(d).dia}, ${dsr ? 'DSR' : t.nome}${manual ? ', configurado à mão fora dos dias do turno' : ''}${pend ? ', alteração não salva' : ''}${viol ? `, ${viol.length} violação(ões)` : ''}`;
    const sel = celSel?.id === op.id_usuario && celSel?.data === d;
    const conteudo = visao === 'semana'
      ? (dsr ? html`<span class="c-folga">DSR</span>` : html`<span class="c-bloco" style=${{ '--t': t.cor || 'var(--cor-acao-fundo)' }}><b>${t.entrada ? `${t.entrada}–${t.saida}` : t.nome}</b><small>${t.codigo}</small></span>`)
      : (dsr ? html`<span class="c-turno c-turno--dsr">DSR</span>` : html`<span class="c-turno c-turno--cor" style=${{ '--t': t.cor || 'var(--cor-acao-fundo)' }}>${t.codigo}</span>`);
    const classeTd = [visao === 'semana' ? 'c-dia-sem' : 'c-dia', d === hojeIso ? 'c-hoje' : '', evs.length ? 'c-feriado' : '', infoDia(d).fimDeSemana && visao === 'mes' ? 'c-fds' : '',
      pend ? 'c-cel-pendente' : '', viol ? 'c-cel-violacao' : '', manual ? 'c-cel-manual' : '', sel ? 'c-cel-sel' : ''].filter(Boolean).join(' ');
    return html`<td key=${d} class=${classeTd} title=${viol ? viol.map((v) => v.mensagem).join('\n') : (dsr ? (evs.map((e) => e.descricao).join(' · ') || undefined) : descreverTurno(t))}>
      ${editavel
        ? html`<button type="button" class="c-cel-botao" data-r=${r} data-c=${c} data-id=${op.id_usuario} data-d=${d} tabIndex=${r === focoR && c === Math.min(foco.c, diasMostrados.length - 1) ? 0 : -1} aria-label=${rotulo} aria-pressed=${sel ? 'true' : 'false'}
            onFocus=${() => setFoco({ r, c })} onClick=${() => { setCelSel({ id: op.id_usuario, nome: op.nome, data: d }); setTimeout(() => document.querySelector('[data-faixa-primeiro]')?.focus(), 0); }}>${conteudo}</button>`
        : html`<span title=${rotulo}>${conteudo}</span>`}
    </td>`;
  };

  const tabela = () => html`<table class=${`c-tabela c-tabela--fixa ${visao === 'semana' ? 'c-semana' : 'c-tabela--compacta c-grade-mes'} c-escala-grade`}
      role="grid" aria-label=${visao === 'semana' ? `Escala do mês · semana de ${rotuloPeriodo}` : 'Escala do mês'}
      onKeyDown=${(e) => { if (e.key === 'Escape' && celSel) { e.stopPropagation(); cancelarAjuste(); return; } if (editavel) aoTeclarGrade(e); }}>
    <thead><tr>
      <th scope="col" class="c-col-nome">${editavel ? html`<label class="c-marcar"><input type="checkbox" aria-label="Selecionar todos os operadores" checked=${visiveis.length > 0 && selecionadosVis.length === visiveis.length}
        ref=${(el) => { if (el) el.indeterminate = selecionadosVis.length > 0 && selecionadosVis.length < visiveis.length; }} onChange=${alternarTodos} /><span>Colaborador</span></label>` : 'Colaborador'}</th>
      ${visao === 'mes' ? html`<th scope="col" class="c-num">Horas</th>` : null}
      ${diasMostrados.map((d) => {
    const evs = eventosPorDia[d] || [];
    const sem = SEMANA_CURTA[doIso(d).getDay()];
    return visao === 'semana'
      ? html`<th key=${d} scope="col" class=${`c-dia-sem ${d === hojeIso ? 'c-hoje' : ''} ${evs.length ? 'c-feriado' : ''}`} title=${evs.map((e) => e.descricao).join(' · ') || undefined}>${sem} ${d.slice(8)}/${d.slice(5, 7)}</th>`
      : html`<th key=${d} scope="col" class=${`c-dia ${d === hojeIso ? 'c-hoje' : ''} ${evs.length ? 'c-feriado' : ''} ${infoDia(d).fimDeSemana ? 'c-fds' : ''}`} title=${evs.map((e) => e.descricao).join(' · ') || undefined}>${infoDia(d).dia}<small>${sem.slice(0, 1)}</small></th>`;
  })}
      ${visao === 'semana' ? html`<th scope="col" class="c-num c-total-ini" title="Horas de trabalho no mês (inclui o que ainda não foi salvo)">Horas no mês</th>` : null}
    </tr></thead>
    <tbody>${visiveis.map((op, r) => {
    const tot = totalDe(op.id_usuario);
    const horas = html`<td class=${`c-num ${visao === 'semana' ? 'c-total-ini' : ''}`} title=${`${tot.dias} dia(s) de trabalho`}>${horasMin(tot.min)}</td>`;
    return html`<tr key=${op.id_usuario} aria-selected=${selecionados[op.id_usuario] ? 'true' : null}>
        <td class="c-forte c-col-nome">${editavel ? html`<label class="c-marcar"><input type="checkbox" aria-label=${`Selecionar ${op.nome}`} checked=${!!selecionados[op.id_usuario]} onChange=${() => alternarSel(op.id_usuario)} /><span>${op.nome}</span></label>` : op.nome}</td>
        ${visao === 'mes' ? horas : null}
        ${diasMostrados.map((d, c) => celula(op, d, r, c))}
        ${visao === 'semana' ? horas : null}
      </tr>`;
  })}</tbody>
    <tfoot><tr>
      <td>Escalados no dia</td>
      ${visao === 'mes' ? html`<td></td>` : null}
      ${diasMostrados.map((d) => {
    const n = visiveis.filter((o) => turnosPorId[idTurnoDe(o.id_usuario, d)]?.tipo === 'TRABALHO').length;
    return html`<td key=${d} class=${visao === 'semana' ? 'c-dia-sem' : 'c-dia'}>${n}${visao === 'semana' ? html`<small> de ${visiveis.length}</small>` : null}</td>`;
  })}
      ${visao === 'semana' ? html`<td class="c-num c-total-ini">${horasMin(visiveis.reduce((s, o) => s + totalDe(o.id_usuario).min, 0))}</td>` : null}
    </tr></tfoot>
  </table>`;

  return html`
    <main class="c-pagina c-conteudo">
      <div class="c-cab-linha c-cab-escala">
        ${voltar}
        <h1 title=${nomeOperacao}>${nomeOperacao}</h1>
        ${opcoesEscala && opcoesEscala.length > 1 && aoTrocarEscala ? html`<select class="c-entrada c-entrada--compacta c-trocar-escala" aria-label="Trocar de escala" value=${operacao} onChange=${(e) => aoTrocarEscala(e.target.value)}>${opcoesEscala.map(([v, r]) => html`<option key=${v} value=${v}>${r}</option>`)}</select>` : null}
        <${Selo} tom=${tomEstado} icone=${iconeEstado} title="Caminho: Rascunho › Aprovação › Publicada › Fechada">${rotuloEstado}<//>
        ${proximoPasso ? html`<span class="c-ajuda">${proximoPasso}</span>` : null}
        <div class="c-cab-dir">
          ${acessorio}
          ${totalPend ? html`<span class="c-ajuda c-pendencias" role="status">${totalPend} alteração(ões) não salva(s)</span>` : null}
          ${menuAcoes}
          ${totalPend ? html`<button type="button" class="c-botao c-botao--texto" onClick=${() => setPendentes({})}>Descartar</button>` : null}
          ${editavel ? html`<button type="button" class="c-botao c-botao--secundario" aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || totalPend === 0 || (fechada && !justificativa.trim()) || null} onClick=${salvar}>Salvar${totalPend ? ` (${totalPend})` : ''}</button>` : null}
          ${!somentePropria ? html`<${AcoesAprovacao} operacao=${operacao} anoMes=${anoMes} aprovacao=${aprov} onMudou=${carregar} showToast=${showToast} desabilitado=${totalPend > 0} />` : null}
          ${podePublicarAqui ? html`<button type="button" class=${`c-botao ${aprov?.pode_enviar || aprov?.pode_aprovar ? 'c-botao--secundario' : 'c-botao--principal'}`} disabled=${publicarBloqueado || null}
            title=${totalPend ? 'Salve as alterações antes de publicar.' : (!fechada && dados.aprovacao?.estado !== 'APROVADA') ? 'A escala precisa ser aprovada pelo Gestor ou Supervisor antes de publicar.' : null} onClick=${publicar}><${Ic} nome="send" />Publicar nova versão</button>` : null}
        </div>
      </div>

      ${aprov?.declinada && aprov.motivo ? html`<${Faixa} tom="perigo" icone="x-circle"><b>Declinada por ${aprov.decidido_por || '—'}${aprov.decidido_em ? ` em ${dataHora(aprov.decidido_em)}` : ''}:</b> ${aprov.motivo}<//>` : null}
      ${aprov?.invalidada && !aprov?.declinada ? html`<${Faixa} tom="atencao" icone="warning">A escala foi alterada depois do envio/aprovação: envie novamente para aprovação.<//>` : null}
      ${aprov?.estado === 'EM_APROVACAO' ? html`<${Faixa} tom="informacao" icone="hourglass">Aguardando aprovação ${aprov.aprovadores_configurados ? 'dos aprovadores configurados' : 'do Gestor ou Supervisor'}. Enviada por ${aprov.enviado_por || '—'} em ${dataHora(aprov.enviado_em)}.<//>` : null}
      ${!somentePropria && validacao?.violacoes?.length ? html`<${Faixa} tom=${bloqueio ? 'perigo' : 'atencao'} icone="warning"
        acao=${html`<button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => setVerViolacoes(true)}>Ver violações</button>`}>
        <b>${validacao.violacoes.length} violação(ões) de jornada.</b> ${duro ? 'Bloqueio duro: corrija a escala para publicar.' : bloqueio ? (podePublicarComViolacao ? 'Você pode publicar com justificativa (fica registrada em auditoria).' : 'Não é possível publicar até corrigir.') : 'Confira antes de publicar.'}
      <//>` : null}
      ${precisaJust ? html`<div class="c-cartao c-cartao-corpo"><${Campo} rotulo=${`Justificativa${exigeJustFechada || bloqueio ? ' (obrigatória)' : ''}`}>
        <input class="c-entrada" maxlength="400" value=${justificativa} onInput=${(e) => setJustificativa(e.target.value)} placeholder=${exigeJustFechada ? 'Motivo da correção após o fechamento' : 'Motivo para publicar com violação pendente'} />
      <//></div>` : null}

      <div class="c-tabela-caixa">
        ${editavel && padraoDisponivel && selecionadosVis.length ? html`<div class="c-selecao">
          <span>${selecionadosVis.length} selecionado(s)</span>
          <select class="c-entrada c-entrada--compacta" aria-label="Turno a atribuir" value=${turnoMassa} onChange=${(e) => setTurnoMassa(e.target.value)}>
            <option value="">Atribuir turno…</option>${turnosOrdenados.map((t) => html`<option key=${t.id_turno} value=${t.id_turno}>${t.nome}${t.entrada ? ` ${t.entrada}–${t.saida}` : ''}</option>`)}</select>
          <button type="button" class="c-botao c-botao--principal c-botao--compacto" disabled=${turnoMassa === '' || null} onClick=${aplicarTurnoMassa}>Aplicar turno</button>
          <button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${abrirPadrao}>Aplicar padrão semanal</button>
          <button type="button" class="c-botao c-botao--texto c-botao--compacto c-fim" onClick=${() => setSelecionados({})}>Limpar seleção</button>
        </div>` : null}
        <div class="c-filtros c-filtros--suave">
          <${Segmento} rotulo="Visão" valor=${visao} aoMudar=${(v) => { if (v === 'dia') aoVoltarDia?.(); else if (v === 'pausas') aoPausas?.(); else setVisao(v); }}
            opcoes=${[['semana', 'Semana'], ['mes', 'Mês'], ...(aoVoltarDia ? [['dia', 'Do dia']] : []), ...(aoPausas && !somentePropria ? [['pausas', 'Pausas']] : [])]} />
          ${visao === 'semana'
            ? html`<${Navegar} grupo="Semana" rotulo=${rotuloPeriodo} rotuloAnterior="Semana anterior" rotuloProximo="Próxima semana" aoAnterior=${() => moverSemana(-1)} aoProximo=${() => moverSemana(1)} />`
            : html`<${Navegar} grupo="Mês" rotulo=${rotuloPeriodo} rotuloAnterior="Mês anterior" rotuloProximo="Próximo mês" aoAnterior=${() => aoMudarMes?.(somarMes(anoMes, -1))} aoProximo=${() => aoMudarMes?.(somarMes(anoMes, 1))} />`}
          <div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" /><input class="c-entrada c-entrada--compacta" type="search" placeholder="Buscar colaborador" aria-label="Buscar colaborador" value=${busca} onInput=${(e) => setBusca(e.target.value)} /></div>
          ${controlador.estado?.perfilUsuario === 'supervisor' && !somentePropria ? html`<select class="c-entrada c-entrada--compacta" aria-label="Equipes exibidas" value=${todasEquipes ? 'todas' : ''} onChange=${(e) => setTodasEquipes(e.target.value === 'todas')}><option value="">Minha equipe</option><option value="todas">Todas as equipes</option></select>` : null}
          ${equipes.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Equipe" value=${filtroEquipe} onChange=${(e) => setFiltroEquipe(e.target.value)}><option value="">Equipe: todas</option>${equipes.map(([id, nome]) => html`<option key=${id} value=${String(id)}>${nome}</option>`)}</select>` : null}
          ${supervisores.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Supervisor" value=${filtroSup} onChange=${(e) => setFiltroSup(e.target.value)}><option value="">Supervisor: todos</option>${supervisores.map(([id, nome]) => html`<option key=${id} value=${String(id)}>${nome}</option>`)}</select>` : null}
          ${cargos.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Cargo" value=${filtroCargo} onChange=${(e) => setFiltroCargo(e.target.value)}><option value="">Cargo: todos</option>${cargos.map((c) => html`<option key=${c} value=${c}>${c}</option>`)}</select>` : null}
          <span class="c-contador" aria-live="polite">${visiveis.length} de ${dados.operadores.length} · ${operadoresEscalados} escalado(s)${dados.todas_equipes ? ' · todas as equipes, somente leitura' : ''}</span>
        </div>

        ${semItens ? html`<${Estado} icone="users" titulo="Nenhum operador" texto="Não há operadores visíveis para você nesta operação." />`
          : !visiveis.length ? html`<${Estado} titulo="Nenhum colaborador com estes filtros." rotuloAcao="Limpar filtros" aoAcao=${() => { setBusca(''); setFiltroEquipe(''); setFiltroSup(''); setFiltroCargo(''); }} />`
          : tabela()}

        ${celSel ? html`<div class="c-ajuste-dia" role="status" aria-live="polite">
          <span class="c-forte">Dia ${Number(celSel.data.slice(8))} · ${celSel.nome}</span>
          <span class="c-sec">escolha o turno:</span>
          <span class="c-ajuste-turnos">
            ${turnosOrdenados.map((t, i) => html`<button key=${t.id_turno} type="button" class="c-botao c-botao--secundario c-botao--compacto" data-faixa-primeiro=${i === 0 ? '' : undefined} aria-pressed=${turnoDaSel === t.id_turno ? 'true' : 'false'} title=${descreverTurno(t)} onClick=${() => escolherTurno(t.id_turno)}>
              <span class="c-turno c-turno--cor" style=${{ '--t': t.cor || 'var(--cor-acao-fundo)' }}>${t.codigo}</span>${t.entrada ? `${t.entrada}–${t.saida}` : t.nome}</button>`)}
            <button type="button" class="c-botao c-botao--secundario c-botao--compacto" aria-pressed=${turnoDaSel === null || turnoDaSel === undefined ? 'true' : 'false'} title="Descanso semanal" data-faixa-primeiro=${turnosOrdenados.length ? undefined : ''} onClick=${() => escolherTurno(null)}><span class="c-turno c-turno--dsr">DSR</span></button>
          </span>
          <span class="c-fim c-grupo">
            <button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => { const c = celSel; setCelSel(null); abrirGaveta({ id_usuario: c.id, nome: c.nome }, c.data); }}>Mais opções</button>
            <button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${cancelarAjuste}>Fechar</button>
          </span>
        </div>` : null}

        ${!semItens ? html`<div class="c-legenda">
          ${turnosDoMes.map((t) => html`<span key=${t.id_turno} title=${descreverTurno(t)}><span class="c-traco" style=${{ '--t': t.cor || 'var(--cor-acao-fundo)' }}></span>${t.codigo} · ${t.nome}</span>`)}
          <span>DSR · descanso semanal</span>
          ${aprovada ? html`<span><${Ic} nome="check-circle" />Aprovada por ${aprov.decidido_por || '—'} em ${dataHora(aprov.decidido_em)}</span>` : null}
          <span class="c-legenda-fim">${editavel ? 'Clique numa célula para ajustar o dia · tracejado = não salvo' : 'Somente leitura'}</span>
        </div>` : null}
      </div>
    </main>

    ${verVersoes ? html`<${Janela} titulo=${`Histórico de versões (${versoes.length})`} tamanho="grande" onClose=${() => setVerVersoes(false)}>
      <div class="c-janela-corpo"><div class="c-tabela-caixa"><table class="c-tabela">
        <thead><tr><th scope="col">Versão</th><th scope="col">Aprovada por</th><th scope="col">Publicada por</th><th scope="col">Em</th><th scope="col">Violação</th><th scope="col" class="c-estica">Justificativa</th></tr></thead>
        <tbody>${versoes.map((v) => html`<tr key=${v.versao}><td class="c-forte">v${v.versao}</td><td>${v.aprovado_por || '—'}</td><td>${v.publicado_por || '—'}</td><td>${dataHora(v.publicado_em)}</td><td>${v.com_violacao ? html`<${Selo} tom="atencao">Sim<//>` : 'Não'}</td><td class="c-estica c-quebra c-secundario">${v.justificativa || '—'}</td></tr>`)}</tbody>
      </table></div></div>
    <//>` : null}

    ${verViolacoes && validacao?.violacoes?.length ? html`<${Janela} titulo=${`${validacao.violacoes.length} violação(ões) de jornada`} tamanho="grande" onClose=${() => setVerViolacoes(false)}>
      <div class="c-janela-corpo">
        ${duro ? html`<${Faixa} tom="perigo" icone="lock">Bloqueio duro: corrija a escala para publicar.<//>` : bloqueio ? html`<${Faixa} tom="atencao" icone="warning">${podePublicarComViolacao ? 'Você pode publicar com justificativa (fica registrada em auditoria).' : 'Não é possível publicar até corrigir. Somente o Gestor/RH publica com violação pendente.'}<//>` : null}
        <div class="c-tabela-caixa"><table class="c-tabela">
          <thead><tr><th scope="col">Colaborador</th><th scope="col">Dia</th><th scope="col" class="c-estica">Regra</th><th scope="col">Tipo</th></tr></thead>
          <tbody>${validacao.violacoes.slice(0, 40).map((v, i) => html`<tr key=${i}><td class="c-forte">${v.operador}</td><td>${v.data.split('-').reverse().join('/')}</td><td class="c-estica c-quebra">${v.mensagem}</td><td>${v.permite_override ? html`<${Selo} tom="atencao">Alerta<//>` : html`<${Selo} tom="perigo">Bloqueio duro<//>`}</td></tr>`)}</tbody>
        </table></div>
      </div>
    <//>` : null}

    ${padrao ? html`<${JanelaPadrao} padrao=${padrao} setPadrao=${setPadrao} turnos=${dados.turnos.filter((t) => t.ativo !== false)}
      alvoTexto=${selecionadosVis.length ? `${selecionadosVis.length} colaborador(es) selecionado(s)` : `todos os ${visiveis.length} colaborador(es) exibidos`}
      diasDoTurno=${diasDoTurnoSelecionado} programarPausas=${programarPausas} setProgramarPausas=${setProgramarPausas} aoAplicar=${aplicarPadrao} />` : null}
    ${somenteLeitura && !somentePropria ? html`<${OutrasEscalas} anoMes=${anoMes} operacao=${operacao} versao=${`${dados.aprovacao?.estado}:${dados.status?.versao_publicada}`} onEscolher=${(chave) => aoTrocarEscala?.(chave)} />` : null}
    ${gaveta && editavel ? html`<${GavetaAjusteDia} alvo=${gaveta} dados=${dados} operacao=${operacao} anoMes=${anoMes} fechada=${fechada} showToast=${showToast}
      bloqueio=${totalPend > 0 ? 'Há alterações não salvas na tela. Salve ou descarte antes de ajustar um dia.' : ''}
      aoFechar=${() => setGaveta(null)} aoSalvo=${(ok) => { if (ok) setGaveta(null); carregar(); }} />` : null}
    ${configurando ? html`<${ModalConfigEscala} operacao=${operacao} nomePadrao=${(contexto?.operacoes || []).find((o) => o.chave === operacao)?.nome || operacao} showToast=${showToast} onClose=${() => setConfigurando(false)} onSalvo=${() => { setConfigurando(false); carregar(); }} onMudouLista=${() => { setConfigurando(false); aoVoltarLista?.(); }} />` : null}`;
}
