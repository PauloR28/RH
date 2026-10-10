import { html, useCallback, useEffect, useMemo, useRef, useState } from '../../../infraestrutura-react.js';
import { EmptyState, LoadingState } from '../../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../../ui/icone.js';
import { lerEscalaWfm, listarColegasTrocaWfm, solicitarTrocaWfm } from '../../../services/api/wfm.js';
import { minutosParaHoras } from './comum.js';

// Visão do Operador: só a própria escala PUBLICADA. Calendário (semana ou mês) à esquerda e, à direita, o painel
// do dia selecionado (turno, jornada, pausas e o pedido de troca). Clicar num dia só seleciona: o modal de troca
// abre pelo botão do painel. Estilos: bloco "Minhas escalas" (.mc-*) no fim de estilos/wfm.css.

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
const nomeSemana = (d) => SEMANA[(d.getDay() + 6) % 7];
const rotuloDia = (iso) => `${nomeSemana(doIso(iso)).slice(0, 3)} ${brIso(iso).slice(0, 5)}`;
const tituloDia = (d) => `${nomeSemana(d)}, ${br(d)}`;
const faixa = (item) => `${item.entrada} – ${item.saida}`;
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const aMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const iniciais = (nome) => { const p = String(nome || '').trim().split(/\s+/).filter(Boolean); return p.length > 1 ? `${p[0][0]}${p[p.length - 1][0]}`.toUpperCase() : (p[0] || '?').slice(0, 2).toUpperCase(); };

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

const temPausas = (item) => (item?.pausas || []).length > 0;
const nomePausa = (p, i) => (p.tipo && p.tipo !== 'OUTRA' && ROTULO_PAUSA[p.tipo]) || `Pausa ${i + 1}`;

function Chip({ item, comum }) {
  const nome = String(item.nome_turno || item.codigo || '').toUpperCase();
  const classe = item.cor ? 'mc-chip' : `mc-chip ${item.codigo === comum ? 'is-solido' : 'is-contorno'}`;
  return html`<span class=${classe} title=${nome} style=${item.cor ? { '--mc-cor': item.cor } : undefined}>${nome}</span>`;
}

function PontoPausa({ programada }) {
  const rotulo = programada ? 'Pausas programadas' : 'Pausas a programar';
  return html`<span class=${`mc-ponto ${programada ? 'is-cheio' : 'is-anel'}`} role="img" aria-label=${rotulo} title=${rotulo}></span>`;
}

// ---------------------------------------------------------------- calendário

function CelulaDia({ data, itens, hoje, selecionado, comum, onSelecionar }) {
  const trabalhando = itens.filter((i) => i.trabalha);
  const iso = paraIso(data);
  const ehHoje = iso === hoje;
  const numero = String(data.getDate()).padStart(2, '0');
  if (!trabalhando.length) {
    const folga = itens[0] && itens[0].codigo !== 'DSR';
    return html`<div class="mc-dia is-dsr" aria-label=${`${tituloDia(data)}, ${folga ? 'folga' : 'DSR'}`}>
      <span class="mc-dia-num">${numero}</span><span class="mc-dia-sem">${nomeSemana(data).slice(0, 3)}</span>
      <span class="mc-dsr">${folga ? 'FOLGA' : 'DSR'}</span></div>`;
  }
  const descricao = trabalhando.map((it) => `${it.entrada} às ${it.saida}, ${it.nome_turno || it.codigo}, pausas ${temPausas(it) ? 'programadas' : 'a programar'}`).join('; ');
  const classe = `mc-dia ${ehHoje ? 'is-hoje' : ''} ${selecionado ? 'is-sel' : ''}`.trim();
  return html`<button type="button" class=${classe} aria-pressed=${selecionado} aria-current=${ehHoje ? 'date' : undefined}
    aria-label=${`${nomeSemana(data)}, ${data.getDate()} de ${MESES[data.getMonth()]}, ${descricao}`} onClick=${() => onSelecionar(iso)}>
    <span class="mc-dia-topo"><span class="mc-dia-num">${numero}</span><span class="mc-dia-sem">${nomeSemana(data).slice(0, 3)}</span>${ehHoje ? html`<span class="mc-hoje">HOJE</span>` : null}</span>
    ${trabalhando.map((it, i) => html`<span key=${i} class="mc-dia-bloco">
      <span class="mc-dia-horario">${it.entrada}–${it.saida}</span>
      <span class="mc-dia-pe"><${Chip} item=${it} comum=${comum} /><${PontoPausa} programada=${temPausas(it)} /></span>
    </span>`)}
  </button>`;
}

function Legenda({ tipos, comum }) {
  return html`<div class="mc-legenda" aria-label="Legenda">
    ${tipos.map((t) => html`<span key=${t.codigo} class="mc-legenda-item"><${Chip} item=${t} comum=${comum} /></span>`)}
    <span class="mc-legenda-item"><span class="mc-amostra-dsr" aria-hidden="true"></span>DSR</span>
    <span class="mc-legenda-item"><span class="mc-ponto is-cheio" aria-hidden="true"></span>Pausas programadas</span>
    <span class="mc-legenda-item"><span class="mc-ponto is-anel" aria-hidden="true"></span>Pausas a programar</span>
  </div>`;
}

// ---------------------------------------------------------------- painel do dia

// Reaproveitada pela administração da escala (Escala do dia e gaveta "Ajustar dia"): `mini` = só a barra de 96x8.
export function LinhaTempo({ item, mini = false }) {
  const ini = aMin(item.entrada);
  let total = aMin(item.saida) - ini;
  if (total <= 0) total += 1440;
  const barra = html`<div class=${`mc-tl-barra ${mini ? 'mc-tl-barra--mini' : ''}`} aria-hidden="true">${item.pausas.map((p, i) => {
    const off = ((aMin(p.inicio) - ini + 1440) % 1440) / total * 100;
    const larg = Math.min(p.duracao_min / total * 100, 100 - off);
    return html`<span key=${i} class="mc-tl-pausa" style=${{ left: `${off}%`, width: `${Math.max(larg, 1)}%` }}></span>`;
  })}</div>`;
  if (mini) return barra;
  return html`<div class="mc-tl">
    ${barra}
    <div class="mc-tl-horas"><span>${item.entrada}</span><span>${item.saida}</span></div>
  </div>`;
}

function BlocoTurno({ item, comum, mostrarEscala }) {
  const pausas = item.pausas || [];
  return html`<div class="mc-bloco">
    ${mostrarEscala ? html`<p class="mc-escala">${item.nome_escala || item.operacao}</p>` : null}
    <div class="mc-turno">
      <div class="mc-turno-linha"><${Chip} item=${item} comum=${comum} /><span>${minutosParaHoras(item.minutos)} de jornada</span></div>
      <div class="mc-turno-horario">${faixa(item)}</div>
    </div>
    <div class="mc-pausas">
      <div class="mc-pausas-cab"><h4>Pausas</h4>${pausas.length ? html`<span>${pausas.length} programada${pausas.length > 1 ? 's' : ''}</span>` : null}</div>
      ${pausas.length ? html`<${LinhaTempo} item=${item} />
        <ul class="mc-pausas-lista">${pausas.map((p, i) => {
          const fim = (aMin(p.inicio) + p.duracao_min) % 1440;
          const fimTxt = `${String(Math.floor(fim / 60)).padStart(2, '0')}:${String(fim % 60).padStart(2, '0')}`;
          return html`<li key=${i}><span class="mc-ponto is-cheio" aria-hidden="true"></span><span class="mc-pausa-nome">${nomePausa(p, i)}</span><span class="mc-pausa-int">${p.inicio} – ${fimTxt}</span><span class="mc-pausa-dur">${p.duracao_min} min</span></li>`;
        })}</ul>`
        : html`<p class="mc-pausas-vazio">Pausas ainda não programadas</p>`}
    </div>
  </div>`;
}

function PainelDia({ data, itens, eventos, comum, podeTrocar, onTrocar }) {
  const trabalhando = itens.filter((i) => i.trabalha);
  return html`<aside class="mc-painel" aria-label="Dia selecionado">
    <div><p class="mc-eyebrow">DIA SELECIONADO</p><h3 class="mc-painel-titulo">${tituloDia(data)}</h3></div>
    ${trabalhando.map((item) => {
      const motivo = podeTrocar ? motivoSemTroca(data, item) : '';
      const idAjuda = `mc-ajuda-${item.operacao}`;
      return html`<div key=${item.operacao} class="mc-painel-item">
        <${BlocoTurno} item=${item} comum=${comum} mostrarEscala=${trabalhando.length > 1 || !!item.nome_escala} />
        ${podeTrocar ? html`<hr class="mc-div" />
          <button type="button" class="btn btn-primary mc-btn-troca" disabled=${!!motivo} aria-describedby=${idAjuda} onClick=${() => onTrocar(item)}>Pedir troca de plantão</button>
          <p id=${idAjuda} class="mc-ajuda">${motivo || 'Troque só o turno ou o dia inteiro com um colega.'}</p>` : null}
      </div>`;
    })}
    ${eventos.length ? html`<p class="mc-ajuda mc-eventos">${eventos.map((e) => e.descricao).join(' · ')}</p>` : null}
  </aside>`;
}

// ---------------------------------------------------------------- modal de troca

function Avatar({ nome, ativo }) {
  return html`<span class=${`mc-avatar ${ativo ? 'is-ativo' : ''}`} aria-hidden="true">${iniciais(nome)}</span>`;
}

// Passo a passo: o que trocar → com quem → confirmar. Regras de negócio e payload iguais aos de antes.
function ModalTroca({ operacao, data, item, onClose, onFeito, showToast }) {
  const iso = paraIso(data);
  const [colegas, setColegas] = useState(null);
  const [modo, setModo] = useState('turno'); // 'turno' = mesmo dia | 'dia' = assumo outro dia do colega
  const [idColega, setIdColega] = useState(null);
  const [dataB, setDataB] = useState('');
  const [motivo, setMotivo] = useState('');
  const [busca, setBusca] = useState('');
  const [horario, setHorario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const caixa = useRef(null);
  const fechar = useRef(onClose);
  fechar.current = onClose;
  useEffect(() => { listarColegasTrocaWfm(operacao).then((r) => setColegas(r.itens || [])).catch(() => setColegas([])); }, [operacao]);

  // Foco: entra no diálogo, Tab circula dentro dele, Esc fecha e o foco volta para quem abriu.
  useEffect(() => {
    const anterior = document.activeElement;
    const el = caixa.current;
    el?.querySelector('input[type="radio"]:checked')?.focus();
    const aoTeclar = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); fechar.current(); return; }
      if (e.key !== 'Tab' || !el) return;
      const foco = [...el.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href]')].filter((n) => n.offsetParent !== null);
      if (!foco.length) return;
      const primeiro = foco[0]; const ultimo = foco[foco.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    };
    document.addEventListener('keydown', aoTeclar);
    return () => { document.removeEventListener('keydown', aoTeclar); anterior?.focus?.(); };
  }, []);

  const limite = Date.now() + (item?.troca_antecedencia_dias ?? 3) * 24 * 3600 * 1000;
  const diasAssumiveis = (c) => Object.entries(c.dias || {}).filter(([d, h]) => d !== iso && doIso(d).setHours(Number(h.entrada.slice(0, 2)), Number(h.entrada.slice(3)), 0, 0) >= limite).sort(([a], [b]) => a.localeCompare(b));
  const compativeis = (colegas || []).filter((c) => c.compativel);
  const opcoes = compativeis.filter((c) => (modo === 'turno' ? c.dias?.[iso] : diasAssumiveis(c).length > 0));
  const horarios = modo === 'turno' ? [...new Set(opcoes.map((c) => faixa(c.dias[iso])))].sort() : [];
  const termo = semAcento(busca.trim());
  const filtradas = opcoes.filter((c) => (!termo || semAcento(c.nome).includes(termo)) && (!horario || modo !== 'turno' || faixa(c.dias[iso]) === horario));
  const filtrando = !!termo || !!horario;
  const colega = (colegas || []).find((c) => c.id_usuario === idColega);
  const dataFinalB = modo === 'turno' ? iso : dataB;
  const horarioB = colega?.dias?.[dataFinalB];
  const pronto = !!colega && !!horarioB;

  const trocarModo = (m) => { setModo(m); setIdColega(null); setDataB(''); setHorario(''); };
  const limpar = () => { setBusca(''); setHorario(''); };
  const enviar = async () => {
    setEnviando(true);
    try {
      await solicitarTrocaWfm({ operacao, id_alvo: colega.id_usuario, data_a: iso, data_b: dataFinalB, motivo });
      showToast?.('Troca solicitada. Seu colega tem 48 horas úteis para responder.', 'success');
      onFeito();
    } catch (err) { showToast?.(err?.message || 'Não foi possível solicitar a troca.', 'error'); } finally { setEnviando(false); }
  };

  const contagem = `${filtradas.length} operador${filtradas.length === 1 ? '' : 'es'} ${filtrando ? (filtradas.length === 1 ? 'encontrado' : 'encontrados') : (modo === 'turno' ? (filtradas.length === 1 ? 'trabalha neste dia' : 'trabalham neste dia') : (filtradas.length === 1 ? 'tem outro dia disponível' : 'têm outro dia disponível'))}`;
  const resumo = pronto ? (modo === 'turno'
    ? { voce: [faixa(item), faixa(horarioB)], colega: [faixa(horarioB), faixa(item)] }
    : { voce: [`${rotuloDia(iso)} · ${faixa(item)}`, `${rotuloDia(dataFinalB)} · ${faixa(horarioB)}`], colega: [`${rotuloDia(dataFinalB)} · ${faixa(horarioB)}`, `${rotuloDia(iso)} · ${faixa(item)}`] }) : null;

  return html`<div class="rh-modal-overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="mc-modal c24-fade-in" role="dialog" aria-modal="true" aria-labelledby="mc-modal-titulo" ref=${caixa}>
      <header class="mc-modal-cab">
        <div><h3 id="mc-modal-titulo">${tituloDia(data)}</h3><p>Pedir troca de plantão</p></div>
        <button type="button" class="mc-fechar" aria-label="Fechar" onClick=${onClose}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('close')}</span></button>
      </header>

      <div class="mc-meu-turno"><${Chip} item=${item} comum=${item.codigo} /><strong>${faixa(item)}</strong><span>${minutosParaHoras(item.minutos)} · seu turno neste dia</span></div>

      <fieldset class="mc-passo"><legend><span class="mc-num">1</span>O QUE VOCÊ QUER TROCAR?</legend>
        <div class="mc-opcoes" role="radiogroup">
          ${[['turno', 'Só o turno', 'Mesmo dia: vocês trocam de horário.'], ['dia', 'O dia inteiro', 'Você cede este dia e assume outro dia do colega.']].map(([valor, titulo, desc]) => html`
            <label key=${valor} class=${`mc-opcao ${modo === valor ? 'is-ativa' : ''}`}>
              <input type="radio" name="mc-modo" class="mc-radio-oculto" checked=${modo === valor} onChange=${() => trocarModo(valor)} />
              <strong>${titulo}</strong><small>${desc}</small></label>`)}
        </div></fieldset>

      <fieldset class="mc-passo"><legend><span class="mc-num">2</span>COM QUEM?</legend>
        ${colegas === null ? html`<p class="mc-vazio-txt">Carregando colegas…</p>` : html`
          <div class="mc-controles">
            <label class="mc-busca"><span class="visually-hidden">Buscar operador por nome</span>
              <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('search')}</span>
              <input type="search" class="form-control" placeholder="Buscar operador por nome" value=${busca} onInput=${(e) => setBusca(e.target.value)} /></label>
            ${modo === 'turno' && horarios.length > 1 ? html`<label class="mc-filtro-horario"><span class="visually-hidden">Filtrar por horário</span>
              <select class="form-select" value=${horario} onChange=${(e) => setHorario(e.target.value)}>
                <option value="">Todos os horários</option>${horarios.map((h) => html`<option key=${h} value=${h}>${h}</option>`)}
              </select></label>` : null}
          </div>
          <p class="mc-contagem" aria-live="polite">${opcoes.length ? contagem : ''}</p>
          ${filtradas.length ? html`<div class="mc-lista" role="radiogroup" aria-label="Operadores">${filtradas.map((c) => {
            const ativo = idColega === c.id_usuario;
            return html`<label key=${c.id_usuario} class=${`mc-linha ${ativo ? 'is-ativa' : ''}`}>
              <input type="radio" name="mc-colega" class="mc-radio-oculto" checked=${ativo} onChange=${() => { setIdColega(c.id_usuario); setDataB(''); }} />
              <${Avatar} nome=${c.nome} ativo=${ativo} />
              <span class="mc-linha-nome">${c.nome}</span>
              <span class="mc-linha-horario">${modo === 'turno' ? faixa(c.dias[iso]) : `${diasAssumiveis(c).length} dia(s)`}</span>
              <span class="mc-indicador" aria-hidden="true"></span></label>`; })}</div>`
            : html`<div class="mc-lista mc-lista-vazia">${opcoes.length
              ? html`<p>Nenhum operador encontrado</p><button type="button" class="mc-link" onClick=${limpar}>Limpar busca e filtros</button>`
              : html`<p>${modo === 'turno' ? 'Nenhum colega com as mesmas skills trabalha neste dia.' : 'Nenhum colega com as mesmas skills tem outro dia de trabalho disponível nesta semana.'}</p>`}</div>`}
          ${modo === 'dia' && colega ? html`<div class="mc-dias-colega" role="radiogroup" aria-label=${`Dia que você assume de ${colega.nome.split(' ')[0]}`}>
            <span>Dia que você assume de ${colega.nome.split(' ')[0]}:</span>
            ${diasAssumiveis(colega).map(([d, h]) => html`<label key=${d} class=${`mc-dia-opcao ${dataB === d ? 'is-ativa' : ''}`}>
              <input type="radio" name="mc-dia-b" class="mc-radio-oculto" checked=${dataB === d} onChange=${() => setDataB(d)} /><strong>${rotuloDia(d)}</strong><small>${h.entrada}–${h.saida}</small></label>`)}</div>` : null}`}
      </fieldset>

      ${resumo ? html`<section class="mc-resumo" aria-label="Resumo da troca">
        <h4>RESUMO DA TROCA · ${brIso(iso).slice(0, 5)}</h4>
        ${[['Você', resumo.voce], [colega.nome, resumo.colega]].map(([quem, [de, para]]) => html`<div key=${quem} class="mc-resumo-linha">
          <span class="mc-resumo-nome">${quem}</span><span class="mc-resumo-de">${de}</span>
          <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('arrow_forward')}</span><b class="mc-resumo-para">${para}</b></div>`)}
        <label class="mc-motivo"><span>Motivo (opcional)</span><input class="form-control" maxlength="300" value=${motivo} onInput=${(e) => setMotivo(e.target.value)} /></label>
        <p class="mc-ajuda">Seu colega precisa aceitar e depois o supervisor (ou o RH) aprova.</p>
      </section>` : null}

      <footer class="mc-modal-rodape">
        <button type="button" class="btn btn-outline-secondary" onClick=${onClose}>Cancelar</button>
        <button type="button" class="btn btn-primary" disabled=${!pronto || enviando} onClick=${enviar}>${enviando ? 'Enviando…' : 'Enviar solicitação'}</button>
      </footer>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- tela

export function TelaMinhaEscala({ contexto, showToast, podeTrocar = false }) {
  const [modo, setModo] = useState('semana');
  const [ancora, setAncora] = useState(() => new Date());
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [sel, setSel] = useState(null);
  const [trocando, setTrocando] = useState(null); // item (escala) em troca
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
        const turnos = Object.fromEntries((r.turnos || []).map((t) => [t.codigo, t]));
        (r.itens || []).forEach((i) => { (itens[i.data] = itens[i.data] || []).push({ ...i, cor: turnos[i.codigo]?.cor, nome_turno: turnos[i.codigo]?.nome, operacao: r.chave, nome_escala: r.nome_escala, troca_antecedencia_dias: r.troca_antecedencia_dias }); });
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

  const trabalha = useCallback((iso) => (dados?.itens[iso] || []).some((i) => i.trabalha), [dados]);

  // Seleção: mantém o dia escolhido enquanto ele existir no período; senão hoje (se trabalha) ou o 1º dia de trabalho.
  useEffect(() => {
    if (!dados) return;
    const noPeriodo = (iso) => periodo.dias.some((d) => paraIso(d) === iso) && trabalha(iso);
    setSel((atual) => {
      if (atual && noPeriodo(atual)) return atual;
      if (noPeriodo(hoje)) return hoje;
      const primeiro = periodo.dias.map(paraIso).find(trabalha);
      return primeiro || null;
    });
  }, [dados, periodo, trabalha, hoje]);

  const mover = (n) => setAncora((a) => (modo === 'semana' ? somarDias(a, 7 * n) : new Date(a.getFullYear(), a.getMonth() + n, 1)));
  const irHoje = () => { setAncora(new Date()); setSel(hoje); };

  const rotuloPeriodo = modo === 'semana' ? `${br(periodo.ini)} a ${br(periodo.fim)}` : `${MESES[periodo.ini.getMonth()]} de ${periodo.ini.getFullYear()}`;
  const itensPeriodo = dados ? periodo.dias.flatMap((d) => dados.itens[paraIso(d)] || []) : [];
  const escalados = itensPeriodo.filter((i) => i.trabalha);
  const diasTrabalho = dados ? periodo.dias.filter((d) => trabalha(paraIso(d))).length : 0;
  const diasDsr = dados ? periodo.dias.filter((d) => { const l = dados.itens[paraIso(d)] || []; return l.length && !l.some((i) => i.trabalha) && l[0].codigo === 'DSR'; }).length : 0;
  const totalMin = escalados.reduce((soma, i) => soma + (i.minutos || 0), 0);
  const eventosDoDia = (d) => (dados?.eventos || []).filter((e) => paraIso(d) >= e.data_ini && paraIso(d) <= e.data_fim);

  // Tipos de turno que aparecem no período (legenda) e o mais comum (preenchimento de quem não tem cor).
  const tipos = []; const contagem = {};
  escalados.forEach((i) => { contagem[i.codigo] = (contagem[i.codigo] || 0) + 1; if (!tipos.some((t) => t.codigo === i.codigo)) tipos.push(i); });
  const comum = Object.keys(contagem).sort((a, b) => contagem[b] - contagem[a])[0];

  const dataSel = sel ? doIso(sel) : null;
  const cabecalho = html`<div class="mc-dias-cab" aria-hidden="true">${SEMANA.map((s) => html`<span key=${s}>${s.slice(0, 3).toUpperCase()}</span>`)}</div>`;
  const celula = (d) => html`<${CelulaDia} key=${paraIso(d)} data=${d} itens=${dados.itens[paraIso(d)] || []} hoje=${hoje} selecionado=${paraIso(d) === sel} comum=${comum} onSelecionar=${setSel} />`;

  return html`
    <section class="mon-card wfm-minha mc-card">
      <div class="mc-barra">
        <div class="mc-barra-esq">
          <h3 class="mc-mes">${rotuloPeriodo}</h3>
          <div class="mc-nav">
            <button type="button" class="mc-btn mc-btn-icone" aria-label=${modo === 'semana' ? 'Semana anterior' : 'Mês anterior'} onClick=${() => mover(-1)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('chevron_left')}</span></button>
            <button type="button" class="mc-btn" onClick=${irHoje}>Hoje</button>
            <button type="button" class="mc-btn mc-btn-icone" aria-label=${modo === 'semana' ? 'Próxima semana' : 'Próximo mês'} onClick=${() => mover(1)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('chevron_right')}</span></button>
          </div>
        </div>
        ${dados?.publicada ? html`<dl class="mc-totais">
          <div><dd>${diasTrabalho}</dd><dt>dias de trabalho</dt></div>
          <div><dd>${minutosParaHoras(totalMin)}</dd><dt>${modo === 'semana' ? 'na semana' : 'no mês'}</dt></div>
          <div><dd>${diasDsr}</dd><dt>DSR</dt></div>
        </dl>` : html`<span></span>`}
        <div class="mc-seg" role="group" aria-label="Visualização">
          <button type="button" aria-pressed=${modo === 'semana'} class=${modo === 'semana' ? 'is-ativo' : ''} onClick=${() => setModo('semana')}>Semana</button>
          <button type="button" aria-pressed=${modo === 'mes'} class=${modo === 'mes' ? 'is-ativo' : ''} onClick=${() => setModo('mes')}>Mês</button>
        </div>
      </div>
      ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`
        : !dados ? html`<${LoadingState} titulo="Carregando a sua escala" />`
        : !dados.publicada ? html`<${EmptyState} icon="calendar_month" title="Escala ainda não publicada" text="Assim que a escala deste período for publicada, ela aparece aqui." />`
        : html`<div class="mc-corpo">
          <div class="mc-grade-col">
            ${cabecalho}
            <div class=${`mc-grade ${modo === 'semana' ? 'is-semana' : ''}`}>${modo === 'semana' ? periodo.dias.map(celula)
              : periodo.grade.map((d) => (d.getMonth() === periodo.ini.getMonth() ? celula(d) : html`<div key=${paraIso(d)} class="mc-fora" aria-hidden="true"></div>`))}</div>
            <${Legenda} tipos=${tipos} comum=${comum} />
          </div>
          ${dataSel ? html`<${PainelDia} data=${dataSel} itens=${dados.itens[sel] || []} eventos=${eventosDoDia(dataSel)} comum=${comum} podeTrocar=${podeTrocar} onTrocar=${setTrocando} />` : null}
        </div>`}
    </section>
    ${trocando && dataSel ? html`<${ModalTroca} operacao=${trocando.operacao} data=${dataSel} item=${trocando} showToast=${showToast} onClose=${() => setTrocando(null)} onFeito=${() => setTrocando(null)} />` : null}`;
}
