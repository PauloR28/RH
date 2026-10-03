import { html, useCallback, useEffect, useState } from '../../../infraestrutura-react.js';
import { lerContextoWfm } from '../../../services/api/wfm.js';

// WFM — peças compartilhadas: contexto do usuário, seletor de operação/mês e formatação.

export function useContextoWfm() {
  const [contexto, setContexto] = useState(null);
  const [erro, setErro] = useState('');
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    let ativo = true;
    lerContextoWfm()
      .then((dados) => { if (ativo) setContexto(dados); })
      .catch((e) => { if (ativo) setErro(e?.message || 'Não foi possível carregar o WFM.'); });
    return () => { ativo = false; };
  }, [versao]);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  return { contexto, erro, recarregar };
}

export function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

export function infoDia(iso) {
  const [ano, mes, dia] = iso.split('-').map(Number);
  const d = new Date(ano, mes - 1, dia);
  return { dia, semana: DIAS_SEMANA[d.getDay()], fimDeSemana: d.getDay() === 0 || d.getDay() === 6 };
}

export const minutosParaHoras = (min) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;

export const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR') : '');

export function SeletorPeriodo({ contexto, operacao, setOperacao, anoMes, setAnoMes, semMes = false, semOperacao = false, soEscalasAtivas = false }) {
  // Telas sem mês (Jornadas): com uma única operação não há o que escolher.
  if (semMes && (contexto?.operacoes || []).length < 2) return null;
  return html`
    <div class="wfm-filtros">
      ${semOperacao ? null : html`<label class="mon-campo"><span>Escala / operação</span>
        <select class="form-select" value=${operacao} onChange=${(e) => setOperacao(e.target.value)}>
          ${(contexto?.operacoes || []).filter((o) => !soEscalasAtivas || o.escala_ativa !== false).map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}
        </select>
      </label>`}
      ${semMes ? null : html`<label class="mon-campo"><span>Mês</span>
        <input class="form-control" type="month" value=${anoMes} onChange=${(e) => e.target.value && setAnoMes(e.target.value)} />
      </label>`}
    </div>`;
}

export const ROTULO_TIPO_EVENTO = {
  FERIADO: 'Feriado',
  DATA_ESPECIAL: 'Data especial',
  DIA_ESPECIAL: 'Dia especial',
  HORARIO_ESPECIAL: 'Horário especial',
};

export const ROTULO_STATUS_PRESENCA = {
  PRESENTE: 'Presente',
  FALTA: 'Falta',
  FALTA_JUSTIFICADA: 'Falta justificada',
  ATESTADO: 'Atestado',
};

export const SIGLA_PRESENCA = { PRESENTE: 'P', FALTA: 'F', FALTA_JUSTIFICADA: 'FJ', ATESTADO: 'AT' };
