import { html, useCallback, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import { lerEscalaWfm } from '../../services/api/wfm.js';
import { minutosParaHoras } from './comum.js';

// Visão do Operador: só a própria escala PUBLICADA. A escala é montada por semana, então a
// semana (segunda a domingo) é a visão padrão; o mês continua disponível.

const SEMANA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const paraIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const doIso = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
const br = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const somarDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const segundaDe = (d) => somarDias(d, -((d.getDay() + 6) % 7));
const anoMesDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function CartaoDia({ data, item, eventos, hoje }) {
  const fimDeSemana = data.getDay() === 0 || data.getDay() === 6;
  const classe = `wfm-dia ${item?.trabalha ? 'is-escalado' : ''} ${fimDeSemana ? 'is-fds' : ''} ${paraIso(data) === hoje ? 'is-hoje' : ''}`.trim();
  return html`
    <div class=${classe}>
      <div class="wfm-dia-topo"><strong>${String(data.getDate()).padStart(2, '0')}</strong><span>${SEMANA[(data.getDay() + 6) % 7].slice(0, 3)}</span></div>
      ${item?.trabalha ? html`
        <span class="wfm-tag-escalado"><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('check_circle')}</span>Escalado</span>
        <span class="wfm-dia-horario">${item.entrada} – ${item.saida}</span>
        <span class="wfm-dia-horas">${minutosParaHoras(item.minutos)} · ${item.codigo}</span>`
        : item ? html`<span class="wfm-dia-folga">${item.codigo === 'DSR' ? 'DSR' : 'Folga'}</span>`
        : html`<span class="wfm-dia-vazio">Sem escala</span>`}
      ${eventos.length ? html`<span class="wfm-dia-evento" title=${eventos.map((e) => e.descricao).join(' · ')}>${eventos[0].descricao}</span>` : null}
    </div>`;
}

export function TelaMinhaEscala({ contexto, operacao }) {
  const [modo, setModo] = useState('semana');
  const [ancora, setAncora] = useState(() => new Date());
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
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
    if (!operacao) return;
    setErro('');
    const meses = [...new Set((periodo.grade || periodo.dias).map(anoMesDe))];
    try {
      const respostas = await Promise.all(meses.map((m) => lerEscalaWfm(operacao, m)));
      setDados({
        itens: Object.fromEntries(respostas.flatMap((r) => r.itens).map((i) => [i.data, i])),
        eventos: respostas.flatMap((r) => r.eventos),
        publicada: respostas.some((r) => r.status.versao_publicada > 0),
      });
    } catch (e) {
      setDados(null);
      setErro(e?.message || 'Não foi possível carregar a sua escala.');
    }
  }, [operacao, periodo]);
  useEffect(() => { setDados(null); carregar(); }, [carregar]);

  const mover = (n) => setAncora((a) => (modo === 'semana' ? somarDias(a, 7 * n) : new Date(a.getFullYear(), a.getMonth() + n, 1)));

  const rotuloPeriodo = modo === 'semana'
    ? `Escala de ${br(periodo.ini)} a ${br(periodo.fim)}`
    : `Escala de ${MESES[periodo.ini.getMonth()]} de ${periodo.ini.getFullYear()}`;
  const escalados = dados ? periodo.dias.map((d) => dados.itens[paraIso(d)]).filter((i) => i?.trabalha) : [];
  const totalMin = escalados.reduce((soma, i) => soma + (i.minutos || 0), 0);
  const eventosDoDia = (d) => (dados?.eventos || []).filter((e) => paraIso(d) >= e.data_ini && paraIso(d) <= e.data_fim);

  return html`
    <section class="mon-card wfm-minha">
      <div class="wfm-cabecalho">
        <div><h3>Minha escala</h3><p class="mon-muted">${rotuloPeriodo}</p></div>
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
          <div class="wfm-resumo">
            <div><span>Total de horas ${modo === 'semana' ? 'na semana' : 'no mês'}</span><strong>${minutosParaHoras(totalMin)}</strong></div>
            <div><span>Dias escalados</span><strong>${escalados.length}</strong></div>
          </div>
          ${modo === 'semana' ? html`<div class="wfm-semana">${periodo.dias.map((d) => html`<${CartaoDia} key=${paraIso(d)} data=${d} item=${dados.itens[paraIso(d)]} eventos=${eventosDoDia(d)} hoje=${hoje} />`)}</div>`
            : html`<div class="wfm-mes-cab">${SEMANA.map((s) => html`<span key=${s}>${s.slice(0, 3)}</span>`)}</div>
              <div class="wfm-mes">${periodo.grade.map((d) => (d.getMonth() === periodo.ini.getMonth()
                ? html`<${CartaoDia} key=${paraIso(d)} data=${d} item=${dados.itens[paraIso(d)]} eventos=${eventosDoDia(d)} hoje=${hoje} />`
                : html`<div key=${paraIso(d)} class="wfm-dia is-fora"></div>`))}</div>`}`}
    </section>`;
}
