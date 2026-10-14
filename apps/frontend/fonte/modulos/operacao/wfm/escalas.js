import { html, useEffect, useState } from '../../../infraestrutura-react.js';
import { criarEscalaWfm, gestaoEscalasWfm, publicarEscalaWfm } from '../../../services/api/wfm.js';
import { Campo, ModalForm } from './formulario.js';
import { AbasConsole, AvisoConsole, BotaoTracejado, CabecalhoConsole, CardResumo, EsqueletoLinhas, EstadoConsole, IconeCx, PaginaConsole, PilulaStatus, idAba, idPainel } from '../../../ui/components/console-primitivas.js?v=20261014-historico';
import { MenuAcoesProcesso } from '../../../ui/components/menu-acoes.js?v=20260930-label';

// Tela inicial da aba Escala: a lista de escalas do mês.
//  - Quem cria escalas (Supervisor, Control Desk, Analista de TI): vê todas (ativas e inativas), abre a escala para montar,
//    visualiza o mês inteiro, configura (⚙) e cria novas.
//  - Gestor: tela simples; só as escalas ativas que já saíram de rascunho, com "Visualizar escala".
//  - Demais perfis de leitura: só as escalas ativas, com "Visualizar escala".
// O que cada perfil pode fazer é decidido no servidor; aqui só se escolhe o que mostrar.

const ESTADO = {
  RASCUNHO: ['Rascunho', 'rascunho'],
  EM_APROVACAO: ['Em aprovação', 'troca'],
  APROVADA: ['Aprovada', 'ativo'],
};

// Escala "sai de rascunho" quando foi enviada, aprovada ou publicada, ou o período já foi fechado.
export const foraDeRascunho = (e) => !e.declinada && (e.aprovacao === 'EM_APROVACAO' || e.aprovacao === 'APROVADA' || e.versao_publicada > 0 || e.fechada);

function ModalCriarEscala({ operacoes, operacaoInicial, onClose, onCriada, showToast }) {
  const [operacao, setOperacao] = useState(operacaoInicial || operacoes[0]?.chave || '');
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const salvar = async (ev) => {
    ev.preventDefault();
    if (!nome.trim()) { setErro('Informe o nome da escala.'); return; }
    setErro('');
    setSalvando(true);
    try {
      const r = await criarEscalaWfm({ operacao_base: operacao, nome: nome.trim() });
      showToast?.('Escala criada.', 'success');
      onCriada(r.chave);
    } catch (e) { setErro(e?.message || 'Não foi possível criar a escala.'); } finally { setSalvando(false); }
  };
  return html`<${ModalForm} titulo="Criar escala" onClose=${onClose} onSubmit=${salvar} erro=${erro} salvando=${salvando} salvarRotulo="Criar escala">
    <div class="wfm-grade-form">
      <${Campo} rotulo="Nome da escala" span=${12} dica="Ex.: Plantão de sábado, Escala 6x1 manhã.">
        <input class="form-control" maxlength="120" autofocus value=${nome} onInput=${(e) => setNome(e.target.value)} />
      </${Campo}>
      <${Campo} rotulo="Operação" span=${12}>
        <select class="form-select" value=${operacao} onChange=${(e) => setOperacao(e.target.value)}>
          ${operacoes.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}
        </select>
      </${Campo}>
    </div>
    <p class="mon-muted">Depois de criar, use o botão de configurações da escala para definir quem aprova, a jornada e outras opções.</p>
  </${ModalForm}>`;
}

const nomeMes = (anoMes) => {
  const [a, m] = anoMes.split('-').map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
};
const rotuloMesAno = (anoMes) => `${nomeMes(anoMes)} de ${anoMes.split('-')[0]}`;
const somarMes = (anoMes, delta) => {
  const [a, m] = anoMes.split('-').map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const ehRascunho = (e) => !e.declinada && !foraDeRascunho(e);
const ehPublicada = (e) => e.versao_publicada > 0;

// Regra de hoje para publicar (a mesma da tela da escala aberta): aprovada (ou período fechado) e com colaboradores.
const motivoSemPublicar = (e) => {
  if (!e.ativa) return 'A escala está inativa.';
  if (!e.escalados) return 'Adicione colaboradores antes de publicar';
  if (!e.fechada && e.aprovacao !== 'APROVADA') return 'A escala precisa ser aprovada pelo Gestor ou Supervisor antes de publicar.';
  return '';
};

export function ListaEscalas({ controlador, anoMes, aoMudarMes, versao, showToast, aoAbrir, aoConfigurar, aoMudou, titulo, descricao, abas, abaAtiva, aoMudarAba }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [tentativa, setTentativa] = useState(0);
  const [criando, setCriando] = useState(false);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('todas');
  const [publicando, setPublicando] = useState('');
  useEffect(() => {
    let ativo = true;
    setErro('');
    setDados(null);
    gestaoEscalasWfm(anoMes)
      .then((r) => { if (ativo) setDados(r); })
      .catch((e) => { if (ativo) setErro(e?.message || 'Não foi possível carregar as escalas.'); });
    return () => { ativo = false; };
  }, [anoMes, versao, tentativa]);

  const gere = Boolean(dados?.pode_criar);
  const ehGestor = controlador?.estado?.perfilUsuario === 'gestor';
  const podePublicar = controlador?.possuiPermissao?.('wfm.escala.publicar');
  const base = dados ? dados.itens.filter((e) => (gere || e.ativa) && (!ehGestor || foraDeRascunho(e))) : [];
  const termo = busca.trim().toLowerCase();
  const itens = base.filter((e) => (filtro === 'todas' || (filtro === 'rascunho' ? ehRascunho(e) : ehPublicada(e)))
    && (!termo || `${e.nome} ${e.operacao}`.toLowerCase().includes(termo)));
  const totais = {
    todas: base.length,
    rascunho: base.filter(ehRascunho).length,
    publicadas: base.filter(ehPublicada).length,
    colaboradores: base.reduce((soma, e) => soma + (Number(e.escalados) || 0), 0),
  };
  const mes = nomeMes(anoMes);
  const semColaboradores = base.filter((e) => ehRascunho(e) && !e.escalados);

  const publicar = async (e) => {
    if (!window.confirm(`Publicar a escala "${e.nome}" de ${rotuloMesAno(anoMes)}?`)) return;
    setPublicando(e.chave);
    try {
      await publicarEscalaWfm({ operacao: e.chave, ano_mes: anoMes, justificativa: '' });
      showToast?.('Escala publicada.', 'success');
      aoMudou?.();
    } catch (err) {
      showToast?.(`${err?.message || 'Não foi possível publicar.'} Se for preciso justificar, abra a escala para publicar.`, 'error');
    } finally { setPublicando(''); }
  };

  const botaoNova = gere ? html`<button type="button" class="cx-btn cx-btn--primario" onClick=${() => setCriando(true)}><${IconeCx} nome="add" />Nova escala</button>` : null;
  const corpoTabela = () => {
    if (erro) return html`<${EstadoConsole} mensagem=${erro} rotuloAcao="Tentar de novo" aoAcao=${() => setTentativa((t) => t + 1)} />`;
    if (!dados) return html`<${EsqueletoLinhas} linhas=${5} altura=${62} />`;
    if (!base.length) return html`<${EstadoConsole} mensagem=${gere ? `Nenhuma escala em ${mes}` : ehGestor ? 'Quando uma escala for enviada para aprovação ou publicada, ela aparece aqui.' : `Não há escalas ativas em ${mes}.`} rotuloAcao=${gere ? 'Nova escala' : undefined} aoAcao=${() => setCriando(true)} />`;
    if (!itens.length) return html`<${EstadoConsole} mensagem="Nenhuma escala encontrada." rotuloAcao="Limpar filtros" aoAcao=${() => { setBusca(''); setFiltro('todas'); }} />`;
    return html`
      <table class="cx-tabela">
        <thead><tr>
          <th scope="col">Escala</th><th scope="col" class="cx-col-situacao">Situação no mês</th>
          <th scope="col" class="cx-col-num">Colaboradores</th><th scope="col" class="cx-col-pub">Publicação</th>
          <th scope="col" class="cx-col-num cx-col-acoes">Ações</th>
        </tr></thead>
        <tbody>${itens.map((e) => {
    const [rotulo, variante] = e.declinada ? ['Declinada', 'falta'] : (ESTADO[e.aprovacao] || ESTADO.RASCUNHO);
    const motivo = motivoSemPublicar(e);
    return html`<tr key=${e.chave}>
            <td><div class="cx-linha-nome cx-trunca" title=${e.nome}>${e.nome}</div>
              <div class="cx-linha-sub cx-trunca" title=${e.operacao}>${e.operacao}${e.principal ? ' · principal' : ''}${e.jornada ? ` · jornada ${e.jornada}` : ''}${gere && !e.ativa ? ' · inativa' : ''}</div></td>
            <td><${PilulaStatus} variante=${e.fechada ? 'inativo' : variante}>${e.fechada ? 'Fechada' : rotulo}</${PilulaStatus}></td>
            <td class="cx-col-num">${e.escalados}</td>
            <td>${e.versao_publicada ? `Versão ${e.versao_publicada}` : 'Não publicada'}</td>
            <td class="cx-col-num"><span class="cx-linha-acoes">
              <button type="button" class="cx-btn cx-btn--sm cx-btn--suave" title="Visualizar a escala do mês inteiro" onClick=${() => aoAbrir(e.chave, 'mes')}><${IconeCx} nome="calendar_month" />Visualizar</button>
              ${podePublicar ? html`<span title=${motivo || undefined}><button type="button" class="cx-btn cx-btn--sm" disabled=${Boolean(motivo) || publicando === e.chave} onClick=${() => publicar(e)}>${publicando === e.chave ? 'Publicando...' : 'Publicar'}</button></span>` : null}
              ${gere ? html`<${MenuAcoesProcesso} ariaLabel=${`Mais ações de ${e.nome}`} icon="more_horiz" triggerClassName="cx-icone-btn cx-icone-btn--borda"
                acoes=${[
        { label: 'Abrir escala', icon: 'edit_note', disabled: !e.ativa, onClick: () => aoAbrir(e.chave, 'dia') },
        { label: 'Configurações da escala', icon: 'settings', onClick: () => aoConfigurar(e) },
      ]} />` : null}
            </span></td>
          </tr>`;
  })}</tbody>
      </table>`;
  };

  const chips = [['todas', 'Todas', totais.todas], ['rascunho', 'Rascunho', totais.rascunho], ['publicadas', 'Publicadas', totais.publicadas]];
  return html`
    <${PaginaConsole} espaco14=${true} className="cx-escala">
      <${CabecalhoConsole} titulo=${titulo} subtitulo=${descricao} acoes=${botaoNova} />
      ${abas?.length ? html`<div class="cx-fixo"><${AbasConsole} prefixo="wfm" rotulo="Seções de Turnos e Plantões" itens=${abas} ativa=${abaAtiva} aoMudar=${aoMudarAba} /></div>` : null}
      <div class="cx-resumos" aria-busy=${!dados && !erro}>
        <${CardResumo} icone="calendar_month" rotulo=${`Escalas em ${mes}`} valor=${dados ? totais.todas : '—'} />
        <${CardResumo} icone="edit_note" rotulo="Em rascunho" valor=${dados ? totais.rascunho : '—'} />
        <${CardResumo} icone="event_available" tom="sucesso" rotulo="Publicadas" valor=${dados ? totais.publicadas : '—'} />
        <${CardResumo} icone="groups" rotulo="Colaboradores escalados" valor=${dados ? totais.colaboradores : '—'} />
      </div>
      <div class="cx-escala-corpo cx-cresce" role="tabpanel" id=${idPainel('wfm', abaAtiva)} aria-labelledby=${idAba('wfm', abaAtiva)}>
        <section class="cx-card">
          <div class="cx-toolbar" role="search">
            <label class="cx-busca"><${IconeCx} nome="search" /><input type="search" value=${busca} placeholder="Buscar escala" aria-label="Buscar escala" onInput=${(ev) => setBusca(ev.target.value)} /></label>
            <div class="cx-mes" role="group" aria-label="Mês">
              <button type="button" class="cx-icone-btn" aria-label="Mês anterior" onClick=${() => aoMudarMes?.(somarMes(anoMes, -1))}><${IconeCx} nome="chevron_left" /></button>
              <span class="cx-mes-rotulo" aria-live="polite">${rotuloMesAno(anoMes)}</span>
              <button type="button" class="cx-icone-btn" aria-label="Próximo mês" onClick=${() => aoMudarMes?.(somarMes(anoMes, 1))}><${IconeCx} nome="chevron_right" /></button>
            </div>
            <div class="cx-chips" role="group" aria-label="Filtrar por situação">
              ${chips.map(([id, rotulo, n]) => html`<button key=${id} type="button" class="cx-chip" aria-pressed=${filtro === id} onClick=${() => setFiltro(id)}>${rotulo} <span class="cx-chip-n">${n}</span></button>`)}
            </div>
          </div>
          <div class="cx-card-corpo">${corpoTabela()}</div>
          ${gere && dados ? html`<div class="cx-card-rodape cx-card-rodape--solto"><${BotaoTracejado} onClick=${() => setCriando(true)}>Criar outra escala para ${mes}</${BotaoTracejado}></div>` : null}
        </section>
        <aside class="cx-escala-lateral">
          <section class="cx-card">
            <div class="cx-card-cab"><div class="cx-card-titulo"><p class="cx-sobre">Próximos passos</p><h2 class="cx-h2">Para publicar o mês</h2></div></div>
            <div class="cx-card-corpo cx-passos-corpo">
              ${!dados ? html`<${EsqueletoLinhas} linhas=${3} altura=${40} />` : base.length && totais.publicadas === base.length
      ? html`<p class="cx-legenda">Todas as escalas de ${mes} já estão publicadas.</p>`
      : html`<ol class="cx-passos">
                ${semColaboradores.map((e) => html`<li key=${e.chave}><button type="button" class="cx-passo-link" onClick=${() => aoAbrir(e.chave, gere && e.ativa ? 'dia' : 'mes')}><strong title=${e.nome}>${e.nome}</strong> está sem colaboradores.</button></li>`)}
                <li><span>Depois, use Publicar em cada escala.</span></li>
              </ol>`}
            </div>
          </section>
          <${AvisoConsole} suave=${true}>Dia sem turno é DSR. Turnos, horários, pausas, presença e hora extra ficam dentro de cada escala aberta.</${AvisoConsole}>
        </aside>
      </div>
    </${PaginaConsole}>
    ${criando ? html`<${ModalCriarEscala} operacoes=${dados?.operacoes_criacao || []} showToast=${showToast} onClose=${() => setCriando(false)} onCriada=${(chave) => { setCriando(false); aoMudou?.(chave); }} />` : null}`;
}
