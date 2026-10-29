import { html, useEffect, useState } from '../../../infraestrutura-react.js';
import { EmptyState, LoadingState, PainelRh } from '../../../ui/componentes-compartilhados.js';
import { PageShell } from '../../../ui/components/layout-primitivas.js?v=20261005-redesign16';
import { AbasConsole, PaginaConsole, idAba, idPainel } from '../../../ui/components/console-primitivas.js?v=20261022-equipes';
import { ContextField, ModuleHeader, ModuleTabs, Stepper } from '../../../ui/components/modulo-primitivas.js?v=20261023-ajustes';
import { usePendenciasAprovacao, usePendenciasPresenca } from './pendencias.js?v=20261029-fix';
import { useToast } from '../../../shared/hooks/use-toast.js';
import { TelaHistorico } from './historico.js?v=20261029-fix';
import { SeletorPeriodo, mesAtual, useContextoWfm } from './comum.js?v=20261029-fix';
import { TelaEscala } from './escala.js?v=20261029-fix';
import { TelaPresenca } from './presenca.js?v=20261029-fix';
import { TelaCadastros } from './cadastros.js?v=20261029-fix';
import { rotuloMesAno, somarMes } from './escala-ui.js?v=20261029-fix';
import { TelaJornadas } from './jornadas.js?v=20261029-fix';
import { TelaEscalaPausas } from './pausas.js?v=20261029-fix';
import { TelaEscalaTabela } from './tabela.js?v=20261029-fix';
import { TelaMinhaEscala } from './minha.js?v=20261029-fix';
import { ListaEscalas } from './escalas.js?v=20261029-fix';
import { ModalConfigEscala } from './configuracao.js?v=20261029-fix';
import { TelaTrocas } from './trocas.js?v=20261029-fix';
import { TelaRelatorios } from './relatorios.js?v=20261029-fix';

// WFM — Turnos e Plantões. Um módulo de telas, cada uma com sua rota (screen-wfm*).
// Toda restrição (operação, equipe, perfil, conflito de interesse) é aplicada no backend;
// a tela só esconde o que o perfil não pode usar.

export const ABAS_WFM = [
  { tela: 'screen-wfm', rotulo: 'Escala', icone: 'calendar_month', permissao: 'wfm.escala.visualizar' },
  { tela: 'screen-wfm-minha-escala', rotulo: 'Minhas escalas', icone: 'today', permissao: 'wfm.escala.propria' },
  { tela: 'screen-wfm-trocas', rotulo: 'Trocas', icone: 'compare_arrows', permissao: 'wfm.troca.visualizar' },
  { tela: 'screen-wfm-presenca', rotulo: 'Presença', icone: 'fact_check', permissao: 'wfm.presenca.lancar' },
  { tela: 'screen-wfm-painel', rotulo: 'Painel', icone: 'monitoring', permissao: 'relhub.wfm.painel' },
  { tela: 'screen-wfm-jornadas', rotulo: 'Jornadas', icone: 'schedule', permissao: 'wfm.cadastros.visualizar' },
  { tela: 'screen-wfm-cadastros', rotulo: 'Cadastros', icone: 'settings', permissao: 'wfm.cadastros.visualizar' },
];

const TITULOS = {
  'screen-wfm': ['Escala', 'Crie, configure e acompanhe as escalas. Turnos, horários, pausas, presença e hora extra do dia ficam na escala aberta. Dia sem turno é DSR.'],
  'screen-wfm-minha-escala': ['Minhas escalas', 'Seus turnos em todas as escalas, conforme a última versão publicada.'],
  'screen-wfm-trocas': ['Trocas de plantão', 'Solicite, responda e aprove trocas entre operadores.'],
  'screen-wfm-presenca': ['Presença', 'Lançamento de presença, falta e atestado da sua equipe.'],
  'screen-wfm-painel': ['Painel', 'Indicadores e gráficos do período, com comparação ao período anterior. Os relatórios em planilha ficam em Relatórios e Históricos.'],
  'screen-wfm-jornadas': ['Jornadas', 'Limites de jornada, interjornada e pausas obrigatórias.'],
  'screen-wfm-cadastros': ['Cadastros', 'Turnos, calendário especial, skills e jornadas.'],
  'screen-wfm-auditoria': ['Histórico', 'Quem fez o quê, quando, e o valor antes e depois.'],
};

export function abaInicialWfm(controlador) {
  const ordem = ['screen-wfm-minha-escala', 'screen-wfm', 'screen-wfm-trocas', 'screen-wfm-presenca', 'screen-wfm-painel', 'screen-wfm-jornadas', 'screen-wfm-cadastros', 'screen-wfm-auditoria'];
  return ordem.find((t) => controlador.podeAcessarTela(t)) || 'screen-wfm';
}

export function TelaWfm({ controlador, telaAtual: telaPedida = 'screen-wfm' }) {
  // Operador/técnicos (só a própria escala, sem editar/criar) não veem a aba Escala: ficam com Minhas escalas e Trocas.
  const soParticipante = controlador.possuiPermissao('wfm.escala.propria') && !controlador.possuiPermissao('wfm.escala.editar') && !controlador.possuiPermissao('wfm.escala.criar');
  const telaAtual = soParticipante && telaPedida === 'screen-wfm' ? 'screen-wfm-minha-escala' : telaPedida;
  const { showToast, ToastHost } = useToast();
  const { contexto, erro, recarregar: recarregarContexto } = useContextoWfm();
  const [operacao, setOperacao] = useState('');
  const [anoMes, setAnoMes] = useState(mesAtual());
  // Aba Escala: 'lista' (padrão, lista de escalas) | 'dia' (montar) | 'mes' (visualizar o mês inteiro) | 'pausas'
  const [visaoEscala, setVisaoEscala] = useState('lista');
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
    if (!contexto || !['screen-wfm-presenca', 'screen-wfm-trocas', 'screen-wfm-minha-escala'].includes(telaAtual)) return;
    const ativas = contexto.operacoes.filter((o) => o.escala_ativa !== false);
    if (ativas.length && !ativas.some((o) => o.chave === operacao)) setOperacao(ativas[0].chave);
  }, [contexto, telaAtual, operacao]);

  // "Minhas escalas" segue a permissão wfm.escala.propria: quem pode ser escalado (Operador, Técnicos e Analista de TI).
  // Jornadas vive dentro de Cadastros (alternador no topo da tela): uma aba a menos na barra.
  const abas = ABAS_WFM.filter((a) => controlador.possuiPermissao(a.permissao) && a.tela !== 'screen-wfm-jornadas' && !(soParticipante && a.tela === 'screen-wfm'));
  const abaAtiva = telaAtual === 'screen-wfm-jornadas' ? 'screen-wfm-cadastros' : telaAtual;
  const emConfig = ['screen-wfm-cadastros', 'screen-wfm-jornadas'].includes(telaAtual);
  const [titulo, descricao] = TITULOS[telaAtual] || TITULOS['screen-wfm'];
  const podeCriarEscala = controlador.possuiPermissao('wfm.escala.criar');
  const aoVerPausas = controlador.possuiPermissao('wfm.escala.visualizar') ? () => setVisaoEscala('pausas') : undefined;
  const voltarParaLista = () => { setVisaoEscala('lista'); setVersaoLista((v) => v + 1); recarregarContexto(); };
  // Presença, Trocas e Minha escala só fazem sentido com escala ativa; Cadastros e Jornadas seguem a operação.
  const dependeDeEscala = ['screen-wfm-presenca', 'screen-wfm-trocas', 'screen-wfm-minha-escala'].includes(telaAtual);
  const operacoesComEscala = (contexto?.operacoes || []).filter((o) => o.escala_ativa !== false);
  const props = { controlador, contexto, operacao, anoMes, showToast, recarregarContexto, aoTrocarEscala: setOperacao };
  // Selo da aba Presença: total de pendências de confirmação da semana, vindo do servidor.
  const [totalSemanaPresenca, setTotalSemanaPresenca] = useState(null); // na tela Presença, o total da semana mostrada
  const { total: pendenciasServidor } = usePendenciasPresenca(operacao, Boolean(contexto) && controlador.possuiPermissao('wfm.presenca.lancar') && operacoesComEscala.some((o) => o.chave === operacao), telaAtual);
  const pendenciasPresenca = telaAtual === 'screen-wfm-presenca' && totalSemanaPresenca !== null ? totalSemanaPresenca : pendenciasServidor;
  // Selo da aba Escala: escalas aguardando a aprovação deste usuário (Supervisor, Gestor...). Só quem aprova consulta.
  const podeAprovar = controlador.possuiPermissao('wfm.escala.aprovar') && !soParticipante;
  const aprovacoes = usePendenciasAprovacao(podeAprovar, `${telaAtual}:${versaoLista}`);
  const itensAbas = abas.map((a) => ({ id: a.tela, rotulo: a.rotulo, icone: a.icone, selo: a.tela === 'screen-wfm-presenca' ? pendenciasPresenca : a.tela === 'screen-wfm' ? aprovacoes.total : 0 }));

  // Lista de escalas: layout novo (cabeçalho, abas, resumo e lista numa tela só); as demais telas do WFM seguem como estão.
  if (telaAtual === 'screen-wfm' && visaoEscala === 'lista' && contexto && !erro) {
    return html`
      <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Turnos e Plantões" placeholderBusca="Turnos e Plantões" controlador=${controlador} buscaGlobal=${false}>
        <div class="wfm-toast"><${ToastHost} /></div>
        <${ListaEscalas} controlador=${controlador} anoMes=${anoMes} aoMudarMes=${setAnoMes} versao=${versaoLista} showToast=${showToast}
          aprovacoes=${aprovacoes.itens} aoRecarregarAprovacoes=${aprovacoes.recarregar}
          titulo=${titulo} descricao=${descricao}
          abas=${itensAbas} abaAtiva=${abaAtiva} aoMudarAba=${(tela) => controlador.irParaTelaProtegida(tela)}
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
    const opcoesEscala = podeCriarEscala ? operacoesComEscala.map((o) => [o.chave, o.nome]) : null;
    return html`
      <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Turnos e Plantões" placeholderBusca="Turnos e Plantões" controlador=${controlador} buscaGlobal=${false}>
        <div class="wfm-toast"><${ToastHost} /></div>
        <${PaginaConsole} className="cx-pagina--modulo cx-escala-aberta">
          <${ModuleHeader} titulo=${titulo} subtitulo=${descricao}
            abas=${html`<${ModuleTabs} itens=${itensAbas} ativa=${abaAtiva} aoMudar=${(tela) => controlador.irParaTelaProtegida(tela)} />`} />
          ${visaoEscala === 'pausas'
            ? html`<${TelaEscalaPausas} ...${props} aoMudarMes=${setAnoMes} opcoesEscala=${opcoesEscala} aoVoltarLista=${voltarParaLista} aoDia=${podeCriarEscala ? () => setVisaoEscala('dia') : undefined} aoMes=${() => setVisaoEscala('mes')} />`
            : visaoEscala === 'mes'
              ? html`<${TelaEscala} ...${props} aoMudarMes=${setAnoMes} opcoesEscala=${opcoesEscala} somenteLeitura=${!podeCriarEscala} aoVoltarLista=${voltarParaLista} aoVoltarDia=${podeCriarEscala ? () => setVisaoEscala('dia') : undefined} aoPausas=${aoVerPausas} />`
              : html`<${TelaEscalaTabela} ...${props} aoMudarMes=${setAnoMes} opcoesEscala=${opcoesEscala} aoVerMes=${() => setVisaoEscala('mes')} aoPausas=${aoVerPausas} aoVoltarLista=${voltarParaLista} />`}
        <//>
        ${configurandoItem ? html`<${ModalConfigEscala} operacao=${configurandoItem.chave} nomePadrao=${configurandoItem.operacao} showToast=${showToast} onClose=${() => setConfigurandoItem(null)}
          onSalvo=${() => { setConfigurandoItem(null); setVersaoLista((v) => v + 1); recarregarContexto(); }}
          onMudouLista=${() => { setConfigurandoItem(null); setVersaoLista((v) => v + 1); recarregarContexto(); }} />` : null}
      </${PainelRh}>`;
  }

  // Relatórios: cabeçalho do módulo, linha de filtros e card com abas de nível 2, sem rolagem da página.
  if (telaAtual === 'screen-wfm-painel' && contexto && !erro && operacao && contexto.operacoes.length) {
    return html`
      <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Turnos e Plantões" placeholderBusca="Turnos e Plantões" controlador=${controlador} buscaGlobal=${false}>
        <div class="wfm-toast"><${ToastHost} /></div>
        <${PaginaConsole} className="cx-pagina--modulo cx-escala-aberta">
          <${ModuleHeader} titulo=${titulo} subtitulo=${descricao}
            abas=${html`<${ModuleTabs} itens=${itensAbas} ativa=${abaAtiva} aoMudar=${(tela) => controlador.irParaTelaProtegida(tela)} />`} />
          <${TelaRelatorios} contexto=${contexto} operacao=${operacao} aoTrocarEscala=${setOperacao} showToast=${showToast} somentePainel=${true} />
        <//>
      </${PainelRh}>`;
  }

  // Presença: quadro da semana e pendências lado a lado, numa tela só.
  if (telaAtual === 'screen-wfm-presenca' && contexto && !erro && operacao && operacoesComEscala.length) {
    return html`
      <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Turnos e Plantões" placeholderBusca="Turnos e Plantões" controlador=${controlador} buscaGlobal=${false}>
        <div class="wfm-toast"><${ToastHost} /></div>
        <${PaginaConsole} className="cx-pagina--modulo cx-escala-aberta">
          <${ModuleHeader} titulo=${titulo} subtitulo=${descricao}
            abas=${html`<${ModuleTabs} itens=${itensAbas} ativa=${abaAtiva} aoMudar=${(tela) => controlador.irParaTelaProtegida(tela)} />`} />
          <${TelaPresenca} controlador=${controlador} operacao=${operacao} showToast=${showToast} aoMudarPendencias=${setTotalSemanaPresenca} />
        <//>
      </${PainelRh}>`;
  }

  // Cadastros e Jornadas: contexto (escala e mês), sub-abas e os cartões numa tela só.
  if (emConfig && contexto && !erro && operacao && contexto.operacoes.length) {
    const noCadastros = telaAtual === 'screen-wfm-cadastros';
    return html`
      <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Turnos e Plantões" placeholderBusca="Turnos e Plantões" controlador=${controlador} buscaGlobal=${false}>
        <div class="wfm-toast"><${ToastHost} /></div>
        <${PaginaConsole} className="cx-pagina--modulo cx-pagina--rolavel">
          <${ModuleHeader} titulo=${titulo} subtitulo=${descricao}
            abas=${html`<${ModuleTabs} itens=${itensAbas} ativa=${abaAtiva} aoMudar=${(tela) => controlador.irParaTelaProtegida(tela)} />`} />
          <div class="mo-contexto cx-fixo">
            <${ContextField} rotulo="Escala / operação" valor=${operacao} opcoes=${contexto.operacoes.map((o) => [o.chave, o.nome])} aoMudar=${setOperacao} ocultar=${contexto.operacoes.length <= 1} />
            ${noCadastros ? html`<${Stepper} rotulo="Mês" valor=${rotuloMesAno(anoMes)} rotuloAnterior="Mês anterior" rotuloProximo="Próximo mês" aoAnterior=${() => setAnoMes(somarMes(anoMes, -1))} aoProximo=${() => setAnoMes(somarMes(anoMes, 1))} />` : null}
          </div>
          <section class="mo-card-escala cx-cresce mo-cad-card">
            <div class="mo-subabas cx-fixo">
              <${AbasConsole} prefixo="wfmcad" rotulo="Cadastros e jornadas" variante="sublinhada" ativa=${telaAtual}
                itens=${[{ id: 'screen-wfm-cadastros', rotulo: 'Turnos, calendário e skills' }, { id: 'screen-wfm-jornadas', rotulo: 'Jornadas e limites' }]}
                aoMudar=${(tela) => controlador.irParaTelaProtegida(tela)} />
            </div>
            <div class="mo-cad-painel cx-cresce" role="tabpanel" id=${idPainel('wfmcad', telaAtual)} aria-labelledby=${idAba('wfmcad', telaAtual)}>
              ${noCadastros ? html`<${TelaCadastros} ...${props} />` : html`<${TelaJornadas} ...${props} />`}
            </div>
          </section>
        <//>
      </${PainelRh}>`;
  }

  // Histórico (antiga Auditoria de Plantões): layout novo, cabe numa tela só.
  if (telaAtual === 'screen-wfm-auditoria' && contexto && !erro) {
    return html`
      <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Auditoria de Plantões" placeholderBusca="Turnos e Plantões" controlador=${controlador} buscaGlobal=${false}>
        <div class="wfm-toast"><${ToastHost} /></div>
        <${TelaHistorico} contexto=${contexto} showToast=${showToast} />
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
  else if (telaAtual === 'screen-wfm-jornadas') corpo = html`<${TelaJornadas} ...${props} />`;
  else if (telaAtual === 'screen-wfm-cadastros') corpo = html`<${TelaCadastros} ...${props} />`;
  else if (visaoEscala === 'mes') corpo = html`
    <${TelaEscala} ...${props} somenteLeitura=${!podeCriarEscala} aoVoltarLista=${voltarParaLista} aoVoltarDia=${podeCriarEscala ? () => setVisaoEscala('dia') : undefined} />`;
  else corpo = html`<${TelaEscalaTabela} ...${props} aoVerMes=${() => setVisaoEscala('mes')} aoVoltarLista=${voltarParaLista} />`;

  // A lista de escalas é a navegação da aba Escala; sem permissão de criar (ex.: Gestor) não há troca de escala pelo seletor.
  const semOperacao = telaAtual === 'screen-wfm' && (visaoEscala === 'lista' || !podeCriarEscala);
  const semPeriodo = (telaAtual === 'screen-wfm' && visaoEscala === 'lista') || ['screen-wfm-auditoria', 'screen-wfm-painel', 'screen-wfm-minha-escala', 'screen-wfm-trocas', 'screen-wfm-presenca'].includes(telaAtual);
  return html`
    <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca=${telaAtual === 'screen-wfm-auditoria' ? 'Auditoria de Plantões' : 'Turnos e Plantões'} placeholderBusca="Turnos e Plantões" controlador=${controlador} buscaGlobal=${false}>
      <div class="wfm-toast"><${ToastHost} /></div>
      <${PageShell}>
      <div class="mo-cab-solto"><${ModuleHeader} titulo=${titulo} subtitulo=${descricao}
        abas=${html`<${ModuleTabs} itens=${itensAbas} ativa=${abaAtiva} aoMudar=${(tela) => controlador.irParaTelaProtegida(tela)} />`} /></div>
      <div class="mon-shell">
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
      <//>
    </${PainelRh}>`;
}
