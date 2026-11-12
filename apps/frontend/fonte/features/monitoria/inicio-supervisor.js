import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { PainelRh } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import { Esqueleto, Estado, Ic, Selo } from '../../ui/components/ds.js?v=20261106-wfm';
import { lerResumoHojeDiario } from '../../services/api/diario.js';
import { pedirDiaDiario, pendenciasDiario } from '../../modulos/operacao/diario/ligacoes.js';
import { aprovacoesPendentesWfm, lerContextoWfm, listarTrocasWfm, pendenciasPresencaWfm } from '../../services/api/wfm.js?v=20261112-exporta-filtro';
import { listarMural } from '../../services/api/mural.js';
import { API_MURAL_EQUIPE } from '../../services/api/equipes.js';
import {
  EixoHoras, agoraNoDia, agruparPorTurno, carregarDia, faixa, iniciais, montarLinhas, paraIso, pctEixo, resumoGrupo, rotuloDiaMes,
} from '../../modulos/operacao/wfm/painel-dia.js?v=20261112-exporta-filtro';
import { pedirFocoPessoa } from '../../modulos/operacao/wfm/foco-pessoa.js';

// Início do Supervisor (amostra "Painel do dia", aprovada em 08/11/2026): atalhos para as sessões, "Escala de hoje"
// (um calendário do dia, 1 linha por turno) e, lado a lado, "Precisa de você" e "Mural". Só leitura; os números vêm
// das mesmas rotas do WFM, da Monitoria e do Mural, com o escopo do servidor.

const DIAS_LONGOS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const pad = (n) => String(n).padStart(2, '0');
const saudacao = (d) => (d.getHours() < 12 ? 'Bom dia' : d.getHours() < 18 ? 'Boa tarde' : 'Boa noite');
const segundaDaSemana = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return paraIso(x); };
const quando = (iso, agora) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dia = paraIso(d);
  if (dia === paraIso(agora)) return `hoje ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const ontem = new Date(agora); ontem.setDate(ontem.getDate() - 1);
  if (dia === paraIso(ontem)) return 'ontem';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
};
const prazoCurto = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function EscalaDeHoje({ controlador, operacao }) {
  const [estado, setEstado] = useState({ bruto: null, erro: '', em: new Date() });
  const hoje = paraIso(estado.em);
  useEffect(() => {
    if (!operacao) return undefined;
    let ativo = true;
    const ler = () => carregarDia(operacao, paraIso(new Date()), true)
      .then((bruto) => { if (ativo) setEstado({ bruto, erro: '', em: new Date() }); })
      .catch((e) => { if (ativo) setEstado((s) => ({ ...s, erro: s.bruto ? '' : (e?.message || 'Não foi possível ler a escala de hoje.') })); });
    ler();
    const t = setInterval(ler, 60000);
    return () => { ativo = false; clearInterval(t); };
  }, [operacao]);

  const abrirPainel = (idTurno = '') => {
    if (idTurno) pedirFocoPessoa('painel-turno', String(idTurno));
    controlador.irParaTelaProtegida('screen-wfm-dia');
  };
  const agora = agoraNoDia(hoje, estado.em);
  const linhas = estado.bruto ? montarLinhas(estado.bruto, hoje, agora) : [];
  const grupos = agruparPorTurno(linhas);
  const agoraTxt = `${pad(estado.em.getHours())}:${pad(estado.em.getMinutes())}`;
  return html`<section class="c-cartao c-hoje" aria-labelledby="c-hoje-titulo">
    <div class="c-cartao-cab"><h2 id="c-hoje-titulo">Escala de hoje</h2>
      <span class="c-secundario c-hoje-sub">${rotuloDiaMes(hoje)}${estado.bruto ? ` · ${linhas.length} ${linhas.length === 1 ? 'escalado' : 'escalados'}` : ''} · agora ${agoraTxt}</span>
      <a class="c-botao c-botao--secundario c-botao--compacto c-fim" href="#" onClick=${(ev) => { ev.preventDefault(); abrirPainel(); }}><${Ic} nome="eye" />Visualizar</a>
    </div>
    ${estado.erro ? html`<${Estado} titulo=${estado.erro} />`
      : !estado.bruto ? html`<div class="c-cartao-corpo"><${Esqueleto} linhas=${3} /></div>`
        : !grupos.length ? html`<${Estado} icone="calendar-blank" titulo="Ninguém escalado para trabalhar hoje." />`
          : html`<div class="c-hoje-grade">
        <div class="c-hoje-cab"><span>Turno</span><${EixoHoras} /></div>
        ${grupos.map((g) => {
    const pessoas = g.linhas.slice(0, 3);
    const mais = g.linhas.length - pessoas.length;
    return html`<a key=${g.id} class="c-hoje-linha" href="#" title=${`Abrir o Painel só com ${g.nome}`} onClick=${(ev) => { ev.preventDefault(); abrirPainel(g.id); }}>
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
  })}
      </div>`}
  </section>`;
}

function usePendencias(controlador, operacoes, alertasMonitoria, destinoMonitoria) {
  const [itens, setItens] = useState(null);
  const chaves = operacoes.join('|');
  useEffect(() => {
    let ativo = true;
    (async () => {
      const hoje = new Date();
      const lista = [];
      // Diário de bordo (08/11/2026): o turno da hora atual (ou um anterior) ainda sem concluir.
      if (controlador.possuiPermissao('diario.preencher')) {
        const r = await lerResumoHojeDiario().catch(() => ({ itens: [] }));
        pendenciasDiario(r.itens, controlador).forEach((p) => lista.push({
          id: p.chave, icone: 'notebook', texto: p.titulo, qtd: p.qtd, prazo: p.prazo.startsWith('Turno acaba') ? `${p.data}T${p.prazo.slice(-5)}:00` : null,
          onde: 'Diário de bordo › Hoje', tela: 'screen-diario', antes: () => pedirDiaDiario(p.operacao, p.data),
        }));
      }
      if (controlador.possuiPermissao('wfm.troca.visualizar') && operacoes.length) {
        const trocas = (await Promise.all(operacoes.map((c) => listarTrocasWfm(c).then((r) => r.itens || [], () => [])))).flat().filter((t) => t.pode_responder || t.pode_decidir);
        if (trocas.length) {
          const prazos = trocas.map((t) => (t.estado === 'AGUARDANDO_APROVACAO' ? t.prazo_decisao : t.prazo_resposta)).filter(Boolean).sort();
          lista.push({ id: 'trocas', icone: 'arrows-left-right', texto: 'Trocas aguardando você', qtd: trocas.length, prazo: prazos[0] || null, onde: 'Turnos e Plantões › Trocas', tela: 'screen-wfm-trocas' });
        }
      }
      if (controlador.possuiPermissao('wfm.presenca.lancar') && operacoes.length) {
        const pend = await Promise.all(operacoes.map((c) => pendenciasPresencaWfm(c, segundaDaSemana(hoje), paraIso(hoje)).then((r) => Number(r.total) || 0, () => 0)));
        const total = pend.reduce((a, n) => a + n, 0);
        if (total) lista.push({ id: 'presenca', icone: 'user-check', texto: 'Presença sem lançamento nesta semana', qtd: total, prazo: null, onde: 'Turnos e Plantões › Presença', tela: 'screen-wfm-presenca' });
      }
      if (controlador.possuiPermissao('wfm.escala.aprovar')) {
        const r = await aprovacoesPendentesWfm().catch(() => ({ itens: [] }));
        const n = (r.itens || []).length;
        if (n) lista.push({ id: 'aprovar', icone: 'calendar-dots', texto: 'Escalas para aprovar', qtd: n, prazo: null, onde: 'Turnos e Plantões › Escalas', tela: 'screen-wfm' });
      }
      if (ativo) setItens(lista);
    })();
    return () => { ativo = false; };
  }, [chaves]);
  if (!itens) return null;
  return alertasMonitoria > 0 && destinoMonitoria
    ? [...itens, { id: 'monitoria', icone: 'clipboard-text', texto: 'Novidades em monitorias', qtd: alertasMonitoria, prazo: null, onde: 'Monitoria', tela: destinoMonitoria }]
    : itens;
}

function useMural(controlador) {
  const fonte = controlador.possuiPermissao('mural.visualizar') ? listarMural : controlador.possuiPermissao('equipes.mural.publicar') ? API_MURAL_EQUIPE.listar : null;
  const [itens, setItens] = useState(fonte ? null : []);
  useEffect(() => {
    if (!fonte) return undefined;
    let ativo = true;
    fonte('publicado').then((r) => {
      const lista = (Array.isArray(r) ? r : r?.itens || []).filter((p) => !p.status || String(p.status).toLowerCase() === 'publicado');
      const data = (p) => p.publicado_em || p.atualizado_em || p.criado_em || '';
      if (ativo) setItens(lista.sort((a, b) => String(data(b)).localeCompare(String(data(a)))).slice(0, 4).map((p) => ({ id: p.id_publicacao, titulo: p.titulo, em: data(p) })));
    }, () => { if (ativo) setItens([]); });
    return () => { ativo = false; };
  }, []);
  return { itens, disponivel: Boolean(fonte) };
}

export function TelaInicioSupervisor({ controlador, sessoes, alertasMonitoria = 0, trocasPendentes = 0, atalhosOcultos = new Set() }) {
  const estado = controlador.estado;
  const nome = estado.nomeUsuarioAutenticado || estado.usuarioAutenticado || '';
  const agora = new Date();
  const [operacoes, setOperacoes] = useState(null);
  const temWfm = controlador.podeAcessarTela('screen-wfm-dia');
  useEffect(() => {
    let ativo = true;
    lerContextoWfm().then((ctx) => { if (ativo) setOperacoes((ctx?.operacoes || []).filter((o) => o.escala_ativa !== false).map((o) => o.chave)); }, () => { if (ativo) setOperacoes([]); });
    return () => { ativo = false; };
  }, []);
  const destinoMonitoria = sessoes.find((s) => s.id === 'monitoria')?.destino || null;
  const pendencias = usePendencias(controlador, operacoes || [], alertasMonitoria, destinoMonitoria);
  // Sem Mural e sem atalho da Central de Treinamento no Início (pedido do Paulo, 09/11/2026); o Mural segue na seção própria.
  const atalhos = sessoes.filter((s) => s.id !== 'treinamentos' && !atalhosOcultos.has(s.id));
  const hoje = paraIso(agora);
  const vencemHoje = (pendencias || []).filter((p) => p.prazo && paraIso(new Date(p.prazo)) === hoje).length;
  const irPara = (tela) => controlador.irParaTelaProtegida(tela);
  const destinoMural = controlador.podeAcessarTela('screen-mural') ? 'screen-mural' : controlador.podeAcessarTela('screen-equipes-controle') ? 'screen-equipes-controle' : null;

  return html`
    <${PainelRh} screenId="screen-menu" navAtiva="screen-menu" subtituloMarca="Início" placeholderBusca="Conecta" controlador=${controlador}>
      <main class="c-pagina c-conteudo">
        <div class="c-pagina-cab"><div class="c-titulo"><h1>${saudacao(agora)}, ${(nome || '').split(' ')[0] || 'bem-vindo(a)'}</h1>
          <p>${estado.perfilUsuarioNome || 'Supervisor'} · ${DIAS_LONGOS[agora.getDay()]}, ${agora.getDate()} de ${MESES[agora.getMonth()]}</p></div></div>
        ${atalhos.length ? html`<section><h2 class="c-rotulo c-oculto">Atalhos</h2><nav class="c-atalhos" aria-label="Atalhos">
          ${atalhos.map((s) => html`<a key=${s.id} class="c-atalho" href="#" onClick=${(ev) => { ev.preventDefault(); irPara(s.destino); }}
            title=${s.desc}><span class="c-ic" aria-hidden="true">${IconeSvg(s.icone)}</span>${s.titulo}
            ${(() => { const n = s.id === 'monitoria' ? alertasMonitoria : s.id === 'wfm' ? trocasPendentes : 0; return n > 0 ? html`<span class="c-conta c-atalho-conta" aria-label=${`${n} pendente(s)`}>${n}</span>` : null; })()}</a>`)}
        </nav></section>` : null}
        ${temWfm && operacoes === null ? html`<section class="c-cartao"><div class="c-cartao-corpo"><${Esqueleto} linhas=${3} /></div></section>` : null}
        ${temWfm && operacoes?.length ? html`<${EscalaDeHoje} controlador=${controlador} operacao=${operacoes[0]} />` : null}
        <div class="c-hoje-dupla c-hoje-dupla--so">
          <section class="c-cartao" aria-labelledby="c-precisa-titulo">
            <div class="c-cartao-cab"><h2 id="c-precisa-titulo">Precisa de você</h2>${vencemHoje ? html`<${Selo} tom="perigo" icone="warning-octagon">${vencemHoje} ${vencemHoje === 1 ? 'vence hoje' : 'vencem hoje'}<//>` : null}</div>
            ${pendencias === null ? html`<div class="c-cartao-corpo"><${Esqueleto} linhas=${3} /></div>`
    : !pendencias.length ? html`<${Estado} icone="check-circle" titulo="Nada pendente agora." />`
      : html`<div class="c-tabela-caixa"><table class="c-tabela c-tabela--junta c-hoje-pend">
              <thead><tr><th scope="col" class="c-estica">Pendência</th><th scope="col" class="c-num">Qtd.</th><th scope="col">Prazo</th><th scope="col" class="c-acoes"><span class="c-oculto">Ação</span></th></tr></thead>
              <tbody>${pendencias.map((p) => html`<tr key=${p.id} class="c-clicavel" title=${p.onde} onClick=${() => { p.antes?.(); irPara(p.tela); }}>
                <td class="c-estica"><span style=${{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}><${Ic} nome=${p.icone} />${p.texto}</span></td>
                <td class="c-num c-forte">${p.qtd}</td>
                <td class=${p.prazo ? '' : 'c-secundario'}>${p.prazo ? prazoCurto(p.prazo) : 'Sem prazo'}</td>
                <td class="c-acoes"><button type="button" class="c-botao c-botao--secundario c-botao--compacto" aria-label=${`Ver: ${p.texto} (${p.onde})`} onClick=${(ev) => { ev.stopPropagation(); p.antes?.(); irPara(p.tela); }}>Ver</button></td>
              </tr>`)}</tbody></table></div>`}
          </section>
        </div>
      </main>
    </${PainelRh}>`;
}
