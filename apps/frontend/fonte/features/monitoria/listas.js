import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState, ModalPadrao } from '../../ui/componentes-compartilhados.js';
import {
  compartilharMonitorias,
  criarPlano,
  exportarMonitorias,
  exportarRelatorio,
  lerPlano,
  lerRelatorio,
  listarDestinatarios,
  listarMonitorias,
  listarOperadoresMonitoria,
  listarPlanos,
  revisarPlano,
} from '../../services/api/monitoria.js';
import { IconeSvg } from '../../ui/icone.js';
import {
  BadgeSla,
  BadgeStatus,
  BotaoExportar,
  SelectOperacao,
  STATUS_INFO,
  TagOperacao,
  TagsMonitoria,
  baixarArquivo,
  formatarData,
  formatarDataHoraCurta,
  formatarNota,
  hoje,
} from './comum.js';

// ---------------------------------------------------------------------------
// Lista de monitorias (histórico + busca; fila de feedback; contestações; minhas)
// ---------------------------------------------------------------------------
const PRESETS = {
  historico: { titulo: 'Histórico', texto: 'Todas as monitorias do seu escopo. Busque por ID, operador, data ou avaliador.', status: '' },
  feedback: { titulo: 'Feedback pendente', texto: 'Monitorias aguardando a aplicação do feedback (prazo de 72 horas).', status: 'FEEDBACK_PENDENTE' },
  contestacoes: { titulo: 'Contestações para reanálise', texto: 'Contestações abertas do operador (prazo de 72 horas; sem decisão = anulada automaticamente).', status: 'REANALISE' },
  minhas: { titulo: 'Minhas monitorias', texto: 'Suas avaliações. Confirme ou conteste em até 48 horas depois do feedback.', status: '' },
};

const FILTROS_VAZIOS = { codigo: '', operador: '', avaliador: '', data_inicio: '', data_fim: '', operacao: '', status: '' };

export function ListaMonitorias({ modo = 'historico', controlador, contexto, abrirDetalhe, atualizacao, showToast }) {
  const perfil = controlador?.estado?.perfilUsuario;
  const ehOperador = perfil === 'operador';
  const preset = modo === 'minhas' && !ehOperador
    ? { ...PRESETS.minhas, texto: '' }
    : modo === 'historico' && ehOperador
      ? { ...PRESETS.historico, texto: 'Histórico das suas monitorias. Busque por ID, data ou avaliador.' }
      : PRESETS[modo] || PRESETS.historico;
  const podeExportar = controlador.possuiPermissao('monitoria.exportar');
  const padrao = { ...FILTROS_VAZIOS, status: preset.status };
  // `rascunho` é o que está nos campos; `filtros` é o que já foi aplicado à consulta.
  const [rascunho, setRascunho] = useState(padrao);
  const [filtros, setFiltros] = useState(padrao);
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState({ itens: [], total: 0 });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [selecionadas, setSelecionadas] = useState([]);
  const porPagina = 20;

  useEffect(() => {
    const inicial = { ...FILTROS_VAZIOS, status: preset.status };
    setRascunho(inicial);
    setFiltros(inicial);
    setPagina(1);
    setSelecionadas([]);
  }, [modo]);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    listarMonitorias({ ...filtros, pagina, por_pagina: porPagina })
      .then((r) => ativo && (setDados(r), setErro('')))
      .catch((e) => ativo && setErro(e?.message || 'Não foi possível carregar as monitorias.'))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [filtros, pagina, atualizacao]);

  const campo = (nome, valor) => setRascunho((f) => ({ ...f, [nome]: valor }));
  const aplicar = () => {
    setFiltros(rascunho);
    setPagina(1);
    setSelecionadas([]);
  };
  const limpar = () => {
    setRascunho(padrao);
    setFiltros(padrao);
    setPagina(1);
    setSelecionadas([]);
  };
  const totalPaginas = Math.max(1, Math.ceil((dados.total || 0) / porPagina));
  const alternar = (id) => setSelecionadas((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const idsDaPagina = dados.itens.map((m) => m.id_monitoria);
  const todasMarcadas = idsDaPagina.length > 0 && idsDaPagina.every((id) => selecionadas.includes(id));
  const algumaMarcada = idsDaPagina.some((id) => selecionadas.includes(id));
  const alternarTodas = () =>
    setSelecionadas((s) => (todasMarcadas ? s.filter((id) => !idsDaPagina.includes(id)) : [...new Set([...s, ...idsDaPagina])]));

  const exportarSelecionadas = async () => {
    try {
      baixarArquivo(await exportarMonitorias(selecionadas));
    } catch (e) {
      showToast(e?.message || 'Não foi possível exportar.', 'danger');
    }
  };

  return html`
    <div class="mon-shell">
      <p class="mon-muted">${preset.texto}</p>
      <div class="mon-filtros" onKeyDown=${(e) => { if (e.key === 'Enter') aplicar(); }}>
        <label class="mon-filtro mon-filtro--id">ID<input class="form-control" maxlength="8" inputmode="numeric" placeholder="8 dígitos" value=${rascunho.codigo} onInput=${(e) => campo('codigo', e.target.value.replace(/\D/g, ''))} /></label>
        ${!ehOperador ? html`<label class="mon-filtro">Operador<input class="form-control" placeholder="Nome" value=${rascunho.operador} onInput=${(e) => campo('operador', e.target.value)} /></label>` : null}
        ${modo !== 'minhas' || !ehOperador ? html`<label class="mon-filtro">Avaliador<input class="form-control" placeholder="Nome" value=${rascunho.avaliador} onInput=${(e) => campo('avaliador', e.target.value)} /></label>` : null}
        <label class="mon-filtro mon-filtro--data">De<input class="form-control" type="date" value=${rascunho.data_inicio} onInput=${(e) => campo('data_inicio', e.target.value)} /></label>
        <label class="mon-filtro mon-filtro--data">Até<input class="form-control" type="date" value=${rascunho.data_fim} onInput=${(e) => campo('data_fim', e.target.value)} /></label>
        ${(contexto?.operacoes || []).length > 1 ? html`<label class="mon-filtro">Operação<${SelectOperacao} contexto=${contexto} valor=${rascunho.operacao} onChange=${(v) => campo('operacao', v)} /></label>` : null}
        ${modo === 'historico' || modo === 'minhas' ? html`
          <label class="mon-filtro">Status<select class="form-select" value=${rascunho.status} onChange=${(e) => campo('status', e.target.value)}>
            <option value="">Todos</option>${Object.entries(STATUS_INFO).map(([k, v]) => html`<option key=${k} value=${k}>${v.rotulo}</option>`)}
          </select></label>` : null}
        <div class="mon-filtros-acoes">
          <button type="button" class="mon-icone-btn" title="Limpar filtros" aria-label="Limpar filtros" onClick=${limpar}>
            <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('delete')}</span>
          </button>
          <button type="button" class="btn btn-primary" onClick=${aplicar}>Aplicar filtros</button>
        </div>
      </div>

      ${podeExportar && selecionadas.length ? html`
        <div class="mon-acoes mon-acoes--selecao"><span class="mon-muted">${selecionadas.length} selecionada(s)</span>
          <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${exportarSelecionadas}>Exportar seleção (XLSX)</button>
          <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => abrirDetalhe(selecionadas.length === 1 ? String(selecionadas[0]) : null, { compartilhar: selecionadas })}>Compartilhar por e-mail</button></div>` : null}

      ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>` : null}
      ${carregando ? html`<${LoadingState} titulo="Carregando monitorias" />` : !dados.itens.length ? html`
        <${EmptyState} icon="fact_check" title="Nenhuma monitoria encontrada" text="Ajuste os filtros ou aguarde novas avaliações." />` : html`
        <div class="mon-tabela-wrap">
          <table class="mon-tabela">
            <thead><tr>
              <th><span class="mon-th-id">
                ${podeExportar ? html`<input type="checkbox" aria-label="Selecionar todas as monitorias da página" checked=${todasMarcadas}
                  ref=${(el) => { if (el) el.indeterminate = algumaMarcada && !todasMarcadas; }} onChange=${alternarTodas} />` : null}
                ID</span></th><th>Data</th><th>Operação</th><th>Operador</th><th>Equipe</th><th>Avaliador</th><th class="num">Nota</th><th>Status nota</th><th>Status</th><th>Prazo</th>
            </tr></thead>
            <tbody>
              ${dados.itens.map((m) => html`
                <tr key=${m.id_monitoria} class="is-clicavel" onClick=${() => abrirDetalhe(String(m.id_monitoria))}>
                  <td><span class="mon-th-id">
                    ${podeExportar ? html`<input type="checkbox" aria-label=${`Selecionar ${m.codigo}`} checked=${selecionadas.includes(m.id_monitoria)}
                      onClick=${(e) => e.stopPropagation()} onChange=${() => alternar(m.id_monitoria)} />` : null}
                    <strong>#${m.codigo}</strong></span></td>
                  <td>${formatarData(m.data_monitoria)}</td>
                  <td><${TagOperacao} chave=${m.operacao} nome=${m.operacao_nome} contexto=${contexto} /></td>
                  <td>${m.operador_nome}</td><td>${m.equipe_nome || '—'}</td><td>${m.avaliador_nome}</td>
                  <td class="num"><strong>${formatarNota(m.nota)}</strong></td>
                  <td><${TagsMonitoria} item=${m} /></td>
                  <td><${BadgeStatus} status=${m.status} rotulo=${m.status_rotulo} perfil=${perfil} contestada=${m.tem_contestacao} /></td>
                  <td><${BadgeSla} sla=${m.sla} /></td>
                </tr>`)}
            </tbody>
          </table>
        </div>
        <div class="mon-paginacao">
          <span>${dados.total} monitoria(s)</span>
          <div class="mon-acoes">
            <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${pagina <= 1} onClick=${() => setPagina(pagina - 1)}>Anterior</button>
            <span>Página ${pagina} de ${totalPaginas}</span>
            <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${pagina >= totalPaginas} onClick=${() => setPagina(pagina + 1)}>Próxima</button>
          </div>
        </div>`}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Compartilhamento em lote (histórico)
// ---------------------------------------------------------------------------
export function ModalCompartilhar({ ids, onClose, showToast }) {
  const [destinatarios, setDestinatarios] = useState(null);
  const [selecionados, setSelecionados] = useState([]);
  const [mensagem, setMensagem] = useState('');
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    if (!ids?.length) return;
    listarDestinatarios(ids).then((r) => setDestinatarios(r.itens || [])).catch((e) => { showToast(e?.message || 'Erro ao listar destinatários.', 'danger'); setDestinatarios([]); });
  }, [ids?.join(',')]);
  return html`
    <${ModalPadrao} aberto=${Boolean(ids?.length)} titulo="Compartilhar por e-mail" subtitulo="Somente quem pode ver todas as monitorias selecionadas aparece na lista." onClose=${onClose}>
      ${destinatarios === null ? html`<${LoadingState} titulo="Carregando" />` : html`
        <div class="mon-shell">
          <div class="mon-acoes">${destinatarios.map((u) => html`<label key=${u.id_usuario} class="mon-tag" style=${{ cursor: 'pointer' }}>
            <input type="checkbox" checked=${selecionados.includes(u.id_usuario)} onChange=${(e) => setSelecionados((s) => e.target.checked ? [...s, u.id_usuario] : s.filter((x) => x !== u.id_usuario))} /> ${u.nome} · ${u.perfil}</label>`)}</div>
          <label>Mensagem (opcional)<textarea class="form-control" rows="3" value=${mensagem} onInput=${(e) => setMensagem(e.target.value)}></textarea></label>
          <div class="mon-acoes-fixas"><button type="button" class="btn btn-primary" disabled=${!selecionados.length || enviando}
            onClick=${async () => { setEnviando(true); try { await compartilharMonitorias({ ids, destinatarios: selecionados, mensagem }); showToast('Monitorias compartilhadas por e-mail.', 'success'); onClose(); } catch (e) { showToast(e?.message || 'Falha no envio.', 'danger'); } finally { setEnviando(false); } }}>Enviar</button></div>
        </div>`}
    </${ModalPadrao}>`;
}

// ---------------------------------------------------------------------------
// Planos de ação
// ---------------------------------------------------------------------------
const STATUS_PLANO = { ABERTO: 'Aberto', EM_ANDAMENTO: 'Em andamento', EM_REVISAO: 'Em revisão', CONCLUIDO: 'Concluído' };
const PROXIMOS = { ABERTO: ['EM_ANDAMENTO'], EM_ANDAMENTO: ['EM_REVISAO'], EM_REVISAO: ['EM_ANDAMENTO', 'CONCLUIDO'], CONCLUIDO: [] };

export function TelaPlanos({ controlador, contexto, showToast }) {
  const podeEditar = controlador.possuiPermissao('monitoria.plano_acao');
  const [filtros, setFiltros] = useState({ status: '', operacao: '', vencidos: false });
  const [dados, setDados] = useState({ itens: [] });
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState(null);
  const [novo, setNovo] = useState(false);
  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    setCarregando(true);
    listarPlanos({ ...filtros, por_pagina: 100 }).then(setDados).catch((e) => showToast(e?.message || 'Erro ao carregar planos.', 'danger')).finally(() => setCarregando(false));
  }, [filtros, recarga]);
  const contagem = (s) => dados.itens.filter((p) => p.status === s).length;
  return html`
    <div class="mon-shell">
      <div class="mon-kpis">
        ${Object.entries(STATUS_PLANO).map(([k, v]) => html`<div class="mon-kpi" key=${k}><span>${v}</span><strong>${contagem(k)}</strong></div>`)}
        <div class=${`mon-kpi ${dados.itens.some((p) => p.vencido) ? 'is-alerta' : ''}`}><span>Vencidos</span><strong>${dados.itens.filter((p) => p.vencido).length}</strong></div>
      </div>
      <div class="mon-filtros">
        <label class="mon-filtro">Status<select class="form-select" value=${filtros.status} onChange=${(e) => setFiltros({ ...filtros, status: e.target.value })}><option value="">Todos</option>${Object.entries(STATUS_PLANO).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></label>
        ${(contexto?.operacoes || []).length > 1 ? html`<label class="mon-filtro">Operação<${SelectOperacao} contexto=${contexto} valor=${filtros.operacao} onChange=${(v) => setFiltros({ ...filtros, operacao: v })} /></label>` : null}
        <label class="mon-check"><input type="checkbox" checked=${filtros.vencidos} onChange=${(e) => setFiltros({ ...filtros, vencidos: e.target.checked })} />Somente vencidos</label>
        ${podeEditar ? html`<div class="mon-filtros-acoes"><button type="button" class="btn btn-primary" onClick=${() => setNovo(true)}>
          <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Novo plano de ação</button></div>` : null}
      </div>
      ${carregando ? html`<${LoadingState} titulo="Carregando planos" />` : !dados.itens.length ? html`<${EmptyState} icon="task_alt" title="Nenhum plano de ação" text="Planos criados a partir das monitorias aparecem aqui." />` : html`
        <div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Operação</th><th>Operador</th><th>Problema</th><th>Prazo</th><th>Status</th><th class="num">Antes → Depois</th></tr></thead><tbody>
          ${dados.itens.map((p) => html`<tr key=${p.id_plano} class="is-clicavel" onClick=${() => setAberto(p.id_plano)}>
            <td><${TagOperacao} chave=${p.operacao} nome=${p.operacao_nome} contexto=${contexto} /></td><td>${p.operador_nome}</td><td>${p.problema}</td>
            <td>${formatarData(p.prazo)} ${p.vencido ? html`<span class="mon-sla mon-sla--vencido">vencido</span>` : null}</td>
            <td><span class="mon-badge mon-badge--info">${p.status_rotulo}</span></td><td class="num">${formatarNota(p.nota_antes)} → ${formatarNota(p.nota_depois)}</td></tr>`)}
        </tbody></table></div>`}
      <${DetalhePlano} id=${aberto} podeEditar=${podeEditar} onClose=${() => setAberto(null)} onAlterou=${() => setRecarga((r) => r + 1)} showToast=${showToast} />
      <${NovoPlano} aberto=${novo} contexto=${contexto} onClose=${() => setNovo(false)} onCriado=${() => { setNovo(false); setRecarga((r) => r + 1); }} showToast=${showToast} />
    </div>`;
}

function DetalhePlano({ id, podeEditar, onClose, onAlterou, showToast }) {
  const [p, setP] = useState(null);
  const [form, setForm] = useState({ status: '', resultado: '', observacoes: '' });
  const carregar = () => lerPlano(id).then(setP).catch((e) => showToast(e?.message || 'Erro ao carregar o plano.', 'danger'));
  useEffect(() => { setP(null); if (id) carregar(); }, [id]);
  return html`
    <${ModalPadrao} aberto=${Boolean(id)} titulo="Plano de ação" onClose=${onClose}>
      ${!p ? html`<${LoadingState} titulo="Carregando" />` : html`
        <div class="mon-shell">
          <dl class="mon-dl">
            <div><dt>Operador</dt><dd>${p.operador_nome}</dd></div><div><dt>Responsável</dt><dd>${p.responsavel}</dd></div>
            <div><dt>Origem</dt><dd>${p.origem}</dd></div><div><dt>Prazo</dt><dd>${formatarData(p.prazo)}</dd></div>
            <div><dt>Problema</dt><dd>${p.problema}</dd></div><div><dt>Critério</dt><dd>${p.criterio || '—'}</dd></div>
            <div><dt>Objetivo</dt><dd>${p.objetivo}</dd></div><div><dt>Ação</dt><dd>${p.acao}</dd></div>
            <div><dt>Nota antes → depois</dt><dd>${formatarNota(p.nota_antes)} → ${formatarNota(p.nota_depois)}</dd></div><div><dt>Resultado</dt><dd>${p.resultado || '—'}</dd></div>
          </dl>
          <ol class="mon-timeline">${p.historico.map((h, i) => html`<li key=${i}><div><strong>${h.evento === 'criacao' ? 'Criado' : STATUS_PLANO[h.para] || h.evento}</strong><div class="quando">${formatarDataHoraCurta(h.em)} · ${h.por}</div>${h.detalhe ? html`<div class="mon-muted">${h.detalhe}</div>` : null}</div></li>`)}</ol>
          ${podeEditar && PROXIMOS[p.status].length ? html`
            <div class="mon-form-grid">
              <label>Novo status<select class="form-select" value=${form.status} onChange=${(e) => setForm({ ...form, status: e.target.value })}><option value="">Selecione…</option>${PROXIMOS[p.status].map((s) => html`<option key=${s} value=${s}>${STATUS_PLANO[s]}</option>`)}</select></label>
              <label>Resultado obtido<input class="form-control" value=${form.resultado} onInput=${(e) => setForm({ ...form, resultado: e.target.value })} /></label>
              <label>Observações / revisão<input class="form-control" value=${form.observacoes} onInput=${(e) => setForm({ ...form, observacoes: e.target.value })} /></label>
            </div>
            <div class="mon-acoes-fixas"><button type="button" class="btn btn-primary" disabled=${!form.status}
              onClick=${async () => { try { await revisarPlano(p.id_plano, form); showToast('Plano atualizado.', 'success'); setForm({ status: '', resultado: '', observacoes: '' }); await carregar(); onAlterou(); } catch (e) { showToast(e?.message || 'Erro ao atualizar.', 'danger'); } }}>Registrar revisão</button></div>` : null}
        </div>`}
    </${ModalPadrao}>`;
}

function NovoPlano({ aberto, contexto, onClose, onCriado, showToast }) {
  const operacoes = (contexto?.operacoes || []).filter((o) => o.ativo);
  const [operacao, setOperacao] = useState('');
  const [operadores, setOperadores] = useState([]);
  const [f, setF] = useState({ id_operador: '', origem: 'Manual', problema: '', criterio: '', objetivo: '', acao: '', prazo: '', observacoes: '' });
  useEffect(() => { if (operacoes.length === 1) setOperacao(operacoes[0].chave); }, [aberto]);
  useEffect(() => { if (operacao) listarOperadoresMonitoria(operacao).then((r) => setOperadores(r.itens || [])).catch(() => setOperadores([])); }, [operacao]);
  return html`
    <${ModalPadrao} aberto=${aberto} titulo="Novo plano de ação" onClose=${onClose}>
      <div class="mon-form-grid">
        <label>Operação<${SelectOperacao} contexto=${{ operacoes }} valor=${operacao} todas=${false} onChange=${setOperacao} /></label>
        <label>Operador<select class="form-select" value=${f.id_operador} onChange=${(e) => setF({ ...f, id_operador: e.target.value })}><option value="">Selecione…</option>${operadores.map((o) => html`<option key=${o.id_usuario} value=${o.id_usuario}>${o.nome}</option>`)}</select></label>
        <label>Problema identificado<input class="form-control" value=${f.problema} onInput=${(e) => setF({ ...f, problema: e.target.value })} /></label>
        <label>Critério relacionado<input class="form-control" value=${f.criterio} onInput=${(e) => setF({ ...f, criterio: e.target.value })} /></label>
        <label>Objetivo<input class="form-control" value=${f.objetivo} onInput=${(e) => setF({ ...f, objetivo: e.target.value })} /></label>
        <label>Ação proposta<input class="form-control" value=${f.acao} onInput=${(e) => setF({ ...f, acao: e.target.value })} /></label>
        <label>Prazo<input class="form-control" type="date" min=${hoje()} value=${f.prazo} onInput=${(e) => setF({ ...f, prazo: e.target.value })} /></label>
      </div>
      <div class="mon-acoes-fixas"><button type="button" class="btn btn-primary" disabled=${!operacao || !f.id_operador || !f.problema || !f.objetivo || !f.acao || !f.prazo}
        onClick=${async () => { try { await criarPlano({ ...f, operacao, id_operador: Number(f.id_operador) }); showToast('Plano de ação criado.', 'success'); onCriado(); } catch (e) { showToast(e?.message || 'Erro ao criar o plano.', 'danger'); } }}>Criar plano</button></div>
    </${ModalPadrao}>`;
}

// ---------------------------------------------------------------------------
// Relatórios (visualização + exportação XLSX/CSV — mesmo motor do dashboard)
// ---------------------------------------------------------------------------
const TIPOS_RELATORIO = [
  ['monitorias', 'Monitorias'],
  ['qualidade', 'Qualidade'],
  ['planos', 'Planos de ação'],
];

export function TelaRelatorios({ controlador, contexto, showToast }) {
  const podeExportar = controlador.possuiPermissao('monitoria.exportar');
  const [tipo, setTipo] = useState('monitorias');
  const [filtros, setFiltros] = useState({ operacao: '', data_inicio: '', data_fim: '' });
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [pagina, setPagina] = useState(1);
  useEffect(() => {
    setCarregando(true);
    setPagina(1);
    lerRelatorio(tipo, filtros).then(setDados).catch((e) => showToast(e?.message || 'Erro ao gerar o relatório.', 'danger')).finally(() => setCarregando(false));
  }, [tipo, filtros]);
  const exportar = async (formato) => {
    try { baixarArquivo(await exportarRelatorio(tipo, formato, filtros)); } catch (e) { showToast(e?.message || 'Erro na exportação.', 'danger'); }
  };
  const linhas = dados?.linhas || [];
  const por = 25;
  return html`
    <div class="mon-shell">
      <div class="mon-acoes">${TIPOS_RELATORIO.map(([k, r]) => html`<button key=${k} type="button" class=${`mon-subnav-btn ${tipo === k ? 'is-active' : ''}`} onClick=${() => setTipo(k)}>${r}</button>`)}</div>
      <div class="mon-filtros">
        ${(contexto?.operacoes || []).length > 1 ? html`<label class="mon-filtro">Operação<${SelectOperacao} contexto=${contexto} valor=${filtros.operacao} onChange=${(v) => setFiltros({ ...filtros, operacao: v })} /></label>` : null}
        <label class="mon-filtro mon-filtro--data">Período inicial<input class="form-control" type="date" value=${filtros.data_inicio} onInput=${(e) => setFiltros({ ...filtros, data_inicio: e.target.value })} /></label>
        <label class="mon-filtro mon-filtro--data">Período final<input class="form-control" type="date" value=${filtros.data_fim} onInput=${(e) => setFiltros({ ...filtros, data_fim: e.target.value })} /></label>
        ${podeExportar ? html`<div class="mon-filtros-acoes"><${BotaoExportar} opcoes=${[{ rotulo: 'Exportar XLSX', onSelecionar: () => exportar('xlsx') }, { rotulo: 'Exportar CSV', onSelecionar: () => exportar('csv') }]} /></div>` : null}
      </div>
      ${carregando ? html`<${LoadingState} titulo="Gerando relatório" />` : !linhas.length ? html`<${EmptyState} icon="table_chart" title="Sem dados" text="Nenhum registro para os filtros selecionados." />` : html`
        <div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr>${dados.colunas.map((c) => html`<th key=${c}>${c}</th>`)}</tr></thead><tbody>
          ${linhas.slice((pagina - 1) * por, pagina * por).map((l, i) => html`<tr key=${i}>${l.map((v, j) => html`<td key=${j}>${v === null || v === undefined ? '' : String(v)}</td>`)}</tr>`)}
        </tbody></table></div>
        <div class="mon-paginacao"><span>${linhas.length} linha(s)</span><div class="mon-acoes">
          <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${pagina <= 1} onClick=${() => setPagina(pagina - 1)}>Anterior</button>
          <span>Página ${pagina} de ${Math.max(1, Math.ceil(linhas.length / por))}</span>
          <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${pagina * por >= linhas.length} onClick=${() => setPagina(pagina + 1)}>Próxima</button></div></div>`}
    </div>`;
}
