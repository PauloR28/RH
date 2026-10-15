import { html, useEffect, useState } from '../../../infraestrutura-react.js';
import { EmptyState, LoadingState, PainelRh } from '../../../ui/componentes-compartilhados.js';
import { PageHeader, PageShell } from '../../../ui/components/layout-primitivas.js?v=20261005-redesign16';
import { AbasConsole } from '../../../ui/components/console-primitivas.js?v=20261014-historico';
import { useToast } from '../../../shared/hooks/use-toast.js';
import { TelaHistorico } from './historico.js?v=20261014-historico';
import { SeletorPeriodo, mesAtual, useContextoWfm } from './comum.js?v=20261005-redesign16';
import { TelaEscala } from './escala.js?v=20261007-admin-escala';
import { TelaPresenca } from './presenca.js?v=20261010-presenca';
import { TelaCadastros } from './cadastros.js?v=20261005-redesign16';
import { TelaJornadas } from './jornadas.js?v=20261005-redesign16';
import { TelaEscalaTabela } from './tabela.js?v=20261007-admin-escala';
import { TelaMinhaEscala } from './minha.js?v=20261007-admin-escala';
import { ListaEscalas } from './escalas.js?v=20261014-escala';
import { ModalConfigEscala } from './configuracao.js?v=20261005-redesign16';
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
  'screen-wfm-auditoria': ['Histórico', 'Quem fez o quê, quando, e o valor antes e depois.'],
};

export function abaInicialWfm(controlador) {
  const ordem = ['screen-wfm-minha-escala', 'screen-wfm', 'screen-wfm-trocas', 'screen-wfm-presenca', 'screen-wfm-relatorios', 'screen-wfm-jornadas', 'screen-wfm-cadastros', 'screen-wfm-auditoria'];
  return ordem.find((t) => controlador.podeAcessarTela(t)) || 'screen-wfm';
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

  // Lista de escalas: layout novo (cabeçalho, abas, resumo e lista numa tela só); as demais telas do WFM seguem como estão.
  if (telaAtual === 'screen-wfm' && visaoEscala === 'lista' && contexto && !erro) {
    return html`
      <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Turnos e Plantões" placeholderBusca="Turnos e Plantões" controlador=${controlador} buscaGlobal=${false}>
        <div class="wfm-toast"><${ToastHost} /></div>
        <${ListaEscalas} controlador=${controlador} anoMes=${anoMes} aoMudarMes=${setAnoMes} versao=${versaoLista} showToast=${showToast}
          titulo=${titulo} descricao=${descricao}
          abas=${abas.map((a) => ({ id: a.tela, rotulo: a.rotulo, icone: a.icone }))} abaAtiva=${abaAtiva} aoMudarAba=${(tela) => controlador.irParaTelaProtegida(tela)}
          aoAbrir=${(chave, modo) => { setOperacao(chave); setVisaoEscala(modo); }}
          aoConfigurar=${(item) => setConfigurandoItem(item)}
          aoMudou=${() => { recarregarContexto(); setVersaoLista((v) => v + 1); }} />
        ${configurandoItem ? html`<${ModalConfigEscala} operacao=${configurandoItem.chave} nomePadrao=${configurandoItem.operacao} showToast=${showToast} onClose=${() => setConfigurandoItem(null)}
          onSalvo=${() => { setConfigurandoItem(null); setVersaoLista((v) => v + 1); recarregarContexto(); }}
          onMudouLista=${() => { setConfigurandoItem(null); setVersaoLista((v) => v + 1); recarregarContexto(); }} />` : null}
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
  else if (telaAtual === 'screen-wfm-minha-escala') corpo = html`<${TelaMinhaEscala} contexto=${contexto} operacao=${operacao} showToast=${showToast} podeTrocar=${controlador.possuiPermissao('wfm.troca.solicitar')} />`;
  else if (telaAtual === 'screen-wfm-trocas') corpo = html`<${TelaTrocas} controlador=${controlador} operacao=${operacao} showToast=${showToast} />`;
  else if (telaAtual === 'screen-wfm-relatorios') corpo = html`<${TelaRelatorios} contexto=${contexto} operacao=${operacao} aoTrocarEscala=${setOperacao} showToast=${showToast} />`;
  else if (telaAtual === 'screen-wfm-presenca') corpo = html`<${TelaPresenca} ...${props} />`;
  else if (telaAtual === 'screen-wfm-jornadas') corpo = html`<${TelaJornadas} ...${props} />`;
  else if (telaAtual === 'screen-wfm-cadastros') corpo = html`<${TelaCadastros} ...${props} />`;
  else if (visaoEscala === 'mes') corpo = html`
    <${TelaEscala} ...${props} somenteLeitura=${!podeCriarEscala} aoVoltarLista=${voltarParaLista} aoVoltarDia=${podeCriarEscala ? () => setVisaoEscala('dia') : undefined} />`;
  else corpo = html`<${TelaEscalaTabela} ...${props} aoVerMes=${() => setVisaoEscala('mes')} aoVoltarLista=${voltarParaLista} />`;

  // A lista de escalas é a navegação da aba Escala; sem permissão de criar (ex.: Gestor) não há troca de escala pelo seletor.
  const semOperacao = telaAtual === 'screen-wfm' && (visaoEscala === 'lista' || !podeCriarEscala);
  const semPeriodo = (telaAtual === 'screen-wfm' && visaoEscala === 'lista') || ['screen-wfm-auditoria', 'screen-wfm-relatorios', 'screen-wfm-minha-escala', 'screen-wfm-trocas', 'screen-wfm-presenca'].includes(telaAtual);
  return html`
    <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca=${telaAtual === 'screen-wfm-auditoria' ? 'Auditoria de Plantões' : 'Turnos e Plantões'} placeholderBusca="Turnos e Plantões" controlador=${controlador} buscaGlobal=${false}>
      <div class="wfm-toast"><${ToastHost} /></div>
      <${PageShell}>
      <${PageHeader} titulo=${titulo} subtitulo=${descricao} />
      <div class="mon-shell">
        ${telaAtual === 'screen-wfm-auditoria' ? null : html`<${AbasConsole} prefixo="wfm" rotulo="Seções de Turnos e Plantões" itens=${abas.map((a) => ({ id: a.tela, rotulo: a.rotulo, icone: a.icone }))} ativa=${abaAtiva} aoMudar=${(tela) => controlador.irParaTelaProtegida(tela)} />`}
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
