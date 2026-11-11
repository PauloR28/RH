import { html, useCallback, useEffect, useState } from '../../../infraestrutura-react.js';
import { desvincularOperadorContratoWfm, excluirContratoWfm, listarContratosWfm, listarOperadoresContratoWfm, salvarContratoWfm } from '../../../services/api/wfm.js?v=20261111-modulos-op';
import { minutosParaHoras } from './comum.js?v=20261111-modulos-op';
import { semAcento } from './escala-ui.js?v=20261111-modulos-op';
import { Campo, Esqueleto, Estado, Ic, Janela, JanelaForm, MenuAcoes, Selo } from '../../../ui/components/ds.js?v=20261106-wfm';

// Jornadas e limites (item de Cadastros no redesign Fase 15, amostra Q3 do lote 1): limites do motor de regras (horas no dia
// e na semana, descanso entre dias, dias seguidos) e pausas obrigatórias. "Bloqueio duro" vira o selo Bloqueia / Só avisa.
// Quem tem wfm.contratos.editar edita; os demais só consultam. Mesmas rotas de antes.

export const TIPOS_PAUSA = { DESCANSO: 'Descanso', REFEICAO: 'Refeição', INTERVALO: 'Intervalo não remunerado', LANCHE: 'Lanche', OUTRA: 'Outra' };
const TIPOS_JORNADA = { ESTAGIARIO: 'Estagiário', CLT: 'CLT', TERCEIRO: 'Terceiro', APRENDIZ: 'Jovem aprendiz' };
const JORNADA_VAZIA = { codigo: '', nome: '', tipo: 'CLT', jornada_diaria_max_min: 480, interjornada_min_min: 660, max_dias_consecutivos: 6, jornada_semanal_max_min: 2640, jornada_feriado_max_min: '', jornada_bloqueio_duro: false, exigencias_pausa: [], ativo: true };
// Horas no dia e na semana são digitadas em horas (aceita 7,5) e guardadas em minutos.
const emHoras = (min) => (min === '' || min === null || min === undefined ? '' : Number((Number(min) / 60).toFixed(2)));
const emMinutos = (h) => (h === '' ? '' : Math.round(Number(String(h).replace(',', '.')) * 60));
const PAUSA_VAZIA = { nome: '', a_partir_de_min: 300, tipo: 'DESCANSO', quantidade: 1, duracao_min: 10 };
const br = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

function ModalJornada({ operacao, inicial, onClose, onSalvo, showToast }) {
  const [edit, setEdit] = useState(inicial);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const set = (k, v) => setEdit((e) => ({ ...e, [k]: v }));
  const setPausa = (i, k, v) => setEdit((e) => ({ ...e, exigencias_pausa: e.exigencias_pausa.map((p, j) => (j === i ? { ...p, [k]: ['tipo', 'nome'].includes(k) ? v : Number(v) } : p)) }));
  const num = (k) => (e) => set(k, e.target.value === '' ? '' : Number(e.target.value));
  const horas = (k) => (e) => set(k, emMinutos(e.target.value));

  const salvar = async (ev) => {
    ev.preventDefault();
    if (!edit.codigo.trim() || !edit.nome.trim()) return setErro('Informe o código e o nome da jornada.');
    if (!(edit.jornada_diaria_max_min >= 30) || !(edit.max_dias_consecutivos >= 1)) return setErro('Preencha as horas no dia (mínimo 0,5) e os dias seguidos.');
    if (edit.jornada_semanal_max_min !== '' && edit.jornada_semanal_max_min !== null && edit.jornada_semanal_max_min < edit.jornada_diaria_max_min) return setErro('As horas na semana não podem ser menores que as horas no dia.');
    setErro('');
    setSalvando(true);
    try {
      await salvarContratoWfm({ ...edit, operacao, interjornada_min_min: edit.interjornada_min_min === '' ? 660 : edit.interjornada_min_min, jornada_semanal_max_min: edit.jornada_semanal_max_min === '' || edit.jornada_semanal_max_min === null ? null : Number(edit.jornada_semanal_max_min), jornada_feriado_max_min: edit.jornada_feriado_max_min === '' ? null : Number(edit.jornada_feriado_max_min) }, edit.id_contrato);
      showToast?.('Jornada salva.', 'success');
      onSalvo();
    } catch (err) { setErro(err?.message || 'Não foi possível salvar a jornada.'); } finally { setSalvando(false); }
  };

  return html`<${JanelaForm} titulo=${edit.id_contrato ? `Editar jornada ${edit.codigo}` : 'Nova jornada'} onClose=${onClose} onSubmit=${salvar} erro=${erro} salvando=${salvando} salvarRotulo="Salvar jornada">
    <div class="c-form" style=${{ '--colunas': 3 }}>
      <${Campo} rotulo="Código"><input class="c-entrada" maxlength="30" disabled=${!!edit.id_contrato} value=${edit.codigo} onInput=${(e) => set('codigo', e.target.value)} /><//>
      <${Campo} rotulo="Nome"><input class="c-entrada" maxlength="120" value=${edit.nome} onInput=${(e) => set('nome', e.target.value)} /><//>
      <${Campo} rotulo="Tipo"><select class="c-entrada" value=${edit.tipo} onChange=${(e) => set('tipo', e.target.value)}>${Object.entries(TIPOS_JORNADA).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
      <${Campo} rotulo="No dia (h)" ajuda="Máximo trabalhado no dia"><input class="c-entrada" type="number" min="0.5" max="24" step="0.5" value=${emHoras(edit.jornada_diaria_max_min)} onInput=${horas('jornada_diaria_max_min')} /><//>
      <${Campo} rotulo="Na semana (h)" ajuda="Vazio = sem limite"><input class="c-entrada" type="number" min="1" max="168" step="0.5" value=${emHoras(edit.jornada_semanal_max_min)} onInput=${horas('jornada_semanal_max_min')} /><//>
      <${Campo} rotulo="Descanso entre dias (h)" ajuda="Interjornada mínima"><input class="c-entrada" type="number" min="1" max="48" step="0.5" value=${emHoras(edit.interjornada_min_min)} onInput=${horas('interjornada_min_min')} /><//>
      <${Campo} rotulo="Dias seguidos" ajuda="Máximo sem DSR"><input class="c-entrada" type="number" min="1" value=${edit.max_dias_consecutivos} onInput=${num('max_dias_consecutivos')} /><//>
      <${Campo} rotulo="Máx. em feriado (min)" opcional=${true}><input class="c-entrada" type="number" min="30" value=${edit.jornada_feriado_max_min} onInput=${(e) => set('jornada_feriado_max_min', e.target.value)} /><//>
      <label class="c-interruptor" title="Ligado: a escala não publica com violação. Desligado: só avisa."><input type="checkbox" role="switch" checked=${!!edit.jornada_bloqueio_duro} onChange=${(e) => set('jornada_bloqueio_duro', e.target.checked)} />Bloqueia (bloqueio duro)</label>
      <label class="c-interruptor"><input type="checkbox" role="switch" checked=${!!edit.ativo} onChange=${(e) => set('ativo', e.target.checked)} />Jornada ativa</label>
    </div>
    <div class="c-tabela-caixa">
      <div class="c-filtros"><h3 class="c-cad-titulo">Pausas obrigatórias</h3>
        <button type="button" class="c-botao c-botao--texto c-botao--compacto" style=${{ marginLeft: 'auto' }} onClick=${() => setEdit({ ...edit, exigencias_pausa: [...edit.exigencias_pausa, { ...PAUSA_VAZIA }] })}><${Ic} nome="plus" />Pausa</button></div>
      ${edit.exigencias_pausa.length ? html`<table class="c-tabela c-tabela--compacta"><thead><tr><th scope="col">Nome</th><th scope="col">Tipo</th><th scope="col">A partir de (min)</th><th scope="col">Qtd.</th><th scope="col">Min</th><th scope="col" class="c-acoes"><span class="c-oculto">Remover</span></th></tr></thead><tbody>
        ${edit.exigencias_pausa.map((p, i) => html`<tr key=${i}>
          <td><input class="c-entrada c-entrada--compacta" aria-label="Nome da pausa" maxlength="60" placeholder="Ex.: Descanso 1" value=${p.nome || ''} onInput=${(e) => setPausa(i, 'nome', e.target.value)} /></td>
          <td><select class="c-entrada c-entrada--compacta" aria-label="Tipo da pausa" value=${p.tipo} onChange=${(e) => setPausa(i, 'tipo', e.target.value)}>${Object.entries(TIPOS_PAUSA).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></td>
          <td><input class="c-entrada c-entrada--compacta c-entrada--numero" aria-label="A partir de (min)" type="number" min="0" value=${p.a_partir_de_min} onInput=${(e) => setPausa(i, 'a_partir_de_min', e.target.value)} /></td>
          <td><input class="c-entrada c-entrada--compacta c-entrada--numero" aria-label="Quantidade" type="number" min="0" value=${p.quantidade} onInput=${(e) => setPausa(i, 'quantidade', e.target.value)} /></td>
          <td><input class="c-entrada c-entrada--compacta c-entrada--numero" aria-label="Duração (min)" type="number" min="0" value=${p.duracao_min} onInput=${(e) => setPausa(i, 'duracao_min', e.target.value)} /></td>
          <td class="c-acoes"><button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Remover pausa" title="Remover pausa" onClick=${() => setEdit({ ...edit, exigencias_pausa: edit.exigencias_pausa.filter((_, j) => j !== i) })}><${Ic} nome="trash" /></button></td>
        </tr>`)}</tbody></table>` : html`<p class="c-ajuda" style=${{ padding: 'var(--espaco-2) var(--espaco-3)', margin: 0 }}>Nenhuma pausa obrigatória.</p>`}
    </div>
  <//>`;
}

// Quem está atribuído à jornada, com opção de desvincular ("Ver pessoas").
function JanelaPessoas({ operacao, jornada, podeEditar, onClose, onMudou, showToast }) {
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const carregar = useCallback(async () => {
    try { setLista((await listarOperadoresContratoWfm(operacao, jornada.id_contrato)).itens); } catch (e) { setErro(e?.message || 'Não foi possível carregar as pessoas.'); }
  }, [operacao, jornada.id_contrato]);
  useEffect(() => { carregar(); }, [carregar]);
  const desvincular = async (o) => {
    if (!window.confirm(`Desvincular ${o.nome} da jornada ${jornada.codigo}? Sem outra jornada, a escala dele não poderá ser validada.`)) return;
    setErro('');
    try { await desvincularOperadorContratoWfm(operacao, jornada.id_contrato, o.id_operador); showToast?.('Operador desvinculado.', 'success'); await carregar(); onMudou(); }
    catch (e) { setErro(e?.message || 'Não foi possível desvincular.'); }
  };
  return html`<${Janela} titulo=${`Pessoas na jornada ${jornada.codigo}`} onClose=${onClose}
    rodape=${html`<span class="c-ajuda" style=${{ marginRight: 'auto' }}>${lista ? `${new Set(lista.map((o) => o.id_operador)).size} pessoa(s)` : ''}</span><button type="button" class="c-botao c-botao--secundario" onClick=${onClose}>Fechar</button>`}>
    <div class="c-janela-corpo">
      ${erro ? html`<div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${erro}</p></div></div>` : null}
      <div class="c-tabela-caixa">${!lista ? html`<${Esqueleto} linhas=${3} />` : lista.length ? html`<table class="c-tabela c-tabela--compacta"><thead><tr><th scope="col" class="c-estica">Colaborador</th><th scope="col">Desde</th><th scope="col">Até</th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead><tbody>
        ${lista.map((o, i) => html`<tr key=${`${o.id_operador}-${i}`}><td class="c-estica">${o.nome}</td><td class="c-num-esq">${br(o.vigencia_ini)}</td><td>${o.vigencia_fim ? br(o.vigencia_fim) : 'Atual'}</td>
          <td class="c-acoes">${podeEditar ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto c-tom-perigo" onClick=${() => desvincular(o)}>Desvincular</button>` : null}</td></tr>`)}
      </tbody></table>` : html`<${Estado} icone="users" titulo="Ninguém nesta jornada." />`}</div>
    </div>
  <//>`;
}

function JanelaExcluir({ operacao, jornada, onClose, onExcluida, showToast }) {
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const excluir = async () => {
    setSalvando(true); setErro('');
    try { await excluirContratoWfm(operacao, jornada.id_contrato); showToast?.('Jornada excluída.', 'success'); onExcluida(); }
    catch (e) { setErro(e?.message || 'Não foi possível excluir a jornada.'); } finally { setSalvando(false); }
  };
  return html`<${Janela} titulo=${`Excluir jornada ${jornada.codigo}`} tamanho="pequena" onClose=${onClose}
    rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${onClose}>Cancelar</button><button type="button" class="c-botao c-botao--perigo" aria-busy=${salvando ? 'true' : null} disabled=${salvando || null} onClick=${excluir}>Excluir</button>`}>
    <div class="c-janela-corpo">
      <p>Excluir a jornada <b>${jornada.codigo} · ${jornada.nome}</b>? Só é possível se nenhuma pessoa ou turno estiver ligado a ela. Use "Ver pessoas" para desvincular.</p>
      ${erro ? html`<div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${erro}</p></div></div>` : null}
    </div>
  <//>`;
}

export function TabelaJornadas({ controlador, operacao, showToast }) {
  const [contratos, setContratos] = useState(null);
  const [erro, setErro] = useState('');
  const [edit, setEdit] = useState(null);
  const [ver, setVer] = useState(null);
  const [excluindo, setExcluindo] = useState(null);
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('');
  const podeEditar = controlador.possuiPermissao('wfm.contratos.editar');

  const carregar = useCallback(async () => {
    if (!operacao) return;
    setErro('');
    try { setContratos((await listarContratosWfm(operacao)).itens); } catch (e) { setContratos(null); setErro(e?.message || 'Não foi possível carregar as jornadas.'); }
  }, [operacao]);
  useEffect(() => { setContratos(null); carregar(); }, [carregar]);

  const abrir = (c) => setEdit({ ...c, jornada_feriado_max_min: c.jornada_feriado_max_min ?? '', exigencias_pausa: (c.exigencias_pausa || []).map((p) => ({ nome: '', ...p })) });
  const duplicar = (c) => { const { id_contrato: _id, ...resto } = c; setEdit({ ...resto, codigo: '', nome: `${c.nome} (cópia)`, jornada_feriado_max_min: c.jornada_feriado_max_min ?? '', exigencias_pausa: (c.exigencias_pausa || []).map((p) => ({ nome: '', ...p })) }); };
  const visiveis = (contratos || []).filter((c) => (!busca || semAcento(`${c.codigo} ${c.nome}`).includes(semAcento(busca))) && (!tipo || c.tipo === tipo));
  const novo = () => setEdit({ ...JORNADA_VAZIA, exigencias_pausa: [] });

  return html`
    <div class="c-tabela-caixa">
      <div class="c-filtros c-filtros--suave c-cad-faixa">
        <h2 class="c-cad-titulo">Jornadas e limites</h2>
        <div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" /><input class="c-entrada c-entrada--compacta" type="search" placeholder="Buscar jornada" aria-label="Buscar jornada" value=${busca} onInput=${(e) => setBusca(e.target.value)} /></div>
        <select class="c-entrada c-entrada--compacta" aria-label="Tipo" value=${tipo} onChange=${(e) => setTipo(e.target.value)}><option value="">Tipo: todos</option>${Object.entries(TIPOS_JORNADA).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>
        ${contratos ? html`<span class="c-contador">${visiveis.length} de ${contratos.length}</span>` : null}
        ${podeEditar ? html`<button type="button" class="c-botao c-botao--principal c-botao--compacto c-cad-novo" style=${{ marginLeft: 0 }} onClick=${novo}><${Ic} nome="plus" />Nova jornada</button>` : null}
      </div>
      ${erro ? html`<${Estado} titulo=${erro} rotuloAcao="Tentar de novo" aoAcao=${carregar} />`
        : !contratos ? html`<${Esqueleto} linhas=${4} />`
        : !contratos.length ? html`<${Estado} icone="scales" titulo="Nenhuma jornada cadastrada." rotuloAcao=${podeEditar ? 'Nova jornada' : undefined} aoAcao=${podeEditar ? novo : undefined} />`
        : !visiveis.length ? html`<${Estado} titulo="Nenhuma jornada com estes filtros." rotuloAcao="Limpar filtros" aoAcao=${() => { setBusca(''); setTipo(''); }} />`
        : html`<table class="c-tabela">
          <thead><tr><th scope="col">Código</th><th scope="col" class="c-estica">Nome</th><th scope="col" class="c-col-opc">Tipo</th><th scope="col" class="c-num">No dia</th><th scope="col" class="c-num">Na semana</th><th scope="col" class="c-num c-col-opc">Descanso entre dias</th><th scope="col" class="c-num">Dias seguidos</th><th scope="col">Se passar</th><th scope="col" class="c-col-opc">Pausas</th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead>
          <tbody>${visiveis.map((c) => html`<tr key=${c.id_contrato} class=${podeEditar ? 'c-clicavel' : ''} onClick=${podeEditar ? (ev) => { if (!ev.target.closest('button, .c-abre-menu')) abrir(c); } : undefined}>
            <td class="c-forte" data-papel="info" data-prioridade="1" data-primeira="">${c.codigo}</td>
            <td class="c-estica" data-papel="titulo">${c.nome}${c.ativo ? '' : html` <${Selo} tom="neutro">Inativa<//>`}</td>
            <td class="c-col-opc">${TIPOS_JORNADA[c.tipo] || c.tipo}</td>
            <td class="c-num" data-papel="info" data-prioridade="1">${minutosParaHoras(c.jornada_diaria_max_min)}</td>
            <td class="c-num">${c.jornada_semanal_max_min ? minutosParaHoras(c.jornada_semanal_max_min) : '—'}</td>
            <td class="c-num c-col-opc">${c.interjornada_min_min ? minutosParaHoras(c.interjornada_min_min) : '—'}</td>
            <td class="c-num">${c.max_dias_consecutivos}</td>
            <td data-papel="selo">${c.jornada_bloqueio_duro ? html`<${Selo} tom="perigo" icone="lock">Bloqueia<//>` : html`<${Selo} tom="atencao" icone="warning">Só avisa<//>`}</td>
            <td class="c-secundario c-col-opc" title=${(c.exigencias_pausa || []).map((p) => `${p.nome || TIPOS_PAUSA[p.tipo] || p.tipo} ${p.duracao_min} min`).join(' · ') || null}>${(c.exigencias_pausa || []).length || '—'}</td>
            <td class="c-acoes" data-papel="acoes"><${MenuAcoes} rotulo=${`Ações da jornada ${c.codigo}`} acoes=${[
              { label: 'Ver pessoas', icon: 'users', onClick: () => setVer(c) },
              podeEditar ? { label: 'Duplicar', icon: 'copy', onClick: () => duplicar(c) } : null,
              podeEditar ? { label: 'Excluir', icon: 'trash', perigo: true, onClick: () => setExcluindo(c) } : null,
            ]} /></td>
          </tr>`)}</tbody>
        </table>`}
    </div>
    ${ver ? html`<${JanelaPessoas} operacao=${operacao} jornada=${ver} podeEditar=${podeEditar} showToast=${showToast} onClose=${() => setVer(null)} onMudou=${carregar} />` : null}
    ${excluindo ? html`<${JanelaExcluir} operacao=${operacao} jornada=${excluindo} showToast=${showToast} onClose=${() => setExcluindo(null)} onExcluida=${() => { setExcluindo(null); carregar(); }} />` : null}
    ${edit ? html`<${ModalJornada} operacao=${operacao} inicial=${edit} showToast=${showToast} onClose=${() => setEdit(null)} onSalvo=${() => { setEdit(null); carregar(); }} />` : null}`;
}

// Nome antigo (a aba "Jornadas" virou item de Cadastros): continua exportado para quem ainda importa.
export const TelaJornadas = TabelaJornadas;
