import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import { criarEscalaWfm, gestaoEscalasWfm } from '../../services/api/wfm.js';
import { Campo, ModalForm } from './formulario.js';

// Tela inicial da aba Escala: a lista de escalas do mês.
//  - Quem cria escalas (Supervisor, Control Desk, Analista de TI): vê todas (ativas e inativas), abre a escala para montar,
//    visualiza o mês inteiro, configura (⚙) e cria novas.
//  - Gestor: tela simples; só as escalas ativas que já saíram de rascunho, com "Visualizar escala".
//  - Demais perfis de leitura: só as escalas ativas, com "Visualizar escala".
// O que cada perfil pode fazer é decidido no servidor; aqui só se escolhe o que mostrar.

const ESTADO = {
  RASCUNHO: ['Rascunho', 'mon-badge--nula'],
  EM_APROVACAO: ['Em aprovação', 'mon-badge--pendente'],
  APROVADA: ['Aprovada', 'mon-badge--ok'],
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

export function ListaEscalas({ controlador, anoMes, versao, showToast, aoAbrir, aoConfigurar, aoMudou }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [criando, setCriando] = useState(false);
  useEffect(() => {
    let ativo = true;
    setErro('');
    gestaoEscalasWfm(anoMes)
      .then((r) => { if (ativo) setDados(r); })
      .catch((e) => { if (ativo) setErro(e?.message || 'Não foi possível carregar as escalas.'); });
    return () => { ativo = false; };
  }, [anoMes, versao]);

  if (erro) return html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  if (!dados) return html`<${LoadingState} titulo="Carregando as escalas" />`;

  const gere = dados.pode_criar;
  const ehGestor = controlador?.estado?.perfilUsuario === 'gestor';
  const itens = dados.itens.filter((e) => (gere || e.ativa) && (!ehGestor || foraDeRascunho(e)));

  return html`
    <section class="mon-card wfm-lista-escalas">
      <div class="wfm-cabecalho wfm-cabecalho--centro">
        <div>
          <h3>Escalas</h3>
          <p class="mon-muted">${gere ? 'Crie, abra e configure as escalas. Cada escala tem seu próprio fluxo de aprovação e publicação.' : ehGestor ? 'Escalas ativas enviadas para aprovação ou já publicadas.' : 'Escalas ativas do mês.'}</p>
        </div>
        ${gere ? html`<div class="wfm-acoes-cab"><button type="button" class="btn btn-primary" onClick=${() => setCriando(true)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Criar escala</button></div>` : null}
      </div>
      ${itens.length ? html`<div class="mon-tabela-wrap"><table class="mon-tabela wfm-tabela-escalas">
        <thead><tr><th>Escala</th><th>Situação no mês</th><th>Colaboradores</th><th>Publicação</th>${gere ? html`<th>Status</th>` : null}<th class="wfm-col-acoes"><span class="visually-hidden">Ações</span></th></tr></thead>
        <tbody>
          ${itens.map((e) => {
            const [rotulo, classe] = e.declinada ? ['Declinada', 'mon-badge--critico'] : (ESTADO[e.aprovacao] || ESTADO.RASCUNHO);
            return html`<tr key=${e.chave} class=${e.ativa ? '' : 'is-inativa'}>
              <td class="wfm-col-nome-escala"><span class="wfm-nome-dia">${e.nome}</span><small class="wfm-sub">${e.operacao}${e.principal ? ' · escala principal' : ''}${e.jornada ? ` · jornada ${e.jornada}` : ''}</small></td>
              <td><span class=${`mon-badge ${classe}`}>${e.fechada ? 'Fechada' : rotulo}</span></td>
              <td>${e.escalados}</td>
              <td>${e.versao_publicada ? `Versão ${e.versao_publicada}` : 'Não publicada'}</td>
              ${gere ? html`<td><span class=${`mon-badge ${e.ativa ? 'mon-badge--ok' : 'mon-badge--nula'}`}>${e.ativa ? 'Ativa' : 'Inativa'}</span></td>` : null}
              <td class="wfm-col-acoes"><span class="wfm-linha-acoes">
                ${gere ? html`<button type="button" class="btn btn-outline-primary btn-sm" disabled=${!e.ativa} onClick=${() => aoAbrir(e.chave, 'dia')}>Abrir escala</button>` : null}
                <button type="button" class="btn btn-outline-secondary btn-sm" title="Visualizar a escala do mês inteiro" onClick=${() => aoAbrir(e.chave, 'mes')}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('calendar_month')}</span><span class="wfm-rotulo-btn">Visualizar escala</span></button>
                ${gere ? html`<button type="button" class="wfm-btn-icone" aria-label=${`Configurações de ${e.nome}`} title="Configurações da escala" onClick=${() => aoConfigurar(e)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('settings')}</span></button>` : null}
              </span></td>
            </tr>`;
          })}
        </tbody>
      </table></div>` : html`<${EmptyState} icon="calendar_month" title=${gere ? 'Nenhuma escala criada' : 'Nenhuma escala para mostrar'} text=${gere ? 'Clique em "Criar escala" para começar.' : ehGestor ? 'Quando uma escala for enviada para aprovação ou publicada, ela aparece aqui.' : 'Não há escalas ativas neste mês.'} />`}
    </section>
    ${criando ? html`<${ModalCriarEscala} operacoes=${dados.operacoes_criacao} showToast=${showToast} onClose=${() => setCriando(false)} onCriada=${(chave) => { setCriando(false); aoMudou?.(chave); }} />` : null}`;
}
