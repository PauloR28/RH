import { html, useCallback, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState, ModalPadrao } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import { lerEscalaWfm, listarColegasTrocaWfm, solicitarTrocaWfm } from '../../services/api/wfm.js';
import { minutosParaHoras } from './comum.js';

// Visão do Operador: só a própria escala PUBLICADA. Semana (segunda a domingo) é a visão padrão; o mês
// continua disponível. Clicar em um dia abre os detalhes (horário e pausas) e, quando a troca é possível,
// o passo a passo para pedir a troca de plantão ali mesmo.

const SEMANA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const ROTULO_PAUSA = { DESCANSO: 'Descanso', REFEICAO: 'Refeição', LANCHE: 'Lanche', OUTRA: 'Pausa', INTERVALO: 'Intervalo' };

const paraIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const br = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const brIso = (iso) => iso.split('-').reverse().join('/');
const somarDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const segundaDe = (d) => somarDias(d, -((d.getDay() + 6) % 7));
const anoMesDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const doIso = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
const rotuloDia = (iso) => `${SEMANA[(doIso(iso).getDay() + 6) % 7].slice(0, 3)} ${brIso(iso).slice(0, 5)}`;

// Dá para pedir troca deste dia? (o servidor valida de novo: aqui só evitamos oferecer o que vai falhar)
function motivoSemTroca(data, item) {
  const agora = new Date();
  if (!item?.trabalha) return 'Só dá para trocar um dia de trabalho.';
  const dias = item.troca_antecedencia_dias ?? 3;
  const [h, m] = item.entrada.split(':').map(Number);
  const inicio = new Date(data); inicio.setHours(h, m, 0, 0);
  if (inicio.getTime() < agora.getTime() + dias * 24 * 3600 * 1000) return `A troca exige ${dias} dia(s) de antecedência antes do início do turno.`;
  return '';
}

function Pausas({ pausas, compacto = false }) {
  if (!(pausas || []).length) return null;
  return html`<ul class=${`wfm-pausas-lista ${compacto ? 'is-compacto' : ''}`} aria-label="Pausas">
    ${pausas.map((p, i) => html`<li key=${i}><span class="wfm-pausa-n">${i + 1}</span><b>${p.inicio}</b><span>${p.duracao_min} min</span>${compacto ? null : html`<span class="wfm-pausa-tipo">${ROTULO_PAUSA[p.tipo] || 'Pausa'}</span>`}</li>`)}
  </ul>`;
}

function CartaoDia({ data, itens = [], eventos, hoje, compacto, onAbrir }) {
  const trabalhando = itens.filter((i) => i.trabalha);
  const item = trabalhando[0] || itens[0];
  const fimDeSemana = data.getDay() === 0 || data.getDay() === 6;
  const trabalha = !!item?.trabalha;
  const classe = `wfm-dia ${trabalha ? 'is-escalado' : ''} ${fimDeSemana ? 'is-fds' : ''} ${paraIso(data) === hoje ? 'is-hoje' : ''} ${compacto ? 'is-compacto' : ''}`.trim();
  return html`
    <button type="button" class=${classe} onClick=${() => onAbrir(data)} aria-label=${`${SEMANA[(data.getDay() + 6) % 7]}, ${br(data)}${trabalha ? trabalhando.map((it) => `, ${it.entrada} às ${it.saida}`).join('') : ', DSR'}`}>
      <span class="wfm-dia-topo"><strong>${String(data.getDate()).padStart(2, '0')}</strong><span>${SEMANA[(data.getDay() + 6) % 7].slice(0, 3)}</span></span>
      ${trabalhando.length > 1 ? html`
        ${trabalhando.map((it, i) => html`<span key=${i} class="wfm-dia-horas"><span class="wfm-chip" style=${{ '--wfm-cor': it.cor || 'var(--brand)' }}>${it.codigo}</span>${it.entrada}–${it.saida}</span>`)}`
        : trabalha ? html`
        <span class="wfm-dia-horario">${item.entrada} – ${item.saida}</span>
        <span class="wfm-dia-horas"><span class="wfm-chip" style=${{ '--wfm-cor': item.cor || 'var(--brand)' }}>${item.codigo}</span>${minutosParaHoras(item.minutos)}</span>
        ${compacto ? ((item.pausas || []).length ? html`<span class="wfm-dia-npausas">${item.pausas.length} pausas</span>` : null) : html`<${Pausas} pausas=${item.pausas} compacto=${true} />`}`
        : html`<span class="wfm-dia-folga">${item && item.codigo !== 'DSR' ? 'Folga' : 'DSR'}</span>`}
      ${eventos.length ? html`<span class="wfm-dia-evento" title=${eventos.map((e) => e.descricao).join(' · ')}>${eventos[0].descricao}</span>` : null}
    </button>`;
}

// Passo a passo: o que trocar → com quem → confirmar.
function PedirTroca({ operacao, iso, item, onFeito, showToast }) {
  const [colegas, setColegas] = useState(null);
  const [modo, setModo] = useState('turno'); // 'turno' = mesmo dia | 'dia' = assumo outro dia do colega
  const [idColega, setIdColega] = useState(null);
  const [dataB, setDataB] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { listarColegasTrocaWfm(operacao).then((r) => setColegas(r.itens || [])).catch(() => setColegas([])); }, [operacao]);

  const limite = Date.now() + (item?.troca_antecedencia_dias ?? 3) * 24 * 3600 * 1000;
  const diasAssumiveis = (c) => Object.entries(c.dias || {}).filter(([d, h]) => d !== iso && doIso(d).setHours(Number(h.entrada.slice(0, 2)), Number(h.entrada.slice(3)), 0, 0) >= limite).sort(([a], [b]) => a.localeCompare(b));
  const compativeis = (colegas || []).filter((c) => c.compativel);
  const opcoes = compativeis.filter((c) => (modo === 'turno' ? c.dias?.[iso] : diasAssumiveis(c).length > 0));
  const colega = (colegas || []).find((c) => c.id_usuario === idColega);
  const dataFinalB = modo === 'turno' ? iso : dataB;
  const horarioB = colega?.dias?.[dataFinalB];
  const pronto = !!colega && !!horarioB;

  const trocarModo = (m) => { setModo(m); setIdColega(null); setDataB(''); };
  const enviar = async () => {
    setEnviando(true);
    try {
      await solicitarTrocaWfm({ operacao, id_alvo: colega.id_usuario, data_a: iso, data_b: dataFinalB, motivo });
      showToast?.('Troca solicitada. Seu colega tem 48 horas úteis para responder.', 'success');
      onFeito();
    } catch (err) { showToast?.(err?.message || 'Não foi possível solicitar a troca.', 'error'); } finally { setEnviando(false); }
  };

  return html`<div class="wfm-troca-passos">
    <div class="wfm-passo"><h4><span>1</span>O que você quer trocar?</h4>
      <div class="wfm-opcoes">
        <button type="button" class=${`wfm-opcao ${modo === 'turno' ? 'is-ativa' : ''}`} onClick=${() => trocarModo('turno')}><strong>Só o turno</strong><small>Mesmo dia: você e o colega trocam de horário.</small></button>
        <button type="button" class=${`wfm-opcao ${modo === 'dia' ? 'is-ativa' : ''}`} onClick=${() => trocarModo('dia')}><strong>O dia inteiro</strong><small>Você cede este dia e assume outro dia de trabalho do colega.</small></button>
      </div></div>

    <div class="wfm-passo"><h4><span>2</span>Com quem?</h4>
      ${colegas === null ? html`<p class="mon-muted wfm-vazio-txt">Carregando colegas…</p>`
        : opcoes.length ? html`<div class="wfm-colegas">${opcoes.map((c) => { const h = modo === 'turno' ? c.dias[iso] : null; const n = modo === 'dia' ? diasAssumiveis(c).length : 0;
          return html`<button key=${c.id_usuario} type="button" class=${`wfm-colega ${idColega === c.id_usuario ? 'is-ativo' : ''}`} onClick=${() => { setIdColega(c.id_usuario); setDataB(''); }}>
            <strong>${c.nome}</strong><small>${h ? `Trabalha ${h.entrada}–${h.saida}` : `${n} dia(s) disponível(is)`}</small></button>`; })}</div>`
        : html`<p class="mon-muted wfm-vazio-txt">${modo === 'turno' ? 'Nenhum colega com as mesmas skills trabalha neste dia.' : 'Nenhum colega com as mesmas skills tem outro dia de trabalho disponível nesta semana.'}</p>`}
      ${modo === 'dia' && colega ? html`<div class="wfm-dias-colega"><span class="mon-muted">Dia que você assume de ${colega.nome.split(' ')[0]}:</span>
        ${diasAssumiveis(colega).map(([d, h]) => html`<button key=${d} type="button" class=${`wfm-dia-opcao ${dataB === d ? 'is-ativo' : ''}`} onClick=${() => setDataB(d)}><strong>${rotuloDia(d)}</strong><small>${h.entrada}–${h.saida}</small></button>`)}</div>` : null}
    </div>

    ${pronto ? html`<div class="wfm-passo"><h4><span>3</span>Confirme</h4>
      <p class="wfm-resumo-troca">Você cede <b>${rotuloDia(iso)} · ${item.entrada}–${item.saida}</b> e assume <b>${rotuloDia(dataFinalB)} · ${horarioB.entrada}–${horarioB.saida}</b> de <b>${colega.nome}</b>.</p>
      <label class="wfm-campo"><span>Motivo (opcional)</span><input class="form-control" maxlength="300" value=${motivo} onInput=${(e) => setMotivo(e.target.value)} /></label>
      <p class="mon-muted wfm-vazio-txt">Seu colega precisa aceitar e depois o supervisor (ou o RH) aprova.</p></div>` : null}
    <div class="wfm-modal-rodape"><span></span><button type="button" class="btn btn-primary" disabled=${!pronto || enviando} onClick=${enviar}>${enviando ? 'Enviando…' : 'Enviar solicitação'}</button></div>
  </div>`;
}

function ModalDia({ data, itens = [], eventos, onClose, onTrocaEnviada, showToast, podeTrocar }) {
  const iso = paraIso(data);
  const trabalhando = itens.filter((i) => i.trabalha);
  const folga = itens[0];
  const [trocando, setTrocando] = useState(null); // item (escala) em troca
  return html`<${ModalPadrao} aberto=${true} titulo=${`${SEMANA[(data.getDay() + 6) % 7]}, ${br(data)}`} onClose=${onClose} className="wfm-modal">
    <div class="wfm-form-modal">
      ${trabalhando.length ? trabalhando.map((item) => {
        const motivo = motivoSemTroca(data, item);
        return html`<div key=${item.operacao} class="wfm-passo">
          ${trabalhando.length > 1 || item.nome_escala ? html`<h4>${item.nome_escala || item.operacao}</h4>` : null}
          <div class="wfm-dia-detalhe">
            <span class="wfm-chip" style=${{ '--wfm-cor': item.cor || 'var(--brand)' }}>${item.codigo}</span>
            <div><strong>${item.entrada} – ${item.saida}</strong><small>${minutosParaHoras(item.minutos)} de jornada</small></div>
          </div>
          ${(item.pausas || []).length ? html`<div class="wfm-passo"><h4>Suas pausas</h4><${Pausas} pausas=${item.pausas} /></div>` : html`<p class="mon-muted wfm-vazio-txt">Pausas ainda não programadas.</p>`}
          ${podeTrocar && trocando?.operacao !== item.operacao ? (motivo ? html`<p class="mon-muted wfm-vazio-txt">${motivo}</p>`
            : html`<div class="wfm-modal-rodape"><span></span><button type="button" class="btn btn-outline-primary" onClick=${() => setTrocando(item)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('compare_arrows')}</span>Trocar este plantão</button></div>`) : null}
          ${trocando?.operacao === item.operacao ? html`<${PedirTroca} operacao=${item.operacao} iso=${iso} item=${item} showToast=${showToast} onFeito=${onTrocaEnviada} />` : null}
        </div>`;
      }) : html`<p class="wfm-vazio-txt"><strong>${folga && folga.codigo !== 'DSR' ? 'Folga' : 'DSR'}</strong> — descanso semanal. Nada para trocar neste dia.</p>`}
      ${eventos.length ? html`<p class="mon-muted wfm-vazio-txt">${eventos.map((e) => e.descricao).join(' · ')}</p>` : null}
    </div>
  </${ModalPadrao}>`;
}

export function TelaMinhaEscala({ contexto, showToast, podeTrocar = false }) {
  const [modo, setModo] = useState('semana');
  const [ancora, setAncora] = useState(() => new Date());
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(null);
  const hoje = paraIso(new Date());

  const periodo = useMemo(() => {
    if (modo === 'semana') {
      const ini = segundaDe(ancora);
      return { ini, fim: somarDias(ini, 6), dias: Array.from({ length: 7 }, (_, i) => somarDias(ini, i)) };
    }
    const primeiro = new Date(ancora.getFullYear(), ancora.getMonth(), 1);
    const ultimo = new Date(ancora.getFullYear(), ancora.getMonth() + 1, 0);
    const ini = segundaDe(primeiro);
    const fim = somarDias(segundaDe(ultimo), 6);
    const n = Math.round((fim - ini) / 86400000) + 1;
    return { ini: primeiro, fim: ultimo, grade: Array.from({ length: n }, (_, i) => somarDias(ini, i)), dias: Array.from({ length: ultimo.getDate() }, (_, i) => new Date(ancora.getFullYear(), ancora.getMonth(), i + 1)) };
  }, [modo, ancora]);

  const carregar = useCallback(async () => {
    const chaves = (contexto?.operacoes || []).filter((o) => o.escala_ativa !== false).map((o) => o.chave);
    if (!chaves.length) return;
    setErro('');
    const meses = [...new Set((periodo.grade || periodo.dias).map(anoMesDe))];
    try {
      // Une todas as escalas em que a pessoa está (ex.: plantão de sábado + sobreaviso): cada dia pode ter
      // mais de um turno; o servidor impede que os horários se sobreponham ao montar a escala.
      const pares = chaves.flatMap((chave) => meses.map((m) => ({ chave, m })));
      const respostas = (await Promise.all(pares.map(({ chave, m }) => lerEscalaWfm(chave, m, true).then((r) => ({ ...r, chave }), () => null)))).filter(Boolean);
      if (!respostas.length) throw new Error('Não foi possível carregar a sua escala.');
      const itens = {};
      respostas.forEach((r) => {
        const cores = Object.fromEntries((r.turnos || []).map((t) => [t.codigo, t.cor]));
        (r.itens || []).forEach((i) => { (itens[i.data] = itens[i.data] || []).push({ ...i, cor: cores[i.codigo], operacao: r.chave, nome_escala: r.nome_escala, troca_antecedencia_dias: r.troca_antecedencia_dias }); });
      });
      Object.values(itens).forEach((lista) => lista.sort((a, b) => (b.trabalha ? 1 : 0) - (a.trabalha ? 1 : 0) || String(a.entrada || '').localeCompare(String(b.entrada || ''))));
      setDados({
        itens,
        eventos: respostas.flatMap((r) => r.eventos || []),
        publicada: respostas.some((r) => r.status.versao_publicada > 0),
      });
    } catch (e) {
      setDados(null);
      setErro(e?.message || 'Não foi possível carregar a sua escala.');
    }
  }, [contexto, periodo]);
  useEffect(() => { setDados(null); carregar(); }, [carregar]);

  const mover = (n) => setAncora((a) => (modo === 'semana' ? somarDias(a, 7 * n) : new Date(a.getFullYear(), a.getMonth() + n, 1)));

  const rotuloPeriodo = modo === 'semana'
    ? `${br(periodo.ini)} a ${br(periodo.fim)}`
    : `${MESES[periodo.ini.getMonth()]} de ${periodo.ini.getFullYear()}`;
  const escalados = dados ? periodo.dias.map((d) => dados.itens[paraIso(d)] || []).flat().filter((i) => i?.trabalha) : [];
  const totalMin = escalados.reduce((soma, i) => soma + (i.minutos || 0), 0);
  const eventosDoDia = (d) => (dados?.eventos || []).filter((e) => paraIso(d) >= e.data_ini && paraIso(d) <= e.data_fim);
  const abrir = (d) => setAberto(d);

  return html`
    <section class="mon-card wfm-minha">
      <div class="wfm-cabecalho wfm-cabecalho--centro">
        <div><h3>Minhas escalas</h3><p class="mon-muted">${rotuloPeriodo}${dados?.publicada ? ` · ${minutosParaHoras(totalMin)} em ${escalados.length} dia(s) de trabalho` : ''}</p></div>
        <div class="wfm-acoes-cab">
          <div class="wfm-alternador" role="group" aria-label="Visualização">
            <button type="button" class=${modo === 'semana' ? 'is-ativo' : ''} onClick=${() => setModo('semana')}>Semana</button>
            <button type="button" class=${modo === 'mes' ? 'is-ativo' : ''} onClick=${() => setModo('mes')}>Mês</button>
          </div>
          <button type="button" class="btn btn-outline-secondary btn-sm" aria-label=${modo === 'semana' ? 'Semana anterior' : 'Mês anterior'} onClick=${() => mover(-1)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('chevron_left')}</span></button>
          <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setAncora(new Date())}>Hoje</button>
          <button type="button" class="btn btn-outline-secondary btn-sm" aria-label=${modo === 'semana' ? 'Próxima semana' : 'Próximo mês'} onClick=${() => mover(1)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('chevron_right')}</span></button>
        </div>
      </div>
      ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`
        : !dados ? html`<${LoadingState} titulo="Carregando a sua escala" />`
        : !dados.publicada ? html`<${EmptyState} icon="calendar_month" title="Escala ainda não publicada" text="Assim que a escala deste período for publicada, ela aparece aqui." />`
        : html`
          <p class="mon-muted wfm-dica">Clique em um dia para ver as pausas ou pedir uma troca de plantão.</p>
          ${modo === 'semana' ? html`<div class="wfm-semana">${periodo.dias.map((d) => html`<${CartaoDia} key=${paraIso(d)} data=${d} itens=${dados.itens[paraIso(d)] || []} eventos=${eventosDoDia(d)} hoje=${hoje} compacto=${false} onAbrir=${abrir} />`)}</div>`
            : html`<div class="wfm-mes-cab">${SEMANA.map((s) => html`<span key=${s}>${s.slice(0, 3)}</span>`)}</div>
              <div class="wfm-mes">${periodo.grade.map((d) => (d.getMonth() === periodo.ini.getMonth()
                ? html`<${CartaoDia} key=${paraIso(d)} data=${d} itens=${dados.itens[paraIso(d)] || []} eventos=${eventosDoDia(d)} hoje=${hoje} compacto=${true} onAbrir=${abrir} />`
                : html`<div key=${paraIso(d)} class="wfm-dia is-fora"></div>`))}</div>`}`}
    </section>
    ${aberto ? html`<${ModalDia} podeTrocar=${podeTrocar} data=${aberto} itens=${dados?.itens[paraIso(aberto)] || []} eventos=${eventosDoDia(aberto)} showToast=${showToast} onClose=${() => setAberto(null)} onTrocaEnviada=${() => setAberto(null)} />` : null}`;
}
