import { html, useEffect, useState } from '../../infraestrutura-react.js?v=20261124-equipes';
import { PainelRh } from '../../ui/componentes-compartilhados.js?v=20261124-equipes';
import { IconeSvg } from '../../ui/icone.js?v=20261124-equipes';
import { Esqueleto, Estado, Ic, Segmento, Selo } from '../../ui/components/ds.js?v=20261124-equipes';
import { lerResumoHojeDiario } from '../../services/api/diario.js?v=20261124-equipes';
import { pedirDiaDiario, pendenciasDiario } from '../../modulos/operacao/diario/ligacoes.js?v=20261124-equipes';
import { aprovacoesPendentesWfm, lerContextoWfm, listarTrocasWfm, pendenciasPresencaWfm } from '../../services/api/wfm.js?v=20261124-equipes';
import {
  EixoHoras, agoraNoDia, agruparPorTurno, carregarDia, faixa, iniciais, montarLinhas, paraIso, pctEixo, resumoGrupo, rotuloDiaMes,
} from '../../modulos/operacao/wfm/painel-dia.js?v=20261124-equipes';
import { pedirFocoPessoa } from '../../modulos/operacao/wfm/foco-pessoa.js?v=20261124-equipes';
import { useInicioDoModulo } from '../../shared/tela-inicial.js?v=20261124-equipes';

// Início da Operação (reestruturação, Etapa 8 — amostra aprovada em 17/11/2026). Vale para todos os perfis no módulo
// Operação, menos o Operador (que tem o Início próprio, "Seu dia"). Mesmo desenho do Início do Supervisor (08/11/2026):
// atalhos, "Escala de hoje" (1 linha por turno) e "Precisa de você". Quem vê mais de uma operação ganha o seletor
// Todas · CRF · Brava (em Todas só a 1ª operação vem aberta), a coluna Operação e o cartão "Suas operações".
// Os blocos que aparecem e a ordem vêm de Configurações › Início dos módulos. Só leitura; o escopo é o do servidor.

const DIAS_LONGOS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const TODAS = '__todas__';
const CHAVE_ESCOLHA = 'conecta.inicioOperacao.escolha';
const pad = (n) => String(n).padStart(2, '0');
const saudacao = (d) => (d.getHours() < 12 ? 'Bom dia' : d.getHours() < 18 ? 'Boa tarde' : 'Boa noite');
const segundaDaSemana = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return paraIso(x); };
const prazoCurto = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const lerEscolha = () => { try { return window.localStorage.getItem(CHAVE_ESCOLHA) || TODAS; } catch { return TODAS; } };
const gravarEscolha = (v) => { try { window.localStorage.setItem(CHAVE_ESCOLHA, v); } catch { /* sem storage */ } };

// Atalhos do módulo Operação (mesmos destinos das sessões; Diário de bordo tem tela própria).
function atalhosOperacao(controlador, sessoes, ocultos) {
  const daSessao = (id, titulo) => {
    const s = sessoes.find((x) => x.id === id);
    return s ? { id, titulo, icone: s.icone, desc: s.desc, destino: s.destino } : null;
  };
  const diario = controlador.podeAcessarTela('screen-diario')
    ? { id: 'diario', titulo: 'Diário de bordo', icone: 'menu_book', desc: 'Registro do turno e intercorrências.', destino: 'screen-diario' } : null;
  return [daSessao('monitoria', 'Monitoria'), daSessao('wfm', 'Turnos e Plantões'), diario, daSessao('equipe', 'Equipes')]
    .filter((a) => a && !ocultos.has(a.id));
}

// Escala de hoje de cada operação (uma leitura por operação, a cada minuto).
function useDias(operacoes) {
  const [estado, setEstado] = useState({ dias: {}, erros: {}, em: new Date() });
  const chaves = operacoes.map((o) => o.chave).join('|');
  useEffect(() => {
    if (!operacoes.length) return undefined;
    let ativo = true;
    const ler = async () => {
      const hoje = paraIso(new Date());
      const res = await Promise.all(operacoes.map((o) => carregarDia(o.chave, hoje, true).then((b) => [o.chave, b, ''], (e) => [o.chave, null, e?.message || 'Não foi possível ler a escala de hoje.'])));
      if (!ativo) return;
      setEstado((s) => {
        const dias = { ...s.dias };
        const erros = {};
        res.forEach(([c, b, e]) => { if (b) dias[c] = b; else if (!dias[c]) erros[c] = e; });
        return { dias, erros, em: new Date() };
      });
    };
    ler();
    const t = setInterval(ler, 60000);
    return () => { ativo = false; clearInterval(t); };
  }, [chaves]);
  const hoje = paraIso(estado.em);
  const agora = agoraNoDia(hoje, estado.em);
  const grupos = {};
  Object.entries(estado.dias).forEach(([c, bruto]) => { grupos[c] = agruparPorTurno(montarLinhas(bruto, hoje, agora)); });
  return { grupos, erros: estado.erros, em: estado.em, hoje, agora };
}

const somar = (gs, campo) => gs.reduce((a, g) => a + (campo === 'linhas' ? g.linhas.length : g[campo]), 0);

function LinhaTurno({ g, agora, abrir }) {
  const pessoas = g.linhas.slice(0, 3);
  const mais = g.linhas.length - pessoas.length;
  return html`<a class="c-hoje-linha" href="#" title=${`Abrir o Painel só com ${g.nome}`} onClick=${(ev) => { ev.preventDefault(); abrir(g.id); }}>
    <span class="c-hoje-turno"><span class="c-traco" style=${{ background: g.cor }}></span><b>${g.nome}</b><small>${g.entrada}–${g.saida}</small></span>
    <span class="c-hoje-trilho">
      <span class=${`c-hoje-barra ${g.comecou ? '' : 'c-hoje-barra--depois'}`.trim()} style=${{ '--t': g.cor, ...faixa(g.ini, g.fim) }}>
        <span class="c-hoje-pessoas">${pessoas.map((l) => html`<span key=${l.id} class="c-hoje-av" title=${l.nome}>${iniciais(l.nome)}</span>`)}${mais > 0 ? html`<span class="c-hoje-av c-hoje-av--mais">+${mais}</span>` : null}</span>
        <span class="c-hoje-txt">${resumoGrupo(g)}</span>
        ${g.naoLogaram ? html`<span class="c-hoje-alerta"><${Ic} nome="warning-octagon" />${g.naoLogaram} não logou</span>` : null}
      </span>
      ${agora >= 360 && agora <= 1470 ? html`<span class="c-pd-agora" style=${{ left: `${pctEixo(agora).toFixed(2)}%` }}></span>` : null}
    </span>
  </a>`;
}

function EscalaDeHoje({ controlador, operacoes, escolha, aoEscolher, dias }) {
  // Em "Todas", só a 1ª operação vem aberta; as outras vêm dobradas e abrem com um clique.
  const [abertas, setAbertas] = useState(() => new Set(operacoes[0] ? [operacoes[0].chave] : []));
  const varias = operacoes.length > 1;
  const visiveis = escolha === TODAS ? operacoes : operacoes.filter((o) => o.chave === escolha);
  const abrirPainel = (idTurno = '') => {
    if (idTurno) pedirFocoPessoa('painel-turno', String(idTurno));
    controlador.irParaTelaProtegida('screen-wfm-dia');
  };
  const alternar = (chave) => setAbertas((atual) => { const n = new Set(atual); if (n.has(chave)) n.delete(chave); else n.add(chave); return n; });
  const carregadas = visiveis.filter((o) => dias.grupos[o.chave]);
  const total = carregadas.reduce((a, o) => a + somar(dias.grupos[o.chave], 'linhas'), 0);
  const erro = visiveis.map((o) => dias.erros[o.chave]).find(Boolean);
  const agoraTxt = `${pad(dias.em.getHours())}:${pad(dias.em.getMinutes())}`;
  const sub = `${rotuloDiaMes(dias.hoje)}${carregadas.length ? ` · ${plural(total, 'escalado', 'escalados')}${escolha === TODAS && varias ? ` em ${operacoes.length} operações` : ''}` : ''} · agora ${agoraTxt}`;
  const turnos = (gs) => gs.map((g) => html`<${LinhaTurno} key=${g.id} g=${g} agora=${dias.agora} abrir=${abrirPainel} />`);

  let corpo;
  if (!carregadas.length) corpo = erro ? html`<${Estado} titulo=${erro} />` : html`<div class="c-cartao-corpo"><${Esqueleto} linhas=${3} /></div>`;
  else if (!total) corpo = html`<${Estado} icone="calendar-blank" titulo="Ninguém escalado para trabalhar hoje." />`;
  else {
    corpo = html`<div class="c-hoje-grade">
      <div class="c-hoje-cab"><span>Turno</span><${EixoHoras} /></div>
      ${escolha === TODAS && varias ? carregadas.map((o) => {
        const gs = dias.grupos[o.chave];
        const aberta = abertas.has(o.chave);
        const logados = somar(gs.filter((g) => g.comecou && g.comLogin), 'logados');
        const resumo = `${plural(gs.length, 'turno', 'turnos')} · ${plural(somar(gs, 'linhas'), 'escalado', 'escalados')}${aberta ? '' : ` · ${logados} logados agora`}`;
        return html`<button key=${`op-${o.chave}`} type="button" class="c-hoje-op" aria-expanded=${aberta ? 'true' : 'false'} onClick=${() => alternar(o.chave)}>
            <${Ic} nome=${aberta ? 'caret-down' : 'caret-right'} /><b>${o.nome}</b><span class="c-secundario">${resumo}</span>
          </button>${aberta ? turnos(gs) : null}`;
      }) : turnos(dias.grupos[carregadas[0].chave])}
    </div>`;
  }
  return html`<section class="c-cartao c-hoje" aria-labelledby="c-hoje-titulo">
    <div class="c-cartao-cab"><h2 id="c-hoje-titulo">Escala de hoje</h2>
      <span class="c-secundario c-hoje-sub">${sub}</span>
      ${varias ? html`<span class="c-fim"><${Segmento} rotulo="Operação" opcoes=${[[TODAS, 'Todas'], ...operacoes.map((o) => [o.chave, o.nome])]} valor=${escolha} aoMudar=${aoEscolher} /></span>` : null}
    </div>
    ${corpo}
  </section>`;
}

// Pendências de cada operação (mesmas rotas do WFM, do Diário e da Monitoria, com o escopo do servidor).
function usePendencias(controlador, chaves, alertasMonitoria, destinoMonitoria) {
  const [itens, setItens] = useState(null);
  const chave = chaves.join('|');
  useEffect(() => {
    let ativo = true;
    (async () => {
      const hoje = new Date();
      const lista = [];
      if (controlador.possuiPermissao('diario.preencher')) {
        const r = await lerResumoHojeDiario().catch(() => ({ itens: [] }));
        pendenciasDiario(r.itens, controlador).forEach((p) => lista.push({
          id: p.chave, op: p.operacao || '', icone: 'notebook', texto: p.titulo, qtd: p.qtd, prazo: p.prazo.startsWith('Turno acaba') ? `${p.data}T${p.prazo.slice(-5)}:00` : null,
          onde: 'Diário de bordo › Hoje', tela: 'screen-diario', antes: () => pedirDiaDiario(p.operacao, p.data),
        }));
      }
      if (controlador.possuiPermissao('wfm.escala.aprovar')) {
        const r = await aprovacoesPendentesWfm().catch(() => ({ itens: [] }));
        const porOp = {};
        (r.itens || []).forEach((i) => { porOp[i.chave] = (porOp[i.chave] || 0) + 1; });
        Object.entries(porOp).forEach(([op, n]) => lista.push({ id: `aprovar-${op}`, op, icone: 'calendar-dots', texto: 'Escalas para aprovar', qtd: n, prazo: null, onde: 'Turnos e Plantões › Escalas', tela: 'screen-wfm' }));
      }
      if (controlador.possuiPermissao('wfm.troca.visualizar') && chaves.length) {
        const porOp = await Promise.all(chaves.map((c) => listarTrocasWfm(c).then((r) => [c, (r.itens || []).filter((t) => t.pode_responder || t.pode_decidir)], () => [c, []])));
        porOp.filter(([, ts]) => ts.length).forEach(([op, ts]) => {
          const prazos = ts.map((t) => (t.estado === 'AGUARDANDO_APROVACAO' ? t.prazo_decisao : t.prazo_resposta)).filter(Boolean).sort();
          lista.push({ id: `trocas-${op}`, op, icone: 'arrows-left-right', texto: 'Trocas aguardando você', qtd: ts.length, prazo: prazos[0] || null, onde: 'Turnos e Plantões › Trocas', tela: 'screen-wfm-trocas' });
        });
      }
      if (controlador.possuiPermissao('wfm.presenca.lancar') && chaves.length) {
        const porOp = await Promise.all(chaves.map((c) => pendenciasPresencaWfm(c, segundaDaSemana(hoje), paraIso(hoje)).then((r) => [c, Number(r.total) || 0], () => [c, 0])));
        porOp.filter(([, n]) => n).forEach(([op, n]) => lista.push({ id: `presenca-${op}`, op, icone: 'user-check', texto: 'Presença sem lançamento', qtd: n, prazo: null, onde: 'Turnos e Plantões › Presença', tela: 'screen-wfm-presenca' }));
      }
      if (ativo) setItens(lista);
    })();
    return () => { ativo = false; };
  }, [chave]);
  if (!itens) return null;
  return alertasMonitoria > 0 && destinoMonitoria
    ? [...itens, { id: 'monitoria', op: '', icone: 'clipboard-text', texto: 'Novidades em monitorias', qtd: alertasMonitoria, prazo: null, onde: 'Monitoria', tela: destinoMonitoria }]
    : itens;
}

function PrecisaDeVoce({ pendencias, comOperacao, nomeOp, irPara, hoje }) {
  const vencemHoje = (pendencias || []).filter((p) => p.prazo && paraIso(new Date(p.prazo)) === hoje).length;
  return html`<section class="c-cartao" aria-labelledby="c-precisa-titulo">
    <div class="c-cartao-cab"><h2 id="c-precisa-titulo">Precisa de você</h2>${vencemHoje ? html`<${Selo} tom="perigo" icone="warning-octagon">${vencemHoje} ${vencemHoje === 1 ? 'vence hoje' : 'vencem hoje'}<//>` : null}</div>
    ${pendencias === null ? html`<div class="c-cartao-corpo"><${Esqueleto} linhas=${3} /></div>`
    : !pendencias.length ? html`<${Estado} icone="check-circle" titulo="Nada pendente agora." />`
      : html`<div class="c-tabela-caixa"><table class=${`c-tabela c-tabela--junta c-hoje-pend ${comOperacao ? 'c-hoje-pend--op' : ''}`.trim()}>
        <thead><tr><th scope="col" class=${comOperacao ? '' : 'c-estica'}>Pendência</th>${comOperacao ? html`<th scope="col">Operação</th>` : null}<th scope="col" class="c-num">Qtd.</th><th scope="col">Prazo</th><th scope="col" class="c-acoes"><span class="c-oculto">Ação</span></th></tr></thead>
        <tbody>${pendencias.map((p) => html`<tr key=${p.id} class="c-clicavel" title=${p.onde} onClick=${() => { p.antes?.(); irPara(p.tela); }}>
          <td class=${comOperacao ? '' : 'c-estica'}><span style=${{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}><${Ic} nome=${p.icone} />${p.texto}</span></td>
          ${comOperacao ? html`<td>${p.op ? nomeOp(p.op) : html`<span class="c-secundario">—</span>`}</td>` : null}
          <td class="c-num c-forte">${p.qtd}</td>
          <td class=${p.prazo ? '' : 'c-secundario'}>${p.prazo ? prazoCurto(p.prazo) : 'Sem prazo'}</td>
          <td class="c-acoes"><button type="button" class="c-botao c-botao--secundario c-botao--compacto" aria-label=${`Ver: ${p.texto} (${p.onde})`} onClick=${(ev) => { ev.stopPropagation(); p.antes?.(); irPara(p.tela); }}>Ver</button></td>
        </tr>`)}</tbody></table></div>`}
  </section>`;
}

function SuasOperacoes({ operacoes, dias, pendencias, aoEscolher }) {
  return html`<section class="c-cartao" aria-labelledby="c-ops-titulo">
    <div class="c-cartao-cab"><h2 id="c-ops-titulo">Suas operações</h2><${Selo} tom="neutro">${operacoes.length}<//></div>
    <div class="c-tabela-caixa"><table class="c-tabela c-tabela--junta c-hoje-pend c-hoje-pend--op">
      <thead><tr><th scope="col">Operação</th><th scope="col">Agora</th><th scope="col" class="c-num">Não logou</th><th scope="col" class="c-num">Pendências</th></tr></thead>
      <tbody>${operacoes.map((o) => {
        const gs = dias.grupos[o.chave];
        const emCurso = (gs || []).filter((g) => g.comecou);
        const naoLogou = gs ? somar(gs, 'naoLogaram') : null;
        const pend = (pendencias || []).filter((p) => p.op === o.chave).reduce((a, p) => a + (Number(p.qtd) || 0), 0);
        return html`<tr key=${o.chave} class="c-clicavel" title=${`Ver só ${o.nome}`} onClick=${() => aoEscolher(o.chave)}>
          <td class="c-forte">${o.nome}</td>
          <td>${!gs ? '—' : emCurso.length && emCurso.every((g) => g.comLogin) ? html`${somar(emCurso, 'logados')} de ${somar(emCurso, 'esperados')} <span class="c-secundario">logados</span>` : html`<span class="c-secundario">${plural(somar(gs, 'linhas'), 'escalado', 'escalados')}</span>`}</td>
          <td class="c-num">${naoLogou ? html`<${Selo} tom="perigo">${naoLogou}<//>` : html`<span class="c-secundario">${naoLogou === null ? '—' : 0}</span>`}</td>
          <td class="c-num c-forte">${pendencias === null ? '—' : pend}</td>
        </tr>`;
      })}</tbody></table></div>
  </section>`;
}

export function TelaInicioOperacao({ controlador, sessoes, alertasMonitoria = 0, trocasPendentes = 0, atalhosOcultos = new Set() }) {
  const estado = controlador.estado;
  const nome = estado.nomeUsuarioAutenticado || estado.usuarioAutenticado || '';
  const agora = new Date();
  const config = useInicioDoModulo('operacao');
  const [operacoes, setOperacoes] = useState(null);
  const [todasChaves, setTodasChaves] = useState([]);
  const [escolha, setEscolha] = useState(lerEscolha);
  const temWfm = controlador.podeAcessarTela('screen-wfm-dia');
  useEffect(() => {
    let ativo = true;
    lerContextoWfm().then((ctx) => {
      if (!ativo) return;
      const ativas = (ctx?.operacoes || []).filter((o) => o.escala_ativa !== false);
      setTodasChaves(ativas.map((o) => o.chave));
      setOperacoes(ativas.filter((o) => !o.tipo_escala).map((o) => ({ chave: o.chave, nome: o.nome || o.chave })));
    }, () => { if (ativo) setOperacoes([]); });
    return () => { ativo = false; };
  }, []);
  const lista = operacoes || [];
  const varias = lista.length > 1;
  const escolhaValida = escolha === TODAS || lista.some((o) => o.chave === escolha) ? escolha : TODAS;
  const escolher = (v) => { setEscolha(v); gravarEscolha(v); };
  const dias = useDias(temWfm ? lista : []);
  const destinoMonitoria = sessoes.find((s) => s.id === 'monitoria')?.destino || null;
  const pendencias = usePendencias(controlador, todasChaves, alertasMonitoria, destinoMonitoria);
  const nomes = Object.fromEntries(lista.map((o) => [o.chave, o.nome]));
  const nomeOp = (c) => nomes[c] || c;
  // Escolhida uma operação, "Precisa de você" mostra só as pendências dela (e as que não são de nenhuma operação).
  const pendVisiveis = pendencias && escolhaValida !== TODAS ? pendencias.filter((p) => !p.op || p.op === escolhaValida) : pendencias;
  const irPara = (tela) => controlador.irParaTelaProtegida(tela);
  const ocultos = new Set([...atalhosOcultos, ...(config?.atalhosOcultos || [])]);
  const atalhos = atalhosOperacao(controlador, sessoes, ocultos);
  const blocos = config?.blocos || [];

  const pedacos = {
    atalhos: () => (atalhos.length ? html`<section key="atalhos"><h2 class="c-rotulo c-oculto">Atalhos</h2><nav class="c-atalhos" aria-label="Atalhos">
      ${atalhos.map((s) => html`<a key=${s.id} class="c-atalho" href="#" onClick=${(ev) => { ev.preventDefault(); irPara(s.destino); }}
        title=${s.desc}><span class="c-ic" aria-hidden="true">${IconeSvg(s.icone)}</span>${s.titulo}
        ${(() => { const n = s.id === 'monitoria' ? alertasMonitoria : s.id === 'wfm' ? trocasPendentes : 0; return n > 0 ? html`<span class="c-conta c-atalho-conta" aria-label=${`${n} pendente(s)`}>${n}</span>` : null; })()}</a>`)}
    </nav></section>` : null),
    escala_hoje: () => {
      if (!temWfm) return null;
      if (operacoes === null) return html`<section key="escala" class="c-cartao"><div class="c-cartao-corpo"><${Esqueleto} linhas=${3} /></div></section>`;
      return lista.length ? html`<${EscalaDeHoje} key="escala" controlador=${controlador} operacoes=${lista} escolha=${escolhaValida} aoEscolher=${escolher} dias=${dias} />` : null;
    },
  };
  // "Precisa de você" e "Suas operações" ficam lado a lado, no lugar do primeiro dos dois na ordem configurada.
  const mostraPrecisa = blocos.includes('precisa_de_voce');
  const mostraOps = blocos.includes('suas_operacoes') && varias;
  const dupla = (mostraPrecisa || mostraOps) ? html`<div key="dupla" class=${`c-hoje-dupla ${mostraPrecisa && mostraOps ? '' : 'c-hoje-dupla--so'}`.trim()}>
    ${mostraPrecisa ? html`<${PrecisaDeVoce} pendencias=${pendVisiveis} comOperacao=${varias} nomeOp=${nomeOp} irPara=${irPara} hoje=${paraIso(agora)} />` : null}
    ${mostraOps ? html`<${SuasOperacoes} operacoes=${lista} dias=${dias} pendencias=${pendencias} aoEscolher=${escolher} />` : null}
  </div>` : null;
  let duplaPosta = false;
  const corpo = blocos.map((id) => {
    if (id === 'precisa_de_voce' || id === 'suas_operacoes') {
      if (duplaPosta) return null;
      duplaPosta = true;
      return dupla;
    }
    return pedacos[id]?.() || null;
  });

  return html`
    <${PainelRh} screenId="screen-menu" navAtiva="screen-menu" subtituloMarca="Início" placeholderBusca="Conecta" controlador=${controlador}>
      <main class="c-pagina c-conteudo">
        <div class="c-pagina-cab"><div class="c-titulo"><h1>${saudacao(agora)}, ${(nome || '').split(' ')[0] || 'bem-vindo(a)'}</h1>
          <p>${estado.perfilUsuarioNome || ''} · ${DIAS_LONGOS[agora.getDay()]}, ${agora.getDate()} de ${MESES[agora.getMonth()]}</p></div></div>
        ${config === null ? html`<section class="c-cartao"><div class="c-cartao-corpo"><${Esqueleto} linhas=${4} /></div></section>`
    : corpo.some(Boolean) ? corpo : html`<${Estado} icone="squares-four" titulo="Nada para mostrar no Início. Os blocos são escolhidos em Configurações › Início dos módulos." />`}
      </main>
    </${PainelRh}>`;
}
