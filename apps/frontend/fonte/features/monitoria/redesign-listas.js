import { html, useEffect, useMemo, useRef, useState } from '../../infraestrutura-react.js';
import {
  anexarEvidencia,
  baixarEvidencia,
  confirmarMonitoria,
  contestarMonitoria,
  excluirMonitoria,
  exportarMonitorias,
  lerMonitoria,
  listarMonitorias,
  reanalisarContestacao,
} from '../../services/api/monitoria.js';
import { marcarNotificacoesEntidadeLidas } from '../../services/api/notifications.js?v=20260921-alertas';
import { Campo, Esqueleto, Estado, Faixa, Ic, Janela, MenuAcoes, Segmento, Selo } from '../../ui/components/ds.js?v=20261106-wfm';
import { STATUS_INFO, baixarArquivo, formatarHoras, formatarNota } from './comum.js';

// Monitoria no desenho novo (Fase 15, amostras Fase 12 "Histórico" e Fase 14 "Minhas monitorias" e
// "Contestações"). Mesmas rotas e regras de antes: a monitoria nunca é editada; cada ação só acrescenta
// confirmação, contestação ou reanálise. Escopo (operação, equipe, perfil) é todo do servidor.

const pad = (n) => String(n).padStart(2, '0');
const isoDia = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const diaMes = (iso) => { if (!iso) return '—'; const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : iso); return Number.isNaN(d.getTime()) ? '—' : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const horaMin = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
// ID curto (DEC-068): sem "#MON-2026-", só os 5 últimos dígitos (o código inteiro fica na dica).
const idCurto = (codigo) => String(codigo || '').slice(-5);

// Situação com o tom do catálogo (DEC-056). O Operador vê "Para você confirmar" no lugar de "Aguardando confirmação".
const SITUACAO = {
  REALIZADA: ['Realizada', 'informacao', 'info'],
  FEEDBACK_PENDENTE: ['Feedback pendente', 'atencao', 'clock'],
  FEEDBACK_APLICADO: ['Feedback aplicado', 'informacao', 'info'],
  AGUARDANDO_CONFIRMACAO: ['Aguardando confirmação', 'atencao', 'clock'],
  CONFIRMADA: ['Confirmada', 'sucesso', 'check-circle'],
  CONTESTADA: ['Contestada', 'atencao', 'flag'],
  REANALISE: ['Em reanálise', 'informacao', 'arrows-clockwise'],
  ANULADA: ['Anulada', 'neutro', 'prohibit'],
  FINALIZADA: ['Finalizada', 'sucesso', 'check-circle'],
};
export function SeloSituacao({ item, perfil }) {
  let [rotulo, tom, icone] = SITUACAO[item.status] || [item.status_rotulo || item.status, 'neutro', ''];
  if (perfil === 'operador' && item.status === 'AGUARDANDO_CONFIRMACAO') rotulo = 'Para você confirmar';
  if (perfil === 'operador' && ['CONTESTADA', 'REANALISE'].includes(item.status)) rotulo = 'Em reanálise';
  const extra = item.possui_ncg ? ' · NCG' : item.resultado === 'SEM_FEEDBACK' ? ' · sem feedback' : '';
  return html`<${Selo} tom=${tom} icone=${icone} title=${item.status_rotulo || null}>${rotulo}${extra}<//>`;
}

// Prazo só como texto: laranja vence em breve, vermelho venceu, cinza o resto.
export function textoPrazo(sla) {
  if (!sla) return ['—', 'c-secundario'];
  if (sla.estado === 'VENCIDO') return [`venceu há ${formatarHoras(sla.atraso_h)}`, 'c-prazo c-prazo--perigo'];
  if (sla.estado === 'PROXIMO_DO_VENCIMENTO') return [`vence em ${formatarHoras(sla.restante_h)}`, 'c-prazo c-prazo--atencao'];
  if (sla.estado === 'DENTRO_DO_PRAZO') return [formatarHoras(sla.restante_h), 'c-secundario'];
  return ['—', 'c-secundario'];
}
const limiteDoPrazo = (sla) => (sla && sla.estado !== 'VENCIDO' && Number(sla.restante_h) > 0 ? new Date(Date.now() + Number(sla.restante_h) * 3600000) : null);
const quandoLimite = (data) => {
  if (!data) return '';
  const hoje = new Date();
  const amanha = new Date(hoje); amanha.setDate(hoje.getDate() + 1);
  const dia = isoDia(data) === isoDia(hoje) ? 'hoje' : isoDia(data) === isoDia(amanha) ? 'amanhã' : diaMes(isoDia(data));
  return `${dia} ${horaMin(data)}`;
};

// Período (DEC-054): os filtros aplicam sozinhos; "De/Até" viram um campo só.
const PERIODOS = [['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['mes', 'Este mês'], ['90', 'Últimos 90 dias'], ['tudo', 'Todo o período'], ['datas', 'Escolher datas…']];
function intervaloDe(periodo, datas) {
  const hoje = new Date();
  if (periodo === 'tudo') return ['', ''];
  if (periodo === 'datas') return [datas[0] || '', datas[1] || ''];
  if (periodo === 'mes') return [isoDia(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), isoDia(hoje)];
  const ini = new Date(hoje); ini.setDate(hoje.getDate() - (Number(periodo) - 1));
  return [isoDia(ini), isoDia(hoje)];
}
const rotuloPeriodo = (periodo) => (PERIODOS.find(([v]) => v === periodo)?.[1] || '').toLowerCase();

const MODOS = {
  historico: { status: '', periodo: '7' },
  contestacoes: { status: 'REANALISE', periodo: 'tudo' },
  minhas: { status: '', periodo: '90' },
};
const POR_PAGINA = 20;

export function ListaMonitoriasNova({ modo = 'historico', controlador, contexto, abrirDetalhe, atualizacao, showToast, aoAlterou }) {
  const perfil = controlador?.estado?.perfilUsuario;
  const ehOperador = perfil === 'operador';
  const cfg = MODOS[modo] || MODOS.historico;
  const podeExportar = controlador.possuiPermissao('monitoria.exportar');
  const ehAdministrador = perfil === 'administrador';
  const podeSelecionar = modo === 'historico' && (podeExportar || ehAdministrador);
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [avaliador, setAvaliador] = useState('');
  const [avaliadorAplicado, setAvaliadorAplicado] = useState('');
  const [operacao, setOperacao] = useState('');
  const [status, setStatus] = useState(cfg.status);
  const [periodo, setPeriodo] = useState(cfg.periodo);
  const [datas, setDatas] = useState(['', '']);
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [selecionadas, setSelecionadas] = useState([]);
  const [excluindo, setExcluindo] = useState(null);
  const [painel, setPainel] = useState(null); // { tipo: 'minha' | 'reanalisar', ref }
  const [criterios, setCriterios] = useState({}); // contestações: id_monitoria -> "1 de 2"
  const [versao, setVersao] = useState(0);

  useEffect(() => { setStatus(cfg.status); setPeriodo(cfg.periodo); setPagina(1); setSelecionadas([]); setPainel(null); }, [modo]);
  // A busca aplica sozinha, 300 ms depois de parar de digitar.
  useEffect(() => { const t = setTimeout(() => { setBuscaAplicada(busca.trim()); setPagina(1); }, 300); return () => clearTimeout(t); }, [busca]);
  useEffect(() => { const t = setTimeout(() => { setAvaliadorAplicado(avaliador.trim()); setPagina(1); }, 300); return () => clearTimeout(t); }, [avaliador]);

  const [dataIni, dataFim] = intervaloDe(periodo, datas);
  const filtros = useMemo(() => {
    const ehCodigo = /^\d{3,8}$/.test(buscaAplicada);
    return {
      codigo: ehCodigo && buscaAplicada.length === 8 ? buscaAplicada : '',
      operador: !ehCodigo ? buscaAplicada : '',
      avaliador: avaliadorAplicado, operacao, status: modo === 'contestacoes' ? 'REANALISE' : status, data_inicio: dataIni, data_fim: dataFim,
    };
  }, [buscaAplicada, avaliadorAplicado, operacao, status, dataIni, dataFim, modo]);

  useEffect(() => {
    let ativo = true;
    setErro('');
    listarMonitorias({ ...filtros, pagina, por_pagina: POR_PAGINA })
      .then((r) => { if (ativo) setDados(r); })
      .catch((e) => { if (ativo) { setDados({ itens: [], total: 0 }); setErro(e?.message || 'Não foi possível carregar as monitorias.'); } });
    return () => { ativo = false; };
  }, [filtros, pagina, atualizacao, versao]);

  // Busca por parte do ID (3 a 7 dígitos): filtra na página, o servidor só busca o código inteiro.
  const itensBrutos = dados?.itens || [];
  const itens = useMemo(() => {
    let lista = /^\d{3,7}$/.test(buscaAplicada) ? itensBrutos.filter((m) => String(m.codigo).includes(buscaAplicada)) : itensBrutos;
    if (modo === 'contestacoes') {
      // Vence antes, aparece antes.
      const chave = (m) => (m.sla?.estado === 'VENCIDO' ? -Number(m.sla.atraso_h || 0) : Number(m.sla?.restante_h ?? 1e9));
      lista = [...lista].sort((a, b) => chave(a) - chave(b));
    }
    return lista;
  }, [itensBrutos, buscaAplicada, modo]);

  // Contestações: quantos critérios foram contestados, entre os que tiveram "Não"/NCG (lido do detalhe de cada uma).
  useEffect(() => {
    if (modo !== 'contestacoes' || !itensBrutos.length) return undefined;
    let ativo = true;
    Promise.all(itensBrutos.slice(0, POR_PAGINA).map((m) => lerMonitoria(String(m.id_monitoria)).then((d) => {
      const c = [...(d.contestacoes || [])].reverse().find((x) => !x.reanalise) || d.contestacoes?.[d.contestacoes.length - 1];
      const naos = Object.values(d.respostas || {}).filter((v) => v === 'NAO' || v === 'NCG').length;
      return [m.id_monitoria, c ? `${c.criterios.length} de ${Math.max(naos, c.criterios.length)}` : '—'];
    }, () => [m.id_monitoria, '—']))).then((pares) => { if (ativo) setCriterios(Object.fromEntries(pares)); });
    return () => { ativo = false; };
  }, [itensBrutos, modo]);

  const total = dados?.total || 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const operacoes = contexto?.operacoes || [];
  const recarregar = () => { setVersao((v) => v + 1); aoAlterou?.(); };

  const abrir = (m) => {
    if (modo === 'contestacoes' && m.status === 'REANALISE' && controlador.possuiPermissao('monitoria.reanalisar')) return setPainel({ tipo: 'reanalisar', ref: String(m.id_monitoria) });
    if (modo === 'minhas') return setPainel({ tipo: 'minha', ref: String(m.id_monitoria) });
    return abrirDetalhe(String(m.id_monitoria));
  };

  const exportarSel = async (formato) => {
    try { baixarArquivo(await exportarMonitorias(selecionadas, formato)); } catch (e) { showToast?.(e?.message || 'Não foi possível exportar.', 'danger'); }
  };
  const excluirSel = async () => {
    setExcluindo((x) => ({ ...x, ocupado: true }));
    let feitas = 0; let falha = '';
    for (const id of selecionadas) {
      const m = itensBrutos.find((i) => i.id_monitoria === id);
      try { await excluirMonitoria(m?.codigo || String(id), excluindo.motivo.trim(), m?.codigo || ''); feitas += 1; } catch (e) { falha = e?.message || 'Não foi possível excluir.'; break; }
    }
    setExcluindo(null); setSelecionadas([]);
    showToast?.(falha ? `${feitas} excluída(s). Parou com erro: ${falha}` : `${feitas} monitoria(s) excluída(s).`, falha ? 'danger' : 'success');
    recarregar();
  };

  const idsPagina = itens.map((m) => m.id_monitoria);
  const todas = idsPagina.length > 0 && idsPagina.every((id) => selecionadas.includes(id));
  const algumas = idsPagina.some((id) => selecionadas.includes(id));
  const alternar = (id) => setSelecionadas((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const colOperador = !ehOperador && modo !== 'minhas' || (modo === 'minhas' && !ehOperador);
  const colEquipe = modo === 'historico' && !ehOperador;
  const colunas = 1 + (podeSelecionar ? 1 : 0) + (modo !== 'contestacoes' ? 1 : 0) + (colOperador ? 1 : 0) + 1 + (colEquipe ? 1 : 0) + 1 + (modo === 'contestacoes' ? 1 : 0) + 1 + (modo !== 'contestacoes' ? 1 : 0) + 2;
  const media = itens.length ? itens.reduce((t, m) => t + Number(m.nota || 0), 0) / itens.length : null;

  const acoesLinha = (m) => {
    const lista = [
      { label: 'Abrir detalhe completo', icon: 'arrow-square-out', onClick: () => abrirDetalhe(String(m.id_monitoria)) },
      podeExportar ? { label: 'Exportar (XLSX)', icon: 'download', onClick: async () => { try { baixarArquivo(await exportarMonitorias([m.id_monitoria])); } catch (e) { showToast?.(e?.message || 'Não foi possível exportar.', 'danger'); } } } : null,
    ];
    return html`<${MenuAcoes} rotulo=${`Mais ações da monitoria ${idCurto(m.codigo)}`} acoes=${lista} />`;
  };
  const botaoLinha = (m) => {
    if (modo === 'minhas' && ehOperador && m.status === 'AGUARDANDO_CONFIRMACAO') return html`<button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${(e) => { e.stopPropagation(); setPainel({ tipo: 'minha', ref: String(m.id_monitoria) }); }}>Responder</button>`;
    if (modo === 'contestacoes' && m.status === 'REANALISE' && controlador.possuiPermissao('monitoria.reanalisar')) return html`<button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${(e) => { e.stopPropagation(); setPainel({ tipo: 'reanalisar', ref: String(m.id_monitoria) }); }}>Reanalisar</button>`;
    return (modo === 'minhas' && ehOperador) || modo === 'contestacoes' ? html`<span style=${{ display: 'inline-block', width: '86px' }}></span>` : null;
  };

  return html`
    <div class="c-tabela-caixa">
      <div class="c-filtros c-filtros--suave">
        ${ehOperador ? null : html`<div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" /><input class="c-entrada c-entrada--compacta" type="search" placeholder="ID ou operador" aria-label="Buscar por ID ou operador" value=${busca} onInput=${(e) => setBusca(e.target.value)} /></div>`}
        ${operacoes.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Operação" value=${operacao} onChange=${(e) => { setOperacao(e.target.value); setPagina(1); }}>
          <option value="">Todas as operações</option>${operacoes.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select>` : null}
        ${modo === 'minhas' && ehOperador ? null : html`<div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="user" /><input class="c-entrada c-entrada--compacta" type="search" placeholder="Avaliador" aria-label="Avaliador" value=${avaliador} onInput=${(e) => setAvaliador(e.target.value)} /></div>`}
        ${modo === 'contestacoes' ? null : html`<select class="c-entrada c-entrada--compacta" aria-label="Situação" value=${status} onChange=${(e) => { setStatus(e.target.value); setPagina(1); }}>
          <option value="">Todas as situações</option>${Object.keys(STATUS_INFO).map((k) => html`<option key=${k} value=${k}>${(SITUACAO[k] || [STATUS_INFO[k].rotulo])[0]}</option>`)}</select>`}
        <select class="c-entrada c-entrada--compacta" aria-label="Período" value=${periodo} onChange=${(e) => { setPeriodo(e.target.value); setPagina(1); }}>
          ${PERIODOS.map(([v, r]) => html`<option key=${v} value=${v}>${r}</option>`)}</select>
        ${periodo === 'datas' ? html`
          <input class="c-entrada c-entrada--compacta" type="date" aria-label="De" value=${datas[0]} max=${datas[1] || undefined} onChange=${(e) => { setDatas([e.target.value, datas[1]]); setPagina(1); }} />
          <input class="c-entrada c-entrada--compacta" type="date" aria-label="Até" value=${datas[1]} min=${datas[0] || undefined} onChange=${(e) => { setDatas([datas[0], e.target.value]); setPagina(1); }} />` : null}
      </div>
      ${podeSelecionar && selecionadas.length ? html`<div class="c-selecao" role="region" aria-label="Seleção">
        <span>${selecionadas.length} selecionada(s)</span>
        ${podeExportar ? html`<${MenuAcoes} rotulo="Exportar seleção" texto="Exportar" icone="download" classeBotao="c-botao c-botao--secundario c-botao--compacto"
          acoes=${[{ label: 'XLSX', onClick: () => exportarSel('xlsx') }, { label: 'CSV', onClick: () => exportarSel('csv') }, { label: 'PDF', onClick: () => exportarSel('pdf') }]} />` : null}
        ${ehAdministrador ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto c-menu-item--perigo" onClick=${() => setExcluindo({ motivo: '', confirmacao: '' })}><${Ic} nome="trash" />Excluir seleção</button>` : null}
        <button type="button" class="c-botao c-botao--texto c-botao--compacto c-fim" onClick=${() => setSelecionadas([])}>Limpar seleção</button>
      </div>` : null}
      ${!dados ? html`<${Esqueleto} linhas=${8} />` : html`
      <table class="c-tabela c-tabela--justa">
        <thead><tr>
          ${podeSelecionar ? html`<th class="c-marca"><input type="checkbox" aria-label="Selecionar as monitorias da página" checked=${todas} ref=${(el) => { if (el) el.indeterminate = algumas && !todas; }}
            onChange=${() => setSelecionadas((s) => (todas ? s.filter((id) => !idsPagina.includes(id)) : [...new Set([...s, ...idsPagina])]))} /></th>` : null}
          <th scope="col">ID</th>
          ${modo !== 'contestacoes' ? html`<th scope="col">Data</th>` : null}
          ${colOperador ? html`<th scope="col" class="c-col-nome">Operador</th>` : null}
          <th scope="col">Operação</th>
          ${colEquipe ? html`<th scope="col">Equipe</th>` : null}
          <th scope="col">Avaliador</th>
          ${modo === 'contestacoes' ? html`<th scope="col" class="c-num">Critérios</th>` : null}
          <th scope="col" class="c-num">Nota</th>
          ${modo !== 'contestacoes' ? html`<th scope="col">Situação</th>` : null}
          <th scope="col">Prazo</th>
          <th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th>
        </tr></thead>
        <tbody>
          ${itens.length ? itens.map((m) => {
    const [prazo, classePrazo] = textoPrazo(m.sla);
    const sel = painel && painel.ref === String(m.id_monitoria);
    return html`<tr key=${m.id_monitoria} class="c-clicavel" tabIndex="0" data-mon-id=${m.id_monitoria} aria-selected=${sel ? 'true' : null}
              onClick=${() => abrir(m)} onKeyDown=${(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrir(m); } }}>
              ${podeSelecionar ? html`<td class="c-marca"><input type="checkbox" aria-label=${`Selecionar ${m.codigo}`} checked=${selecionadas.includes(m.id_monitoria)} onClick=${(e) => e.stopPropagation()} onChange=${() => alternar(m.id_monitoria)} /></td>` : null}
              <td class="c-secundario" title=${`ID ${m.codigo}`}>${idCurto(m.codigo)}</td>
              ${modo !== 'contestacoes' ? html`<td>${diaMes(m.data_monitoria)}</td>` : null}
              ${colOperador ? html`<td class="c-forte c-col-nome">${m.operador_nome}</td>` : null}
              <td>${m.operacao_nome || m.operacao}</td>
              ${colEquipe ? html`<td>${m.equipe_nome || '—'}</td>` : null}
              <td>${m.avaliador_nome}</td>
              ${modo === 'contestacoes' ? html`<td class="c-num">${criterios[m.id_monitoria] || '…'}</td>` : null}
              <td class="c-num c-forte">${formatarNota(m.nota)}</td>
              ${modo !== 'contestacoes' ? html`<td><${SeloSituacao} item=${m} perfil=${perfil} /></td>` : null}
              <td class=${classePrazo}>${prazo}</td>
              <td class="c-acoes" onClick=${(e) => e.stopPropagation()}><div class="c-grupo">${botaoLinha(m)}${acoesLinha(m)}</div></td>
            </tr>`;
  }) : html`<tr><td colspan=${colunas}><${Estado} icone="clipboard-text" titulo=${erro || (modo === 'contestacoes' ? 'Nenhuma contestação aguardando reanálise.' : 'Nenhuma monitoria com estes filtros.')}
              rotuloAcao=${!erro && periodo !== 'tudo' && modo !== 'contestacoes' ? 'Ver todo o período' : null} aoAcao=${() => setPeriodo('tudo')} /></td></tr>`}
        </tbody>
      </table>`}
      <div class="c-legenda">
        <span>${modo === 'contestacoes' ? `${total} ${total === 1 ? 'aguarda' : 'aguardam'} reanálise · vence antes, aparece antes`
    : modo === 'minhas' && ehOperador ? `${total} ${periodo === 'tudo' ? 'no total' : `nos ${rotuloPeriodo(periodo)}`}${media !== null ? ` · nota média ${formatarNota(Math.round(media * 10) / 10)}` : ''}`
      : `${itens.length} de ${total}${periodo === 'tudo' ? '' : ` · ${rotuloPeriodo(periodo)}`}`}</span>
        ${modo === 'historico' ? html`<span style=${{ marginLeft: 'auto' }}>Prazo em laranja = vence em breve · em vermelho = venceu</span>` : null}
        ${totalPaginas > 1 ? html`<span class="c-grupo" style=${{ marginLeft: modo === 'historico' ? '16px' : 'auto' }}>
          <button type="button" class="c-botao c-botao--texto c-botao--compacto" disabled=${pagina <= 1 || null} onClick=${() => setPagina(pagina - 1)}><${Ic} nome="caret-left" />Anterior</button>
          <span>Página ${pagina} de ${totalPaginas}</span>
          <button type="button" class="c-botao c-botao--texto c-botao--compacto" disabled=${pagina >= totalPaginas || null} onClick=${() => setPagina(pagina + 1)}>Próxima<${Ic} nome="caret-right" /></button>
        </span>` : null}
      </div>
    </div>
    ${painel?.tipo === 'minha' ? html`<${PainelMinhaMonitoria} key=${painel.ref} referencia=${painel.ref} controlador=${controlador} showToast=${showToast}
      onClose=${() => setPainel(null)} onAlterou=${recarregar} abrirDetalhe=${abrirDetalhe} />` : null}
    ${painel?.tipo === 'reanalisar' ? html`<${PainelReanalisar} key=${painel.ref} referencia=${painel.ref} showToast=${showToast}
      onClose=${() => setPainel(null)} onAlterou=${() => { setPainel(null); recarregar(); }} abrirDetalhe=${abrirDetalhe} />` : null}
    ${excluindo ? html`<${Janela} titulo="Excluir monitorias" tamanho="pequena" onClose=${() => !excluindo.ocupado && setExcluindo(null)}
      rodape=${html`<button type="button" class="c-botao c-botao--secundario" disabled=${excluindo.ocupado || null} onClick=${() => setExcluindo(null)}>Cancelar</button>
        <button type="button" class="c-botao c-botao--perigo" aria-busy=${excluindo.ocupado ? 'true' : null} disabled=${excluindo.ocupado || excluindo.motivo.trim().length < 5 || excluindo.confirmacao.trim() !== 'EXCLUIR' || null} onClick=${excluirSel}>${excluindo.ocupado ? 'Excluindo…' : 'Excluir'}</button>`}>
      <div class="c-janela-corpo" style=${{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <p><b>${selecionadas.length} monitoria(s)</b> saem de listas, painéis e indicadores. Fica registrado no log com o motivo.</p>
        <${Campo} rotulo="Motivo"><input class="c-entrada" maxlength="400" value=${excluindo.motivo} onInput=${(e) => setExcluindo({ ...excluindo, motivo: e.target.value })} /><//>
        <${Campo} rotulo="Digite EXCLUIR para confirmar"><input class="c-entrada" value=${excluindo.confirmacao} onInput=${(e) => setExcluindo({ ...excluindo, confirmacao: e.target.value })} /><//>
      </div>
    <//>` : null}
  `;
}

// ---------------------------------------------------------------------------
// Painel lateral (600 px) com o gabarito completo, em blocos dobrados.
// ---------------------------------------------------------------------------
const ROT_RESP = { SIM: 'Sim', NAO: 'Não', NCG: 'NCG', NA: 'N/A' };
function Resposta({ valor }) {
  const nao = valor === 'NAO' || valor === 'NCG';
  if (valor === 'NA') return html`<span class="c-secundario">N/A</span>`;
  return html`<span class=${`c-gab-r ${nao ? 'c-gab-r--nao' : ''}`.trim()}><${Ic} nome=${nao ? 'x-circle' : 'check-circle'} />${ROT_RESP[valor] || valor || '—'}</span>`;
}

function Gabarito({ d }) {
  const [abertos, setAbertos] = useState({});
  const statusBloco = Object.fromEntries((d.blocos || []).map((b) => [b.id, b]));
  return html`<table class="c-tabela c-tabela--compacta c-gab">
    <thead><tr><th scope="col">Bloco e critério</th><th scope="col">Resposta</th><th scope="col" class="c-num">Peso</th></tr></thead>
    ${(d.config?.blocos || []).map((b) => {
    const st = statusBloco[b.id];
    const naos = b.criterios.filter((c) => ['NAO', 'NCG'].includes(d.respostas?.[c.id])).length;
    const nulo = st?.status === 'NULO';
    const aberto = Boolean(abertos[b.id]);
    const idCorpo = `gab-${d.id_monitoria}-${b.id}`;
    return html`<tbody key=${b.id} class="c-gab-grupo"><tr class="c-gab-bloco"><td colspan="2">
        <button class="c-gab-abre" type="button" aria-expanded=${aberto ? 'true' : 'false'} aria-controls=${idCorpo} onClick=${() => setAbertos((a) => ({ ...a, [b.id]: !a[b.id] }))}>
          <${Ic} nome="caret-right" />${b.nome}<span class="c-gab-qtd">${b.criterios.length} critério(s)</span>
          ${nulo ? html`<span class="c-gab-r c-secundario">bloco nulo (N/A)</span>` : naos ? html`<span class="c-gab-r c-gab-r--nao"><${Ic} nome="x-circle" />${naos} não</span>` : html`<span class="c-gab-r"><${Ic} nome="check-circle" />todos sim</span>`}
        </button></td>
        <td class="c-num">${nulo ? '—' : `${formatarNota(st?.pontos)} de ${formatarNota(st?.valor_efetivo)}`}</td></tr></tbody>
      <tbody id=${idCorpo} hidden=${!aberto || null}>${b.criterios.map((c) => html`<tr key=${c.id} class=${['NAO', 'NCG'].includes(d.respostas?.[c.id]) ? 'c-gab-nao' : ''}>
        <td style=${{ paddingLeft: '32px' }}>${c.texto}</td><td><${Resposta} valor=${d.respostas?.[c.id]} /></td><td class="c-num">${formatarNota(c.peso)}</td></tr>`)}</tbody>`;
  })}
    <tbody><tr class="c-gab-total"><td colspan="2">Total</td><td class="c-num">${formatarNota(d.nota)} de 100</td></tr></tbody>
  </table>`;
}

function useDetalhe(referencia) {
  const [d, setD] = useState(null);
  const [erro, setErro] = useState('');
  const carregar = async () => { try { setD(await lerMonitoria(referencia)); setErro(''); } catch (e) { setErro(e?.message || 'Não foi possível carregar a monitoria.'); } };
  useEffect(() => { setD(null); carregar(); }, [referencia]);
  useEffect(() => { if (d?.id_monitoria) marcarNotificacoesEntidadeLidas('monitoria', d.id_monitoria).catch(() => {}); }, [d?.id_monitoria]);
  return { d, erro, carregar };
}

function PainelLateral({ rotulo, titulo, sub, onClose, rodape = null, classe = '', children }) {
  const ref = useRef(null);
  useEffect(() => {
    const anterior = document.activeElement;
    ref.current?.focus();
    const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.c-fundo-janela')) onClose(); };
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('keydown', esc); if (anterior && document.contains(anterior)) anterior.focus?.(); };
  }, []);
  return html`<aside ref=${ref} tabIndex="-1" class=${`c-painel-lateral c-diario c-ds ${classe}`.trim()} style=${{ width: 'min(600px, 100%)' }} role="dialog" aria-label=${rotulo}>
    <div class="c-janela-cab"><h2>${titulo}${sub ? html`<small>${sub}</small>` : null}</h2>
      <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Fechar" title="Fechar" style=${{ marginLeft: 'auto' }} onClick=${onClose}><${Ic} nome="x" /></button></div>
    <div class="c-janela-corpo">${children}</div>
    ${rodape ? html`<div class="c-janela-rodape">${rodape}</div>` : null}
  </aside>`;
}

export function PainelMinhaMonitoria({ referencia, controlador, showToast, onClose, onAlterou, abrirDetalhe }) {
  const { d, erro, carregar } = useDetalhe(referencia);
  const [contestando, setContestando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const perfil = controlador?.estado?.perfilUsuario;
  if (erro) return html`<${PainelLateral} rotulo="Monitoria" titulo="Monitoria" onClose=${onClose}><${Estado} titulo=${erro} rotuloAcao="Tentar de novo" aoAcao=${carregar} /><//>`;
  if (!d) return html`<${PainelLateral} rotulo="Monitoria" titulo="Monitoria" onClose=${onClose}><${Esqueleto} linhas=${6} /><//>`;
  const ehDono = perfil === 'operador' && controlador.possuiPermissao('monitoria.contestar');
  const podeManifestar = ehDono && d.status === 'AGUARDANDO_CONFIRMACAO';
  const respostas = Object.values(d.respostas || {});
  const avaliados = respostas.filter((v) => v !== 'NA').length;
  const atendidos = respostas.filter((v) => v === 'SIM').length;
  const limite = limiteDoPrazo(d.sla);
  const feedback = (d.feedbacks || [])[d.feedbacks.length - 1];
  const confirmar = async () => {
    setOcupado(true);
    try { await confirmarMonitoria(d.codigo); showToast?.('Você confirmou a monitoria.', 'success'); await carregar(); onAlterou?.(); } catch (e) { showToast?.(e?.message || 'Não foi possível confirmar.', 'danger'); } finally { setOcupado(false); }
  };
  return html`<${PainelLateral} rotulo=${`Monitoria ${idCurto(d.codigo)}`} titulo=${`Monitoria ${idCurto(d.codigo)}`}
      sub=${`${diaMes(d.data_monitoria)} · ${d.operacao_nome || d.operacao} · avaliada por ${d.avaliador_nome || '—'}`} onClose=${onClose}
      rodape=${podeManifestar ? html`<button type="button" class="c-botao c-botao--secundario" disabled=${ocupado || null} onClick=${() => setContestando(true)}><${Ic} nome="flag" />Contestar</button>
        <button type="button" class="c-botao c-botao--principal" aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || null} onClick=${confirmar}><${Ic} nome="check" />Confirmar</button>`
    : html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => abrirDetalhe(String(d.id_monitoria))}><${Ic} nome="arrow-square-out" />Ver detalhe completo</button>`}>
    <div class="c-diario-numeros" style=${{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
      <div><small>Nota</small><b>${formatarNota(d.nota)}</b><em>de 100 pontos</em></div>
      <div><small>Critérios</small><b>${atendidos} de ${avaliados}</b><em>atendidos</em></div>
      ${podeManifestar && limite ? html`<div><small>Responder até</small><b class="c-prazo--atencao">${horaMin(limite)}</b><em>${quandoLimite(limite).split(' ')[0]} · depois, confirma sozinha</em></div>`
    : html`<div><small>Situação</small><b style=${{ fontSize: '14px' }}><${SeloSituacao} item=${d} perfil=${perfil} /></b><em>${d.faixa?.label || ''}</em></div>`}
    </div>
    <div><h3>Gabarito</h3><${Gabarito} d=${d} /></div>
    ${feedback ? html`<div class="c-feedback"><h3>Feedback da qualidade</h3><p>${feedback.observacao}</p>${feedback.complemento ? html`<p>${feedback.complemento}</p>` : null}</div>`
    : d.sugestao_feedback && !ehDono ? html`<div class="c-feedback"><h3>Sugestão de feedback</h3><p>${d.sugestao_feedback}</p></div>` : null}
    ${contestando ? html`<${JanelaContestar} d=${d} showToast=${showToast} onClose=${() => setContestando(false)} onEnviado=${async () => { setContestando(false); await carregar(); onAlterou?.(); }} />` : null}
  <//>`;
}

const MOTIVOS = ['Fiz o que o procedimento pede', 'O critério não se aplica a este contato', 'Outro motivo'];
function JanelaContestar({ d, showToast, onClose, onEnviado }) {
  const candidatos = (d.config?.blocos || []).flatMap((b) => b.criterios.filter((c) => ['NAO', 'NCG'].includes(d.respostas?.[c.id])).map((c) => ({ ...c, bloco: b.nome })));
  const [marcados, setMarcados] = useState(candidatos.length === 1 ? [candidatos[0].id] : []);
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const [outro, setOutro] = useState('');
  const [texto, setTexto] = useState('');
  const [arquivo, setArquivo] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const arquivoRef = useRef(null);
  const motivoFinal = motivo === 'Outro motivo' ? outro.trim() : motivo;
  const pronto = marcados.length && motivoFinal && texto.trim();
  const enviar = async () => {
    setOcupado(true); setErro('');
    try {
      await contestarMonitoria(d.codigo, { criterios: marcados, motivo: motivoFinal, justificativa: texto.trim() });
      if (arquivo) { try { await anexarEvidencia(d.codigo, arquivo); } catch (e) { showToast?.(`Contestação enviada, mas a evidência não foi anexada: ${e?.message || 'tente de novo no detalhe.'}`, 'danger'); } }
      showToast?.('Contestação enviada para reanálise.', 'success');
      onEnviado?.();
    } catch (e) { setErro(e?.message || 'Não foi possível enviar a contestação.'); } finally { setOcupado(false); }
  };
  return html`<${Janela} titulo=${`Contestar monitoria ${idCurto(d.codigo)}`} onClose=${onClose}
    rodape=${html`<button type="button" class="c-botao c-botao--secundario" disabled=${ocupado || null} onClick=${onClose}>Cancelar</button>
      <button type="button" class="c-botao c-botao--principal" aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || !pronto || null} onClick=${enviar}><${Ic} nome="paper-plane-tilt" />Enviar contestação</button>`}>
    <div class="c-janela-corpo" style=${{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <fieldset class="c-campo" style=${{ border: 0, margin: 0, padding: 0 }}><legend class="c-rotulo" style=${{ marginBottom: '4px' }}>Quais critérios você contesta?</legend>
        ${candidatos.length ? candidatos.map((c) => html`<label key=${c.id} class="c-marcar"><input type="checkbox" checked=${marcados.includes(c.id)}
          onChange=${(e) => setMarcados((m) => (e.target.checked ? [...m, c.id] : m.filter((x) => x !== c.id)))} />${c.texto}</label>`)
    : html`<p class="c-ajuda">Nenhum critério com "Não" nesta monitoria.</p>`}
      </fieldset>
      <${Campo} rotulo="Motivo"><select class="c-entrada" value=${motivo} onChange=${(e) => setMotivo(e.target.value)}>${MOTIVOS.map((m) => html`<option key=${m} value=${m}>${m}</option>`)}</select><//>
      ${motivo === 'Outro motivo' ? html`<${Campo} rotulo="Qual motivo?"><input class="c-entrada" maxlength="400" value=${outro} onInput=${(e) => setOutro(e.target.value)} /><//>` : null}
      <${Campo} rotulo="Explique"><textarea class="c-entrada" rows="3" value=${texto} onInput=${(e) => setTexto(e.target.value)}></textarea><//>
      <div>
        <input ref=${arquivoRef} type="file" class="c-oculto" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onChange=${(e) => setArquivo(e.target.files?.[0] || null)} />
        <button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => arquivoRef.current?.click()}><${Ic} nome="paperclip" />${arquivo ? arquivo.name : 'Anexar evidência'}</button>
        <span class="c-ajuda" style=${{ marginLeft: '8px' }}>PDF, DOC, PNG ou JPG · até 10 MB · opcional</span>
      </div>
      ${erro ? html`<${Faixa} tom="perigo" icone="warning">${erro}<//>` : null}
    </div>
  <//>`;
}

export function PainelReanalisar({ referencia, showToast, onClose, onAlterou, abrirDetalhe }) {
  const { d, erro, carregar } = useDetalhe(referencia);
  const [resultado, setResultado] = useState('CONFIRMADA');
  const [obs, setObs] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [confirmarAnular, setConfirmarAnular] = useState(false);
  if (erro) return html`<${PainelLateral} rotulo="Reanalisar contestação" titulo="Reanalisar" onClose=${onClose}><${Estado} titulo=${erro} rotuloAcao="Tentar de novo" aoAcao=${carregar} /><//>`;
  if (!d) return html`<${PainelLateral} rotulo="Reanalisar contestação" titulo="Reanalisar" onClose=${onClose}><${Esqueleto} linhas=${6} /><//>`;
  const c = [...(d.contestacoes || [])].reverse().find((x) => !x.reanalise) || d.contestacoes?.[d.contestacoes.length - 1];
  const criteriosConfig = Object.fromEntries((d.config?.blocos || []).flatMap((b) => b.criterios.map((x) => [x.id, x])));
  const limite = limiteDoPrazo(d.sla);
  const enviar = async () => {
    setOcupado(true);
    try {
      await reanalisarContestacao(d.codigo, { resultado, observacao: obs.trim() });
      showToast?.(resultado === 'ANULADA' ? 'Monitoria anulada. O operador foi avisado.' : 'Nota mantida. O operador foi avisado.', 'success');
      onAlterou?.();
    } catch (e) { showToast?.(e?.message || 'Não foi possível registrar a decisão.', 'danger'); } finally { setOcupado(false); setConfirmarAnular(false); }
  };
  return html`<${PainelLateral} rotulo="Reanalisar contestação" classe="c-reanalisar" titulo=${`Reanalisar · ${idCurto(d.codigo)}`}
      sub=${`${d.operador_nome} · ${d.operacao_nome || d.operacao} · nota ${formatarNota(d.nota)} · avaliada por ${d.avaliador_nome || '—'}`} onClose=${onClose}
      rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${onClose}>Cancelar</button>
        <button type="button" class="c-botao c-botao--principal" aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || !obs.trim() || null}
          onClick=${() => (resultado === 'ANULADA' ? setConfirmarAnular(true) : enviar())}><${Ic} nome="paper-plane-tilt" />Enviar decisão</button>`}>
    ${(c?.criterios || []).map((cr) => {
    const cfg = criteriosConfig[cr.id] || {};
    return html`<section key=${cr.id} class="c-contestado" aria-label="Critério contestado">
        <div class="c-contestado-cab"><span class="c-rotulo">Critério contestado</span><b>${cr.texto || cfg.texto}</b>
          <span class="c-contestado-meta">peso ${formatarNota(cfg.peso)} · resposta <${Resposta} valor=${d.respostas?.[cr.id]} /></span></div>
        <div class="c-contestado-lados">
          <div><span class="c-contestado-quem"><${Ic} nome="clipboard-text" />Avaliação · ${d.avaliador_nome || '—'}</span><p>${d.observacao ? `"${d.observacao}"` : 'Sem observação do avaliador.'}</p></div>
          <div><span class="c-contestado-quem"><${Ic} nome="user" />Operador · ${d.operador_nome}</span><p>"${c.justificativa}"</p>
            ${(c.anexos || []).map((a) => html`<a key=${a.id_anexo} href="#" onClick=${async (e) => { e.preventDefault(); try { baixarArquivo(await baixarEvidencia(a.id_anexo)); } catch (err) { showToast?.(err?.message || 'Não foi possível baixar.', 'danger'); } }}><${Ic} nome="paperclip" />${a.nome}</a>`)}</div>
        </div></section>`;
  })}
    ${c ? html`<table class="c-diario-ficha"><tbody>
      <tr><td>Motivo</td><td style=${{ whiteSpace: 'normal' }}>${c.motivo}</td></tr>
      ${(c.replicas || []).map((r, i) => html`<tr key=${i}><td>Réplica</td><td style=${{ whiteSpace: 'normal' }}>${r.texto}</td></tr>`)}
    </tbody></table>` : null}
    <div class="c-campo"><span class="c-rotulo">Decisão</span><${Segmento} rotulo="Decisão" valor=${resultado} aoMudar=${setResultado} opcoes=${[['CONFIRMADA', 'Manter a nota'], ['ANULADA', 'Anular a monitoria']]} /></div>
    <${Campo} rotulo="Explique a decisão"><textarea class="c-entrada" rows="2" placeholder="O operador vai ler este texto" value=${obs} onInput=${(e) => setObs(e.target.value)}></textarea><//>
    ${limite ? html`<${Faixa} tom="atencao" icone="clock">Se ninguém decidir até ${quandoLimite(limite)}, a monitoria é anulada sozinha.<//>` : d.sla?.estado === 'VENCIDO' ? html`<${Faixa} tom="perigo" icone="warning">O prazo venceu: a anulação automática acontece na próxima rodada do sistema.<//>` : null}
    <div><button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => abrirDetalhe(String(d.id_monitoria))}><${Ic} nome="arrow-square-out" />Ver a monitoria completa</button></div>
    ${confirmarAnular ? html`<${Janela} titulo="Anular a monitoria?" tamanho="pequena" onClose=${() => setConfirmarAnular(false)}
      rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => setConfirmarAnular(false)}>Cancelar</button>
        <button type="button" class="c-botao c-botao--perigo" aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || null} onClick=${enviar}>Anular</button>`}>
      <div class="c-janela-corpo"><p style=${{ margin: '0 0 8px' }}><b>${d.operador_nome}</b> · ${d.operacao_nome || d.operacao} · nota <b>${formatarNota(d.nota)}</b></p><p style=${{ margin: 0 }}>A monitoria sai dos indicadores. Isso não pode ser desfeito.</p></div>
    <//>` : null}
  <//>`;
}
