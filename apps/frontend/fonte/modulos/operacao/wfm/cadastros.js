import { html, useCallback, useEffect, useState, React } from '../../infraestrutura-react.js';

const Fragment = React.Fragment;
import { LoadingState } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import {
  definirSkillsOperadorWfm,
  lerEscalaWfm,
  listarCalendarioWfm,
  listarContratosWfm,
  listarSkillsWfm,
  listarSupervisoresWfm,
  listarTiposEscalaWfm,
  listarTurnosWfm,
  salvarEventoWfm,
  salvarSkillWfm,
  salvarTurnoWfm,
  excluirTurnoWfm,
  excluirEscalaWfm,
  salvarTipoEscalaWfm,
} from '../../services/api/wfm.js';
import { ROTULO_TIPO_EVENTO, minutosParaHoras } from './comum.js';
import { descreverTurno } from './escala.js';
import { BotaoAdicionar, BotaoRemover, Campo, Marca, ModalForm, Secao } from './formulario.js';
import { TIPOS_PAUSA } from './jornadas.js';

// Cadastros do WFM: turnos, calendário especial (feriado, data, dia e horário especiais) e skills.

const CATEGORIAS_SKILL = { IDIOMA: 'Idioma', PRODUTO: 'Produto', RETENCAO: 'Retenção', OUTRO: 'Outro' };
export const TURNO_VAZIO = { codigo: '', nome: '', tipo: 'TRABALHO', cor: '#1f5fbf', entrada: '08:00', saida: '16:00', id_contrato: '', id_supervisor: '', pausas: [], ativo: true };
const EVENTO_VAZIO = { tipo: 'FERIADO', data_ini: '', data_fim: '', descricao: '', id_turno: '', entrada: '', saida: '' };

const paraMin = (hhmm) => { const [h, m] = (hhmm || '00:00').split(':').map(Number); return h * 60 + m; };
const horaDe = (min) => `${String(Math.floor((((min % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String((((min % 1440) + 1440) % 1440) % 60).padStart(2, '0')}`;
const offsetDe = (entrada, inicio) => (((paraMin(inicio) - paraMin(entrada)) % 1440) + 1440) % 1440;

// Turno atrelado a jornada: saída = entrada + jornada (+ intervalos não remunerados).
const saidaCalculada = (t, contratos) => {
  const c = contratos.find((x) => String(x.id_contrato) === String(t.id_contrato));
  if (!c || !t.entrada) return '';
  return horaDe(paraMin(t.entrada) + c.jornada_diaria_max_min + (t.pausas || []).filter((p) => p.tipo === 'INTERVALO').reduce((a, p) => a + Number(p.duracao_min || 0), 0));
};

export function ModalTurno({ operacao, inicial, contratos, supervisores = [], onClose, onSalvo, showToast }) {
  const [edit, setEdit] = useState(inicial);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const set = (k, v) => setEdit((e) => ({ ...e, [k]: v }));
  const setPausa = (i, k, v) => setEdit((e) => ({ ...e, pausas: e.pausas.map((p, j) => (j === i ? { ...p, [k]: ['tipo', 'inicio'].includes(k) ? v : Number(v) } : p)) }));
  const trabalho = edit.tipo === 'TRABALHO';
  const comJornada = !!edit.id_contrato;
  const saida = comJornada ? saidaCalculada(edit, contratos) : edit.saida;

  const salvar = async (ev) => {
    ev.preventDefault();
    if (!edit.codigo.trim() || !edit.nome.trim()) return setErro('Informe o código e o nome do turno.');
    if (trabalho && (!edit.entrada || !saida)) return setErro('Informe o horário de entrada e de saída.');
    if (trabalho && edit.entrada === saida) return setErro('Entrada e saída não podem ser iguais.');
    setErro('');
    setSalvando(true);
    try {
      const pausas = (edit.pausas || []).map((p) => ({ offset_min: offsetDe(edit.entrada, p.inicio), duracao_min: Math.max(Number(p.duracao_min) || 1, 1), tipo: p.tipo }));
      await salvarTurnoWfm({ ...edit, pausas, operacao, saida, id_contrato: comJornada ? Number(edit.id_contrato) : null, id_supervisor: edit.id_supervisor ? Number(edit.id_supervisor) : null }, edit.id_turno);
      showToast?.('Turno salvo.', 'success');
      onSalvo();
    } catch (err) { setErro(err?.message || 'Não foi possível salvar o turno.'); } finally { setSalvando(false); }
  };

  return html`<${ModalForm} titulo=${edit.id_turno ? `Editar turno ${edit.codigo}` : 'Novo turno'} onClose=${onClose} onSubmit=${salvar} erro=${erro} salvando=${salvando} salvarRotulo="Salvar turno">
    <div class="wfm-grade-form">
      <${Campo} rotulo="Código" span=${3}><input class="form-control" maxlength="20" disabled=${!!edit.id_turno} value=${edit.codigo} onInput=${(e) => set('codigo', e.target.value)} /></${Campo}>
      <${Campo} rotulo="Nome" span=${5}><input class="form-control" maxlength="120" value=${edit.nome} onInput=${(e) => set('nome', e.target.value)} /></${Campo}>
      <${Campo} rotulo="Tipo" span=${3}><select class="form-select" value=${edit.tipo} disabled=${!!edit.id_turno} onChange=${(e) => set('tipo', e.target.value)}><option value="TRABALHO">Trabalho</option><option value="FOLGA">Folga</option><option value="DSR">DSR</option></select></${Campo}>
      <${Campo} rotulo="Cor" span=${1}><input class="form-control form-control-color wfm-cor" type="color" value=${edit.cor} onInput=${(e) => set('cor', e.target.value)} /></${Campo}>
      ${trabalho ? html`
        <${Campo} rotulo="Entrada" span=${3}><input class="form-control" type="time" value=${edit.entrada} onInput=${(e) => set('entrada', e.target.value)} /></${Campo}>
        <${Campo} rotulo="Saída" span=${3} dica=${comJornada ? 'Calculada: entrada + jornada' : 'Atravessa a meia-noite se menor que a entrada'}><input class="form-control" type="time" disabled=${comJornada} value=${saida} onInput=${(e) => set('saida', e.target.value)} /></${Campo}>
        <${Campo} rotulo="Jornada (opcional)" span=${6}><select class="form-select" value=${edit.id_contrato || ''} onChange=${(e) => set('id_contrato', e.target.value)}>
          <option value="">Sem jornada</option>${contratos.filter((c) => c.ativo).map((c) => html`<option key=${c.id_contrato} value=${c.id_contrato}>${c.codigo} · ${minutosParaHoras(c.jornada_diaria_max_min)}</option>`)}</select></${Campo}>
        <${Campo} rotulo="Supervisor (opcional)" span=${5}><select class="form-select" value=${edit.id_supervisor || ''} onChange=${(e) => set('id_supervisor', e.target.value)}>
          <option value="">Nenhum</option>${supervisores.map((s) => html`<option key=${s.id_usuario} value=${s.id_usuario}>${s.nome}</option>`)}</select></${Campo}>
        <${Campo} rotulo="Equipe" span=${4} dica="A equipe vem do supervisor escolhido"><input class="form-control" disabled value=${(supervisores.find((s) => String(s.id_usuario) === String(edit.id_supervisor)) || {}).equipe || '—'} /></${Campo}>
        <${Marca} rotulo="Ativo" span=${3} checked=${edit.ativo} onChange=${(v) => set('ativo', v)} />` : html`<${Marca} rotulo="Ativo" span=${12} checked=${edit.ativo} onChange=${(v) => set('ativo', v)} />`}
    </div>
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
  </${ModalForm}>`;
}

// Turno vindo da API -> estado do formulário (pausas com horário de início real).
export const turnoParaEdicao = (t) => ({
  ...t,
  entrada: t.entrada || '',
  saida: t.saida || '',
  id_contrato: t.id_contrato || '',
  id_supervisor: t.id_supervisor || '',
  pausas: (t.pausas || []).map((p) => ({ inicio: t.entrada ? horaDe(paraMin(t.entrada) + p.offset_min) : '00:00', duracao_min: p.duracao_min, tipo: p.tipo })),
});

function Turnos({ operacao, turnos, contratos, supervisores, podeEditar, recarregar, showToast }) {
  const [edit, setEdit] = useState(null);
  const abrirEdicao = (t) => setEdit(turnoParaEdicao(t));
  const excluir = async (t) => {
    if (!window.confirm(`Excluir o turno ${t.codigo} (${t.nome})? Só é possível se ele nunca foi usado em uma escala.`)) return;
    try { await excluirTurnoWfm(operacao, t.id_turno); showToast?.('Turno excluído.', 'success'); recarregar(); }
    catch (err) { showToast?.(err?.message || 'Não foi possível excluir o turno.', 'error'); }
  };
  return html`
    <${Secao} titulo="Turnos"
      acoes=${podeEditar ? html`<button type="button" class="btn btn-outline-primary btn-sm" onClick=${() => setEdit({ ...TURNO_VAZIO, pausas: [] })}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Novo turno</button>` : null}>
      <div class="mon-tabela-wrap"><table class="mon-tabela wfm-tabela"><thead><tr><th>Código</th><th>Nome</th><th>Tipo</th><th>Horário</th><th>Jornada</th><th>Supervisor · Equipe</th><th>Pausas</th><th></th></tr></thead><tbody>
        ${turnos.map((t) => html`<tr key=${t.id_turno}><td><span class="wfm-chip" style=${{ '--wfm-cor': t.cor }}>${t.codigo}</span></td><td>${t.nome}${t.ativo ? '' : html` <span class="mon-tag">Inativo</span>`}</td><td>${t.tipo}</td><td>${t.entrada ? `${t.entrada}–${t.saida}` : '—'}</td><td>${t.entrada ? minutosParaHoras(t.minutos || 0) : '—'}${t.id_contrato ? html`<small class="wfm-sub">${(contratos.find((c) => c.id_contrato === t.id_contrato) || {}).codigo || ''}</small>` : null}</td><td>${t.supervisor ? html`${t.supervisor}${t.equipe ? html`<small class="wfm-sub">${t.equipe}</small>` : null}` : '—'}</td><td>${t.pausas.length ? descreverTurno(t).split(' · ').slice(1).join(' · ') : '—'}</td>
          <td class="wfm-acoes-linha">${podeEditar ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => abrirEdicao(t)}>Editar</button>${t.tipo === 'TRABALHO' ? html`<button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => excluir(t)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('delete')}</span>Excluir</button>` : null}` : null}</td></tr>`)}
      </tbody></table></div>
    </${Secao}>
    ${edit ? html`<${ModalTurno} operacao=${operacao} inicial=${edit} contratos=${contratos} supervisores=${supervisores} showToast=${showToast} onClose=${() => setEdit(null)} onSalvo=${() => { setEdit(null); recarregar(); }} />` : null}`;
}

function ModalEvento({ operacao, inicial, turnos, onClose, onSalvo, showToast }) {
  const [form, setForm] = useState(inicial);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const trabalho = turnos.filter((t) => t.tipo === 'TRABALHO' && t.ativo);
  const usaTurno = ['DIA_ESPECIAL', 'HORARIO_ESPECIAL'].includes(form.tipo);
  const salvar = async (ev) => {
    ev.preventDefault();
    if (!form.data_ini || !form.data_fim || !form.descricao.trim()) return setErro('Informe as datas e a descrição.');
    if (usaTurno && !form.id_turno) return setErro('Selecione o turno.');
    if (form.tipo === 'HORARIO_ESPECIAL' && (!form.entrada || !form.saida)) return setErro('Informe a nova entrada e saída.');
    setErro('');
    setSalvando(true);
    try {
      await salvarEventoWfm({ ...form, operacao, id_turno: form.id_turno ? Number(form.id_turno) : null }, form.id_item);
      showToast?.('Item do calendário salvo.', 'success');
      onSalvo();
    } catch (err) { setErro(err?.message || 'Não foi possível salvar.'); } finally { setSalvando(false); }
  };
  return html`<${ModalForm} titulo=${form.id_item ? 'Editar item do calendário' : 'Novo item do calendário'} onClose=${onClose} onSubmit=${salvar} erro=${erro} salvando=${salvando}>
    <div class="wfm-grade-form">
      <${Campo} rotulo="Tipo" span=${4}><select class="form-select" value=${form.tipo} onChange=${(e) => set('tipo', e.target.value)}>${Object.entries(ROTULO_TIPO_EVENTO).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></${Campo}>
      <${Campo} rotulo="Data inicial" span=${4}><input class="form-control" type="date" value=${form.data_ini} onInput=${(e) => setForm({ ...form, data_ini: e.target.value, data_fim: form.data_fim || e.target.value })} /></${Campo}>
      <${Campo} rotulo="Data final" span=${4}><input class="form-control" type="date" value=${form.data_fim} onInput=${(e) => set('data_fim', e.target.value)} /></${Campo}>
      <${Campo} rotulo="Descrição" span=${usaTurno ? 6 : 12}><input class="form-control" maxlength="200" value=${form.descricao} onInput=${(e) => set('descricao', e.target.value)} /></${Campo}>
      ${usaTurno ? html`<${Campo} rotulo="Turno" span=${form.tipo === 'HORARIO_ESPECIAL' ? 2 : 6}><select class="form-select" value=${form.id_turno} onChange=${(e) => set('id_turno', e.target.value)}><option value="">Selecione</option>${trabalho.map((t) => html`<option key=${t.id_turno} value=${t.id_turno}>${t.codigo} · ${t.nome}</option>`)}</select></${Campo}>` : null}
      ${form.tipo === 'HORARIO_ESPECIAL' ? html`<${Campo} rotulo="Nova entrada" span=${2}><input class="form-control" type="time" value=${form.entrada} onInput=${(e) => set('entrada', e.target.value)} /></${Campo}><${Campo} rotulo="Nova saída" span=${2}><input class="form-control" type="time" value=${form.saida} onInput=${(e) => set('saida', e.target.value)} /></${Campo}>` : null}
    </div>
  </${ModalForm}>`;
}

function Calendario({ operacao, eventos, turnos, podeEditar, recarregar, showToast }) {
  const [edit, setEdit] = useState(null);
  const remover = async (ev) => {
    try { await salvarEventoWfm({ ...ev, operacao, ativo: false }, ev.id_item); recarregar(); } catch (err) { showToast?.(err?.message || 'Não foi possível remover.', 'error'); }
  };
  return html`
    <${Secao} titulo="Calendário especial" descricao="Feriado · Data especial (informativa) · Dia especial (o dia todo usa um turno) · Horário especial (muda entrada e saída de um turno)."
      acoes=${podeEditar ? html`<button type="button" class="btn btn-outline-primary btn-sm" onClick=${() => setEdit({ ...EVENTO_VAZIO })}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Novo item</button>` : null}>
      <div class="mon-tabela-wrap"><table class="mon-tabela wfm-tabela"><thead><tr><th>Tipo</th><th>Período</th><th>Descrição</th><th>Turno</th><th></th></tr></thead><tbody>
        ${eventos.length ? eventos.map((ev) => html`<tr key=${ev.id_item}><td>${ROTULO_TIPO_EVENTO[ev.tipo] || ev.tipo}</td><td>${ev.data_ini.split('-').reverse().join('/')}${ev.data_fim !== ev.data_ini ? ` a ${ev.data_fim.split('-').reverse().join('/')}` : ''}</td><td>${ev.descricao}</td>
          <td>${ev.id_turno ? (turnos.find((t) => t.id_turno === ev.id_turno)?.codigo || '') : ''}${ev.entrada ? ` ${ev.entrada}–${ev.saida}` : ''}</td>
          <td class="wfm-acoes-linha">${podeEditar ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setEdit({ ...ev, id_turno: ev.id_turno || '', entrada: ev.entrada || '', saida: ev.saida || '' })}>Editar</button><button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => remover(ev)}>Remover</button>` : null}</td></tr>`)
          : html`<tr><td colspan="5" class="mon-muted">Nenhum item neste mês.</td></tr>`}
      </tbody></table></div>
    </${Secao}>
    ${edit ? html`<${ModalEvento} operacao=${operacao} inicial=${edit} turnos=${turnos} showToast=${showToast} onClose=${() => setEdit(null)} onSalvo=${() => { setEdit(null); recarregar(); }} />` : null}`;
}

function Skills({ operacao, skills, operadores, podeEditar, recarregar, showToast }) {
  const [form, setForm] = useState({ categoria: 'IDIOMA', nome: '' });
  const [editandoOp, setEditandoOp] = useState(null);
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
    <${Secao} aberta=${false} titulo="Skills">
      <div class="wfm-chips">${skills.length ? skills.map((s) => html`<span key=${s.id_skill} class="mon-tag">${CATEGORIAS_SKILL[s.categoria]} · ${s.nome}</span>`) : html`<span class="mon-muted">Nenhuma skill cadastrada.</span>`}</div>
      ${podeEditar ? html`<form class="wfm-linha-form" onSubmit=${adicionar}>
        <label class="wfm-campo"><span>Categoria</span><select class="form-select" value=${form.categoria} onChange=${(e) => setForm({ ...form, categoria: e.target.value })}>${Object.entries(CATEGORIAS_SKILL).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></label>
        <label class="wfm-campo"><span>Nome</span><input class="form-control" required maxlength="120" value=${form.nome} onInput=${(e) => setForm({ ...form, nome: e.target.value })} /></label>
        <button type="submit" class="btn btn-primary btn-sm">Adicionar</button></form>` : null}
      <h4 class="wfm-sub-titulo">Skills por operador</h4>
      <div class="mon-tabela-wrap"><table class="mon-tabela wfm-tabela"><thead><tr><th>Operador</th><th>Skills</th><th></th></tr></thead><tbody>
        ${operadores.map((o) => html`<${Fragment} key=${o.id_usuario}>
          <tr><td>${o.nome}</td><td>${(o.skills || []).map((id) => skills.find((s) => s.id_skill === id)?.nome).filter(Boolean).join(', ') || '—'}</td>
            <td class="wfm-acoes-linha">${podeEditar ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setEditandoOp(editandoOp?.id_usuario === o.id_usuario ? null : { id_usuario: o.id_usuario, nome: o.nome, skills: [...(o.skills || [])] })}>${editandoOp?.id_usuario === o.id_usuario ? 'Fechar' : 'Editar'}</button>` : null}</td></tr>
          ${editandoOp?.id_usuario === o.id_usuario ? html`<tr class="wfm-linha-edicao"><td colspan="3">
            ${ativas.length ? html`<div class="wfm-chips">${ativas.map((s) => html`<label key=${s.id_skill} class="wfm-check"><input type="checkbox" checked=${editandoOp.skills.includes(s.id_skill)} onChange=${() => alternar(s.id_skill)} /> ${CATEGORIAS_SKILL[s.categoria]} · ${s.nome}</label>`)}</div>` : html`<span class="mon-muted">Cadastre ao menos uma skill acima para atribuir ao operador.</span>`}
            <div class="wfm-acoes"><button type="button" class="btn btn-primary btn-sm" onClick=${salvarOp}>Salvar skills</button><button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setEditandoOp(null)}>Cancelar</button></div></td></tr>` : null}
        </${Fragment}>`)}
      </tbody></table></div>
    </${Secao}>`;
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
    <${Secao} titulo="Tipos de escala (setor de TI)" descricao="Cada tipo é uma escala própria do setor de Tecnologia (ex.: Plantão de sábado, Sobreaviso), com turnos, calendário e aprovação independentes."
      acoes=${html`<button type="button" class="btn btn-outline-primary btn-sm" onClick=${() => setForm({ nome: '', descricao: '', ativo: true })}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Nova escala</button>`}>
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
    </${Secao}>`;
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
    ${contexto?.pode_editar_tipos_escala ? html`<${TiposEscala} recarregarContexto=${recarregarContexto} showToast=${showToast} />` : null}
    ${!operacao ? html`<p class="mon-muted wfm-vazio-txt">Os turnos, o calendário especial e as skills pertencem a uma escala. Clique em "Nova escala" (ou ative uma existente) acima: assim que ela existir, escolha-a no seletor "Escala / operação" que aparece no topo e o cadastro de turnos é liberado.</p>` : html`
    <${Turnos} ...${comum} turnos=${dados.turnos} contratos=${dados.contratos} supervisores=${dados.supervisores} podeEditar=${podeCadastros} />
    <${Calendario} ...${comum} eventos=${dados.eventos} turnos=${dados.turnos} podeEditar=${podeCadastros} />
    <${Skills} ...${comum} skills=${dados.skills} operadores=${dados.operadores} podeEditar=${podeCadastros} />`}`;
}
