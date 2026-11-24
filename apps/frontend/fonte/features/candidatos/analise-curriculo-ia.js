import { html, useEffect, useState } from '../../infraestrutura-react.js?v=20261124-equipes3';
import {
  analisarCurriculoIa,
  lerConfiguracaoAnaliseCurriculoIa,
  lerUltimaAnaliseCurriculoIa,
  marcarAnaliseCurriculoIaRevisada,
} from '../../servico-api.js?v=20261124-equipes3';
import { SectionCard } from '../../ui/componentes-compartilhados.js?v=20261124-equipes3';
import { formatarDataHora } from '../../shared/helpers-visuais.js?v=20261124-equipes3';
import { IconeSvg } from '../../ui/icone.js?v=20261124-equipes3';


const AVISO_REVISAO_HUMANA =
  'Esta análise é um apoio automatizado ao RH. A decisão final deve ser feita por uma pessoa responsável pelo processo seletivo.';

function formatarParecer(valor) {
  return String(valor || '-').replaceAll('_', ' ');
}

function ListaAnalise({ itens, vazio = 'Nenhum item informado.' }) {
  const lista = Array.isArray(itens) ? itens : [];
  if (!lista.length) return html`<span class="text-muted">${vazio}</span>`;
  return html`
    <ul class="mb-0 ps-3">
      ${lista.map((item, indice) => html`<li key=${`ia-item-${indice}`}>${item}</li>`)}
    </ul>
  `;
}

export function PainelAnaliseCurriculoIa({ candidato, podeAnalisar = false }) {
  const [configuracao, setConfiguracao] = useState(null);
  const [analise, setAnalise] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [executando, setExecutando] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');

  const idCandidato = String(candidato?.id_teste || '').trim();
  const idProcesso = String(
    candidato?.id_processo_ref || candidato?.id_processo || '',
  ).trim();

  useEffect(() => {
    let ativo = true;
    if (!podeAnalisar || !idCandidato) {
      setConfiguracao(null);
      setAnalise(null);
      return () => {
        ativo = false;
      };
    }

    setCarregando(true);
    setErro('');
    Promise.allSettled([
      lerConfiguracaoAnaliseCurriculoIa(),
      lerUltimaAnaliseCurriculoIa(idCandidato, idProcesso),
    ])
      .then(([configResp, ultimaResp]) => {
        if (!ativo) return;
        if (configResp.status === 'fulfilled') {
          setConfiguracao(configResp.value || {});
        } else {
          setConfiguracao({
            available: false,
            reason: 'Não foi possível consultar a configuração de IA.',
          });
        }
        if (ultimaResp.status === 'fulfilled') {
          setAnalise(ultimaResp.value?.analise || null);
        }
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });

    return () => {
      ativo = false;
    };
  }, [idCandidato, idProcesso, podeAnalisar]);

  if (!podeAnalisar || !idCandidato) return null;

  const executarAnalise = async () => {
    if (analise && !window.confirm('Deseja reanalisar este currículo com IA?')) return;
    setExecutando(true);
    setErro('');
    setMensagem('');
    try {
      const resposta = await analisarCurriculoIa(idCandidato, idProcesso);
      setAnalise(resposta?.analise || null);
      setMensagem('Análise concluída e registrada para revisão humana.');
    } catch (error) {
      setErro(error?.message || 'Não foi possível analisar o currículo com IA.');
      const ultima = await lerUltimaAnaliseCurriculoIa(idCandidato, idProcesso).catch(
        () => null,
      );
      if (ultima?.analise) setAnalise(ultima.analise);
    } finally {
      setExecutando(false);
    }
  };

  const marcarRevisada = async () => {
    if (!analise?.id_analise) return;
    setRevisando(true);
    setErro('');
    setMensagem('');
    try {
      const resposta = await marcarAnaliseCurriculoIaRevisada(analise.id_analise);
      setAnalise(resposta?.analise || analise);
      setMensagem('Análise marcada como revisada pelo RH.');
    } catch (error) {
      setErro(error?.message || 'Não foi possível registrar a revisão humana.');
    } finally {
      setRevisando(false);
    }
  };

  const disponivel = !!configuracao?.available;
  const possuiCurriculo = !!candidato?.cv_disponivel;
  const concluida = analise?.status_analise === 'CONCLUIDA';

  return html`
    <${SectionCard}
      title="Análise de currículo com IA"
      description="Avaliação técnica opcional, auditável e sem decisão automática."
      className="rh-section-card--flat"
    >
      <div class="alert alert-warning py-2">${AVISO_REVISAO_HUMANA}</div>

      ${carregando
        ? html`<p class="text-muted mb-0">Carregando análise...</p>`
        : html`
            ${!disponivel
              ? html`
                  <div class="alert alert-secondary py-2">
                    ${configuracao?.reason || 'A análise com IA está indisponível.'}
                  </div>
                `
              : null}
            ${!possuiCurriculo
              ? html`
                  <div class="alert alert-info py-2">
                    Adicione um currículo antes de solicitar a análise com IA.
                  </div>
                `
              : null}
            ${erro ? html`<div class="alert alert-danger py-2">${erro}</div>` : null}
            ${mensagem
              ? html`<div class="alert alert-success py-2">${mensagem}</div>`
              : null}

            <div class="d-flex flex-wrap gap-2 mb-3">
              ${disponivel && possuiCurriculo
                ? html`
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      disabled=${executando || revisando}
                      onClick=${executarAnalise}
                    >
                      <span class="material-symbols-outlined">${IconeSvg('auto_awesome')}</span>
                      ${executando
                        ? 'Analisando...'
                        : analise
                          ? 'Reanalisar'
                          : 'Analisar currículo com IA'}
                    </button>
                  `
                : null}
              ${concluida && !analise?.revisado_por_humano
                ? html`
                    <button
                      type="button"
                      class="btn btn-outline-primary btn-sm"
                      disabled=${executando || revisando}
                      onClick=${marcarRevisada}
                    >
                      ${revisando ? 'Registrando...' : 'Marcar como revisado pelo RH'}
                    </button>
                  `
                : null}
            </div>

            ${analise
              ? html`
                  <div class="row g-3">
                    <div class="col-md-3">
                      <strong>Status</strong>
                      <div>${formatarParecer(analise.status_analise)}</div>
                    </div>
                    <div class="col-md-3">
                      <strong>Nota de aderência</strong>
                      <div>${analise.nota_aderencia ?? '-'}</div>
                    </div>
                    <div class="col-md-3">
                      <strong>Parecer</strong>
                      <div>${formatarParecer(analise.parecer)}</div>
                    </div>
                    <div class="col-md-3">
                      <strong>Revisão humana</strong>
                      <div>${analise.revisado_por_humano ? 'Revisada pelo RH' : 'Pendente'}</div>
                    </div>
                    ${analise.status_analise === 'ERRO'
                      ? html`
                          <div class="col-12">
                            <div class="alert alert-danger mb-0">
                              ${analise.erro_analise || 'A análise não foi concluída.'}
                            </div>
                          </div>
                        `
                      : html`
                          <div class="col-12"><strong>Resumo</strong><div>${analise.resumo || '-'}</div></div>
                          <div class="col-md-6"><strong>Pontos fortes</strong><${ListaAnalise} itens=${analise.pontos_fortes} /></div>
                          <div class="col-md-6"><strong>Pontos de atenção</strong><${ListaAnalise} itens=${analise.pontos_atencao} /></div>
                          <div class="col-md-6"><strong>Riscos a validar</strong><${ListaAnalise} itens=${analise.riscos} /></div>
                          <div class="col-md-6"><strong>Perguntas sugeridas para entrevista</strong><${ListaAnalise} itens=${analise.perguntas_sugeridas_entrevista} /></div>
                          <div class="col-12"><strong>Justificativa</strong><div>${analise.justificativa || '-'}</div></div>
                        `}
                    <div class="col-md-6">
                      <strong>Modelo usado</strong>
                      <div>${analise.modelo_ia || '-'}</div>
                    </div>
                    <div class="col-md-6">
                      <strong>Data da análise</strong>
                      <div>${formatarDataHora(analise.criado_em)}</div>
                    </div>
                  </div>
                `
              : html`<p class="text-muted mb-0">Nenhuma análise de IA registrada.</p>`}
          `}
    </${SectionCard}>
  `;
}
