import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { PainelRh } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import { Esqueleto, Estado, Ic, Selo } from '../../ui/components/ds.js?v=20261106-wfm';
import { lerContextoWfm, lerEscalaWfm, listarTrocasWfm } from '../../services/api/wfm.js?v=20261104-leitura';
import { listarMonitorias } from '../../services/api/monitoria.js';

// Início do Operador (redesign Fase 15, fatia 4, lote 3 · amostra Fase 14, quadro 1): cabeçalho em caixa com a saudação,
// "Operador · <dia>" e a faixa "Seu dia" (Entrada · pausas · Saída do turno de hoje, da escala publicada); o que já passou
// fica apagado com ✓ e a próxima fica destacada, e a faixa se atualiza sozinha. Depois os atalhos (Minha escala · Minhas
// monitorias) e "Precisa de você". Sem Mural e sem "Pedir troca" (ajustes do Paulo, 05/11). Só leitura: os dados vêm das
// mesmas rotas da Minha escala, das Trocas e de Minhas monitorias, com o escopo do servidor.

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const ROTULO_SEM_HORARIO = { FOLGA: 'Folga', DSR: 'DSR', FERIAS: 'Férias', ESCALADO: 'Escalado', SOBREAVISO: 'Sobreaviso' };
const ORDINAL = ['1ª', '2ª', '3ª', '4ª', '5ª', '6ª'];
const pad = (n) => String(n).padStart(2, '0');
const paraIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const anoMesDe = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const aMin = (hm) => Number(String(hm).slice(0, 2)) * 60 + Number(String(hm).slice(3, 5));
const saudacao = (d) => (d.getHours() < 12 ? 'Bom dia' : d.getHours() < 18 ? 'Boa tarde' : 'Boa noite');
const duracao = (min) => { const h = Math.floor(min / 60); const m = min % 60; return h ? `${h} h${m ? ` ${pad(m)}` : ''}` : `${m} min`; };
const dataHoraCurta = (d) => `${DIAS_CURTOS[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Turno de hoje (o primeiro, se a pessoa tiver mais de um) ou o tipo do dia sem horário (Folga, DSR...).
function useMeuDia(habilitado) {
  const [dia, setDia] = useState(habilitado ? null : { indisponivel: true });
  useEffect(() => {
    if (!habilitado) return undefined;
    let ativo = true;
    (async () => {
      try {
        const hoje = new Date();
        const iso = paraIso(hoje);
        const ctx = await lerContextoWfm();
        const chaves = (ctx?.operacoes || []).filter((o) => o.escala_ativa !== false).map((o) => o.chave);
        const respostas = (await Promise.all(chaves.map((c) => lerEscalaWfm(c, anoMesDe(hoje), true).then((r) => r, () => null)))).filter(Boolean);
        const itens = respostas.flatMap((r) => (r.itens || []).filter((i) => i.data === iso));
        const trabalho = itens.filter((i) => i.trabalha && i.entrada && i.saida).sort((a, b) => String(a.entrada).localeCompare(String(b.entrada)));
        if (ativo) setDia(trabalho[0] ? { turno: trabalho[0] } : itens[0] ? { semHorario: ROTULO_SEM_HORARIO[itens[0].tipo] || ROTULO_SEM_HORARIO[itens[0].codigo] || 'Sem turno' } : { semEscala: true });
      } catch { if (ativo) setDia({ indisponivel: true }); }
    })();
    return () => { ativo = false; };
  }, [habilitado]);
  return dia;
}

// Etapas do dia em minutos desde 00:00 (turno que vira a meia-noite soma 24 h ao que passa dela).
function etapasDoTurno(turno) {
  const ini = aMin(turno.entrada);
  const ajusta = (m) => (m < ini ? m + 1440 : m);
  const fim = ajusta(aMin(turno.saida));
  const pausas = [...(turno.pausas || [])].map((p) => ({ ...p, min: ajusta(aMin(p.inicio)) })).sort((a, b) => a.min - b.min);
  return [
    { id: 'entrada', rotulo: 'Entrada', hora: turno.entrada, min: ini, fim: ini, nota: 'início do turno' },
    ...pausas.map((p, i) => ({ id: `p${i}`, rotulo: `${ORDINAL[i] || `${i + 1}ª`} pausa`, hora: p.inicio, min: p.min, fim: p.min + (Number(p.duracao_min) || 0), nota: `${Number(p.duracao_min) || 0} min` })),
    { id: 'saida', rotulo: 'Saída', hora: turno.saida, min: fim, fim, nota: `${duracao(fim - ini)} no dia` },
  ];
}

function FaixaSeuDia({ dia, agora }) {
  if (!dia) return html`<div class="c-meudia c-io-meudia-carregando" aria-busy="true"><${Esqueleto} linhas=${1} /></div>`;
  if (dia.indisponivel) return null;
  if (!dia.turno) {
    return html`<ol class="c-meudia" aria-label="Seu dia" style=${{ '--n': 1 }}>
      <li><small>Hoje</small><b>${dia.semEscala ? '—' : dia.semHorario}</b><em>${dia.semEscala ? 'sem escala publicada' : 'sem horário de trabalho'}</em></li></ol>`;
  }
  const etapas = etapasDoTurno(dia.turno);
  const ini = etapas[0].min;
  let agoraMin = agora.getHours() * 60 + agora.getMinutes();
  if (agoraMin < ini && etapas[etapas.length - 1].min >= 1440) agoraMin += 1440;
  const proxima = etapas.findIndex((e) => e.fim > agoraMin || (e.id === 'saida' && e.min > agoraMin));
  return html`<ol class="c-meudia" aria-label="Seu dia" style=${{ '--n': etapas.length }}>
    ${etapas.map((e, i) => {
    const passou = proxima === -1 || i < proxima;
    const atual = i === proxima;
    return html`<li key=${e.id} class=${passou ? 'c-meudia-feito' : null} aria-current=${atual ? 'step' : null}>
        <small>${e.rotulo}</small><b>${e.hora}</b>
        <em>${passou ? html`<${Ic} nome="check" /><span class="c-oculto">já passou · </span>` : null}${atual ? `próxima · ${e.nota}` : e.nota}</em></li>`;
  })}
  </ol>`;
}

function usePendencias(controlador, podeTrocas) {
  const [itens, setItens] = useState(null);
  useEffect(() => {
    let ativo = true;
    (async () => {
      const lista = [];
      const destinoMinhas = controlador.podeAcessarTela('screen-monitoria-minhas') ? 'screen-monitoria-minhas' : null;
      if (destinoMinhas) {
        const r = await listarMonitorias({ status: 'AGUARDANDO_CONFIRMACAO', pagina: 1, por_pagina: 50 }).catch(() => null);
        const total = Number(r?.total) || 0;
        if (total) {
          const restantes = (r.itens || []).map((m) => Number(m.sla?.restante_h)).filter((h) => Number.isFinite(h) && h > 0).sort((a, b) => a - b);
          lista.push({ id: 'monitorias', icone: 'clipboard-text', texto: total === 1 ? 'Monitoria para confirmar ou contestar' : 'Monitorias para confirmar ou contestar', qtd: total,
            prazo: restantes.length ? new Date(Date.now() + restantes[0] * 3600000) : null, onde: 'Monitoria › Minhas monitorias', tela: destinoMinhas, acao: 'Ver' });
        }
      }
      if (podeTrocas) {
        try {
          const ctx = await lerContextoWfm();
          const chaves = (ctx?.operacoes || []).filter((o) => o.escala_ativa !== false).map((o) => o.chave);
          const trocas = (await Promise.all(chaves.map((c) => listarTrocasWfm(c).then((r) => r.itens || [], () => [])))).flat().filter((t) => t.pode_responder || t.pode_decidir);
          if (trocas.length) {
            const prazos = trocas.map((t) => t.prazo_resposta || t.prazo_decisao).filter(Boolean).sort();
            lista.push({ id: 'trocas', icone: 'arrows-left-right', texto: trocas.length === 1 ? 'Pedido de troca para responder' : 'Pedidos de troca para responder', qtd: trocas.length,
              prazo: prazos[0] ? new Date(prazos[0]) : null, onde: 'Turnos e Plantões › Trocas', tela: 'screen-wfm-trocas', acao: 'Responder' });
          }
        } catch { /* sem Turnos e Plantões: só não mostra a linha */ }
      }
      if (ativo) setItens(lista);
    })();
    return () => { ativo = false; };
  }, []);
  return itens;
}

export function TelaInicioOperador({ controlador, sessoes = [], atalhosOcultos = new Set() }) {
  const estado = controlador.estado;
  const nome = estado.nomeUsuarioAutenticado || estado.usuarioAutenticado || '';
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setAgora(new Date()), 60000); return () => clearInterval(t); }, []);
  const temEscala = controlador.podeAcessarTela('screen-wfm-minha-escala');
  const podeTrocas = controlador.podeAcessarTela('screen-wfm-trocas');
  const dia = useMeuDia(temEscala);
  const pendencias = usePendencias(controlador, podeTrocas);
  const irPara = (tela) => controlador.irParaTelaProtegida(tela);

  // Atalhos: Minha escala, Trocas e Minhas monitorias; as demais áreas liberadas ao perfil (ex.: Treinamentos) continuam aqui.
  const atalhos = [
    temEscala ? { id: 'minha-escala', titulo: 'Minha escala', icone: 'calendar-blank', destino: 'screen-wfm-minha-escala' } : null,
    podeTrocas ? { id: 'trocas', titulo: 'Trocas', icone: 'arrows-left-right', destino: 'screen-wfm-trocas' } : null,
    controlador.podeAcessarTela('screen-monitoria-minhas') ? { id: 'minhas-monitorias', titulo: 'Minhas monitorias', icone: 'clipboard-text', destino: 'screen-monitoria-minhas' } : null,
    ...sessoes.filter((s) => !['wfm', 'monitoria', 'mural'].includes(s.id)).map((s) => ({ id: s.id, titulo: s.titulo, icone: s.icone, destino: s.destino, desc: s.desc })),
  ].filter((a) => a && !atalhosOcultos.has(a.id));
  const vencemLogo = (pendencias || []).filter((p) => p.prazo && p.prazo.getTime() - agora.getTime() < 24 * 3600000).length;

  return html`
    <${PainelRh} screenId="screen-menu" navAtiva="screen-menu" subtituloMarca="Início" placeholderBusca="Conecta" controlador=${controlador}>
      <main class="c-pagina c-conteudo">
        <header class="c-saudacao">
          <div class="c-saudacao-quem"><h1>${saudacao(agora)}, ${(nome || '').split(' ')[0] || 'bem-vindo(a)'}</h1>
            <p>${estado.perfilUsuarioNome || 'Operador'} · ${DIAS_CURTOS[agora.getDay()]}, ${agora.getDate()} ${MESES_CURTOS[agora.getMonth()]}</p></div>
          ${temEscala ? html`<${FaixaSeuDia} dia=${dia} agora=${agora} />` : null}
        </header>
        ${atalhos.length ? html`<section><h2 class="c-rotulo c-io-rotulo">Atalhos</h2><nav class="c-atalhos" aria-label="Atalhos">
          ${atalhos.map((s) => html`<a key=${s.id} class="c-atalho" href="#" title=${s.desc || null} onClick=${(ev) => { ev.preventDefault(); irPara(s.destino); }}>
            ${s.icone && s.icone.includes('-') ? html`<${Ic} nome=${s.icone} />` : html`<span class="c-ic" aria-hidden="true">${IconeSvg(s.icone)}</span>`}${s.titulo}${(() => { const n = (pendencias || []).find((p) => (s.id === 'trocas' && p.id === 'trocas') || (s.id === 'minhas-monitorias' && p.id === 'monitorias'))?.qtd || 0; return n > 0 ? html`<span class="c-conta c-atalho-conta" aria-label=${`${n} pendente(s)`}>${n}</span>` : null; })()}</a>`)}
        </nav></section>` : null}
        <section class="c-cartao" aria-labelledby="c-io-precisa">
          <div class="c-cartao-cab"><h2 id="c-io-precisa">Precisa de você</h2>${vencemLogo ? html`<${Selo} tom="atencao" icone="clock">${vencemLogo} ${vencemLogo === 1 ? 'vence em até 24 h' : 'vencem em até 24 h'}<//>` : null}</div>
          ${pendencias === null ? html`<div class="c-cartao-corpo"><${Esqueleto} linhas=${2} /></div>`
    : !pendencias.length ? html`<${Estado} icone="check-circle" titulo="Nada pendente agora." />`
      : html`<div class="c-tabela-caixa"><table class="c-tabela c-tabela--junta c-io-tabela">
            <thead><tr><th scope="col">Pendência</th><th scope="col" class="c-num">Qtd.</th><th scope="col">Prazo</th><th scope="col" class="c-estica">Onde fica</th><th scope="col" class="c-acoes"><span class="c-oculto">Ação</span></th></tr></thead>
            <tbody>${pendencias.map((p) => html`<tr key=${p.id} class="c-clicavel" onClick=${() => irPara(p.tela)}>
              <td><span class="c-io-pend"><${Ic} nome=${p.icone} />${p.texto}</span></td>
              <td class="c-num c-forte">${p.qtd}</td>
              <td class=${p.prazo ? '' : 'c-secundario'}>${p.prazo ? `Até ${dataHoraCurta(p.prazo)}` : 'Sem prazo'}</td>
              <td class="c-estica c-secundario">${p.onde}</td>
              <td class="c-acoes c-acoes--iguais"><button type="button" class="c-botao c-botao--secundario c-botao--compacto" aria-label=${`${p.acao}: ${p.texto}`} onClick=${(ev) => { ev.stopPropagation(); irPara(p.tela); }}>${p.acao}</button></td>
            </tr>`)}</tbody></table></div>`}
        </section>
      </main>
    </${PainelRh}>`;
}
