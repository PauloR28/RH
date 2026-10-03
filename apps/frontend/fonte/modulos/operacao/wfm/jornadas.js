import { html, useCallback, useEffect, useState } from '../../../infraestrutura-react.js';
import { LoadingState } from '../../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../../ui/icone.js';
import { desvincularOperadorContratoWfm, excluirContratoWfm, listarContratosWfm, listarOperadoresContratoWfm, salvarContratoWfm } from '../../../services/api/wfm.js';
import { ModalPadrao } from '../../../ui/componentes-compartilhados.js';
import { minutosParaHoras } from './comum.js';
import { BotaoAdicionar, BotaoRemover, Campo, Marca, ModalForm, Secao } from './formulario.js';

// Jornadas: limites do motor de regras (jornada diária, interjornada, dias seguidos) e pausas obrigatórias.
// Administrador e Control Desk editam; os demais perfis só consultam.

export const TIPOS_PAUSA = { DESCANSO: 'Descanso', REFEICAO: 'Refeição', INTERVALO: 'Intervalo não remunerado', LANCHE: 'Lanche', OUTRA: 'Outra' };
const TIPOS_JORNADA = { ESTAGIARIO: 'Estagiário', CLT: 'CLT', TERCEIRO: 'Terceiro', APRENDIZ: 'Jovem aprendiz' };
const JORNADA_VAZIA = { codigo: '', nome: '', tipo: 'CLT', jornada_diaria_max_min: 480, interjornada_min_min: 660, max_dias_consecutivos: 6, jornada_feriado_max_min: '', jornada_bloqueio_duro: false, exigencias_pausa: [], ativo: true };
const PAUSA_VAZIA = { nome: '', a_partir_de_min: 300, tipo: 'DESCANSO', quantidade: 1, duracao_min: 10 };

function ModalJornada({ operacao, inicial, onClose, onSalvo, showToast }) {
  const [edit, setEdit] = useState(inicial);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const set = (k, v) => setEdit((e) => ({ ...e, [k]: v }));
  const setPausa = (i, k, v) => setEdit((e) => ({ ...e, exigencias_pausa: e.exigencias_pausa.map((p, j) => (j === i ? { ...p, [k]: ['tipo', 'nome'].includes(k) ? v : Number(v) } : p)) }));
  const num = (k) => (e) => set(k, e.target.value === '' ? '' : Number(e.target.value));

  const salvar = async (ev) => {
    ev.preventDefault();
    if (!edit.codigo.trim() || !edit.nome.trim()) return setErro('Informe o código e o nome da jornada.');
    if (!(edit.jornada_diaria_max_min >= 30) || edit.interjornada_min_min === '' || !(edit.max_dias_consecutivos >= 1)) return setErro('Preencha jornada máxima (mín. 30), interjornada e dias seguidos.');
    setErro('');
    setSalvando(true);
    try {
      await salvarContratoWfm({ ...edit, operacao, jornada_feriado_max_min: edit.jornada_feriado_max_min === '' ? null : Number(edit.jornada_feriado_max_min) }, edit.id_contrato);
      showToast?.('Jornada salva.', 'success');
      onSalvo();
    } catch (err) { setErro(err?.message || 'Não foi possível salvar a jornada.'); } finally { setSalvando(false); }
  };

  return html`<${ModalForm} titulo=${edit.id_contrato ? `Editar jornada ${edit.codigo}` : 'Nova jornada'} onClose=${onClose} onSubmit=${salvar} erro=${erro} salvando=${salvando} salvarRotulo="Salvar jornada">
    <div class="wfm-grade-form">
      <${Campo} rotulo="Código" span=${3}><input class="form-control" maxlength="30" disabled=${!!edit.id_contrato} value=${edit.codigo} onInput=${(e) => set('codigo', e.target.value)} /></${Campo}>
      <${Campo} rotulo="Nome" span=${5}><input class="form-control" maxlength="120" value=${edit.nome} onInput=${(e) => set('nome', e.target.value)} /></${Campo}>
      <${Campo} rotulo="Tipo" span=${4}><select class="form-select" value=${edit.tipo} onChange=${(e) => set('tipo', e.target.value)}>${Object.entries(TIPOS_JORNADA).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></${Campo}>
      <${Campo} rotulo="Jornada máx. (min)" span=${3}><input class="form-control" type="number" min="30" value=${edit.jornada_diaria_max_min} onInput=${num('jornada_diaria_max_min')} /></${Campo}>
      <${Campo} rotulo="Interjornada (min)" span=${3}><input class="form-control" type="number" min="0" value=${edit.interjornada_min_min} onInput=${num('interjornada_min_min')} /></${Campo}>
      <${Campo} rotulo="Dias seguidos" span=${3} dica="Máximo de dias de trabalho seguidos sem DSR"><input class="form-control" type="number" min="1" value=${edit.max_dias_consecutivos} onInput=${num('max_dias_consecutivos')} /></${Campo}>
      <${Campo} rotulo="Máx. em feriado (min)" span=${3} dica="Opcional"><input class="form-control" type="number" min="30" value=${edit.jornada_feriado_max_min} onInput=${(e) => set('jornada_feriado_max_min', e.target.value)} /></${Campo}>
      <${Marca} rotulo="Bloqueio duro" span=${4} checked=${edit.jornada_bloqueio_duro} onChange=${(v) => set('jornada_bloqueio_duro', v)} />
      <${Marca} rotulo="Ativa" span=${4} checked=${edit.ativo} onChange=${(v) => set('ativo', v)} />
    </div>
    <div class="wfm-sub-cab"><h4>Pausas obrigatórias</h4><${BotaoAdicionar} rotulo="Pausa" onClick=${() => setEdit({ ...edit, exigencias_pausa: [...edit.exigencias_pausa, { ...PAUSA_VAZIA }] })} /></div>
    ${edit.exigencias_pausa.length ? html`<div class="wfm-linhas wfm-linhas--jornada">
      <div class="wfm-linhas-cab"><span>Nome pausa</span><span>Tipo</span><span>A partir de (min)</span><span>Qtd.</span><span>Duração min</span><span></span></div>
      ${edit.exigencias_pausa.map((p, i) => html`<div class="wfm-linhas-item" key=${i}>
        <input class="form-control" aria-label="Nome pausa" maxlength="60" placeholder="Ex.: Descanso 1" value=${p.nome || ''} onInput=${(e) => setPausa(i, 'nome', e.target.value)} />
        <select class="form-select" aria-label="Tipo" value=${p.tipo} onChange=${(e) => setPausa(i, 'tipo', e.target.value)}>${Object.entries(TIPOS_PAUSA).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>
        <input class="form-control" aria-label="A partir de (min)" type="number" min="0" value=${p.a_partir_de_min} onInput=${(e) => setPausa(i, 'a_partir_de_min', e.target.value)} />
        <input class="form-control" aria-label="Quantidade" type="number" min="0" value=${p.quantidade} onInput=${(e) => setPausa(i, 'quantidade', e.target.value)} />
        <input class="form-control" aria-label="Duração min" type="number" min="0" value=${p.duracao_min} onInput=${(e) => setPausa(i, 'duracao_min', e.target.value)} />
        <${BotaoRemover} onClick=${() => setEdit({ ...edit, exigencias_pausa: edit.exigencias_pausa.filter((_, j) => j !== i) })} />
      </div>`)}
    </div>` : html`<p class="mon-muted wfm-vazio-txt">Nenhuma pausa obrigatória.</p>`}
  </${ModalForm}>`;
}

const br = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

// Quem está atribuído à jornada, com opção de desvincular.
function ModalVerJornada({ operacao, jornada, podeEditar, onClose, onMudou, showToast }) {
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const carregar = useCallback(async () => {
    try { setLista((await listarOperadoresContratoWfm(operacao, jornada.id_contrato)).itens); } catch (e) { setErro(e?.message || 'Não foi possível carregar os operadores.'); }
  }, [operacao, jornada.id_contrato]);
  useEffect(() => { carregar(); }, [carregar]);
  const desvincular = async (o) => {
    if (!window.confirm(`Desvincular ${o.nome} da jornada ${jornada.codigo}? Sem outra jornada, a escala dele não poderá ser validada.`)) return;
    setErro('');
    try { await desvincularOperadorContratoWfm(operacao, jornada.id_contrato, o.id_operador); showToast?.('Operador desvinculado.', 'success'); await carregar(); onMudou(); }
    catch (e) { setErro(e?.message || 'Não foi possível desvincular.'); }
  };
  return html`<${ModalPadrao} aberto=${true} titulo=${`Jornada ${jornada.codigo} · ${jornada.nome}`} onClose=${onClose} className="wfm-modal">
    <div class="wfm-form-modal">
      ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>` : null}
      ${!lista ? html`<${LoadingState} titulo="Carregando" />` : lista.length ? html`<div class="mon-tabela-wrap"><table class="mon-tabela wfm-tabela"><thead><tr><th>Operador</th><th>Desde</th><th>Até</th><th></th></tr></thead><tbody>
        ${lista.map((o, i) => html`<tr key=${`${o.id_operador}-${i}`}><td>${o.nome}</td><td>${br(o.vigencia_ini)}</td><td>${o.vigencia_fim ? br(o.vigencia_fim) : 'Atual'}</td>
          <td class="wfm-acoes-linha">${podeEditar ? html`<button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => desvincular(o)}>Desvincular</button>` : null}</td></tr>`)}
      </tbody></table></div>` : html`<p class="mon-muted wfm-vazio-txt">Nenhum operador vinculado a esta jornada.</p>`}
      <div class="wfm-modal-rodape"><span class="mon-muted">${lista ? `${new Set(lista.map((o) => o.id_operador)).size} operador(es)` : ''}</span><button type="button" class="btn btn-outline-secondary" onClick=${onClose}>Fechar</button></div>
    </div>
  </${ModalPadrao}>`;
}

function ModalExcluirJornada({ operacao, jornada, onClose, onExcluida, showToast }) {
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const excluir = async (ev) => {
    ev.preventDefault();
    setSalvando(true);
    setErro('');
    try { await excluirContratoWfm(operacao, jornada.id_contrato); showToast?.('Jornada excluída.', 'success'); onExcluida(); }
    catch (e) { setErro(e?.message || 'Não foi possível excluir a jornada.'); } finally { setSalvando(false); }
  };
  return html`<${ModalForm} titulo=${`Excluir jornada ${jornada.codigo}`} onClose=${onClose} onSubmit=${excluir} erro=${erro} salvando=${salvando} salvarRotulo="Excluir">
    <p class="wfm-vazio-txt">Excluir a jornada <strong>${jornada.codigo} · ${jornada.nome}</strong>? Só é possível se nenhum operador ou turno estiver vinculado a ela. Use "Ver jornada" para desvincular os operadores.</p>
  </${ModalForm}>`;
}

export function TelaJornadas({ controlador, operacao, showToast }) {
  const [contratos, setContratos] = useState(null);
  const [erro, setErro] = useState('');
  const [edit, setEdit] = useState(null);
  const [ver, setVer] = useState(null);
  const [excluindo, setExcluindo] = useState(null);
  const podeEditar = controlador.possuiPermissao('wfm.contratos.editar');

  const carregar = useCallback(async () => {
    if (!operacao) return;
    setErro('');
    try { setContratos((await listarContratosWfm(operacao)).itens); } catch (e) { setContratos(null); setErro(e?.message || 'Não foi possível carregar as jornadas.'); }
  }, [operacao]);
  useEffect(() => { setContratos(null); carregar(); }, [carregar]);

  if (erro) return html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  if (!contratos) return html`<${LoadingState} titulo="Carregando as jornadas" />`;
  return html`
    <${Secao} titulo="Jornadas"
      acoes=${podeEditar ? html`<button type="button" class="btn btn-outline-primary btn-sm" onClick=${() => setEdit({ ...JORNADA_VAZIA, exigencias_pausa: [] })}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Nova jornada</button>` : null}>
      <div class="mon-tabela-wrap"><table class="mon-tabela wfm-tabela"><thead><tr><th>Código</th><th>Nome</th><th>Tipo</th><th>Jornada máx.</th><th>Interjornada</th><th>Dias seguidos</th><th>Bloqueio duro</th><th>Pausas</th><th></th></tr></thead><tbody>
        ${contratos.length ? contratos.map((c) => html`<tr key=${c.id_contrato}>
          <td><b>${c.codigo}</b></td><td>${c.nome}${c.ativo ? '' : html` <span class="mon-tag">Inativa</span>`}</td><td>${TIPOS_JORNADA[c.tipo] || c.tipo}</td>
          <td>${minutosParaHoras(c.jornada_diaria_max_min)}</td><td>${minutosParaHoras(c.interjornada_min_min)}</td><td>${c.max_dias_consecutivos}</td><td>${c.jornada_bloqueio_duro ? 'Sim' : 'Não'}</td>
          <td>${(c.exigencias_pausa || []).length ? (c.exigencias_pausa || []).map((p) => `${p.nome || TIPOS_PAUSA[p.tipo] || p.tipo} ${p.duracao_min} min`).join(' · ') : '—'}</td>
          <td class="wfm-acoes-linha"><button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setVer(c)}>Ver jornada</button>${podeEditar ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setEdit({ ...c, jornada_feriado_max_min: c.jornada_feriado_max_min ?? '', exigencias_pausa: (c.exigencias_pausa || []).map((p) => ({ nome: '', ...p })) })}>Editar</button><button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => setExcluindo(c)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('delete')}</span>Excluir</button>` : null}</td></tr>`)
          : html`<tr><td colspan="9" class="mon-muted">Nenhuma jornada cadastrada.</td></tr>`}
      </tbody></table></div>
    </${Secao}>
    ${ver ? html`<${ModalVerJornada} operacao=${operacao} jornada=${ver} podeEditar=${podeEditar} showToast=${showToast} onClose=${() => setVer(null)} onMudou=${carregar} />` : null}
    ${excluindo ? html`<${ModalExcluirJornada} operacao=${operacao} jornada=${excluindo} showToast=${showToast} onClose=${() => setExcluindo(null)} onExcluida=${() => { setExcluindo(null); carregar(); }} />` : null}
    ${edit ? html`<${ModalJornada} operacao=${operacao} inicial=${edit} showToast=${showToast} onClose=${() => setEdit(null)} onSalvo=${() => { setEdit(null); carregar(); }} />` : null}`;
}
