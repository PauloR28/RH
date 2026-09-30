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
  listarTurnosWfm,
  salvarContratoWfm,
  salvarEventoWfm,
  salvarSkillWfm,
  salvarTurnoWfm,
  vincularContratoOperadorWfm,
} from '../../services/api/wfm.js';
import { ROTULO_TIPO_EVENTO, minutosParaHoras } from './comum.js';
import { descreverTurno } from './escala.js';

// Cadastros do WFM: contratos e limites do motor (Adm e Control Desk), turnos-modelo, skills,
// calendário especial (feriado, data, dia e horário especiais) e vínculos dos operadores.

const Campo = ({ rotulo, children }) => html`<label class="mon-campo"><span>${rotulo}</span>${children}</label>`;
const CATEGORIAS_SKILL = { IDIOMA: 'Idioma', PRODUTO: 'Produto', RETENCAO: 'Retenção', OUTRO: 'Outro' };
const TIPOS_PAUSA = { DESCANSO: 'Descanso', REFEICAO: 'Refeição', LANCHE: 'Lanche', OUTRA: 'Outra' };
const CONTRATO_VAZIO = { codigo: '', nome: '', tipo: 'CLT', jornada_diaria_max_min: 480, interjornada_min_min: 660, max_dias_consecutivos: 6, jornada_feriado_max_min: '', jornada_bloqueio_duro: false, exigencias_pausa: [], ativo: true };
const TURNO_VAZIO = { codigo: '', nome: '', tipo: 'TRABALHO', cor: '#1f5fbf', entrada: '08:00', saida: '16:00', pausas: [], ativo: true };
const EVENTO_VAZIO = { tipo: 'FERIADO', data_ini: '', data_fim: '', descricao: '', id_turno: '', entrada: '', saida: '' };

const paraMin = (hhmm) => { const [h, m] = (hhmm || '00:00').split(':').map(Number); return h * 60 + m; };
const horaDe = (min) => `${String(Math.floor((((min % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String((((min % 1440) + 1440) % 1440) % 60).padStart(2, '0')}`;
const offsetDe = (entrada, inicio) => (((paraMin(inicio) - paraMin(entrada)) % 1440) + 1440) % 1440;

// Turnos de exemplo (CLT 6h com as pausas obrigatórias da NR-17: 2 descansos de 10 min + 1 refeição de 20 min).
const TURNOS_EXEMPLO = [
  { codigo: 'M', nome: 'Manhã', cor: '#1f5fbf', entrada: '06:00', saida: '12:20', pausas: [['07:30', 10, 'DESCANSO'], ['09:00', 20, 'REFEICAO'], ['10:40', 10, 'DESCANSO']] },
  { codigo: 'T', nome: 'Tarde', cor: '#b45309', entrada: '12:00', saida: '18:20', pausas: [['13:30', 10, 'DESCANSO'], ['15:00', 20, 'REFEICAO'], ['16:40', 10, 'DESCANSO']] },
  { codigo: 'N', nome: 'Noite', cor: '#475569', entrada: '18:00', saida: '00:20', pausas: [['19:30', 10, 'DESCANSO'], ['21:00', 20, 'REFEICAO'], ['22:40', 10, 'DESCANSO']] },
];

function Secao({ titulo, descricao, acoes, children }) {
  return html`<section class="mon-card"><div class="wfm-cabecalho"><div><h3>${titulo}</h3><p class="mon-muted">${descricao}</p></div><div class="wfm-acoes-cab">${acoes}</div></div>${children}</section>`;
}

function Contratos({ operacao, contratos, podeEditar, recarregar, showToast }) {
  const [edit, setEdit] = useState(null);
  const salvar = async (e) => {
    e.preventDefault();
    try {
      await salvarContratoWfm({ ...edit, operacao, jornada_feriado_max_min: edit.jornada_feriado_max_min === '' ? null : Number(edit.jornada_feriado_max_min) }, edit.id_contrato);
      showToast?.('Contrato salvo.', 'success');
      setEdit(null);
      recarregar();
    } catch (err) { showToast?.(err?.message || 'Não foi possível salvar o contrato.', 'error'); }
  };
  const set = (k, v) => setEdit({ ...edit, [k]: v });
  const setPausa = (i, k, v) => setEdit({ ...edit, exigencias_pausa: edit.exigencias_pausa.map((p, j) => (j === i ? { ...p, [k]: k === 'tipo' ? v : Number(v) } : p)) });
  return html`
    <${Secao} titulo="Contratos de jornada" descricao="Limites do motor de regras. Todos são parâmetros editáveis; nenhum é fixo no código."
      acoes=${podeEditar ? html`<button type="button" class="btn btn-outline-primary" onClick=${() => setEdit({ ...CONTRATO_VAZIO })}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Novo contrato</button>` : null}>
      <div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Código</th><th>Nome</th><th>Tipo</th><th>Jornada máx.</th><th>Interjornada</th><th>Dias seguidos</th><th>Bloqueio por lei</th><th></th></tr></thead><tbody>
        ${contratos.map((c) => html`<tr key=${c.id_contrato}><td><b>${c.codigo}</b></td><td>${c.nome}${c.ativo ? '' : ' (inativo)'}</td><td>${c.tipo}</td><td>${minutosParaHoras(c.jornada_diaria_max_min)}</td><td>${minutosParaHoras(c.interjornada_min_min)}</td><td>${c.max_dias_consecutivos}</td><td>${c.jornada_bloqueio_duro ? 'Sim' : 'Não'}</td>
          <td>${podeEditar ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setEdit({ ...c, jornada_feriado_max_min: c.jornada_feriado_max_min ?? '' })}>Editar</button>` : null}</td></tr>`)}
      </tbody></table></div>
      ${edit ? html`<form class="wfm-form" onSubmit=${salvar}>
        <div class="mon-form-grid">
          <${Campo} rotulo="Código"><input class="form-control" required maxlength="30" disabled=${!!edit.id_contrato} value=${edit.codigo} onInput=${(e) => set('codigo', e.target.value)} /></${Campo}>
          <${Campo} rotulo="Nome"><input class="form-control" required maxlength="120" value=${edit.nome} onInput=${(e) => set('nome', e.target.value)} /></${Campo}>
          <${Campo} rotulo="Tipo"><select class="form-select" value=${edit.tipo} onChange=${(e) => set('tipo', e.target.value)}><option value="ESTAGIARIO">Estagiário</option><option value="CLT">CLT</option><option value="TERCEIRO">Terceiro</option><option value="APRENDIZ">Jovem aprendiz</option></select></${Campo}>
          <${Campo} rotulo="Jornada diária máx. (min)"><input class="form-control" type="number" min="30" required value=${edit.jornada_diaria_max_min} onInput=${(e) => set('jornada_diaria_max_min', Number(e.target.value))} /></${Campo}>
          <${Campo} rotulo="Interjornada mín. (min)"><input class="form-control" type="number" min="0" required value=${edit.interjornada_min_min} onInput=${(e) => set('interjornada_min_min', Number(e.target.value))} /></${Campo}>
          <${Campo} rotulo="Máx. dias seguidos sem DSR"><input class="form-control" type="number" min="1" required value=${edit.max_dias_consecutivos} onInput=${(e) => set('max_dias_consecutivos', Number(e.target.value))} /></${Campo}>
          <${Campo} rotulo="Jornada máx. em feriado (min, opcional)"><input class="form-control" type="number" min="30" value=${edit.jornada_feriado_max_min} onInput=${(e) => set('jornada_feriado_max_min', e.target.value)} /></${Campo}>
        </div>
        <label class="wfm-check"><input type="checkbox" checked=${edit.jornada_bloqueio_duro} onChange=${(e) => set('jornada_bloqueio_duro', e.target.checked)} /> Bloqueio duro por lei (nem o Gestor/RH publica com violação de jornada)</label>
        <label class="wfm-check"><input type="checkbox" checked=${edit.ativo} onChange=${(e) => set('ativo', e.target.checked)} /> Ativo</label>
        <h4>Pausas obrigatórias (NR-17)</h4>
        ${edit.exigencias_pausa.map((p, i) => html`<div class="wfm-linha" key=${i}>
          <${Campo} rotulo="Jornada a partir de (min)"><input class="form-control" type="number" min="0" value=${p.a_partir_de_min} onInput=${(e) => setPausa(i, 'a_partir_de_min', e.target.value)} /></${Campo}>
          <${Campo} rotulo="Tipo"><select class="form-select" value=${p.tipo} onChange=${(e) => setPausa(i, 'tipo', e.target.value)}>${Object.entries(TIPOS_PAUSA).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></${Campo}>
          <${Campo} rotulo="Quantidade"><input class="form-control" type="number" min="0" value=${p.quantidade} onInput=${(e) => setPausa(i, 'quantidade', e.target.value)} /></${Campo}>
          <${Campo} rotulo="Duração mín. (min)"><input class="form-control" type="number" min="0" value=${p.duracao_min} onInput=${(e) => setPausa(i, 'duracao_min', e.target.value)} /></${Campo}>
          <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setEdit({ ...edit, exigencias_pausa: edit.exigencias_pausa.filter((_, j) => j !== i) })}>Remover</button></div>`)}
        <div class="wfm-acoes"><button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setEdit({ ...edit, exigencias_pausa: [...edit.exigencias_pausa, { a_partir_de_min: 300, tipo: 'DESCANSO', quantidade: 1, duracao_min: 10 }] })}>Adicionar pausa obrigatória</button>
          <button type="submit" class="btn btn-primary">Salvar contrato</button><button type="button" class="btn btn-outline-secondary" onClick=${() => setEdit(null)}>Cancelar</button></div>
      </form>` : null}
    </${Secao}>`;
}

function Turnos({ operacao, turnos, podeEditar, recarregar, showToast }) {
  const [edit, setEdit] = useState(null);
  const abrirEdicao = (t) => setEdit({
    ...t,
    entrada: t.entrada || '',
    saida: t.saida || '',
    pausas: (t.pausas || []).map((p) => ({ inicio: t.entrada ? horaDe(paraMin(t.entrada) + p.offset_min) : '00:00', duracao_min: p.duracao_min, tipo: p.tipo })),
  });
  const criarExemplos = async () => {
    try {
      for (const t of TURNOS_EXEMPLO.filter((x) => !turnos.some((y) => y.codigo === x.codigo))) {
        await salvarTurnoWfm({ operacao, codigo: t.codigo, nome: t.nome, cor: t.cor, entrada: t.entrada, saida: t.saida,
          pausas: t.pausas.map(([inicio, duracao_min, tipo]) => ({ offset_min: offsetDe(t.entrada, inicio), duracao_min, tipo })) });
      }
      showToast?.('Turnos de exemplo criados. Ajuste horários e pausas como precisar.', 'success');
      recarregar();
    } catch (err) { showToast?.(err?.message || 'Não foi possível criar os turnos.', 'error'); }
  };
  const salvar = async (e) => {
    e.preventDefault();
    try {
      const pausas = (edit.pausas || []).map((p) => ({ offset_min: offsetDe(edit.entrada, p.inicio), duracao_min: p.duracao_min, tipo: p.tipo }));
      await salvarTurnoWfm({ ...edit, pausas, operacao }, edit.id_turno);
      showToast?.('Turno salvo.', 'success');
      setEdit(null);
      recarregar();
    } catch (err) { showToast?.(err?.message || 'Não foi possível salvar o turno.', 'error'); }
  };
  const set = (k, v) => setEdit({ ...edit, [k]: v });
  const setPausa = (i, k, v) => setEdit({ ...edit, pausas: edit.pausas.map((p, j) => (j === i ? { ...p, [k]: ['tipo', 'inicio'].includes(k) ? v : Number(v) } : p)) });
  return html`
    <${Secao} titulo="Turnos-modelo" descricao="Código, cor, horários e pausas padrão. Folga e DSR são turnos fixos de cada operação."
      acoes=${podeEditar ? html`${turnos.filter((t) => t.tipo === 'TRABALHO').length === 0 ? html`<button type="button" class="btn btn-primary" onClick=${criarExemplos}>Criar turnos de exemplo</button>` : null}<button type="button" class="btn btn-outline-primary" onClick=${() => setEdit({ ...TURNO_VAZIO })}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Novo turno</button>` : null}>
      <div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Código</th><th>Nome</th><th>Tipo</th><th>Horário</th><th>Pausas (horário real)</th><th></th></tr></thead><tbody>
        ${turnos.map((t) => html`<tr key=${t.id_turno}><td><span class="wfm-chip" style=${{ '--wfm-cor': t.cor }}>${t.codigo}</span></td><td>${t.nome}${t.ativo ? '' : ' (inativo)'}</td><td>${t.tipo}</td><td>${t.entrada ? `${t.entrada}–${t.saida}` : '—'}</td><td>${t.pausas.length ? descreverTurno(t).split(' · ').slice(1).join(' · ') : '—'}</td>
          <td>${podeEditar ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => abrirEdicao(t)}>Editar</button>` : null}</td></tr>`)}
      </tbody></table></div>
      ${edit ? html`<form class="wfm-form" onSubmit=${salvar}>
        <div class="mon-form-grid">
          <${Campo} rotulo="Código"><input class="form-control" required maxlength="20" disabled=${!!edit.id_turno} value=${edit.codigo} onInput=${(e) => set('codigo', e.target.value)} /></${Campo}>
          <${Campo} rotulo="Nome"><input class="form-control" required maxlength="120" value=${edit.nome} onInput=${(e) => set('nome', e.target.value)} /></${Campo}>
          <${Campo} rotulo="Tipo"><select class="form-select" value=${edit.tipo} disabled=${!!edit.id_turno} onChange=${(e) => set('tipo', e.target.value)}><option value="TRABALHO">Trabalho</option><option value="FOLGA">Folga</option><option value="DSR">DSR</option></select></${Campo}>
          <${Campo} rotulo="Cor"><input class="form-control" type="color" value=${edit.cor} onInput=${(e) => set('cor', e.target.value)} /></${Campo}>
          ${edit.tipo === 'TRABALHO' ? html`
            <${Campo} rotulo="Entrada"><input class="form-control" type="time" required value=${edit.entrada} onInput=${(e) => set('entrada', e.target.value)} /></${Campo}>
            <${Campo} rotulo="Saída (atravessa a meia-noite se menor que a entrada)"><input class="form-control" type="time" required value=${edit.saida} onInput=${(e) => set('saida', e.target.value)} /></${Campo}>` : null}
        </div>
        <label class="wfm-check"><input type="checkbox" checked=${edit.ativo} onChange=${(e) => set('ativo', e.target.checked)} /> Ativo</label>
        ${edit.tipo === 'TRABALHO' ? html`<h4>Pausas padrão do turno</h4>
          <p class="mon-muted">Informe o horário de cada pausa. Descanso e refeição são as pausas exigidas pela NR-17 (configuradas no contrato); a refeição é descontada da jornada.</p>
          ${edit.pausas.map((p, i) => html`<div class="wfm-linha" key=${i}>
            <${Campo} rotulo="Tipo"><select class="form-select" value=${p.tipo} onChange=${(e) => setPausa(i, 'tipo', e.target.value)}>${Object.entries(TIPOS_PAUSA).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></${Campo}>
            <${Campo} rotulo="Horário de início"><input class="form-control" type="time" value=${p.inicio} onInput=${(e) => setPausa(i, 'inicio', e.target.value)} /></${Campo}>
            <${Campo} rotulo="Duração (min)"><input class="form-control" type="number" min="1" value=${p.duracao_min} onInput=${(e) => setPausa(i, 'duracao_min', e.target.value)} /></${Campo}>
            <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setEdit({ ...edit, pausas: edit.pausas.filter((_, j) => j !== i) })}>Remover</button></div>`)}
          <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setEdit({ ...edit, pausas: [...edit.pausas, { inicio: edit.entrada ? horaDe(paraMin(edit.entrada) + 90) : '09:00', duracao_min: 10, tipo: 'DESCANSO' }] })}>Adicionar pausa</button>` : null}
        <div class="wfm-acoes"><button type="submit" class="btn btn-primary">Salvar turno</button><button type="button" class="btn btn-outline-secondary" onClick=${() => setEdit(null)}>Cancelar</button></div>
      </form>` : null}
    </${Secao}>`;
}

function Calendario({ operacao, eventos, turnos, podeEditar, recarregar, showToast }) {
  const [form, setForm] = useState({ ...EVENTO_VAZIO });
  const salvar = async (e) => {
    e.preventDefault();
    try {
      await salvarEventoWfm({ ...form, operacao, id_turno: form.id_turno ? Number(form.id_turno) : null }, form.id_item);
      showToast?.('Item do calendário salvo.', 'success');
      setForm({ ...EVENTO_VAZIO });
      recarregar();
    } catch (err) { showToast?.(err?.message || 'Não foi possível salvar.', 'error'); }
  };
  const remover = async (ev) => {
    try { await salvarEventoWfm({ ...ev, operacao, ativo: false }, ev.id_item); recarregar(); } catch (err) { showToast?.(err?.message || 'Não foi possível remover.', 'error'); }
  };
  const set = (k, v) => setForm({ ...form, [k]: v });
  const trabalho = turnos.filter((t) => t.tipo === 'TRABALHO' && t.ativo);
  return html`
    <${Secao} titulo="Calendário especial" descricao="Feriado: jornada própria do contrato · Data especial: só informativa · Dia especial: o dia todo usa um turno · Horário especial: sobrescreve entrada/saída de um turno.">
      <div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Tipo</th><th>Período</th><th>Descrição</th><th>Turno</th><th></th></tr></thead><tbody>
        ${eventos.length ? eventos.map((ev) => html`<tr key=${ev.id_item}><td>${ROTULO_TIPO_EVENTO[ev.tipo] || ev.tipo}</td><td>${ev.data_ini.split('-').reverse().join('/')}${ev.data_fim !== ev.data_ini ? ` a ${ev.data_fim.split('-').reverse().join('/')}` : ''}</td><td>${ev.descricao}</td>
          <td>${ev.id_turno ? (turnos.find((t) => t.id_turno === ev.id_turno)?.codigo || '') : ''}${ev.entrada ? ` ${ev.entrada}–${ev.saida}` : ''}</td>
          <td>${podeEditar ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setForm({ ...ev, id_turno: ev.id_turno || '', entrada: ev.entrada || '', saida: ev.saida || '' })}>Editar</button> <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => remover(ev)}>Remover</button>` : null}</td></tr>`)
          : html`<tr><td colspan="5" class="mon-muted">Nenhum item neste mês.</td></tr>`}
      </tbody></table></div>
      ${podeEditar ? html`<form class="wfm-form" onSubmit=${salvar}>
        <div class="mon-form-grid">
          <${Campo} rotulo="Tipo"><select class="form-select" value=${form.tipo} onChange=${(e) => set('tipo', e.target.value)}>${Object.entries(ROTULO_TIPO_EVENTO).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></${Campo}>
          <${Campo} rotulo="Data inicial"><input class="form-control" type="date" required value=${form.data_ini} onInput=${(e) => setForm({ ...form, data_ini: e.target.value, data_fim: form.data_fim || e.target.value })} /></${Campo}>
          <${Campo} rotulo="Data final"><input class="form-control" type="date" required value=${form.data_fim} onInput=${(e) => set('data_fim', e.target.value)} /></${Campo}>
          <${Campo} rotulo="Descrição"><input class="form-control" required maxlength="200" value=${form.descricao} onInput=${(e) => set('descricao', e.target.value)} /></${Campo}>
          ${['DIA_ESPECIAL', 'HORARIO_ESPECIAL'].includes(form.tipo) ? html`<${Campo} rotulo="Turno-modelo"><select class="form-select" required value=${form.id_turno} onChange=${(e) => set('id_turno', e.target.value)}><option value="">Selecione</option>${trabalho.map((t) => html`<option key=${t.id_turno} value=${t.id_turno}>${t.codigo} · ${t.nome}</option>`)}</select></${Campo}>` : null}
          ${form.tipo === 'HORARIO_ESPECIAL' ? html`<${Campo} rotulo="Nova entrada"><input class="form-control" type="time" required value=${form.entrada} onInput=${(e) => set('entrada', e.target.value)} /></${Campo}><${Campo} rotulo="Nova saída"><input class="form-control" type="time" required value=${form.saida} onInput=${(e) => set('saida', e.target.value)} /></${Campo}>` : null}
        </div>
        <div class="wfm-acoes"><button type="submit" class="btn btn-primary">${form.id_item ? 'Salvar alterações' : 'Adicionar'}</button>${form.id_item ? html`<button type="button" class="btn btn-outline-secondary" onClick=${() => setForm({ ...EVENTO_VAZIO })}>Cancelar</button>` : null}</div>
      </form>` : null}
    </${Secao}>`;
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
    <${Secao} titulo="Skills" descricao="Idioma, produto e retenção. A compatibilidade de skills é usada nas trocas (Fase 2).">
      <div class="wfm-chips">${skills.length ? skills.map((s) => html`<span key=${s.id_skill} class="mon-tag">${CATEGORIAS_SKILL[s.categoria]} · ${s.nome}</span>`) : html`<span class="mon-muted">Nenhuma skill cadastrada.</span>`}</div>
      ${podeEditar ? html`<form class="mon-linha-form" onSubmit=${adicionar}>
        <${Campo} rotulo="Categoria"><select class="form-select" value=${form.categoria} onChange=${(e) => setForm({ ...form, categoria: e.target.value })}>${Object.entries(CATEGORIAS_SKILL).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></${Campo}>
        <${Campo} rotulo="Nome"><input class="form-control" required maxlength="120" value=${form.nome} onInput=${(e) => setForm({ ...form, nome: e.target.value })} /></${Campo}>
        <button type="submit" class="btn btn-primary">Adicionar</button></form>` : null}
      <h4>Skills por operador</h4>
      <div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Operador</th><th>Skills</th><th></th></tr></thead><tbody>
        ${operadores.map((o) => html`<${Fragment} key=${o.id_usuario}>
          <tr><td>${o.nome}</td><td>${(o.skills || []).map((id) => skills.find((s) => s.id_skill === id)?.nome).filter(Boolean).join(', ') || '—'}</td>
            <td>${podeEditar ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setEditandoOp(editandoOp?.id_usuario === o.id_usuario ? null : { id_usuario: o.id_usuario, nome: o.nome, skills: [...(o.skills || [])] })}>${editandoOp?.id_usuario === o.id_usuario ? 'Fechar' : 'Editar'}</button>` : null}</td></tr>
          ${editandoOp?.id_usuario === o.id_usuario ? html`<tr class="wfm-linha-edicao"><td colspan="3">
            ${ativas.length ? html`<div class="wfm-chips">${ativas.map((s) => html`<label key=${s.id_skill} class="wfm-check"><input type="checkbox" checked=${editandoOp.skills.includes(s.id_skill)} onChange=${() => alternar(s.id_skill)} /> ${CATEGORIAS_SKILL[s.categoria]} · ${s.nome}</label>`)}</div>` : html`<span class="mon-muted">Cadastre ao menos uma skill acima para atribuir ao operador.</span>`}
            <div class="wfm-acoes"><button type="button" class="btn btn-primary btn-sm" onClick=${salvarOp}>Salvar skills</button><button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setEditandoOp(null)}>Cancelar</button></div></td></tr>` : null}
        </${Fragment}>`)}
      </tbody></table></div>
    </${Secao}>`;
}

function OperadoresContrato({ operacao, operadores, contratos, podeEditar, recarregar, showToast }) {
  const [sel, setSel] = useState({});
  const ativos = contratos.filter((c) => c.ativo);
  const vincular = async (op) => {
    const s = sel[op.id_usuario] || {};
    if (!s.id_contrato || !s.vigencia_ini) { showToast?.('Escolha o contrato e a data de início.', 'error'); return; }
    try { await vincularContratoOperadorWfm(op.id_usuario, { operacao, id_contrato: Number(s.id_contrato), vigencia_ini: s.vigencia_ini }); showToast?.('Contrato vinculado.', 'success'); recarregar(); } catch (err) { showToast?.(err?.message || 'Não foi possível vincular.', 'error'); }
  };
  return html`
    <${Secao} titulo="Contrato dos operadores" descricao="Cada operador precisa de um contrato vigente; sem ele a escala não é publicada. A mudança de contrato vale a partir da data informada.">
      <div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Operador</th><th>Contrato vigente</th>${podeEditar ? html`<th>Novo contrato</th><th>A partir de</th><th></th>` : null}</tr></thead><tbody>
        ${operadores.map((o) => { const s = sel[o.id_usuario] || {}; const atual = (o.contratos || []).filter((c) => !c.fim).pop() || (o.contratos || []).slice(-1)[0]; return html`<tr key=${o.id_usuario}><td>${o.nome}</td><td>${atual ? `${atual.codigo} desde ${atual.ini.split('-').reverse().join('/')}` : html`<span class="wfm-alerta-txt">sem contrato</span>`}</td>
          ${podeEditar ? html`<td><select class="form-select" value=${s.id_contrato || ''} onChange=${(e) => setSel({ ...sel, [o.id_usuario]: { ...s, id_contrato: e.target.value } })}><option value="">Selecione</option>${ativos.map((c) => html`<option key=${c.id_contrato} value=${c.id_contrato}>${c.codigo}</option>`)}</select></td>
            <td><input class="form-control" type="date" value=${s.vigencia_ini || ''} onInput=${(e) => setSel({ ...sel, [o.id_usuario]: { ...s, vigencia_ini: e.target.value } })} /></td>
            <td><button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => vincular(o)}>Vincular</button></td>` : null}</tr>`; })}
      </tbody></table></div>
    </${Secao}>`;
}

export function TelaCadastros({ controlador, operacao, anoMes, showToast }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const carregar = useCallback(async () => {
    if (!operacao) return;
    setErro('');
    try {
      const [contratos, turnos, skills, eventos, escala] = await Promise.all([
        listarContratosWfm(operacao), listarTurnosWfm(operacao), listarSkillsWfm(operacao), listarCalendarioWfm(operacao, anoMes), lerEscalaWfm(operacao, anoMes),
      ]);
      setDados({ contratos: contratos.itens, turnos: turnos.itens, skills: skills.itens, eventos: eventos.itens, operadores: escala.operadores });
    } catch (e) { setDados(null); setErro(e?.message || 'Não foi possível carregar os cadastros.'); }
  }, [operacao, anoMes]);
  useEffect(() => { setDados(null); carregar(); }, [carregar]);
  if (erro) return html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  if (!dados) return html`<${LoadingState} titulo="Carregando os cadastros" />`;
  const podeContratos = controlador.possuiPermissao('wfm.contratos.editar');
  const podeCadastros = controlador.possuiPermissao('wfm.cadastros.editar');
  const comum = { operacao, showToast, recarregar: carregar };
  return html`
    <${Contratos} ...${comum} contratos=${dados.contratos} podeEditar=${podeContratos} />
    <${OperadoresContrato} ...${comum} operadores=${dados.operadores} contratos=${dados.contratos} podeEditar=${podeCadastros} />
    <${Turnos} ...${comum} turnos=${dados.turnos} podeEditar=${podeCadastros} />
    <${Calendario} ...${comum} eventos=${dados.eventos} turnos=${dados.turnos} podeEditar=${podeCadastros} />
    <${Skills} ...${comum} skills=${dados.skills} operadores=${dados.operadores} podeEditar=${podeCadastros} />`;
}
