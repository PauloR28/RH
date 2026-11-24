import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js?v=20261124-equipes';
import {
  atualizarStatusCandidato,
  compararResultadosAnaliticos,
  lerConfiguracaoResultadosAnaliticosProcesso,
  lerDetalheResultadoAnalitico,
  lerStatusResultadosAnaliticosProcesso,
  listarResultadosAnaliticosProcesso,
  salvarPerfilIdealResultadosAnaliticos,
  salvarMapeamentosResultadosAnaliticos,
  salvarPesosResultadosAnaliticos,
} from '../../servico-api.js?v=20261124-equipes';
import { navegarParaTela } from '../../app/controlador-aplicacao.js?v=20261124-equipes';
import {
  obterProcessoResultadosAnaliticosPorRota,
  obterRotaAtual,
} from '../../rotas.js?v=20261124-equipes';
import {
  EmptyState,
  GrupoPaginacao,
  LoadingState,
  MetricGrid,
  ModalPadrao,
  PageIntro,
  PainelRh,
  SectionCard,
} from '../../ui/componentes-compartilhados.js?v=20261124-equipes';
import { IconeSvg } from '../../ui/icone.js?v=20261124-equipes';


function numero(value, digits = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '–';
  return parsed.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function dataHora(value) {
  if (!value) return '–';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('pt-BR');
}

function notaOficial(item, key, fallback = null) {
  const value = item?.notas_oficiais?.[key];
  return value === null || value === undefined ? fallback : value;
}

function rotuloNota(value) {
  return value === null || value === undefined ? '–' : numero(value);
}

function textoRespostaObjetiva(value) {
  if (value === null || value === undefined || value === '') return 'Sem resposta';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function classeStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('falha')) return 'is-danger';
  if (normalized === 'calculado' || normalized === 'concluido') return 'is-success';
  if (normalized === 'parcial' || normalized === 'pendente' || normalized === 'processando') return 'is-warning';
  if (normalized === 'invalido' || normalized === 'cancelado' || normalized === 'erro' || normalized === 'falhou') return 'is-danger';
  return 'is-neutral';
}

function BarraPontuacao({ value, label }) {
  const numeric = Number(value);
  const valid = Number.isFinite(numeric);
  const width = valid ? Math.max(0, Math.min(100, numeric)) : 0;
  return html`
    <div class="exam-analytics-score-bar" title=${valid ? `${numero(numeric)} de 100` : 'Indisponível'}>
      <span style=${{ width: `${width}%` }}></span>
      <strong>${label || (valid ? numero(numeric) : '–')}</strong>
    </div>
  `;
}

function StatusAmostra({ result }) {
  if (!result?.tamanho_amostra) return html`<span class="exam-analytics-sample is-empty">Sem coorte comparável</span>`;
  return html`
    <span class=${`exam-analytics-sample ${result.amostra_pequena ? 'is-small' : 'is-ready'}`}>
      ${result.amostra_pequena ? 'Amostra pequena' : 'Amostra comparável'} · n=${result.tamanho_amostra}
    </span>
  `;
}

function ModalDetalheAnalitico({ detail, loading, onClose }) {
  const result = detail?.result || {};
  const categories = result.categorias || [];
  const stages = result.etapas || [];
  const telemetry = detail?.telemetry || [];
  const sessions = detail?.stageSessions || [];
  const execution = detail?.executionSummary || {};
  return html`
    <${ModalPadrao}
      aberto=${Boolean(loading || detail)}
      titulo=${result.nome_candidato ? `Resultado analítico · ${result.nome_candidato}` : 'Carregando resultado'}
      subtitulo="Leitura complementar; a nota oficial permanece soberana."
      onClose=${onClose}
      className="exam-analytics-detail-modal"
    >
      ${loading
      ? html`<${LoadingState} titulo="Carregando detalhe" descricao="Buscando métricas derivadas e evidências permitidas." />`
      : html`
          <div class="exam-analytics-detail-summary">
            <div><span>Nota oficial</span><strong>${numero(result.nota_oficial)}</strong></div>
            <div><span>Score analítico</span><strong>${numero(result.score_analitico)}</strong></div>
            <div><span>Percentil geral</span><strong>${result.percentil_geral === null || result.percentil_geral === undefined ? '–' : numero(result.percentil_geral)}</strong></div>
            <div><span>Ranking</span><strong>${result.posicao_densa ? `${result.posicao_densa}º · ${result.ranking_status || ''}` : '–'}</strong></div>
            <div><span>Aderência</span><strong>${result.aderencia_perfil === null || result.aderencia_perfil === undefined ? 'Não configurada' : `${numero(result.aderencia_perfil)}%`}</strong></div>
            <div><span>Atualização</span><strong>${dataHora(result.atualizado_em)}</strong></div>
            <div><span>Versões</span><strong>Gabarito ${result.gabarito_versao || 'legado'} · algoritmo ${result.algoritmo_versao || '–'}</strong></div>
          </div>
          <${StatusAmostra} result=${result} />
          ${result.motivo_indisponibilidade
          ? html`<div class="alert alert-warning mt-3 mb-0">${result.motivo_indisponibilidade}</div>`
          : null}
          <section class="exam-analytics-detail-section">
            <h4>Notas oficiais por etapa</h4>
            ${stages.length
          ? html`<div class="table-responsive"><table class="table align-middle"><thead><tr><th>Etapa</th><th>Tipo</th><th>Nota</th><th>Possível</th><th>Status</th><th>Origem</th><th>Motivo</th></tr></thead><tbody>
                ${stages.map((stage, index) => html`<tr key=${stage.key || index}><td>${stage.label || stage.name || stage.key || `Etapa ${index + 1}`}</td><td>${stage.type || stage.kind || '–'}</td><td>${rotuloNota(stage.percent ?? stage.score ?? stage.rawScore)}</td><td>${rotuloNota(stage.rawMax ?? stage.maxScore)}</td><td>${stage.interrupted ? 'Interrompida' : stage.status || (stage.pendings ? 'Pendente' : 'Concluída')}</td><td>${stage.manual ? 'Correção manual' : 'Correção oficial'}</td><td>${stage.zeroReason || stage.reason || (stage.interrupted ? 'Regra oficial de interrupção' : '–')}</td></tr>`)}
              </tbody></table></div>`
          : html`<p class="exam-analytics-caption">Detalhamento de etapas não registrado nesta versão da prova.</p>`}
          </section>
          <section class="exam-analytics-detail-section">
            <h4>Desempenho por categoria</h4>
            ${categories.length
          ? categories.map((category) => html`
                    <article class="exam-analytics-category" key=${category.key}>
                      <div>
                        <strong>${category.name || category.key}</strong>
                        <small>${category.comparable ? `Bruto ${rotuloNota(category.rawScore)} de ${rotuloNota(category.rawMax)} · percentil ${numero(category.percentile)} · posição ${category.rank || '–'}` : 'Categoria não comparável'}</small>
                        <small>Peso ${category.weight === null || category.weight === undefined ? 'não configurado' : `${numero(Number(category.weight) * 100)}%`} · contribuição ${rotuloNota(category.contribution)} · ${category.completionStatus || 'status indisponível'} (${category.completedComponents || 0}/${category.expectedComponents || 0})</small>
                      </div>
                      <${BarraPontuacao} value=${category.officialScore} />
                    </article>
                  `)
          : html`<${EmptyState} title="Categorias indisponíveis" text="O resultado oficial ainda não gerou categorias analíticas válidas." />`}
          </section>
          ${result.indicador_execucao
          ? html`<div class="exam-analytics-execution"><span class="material-symbols-outlined">${IconeSvg('speed')}</span><div><strong>Indicador de execução</strong><p>${result.indicador_execucao}</p></div></div>`
          : null}
          <section class="exam-analytics-detail-section">
            <h4>Indicadores objetivos de execução</h4>
            <div class="exam-analytics-detail-summary">
              <div><span>Tempo ativo total</span><strong>${telemetry.length ? `${numero(execution.activeSeconds)} s` : 'Não registrado'}</strong></div>
              <div><span>Alterações agregadas</span><strong>${telemetry.length ? execution.changes : 'Não registrado'}</strong></div>
              <div><span>Ordem de respostas</span><strong>${execution.answerOrder?.length ? execution.answerOrder.map((index) => Number(index) + 1).join(' → ') : 'Não registrada'}</strong></div>
              <div><span>Universo comparado</span><strong>${execution.comparisonUniverse || 'Indisponível'}</strong></div>
            </div>
            ${sessions.length
          ? html`<div class="table-responsive"><table class="table align-middle"><thead><tr><th>Etapa</th><th>Início</th><th>Fim</th><th>Tempo ativo</th><th>Status</th></tr></thead><tbody>${sessions.map((session) => html`<tr key=${session.etapa_chave}><td>${session.etapa_chave}</td><td>${dataHora(session.iniciada_em)}</td><td>${dataHora(session.finalizada_em)}</td><td>${session.tempo_ativo_segundos === null || session.tempo_ativo_segundos === undefined ? '–' : `${numero(session.tempo_ativo_segundos)} s`}</td><td>${session.status_etapa}</td></tr>`)}</tbody></table></div>`
          : html`<p class="exam-analytics-caption">Informação não registrada nesta versão da prova.</p>`}
          </section>
          ${(result.alertas || []).length
          ? html`
                <section class="exam-analytics-detail-section">
                  <h4>Registros de atenção</h4>
                  <ul class="exam-analytics-notes">
                    ${result.alertas.map((alert) => html`<li key=${alert.code || alert.message}><strong>${alert.code || 'Atenção'}:</strong> ${alert.message}<small>Origem: ${alert.source || 'não informada'} · data: ${dataHora(alert.observedAt)}${alert.recommendation ? ` · ação recomendada: ${alert.recommendation}` : ''}</small></li>`)}
                  </ul>
                </section>
              `
          : null}
          ${(detail?.excelDetails || []).length
          ? html`
                <section class="exam-analytics-detail-section">
                  <h4>Detalhes complementares do Excel</h4>
                  <div class="table-responsive"><table class="table align-middle"><thead><tr><th>Item/célula</th><th>Esperado</th><th>Obtido</th><th>Fórmula ou método</th><th>Tolerância</th><th>Resultado</th><th>Justificativa</th></tr></thead><tbody>
                    ${detail.excelDetails.map((item) => html`<tr key=${`${item.questao_indice}-${item.item_chave}`}><td>${item.item_rotulo || item.item_chave}<small>${item.celula_esperada || item.celula_encontrada || ''}</small></td><td>${item.valor_esperado || 'Não registrado'}</td><td>${item.valor_encontrado || 'Não registrado'}</td><td>${item.formula_encontrada || item.metodo_identificado || 'Não registrado'}</td><td>${item.tolerancia_utilizada === null || item.tolerancia_utilizada === undefined ? '–' : numero(item.tolerancia_utilizada, 3)}</td><td>${item.status_item || '–'}<small>${numero(item.pontuacao)} / ${numero(item.pontuacao_maxima)}</small></td><td>${item.justificativa || '–'}</td></tr>`)}
                  </tbody></table></div>
                </section>
              `
          : null}
          ${(detail?.textDetails || []).length
          ? html`
                <section class="exam-analytics-detail-section">
                  <h4>Métricas locais de texto</h4>
                  <div class="table-responsive"><table class="table align-middle"><thead><tr><th>Questão</th><th>Palavras</th><th>Parágrafos</th><th>Média/frase</th><th>Legibilidade</th><th>Riqueza lexical</th><th>Ocorrências</th><th>Termos</th></tr></thead><tbody>
                    ${detail.textDetails.map((item) => item.indicadores_estrutura?.status === 'Indisponivel'
                      ? html`<tr key=${item.questao_indice}><td>${Number(item.questao_indice) + 1}</td><td colspan="7">${item.indicadores_estrutura.reason || 'Métrica não registrada nesta versão da prova.'}</td></tr>`
                      : html`<tr key=${item.questao_indice}><td>${Number(item.questao_indice) + 1}</td><td>${item.quantidade_palavras}</td><td>${item.quantidade_paragrafos}</td><td>${rotuloNota(item.media_palavras_sentenca)}</td><td>${rotuloNota(item.indice_legibilidade)}</td><td>${item.riqueza_lexical === null || item.riqueza_lexical === undefined ? '–' : `${numero(Number(item.riqueza_lexical) * 100)}%`}</td><td>${item.ocorrencias_ortograficas === null || item.ocorrencias_ortograficas === undefined ? item.ortografia_status : item.ocorrencias_ortograficas}</td><td>${item.aderencia_termos?.status || 'Indisponível'}</td></tr>`)}
                  </tbody></table></div>
                  <p class="exam-analytics-caption">Métricas descritivas locais; não inferem personalidade, intenção ou adequação cultural.</p>
                </section>
              `
          : null}
          ${(detail?.objectiveDetails || []).length
          ? html`<section class="exam-analytics-detail-section"><h4>Questões objetivas</h4><div class="table-responsive"><table class="table align-middle"><thead><tr><th>Questão</th><th>Categoria</th><th>Resposta registrada</th><th>Resultado</th><th>Nota</th></tr></thead><tbody>${detail.objectiveDetails.map((item) => html`<tr key=${item.questao_id || item.questao_indice}><td>${Number(item.questao_indice) + 1}</td><td>${item.categoria || item.etapa_chave || '–'}</td><td>${textoRespostaObjetiva(item.resposta)}</td><td>${item.correta === null || item.correta === undefined ? '–' : item.correta ? 'Correta' : 'Incorreta'}</td><td>${rotuloNota(item.nota)}</td></tr>`)}</tbody></table></div></section>`
          : null}
          ${(result.explicacoes || []).length
          ? html`<section class="exam-analytics-detail-section"><h4>Como interpretar</h4><ul class="exam-analytics-notes">${result.explicacoes.map((text, index) => html`<li key=${index}>${text}</li>`)}</ul></section>`
          : null}
          <div class="exam-analytics-privacy"><span class="material-symbols-outlined">${IconeSvg('lock')}</span>Respostas brutas e conteúdo da área de transferência não são exibidos nem coletados por este módulo.</div>
        `}
    </${ModalPadrao}>
  `;
}

function ModalComparacao({ data, loading, onClose, podeAprovar, podeEliminar, acaoEmAndamento, onAprovar, onEliminar }) {
  const items = data?.items || [];
  const categoryKeys = Array.from(new Set(items.flatMap((item) => (item.categorias || []).map((category) => category.key))));
  const [motivoEliminacaoAberto, setMotivoEliminacaoAberto] = useState('');
  const [motivoEliminacaoTexto, setMotivoEliminacaoTexto] = useState('');

  useEffect(() => {
    setMotivoEliminacaoAberto('');
    setMotivoEliminacaoTexto('');
  }, [data]);

  const confirmarEliminacao = (idRegistro) => {
    const motivo = motivoEliminacaoTexto.trim();
    if (!motivo) return;
    onEliminar(idRegistro, motivo);
    setMotivoEliminacaoAberto('');
    setMotivoEliminacaoTexto('');
  };

  return html`
    <${ModalPadrao} aberto=${Boolean(loading || data)} titulo="Comparação de candidatos" subtitulo="Comparação limitada a 2 ou 3 resultados do mesmo processo." onClose=${onClose} className="exam-analytics-compare-modal">
      ${loading
      ? html`
            <${LoadingState}
              titulo="Preparando comparação"
              mensagens=${['Buscando os resultados oficiais...', 'Alinhando categorias e pesos...', 'Montando a comparação...']}
            />
          `
      : html`
          ${(data?.warnings || []).map((warning) => html`<div class="alert alert-warning" key=${warning}>${warning}</div>`)}
          ${(data?.assessmentDifferences || []).length ? html`<ul class="exam-analytics-notes">${data.assessmentDifferences.map((difference) => html`<li key=${difference.candidateId}><strong>${difference.candidateName}:</strong> ${difference.reason} Gabarito ${difference.answerKeyVersion}.</li>`)}</ul>` : null}
          <p class="exam-analytics-caption">Universo comparado: ${data?.comparisonUniverse || 'indisponível'} candidato(s). ${data?.comparable ? 'Avaliações equivalentes para comparação.' : 'Sem conclusão comparativa automática.'}</p>
          <div class="table-responsive"><table class="table exam-analytics-compare-table"><thead><tr><th>Métrica</th>${items.map((item) => html`<th key=${item.id_teste}>${item.nome_candidato}</th>`)}</tr></thead><tbody>
            <tr><th>Nota oficial</th>${items.map((item) => html`<td>${numero(item.nota_oficial)}</td>`)}</tr>
            <tr><th>Score analítico</th>${items.map((item) => html`<td>${numero(item.score_analitico)}</td>`)}</tr>
            <tr><th>Percentil</th>${items.map((item) => html`<td>${rotuloNota(item.percentil_geral)}</td>`)}</tr>
            <tr><th>Ranking</th>${items.map((item) => html`<td>${item.posicao_densa ? `${item.posicao_densa}º` : '–'}</td>`)}</tr>
            <tr><th>Aderência</th>${items.map((item) => html`<td>${item.aderencia_perfil === null || item.aderencia_perfil === undefined ? '–' : `${numero(item.aderencia_perfil)}%`}</td>`)}</tr>
            <tr><th>Excel</th>${items.map((item) => html`<td>${rotuloNota(notaOficial(item, 'excel'))}</td>`)}</tr>
            <tr><th>Word/comunicação</th>${items.map((item) => html`<td>${rotuloNota(notaOficial(item, 'word', notaOficial(item, 'comunicacao')))}</td>`)}</tr>
            <tr><th>Conhecimentos gerais</th>${items.map((item) => html`<td>${rotuloNota(notaOficial(item, 'objetiva'))}</td>`)}</tr>
            <tr><th>Conhecimentos técnicos</th>${items.map((item) => html`<td>${rotuloNota(notaOficial(item, 'tecnica'))}</td>`)}</tr>
            <tr><th>Redação</th>${items.map((item) => html`<td>${rotuloNota(notaOficial(item, 'redacao'))}</td>`)}</tr>
            <tr><th>Execução</th>${items.map((item) => html`<td>${item.indicador_execucao || 'Indisponível'}</td>`)}</tr>
            <tr><th>Flags</th>${items.map((item) => html`<td>${(item.alertas || []).length ? item.alertas.map((alert) => alert.code || alert.message).join(', ') : 'Nenhuma'}</td>`)}</tr>
            ${categoryKeys.map((key) => html`<tr key=${key}><th>${items.flatMap((item) => item.categorias || []).find((category) => category.key === key)?.name || key}</th>${items.map((item) => { const category = (item.categorias || []).find((entry) => entry.key === key); return html`<td><strong>${numero(category?.officialScore)}</strong><small>${category?.percentile === null || category?.percentile === undefined ? 'percentil indisponível' : `percentil ${numero(category.percentile)}`}</small></td>`; })}</tr>`)}
          </tbody></table></div>
          <p class="exam-analytics-caption">Empates permanecem empatados; tempo e dados pessoais não são usados para desempate.</p>
          ${(podeAprovar || podeEliminar)
      ? html`
                <div class="exam-analytics-compare-actions">
                  <h5 class="exam-analytics-compare-actions-title">Decidir por comparação</h5>
                  <div class="row g-2">
                    ${items.map((item) => html`
                      <div key=${item.id_teste} class="col-md-${items.length === 2 ? '6' : '4'}">
                        <div class="rh-section-card rh-section-card--flat" style=${{ padding: '12px' }}>
                          <strong class="d-block mb-2">${item.nome_candidato}</strong>
                          <div class="d-flex gap-2 flex-wrap">
                            ${podeAprovar
        ? html`
                                  <button
                                    type="button"
                                    class="btn btn-sm btn-outline-primary"
                                    disabled=${acaoEmAndamento}
                                    onClick=${() => onAprovar(item.id_registro)}
                                  >
                                    Aprovar
                                  </button>
                                `
        : null}
                            ${podeEliminar
        ? html`
                                  <button
                                    type="button"
                                    class="btn btn-sm btn-outline-danger"
                                    disabled=${acaoEmAndamento}
                                    onClick=${() => {
              setMotivoEliminacaoAberto(item.id_teste);
              setMotivoEliminacaoTexto('');
            }}
                                  >
                                    Eliminar
                                  </button>
                                `
        : null}
                          </div>
                          ${motivoEliminacaoAberto === item.id_teste
        ? html`
                                <div class="mt-2">
                                  <textarea
                                    class="form-control form-control-sm"
                                    rows="2"
                                    placeholder="Motivo da eliminação"
                                    value=${motivoEliminacaoTexto}
                                    onInput=${(event) => setMotivoEliminacaoTexto(event.target.value)}
                                  ></textarea>
                                  <div class="d-flex gap-2 mt-1">
                                    <button
                                      type="button"
                                      class="btn btn-sm btn-danger"
                                      disabled=${acaoEmAndamento || !motivoEliminacaoTexto.trim()}
                                      onClick=${() => confirmarEliminacao(item.id_registro)}
                                    >
                                      Confirmar eliminação
                                    </button>
                                    <button
                                      type="button"
                                      class="btn btn-sm btn-outline-secondary"
                                      onClick=${() => setMotivoEliminacaoAberto('')}
                                    >
                                      Cancelar
                                    </button>
                                  </div>
                                </div>
                              `
        : null}
                        </div>
                      </div>
                    `)}
                  </div>
                </div>
              `
      : null}
        `}
    </${ModalPadrao}>
  `;
}

function ModalConfiguracao({ open, configuration, form, mappings, saving, error, message, onChange, onMappingChange, onClose, onSaveWeights, onSaveProfile, onSaveMappings }) {
  const total = form.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  return html`
    <${ModalPadrao} aberto=${open} titulo="Configuração analítica do processo" subtitulo="Pesos e perfil ideal são versionados e nunca alteram a nota oficial." onClose=${onClose} className="exam-analytics-config-modal">
      <div class="exam-analytics-config-help">
        <span class="material-symbols-outlined">${IconeSvg('info')}</span>
        <p>Informe pesos que totalizem 100%. Ausências não recebem zero e os pesos não são redistribuídos silenciosamente.</p>
      </div>
      ${form.length
      ? html`
          <div class="table-responsive"><table class="table align-middle"><thead><tr><th>Categoria</th><th>Peso (%)</th><th>Perfil ideal (0–100)</th></tr></thead><tbody>
            ${form.map((item, index) => html`
              <tr key=${item.key}>
                <td><strong>${item.name || item.key}</strong></td>
                <td><input class="form-control" type="number" min="0" max="100" step="0.1" value=${item.weight} onInput=${(event) => onChange(index, 'weight', event.target.value)} /></td>
                <td><input class="form-control" type="number" min="0" max="100" step="0.1" value=${item.target} placeholder="Opcional" onInput=${(event) => onChange(index, 'target', event.target.value)} /></td>
              </tr>
            `)}
          </tbody></table></div>
          <div class=${`exam-analytics-weight-total ${Math.abs(total - 100) < 0.01 ? 'is-valid' : 'is-invalid'}`}>Total dos pesos: <strong>${numero(total)}%</strong></div>
          ${mappings.length
          ? html`<section class="exam-analytics-detail-section"><h4>Mapeamento de etapas para categorias</h4><p class="exam-analytics-caption">A origem é preservada; altere apenas a chave da categoria analítica. O recálculo é versionado.</p><div class="table-responsive"><table class="table align-middle"><thead><tr><th>Origem</th><th>Categoria analítica</th></tr></thead><tbody>${mappings.map((mapping, index) => html`<tr key=${`${mapping.origem_tipo}-${mapping.origem_chave}`}><td>${mapping.origem_tipo}: <strong>${mapping.origem_chave}</strong></td><td><input class="form-control" maxlength="120" value=${mapping.categoria_chave} onInput=${(event) => onMappingChange(index, event.target.value)} /></td></tr>`)}</tbody></table></div></section>`
          : null}
          ${error ? html`<div class="alert alert-danger mb-0">${error}</div>` : null}
          ${message ? html`<div class="alert alert-success mb-0">${message}</div>` : null}
          <footer class="exam-analytics-config-actions">
            <button type="button" class="btn btn-outline-primary" disabled=${saving || Math.abs(total - 100) >= 0.01} onClick=${onSaveWeights}>Salvar pesos</button>
            <button type="button" class="btn btn-outline-primary" disabled=${saving || !mappings.length || mappings.some((item) => !String(item.categoria_chave || '').trim())} onClick=${onSaveMappings}>Salvar categorias</button>
            <button type="button" class="btn btn-primary" disabled=${saving || !configuration?.configured} title=${configuration?.configured ? '' : 'Salve os pesos antes do perfil ideal.'} onClick=${onSaveProfile}>Salvar perfil ideal</button>
          </footer>
        `
      : html`<${EmptyState} title="Categorias ainda indisponíveis" text="Processe ao menos um resultado oficial para configurar categorias deste processo." />`}
    </${ModalPadrao}>
  `;
}

const FILTROS_INICIAIS = {
  page: 1,
  page_size: 20,
  search: '',
  status: '',
  stage: '',
  category: '',
  flag: '',
  score_min: '',
  score_max: '',
  adherence_min: '',
  adherence_max: '',
  pending_analysis: '',
  comparable: '',
  manual_correction: '',
  sort: 'ranking',
  direction: 'asc',
};

export function TelaResultadosAnaliticosProcesso({ controlador }) {
  const processId = obterProcessoResultadosAnaliticosPorRota(obterRotaAtual());
  const [data, setData] = useState(null);
  const [statusData, setStatusData] = useState(null);
  const [configuration, setConfiguration] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ ...FILTROS_INICIAIS });
  const [selected, setSelected] = useState([]);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [comparison, setComparison] = useState(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [configForm, setConfigForm] = useState([]);
  const [mappingForm, setMappingForm] = useState([]);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState('');
  const [configMessage, setConfigMessage] = useState('');
  const [acaoComparacaoEmAndamento, setAcaoComparacaoEmAndamento] = useState(false);

  const load = async ({ quiet = false, override = null } = {}) => {
    if (!processId) {
      setError('Não foi possível identificar o processo desta página.');
      setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    setError('');
    try {
      const effectiveFilters = override || filters;
      const [result, statusResult, configResult] = await Promise.all([
        listarResultadosAnaliticosProcesso(processId, effectiveFilters),
        lerStatusResultadosAnaliticosProcesso(processId),
        lerConfiguracaoResultadosAnaliticosProcesso(processId),
      ]);
      setData(result);
      setStatusData(statusResult);
      setConfiguration(configResult);
    } catch (loadError) {
      setError(loadError?.message || 'Não foi possível carregar os resultados analíticos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [processId, filters.page, filters.page_size, filters.status, filters.sort, filters.direction]);

  const items = data?.items || [];
  const jobs = statusData?.jobs || {};
  const summary = statusData?.summary || {};
  const pendingJobs = Number(jobs.Pendente || 0) + Number(jobs.Processando || 0);
  const metricItems = [
    { label: 'Candidatos com prova', value: Number(summary.proofs || 0), icon: 'assignment_ind', helper: 'Provas vinculadas ao processo' },
    { label: 'Resultados concluídos', value: Number(summary.completed || 0), icon: 'check_circle', helper: 'Completos e elegíveis' },
    { label: 'Análises pendentes', value: Number(summary.pending || 0) + pendingJobs, icon: 'pending_actions', helper: 'Sem imputação de nota zero' },
    { label: 'Correções com erro', value: Number(summary.errors || 0), icon: 'error', helper: 'Falhas controladas da fila' },
    { label: 'Comparáveis', value: Number(summary.comparable || 0), icon: 'compare_arrows', helper: 'Mesma assinatura de avaliação' },
    { label: 'Ranking atualizado', value: Number(summary.ranked || 0), icon: 'leaderboard', helper: 'Posições disponíveis' },
  ];

  const applyFilters = (event) => {
    event?.preventDefault();
    const next = { ...filters, page: 1 };
    setFilters(next);
    load({ override: next });
  };

  const clearFilters = () => {
    const next = { ...FILTROS_INICIAIS };
    setFilters(next);
    load({ override: next });
  };

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggleSelected = (id) => {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 3) return current;
      return [...current, id];
    });
  };

  const openDetail = async (candidateId) => {
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await lerDetalheResultadoAnalitico(processId, candidateId));
    } catch (detailError) {
      setError(detailError?.message || 'Não foi possível carregar o detalhe.');
    } finally {
      setDetailLoading(false);
    }
  };

  const compare = async () => {
    if (selected.length < 2 || selected.length > 3) return;
    setComparison(null);
    setComparisonLoading(true);
    try {
      setComparison(await compararResultadosAnaliticos(processId, selected));
    } catch (compareError) {
      setError(compareError?.message || 'Não foi possível comparar os candidatos.');
    } finally {
      setComparisonLoading(false);
    }
  };

  const aprovarCandidatoComparado = async (idRegistro) => {
    if (!idRegistro) return;
    if (!window.confirm('Aprovar este candidato?')) return;
    setAcaoComparacaoEmAndamento(true);
    setError('');
    try {
      await atualizarStatusCandidato(idRegistro, { status_candidato: 'aprovado' });
      setComparison(null);
      await load({ quiet: true });
    } catch (actionError) {
      setError(actionError?.message || 'Não foi possível aprovar o candidato.');
    } finally {
      setAcaoComparacaoEmAndamento(false);
    }
  };

  const eliminarCandidatoComparado = async (idRegistro, motivo) => {
    if (!idRegistro || !motivo) return;
    setAcaoComparacaoEmAndamento(true);
    setError('');
    try {
      await atualizarStatusCandidato(idRegistro, {
        status_candidato: 'eliminado',
        motivo_eliminacao: motivo,
      });
      setComparison(null);
      await load({ quiet: true });
    } catch (actionError) {
      setError(actionError?.message || 'Não foi possível eliminar o candidato.');
    } finally {
      setAcaoComparacaoEmAndamento(false);
    }
  };

  const openConfiguration = () => {
    const weights = new Map((configuration?.weights || []).map((item) => [item.categoria_chave, item]));
    const profiles = new Map((configuration?.idealProfile || []).map((item) => [item.categoria_chave, item]));
    const categories = configuration?.availableCategories?.length
      ? configuration.availableCategories
      : (configuration?.weights || []).map((item) => ({ key: item.categoria_chave, name: item.categoria_chave }));
    setConfigForm(categories.map((category) => ({
      key: category.key,
      name: category.name,
      weight: weights.has(category.key) ? String(Number(weights.get(category.key).peso) * 100) : '',
      target: profiles.has(category.key) ? String(Number(profiles.get(category.key).valor_ideal)) : '',
    })));
    setMappingForm((configuration?.mappings || []).map((mapping) => ({ ...mapping })));
    setConfigError('');
    setConfigMessage('');
    setConfigOpen(true);
  };

  const updateConfigForm = (index, field, value) => {
    setConfigForm((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  };

  const updateMappingForm = (index, value) => {
    setMappingForm((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, categoria_chave: value } : item));
  };

  const saveWeights = async () => {
    setConfigSaving(true);
    setConfigError('');
    setConfigMessage('');
    try {
      await salvarPesosResultadosAnaliticos(processId, configForm.map((item) => ({ categoria_chave: item.key, peso: Number(item.weight) / 100, obrigatoria: true })));
      setConfigMessage('Pesos versionados e recálculo enfileirado.');
      const nextConfig = await lerConfiguracaoResultadosAnaliticosProcesso(processId);
      setConfiguration(nextConfig);
    } catch (saveError) {
      setConfigError(saveError?.message || 'Não foi possível salvar os pesos.');
    } finally {
      setConfigSaving(false);
    }
  };

  const saveProfile = async () => {
    setConfigSaving(true);
    setConfigError('');
    setConfigMessage('');
    try {
      const profile = configForm.filter((item) => item.target !== '').map((item) => ({ categoria_chave: item.key, valor_ideal: Number(item.target) }));
      await salvarPerfilIdealResultadosAnaliticos(processId, profile);
      setConfigMessage(profile.length ? 'Perfil ideal versionado e recálculo enfileirado.' : 'Perfil ideal removido; recálculo enfileirado.');
      setConfiguration(await lerConfiguracaoResultadosAnaliticosProcesso(processId));
    } catch (saveError) {
      setConfigError(saveError?.message || 'Não foi possível salvar o perfil ideal.');
    } finally {
      setConfigSaving(false);
    }
  };

  const saveMappings = async () => {
    setConfigSaving(true);
    setConfigError('');
    setConfigMessage('');
    try {
      await salvarMapeamentosResultadosAnaliticos(processId, mappingForm);
      setConfigMessage('Categorias versionadas e recálculo enfileirado. Ajuste os pesos se as chaves de destino mudaram.');
      setConfiguration(await lerConfiguracaoResultadosAnaliticosProcesso(processId));
    } catch (saveError) {
      setConfigError(saveError?.message || 'Não foi possível salvar os mapeamentos de categorias.');
    } finally {
      setConfigSaving(false);
    }
  };

  return html`
    <${PainelRh}
      screenId="screen-process-analytical-results"
      navAtiva="screen-processes"
      subtituloMarca="Resultados analíticos"
      placeholderBusca="Buscar no Conecta RH"
      controlador=${controlador}
      acaoPrimaria=${controlador.possuiPermissao('provas.configurar_pesos') ? { label: 'Configurar análise', icon: 'tune', onClick: openConfiguration } : null}
    >
      <div class="exam-analytics-page">
        <${PageIntro}
          kicker="Conecta Provas"
          title="Resultados analíticos do processo"
          description=${data?.process?.vacancy ? `${data.process.vacancy} · ${data.process.status || 'Status não informado'}` : 'Comparabilidade, execução e evidências complementares, sem alterar a correção oficial.'}
          actions=${html`
            <button type="button" class="btn btn-outline-secondary" onClick=${() => navegarParaTela('screen-process-details')}><span class="material-symbols-outlined">${IconeSvg('arrow_back')}</span>Voltar ao processo</button>
            <button type="button" class="btn btn-outline-primary" disabled=${loading} onClick=${() => load()}><span class="material-symbols-outlined">${IconeSvg('refresh')}</span>Atualizar</button>
          `}
        />
        <div class="exam-analytics-process-meta">
          <span><strong>Processo</strong>${data?.process?.id || processId || '–'}</span>
          <span><strong>Status</strong>${statusData?.processStatus || data?.process?.status || 'Não informado'}</span>
          <span><strong>Candidatos</strong>${Number(summary.candidates || 0)}</span>
          <span><strong>Atualização analítica</strong>${dataHora(statusData?.updatedAt)}</span>
          <span><strong>Processamento</strong><em class=${`exam-analytics-status ${classeStatus(statusData?.processingStatus)}`}>${statusData?.processingStatus || 'Aguardando'}</em></span>
        </div>
        <div class="exam-analytics-principle"><span class="material-symbols-outlined">${IconeSvg('verified_user')}</span><div><strong>Leitura de apoio ao RH</strong><p>Nota oficial, decisão humana e regras atuais do processo continuam soberanas. Amostras pequenas e dados ausentes são sinalizados explicitamente.</p></div></div>
        <${MetricGrid} items=${metricItems} />
        ${error ? html`<div class="alert alert-danger">${error}</div>` : null}
        ${pendingJobs ? html`<div class="alert alert-info">Processamento pendente: ${pendingJobs} job(s) aguardando ou em execução. A página continua exibindo a última consolidação válida.</div>` : null}
        ${!configuration?.configured ? html`<div class="alert alert-warning">Configuração analítica incompleta: os pesos ainda não totalizam 100% em uma versão válida.</div>` : null}
        ${configuration?.configured && !(configuration?.idealProfile || []).length ? html`<div class="alert alert-secondary">Perfil ideal não configurado; a aderência permanece indisponível.</div>` : null}
        ${Number(summary.comparable || 0) > 0 && Number(summary.comparable || 0) < 5 ? html`<div class="alert alert-warning">Amostra reduzida: percentis e ranking são exibidos com o tamanho da coorte.</div>` : null}
        <${SectionCard} title="Candidatos e resultados" description=${statusData?.updatedAt ? `Atualizado em ${dataHora(statusData.updatedAt)} · algoritmo ${statusData.algorithmVersion}` : 'Aguardando resultados processados'}>
          <form class="exam-analytics-filters" onSubmit=${applyFilters}>
            <label><span>Buscar candidato</span><input class="form-control" value=${filters.search} placeholder="Nome ou ID" onInput=${(event) => setFilters((current) => ({ ...current, search: event.target.value }))} /></label>
            <label><span>Status analítico</span><select class="form-select" value=${filters.status} onChange=${(event) => setFilters((current) => ({ ...current, page: 1, status: event.target.value }))}><option value="">Todos</option><option>Calculado</option><option>Parcial</option><option>Pendente</option><option>Invalido</option><option>Cancelado</option></select></label>
            <label><span>Etapa</span><input class="form-control" value=${filters.stage} placeholder="Nome ou chave" onInput=${(event) => setFilters((current) => ({ ...current, stage: event.target.value }))} /></label>
            <label><span>Categoria</span><select class="form-select" value=${filters.category} onChange=${(event) => setFilters((current) => ({ ...current, category: event.target.value }))}><option value="">Todas</option>${(configuration?.availableCategories || []).map((category) => html`<option value=${category.key} key=${category.key}>${category.name}</option>`)}</select></label>
            <label><span>Score analítico mínimo</span><input class="form-control" type="number" min="0" max="100" value=${filters.score_min} onInput=${(event) => setFilters((current) => ({ ...current, score_min: event.target.value }))} /></label>
            <label><span>Score analítico máximo</span><input class="form-control" type="number" min="0" max="100" value=${filters.score_max} onInput=${(event) => setFilters((current) => ({ ...current, score_max: event.target.value }))} /></label>
            <label><span>Aderência mínima</span><input class="form-control" type="number" min="0" max="100" value=${filters.adherence_min} onInput=${(event) => setFilters((current) => ({ ...current, adherence_min: event.target.value }))} /></label>
            <label><span>Aderência máxima</span><input class="form-control" type="number" min="0" max="100" value=${filters.adherence_max} onInput=${(event) => setFilters((current) => ({ ...current, adherence_max: event.target.value }))} /></label>
            <label><span>Flag</span><input class="form-control" value=${filters.flag} placeholder="Código da flag" onInput=${(event) => setFilters((current) => ({ ...current, flag: event.target.value }))} /></label>
            <label><span>Análise pendente</span><select class="form-select" value=${filters.pending_analysis} onChange=${(event) => setFilters((current) => ({ ...current, pending_analysis: event.target.value }))}><option value="">Todas</option><option value="true">Somente pendentes</option><option value="false">Sem pendência</option></select></label>
            <label><span>Avaliação comparável</span><select class="form-select" value=${filters.comparable} onChange=${(event) => setFilters((current) => ({ ...current, comparable: event.target.value }))}><option value="">Todas</option><option value="true">Comparável</option><option value="false">Não comparável</option></select></label>
            <label><span>Correção manual</span><select class="form-select" value=${filters.manual_correction} onChange=${(event) => setFilters((current) => ({ ...current, manual_correction: event.target.value }))}><option value="">Todas</option><option value="true">Com correção manual</option><option value="false">Sem correção manual</option></select></label>
            <label><span>Ordenar por</span><select class="form-select" value=${filters.sort} onChange=${(event) => setFilters((current) => ({ ...current, page: 1, sort: event.target.value }))}><option value="ranking">Ranking</option><option value="candidate">Candidato</option><option value="official_score">Nota oficial</option><option value="analytical_score">Score analítico</option><option value="adherence">Aderência</option><option value="updated_at">Atualização</option></select></label>
            <label><span>Direção</span><select class="form-select" value=${filters.direction} onChange=${(event) => setFilters((current) => ({ ...current, direction: event.target.value }))}><option value="asc">Crescente</option><option value="desc">Decrescente</option></select></label>
            <div class="exam-analytics-filter-actions"><button type="submit" class="btn btn-primary"><span class="material-symbols-outlined">${IconeSvg('search')}</span>Aplicar</button><button type="button" class="btn btn-outline-secondary" onClick=${clearFilters}>Limpar</button></div>
          </form>
          <div class="exam-analytics-selection-bar">
            <span>${selected.length ? `${selected.length} selecionado(s)` : 'Selecione 2 ou 3 candidatos para comparar'}</span>
            <button type="button" class="btn btn-outline-primary btn-sm" disabled=${selected.length < 2 || selected.length > 3} onClick=${compare}>Comparar selecionados</button>
          </div>
          ${loading
          ? html`<${LoadingState} titulo="Carregando resultados" descricao="Consultando a leitura analítica consolidada." />`
          : items.length
            ? html`
              <div class="table-responsive exam-analytics-table-wrap"><table class="table align-middle exam-analytics-table"><thead><tr><th class="is-check"></th><th>Posição</th><th>Candidato</th><th>Status das provas</th><th>Excel</th><th>Word</th><th>Conhecimentos gerais</th><th>Conhecimentos técnicos</th><th>Redação</th><th>Nota oficial</th><th>Score analítico</th><th>Percentil</th><th>Aderência</th><th>Execução</th><th>Flags</th><th>Atualização</th><th>Ações</th></tr></thead><tbody>
                ${items.map((item) => html`
                  <tr key=${item.id_teste}>
                    <td class="is-check"><input type="checkbox" checked=${selectedSet.has(item.id_teste)} disabled=${!selectedSet.has(item.id_teste) && selected.length >= 3} onChange=${() => toggleSelected(item.id_teste)} aria-label=${`Selecionar ${item.nome_candidato}`} /></td>
                    <td><strong class="exam-analytics-rank">${item.posicao_densa ? `${item.posicao_densa}º` : '–'}</strong><small>${item.ranking_status || 'Indisponível'}</small></td>
                    <td><strong>${item.nome_candidato}</strong><small>${item.id_teste}</small></td>
                    <td><span class=${`exam-analytics-status ${classeStatus(item.status_analitico)}`}>${item.status_prova || item.status_analitico || '–'}</span><small>${item.status_correcao_oficial || item.motivo_indisponibilidade || ''}</small></td>
                    <td><strong>${rotuloNota(notaOficial(item, 'excel'))}</strong></td>
                    <td><strong>${rotuloNota(notaOficial(item, 'word', notaOficial(item, 'comunicacao')))}</strong></td>
                    <td><strong>${rotuloNota(notaOficial(item, 'objetiva'))}</strong></td>
                    <td><strong>${rotuloNota(notaOficial(item, 'tecnica'))}</strong></td>
                    <td><strong>${rotuloNota(notaOficial(item, 'redacao'))}</strong></td>
                    <td><strong>${numero(item.nota_oficial)}</strong><small>fonte oficial</small></td>
                    <td><${BarraPontuacao} value=${item.score_analitico} /></td>
                    <td><strong>${rotuloNota(item.percentil_geral)}</strong><small><${StatusAmostra} result=${item} /></small></td>
                    <td>${item.aderencia_perfil === null || item.aderencia_perfil === undefined ? html`<span class="text-muted">Não configurada</span>` : html`<strong>${numero(item.aderencia_perfil)}%</strong>`}</td>
                    <td>${item.indicador_execucao || 'Indisponível'}<small>${item.status_analitico}</small></td>
                    <td>${(item.alertas || []).length ? html`<span class="exam-analytics-status is-warning">${item.alertas.length} atenção(ões)</span>` : html`<span class="text-muted">Nenhuma</span>`}</td>
                    <td>${dataHora(item.atualizado_em)}</td>
                    <td><button type="button" class="btn btn-sm btn-outline-primary" onClick=${() => openDetail(item.id_teste)}>Ver detalhe</button></td>
                  </tr>
                `)}
              </tbody></table></div>
              <${GrupoPaginacao} paginaAtual=${data.pagination.page} totalPaginas=${data.pagination.pages} onChange=${(page) => setFilters((current) => ({ ...current, page }))} />
            `
            : Number(summary.proofs || 0) === 0
              ? html`<${EmptyState} title="Processo sem provas" text="Ainda não há prova vinculada a candidato neste processo." />`
              : html`<${EmptyState} title="Nenhum resultado analítico disponível" text="Há provas pendentes ou resultados oficiais que ainda precisam ser processados; novas finalizações entram automaticamente na fila." />`}
        </${SectionCard}>
      </div>
      <${ModalDetalheAnalitico} detail=${detail} loading=${detailLoading} onClose=${() => { setDetail(null); setDetailLoading(false); }} />
      <${ModalComparacao}
        data=${comparison}
        loading=${comparisonLoading}
        onClose=${() => { setComparison(null); setComparisonLoading(false); }}
        podeAprovar=${!!controlador?.possuiPermissao?.('candidatos.aprovar_final')}
        podeEliminar=${!!controlador?.possuiPermissao?.('candidatos.eliminar')}
        acaoEmAndamento=${acaoComparacaoEmAndamento}
        onAprovar=${aprovarCandidatoComparado}
        onEliminar=${eliminarCandidatoComparado}
      />
      <${ModalConfiguracao} open=${configOpen} configuration=${configuration} form=${configForm} mappings=${mappingForm} saving=${configSaving} error=${configError} message=${configMessage} onChange=${updateConfigForm} onMappingChange=${updateMappingForm} onClose=${() => setConfigOpen(false)} onSaveWeights=${saveWeights} onSaveProfile=${saveProfile} onSaveMappings=${saveMappings} />
    </${PainelRh}>
  `;
}
