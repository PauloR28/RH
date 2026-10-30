import { html, useCallback, useEffect, useRef, useState, React } from '../../../infraestrutura-react.js';

const Fragment = React.Fragment;
import { LoadingState } from '../../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../../ui/icone.js';
import { MenuAcoesProcesso } from '../../../ui/components/menu-acoes.js?v=20260930-label';
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
} from '../../../services/api/wfm.js?v=20261030-folga';
import { ROTULO_TIPO_EVENTO, falhaAo, minutosParaHoras } from './comum.js?v=20261029-fix';
import { descreverTurno } from './escala.js?v=20261029-fix';
import { BotaoAdicionar, BotaoRemover, Campo, Marca, ModalForm } from './formulario.js';
import { CardRecolhivel } from '../../../ui/components/modulo-primitivas.js?v=20261023-ajustes';
import { Icone } from './escala-ui.js?v=20261029-fix';
import { textoLegivel } from './compartilhar.js?v=20261029-fix';
import { TIPOS_PAUSA } from './jornadas.js?v=20261029-fix';

// Cadastros do WFM: turnos, calendário especial (feriado, data, dia e horário especiais) e skills.

const CATEGORIAS_SKILL = { IDIOMA: 'Idioma', PRODUTO: 'Produto', RETENCAO: 'Retenção', OUTRO: 'Outro' };
// Tipos de turno. Férias e Escalado não exigem horário nem jornada (Escalado = horário ainda por definir).
export const TIPOS_TURNO = { TRABALHO: 'Trabalho', FOLGA: 'Folga', DSR: 'DSR', FERIAS: 'Férias', ESCALADO: 'Escalado', SOBREAVISO: 'Sobreaviso' };
const TIPOS_SEM_HORARIO = ['FERIAS', 'ESCALADO'];
const AVISO_TIPO = { FERIAS: 'Férias não exigem horário nem jornada.', ESCALADO: 'Escalado não exige horário nem jornada: use quando o horário ainda não foi definido e depois mude o tipo para Trabalho.' };
export const TURNO_VAZIO = { codigo: '', nome: '', tipo: 'TRABALHO', cor: '#1f5fbf', entrada: '08:00', saida: '16:00', id_contrato: '', id_supervisor: '', pausas: [], weekdays: [0, 1, 2, 3, 4], especial: false, ativo: true };
const EVENTO_VAZIO = { tipo: 'FERIADO', data_ini: '', data_fim: '', descricao: '', id_turno: '', entrada: '', saida: '', gera_servico: false, servico: null };
const SERVICO_VAZIO = { id_turno: '', entrada: '', saida: '', ids_operadores: [] };

const paraMin = (hhmm) => { const [h, m] = (hhmm || '00:00').split(':').map(Number); return h * 60 + m; };
const horaDe = (min) => `${String(Math.floor((((min % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String((((min % 1440) + 1440) % 1440) % 60).padStart(2, '0')}`;
const offsetDe = (entrada, inicio) => (((paraMin(inicio) - paraMin(entrada)) % 1440) + 1440) % 1440;

// Turno atrelado a jornada: saída = entrada + jornada (+ intervalos não remunerados).
const saidaCalculada = (t, contratos) => {
  const c = contratos.find((x) => String(x.id_contrato) === String(t.id_contrato));
  if (!c || !t.entrada) return '';
  return horaDe(paraMin(t.entrada) + c.jornada_diaria_max_min + (t.pausas || []).filter((p) => p.tipo === 'INTERVALO').reduce((a, p) => a + Number(p.duracao_min || 0), 0));
};

const DIAS_CURTOS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const ATALHOS_DIAS = [['Todos os dias', [0, 1, 2, 3, 4, 5, 6]], ['Seg a Sex', [0, 1, 2, 3, 4]], ['Fim de semana', [5, 6]]];
const mesmosDias = (a, b) => a.length === b.length && a.every((d) => b.includes(d));

// Bloco "Dias da semana" do turno: sete botões de marcar, atalhos e resumo. Estado nunca só por cor (rótulo e aria-checked).
function BlocoDiasSemana({ dias, aoMudar, obrigatorio }) {
  const alternar = (i) => aoMudar((atual) => (atual.includes(i) ? atual.filter((d) => d !== i) : [...atual, i].sort()));
  const vazio = dias.length === 0;
  return html`<section class="wfm-pt-dias" aria-labelledby="wfm-pt-dias-t">
    <header><h3 id="wfm-pt-dias-t">Dias da semana</h3><span class="wfm-pt-novo">NOVO</span></header>
    <p class="wfm-pt-ajuda">Dias em que este turno vale. O colaborador só trabalha nesses dias; nos outros fica sem escala ou com outro turno.</p>
    <div class="wfm-pt-dias-btns" role="group" aria-label="Dias da semana do turno">
      ${DIAS_CURTOS.map((nome, i) => html`<button key=${nome} type="button" role="checkbox" aria-checked=${dias.includes(i)} class=${`wfm-pt-dia ${dias.includes(i) ? 'is-marcado' : ''}`} onClick=${() => alternar(i)}>${nome}</button>`)}
    </div>
    <div class="wfm-pt-atalhos">${ATALHOS_DIAS.map(([rotulo, valor]) => html`<button key=${rotulo} type="button" class="wfm-pt-atalho" onClick=${() => aoMudar(valor)}>${rotulo}</button>`)}</div>
    ${vazio && obrigatorio ? html`<p class="wfm-pt-resumo is-erro" role="alert">Escolha pelo menos um dia.</p>`
      : html`<p class="wfm-pt-resumo">${vazio ? 'Vale em: nenhum dia' : `Vale em: ${dias.map((d) => DIAS_CURTOS[d]).join(', ')}`}</p>`}
  </section>`;
}

// Painel flutuante "Novo turno / Editar turno": 470 px, colado ao topo e ao rodapé do cartão (14 px de margem) e por cima da
// coluna da direita; sem cartão por perto, ocupa a lateral da janela. O corpo rola por dentro.
export function ModalTurno({ operacao, inicial, contratos, supervisores = [], onClose, onSalvo, showToast }) {
  const [edit, setEdit] = useState(inicial);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [impacto, setImpacto] = useState(null);   // regra 8: números mostrados antes de confirmar a mudança de dias de um turno em uso
  const [impactoTipo, setImpactoTipo] = useState(null);   // idem para a mudança de TIPO de um turno em uso (afeta toda a escala)
  const caixa = useRef(null);
  const set = (k, v) => setEdit((e) => ({ ...e, [k]: v }));
  useEffect(() => { if (impacto || impactoTipo) caixa.current?.querySelector('.wfm-pt-impacto')?.scrollIntoView({ block: 'nearest' }); }, [impacto, impactoTipo]);
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

  useEffect(() => {
    const anterior = document.activeElement;
    const posicionar = () => {
      const el = caixa.current; if (!el) return;
      const r = document.querySelector('.mo-card-escala')?.getBoundingClientRect();
      const ok = r && r.width > 0 && r.height > 0;
      el.style.top = `${(ok ? r.top : 0) + 14}px`;
      el.style.bottom = `${ok ? Math.max(window.innerHeight - r.bottom, 0) + 14 : 14}px`;
      el.style.right = `${ok ? Math.max(window.innerWidth - r.right, 0) + 14 : 14}px`;
    };
    posicionar();
    caixa.current?.querySelector('input:not([disabled])')?.focus();
    const aoTeclar = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('resize', posicionar);
    document.addEventListener('keydown', aoTeclar);
    return () => { window.removeEventListener('resize', posicionar); document.removeEventListener('keydown', aoTeclar); anterior?.focus?.(); };
  }, []);

  const gravar = async () => {
    setSalvando(true);
    try {
      const pausas = (edit.pausas || []).map((p) => ({ offset_min: offsetDe(edit.entrada, p.inicio), duracao_min: Math.max(Number(p.duracao_min) || 1, 1), tipo: p.tipo }));
      await salvarTurnoWfm({ ...edit, pausas, operacao, saida: trabalho ? saida : '', entrada: trabalho ? edit.entrada : '', confirmar_mudanca_tipo: mudouTipo, weekdays: especial ? [0, 1, 2, 3, 4, 5, 6] : dias, especial, id_contrato: comJornada ? Number(edit.id_contrato) : null, id_supervisor: edit.id_supervisor ? Number(edit.id_supervisor) : null }, edit.id_turno);
      showToast?.(edit.id_turno ? 'Turno salvo.' : 'Turno salvo.', 'success');
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

  return html`<aside class="wfm-pt" ref=${caixa} role="dialog" aria-modal="false" aria-label=${edit.id_turno ? `Editar turno ${edit.codigo}` : 'Novo turno'}>
    <header class="wfm-pt-cab"><h2>${edit.id_turno ? `Editar turno ${edit.codigo}` : 'Novo turno'}</h2>
      <button type="button" class="mo-painel-x" aria-label="Fechar" title="Fechar" onClick=${onClose}><${Icone} nome="close" /></button></header>
    <form class="wfm-pt-form" noValidate onSubmit=${salvar}>
      <div class="wfm-pt-corpo">
        <div class="wfm-pt-grade">
          <${Campo} rotulo="Código" span=${1} dica=${edit.id_turno ? undefined : 'Gerado automaticamente a partir do nome'}><input class="form-control" maxlength="20" disabled value=${edit.codigo} placeholder="Automático" /></${Campo}>
          <${Campo} rotulo="Nome" span=${1}><input class="form-control" maxlength="120" value=${edit.nome} onInput=${(e) => set('nome', e.target.value)} /></${Campo}>
          <${Campo} rotulo="Tipo" span=${1}><select class="form-select" value=${edit.tipo} onChange=${(e) => mudarTipo(e.target.value)}>${['TRABALHO', 'FOLGA', 'DSR', 'FERIAS', 'ESCALADO', ...(inicial.tipo === 'SOBREAVISO' ? ['SOBREAVISO'] : [])].map((t) => html`<option key=${t} value=${t}>${TIPOS_TURNO[t]}</option>`)}</select></${Campo}>
          <${Campo} rotulo="Cor" span=${1}><input class="form-control form-control-color wfm-cor" type="color" value=${edit.cor} onInput=${(e) => set('cor', e.target.value)} /></${Campo}>
          ${trabalho ? html`
            <${Campo} rotulo="Horário (entrada – saída)" span=${1} dica=${comJornada ? 'Saída calculada: entrada + jornada' : 'A saída atravessa a meia-noite se for menor que a entrada'}>
              <span class="wfm-pt-horario"><input class="form-control" type="time" aria-label="Entrada" value=${edit.entrada} onInput=${(e) => set('entrada', e.target.value)} /><span aria-hidden="true">–</span><input class="form-control" type="time" aria-label="Saída" disabled=${comJornada} value=${saida} onInput=${(e) => set('saida', e.target.value)} /></span></${Campo}>
            <${Campo} rotulo="Jornada (opcional)" span=${1}><select class="form-select" value=${edit.id_contrato || ''} onChange=${(e) => set('id_contrato', e.target.value)}>
              <option value="">Sem jornada</option>${contratos.filter((c) => c.ativo).map((c) => html`<option key=${c.id_contrato} value=${c.id_contrato}>${c.codigo} · ${minutosParaHoras(c.jornada_diaria_max_min)}</option>`)}</select></${Campo}>
            <${Campo} rotulo="Supervisor · Equipe" span=${2} dica="A equipe vem do supervisor escolhido"><span class="wfm-pt-sup">
              <select class="form-select" aria-label="Supervisor (opcional)" value=${edit.id_supervisor || ''} onChange=${(e) => set('id_supervisor', e.target.value)}><option value="">Nenhum</option>${supervisores.map((s) => html`<option key=${s.id_usuario} value=${s.id_usuario}>${s.nome}</option>`)}</select>
              <input class="form-control" aria-label="Equipe" disabled value=${supervisor.equipe || '—'} /></span></${Campo}>` : null}
          <${Marca} rotulo="Ativo" span=${trabalho ? 1 : 2} checked=${edit.ativo} onChange=${(v) => set('ativo', v)} />
          ${trabalho ? html`<${Marca} rotulo="Escala Especial" span=${1} checked=${!!edit.especial} onChange=${(v) => { setImpacto(null); set('especial', v); }} />` : null}
        </div>

        ${especial
          ? html`<p class="wfm-pt-nota">Escala Especial: para dias fora da escala tradicional, com horário e rotina próprios. Vale em qualquer dia da semana e não conta no limite de escalas por colaborador.</p>`
          : semHorario ? html`<p class="wfm-pt-nota" role="note">${AVISO_TIPO[edit.tipo]}</p>`
          : html`<${BlocoDiasSemana} dias=${dias} aoMudar=${(v) => { setImpacto(null); setEdit((e) => ({ ...e, weekdays: typeof v === 'function' ? v(e.weekdays || []) : v })); }} obrigatorio=${trabalho} />
        <p class="wfm-pt-nota">Cada colaborador pode ter até o limite de escalas definido em Configurações da escala (padrão 4), em dias diferentes. Pausas e outras configurações seguem esses dias.</p>`}

        ${trabalho ? html`
          <div class="wfm-sub-cab"><h4>Pausas do turno</h4><${BotaoAdicionar} rotulo="Pausa" onClick=${() => setEdit({ ...edit, pausas: [...edit.pausas, { inicio: edit.entrada ? horaDe(paraMin(edit.entrada) + 90) : '09:00', duracao_min: 10, tipo: 'DESCANSO' }] })} /></div>
          ${edit.pausas.length ? html`<div class="wfm-linhas wfm-linhas--turno">
            <div class="wfm-linhas-cab"><span>Tipo</span><span>Início</span><span>Duração min</span><span></span></div>
            ${edit.pausas.map((p, i) => html`<div class="wfm-linhas-item" key=${i}>
              <select class="form-select" aria-label="Tipo" value=${p.tipo} onChange=${(e) => setPausa(i, 'tipo', e.target.value)}>${Object.entries(TIPOS_PAUSA).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>
              <input class="form-control" aria-label="Início" type="time" value=${p.inicio} onInput=${(e) => setPausa(i, 'inicio', e.target.value)} />
              <input class="form-control" aria-label="Duração min" type="number" min="1" value=${p.duracao_min} onInput=${(e) => setPausa(i, 'duracao_min', e.target.value)} />
              <${BotaoRemover} onClick=${() => setEdit({ ...edit, pausas: edit.pausas.filter((_, j) => j !== i) })} />
            </div>`)}
          </div>` : html`<p class="mon-muted wfm-vazio-txt">Nenhuma pausa neste turno.</p>`}` : null}

        ${impactoTipo ? html`<div class="wfm-pt-impacto" role="alert"><strong>Esta mudança afeta toda a escala que usa o turno ${edit.codigo}.</strong>
          <span>${`O tipo muda de ${TIPOS_TURNO[impactoTipo.tipo_atual] || impactoTipo.tipo_atual} para ${TIPOS_TURNO[impactoTipo.tipo_novo] || impactoTipo.tipo_novo} para ${impactoTipo.operadores} colaborador(es): ${impactoTipo.dias_futuros} dia(s) de hoje em diante e ${impactoTipo.dias_passados} dia(s) já passados${impactoTipo.eventos_calendario ? `, além de ${impactoTipo.eventos_calendario} item(ns) do calendário especial` : ''}.${impactoTipo.trocas_em_andamento ? ` ${impactoTipo.trocas_em_andamento} pedido(s) de troca em andamento serão invalidados.` : ''}`}</span>
          <span>${impactoTipo.aviso}</span></div>` : null}
        ${impacto ? html`<div class="wfm-pt-impacto" role="alert"><strong>Esta mudança afeta escalas já lançadas.</strong>
          <span>${impacto.operadores} operador(es) e ${impacto.dias_fora} dia(s) de hoje em diante ficam fora dos novos dias e passam a contar como configurados à mão.
          Pausas nesses dias: ${impacto.pausas_automaticas} automática(s) e ${impacto.pausas_manuais} manual(is).</span>
          <span>${impacto.aviso}</span></div>` : null}
        ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>` : null}
      </div>
      <footer class="wfm-pt-rodape">
        ${podeExcluir ? html`<button type="button" class="btn btn-outline-danger wfm-pt-excluir" disabled=${excluindo || !!salvando} onClick=${excluir}>${excluindo ? 'Excluindo…' : 'Excluir turno'}</button>` : null}
        <button type="button" class="btn btn-outline-secondary" onClick=${onClose}>Cancelar</button>
        <button type="submit" class="btn btn-primary" disabled=${!!salvando || semDias}>${salvando ? 'Salvando…' : impacto || impactoTipo ? 'Confirmar e salvar turno' : 'Salvar turno'}</button>
      </footer>
    </form>
  </aside>`;
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
  return html`<${ModalForm} titulo=${`Personalizar turno ${turno.codigo}`} onClose=${onClose} onSubmit=${salvar} erro=${erro} salvando=${salvando} salvarRotulo="Salvar horário">
    <p class="mon-muted">Horário padrão do turno: <strong>${turno.entrada}–${turno.saida}</strong>. Quem já está no turno continua com o horário padrão; só o colaborador escolhido abaixo passa a ter horário próprio.</p>
    <div class="wfm-grade-form">
      <${Campo} rotulo="Colaborador" span=${6}><select class="form-select" value=${form.id_operador} onChange=${(e) => set('id_operador', e.target.value)}><option value="">Escolher colaborador</option>${livres.map((o) => html`<option key=${o.id_usuario} value=${o.id_usuario}>${o.nome}</option>`)}</select></${Campo}>
      <${Campo} rotulo="Entrada" span=${3}><input class="form-control" type="time" value=${form.entrada} onInput=${(e) => set('entrada', e.target.value)} /></${Campo}>
      <${Campo} rotulo="Saída" span=${3}><input class="form-control" type="time" value=${form.saida} onInput=${(e) => set('saida', e.target.value)} /></${Campo}>
      <${Marca} rotulo="Ajustar também os dias já lançados de hoje em diante" span=${12} checked=${form.aplicar_lancados} onChange=${(v) => set('aplicar_lancados', v)} />
    </div>
    <div class="wfm-sub-cab"><h4>Colaboradores com horário próprio</h4></div>
    ${lista === null ? html`<${LoadingState} />` : lista.length ? html`<div class="mon-tabela-wrap"><table class="mon-tabela wfm-tabela"><thead><tr><th>Colaborador</th><th>Horário</th><th></th></tr></thead><tbody>
      ${lista.map((p) => html`<tr key=${p.id_operador}><td>${p.operador}</td><td>${p.entrada}–${p.saida}</td><td class="wfm-acoes-linha"><button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setForm((f) => ({ ...f, id_operador: String(p.id_operador), entrada: p.entrada, saida: p.saida }))}>Editar</button><button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => remover(p)}>Remover</button></td></tr>`)}
    </tbody></table></div>` : html`<p class="mon-muted wfm-vazio-txt">Ninguém com horário próprio neste turno.</p>`}
  </${ModalForm}>`;
}

function Turnos({ operacao, turnos, contratos, supervisores, operadores = [], podeEditar, recarregar, showToast }) {
  const [edit, setEdit] = useState(null);
  const [personalizar, setPersonalizar] = useState(null);
  const abrirEdicao = (t) => setEdit(turnoParaEdicao(t));
  const excluir = async (t) => {
    if (!window.confirm(`Excluir o turno ${t.codigo} (${t.nome})? Só é possível se ele nunca foi usado em uma escala.`)) return;
    try { await excluirTurnoWfm(operacao, t.id_turno); showToast?.('Turno excluído.', 'success'); recarregar(); }
    catch (err) { showToast?.(falhaAo('excluir o turno', err), 'error'); }
  };
  return html`
    <${CardRecolhivel} titulo="Turnos" contador=${turnos.length} className="mo-cartao-turnos"
      acoes=${podeEditar ? html`<button type="button" class="mo-btn mo-btn--sec mo-btn--34" onClick=${() => setEdit({ ...TURNO_VAZIO, pausas: [] })}><${Icone} nome="add" />Novo turno</button>` : null}>
      <table class="mo-tabela mo-tabela--turnos">
        <colgroup><col style=${{ width: '148px' }} /><col /><col style=${{ width: '84px' }} /><col style=${{ width: '124px' }} /><col style=${{ width: '64px' }} /><col style=${{ width: '150px' }} /><col style=${{ width: '54px' }} /><col style=${{ width: '92px' }} /></colgroup>
        <thead><tr><th scope="col">Código</th><th scope="col">Nome</th><th scope="col">Tipo</th><th scope="col">Horário · Dias</th><th scope="col">Jornada</th><th scope="col">Supervisor · Equipe</th><th scope="col">Pausas</th><th scope="col"><span class="visually-hidden">Ações</span></th></tr></thead>
        <tbody>
          ${turnos.length ? turnos.map((t) => html`<tr key=${t.id_turno}>
            <td><span class="mo-chip mo-chip--lg" style=${{ '--ea-cor': t.cor, '--ea-fg': textoLegivel(t.cor) }} title=${t.nome}>${t.codigo}</span></td>
            <td><span class="mo-trunca" title=${t.nome}>${t.nome}</span>${t.ativo ? '' : html` <span class="mon-tag">Inativo</span>`}</td>
            <td><span class="mo-tipo">${t.especial ? 'ESPECIAL' : (TIPOS_TURNO[t.tipo] || t.tipo)}</span></td>
            <td><span class="mo-num">${t.entrada ? `${t.entrada}–${t.saida}` : '—'}</span><small class="mo-sub2" title="Dias da semana em que o turno vale">${t.dias_rotulo || '—'}</small></td>
            <td><span class="mo-num">${t.entrada ? minutosParaHoras(t.minutos || 0) : '—'}</span>${t.id_contrato ? html`<small class="mo-sub2">${(contratos.find((c) => c.id_contrato === t.id_contrato) || {}).codigo || ''}</small>` : null}</td>
            <td>${t.supervisor ? html`<span class="mo-trunca" title=${t.supervisor}>${t.supervisor}</span>${t.equipe ? html`<small class="mo-sub2 mo-trunca" title=${`Equipe ${t.equipe}`}>Equipe ${t.equipe}</small>` : html`<small class="mo-sub2">—</small>`}` : '—'}</td>
            <td class="mo-num">${t.pausas.length ? html`<span title=${descreverTurno(t).split(' · ').slice(1).join(' · ')}>${t.pausas.length}</span>` : '—'}</td>
            <td class="mo-acoes-celula">${podeEditar ? html`<${MenuAcoesProcesso} ariaLabel=${`Ações do turno ${t.codigo}`} label="Ações" mostrarLabel=${true} icon="expand_more" triggerClassName="mo-btn mo-btn--neutro mo-btn--30"
              acoes=${[
                { label: 'Editar', icon: 'edit', onClick: () => abrirEdicao(t) },
                t.tipo === 'TRABALHO' && t.ativo ? { label: 'Personalizar', icon: 'tune', onClick: () => setPersonalizar(t) } : null,
                ['TRABALHO', 'SOBREAVISO', 'FERIAS', 'ESCALADO'].includes(t.tipo) ? { label: 'Excluir', icon: 'delete', danger: true, onClick: () => excluir(t) } : null,
              ]} />` : null}</td></tr>`)
          : html`<tr><td colspan="8" class="mo-vazio">Nenhum turno cadastrado.${podeEditar ? html` <button type="button" class="mo-btn mo-btn--sec mo-btn--30" onClick=${() => setEdit({ ...TURNO_VAZIO, pausas: [] })}><${Icone} nome="add" />Novo turno</button>` : null}</td></tr>`}
        </tbody>
      </table>
    </${CardRecolhivel}>
    ${edit ? html`<${ModalTurno} operacao=${operacao} inicial=${edit} contratos=${contratos} supervisores=${supervisores} showToast=${showToast} onClose=${() => setEdit(null)} onSalvo=${() => { setEdit(null); recarregar(); }} />` : null}
    ${personalizar ? html`<${ModalPersonalizarTurno} operacao=${operacao} turno=${personalizar} operadores=${operadores} showToast=${showToast} onClose=${() => setPersonalizar(null)} onMudou=${recarregar} />` : null}`;
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
  const normaliza = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const filtrados = operadores.filter((o) => !busca.trim() || normaliza(o.nome).includes(normaliza(busca.trim())));
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
  return html`<${ModalForm} titulo=${form.id_item ? 'Editar item do calendário' : 'Novo item do calendário'} onClose=${onClose} onSubmit=${salvar} erro=${erro} salvando=${salvando}>
    <div class="wfm-grade-form">
      <${Campo} rotulo="Tipo" span=${4}><select class="form-select" value=${form.tipo} onChange=${(e) => set('tipo', e.target.value)}>${Object.entries(ROTULO_TIPO_EVENTO).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></${Campo}>
      <${Campo} rotulo="Data inicial" span=${4}><input class="form-control" type="date" value=${form.data_ini} onInput=${(e) => setForm({ ...form, data_ini: e.target.value, data_fim: form.data_fim || e.target.value })} /></${Campo}>
      <${Campo} rotulo="Data final" span=${4}><input class="form-control" type="date" value=${form.data_fim} onInput=${(e) => set('data_fim', e.target.value)} /></${Campo}>
      <${Campo} rotulo="Descrição" span=${usaTurno ? 6 : 12}><input class="form-control" maxlength="200" value=${form.descricao} onInput=${(e) => set('descricao', e.target.value)} /></${Campo}>
      ${usaTurno ? html`<${Campo} rotulo="Turno" span=${form.tipo === 'HORARIO_ESPECIAL' ? 2 : 6}><select class="form-select" value=${form.id_turno} onChange=${(e) => set('id_turno', e.target.value)}><option value="">Selecione</option>${trabalho.map((t) => html`<option key=${t.id_turno} value=${t.id_turno}>${t.codigo} · ${t.nome}</option>`)}</select></${Campo}>` : null}
      ${feriado ? html`<fieldset class="wfm-feriado" style=${{ gridColumn: 'span 12' }}>
        <legend>Neste feriado, a escala…</legend>
        <label class="wfm-check"><input type="radio" name="gera-servico" checked=${!form.gera_servico} onChange=${() => setForm({ ...form, gera_servico: false })} /> Não gera serviço — todos ficam de Folga nesse(s) dia(s)</label>
        <label class="wfm-check"><input type="radio" name="gera-servico" checked=${!!form.gera_servico} onChange=${() => setForm({ ...form, gera_servico: true })} /> Gera serviço — escolho quem trabalha e o horário (os demais ficam de Folga)</label>
        ${form.gera_servico ? html`<div class="wfm-feriado-servico">
          <div class="wfm-grade-form">
            <${Campo} rotulo="Turno de quem trabalha" span=${6}><select class="form-select" value=${servico.id_turno} onChange=${(e) => setServico('id_turno', e.target.value)}><option value="">Selecione</option>${trabalho.map((t) => html`<option key=${t.id_turno} value=${t.id_turno}>${t.codigo} · ${t.nome}${t.entrada ? ` (${t.entrada}–${t.saida})` : ''}</option>`)}</select></${Campo}>
            <${Campo} rotulo="Entrada (opcional)" span=${3} dica="Em branco = horário do turno"><input class="form-control" type="time" value=${servico.entrada} onInput=${(e) => setServico('entrada', e.target.value)} /></${Campo}>
            <${Campo} rotulo="Saída (opcional)" span=${3}><input class="form-control" type="time" value=${servico.saida} onInput=${(e) => setServico('saida', e.target.value)} /></${Campo}>
          </div>
          <div class="wfm-feriado-pessoas" role="group" aria-label="Quem vai trabalhar">
            <div class="wfm-feriado-cab">
              <input class="form-control" type="search" aria-label="Buscar colaborador" placeholder="Buscar colaborador" value=${busca} onInput=${(e) => setBusca(e.target.value)} />
              <label class="wfm-check"><input type="checkbox" checked=${todosFiltrados} onChange=${alternarTodos} /> Marcar todos</label>
              <span class="mon-muted">${servico.ids_operadores.length} de ${operadores.length} vão trabalhar</span>
            </div>
            <ul class="wfm-feriado-lista">${filtrados.length ? filtrados.map((o) => html`<li key=${o.id_usuario}><label class="wfm-check"><input type="checkbox" checked=${marcados.has(o.id_usuario)} onChange=${() => alternarOp(o.id_usuario)} /> ${o.nome}</label></li>`) : html`<li class="mon-muted">Nenhum colaborador encontrado.</li>`}</ul>
          </div>
        </div>` : null}
        <p class="mon-muted">O que for definido aqui é aplicado na escala assim que você salvar o feriado. Se a escala já estava aprovada, ela volta a rascunho e precisa ser aprovada de novo.</p>
      </fieldset>` : null}
      ${form.tipo === 'HORARIO_ESPECIAL' ? html`<${Campo} rotulo="Nova entrada" span=${2}><input class="form-control" type="time" value=${form.entrada} onInput=${(e) => set('entrada', e.target.value)} /></${Campo}><${Campo} rotulo="Nova saída" span=${2}><input class="form-control" type="time" value=${form.saida} onInput=${(e) => set('saida', e.target.value)} /></${Campo}>` : null}
    </div>
  </${ModalForm}>`;
}

function Calendario({ operacao, eventos, turnos, operadores = [], podeEditar, recarregar, showToast }) {
  const [edit, setEdit] = useState(null);
  const remover = async (ev) => {
    try { await salvarEventoWfm({ ...ev, operacao, ativo: false }, ev.id_item); recarregar(); } catch (err) { showToast?.(falhaAo('remover o item do calendário', err), 'error'); }
  };
  return html`
    <${CardRecolhivel} titulo="Calendário especial" contador=${eventos.length} descricao="Feriado · Data especial (informativa) · Dia especial (o dia todo usa um turno) · Horário especial (muda entrada e saída de um turno)."
      acoes=${podeEditar ? html`<button type="button" class="mo-btn mo-btn--sec mo-btn--34" onClick=${() => setEdit({ ...EVENTO_VAZIO })}><${Icone} nome="add" />Novo item</button>` : null}>
      <ul class="mo-cal-lista">
        ${eventos.length ? eventos.map((ev) => {
          const curta = (iso) => iso.split('-').reverse().slice(0, 2).join('/');
          const turno = ev.id_turno ? (turnos.find((t) => t.id_turno === ev.id_turno)?.codigo || '') : '';
          const extra = [turno, ev.entrada ? `${ev.entrada}–${ev.saida}` : '', ev.tipo === 'FERIADO' ? (ev.gera_servico ? `serviço: ${(ev.servico?.ids_operadores || []).length} pessoa(s)` : 'folga para todos') : ''].filter(Boolean).join(' · ');
          return html`<li key=${ev.id_item} class="mo-cal-lin">
            <span class="mo-cal-data">${curta(ev.data_ini)}${ev.data_fim !== ev.data_ini ? ` a ${curta(ev.data_fim)}` : ''}</span>
            <span class="mo-cal-meio"><span class="mo-trunca mo-cal-nome" title=${`${ev.descricao}${extra ? ` · ${extra}` : ''}`}>${ev.descricao}${extra ? html` <small class="mo-sub2">${extra}</small>` : null}</span>
              <span class="mo-pilula mo-pilula--info">${ROTULO_TIPO_EVENTO[ev.tipo] || ev.tipo}</span></span>
            ${podeEditar ? html`<span class="mo-cal-acoes"><button type="button" class="mo-btn mo-btn--neutro mo-btn--30" onClick=${() => setEdit({ ...ev, id_turno: ev.id_turno || '', entrada: ev.entrada || '', saida: ev.saida || '' })}>Editar</button><button type="button" class="mo-btn mo-btn--erro mo-btn--30" onClick=${() => remover(ev)}>Remover</button></span>` : null}
          </li>`; })
        : html`<li class="mo-vazio">Nenhum item neste mês.</li>`}
      </ul>
    </${CardRecolhivel}>
    ${edit ? html`<${ModalEvento} operacao=${operacao} inicial=${edit} turnos=${turnos} operadores=${operadores} showToast=${showToast} onClose=${() => setEdit(null)} onSalvo=${() => { setEdit(null); recarregar(); }} />` : null}`;
}

function Skills({ operacao, skills, operadores, podeEditar, recarregar, showToast }) {
  const [form, setForm] = useState({ categoria: 'IDIOMA', nome: '' });
  const [editandoOp, setEditandoOp] = useState(null);
  const [verForm, setVerForm] = useState(false);
  const adicionar = async (e) => {
    e.preventDefault();
    try { await salvarSkillWfm({ ...form, operacao }); setForm({ ...form, nome: '' }); recarregar(); showToast?.('Skill adicionada.', 'success'); } catch (err) { showToast?.(err?.message || 'Não foi possível salvar.', 'error'); }
  };
  const salvarOp = async () => {
    try { await definirSkillsOperadorWfm(editandoOp.id_usuario, { operacao, ids_skill: editandoOp.skills }); setEditandoOp(null); recarregar(); showToast?.('Skills do operador salvas.', 'success'); } catch (err) { showToast?.(err?.message || 'Não foi possível salvar.', 'error'); }
  };
  const alternar = (id) => setEditandoOp({ ...editandoOp, skills: editandoOp.skills.includes(id) ? editandoOp.skills.filter((s) => s !== id) : [...editandoOp.skills, id] });
  const ativas = skills.filter((s) => s.ativo);
  return html`
    <${CardRecolhivel} titulo="Skills" contador=${skills.length} className="mo-cartao-skills"
      acoes=${podeEditar ? html`<button type="button" class="mo-btn mo-btn--sec mo-btn--34" aria-expanded=${verForm} onClick=${() => setVerForm(!verForm)}><${Icone} nome="add" />Adicionar</button>` : null}>
      <div class="mo-skills">
        <div class="wfm-chips">${skills.length ? skills.map((s) => html`<span key=${s.id_skill} class="mo-skill">${CATEGORIAS_SKILL[s.categoria]} · ${s.nome}</span>`) : html`<span class="mon-muted">Nenhuma skill cadastrada.</span>`}</div>
        ${podeEditar && verForm ? html`<form class="wfm-linha-form" onSubmit=${adicionar}>
          <label class="wfm-campo"><span>Categoria</span><select class="form-select" value=${form.categoria} onChange=${(e) => setForm({ ...form, categoria: e.target.value })}>${Object.entries(CATEGORIAS_SKILL).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></label>
          <label class="wfm-campo"><span>Nome</span><input class="form-control" required maxlength="120" value=${form.nome} onInput=${(e) => setForm({ ...form, nome: e.target.value })} /></label>
          <button type="submit" class="btn btn-primary btn-sm">Adicionar</button></form>` : null}
        <h3 class="mo-skills-sub">Skills por operador</h3>
        <table class="mo-tabela"><thead><tr><th scope="col">Operador</th><th scope="col">Skills</th><th scope="col"><span class="visually-hidden">Ações</span></th></tr></thead><tbody>
          ${operadores.map((o) => html`<${Fragment} key=${o.id_usuario}>
            <tr><td><span class="mo-trunca" title=${o.nome}>${o.nome}</span></td><td>${(o.skills || []).map((id) => skills.find((s) => s.id_skill === id)?.nome).filter(Boolean).join(', ') || '—'}</td>
              <td class="mo-acoes-celula">${podeEditar ? html`<button type="button" class="mo-btn mo-btn--neutro mo-btn--30" onClick=${() => setEditandoOp(editandoOp?.id_usuario === o.id_usuario ? null : { id_usuario: o.id_usuario, nome: o.nome, skills: [...(o.skills || [])] })}>${editandoOp?.id_usuario === o.id_usuario ? 'Fechar' : 'Editar'}</button>` : null}</td></tr>
            ${editandoOp?.id_usuario === o.id_usuario ? html`<tr class="wfm-linha-edicao"><td colspan="3">
              ${ativas.length ? html`<div class="wfm-chips">${ativas.map((s) => html`<label key=${s.id_skill} class="wfm-check"><input type="checkbox" checked=${editandoOp.skills.includes(s.id_skill)} onChange=${() => alternar(s.id_skill)} /> ${CATEGORIAS_SKILL[s.categoria]} · ${s.nome}</label>`)}</div>` : html`<span class="mon-muted">Cadastre ao menos uma skill acima para atribuir ao operador.</span>`}
              <div class="wfm-acoes"><button type="button" class="btn btn-primary btn-sm" onClick=${salvarOp}>Salvar skills</button><button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setEditandoOp(null)}>Cancelar</button></div></td></tr>` : null}
          </${Fragment}>`)}
        </tbody></table>
      </div>
    </${CardRecolhivel}>`;
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
    <${CardRecolhivel} titulo="Tipos de escala (setor de TI)" descricao="Cada tipo é uma escala própria do setor de Tecnologia (ex.: Plantão de sábado, Sobreaviso), com turnos, calendário e aprovação independentes." className="mo-cartao-tipos" aberta=${false}
      acoes=${html`<button type="button" class="mo-btn mo-btn--sec mo-btn--34" onClick=${() => setForm({ nome: '', descricao: '', ativo: true })}><${Icone} nome="add" />Nova escala</button>`}>
      <div class="wfm-tipos">
        ${form ? html`<form class="wfm-tipo-form" onSubmit=${salvar}>
          <label class="mon-campo"><span>Nome da escala</span><input class="form-control" required maxlength="120" value=${form.nome} onInput=${(e) => setForm({ ...form, nome: e.target.value })} /></label>
          <label class="mon-campo"><span>Descrição</span><input class="form-control" maxlength="200" value=${form.descricao} onInput=${(e) => setForm({ ...form, descricao: e.target.value })} /></label>
          <button type="submit" class="btn btn-primary btn-sm" disabled=${salvando || !form.nome.trim()}>Salvar</button>
          <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setForm(null)}>Cancelar</button>
        </form>` : null}
        <div class="wfm-tipos-lista">
          ${!itens ? html`<div class="wfm-tipo-linha mon-muted">Carregando…</div>` : itens.length ? itens.map((t) => html`<div key=${t.id_tipo} class="wfm-tipo-linha">
            <span class="wfm-tipo-nome">${t.nome}${t.descricao ? html`<small>${t.descricao}</small>` : null}</span>
            <span class=${`mon-badge ${t.ativo ? 'mon-badge--ok' : 'mon-badge--nula'}`}>${t.ativo ? 'Ativa' : 'Desativada'}</span>
            <span class="wfm-tipo-acoes">
              <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setForm({ id_tipo: t.id_tipo, nome: t.nome, descricao: t.descricao || '', ativo: t.ativo })}>Editar</button>
              <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => alternar(t)}>${t.ativo ? 'Desativar' : 'Ativar'}</button>
              <button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => excluir(t)}>Excluir</button>
            </span></div>`) : html`<div class="wfm-tipo-linha mon-muted">Nenhuma escala cadastrada.</div>`}
        </div>
      </div>
    </${CardRecolhivel}>`;
}

export function TelaCadastros({ controlador, contexto, operacao, anoMes, showToast, recarregarContexto }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const carregar = useCallback(async () => {
    if (!operacao) { setDados({ supervisores: [], contratos: [], turnos: [], skills: [], eventos: [], operadores: [] }); return; }
    setErro('');
    try {
      const [contratos, turnos, skills, eventos, escala, supervisores] = await Promise.all([
        listarContratosWfm(operacao), listarTurnosWfm(operacao), listarSkillsWfm(operacao), listarCalendarioWfm(operacao, anoMes), lerEscalaWfm(operacao, anoMes).catch(() => ({ operadores: [] })),
        listarSupervisoresWfm(operacao).catch(() => ({ itens: [] })),
      ]);
      setDados({ supervisores: supervisores.itens, contratos: contratos.itens, turnos: turnos.itens, skills: skills.itens, eventos: eventos.itens, operadores: escala.operadores });
    } catch (e) { setDados(null); setErro(e?.message || 'Não foi possível carregar os cadastros.'); }
  }, [operacao, anoMes]);
  useEffect(() => { setDados(null); carregar(); }, [carregar]);
  if (erro) return html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  if (!dados) return html`<${LoadingState} titulo="Carregando os cadastros" />`;
  const podeCadastros = controlador.possuiPermissao('wfm.cadastros.editar');
  const comum = { operacao, showToast, recarregar: carregar };
  return html`
    ${!operacao ? html`<p class="mon-muted wfm-vazio-txt">Os turnos, o calendário especial e as skills pertencem a uma escala. Clique em "Nova escala" (ou ative uma existente) acima: assim que ela existir, escolha-a no seletor "Escala / operação" que aparece no topo e o cadastro de turnos é liberado.</p>` : null}
    <div class="mo-cad">
      <div class="mo-cad-esq">
        ${contexto?.pode_editar_tipos_escala ? html`<${TiposEscala} recarregarContexto=${recarregarContexto} showToast=${showToast} />` : null}
        ${operacao ? html`<${Turnos} ...${comum} turnos=${dados.turnos} contratos=${dados.contratos} supervisores=${dados.supervisores} operadores=${dados.operadores} podeEditar=${podeCadastros} />` : null}
      </div>
      ${operacao ? html`<div class="mo-cad-dir">
        <${Calendario} ...${comum} eventos=${dados.eventos} turnos=${dados.turnos} operadores=${dados.operadores} podeEditar=${podeCadastros} />
        <${Skills} ...${comum} skills=${dados.skills} operadores=${dados.operadores} podeEditar=${podeCadastros} />
      </div>` : null}
    </div>`;
}
