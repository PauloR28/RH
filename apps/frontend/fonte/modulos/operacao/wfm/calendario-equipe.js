import { html, useEffect, useMemo, useState } from '../../../infraestrutura-react.js';
import { useVisaoEquipes } from './escala-ui.js?v=20261111-modulos-op';
import { lerEscalaWfm } from '../../../services/api/wfm.js?v=20261111-modulos-op';
import { Esqueleto, Estado, Ic, Navegar, Selo } from '../../../ui/components/ds.js?v=20261106-wfm';

// Equipes › Escala (redesign Fase 15, fatia 4, amostra Q4 do lote 2): calendário do mês (c-cal) em que cada dia mostra quantos
// estão escalados; o dia escolhido ganha contorno e a coluna da direita (320 px) lista quem trabalha, código do turno, horário e
// as 3 pausas. Somente leitura; o escopo (equipe/todas as equipes) é do servidor.

const SEMANA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const ROTULO_PAUSA = { DESCANSO: 'Descanso', REFEICAO: 'Refeição', LANCHE: 'Lanche', OUTRA: 'Pausa', INTERVALO: 'Intervalo' };
const pad = (n) => String(n).padStart(2, '0');
const paraIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const doIso = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
const diaSemana = (d) => (d.getDay() + 6) % 7; // 0 = segunda
const aMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const tituloDia = (d) => `${SEMANA[diaSemana(d)]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
const fimPausa = (p) => hhmm((aMin(p.inicio) + p.duracao_min) % 1440);

export function CalendarioEquipe({ operacao, anoMes, aoMudarMes, opcoesEscala, aoTrocarEscala, ehSupervisor = false, aoVerPainel }) {
  // Supervisor: alterna entre a própria equipe e TODAS as equipes (sábado, domingo e feriado ele responde pela operação toda).
  const [todasEquipes, setTodasEquipes] = useVisaoEquipes(ehSupervisor);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [sel, setSel] = useState(null);
  const hoje = paraIso(new Date());
  const [ano, mes] = anoMes.split('-').map(Number);

  useEffect(() => {
    let ativo = true;
    setDados(null); setErro('');
    lerEscalaWfm(operacao, anoMes, false, todasEquipes)
      .then((r) => { if (ativo) setDados(r); })
      .catch((e) => { if (ativo) setErro(e?.message || 'Não foi possível carregar a escala da equipe.'); });
    return () => { ativo = false; };
  }, [operacao, anoMes, todasEquipes]);

  // dia (ISO) -> { trabalham: [{ id, nome, entrada, saida, codigo, cor, pausas }], folgas: [nome] }
  const porDia = useMemo(() => {
    if (!dados) return {};
    const turnos = Object.fromEntries((dados.turnos || []).map((t) => [t.id_turno, t]));
    const nomes = Object.fromEntries((dados.operadores || []).map((o) => [o.id_usuario, o.nome]));
    const equipes = Object.fromEntries((dados.operadores || []).map((o) => [o.id_usuario, o.equipe || '']));
    const pausas = {};
    (dados.pausas_equipe || []).forEach((p) => { (pausas[`${p.id_operador}|${p.data}`] = pausas[`${p.id_operador}|${p.data}`] || []).push(p); });
    const mapa = {};
    (dados.itens || []).forEach((i) => {
      const t = turnos[i.id_turno];
      if (!t || nomes[i.id_operador] === undefined) return;
      const dia = (mapa[i.data] = mapa[i.data] || { trabalham: [], folgas: [] });
      if (t.tipo !== 'TRABALHO') { dia.folgas.push(nomes[i.id_operador]); return; }
      dia.trabalham.push({
        id: i.id_operador, nome: nomes[i.id_operador], equipe: equipes[i.id_operador], codigo: t.codigo, cor: t.cor,
        entrada: i.entrada_ajuste || t.entrada, saida: i.saida_ajuste || t.saida, pausas: pausas[`${i.id_operador}|${i.data}`] || [],
      });
    });
    Object.values(mapa).forEach((d) => { d.trabalham.sort((a, b) => String(a.entrada).localeCompare(String(b.entrada)) || a.nome.localeCompare(b.nome, 'pt-BR')); d.folgas.sort((a, b) => a.localeCompare(b, 'pt-BR')); });
    return mapa;
  }, [dados]);

  const semanas = useMemo(() => {
    const primeiro = new Date(ano, mes - 1, 1);
    const ultimo = new Date(ano, mes, 0);
    const ini = new Date(primeiro); ini.setDate(ini.getDate() - diaSemana(primeiro));
    const total = Math.ceil((diaSemana(primeiro) + ultimo.getDate()) / 7) * 7;
    const dias = Array.from({ length: total }, (_, i) => { const d = new Date(ini); d.setDate(ini.getDate() + i); return d; });
    return Array.from({ length: total / 7 }, (_, s) => dias.slice(s * 7, s * 7 + 7));
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
  const irHoje = () => { const h = new Date(); aoMudarMes?.(`${h.getFullYear()}-${pad(h.getMonth() + 1)}`); setSel(hoje); };
  const diaSel = sel ? porDia[sel] : null;
  const versao = dados?.status?.versao_publicada || 0;
  const nSel = diaSel?.trabalham.length || 0;

  const celula = (d) => {
    const iso = paraIso(d);
    const fora = d.getMonth() !== mes - 1;
    if (fora) return html`<td key=${iso} class="c-cal-fora" aria-hidden="true"><span class="c-eq-dia" style=${{ cursor: 'default' }}><b>${d.getDate()}</b></span></td>`;
    const dia = porDia[iso];
    const n = dia?.trabalham.length || 0;
    const codigos = {};
    (dia?.trabalham || []).forEach((t) => { codigos[t.codigo] = (codigos[t.codigo] || 0) + 1; });
    const classe = [iso === hoje ? 'c-cal-hoje' : '', iso === sel ? 'c-eq-sel' : '', !n ? 'c-cal-dsr' : ''].filter(Boolean).join(' ');
    return html`<td key=${iso} class=${classe || null}>
      <button type="button" class="c-eq-dia" aria-pressed=${iso === sel ? 'true' : 'false'} aria-label=${`${tituloDia(d)}: ${n} escalado(s)`} onClick=${() => setSel(iso)}>
        <b>${d.getDate()}</b>
        ${n ? html`<small>${n} escalado${n > 1 ? 's' : ''}</small><small title=${Object.entries(codigos).map(([c, q]) => `${c} ${q}`).join(' · ')}>${Object.entries(codigos).slice(0, 3).map(([c, q]) => `${c} ${q}`).join(' · ')}</small>` : html`<small>—</small>`}
      </button>
    </td>`;
  };

  const faixa = html`<div class="c-filtros c-filtros--suave">
    <${Navegar} grupo="Mês" rotulo=${`${MESES[mes - 1].charAt(0).toUpperCase()}${MESES[mes - 1].slice(1)} de ${ano}`} rotuloAnterior="Mês anterior" rotuloProximo="Próximo mês" aoAnterior=${() => mover(-1)} aoProximo=${() => mover(1)} />
    <button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${(sel === hoje && hoje.startsWith(anoMes)) || null} onClick=${irHoje}>Hoje</button>
    ${ehSupervisor ? html`<select class="c-entrada c-entrada--compacta" aria-label="Equipes exibidas" value=${todasEquipes ? 'todas' : 'minha'} onChange=${(e) => setTodasEquipes(e.target.value === 'todas')}><option value="minha">Minha equipe</option><option value="todas">Todas as equipes</option></select>` : null}
    ${opcoesEscala?.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Escala" value=${operacao} onChange=${(e) => aoTrocarEscala?.(e.target.value)}>${opcoesEscala.map(([v, r]) => html`<option key=${v} value=${v}>${r}</option>`)}</select>` : null}
    ${dados ? html`<span class="c-contador">${versao ? html`<${Selo} tom="sucesso" icone="check-circle">Escala publicada · v${versao}<//>` : html`<${Selo} tom="neutro" icone="pencil-simple">Escala em rascunho<//>`}</span>` : null}
  </div>`;

  return html`<div class="c-eq-corpo">
    <div class="c-tabela-caixa">
      ${faixa}
      ${erro ? html`<${Estado} titulo=${erro} />`
        : !dados ? html`<${Esqueleto} linhas=${6} />`
        : !(dados.itens || []).length ? html`<${Estado} icone="calendar-blank" titulo="Escala sem colaboradores" texto=${todasEquipes ? 'Não há colaboradores escalados neste mês.' : 'Não há colaboradores escalados da sua equipe neste mês.'} />`
        : html`<table class="c-cal c-eq-cal" aria-label=${`Escala de ${MESES[mes - 1]} de ${ano}`}>
          <thead><tr>${SEMANA.map((s) => html`<th key=${s} scope="col">${s.slice(0, 3)}</th>`)}</tr></thead>
          <tbody>${semanas.map((linha, i) => html`<tr key=${i}>${linha.map(celula)}</tr>`)}</tbody>
        </table>`}
    </div>
    <aside class="c-eq-lado" aria-label="Dia escolhido">
      <div class="c-db-bloco">
        <div class="c-db-bloco-cab"><h3>${sel ? tituloDia(doIso(sel)) : 'Dia'}</h3>${sel ? html`<span class="c-ajuda" style=${{ marginLeft: 'auto', paddingRight: 'var(--espaco-2)' }}>${nSel} escalado${nSel === 1 ? '' : 's'}</span>` : null}</div>
        <div class="c-db-bloco-corpo">
          ${diaSel?.trabalham.length ? html`<ul class="c-eq-pessoas">${diaSel.trabalham.map((t) => html`<li key=${t.id}>
              <div><b title=${t.nome}>${t.nome}${todasEquipes && t.equipe ? html` <span class="c-secundario">· ${t.equipe}</span>` : ''}</b><span class="c-eq-hor"><span class="c-eq-cod" style=${{ '--t': t.cor || 'var(--cor-acao-fundo)' }}>${t.codigo}</span>${t.entrada}–${t.saida}</span></div>
              <div class="c-eq-pausas">${t.pausas.length ? t.pausas.slice(0, 3).map((p, i) => html`<span key=${i} class="c-ajuda" title=${`${ROTULO_PAUSA[p.tipo] || 'Pausa'} ${p.inicio}–${fimPausa(p)}`}>${p.inicio}</span>`) : html`<span class="c-ajuda">Pausas a programar</span>`}</div>
            </li>`)}</ul>`
            : html`<p class="c-ajuda" style=${{ margin: 0 }}>${sel ? (todasEquipes ? 'Ninguém escalado neste dia.' : 'Ninguém da equipe escalado neste dia.') : 'Escolha um dia no calendário.'}</p>`}
          ${diaSel?.folgas.length ? html`<p class="c-ajuda" style=${{ margin: 0 }}><b>Folga/DSR (${diaSel.folgas.length}):</b> ${diaSel.folgas.join(', ')}</p>` : null}
          ${aoVerPainel && sel === hoje && nSel ? html`<a href="#" class="c-eq-mais" onClick=${(e) => { e.preventDefault(); aoVerPainel(); }}>Ver os ${nSel} no Painel do dia<${Ic} nome="arrow-right" /></a>` : null}
        </div>
      </div>
    </aside>
  </div>`;
}
