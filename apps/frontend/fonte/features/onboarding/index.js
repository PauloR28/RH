import { html, useEffect, useState } from '../../infraestrutura-react.js';
import {
  atualizarTrilhaOnboarding,
  criarTrilhaOnboarding,
  iniciarOnboardingCandidato,
  lerProgressoOnboardingCandidato,
  listarTrilhasOnboarding,
  marcarItemOnboarding,
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

const ITEM_INICIAL = { titulo: '', descricao: '', obrigatorio: true };
const FORM_INICIAL = { id_trilha: '', nome: '', descricao: '', ativo: true, itens: [] };

function normalizarTextoPerfil(valor) {
  return String(valor || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Sugere a trilha mais aderente à vaga do candidato comparando o texto da
 * vaga com a categoria/nome de cada trilha ativa (correspondência parcial
 * nos dois sentidos). Sem match, cai para a primeira trilha ativa.
 */
function sugerirTrilhaPorPerfil(trilhasAtivas, vagaCandidato) {
  const vaga = normalizarTextoPerfil(vagaCandidato);
  if (!vaga || !trilhasAtivas.length) return trilhasAtivas[0] || null;

  const encontrada = trilhasAtivas.find((trilha) => {
    const categoria = normalizarTextoPerfil(trilha.categoria);
    const nome = normalizarTextoPerfil(trilha.nome);
    return (categoria && (vaga.includes(categoria) || categoria.includes(vaga))) ||
      (nome && (vaga.includes(nome) || nome.includes(vaga)));
  });

  return encontrada || trilhasAtivas[0] || null;
}

function normalizarItensParaEnvio(itens) {
  return itens.map((item, index) => ({
    titulo: item.titulo.trim(),
    descricao: (item.descricao || '').trim(),
    ordem: index,
    obrigatorio: !!item.obrigatorio,
  }));
}

export function TelaOnboarding({ controlador }) {
  const [trilhas, setTrilhas] = useState([]);
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
      const dados = await listarTrilhasOnboarding();
      setTrilhas(Array.isArray(dados) ? dados : []);
    } catch (error) {
      setErro(error?.message || 'Não foi possível carregar as trilhas de onboarding.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const abrirNova = () => {
    setForm({ ...FORM_INICIAL, itens: [{ ...ITEM_INICIAL }] });
    setErroForm('');
    setModalAberto(true);
  };

  const abrirEdicao = (trilha) => {
    setForm({
      id_trilha: trilha.id_trilha,
      nome: trilha.nome || '',
      descricao: trilha.descricao || '',
      ativo: !!trilha.ativo,
      itens: (trilha.itens || []).map((item) => ({
        titulo: item.titulo || '',
        descricao: item.descricao || '',
        obrigatorio: !!item.obrigatorio,
      })),
    });
    setErroForm('');
    setModalAberto(true);
  };

  const fechar = () => {
    setModalAberto(false);
    setForm(FORM_INICIAL);
    setErroForm('');
  };

  const atualizarItem = (index, campo, valor) => {
    setForm((atual) => ({
      ...atual,
      itens: atual.itens.map((item, idx) => (idx === index ? { ...item, [campo]: valor } : item)),
    }));
  };

  const adicionarItem = () => {
    setForm((atual) => ({ ...atual, itens: [...atual.itens, { ...ITEM_INICIAL }] }));
  };

  const removerItem = (index) => {
    setForm((atual) => ({ ...atual, itens: atual.itens.filter((_, idx) => idx !== index) }));
  };

  const moverItem = (index, direcao) => {
    setForm((atual) => {
      const novoIndex = index + direcao;
      if (novoIndex < 0 || novoIndex >= atual.itens.length) return atual;
      const itens = [...atual.itens];
      const [item] = itens.splice(index, 1);
      itens.splice(novoIndex, 0, item);
      return { ...atual, itens };
    });
  };

  const itensValidos = form.itens.every((item) => item.titulo.trim());

  const salvar = async () => {
    setErroForm('');
    if (!form.nome.trim()) {
      setErroForm('Informe o nome da trilha.');
      return;
    }
    if (!itensValidos) {
      setErroForm('Informe o título de todos os itens do checklist.');
      return;
    }

    const payload = {
      nome: form.nome.trim(),
      descricao: form.descricao.trim(),
      ativo: !!form.ativo,
      itens: normalizarItensParaEnvio(form.itens),
    };

    setSalvando(true);
    try {
      if (form.id_trilha) {
        await atualizarTrilhaOnboarding(form.id_trilha, payload);
      } else {
        await criarTrilhaOnboarding(payload);
      }
      fechar();
      await carregar();
    } catch (error) {
      setErroForm(error?.message || 'Não foi possível salvar a trilha de onboarding.');
    } finally {
      setSalvando(false);
    }
  };

  return html`
    <${PainelRh}
      screenId="screen-settings-onboarding"
      navAtiva="screen-settings-onboarding"
      subtituloMarca="Trilhas de onboarding"
      placeholderBusca="Trilhas de onboarding"
      controlador=${controlador}
      acaoPrimaria=${{
      label: 'Nova trilha',
      icon: 'add',
      onClick: abrirNova,
      permissao: 'onboarding.editar',
    }}
    >
      <${PageIntro}
        kicker="Configurações"
        title="Trilhas de onboarding"
       
      />

      ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}

      <${SectionCard} title="Trilhas cadastradas" className="rh-section-card--flat">
        <div class="table-responsive">
          <table class="table align-middle rh-modern-history-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Itens</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${carregando
      ? html`<${SkeletonTableRows} colunas=${4} linhas=${3} />`
      : trilhas.length
        ? trilhas.map(
          (item) => html`
                      <tr key=${item.id_trilha}>
                        <td>
                          <strong>${item.nome}</strong>
                          ${item.descricao ? html`<div class="text-muted small">${item.descricao}</div>` : null}
                        </td>
                        <td>${(item.itens || []).length} item(ns)</td>
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
                        texto="Nenhuma trilha de onboarding cadastrada."
                        icone="checklist"
                      />
                    `}
            </tbody>
          </table>
        </div>
      </${SectionCard}>

      <${ModalPadrao}
        aberto=${modalAberto}
        titulo=${form.id_trilha ? 'Editar trilha de onboarding' : 'Nova trilha de onboarding'}
        subtitulo="Monte o checklist que será aplicado ao iniciar o onboarding de um candidato aprovado."
        onClose=${fechar}
        className="rh-modal-dialog--lg"
      >
        <div class="rh-details-body">
          ${erroForm ? html`<div class="alert alert-warning">${erroForm}</div>` : null}

          <div class="rh-filter-field">
            <label>Nome da trilha</label>
            <input
              class="form-control"
              value=${form.nome}
              onInput=${(event) => setForm({ ...form, nome: event.target.value })}
              placeholder="Ex.: Trilha padrão de onboarding"
            />
          </div>

          <div class="rh-filter-field">
            <label>Descrição (opcional)</label>
            <textarea
              class="form-control"
              rows="2"
              value=${form.descricao}
              onInput=${(event) => setForm({ ...form, descricao: event.target.value })}
            ></textarea>
          </div>

          <label class="d-flex align-items-center gap-2">
            <input
              type="checkbox"
              checked=${form.ativo}
              onChange=${(event) => setForm({ ...form, ativo: !!event.target.checked })}
            />
            <span>Trilha ativa</span>
          </label>

          <div class="rh-filter-field">
            <label>Itens do checklist</label>
            ${form.itens.map(
          (item, index) => html`
                <div key=${index} class="rh-section-card rh-section-card--flat" style=${{ padding: '12px', marginBottom: '8px' }}>
                  <div class="row g-2 align-items-start">
                    <div class="col-md-5">
                      <input
                        class="form-control"
                        placeholder="Título do item"
                        value=${item.titulo}
                        onInput=${(event) => atualizarItem(index, 'titulo', event.target.value)}
                      />
                    </div>
                    <div class="col-md-5">
                      <input
                        class="form-control"
                        placeholder="Descrição (opcional)"
                        value=${item.descricao}
                        onInput=${(event) => atualizarItem(index, 'descricao', event.target.value)}
                      />
                    </div>
                    <div class="col-md-2 d-flex gap-1">
                      <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => moverItem(index, -1)} title="Mover para cima">
                        <span class="material-symbols-outlined">${IconeSvg('arrow_upward')}</span>
                      </button>
                      <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => moverItem(index, 1)} title="Mover para baixo">
                        <span class="material-symbols-outlined">${IconeSvg('arrow_downward')}</span>
                      </button>
                    </div>
                  </div>
                  <div class="d-flex align-items-center justify-content-between mt-2">
                    <label class="d-flex align-items-center gap-2 mb-0">
                      <input
                        type="checkbox"
                        checked=${item.obrigatorio}
                        onChange=${(event) => atualizarItem(index, 'obrigatorio', !!event.target.checked)}
                      />
                      <span>Item obrigatório</span>
                    </label>
                    <button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => removerItem(index)}>
                      <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                      Remover
                    </button>
                  </div>
                </div>
              `,
        )}
            <button type="button" class="btn btn-outline-primary btn-sm" onClick=${adicionarItem}>
              <span class="material-symbols-outlined">${IconeSvg('add')}</span>
              Adicionar item
            </button>
          </div>
        </div>

        <footer class="rh-modal-footer">
          <div class="rh-modal-footer-actions">
            <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${fechar}>
              Cancelar
            </button>
            <button
              type="button"
              class="btn btn-primary"
              disabled=${salvando || !form.nome.trim() || !itensValidos}
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

/**
 * Painel de onboarding de um candidato específico (id_registro em
 * candidatos_processos). Usado embutido na ficha/detalhe do candidato:
 * mostra o progresso do checklist se já iniciado, ou permite escolher uma
 * trilha ativa e iniciar o onboarding.
 */
export function PainelOnboardingCandidato({ idRegistro, controlador, vagaCandidato = '' }) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [progresso, setProgresso] = useState(null);
  const [trilhas, setTrilhas] = useState([]);
  const [trilhaSelecionada, setTrilhaSelecionada] = useState('');
  const [trilhaSugeridaId, setTrilhaSugeridaId] = useState('');
  const [iniciando, setIniciando] = useState(false);

  const podeEditar = controlador?.possuiPermissao?.('onboarding.editar');

  const carregar = async () => {
    if (!idRegistro) return;
    setCarregando(true);
    setErro('');
    try {
      const [progressoResp, trilhasResp] = await Promise.all([
        lerProgressoOnboardingCandidato(idRegistro),
        listarTrilhasOnboarding(),
      ]);
      setProgresso(progressoResp);
      const ativas = (Array.isArray(trilhasResp) ? trilhasResp : []).filter((item) => item.ativo);
      const sugerida = sugerirTrilhaPorPerfil(ativas, vagaCandidato);
      setTrilhas(ativas);
      setTrilhaSugeridaId(sugerida ? String(sugerida.id_trilha) : '');
      if (ativas.length && !trilhaSelecionada) {
        setTrilhaSelecionada(String((sugerida || ativas[0]).id_trilha));
      }
    } catch (error) {
      setErro(error?.message || 'Não foi possível carregar o onboarding deste candidato.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, [idRegistro]);

  const iniciar = async () => {
    if (!trilhaSelecionada) return;
    setIniciando(true);
    setErro('');
    try {
      const resultado = await iniciarOnboardingCandidato({
        id_registro: Number(idRegistro),
        trilha_id: Number(trilhaSelecionada),
      });
      setProgresso(resultado);
    } catch (error) {
      setErro(error?.message || 'Não foi possível iniciar o onboarding.');
    } finally {
      setIniciando(false);
    }
  };

  const alternarItem = async (item) => {
    if (!podeEditar) return;
    try {
      const resultado = await marcarItemOnboarding(item.id_onboarding_item, !item.concluido);
      setProgresso(resultado);
    } catch (error) {
      setErro(error?.message || 'Não foi possível atualizar o item do checklist.');
    }
  };

  if (carregando) {
    return html`<p class="text-muted">Carregando onboarding...</p>`;
  }

  if (erro) {
    return html`<div class="alert alert-warning">${erro}</div>`;
  }

  if (!progresso?.iniciado) {
    const trilhasOrdenadas = trilhaSugeridaId
      ? [
        ...trilhas.filter((trilha) => String(trilha.id_trilha) === trilhaSugeridaId),
        ...trilhas.filter((trilha) => String(trilha.id_trilha) !== trilhaSugeridaId),
      ]
      : trilhas;
    return html`
      <div class="rh-filter-field">
        <p class="text-muted">Nenhum onboarding iniciado para este candidato.</p>
        ${trilhas.length
        ? html`
              <div class="d-flex gap-2 align-items-center">
                <select
                  class="form-select"
                  value=${trilhaSelecionada}
                  onChange=${(event) => setTrilhaSelecionada(event.target.value)}
                >
                  ${trilhasOrdenadas.map(
          (trilha) => html`<option key=${trilha.id_trilha} value=${trilha.id_trilha}>${trilha.nome}${String(trilha.id_trilha) === trilhaSugeridaId ? ' (sugerida para esta vaga)' : ''}</option>`,
        )}
                </select>
                <button
                  type="button"
                  class="btn btn-primary text-nowrap"
                  disabled=${iniciando || !podeEditar}
                  onClick=${iniciar}
                >
                  ${iniciando ? 'Iniciando...' : 'Iniciar onboarding'}
                </button>
              </div>
              ${trilhaSugeridaId
            ? html`<small class="text-muted">Sugerida com base na vaga do candidato. Você pode escolher outra trilha na lista.</small>`
            : null}
            `
        : html`<p class="text-muted">Nenhuma trilha ativa cadastrada. Cadastre uma trilha em Configurações &gt; Trilhas de onboarding.</p>`}
      </div>
    `;
  }

  return html`
    <div class="rh-filter-field">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <strong>Progresso do checklist</strong>
        <span class="rh-chip is-indicacao">${progresso.itens_concluidos}/${progresso.total_itens} (${progresso.percentual_concluido}%)</span>
      </div>
      <ul class="list-unstyled d-flex flex-column gap-2 mb-0">
        ${progresso.itens.map(
    (item) => html`
            <li key=${item.id_onboarding_item} class="d-flex align-items-start gap-2">
              <input
                type="checkbox"
                checked=${!!item.concluido}
                disabled=${!podeEditar}
                onChange=${() => alternarItem(item)}
              />
              <span class=${item.concluido ? 'text-decoration-line-through text-muted' : ''}>
                ${item.titulo}
                ${item.obrigatorio
        ? html`<span class="rh-chip is-indicacao ms-2" style=${{ fontSize: '11px' }}>Obrigatório</span>`
        : null}
              </span>
            </li>
          `,
  )}
      </ul>
    </div>
  `;
}
