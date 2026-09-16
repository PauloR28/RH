import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import {
  atualizarBlocoDisc,
  criarBlocoDisc,
  finalizarAplicacaoDiscPublica,
  lerAplicacaoDiscPublica,
  lerResultadoDiscCandidato,
  listarBlocosDisc,
} from '../../servico-api.js';
import { ModalPadrao, PageIntro, PainelRh, SectionCard } from '../../ui/componentes-compartilhados.js';
import { TabelaVazia } from '../../shared/components/empty-table-row.js';
import { obterIdAplicacaoDiscPorHash } from '../../rotas.js';
import { IconeSvg } from '../../ui/icone.js';

const DIMENSOES = ['D', 'I', 'S', 'C'];
const DIMENSAO_LABEL = { D: 'Dominância (D)', I: 'Influência (I)', S: 'Estabilidade (S)', C: 'Conformidade (C)' };
const FRASE_VAZIA = () => ({ dimensao: '', texto: '' });
const FORM_INICIAL = () => ({ ordem: 0, frases: [FRASE_VAZIA(), FRASE_VAZIA(), FRASE_VAZIA(), FRASE_VAZIA()] });

// ----------------------------------------------------------------------
// RH: administração dos blocos de 4 frases (uma por dimensão D/I/S/C)
// ----------------------------------------------------------------------
export function TelaDiscAdmin({ controlador }) {
  const [blocos, setBlocos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL());
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState('');
  // Correções.txt item 7: blocos compactados/dobráveis + edição.
  const [editandoId, setEditandoId] = useState(null);
  const [blocosExpandidos, setBlocosExpandidos] = useState({});

  const alternarBloco = (idBloco) => {
    setBlocosExpandidos((atual) => ({ ...atual, [idBloco]: !atual[idBloco] }));
  };

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    try {
      const resposta = await listarBlocosDisc();
      setBlocos(Array.isArray(resposta) ? resposta : []);
    } catch (error) {
      setErro(error?.message || 'Não foi possível carregar os blocos do teste DISC.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const abrirNovo = () => {
    setEditandoId(null);
    setForm({ ...FORM_INICIAL(), ordem: blocos.length ? Math.max(...blocos.map((b) => b.ordem || 0)) + 1 : 1 });
    setErroForm('');
    setModalAberto(true);
  };

  const abrirEdicao = (bloco) => {
    setEditandoId(bloco.id_bloco);
    setForm({
      ordem: bloco.ordem || 0,
      frases: (bloco.frases || []).map((frase) => ({ dimensao: frase.dimensao || '', texto: frase.texto || '' })),
    });
    setErroForm('');
    setModalAberto(true);
  };

  const fechar = () => {
    setModalAberto(false);
    setEditandoId(null);
    setErroForm('');
  };

  const atualizarFrase = (indice, campo, valor) => {
    setForm((atual) => {
      const frases = atual.frases.map((frase, idx) => (idx === indice ? { ...frase, [campo]: valor } : frase));
      return { ...atual, frases };
    });
  };

  const dimensoesUsadas = useMemo(() => new Set(form.frases.map((f) => f.dimensao).filter(Boolean)), [form.frases]);
  const formValido =
    form.frases.every((f) => f.dimensao && f.texto.trim()) && dimensoesUsadas.size === 4;

  const salvar = async () => {
    setErroForm('');
    if (!formValido) {
      setErroForm('Preencha as 4 frases, uma para cada dimensão (D, I, S e C), sem repetir dimensão.');
      return;
    }
    setSalvando(true);
    try {
      const payload = {
        ordem: Number(form.ordem) || 0,
        frases: form.frases.map((f) => ({ dimensao: f.dimensao, texto: f.texto.trim() })),
      };
      if (editandoId) {
        await atualizarBlocoDisc(editandoId, payload);
      } else {
        await criarBlocoDisc(payload);
      }
      fechar();
      await carregar();
    } catch (error) {
      setErroForm(error?.message || 'Não foi possível salvar o bloco.');
    } finally {
      setSalvando(false);
    }
  };

  return html`
    <${PainelRh}
      screenId="screen-settings-disc"
      navAtiva="screen-settings-disc"
      subtituloMarca="Teste DISC"
      placeholderBusca="Teste DISC"
      controlador=${controlador}
      acaoPrimaria=${{
        label: 'Novo bloco',
        icon: 'add',
        onClick: abrirNovo,
        permissao: 'provas.questoes_criar',
      }}
    >
      <${PageIntro}
        kicker="Testes complementares"
        title="Teste DISC"
        description="Cada bloco tem 4 frases (uma por dimensão D, I, S e C). O candidato escolhe a frase mais e a menos parecida com o seu comportamento. O resultado inclui o perfil D-I-S-C e a aderência ao perfil Call Center."
      />

      ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}

      <${SectionCard} title="Blocos cadastrados" className="rh-section-card--flat">
        ${carregando
          ? html`<p class="text-muted">Carregando blocos...</p>`
          : blocos.length
            ? html`
                <div class="rh-disc-bloco-list">
                  ${blocos.map((bloco) => {
                    const expandido = Boolean(blocosExpandidos[bloco.id_bloco]);
                    return html`
                      <div class="rh-disc-bloco-card" key=${bloco.id_bloco}>
                        <button
                          type="button"
                          class="rh-disc-bloco-header"
                          aria-expanded=${expandido}
                          onClick=${() => alternarBloco(bloco.id_bloco)}
                        >
                          <span class="material-symbols-outlined">${IconeSvg(expandido ? 'expand_less' : 'expand_more')}</span>
                          <strong>Bloco ${bloco.ordem}</strong>
                          <small>${(bloco.frases || []).length} frases</small>
                        </button>
                        ${expandido
                          ? html`
                              <div class="rh-disc-bloco-body">
                                <div class="rh-cell-stack">
                                  ${(bloco.frases || []).map(
                                    (frase) => html`
                                      <span key=${frase.id_frase}>
                                        <strong>${frase.dimensao}</strong> — ${frase.texto}
                                      </span>
                                    `,
                                  )}
                                </div>
                                <button type="button" class="btn btn-sm btn-outline-primary" onClick=${() => abrirEdicao(bloco)}>
                                  <span class="material-symbols-outlined">${IconeSvg('edit')}</span>
                                  Editar
                                </button>
                              </div>
                            `
                          : null}
                      </div>
                    `;
                  })}
                </div>
              `
            : html`<div class="table-responsive"><table class="table"><tbody><${TabelaVazia} colunas=${2} texto="Nenhum bloco DISC cadastrado." icone="bar_chart" /></tbody></table></div>`}
      </${SectionCard}>

      <${ModalPadrao}
        aberto=${modalAberto}
        titulo=${editandoId ? 'Editar bloco DISC' : 'Novo bloco DISC'}
        subtitulo="Cadastre exatamente 4 frases, uma para cada dimensão."
        onClose=${fechar}
        className="rh-modal-dialog--lg"
      >
        <div class="rh-details-body">
          ${erroForm ? html`<div class="alert alert-warning">${erroForm}</div>` : null}

          <div class="rh-filter-field">
            <label>Ordem de exibição</label>
            <input
              type="number"
              class="form-control"
              value=${form.ordem}
              onInput=${(event) => setForm({ ...form, ordem: event.target.value })}
            />
          </div>

          ${form.frases.map(
        (frase, indice) => html`
              <div class="row g-2 align-items-end" key=${indice} style=${{ marginTop: '8px' }}>
                <div class="col-md-3">
                  <div class="rh-filter-field">
                    <label>Dimensão</label>
                    <select
                      class="form-select"
                      value=${frase.dimensao}
                      onChange=${(event) => atualizarFrase(indice, 'dimensao', event.target.value)}
                    >
                      <option value="">Selecione</option>
                      ${DIMENSOES.map((dim) => html`<option key=${dim} value=${dim}>${DIMENSAO_LABEL[dim]}</option>`)}
                    </select>
                  </div>
                </div>
                <div class="col-md-9">
                  <div class="rh-filter-field">
                    <label>Frase</label>
                    <input
                      class="form-control"
                      value=${frase.texto}
                      onInput=${(event) => atualizarFrase(indice, 'texto', event.target.value)}
                      placeholder="Ex.: Gosto de assumir o controle das situações."
                    />
                  </div>
                </div>
              </div>
            `,
      )}
        </div>

        <footer class="rh-modal-footer">
          <div class="rh-modal-footer-actions">
            <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${fechar}>
              Cancelar
            </button>
            <button type="button" class="btn btn-primary" disabled=${salvando || !formValido} onClick=${salvar}>
              ${salvando ? 'Salvando...' : 'Salvar bloco'}
            </button>
          </div>
        </footer>
      </${ModalPadrao}>
    </${PainelRh}>
  `;
}

// ----------------------------------------------------------------------
// Candidato: aplicação pública do teste (link com id_aplicacao no path)
// ----------------------------------------------------------------------
export function TelaDiscTestePublico() {
  const [idAplicacao, setIdAplicacao] = useState(() => obterIdAplicacaoDiscPorHash(window.location.hash));
  const [aplicacao, setAplicacao] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [indiceAtual, setIndiceAtual] = useState(0);
  const [respostas, setRespostas] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [concluido, setConcluido] = useState(false);

  useEffect(() => {
    const aoTrocarHash = () => setIdAplicacao(obterIdAplicacaoDiscPorHash(window.location.hash));
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
    setErro('');
    lerAplicacaoDiscPublica(idAplicacao)
      .then((dados) => {
        setAplicacao(dados);
        if (dados?.status === 'Finalizada') setConcluido(true);
      })
      .catch((error) => setErro(error?.message || 'Não foi possível carregar o teste.'))
      .finally(() => setCarregando(false));
  }, [idAplicacao]);

  const blocos = aplicacao?.blocos || [];
  const blocoAtual = blocos[indiceAtual];
  const respostaAtual = blocoAtual ? respostas[blocoAtual.id_bloco] || {} : {};
  const totalRespondidos = Object.values(respostas).filter((r) => r.mais && r.menos).length;
  const progresso = blocos.length ? Math.round(((indiceAtual + 1) / blocos.length) * 100) : 0;

  const escolher = (tipo, fraseId) => {
    if (!blocoAtual) return;
    setRespostas((atual) => {
      const atualBloco = atual[blocoAtual.id_bloco] || {};
      const outroTipo = tipo === 'mais' ? 'menos' : 'mais';
      if (atualBloco[outroTipo] === fraseId) return atual;
      const novoValor = atualBloco[tipo] === fraseId ? undefined : fraseId;
      return { ...atual, [blocoAtual.id_bloco]: { ...atualBloco, [tipo]: novoValor } };
    });
  };

  const enviar = async () => {
    setErro('');
    const respostasCompletas = blocos.every((bloco) => {
      const r = respostas[bloco.id_bloco];
      return r && r.mais && r.menos;
    });
    if (!respostasCompletas) {
      setErro('Responda mais/menos em todos os blocos antes de enviar.');
      return;
    }
    setEnviando(true);
    try {
      await finalizarAplicacaoDiscPublica(idAplicacao, {
        respostas: blocos.map((bloco) => ({
          bloco_id: bloco.id_bloco,
          frase_mais_id: respostas[bloco.id_bloco].mais,
          frase_menos_id: respostas[bloco.id_bloco].menos,
        })),
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
      <section class="active screen" id="screen-disc-teste">
        <div class="rh-teste-publico-shell"><p>Carregando teste...</p></div>
      </section>
    `;
  }

  if (concluido) {
    return html`
      <section class="active screen" id="screen-disc-teste">
        <div class="rh-teste-publico-shell">
          <div class="rh-teste-publico-card">
            <h2>Teste concluído</h2>
            <p>Suas respostas foram registradas com sucesso. Obrigado pela participação!</p>
          </div>
        </div>
      </section>
    `;
  }

  if (erro && !blocos.length) {
    return html`
      <section class="active screen" id="screen-disc-teste">
        <div class="rh-teste-publico-shell"><div class="alert alert-warning">${erro}</div></div>
      </section>
    `;
  }

  return html`
    <section class="active screen" id="screen-disc-teste">
      <div class="rh-teste-publico-shell">
        <h2>Teste de perfil comportamental</h2>
        <p class="text-muted">Em cada bloco, escolha a frase que <strong>mais</strong> e a que <strong>menos</strong> combina com você.</p>
        <div class="rh-teste-publico-progresso"><span style=${{ width: `${progresso}%` }}></span></div>

        ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}

        ${blocoAtual
      ? html`
              <div class="rh-teste-publico-card">
                <p class="text-muted">Bloco ${indiceAtual + 1} de ${blocos.length}</p>
                ${blocoAtual.frases.map(
        (frase) => html`
                    <div class="rh-disc-bloco-frase" key=${frase.id_frase}>
                      <span class="rh-disc-bloco-frase-texto">${frase.texto}</span>
                      <div class="rh-disc-bloco-frase-acoes">
                        <button
                          type="button"
                          class=${`rh-disc-choice-btn is-mais ${respostaAtual.mais === frase.id_frase ? 'is-ativo' : ''}`}
                          onClick=${() => escolher('mais', frase.id_frase)}
                        >
                          Mais
                        </button>
                        <button
                          type="button"
                          class=${`rh-disc-choice-btn is-menos ${respostaAtual.menos === frase.id_frase ? 'is-ativo' : ''}`}
                          onClick=${() => escolher('menos', frase.id_frase)}
                        >
                          Menos
                        </button>
                      </div>
                    </div>
                  `,
      )}

                <div class="d-flex justify-content-between" style=${{ marginTop: '16px' }}>
                  <button
                    type="button"
                    class="btn btn-outline-secondary"
                    disabled=${indiceAtual === 0}
                    onClick=${() => setIndiceAtual((i) => Math.max(0, i - 1))}
                  >
                    Anterior
                  </button>
                  ${indiceAtual < blocos.length - 1
          ? html`
                        <button
                          type="button"
                          class="btn btn-primary"
                          disabled=${!respostaAtual.mais || !respostaAtual.menos}
                          onClick=${() => setIndiceAtual((i) => Math.min(blocos.length - 1, i + 1))}
                        >
                          Próximo
                        </button>
                      `
          : html`
                        <button type="button" class="btn btn-primary" disabled=${enviando} onClick=${enviar}>
                          ${enviando ? 'Enviando...' : `Enviar (${totalRespondidos}/${blocos.length})`}
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
export function PainelResultadoDisc({ idTeste, aoCarregar }) {
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
    lerResultadoDiscCandidato(idTeste)
      .then((dados) => {
        setResultado(dados);
        aoCarregar?.({ possuiResultado: Boolean(dados?.possui_resultado), resultado: dados });
      })
      .catch((error) => {
        setErro(error?.message || 'Não foi possível carregar o resultado do DISC.');
        aoCarregar?.({ possuiResultado: false });
      })
      .finally(() => setCarregando(false));
  }, [idTeste]);

  if (!idTeste) return null;
  if (carregando) return html`<p class="text-muted">Carregando resultado do DISC...</p>`;
  if (erro) return html`<div class="alert alert-warning">${erro}</div>`;
  if (!resultado?.possui_resultado) {
    return html`<p class="text-muted">Este candidato ainda não realizou o teste DISC.</p>`;
  }

  const perfil = resultado.resultado?.perfil || {};
  const percentuais = perfil.percentuais || {};
  const aderencia = resultado.resultado?.aderencia_call_center || {};
  const faixaClasse =
    aderencia.faixa === 'Alta aderência' ? 'is-alta' : aderencia.faixa === 'Aderência moderada' ? 'is-moderada' : 'is-baixa';

  return html`
    <div>
      ${DIMENSOES.map(
        (dim) => html`
          <div class="rh-score-bar-row" key=${dim}>
            <span class="rh-score-bar-label">${DIMENSAO_LABEL[dim]}</span>
            <div class="rh-score-bar-track"><div class="rh-score-bar-fill" style=${{ width: `${percentuais[dim] || 0}%` }}></div></div>
            <span class="rh-score-bar-value">${percentuais[dim] || 0}%</span>
          </div>
        `,
      )}
      <div class=${`rh-aderencia-badge ${faixaClasse}`} style=${{ marginTop: '8px' }}>
        <span class="material-symbols-outlined">${IconeSvg('support_agent')}</span>
        Aderência Call Center: ${aderencia.percentual_aderencia ?? '-'}% (${aderencia.faixa || 'não calculada'})
      </div>
    </div>
  `;
}
