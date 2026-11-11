import { html, useCallback, useEffect, useMemo, useState } from '../../../infraestrutura-react.js';
import { lerEscalaWfm, listarColegasTrocaWfm, listarTrocasWfm, solicitarTrocaWfm } from '../../../services/api/wfm.js?v=20261111-modulos-op';
import { TextoFormal, textoTrocaOperador } from './trocas-texto.js?v=20261111-texto';
import { horasMin, ROTULO_STATUS_PRESENCA } from './comum.js?v=20261111-modulos-op';
import { Campo, Esqueleto, Estado, Faixa, Ic, Janela, Navegar, Segmento, Selo } from '../../../ui/components/ds.js?v=20261106-wfm';

// Minha escala (redesign Fase 15, amostras "Minha escala" e "Pedir troca" da Fase 14). Só a própria escala PUBLICADA.
// Duas visões do mês: Planilha (um dia por linha) e Calendário. O detalhe do dia (jornada, pausas, presença) abre no
// painel lateral; "Pedir troca" abre a janela da troca. Regras e payload da troca iguais aos de antes; o servidor valida.

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
const rotuloDia = (iso) => `${nomeSemana(doIso(iso)).slice(0, 3).toLowerCase()}, ${brIso(iso).slice(0, 5)}`;
const tituloDia = (d) => `${nomeSemana(d)}, ${br(d)}`;
const faixa = (item) => `${item.entrada}–${item.saida}`;
const rotuloHorario = (item) => (item?.entrada ? faixa(item) : 'Folga'); // folga não tem horário
// Dia sem horário: o que a pessoa vê. Folga e DSR podem entrar numa troca; Férias e Escalado (horário por definir) não.
const ROTULO_SEM_HORARIO = { FOLGA: 'Folga', DSR: 'DSR', FERIAS: 'Férias', ESCALADO: 'Escalado', SOBREAVISO: 'Sobreaviso' };
const TIPOS_FOLGA = ['FOLGA', 'DSR'];
const aMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
// Troca em andamento no dia (pedidos do próprio operador, ou que ele recebeu): selo na Situação.
const SELO_TROCA = { AGUARDANDO_B: ['Pendente aceitação', 'atencao'], AGUARDANDO_APROVACAO: ['Aguardando aprovação', 'informacao'] };
function SeloTroca({ estado }) {
  const s = SELO_TROCA[estado];
  return s ? html`<${Selo} tom=${s[1]} icone="arrows-left-right">${s[0]}<//>` : null;
}
const TOM_PRESENCA = { PRESENTE: 'sucesso', FALTA: 'perigo', FALTA_JUSTIFICADA: 'atencao', ATESTADO: 'informacao' };
const ICONE_PRESENCA = { PRESENTE: 'check-circle', FALTA: 'x-circle', FALTA_JUSTIFICADA: 'warning', ATESTADO: 'file-text' };

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

const nomePausa = (p, i) => (p.tipo && p.tipo !== 'OUTRA' && ROTULO_PAUSA[p.tipo]) || `Pausa ${i + 1}`;
const fimPausa = (p) => { const fim = (aMin(p.inicio) + p.duracao_min) % 1440; return `${String(Math.floor(fim / 60)).padStart(2, '0')}:${String(fim % 60).padStart(2, '0')}`; };

// Traço colorido + nome do turno (a cor do turno vem do cadastro; sem cor, o traço usa a cor de ação).
function Turno({ item }) {
  const nome = item.nome_turno || item.codigo || '';
  return html`<span class="c-turno-linha"><span class="c-traco" style=${{ '--t': item.cor || 'var(--cor-acao-fundo)' }}></span>${nome}</span>`;
}

function SeloPresenca({ presenca }) {
  if (!presenca) return null;
  return html`<${Selo} tom=${TOM_PRESENCA[presenca.status] || 'neutro'} icone=${ICONE_PRESENCA[presenca.status] || ''}>${ROTULO_STATUS_PRESENCA[presenca.status] || presenca.status}<//>`;
}

// ---------------------------------------------------------------- linha do tempo (também usada pela Escala do dia)

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

// ---------------------------------------------------------------- detalhe do dia (painel lateral)

function PainelDia({ data, itens, eventos, presenca, podeTrocar, folga, onTrocar, onClose }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  const trabalhando = itens.filter((i) => i.trabalha);
  const passado = paraIso(data) < paraIso(new Date());
  return html`<aside class="c-painel-lateral c-diario c-ds" role="dialog" aria-label=${`Dia ${tituloDia(data)}`}>
    <div class="c-janela-cab">
      <h2>${tituloDia(data)}<small>${trabalhando.length ? trabalhando.map((i) => i.nome_escala || i.operacao).join(' · ') : folga ? 'Sua folga' : 'Sem turno'}</small></h2>
      <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Fechar" title="Fechar" onClick=${onClose}><${Ic} nome="x" /></button>
    </div>
    <div class="c-janela-corpo">
      ${presenca ? html`<div><${SeloPresenca} presenca=${presenca} />${presenca.observacao && !String(presenca.lancado_por || '').startsWith('Automática') && !String(presenca.observacao).startsWith('Presença automática') ? html` <span class="c-ajuda">${presenca.observacao}</span>` : null}</div>`
        : passado && trabalhando.length ? html`<div><${Selo} tom="neutro">Presença não lançada<//></div>` : null}
      ${trabalhando.map((item) => {
        const pausas = item.pausas || [];
        const motivo = podeTrocar ? motivoSemTroca(data, item) : '';
        return html`<div key=${item.operacao} class="c-dia-secao">
          <table class="c-diario-ficha"><tbody>
            <tr><td>Turno</td><td><${Turno} item=${item} /></td></tr>
            <tr><td>Horário</td><td><b>${faixa(item)}</b> · ${horasMin(item.minutos)} de jornada</td></tr>
          </tbody></table>
          <div>
            <h3>Pausas ${pausas.length ? `(${pausas.length})` : ''}</h3>
            ${pausas.length ? html`<${LinhaTempo} item=${item} />
              <table class="c-diario-ficha"><tbody>${pausas.map((p, i) => html`<tr key=${i}><td>${nomePausa(p, i)}</td><td>${p.inicio}–${fimPausa(p)} · ${p.duracao_min} min</td></tr>`)}</tbody></table>`
              : html`<p class="c-ajuda">Pausas ainda não programadas.</p>`}
          </div>
          ${podeTrocar ? html`<div class="c-grupo">
            <button type="button" class="c-botao c-botao--secundario" disabled=${!!motivo || null} onClick=${() => onTrocar(item)}><${Ic} nome="arrows-left-right" />Pedir troca de plantão</button>
            <span class="c-ajuda">${motivo || 'Troque só o turno ou o dia inteiro com um colega.'}</span>
          </div>` : null}
        </div>`;
      })}
      ${!trabalhando.length && folga ? html`<div class="c-dia-secao">
        <p>Você está de folga neste dia.</p>
        <div class="c-grupo">
          <button type="button" class="c-botao c-botao--secundario" onClick=${() => onTrocar({ ...folga, folga: true })}><${Ic} nome="arrows-left-right" />Pedir troca de folga</button>
          <span class="c-ajuda">Você assume o turno de um colega neste dia e a sua folga passa para essa pessoa.</span>
        </div>
      </div>` : null}
      ${eventos.length ? html`<${Faixa} tom="informacao" icone="calendar-dots">${eventos.map((e) => e.descricao).join(' · ')}<//>` : null}
    </div>
  </aside>`;
}

// ---------------------------------------------------------------- janela "Pedir troca"

// O que trocar → com quem → conferir e enviar. Regras de negócio e payload iguais aos de antes.
function JanelaTroca({ operacao, data, item, nomeUsuario, onClose, onFeito, showToast }) {
  const iso = paraIso(data);
  const [colegas, setColegas] = useState(null);
  const [modo, setModo] = useState('turno'); // 'turno' = mesmo dia | 'dia' = assumo outro dia do colega
  const [idColega, setIdColega] = useState('');
  const [dataB, setDataB] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [ciente, setCiente] = useState(false);
  useEffect(() => { listarColegasTrocaWfm(operacao).then((r) => setColegas(r.itens || [])).catch(() => setColegas([])); }, [operacao]);

  const ehFolga = !!item.folga; // troca de folga: a pessoa assume o turno de um colega que trabalha neste dia
  const limite = Date.now() + (item?.troca_antecedencia_dias ?? 3) * 24 * 3600 * 1000;
  const comAntecedencia = (h) => doIso(iso).setHours(Number(h.entrada.slice(0, 2)), Number(h.entrada.slice(3)), 0, 0) >= limite;
  const diasAssumiveis = (c) => Object.entries(c.dias || {}).filter(([d, h]) => d !== iso && doIso(d).setHours(Number(h.entrada.slice(0, 2)), Number(h.entrada.slice(3)), 0, 0) >= limite).sort(([a], [b]) => a.localeCompare(b));
  // Mesmo dia: o colega trabalha (troca de horário) ou, para quem trabalha, também pode estar de folga (a folga dele passa para você).
  const diaDoColega = (c) => (c.dias?.[iso] && (!ehFolga || comAntecedencia(c.dias[iso]))) ? c.dias[iso] : (ehFolga ? null : c.folgas?.[iso] || null);
  const horarioDe = (c) => rotuloHorario(diaDoColega(c));
  const compativeis = (colegas || []).filter((c) => c.compativel);
  const opcoes = compativeis.filter((c) => (modo === 'turno' ? !!diaDoColega(c) : diasAssumiveis(c).length > 0))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const colega = (colegas || []).find((c) => String(c.id_usuario) === String(idColega));
  const dataFinalB = modo === 'turno' ? iso : dataB;
  const horarioB = modo === 'turno' ? (colega && diaDoColega(colega)) : colega?.dias?.[dataFinalB];
  const pronto = !!colega && !!horarioB;
  const meuHorario = rotuloHorario(item);
  const primeiroNome = (n) => String(n || '').split(' ')[0];

  const trocarModo = (m) => { setCiente(false); setModo(m); setIdColega(''); setDataB(''); };
  const enviar = async () => {
    setEnviando(true);
    try {
      await solicitarTrocaWfm({ operacao, id_alvo: colega.id_usuario, data_a: iso, data_b: dataFinalB, motivo });
      showToast?.('Troca solicitada. Seu colega tem 48 horas úteis para responder.', 'success');
      onFeito();
    } catch (err) { showToast?.(err?.message || 'Não foi possível solicitar a troca.', 'error'); } finally { setEnviando(false); }
  };

  const resumo = pronto ? (modo === 'turno'
    ? { voce: [meuHorario, rotuloHorario(horarioB)], colega: [rotuloHorario(horarioB), meuHorario] }
    : { voce: [`${rotuloDia(iso)} · ${faixa(item)}`, `${rotuloDia(dataFinalB)} · ${faixa(horarioB)}`], colega: [`${rotuloDia(dataFinalB)} · ${faixa(horarioB)}`, `${rotuloDia(iso)} · ${faixa(item)}`] }) : null;
  const opcoesModo = [['turno', 'Só o turno'], ['dia', 'O dia inteiro']];
  const ajudaModo = ehFolga ? 'Você assume o turno de um colega neste dia e a sua folga passa para essa pessoa.'
    : modo === 'turno' ? 'Mesmo dia: vocês trocam de horário (ou de folga, se o colega estiver de folga).' : 'Você cede este dia e assume outro dia do colega.';
  const vazio = modo === 'turno' ? (ehFolga ? 'Nenhum colega com as mesmas skills trabalha neste dia.' : 'Nenhum colega com as mesmas skills trabalha ou está de folga neste dia.')
    : 'Nenhum colega com as mesmas skills tem outro dia de trabalho disponível.';

  return html`<${Janela} titulo=${`${ehFolga ? 'Pedir troca de folga' : 'Pedir troca'} · ${rotuloDia(iso)}`} onClose=${onClose}
    rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${onClose}>Cancelar</button>
      <button type="button" class="c-botao c-botao--principal" aria-busy=${enviando ? 'true' : null} disabled=${!pronto || !ciente || !motivo.trim() || enviando || null} onClick=${enviar}><${Ic} nome="arrows-left-right" />${enviando ? 'Enviando…' : 'Enviar pedido'}</button>`}>
    <div class="c-janela-corpo">
      <p>${ehFolga ? 'Sua folga neste dia.' : html`Seu turno neste dia: <b>${meuHorario}</b> · ${horasMin(item.minutos)}.`}</p>
      ${ehFolga ? html`<p class="c-ajuda">${ajudaModo}</p>` : html`<div class="c-campo">
        <span class="c-rotulo">O que você quer trocar?</span>
        <${Segmento} rotulo="O que trocar" valor=${modo} aoMudar=${trocarModo} opcoes=${opcoesModo} />
        <span class="c-ajuda">${ajudaModo}</span>
      </div>`}
      ${colegas === null ? html`<${Esqueleto} linhas=${2} />` : opcoes.length ? html`
        <${Campo} rotulo="Trocar com" ajuda="Só aparecem colegas com as mesmas skills.">
          <select class="c-entrada" autofocus value=${idColega} onChange=${(e) => { setIdColega(e.target.value); setDataB(''); setCiente(false); }}>
            <option value="">Escolha o colega</option>
            ${opcoes.map((c) => html`<option key=${c.id_usuario} value=${c.id_usuario}>${c.nome} · ${modo === 'turno' ? horarioDe(c) : `${diasAssumiveis(c).length} dia(s) disponível(is)`}</option>`)}
          </select>
        <//>
        ${modo === 'dia' && colega ? html`<${Campo} rotulo=${`Dia que você assume de ${primeiroNome(colega.nome)}`}>
          <select class="c-entrada" value=${dataB} onChange=${(e) => { setDataB(e.target.value); setCiente(false); }}>
            <option value="">Escolha o dia</option>
            ${diasAssumiveis(colega).map(([d, h]) => html`<option key=${d} value=${d}>${rotuloDia(d)} · ${h.entrada}–${h.saida}</option>`)}
          </select>
        <//>` : null}`
        : html`<${Faixa} tom="informacao" icone="info">${vazio}<//>`}
      ${resumo ? html`
        <div class="c-tabela-caixa"><table class="c-tabela c-tabela--compacta">
          <thead><tr><th scope="col"></th><th scope="col">Hoje</th><th scope="col">Depois da troca</th></tr></thead>
          <tbody>
            <tr><td class="c-forte">Você</td><td>${resumo.voce[0]}</td><td class="c-forte">${resumo.voce[1]}</td></tr>
            <tr><td class="c-forte">${primeiroNome(colega.nome)}</td><td>${resumo.colega[0]}</td><td class="c-forte">${resumo.colega[1]}</td></tr>
          </tbody>
        </table></div>
        <${Campo} rotulo="Motivo" erro=${motivo.trim() ? '' : 'Escreva o motivo'} ajuda=${`Obrigatório. ${primeiroNome(colega.nome)} e o supervisor leem este texto.`}>
          <textarea class="c-entrada" rows="2" maxlength="300" placeholder="Ex.: consulta médica de manhã" value=${motivo} onInput=${(e) => setMotivo(e.target.value)}></textarea>
        <//>
        <${TextoFormal} texto=${textoTrocaOperador({ dataA: iso, dataB: dataFinalB, nomeA: nomeUsuario || 'Você', nomeB: colega.nome, horario: modo === 'turno' ? `${meuHorario} (${nomeUsuario ? primeiroNome(nomeUsuario) : 'você'}) e ${rotuloHorario(horarioB)} (${primeiroNome(colega.nome)})` : `${rotuloDia(iso)} ${faixa(item)} e ${rotuloDia(dataFinalB)} ${faixa(horarioB)}` })} />
        <label class="c-marcar"><input type="checkbox" checked=${ciente} onChange=${(e) => setCiente(e.target.checked)} /><span>Estou ciente</span></label>
        <p class="c-ajuda">Depois de enviar: ${primeiroNome(colega.nome)} aceita ou recusa. Se aceitar, o supervisor (ou o RH) aprova.</p>` : null}
    </div>
  <//>`;
}

// ---------------------------------------------------------------- tela

export function TelaMinhaEscala({ contexto, showToast, podeTrocar = false, nomeUsuario = '', acessorio = null }) {
  const [visao, setVisao] = useState('planilha'); // planilha | calendario
  const [ancora, setAncora] = useState(() => new Date());
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(null); // dia no painel lateral
  const [trocando, setTrocando] = useState(null); // { item, data } em troca
  const hoje = paraIso(new Date());

  const periodo = useMemo(() => {
    const primeiro = new Date(ancora.getFullYear(), ancora.getMonth(), 1);
    const ultimo = new Date(ancora.getFullYear(), ancora.getMonth() + 1, 0);
    const ini = segundaDe(primeiro);
    const fim = somarDias(segundaDe(ultimo), 6);
    const n = Math.round((fim - ini) / 86400000) + 1;
    return { ini: primeiro, fim: ultimo, grade: Array.from({ length: n }, (_, i) => somarDias(ini, i)), dias: Array.from({ length: ultimo.getDate() }, (_, i) => new Date(ancora.getFullYear(), ancora.getMonth(), i + 1)) };
  }, [ancora]);

  const carregar = useCallback(async () => {
    const chaves = (contexto?.operacoes || []).filter((o) => o.escala_ativa !== false).map((o) => o.chave);
    if (!chaves.length) return;
    setErro('');
    const meses = [...new Set(periodo.grade.map(anoMesDe))];
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
      // Dia sem lançamento num mês em que a pessoa está escalada conta como folga (dá para trocar). Fica fora de `itens`: não entra nos totais.
      const porEscala = {};
      respostas.forEach((r) => { const e = (porEscala[r.chave] = porEscala[r.chave] || { r, datas: new Set() }); (r.itens || []).forEach((i) => e.datas.add(i.data)); });
      const livres = {};
      Object.values(porEscala).forEach(({ r, datas }) => {
        const mesesEscala = new Set([...datas].map((x) => x.slice(0, 7)));
        periodo.dias.forEach((d) => {
          const iso = paraIso(d);
          if (datas.has(iso) || !mesesEscala.has(iso.slice(0, 7))) return;
          (livres[iso] = livres[iso] || []).push({ data: iso, operacao: r.chave, nome_escala: r.nome_escala, troca_antecedencia_dias: r.troca_antecedencia_dias, trabalha: false, tipo: 'SEM_LANCAMENTO', codigo: 'FOLGA', nome_turno: 'Folga' });
        });
      });
      // Trocas em andamento: o operador só recebe as dele (escopo do servidor). Falha aqui não impede a escala de abrir.
      const trocas = (await Promise.all(chaves.map((c) => listarTrocasWfm(c).then((r) => r.itens || [], () => [])))).flat();
      const trocasPorDia = {};
      trocas.filter((t) => SELO_TROCA[t.estado]).forEach((t) => { [t.data_a, t.data_b].filter(Boolean).forEach((d) => { trocasPorDia[String(d).slice(0, 10)] = t.estado; }); });
      setDados({
        trocasPorDia,
        itens,
        livres,
        eventos: respostas.flatMap((r) => r.eventos || []),
        presencas: Object.fromEntries(respostas.flatMap((r) => r.presencas || []).map((p) => [p.data, p])),
        publicada: respostas.some((r) => r.status.versao_publicada > 0),
      });
    } catch (e) {
      setDados(null);
      setErro(e?.message || 'Não foi possível carregar a sua escala.');
    }
  }, [contexto, periodo]);
  useEffect(() => { setDados(null); carregar(); }, [carregar]);

  const trabalha = useCallback((iso) => (dados?.itens[iso] || []).some((i) => i.trabalha), [dados]);
  // Folga que dá para trocar: Folga/DSR lançado ou dia sem lançamento, de amanhã em diante, em dia em que a pessoa não trabalha em escala nenhuma.
  const folgaDe = (iso) => {
    if (!podeTrocar || !dados || iso <= hoje) return null;
    const lista = dados.itens[iso] || [];
    if (lista.some((i) => i.trabalha)) return null;
    return lista.find((i) => TIPOS_FOLGA.includes(i.tipo)) || (lista.length ? null : (dados.livres?.[iso] || [])[0]) || null;
  };
  // "Pedir troca" direto na linha: o primeiro turno que ainda permite troca, ou a folga trocável.
  const trocaDoDia = (iso) => {
    if (!podeTrocar || !dados) return null;
    const turno = (dados.itens[iso] || []).find((i) => i.trabalha && !motivoSemTroca(doIso(iso), i));
    if (turno) return turno;
    const folga = folgaDe(iso);
    return folga ? { ...folga, folga: true } : null;
  };

  const mover = (n) => setAncora((a) => new Date(a.getFullYear(), a.getMonth() + n, 1));
  const rotuloPeriodo = `${MESES[periodo.ini.getMonth()]} de ${periodo.ini.getFullYear()}`;
  const itensPeriodo = dados ? periodo.dias.flatMap((d) => dados.itens[paraIso(d)] || []) : [];
  const escalados = itensPeriodo.filter((i) => i.trabalha);
  const diasTrabalho = dados ? periodo.dias.filter((d) => trabalha(paraIso(d))).length : 0;
  const diasDsr = dados ? periodo.dias.filter((d) => { const l = dados.itens[paraIso(d)] || []; return l.length && !l.some((i) => i.trabalha) && l[0].codigo === 'DSR'; }).length : 0;
  const totalMin = escalados.reduce((soma, i) => soma + (i.minutos || 0), 0);
  const eventosDoDia = (d) => (dados?.eventos || []).filter((e) => paraIso(d) >= e.data_ini && paraIso(d) <= e.data_fim);
  const semTurno = (lista) => { const item = lista[0]; return ROTULO_SEM_HORARIO[item?.tipo] || (item && item.codigo !== 'DSR' ? 'Folga' : 'DSR'); };

  const planilha = () => html`<table class="c-tabela c-tabela--junta c-minha">
    <thead><tr><th scope="col">Dia</th><th scope="col">Turno</th><th scope="col" class="c-num">Horário</th><th scope="col" class="c-estica">Pausas</th><th scope="col">Situação</th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead>
    <tbody>${periodo.dias.map((d) => {
    const iso = paraIso(d);
    const lista = dados.itens[iso] || [];
    const trab = lista.filter((i) => i.trabalha);
    const troca = trocaDoDia(iso);
    const passou = iso < hoje;
    const dia = html`${rotuloDia(iso)}${iso === hoje ? html` <span class="c-sec">· hoje</span>` : passou ? html` <span class="c-dia-passou-rot">· passou</span>` : null}`;
    return html`<tr key=${iso} class=${`c-clicavel ${trab.length ? '' : 'c-dia-folga'} ${passou ? 'c-dia-passou' : ''}`.replace(/\s+/g, ' ').trim()} aria-current=${iso === hoje ? 'date' : null} aria-selected=${aberto === iso ? 'true' : null}
        tabIndex="0" onClick=${(ev) => { if (!ev.target.closest('button')) setAberto(iso); }} onKeyDown=${(ev) => { if (ev.key === 'Enter' && ev.target === ev.currentTarget) setAberto(iso); }}>
        <td class="c-forte">${dia}</td>
        ${trab.length ? html`
          <td>${trab.map((i, k) => html`<div key=${k}><${Turno} item=${i} /></div>`)}</td>
          <td class="c-num">${trab.map((i, k) => html`<div key=${k}>${faixa(i)}</div>`)}</td>
          <td class="c-estica c-secundario">${trab.map((i, k) => html`<div key=${k}>${(i.pausas || []).length ? i.pausas.map((p) => p.inicio).join(' · ') : 'a programar'}</div>`)}</td>`
        : html`<td><span class="c-folga">${semTurno(lista) === 'DSR' ? 'Descanso semanal' : semTurno(lista)}</span></td><td class="c-num">—</td><td class="c-estica c-secundario">—</td>`}
        <td><span class="c-grupo"><${SeloPresenca} presenca=${dados.presencas?.[iso]} /><${SeloTroca} estado=${dados.trocasPorDia?.[iso]} /></span></td>
        <td class="c-acoes">${troca ? html`<button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => setTrocando({ item: troca, data: d })}><${Ic} nome="arrows-left-right" />Pedir troca</button>` : null}</td>
      </tr>`;
  })}</tbody>
    <tfoot><tr><td>Mês</td><td>${diasTrabalho} dias</td><td class="c-num">${horasMin(totalMin)}</td><td>${diasDsr} DSR</td><td></td><td></td></tr></tfoot>
  </table>`;

  const calendario = () => html`<table class="c-cal">
    <thead><tr>${SEMANA.map((s) => html`<th key=${s} scope="col">${s.slice(0, 3).toLowerCase()}</th>`)}</tr></thead>
    <tbody>${Array.from({ length: periodo.grade.length / 7 }, (_, sem) => html`<tr key=${sem}>${periodo.grade.slice(sem * 7, sem * 7 + 7).map((d) => {
    const iso = paraIso(d);
    const fora = d.getMonth() !== periodo.ini.getMonth();
    const lista = dados.itens[iso] || [];
    const trab = lista.filter((i) => i.trabalha);
    const pres = dados.presencas?.[iso];
    const classe = `c-cal-dia ${iso === hoje ? 'c-cal-hoje' : ''} ${fora ? 'c-cal-fora' : ''} ${!trab.length ? 'c-cal-dsr' : ''} ${iso < hoje ? 'c-cal-passou' : ''}`.replace(/\s+/g, ' ').trim();
    const conteudo = html`<span class="c-cal-n">${d.getDate()}</span>
      ${trab.length ? trab.map((i, k) => html`<span key=${k} class="c-cal-bloco" style=${i.cor ? { borderLeftColor: i.cor } : undefined}>${faixa(i)}</span>`) : html`<span class="c-cal-folga">${lista.length || dados.livres?.[iso] ? semTurno(lista) : '—'}</span>`}
      ${pres ? html`<span class=${`c-cal-st c-cal-st--${TOM_PRESENCA[pres.status] || 'neutro'}`}><${Ic} nome=${ICONE_PRESENCA[pres.status] || 'circle'} />${ROTULO_STATUS_PRESENCA[pres.status] || pres.status}</span>` : null}
      ${dados.trocasPorDia?.[iso] ? html`<span class=${`c-cal-st c-cal-st--${SELO_TROCA[dados.trocasPorDia[iso]][1]}`}><${Ic} nome="arrows-left-right" />${SELO_TROCA[dados.trocasPorDia[iso]][0]}</span>` : null}`;
    return html`<td key=${iso} class=${classe} aria-current=${iso === hoje ? 'date' : null}>
      ${fora ? conteudo : html`<button type="button" class="c-cal-botao" aria-label=${`${tituloDia(d)}${trab.length ? `, ${trab.map(faixa).join(' e ')}` : `, ${semTurno(lista)}`}`} aria-pressed=${aberto === iso ? 'true' : 'false'} onClick=${() => setAberto(iso)}>${conteudo}</button>`}
    </td>`;
  })}</tr>`)}</tbody>
  </table>`;

  const corpo = () => {
    if (erro) return html`<${Estado} titulo=${erro} rotuloAcao="Tentar de novo" aoAcao=${carregar} />`;
    if (!dados) return html`<${Esqueleto} linhas=${8} />`;
    if (!dados.publicada) return html`<${Estado} icone="calendar-blank" titulo="Escala ainda não publicada" texto="Assim que a escala deste período for publicada, ela aparece aqui." />`;
    return visao === 'planilha' ? planilha() : calendario();
  };
  const dataAberta = aberto ? doIso(aberto) : null;

  return html`
    <main class="c-pagina c-conteudo">
      <div class="c-cab-linha"><h1>Minha escala</h1>${acessorio ? html`<div class="c-cab-dir">${acessorio}</div>` : null}</div>
      <div class="c-tabela-caixa">
        <div class="c-filtros c-filtros--suave">
          <${Segmento} rotulo="Visão" valor=${visao} aoMudar=${setVisao} opcoes=${[['planilha', 'Planilha'], ['calendario', 'Calendário']]} />
          <${Navegar} grupo="Mês" rotulo=${rotuloPeriodo} rotuloAnterior="Mês anterior" rotuloProximo="Próximo mês" aoAnterior=${() => mover(-1)} aoProximo=${() => mover(1)} />
          <button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => { setAncora(new Date()); }}>Hoje</button>
          ${dados?.publicada ? html`<span class="c-contador">${diasTrabalho} dias de trabalho · ${horasMin(totalMin)} no mês · ${diasDsr} DSR</span>` : null}
        </div>
        ${corpo()}
        ${dados?.publicada && podeTrocar ? html`<div class="c-legenda"><span>Pedir troca aparece só nos dias que ainda vão chegar e respeitam a antecedência da escala · clique no dia para ver pausas e presença</span></div>` : null}
      </div>
    </main>
    ${dataAberta && dados ? html`<${PainelDia} data=${dataAberta} itens=${dados.itens[aberto] || []} eventos=${eventosDoDia(dataAberta)} presenca=${dados.presencas?.[aberto]}
      podeTrocar=${podeTrocar} folga=${folgaDe(aberto)} onClose=${() => setAberto(null)} onTrocar=${(item) => setTrocando({ item, data: dataAberta })} />` : null}
    ${trocando ? html`<${JanelaTroca} nomeUsuario=${nomeUsuario} operacao=${trocando.item.operacao} data=${trocando.data} item=${trocando.item} showToast=${showToast}
      onClose=${() => setTrocando(null)} onFeito=${() => { setTrocando(null); setAberto(null); }} />` : null}`;
}
