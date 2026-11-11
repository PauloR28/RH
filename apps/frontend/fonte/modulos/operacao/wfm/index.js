import { html, useEffect, useState } from '../../../infraestrutura-react.js';
import { EmptyState, LoadingState, PainelRh } from '../../../ui/componentes-compartilhados.js';
import { PageShell } from '../../../ui/components/layout-primitivas.js?v=20261005-redesign16';
import { ModuleHeader } from '../../../ui/components/modulo-primitivas.js?v=20261023-ajustes';
import { usePendenciasAprovacao, usePendenciasPresenca } from './pendencias.js?v=20261104-leitura';
import { useToast } from '../../../shared/hooks/use-toast.js';
import { definirSelos } from '../../../ui/components/selos-subbarra.js';
import { Segmento } from '../../../ui/components/ds.js?v=20261106-wfm';
import { SeletorPeriodo, mesAtual, useContextoWfm } from './comum.js?v=20261104-leitura';
import { TelaEscala } from './escala.js?v=20261109-proprio';
import { TelaPresenca } from './presenca.js?v=20261111-seletor';
import { TelaCadastros } from './cadastros.js?v=20261109-cadastros';
import { TelaEscalaPausas } from './pausas.js?v=20261111-espacos';
import { TelaEscalaTabela } from './tabela.js?v=20261109-proprio';
import { TelaMinhaEscala } from './minha.js?v=20261111-passou';
import { ListaEscalas } from './escalas.js?v=20261109-proprio';
import { ModalConfigEscala } from './configuracao.js?v=20261109-proprio';
import { TelaTrocas } from './trocas.js?v=20261111-seletor';
import { TelaRelatorios } from './relatorios.js?v=20261110-graficos2';
import { TelaPainelDia } from './painel-dia.js?v=20261108-painel-dia';

// WFM — Turnos e Plantões. Um módulo de telas, cada uma com sua rota (screen-wfm*).
// Toda restrição (operação, equipe, perfil, conflito de interesse) é aplicada no backend;
// a tela só esconde o que o perfil não pode usar.

export const ABAS_WFM = [
  { tela: 'screen-wfm-dia', rotulo: 'Painel', icone: 'today', permissao: 'wfm.presenca.lancar' },
  { tela: 'screen-wfm', rotulo: 'Escala', icone: 'calendar_month', permissao: 'wfm.escala.visualizar' },
  { tela: 'screen-wfm-minha-escala', rotulo: 'Minhas escalas', icone: 'today', permissao: 'wfm.escala.propria' },
  { tela: 'screen-wfm-trocas', rotulo: 'Trocas', icone: 'compare_arrows', permissao: 'wfm.troca.visualizar' },
  { tela: 'screen-wfm-presenca', rotulo: 'Presença', icone: 'fact_check', permissao: 'wfm.presenca.lancar' },
  { tela: 'screen-wfm-painel', rotulo: 'Indicadores', icone: 'monitoring', permissao: 'relhub.wfm.painel' },
  { tela: 'screen-wfm-cadastros', rotulo: 'Cadastros', icone: 'settings', permissao: 'wfm.cadastros.visualizar' },
];

const TITULOS = {
  'screen-wfm-dia': ['Painel', 'O dia da operação numa tela: quem está escalado, quem logou, pausas previstas, trocas e presença.'],
  'screen-wfm': ['Escala', 'Crie, configure e acompanhe as escalas. Turnos, horários, pausas, presença e hora extra do dia ficam na escala aberta. Dia sem turno é DSR.'],
  'screen-wfm-minha-escala': ['Minhas escalas', 'Seus turnos em todas as escalas, conforme a última versão publicada.'],
  'screen-wfm-trocas': ['Trocas de plantão', 'Solicite, responda e aprove trocas entre operadores.'],
  'screen-wfm-presenca': ['Presença', 'Lançamento de presença, falta e atestado da sua equipe.'],
  'screen-wfm-painel': ['Indicadores', 'Indicadores e gráficos do período, com comparação ao período anterior. Os relatórios em planilha ficam em Relatórios e Históricos.'],
  'screen-wfm-jornadas': ['Jornadas', 'Limites de jornada, interjornada e pausas obrigatórias.'],
  'screen-wfm-cadastros': ['Cadastros', 'Turnos, calendário especial, skills e jornadas.'],
  'screen-wfm-auditoria': ['Histórico', 'Quem fez o quê, quando, e o valor antes e depois.'],
};

export function abaInicialWfm(controlador) {
  // Supervisor abre no Painel do dia (amostra aprovada em 08/11/2026); os demais seguem a ordem de antes.
  if (controlador.estado?.perfilUsuario === 'supervisor' && controlador.podeAcessarTela('screen-wfm-dia')) return 'screen-wfm-dia';
  const ordem = ['screen-wfm-minha-escala', 'screen-wfm', 'screen-wfm-trocas', 'screen-wfm-presenca', 'screen-wfm-painel', 'screen-wfm-jornadas', 'screen-wfm-cadastros', 'screen-wfm-auditoria'];
  return ordem.find((t) => controlador.podeAcessarTela(t)) || 'screen-wfm';
}

export function TelaWfm({ controlador, telaAtual: telaPedida = 'screen-wfm' }) {
  // Operador/técnicos (só a própria escala, sem ver/editar/criar escalas) não veem a aba Escala: ficam com Minhas escalas e
  // Trocas. Quem também pode CONSULTAR escalas (wfm.escala.visualizar, ex.: Administrador com a própria escala liberada em
  // Perfis) abre a aba Escala normalmente, em leitura.
  const soParticipante = controlador.possuiPermissao('wfm.escala.propria') && !controlador.possuiPermissao('wfm.escala.visualizar')
    && !controlador.possuiPermissao('wfm.escala.editar') && !controlador.possuiPermissao('wfm.escala.criar');
  const telaAtual = soParticipante && telaPedida === 'screen-wfm' ? 'screen-wfm-minha-escala' : telaPedida;
  const { showToast, ToastHost } = useToast();
  const { contexto, erro, recarregar: recarregarContexto } = useContextoWfm();
  const [operacao, setOperacao] = useState('');
  const [anoMes, setAnoMes] = useState(mesAtual());
  // Aba Escala: 'lista' (padrão, lista de escalas) | 'dia' (montar) | 'mes' (visualizar o mês inteiro) | 'pausas'
  const [visaoEscala, setVisaoEscala] = useState('lista');
  // Grade da escala aberta (Semana ou Mês): o seletor de visão do Dia e das Pausas abre a grade já na visão escolhida.
  const [visaoGrade, setVisaoGrade] = useState('semana');
  const verGrade = (v) => { setVisaoGrade(v === 'mes' ? 'mes' : 'semana'); setVisaoEscala('mes'); };
  const [configurandoItem, setConfigurandoItem] = useState(null);
  const [versaoLista, setVersaoLista] = useState(0);
  // Minhas escalas: quem enxerga escalas (Supervisor, Gestor...) alterna entre a própria escala e a da equipe (somente leitura;
  // o escopo da equipe é aplicado no servidor). O Supervisor abre direto na equipe, já que quase não tem escala própria.
  const podeVerEquipe = controlador.possuiPermissao('wfm.escala.visualizar') && !soParticipante && controlador.estado.perfilUsuario !== 'operador';
  const [visaoMinha, setVisaoMinha] = useState(controlador.estado.perfilUsuario === 'supervisor' ? 'equipe' : 'minha');
  useEffect(() => {
    // Também reposiciona quando a escala selecionada deixa de existir (ex.: tipo de escala excluído).
    if (!contexto) return;
    if (contexto.operacoes.length && !contexto.operacoes.some((o) => o.chave === operacao)) setOperacao(contexto.operacoes[0].chave);
    // Sem nenhuma escala (todas excluídas/desativadas): limpa a seleção antiga e volta para a lista.
    else if (!contexto.operacoes.length && operacao) { setOperacao(''); setVisaoEscala('lista'); }
  }, [contexto, operacao]);

  useEffect(() => {
    if (!contexto || !['screen-wfm-dia', 'screen-wfm-presenca', 'screen-wfm-trocas', 'screen-wfm-minha-escala'].includes(telaAtual)) return;
    const ativas = contexto.operacoes.filter((o) => o.escala_ativa !== false);
    if (ativas.length && !ativas.some((o) => o.chave === operacao)) setOperacao(ativas[0].chave);
  }, [contexto, telaAtual, operacao]);

  // "Minhas escalas" segue a permissão wfm.escala.propria: quem pode ser escalado (Operador, Técnicos e Analista de TI).
  const [titulo, descricao] = TITULOS[telaAtual] || TITULOS['screen-wfm'];
  const podeCriarEscala = controlador.possuiPermissao('wfm.escala.criar');
  // Editar a escala aberta vale pela chave de EDITAR (decisão do Paulo, 09/11/2026: vale a chave de Perfis, não o nome do perfil).
  const podeEditarEscala = podeCriarEscala || controlador.possuiPermissao('wfm.escala.editar');
  // Quem só consulta escalas abre a Escala do dia em leitura (sem montar nem publicar).
  const podeAbrirDia = podeEditarEscala || controlador.possuiPermissao('wfm.escala.visualizar');
  const aoVerPausas = controlador.possuiPermissao('wfm.escala.visualizar') ? () => setVisaoEscala('pausas') : undefined;
  const voltarParaLista = () => { setVisaoEscala('lista'); setVersaoLista((v) => v + 1); recarregarContexto(); };
  // Presença, Trocas e Minha escala só fazem sentido com escala ativa; Cadastros e Jornadas seguem a operação.
  const dependeDeEscala = ['screen-wfm-dia', 'screen-wfm-presenca', 'screen-wfm-trocas', 'screen-wfm-minha-escala'].includes(telaAtual);
  const operacoesComEscala = (contexto?.operacoes || []).filter((o) => o.escala_ativa !== false);
  const props = { controlador, contexto, operacao, anoMes, showToast, recarregarContexto, aoTrocarEscala: setOperacao };
  // Selo da aba Presença: total de pendências de confirmação da semana, vindo do servidor.
  const [totalSemanaPresenca, setTotalSemanaPresenca] = useState(null); // na tela Presença, o total da semana mostrada
  const { total: pendenciasServidor } = usePendenciasPresenca(operacao, Boolean(contexto) && controlador.possuiPermissao('wfm.presenca.lancar') && operacoesComEscala.some((o) => o.chave === operacao), telaAtual);
  const pendenciasPresenca = telaAtual === 'screen-wfm-presenca' && totalSemanaPresenca !== null ? totalSemanaPresenca : pendenciasServidor;
  // Selo da aba Escala: escalas aguardando a aprovação deste usuário (Supervisor, Gestor...). Só quem aprova consulta.
  const podeAprovar = controlador.possuiPermissao('wfm.escala.aprovar') && !soParticipante;
  const aprovacoes = usePendenciasAprovacao(podeAprovar, `${telaAtual}:${versaoLista}`);
  // Contagens das telas (Presença: pendências da semana; Escalas: aprovações) vão para a sub-barra da moldura (Fase 15).
  useEffect(() => {
    definirSelos({ 'screen-wfm-presenca': Number(pendenciasPresenca) || 0, 'screen-wfm': Number(aprovacoes.total) || 0 });
  }, [pendenciasPresenca, aprovacoes.total]);

  // Lista de escalas: redesign Fase 15 (a própria ListaEscalas monta a página).
  if (telaAtual === 'screen-wfm' && visaoEscala === 'lista' && contexto && !erro) {
    return html`
      <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Turnos e Plantões" placeholderBusca="Turnos e Plantões" controlador=${controlador} buscaGlobal=${false}>
        <div class="wfm-toast"><${ToastHost} /></div>
        <${ListaEscalas} controlador=${controlador} anoMes=${anoMes} aoMudarMes=${setAnoMes} versao=${versaoLista} showToast=${showToast}
          aprovacoes=${aprovacoes.itens} aoRecarregarAprovacoes=${aprovacoes.recarregar}
          aoAbrir=${(chave, modo) => { setOperacao(chave); setVisaoEscala(modo); }}
          aoConfigurar=${(item) => setConfigurandoItem(item)}
          aoMudou=${() => { recarregarContexto(); setVersaoLista((v) => v + 1); }} />
        ${configurandoItem ? html`<${ModalConfigEscala} operacao=${configurandoItem.chave} nomePadrao=${configurandoItem.operacao} showToast=${showToast} onClose=${() => setConfigurandoItem(null)}
          onSalvo=${() => { setConfigurandoItem(null); setVersaoLista((v) => v + 1); recarregarContexto(); }}
          onMudouLista=${() => { setConfigurandoItem(null); setVersaoLista((v) => v + 1); recarregarContexto(); }} />` : null}
      </${PainelRh}>`;
  }

  // Escala aberta (mensal ou do dia): cabeçalho do módulo, linha de contexto e card principal numa tela só.
  if (telaAtual === 'screen-wfm' && visaoEscala !== 'lista' && contexto && !erro && operacao) {
    const opcoesEscala = podeEditarEscala ? operacoesComEscala.map((o) => [o.chave, o.nome]) : null;
    return html`
      <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Turnos e Plantões" placeholderBusca="Turnos e Plantões" controlador=${controlador} buscaGlobal=${false}>
        <div class="wfm-toast"><${ToastHost} /></div>
        ${visaoEscala === 'mes'
          ? html`<${TelaEscala} key=${visaoGrade} ...${props} visaoInicial=${visaoGrade} aoMudarMes=${setAnoMes} opcoesEscala=${opcoesEscala} somenteLeitura=${!podeEditarEscala} aoVoltarLista=${voltarParaLista} aoVoltarDia=${podeAbrirDia ? () => setVisaoEscala('dia') : undefined} aoPausas=${aoVerPausas} />`
          : visaoEscala === 'pausas'
            ? html`<${TelaEscalaPausas} ...${props} aoMudarMes=${setAnoMes} opcoesEscala=${opcoesEscala} aoVoltarLista=${voltarParaLista} aoDia=${podeAbrirDia ? () => setVisaoEscala('dia') : undefined} aoMes=${verGrade} />`
            : html`<${TelaEscalaTabela} ...${props} aoMudarMes=${setAnoMes} opcoesEscala=${opcoesEscala} somenteLeitura=${!podeEditarEscala} aoVerMes=${verGrade} aoPausas=${aoVerPausas} aoVoltarLista=${voltarParaLista} />`}
        ${configurandoItem ? html`<${ModalConfigEscala} operacao=${configurandoItem.chave} nomePadrao=${configurandoItem.operacao} showToast=${showToast} onClose=${() => setConfigurandoItem(null)}
          onSalvo=${() => { setConfigurandoItem(null); setVersaoLista((v) => v + 1); recarregarContexto(); }}
          onMudouLista=${() => { setConfigurandoItem(null); setVersaoLista((v) => v + 1); recarregarContexto(); }} />` : null}
      </${PainelRh}>`;
  }

  // Painel do dia (aba "Painel", 1ª de Turnos e Plantões): a própria TelaPainelDia monta a página.
  if (telaAtual === 'screen-wfm-dia' && contexto && !erro && operacao && operacoesComEscala.length) {
    // "Ver escala do mês" abre a escala mensal desta escala, no mês do dia mostrado (somente leitura sem 'criar escala').
    const aoVerEscalaMes = controlador.podeAcessarTela('screen-wfm') ? (mes) => { setAnoMes(mes); setVisaoEscala('mes'); controlador.irParaTelaProtegida('screen-wfm'); } : undefined;
    return html`
      <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Turnos e Plantões" placeholderBusca="Turnos e Plantões" controlador=${controlador} buscaGlobal=${false}>
        <div class="wfm-toast"><${ToastHost} /></div>
        <${TelaPainelDia} key=${operacao} controlador=${controlador} contexto=${contexto} operacao=${operacao} showToast=${showToast} aoTrocarEscala=${setOperacao} aoVerEscalaMes=${aoVerEscalaMes} />
      </${PainelRh}>`;
  }

  // Indicadores (antiga aba Painel): redesign Fase 15 (TelaRelatorios com somentePainel monta a página no desenho novo).
  if (telaAtual === 'screen-wfm-painel' && contexto && !erro && operacao && contexto.operacoes.length) {
    return html`
      <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Turnos e Plantões" placeholderBusca="Turnos e Plantões" controlador=${controlador} buscaGlobal=${false}>
        <div class="wfm-toast"><${ToastHost} /></div>
        <${TelaRelatorios} contexto=${contexto} operacao=${operacao} aoTrocarEscala=${setOperacao} showToast=${showToast} somentePainel=${true} />
      </${PainelRh}>`;
  }

  // Minha escala: redesign Fase 15. Quem enxerga a equipe alterna entre a própria escala e a da equipe (somente leitura).
  if (telaAtual === 'screen-wfm-minha-escala' && contexto && !erro && operacao && operacoesComEscala.length) {
    const equipe = podeVerEquipe && visaoMinha === 'equipe';
    const alternar = podeVerEquipe ? html`<${Segmento} rotulo="Escala exibida" valor=${visaoMinha} aoMudar=${setVisaoMinha} opcoes=${[['minha', 'Minha escala'], ['equipe', 'Minha equipe']]} />` : null;
    return html`
      <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Turnos e Plantões" placeholderBusca="Turnos e Plantões" controlador=${controlador} buscaGlobal=${false}>
        <div class="wfm-toast"><${ToastHost} /></div>
        ${equipe ? html`<${TelaEscala} ...${props} somenteLeitura=${true} aoMudarMes=${setAnoMes} acessorio=${alternar} opcoesEscala=${operacoesComEscala.length > 1 ? operacoesComEscala.map((o) => [o.chave, o.nome]) : null} />`
          : html`<${TelaMinhaEscala} contexto=${contexto} operacao=${operacao} showToast=${showToast} podeTrocar=${controlador.possuiPermissao('wfm.troca.solicitar')} nomeUsuario=${controlador.estado?.nomeUsuarioAutenticado || ''} acessorio=${alternar} />`}
      </${PainelRh}>`;
  }

  // Trocas: redesign Fase 15 (a própria TelaTrocas monta a página).
  if (telaAtual === 'screen-wfm-trocas' && contexto && !erro && operacao && operacoesComEscala.length) {
    return html`
      <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Turnos e Plantões" placeholderBusca="Turnos e Plantões" controlador=${controlador} buscaGlobal=${false}>
        <div class="wfm-toast"><${ToastHost} /></div>
        <${TelaTrocas} controlador=${controlador} operacao=${operacao} showToast=${showToast} opcoesEscala=${operacoesComEscala.map((o) => [o.chave, o.nome])} aoTrocarEscala=${setOperacao} />
      </${PainelRh}>`;
  }

  // Presença: redesign Fase 15 (a própria TelaPresenca monta a página).
  if (telaAtual === 'screen-wfm-presenca' && contexto && !erro && operacao && operacoesComEscala.length) {
    return html`
      <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Turnos e Plantões" placeholderBusca="Turnos e Plantões" controlador=${controlador} buscaGlobal=${false}>
        <div class="wfm-toast"><${ToastHost} /></div>
        <${TelaPresenca} controlador=${controlador} operacao=${operacao} showToast=${showToast} aoMudarPendencias=${setTotalSemanaPresenca} opcoesEscala=${operacoesComEscala.map((o) => [o.chave, o.nome])} aoTrocarEscala=${setOperacao} />
      </${PainelRh}>`;
  }

  // Cadastros (redesign Fase 15, amostra Q3): lista lateral com Turnos, Jornadas e limites, Calendário especial, Skills,
  // Tipos de escala e Histórico de alterações. As rotas antigas de Jornadas e do Histórico abrem o item correspondente.
  const emCadastros = ['screen-wfm-cadastros', 'screen-wfm-jornadas', 'screen-wfm-auditoria'].includes(telaAtual);
  if (emCadastros && contexto && !erro && (operacao || telaAtual === 'screen-wfm-auditoria' || contexto.pode_editar_tipos_escala)) {
    const item = { 'screen-wfm-jornadas': 'jornadas', 'screen-wfm-auditoria': 'historico' }[telaAtual] || 'turnos';
    return html`
      <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual === 'screen-wfm-auditoria' && !controlador.podeAcessarTela('screen-wfm-cadastros') ? telaAtual : 'screen-wfm-cadastros'} subtituloMarca="Turnos e Plantões" placeholderBusca="Turnos e Plantões" controlador=${controlador} buscaGlobal=${false}>
        <div class="wfm-toast"><${ToastHost} /></div>
        <${TelaCadastros} ...${props} pagina=${true} itemInicial=${item}
          comJornadas=${controlador.possuiPermissao('wfm.cadastros.visualizar')} comHistorico=${controlador.podeAcessarTela('screen-wfm-auditoria')} />
      </${PainelRh}>`;
  }

  let corpo;
  if (erro) corpo = html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  else if (!contexto) corpo = html`<${LoadingState} titulo="Carregando Turnos e Plantões" />`;
  else if (dependeDeEscala && !operacoesComEscala.length) corpo = html`<${EmptyState} icon="calendar_month" title="Nenhuma escala ativa" text="Não há escalas ativas no momento. Quem gere as escalas pode criar ou ativar uma na aba Escala." />`;
  else if (telaAtual === 'screen-wfm' && visaoEscala === 'lista') corpo = html`
    <${ListaEscalas} controlador=${controlador} anoMes=${anoMes} aoMudarMes=${setAnoMes} versao=${versaoLista} showToast=${showToast}
      aoAbrir=${(chave, modo) => { setOperacao(chave); setVisaoEscala(modo); }}
      aoConfigurar=${(item) => setConfigurandoItem(item)}
      aoMudou=${() => { recarregarContexto(); setVersaoLista((v) => v + 1); }} />`;
  else if (!contexto.operacoes.length && !(telaAtual === 'screen-wfm-cadastros' && contexto.pode_editar_tipos_escala)) corpo = html`<${EmptyState} icon="lock" title="Nenhuma operação vinculada" text="Seu usuário ainda não está vinculado a uma operação. Fale com o Administrador." />`;
  else if (!operacao && !(telaAtual === 'screen-wfm-cadastros' && contexto.pode_editar_tipos_escala)) corpo = html`<${LoadingState} titulo="Carregando" />`;
  else if (telaAtual === 'screen-wfm-minha-escala') {
    const equipe = podeVerEquipe && visaoMinha === 'equipe';
    corpo = html`
      ${podeVerEquipe ? html`<div class="wfm-segmento" role="tablist" aria-label="Escala exibida">
        ${[['minha', 'Minha escala'], ['equipe', 'Minha equipe']].map(([id, rotulo]) => html`<button key=${id} type="button" role="tab" aria-selected=${visaoMinha === id} class=${visaoMinha === id ? 'is-ativo' : ''} onClick=${() => setVisaoMinha(id)}>${rotulo}</button>`)}
      </div>` : null}
      ${equipe ? html`<${TelaEscala} ...${props} somenteLeitura=${true} aoMudarMes=${setAnoMes} opcoesEscala=${operacoesComEscala.length > 1 ? operacoesComEscala.map((o) => [o.chave, o.nome]) : null} />`
        : html`<${TelaMinhaEscala} contexto=${contexto} operacao=${operacao} showToast=${showToast} podeTrocar=${controlador.possuiPermissao('wfm.troca.solicitar')} nomeUsuario=${controlador.estado?.nomeUsuarioAutenticado || ''} />`}`;
  }
  else if (telaAtual === 'screen-wfm-trocas') corpo = html`<${TelaTrocas} controlador=${controlador} operacao=${operacao} showToast=${showToast} />`;
  else if (telaAtual === 'screen-wfm-painel') corpo = html`<${TelaRelatorios} contexto=${contexto} operacao=${operacao} aoTrocarEscala=${setOperacao} showToast=${showToast} somentePainel=${true} />`;
  else if (telaAtual === 'screen-wfm-presenca') corpo = html`<${TelaPresenca} ...${props} />`;
  else if (telaAtual === 'screen-wfm-jornadas') corpo = html`<${TelaCadastros} ...${props} itemInicial="jornadas" comJornadas=${true} />`;
  else if (telaAtual === 'screen-wfm-cadastros') corpo = html`<${TelaCadastros} ...${props} />`;
  else if (visaoEscala === 'mes') corpo = html`
    <${TelaEscala} ...${props} somenteLeitura=${!podeEditarEscala} aoVoltarLista=${voltarParaLista} aoVoltarDia=${podeAbrirDia ? () => setVisaoEscala('dia') : undefined} />`;
  else corpo = html`<${TelaEscalaTabela} ...${props} somenteLeitura=${!podeEditarEscala} aoVerMes=${() => setVisaoEscala('mes')} aoVoltarLista=${voltarParaLista} />`;

  // A lista de escalas é a navegação da aba Escala; sem permissão de criar (ex.: Gestor) não há troca de escala pelo seletor.
  const semOperacao = telaAtual === 'screen-wfm' && (visaoEscala === 'lista' || !podeCriarEscala);
  const semPeriodo = (telaAtual === 'screen-wfm' && visaoEscala === 'lista') || ['screen-wfm-dia', 'screen-wfm-auditoria', 'screen-wfm-painel', 'screen-wfm-minha-escala', 'screen-wfm-trocas', 'screen-wfm-presenca'].includes(telaAtual);
  return html`
    <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca=${telaAtual === 'screen-wfm-auditoria' ? 'Auditoria de Plantões' : 'Turnos e Plantões'} placeholderBusca="Turnos e Plantões" controlador=${controlador} buscaGlobal=${false}>
      <div class="wfm-toast"><${ToastHost} /></div>
      <${PageShell}>
      <div class="mo-cab-solto"><${ModuleHeader} titulo=${titulo} subtitulo=${descricao} /></div>
      <div class="mon-shell">
        ${contexto && (contexto.operacoes.length || telaAtual === 'screen-wfm') && !semPeriodo ? html`<${SeletorPeriodo} contexto=${contexto} operacao=${operacao} setOperacao=${setOperacao} anoMes=${anoMes} setAnoMes=${setAnoMes} semMes=${telaAtual === 'screen-wfm-jornadas'} semOperacao=${semOperacao} soEscalasAtivas=${telaAtual === 'screen-wfm'} />` : null}
        ${corpo}
        ${configurandoItem ? html`<${ModalConfigEscala} operacao=${configurandoItem.chave} nomePadrao=${configurandoItem.operacao} showToast=${showToast} onClose=${() => setConfigurandoItem(null)}
          onSalvo=${() => { setConfigurandoItem(null); setVersaoLista((v) => v + 1); recarregarContexto(); }}
          onMudouLista=${() => { setConfigurandoItem(null); setVersaoLista((v) => v + 1); recarregarContexto(); }} />` : null}
      </div>
      <//>
    </${PainelRh}>`;
}
