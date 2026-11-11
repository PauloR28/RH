import { html, useCallback, useEffect, useState } from '../../../infraestrutura-react.js';
import {
  definirSkillsOperadorWfm,
  lerEscalaWfm,
  listarCalendarioWfm,
  listarContratosWfm,
  listarSkillsWfm,
  listarSupervisoresWfm,
  listarTiposEscalaWfm,
  listarTurnosWfm,
  listarPersonalizacoesTurnoWfm,
  removerPersonalizacaoTurnoWfm,
  salvarPersonalizacaoTurnoWfm,
  salvarEventoWfm,
  salvarSkillWfm,
  salvarTurnoWfm,
  excluirTurnoWfm,
  impactoDiasTurnoWfm,
  impactoTipoTurnoWfm,
  excluirEscalaWfm,
  salvarTipoEscalaWfm,
} from '../../../services/api/wfm.js?v=20261111-modulos-op';
import { ROTULO_TIPO_EVENTO, falhaAo, minutosParaHoras } from './comum.js?v=20261111-modulos-op';
import { semAcento } from './escala-ui.js?v=20261111-modulos-op';
import { TIPOS_PAUSA, TabelaJornadas } from './jornadas.js?v=20261111-modulos-op';
import { TabelaHistorico } from './historico.js?v=20261111-modulos-op';
import { Campo, Esqueleto, Estado, Ic, Janela, JanelaForm, MenuAcoes, Navegar, Segmento, Selo } from '../../../ui/components/ds.js?v=20261106-wfm';

// Cadastros do WFM (redesign Fase 15, amostra Q3 do lote 1): lista lateral em caixa branca (como Relatórios) —
// Escala › Turnos · Jornadas e limites · Calendário especial · Skills · Tipos de escala; Registro › Histórico de alterações.
// Cada item é UMA tabela com título e filtros na faixa de cima e "Novo …" à direita; clique na linha abre a janela de 560 px;
// ⋯ = Ver pessoas, Duplicar, Excluir (quando o item tem). Só o Calendário especial usa mês. Mesmas rotas e regras de antes.

const CATEGORIAS_SKILL = { IDIOMA: 'Idioma', PRODUTO: 'Produto', RETENCAO: 'Retenção', OUTRO: 'Outro' };
// Tipos de turno. Férias e Escalado não exigem horário nem jornada (Escalado = horário ainda por definir).
export const TIPOS_TURNO = { TRABALHO: 'Trabalho', FOLGA: 'Folga', DSR: 'DSR', FERIAS: 'Férias', ESCALADO: 'Escalado', SOBREAVISO: 'Sobreaviso' };
const TIPOS_SEM_HORARIO = ['FERIAS', 'ESCALADO'];
const AVISO_TIPO = { FERIAS: 'Férias não exigem horário nem jornada.', ESCALADO: 'Escalado não exige horário nem jornada: use quando o horário ainda não foi definido e depois mude o tipo para Trabalho.' };
export const TURNO_VAZIO = { codigo: '', nome: '', tipo: 'TRABALHO', cor: '#1f5fbf', entrada: '08:00', saida: '16:00', id_contrato: '', id_supervisor: '', pausas: [], weekdays: [0, 1, 2, 3, 4], especial: false, ativo: true };
const EVENTO_VAZIO = { tipo: 'FERIADO', data_ini: '', data_fim: '', descricao: '', id_turno: '', entrada: '', saida: '', gera_servico: false, servico: null };
const SERVICO_VAZIO = { id_turno: '', entrada: '', saida: '', ids_operadores: [] };
const TOM_EVENTO = { FERIADO: 'atencao', DATA_ESPECIAL: 'neutro', DIA_ESPECIAL: 'informacao', HORARIO_ESPECIAL: 'informacao' };

const paraMin = (hhmm) => { const [h, m] = (hhmm || '00:00').split(':').map(Number); return h * 60 + m; };
const horaDe = (min) => `${String(Math.floor((((min % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String((((min % 1440) + 1440) % 1440) % 60).padStart(2, '0')}`;
const offsetDe = (entrada, inicio) => (((paraMin(inicio) - paraMin(entrada)) % 1440) + 1440) % 1440;
const curta = (iso) => (iso ? iso.split('-').reverse().slice(0, 2).join('/') : '');
const somarMes = (anoMes, delta) => { const [a, m] = anoMes.split('-').map(Number); const d = new Date(a, m - 1 + delta, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const rotuloMes = (anoMes) => { const [a, m] = anoMes.split('-').map(Number); const nome = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' }); return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${a}`; };

// Turno atrelado a jornada: saída = entrada + jornada (+ intervalos não remunerados).
const saidaCalculada = (t, contratos) => {
  const c = contratos.find((x) => String(x.id_contrato) === String(t.id_contrato));
  if (!c || !t.entrada) return '';
  return horaDe(paraMin(t.entrada) + c.jornada_diaria_max_min + (t.pausas || []).filter((p) => p.tipo === 'INTERVALO').reduce((a, p) => a + Number(p.duracao_min || 0), 0));
};

const DIAS_CURTOS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const ATALHOS_DIAS = [['Todos os dias', [0, 1, 2, 3, 4, 5, 6]], ['Seg a Sex', [0, 1, 2, 3, 4]], ['Fim de semana', [5, 6]]];
const mesmosDias = (a, b) => a.length === b.length && a.every((d) => b.includes(d));

// Dias da semana do turno: sete caixinhas, atalhos e resumo (estado nunca só por cor).
function BlocoDiasSemana({ dias, aoMudar, obrigatorio }) {
  const alternar = (i) => aoMudar((atual) => (atual.includes(i) ? atual.filter((d) => d !== i) : [...atual, i].sort()));
  const vazio = dias.length === 0;
  return html`<fieldset class="c-padrao-dias c-cheio" aria-label="Dias da semana do turno">
    <legend class="c-rotulo">Dias da semana · em que este turno vale</legend>
    ${DIAS_CURTOS.map((nome, i) => html`<label key=${nome} class="c-marcar"><input type="checkbox" checked=${dias.includes(i)} onChange=${() => alternar(i)} /><span>${nome}</span></label>`)}
    <span class="c-grupo">${ATALHOS_DIAS.map(([rotulo, valor]) => html`<button key=${rotulo} type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => aoMudar(valor)}>${rotulo}</button>`)}</span>
    ${vazio && obrigatorio ? html`<span class="c-erro" role="alert"><${Ic} nome="warning" />Escolha pelo menos um dia.</span>` : null}
  </fieldset>`;
}

// Janela "Novo turno / Editar turno" (560 px). Mesmas validações e confirmações de impacto de antes.
export function ModalTurno({ operacao, inicial, contratos, supervisores = [], onClose, onSalvo, showToast }) {
  const [edit, setEdit] = useState(inicial);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [impacto, setImpacto] = useState(null);   // números mostrados antes de confirmar a mudança de dias de um turno em uso
  const [impactoTipo, setImpactoTipo] = useState(null);   // idem para a mudança de TIPO de um turno em uso (afeta toda a escala)
  const set = (k, v) => setEdit((e) => ({ ...e, [k]: v }));
  const mudarTipo = (tipo) => {
    setImpactoTipo(null); setImpacto(null); setErro('');
    setEdit((e) => ({ ...e, tipo, ...(tipo === 'TRABALHO' && !e.entrada ? { entrada: '08:00', saida: '16:00' } : {}) }));
  };
  const setPausa = (i, k, v) => setEdit((e) => ({ ...e, pausas: e.pausas.map((p, j) => (j === i ? { ...p, [k]: ['tipo', 'inicio'].includes(k) ? v : Number(v) } : p)) }));
  const trabalho = edit.tipo === 'TRABALHO';
  const semHorario = TIPOS_SEM_HORARIO.includes(edit.tipo);
  const mudouTipo = !!edit.id_turno && edit.tipo !== inicial.tipo;
  const comJornada = !!edit.id_contrato;
  const saida = comJornada ? saidaCalculada(edit, contratos) : edit.saida;
  const dias = edit.weekdays || [];
  const especial = trabalho && !!edit.especial; // Escala Especial vale em qualquer dia: não escolhe dias da semana
  const semDias = trabalho && !especial && dias.length === 0;
  const supervisor = supervisores.find((s) => String(s.id_usuario) === String(edit.id_supervisor)) || {};

  const gravar = async () => {
    setSalvando(true);
    try {
      const pausas = (edit.pausas || []).map((p) => ({ offset_min: offsetDe(edit.entrada, p.inicio), duracao_min: Math.max(Number(p.duracao_min) || 1, 1), tipo: p.tipo }));
      await salvarTurnoWfm({ ...edit, pausas, operacao, saida: trabalho ? saida : '', entrada: trabalho ? edit.entrada : '', confirmar_mudanca_tipo: mudouTipo, weekdays: especial ? [0, 1, 2, 3, 4, 5, 6] : dias, especial, id_contrato: comJornada ? Number(edit.id_contrato) : null, id_supervisor: edit.id_supervisor ? Number(edit.id_supervisor) : null }, edit.id_turno);
      showToast?.('Turno salvo.', 'success');
      onSalvo();
    } catch (err) { setErro(falhaAo('salvar o turno', err)); } finally { setSalvando(false); }
  };

  // Excluir o turno direto da edição (Folga e DSR são fixos). Turno em uso de hoje em diante é recusado pelo servidor, com o motivo.
  const podeExcluir = !!edit.id_turno && ['TRABALHO', 'SOBREAVISO', 'FERIAS', 'ESCALADO'].includes(edit.tipo);
  const excluir = async () => {
    if (!window.confirm(`Excluir o turno ${edit.codigo} (${edit.nome})? Se ele já foi usado só em datas passadas, o histórico é preservado.`)) return;
    setExcluindo(true); setErro('');
    try { await excluirTurnoWfm(operacao, edit.id_turno); showToast?.('Turno excluído.', 'success'); onSalvo(); }
    catch (err) { setErro(falhaAo('excluir o turno', err)); } finally { setExcluindo(false); }
  };

  const salvar = async (ev) => {
    ev.preventDefault();
    if (!edit.nome.trim()) return setErro('Informe o nome do turno.');
    if (trabalho && (!edit.entrada || !saida)) return setErro('Informe o horário de entrada e de saída.');
    if (trabalho && edit.entrada === saida) return setErro('Entrada e saída não podem ser iguais.');
    if (semDias) return setErro('Escolha pelo menos um dia da semana.');
    setErro('');
    if (mudouTipo && !impactoTipo) {
      // Mudar o tipo de um turno em uso muda a escala de todos os colaboradores nele: mostra o impacto e só salva depois da confirmação.
      setSalvando(true);
      try {
        const r = await impactoTipoTurnoWfm(edit.id_turno, { operacao, tipo: edit.tipo });
        if (r.em_uso) { setImpactoTipo(r); setSalvando(false); return undefined; }
      } catch (err) { setErro(err?.message || 'Não foi possível calcular o impacto da mudança de tipo.'); setSalvando(false); return undefined; }
      setSalvando(false);
    }
    if (edit.id_turno && trabalho && !mudouTipo && !especial && !inicial.especial && !impacto && !mesmosDias(dias, inicial.weekdays || [])) {
      setSalvando(true);
      try {
        const r = await impactoDiasTurnoWfm(edit.id_turno, { operacao, weekdays: dias });
        if (r.dias_fora > 0) { setImpacto(r); setSalvando(false); return undefined; }
      } catch (err) { setErro(err?.message || 'Não foi possível calcular o impacto da mudança de dias.'); setSalvando(false); return undefined; }
      setSalvando(false);
    }
    return gravar();
  };

  const titulo = edit.id_turno ? `Editar turno ${edit.codigo}` : 'Novo turno';
  return html`<${Janela} titulo=${titulo} onClose=${onClose}>
    <form class="c-janela-form" noValidate onSubmit=${salvar}>
      <div class="c-janela-corpo">
        <div class="c-form" style=${{ '--colunas': 2 }}>
          <${Campo} rotulo="Nome"><input class="c-entrada" maxlength="120" value=${edit.nome} onInput=${(e) => set('nome', e.target.value)} /><//>
          <${Campo} rotulo="Código" ajuda=${edit.id_turno ? '' : 'Gerado a partir do nome'}><input class="c-entrada" maxlength="20" disabled value=${edit.codigo} placeholder="Automático" /><//>
          <${Campo} rotulo="Tipo"><select class="c-entrada" value=${edit.tipo} onChange=${(e) => mudarTipo(e.target.value)}>${['TRABALHO', 'FOLGA', 'DSR', 'FERIAS', 'ESCALADO', ...(inicial.tipo === 'SOBREAVISO' ? ['SOBREAVISO'] : [])].map((t) => html`<option key=${t} value=${t}>${TIPOS_TURNO[t]}</option>`)}</select><//>
          <${Campo} rotulo="Cor"><input class="c-entrada" type="color" value=${edit.cor} onInput=${(e) => set('cor', e.target.value)} /><//>
          ${trabalho ? html`
            <${Campo} rotulo="Entrada" ajuda="Se a saída for menor, atravessa a meia-noite"><input class="c-entrada" type="time" value=${edit.entrada} onInput=${(e) => set('entrada', e.target.value)} /><//>
            <${Campo} rotulo="Saída" ajuda=${comJornada ? 'Calculada: entrada + jornada' : ''}><input class="c-entrada" type="time" disabled=${comJornada} value=${saida} onInput=${(e) => set('saida', e.target.value)} /><//>
            <${Campo} rotulo="Jornada (opcional)"><select class="c-entrada" value=${edit.id_contrato || ''} onChange=${(e) => set('id_contrato', e.target.value)}>
              <option value="">Sem jornada</option>${contratos.filter((c) => c.ativo).map((c) => html`<option key=${c.id_contrato} value=${c.id_contrato}>${c.codigo} · ${minutosParaHoras(c.jornada_diaria_max_min)}</option>`)}</select><//>
            <${Campo} rotulo="Supervisor (opcional)" ajuda=${supervisor.equipe ? `Equipe ${supervisor.equipe}` : 'A equipe vem do supervisor'}><select class="c-entrada" value=${edit.id_supervisor || ''} onChange=${(e) => set('id_supervisor', e.target.value)}><option value="">Nenhum</option>${supervisores.map((s) => html`<option key=${s.id_usuario} value=${s.id_usuario}>${s.nome}</option>`)}</select><//>` : null}
          <label class="c-interruptor"><input type="checkbox" role="switch" checked=${!!edit.ativo} onChange=${(e) => set('ativo', e.target.checked)} />Turno ativo</label>
          ${trabalho ? html`<label class="c-interruptor" title="Para dias fora da escala tradicional; vale em qualquer dia e não conta no limite de escalas por pessoa"><input type="checkbox" role="switch" checked=${!!edit.especial} onChange=${(e) => { setImpacto(null); set('especial', e.target.checked); }} />Escala Especial</label>` : null}
          ${especial
            ? html`<p class="c-ajuda c-cheio">Escala Especial: vale em qualquer dia da semana e não conta no limite de escalas por pessoa.</p>`
            : semHorario ? html`<p class="c-ajuda c-cheio" role="note">${AVISO_TIPO[edit.tipo]}</p>`
            : html`<${BlocoDiasSemana} dias=${dias} aoMudar=${(v) => { setImpacto(null); setEdit((e) => ({ ...e, weekdays: typeof v === 'function' ? v(e.weekdays || []) : v })); }} obrigatorio=${trabalho} />`}
        </div>

        ${trabalho ? html`<div class="c-tabela-caixa">
          <div class="c-filtros"><h3 class="c-cad-titulo">Pausas do turno</h3>
            <button type="button" class="c-botao c-botao--texto c-botao--compacto c-cad-novo" style=${{ marginLeft: 'auto' }} onClick=${() => setEdit({ ...edit, pausas: [...edit.pausas, { inicio: edit.entrada ? horaDe(paraMin(edit.entrada) + 90) : '09:00', duracao_min: 10, tipo: 'DESCANSO' }] })}><${Ic} nome="plus" />Pausa</button></div>
          ${edit.pausas.length ? html`<table class="c-tabela c-tabela--compacta"><thead><tr><th scope="col">Tipo</th><th scope="col">Início</th><th scope="col">Duração (min)</th><th scope="col" class="c-acoes"><span class="c-oculto">Remover</span></th></tr></thead><tbody>
            ${edit.pausas.map((p, i) => html`<tr key=${i}>
              <td><select class="c-entrada c-entrada--compacta" aria-label="Tipo da pausa" value=${p.tipo} onChange=${(e) => setPausa(i, 'tipo', e.target.value)}>${Object.entries(TIPOS_PAUSA).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></td>
              <td><input class="c-entrada c-entrada--compacta" aria-label="Início da pausa" type="time" value=${p.inicio} onInput=${(e) => setPausa(i, 'inicio', e.target.value)} /></td>
              <td><input class="c-entrada c-entrada--compacta c-entrada--numero" aria-label="Duração da pausa (min)" type="number" min="1" value=${p.duracao_min} onInput=${(e) => setPausa(i, 'duracao_min', e.target.value)} /></td>
              <td class="c-acoes"><button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Remover pausa" title="Remover pausa" onClick=${() => setEdit({ ...edit, pausas: edit.pausas.filter((_, j) => j !== i) })}><${Ic} nome="trash" /></button></td>
            </tr>`)}</tbody></table>` : html`<p class="c-ajuda" style=${{ padding: 'var(--espaco-2) var(--espaco-3)', margin: 0 }}>Nenhuma pausa neste turno.</p>`}
        </div>` : null}

        ${impactoTipo ? html`<div class="c-faixa c-faixa--atencao" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p><b>Esta mudança afeta toda a escala que usa o turno ${edit.codigo}.</b>
          ${` O tipo muda de ${TIPOS_TURNO[impactoTipo.tipo_atual] || impactoTipo.tipo_atual} para ${TIPOS_TURNO[impactoTipo.tipo_novo] || impactoTipo.tipo_novo} para ${impactoTipo.operadores} colaborador(es): ${impactoTipo.dias_futuros} dia(s) de hoje em diante e ${impactoTipo.dias_passados} dia(s) já passados${impactoTipo.eventos_calendario ? `, além de ${impactoTipo.eventos_calendario} item(ns) do calendário especial` : ''}.${impactoTipo.trocas_em_andamento ? ` ${impactoTipo.trocas_em_andamento} pedido(s) de troca em andamento serão invalidados.` : ''}`}
          ${impactoTipo.aviso ? ` ${impactoTipo.aviso}` : ''}</p></div></div>` : null}
        ${impacto ? html`<div class="c-faixa c-faixa--atencao" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p><b>Esta mudança afeta escalas já lançadas.</b>
          ${` ${impacto.operadores} operador(es) e ${impacto.dias_fora} dia(s) de hoje em diante ficam fora dos novos dias e passam a contar como configurados à mão. Pausas nesses dias: ${impacto.pausas_automaticas} automática(s) e ${impacto.pausas_manuais} manual(is).`}
          ${impacto.aviso ? ` ${impacto.aviso}` : ''}</p></div></div>` : null}
        ${erro ? html`<div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${erro}</p></div></div>` : null}
      </div>
      <div class="c-janela-rodape">
        ${podeExcluir ? html`<button type="button" class="c-botao c-botao--texto c-tom-perigo" style=${{ marginRight: 'auto' }} disabled=${excluindo || !!salvando || null} onClick=${excluir}>${excluindo ? 'Excluindo…' : 'Excluir turno'}</button>` : null}
        <button type="button" class="c-botao c-botao--secundario" onClick=${onClose}>Cancelar</button>
        <button type="submit" class="c-botao c-botao--principal" aria-busy=${salvando ? 'true' : null} disabled=${!!salvando || semDias || null}>${salvando ? 'Salvando…' : impacto || impactoTipo ? 'Confirmar e salvar turno' : 'Salvar turno'}</button>
      </div>
    </form>
  <//>`;
}

// Turno vindo da API -> estado do formulário (pausas com horário de início real).
export const turnoParaEdicao = (t) => ({
  ...t,
  entrada: t.entrada || '',
  saida: t.saida || '',
  id_contrato: t.id_contrato || '',
  id_supervisor: t.id_supervisor || '',
  weekdays: Array.isArray(t.weekdays) ? t.weekdays : [0, 1, 2, 3, 4, 5, 6],
  pausas: (t.pausas || []).map((p) => ({ inicio: t.entrada ? horaDe(paraMin(t.entrada) + p.offset_min) : '00:00', duracao_min: p.duracao_min, tipo: p.tipo })),
});

// Personalização: horário próprio de um colaborador dentro de um turno. O turno e quem já está nele não mudam.
function ModalPersonalizarTurno({ operacao, turno, operadores, onClose, onMudou, showToast }) {
  const [lista, setLista] = useState(null);
  const [form, setForm] = useState({ id_operador: '', entrada: turno.entrada || '', saida: turno.saida || '', aplicar_lancados: true });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const carregar = useCallback(async () => {
    try { setLista((await listarPersonalizacoesTurnoWfm(operacao, turno.id_turno)).itens); } catch (e) { setErro(e?.message || 'Não foi possível carregar as personalizações.'); }
  }, [operacao, turno.id_turno]);
  useEffect(() => { carregar(); }, [carregar]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const salvar = async (ev) => {
    ev.preventDefault();
    if (!form.id_operador) return setErro('Escolha o colaborador.');
    if (!form.entrada || !form.saida) return setErro('Informe entrada e saída.');
    setErro(''); setSalvando(true);
    try {
      const r = await salvarPersonalizacaoTurnoWfm(turno.id_turno, Number(form.id_operador), { operacao, entrada: form.entrada, saida: form.saida, aplicar_lancados: form.aplicar_lancados });
      showToast?.(r?.dias_ajustados ? `Horário personalizado. ${r.dias_ajustados} dia(s) já lançado(s) ajustado(s).` : 'Horário personalizado salvo.', 'success');
      setForm((f) => ({ ...f, id_operador: '' }));
      await carregar(); onMudou();
    } catch (e) { setErro(e?.message || 'Não foi possível salvar.'); } finally { setSalvando(false); }
  };
  const remover = async (p) => {
    if (!window.confirm(`Voltar ${p.operador} ao horário padrão do turno ${turno.codigo}? Os dias futuros já lançados também voltam ao padrão.`)) return;
    try { await removerPersonalizacaoTurnoWfm(operacao, turno.id_turno, p.id_operador, true); showToast?.('Personalização removida.', 'success'); await carregar(); onMudou(); }
    catch (e) { setErro(e?.message || 'Não foi possível remover.'); }
  };
  const livres = operadores.filter((o) => !(lista || []).some((p) => p.id_operador === o.id_usuario) || String(o.id_usuario) === form.id_operador);
  return html`<${JanelaForm} titulo=${`Pessoas com horário próprio · ${turno.codigo}`} onClose=${onClose} onSubmit=${salvar} erro=${erro} salvando=${salvando} salvarRotulo="Salvar horário">
    <p class="c-ajuda">Horário padrão do turno: <b>${turno.entrada}–${turno.saida}</b>. Só a pessoa escolhida abaixo passa a ter horário próprio.</p>
    <div class="c-form" style=${{ '--colunas': 3 }}>
      <${Campo} rotulo="Colaborador" cheio=${true}><select class="c-entrada" value=${form.id_operador} onChange=${(e) => set('id_operador', e.target.value)}><option value="">Escolher colaborador</option>${livres.map((o) => html`<option key=${o.id_usuario} value=${o.id_usuario}>${o.nome}</option>`)}</select><//>
      <${Campo} rotulo="Entrada"><input class="c-entrada" type="time" value=${form.entrada} onInput=${(e) => set('entrada', e.target.value)} /><//>
      <${Campo} rotulo="Saída"><input class="c-entrada" type="time" value=${form.saida} onInput=${(e) => set('saida', e.target.value)} /><//>
    </div>
    <label class="c-marcar"><input type="checkbox" checked=${form.aplicar_lancados} onChange=${(e) => set('aplicar_lancados', e.target.checked)} /><span>Ajustar também os dias já lançados de hoje em diante</span></label>
    <div class="c-tabela-caixa">${lista === null ? html`<${Esqueleto} linhas=${2} />` : lista.length ? html`<table class="c-tabela c-tabela--compacta"><thead><tr><th scope="col" class="c-estica">Colaborador</th><th scope="col">Horário</th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead><tbody>
      ${lista.map((p) => html`<tr key=${p.id_operador}><td class="c-estica">${p.operador}</td><td class="c-num-esq">${p.entrada}–${p.saida}</td><td class="c-acoes"><${MenuAcoes} rotulo=${`Ações para ${p.operador}`} acoes=${[
        { label: 'Editar', icon: 'pencil-simple', onClick: () => setForm((f) => ({ ...f, id_operador: String(p.id_operador), entrada: p.entrada, saida: p.saida })) },
        { label: 'Voltar ao padrão', icon: 'trash', perigo: true, onClick: () => remover(p) },
      ]} /></td></tr>`)}
    </tbody></table>` : html`<${Estado} titulo="Ninguém com horário próprio neste turno." />`}</div>
  <//>`;
}

function ModalEvento({ operacao, inicial, turnos, operadores = [], onClose, onSalvo, showToast }) {
  const [form, setForm] = useState({ ...inicial, servico: { ...SERVICO_VAZIO, ...(inicial.servico || {}), id_turno: inicial.servico?.id_turno ? String(inicial.servico.id_turno) : '', entrada: inicial.servico?.entrada || '', saida: inicial.servico?.saida || '' } });
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const trabalho = turnos.filter((t) => t.tipo === 'TRABALHO' && t.ativo);
  const usaTurno = ['DIA_ESPECIAL', 'HORARIO_ESPECIAL'].includes(form.tipo);
  const feriado = form.tipo === 'FERIADO';
  const servico = form.servico;
  const setServico = (k, v) => setForm((f) => ({ ...f, servico: { ...f.servico, [k]: v } }));
  const marcados = new Set(servico.ids_operadores);
  const filtrados = operadores.filter((o) => !busca.trim() || semAcento(o.nome).includes(semAcento(busca.trim())));
  const alternarOp = (id) => setServico('ids_operadores', marcados.has(id) ? servico.ids_operadores.filter((x) => x !== id) : [...servico.ids_operadores, id]);
  const todosFiltrados = filtrados.length > 0 && filtrados.every((o) => marcados.has(o.id_usuario));
  const alternarTodos = () => setServico('ids_operadores', todosFiltrados
    ? servico.ids_operadores.filter((id) => !filtrados.some((o) => o.id_usuario === id))
    : [...new Set([...servico.ids_operadores, ...filtrados.map((o) => o.id_usuario)])]);
  const salvar = async (ev) => {
    ev.preventDefault();
    if (!form.data_ini || !form.data_fim || !form.descricao.trim()) return setErro('Informe as datas e a descrição.');
    if (usaTurno && !form.id_turno) return setErro('Selecione o turno.');
    if (form.tipo === 'HORARIO_ESPECIAL' && (!form.entrada || !form.saida)) return setErro('Informe a nova entrada e saída.');
    if (feriado && form.gera_servico) {
      if (!servico.ids_operadores.length) return setErro('Feriado com serviço: marque quem vai trabalhar.');
      if (!servico.id_turno) return setErro('Feriado com serviço: escolha o turno de quem vai trabalhar.');
      if (!!servico.entrada !== !!servico.saida) return setErro('Informe a entrada e a saída do serviço, ou deixe as duas em branco para usar o horário do turno.');
    }
    setErro('');
    setSalvando(true);
    try {
      const corpo = { ...form, operacao, id_turno: form.id_turno ? Number(form.id_turno) : null };
      if (feriado && form.gera_servico) corpo.servico = { ...servico, id_turno: Number(servico.id_turno) };
      else { corpo.gera_servico = false; corpo.servico = null; }
      const r = await salvarEventoWfm(corpo, form.id_item);
      const ap = r?.aplicacao;
      showToast?.(ap?.aplicados ? `Feriado salvo e aplicado na escala (${ap.aplicados} lançamento(s)).` : 'Item do calendário salvo.', 'success');
      (ap?.avisos || []).forEach((aviso) => showToast?.(aviso, 'warning'));
      onSalvo();
    } catch (err) { setErro(falhaAo('salvar o item do calendário', err)); } finally { setSalvando(false); }
  };
  return html`<${JanelaForm} titulo=${form.id_item ? 'Editar item do calendário' : 'Novo item do calendário'} onClose=${onClose} onSubmit=${salvar} erro=${erro} salvando=${salvando}>
    <div class="c-form" style=${{ '--colunas': 3 }}>
      <${Campo} rotulo="Tipo"><select class="c-entrada" value=${form.tipo} onChange=${(e) => set('tipo', e.target.value)}>${Object.entries(ROTULO_TIPO_EVENTO).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
      <${Campo} rotulo="De"><input class="c-entrada" type="date" value=${form.data_ini} onInput=${(e) => setForm({ ...form, data_ini: e.target.value, data_fim: form.data_fim || e.target.value })} /><//>
      <${Campo} rotulo="Até"><input class="c-entrada" type="date" value=${form.data_fim} onInput=${(e) => set('data_fim', e.target.value)} /><//>
      <${Campo} rotulo="Descrição" cheio=${true}><input class="c-entrada" maxlength="200" value=${form.descricao} onInput=${(e) => set('descricao', e.target.value)} /><//>
      ${usaTurno ? html`<${Campo} rotulo="Turno"><select class="c-entrada" value=${form.id_turno} onChange=${(e) => set('id_turno', e.target.value)}><option value="">Selecione</option>${trabalho.map((t) => html`<option key=${t.id_turno} value=${t.id_turno}>${t.codigo} · ${t.nome}</option>`)}</select><//>` : null}
      ${form.tipo === 'HORARIO_ESPECIAL' ? html`<${Campo} rotulo="Nova entrada"><input class="c-entrada" type="time" value=${form.entrada} onInput=${(e) => set('entrada', e.target.value)} /><//><${Campo} rotulo="Nova saída"><input class="c-entrada" type="time" value=${form.saida} onInput=${(e) => set('saida', e.target.value)} /><//>` : null}
    </div>
    ${feriado ? html`<fieldset class="c-padrao-dias" style=${{ flexDirection: 'column', alignItems: 'stretch' }}>
      <legend class="c-rotulo">Neste feriado, a escala…</legend>
      <label class="c-marcar"><input type="radio" name="gera-servico" checked=${!form.gera_servico} onChange=${() => setForm({ ...form, gera_servico: false })} /><span>Não gera serviço — todos ficam de Folga</span></label>
      <label class="c-marcar"><input type="radio" name="gera-servico" checked=${!!form.gera_servico} onChange=${() => setForm({ ...form, gera_servico: true })} /><span>Gera serviço — escolho quem trabalha e o horário (os demais ficam de Folga)</span></label>
    </fieldset>` : null}
    ${feriado && form.gera_servico ? html`
      <div class="c-form" style=${{ '--colunas': 3 }}>
        <${Campo} rotulo="Turno de quem trabalha"><select class="c-entrada" value=${servico.id_turno} onChange=${(e) => setServico('id_turno', e.target.value)}><option value="">Selecione</option>${trabalho.map((t) => html`<option key=${t.id_turno} value=${t.id_turno}>${t.codigo} · ${t.nome}${t.entrada ? ` (${t.entrada}–${t.saida})` : ''}</option>`)}</select><//>
        <${Campo} rotulo="Entrada" opcional=${true} ajuda="Em branco = horário do turno"><input class="c-entrada" type="time" value=${servico.entrada} onInput=${(e) => setServico('entrada', e.target.value)} /><//>
        <${Campo} rotulo="Saída" opcional=${true}><input class="c-entrada" type="time" value=${servico.saida} onInput=${(e) => setServico('saida', e.target.value)} /><//>
      </div>
      <div class="c-grupo" role="group" aria-label="Quem vai trabalhar">
        <div class="c-com-icone c-com-icone--compacta"><${Ic} nome="magnifying-glass" /><input class="c-entrada c-entrada--compacta" type="search" aria-label="Buscar colaborador" placeholder="Buscar colaborador" value=${busca} onInput=${(e) => setBusca(e.target.value)} /></div>
        <label class="c-marcar"><input type="checkbox" checked=${todosFiltrados} onChange=${alternarTodos} /><span>Marcar todos</span></label>
        <span class="c-ajuda">${servico.ids_operadores.length} de ${operadores.length} vão trabalhar</span>
      </div>
      <div class="c-lote-lista">${filtrados.length ? filtrados.map((o) => html`<label key=${o.id_usuario} class="c-marcar"><input type="checkbox" checked=${marcados.has(o.id_usuario)} onChange=${() => alternarOp(o.id_usuario)} /><span>${o.nome}</span></label>`) : html`<span class="c-ajuda">Nenhum colaborador encontrado.</span>`}</div>` : null}
    ${feriado ? html`<p class="c-ajuda">É aplicado na escala ao salvar. Se a escala já estava aprovada, ela volta a rascunho e precisa ser aprovada de novo.</p>` : null}
  <//>`;
}

// Faixa de cima de cada tabela: título, filtros e "Novo …" à direita.
function FaixaItem({ titulo, children, novo = null, contagem = '' }) {
  return html`<div class="c-filtros c-filtros--suave c-cad-faixa">
    <h2 class="c-cad-titulo">${titulo}</h2>
    ${children}
    ${contagem ? html`<span class="c-contador">${contagem}</span>` : null}
    ${novo ? html`<button type="button" class="c-botao c-botao--principal c-botao--compacto c-cad-novo" style=${contagem ? { marginLeft: 0 } : null} onClick=${novo.onClick}><${Ic} nome="plus" />${novo.rotulo}</button>` : null}
  </div>`;
}

function Busca({ valor, aoMudar, rotulo }) {
  return html`<div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" /><input class="c-entrada c-entrada--compacta" type="search" placeholder=${rotulo} aria-label=${rotulo} value=${valor} onInput=${(e) => aoMudar(e.target.value)} /></div>`;
}

function Turnos({ operacao, turnos, contratos, supervisores, operadores = [], podeEditar, recarregar, showToast }) {
  const [edit, setEdit] = useState(null);
  const [personalizar, setPersonalizar] = useState(null);
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('');
  const [situacao, setSituacao] = useState('');
  const excluir = async (t) => {
    if (!window.confirm(`Excluir o turno ${t.codigo} (${t.nome})? Só é possível se ele nunca foi usado em uma escala.`)) return;
    try { await excluirTurnoWfm(operacao, t.id_turno); showToast?.('Turno excluído.', 'success'); recarregar(); }
    catch (err) { showToast?.(falhaAo('excluir o turno', err), 'error'); }
  };
  // Duplicar abre a janela de Novo turno já preenchida (nome com "(cópia)"); só grava ao salvar.
  const duplicar = (t) => { const e = turnoParaEdicao(t); delete e.id_turno; setEdit({ ...e, codigo: '', nome: `${t.nome} (cópia)` }); };
  const visiveis = turnos.filter((t) => (!busca || semAcento(`${t.codigo} ${t.nome}`).includes(semAcento(busca)))
    && (!tipo || t.tipo === tipo) && (!situacao || (situacao === 'ativo' ? t.ativo : !t.ativo)));
  const tipos = [...new Set(turnos.map((t) => t.tipo))];
  return html`
    <div class="c-tabela-caixa">
      <${FaixaItem} titulo="Turnos" contagem=${`${visiveis.length} de ${turnos.length}`} novo=${podeEditar ? { rotulo: 'Novo turno', onClick: () => setEdit({ ...TURNO_VAZIO, pausas: [] }) } : null}>
        <${Busca} valor=${busca} aoMudar=${setBusca} rotulo="Buscar turno" />
        ${tipos.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Tipo" value=${tipo} onChange=${(e) => setTipo(e.target.value)}><option value="">Tipo: todos</option>${tipos.map((t) => html`<option key=${t} value=${t}>${TIPOS_TURNO[t] || t}</option>`)}</select>` : null}
        <select class="c-entrada c-entrada--compacta" aria-label="Situação" value=${situacao} onChange=${(e) => setSituacao(e.target.value)}><option value="">Situação: todas</option><option value="ativo">Ativos</option><option value="inativo">Inativos</option></select>
      <//>
      ${!turnos.length ? html`<${Estado} icone="clock" titulo="Nenhum turno cadastrado." rotuloAcao=${podeEditar ? 'Novo turno' : undefined} aoAcao=${podeEditar ? () => setEdit({ ...TURNO_VAZIO, pausas: [] }) : undefined} />`
        : !visiveis.length ? html`<${Estado} titulo="Nenhum turno com estes filtros." rotuloAcao="Limpar filtros" aoAcao=${() => { setBusca(''); setTipo(''); setSituacao(''); }} />`
        : html`<table class="c-tabela">
          <thead><tr><th scope="col">Código</th><th scope="col" class="c-estica">Nome</th><th scope="col">Tipo</th><th scope="col">Horário</th><th scope="col">Dias</th><th scope="col" class="c-col-opc">Jornada</th><th scope="col" class="c-col-opc">Supervisor</th><th scope="col" class="c-num c-col-opc">Pausas</th><th scope="col">Situação</th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead>
          <tbody>${visiveis.map((t) => html`<tr key=${t.id_turno} class=${podeEditar ? 'c-clicavel' : ''} onClick=${podeEditar ? (ev) => { if (!ev.target.closest('button, .c-abre-menu')) setEdit(turnoParaEdicao(t)); } : undefined}>
            <td class="c-forte" data-papel="info" data-prioridade="1" data-primeira=""><span class="c-cor-turno" style=${{ '--t': t.cor || 'var(--cor-acao-fundo)' }} aria-hidden="true"></span>${t.codigo}</td>
            <td class="c-estica" data-papel="titulo">${podeEditar ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto c-linha-nome" onClick=${() => setEdit(turnoParaEdicao(t))}>${t.nome}</button>` : t.nome}</td>
            <td>${t.especial ? 'Especial' : (TIPOS_TURNO[t.tipo] || t.tipo)}</td>
            <td class="c-num-esq" data-papel="info" data-prioridade="1">${t.entrada ? `${t.entrada}–${t.saida}` : '—'}</td>
            <td class="c-secundario" data-papel="info" data-prioridade="1">${t.dias_rotulo || '—'}</td>
            <td class="c-num-esq c-col-opc">${t.entrada ? minutosParaHoras(t.minutos || 0) : '—'}${t.id_contrato ? html` <span class="c-secundario">${(contratos.find((c) => c.id_contrato === t.id_contrato) || {}).codigo || ''}</span>` : null}</td>
            <td class="c-secundario c-col-opc">${t.supervisor ? `${t.supervisor}${t.equipe ? ` · ${t.equipe}` : ''}` : '—'}</td>
            <td class="c-num c-col-opc">${(t.pausas || []).length || '—'}</td>
            <td data-papel="selo">${t.ativo ? html`<${Selo} tom="sucesso">Ativo<//>` : html`<${Selo} tom="neutro">Inativo<//>`}</td>
            <td class="c-acoes" data-papel="acoes">${podeEditar ? html`<${MenuAcoes} rotulo=${`Ações do turno ${t.codigo}`} acoes=${[
              t.tipo === 'TRABALHO' && t.ativo ? { label: 'Ver pessoas com horário próprio', icon: 'users', onClick: () => setPersonalizar(t) } : null,
              ['TRABALHO', 'SOBREAVISO', 'FERIAS', 'ESCALADO'].includes(t.tipo) ? { label: 'Duplicar', icon: 'copy', onClick: () => duplicar(t) } : null,
              ['TRABALHO', 'SOBREAVISO', 'FERIAS', 'ESCALADO'].includes(t.tipo) ? { label: 'Excluir', icon: 'trash', perigo: true, onClick: () => excluir(t) } : null,
            ]} />` : null}</td>
          </tr>`)}</tbody>
        </table>`}
    </div>
    ${edit ? html`<${ModalTurno} operacao=${operacao} inicial=${edit} contratos=${contratos} supervisores=${supervisores} showToast=${showToast} onClose=${() => setEdit(null)} onSalvo=${() => { setEdit(null); recarregar(); }} />` : null}
    ${personalizar ? html`<${ModalPersonalizarTurno} operacao=${operacao} turno=${personalizar} operadores=${operadores} showToast=${showToast} onClose=${() => setPersonalizar(null)} onMudou=${recarregar} />` : null}`;
}

function Calendario({ operacao, anoMes, aoMudarMes, eventos, turnos, operadores = [], podeEditar, recarregar, showToast }) {
  const [edit, setEdit] = useState(null);
  const [tipo, setTipo] = useState('');
  const remover = async (ev) => {
    if (!window.confirm(`Excluir "${ev.descricao}" do calendário especial?`)) return;
    try { await salvarEventoWfm({ ...ev, operacao, ativo: false }, ev.id_item); recarregar(); } catch (err) { showToast?.(falhaAo('remover o item do calendário', err), 'error'); }
  };
  const abrir = (ev) => setEdit({ ...ev, id_turno: ev.id_turno || '', entrada: ev.entrada || '', saida: ev.saida || '' });
  const duplicar = (ev) => { const { id_item: _id, ...resto } = ev; setEdit({ ...resto, id_turno: ev.id_turno || '', entrada: ev.entrada || '', saida: ev.saida || '', descricao: `${ev.descricao} (cópia)` }); };
  const visiveis = eventos.filter((e) => !tipo || e.tipo === tipo);
  return html`
    <div class="c-tabela-caixa">
      <${FaixaItem} titulo="Calendário especial" contagem=${`${visiveis.length} no mês`} novo=${podeEditar ? { rotulo: 'Novo item', onClick: () => setEdit({ ...EVENTO_VAZIO }) } : null}>
        <${Navegar} grupo="Mês" rotulo=${rotuloMes(anoMes)} rotuloAnterior="Mês anterior" rotuloProximo="Próximo mês" aoAnterior=${() => aoMudarMes(somarMes(anoMes, -1))} aoProximo=${() => aoMudarMes(somarMes(anoMes, 1))} />
        <select class="c-entrada c-entrada--compacta" aria-label="Tipo" value=${tipo} onChange=${(e) => setTipo(e.target.value)}><option value="">Tipo: todos</option>${Object.entries(ROTULO_TIPO_EVENTO).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>
      <//>
      ${!visiveis.length ? html`<${Estado} icone="calendar-blank" titulo=${eventos.length ? 'Nenhum item deste tipo no mês.' : 'Nenhum item neste mês.'} texto="Feriado · Data especial (informativa) · Dia especial (o dia todo usa um turno) · Horário especial (muda entrada e saída de um turno)." />`
        : html`<table class="c-tabela">
          <thead><tr><th scope="col">Data</th><th scope="col" class="c-estica">Descrição</th><th scope="col">Tipo</th><th scope="col" class="c-col-opc">Turno e horário</th><th scope="col">Na escala</th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead>
          <tbody>${visiveis.map((ev) => {
            const turno = ev.id_turno ? (turnos.find((t) => t.id_turno === ev.id_turno)?.codigo || '') : '';
            return html`<tr key=${ev.id_item} class=${podeEditar ? 'c-clicavel' : ''} onClick=${podeEditar ? (e) => { if (!e.target.closest('button, .c-abre-menu')) abrir(ev); } : undefined}>
              <td class="c-num-esq c-forte" data-papel="info" data-prioridade="1" data-primeira="">${curta(ev.data_ini)}${ev.data_fim !== ev.data_ini ? ` a ${curta(ev.data_fim)}` : ''}</td>
              <td class="c-estica" data-papel="titulo">${ev.descricao}</td>
              <td data-papel="selo"><${Selo} tom=${TOM_EVENTO[ev.tipo] || 'neutro'}>${ROTULO_TIPO_EVENTO[ev.tipo] || ev.tipo}<//></td>
              <td class="c-num-esq c-secundario c-col-opc">${[turno, ev.entrada ? `${ev.entrada}–${ev.saida}` : ''].filter(Boolean).join(' · ') || '—'}</td>
              <td class="c-secundario" data-papel="info" data-prioridade="1">${ev.tipo === 'FERIADO' ? (ev.gera_servico ? `Serviço: ${(ev.servico?.ids_operadores || []).length} pessoa(s)` : 'Folga para todos') : '—'}</td>
              <td class="c-acoes" data-papel="acoes">${podeEditar ? html`<${MenuAcoes} rotulo=${`Ações de ${ev.descricao}`} acoes=${[
                ev.tipo === 'FERIADO' && ev.gera_servico ? { label: 'Ver pessoas', icon: 'users', onClick: () => abrir(ev) } : null,
                { label: 'Duplicar', icon: 'copy', onClick: () => duplicar(ev) },
                { label: 'Excluir', icon: 'trash', perigo: true, onClick: () => remover(ev) },
              ]} />` : null}</td>
            </tr>`; })}</tbody>
        </table>`}
    </div>
    ${edit ? html`<${ModalEvento} operacao=${operacao} inicial=${edit} turnos=${turnos} operadores=${operadores} showToast=${showToast} onClose=${() => setEdit(null)} onSalvo=${() => { setEdit(null); recarregar(); }} />` : null}`;
}

// Skills: catálogo (Skill · Categoria · Pessoas) e, em "Por pessoa", quem tem cada skill (editar abre a janela).
function Skills({ operacao, skills, operadores, podeEditar, recarregar, showToast }) {
  const [visao, setVisao] = useState('skills');
  const [nova, setNova] = useState(null);
  const [editandoOp, setEditandoOp] = useState(null);
  const [verPessoas, setVerPessoas] = useState(null);
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);
  const adicionar = async (e) => {
    e.preventDefault();
    if (!nova.nome.trim()) return;
    setSalvando(true);
    try { await salvarSkillWfm({ ...nova, operacao }); setNova(null); recarregar(); showToast?.('Skill adicionada.', 'success'); } catch (err) { showToast?.(err?.message || 'Não foi possível salvar.', 'error'); } finally { setSalvando(false); }
  };
  const salvarOp = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try { await definirSkillsOperadorWfm(editandoOp.id_usuario, { operacao, ids_skill: editandoOp.skills }); setEditandoOp(null); recarregar(); showToast?.('Skills salvas.', 'success'); } catch (err) { showToast?.(err?.message || 'Não foi possível salvar.', 'error'); } finally { setSalvando(false); }
  };
  const alternar = (id) => setEditandoOp({ ...editandoOp, skills: editandoOp.skills.includes(id) ? editandoOp.skills.filter((s) => s !== id) : [...editandoOp.skills, id] });
  const ativas = skills.filter((s) => s.ativo);
  const pessoasDe = (id) => operadores.filter((o) => (o.skills || []).includes(id));
  const ops = operadores.filter((o) => !busca || semAcento(o.nome).includes(semAcento(busca)));
  const sks = skills.filter((s) => !busca || semAcento(s.nome).includes(semAcento(busca)));
  return html`
    <div class="c-tabela-caixa">
      <${FaixaItem} titulo="Skills" novo=${podeEditar && visao === 'skills' ? { rotulo: 'Nova skill', onClick: () => setNova({ categoria: 'IDIOMA', nome: '' }) } : null}>
        <${Segmento} mini=${true} rotulo="Ver" valor=${visao} aoMudar=${setVisao} opcoes=${[['skills', 'Skills', skills.length], ['pessoas', 'Por pessoa', operadores.length]]} />
        <${Busca} valor=${busca} aoMudar=${setBusca} rotulo=${visao === 'skills' ? 'Buscar skill' : 'Buscar pessoa'} />
      <//>
      ${visao === 'skills'
        ? (!sks.length ? html`<${Estado} icone="star" titulo=${skills.length ? 'Nenhuma skill com esta busca.' : 'Nenhuma skill cadastrada.'} />`
          : html`<table class="c-tabela"><thead><tr><th scope="col" class="c-estica">Skill</th><th scope="col">Categoria</th><th scope="col" class="c-num">Pessoas</th><th scope="col">Situação</th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead><tbody>
            ${sks.map((s) => html`<tr key=${s.id_skill} class="c-clicavel" onClick=${(ev) => { if (!ev.target.closest('button, .c-abre-menu')) setVerPessoas(s); }}>
              <td class="c-estica c-forte" data-papel="titulo">${s.nome}</td><td data-papel="info" data-prioridade="1" data-primeira="">${CATEGORIAS_SKILL[s.categoria] || s.categoria || '—'}</td><td class="c-num" data-papel="info" data-prioridade="1">${pessoasDe(s.id_skill).length}</td>
              <td data-papel="selo">${s.ativo === false ? html`<${Selo} tom="neutro">Inativa<//>` : html`<${Selo} tom="sucesso">Ativa<//>`}</td>
              <td class="c-acoes" data-papel="acoes"><${MenuAcoes} rotulo=${`Ações da skill ${s.nome}`} acoes=${[{ label: 'Ver pessoas', icon: 'users', onClick: () => setVerPessoas(s) }]} /></td>
            </tr>`)}</tbody></table>`)
        : (!ops.length ? html`<${Estado} icone="users" titulo="Ninguém com esta busca." />`
          : html`<table class="c-tabela"><thead><tr><th scope="col">Colaborador</th><th scope="col" class="c-estica">Skills</th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead><tbody>
            ${ops.map((o) => html`<tr key=${o.id_usuario} class=${podeEditar ? 'c-clicavel' : ''} onClick=${podeEditar ? (ev) => { if (!ev.target.closest('button, .c-abre-menu')) setEditandoOp({ id_usuario: o.id_usuario, nome: o.nome, skills: [...(o.skills || [])] }); } : undefined}>
              <td class="c-forte" data-papel="titulo">${o.nome}</td><td class="c-estica c-secundario" data-papel="info" data-prioridade="1" data-primeira="">${(o.skills || []).map((id) => skills.find((s) => s.id_skill === id)?.nome).filter(Boolean).join(', ') || '—'}</td>
              <td class="c-acoes" data-papel="acoes">${podeEditar ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => setEditandoOp({ id_usuario: o.id_usuario, nome: o.nome, skills: [...(o.skills || [])] })}>Editar</button>` : null}</td>
            </tr>`)}</tbody></table>`)}
    </div>
    ${nova ? html`<${JanelaForm} titulo="Nova skill" onClose=${() => setNova(null)} onSubmit=${adicionar} salvando=${salvando} salvarRotulo="Adicionar">
      <div class="c-form" style=${{ '--colunas': 2 }}>
        <${Campo} rotulo="Categoria"><select class="c-entrada" value=${nova.categoria} onChange=${(e) => setNova({ ...nova, categoria: e.target.value })}>${Object.entries(CATEGORIAS_SKILL).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
        <${Campo} rotulo="Nome"><input class="c-entrada" required maxlength="120" value=${nova.nome} onInput=${(e) => setNova({ ...nova, nome: e.target.value })} /><//>
      </div>
    <//>` : null}
    ${editandoOp ? html`<${JanelaForm} titulo=${`Skills de ${editandoOp.nome}`} onClose=${() => setEditandoOp(null)} onSubmit=${salvarOp} salvando=${salvando} salvarRotulo="Salvar skills">
      ${ativas.length ? html`<div class="c-lote-lista">${ativas.map((s) => html`<label key=${s.id_skill} class="c-marcar"><input type="checkbox" checked=${editandoOp.skills.includes(s.id_skill)} onChange=${() => alternar(s.id_skill)} /><span>${CATEGORIAS_SKILL[s.categoria]} · ${s.nome}</span></label>`)}</div>`
        : html`<p class="c-ajuda">Cadastre ao menos uma skill para atribuir.</p>`}
    <//>` : null}
    ${verPessoas ? html`<${Janela} titulo=${`Pessoas com ${verPessoas.nome}`} onClose=${() => setVerPessoas(null)} rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => setVerPessoas(null)}>Fechar</button>`}>
      <div class="c-janela-corpo">${pessoasDe(verPessoas.id_skill).length ? html`<ul class="c-lote-lista" style=${{ listStyle: 'none', margin: 0, padding: 0 }}>${pessoasDe(verPessoas.id_skill).map((o) => html`<li key=${o.id_usuario}>${o.nome}</li>`)}</ul>` : html`<p class="c-ajuda">Ninguém com esta skill.</p>`}</div>
    <//>` : null}`;
}

function TiposEscala({ recarregarContexto, showToast }) {
  const [itens, setItens] = useState(null);
  const [form, setForm] = useState(null); // { id_tipo?, nome, descricao, ativo }
  const [salvando, setSalvando] = useState(false);
  const carregar = useCallback(async () => {
    try { setItens((await listarTiposEscalaWfm()).itens || []); } catch (e) { setItens([]); showToast?.(e?.message || 'Não foi possível carregar os tipos de escala.', 'error'); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const depois = async (msg) => { showToast?.(msg, 'success'); setForm(null); await carregar(); recarregarContexto?.(); };
  const salvar = async (e) => {
    e.preventDefault();
    if (!form.nome.trim()) return;
    setSalvando(true);
    try { await salvarTipoEscalaWfm({ operacao_base: 'TI', nome: form.nome, descricao: form.descricao || '', ativo: form.ativo }, form.id_tipo); await depois('Tipo de escala salvo.'); }
    catch (err) { showToast?.(err?.message || 'Não foi possível salvar.', 'error'); } finally { setSalvando(false); }
  };
  const alternar = async (t) => {
    try { await salvarTipoEscalaWfm({ operacao_base: t.operacao_base, nome: t.nome, descricao: t.descricao || '', ativo: !t.ativo }, t.id_tipo); await depois(t.ativo ? 'Tipo de escala desativado.' : 'Tipo de escala ativado.'); }
    catch (err) { showToast?.(err?.message || 'Não foi possível alterar.', 'error'); }
  };
  const excluir = async (t) => {
    if (!window.confirm(`Excluir a escala "${t.nome}" e os turnos dela? Se já tiver histórico publicado, ela some das telas e o histórico é preservado.`)) return;
    try { await excluirEscalaWfm(t.chave); await depois('Escala excluída.'); }
    catch (err) { showToast?.(err?.message || 'Não foi possível excluir.', 'error'); await carregar(); recarregarContexto?.(); }
  };
  return html`
    <div class="c-tabela-caixa">
      <${FaixaItem} titulo="Tipos de escala" novo=${{ rotulo: 'Novo tipo', onClick: () => setForm({ nome: '', descricao: '', ativo: true }) }}>
        <span class="c-ajuda">Escalas próprias do setor de Tecnologia (ex.: Plantão de sábado, Sobreaviso).</span>
      <//>
      ${!itens ? html`<${Esqueleto} linhas=${3} />` : !itens.length ? html`<${Estado} titulo="Nenhum tipo de escala cadastrado." />`
        : html`<table class="c-tabela"><thead><tr><th scope="col">Nome</th><th scope="col" class="c-estica">Descrição</th><th scope="col">Situação</th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead><tbody>
          ${itens.map((t) => html`<tr key=${t.id_tipo} class="c-clicavel" onClick=${(ev) => { if (!ev.target.closest('button, .c-abre-menu')) setForm({ id_tipo: t.id_tipo, nome: t.nome, descricao: t.descricao || '', ativo: t.ativo }); }}>
            <td class="c-forte" data-papel="titulo">${t.nome}</td><td class="c-estica c-secundario" data-papel="info" data-prioridade="1" data-primeira="">${t.descricao || '—'}</td>
            <td data-papel="selo">${t.ativo ? html`<${Selo} tom="sucesso">Ativa<//>` : html`<${Selo} tom="neutro">Desativada<//>`}</td>
            <td class="c-acoes" data-papel="acoes"><${MenuAcoes} rotulo=${`Ações de ${t.nome}`} acoes=${[
              { label: t.ativo ? 'Desativar' : 'Ativar', icon: t.ativo ? 'pause-circle' : 'play-circle', onClick: () => alternar(t) },
              { label: 'Excluir', icon: 'trash', perigo: true, onClick: () => excluir(t) },
            ]} /></td></tr>`)}
        </tbody></table>`}
    </div>
    ${form ? html`<${JanelaForm} titulo=${form.id_tipo ? 'Editar tipo de escala' : 'Novo tipo de escala'} onClose=${() => setForm(null)} onSubmit=${salvar} salvando=${salvando}>
      <${Campo} rotulo="Nome da escala"><input class="c-entrada" required maxlength="120" value=${form.nome} onInput=${(e) => setForm({ ...form, nome: e.target.value })} /><//>
      <${Campo} rotulo="Descrição" opcional=${true}><input class="c-entrada" maxlength="200" value=${form.descricao} onInput=${(e) => setForm({ ...form, descricao: e.target.value })} /><//>
    <//>` : null}`;
}

const ITENS = [
  ['escala', 'Escala', [['turnos', 'Turnos', 'clock'], ['jornadas', 'Jornadas e limites', 'scales'], ['calendario', 'Calendário especial', 'calendar-dots'], ['skills', 'Skills', 'star'], ['tipos', 'Tipos de escala', 'squares-four']]],
  ['registro', 'Registro', [['historico', 'Histórico de alterações', 'clock-counter-clockwise']]],
];

// Cadastros: lista lateral + a tabela do item escolhido. `pagina` monta a página inteira (cabeçalho com a escala);
// sem ela (Equipes › Horários) mostra só a lista e a tabela. Jornadas e Histórico só aparecem quando a tela os oferece.
export function TelaCadastros({ controlador, contexto, operacao, anoMes, showToast, recarregarContexto, aoTrocarEscala, itemInicial = 'turnos', comJornadas = false, comHistorico = false, pagina = false }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [item, setItem] = useState(itemInicial);
  const [mesCal, setMesCal] = useState(anoMes);
  useEffect(() => { setMesCal(anoMes); }, [anoMes]);
  useEffect(() => { setItem(itemInicial); }, [itemInicial]);
  const carregar = useCallback(async () => {
    if (!operacao) { setDados({ supervisores: [], contratos: [], turnos: [], skills: [], eventos: [], operadores: [] }); return; }
    setErro('');
    try {
      const [contratos, turnos, skills, eventos, escala, supervisores] = await Promise.all([
        listarContratosWfm(operacao), listarTurnosWfm(operacao), listarSkillsWfm(operacao), listarCalendarioWfm(operacao, mesCal), lerEscalaWfm(operacao, mesCal).catch(() => ({ operadores: [] })),
        listarSupervisoresWfm(operacao).catch(() => ({ itens: [] })),
      ]);
      setDados({ supervisores: supervisores.itens, contratos: contratos.itens, turnos: turnos.itens, skills: skills.itens, eventos: eventos.itens, operadores: escala.operadores });
    } catch (e) { setDados(null); setErro(e?.message || 'Não foi possível carregar os cadastros.'); }
  }, [operacao, mesCal]);
  useEffect(() => { carregar(); }, [carregar]);

  const podeCadastros = controlador.possuiPermissao('wfm.cadastros.editar');
  const disponivel = {
    turnos: !!operacao, jornadas: comJornadas && !!operacao, calendario: !!operacao, skills: !!operacao,
    tipos: !!contexto?.pode_editar_tipos_escala, historico: comHistorico,
  };
  const atual = disponivel[item] ? item : (Object.keys(disponivel).find((k) => disponivel[k]) || 'turnos');
  const comum = { operacao, showToast, recarregar: carregar };

  const conteudo = () => {
    if (atual === 'historico') return html`<${TabelaHistorico} contexto=${contexto} showToast=${showToast} />`;
    if (atual === 'tipos') return html`<${TiposEscala} recarregarContexto=${recarregarContexto} showToast=${showToast} />`;
    if (atual === 'jornadas') return html`<${TabelaJornadas} controlador=${controlador} operacao=${operacao} showToast=${showToast} />`;
    if (!operacao) return html`<div class="c-tabela-caixa"><${Estado} icone="calendar-blank" titulo="Escolha uma escala" texto="Turnos, calendário especial e skills pertencem a uma escala. Crie ou ative uma escala e escolha-a no topo." /></div>`;
    if (erro) return html`<div class="c-tabela-caixa"><${Estado} titulo=${erro} rotuloAcao="Tentar de novo" aoAcao=${carregar} /></div>`;
    if (!dados) return html`<div class="c-tabela-caixa"><${Esqueleto} linhas=${6} /></div>`;
    if (atual === 'calendario') return html`<${Calendario} ...${comum} anoMes=${mesCal} aoMudarMes=${setMesCal} eventos=${dados.eventos} turnos=${dados.turnos} operadores=${dados.operadores} podeEditar=${podeCadastros} />`;
    if (atual === 'skills') return html`<${Skills} ...${comum} skills=${dados.skills} operadores=${dados.operadores} podeEditar=${podeCadastros} />`;
    return html`<${Turnos} ...${comum} turnos=${dados.turnos} contratos=${dados.contratos} supervisores=${dados.supervisores} operadores=${dados.operadores} podeEditar=${podeCadastros} />`;
  };

  const lista = html`<nav class="c-rel-lista c-rel-lista--caixa c-cad-lista" aria-label="Cadastros">
    ${ITENS.map(([grupo, rotulo, itens]) => {
      const vis = itens.filter(([id]) => disponivel[id]);
      if (!vis.length) return null;
      return html`<div key=${grupo} style=${{ display: 'contents' }}><h3>${rotulo}</h3>
        ${vis.map(([id, nome, icone]) => html`<button key=${id} type="button" class="c-cad-item" aria-current=${atual === id ? 'page' : null} onClick=${() => setItem(id)}><${Ic} nome=${icone} />${nome}</button>`)}</div>`;
    })}
  </nav>`;
  const corpo = html`<div class="c-cad">${lista}<div style=${{ minWidth: 0 }}>${conteudo()}</div></div>`;
  if (!pagina) return corpo;
  const opcoes = (contexto?.operacoes || []).map((o) => [o.chave, o.nome]);
  return html`<main class="c-pagina c-conteudo">
    <div class="c-cab-linha">
      <h1>Cadastros</h1>
      ${opcoes.length > 1 && aoTrocarEscala && atual !== 'historico' && atual !== 'tipos' ? html`<select class="c-entrada c-entrada--compacta c-trocar-escala" aria-label="Escala / operação" value=${operacao} onChange=${(e) => aoTrocarEscala(e.target.value)}>${opcoes.map(([v, r]) => html`<option key=${v} value=${v}>${r}</option>`)}</select>` : null}
    </div>
    ${corpo}
  </main>`;
}

