import { html, useEffect, useState } from '../../infraestrutura-react.js';
import {
  atualizarValorEmpresa,
  criarValorEmpresa,
  enviarRespostasFitCulturalPublicas,
  lerResultadoFitCultural,
  listarFrasesFitCulturalPublicas,
  listarValoresEmpresa,
} from '../../servico-api.js';
import { ModalPadrao, PageIntro, PainelRh, SectionCard } from '../../ui/componentes-compartilhados.js';
import { TabelaVazia } from '../../shared/components/empty-table-row.js';
import { SkeletonTableRows } from '../../shared/components/skeleton.js';
import { obterCandidatoProcessoIdFitCulturalPorHash } from '../../rotas.js';
import { IconeSvg } from '../../ui/icone.js';

const FRASE_VAZIA = () => ({ frase: '' });
const FORM_INICIAL = () => ({ id_valor: '', nome: '', descricao: '', ativo: true, frases: [FRASE_VAZIA()] });
const OPCOES_LIKERT = [
  { valor: 1, label: 'Discordo totalmente' },
  { valor: 2, label: 'Discordo' },
  { valor: 3, label: 'Neutro' },
  { valor: 4, label: 'Concordo' },
  { valor: 5, label: 'Concordo totalmente' },
];

// ----------------------------------------------------------------------
// RH: administração dos valores da empresa e frases associadas
// ----------------------------------------------------------------------
export function TelaFitCulturalAdmin({ controlador }) {
  const [valores, setValores] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL());
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState('');

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    try {
      const resposta = await listarValoresEmpresa();
      setValores(Array.isArray(resposta) ? resposta : []);
    } catch (error) {
      setErro(error?.message || 'Não foi possível carregar os valores da empresa.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const abrirNovo = () => {
    setForm(FORM_INICIAL());
    setErroForm('');
    setModalAberto(true);
  };

  const abrirEdicao = (valor) => {
    setForm({
      id_valor: valor.id_valor,
      nome: valor.nome || '',
      descricao: valor.descricao || '',
      ativo: valor.ativo !== false,
      frases: (valor.frases || []).length ? valor.frases.map((f) => ({ frase: f.frase, id_frase: f.id_frase })) : [FRASE_VAZIA()],
    });
    setErroForm('');
    setModalAberto(true);
  };

  const fechar = () => {
    setModalAberto(false);
    setErroForm('');
  };

  const atualizarFrase = (indice, valor) => {
    setForm((atual) => ({
      ...atual,
      frases: atual.frases.map((f, idx) => (idx === indice ? { ...f, frase: valor } : f)),
    }));
  };

  const adicionarFrase = () => setForm((atual) => ({ ...atual, frases: [...atual.frases, FRASE_VAZIA()] }));
  const removerFrase = (indice) =>
    setForm((atual) => ({ ...atual, frases: atual.frases.filter((_, idx) => idx !== indice) }));

  const formValido = form.nome.trim() && form.frases.some((f) => f.frase.trim());

  const salvar = async () => {
    setErroForm('');
    if (!formValido) {
      setErroForm('Informe o nome do valor e ao menos uma frase.');
      return;
    }
    const payload = {
      nome: form.nome.trim(),
      descricao: form.descricao.trim(),
      ativo: !!form.ativo,
      frases: form.frases
        .filter((f) => f.frase.trim())
        .map((f, ordem) => ({ frase: f.frase.trim(), ordem })),
    };
    setSalvando(true);
    try {
      if (form.id_valor) {
        await atualizarValorEmpresa(form.id_valor, payload);
      } else {
        await criarValorEmpresa(payload);
      }
      fechar();
      await carregar();
    } catch (error) {
      setErroForm(error?.message || 'Não foi possível salvar o valor da empresa.');
    } finally {
      setSalvando(false);
    }
  };

  return html`
    <${PainelRh}
      screenId="screen-settings-fit-cultural"
      navAtiva="screen-settings-fit-cultural"
      subtituloMarca="Fit Cultural"
      placeholderBusca="Fit Cultural"
      controlador=${controlador}
      acaoPrimaria=${{
        label: 'Novo valor',
        icon: 'add',
        onClick: abrirNovo,
        permissao: 'fit_cultural.editar',
      }}
    >
      <${PageIntro}
        kicker="Testes complementares"
        title="Fit Cultural"
        description="Cadastre os valores da empresa e as frases associadas a cada um. O candidato responde cada frase em uma escala de concordância de 1 a 5."
      />

      ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}

      <${SectionCard} title="Valores cadastrados" className="rh-section-card--flat">
        <div class="table-responsive">
          <table class="table align-middle rh-modern-history-table">
            <thead>
              <tr>
                <th>Valor</th>
                <th>Frases</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${carregando
        ? html`<${SkeletonTableRows} colunas=${4} linhas=${3} />`
        : valores.length
          ? valores.map(
            (valor) => html`
                      <tr key=${valor.id_valor}>
                        <td>
                          <strong>${valor.nome}</strong>
                          <div class="text-muted" style=${{ fontSize: '12px' }}>${valor.descricao || ''}</div>
                        </td>
                        <td>${(valor.frases || []).length} frase(s)</td>
                        <td>
                          <span class=${`rh-status-pill ${valor.ativo ? 'is-finished' : ''}`}>
                            ${valor.ativo ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                        <td>
                          <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => abrirEdicao(valor)}>
                            <span class="material-symbols-outlined">${IconeSvg('edit')}</span>
                            Editar
                          </button>
                        </td>
                      </tr>
                    `,
          )
          : html`<${TabelaVazia} colunas=${4} texto="Nenhum valor da empresa cadastrado." icone="diversity_3" />`}
            </tbody>
          </table>
        </div>
      </${SectionCard}>

      <${ModalPadrao}
        aberto=${modalAberto}
        titulo=${form.id_valor ? 'Editar valor da empresa' : 'Novo valor da empresa'}
        onClose=${fechar}
        className="rh-modal-dialog--lg"
      >
        <div class="rh-details-body">
          ${erroForm ? html`<div class="alert alert-warning">${erroForm}</div>` : null}

          <div class="rh-filter-field">
            <label>Nome do valor</label>
            <input
              class="form-control"
              value=${form.nome}
              onInput=${(event) => setForm({ ...form, nome: event.target.value })}
              placeholder="Ex.: Colaboração"
            />
          </div>

          <div class="rh-filter-field">
            <label>Descrição</label>
            <textarea
              class="form-control"
              rows="2"
              value=${form.descricao}
              onInput=${(event) => setForm({ ...form, descricao: event.target.value })}
            ></textarea>
          </div>

          <div class="rh-filter-field">
            <label>Frases associadas</label>
            ${form.frases.map(
        (frase, indice) => html`
                <div class="d-flex gap-2 align-items-center" key=${indice} style=${{ marginBottom: '8px' }}>
                  <input
                    class="form-control"
                    value=${frase.frase}
                    onInput=${(event) => atualizarFrase(indice, event.target.value)}
                    placeholder="Ex.: Costumo ajudar colegas mesmo sem ser solicitado."
                  />
                  <button
                    type="button"
                    class="btn btn-outline-danger btn-sm"
                    disabled=${form.frases.length <= 1}
                    onClick=${() => removerFrase(indice)}
                  >
                    <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                  </button>
                </div>
              `,
      )}
            <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${adicionarFrase}>
              <span class="material-symbols-outlined">${IconeSvg('add')}</span>
              Adicionar frase
            </button>
          </div>

          <label class="d-flex align-items-center gap-2" style=${{ marginTop: '16px' }}>
            <input
              type="checkbox"
              checked=${form.ativo}
              onChange=${(event) => setForm({ ...form, ativo: !!event.target.checked })}
            />
            <span>Valor ativo</span>
          </label>
        </div>

        <footer class="rh-modal-footer">
          <div class="rh-modal-footer-actions">
            <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${fechar}>
              Cancelar
            </button>
            <button type="button" class="btn btn-primary" disabled=${salvando || !formValido} onClick=${salvar}>
              ${salvando ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </footer>
      </${ModalPadrao}>
    </${PainelRh}>
  `;
}

// ----------------------------------------------------------------------
// Candidato: aplicação pública (Likert 1-5 por frase)
// ----------------------------------------------------------------------
export function TelaFitCulturalTestePublico() {
  const [candidatoProcessoId, setCandidatoProcessoId] = useState(() =>
    obterCandidatoProcessoIdFitCulturalPorHash(window.location.hash),
  );
  const [frases, setFrases] = useState([]);
  const [respostas, setRespostas] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [concluido, setConcluido] = useState(false);

  useEffect(() => {
    const aoTrocarHash = () =>
      setCandidatoProcessoId(obterCandidatoProcessoIdFitCulturalPorHash(window.location.hash));
    window.addEventListener('hashchange', aoTrocarHash);
    return () => window.removeEventListener('hashchange', aoTrocarHash);
  }, []);

  useEffect(() => {
    if (!candidatoProcessoId) {
      setErro('Link de teste inválido.');
      setCarregando(false);
      return;
    }
    setCarregando(true);
    listarFrasesFitCulturalPublicas()
      .then((dados) => setFrases(Array.isArray(dados) ? dados : []))
      .catch((error) => setErro(error?.message || 'Não foi possível carregar o questionário.'))
      .finally(() => setCarregando(false));
  }, [candidatoProcessoId]);

  const responder = (fraseId, nota) => setRespostas((atual) => ({ ...atual, [fraseId]: nota }));

  const enviar = async () => {
    setErro('');
    if (frases.some((frase) => !respostas[frase.id_frase])) {
      setErro('Responda todas as frases antes de enviar.');
      return;
    }
    setEnviando(true);
    try {
      await enviarRespostasFitCulturalPublicas({
        candidato_processo_id: Number(candidatoProcessoId),
        respostas: frases.map((frase) => ({ frase_id: frase.id_frase, nota_concordancia: respostas[frase.id_frase] })),
      });
      setConcluido(true);
    } catch (error) {
      setErro(error?.message || 'Não foi possível enviar suas respostas.');
    } finally {
      setEnviando(false);
    }
  };

  if (carregando) {
    return html`
      <section class="active screen" id="screen-fit-cultural-teste">
        <div class="rh-teste-publico-shell"><p>Carregando questionário...</p></div>
      </section>
    `;
  }

  if (concluido) {
    return html`
      <section class="active screen" id="screen-fit-cultural-teste">
        <div class="rh-teste-publico-shell">
          <div class="rh-teste-publico-card">
            <h2>Questionário concluído</h2>
            <p>Suas respostas foram registradas com sucesso. Obrigado pela participação!</p>
          </div>
        </div>
      </section>
    `;
  }

  const respondidas = Object.keys(respostas).length;

  return html`
    <section class="active screen" id="screen-fit-cultural-teste">
      <div class="rh-teste-publico-shell">
        <h2>Questionário de fit cultural</h2>
        <p class="text-muted">Indique o quanto você concorda com cada frase abaixo (1 = discordo totalmente, 5 = concordo totalmente).</p>

        ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}

        <div class="rh-teste-publico-card">
          ${frases.map(
        (frase) => html`
              <div class="rh-likert-frase" key=${frase.id_frase}>
                <p style=${{ marginBottom: 0 }}>${frase.frase}</p>
                <div class="rh-likert-opcoes">
                  ${OPCOES_LIKERT.map(
          (opcao) => html`
                      <button
                        type="button"
                        class=${`rh-likert-opcao ${respostas[frase.id_frase] === opcao.valor ? 'is-ativo' : ''}`}
                        onClick=${() => responder(frase.id_frase, opcao.valor)}
                      >
                        <strong>${opcao.valor}</strong>
                        <span>${opcao.label}</span>
                      </button>
                    `,
        )}
                </div>
              </div>
            `,
      )}

          <button type="button" class="btn btn-primary" disabled=${enviando} onClick=${enviar}>
            ${enviando ? 'Enviando...' : `Enviar respostas (${respondidas}/${frases.length})`}
          </button>
        </div>
      </div>
    </section>
  `;
}

// ----------------------------------------------------------------------
// Painel de resultado (embutido na ficha do candidato)
// ----------------------------------------------------------------------
export function PainelResultadoFitCultural({ candidatoProcessoId, aoCarregar }) {
  const [resultado, setResultado] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!candidatoProcessoId) {
      setCarregando(false);
      aoCarregar?.({ possuiResultado: false });
      return;
    }
    setCarregando(true);
    lerResultadoFitCultural(candidatoProcessoId)
      .then((dados) => {
        setResultado(dados);
        aoCarregar?.({ possuiResultado: Boolean(dados?.possui_resultado), resultado: dados });
      })
      .catch((error) => {
        setErro(error?.message || 'Não foi possível carregar o resultado de fit cultural.');
        aoCarregar?.({ possuiResultado: false });
      })
      .finally(() => setCarregando(false));
  }, [candidatoProcessoId]);

  if (!candidatoProcessoId) return null;
  if (carregando) return html`<p class="text-muted">Carregando resultado de fit cultural...</p>`;
  if (erro) return html`<div class="alert alert-warning">${erro}</div>`;
  if (!resultado?.possui_resultado) {
    return html`<p class="text-muted">Este candidato ainda não respondeu ao questionário de fit cultural.</p>`;
  }

  return html`
    <div>
      ${(resultado.por_valor || []).map(
        (item) => html`
          <div class="rh-score-bar-row" key=${item.valor_id}>
            <span class="rh-score-bar-label">${item.valor_nome}</span>
            <div class="rh-score-bar-track"><div class="rh-score-bar-fill" style=${{ width: `${item.percentual_aderencia}%` }}></div></div>
            <span class="rh-score-bar-value">${item.percentual_aderencia}%</span>
          </div>
        `,
      )}
      <div class="rh-aderencia-badge is-alta" style=${{ marginTop: '8px' }}>
        <span class="material-symbols-outlined">${IconeSvg('diversity_3')}</span>
        Score geral de fit cultural: ${resultado.score_geral}%
      </div>
    </div>
  `;
}
