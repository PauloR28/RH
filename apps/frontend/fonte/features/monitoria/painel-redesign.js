import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { lerDashboard } from '../../services/api/monitoria.js';
import { LineTrendChart } from '../../ui/components/charts.js';
import { Esqueleto, Estado, Faixa, Segmento } from '../../ui/components/ds.js?v=20261106-wfm';
import { GraficoBarrasH } from '../../modulos/operacao/wfm/graficos.js?v=20261110-graficos';
import { formatarNota } from './comum.js';

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
    <div class="c-graficos c-graficos-wfm">
      ${f.modo !== 'geral' || ehOperador ? html`<${Figura} titulo=${`Evolução da nota${f.modo === 'periodo' ? ` por ${{ dia: 'dia', semana: 'semana', mes: 'mês' }[f.granularidade]}` : ''}`} nota="Nota média das monitorias válidas">
        ${pontos.length ? html`<${LineTrendChart} points=${pontos} valueFormatter=${(v) => formatarNota(v)} />` : html`<p class="c-nota">Sem dados no período.</p>`}<//>` : null}
      <${Figura} titulo="Desempenho por bloco" nota="% de acerto médio">
        ${(d.desempenho_blocos || []).length ? html`<${GraficoBarrasH} dados=${d.desempenho_blocos.map((b) => ({ rotulo: b.bloco, valor: b.percentual_medio || 0 }))} series=${[{ chave: 'valor', rotulo: '% de acerto', cor: cor(1) }]} unidade="%" />` : html`<p class="c-nota">Sem dados no período.</p>`}<//>
      <${Figura} titulo="Monitorias por faixa de nota" nota="Quantidade no período">
        <${GraficoBarrasH} dados=${(r.distribuicao_faixas || []).map((x) => ({ rotulo: x.label, valor: x.quantidade }))} series=${[{ chave: 'valor', rotulo: 'Monitorias', cor: cor(1) }]} /><//>
      ${!ehOperador && (d.por_operador || []).some((o) => o.nota_media !== null) ? html`<${Figura} titulo="Nota média por operador" nota="Até 15 operadores">
        <${GraficoBarrasH} dados=${d.por_operador.filter((o) => o.nota_media !== null).slice(0, 15).map((o) => ({ rotulo: o.rotulo, valor: o.nota_media }))} series=${[{ chave: 'valor', rotulo: 'Nota', cor: cor(1) }]} /><//>` : null}
      ${pilares.length ? html`<${Figura} titulo="Pilares por indicador" nota="Escala 1–10 · não alteram a nota">
        <${GraficoBarrasH} dados=${pilares} series=${[{ chave: 'valor', rotulo: 'Média', cor: cor(2) }]} /><//>` : null}
    </div>
    <div class="c-colunas">
      <section class="c-cartao" aria-labelledby="mon-p-erros">
        <div class="c-cartao-cab"><h2 id="mon-p-erros">Critérios com mais erro</h2></div>
        ${(d.criterios_erro || []).length ? html`<div class="c-tabela-caixa"><table class="c-tabela c-tabela--compacta">
          <thead><tr><th scope="col" class="c-estica">Critério</th><th scope="col" class="c-num">Não</th><th scope="col" class="c-num">% erro</th><th scope="col" class="c-num">NCG</th></tr></thead>
          <tbody>${d.criterios_erro.map((c) => html`<tr key=${c.id_criterio}><td class="c-estica" title=${c.bloco} style=${{ whiteSpace: 'normal' }}>${c.pergunta}</td>
            <td class="c-num">${c.nao}/${c.avaliados}</td><td class="c-num c-forte">${formatarNota(c.pct_erro)}%</td><td class="c-num">${c.ncg}</td></tr>`)}</tbody></table></div>`
    : html`<${Estado} titulo="Nenhum erro registrado no período." />`}
      </section>
      ${!ehOperador ? html`<section class="c-cartao" aria-labelledby="mon-p-top">
        <div class="c-cartao-cab"><h2 id="mon-p-top">Top ${d.top_n} · nota média</h2></div>
        ${(d.top || []).length ? html`<div class="c-tabela-caixa"><table class="c-tabela c-tabela--compacta">
          <thead><tr><th scope="col" class="c-num">#</th><th scope="col" class="c-estica">Operador</th><th scope="col" class="c-num">Nota média</th><th scope="col" class="c-num">Monitorias</th></tr></thead>
          <tbody>${d.top.map((t) => html`<tr key=${t.id_operador}><td class="c-num c-secundario">${t.posicao}</td><td class="c-estica c-forte">${t.operador_nome}</td><td class="c-num c-forte">${formatarNota(t.nota_media)}</td><td class="c-num">${t.quantidade_validas}</td></tr>`)}</tbody></table></div>`
    : html`<${Estado} titulo="Sem monitorias válidas." />`}
      </section>` : null}
    </div>
    ${!ehOperador && comparativo?.length ? html`<section class="c-cartao" aria-labelledby="mon-p-comp">
      <div class="c-cartao-cab"><h2 id="mon-p-comp">Comparação por ${rotuloComp.toLowerCase()}</h2></div>
      <div class="c-tabela-caixa"><table class="c-tabela c-tabela--compacta">
        <thead><tr><th scope="col" class="c-estica">${rotuloComp}</th><th scope="col" class="c-num">Realizadas</th><th scope="col" class="c-num">Válidas</th><th scope="col" class="c-num">Nota média</th><th scope="col" class="c-num">NCG</th><th scope="col" class="c-num">Conhecimento</th><th scope="col" class="c-num">Encantamento</th></tr></thead>
        <tbody>${comparativo.map((c) => html`<tr key=${String(c.chave)}><td class="c-estica c-forte">${c.rotulo}</td><td class="c-num">${c.quantidade_realizadas}</td><td class="c-num">${c.quantidade_validas}</td>
          <td class="c-num c-forte">${formatarNota(c.nota_media)}</td><td class="c-num">${c.ncg}</td><td class="c-num">${formatarNota(c.pilar_conhecimento)}</td><td class="c-num">${formatarNota(c.pilar_encantamento)}</td></tr>`)}</tbody>
      </table></div></section>` : null}
    <p class="c-nota">N/A não é erro e sai da conta; NÃO e NCG são contados separados. Desempate do ranking: mais monitorias válidas, depois ordem alfabética.</p>`) : null}`;
}
