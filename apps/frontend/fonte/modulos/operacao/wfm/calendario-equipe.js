import { html, useEffect, useMemo, useState } from '../../../infraestrutura-react.js';
import { EmptyState, LoadingState } from '../../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../../ui/icone.js';
import { lerEscalaWfm } from '../../../services/api/wfm.js?v=20261026-trocas';

// Escala da equipe em calendário (visão do Supervisor): versão reduzida do calendário do operador. Cada dia mostra quantos
// estão escalados e, ao selecionar, quem trabalha, em que horário e com quais pausas. Somente leitura.

const SEMANA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const ROTULO_PAUSA = { DESCANSO: 'Descanso', REFEICAO: 'Refeição', LANCHE: 'Lanche', OUTRA: 'Pausa', INTERVALO: 'Intervalo' };
const pad = (n) => String(n).padStart(2, '0');
const paraIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const doIso = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
const diaSemana = (d) => (d.getDay() + 6) % 7; // 0 = segunda
const aMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const tituloDia = (d) => `${SEMANA[diaSemana(d)]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const fimPausa = (p) => hhmm((aMin(p.inicio) + p.duracao_min) % 1440);

export function CalendarioEquipe({ operacao, anoMes, aoMudarMes, opcoesEscala, aoTrocarEscala }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [sel, setSel] = useState(null);
  const hoje = paraIso(new Date());
  const [ano, mes] = anoMes.split('-').map(Number);

  useEffect(() => {
    let ativo = true;
    setDados(null); setErro('');
    lerEscalaWfm(operacao, anoMes)
      .then((r) => { if (ativo) setDados(r); })
      .catch((e) => { if (ativo) setErro(e?.message || 'Não foi possível carregar a escala da equipe.'); });
    return () => { ativo = false; };
  }, [operacao, anoMes]);

  // dia (ISO) -> { trabalham: [{ id, nome, entrada, saida, codigo, cor, pausas }], folgas: [nome] }
  const porDia = useMemo(() => {
    if (!dados) return {};
    const turnos = Object.fromEntries((dados.turnos || []).map((t) => [t.id_turno, t]));
    const nomes = Object.fromEntries((dados.operadores || []).map((o) => [o.id_usuario, o.nome]));
    const pausas = {};
    (dados.pausas_equipe || []).forEach((p) => { (pausas[`${p.id_operador}|${p.data}`] = pausas[`${p.id_operador}|${p.data}`] || []).push(p); });
    const mapa = {};
    (dados.itens || []).forEach((i) => {
      const t = turnos[i.id_turno];
      if (!t || nomes[i.id_operador] === undefined) return;
      const dia = (mapa[i.data] = mapa[i.data] || { trabalham: [], folgas: [] });
      if (t.tipo !== 'TRABALHO') { dia.folgas.push(nomes[i.id_operador]); return; }
      dia.trabalham.push({
        id: i.id_operador, nome: nomes[i.id_operador], codigo: t.codigo, cor: t.cor,
        entrada: i.entrada_ajuste || t.entrada, saida: i.saida_ajuste || t.saida, pausas: pausas[`${i.id_operador}|${i.data}`] || [],
      });
    });
    Object.values(mapa).forEach((d) => { d.trabalham.sort((a, b) => String(a.entrada).localeCompare(String(b.entrada)) || a.nome.localeCompare(b.nome, 'pt-BR')); d.folgas.sort((a, b) => a.localeCompare(b, 'pt-BR')); });
    return mapa;
  }, [dados]);

  const grade = useMemo(() => {
    const primeiro = new Date(ano, mes - 1, 1);
    const ultimo = new Date(ano, mes, 0);
    const ini = new Date(primeiro); ini.setDate(ini.getDate() - diaSemana(primeiro));
    const total = Math.ceil((diaSemana(primeiro) + ultimo.getDate()) / 7) * 7;
    return Array.from({ length: total }, (_, i) => { const d = new Date(ini); d.setDate(ini.getDate() + i); return d; });
  }, [ano, mes]);

  // Seleção: mantém o dia escolhido no mês; senão hoje (se for o mês atual) ou o primeiro dia com escala.
  useEffect(() => {
    if (!dados) return;
    setSel((atual) => {
      if (atual && atual.startsWith(anoMes)) return atual;
      if (hoje.startsWith(anoMes)) return hoje;
      return Object.keys(porDia).filter((d) => d.startsWith(anoMes)).sort()[0] || null;
    });
  }, [dados, anoMes, porDia, hoje]);

  const mover = (n) => { const d = new Date(ano, mes - 1 + n, 1); aoMudarMes?.(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); };
  const diaSel = sel ? porDia[sel] : null;
  const publicada = (dados?.status?.versao_publicada || 0) > 0;

  const celula = (d) => {
    const iso = paraIso(d);
    if (d.getMonth() !== mes - 1) return html`<div key=${iso} class="ce-fora" aria-hidden="true"></div>`;
    const dia = porDia[iso];
    const n = dia?.trabalham.length || 0;
    const codigos = {};
    (dia?.trabalham || []).forEach((t) => { codigos[t.codigo] = (codigos[t.codigo] || 0) + 1; });
    const comPausa = (dia?.trabalham || []).some((t) => t.pausas.length);
    const classe = `ce-dia ${iso === hoje ? 'is-hoje' : ''} ${iso === sel ? 'is-sel' : ''} ${n ? '' : 'is-vazio'}`.trim();
    return html`<button type="button" key=${iso} class=${classe} aria-pressed=${iso === sel} aria-label=${`${tituloDia(d)}: ${n} escalado(s)`} onClick=${() => setSel(iso)}>
      <span class="ce-dia-num">${pad(d.getDate())}</span>
      ${n ? html`<strong class="ce-dia-n">${n}</strong><span class="ce-dia-cod">${Object.entries(codigos).slice(0, 3).map(([c, q]) => `${c} ${q}`).join(' · ')}</span>
        ${comPausa ? html`<span class="ce-ponto" title="Pausas programadas" aria-hidden="true"></span>` : null}` : null}
    </button>`;
  };

  return html`<section class="mon-card ce-card">
    <div class="ce-barra">
      <div class="ce-barra-esq">
        <h3 class="ce-mes">${MESES[mes - 1]} de ${ano}</h3>
        <div class="mc-nav">
          <button type="button" class="mc-btn mc-btn-icone" aria-label="Mês anterior" onClick=${() => mover(-1)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('chevron_left')}</span></button>
          <button type="button" class="mc-btn" onClick=${() => { const h = new Date(); aoMudarMes?.(`${h.getFullYear()}-${pad(h.getMonth() + 1)}`); setSel(hoje); }}>Hoje</button>
          <button type="button" class="mc-btn mc-btn-icone" aria-label="Próximo mês" onClick=${() => mover(1)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('chevron_right')}</span></button>
        </div>
      </div>
      ${opcoesEscala?.length > 1 ? html`<label class="ce-escala"><span class="visually-hidden">Escala</span>
        <select class="form-select form-select-sm" value=${operacao} onChange=${(e) => aoTrocarEscala?.(e.target.value)}>${opcoesEscala.map(([v, r]) => html`<option key=${v} value=${v}>${r}</option>`)}</select></label>` : null}
    </div>
    ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`
      : !dados ? html`<${LoadingState} titulo="Carregando a escala da equipe" />`
      : !(dados.itens || []).length ? html`<${EmptyState} icon="calendar_month" title="Escala sem colaboradores" text="Não há colaboradores escalados da sua equipe neste mês." />`
      : html`<div class="ce-corpo">
        <div class="ce-grade-col">
          <div class="ce-cab" aria-hidden="true">${SEMANA.map((s) => html`<span key=${s}>${s.slice(0, 3).toUpperCase()}</span>`)}</div>
          <div class="ce-grade">${grade.map(celula)}</div>
          <p class="ce-legenda"><span class="ce-ponto" aria-hidden="true"></span> Dia com pausas programadas · número = colaboradores escalados${publicada ? '' : ' · escala ainda em rascunho'}</p>
        </div>
        <aside class="ce-painel" aria-label="Dia selecionado">
          ${sel ? html`<p class="mc-eyebrow">DIA SELECIONADO</p><h4 class="ce-painel-titulo">${tituloDia(doIso(sel))}</h4>` : null}
          ${diaSel?.trabalham.length ? html`<ul class="ce-lista">${diaSel.trabalham.map((t) => html`<li key=${t.id} class="ce-pessoa">
              <div class="ce-pessoa-topo"><strong>${t.nome}</strong><span class="ce-horario">${t.entrada}–${t.saida}</span></div>
              <div class="ce-pessoa-sub"><span class="ce-cod" style=${t.cor ? { '--ce-cor': t.cor } : undefined}>${t.codigo}</span>
                ${t.pausas.length ? t.pausas.map((p, i) => html`<span key=${i} class="ce-pausa" title=${ROTULO_PAUSA[p.tipo] || 'Pausa'}>${(ROTULO_PAUSA[p.tipo] || 'Pausa')} ${p.inicio}–${fimPausa(p)}</span>`) : html`<span class="ce-pausa is-vazio">Pausas a programar</span>`}
              </div>
            </li>`)}</ul>`
            : html`<p class="mc-ajuda">${sel ? 'Ninguém da equipe escalado neste dia.' : 'Selecione um dia para ver quem trabalha.'}</p>`}
          ${diaSel?.folgas.length ? html`<p class="ce-folgas"><b>Folga/DSR (${diaSel.folgas.length}):</b> ${diaSel.folgas.join(', ')}</p>` : null}
        </aside>
      </div>`}
  </section>`;
}
