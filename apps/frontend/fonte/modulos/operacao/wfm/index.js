import { html, useEffect, useState } from '../../../infraestrutura-react.js';
import { EmptyState, LoadingState, PageIntro, PainelRh } from '../../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../../ui/icone.js';
import { useToast } from '../../../shared/hooks/use-toast.js';
import { listarAuditoriaWfm } from '../../../services/api/wfm.js';
import { SeletorPeriodo, dataHora, mesAtual, useContextoWfm } from './comum.js';
import { TelaEscala } from './escala.js';
import { TelaPresenca } from './presenca.js';
import { TelaCadastros } from './cadastros.js';
import { TelaJornadas } from './jornadas.js';
import { TelaEscalaTabela } from './tabela.js';
import { TelaMinhaEscala } from './minha.js';
import { ListaEscalas } from './escalas.js';
import { ModalConfigEscala } from './configuracao.js';
import { TelaTrocas } from './trocas.js';
import { TelaRelatorios } from './relatorios.js';

// WFM — Turnos e Plantões. Um módulo de telas, cada uma com sua rota (screen-wfm*).
// Toda restrição (operação, equipe, perfil, conflito de interesse) é aplicada no backend;
// a tela só esconde o que o perfil não pode usar.

export const ABAS_WFM = [
  { tela: 'screen-wfm', rotulo: 'Escala', icone: 'calendar_month', permissao: 'wfm.escala.visualizar' },
  { tela: 'screen-wfm-minha-escala', rotulo: 'Minhas escalas', icone: 'today', permissao: 'wfm.escala.propria' },
  { tela: 'screen-wfm-trocas', rotulo: 'Trocas', icone: 'compare_arrows', permissao: 'wfm.troca.visualizar' },
  { tela: 'screen-wfm-presenca', rotulo: 'Presença', icone: 'fact_check', permissao: 'wfm.presenca.lancar' },
  { tela: 'screen-wfm-relatorios', rotulo: 'Relatórios', icone: 'analytics', permissao: 'wfm.relatorios' },
  { tela: 'screen-wfm-jornadas', rotulo: 'Jornadas', icone: 'schedule', permissao: 'wfm.cadastros.visualizar' },
  { tela: 'screen-wfm-cadastros', rotulo: 'Cadastros', icone: 'settings', permissao: 'wfm.cadastros.visualizar' },
];

const TITULOS = {
  'screen-wfm': ['Escala', 'Crie, configure e acompanhe as escalas. Turnos, horários, pausas, presença e hora extra do dia ficam na escala aberta. Dia sem turno é DSR.'],
  'screen-wfm-minha-escala': ['Minhas escalas', 'Seus turnos em todas as escalas, conforme a última versão publicada.'],
  'screen-wfm-trocas': ['Trocas de plantão', 'Solicite, responda e aprove trocas entre operadores.'],
  'screen-wfm-presenca': ['Presença', 'Lançamento de presença, falta e atestado da sua equipe.'],
  'screen-wfm-relatorios': ['Relatórios', 'Histórico de escalas, presenças e faltas, trocas, aprovações e total de horas. Filtre e exporte.'],
  'screen-wfm-jornadas': ['Jornadas', 'Limites de jornada, interjornada e pausas obrigatórias.'],
  'screen-wfm-cadastros': ['Cadastros', 'Turnos, calendário especial, skills e jornadas.'],
  'screen-wfm-auditoria': ['Auditoria de Plantões', 'Quem fez o quê, quando, e o valor antes e depois.'],
};

export function abaInicialWfm(controlador) {
  const ordem = ['screen-wfm-minha-escala', 'screen-wfm', 'screen-wfm-trocas', 'screen-wfm-presenca', 'screen-wfm-relatorios', 'screen-wfm-jornadas', 'screen-wfm-cadastros', 'screen-wfm-auditoria'];
  return ordem.find((t) => controlador.podeAcessarTela(t)) || 'screen-wfm';
}

const ROTULO_CAMPO = {
  id_contrato: 'Jornada (id)', codigo: 'Código', vigencia_ini: 'Vigência a partir de', nome: 'Nome', tipo: 'Tipo', ativo: 'Ativo',
  entrada: 'Entrada', saida: 'Saída', versao: 'Versão', itens: 'Itens', violacoes: 'Violações', fechada: 'Fechada', skills: 'Skills',
  status: 'Status', observacao: 'Observação', categoria: 'Categoria', data_ini: 'Início', data_fim: 'Fim', descricao: 'Descrição',
  id_operador: 'Operador (id)', id_turno: 'Turno (id)', limites: 'Limites', pausas_json: 'Pausas', cor: 'Cor',
};
const ROTULO_ACAO = {
  editar_escala: 'Editou a escala', corrigir_escala_fechada: 'Corrigiu escala fechada', publicar_escala: 'Publicou a escala',
  publicar_com_violacao: 'Publicou com violação', fechar_periodo: 'Fechou o período', lancar_presenca: 'Lançou presença',
  registrar_atestado: 'Registrou atestado', salvar_contrato: 'Salvou jornada', excluir_contrato: 'Excluiu jornada', excluir_turno: 'Excluiu turno', lancar_hora_extra: 'Lançou hora extra', salvar_turno: 'Salvou turno', salvar_skill: 'Salvou skill',
  salvar_calendario_especial: 'Salvou calendário especial', enviar_aprovacao: 'Enviou para aprovação', aprovar_escala: 'Aprovou a escala', declinar_escala: 'Declinou a escala', cancelar_envio_aprovacao: 'Cancelou o envio para aprovação', criar_tipo_escala: 'Criou tipo de escala', salvar_tipo_escala: 'Salvou tipo de escala', excluir_tipo_escala: 'Excluiu tipo de escala', solicitar_troca: 'Solicitou troca', aceitar_troca: 'Colega aceitou a troca',
  aprovar_troca: 'Aprovou troca', reprovar_troca: 'Reprovou troca', cancelar_troca: 'Cancelou troca', desfazer_troca: 'Desfez troca', exportar_escala: 'Exportou a escala', duplicar_escala: 'Duplicou a escala', configurar_escala: 'Configurou a escala', vincular_contrato: 'Vinculou jornada', definir_skills: 'Definiu skills',
};

function formatarValor(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  if (Array.isArray(valor)) return valor.length ? valor.map(formatarValor).join(', ') : '—';
  if (typeof valor === 'object') return Object.entries(valor).map(([k, v]) => `${ROTULO_CAMPO[k] || k}: ${formatarValor(v)}`).join(' · ');
  const texto = String(valor);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto.split('-').reverse().join('/') : texto;
}

// Converte o JSON gravado na auditoria em linhas "Campo: valor" legíveis.
function ValorAuditoria({ json }) {
  if (!json) return html`<span class="mon-muted">—</span>`;
  let dados;
  try { dados = JSON.parse(json); } catch { return html`<span>${json}</span>`; }
  if (dados === null || typeof dados !== 'object' || Array.isArray(dados)) return html`<span>${formatarValor(dados)}</span>`;
  return html`<ul class="wfm-auditoria-valor">${Object.entries(dados).map(([k, v]) => html`<li key=${k}><span>${ROTULO_CAMPO[k] || k}</span> ${formatarValor(v)}</li>`)}</ul>`;
}

export function TelaAuditoria({ contexto }) {
  const [itens, setItens] = useState(null);
  const [erro, setErro] = useState('');
  const [operacao, setOperacao] = useState('');
  const [entidade, setEntidade] = useState('');
  useEffect(() => {
    let ativo = true;
    setItens(null);
    setErro('');
    listarAuditoriaWfm({ operacao, entidade, limite: 200 })
      .then((r) => { if (ativo) setItens(r.itens || []); })
      .catch((e) => { if (ativo) setErro(e?.message || 'Não foi possível carregar a auditoria.'); });
    return () => { ativo = false; };
  }, [operacao, entidade]);
  return html`
    <section class="mon-card">
      <div class="wfm-cabecalho wfm-cabecalho--centro">
        <h3>Trilha de auditoria</h3>
        <div class="wfm-filtros-direita">
          <label class="mon-campo"><span>Operação</span><select class="form-select" value=${operacao} onChange=${(e) => setOperacao(e.target.value)}>
            <option value="">Todas</option>${(contexto?.operacoes || []).map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select></label>
          <label class="mon-campo"><span>Entidade</span><select class="form-select" value=${entidade} onChange=${(e) => setEntidade(e.target.value)}>
            <option value="">Todas</option>${['escala', 'escala_item', 'presenca', 'atestado', 'contrato', 'turno', 'skill', 'calendario_especial', 'operador', 'tipo_escala'].map((e) => html`<option key=${e} value=${e}>${e}</option>`)}</select></label>
        </div>
      </div>
      ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`
        : !itens ? html`<${LoadingState} titulo="Carregando a auditoria" />`
        : itens.length ? html`<div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Entidade</th><th>Antes</th><th>Depois</th><th>Justificativa</th></tr></thead><tbody>
        ${itens.map((a) => html`<tr key=${a.id_auditoria}><td>${dataHora(a.criado_em)}</td><td>${a.usuario_nome}<small class="wfm-sub">${a.perfil}</small></td><td>${ROTULO_ACAO[a.acao] || a.acao}</td><td>${a.entidade}${a.entidade_id ? html`<small class="wfm-sub">${a.entidade_id}</small>` : null}</td>
          <td><${ValorAuditoria} json=${a.antes_json} /></td><td><${ValorAuditoria} json=${a.depois_json} /></td><td>${a.justificativa || '—'}</td></tr>`)}
      </tbody></table></div>` : html`<${EmptyState} icon="history" title="Sem registros" text="Nada foi registrado para este filtro." />`}
    </section>`;
}

export function TelaWfm({ controlador, telaAtual = 'screen-wfm' }) {
  const { showToast, ToastHost } = useToast();
  const { contexto, erro, recarregar: recarregarContexto } = useContextoWfm();
  const [operacao, setOperacao] = useState('');
  const [anoMes, setAnoMes] = useState(mesAtual());
  // Aba Escala: 'lista' (padrão, lista de escalas) | 'dia' (montar) | 'mes' (visualizar o mês inteiro)
  const [visaoEscala, setVisaoEscala] = useState('lista');
  const [configurandoItem, setConfigurandoItem] = useState(null);
  const [versaoLista, setVersaoLista] = useState(0);
  useEffect(() => {
    // Também reposiciona quando a escala selecionada deixa de existir (ex.: tipo de escala excluído).
    if (!contexto) return;
    if (contexto.operacoes.length && !contexto.operacoes.some((o) => o.chave === operacao)) setOperacao(contexto.operacoes[0].chave);
    // Sem nenhuma escala (todas excluídas/desativadas): limpa a seleção antiga e volta para a lista.
    else if (!contexto.operacoes.length && operacao) { setOperacao(''); setVisaoEscala('lista'); }
  }, [contexto, operacao]);

  useEffect(() => {
    if (!contexto || !['screen-wfm-presenca', 'screen-wfm-trocas', 'screen-wfm-minha-escala'].includes(telaAtual)) return;
    const ativas = contexto.operacoes.filter((o) => o.escala_ativa !== false);
    if (ativas.length && !ativas.some((o) => o.chave === operacao)) setOperacao(ativas[0].chave);
  }, [contexto, telaAtual, operacao]);

  // "Minhas escalas" segue a permissão wfm.escala.propria: quem pode ser escalado (Operador, Técnicos e Analista de TI).
  // Jornadas vive dentro de Cadastros (alternador no topo da tela): uma aba a menos na barra.
  const abas = ABAS_WFM.filter((a) => controlador.possuiPermissao(a.permissao) && a.tela !== 'screen-wfm-jornadas');
  const abaAtiva = telaAtual === 'screen-wfm-jornadas' ? 'screen-wfm-cadastros' : telaAtual;
  const emConfig = ['screen-wfm-cadastros', 'screen-wfm-jornadas'].includes(telaAtual);
  const [titulo, descricao] = TITULOS[telaAtual] || TITULOS['screen-wfm'];
  const podeCriarEscala = controlador.possuiPermissao('wfm.escala.criar');
  const voltarParaLista = () => { setVisaoEscala('lista'); setVersaoLista((v) => v + 1); recarregarContexto(); };
  // Presença, Trocas e Minha escala só fazem sentido com escala ativa; Cadastros e Jornadas seguem a operação.
  const dependeDeEscala = ['screen-wfm-presenca', 'screen-wfm-trocas', 'screen-wfm-minha-escala'].includes(telaAtual);
  const operacoesComEscala = (contexto?.operacoes || []).filter((o) => o.escala_ativa !== false);
  const props = { controlador, contexto, operacao, anoMes, showToast, recarregarContexto, aoTrocarEscala: setOperacao };

  let corpo;
  if (erro) corpo = html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  else if (!contexto) corpo = html`<${LoadingState} titulo="Carregando Turnos e Plantões" />`;
  else if (dependeDeEscala && !operacoesComEscala.length) corpo = html`<${EmptyState} icon="calendar_month" title="Nenhuma escala ativa" text="Não há escalas ativas no momento. Quem gere as escalas pode criar ou ativar uma na aba Escala." />`;
  else if (telaAtual === 'screen-wfm' && visaoEscala === 'lista') corpo = html`
    <${ListaEscalas} controlador=${controlador} anoMes=${anoMes} versao=${versaoLista} showToast=${showToast}
      aoAbrir=${(chave, modo) => { setOperacao(chave); setVisaoEscala(modo); }}
      aoConfigurar=${(item) => setConfigurandoItem(item)}
      aoMudou=${() => { recarregarContexto(); setVersaoLista((v) => v + 1); }} />`;
  else if (!contexto.operacoes.length && !(telaAtual === 'screen-wfm-cadastros' && contexto.pode_editar_tipos_escala)) corpo = html`<${EmptyState} icon="lock" title="Nenhuma operação vinculada" text="Seu usuário ainda não está vinculado a uma operação. Fale com o Administrador." />`;
  else if (!operacao && !(telaAtual === 'screen-wfm-cadastros' && contexto.pode_editar_tipos_escala)) corpo = html`<${LoadingState} titulo="Carregando" />`;
  else if (telaAtual === 'screen-wfm-minha-escala') corpo = html`<${TelaMinhaEscala} contexto=${contexto} operacao=${operacao} showToast=${showToast} podeTrocar=${controlador.possuiPermissao('wfm.troca.solicitar')} />`;
  else if (telaAtual === 'screen-wfm-trocas') corpo = html`<${TelaTrocas} controlador=${controlador} operacao=${operacao} showToast=${showToast} />`;
  else if (telaAtual === 'screen-wfm-relatorios') corpo = html`<${TelaRelatorios} contexto=${contexto} operacao=${operacao} aoTrocarEscala=${setOperacao} showToast=${showToast} />`;
  else if (telaAtual === 'screen-wfm-presenca') corpo = html`<${TelaPresenca} ...${props} />`;
  else if (telaAtual === 'screen-wfm-jornadas') corpo = html`<${TelaJornadas} ...${props} />`;
  else if (telaAtual === 'screen-wfm-cadastros') corpo = html`<${TelaCadastros} ...${props} />`;
  else if (telaAtual === 'screen-wfm-auditoria') corpo = html`<${TelaAuditoria} contexto=${contexto} />`;
  else if (visaoEscala === 'mes') corpo = html`
    <${TelaEscala} ...${props} somenteLeitura=${!podeCriarEscala} aoVoltarLista=${voltarParaLista} aoVoltarDia=${podeCriarEscala ? () => setVisaoEscala('dia') : undefined} />`;
  else corpo = html`<${TelaEscalaTabela} ...${props} aoVerMes=${() => setVisaoEscala('mes')} aoVoltarLista=${voltarParaLista} />`;

  // A lista de escalas é a navegação da aba Escala; sem permissão de criar (ex.: Gestor) não há troca de escala pelo seletor.
  const semOperacao = telaAtual === 'screen-wfm' && (visaoEscala === 'lista' || !podeCriarEscala);
  const semPeriodo = ['screen-wfm-auditoria', 'screen-wfm-relatorios', 'screen-wfm-minha-escala', 'screen-wfm-trocas', 'screen-wfm-presenca'].includes(telaAtual);
  return html`
    <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca=${telaAtual === 'screen-wfm-auditoria' ? 'Auditoria de Plantões' : 'Turnos e Plantões'} placeholderBusca="Turnos e Plantões" controlador=${controlador}>
      <div class="wfm-toast"><${ToastHost} /></div>
      <${PageIntro} kicker=${telaAtual === 'screen-wfm-auditoria' ? 'Configurações' : 'Turnos e Plantões'} title=${titulo} description=${descricao} />
      <div class="mon-shell">
        ${telaAtual === 'screen-wfm-auditoria' ? null : html`<nav class="mon-subnav" aria-label="Seções de Turnos e Plantões">
          ${abas.map((a) => html`
            <button key=${a.tela} type="button" class=${`mon-subnav-btn ${a.tela === abaAtiva ? 'is-active' : ''}`} onClick=${() => controlador.irParaTelaProtegida(a.tela)}>
              <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(a.icone)}</span>${a.rotulo}
            </button>`)}
        </nav>`}
        ${contexto && (contexto.operacoes.length || telaAtual === 'screen-wfm') && !semPeriodo ? html`<${SeletorPeriodo} contexto=${contexto} operacao=${operacao} setOperacao=${setOperacao} anoMes=${anoMes} setAnoMes=${setAnoMes} semMes=${telaAtual === 'screen-wfm-jornadas'} semOperacao=${semOperacao} soEscalasAtivas=${telaAtual === 'screen-wfm'} />` : null}
        ${emConfig && contexto ? html`<div class="wfm-segmento" role="tablist" aria-label="Cadastros e jornadas">
          <button type="button" role="tab" aria-selected=${telaAtual === 'screen-wfm-cadastros'} class=${telaAtual === 'screen-wfm-cadastros' ? 'is-ativo' : ''} onClick=${() => controlador.irParaTelaProtegida('screen-wfm-cadastros')}>Turnos, calendário e skills</button>
          <button type="button" role="tab" aria-selected=${telaAtual === 'screen-wfm-jornadas'} class=${telaAtual === 'screen-wfm-jornadas' ? 'is-ativo' : ''} onClick=${() => controlador.irParaTelaProtegida('screen-wfm-jornadas')}>Jornadas e limites</button>
        </div>` : null}
        ${corpo}
        ${configurandoItem ? html`<${ModalConfigEscala} operacao=${configurandoItem.chave} nomePadrao=${configurandoItem.operacao} showToast=${showToast} onClose=${() => setConfigurandoItem(null)}
          onSalvo=${() => { setConfigurandoItem(null); setVersaoLista((v) => v + 1); recarregarContexto(); }}
          onMudouLista=${() => { setConfigurandoItem(null); setVersaoLista((v) => v + 1); recarregarContexto(); }} />` : null}
      </div>
    </${PainelRh}>`;
}
