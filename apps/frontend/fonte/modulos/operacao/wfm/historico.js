import { html, useCallback, useEffect, useMemo, useState } from '../../../infraestrutura-react.js';
import { exportarHistoricoWfm, listarHistoricoWfm, opcoesHistoricoWfm } from '../../../services/api/wfm.js?v=20261104-leitura';
import { baixarArquivo } from '../../../features/monitoria/comum.js';
import { Esqueleto, Estado, Ic, Janela, MenuAcoes, Selo } from '../../../ui/components/ds.js?v=20261106-wfm';

// Histórico de alterações (antiga "Auditoria de Plantões"; no redesign Fase 15 vira item "Registro" de Cadastros, amostra Q3):
// Quando · Quem · O quê · Ação · Item · Antes → depois, com período, busca, filtros e Exportar. Lista com cursor (20 na
// primeira carga, +20 em "Ver mais"), seleção por id que sobrevive ao "Ver mais", exportação (XLSX/CSV/PDF) gerada no
// servidor. Clique na linha abre a janela com o registro completo. Mesmas rotas de antes.

const ENTIDADES = {
  escala: 'Escala', escala_item: 'Dia da escala', presenca: 'Presença', atestado: 'Atestado', contrato: 'Jornada', turno: 'Turno',
  skill: 'Skill', calendario_especial: 'Calendário especial', operador: 'Colaborador', tipo_escala: 'Tipo de escala',
};
const TOM_ACAO = { presente: 'sucesso', troca: 'informacao' };
const PRIMEIRA_PAGINA = 20;
const PROXIMAS_PAGINAS = 20;

const doisDigitos = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
export function mesCorrente(hoje = new Date()) {
  return { ini: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), fim: iso(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)) };
}
const FILTROS_INICIAIS = () => ({ texto: '', operacao: '', entidade: '', operador: '', supervisor: '', ...mesCorrente() });
const PASSO = (p) => (p ? `${p.nome || '—'} · ${p.data.slice(0, 5)} às ${p.hora}` : '—');
const textoPares = (pares) => (pares || []).map((p) => (p.rotulo ? `${p.rotulo}: ${p.valor}` : p.valor)).join(' · ');

function JanelaRegistro({ item, onClose }) {
  const t = item.troca;
  const linhas = item.eh_troca
    ? [['Registrado em', item.registrado_em], ['Quem solicitou', PASSO(t?.solicitou)], ['Quem aceitou', PASSO(t?.aceitou)], ['Supervisor que trocou', PASSO(t?.efetivou)]]
    : [['Registrado em', item.registrado_em], ['Quem', `${item.operador || '—'}${item.perfil ? ` · ${item.perfil}` : ''}`], ['Supervisor', item.supervisor || '—'],
      ['O quê', `${ENTIDADES[item.entidade] || item.entidade}${item.entidade_id ? ` · ${item.entidade_id}` : ''}`], ['Plantão', item.hora_inicio ? `${item.data} · ${item.hora_inicio}–${item.hora_fim || '—'}` : '—']];
  return html`<${Janela} titulo=${`${item.acao_nome} · ${ENTIDADES[item.entidade] || item.entidade}`} onClose=${onClose}
    rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${onClose}>Fechar</button>`}>
    <div class="c-janela-corpo">
      <table class="c-diario-ficha"><tbody>
        ${linhas.map(([r, v]) => html`<tr key=${r}><td>${r}</td><td class="c-quebra">${v}</td></tr>`)}
        <tr><td>Antes</td><td class="c-quebra">${item.antes_texto || textoPares(item.antes) || '—'}</td></tr>
        <tr><td>Depois</td><td class="c-quebra">${item.depois_texto || textoPares(item.depois) || '—'}</td></tr>
        <tr><td>Justificativa</td><td class="c-quebra">${item.justificativa || '—'}</td></tr>
      </tbody></table>
    </div>
  <//>`;
}

export function TabelaHistorico({ contexto, showToast }) {
  const [filtros, setFiltros] = useState(FILTROS_INICIAIS);
  const [textoDigitado, setTextoDigitado] = useState('');
  const [opcoes, setOpcoes] = useState({ operadores: [], supervisores: [] });
  const [itens, setItens] = useState(null);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState(null);
  const [temMais, setTemMais] = useState(false);
  const [erro, setErro] = useState('');
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [selecionados, setSelecionados] = useState(() => new Set());
  const [exportando, setExportando] = useState(false);
  const [aberto, setAberto] = useState(null);

  // Busca de texto espera ~300 ms depois da última tecla; os demais filtros aplicam na hora.
  useEffect(() => {
    if (textoDigitado === filtros.texto) return undefined;
    const espera = window.setTimeout(() => setFiltros((f) => ({ ...f, texto: textoDigitado })), 300);
    return () => window.clearTimeout(espera);
  }, [textoDigitado, filtros.texto]);

  useEffect(() => {
    let ativo = true;
    opcoesHistoricoWfm(filtros.operacao).then((r) => { if (ativo && r) setOpcoes({ operadores: r.operadores || [], supervisores: r.supervisores || [] }); }).catch(() => {});
    return () => { ativo = false; };
  }, [filtros.operacao]);

  const consulta = useMemo(() => ({
    texto: filtros.texto, operacao: filtros.operacao, entidade: filtros.entidade, operador: filtros.operador,
    supervisor: filtros.supervisor, data_ini: filtros.ini, data_fim: filtros.fim,
  }), [filtros]);

  // Primeira carga (e a cada mudança de filtro): zera a lista e a seleção.
  useEffect(() => {
    let ativo = true;
    setItens(null); setErro(''); setSelecionados(new Set());
    listarHistoricoWfm({ ...consulta, limite: PRIMEIRA_PAGINA })
      .then((r) => { if (!ativo) return; setItens(r.itens || []); setTotal(r.total || 0); setCursor(r.proximo_cursor || null); setTemMais(Boolean(r.tem_mais)); })
      .catch((e) => { if (ativo) setErro(e?.message || 'Não foi possível carregar o Histórico.'); });
    return () => { ativo = false; };
  }, [consulta, tentativa]);

  const verMais = useCallback(async () => {
    if (!cursor || carregandoMais) return;
    setCarregandoMais(true);
    try {
      const r = await listarHistoricoWfm({ ...consulta, cursor, limite: PROXIMAS_PAGINAS });
      setItens((atual) => [...(atual || []), ...(r.itens || [])]);  // acrescenta; não apaga o que já está na tela
      setTotal(r.total || 0); setCursor(r.proximo_cursor || null); setTemMais(Boolean(r.tem_mais));
    } catch (e) { showToast?.(e?.message || 'Não foi possível carregar mais registros.', 'error'); } finally { setCarregandoMais(false); }
  }, [cursor, carregandoMais, consulta, showToast]);

  const alternarSelecao = (id) => setSelecionados((atual) => { const novo = new Set(atual); if (novo.has(id)) novo.delete(id); else novo.add(id); return novo; });
  const todosMarcados = Boolean(itens?.length) && itens.every((i) => selecionados.has(i.id));
  const algumMarcado = Boolean(itens?.some((i) => selecionados.has(i.id)));
  const alternarTodos = () => setSelecionados((atual) => {
    const novo = new Set(atual);
    if (todosMarcados) (itens || []).forEach((i) => novo.delete(i.id)); else (itens || []).forEach((i) => novo.add(i.id));
    return novo;
  });

  const exportar = async (formato, escopo) => {
    setExportando(true);
    try {
      const arquivo = await exportarHistoricoWfm({ ...consulta, formato, escopo, ids: escopo === 'selecionados' ? [...selecionados] : [] });
      baixarArquivo(arquivo);
      showToast?.('Arquivo gerado.', 'success');
    } catch (e) { showToast?.(e?.message || 'Não foi possível exportar.', 'error'); } finally { setExportando(false); }
  };
  const nSel = selecionados.size;
  const opcoesExportar = [
    ...['xlsx', 'csv', 'pdf'].map((f) => ({ label: `${f.toUpperCase()} · ${total} do filtro`, icon: 'download', disabled: !total || exportando, onClick: () => exportar(f, 'filtro') })),
    ...(nSel ? ['xlsx', 'csv', 'pdf'].map((f) => ({ label: `${f.toUpperCase()} · ${nSel} selecionado(s)`, icon: 'download', disabled: exportando, onClick: () => exportar(f, 'selecionados') })) : []),
  ];
  const mudar = (campo) => (ev) => setFiltros((f) => ({ ...f, [campo]: ev.target.value }));
  const limparFiltros = () => { setTextoDigitado(''); setFiltros(FILTROS_INICIAIS()); };

  return html`
    <div class="c-tabela-caixa">
      <div class="c-filtros c-filtros--suave c-filtros--quebra c-cad-faixa" role="search">
        <h2 class="c-cad-titulo">Histórico de alterações</h2>
        <input class="c-entrada c-entrada--compacta" type="date" aria-label="De" title="De" value=${filtros.ini} max=${filtros.fim || null} onChange=${(e) => e.target.value && setFiltros((f) => ({ ...f, ini: e.target.value }))} />
        <input class="c-entrada c-entrada--compacta" type="date" aria-label="Até" title="Até" value=${filtros.fim} min=${filtros.ini || null} onChange=${(e) => e.target.value && setFiltros((f) => ({ ...f, fim: e.target.value }))} />
        <div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" /><input class="c-entrada c-entrada--compacta" type="search" value=${textoDigitado} placeholder="Buscar pessoa ou item" aria-label="Buscar por operador, supervisor ou item" onInput=${(e) => setTextoDigitado(e.target.value)} /></div>
        ${(contexto?.operacoes || []).length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Operação" value=${filtros.operacao} onChange=${mudar('operacao')}><option value="">Operação: todas</option>${(contexto?.operacoes || []).map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select>` : null}
        <select class="c-entrada c-entrada--compacta" aria-label="O quê" value=${filtros.entidade} onChange=${mudar('entidade')}><option value="">O quê: tudo</option>${Object.entries(ENTIDADES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>
        ${opcoes.operadores.length ? html`<select class="c-entrada c-entrada--compacta" aria-label="Quem" value=${filtros.operador} onChange=${mudar('operador')}><option value="">Quem: todos</option>${opcoes.operadores.map((o) => html`<option key=${o} value=${o}>${o}</option>`)}</select>` : null}
        ${opcoes.supervisores.length ? html`<select class="c-entrada c-entrada--compacta" aria-label="Supervisor" value=${filtros.supervisor} onChange=${mudar('supervisor')}><option value="">Supervisor: todos</option>${opcoes.supervisores.map((o) => html`<option key=${o} value=${o}>${o}</option>`)}</select>` : null}
        <span class="c-contador">${total} registro(s)${nSel ? ` · ${nSel} selecionado(s)` : ''}</span>
        <${MenuAcoes} rotulo="Exportar" texto="Exportar" icone="download" classeBotao="c-botao c-botao--secundario c-botao--compacto" acoes=${opcoesExportar} />
      </div>
      ${erro ? html`<${Estado} titulo=${erro} rotuloAcao="Tentar de novo" aoAcao=${() => setTentativa((t) => t + 1)} />`
        : !itens ? html`<${Esqueleto} linhas=${8} />`
        : !itens.length ? html`<${Estado} icone="clock-counter-clockwise" titulo="Nenhum registro para este filtro." rotuloAcao="Limpar filtros" aoAcao=${limparFiltros} />`
        : html`<table class="c-tabela">
          <thead><tr>
            <th scope="col" style=${{ width: '40px' }}><label class="c-marcar"><input type="checkbox" aria-label="Selecionar todas as linhas carregadas" checked=${todosMarcados} ref=${(el) => { if (el) el.indeterminate = algumMarcado && !todosMarcados; }} onChange=${alternarTodos} /></label></th>
            <th scope="col">Quando</th><th scope="col">Quem</th><th scope="col">O quê · item</th><th scope="col" class="c-col-opc">Ação</th><th scope="col" class="c-estica">Antes → depois</th>
          </tr></thead>
          <tbody>${itens.map((i) => {
            const antes = i.antes_texto || textoPares(i.antes); const depois = i.depois_texto || textoPares(i.depois);
            return html`<tr key=${i.id} class="c-clicavel" aria-selected=${selecionados.has(i.id) ? 'true' : null} onClick=${(ev) => { if (!ev.target.closest('input, button, label')) setAberto(i); }}>
              <td data-papel="acoes"><label class="c-marcar"><input type="checkbox" aria-label=${`Selecionar registro ${i.id}`} checked=${selecionados.has(i.id)} onChange=${() => alternarSelecao(i.id)} /></label></td>
              <td class="c-num-esq" data-papel="info" data-prioridade="1" data-primeira="">${i.registrado_em || i.data}</td>
              <td data-papel="titulo"><span class="c-duas"><span class="c-forte">${i.operador || '—'}</span>${i.perfil ? html`<small>${i.perfil}</small>` : null}</span></td>
              <td data-papel="info" data-prioridade="1"><span class="c-duas"><span>${ENTIDADES[i.entidade] || i.entidade}</span>${i.entidade_id ? html`<small class="c-corta" title=${i.entidade_id}>${i.entidade_id}</small>` : null}</span></td>
              <td class="c-col-opc" data-papel="selo"><${Selo} tom=${TOM_ACAO[i.acao_tom] || 'neutro'}>${i.acao_nome}<//></td>
              <td class="c-estica"><span class="c-antes-depois" title=${`${antes || '—'} → ${depois || '—'}`}><s>${antes || '—'}</s><${Ic} nome="arrow-right" /><span>${depois || '—'}</span></span></td>
            </tr>`; })}</tbody>
        </table>`}
      ${itens?.length ? html`<div class="c-tabela-rodape">
        <span>Mostrando ${itens.length} de ${total} · mais recentes primeiro</span>
        ${temMais ? html`<button type="button" class="c-botao c-botao--secundario c-botao--compacto" aria-busy=${carregandoMais ? 'true' : null} disabled=${carregandoMais || null} onClick=${verMais}>${carregandoMais ? 'Carregando…' : 'Mostrar mais'}</button>` : null}
      </div>` : null}
    </div>
    ${aberto ? html`<${JanelaRegistro} item=${aberto} onClose=${() => setAberto(null)} />` : null}`;
}

// Página solta (rota antiga screen-wfm-auditoria): o mesmo Histórico com o cabeçalho.
export function TelaHistorico({ contexto, showToast }) {
  return html`<main class="c-pagina c-conteudo"><div class="c-cab-linha"><h1>Histórico de alterações</h1></div><${TabelaHistorico} contexto=${contexto} showToast=${showToast} /></main>`;
}
