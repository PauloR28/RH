import { html, useEffect, useState } from '../../infraestrutura-react.js';
import {
  atualizarPerguntaRaciocinio,
  avancarRaciocinioAdaptativoPublico,
  criarPerguntaRaciocinio,
  excluirPerguntaRaciocinio,
  finalizarAplicacaoRaciocinioPublica,
  lerAplicacaoRaciocinioPublica,
  lerResultadoRaciocinioCandidato,
  listarPerguntasRaciocinio,
} from '../../servico-api.js';
import { ModalPadrao, PageIntro, PainelRh, SectionCard } from '../../ui/componentes-compartilhados.js';
import { TabelaVazia } from '../../shared/components/empty-table-row.js';
import { SkeletonTableRows } from '../../shared/components/skeleton.js';
import { obterIdAplicacaoRaciocinioPorHash } from '../../rotas.js';
import { IconeSvg } from '../../ui/icone.js';

const TIPOS = [
  { valor: 'sequencia_logica', label: 'Sequência lógica' },
  { valor: 'interpretacao_numerica', label: 'Interpretação numérica' },
  { valor: 'problema_matematico', label: 'Problema matemático' },
];
const DIFICULDADES = [
  { valor: 'facil', label: 'Fácil' },
  { valor: 'medio', label: 'Médio' },
  { valor: 'dificil', label: 'Difícil' },
];
const FORM_INICIAL = () => ({
  id_pergunta: '',
  enunciado: '',
  tipo: 'sequencia_logica',
  alternativas: ['', ''],
  gabarito: 0,
  dificuldade: 'medio',
  feedback_erro: '',
  ativo: true,
});

function rotuloTipo(tipo) {
  return TIPOS.find((t) => t.valor === tipo)?.label || tipo;
}
function rotuloDificuldade(dificuldade) {
  return DIFICULDADES.find((d) => d.valor === dificuldade)?.label || dificuldade;
}

// ----------------------------------------------------------------------
// RH: administração do banco de questões
// ----------------------------------------------------------------------
export function TelaRaciocinioAdmin({ controlador }) {
  const [perguntas, setPerguntas] = useState([]);
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
      const resposta = await listarPerguntasRaciocinio();
      setPerguntas(Array.isArray(resposta) ? resposta : []);
    } catch (error) {
      setErro(error?.message || 'Não foi possível carregar o banco de questões.');
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

  const abrirEdicao = (pergunta) => {
    setForm({
      id_pergunta: pergunta.id_pergunta,
      enunciado: pergunta.enunciado || '',
      tipo: pergunta.tipo || 'sequencia_logica',
      alternativas: (pergunta.alternativas || []).length ? [...pergunta.alternativas] : ['', ''],
      gabarito: pergunta.gabarito || 0,
      dificuldade: pergunta.dificuldade || 'medio',
      feedback_erro: pergunta.feedback_erro || '',
      ativo: pergunta.ativo !== false,
    });
    setErroForm('');
    setModalAberto(true);
  };

  const fechar = () => {
    setModalAberto(false);
    setErroForm('');
  };

  const atualizarAlternativa = (indice, valor) => {
    setForm((atual) => ({
      ...atual,
      alternativas: atual.alternativas.map((a, idx) => (idx === indice ? valor : a)),
    }));
  };

  const adicionarAlternativa = () => setForm((atual) => ({ ...atual, alternativas: [...atual.alternativas, ''] }));
  const removerAlternativa = (indice) =>
    setForm((atual) => ({
      ...atual,
      alternativas: atual.alternativas.filter((_, idx) => idx !== indice),
      gabarito: atual.gabarito >= indice && atual.gabarito > 0 ? atual.gabarito - 1 : atual.gabarito,
    }));

  const alternativasValidas = form.alternativas.filter((a) => a.trim());
  const formValido =
    form.enunciado.trim() && alternativasValidas.length >= 2 && form.gabarito < form.alternativas.length;

  const salvar = async () => {
    setErroForm('');
    if (!formValido) {
      setErroForm('Preencha o enunciado, ao menos 2 alternativas e um gabarito válido.');
      return;
    }
    const payload = {
      enunciado: form.enunciado.trim(),
      tipo: form.tipo,
      alternativas: form.alternativas.filter((a) => a.trim()),
      gabarito: Number(form.gabarito) || 0,
      dificuldade: form.dificuldade,
      feedback_erro: form.feedback_erro.trim(),
      ativo: !!form.ativo,
    };
    setSalvando(true);
    try {
      if (form.id_pergunta) {
        await atualizarPerguntaRaciocinio(form.id_pergunta, payload);
      } else {
        await criarPerguntaRaciocinio(payload);
      }
      fechar();
      await carregar();
    } catch (error) {
      setErroForm(error?.message || 'Não foi possível salvar a questão.');
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async (pergunta) => {
    if (!window.confirm('Excluir (inativar) esta questão?')) return;
    try {
      await excluirPerguntaRaciocinio(pergunta.id_pergunta);
      await carregar();
    } catch (error) {
      setErro(error?.message || 'Não foi possível excluir a questão.');
    }
  };

  return html`
    <${PainelRh}
      screenId="screen-settings-raciocinio-logico"
      navAtiva="screen-settings-raciocinio-logico"
      subtituloMarca="Raciocínio Lógico"
      placeholderBusca="Raciocínio Lógico"
      controlador=${controlador}
      acaoPrimaria=${{
        label: 'Nova questão',
        icon: 'add',
        onClick: abrirNovo,
        permissao: 'provas.questoes_criar',
      }}
    >
      <${PageIntro}
        kicker="Testes complementares"
        title="Raciocínio Lógico e Numérico"
        description="Banco de questões de múltipla escolha (sequência lógica, interpretação numérica e problema matemático), com correção automática por gabarito."
      />

      ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}

      <${SectionCard} title="Questões cadastradas" className="rh-section-card--flat">
        <div class="table-responsive">
          <table class="table align-middle rh-modern-history-table">
            <thead>
              <tr>
                <th>Enunciado</th>
                <th>Tipo</th>
                <th>Dificuldade</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${carregando
        ? html`<${SkeletonTableRows} colunas=${5} linhas=${4} />`
        : perguntas.length
          ? perguntas.map(
            (pergunta) => html`
                      <tr key=${pergunta.id_pergunta}>
                        <td>${pergunta.enunciado}</td>
                        <td>${rotuloTipo(pergunta.tipo)}</td>
                        <td>${rotuloDificuldade(pergunta.dificuldade)}</td>
                        <td>
                          <span class=${`rh-status-pill ${pergunta.ativo ? 'is-finished' : ''}`}>
                            ${pergunta.ativo ? 'Ativa' : 'Inativa'}
                          </span>
                        </td>
                        <td class="d-flex gap-2">
                          <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => abrirEdicao(pergunta)}>
                            <span class="material-symbols-outlined">${IconeSvg('edit')}</span>
                            Editar
                          </button>
                          <button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => excluir(pergunta)}>
                            <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                            Excluir
                          </button>
                        </td>
                      </tr>
                    `,
          )
          : html`<${TabelaVazia} colunas=${5} texto="Nenhuma questão cadastrada." icone="psychology" />`}
            </tbody>
          </table>
        </div>
      </${SectionCard}>

      <${ModalPadrao}
        aberto=${modalAberto}
        titulo=${form.id_pergunta ? 'Editar questão' : 'Nova questão'}
        onClose=${fechar}
        className="rh-modal-dialog--lg"
      >
        <div class="rh-details-body">
          ${erroForm ? html`<div class="alert alert-warning">${erroForm}</div>` : null}

          <div class="rh-filter-field">
            <label>Enunciado</label>
            <textarea
              class="form-control"
              rows="3"
              value=${form.enunciado}
              onInput=${(event) => setForm({ ...form, enunciado: event.target.value })}
            ></textarea>
          </div>

          <div class="row g-3">
            <div class="col-md-6">
              <div class="rh-filter-field">
                <label>Tipo</label>
                <select class="form-select" value=${form.tipo} onChange=${(event) => setForm({ ...form, tipo: event.target.value })}>
                  ${TIPOS.map((tipo) => html`<option key=${tipo.valor} value=${tipo.valor}>${tipo.label}</option>`)}
                </select>
              </div>
            </div>
            <div class="col-md-6">
              <div class="rh-filter-field">
                <label>Dificuldade</label>
                <select
                  class="form-select"
                  value=${form.dificuldade}
                  onChange=${(event) => setForm({ ...form, dificuldade: event.target.value })}
                >
                  ${DIFICULDADES.map((d) => html`<option key=${d.valor} value=${d.valor}>${d.label}</option>`)}
                </select>
              </div>
            </div>
          </div>

          <div class="rh-filter-field">
            <label>Alternativas (marque o gabarito)</label>
            ${form.alternativas.map(
        (alternativa, indice) => html`
                <div class="d-flex gap-2 align-items-center" key=${indice} style=${{ marginBottom: '8px' }}>
                  <input
                    type="radio"
                    name="gabarito-raciocinio"
                    checked=${form.gabarito === indice}
                    onChange=${() => setForm({ ...form, gabarito: indice })}
                  />
                  <input
                    class="form-control"
                    value=${alternativa}
                    onInput=${(event) => atualizarAlternativa(indice, event.target.value)}
                    placeholder=${`Alternativa ${indice + 1}`}
                  />
                  <button
                    type="button"
                    class="btn btn-outline-danger btn-sm"
                    disabled=${form.alternativas.length <= 2}
                    onClick=${() => removerAlternativa(indice)}
                  >
                    <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                  </button>
                </div>
              `,
      )}
            <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${adicionarAlternativa}>
              <span class="material-symbols-outlined">${IconeSvg('add')}</span>
              Adicionar alternativa
            </button>
          </div>

          <div class="rh-filter-field">
            <label>Feedback ao errar (opcional)</label>
            <textarea
              class="form-control"
              rows="2"
              value=${form.feedback_erro}
              onInput=${(event) => setForm({ ...form, feedback_erro: event.target.value })}
              placeholder="Explicação exibida ao candidato quando ele erra esta questão."
            ></textarea>
          </div>

          <label class="d-flex align-items-center gap-2">
            <input
              type="checkbox"
              checked=${form.ativo}
              onChange=${(event) => setForm({ ...form, ativo: !!event.target.checked })}
            />
            <span>Questão ativa</span>
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
// Candidato: aplicação pública (múltipla escolha, uma questão por vez)
// ----------------------------------------------------------------------
export function TelaRaciocinioTestePublico() {
  const [idAplicacao, setIdAplicacao] = useState(() => obterIdAplicacaoRaciocinioPorHash(window.location.hash));
  const [aplicacao, setAplicacao] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [indiceAtual, setIndiceAtual] = useState(0);
  const [respostas, setRespostas] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [concluido, setConcluido] = useState(false);
  // Modo adaptativo (roadmap respostas.txt): a próxima questão só é
  // conhecida depois que o backend avalia a resposta da questão atual —
  // não há navegação livre "Anterior" nesse modo, ao contrário do modo
  // fixo (lista completa pré-carregada).
  const [avancandoAdaptativo, setAvancandoAdaptativo] = useState(false);
  const [perguntasAdaptativas, setPerguntasAdaptativas] = useState([]);
  const [fimAdaptativo, setFimAdaptativo] = useState(false);

  useEffect(() => {
    const aoTrocarHash = () => setIdAplicacao(obterIdAplicacaoRaciocinioPorHash(window.location.hash));
    window.addEventListener('hashchange', aoTrocarHash);
    return () => window.removeEventListener('hashchange', aoTrocarHash);
  }, []);

  useEffect(() => {
    if (!idAplicacao) {
      setErro('Link de teste inválido.');
      setCarregando(false);
      return;
    }
    setCarregando(true);
    lerAplicacaoRaciocinioPublica(idAplicacao)
      .then((dados) => {
        setAplicacao(dados);
        if (dados?.modo_adaptativo) setPerguntasAdaptativas(dados?.perguntas || []);
        if (dados?.status === 'Finalizada') setConcluido(true);
      })
      .catch((error) => setErro(error?.message || 'Não foi possível carregar o teste.'))
      .finally(() => setCarregando(false));
  }, [idAplicacao]);

  const modoAdaptativo = !!aplicacao?.modo_adaptativo;
  const perguntas = modoAdaptativo ? perguntasAdaptativas : aplicacao?.perguntas || [];
  const perguntaAtual = perguntas[indiceAtual];
  // No modo adaptativo o total de questões não é conhecido de antemão (a
  // seleção é dinâmica); usa a quantidade já mostrada como referência de
  // progresso em vez de uma porcentagem sobre um total fixo.
  const progresso = modoAdaptativo
    ? Math.min(100, Math.round(((indiceAtual + 1) / Math.max(indiceAtual + 1, perguntas.length + (fimAdaptativo ? 0 : 1))) * 100))
    : perguntas.length
      ? Math.round(((indiceAtual + 1) / perguntas.length) * 100)
      : 0;
  const respondidas = Object.keys(respostas).length;

  const escolher = (alternativaIndice) => {
    if (!perguntaAtual) return;
    setRespostas((atual) => ({ ...atual, [perguntaAtual.id_pergunta]: alternativaIndice }));
  };

  const enviar = async (respostasFinais) => {
    setErro('');
    setEnviando(true);
    try {
      const base = respostasFinais || respostas;
      const listaPerguntas = modoAdaptativo ? perguntasAdaptativas : perguntas;
      await finalizarAplicacaoRaciocinioPublica(idAplicacao, {
        respostas: listaPerguntas.map((pergunta) => ({
          pergunta_id: pergunta.id_pergunta,
          alternativa_marcada: base[pergunta.id_pergunta] ?? null,
        })),
      });
      setConcluido(true);
    } catch (error) {
      setErro(error?.message || 'Não foi possível enviar suas respostas.');
    } finally {
      setEnviando(false);
    }
  };

  // Modo adaptativo: pede ao backend a próxima questão (dificuldade
  // adjacente à resposta atual). Quando o backend sinaliza "concluído",
  // envia o teste automaticamente com as respostas já coletadas.
  const avancarAdaptativo = async () => {
    if (!perguntaAtual) return;
    setErro('');
    setAvancandoAdaptativo(true);
    const alternativaMarcada = respostas[perguntaAtual.id_pergunta] ?? null;
    try {
      const resultado = await avancarRaciocinioAdaptativoPublico(idAplicacao, {
        pergunta_id: perguntaAtual.id_pergunta,
        alternativa_marcada: alternativaMarcada,
      });
      if (resultado?.proxima_pergunta) {
        setPerguntasAdaptativas((atual) => [...atual, resultado.proxima_pergunta]);
        setIndiceAtual((i) => i + 1);
      }
      if (resultado?.concluido) {
        setFimAdaptativo(true);
        if (!resultado?.proxima_pergunta) {
          await enviar(respostas);
        }
      }
    } catch (error) {
      setErro(error?.message || 'Não foi possível carregar a próxima questão.');
    } finally {
      setAvancandoAdaptativo(false);
    }
  };

  if (carregando) {
    return html`
      <section class="active screen" id="screen-raciocinio-teste">
        <div class="rh-teste-publico-shell"><p>Carregando teste...</p></div>
      </section>
    `;
  }

  if (concluido) {
    return html`
      <section class="active screen" id="screen-raciocinio-teste">
        <div class="rh-teste-publico-shell">
          <div class="rh-teste-publico-card">
            <h2>Teste concluído</h2>
            <p>Suas respostas foram registradas com sucesso. Obrigado pela participação!</p>
          </div>
        </div>
      </section>
    `;
  }

  if (erro && !perguntas.length) {
    return html`
      <section class="active screen" id="screen-raciocinio-teste">
        <div class="rh-teste-publico-shell"><div class="alert alert-warning">${erro}</div></div>
      </section>
    `;
  }

  return html`
    <section class="active screen" id="screen-raciocinio-teste">
      <div class="rh-teste-publico-shell">
        <h2>Teste de raciocínio lógico e numérico</h2>
        ${aplicacao?.tempo_limite_minutos
      ? html`<p class="text-muted">Tempo sugerido: ${aplicacao.tempo_limite_minutos} minutos.</p>`
      : null}
        <div class="rh-teste-publico-progresso"><span style=${{ width: `${progresso}%` }}></span></div>

        ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}

        ${perguntaAtual
      ? html`
              <div class="rh-teste-publico-card">
                <p class="text-muted">Questão ${indiceAtual + 1} de ${perguntas.length}</p>
                <h4>${perguntaAtual.enunciado}</h4>
                <div class="rh-cell-stack" style=${{ marginTop: '16px' }}>
                  ${(perguntaAtual.alternativas || []).map(
        (alternativa, indice) => html`
                      <label class="d-flex align-items-center gap-2" key=${indice} style=${{ marginBottom: '8px' }}>
                        <input
                          type="radio"
                          name=${`pergunta-${perguntaAtual.id_pergunta}`}
                          checked=${respostas[perguntaAtual.id_pergunta] === indice}
                          onChange=${() => escolher(indice)}
                        />
                        <span>${alternativa}</span>
                      </label>
                    `,
      )}
                </div>

                <div class="d-flex justify-content-between" style=${{ marginTop: '16px' }}>
                  ${modoAdaptativo
          ? html`<span></span>`
          : html`
                        <button
                          type="button"
                          class="btn btn-outline-secondary"
                          disabled=${indiceAtual === 0}
                          onClick=${() => setIndiceAtual((i) => Math.max(0, i - 1))}
                        >
                          Anterior
                        </button>
                      `}
                  ${modoAdaptativo
          ? html`
                        <button
                          type="button"
                          class="btn btn-primary"
                          disabled=${avancandoAdaptativo || enviando || respostas[perguntaAtual.id_pergunta] === undefined}
                          onClick=${avancarAdaptativo}
                        >
                          ${avancandoAdaptativo || enviando ? 'Enviando...' : 'Próxima'}
                        </button>
                      `
          : indiceAtual < perguntas.length - 1
            ? html`
                        <button type="button" class="btn btn-primary" onClick=${() => setIndiceAtual((i) => Math.min(perguntas.length - 1, i + 1))}>
                          Próxima
                        </button>
                      `
            : html`
                        <button type="button" class="btn btn-primary" disabled=${enviando} onClick=${() => enviar()}>
                          ${enviando ? 'Enviando...' : `Enviar (${respondidas}/${perguntas.length})`}
                        </button>
                      `}
                </div>
              </div>
            `
      : null}
      </div>
    </section>
  `;
}

// ----------------------------------------------------------------------
// Painel de resultado (embutido na ficha do candidato)
// ----------------------------------------------------------------------
export function PainelResultadoRaciocinio({ idTeste, aoCarregar }) {
  const [resultado, setResultado] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!idTeste) {
      setCarregando(false);
      aoCarregar?.({ possuiResultado: false });
      return;
    }
    setCarregando(true);
    lerResultadoRaciocinioCandidato(idTeste)
      .then((dados) => {
        setResultado(dados);
        aoCarregar?.({ possuiResultado: Boolean(dados?.possui_resultado) });
      })
      .catch((error) => {
        setErro(error?.message || 'Não foi possível carregar o resultado de raciocínio lógico.');
        aoCarregar?.({ possuiResultado: false });
      })
      .finally(() => setCarregando(false));
  }, [idTeste]);

  if (!idTeste) return null;
  if (carregando) return html`<p class="text-muted">Carregando resultado de raciocínio lógico...</p>`;
  if (erro) return html`<div class="alert alert-warning">${erro}</div>`;
  if (!resultado?.possui_resultado) {
    return html`<p class="text-muted">Este candidato ainda não realizou o teste de raciocínio lógico.</p>`;
  }

  const dados = resultado.resultado || {};
  const porTipo = dados.por_tipo || {};
  const porDificuldade = dados.por_dificuldade || {};

  return html`
    <div>
      <div class="rh-aderencia-badge is-alta" style=${{ marginBottom: '12px' }}>
        <span class="material-symbols-outlined">${IconeSvg('psychology')}</span>
        Nota final: ${dados.nota ?? '-'} (${dados.acertos ?? 0}/${dados.total_questoes ?? 0} acertos)
      </div>
      <div class="row g-3">
        <div class="col-md-6">
          <strong>Acertos por tipo</strong>
          ${Object.entries(porTipo).map(
        ([tipo, valores]) => html`
              <div class="rh-score-bar-row" key=${tipo}>
                <span class="rh-score-bar-label">${rotuloTipo(tipo)}</span>
                <span class="rh-score-bar-value">${valores.acertos}/${valores.total}</span>
              </div>
            `,
      )}
        </div>
        <div class="col-md-6">
          <strong>Acertos por dificuldade</strong>
          ${Object.entries(porDificuldade).map(
        ([dificuldade, valores]) => html`
              <div class="rh-score-bar-row" key=${dificuldade}>
                <span class="rh-score-bar-label">${rotuloDificuldade(dificuldade)}</span>
                <span class="rh-score-bar-value">${valores.acertos}/${valores.total}</span>
              </div>
            `,
      )}
        </div>
      </div>
    </div>
  `;
}
