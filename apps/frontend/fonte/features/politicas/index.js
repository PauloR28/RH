import { html, useEffect, useState } from '../../infraestrutura-react.js';
import {
  atualizarPolitica,
  criarPolitica,
  listarPoliticas,
} from '../../servico-api.js';
import {
  ModalPadrao,
  PageIntro,
  PainelRh,
  SectionCard,
} from '../../ui/componentes-compartilhados.js';
import { TabelaVazia } from '../../shared/components/empty-table-row.js';
import { SkeletonTableRows } from '../../shared/components/skeleton.js';
import { IconeSvg } from '../../ui/icone.js';

const FORM_INICIAL = { id_politica: '', titulo: '', corpo_texto: '', ativo: true };

export function TelaPoliticas({ controlador }) {
  const [politicas, setPoliticas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState('');

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    try {
      const dados = await listarPoliticas();
      setPoliticas(Array.isArray(dados) ? dados : []);
    } catch (error) {
      setErro(error?.message || 'Não foi possível carregar as políticas cadastradas.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const abrirNova = () => {
    setForm(FORM_INICIAL);
    setErroForm('');
    setModalAberto(true);
  };

  const abrirEdicao = (item) => {
    setForm({
      id_politica: item.id_politica,
      titulo: item.titulo || '',
      corpo_texto: item.corpo_texto || '',
      ativo: !!item.ativo,
    });
    setErroForm('');
    setModalAberto(true);
  };

  const fechar = () => {
    setModalAberto(false);
    setForm(FORM_INICIAL);
    setErroForm('');
  };

  const salvar = async () => {
    setErroForm('');
    const payload = {
      titulo: form.titulo.trim(),
      corpo_texto: form.corpo_texto.trim(),
      ativo: !!form.ativo,
    };

    setSalvando(true);
    try {
      if (form.id_politica) {
        await atualizarPolitica(form.id_politica, payload);
      } else {
        await criarPolitica(payload);
      }
      fechar();
      await carregar();
    } catch (error) {
      setErroForm(error?.message || 'Não foi possível salvar a política.');
    } finally {
      setSalvando(false);
    }
  };

  return html`
    <${PainelRh}
      screenId="screen-settings-policies"
      navAtiva="screen-settings-policies"
      subtituloMarca="Políticas institucionais"
      placeholderBusca="Políticas"
      controlador=${controlador}
      acaoPrimaria=${{
      label: 'Nova política',
      icon: 'add',
      onClick: abrirNova,
      permissao: 'politicas.editar',
    }}
    >
      <${PageIntro}
        kicker="Configurações"
        title="Políticas institucionais"
        description="Cadastre políticas (ex.: dados, código de conduta). A política ativa mais recente é exibida em um aviso bloqueante para os usuários que ainda não confirmaram a leitura."
      />

      ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}

      <${SectionCard} title="Políticas cadastradas" className="rh-section-card--flat">
        <div class="table-responsive">
          <table class="table align-middle rh-modern-history-table">
            <thead>
              <tr>
                <th>Título</th>
                <th>Versão</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${carregando
      ? html`<${SkeletonTableRows} colunas=${4} linhas=${3} />`
      : politicas.length
        ? politicas.map(
          (item) => html`
                      <tr key=${item.id_politica}>
                        <td><strong>${item.titulo}</strong></td>
                        <td>v${item.versao}</td>
                        <td>
                          <span class=${`rh-status-pill ${item.ativo ? 'is-finished' : ''}`}>
                            ${item.ativo ? 'Ativa' : 'Inativa'}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            class="btn btn-outline-secondary btn-sm"
                            onClick=${() => abrirEdicao(item)}
                          >
                            <span class="material-symbols-outlined">${IconeSvg('edit')}</span>
                            Editar
                          </button>
                        </td>
                      </tr>
                    `,
        )
        : html`
                      <${TabelaVazia}
                        colunas=${4}
                        texto="Nenhuma política cadastrada."
                        icone="policy"
                      />
                    `}
            </tbody>
          </table>
        </div>
      </${SectionCard}>

      <${ModalPadrao}
        aberto=${modalAberto}
        titulo=${form.id_politica ? 'Editar política' : 'Nova política'}
        subtitulo="Ao ativar, os usuários que ainda não confirmaram a leitura verão um aviso bloqueante no próximo acesso."
        onClose=${fechar}
      >
        <div class="rh-details-body">
          ${erroForm ? html`<div class="alert alert-warning">${erroForm}</div>` : null}

          <div class="rh-filter-field">
            <label>Título</label>
            <input
              class="form-control"
              value=${form.titulo}
              onInput=${(event) => setForm({ ...form, titulo: event.target.value })}
              placeholder="Ex.: Política de Proteção de Dados"
            />
          </div>

          <div class="rh-filter-field">
            <label>Texto da política</label>
            <textarea
              class="form-control"
              rows="10"
              value=${form.corpo_texto}
              onInput=${(event) => setForm({ ...form, corpo_texto: event.target.value })}
            ></textarea>
          </div>

          <label class="d-flex align-items-center gap-2">
            <input
              type="checkbox"
              checked=${form.ativo}
              onChange=${(event) => setForm({ ...form, ativo: !!event.target.checked })}
            />
            <span>Política ativa (exige confirmação de leitura dos usuários)</span>
          </label>
        </div>

        <footer class="rh-modal-footer">
          <div class="rh-modal-footer-actions">
            <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${fechar}>
              Cancelar
            </button>
            <button
              type="button"
              class="btn btn-primary"
              disabled=${salvando || !form.titulo.trim() || !form.corpo_texto.trim()}
              onClick=${salvar}
            >
              ${salvando ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </footer>
      </${ModalPadrao}>
    </${PainelRh}>
  `;
}
