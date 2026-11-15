// Painel (14/11/2026, amostra v3 aprovada pelo Paulo): visão analítica por módulo e unidade.
// Cada painel é montado pela Tecnologia (Configurações › Painéis). Os filtros só valem ao clicar em "Aplicar filtros" e
// tudo (números, listas e Diário de Bordo) segue o período escolhido. Rebranding: só peças c- e tokens (estilos/painel.css).
import { html, useEffect, useMemo, useRef, useState } from '../../infraestrutura-react.js';
import { PainelRh } from '../../ui/componentes-compartilhados.js';
import { Esqueleto, Estado, Ic } from '../../ui/components/ds.js?v=20261106-wfm';
import { lerDadosPainel, lerFichaOperador, lerOpcoesPainel } from '../../services/api/painel.js';
import { obterEstadoModulos } from '../estado.js?v=20261112-modulo-unico2';

const POR_PAGINA_SUB = 5;
const POR_PAGINA_OPS = 10;
const ROTULO_TROCA = { APROVADA: ['Aprovada', 'sucesso'], AGUARDANDO_B: ['Esperando o colega', 'atencao'], AGUARDANDO_APROVACAO: ['Esperando aprovação', 'atencao'],
  REPROVADA: ['Reprovada', 'perigo'], RECUSADA: ['Recusada', 'perigo'], CANCELADA: ['Cancelada', 'neutro'], EXPIRADA: ['Expirada', 'neutro'], DESFEITA: ['Desfeita', 'neutro'] };
const TOM_SIGLA = { P: 'sucesso', F: 'perigo', FJ: 'informacao', AT: 'informacao', FL: 'neutro', FE: 'neutro', FB: 'neutro', DO: 'neutro', SE: 'neutro' };
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const num = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR'));
const pct = (v) => (v === null || v === undefined ? '—' : `${String(v).replace('.', ',')}%`);
const nota = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const ddmm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
const diaSemana = (iso) => {
  if (!iso) return '';
  if (iso === 'Hoje') return 'Hoje';
  const d = new Date(`${iso}T12:00:00`);
  return `${SEMANA[d.getDay()]}, ${ddmm(iso)}`;
};
const hhmm = (iso) => (iso ? iso.slice(11, 16) : '');

function Indicador({ rotulo, valor, sufixo = '', nota: obs = '', tom = '' }) {
  return html`<div class="c-indicador">
    <span class="c-ind-rotulo">${rotulo}</span>
    <span class="c-ind-valor">${valor}${sufixo ? html`<small>${sufixo}</small>` : null}</span>
    <span class=${`c-ind-nota${tom ? ` c-tom-${tom}` : ''}`}>${obs}</span>
  </div>`;
}

function Cartao({ titulo, acao = null, children }) {
  return html`<article class="c-cartao c-pg-cartao">
    <div class="c-cartao-cab"><h2>${titulo}</h2>${acao}</div>
    ${children}
  </article>`;
}

function Indisponivel({ texto }) {
  return html`<div class="c-pg-vazio"><${Estado} titulo=${texto} /></div>`;
}

// Tabela curta dentro de uma linha aberta: sem barra de rolagem, texto quebra, 5 por página.
function MiniTabela({ colunas, linhas, longa = false }) {
  const [pagina, setPagina] = useState(1);
  const paginas = Math.max(1, Math.ceil(linhas.length / POR_PAGINA_SUB));
  const visiveis = linhas.slice((pagina - 1) * POR_PAGINA_SUB, pagina * POR_PAGINA_SUB);
  return html`<div class="c-tabela-caixa c-pg-mini">
    <table class="c-tabela c-tabela--compacta">
      ${longa ? html`<colgroup>${colunas.map((c, i) => html`<col key=${c} style=${{ width: i === colunas.length - 1 ? '50%' : `${50 / (colunas.length - 1)}%` }} />`)}</colgroup>` : null}
      <thead><tr>${colunas.map((c) => html`<th key=${c}>${c}</th>`)}</tr></thead>
      <tbody>${visiveis.map((l, i) => html`<tr key=${i}>${l.map((c, j) => html`<td key=${j}>${c}</td>`)}</tr>`)}</tbody>
    </table>
    ${paginas > 1 ? html`<div class="c-tabela-rodape c-pg-rodape">
      <span>${(pagina - 1) * POR_PAGINA_SUB + 1}–${Math.min(linhas.length, pagina * POR_PAGINA_SUB)} de ${linhas.length}</span>
      <span class="c-grupo">
        <button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${pagina === 1 || null} onClick=${() => setPagina(pagina - 1)}>Anterior</button>
        <button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${pagina === paginas || null} onClick=${() => setPagina(pagina + 1)}>Próxima</button>
      </span>
    </div>` : null}
  </div>`;
}

// Linha de lista: abre a sublista ao clicar (quando há detalhe). `fixa` = linha que nunca abre (ex.: Frequência).
function Linha({ titulo, direita, detalhe = null, fixa = false }) {
  const [aberta, setAberta] = useState(false);
  if (fixa || !detalhe) {
    return html`<li><div class="c-pg-linha">${fixa ? null : html`<span class="c-pg-sem-seta"></span>`}<span class="c-pg-estica">${titulo}</span>${direita}</div></li>`;
  }
  return html`<li>
    <button type="button" class="c-pg-linha" aria-expanded=${aberta ? 'true' : 'false'} onClick=${() => setAberta(!aberta)}>
      <span class="c-pg-seta"><${Ic} nome="caret-right" /></span><span class="c-pg-estica">${titulo}</span>${direita}
    </button>
    ${aberta ? html`<div class="c-pg-detalhe">${detalhe}</div>` : null}
  </li>`;
}

const Contador = ({ n, tom = 'atencao' }) => html`<span class=${`c-selo c-selo--${n ? tom : 'neutro'}`}>${num(n)}</span>`;

// ── Blocos ──────────────────────────────────────────────────────────
function BlocoPresenca({ d }) {
  if (d.indisponivel) return html`<${Cartao} titulo="Presença"><${Indisponivel} texto=${d.indisponivel} /></${Cartao}>`;
  const var_ = d.variacao_pontos;
  return html`<div class="c-indicadores" aria-label="Presença">
    <${Indicador} rotulo="Escalados" valor=${num(d.escalados)} nota=${d.um_dia ? `${num(d.folgas)} de folga` : `${num(d.pessoas)} pessoas · dias somados`} />
    <${Indicador} rotulo="Presentes" valor=${num(d.presentes)} sufixo=${pct(d.presenca_pct)}
      nota=${var_ === null || var_ === undefined ? 'Sem período anterior para comparar' : `${var_ >= 0 ? '+' : ''}${String(var_).replace('.', ',')} pontos que o período anterior`}
      tom=${var_ === null || var_ === undefined ? '' : var_ >= 0 ? 'sucesso' : 'perigo'} />
    <${Indicador} rotulo="Faltas" valor=${num(d.faltas)} nota=${`${num(d.faltas_injustificadas)} sem justificativa`} tom=${d.faltas_injustificadas ? 'perigo' : ''} />
    <${Indicador} rotulo="Atestados" valor=${num(d.atestados)} nota=${d.um_dia ? 'Hoje' : 'Dias com atestado'} />
    <${Indicador} rotulo="Sem lançamento" valor=${num(d.sem_lancamento)} nota=${d.sem_lancamento ? 'Presença ainda não lançada' : 'Tudo lançado'} tom=${d.sem_lancamento ? 'atencao' : 'sucesso'} />
  </div>`;
}

function BlocoFrequencia({ d, forma }) {
  if (d.indisponivel) return html`<${Cartao} titulo="Frequência"><${Indisponivel} texto=${d.indisponivel} /></${Cartao}>`;
  if (!d.equipes.length) return html`<${Cartao} titulo="Frequência"><${Indisponivel} texto="Ninguém escalado no período." /></${Cartao}>`;
  if (forma === 'tabela') {
    return html`<${Cartao} titulo="Frequência"><div class="c-tabela-caixa c-pg-sem-borda"><table class="c-tabela">
      <thead><tr><th>Equipe</th><th class="c-num">Presença</th><th class="c-num">Faltas</th></tr></thead>
      <tbody>${d.equipes.map((e) => html`<tr key=${e.equipe}><td>${e.equipe}</td><td class="c-num">${pct(e.presenca_pct)}</td><td class="c-num">${num(e.faltas)}</td></tr>`)}</tbody>
    </table></div></${Cartao}>`;
  }
  return html`<${Cartao} titulo="Frequência"><ul class="c-pg-lista">
    ${d.equipes.map((e) => html`<${Linha} key=${e.equipe} fixa=${true} titulo=${e.equipe} direita=${html`
      <span class=${`c-pg-barra${e.presenca_pct !== null && e.presenca_pct < 90 ? ' c-pg-barra--atencao' : ''}`}><i style=${{ width: `${e.presenca_pct || 0}%` }}></i></span>
      <span class="c-pg-num">${pct(e.presenca_pct)}</span><span class="c-pg-sec">${num(e.faltas)} ${e.faltas === 1 ? 'falta' : 'faltas'}</span>`} />`)}
  </ul></${Cartao}>`;
}

function BlocoMonitorias({ d, forma, irPara }) {
  const lista = forma !== 'numeros';
  const prazo = (p) => (p.tom ? html`<span class=${`c-selo c-selo--${p.tom}`}>${p.texto}</span>` : p.texto);
  return html`<${Cartao} titulo="Monitorias" acao=${html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => irPara('screen-monitoria-dashboard')}>Abrir</button>`}>
    <div class=${`c-indicadores c-pg-cartao-indic${lista ? '' : ' c-pg-sem-linha'}`}>
      <${Indicador} rotulo="Feitas" valor=${num(d.feitas)} nota=${`${num(d.validas)} válidas`} />
      <${Indicador} rotulo="Nota média" valor=${nota(d.nota_media)} nota="De 0 a 100" />
      <${Indicador} rotulo="Abaixo da meta" valor=${num(d.abaixo_meta)} nota=${`Nota menor que ${num(d.meta)}`} tom=${d.abaixo_meta ? 'atencao' : ''} />
    </div>
    ${lista ? html`<ul class="c-pg-lista">
      <${Linha} titulo="Feedbacks pendentes" direita=${html`<${Contador} n=${d.feedbacks_pendentes.length} />`}
        detalhe=${d.feedbacks_pendentes.length ? html`<${MiniTabela} colunas=${['Operador', 'Monitoria', 'Monitor', 'Prazo']} linhas=${d.feedbacks_pendentes.map((x) => [x.operador, x.monitoria, x.monitor, prazo(x.prazo)])} />` : null} />
      <${Linha} titulo="Contestações abertas" direita=${html`<${Contador} n=${d.contestacoes.length} tom="neutro" />`}
        detalhe=${d.contestacoes.length ? html`<${MiniTabela} longa=${true} colunas=${['Operador', 'Monitoria', 'Motivo']} linhas=${d.contestacoes.map((x) => [x.operador, x.monitoria, x.motivo || '—'])} />` : null} />
      <${Linha} titulo="Abaixo da meta" direita=${html`<${Contador} n=${d.abaixo.length} />`}
        detalhe=${d.abaixo.length ? html`<${MiniTabela} colunas=${['Operador', 'Data', 'Nota']} linhas=${d.abaixo.map((x) => [x.operador, x.data, x.nota])} />` : null} />
    </ul>` : null}
  </${Cartao}>`;
}

function BlocoDiario({ d, forma, irPara }) {
  if (d.indisponivel) return html`<${Cartao} titulo="Diário de Bordo"><${Indisponivel} texto=${d.indisponivel} /></${Cartao}>`;
  const numeros = forma !== 'lista';
  const ESTADO = { concluido: ['Fechado', 'sucesso'], rascunho: ['Em andamento', 'informacao'], vazio: ['Não começou', 'neutro'] };
  return html`<${Cartao} titulo="Diário de Bordo" acao=${html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => irPara('screen-diario-historico')}>Abrir</button>`}>
    ${numeros ? html`<div class="c-indicadores c-pg-cartao-indic">
      <${Indicador} rotulo="Dias registrados" valor=${`${num(d.dias_registrados)} de ${num(d.dias_periodo)}`} nota="Diário preenchido" />
      <${Indicador} rotulo="Turnos fechados" valor=${`${num(d.turnos_fechados)} de ${num(d.turnos_total)}`}
        nota=${d.turnos_total - d.turnos_fechados > 0 ? `${num(d.turnos_total - d.turnos_fechados)} sem fechar` : 'Todos fechados'} tom=${d.turnos_total - d.turnos_fechados > 0 && !d.um_dia ? 'atencao' : ''} />
      <${Indicador} rotulo="Intercorrências" valor=${num(d.intercorrencias)} nota="No período" />
    </div>` : null}
    <ul class="c-pg-lista">
      ${d.turnos.map((t) => {
        const est = d.um_dia ? ESTADO[t.estado] || ESTADO.vazio : null;
        const qtd = t.itens.length;
        return html`<${Linha} key=${t.turno} titulo=${t.rotulo}
          direita=${html`${est ? html`<span class=${`c-selo c-selo--${est[1]}`}>${est[0]}</span>` : null}<span class="c-pg-sec">${qtd ? `${qtd} ${qtd === 1 ? 'intercorrência' : 'intercorrências'}` : 'Sem intercorrência'}</span>`}
          detalhe=${qtd ? html`<${MiniTabela} longa=${true} colunas=${['Quando', 'Tipo', 'O que aconteceu']} linhas=${t.itens.map((x) => [x.quando, x.tipo, x.descricao])} />` : null} />`;
      })}
    </ul>
  </${Cartao}>`;
}

function BlocoEscalas({ d, irPara }) {
  if (d.indisponivel) return html`<${Cartao} titulo="Escalas e trocas"><${Indisponivel} texto=${d.indisponivel} /></${Cartao}>`;
  const trocas = (lista) => html`<${MiniTabela} colunas=${['Quem pediu', 'Com quem', 'Dias']} linhas=${lista.map((x) => [x.quem, x.com_quem, x.dias])} />`;
  return html`<${Cartao} titulo="Escalas e trocas" acao=${html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => irPara('screen-wfm')}>Abrir</button>`}>
    <ul class="c-pg-lista">
      <${Linha} titulo="Escalas esperando aprovação" direita=${html`<${Contador} n=${d.escalas_aguardando.length} />`}
        detalhe=${d.escalas_aguardando.length ? html`<${MiniTabela} colunas=${['Escala', 'Mês']} linhas=${d.escalas_aguardando.map((x) => [x.escala, `${x.mes.slice(5, 7)}/${x.mes.slice(0, 4)}`])} />` : null} />
      <${Linha} titulo="Trocas pedidas, sem resposta" direita=${html`<${Contador} n=${d.trocas_pendentes.length} />`} detalhe=${d.trocas_pendentes.length ? trocas(d.trocas_pendentes) : null} />
      <${Linha} titulo="Trocas aprovadas" direita=${html`<span class="c-pg-num">${num(d.trocas_aprovadas.length)}</span>`} detalhe=${d.trocas_aprovadas.length ? trocas(d.trocas_aprovadas) : null} />
    </ul>
  </${Cartao}>`;
}

function BlocoOperadores({ d, abrirFicha, selecionado }) {
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  useEffect(() => setPagina(1), [busca, d]);
  if (d.indisponivel) return html`<${Cartao} titulo="Operadores"><${Indisponivel} texto=${d.indisponivel} /></${Cartao}>`;
  const termo = busca.trim().toLowerCase();
  const lista = d.linhas.filter((l) => !termo || l.nome.toLowerCase().includes(termo) || (l.equipe || '').toLowerCase().includes(termo));
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA_OPS));
  const visiveis = lista.slice((pagina - 1) * POR_PAGINA_OPS, pagina * POR_PAGINA_OPS);
  const abrir = (l) => abrirFicha(l);
  return html`<article class="c-cartao c-pg-cartao">
    <div class="c-cartao-cab"><h2>Operadores</h2>
      <label class="c-com-icone c-com-icone--compacta"><${Ic} nome="magnifying-glass" />
        <input class="c-entrada c-entrada--compacta" type="search" placeholder="Buscar operador" aria-label="Buscar operador" value=${busca} onInput=${(e) => setBusca(e.target.value)} />
      </label>
    </div>
    ${lista.length ? html`<div class="c-tabela-caixa c-pg-sem-borda">
      <table class="c-tabela c-pg-ops">
        <colgroup>${[16, 15, 8, 9, 8, 8, 9, 9, 8, 10].map((w, i) => html`<col key=${i} style=${{ width: `${w}%` }} />`)}</colgroup>
        <thead><tr><th>Operador</th><th>Equipe</th><th>Turno</th><th class="c-centro">Dias trabalhados</th><th class="c-centro">Presença</th><th class="c-centro">Faltas</th>
          <th class="c-centro">Nota média</th><th class="c-centro">Monitorias</th><th class="c-centro">Trocas</th><th>Próxima folga</th></tr></thead>
        <tbody>${visiveis.map((l) => html`<tr key=${l.id_operador} class="c-clicavel" tabindex="0" aria-selected=${selecionado === l.id_operador ? 'true' : null}
            onClick=${() => abrir(l)} onKeyDown=${(e) => { if (e.key === 'Enter') abrir(l); }}>
          <td class="c-forte" data-papel="titulo">${l.nome}</td>
          <td data-papel="info" data-prioridade="1" data-primeira="">${l.equipe || '—'}</td>
          <td>${l.turno || '—'}</td>
          <td class="c-centro">${num(l.dias_trabalhados)}</td>
          <td class="c-centro" data-papel="info" data-prioridade="1"><span class="c-pg-so-cel">Presença </span>${pct(l.presenca_pct)}</td>
          <td class="c-centro">${num(l.faltas)}</td>
          <td class="c-centro" data-papel="info" data-prioridade="1"><span class="c-pg-so-cel">Nota </span>${d.mostra_nota ? nota(l.nota_media) : '—'}</td>
          <td class="c-centro">${d.mostra_nota ? num(l.monitorias) : '—'}</td>
          <td class="c-centro">${num(l.trocas)}</td>
          <td>${l.proxima_folga ? diaSemana(l.proxima_folga) : '—'}</td>
        </tr>`)}</tbody>
      </table>
      <div class="c-tabela-rodape c-pg-rodape">
        <span>${visiveis.length} de ${lista.length} operadores · clique numa linha para abrir a ficha</span>
        <span class="c-grupo">
          <button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${pagina === 1 || null} onClick=${() => setPagina(pagina - 1)}>Anterior</button>
          <button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${pagina === paginas || null} onClick=${() => setPagina(pagina + 1)}>Próxima</button>
        </span>
      </div>
    </div>` : html`<${Indisponivel} texto=${termo ? 'Ninguém encontrado com essa busca.' : 'Ninguém escalado no período.'} />`}
  </article>`;
}

function BlocoEntrevistas({ d, forma }) {
  if (d.indisponivel) return html`<${Cartao} titulo="Entrevistas"><${Indisponivel} texto=${d.indisponivel} /></${Cartao}>`;
  return html`<${Cartao} titulo="Entrevistas">
    <div class=${`c-indicadores c-pg-cartao-indic${forma === 'numeros' ? ' c-pg-sem-linha' : ''}`}>
      <${Indicador} rotulo="Marcadas" valor=${num(d.total)} nota="No período" />
      <${Indicador} rotulo="Compareceram" valor=${num(d.compareceram)} nota=${d.total ? `${pct(Math.round((100 * d.compareceram) / d.total))} das marcadas` : '—'} tom="sucesso" />
      <${Indicador} rotulo="Faltaram" valor=${num(d.faltaram)} nota="Não vieram" tom=${d.faltaram ? 'perigo' : ''} />
      <${Indicador} rotulo="Canceladas" valor=${num(d.canceladas)} nota="Pelo RH ou pela pessoa" />
      <${Indicador} rotulo="A acontecer" valor=${num(d.a_acontecer)} nota="Ainda sem resultado" />
    </div>
    ${forma !== 'numeros' ? html`<ul class="c-pg-lista">
      <${Linha} titulo="Quem faltou" direita=${html`<${Contador} n=${d.lista_faltaram.length} tom="perigo" />`}
        detalhe=${d.lista_faltaram.length ? html`<${MiniTabela} colunas=${['Candidato', 'Vaga', 'Quando']} linhas=${d.lista_faltaram.map((x) => [x.candidato, x.vaga || '—', x.quando])} />` : null} />
    </ul>` : null}
  </${Cartao}>`;
}

// ── Ficha do operador ───────────────────────────────────────────────
function Ficha({ painel, operador, periodo, aoFechar, irPara }) {
  const [ficha, setFicha] = useState(null);
  const [erro, setErro] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    setFicha(null); setErro('');
    lerFichaOperador(painel.id_painel, operador.id_operador, periodo).then(setFicha).catch((e) => setErro(e?.message || 'Não foi possível abrir a ficha.'));
    ref.current?.focus();
  }, [operador.id_operador, periodo]);
  useEffect(() => {
    const esc = (ev) => { if (ev.key === 'Escape') aoFechar(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, []);
  const f = ficha;
  const primeiroDia = f ? new Date(`${f.mes.ini}T12:00:00`).getDay() : 0;
  const nomeMes = f ? new Date(`${f.mes.ini}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long' }) : '';
  return html`
    <div class="c-pg-fundo" onClick=${aoFechar}></div>
    <aside ref=${ref} tabIndex="-1" class="c-painel-lateral c-pg-ficha c-ds" role="dialog" aria-modal="true" aria-labelledby="c-pg-ficha-nome">
      <div class="c-janela-cab"><h2 id="c-pg-ficha-nome">${operador.nome}</h2>
        <button type="button" class="c-botao c-botao--icone c-botao--texto" aria-label="Fechar ficha" onClick=${aoFechar}><${Ic} nome="x" /></button></div>
      <p class="c-pg-ficha-sub">
        <span>${operador.equipe || 'Sem equipe'}</span>
        ${f?.operador?.supervisores ? html`<span>·</span><span>Supervisão: ${f.operador.supervisores}</span>` : null}
        ${f ? html`<span>·</span><span>${f.periodo.nome}: ${ddmm(f.periodo.ini)} a ${ddmm(f.periodo.fim)}</span>` : null}
      </p>
      <div class="c-janela-corpo">
        ${erro ? html`<${Estado} titulo=${erro} />` : !f ? html`<${Esqueleto} linhas=${8} />` : html`
          <div class="c-indicadores">
            <${Indicador} rotulo="Presença" valor=${pct(f.resumo.presenca_pct)} nota=${`${num(f.resumo.presentes)} de ${num(f.resumo.apurados)} dias apurados`} />
            <${Indicador} rotulo="Faltas" valor=${num(f.resumo.faltas)} nota=${f.resumo.datas_falta.join(', ') || 'Nenhuma'} tom=${f.resumo.faltas ? 'perigo' : ''} />
            ${f.monitorias ? html`<${Indicador} rotulo="Nota média" valor=${nota(f.monitorias.media)} nota=${`${num(f.monitorias.quantidade)} monitorias`} />` : null}
          </div>
          <section>
            <h3>Hoje</h3>
            <dl class="c-pg-hoje">
              <div><dt>Entrada (1º login no Conecta)</dt><dd>${f.hoje.entrada || 'Ainda não entrou'}</dd></div>
              <div><dt>Turno de hoje</dt><dd>${f.hoje.turno ? `${f.hoje.turno} · ${hhmm(f.hoje.entrada_prevista) || f.hoje.entrada_prevista || ''} às ${hhmm(f.hoje.saida_prevista) || f.hoje.saida_prevista || ''}` : 'Não trabalha hoje'}</dd></div>
              <div><dt>Pausas previstas</dt><dd>${f.hoje.pausas.length ? f.hoje.pausas.map((p) => `${p.inicio} (${p.duracao_min} min)`).join(' · ') : '—'}</dd></div>
            </dl>
            <p class="c-ajuda">O Conecta guarda só a pausa prevista na escala, não a pausa real.</p>
          </section>
          <section>
            <h3>Escala de ${nomeMes}</h3>
            <div class="c-pg-mes">
              ${SEMANA.map((s) => html`<span key=${s} class="c-pg-sem">${s}</span>`)}
              ${Array.from({ length: primeiroDia }, (_, i) => html`<span key=${`v${i}`}></span>`)}
              ${f.mes.dias.map((dia) => html`<span key=${dia.data} class=${`c-pg-dia${dia.hoje ? ' c-pg-dia--hoje' : dia.futuro ? ' c-pg-dia--futuro' : ''}`}>
                <span>${Number(dia.data.slice(8, 10))}</span>
                ${dia.sigla ? html`<span class=${`c-sigla c-selo--${TOM_SIGLA[dia.sigla] || 'neutro'}`}>${dia.sigla}</span>` : null}
              </span>`)}
            </div>
            <div class="c-pg-legenda">
              <span><span class="c-sigla c-selo--sucesso">P</span>Trabalhou</span>
              <span><span class="c-sigla c-selo--perigo">F</span>Falta</span>
              <span><span class="c-sigla c-selo--informacao">FJ</span>Falta justificada</span>
              <span><span class="c-sigla c-selo--neutro">FL</span>Folga</span>
              <span><span class="c-sigla c-selo--neutro">·</span>Sem lançamento</span>
              <span>Código do turno = vai trabalhar</span>
            </div>
          </section>
          ${f.monitorias ? html`<section>
            <h3>Monitorias</h3>
            ${f.monitorias.itens.length ? html`<${MiniTabela} colunas=${['Data', 'Monitor', 'Nota', 'Feedback']}
              linhas=${f.monitorias.itens.map((m) => [m.data, m.monitor, m.nota, html`<span class=${`c-selo c-selo--${m.feedback === 'Aplicado' ? 'sucesso' : m.feedback === 'Pendente' ? 'atencao' : 'neutro'}`}>${m.feedback}</span>`])} />`
              : html`<p class="c-ajuda">Nenhuma monitoria no período.</p>`}
          </section>` : null}
          <section>
            <h3>Trocas</h3>
            ${f.trocas.length ? html`<${MiniTabela} colunas=${['Dias', 'Com quem', 'Situação']}
              linhas=${f.trocas.map((t) => { const r = ROTULO_TROCA[t.estado] || [t.estado, 'neutro']; return [t.dias, t.com_quem, html`<span class=${`c-selo c-selo--${r[1]}`}>${r[0]}</span>`]; })} />`
              : html`<p class="c-ajuda">Nenhuma troca no período.</p>`}
          </section>`}
      </div>
      <div class="c-janela-rodape">
        <button type="button" class="c-botao c-botao--secundario" onClick=${() => irPara('screen-wfm')}>Ver escala completa</button>
        ${f?.monitorias ? html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => irPara('screen-monitoria')}>Ver monitorias</button>` : null}
      </div>
    </aside>`;
}

// ── Tela ────────────────────────────────────────────────────────────
export function TelaPainel({ controlador }) {
  const [opcoes, setOpcoes] = useState(null);
  const [erro, setErro] = useState('');
  const [rascunho, setRascunho] = useState({ modulo: '', painel: '', periodo: 'mes', equipe: '' });
  const [aplicado, setAplicado] = useState(null);
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erroDados, setErroDados] = useState('');
  const [ficha, setFicha] = useState(null);
  const irPara = (tela) => controlador.irParaTelaProtegida(tela);

  useEffect(() => {
    lerOpcoesPainel().then((o) => {
      setOpcoes(o);
      const atual = obterEstadoModulos()?.moduloAtual;
      const modulo = (o.modulos.find((m) => m.chave === atual) || o.modulos[0] || {}).chave || '';
      const painel = String((o.paineis.find((p) => p.modulo === modulo) || {}).id_painel || '');
      const inicial = { modulo, painel, periodo: 'mes', equipe: '' };
      setRascunho(inicial);
      if (painel) setAplicado(inicial);
    }).catch((e) => setErro(e?.message || 'Não foi possível abrir o Painel.'));
  }, []);

  const carregar = (alvo, silencioso = false) => {
    if (!alvo?.painel) return;
    if (!silencioso) { setCarregando(true); setErroDados(''); }
    lerDadosPainel(alvo.painel, alvo.periodo, alvo.equipe)
      .then((d) => { setDados(d); setErroDados(''); })
      .catch((e) => { if (!silencioso) setErroDados(e?.message || 'Não foi possível carregar o painel.'); })
      .finally(() => setCarregando(false));
  };
  useEffect(() => { carregar(aplicado); }, [aplicado]);
  // Atualiza sozinho no intervalo que a Tecnologia escolheu, sem piscar a tela.
  useEffect(() => {
    if (!aplicado?.painel || !dados?.painel?.intervalo_seg) return undefined;
    const id = window.setInterval(() => { if (!document.hidden) carregar(aplicado, true); }, dados.painel.intervalo_seg * 1000);
    return () => window.clearInterval(id);
  }, [aplicado, dados?.painel?.intervalo_seg]);

  const paineisDoModulo = useMemo(() => (opcoes?.paineis || []).filter((p) => p.modulo === rascunho.modulo), [opcoes, rascunho.modulo]);
  const equipes = dados && String(dados.painel.id_painel) === String(rascunho.painel) ? dados.equipes : [];
  const pendente = aplicado && (rascunho.painel !== aplicado.painel || rascunho.periodo !== aplicado.periodo || rascunho.equipe !== aplicado.equipe);
  const mudar = (campo, valor) => setRascunho((r) => {
    const novo = { ...r, [campo]: valor };
    if (campo === 'modulo') { novo.painel = String((opcoes.paineis.find((p) => p.modulo === valor) || {}).id_painel || ''); novo.equipe = ''; }
    if (campo === 'painel') novo.equipe = '';
    return novo;
  });

  const blocos = [];
  if (dados) {
    let meias = [];
    const fechar = () => { if (meias.length) { blocos.push(html`<div key=${`g${blocos.length}`} class="c-colunas c-pg-grade">${meias}</div>`); meias = []; } };
    dados.blocos.forEach((b) => {
      const props = { key: b.metrica, d: b.dados, forma: b.forma, irPara };
      const el = b.metrica === 'presenca' ? html`<${BlocoPresenca} ...${props} />`
        : b.metrica === 'frequencia' ? html`<${BlocoFrequencia} ...${props} />`
          : b.metrica === 'monitorias' ? html`<${BlocoMonitorias} ...${props} />`
            : b.metrica === 'diario' ? html`<${BlocoDiario} ...${props} />`
              : b.metrica === 'escalas' ? html`<${BlocoEscalas} ...${props} />`
                : b.metrica === 'operadores' ? html`<${BlocoOperadores} ...${props} abrirFicha=${setFicha} selecionado=${ficha?.id_operador} />`
                  : b.metrica === 'rh_entrevistas' ? html`<${BlocoEntrevistas} ...${props} />` : null;
      if (!el) return;
      if (b.largura === 'meia') meias.push(el); else { fechar(); blocos.push(el); }
    });
    fechar();
  }

  let corpo;
  if (erro) corpo = html`<div class="c-tabela-caixa"><${Estado} titulo=${erro} /></div>`;
  else if (!opcoes) corpo = html`<div class="c-tabela-caixa"><${Esqueleto} linhas=${6} /></div>`;
  else if (!opcoes.paineis.length) {
    corpo = html`<div class="c-pagina-cab"><div class="c-titulo"><h1>Painel</h1></div></div>
      <div class="c-tabela-caixa"><${Estado} icone="chart-bar" titulo="Nenhum painel liberado para você" texto="Quem monta os painéis é a Tecnologia, em Configurações › Painéis. Peça para criar o painel da sua operação e marcar o seu perfil." /></div>`;
  } else {
    const p = dados?.painel;
    corpo = html`
      <div class="c-pagina-cab"><div class="c-titulo">
        <h1>${p ? `Painel · ${p.modulo_nome} · ${p.operacao_nome}` : 'Painel'}</h1>
        <p>${dados ? `${p.operacao_nome} · ${ddmm(dados.periodo.ini)}${dados.periodo.ini !== dados.periodo.fim ? ` a ${ddmm(dados.periodo.fim)}` : ''} · ${dados.equipe || 'Todas as equipes'}` : 'Carregando…'}</p>
      </div></div>
      <form class="c-filtros c-pg-filtros" aria-label="Filtros do painel" onSubmit=${(e) => { e.preventDefault(); setAplicado({ ...rascunho }); }}>
        <select class="c-entrada" aria-label="Módulo" value=${rascunho.modulo} onChange=${(e) => mudar('modulo', e.target.value)}>
          ${opcoes.modulos.map((m) => html`<option key=${m.chave} value=${m.chave}>${m.nome}</option>`)}
        </select>
        <select class="c-entrada" aria-label="Operação" value=${rascunho.painel} onChange=${(e) => mudar('painel', e.target.value)}>
          ${paineisDoModulo.map((x) => html`<option key=${x.id_painel} value=${String(x.id_painel)}>${x.operacao_nome}</option>`)}
        </select>
        <select class="c-entrada" aria-label="Período" value=${rascunho.periodo} onChange=${(e) => mudar('periodo', e.target.value)}>
          ${opcoes.periodos.map((x) => html`<option key=${x.chave} value=${x.chave}>${x.nome}</option>`)}
        </select>
        <select class="c-entrada" aria-label="Equipe" value=${rascunho.equipe} disabled=${!equipes.length || null} onChange=${(e) => mudar('equipe', e.target.value)}>
          <option value="">Todas as equipes</option>
          ${equipes.map((x) => html`<option key=${x} value=${x}>${x}</option>`)}
        </select>
        <button type="submit" class=${`c-botao c-botao--principal${pendente ? ' c-pg-pendente' : ''}`} disabled=${!rascunho.painel || null}><${Ic} nome="funnel" />Aplicar filtros</button>
        ${dados ? html`<span class="c-pg-atual"><span class="c-pg-ponto" aria-hidden="true"></span>Atualizado às ${hhmm(dados.gerado_em)} · atualiza a cada ${dados.painel.intervalo_seg >= 60 ? `${dados.painel.intervalo_seg / 60} min` : `${dados.painel.intervalo_seg} s`}</span>` : null}
      </form>
      ${erroDados ? html`<div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${erroDados}</p></div></div>` : null}
      ${carregando && !dados ? html`<div class="c-tabela-caixa"><${Esqueleto} linhas=${8} /></div>` : null}
      ${dados && !dados.blocos.length ? html`<div class="c-tabela-caixa"><${Estado} titulo="Nenhuma métrica deste painel está liberada para o seu perfil." texto="Cada métrica pede também o acesso ao módulo de origem (Turnos e Plantões, Monitoria, Diário de bordo)." /></div>` : null}
      <div class=${`c-pg-pilha${carregando ? ' c-pg-carregando' : ''}`} aria-busy=${carregando ? 'true' : 'false'}>${blocos}</div>`;
  }

  return html`<${PainelRh} screenId="screen-painel" navAtiva="screen-painel" subtituloMarca="Painel" placeholderBusca="Painel" controlador=${controlador}>
    <main class="c-pagina c-conteudo c-pg">${corpo}</main>
    ${ficha && dados ? html`<${Ficha} painel=${dados.painel} operador=${ficha} periodo=${aplicado.periodo} aoFechar=${() => setFicha(null)} irPara=${irPara} />` : null}
  </${PainelRh}>`;
}
