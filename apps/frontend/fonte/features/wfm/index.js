import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState, PageIntro, PainelRh } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import { useToast } from '../../shared/hooks/use-toast.js';
import { listarAuditoriaWfm } from '../../services/api/wfm.js';
import { SeletorPeriodo, dataHora, mesAtual, useContextoWfm } from './comum.js';
import { TelaEscala } from './escala.js';
import { TelaPresenca } from './presenca.js';
import { TelaCadastros } from './cadastros.js';

// WFM — Turnos e Plantões (Fase 1). Um módulo de telas, cada uma com sua rota (screen-wfm*).
// Toda restrição (operação, equipe, perfil, conflito de interesse) é aplicada no backend;
// a tela só esconde o que o perfil não pode usar.

export const ABAS_WFM = [
  { tela: 'screen-wfm', rotulo: 'Escala', icone: 'calendar_month', permissao: 'wfm.escala.visualizar' },
  { tela: 'screen-wfm-minha-escala', rotulo: 'Minha escala', icone: 'today', permissao: 'wfm.escala.propria' },
  { tela: 'screen-wfm-presenca', rotulo: 'Presença', icone: 'fact_check', permissao: 'wfm.presenca.lancar' },
  { tela: 'screen-wfm-cadastros', rotulo: 'Cadastros', icone: 'settings', permissao: 'wfm.cadastros.visualizar' },
  { tela: 'screen-wfm-auditoria', rotulo: 'Auditoria', icone: 'history', permissao: 'wfm.auditoria' },
];

const TITULOS = {
  'screen-wfm': ['Escala mensal', 'Monte, valide e publique a escala. Cada publicação gera uma nova versão.'],
  'screen-wfm-minha-escala': ['Minha escala', 'Seus turnos do mês, conforme a última versão publicada.'],
  'screen-wfm-presenca': ['Presença', 'Lançamento de presença, falta e atestado da sua equipe.'],
  'screen-wfm-cadastros': ['Cadastros', 'Contratos de jornada, turnos-modelo, skills e calendário especial.'],
  'screen-wfm-auditoria': ['Auditoria', 'Trilha completa: quem, quando, ação, valor antes e depois.'],
};

export function abaInicialWfm(controlador) {
  const ordem = ['screen-wfm-minha-escala', 'screen-wfm', 'screen-wfm-presenca', 'screen-wfm-cadastros', 'screen-wfm-auditoria'];
  return ordem.find((t) => controlador.podeAcessarTela(t)) || 'screen-wfm';
}

function TelaAuditoria({ operacao, showToast }) {
  const [itens, setItens] = useState(null);
  const [erro, setErro] = useState('');
  const [entidade, setEntidade] = useState('');
  useEffect(() => {
    let ativo = true;
    setItens(null);
    listarAuditoriaWfm({ operacao, entidade, limite: 200 })
      .then((r) => { if (ativo) setItens(r.itens || []); })
      .catch((e) => { if (ativo) setErro(e?.message || 'Não foi possível carregar a auditoria.'); });
    return () => { ativo = false; };
  }, [operacao, entidade]);
  if (erro) return html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  if (!itens) return html`<${LoadingState} titulo="Carregando a auditoria" />`;
  return html`
    <section class="mon-card">
      <div class="wfm-cabecalho"><div><h3>Trilha de auditoria</h3><p class="mon-muted">Últimos 200 registros. Visível apenas para Gestor/RH e Administrador.</p></div>
        <label class="mon-campo"><span>Entidade</span><select class="form-select" value=${entidade} onChange=${(e) => setEntidade(e.target.value)}>
          <option value="">Todas</option>${['escala', 'escala_item', 'presenca', 'atestado', 'contrato', 'turno', 'skill', 'calendario_especial', 'operador'].map((e) => html`<option key=${e} value=${e}>${e}</option>`)}</select></label></div>
      ${itens.length ? html`<div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Entidade</th><th>Antes</th><th>Depois</th><th>Justificativa</th></tr></thead><tbody>
        ${itens.map((a) => html`<tr key=${a.id_auditoria}><td>${dataHora(a.criado_em)}</td><td>${a.usuario_nome}<small class="wfm-sub">${a.perfil}</small></td><td>${a.acao}</td><td>${a.entidade} ${a.entidade_id || ''}</td>
          <td class="wfm-json">${a.antes_json || '—'}</td><td class="wfm-json">${a.depois_json || '—'}</td><td>${a.justificativa || '—'}</td></tr>`)}
      </tbody></table></div>` : html`<${EmptyState} icon="history" title="Sem registros" text="Nada foi registrado para este filtro." />`}
    </section>`;
}

export function TelaWfm({ controlador, telaAtual = 'screen-wfm' }) {
  const { showToast, ToastHost } = useToast();
  const { contexto, erro } = useContextoWfm();
  const [operacao, setOperacao] = useState('');
  const [anoMes, setAnoMes] = useState(mesAtual());
  useEffect(() => {
    if (contexto && !operacao && contexto.operacoes.length) setOperacao(contexto.operacoes[0].chave);
  }, [contexto, operacao]);

  const abas = ABAS_WFM.filter((a) => controlador.possuiPermissao(a.permissao));
  const [titulo, descricao] = TITULOS[telaAtual] || TITULOS['screen-wfm'];
  const props = { controlador, contexto, operacao, anoMes, showToast };

  let corpo;
  if (erro) corpo = html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  else if (!contexto) corpo = html`<${LoadingState} titulo="Carregando Turnos e Plantões" />`;
  else if (!contexto.operacoes.length) corpo = html`<${EmptyState} icon="lock" title="Nenhuma operação vinculada" text="Seu usuário ainda não está vinculado a uma operação. Fale com o Administrador." />`;
  else if (!operacao) corpo = html`<${LoadingState} titulo="Carregando" />`;
  else if (telaAtual === 'screen-wfm-minha-escala') corpo = html`<${TelaEscala} ...${props} somentePropria=${true} />`;
  else if (telaAtual === 'screen-wfm-presenca') corpo = html`<${TelaPresenca} ...${props} />`;
  else if (telaAtual === 'screen-wfm-cadastros') corpo = html`<${TelaCadastros} ...${props} />`;
  else if (telaAtual === 'screen-wfm-auditoria') corpo = html`<${TelaAuditoria} operacao=${operacao} showToast=${showToast} />`;
  else corpo = html`<${TelaEscala} ...${props} />`;

  const semPeriodo = telaAtual === 'screen-wfm-auditoria';
  return html`
    <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Turnos e Plantões" placeholderBusca="Turnos e Plantões" controlador=${controlador}>
      <${ToastHost} />
      <${PageIntro} kicker="Turnos e Plantões" title=${titulo} description=${descricao} />
      <div class="mon-shell">
        <nav class="mon-subnav" aria-label="Seções de Turnos e Plantões">
          ${abas.map((a) => html`
            <button key=${a.tela} type="button" class=${`mon-subnav-btn ${a.tela === telaAtual ? 'is-active' : ''}`} onClick=${() => controlador.irParaTelaProtegida(a.tela)}>
              <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(a.icone)}</span>${a.rotulo}
            </button>`)}
        </nav>
        ${contexto && contexto.operacoes.length ? html`<${SeletorPeriodo} contexto=${contexto} operacao=${operacao} setOperacao=${setOperacao} anoMes=${anoMes} setAnoMes=${setAnoMes} />` : null}
        ${corpo}
      </div>
    </${PainelRh}>`;
}
