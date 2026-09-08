import { html, useEffect, useState } from '../../infraestrutura-react.js';
import {
  Badge,
  EmptyState,
  ModalConfirmacaoAcao,
  PageIntro,
  PainelRh,
  SectionCard,
} from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import {
  criarAmbienteSharePoint,
  excluirAmbienteSharePoint,
  listarAmbientesSharePoint,
  testarAmbienteSharePoint,
} from '../../services/api/sistema.js';
import { listarOperacoes } from '../../services/api/operations.js';

const FORM_INICIAL = {
  operacao_id: '',
  nome: '',
  site_url: '',
  biblioteca_destino: '',
};

const STATUS_BADGE = {
  conectado: { label: 'Conectado', tone: 'success' },
  pendente: { label: 'Pendente de teste', tone: 'warning' },
  erro: { label: 'Erro na conexão', tone: 'danger' },
};

function BadgeStatusAmbiente({ status }) {
  const info = STATUS_BADGE[status] || STATUS_BADGE.pendente;
  return html`<${Badge} label=${info.label} tone=${info.tone} />`;
}

export function TelaNovoAmbienteSharePoint({ controlador }) {
  const [operacoes, setOperacoes] = useState([]);
  const [ambientes, setAmbientes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [feedback, setFeedback] = useState('');

  const [form, setForm] = useState(FORM_INICIAL);
  const [salvando, setSalvando] = useState(false);
  const [testandoId, setTestandoId] = useState(null);
  const [ambienteRemover, setAmbienteRemover] = useState(null);
  const [removendo, setRemovendo] = useState(false);

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    try {
      const [resAmbientes, resOperacoes] = await Promise.all([
        listarAmbientesSharePoint(),
        listarOperacoes(),
      ]);
      setAmbientes(Array.isArray(resAmbientes?.itens) ? resAmbientes.itens : []);
      setOperacoes(Array.isArray(resOperacoes) ? resOperacoes : resOperacoes?.itens || []);
    } catch (error) {
      setErro(error?.message || 'Não foi possível carregar os ambientes cadastrados.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const salvarEValidar = async (event) => {
    event.preventDefault();
    if (!form.nome.trim() || !form.site_url.trim()) {
      setErro('Informe o nome do ambiente e a URL do site do SharePoint.');
      return;
    }
    setSalvando(true);
    setErro('');
    setFeedback('');
    try {
      const criado = await criarAmbienteSharePoint({
        nome: form.nome.trim(),
        operacao_id: form.operacao_id ? Number(form.operacao_id) : null,
        site_url: form.site_url.trim(),
        biblioteca_destino: form.biblioteca_destino.trim(),
      });
      setForm(FORM_INICIAL);
      await carregar();
      if (criado?.id_ambiente) {
        setTestandoId(criado.id_ambiente);
        try {
          const teste = await testarAmbienteSharePoint(criado.id_ambiente);
          setFeedback(
            teste?.success
              ? 'Ambiente criado e conexão validada com sucesso.'
              : `Ambiente criado, mas a conexão ainda não foi validada: ${teste?.mensagem || 'verifique a URL informada.'}`,
          );
        } finally {
          setTestandoId(null);
          await carregar();
        }
      }
    } catch (error) {
      setErro(error?.message || 'Não foi possível criar o ambiente.');
    } finally {
      setSalvando(false);
    }
  };

  const testarNovamente = async (ambiente) => {
    setTestandoId(ambiente.id_ambiente);
    setErro('');
    setFeedback('');
    try {
      const teste = await testarAmbienteSharePoint(ambiente.id_ambiente);
      setFeedback(
        teste?.success
          ? `Conexão com "${ambiente.nome}" validada com sucesso.`
          : `Não foi possível validar "${ambiente.nome}": ${teste?.mensagem || 'verifique a URL informada.'}`,
      );
      await carregar();
    } catch (error) {
      setErro(error?.message || 'Não foi possível testar a conexão deste ambiente.');
    } finally {
      setTestandoId(null);
    }
  };

  const confirmarRemocao = async ({ justificativa }) => {
    if (!ambienteRemover) return;
    setRemovendo(true);
    try {
      await excluirAmbienteSharePoint(ambienteRemover.id_ambiente, justificativa);
      setAmbienteRemover(null);
      setFeedback('Ambiente removido.');
      await carregar();
    } catch (error) {
      setErro(error?.message || 'Não foi possível remover este ambiente.');
    } finally {
      setRemovendo(false);
    }
  };

  return html`
    <${PainelRh}
      screenId="screen-settings-sharepoint-ambiente"
      navAtiva="screen-settings-administracao"
      subtituloMarca="Administração do Conecta"
      placeholderBusca="Administração"
      controlador=${controlador}
      mostrarAtalhos=${false}
    >
      <${PageIntro}
        kicker="Administração › Parâmetros › SharePoint"
        title="Adicionar ambiente"
        description="Ligue a intranet (site SharePoint) de uma operação ao Conecta, para publicações simultâneas no Mural."
      />

      ${feedback ? html`<div class="alert alert-success">${feedback}</div>` : null}
      ${erro ? html`<div class="alert alert-danger">${erro}</div>` : null}

      <${SectionCard} title="Como funciona" className="rh-section-card--flat">
        <div class="rh-def-list mb-0">
          <p class="rh-admin-hint mb-2">
            Um <strong>ambiente</strong> é a ligação entre o Conecta e a intranet (site do SharePoint) de uma
            operação. Depois de cadastrado e validado aqui, o Mural poderá publicar avisos, comunicados, fotos e
            vídeos simultaneamente no Conecta e nessa intranet.
          </p>
          <p class="rh-admin-hint mb-2">
            <strong>O que você precisa antes de começar:</strong> a URL do site SharePoint da intranet da operação
            (peça ao responsável pela operação ou ao time de tecnologia, caso não tenha). As credenciais do
            aplicativo Microsoft usadas para publicar já estão configuradas no servidor e são compartilhadas entre
            todos os ambientes — você não precisa informar nada além da URL.
          </p>
          <p class="rh-admin-hint mb-0">
            <strong>Como conseguir a URL:</strong> abra a intranet da operação no navegador, entre no site do
            SharePoint que deseja conectar e copie o endereço da barra de navegação. Ele costuma ter o formato
            <code>https://suaempresa.sharepoint.com/sites/NomeDoSite</code>.
          </p>
        </div>
      </${SectionCard}>

      <${SectionCard} title="Novo ambiente" className="rh-section-card--flat">
        <form onSubmit=${salvarEValidar}>
          <label class="form-label">Operação vinculada</label>
          <select
            class="form-select mb-3"
            value=${form.operacao_id}
            disabled=${salvando}
            onChange=${(event) => setForm((valor) => ({ ...valor, operacao_id: event.target.value }))}
          >
            <option value="">Selecione a operação (opcional)</option>
            ${operacoes.map(
              (operacao) => html`
                <option key=${operacao.id_item} value=${operacao.id_item}>${operacao.nome}</option>
              `,
            )}
          </select>

          <label class="form-label">Nome do ambiente</label>
          <input
            type="text"
            class="form-control mb-3"
            placeholder="Ex.: Intranet CRF"
            value=${form.nome}
            disabled=${salvando}
            onInput=${(event) => setForm((valor) => ({ ...valor, nome: event.target.value }))}
          />

          <label class="form-label">URL do site SharePoint</label>
          <input
            type="text"
            class="form-control mb-1"
            placeholder="https://suaempresa.sharepoint.com/sites/NomeDoSite"
            value=${form.site_url}
            disabled=${salvando}
            onInput=${(event) => setForm((valor) => ({ ...valor, site_url: event.target.value }))}
          />
          <p class="form-text mb-3">Cole a URL completa do site, como aparece no navegador.</p>

          <label class="form-label">Biblioteca/pasta de destino (opcional)</label>
          <input
            type="text"
            class="form-control mb-1"
            placeholder="Ex.: Avisos do Mural"
            value=${form.biblioteca_destino}
            disabled=${salvando}
            onInput=${(event) => setForm((valor) => ({ ...valor, biblioteca_destino: event.target.value }))}
          />
          <p class="form-text mb-3">
            Nome da biblioteca de documentos ou lista onde as publicações do Mural serão enviadas. Se não souber,
            deixe em branco — pode ser preenchido depois.
          </p>

          <footer class="rh-modal-footer px-0">
            <button
              type="button"
              class="btn btn-outline-secondary"
              disabled=${salvando}
              onClick=${() => controlador.irParaTelaProtegida('screen-settings-administracao')}
            >
              Cancelar
            </button>
            <button type="submit" class="btn btn-primary" disabled=${salvando}>
              ${salvando ? 'Salvando...' : 'Salvar e testar conexão'}
            </button>
          </footer>
        </form>
      </${SectionCard}>

      <${SectionCard} title="Ambientes cadastrados" className="rh-section-card--flat">
        ${carregando
          ? html`<p class="text-muted mb-0">Carregando ambientes...</p>`
          : ambientes.length
            ? html`
                <div class="table-responsive">
                  <table class="table rh-table-compact align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Nome</th>
                        <th>Operação</th>
                        <th>Site</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      ${ambientes.map(
                        (ambiente) => html`
                          <tr key=${ambiente.id_ambiente}>
                            <td>${ambiente.nome}</td>
                            <td>${ambiente.operacao_nome || html`<em>Sem operação</em>`}</td>
                            <td><code>${ambiente.hostname}${ambiente.site_path}</code></td>
                            <td>
                              <${BadgeStatusAmbiente} status=${ambiente.status} />
                              ${ambiente.status === 'erro' && ambiente.ultima_mensagem_teste
                                ? html`<div class="form-text mb-0">${ambiente.ultima_mensagem_teste}</div>`
                                : null}
                            </td>
                            <td class="text-end">
                              <button
                                type="button"
                                class="btn btn-outline-secondary btn-sm me-2"
                                disabled=${testandoId === ambiente.id_ambiente}
                                onClick=${() => testarNovamente(ambiente)}
                              >
                                <span class="material-symbols-outlined">${IconeSvg('sync')}</span>
                                ${testandoId === ambiente.id_ambiente ? 'Testando...' : 'Testar novamente'}
                              </button>
                              <button
                                type="button"
                                class="btn btn-outline-danger btn-sm"
                                onClick=${() => setAmbienteRemover(ambiente)}
                              >
                                <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                                Remover
                              </button>
                            </td>
                          </tr>
                        `,
                      )}
                    </tbody>
                  </table>
                </div>
              `
            : html`
                <${EmptyState}
                  icon="cloud"
                  title="Nenhum ambiente cadastrado"
                  text="Use o formulário acima para conectar a primeira intranet."
                />
              `}
      </${SectionCard}>

      <${ModalConfirmacaoAcao}
        aberto=${Boolean(ambienteRemover)}
        titulo="Remover ambiente"
        descricao=${`Deseja remover o ambiente "${ambienteRemover?.nome || ''}"?`}
        consequencia="O Mural deixará de publicar nesta intranet até que um novo ambiente seja cadastrado."
        reversibilidade="É possível cadastrar este ambiente novamente a qualquer momento."
        textoConfirmar="Remover ambiente"
        tipo="destrutivo"
        carregando=${removendo}
        onClose=${() => setAmbienteRemover(null)}
        onConfirm=${confirmarRemocao}
      />
    </${PainelRh}>
  `;
}
