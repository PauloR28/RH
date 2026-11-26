import { html, useEffect, useState } from '../../infraestrutura-react.js?v=20261126-senha';
import { lerDashboard } from '../../services/api/monitoria.js?v=20261126-senha';
import { LineTrendChart } from '../../ui/components/charts.js?v=20261126-senha';
import { Esqueleto, Estado, Faixa, Segmento } from '../../ui/components/ds.js?v=20261126-senha';
import { GraficoBarrasH } from '../../modulos/operacao/wfm/graficos.js?v=20261126-senha';
import { formatarNota } from './comum.js?v=20261126-senha';

// Monitoria › Painel (antigo Dashboard) no desenho novo, no mesmo molde do Painel de Turnos e Plantões
// (DEC-069): filtros suaves na faixa de cima da caixa, uma faixa de indicadores, gráficos finos e tabelas
// densas. Tudo continua vindo do motor único de indicadores (/monitoria/dashboard).

const MODOS = [['geral', 'Geral'], ['equipe', 'Por equipe'], ['periodo', 'Por período'], ['operador', 'Por operador']];
const cor = (n) => `var(--cor-grafico-${n})`;

function Figura({ titulo, nota = '', children }) {
  return html`<figure class="c-grafico" style=${{ margin: 0 }}>
    <div class="c-grafico-cab"><h2>${titulo}</h2></div>
    ${children}
    ${nota ? html`<div class="c-grafico-rodape"><span>${nota}</span></div>` : null}
  </figure>`;
}
function Indicador({ rotulo, valor, nota = '', tom = '' }) {
  return html`<div class="c-indicador"><span class="c-ind-rotulo">${rotulo}</span><span class="c-ind-valor">${valor}</span>
    <span class=${`c-ind-nota ${tom ? `c-tom-${tom}` : ''}`.trim()}>${nota}</span></div>`;
}

// Duas pilhas (25/11/2026, amostra aprovada): os cartões não esticam até a altura do vizinho. Cada cartão vai para a
// pilha mais baixa (pelo nº de linhas que mostra), na ordem; cada pilha fica do tamanho do que tem dentro.
function DuasPilhas({ itens, classe = '' }) {
  const pilhas = [[], []];
  const alturas = [0, 0];
  itens.filter(Boolean).forEach((it) => { const i = alturas[0] <= alturas[1] ? 0 : 1; pilhas[i].push(it); alturas[i] += it.linhas; });
  return html`<div class=${`c-mon-pilhas ${classe}`.trim()}>${pilhas.map((p, i) => html`<div key=${i} class="c-mon-pilha">${p.map((it) => html`<div key=${it.chave} class="c-mon-pilha-item">${it.no}</div>`)}</div>`)}</div>`;
}


// Gráficos do Painel com mais informação (amostra 26/11/2026): cada linha mostra o nome, a barra com a marca da
// média, o valor e as colunas de apoio; cor só para o que pede atenção (sempre com o número ao lado).
const FAIXAS_ORDEM = ['Excelência', 'Muito bom', 'Bom', 'Desenvolvimento', 'Crítico'];
const TOM_FAIXA = { 'Excelência': 'sucesso', 'Muito bom': 'sucesso', Bom: 'informacao', Desenvolvimento: 'atencao', 'Crítico': 'perigo' };
const tomNota = (v) => (v >= 80 ? '' : v >= 70 ? 'atencao' : 'perigo');
const um = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

function Barras({ colunas = [], linhas, max = 100, media = null, rotuloMedia = 'média' }) {
  const pct = (v) => `${Math.max(0, Math.min(100, (Number(v) || 0) / max * 100))}%`;
  return html`<div class="c-barras" style=${{ '--c-barras-cols': linhas[0]?.extras.length || 1 }}>
    ${colunas.length ? html`<div class="c-barras-cab"><span></span><span>${media !== null ? html`<span class="c-barras-legenda"><i></i>${rotuloMedia} ${um(media)}</span>` : null}</span>${colunas.map((c) => html`<span key=${c} class="c-num">${c}</span>`)}</div>` : null}
    ${linhas.map((l) => html`<div key=${l.chave ?? l.rotulo} class=${`c-barras-linha ${l.tom ? `c-tom-${l.tom}` : ''}`.trim()}>
      <span class="c-barras-rotulo" title=${l.rotulo}>${l.rotulo}</span>
      <span class="c-barras-trilho" role="img" aria-label=${`${l.rotulo}: ${l.texto}`}><i style=${{ width: pct(l.valor) }}></i>${media !== null ? html`<b style=${{ left: pct(media) }}></b>` : null}</span>
      ${l.extras.map((x, i) => html`<span key=${i} class=${i === 0 ? 'c-num c-forte' : 'c-num c-secundario'}>${x}</span>`)}
    </div>`)}
  </div>`;
}

function Destaques({ itens }) {
  return html`<div class="c-graf-destaques">${itens.filter(Boolean).map(([r, v, tom]) => html`<span key=${r}><small>${r}</small><b class=${tom ? `c-tom-${tom}` : ''}>${v}</b></span>`)}</div>`;
}

function CartaoBlocos({ blocos }) {
  const ord = [...blocos].sort((a, b) => (a.percentual_medio ?? 0) - (b.percentual_medio ?? 0));
  const media = blocos.reduce((t, b) => t + (b.percentual_medio || 0), 0) / (blocos.length || 1);
  return html`<${Figura} titulo="Desempenho por bloco" nota="% de acerto médio por bloco · do pior para o melhor">
    <${Destaques} itens=${[['Média dos blocos', `${um(media)}%`], ['Pior bloco', `${ord[0].bloco} · ${um(ord[0].percentual_medio)}%`, tomNota(ord[0].percentual_medio) || 'atencao'], ['Melhor bloco', `${ord[ord.length - 1].bloco} · ${um(ord[ord.length - 1].percentual_medio)}%`]]} />
    <${Barras} colunas=${['Acerto', 'Avaliações']} media=${media} linhas=${ord.map((b) => ({ chave: b.id_bloco, rotulo: b.bloco, valor: b.percentual_medio, texto: `${um(b.percentual_medio)}%`, tom: tomNota(b.percentual_medio), extras: [`${um(b.percentual_medio)}%`, b.quantidade ?? '—'] }))} />
  <//>`;
}

function CartaoFaixas({ faixas }) {
  const total = faixas.reduce((t, f) => t + f.quantidade, 0) || 1;
  const ord = [...faixas].sort((a, b) => (FAIXAS_ORDEM.indexOf(a.label) + 99) % 99 - (FAIXAS_ORDEM.indexOf(b.label) + 99) % 99);
  const abaixo = faixas.filter((f) => ['Desenvolvimento', 'Crítico'].includes(f.label)).reduce((t, f) => t + f.quantidade, 0);
  return html`<${Figura} titulo="Monitorias por faixa de nota" nota="Monitorias válidas no período">
    <${Destaques} itens=${[['Monitorias', total], ['Muito bom ou melhor', `${um((faixas.filter((f) => ['Excelência', 'Muito bom'].includes(f.label)).reduce((t, f) => t + f.quantidade, 0)) / total * 100)}%`], ['Pedem plano de ação', `${abaixo} · ${um(abaixo / total * 100)}%`, abaixo ? 'atencao' : '']]} />
    <div class="c-faixa-pilha" role="img" aria-label="Distribuição por faixa">${ord.map((f) => html`<i key=${f.label} class=${`c-tom-${TOM_FAIXA[f.label] || 'neutro'}`} style=${{ flexGrow: f.quantidade }} title=${`${f.label}: ${f.quantidade}`}></i>`)}</div>
    <${Barras} colunas=${['Monitorias', '%']} max=${Math.max(...ord.map((f) => f.quantidade), 1)} linhas=${ord.map((f) => ({ rotulo: f.label, valor: f.quantidade, texto: String(f.quantidade), tom: TOM_FAIXA[f.label] || '', extras: [f.quantidade, `${um(f.quantidade / total * 100)}%`] }))} />
  <//>`;
}

function CartaoOperadores({ operadores, mediaGeral }) {
  const [todos, setTodos] = useState(false);
  const ord = [...operadores].sort((a, b) => a.nota_media - b.nota_media);
  const abaixo = ord.filter((o) => o.nota_media < mediaGeral).length;
  const lista = todos ? ord : ord.slice(0, 10);
  return html`<${Figura} titulo="Nota média por operador" nota=${`Da menor para a maior nota · ${todos ? `${ord.length} operadores` : `${lista.length} de ${ord.length}`}`}>
    <${Destaques} itens=${[['Operadores', ord.length], ['Abaixo da média', abaixo, abaixo ? 'atencao' : ''], ['Menor nota', `${um(ord[0]?.nota_media)}`, tomNota(ord[0]?.nota_media)]]} />
    <${Barras} colunas=${['Nota', 'Monit.', 'NCG']} media=${mediaGeral} rotuloMedia="média geral" linhas=${lista.map((o) => ({ chave: o.chave, rotulo: o.rotulo, valor: o.nota_media, texto: um(o.nota_media), tom: tomNota(o.nota_media) || (o.nota_media < mediaGeral ? 'abaixo' : ''), extras: [um(o.nota_media), o.quantidade_validas, o.ncg] }))} />
    ${ord.length > 10 ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto c-graf-mais" onClick=${() => setTodos((v) => !v)}>${todos ? 'Mostrar só os 10 primeiros' : `Ver todos os ${ord.length}`}</button>` : null}
  <//>`;
}

function CartaoPilares({ pilares }) {
  const grupos = ['conhecimento', 'encantamento'].map((t) => ({ t, nome: t === 'conhecimento' ? 'Conhecimento' : 'Encantamento', media: pilares?.[t]?.media, itens: Object.entries(pilares?.[t]?.indicadores || {}) })).filter((g) => g.itens.length);
  return html`<${Figura} titulo="Pilares por indicador" nota="Escala 1 a 10 · não alteram a nota da monitoria">
    ${grupos.map((g) => html`<div key=${g.t} class="c-pilar-grupo"><div class="c-pilar-cab"><b>${g.nome}</b><span>média <b>${um(g.media)}</b></span></div>
      <${Barras} max=${10} media=${g.media} linhas=${g.itens.sort((a, b) => a[1] - b[1]).map(([k, v]) => ({ rotulo: k, valor: v, texto: um(v), tom: v < 7 ? 'atencao' : '', extras: [um(v)] }))} /></div>`)}
  <//>`;
}

// Evolução da nota comparando as equipes (amostra 26/11/2026): uma linha por equipe + a média geral tracejada.
// Legenda com a última nota de cada linha; passar o mouse num ponto mostra a nota e as monitorias.
function EvolucaoEquipes({ series, geral, rotuloPeriodo }) {
  const periodos = [...new Set([...geral.map((p) => p.periodo), ...series.flatMap((s) => s.pontos.map((p) => p.periodo))])].sort();
  const valores = [...geral, ...series.flatMap((s) => s.pontos)].map((p) => p.nota_media).filter((v) => v !== null && v !== undefined);
  const min = Math.max(0, Math.floor((Math.min(...valores) - 5) / 10) * 10);
  const L = 900, A = 240, m = { e: 40, d: 16, t: 12, b: 28 };
  const x = (i) => m.e + (periodos.length === 1 ? (L - m.e - m.d) / 2 : ((L - m.e - m.d) * i) / (periodos.length - 1));
  const y = (v) => m.t + (A - m.t - m.b) * (1 - (v - min) / (100 - min));
  const passoGrade = 100 - min > 40 ? 20 : 10;
  const grade = Array.from({ length: Math.floor((100 - min) / passoGrade) + 1 }, (_, i) => min + i * passoGrade);
  const caminho = (pts) => pts.map((p) => `${x(periodos.indexOf(p.periodo))},${y(p.nota_media)}`).join(' ');
  const todas = [...series.map((s, i) => ({ ...s, cor: `var(--cor-grafico-${(i % 6) + 1})` })), { nome: 'Média geral', pontos: geral, cor: 'var(--cor-texto-padrao)', geral: true }];
  const ultimo = (pts) => pts[pts.length - 1]?.nota_media;
  const rot = (p) => p.slice(rotuloPeriodo === 'mes' ? 0 : 5);
  return html`<div class="c-evol">
    <div class="c-evol-legenda">${todas.map((s) => html`<span key=${s.nome} class=${s.geral ? 'c-evol-geral' : ''}><i style=${{ background: s.cor }}></i>${s.nome}<b>${um(ultimo(s.pontos))}</b></span>`)}</div>
    <svg viewBox=${`0 0 ${L} ${A}`} width="100%" role="img" aria-label="Evolução da nota média por equipe">
      ${grade.map((g) => html`<g key=${g}><line x1=${m.e} x2=${L - m.d} y1=${y(g)} y2=${y(g)} stroke="var(--cor-linha-divisoria)" /><text x=${m.e - 8} y=${y(g) + 4} text-anchor="end" class="c-evol-eixo">${Math.round(g)}</text></g>`)}
      ${periodos.map((p, i) => html`<text key=${p} x=${x(i)} y=${A - 8} text-anchor="middle" class="c-evol-eixo">${rot(p)}</text>`)}
      ${todas.map((s) => html`<g key=${s.nome}><polyline points=${caminho(s.pontos)} fill="none" stroke=${s.cor} stroke-width=${s.geral ? 2 : 2.5} stroke-dasharray=${s.geral ? '6 4' : null} />
        ${s.pontos.map((p) => html`<circle key=${p.periodo} cx=${x(periodos.indexOf(p.periodo))} cy=${y(p.nota_media)} r=${s.geral ? 3 : 4} fill=${s.cor}><title>${`${s.nome} · ${rot(p.periodo)}: ${um(p.nota_media)} (${p.quantidade} monitorias)`}</title></circle>`)}</g>`)}
    </svg>
  </div>`;
}

export function TelaPainelMonitoria({ controlador, contexto }) {
  const perfil = controlador?.estado?.perfilUsuario;
  const ehOperador = perfil === 'operador';
  const [f, setF] = useState({ modo: 'geral', top: 5, granularidade: 'mes', operacao: '', id_equipe: '', id_operador: '', data_inicio: '', data_fim: '' });
  const [d, setD] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [opOperador, setOpOperador] = useState([]);
  const [opEquipe, setOpEquipe] = useState([]);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    lerDashboard(f)
      .then((r) => {
        if (!ativo) return;
        setD(r); setErro('');
        if (!f.id_operador) setOpOperador((r.por_operador || []).map((o) => [String(o.chave), o.rotulo]));
        if (!f.id_equipe) setOpEquipe((r.por_equipe || []).filter((e) => e.id_equipe).map((e) => [String(e.id_equipe), e.rotulo]));
      })
      .catch((e) => ativo && setErro(e?.message || 'Não foi possível carregar o painel.'))
      .finally(() => ativo && setCarregando(false));
    return () => { ativo = false; };
  }, [f, versao]);

  const campo = (k, v) => setF((a) => ({ ...a, [k]: v }));
  const r = d?.resumo;
  const operacoes = contexto?.operacoes || [];
  const comparativo = f.modo === 'equipe' ? d?.por_equipe : f.modo === 'operador' ? d?.por_operador : d?.por_operacao;
  const rotuloComp = f.modo === 'equipe' ? 'Equipe' : f.modo === 'operador' ? 'Operador' : 'Operação';
  const pontos = (d?.evolucao || []).map((e) => ({ label: e.periodo.slice(f.granularidade === 'mes' ? 0 : 5), value: e.nota_media, extra: `${e.quantidade} monitoria(s)` }));
  const notasOperador = (d?.por_operador || []).filter((o) => o.nota_media !== null);
  const pilares = ['conhecimento', 'encantamento'].flatMap((t) => Object.entries(r?.pilares?.[t]?.indicadores || {}).map(([k, v]) => ({ rotulo: k, valor: Number(v) || 0 })));

  const filtros = html`<div class="c-filtros c-filtros--suave">
    <${Segmento} rotulo="Visão do painel" valor=${f.modo} aoMudar=${(modo) => setF((a) => ({ ...a, modo, id_equipe: '', id_operador: '' }))}
      opcoes=${MODOS.filter(([k]) => !ehOperador || k === 'geral' || k === 'periodo')} />
    ${operacoes.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Operação" value=${f.operacao} onChange=${(e) => campo('operacao', e.target.value)}>
      <option value="">Todas as operações</option>${operacoes.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select>` : null}
    <input class="c-entrada c-entrada--compacta" type="date" aria-label="De" title="De" value=${f.data_inicio} max=${f.data_fim || undefined} onChange=${(e) => campo('data_inicio', e.target.value)} />
    <input class="c-entrada c-entrada--compacta" type="date" aria-label="Até" title="Até" value=${f.data_fim} min=${f.data_inicio || undefined} onChange=${(e) => campo('data_fim', e.target.value)} />
    ${f.modo === 'periodo' ? html`<select class="c-entrada c-entrada--compacta" aria-label="Agrupar por" value=${f.granularidade} onChange=${(e) => campo('granularidade', e.target.value)}>
      <option value="dia">Por dia</option><option value="semana">Por semana</option><option value="mes">Por mês</option></select>` : null}
    ${!ehOperador && f.modo === 'equipe' ? html`<select class="c-entrada c-entrada--compacta" aria-label="Equipe" value=${f.id_equipe} onChange=${(e) => campo('id_equipe', e.target.value)}>
      <option value="">Todas as equipes (comparar)</option>${opEquipe.map(([v, t]) => html`<option key=${v} value=${v}>${t}</option>`)}</select>` : null}
    ${!ehOperador && f.modo === 'operador' ? html`<select class="c-entrada c-entrada--compacta" aria-label="Operador" value=${f.id_operador} onChange=${(e) => campo('id_operador', e.target.value)}>
      <option value="">Todos os operadores (comparar)</option>${opOperador.map(([v, t]) => html`<option key=${v} value=${v}>${t}</option>`)}</select>` : null}
    ${!ehOperador ? html`<select class="c-entrada c-entrada--compacta c-fim" aria-label="Ranking" value=${f.top} onChange=${(e) => campo('top', Number(e.target.value))}>
      ${[3, 5, 10, 15].map((n) => html`<option key=${n} value=${n}>Top ${n}</option>`)}</select>` : null}
  </div>`;

  let corpo = null;
  if (erro) corpo = html`<${Estado} titulo=${erro} rotuloAcao="Tentar de novo" aoAcao=${() => setVersao((v) => v + 1)} />`;
  else if (!r) corpo = html`<${Esqueleto} linhas=${4} />`;

  return html`
    <div class="c-tabela-caixa" aria-busy=${carregando ? 'true' : null}>${filtros}${corpo}</div>
    ${r && !erro ? (r.quantidade_realizadas === 0 ? html`<div class="c-tabela-caixa"><${Estado} icone="chart-bar" titulo="Sem monitorias no período." texto="Ajuste o período ou a operação para ver os indicadores." /></div>` : html`
    <div class="c-indicadores" aria-label="Indicadores do período">
      <${Indicador} rotulo="Nota média" valor=${formatarNota(r.nota_media)} nota=${r.faixa?.label ? `faixa ${r.faixa.label} · só válidas` : 'só monitorias válidas'} />
      <${Indicador} rotulo="Monitorias" valor=${r.quantidade_realizadas} nota=${`${r.quantidade_validas} válidas · ${r.quantidade_anuladas} anuladas`} />
      <${Indicador} rotulo="NCG" valor=${r.ncg} nota=${`${formatarNota(r.monitorias_ncg_pct)}% das monitorias`} tom=${r.ncg > 0 ? 'perigo' : ''} />
      ${ehOperador ? html`<${Indicador} rotulo="Melhor nota" valor=${formatarNota(r.melhor_nota)} nota="no período" />`
    : html`<${Indicador} rotulo="Operadores avaliados" valor=${r.operadores_avaliados} nota=${`melhor nota ${formatarNota(r.melhor_nota)}`} />`}
      <${Indicador} rotulo="Pilares (escala 1–10)" valor=${formatarNota(r.pilares.conhecimento.media)}
        nota=${`Conhecimento · Encantamento ${formatarNota(r.pilares.encantamento.media)}`} />
    </div>
    <div class="c-indicadores" aria-label="Pendências do fluxo">
      <${Indicador} rotulo="Feedbacks pendentes" valor=${r.pendencias.feedbacks_pendentes} nota=${r.pendencias.feedbacks_vencidos ? `${r.pendencias.feedbacks_vencidos} vencido(s)` : 'nenhum vencido'} tom=${r.pendencias.feedbacks_vencidos ? 'perigo' : ''} />
      <${Indicador} rotulo="Feedbacks aplicados" valor=${r.pendencias.feedbacks_aplicados} nota="no período" />
      <${Indicador} rotulo="Sem feedback" valor=${r.pendencias.encerradas_sem_feedback ?? 0} nota="não aplicado em 72 h" tom=${(r.pendencias.encerradas_sem_feedback || 0) > 0 ? 'atencao' : ''} />
      <${Indicador} rotulo="Confirmação ou contestação" valor=${r.pendencias.confirmacoes_e_contestacoes_pendentes} nota="esperando o operador" />
      <${Indicador} rotulo="Reanálises" valor=${r.pendencias.baixas_ou_confirmacoes_pendentes} nota="manter ou anular" />
    </div>
    ${perfil === 'supervisor' && d.visao_operacao ? html`<${Faixa} tom="informacao" icone="info">Operação inteira: nota média <b>${formatarNota(d.visao_operacao.nota_media)}</b> · ${d.visao_operacao.quantidade_realizadas} monitoria(s) · ${d.visao_operacao.ncg} NCG. O detalhe abaixo é só da(s) sua(s) equipe(s).<//>` : null}
    ${ehOperador && d.escala ? html`<${Faixa} tom="informacao" icone="info">Sua nota média: <b>${formatarNota(d.escala.nota_operador)}</b>${d.escala.faixa_operador ? ` (${d.escala.faixa_operador.label})` : ''} · média da operação: <b>${formatarNota(d.escala.media_operacao)}</b>.<//>` : null}
    <${DuasPilhas} classe="c-graficos-wfm" itens=${[
      !ehOperador && f.modo !== 'operador' && (d.evolucao_equipes || []).length > 1 ? { chave: 'evolucao', linhas: 11, no: html`<${Figura} titulo=${`Evolução da nota por equipe${f.modo === 'periodo' ? ` · por ${{ dia: 'dia', semana: 'semana', mes: 'mês' }[f.granularidade]}` : ''}`} nota="Nota média das monitorias válidas · a linha tracejada é a média geral">
        <${EvolucaoEquipes} series=${d.evolucao_equipes} geral=${d.evolucao || []} rotuloPeriodo=${f.granularidade} /><//>` }
      : (f.modo !== 'geral' || ehOperador) && { chave: 'evolucao', linhas: 9, no: html`<${Figura} titulo=${`Evolução da nota${f.modo === 'periodo' ? ` por ${{ dia: 'dia', semana: 'semana', mes: 'mês' }[f.granularidade]}` : ''}`} nota="Nota média das monitorias válidas">
        ${pontos.length ? html`<${LineTrendChart} points=${pontos} largura=${900} height=${220} valueFormatter=${(v) => formatarNota(v)} />` : html`<p class="c-nota">Sem dados no período.</p>`}<//>` },
      (d.desempenho_blocos || []).length && { chave: 'blocos', linhas: d.desempenho_blocos.length + 6, no: html`<${CartaoBlocos} blocos=${d.desempenho_blocos} />` },
      (r.distribuicao_faixas || []).length && { chave: 'faixas', linhas: r.distribuicao_faixas.length + 7, no: html`<${CartaoFaixas} faixas=${r.distribuicao_faixas} />` },
      !ehOperador && notasOperador.length && { chave: 'operador', linhas: Math.min(10, notasOperador.length) + 7, no: html`<${CartaoOperadores} operadores=${notasOperador} mediaGeral=${r.nota_media} />` },
      pilares.length && { chave: 'pilares', linhas: pilares.length + 7, no: html`<${CartaoPilares} pilares=${r.pilares} />` },
    ]} />
    <${DuasPilhas} itens=${[
      { chave: 'erros', linhas: Math.max(1, (d.criterios_erro || []).length) + 2, no: html`<section class="c-cartao" aria-labelledby="mon-p-erros">
        <div class="c-cartao-cab"><h2 id="mon-p-erros">Critérios com mais erro</h2></div>
        ${(d.criterios_erro || []).length ? html`<div class="c-tabela-caixa"><table class="c-tabela c-tabela--compacta c-tabela-crit">
          <thead><tr><th scope="col">Critério</th><th scope="col">Bloco</th><th scope="col" class="c-estica">% de erro</th><th scope="col" class="c-num">Não</th><th scope="col" class="c-num">NCG</th></tr></thead>
          <tbody>${d.criterios_erro.map((c) => html`<tr key=${c.id_criterio}><td class="c-crit-pergunta" title=${c.pergunta}>${c.pergunta}</td><td class="c-secundario">${c.bloco}</td>
            <td class="c-estica"><span class="c-crit-erro"><span class="c-barras-trilho"><i style=${{ width: `${Math.min(100, (c.pct_erro / Math.max(...d.criterios_erro.map((x) => x.pct_erro), 1)) * 100)}%` }}></i></span><b>${formatarNota(c.pct_erro)}%</b></span></td>
            <td class="c-num">${c.nao}/${c.avaliados}</td><td class=${`c-num ${c.ncg ? 'c-tom-perigo c-forte' : ''}`}>${c.ncg}</td></tr>`)}</tbody></table></div>`
    : html`<${Estado} titulo="Nenhum erro registrado no período." />`}
      </section>` },
      !ehOperador && { chave: 'top', linhas: Math.max(1, (d.top || []).length) + 2, no: html`<section class="c-cartao" aria-labelledby="mon-p-top">
        <div class="c-cartao-cab"><h2 id="mon-p-top">Top ${d.top_n} · nota média</h2></div>
        ${(d.top || []).length ? html`<div class="c-tabela-caixa"><table class="c-tabela c-tabela--compacta">
          <thead><tr><th scope="col" class="c-num">#</th><th scope="col" class="c-estica">Operador</th><th scope="col" class="c-num">Nota média</th><th scope="col" class="c-num">Monitorias</th></tr></thead>
          <tbody>${d.top.map((t) => html`<tr key=${t.id_operador}><td class="c-num c-secundario">${t.posicao}</td><td class="c-estica c-forte">${t.operador_nome}</td><td class="c-num c-forte">${formatarNota(t.nota_media)}</td><td class="c-num">${t.quantidade_validas}</td></tr>`)}</tbody></table></div>`
    : html`<${Estado} titulo="Sem monitorias válidas." />`}
      </section>` },
      !ehOperador && comparativo?.length && { chave: 'comparacao', linhas: comparativo.length + 2, no: html`<section class="c-cartao" aria-labelledby="mon-p-comp">
      <div class="c-cartao-cab"><h2 id="mon-p-comp">Comparação por ${rotuloComp.toLowerCase()}</h2></div>
      <div class="c-tabela-caixa"><table class="c-tabela c-tabela--compacta">
        <thead><tr><th scope="col" class="c-estica">${rotuloComp}</th><th scope="col" class="c-num">Realizadas</th><th scope="col" class="c-num">Válidas</th><th scope="col" class="c-num">Nota média</th><th scope="col" class="c-num">NCG</th><th scope="col" class="c-num">Conhecimento</th><th scope="col" class="c-num">Encantamento</th></tr></thead>
        <tbody>${comparativo.map((c) => html`<tr key=${String(c.chave)}><td class="c-estica c-forte">${c.rotulo}</td><td class="c-num">${c.quantidade_realizadas}</td><td class="c-num">${c.quantidade_validas}</td>
          <td class="c-num c-forte">${formatarNota(c.nota_media)}</td><td class="c-num">${c.ncg}</td><td class="c-num">${formatarNota(c.pilar_conhecimento)}</td><td class="c-num">${formatarNota(c.pilar_encantamento)}</td></tr>`)}</tbody>
      </table></div></section>` },
    ]} />
    <p class="c-nota">N/A não é erro e sai da conta; NÃO e NCG são contados separados. Desempate do ranking: mais monitorias válidas, depois ordem alfabética.</p>`) : null}`;
}
