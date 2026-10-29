import { html, useEffect, useRef, useState } from '../../infraestrutura-react.js';
import { LoadingState } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import { marcarNotificacoesEntidadeLidas } from '../../services/api/notifications.js?v=20260921-alertas';
import {
  excluirMonitoria,
  restaurarMonitoria,
  aplicarFeedback,
  anexarEvidencia,
  baixarEvidencia,
  compartilharMonitorias,
  confirmarMonitoria,
  contestarMonitoria,
  criarPlano,
  exportarMonitorias,
  lerMonitoria,
  listarDestinatarios,
  reanalisarContestacao,
  replicarContestacao,
} from '../../services/api/monitoria.js';
import {
  BadgeSla,
  BadgeStatus,
  TagOperacao,
  TagsMonitoria,
  baixarArquivo,
  formatarDataHoraCurta,
  formatarData,
  formatarNota,
} from './comum.js';
import { AnswerBadge } from './nova-componentes.js?v=20261014-nova';

// Detalhe de UMA monitoria (somente leitura) + ações do fluxo. A monitoria original
// nunca é editada: cada ação só acrescenta feedback, contestação, réplica ou reanálise.
// Janela larga: a aba Avaliação mostra tudo de uma vez, em 3 colunas.

const Icone = ({ nome }) => html`<span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(nome)}</span>`;
const ABAS = [
  ['resumo', 'Avaliação'],
  ['linha', 'Linha do tempo'],
  ['fluxo', 'Feedback e contestação'],
];

function Cartao({ titulo, direita = null, className = '', children, rotulo = '' }) {
  return html`
    <section class=${`mon-dt-cartao ${className}`.trim()} aria-label=${rotulo || (typeof titulo === 'string' ? titulo : undefined)}>
      <header class="mon-dt-cartao-cab"><h3>${titulo}</h3>${direita}</header>
      <div class="mon-dt-cartao-corpo">${children}</div>
    </section>`;
}

// Texto longo: mostra 2 linhas e "Ver mais" expande.
function TextoRecolhivel({ texto }) {
  const ref = useRef(null);
  const [aberto, setAberto] = useState(false);
  const [corta, setCorta] = useState(false);
  useEffect(() => {
    if (!aberto && ref.current) setCorta(ref.current.scrollHeight > ref.current.clientHeight + 1);
  }, [texto, aberto]);
  if (!texto) return html`<p class="mon-dt-texto">—</p>`;
  return html`
    <div>
      <p ref=${ref} class=${`mon-dt-texto ${aberto ? '' : 'is-corta'}`}>${texto}</p>
      ${corta || aberto ? html`<button type="button" class="mon-dt-vermais" aria-expanded=${aberto} onClick=${() => setAberto((v) => !v)}>${aberto ? 'Ver menos' : 'Ver mais'}</button>` : null}
    </div>`;
}

export function DetalheMonitoria({ referencia, controlador, contexto, onClose, onAlterou, onLida, showToast }) {
  const [d, setD] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aba, setAba] = useState('resumo');
  const [feedback, setFeedback] = useState({ observacao: '', complemento: '' });
  const [contestacao, setContestacao] = useState({ criterios: [], motivo: '', justificativa: '' });
  const [contestando, setContestando] = useState(false);
  const [replica, setReplica] = useState('');
  const [reanalise, setReanalise] = useState({ resultado: '', observacao: '' });
  const [plano, setPlano] = useState({ problema: '', criterio: '', objetivo: '', acao: '', prazo: '' });
  const [destinatarios, setDestinatarios] = useState(null);
  const [selecionados, setSelecionados] = useState([]);
  const [excluindo, setExcluindo] = useState(null); // { motivo, confirmacao }
  const abasRef = useRef({});

  const perfil = controlador?.estado?.perfilUsuario;
  const pode = (p) => controlador.possuiPermissao(p);

  const carregar = async () => {
    try {
      setD(await lerMonitoria(referencia));
      setErro('');
    } catch (e) {
      setErro(e?.message || 'Não foi possível carregar a monitoria.');
    }
  };
  useEffect(() => {
    setD(null);
    carregar();
  }, [referencia]);

  // Abrir a monitoria = ciente das novidades dela: some o alerta (bolinha) ligado a ela.
  const idMonitoria = d?.id_monitoria;
  useEffect(() => {
    if (!idMonitoria) return;
    marcarNotificacoesEntidadeLidas('monitoria', idMonitoria)
      .then((r) => { if (r?.atualizadas) onLida?.(); })
      .catch(() => {});
  }, [idMonitoria]);

  const executar = async (acao, mensagem) => {
    setOcupado(true);
    try {
      await acao();
      showToast(mensagem, 'success');
      await carregar();
      onAlterou?.();
    } catch (e) {
      showToast(e?.message || 'Não foi possível concluir a ação.', 'danger');
    } finally {
      setOcupado(false);
    }
  };

  if (erro) {
    return html`<div class="mon-dt-estado"><div class="mon-alerta mon-alerta--danger" role="alert">${erro}
      <button type="button" class="btn btn-outline-secondary btn-sm ms-2" onClick=${() => { setErro(''); carregar(); }}>Tentar de novo</button></div></div>`;
  }
  if (!d) {
    return html`<div class="mon-dt-grade" aria-busy="true" aria-label="Carregando a monitoria">
      ${[0, 1, 2].map((i) => html`<div key=${i} class="mon-dt-esqueleto"><div></div><div></div><div></div></div>`)}</div>`;
  }

  const podeFeedback = d.status === 'FEEDBACK_PENDENTE' && pode('monitoria.feedback_aplicar');
  const ehDono = perfil === 'operador' && pode('monitoria.contestar');
  const podeManifestar = ehDono && d.status === 'AGUARDANDO_CONFIRMACAO';
  const podeReplicar = ehDono && d.status === 'REANALISE';
  const podeReanalisar = d.status === 'REANALISE' && pode('monitoria.reanalisar');
  const podePlano = pode('monitoria.plano_acao') && d.nivel && ['Desenvolvimento', 'Crítico'].includes(d.faixa?.label);
  const podeExportar = pode('monitoria.exportar');
  // Exclusão lógica: somente Administrador (o backend valida de novo).
  const ehAdministrador = perfil === 'administrador';
  const confirmarExclusao = async () => {
    setOcupado(true);
    try {
      await excluirMonitoria(d.codigo, excluindo.motivo.trim(), excluindo.confirmacao.trim());
      showToast(`Monitoria #${d.codigo} excluída. Ela não aparece mais em listas, painéis e indicadores.`, 'success');
      setExcluindo(null);
      onAlterou?.();
      onClose?.();
    } catch (e) {
      showToast(e?.message || 'Não foi possível excluir.', 'danger');
    } finally {
      setOcupado(false);
    }
  };

  const exportar = async () => {
    try {
      baixarArquivo(await exportarMonitorias([d.id_monitoria]));
    } catch (e) {
      showToast(e?.message || 'Não foi possível exportar.', 'danger');
    }
  };
  const abrirCompartilhar = async () => {
    try {
      setDestinatarios((await listarDestinatarios([d.id_monitoria]))?.itens || []);
      setAba('compartilhar');
    } catch (e) {
      showToast(e?.message || 'Não foi possível listar os destinatários.', 'danger');
    }
  };

  const aoTeclarAba = (ev, i) => {
    const passo = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
    if (!passo) return;
    ev.preventDefault();
    const alvo = ABAS[(i + passo + ABAS.length) % ABAS.length][0];
    setAba(alvo);
    abasRef.current[alvo]?.focus();
  };

  const escala = d.config?.escala || { min: 1, max: 10 };
  const pctEscala = (v) => Math.max(0, Math.min(100, ((Number(v) - escala.min) / Math.max(1, escala.max - escala.min)) * 100));
  const blocos = d.config.blocos;
  const meio = Math.ceil(blocos.length / 2);
  const cartoesBlocos = [blocos.slice(0, meio), blocos.slice(meio)].filter((l) => l.length);
  const valoresPilares = [
    ['Conhecimento (média)', d.pilar_conhecimento],
    ['Encantamento (média)', d.pilar_encantamento],
    ...['conhecimento', 'encantamento'].flatMap((t) => Object.entries(d.pilares?.[t] || {})),
  ];
  const temColunaC = podeFeedback || podeManifestar || podeReplicar || podeReanalisar || podePlano;

  const cartaoFeedback = podeFeedback ? html`
    <${Cartao} titulo="Aplicar feedback" className="mon-dt-feedback"
      direita=${html`<span class="mon-dt-prazo">prazo de 72 horas <${BadgeSla} sla=${d.sla} /></span>`}>
      ${d.sugestao_feedback ? html`<div class="mon-dt-sugestao"><strong>Sugestão do avaliador:</strong> ${d.sugestao_feedback}</div>` : null}
      <label class="mon-campo mon-dt-obs-feedback">Observação do feedback aplicado (obrigatória)<textarea class="form-control" value=${feedback.observacao} onInput=${(e) => setFeedback({ ...feedback, observacao: e.target.value })}></textarea></label>
      <label class="mon-campo mon-dt-compl-feedback">Complemento (opcional)<textarea class="form-control" value=${feedback.complemento} onInput=${(e) => setFeedback({ ...feedback, complemento: e.target.value })}></textarea></label>
      <div class="mon-acoes-direita">
        <button type="button" class=${`btn btn-primary ${feedback.observacao.trim() ? '' : 'is-pendente'}`} disabled=${ocupado || !feedback.observacao.trim()}
          onClick=${() => executar(() => aplicarFeedback(d.codigo, feedback), 'Feedback registrado. O operador tem 48 horas para se manifestar.')}>Registrar feedback aplicado</button>
      </div>
    </${Cartao}>` : null;

  const cartaoManifestacao = podeManifestar ? html`
    <${Cartao} titulo="Sua manifestação sobre o feedback">
      <div class="mon-form-feedback">
        ${(d.feedbacks || []).length ? html`<div class="mon-fb-msg">${d.feedbacks.map((f) => html`<div key=${f.id_feedback}>
          <strong>Feedback de ${f.aplicado_por}</strong><span class="mon-muted"> · ${formatarDataHoraCurta(f.em)}</span>
          <p>${f.observacao}</p>${f.complemento ? html`<p>${f.complemento}</p>` : null}</div>`)}</div>` : null}
        <p class="mon-muted">Prazo de 48 horas. Sem resposta, a monitoria é confirmada automaticamente.</p>
        ${!contestando ? html`
          <div class="mon-decisao mon-decisao--lado">
            <button type="button" class="btn btn-primary mon-btn-icone" disabled=${ocupado}
              onClick=${() => executar(() => confirmarMonitoria(d.codigo), 'Você concordou com a monitoria.')}><${Icone} nome="check_circle" />Concordar</button>
            <button type="button" class="btn btn-outline-danger mon-btn-icone" disabled=${ocupado} onClick=${() => setContestando(true)}><${Icone} nome="flag" />Contestar feedback</button>
          </div>` : html`
          <label class="mon-campo"><span>Critério(s) contestado(s)</span>
            <select class="form-select" multiple size="6" value=${contestacao.criterios} onChange=${(e) => setContestacao({ ...contestacao, criterios: Array.from(e.target.selectedOptions).map((o) => o.value) })}>
              ${d.config.blocos.flatMap((b) => b.criterios.map((c) => html`<option key=${c.id} value=${c.id}>${b.nome} — ${c.texto}</option>`))}
            </select></label>
          <label class="mon-campo"><span>Motivo</span><input class="form-control" value=${contestacao.motivo} maxlength="400" onInput=${(e) => setContestacao({ ...contestacao, motivo: e.target.value })} /></label>
          <label class="mon-campo"><span>Justificativa</span><textarea class="form-control" rows="4" value=${contestacao.justificativa} onInput=${(e) => setContestacao({ ...contestacao, justificativa: e.target.value })}></textarea></label>
          <div class="mon-acoes-direita">
            <button type="button" class="btn btn-outline-secondary" disabled=${ocupado} onClick=${() => setContestando(false)}>Voltar</button>
            <button type="button" class="btn btn-danger mon-btn-icone" disabled=${ocupado || !contestacao.criterios.length || !contestacao.motivo.trim() || !contestacao.justificativa.trim()}
              onClick=${() => executar(async () => { await contestarMonitoria(d.codigo, contestacao); setContestando(false); }, 'Contestação enviada ao supervisor responsável.')}><${Icone} nome="flag" />Enviar contestação</button>
          </div>`}
      </div>
    </${Cartao}>` : null;

  const cartaoReplica = podeReplicar ? html`
    <${Cartao} titulo="Réplica e evidências">
      <div class="mon-form-feedback">
        <label class="mon-campo"><span>Réplica</span><textarea class="form-control" rows="3" value=${replica} onInput=${(e) => setReplica(e.target.value)}></textarea></label>
        <div class="mon-acoes-direita">
          <button type="button" class="btn btn-outline-secondary" disabled=${ocupado || !replica.trim()}
            onClick=${() => executar(async () => { await replicarContestacao(d.codigo, replica); setReplica(''); }, 'Réplica registrada.')}>Enviar réplica</button>
        </div>
        <label class="mon-campo"><span>Anexar evidência (PDF, DOC, DOCX, PNG ou JPG · até 10 MB · máx. 5)</span>
          <input type="file" class="form-control" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
            onChange=${(e) => { const f = e.target.files?.[0]; if (f) executar(() => anexarEvidencia(d.codigo, f), 'Evidência anexada.'); e.target.value = ''; }} /></label>
      </div>
    </${Cartao}>` : null;

  const cartaoReanalise = podeReanalisar ? html`
    <${Cartao} titulo="Reanálise da contestação">
      <div class="mon-form-feedback">
        <p class="mon-muted">Prazo de 72 horas. A monitoria original nunca é editada: ao dar baixa, ela segue para o histórico apenas para consulta.</p>
        <div class="mon-campo"><span>Decisão</span>
          <div class="mon-decisao mon-decisao--opcoes" role="radiogroup" aria-label="Decisão da reanálise">
            ${[['CONFIRMADA', 'Manter avaliação'], ['ANULADA', 'Anular monitoria']].map(([v, r]) => html`<button key=${v} type="button" role="radio" aria-checked=${reanalise.resultado === v}
              class=${`mon-subnav-btn ${reanalise.resultado === v ? 'is-active' : ''}`} onClick=${() => setReanalise({ ...reanalise, resultado: v })}>${r}</button>`)}
          </div>
        </div>
        <label class="mon-campo"><span>Observação da reanálise (obrigatória)</span><textarea class="form-control" rows="3" value=${reanalise.observacao} onInput=${(e) => setReanalise({ ...reanalise, observacao: e.target.value })}></textarea></label>
        <div class="mon-acoes-direita">
          <button type="button" class="btn btn-primary mon-btn-icone" disabled=${ocupado || !reanalise.resultado || !reanalise.observacao.trim()}
            onClick=${() => executar(() => reanalisarContestacao(d.codigo, reanalise), 'Baixa registrada: a monitoria foi para o histórico.')}><${Icone} nome="check" />Dar baixa</button>
        </div>
      </div>
    </${Cartao}>` : null;

  const cartaoPlano = podePlano ? html`
    <${Cartao} titulo=${`Plano de ação (${d.faixa.label}: ${d.faixa.acao})`}>
      <div class="mon-form-grid">
        <label>Problema identificado<input class="form-control" value=${plano.problema} onInput=${(e) => setPlano({ ...plano, problema: e.target.value })} /></label>
        <label>Critério relacionado<input class="form-control" value=${plano.criterio} onInput=${(e) => setPlano({ ...plano, criterio: e.target.value })} /></label>
        <label>Objetivo<input class="form-control" value=${plano.objetivo} onInput=${(e) => setPlano({ ...plano, objetivo: e.target.value })} /></label>
        <label>Ação proposta<input class="form-control" value=${plano.acao} onInput=${(e) => setPlano({ ...plano, acao: e.target.value })} /></label>
        <label>Prazo<input class="form-control" type="date" value=${plano.prazo} onInput=${(e) => setPlano({ ...plano, prazo: e.target.value })} /></label>
      </div>
      <div class="mon-acoes-direita"><button type="button" class="btn btn-outline-primary" disabled=${ocupado || !plano.problema || !plano.objetivo || !plano.acao || !plano.prazo}
        onClick=${() => executar(() => criarPlano({ ...plano, id_monitoria: d.id_monitoria }), 'Plano de ação criado.')}>Criar plano de ação</button></div>
    </${Cartao}>` : null;

  return html`
    <div class="mon-dt-conteudo">
      <section class="mon-dt-titulo">
        <div class="mon-dt-titulo-esq">
          <h1>Monitoria #${d.codigo}</h1>
          <div class="mon-dt-chips">
            <${TagOperacao} chave=${d.operacao} nome=${d.operacao_nome} contexto=${contexto} />
            <${BadgeStatus} status=${d.status} rotulo=${d.status_rotulo} perfil=${perfil} contestada=${d.contestacoes.length > 0} />
            <${TagsMonitoria} item=${{ possui_ncg: d.possui_ncg, anulada: d.anulada || d.resultado === 'ANULADA', resultado: d.resultado }} />
            <${BadgeSla} sla=${d.sla} />
          </div>
        </div>
        <div class="mon-dt-nota">
          <span>Nota final</span>
          <strong style=${{ '--faixa': d.faixa?.cor || 'var(--brand)' }}>${formatarNota(d.nota)}<small>/100</small></strong>
          <span>${d.faixa?.label || d.nivel} · matriz v${d.numero_versao}</span>
        </div>
      </section>

      <div class="mon-dt-barra-abas">
        <div class="mon-dt-abas" role="tablist" aria-label="Seções do detalhe">
          ${ABAS.map(([k, rotulo], i) => html`<button key=${k} type="button" role="tab" id=${`mon-dt-aba-${k}`} aria-controls=${`mon-dt-painel-${k}`}
            ref=${(el) => { abasRef.current[k] = el; }} aria-selected=${aba === k} tabIndex=${aba === k || (aba === 'compartilhar' && i === 0) ? 0 : -1}
            class=${`mon-dt-aba ${aba === k ? 'is-ativa' : ''}`} onClick=${() => setAba(k)} onKeyDown=${(ev) => aoTeclarAba(ev, i)}>${rotulo}</button>`)}
        </div>
        <div class="mon-dt-acoes">
          ${podeExportar ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${exportar}>Exportar (XLSX)</button>` : null}
          ${ehAdministrador && !d.excluida ? html`<button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => setExcluindo({ motivo: '', confirmacao: '' })}>Excluir</button>` : null}
        </div>
      </div>

      ${d.excluida ? html`
        <div class="mon-alerta mon-alerta--danger mon-dt-faixa-alerta" role="alert">
          <strong>Monitoria excluída</strong> por ${d.excluida.por} em ${formatarDataHoraCurta(d.excluida.em)}. Motivo: ${d.excluida.motivo}.
          Ela não aparece em listas, painéis nem indicadores.
          ${ehAdministrador ? html`<button type="button" class="btn btn-outline-secondary btn-sm ms-2" disabled=${ocupado}
            onClick=${() => executar(() => restaurarMonitoria(d.id_monitoria), 'Monitoria restaurada.')}>Restaurar</button>` : null}
        </div>` : null}

      ${excluindo ? html`
        <div class="mon-alerta mon-alerta--danger mon-dt-faixa-alerta" role="alertdialog" aria-label="Confirmar exclusão">
          <p><strong>Esta ação não pode ser desfeita pela equipe:</strong> a monitoria some de listas, painéis, indicadores e do fluxo de
          feedback/contestação. Fica registrada no log com o motivo, e só o Administrador pode restaurá-la.</p>
          <div class="mon-form-grid">
            <label class="mon-campo">Motivo (obrigatório)
              <input class="form-control" maxlength="400" value=${excluindo.motivo} onInput=${(e) => setExcluindo({ ...excluindo, motivo: e.target.value })} />
            </label>
            <label class="mon-campo">Digite o ID da monitoria (${d.codigo}) para confirmar
              <input class="form-control" inputmode="numeric" maxlength="8" value=${excluindo.confirmacao} onInput=${(e) => setExcluindo({ ...excluindo, confirmacao: e.target.value })} />
            </label>
          </div>
          <div class="mon-acoes">
            <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${ocupado} onClick=${() => setExcluindo(null)}>Cancelar</button>
            <button type="button" class="btn btn-danger btn-sm"
              disabled=${ocupado || excluindo.motivo.trim().length < 5 || excluindo.confirmacao.trim() !== d.codigo}
              onClick=${confirmarExclusao}>${ocupado ? 'Excluindo…' : 'Excluir definitivamente das telas'}</button>
          </div>
        </div>` : null}

      ${aba === 'resumo' ? html`
        <div class=${`mon-dt-grade ${temColunaC ? '' : 'mon-dt-grade--sem-c'}`} role="tabpanel" id="mon-dt-painel-resumo" aria-labelledby="mon-dt-aba-resumo">
          <div class="mon-dt-col mon-dt-col-a">
            <${Cartao} titulo="Dados da monitoria">
              <dl class="mon-dt-dl">
                <div><dt>Operador</dt><dd>${d.operador_nome || '—'}</dd></div>
                <div><dt>Equipe / turno</dt><dd>${`${d.equipe_nome || '—'}${d.turno ? ` · ${d.turno}` : ''}`}</dd></div>
                <div><dt>Supervisor(es)</dt><dd>${(d.supervisores || []).map((s) => s.nome).join(', ') || '—'}</dd></div>
                <div><dt>Avaliador</dt><dd>${d.avaliador_nome || '—'}</dd></div>
                <div><dt>Data do contato</dt><dd>${formatarData(d.data_contato)}</dd></div>
                <div><dt>Data da monitoria</dt><dd>${formatarDataHoraCurta(d.data_monitoria)}</dd></div>
                <div><dt>Canal / tipo</dt><dd>${d.canal || d.tipo_atendimento ? `${d.canal || '—'} · ${d.tipo_atendimento || '—'}` : '—'}</dd></div>
                <div><dt>Cliente (nome / CPF)</dt><dd>${d.nome_cliente || '—'} / ${d.cpf_cliente || '—'}</dd></div>
                <div><dt>Telefone / interação</dt><dd>${d.telefone || '—'} / ${d.id_interacao || '—'}</dd></div>
                <div><dt>Blocos avaliados / nulos</dt><dd>${d.blocos_avaliados} / ${d.blocos_nulos}</dd></div>
              </dl>
              ${d.possui_ncg ? html`<div class="mon-alerta mon-alerta--danger"><strong>NCG:</strong> ${d.motivo_ncg}</div>` : null}
              ${d.anulada ? html`<div class="mon-alerta"><strong>Anulada (menos de 3 blocos):</strong> ${d.justificativa_anulacao}</div>` : null}
            </${Cartao}>
            <${Cartao} titulo="Pilares" direita=${html`<span class="mon-dt-nota-pilar">não alteram a nota</span>`}>
              <dl class="mon-dt-pilares">
                ${valoresPilares.map(([nome, valor]) => html`
                  <div key=${nome}><dt>${nome}</dt><dd><strong>${valor == null ? '—' : formatarNota(valor)}</strong>
                    <span class="mon-dt-barra" role="img" aria-label=${`${nome}: ${valor == null ? 'sem valor' : formatarNota(valor)} na escala de ${escala.min} a ${escala.max}`}><i style=${{ width: `${valor == null ? 0 : pctEscala(valor)}%` }}></i></span></dd></div>`)}
              </dl>
            </${Cartao}>
          </div>

          <div class="mon-dt-col mon-dt-col-b">
            <div class="mon-dt-blocos">
              ${cartoesBlocos.map((lista, n) => html`
                <div class="mon-dt-bloco-coluna" key=${n}>
                  ${lista.map((bloco) => {
                    const st = d.blocos.find((b) => b.id === bloco.id);
                    return html`
                      <section class=${`mon-dt-bloco ${st?.status === 'NULO' ? 'is-nulo' : ''}`} key=${bloco.id}>
                        <header><strong title=${bloco.nome}>${bloco.nome}</strong><span>${st?.status === 'NULO' ? 'Bloco nulo (N/A)' : `${formatarNota(st?.pontos)} / ${formatarNota(st?.valor_efetivo)}`}</span></header>
                        ${bloco.criterios.map((c) => html`
                          <div class="mon-dt-criterio" key=${c.id}>
                            <span class="mon-dt-criterio-txt" title=${c.texto}>${c.texto}</span>
                            <small>peso ${formatarNota(c.peso)}</small>
                            <${AnswerBadge} valor=${d.respostas[c.id]} />
                          </div>`)}
                      </section>`;
                  })}
                </div>`)}
            </div>
            <${Cartao} titulo="Observação e sugestão de feedback">
              <div class="mon-dt-obs">
                <div><strong>Observação:</strong><${TextoRecolhivel} texto=${d.observacao} /></div>
                <div><strong>Sugestão de feedback:</strong><${TextoRecolhivel} texto=${d.sugestao_feedback} /></div>
              </div>
            </${Cartao}>
          </div>

          ${temColunaC ? html`<div class="mon-dt-col mon-dt-col-c">${cartaoFeedback}${cartaoManifestacao}${cartaoReplica}${cartaoReanalise}${cartaoPlano}</div>` : null}
        </div>
      ` : null}

      ${aba === 'linha' ? html`
        <div class="mon-dt-pagina" role="tabpanel" id="mon-dt-painel-linha" aria-labelledby="mon-dt-aba-linha">
          <ol class="mon-timeline">
            ${d.eventos.map((e, i) => html`
              <li key=${i}><div><strong>${e.para_rotulo}</strong>${e.automatico ? html` <span class="mon-tag">Automático</span>` : null}
                <div class="quando">${formatarDataHoraCurta(e.em)} · ${e.usuario}${e.perfil && e.perfil !== 'sistema' ? ` (${e.perfil})` : ''}${e.de ? ` · ${e.de} → ${e.para}` : ''}</div>
                ${e.observacao ? html`<div class="mon-muted">${e.observacao}</div>` : null}</div></li>`)}
          </ol>
        </div>
      ` : null}

      ${aba === 'fluxo' ? html`
        <div class="mon-dt-pagina" role="tabpanel" id="mon-dt-painel-fluxo" aria-labelledby="mon-dt-aba-fluxo">
          ${!d.feedbacks.length && !d.contestacoes.length ? html`<p class="mon-muted">Ainda não há feedback nem contestação.</p>` : html`
          <div class="mon-dt-fluxo">
            <${Cartao} titulo="Feedback">
              ${d.feedbacks.map((f) => html`<div class="mon-dt-item" key=${f.id_feedback}>
                <strong>Feedback aplicado por ${f.aplicado_por}</strong>
                <p class="mon-muted">${formatarDataHoraCurta(f.em)} · ${f.dentro_sla === false ? 'fora do prazo' : 'dentro do prazo'}</p>
                <p><strong>Observação:</strong> ${f.observacao}</p>${f.complemento ? html`<p><strong>Complemento:</strong> ${f.complemento}</p>` : null}</div>`)}
              ${!d.feedbacks.length ? html`<p class="mon-muted">${d.sugestao_feedback ? `Sugestão do avaliador: ${d.sugestao_feedback}` : '—'}</p>` : null}
            </${Cartao}>
            <${Cartao} titulo="Contestação">
              ${d.contestacoes.map((c) => html`<div class="mon-dt-item" key=${c.id_contestacao}>
                <strong>Contestação do operador</strong>
                <p class="mon-muted">${formatarDataHoraCurta(c.em)}</p>
                <p><strong>Critérios:</strong> ${c.criterios.map((x) => x.texto).join('; ')}</p>
                <p><strong>Motivo:</strong> ${c.motivo}</p><p><strong>Justificativa:</strong> ${c.justificativa}</p>
                ${c.replicas.map((r, i) => html`<p key=${i}><strong>Réplica (${formatarDataHoraCurta(r.em)}):</strong> ${r.texto}</p>`)}
                ${c.anexos.length ? html`<div class="mon-acoes">${c.anexos.map((a) => html`<button key=${a.id_anexo} type="button" class="btn btn-outline-secondary btn-sm"
                  onClick=${async () => baixarArquivo(await baixarEvidencia(a.id_anexo))}>${a.nome}</button>`)}</div>` : null}
                ${c.reanalise ? html`<div class="mon-alerta mon-alerta--info"><strong>Reanálise${c.reanalise.automatico ? ' automática' : ''} — ${c.reanalise.resultado === 'CONFIRMADA' ? 'avaliação mantida' : 'monitoria anulada'}</strong>
                  <div>${c.reanalise.observacao}</div><small>${c.reanalise.supervisor || 'Sistema'} · ${formatarDataHoraCurta(c.reanalise.em)}</small></div>` : null}</div>`)}
              ${!d.contestacoes.length ? html`<p class="mon-muted">—</p>` : null}
            </${Cartao}>
          </div>`}
        </div>
      ` : null}

      ${aba === 'compartilhar' ? html`
        <div class="mon-dt-pagina" role="tabpanel" aria-label="Compartilhar por e-mail">
          <${Cartao} titulo="Compartilhar por e-mail">
            <p class="mon-muted">Somente usuários que podem ver esta monitoria aparecem na lista. O envio é registrado no log.</p>
            ${destinatarios === null ? html`<${LoadingState} titulo="Carregando destinatários" />` : html`
              <div class="mon-acoes">${destinatarios.map((u) => html`<label key=${u.id_usuario} class="mon-tag" style=${{ cursor: 'pointer' }}>
                <input type="checkbox" checked=${selecionados.includes(u.id_usuario)} onChange=${(e) => setSelecionados((s) => e.target.checked ? [...s, u.id_usuario] : s.filter((x) => x !== u.id_usuario))} />
                ${u.nome} · ${u.perfil}</label>`)}</div>
              ${!destinatarios.length ? html`<p class="mon-muted">Nenhum usuário elegível.</p>` : null}
              <button type="button" class="btn btn-primary" disabled=${!selecionados.length || ocupado}
                onClick=${() => executar(() => compartilharMonitorias({ ids: [d.id_monitoria], destinatarios: selecionados }), 'Monitoria compartilhada por e-mail.')}>Enviar</button>`}
          </${Cartao}>
        </div>
      ` : null}
    </div>
  `;
}

// Janela do Detalhe: diálogo largo por cima da página de origem, fundo escurecido.
// Foco preso dentro dela, Esc e clique fora fecham, e o foco volta a quem a abriu.
export function ModalDetalheMonitoria({ referencia, ...props }) {
  const aberto = Boolean(referencia);
  const dialogoRef = useRef(null);
  const origemRef = useRef(null);
  const origemIdRef = useRef('');
  const aoFecharRef = useRef(props.onClose);
  aoFecharRef.current = props.onClose;

  useEffect(() => {
    if (!aberto) return undefined;
    origemRef.current = document.activeElement;
    origemIdRef.current = document.activeElement?.getAttribute?.('data-mon-id') || '';
    dialogoRef.current?.focus();
    const aoTeclar = (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        aoFecharRef.current?.();
        return;
      }
      if (ev.key !== 'Tab' || !dialogoRef.current) return;
      const focaveis = [...dialogoRef.current.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((el) => el.offsetParent !== null);
      if (!focaveis.length) {
        ev.preventDefault();
        return;
      }
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (ev.shiftKey && (document.activeElement === primeiro || document.activeElement === dialogoRef.current)) {
        ev.preventDefault();
        ultimo.focus();
      } else if (!ev.shiftKey && document.activeElement === ultimo) {
        ev.preventDefault();
        primeiro.focus();
      }
    };
    document.addEventListener('keydown', aoTeclar, true);
    return () => {
      document.removeEventListener('keydown', aoTeclar, true);
      const origem = origemRef.current;
      if (origem && typeof origem.focus === 'function' && document.contains(origem)) origem.focus();
      else if (origemIdRef.current) {
        // A lista recarrega após uma ação e troca as linhas: devolve o foco à linha equivalente.
        window.setTimeout(() => document.querySelector(`[data-mon-id="${origemIdRef.current}"]`)?.focus(), 400);
      }
    };
  }, [aberto]);

  if (!aberto) return null;
  return html`
    <div class="rh-modal-overlay mon-dt-overlay" onMouseDown=${(ev) => { if (ev.target === ev.currentTarget) props.onClose?.(); }}>
      <div ref=${dialogoRef} class="mon-dt" role="dialog" aria-modal="true" aria-labelledby="mon-dt-titulo" tabIndex="-1">
        <header class="mon-dt-topo">
          <h2 id="mon-dt-titulo">Detalhe da monitoria</h2>
          <button type="button" class="mon-dt-fechar" aria-label="Fechar" title="Fechar" onClick=${props.onClose}><${Icone} nome="close" /></button>
        </header>
        <${DetalheMonitoria} referencia=${referencia} ...${props} />
      </div>
    </div>
  `;
}
