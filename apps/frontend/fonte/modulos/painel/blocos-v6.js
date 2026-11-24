// Painel — blocos das métricas da amostra v6 (aprovada pelo Paulo em 15/11/2026), organizados em abas por área.
// Gráficos em SVG com as cores --cor-grafico-* do rebranding; só peças c- e c-pg- (estilos/painel.css).
import { html, useEffect, useState } from '../../infraestrutura-react.js?v=20261124-equipes3';
import { lerDiaPainel, lerPresencaComparada } from '../../services/api/painel.js?v=20261124-equipes3';
import { Cartao, Contador, Indicador, Indisponivel, Linha, MiniTabela, SEMANA, ddmm, num, nota, pct } from './pecas.js?v=20261124-equipes3';

const COR1 = 'var(--cor-grafico-1)';
const COR2 = 'var(--cor-grafico-2)';
const CORREF = 'var(--cor-grafico-referencia)';
const NOME_DIA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

const Legenda = ({ itens }) => html`<div class="c-grafico-legenda c-pg-leg">${itens.map(([r, c]) => html`<span key=${r}><i style=${{ background: c }}></i>${r}</span>`)}</div>`;
const Nota = ({ children }) => html`<p class="c-ajuda c-pg-nota">${children}</p>`;
const marcasDe = (min, max, passos = 2) => Array.from({ length: passos + 1 }, (_, i) => Math.round(min + ((max - min) * i) / passos));

// Linha: séries com valores (null = sem dado, a linha "pula" o dia).
function SvgLinha({ series, rotulos, min, max, marcas, suf = '', refValor, refTexto = '', rotulo }) {
  const W = 600; const H = 200; const l = 40; const r = 8; const t = 12; const b = 28;
  const x = (i) => l + (W - l - r) * (rotulos.length <= 1 ? 0.5 : i / (rotulos.length - 1));
  const y = (v) => t + (H - t - b) * (1 - (v - min) / (max - min || 1));
  const passo = Math.max(1, Math.ceil(rotulos.length / 14));
  const trechos = (valores) => {
    const partes = []; let atual = [];
    valores.forEach((v, i) => { if (v === null || v === undefined) { if (atual.length) partes.push(atual); atual = []; } else atual.push(`${x(i)},${y(v)}`); });
    if (atual.length) partes.push(atual);
    return partes;
  };
  return html`<svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${rotulo}>
    ${marcas.map((m) => html`<g key=${`m${m}`}><line class="c-g-grade" x1=${l} x2=${W - r} y1=${y(m)} y2=${y(m)} /><text x=${l - 6} y=${y(m) + 4} text-anchor="end">${m}${suf}</text></g>`)}
    ${refValor !== undefined ? html`<g><line class="c-g-ref" x1=${l} x2=${W - r} y1=${y(refValor)} y2=${y(refValor)} /><text x=${W - r} y=${y(refValor) - 4} text-anchor="end">${refTexto}</text></g>` : null}
    ${rotulos.map((rt, i) => (i % passo === 0 ? html`<text key=${`r${i}`} x=${x(i)} y=${H - 8} text-anchor="middle">${rt}</text>` : null))}
    ${series.map((s, k) => html`<g key=${`s${k}`}>
      ${trechos(s.valores).map((pts, j) => (pts.length > 1
        ? html`<polyline key=${j} fill="none" stroke=${s.cor} stroke-width="2" stroke-dasharray=${s.tracejada ? '5 4' : null} points=${pts.join(' ')} />`
        : null))}
      ${s.tracejada ? null : s.valores.map((v, i) => (v === null || v === undefined ? null
        : html`<circle key=${i} cx=${x(i)} cy=${y(v)} r="3" fill=${s.cor}><title>${`${rotulos[i]}: ${String(v).replace('.', ',')}${suf}`}</title></circle>`))}
    </g>`)}
  </svg>`;
}

// Barras verticais; com `aoClicar`, cada barra vira botão (teclado: Enter/Espaço).
function SvgBarras({ grupos, rotulos, max, marcas, rotulo, aoClicar, selecionada = null }) {
  const W = 600; const H = 200; const l = 40; const r = 8; const t = 16; const b = 28;
  const n = rotulos.length; const k = grupos.length;
  const larg = (W - l - r) / Math.max(n, 1); const bw = Math.min(28, (larg * 0.6) / k);
  const y = (v) => t + (H - t - b) * (1 - v / (max || 1));
  return html`<svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${rotulo}>
    ${marcas.map((m) => html`<g key=${`m${m}`}><line class="c-g-grade" x1=${l} x2=${W - r} y1=${y(m)} y2=${y(m)} /><text x=${l - 6} y=${y(m) + 4} text-anchor="end">${m}</text></g>`)}
    ${rotulos.map((rt, i) => {
      const cx = l + larg * i + larg / 2;
      return html`<g key=${`b${i}`}>
        ${grupos.map((g, j) => {
          const v = g.valores[i] || 0; const bx = cx - (bw * k) / 2 + j * bw;
          const props = aoClicar ? { class: 'c-pg-barra-alvo', tabIndex: 0, role: 'button', 'aria-label': `${rt}: ${v}, ver a lista`,
            onClick: () => aoClicar(i), onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aoClicar(i); } } } : {};
          return html`<rect key=${j} ...${props} opacity=${selecionada !== null && selecionada !== i ? '0.35' : null}
            x=${bx} y=${y(v)} width=${Math.max(bw - 2, 1)} height=${Math.max(H - b - y(v), 0)} rx="2" fill=${g.cor}><title>${`${rt}: ${v}`}</title></rect>`;
        })}
        ${k === 1 ? html`<text class="c-g-forte" x=${cx} y=${y(grupos[0].valores[i] || 0) - 4} text-anchor="middle">${grupos[0].valores[i] || 0}</text>` : null}
        <text x=${cx} y=${H - 8} text-anchor="middle">${rt}</text>
      </g>`;
    })}
  </svg>`;
}

function BarrasH({ itens, max, suf = '', atencao = () => false }) {
  return html`<ul class="c-pg-lista">
    ${itens.map((x) => html`<li key=${x.rotulo}><div class="c-pg-linha">
      <span class="c-pg-estica" title=${x.rotulo}>${x.rotulo}</span>
      <span class=${`c-pg-barra${atencao(x) ? ' c-pg-barra--atencao' : ''}`}><i style=${{ width: `${max ? Math.round((100 * x.valor) / max) : 0}%` }}></i></span>
      <span class="c-pg-num">${String(x.valor).replace('.', ',')}${suf}</span>${x.extra ? html`<span class="c-pg-sec">${x.extra}</span>` : null}
    </div></li>`)}
  </ul>`;
}

const semDados = (d, titulo) => (d.indisponivel ? html`<${Cartao} titulo=${titulo}><${Indisponivel} texto=${d.indisponivel} /></${Cartao}>` : null);
const teto = (valores, minimo = 5) => { const m = Math.max(minimo, ...valores.filter((v) => v !== null && v !== undefined)); const p = 10 ** Math.max(0, String(Math.ceil(m)).length - 1); return Math.ceil(m / p) * p; };

// ── Turnos e Plantões ───────────────────────────────────────────────
function BlocoPresencaDia({ d, painel, filtros }) {
  const [como, setComo] = useState('anterior');
  const [base, setBase] = useState(d.comparacao || null);
  useEffect(() => { setComo('anterior'); setBase(d.comparacao || null); }, [d]);
  const mudar = (valor) => {
    setComo(valor);
    if (valor === 'nenhum') { setBase(null); return; }
    lerPresencaComparada(painel.id_painel, filtros.periodo, filtros.equipe, valor).then(setBase).catch(() => setBase(null));
  };
  const vazio = semDados(d, 'Presença dia a dia');
  if (vazio) return vazio;
  const atual = d.dias.map((x) => x.pct);
  const comp = base && base.dias ? d.dias.map((_, i) => (base.dias[i] ? base.dias[i].pct : null)) : null;
  const todos = [...atual, ...(comp || [])].filter((v) => v !== null && v !== undefined);
  const min = todos.length ? Math.max(0, Math.floor((Math.min(...todos) - 5) / 10) * 10) : 0;
  const rotuloBase = base && base.ini ? { anterior: 'Período anterior', mes: 'Mesmo período do mês passado', ano: 'Mesmo período do ano passado' }[base.como] + ` (${ddmm(base.ini)} a ${ddmm(base.fim)})` : '';
  const filtro = html`<select class="c-entrada c-entrada--compacta c-pg-mini-filtro" aria-label="Comparar com" value=${como} onChange=${(e) => mudar(e.target.value)}>
    <option value="anterior">Comparar com o período anterior</option><option value="mes">Comparar com o mesmo período do mês passado</option>
    <option value="ano">Comparar com o mesmo período do ano passado</option><option value="nenhum">Sem comparação</option></select>`;
  return html`<${Cartao} titulo="Presença dia a dia" acao=${filtro}>
    ${todos.length ? html`<div class="c-pg-graf">
      <${Legenda} itens=${[['Este período', COR1], ...(comp ? [[rotuloBase, CORREF]] : [])]} />
      <${SvgLinha} rotulo="Presença por dia" rotulos=${d.dias.map((x) => x.data.slice(8, 10))} min=${min} max=${100} suf="%" marcas=${marcasDe(min, 100)}
        series=${[...(comp ? [{ valores: comp, cor: CORREF, tracejada: true }] : []), { valores: atual, cor: COR1 }]} />
      <p class="c-ajuda">Presença = presentes ÷ dias com presença lançada. Dia sem lançamento fica sem ponto.</p>
    </div>` : html`<${Indisponivel} texto="Nenhuma presença lançada no período." />`}
  </${Cartao}>`;
}

function BlocoFaltasSemana({ d }) {
  const [sel, setSel] = useState(null);
  useEffect(() => setSel(null), [d]);
  const vazio = semDados(d, 'Faltas por dia da semana');
  if (vazio) return vazio;
  const total = d.contagem.reduce((a, b) => a + b, 0);
  const max = teto(d.contagem, 5);
  const lista = sel === null ? [] : d.faltas.filter((f) => f.dia_semana === sel);
  return html`<${Cartao} titulo="Faltas por dia da semana">
    ${total ? html`<div class="c-pg-graf">
      <${SvgBarras} rotulo="Faltas por dia da semana" rotulos=${SEMANA} grupos=${[{ valores: d.contagem, cor: COR1 }]} max=${max} marcas=${marcasDe(0, max)}
        aoClicar=${(i) => setSel(i === sel ? null : i)} selecionada=${sel} />
      <p class="c-ajuda">Clique numa barra para ver quem faltou naquele dia da semana.</p>
    </div>
    ${sel !== null ? html`<div class="c-pg-det-graf">
      <div class="c-pg-det-cab"><h3>Faltas de ${NOME_DIA[sel]} (${d.contagem[sel]})</h3>
        <button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => setSel(null)}>Fechar lista</button></div>
      ${lista.length ? html`<${MiniTabela} colunas=${['Operador', 'Equipe', 'Dia', 'Falta']}
        linhas=${lista.map((f) => [f.operador, f.equipe || '—', f.data, html`<span class=${`c-selo c-selo--${f.justificada ? 'informacao' : 'perigo'}`}>${f.justificada ? 'Justificada' : 'Sem justificativa'}</span>`])} />`
        : html`<p class="c-ajuda">Ninguém faltou nesse dia da semana.</p>`}
    </div>` : null}` : html`<${Indisponivel} texto="Nenhuma falta no período." />`}
  </${Cartao}>`;
}

function BlocoAtestados({ d, forma }) {
  const vazio = semDados(d, 'Atestados');
  if (vazio) return vazio;
  return html`<${Cartao} titulo="Atestados">
    <div class=${`c-indicadores c-pg-cartao-indic${forma === 'numeros' ? ' c-pg-sem-linha' : ''}`}>
      <${Indicador} rotulo="Dias de atestado" valor=${num(d.dias)} nota="No período" />
      <${Indicador} rotulo="Pessoas" valor=${num(d.pessoas)} nota="Com pelo menos 1 atestado" />
      <${Indicador} rotulo="Média por pessoa" valor=${d.media === null ? '—' : String(d.media).replace('.', ',')} nota="Dias" />
    </div>
    ${forma !== 'numeros' ? html`<ul class="c-pg-lista">
      <${Linha} titulo="Quem teve atestado" direita=${html`<${Contador} n=${d.lista.length} tom="neutro" />`}
        detalhe=${d.lista.length ? html`<${MiniTabela} colunas=${['Operador', 'Equipe', 'Dias', 'Período']} linhas=${d.lista.map((x) => [x.operador, x.equipe || '—', num(x.dias), x.periodo])} />` : null} />
    </ul>` : null}
  </${Cartao}>`;
}

function BlocoTrocasPessoa({ d }) {
  const vazio = semDados(d, 'Trocas por pessoa');
  if (vazio) return vazio;
  const max = Math.max(1, ...d.mais_pedem.map((x) => x.pedidos));
  return html`<${Cartao} titulo="Trocas por pessoa">
    <h3 class="c-pg-sub">Quem mais pede troca</h3>
    ${d.mais_pedem.length ? html`<${BarrasH} itens=${d.mais_pedem.map((x) => ({ rotulo: x.nome, valor: x.pedidos }))} max=${max} />` : html`<${Indisponivel} texto="Nenhum pedido de troca no período." />`}
    <ul class="c-pg-lista c-pg-topo">
      <${Linha} titulo="Recusadas ou reprovadas" direita=${html`<${Contador} n=${d.recusadas.length} tom="perigo" />`}
        detalhe=${d.recusadas.length ? html`<${MiniTabela} colunas=${['Quem pediu', 'Com quem', 'Dias', 'Situação']}
          linhas=${d.recusadas.map((x) => [x.quem, x.com_quem, x.dias, html`<span class="c-selo c-selo--perigo">${x.situacao}</span>`])} />` : null} />
    </ul>
  </${Cartao}>`;
}

function BlocoPresencaDoDia({ d, painel, filtros }) {
  const [dia, setDia] = useState(d.data || '');
  const [dados, setDados] = useState(d);
  const [carregando, setCarregando] = useState(false);
  useEffect(() => { setDia(d.data || ''); setDados(d); }, [d]);
  const trocar = (valor) => {
    setDia(valor); setCarregando(true);
    lerDiaPainel(painel.id_painel, valor, filtros.equipe).then(setDados).catch((e) => setDados({ indisponivel: e?.message || 'Não foi possível carregar o dia.' })).finally(() => setCarregando(false));
  };
  if (d.indisponivel) return html`<${Cartao} titulo="Presença do dia"><${Indisponivel} texto=${d.indisponivel} /></${Cartao}>`;
  const hoje = d.dias[0];
  const seletor = html`<select class="c-entrada c-entrada--compacta c-pg-mini-filtro" aria-label="Dia" value=${dia} onChange=${(e) => trocar(e.target.value)}>
    ${d.dias.map((x) => html`<option key=${x} value=${x}>${ddmm(x)}${x === hoje ? ' (mais recente)' : ''}</option>`)}</select>`;
  if (dados.indisponivel) return html`<${Cartao} titulo="Presença do dia" acao=${seletor}><${Indisponivel} texto=${dados.indisponivel} /></${Cartao}>`;
  const c = dados.contagem;
  const partes = [['Presentes', c.presentes, 'sucesso'], ['Faltaram', c.faltaram, 'perigo'], ['Atestado', c.atestado, 'informacao'], ['Sem lançamento', c.sem_lancamento, 'atencao']];
  const total = partes.reduce((a, p) => a + p[1], 0);
  return html`<${Cartao} titulo="Presença do dia" acao=${seletor}>
    <div class=${`c-pg-graf${carregando ? ' c-pg-carregando' : ''}`}>
      ${total ? html`<div class="c-pg-pilhabar" role="img" aria-label=${partes.map((p) => `${p[1]} ${p[0].toLowerCase()}`).join(', ')}>
        ${partes.filter((p) => p[1]).map((p) => html`<span key=${p[0]} class=${`c-pg-seg c-pg-seg--${p[2]}`} style=${{ flex: p[1] }} title=${`${p[0]}: ${p[1]}`}></span>`)}
      </div>` : null}
      <div class="c-pg-legenda">${partes.map((p) => html`<span key=${p[0]}><span class=${`c-pg-seg-amostra c-pg-seg--${p[2]}`}></span>${p[0]} ${num(p[1])}</span>`)}<span>de ${num(dados.escalados)} escalados</span></div>
    </div>
    <ul class="c-pg-lista c-pg-topo">
      <${Linha} titulo="Presentes" direita=${html`<${Contador} n=${c.presentes} tom="sucesso" />`}
        detalhe=${dados.presentes.length ? html`<${MiniTabela} colunas=${['Operador', 'Entrada', 'Pausas previstas']} linhas=${dados.presentes.map((x) => [x.operador, x.entrada || '—', x.pausas.join(' · ') || '—'])} />` : null} />
      <${Linha} titulo="Faltaram" direita=${html`<${Contador} n=${c.faltaram} tom="perigo" />`}
        detalhe=${dados.faltaram.length ? html`<${MiniTabela} colunas=${['Operador', 'Equipe', 'Falta']}
          linhas=${dados.faltaram.map((x) => [x.operador, x.equipe || '—', html`<span class=${`c-selo c-selo--${x.justificada ? 'informacao' : 'perigo'}`}>${x.justificada ? 'Justificada' : 'Sem justificativa'}</span>`])} />` : null} />
      <${Linha} titulo="Atestado" direita=${html`<${Contador} n=${c.atestado} tom="informacao" />`}
        detalhe=${dados.atestado.length ? html`<${MiniTabela} colunas=${['Operador', 'Equipe']} linhas=${dados.atestado.map((x) => [x.operador, x.equipe || '—'])} />` : null} />
      <${Linha} titulo="Sem lançamento" direita=${html`<${Contador} n=${c.sem_lancamento} />`}
        detalhe=${dados.sem_lancamento.length ? html`<${MiniTabela} colunas=${['Operador', 'Equipe', 'Turno']}
          linhas=${dados.sem_lancamento.map((x) => [x.operador, x.equipe || '—', [x.turno, x.entrada_prevista ? String(x.entrada_prevista).slice(0, 5) : ''].filter(Boolean).join(' · ') || '—'])} />` : null} />
    </ul>
  </${Cartao}>`;
}

function BlocoPausasMapa({ d }) {
  const [sel, setSel] = useState(null);
  useEffect(() => setSel(null), [d]);
  const vazio = semDados(d, 'Mapa de pausas');
  if (vazio) return vazio;
  const maxV = Math.max(1, d.capacidade || 1, ...d.slots.map((s) => s.valor));
  const slot = sel === null ? null : d.slots.find((s) => s.slot === sel);
  const colunas = { gridTemplateColumns: `repeat(${d.slots.length}, minmax(28px, 1fr))` };
  return html`<${Cartao} titulo="Mapa de pausas">
    <div class="c-pg-graf">
      ${d.dias ? html`
        <div class="c-pg-mapa-rolagem">
        <div class="c-pg-mapa" style=${colunas}>
          ${d.slots.map((s) => {
            const n = Math.min(1, s.valor / maxV);
            const acima = s.valor > d.capacidade;
            return html`<button key=${s.slot} type="button" disabled=${!s.valor || null} style=${{ '--n': n }}
              class=${`c-pg-cel${acima ? ' c-pg-cel--acima' : n < 0.45 ? ' c-pg-cel--claro' : ''}${sel === s.slot ? ' c-pg-cel--sel' : ''}`}
              aria-label=${`${s.inicio}: ${String(s.valor).replace('.', ',')} em pausa`} title=${`${s.inicio} às ${s.fim}: ${String(s.valor).replace('.', ',')} em pausa`}
              onClick=${() => setSel(sel === s.slot ? null : s.slot)}><b>${s.valor ? String(Math.round(s.valor * 10) / 10).replace('.', ',') : ''}</b></button>`;
          })}
        </div>
        <div class="c-pg-mapa c-pg-mapa-eixo" style=${colunas}>${d.slots.map((s) => html`<span key=${s.slot}>${s.slot % 4 === 0 ? `${Number(s.inicio.slice(0, 2))}h` : ''}</span>`)}</div>
        </div>
        <div class="c-pg-legenda">
          <span><span class="c-pg-cel c-pg-amostra c-pg-cel--claro" style=${{ '--n': 0.3 }}></span>Poucas pessoas</span>
          <span><span class="c-pg-cel c-pg-amostra" style=${{ '--n': 1 }}></span>Muitas pessoas</span>
          <span><span class="c-pg-cel c-pg-amostra c-pg-cel--acima"></span>Acima do limite (${num(d.capacidade)} ao mesmo tempo)</span>
        </div>
        <p class="c-ajuda">Clique num horário para ver quem está em pausa. Pausas PREVISTAS na escala, a cada 30 minutos${d.media_por_dia ? ' (média por dia do período)' : ''}. O Conecta não guarda a pausa real.</p>
        ${slot ? html`<div class="c-pg-det-graf">
          <div class="c-pg-det-cab"><h3>Em pausa prevista das ${slot.inicio} às ${slot.fim}${d.media_por_dia ? ` (${slot.pessoas.length} no período)` : ` (${slot.pessoas.length})`}</h3>
            <button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => setSel(null)}>Fechar lista</button></div>
          <${MiniTabela} colunas=${d.media_por_dia ? ['Operador', 'Equipe', 'Dia', 'Horário da pausa', 'Tipo'] : ['Operador', 'Equipe', 'Horário da pausa', 'Tipo']}
            linhas=${slot.pessoas.map((p) => (d.media_por_dia ? [p.operador, p.equipe || '—', p.data, p.horario, p.tipo || '—'] : [p.operador, p.equipe || '—', p.horario, p.tipo || '—']))} />
        </div>` : null}`
        : html`<${Indisponivel} texto="Nenhuma pausa prevista no período." />`}
    </div>
  </${Cartao}>`;
}

// ── Monitoria ───────────────────────────────────────────────────────
function BlocoNotaSemana({ d }) {
  if (!d.semanas.length) return html`<${Cartao} titulo="Nota semana a semana"><${Indisponivel} texto="Nenhuma monitoria válida no período." /></${Cartao}>`;
  const valores = d.semanas.map((s) => s.nota_media);
  const min = Math.max(0, Math.floor((Math.min(d.meta, ...valores) - 10) / 10) * 10);
  return html`<${Cartao} titulo="Nota semana a semana"><div class="c-pg-graf">
    <${SvgLinha} rotulo="Nota média por semana" rotulos=${d.semanas.map((s) => ddmm(s.periodo))} min=${min} max=${100} marcas=${marcasDe(min, 100, Math.min(3, (100 - min) / 10))}
      refValor=${d.meta} refTexto=${`Meta ${num(d.meta)}`} series=${[{ valores, cor: COR1 }]} />
    <p class="c-ajuda">Cada ponto é a nota média da semana (de 0 a 100), começando na segunda-feira. A linha tracejada é a meta.</p>
  </div></${Cartao}>`;
}

function BlocoItensErro({ d }) {
  return html`<${Cartao} titulo="Itens que mais perdem nota">
    ${d.itens.length ? html`<${BarrasH} itens=${d.itens.map((i) => ({ rotulo: i.item, valor: Math.round(i.pct) }))} max=${Math.max(...d.itens.map((i) => i.pct))} suf="%" atencao=${(x) => x.valor >= 30} />
      <${Nota}>% de monitorias em que o item foi marcado "Não" (N/A não conta).</${Nota}>` : html`<${Indisponivel} texto="Nenhum item com erro no período." />`}
  </${Cartao}>`;
}

function BlocoDistribuicao({ d }) {
  const max = Math.max(1, ...d.faixas.map((f) => f.quantidade));
  return html`<${Cartao} titulo="Distribuição das notas">
    ${d.total ? html`<${BarrasH} max=${max} atencao=${(x) => x.atencao}
      itens=${d.faixas.map((f) => ({ rotulo: `${f.faixa} (${num(f.min)} a ${num(Math.floor(f.max))})`, valor: f.quantidade, extra: pct(f.pct), atencao: f.atencao }))} />
      <${Nota}>Faixas da Monitoria desta operação. Monitorias anuladas ficam de fora.</${Nota}>` : html`<${Indisponivel} texto="Nenhuma monitoria válida no período." />`}
  </${Cartao}>`;
}

function BlocoSemMonitoria({ d }) {
  const vazio = semDados(d, 'Sem monitoria');
  if (vazio) return vazio;
  return html`<${Cartao} titulo="Sem monitoria">
    <div class="c-indicadores c-pg-cartao-indic">
      <${Indicador} rotulo="Sem monitoria" valor=${num(d.sem)} nota=${`De ${num(d.total)} operadores`} tom=${d.sem ? 'atencao' : ''} />
      <${Indicador} rotulo="Cobertura" valor=${pct(d.cobertura_pct)} nota="Tiveram pelo menos 1" />
    </div>
    <ul class="c-pg-lista">
      <${Linha} titulo="Quem ficou sem monitoria" direita=${html`<${Contador} n=${d.sem} />`}
        detalhe=${d.lista.length ? html`<${MiniTabela} colunas=${['Operador', 'Equipe', 'Última monitoria']} linhas=${d.lista.map((x) => [x.operador, x.equipe || '—', x.ultima])} />` : null} />
    </ul>
  </${Cartao}>`;
}

const tempo = (h) => (h === null || h === undefined ? '—' : h >= 48 ? `${Math.round(h / 24)} dias` : `${Math.round(h)} h`);
function BlocoTempoFeedback({ d, forma }) {
  return html`<${Cartao} titulo="Tempo até o feedback">
    <div class=${`c-indicadores c-pg-cartao-indic${forma === 'numeros' ? ' c-pg-sem-linha' : ''}`}>
      <${Indicador} rotulo="Tempo médio" valor=${tempo(d.media_horas)} nota="Da monitoria ao feedback" />
      <${Indicador} rotulo="No prazo" valor=${pct(d.no_prazo_pct)} nota=${`Prazo de ${num(d.prazo_horas)} h`} tom=${d.no_prazo_pct === null ? '' : 'sucesso'} />
      <${Indicador} rotulo="Fora do prazo" valor=${num(d.fora_prazo)} nota="Feedbacks atrasados" tom=${d.fora_prazo ? 'atencao' : ''} />
    </div>
    ${forma !== 'numeros' ? html`<ul class="c-pg-lista">
      <${Linha} titulo="Mais demorados" direita=${html`<${Contador} n=${d.mais_demorados.length} tom="neutro" />`}
        detalhe=${d.mais_demorados.length ? html`<${MiniTabela} colunas=${['Operador', 'Monitoria', 'Monitor', 'Tempo']} linhas=${d.mais_demorados.map((x) => [x.operador, x.monitoria, x.monitor, tempo(x.horas)])} />` : null} />
    </ul>` : null}
  </${Cartao}>`;
}

// ── Equipes ─────────────────────────────────────────────────────────
function BlocoRanking({ d }) {
  const vazio = semDados(d, 'Ranking das equipes');
  if (vazio) return vazio;
  return html`<${Cartao} titulo="Ranking das equipes">
    <div class="c-tabela-caixa c-pg-sem-borda"><table class="c-tabela c-pg-ops">
      <colgroup><col style=${{ width: '16%' }} /><col style=${{ width: '36%' }} /><col style=${{ width: '16%' }} /><col style=${{ width: '16%' }} /><col style=${{ width: '16%' }} /></colgroup>
      <thead><tr><th>Posição</th><th>Equipe</th><th class="c-num">Presença</th><th class="c-num">Nota média</th><th class="c-num">Faltas</th></tr></thead>
      <tbody>${d.equipes.map((e) => html`<tr key=${e.equipe}><td class="c-forte">${e.posicao}º</td><td>${e.equipe}</td><td class="c-num">${pct(e.presenca_pct)}</td>
        <td class="c-num">${d.mostra_nota ? nota(e.nota_media) : '—'}</td><td class="c-num">${num(e.faltas)}</td></tr>`)}</tbody>
    </table></div>
    <${Nota}>Posição = média das posições em presença (maior), nota (maior) e faltas (menor).</${Nota}>
  </${Cartao}>`;
}

const INDICADORES_COMPARAR = [
  ['operadores', 'Operadores', 'num', 0], ['presenca_pct', 'Presença', 'pct', 1], ['faltas', 'Faltas', 'num', -1], ['atestados', 'Atestados', 'num', -1],
  ['sem_lancamento', 'Sem lançamento', 'num', -1], ['nota_media', 'Nota média', 'nota', 1], ['monitorias', 'Monitorias', 'num', 0],
  ['abaixo_meta', 'Abaixo da meta', 'num', -1], ['feedbacks_pendentes', 'Feedbacks pendentes', 'num', -1], ['trocas', 'Trocas aprovadas', 'num', 0],
];
function BlocoComparar({ d }) {
  const lista = d.equipes || [];
  const [a, setA] = useState(lista[0]?.equipe || '');
  const [b, setB] = useState(lista[1]?.equipe || lista[0]?.equipe || '');
  useEffect(() => { setA(lista[0]?.equipe || ''); setB(lista[1]?.equipe || lista[0]?.equipe || ''); }, [d]);
  const vazio = semDados(d, 'Comparar equipes');
  if (vazio) return vazio;
  const ea = lista.find((e) => e.equipe === a) || {};
  const eb = lista.find((e) => e.equipe === b) || {};
  const fmt = (tipo, v) => (tipo === 'pct' ? pct(v) : tipo === 'nota' ? nota(v) : (v === null || v === undefined ? '—' : String(v).replace('.', ',')));
  const sel = (valor, mudar, id) => html`<select class="c-entrada c-entrada--compacta" aria-label=${`Equipe ${id}`} value=${valor} onChange=${(e) => mudar(e.target.value)}>
    ${lista.map((e) => html`<option key=${e.equipe} value=${e.equipe}>${e.equipe}</option>`)}</select>`;
  return html`<${Cartao} titulo="Comparar equipes" acao=${html`<div class="c-pg-comparar">${sel(a, setA, 'A')}<span class="c-pg-sec">com</span>${sel(b, setB, 'B')}</div>`}>
    <div class="c-tabela-caixa c-pg-sem-borda"><table class="c-tabela c-pg-ops">
      <colgroup><col style=${{ width: '28%' }} /><col style=${{ width: '18%' }} /><col style=${{ width: '18%' }} /><col style=${{ width: '18%' }} /><col style=${{ width: '18%' }} /></colgroup>
      <thead><tr><th>Indicador</th><th class="c-num">${a || 'Equipe A'}</th><th class="c-num">${b || 'Equipe B'}</th><th class="c-num">Média da operação</th><th class="c-num">Diferença (A − B)</th></tr></thead>
      <tbody>${INDICADORES_COMPARAR.filter(([k]) => d.mostra_nota || !['nota_media', 'monitorias', 'abaixo_meta', 'feedbacks_pendentes'].includes(k)).map(([k, rotulo, tipo, sentido]) => {
        const va = ea[k]; const vb = eb[k];
        const dif = va === null || va === undefined || vb === null || vb === undefined ? null : Math.round((va - vb) * 10) / 10;
        const txt = dif === null ? '—' : `${dif > 0 ? '+' : dif < 0 ? '−' : ''}${String(Math.abs(dif)).replace('.', ',')}${tipo === 'pct' ? ' pontos' : ''}`;
        const tom = !sentido || !dif ? '' : (dif > 0) === (sentido > 0) ? 'sucesso' : 'perigo';
        return html`<tr key=${k}><td>${rotulo}</td><td class="c-num c-forte">${fmt(tipo, va)}</td><td class="c-num c-forte">${fmt(tipo, vb)}</td>
          <td class="c-num c-secundario">${fmt(tipo, d.media[k])}</td><td class="c-num">${tom ? html`<span class=${`c-selo c-selo--${tom}`}>${txt}</span>` : txt}</td></tr>`;
      })}</tbody>
    </table></div>
    <${Nota}>Verde = a equipe A está melhor que a B nesse indicador; vermelho = está pior. Média da operação: presença e nota da operação toda; os demais, a média por equipe.</${Nota}>
  </${Cartao}>`;
}

// ── Diário de Bordo ─────────────────────────────────────────────────
function BlocoIntercTipo({ d }) {
  const vazio = semDados(d, 'Intercorrências por tipo');
  if (vazio) return vazio;
  return html`<${Cartao} titulo="Intercorrências por tipo">
    ${d.tipos.length ? html`<${BarrasH} itens=${d.tipos.map((t) => ({ rotulo: t.tipo, valor: t.quantidade }))} max=${Math.max(...d.tipos.map((t) => t.quantidade))} />
      <${Nota}>Tipo = a ferramenta marcada na intercorrência do Diário de Bordo.</${Nota}>` : html`<${Indisponivel} texto="Nenhuma intercorrência no período." />`}
  </${Cartao}>`;
}

// ── RH ──────────────────────────────────────────────────────────────
function BlocoEntrevistas({ d, forma }) {
  const vazio = semDados(d, 'Entrevistas');
  if (vazio) return vazio;
  const max = teto(d.semanas.map((s) => s.marcadas), 5);
  return html`<${Cartao} titulo="Entrevistas">
    <div class=${`c-indicadores c-pg-cartao-indic${forma === 'numeros' ? ' c-pg-sem-linha' : ''}`}>
      <${Indicador} rotulo="Marcadas" valor=${num(d.total)} nota="No período" />
      <${Indicador} rotulo="Compareceram" valor=${num(d.compareceram)} nota=${d.total ? `${pct(Math.round((100 * d.compareceram) / d.total))} das marcadas` : '—'} tom="sucesso" />
      <${Indicador} rotulo="Faltaram" valor=${num(d.faltaram)} nota="Não vieram" tom=${d.faltaram ? 'perigo' : ''} />
      <${Indicador} rotulo="Canceladas" valor=${num(d.canceladas)} nota="Pelo RH ou pela pessoa" />
      <${Indicador} rotulo="A acontecer" valor=${num(d.a_acontecer)} nota="Ainda sem resultado" />
    </div>
    ${forma !== 'numeros' && d.semanas.length ? html`<div class="c-pg-graf">
      <${Legenda} itens=${[['Marcadas', COR1], ['Compareceram', COR2]]} />
      <${SvgBarras} rotulo="Entrevistas por semana" rotulos=${d.semanas.map((s) => ddmm(s.semana))} max=${max} marcas=${marcasDe(0, max)}
        grupos=${[{ valores: d.semanas.map((s) => s.marcadas), cor: COR1 }, { valores: d.semanas.map((s) => s.compareceram), cor: COR2 }]} />
    </div>` : null}
    ${forma !== 'numeros' ? html`<ul class="c-pg-lista c-pg-topo">
      <${Linha} titulo="Quem faltou" direita=${html`<${Contador} n=${d.lista_faltaram.length} tom="perigo" />`}
        detalhe=${d.lista_faltaram.length ? html`<${MiniTabela} colunas=${['Candidato', 'Vaga', 'Quando']} linhas=${d.lista_faltaram.map((x) => [x.candidato, x.vaga || '—', x.quando])} />` : null} />
    </ul>` : null}
  </${Cartao}>`;
}

function BlocoTempoAdmissao({ d }) {
  const vazio = semDados(d, 'Tempo de admissão');
  if (vazio) return vazio;
  const dias = (v) => (v === null || v === undefined ? '—' : `${String(v).replace('.', ',')} ${v === 1 ? 'dia' : 'dias'}`);
  return html`<${Cartao} titulo="Tempo de admissão">
    <div class="c-indicadores c-pg-cartao-indic">
      <${Indicador} rotulo="Tempo médio" valor=${dias(d.media_dias)} nota="Do início ao 1º dia" />
      <${Indicador} rotulo="Mais rápida" valor=${dias(d.mais_rapida?.dias)} nota=${d.mais_rapida?.pessoa || '—'} />
      <${Indicador} rotulo="Mais demorada" valor=${dias(d.mais_demorada?.dias)} nota=${d.mais_demorada?.pessoa || '—'} tom=${d.mais_demorada ? 'atencao' : ''} />
    </div>
    <ul class="c-pg-lista">
      <${Linha} titulo="Admissões do período" direita=${html`<${Contador} n=${d.lista.length} tom="neutro" />`}
        detalhe=${d.lista.length ? html`<${MiniTabela} colunas=${['Pessoa', 'Início', '1º dia', 'Dias']} linhas=${d.lista.map((x) => [x.pessoa, x.inicio, x.primeiro_dia, num(x.dias)])} />` : null} />
    </ul>
    <${Nota}>Início = quando a admissão foi aberta no Conecta. 1º dia = data marcada para começar.</${Nota}>
  </${Cartao}>`;
}

export const BLOCOS_V6 = {
  presenca_dia: BlocoPresencaDia, faltas_semana: BlocoFaltasSemana, atestados: BlocoAtestados, trocas_pessoa: BlocoTrocasPessoa,
  presenca_do_dia: BlocoPresencaDoDia, pausas_mapa: BlocoPausasMapa, nota_semana: BlocoNotaSemana, itens_erro: BlocoItensErro,
  distribuicao_notas: BlocoDistribuicao, sem_monitoria: BlocoSemMonitoria, tempo_feedback: BlocoTempoFeedback, ranking_equipes: BlocoRanking,
  comparar_equipes: BlocoComparar, interc_tipo: BlocoIntercTipo, rh_entrevistas: BlocoEntrevistas, rh_tempo_admissao: BlocoTempoAdmissao,
};
