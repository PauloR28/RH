import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { LoadingState, ModalPadrao, SectionCard } from '../../ui/componentes-compartilhados.js';
import {
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

// Detalhe de UMA monitoria (somente leitura) + ações do fluxo. A monitoria original
// nunca é editada: cada ação só acrescenta feedback, contestação, réplica ou reanálise.

const CLASSE_RESP = { SIM: 'is-sim', NAO: 'is-nao', NCG: 'is-ncg', NA: '' };
const ROTULO_RESP = { SIM: 'SIM', NAO: 'NÃO', NCG: 'NCG', NA: 'N/A' };

function Painel({ titulo, children }) {
  return html`<${SectionCard} title=${titulo}>${children}</${SectionCard}>`;
}

export function DetalheMonitoria({ referencia, controlador, contexto, onClose, onAlterou, showToast }) {
  const [d, setD] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aba, setAba] = useState('resumo');
  const [feedback, setFeedback] = useState({ observacao: '', complemento: '' });
  const [contestacao, setContestacao] = useState({ criterios: [], motivo: '', justificativa: '' });
  const [replica, setReplica] = useState('');
  const [reanalise, setReanalise] = useState({ resultado: '', observacao: '' });
  const [plano, setPlano] = useState({ problema: '', criterio: '', objetivo: '', acao: '', prazo: '' });
  const [destinatarios, setDestinatarios] = useState(null);
  const [selecionados, setSelecionados] = useState([]);

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
    carregar();
  }, [referencia]);

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

  if (erro) return html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  if (!d) return html`<${LoadingState} titulo="Carregando a monitoria" />`;

  const podeFeedback = d.status === 'FEEDBACK_PENDENTE' && pode('monitoria.feedback_aplicar');
  const ehDono = perfil === 'operador' && pode('monitoria.contestar');
  const podeManifestar = ehDono && d.status === 'AGUARDANDO_CONFIRMACAO';
  const podeReplicar = ehDono && d.status === 'REANALISE';
  const podeReanalisar = d.status === 'REANALISE' && pode('monitoria.reanalisar');
  const contestacao0 = d.contestacoes?.[0];
  const podeExportar = pode('monitoria.exportar');

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

  return html`
    <div class="mon-shell">
      <div class="mon-detalhe-topo">
        <div>
          <h2 style=${{ margin: 0 }}>Monitoria #${d.codigo}</h2>
          <div class="mon-acoes" style=${{ marginTop: '8px' }}>
            <${TagOperacao} chave=${d.operacao} nome=${d.operacao_nome} contexto=${contexto} />
            <${BadgeStatus} status=${d.status} rotulo=${d.status_rotulo} />
            <${TagsMonitoria} item=${{ possui_ncg: d.possui_ncg, anulada: d.anulada || d.resultado === 'ANULADA' }} />
            <${BadgeSla} sla=${d.sla} />
          </div>
        </div>
        <div style=${{ textAlign: 'right' }}>
          <div class="mon-detalhe-nota" style=${{ color: d.faixa?.cor || 'inherit' }}>${formatarNota(d.nota)}<small style=${{ fontSize: '14px' }}>/100</small></div>
          <span class="mon-muted">${d.faixa?.label || d.nivel} · matriz v${d.numero_versao}</span>
        </div>
      </div>

      <div class="mon-acoes">
        ${['resumo', 'linha', 'fluxo'].map((k) => html`<button key=${k} type="button" class=${`mon-subnav-btn ${aba === k ? 'is-active' : ''}`} onClick=${() => setAba(k)}>${{ resumo: 'Avaliação', linha: 'Linha do tempo', fluxo: 'Feedback e contestação' }[k]}</button>`)}
        ${podeExportar ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${exportar}>Exportar (XLSX)</button>` : null}
        ${podeExportar ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${abrirCompartilhar}>Compartilhar por e-mail</button>` : null}
      </div>

      ${aba === 'resumo' ? html`
        <${Painel} titulo="Dados da monitoria">
          <dl class="mon-dl">
            <div><dt>Operador</dt><dd>${d.operador_nome}</dd></div>
            <div><dt>Equipe / turno</dt><dd>${d.equipe_nome || '—'}${d.turno ? ` · ${d.turno}` : ''}</dd></div>
            <div><dt>Supervisor(es)</dt><dd>${(d.supervisores || []).map((s) => s.nome).join(', ') || '—'}</dd></div>
            <div><dt>Avaliador</dt><dd>${d.avaliador_nome}</dd></div>
            <div><dt>Data do contato</dt><dd>${formatarData(d.data_contato)}</dd></div>
            <div><dt>Data da monitoria</dt><dd>${formatarDataHoraCurta(d.data_monitoria)}</dd></div>
            <div><dt>Canal / tipo</dt><dd>${d.canal} · ${d.tipo_atendimento}</dd></div>
            <div><dt>Telefone / interação</dt><dd>${d.telefone || '—'} / ${d.id_interacao || '—'}</dd></div>
            <div><dt>Blocos avaliados / nulos</dt><dd>${d.blocos_avaliados} / ${d.blocos_nulos}</dd></div>
          </dl>
          ${d.possui_ncg ? html`<div class="mon-alerta mon-alerta--danger"><strong>NCG:</strong> ${d.motivo_ncg}</div>` : null}
          ${d.anulada ? html`<div class="mon-alerta"><strong>Anulada (menos de 3 blocos):</strong> ${d.justificativa_anulacao}</div>` : null}
        </${Painel}>
        ${d.config.blocos.map((bloco) => {
          const st = d.blocos.find((b) => b.id === bloco.id);
          return html`
            <section class=${`mon-bloco ${st?.status === 'NULO' ? 'is-nulo' : ''}`} key=${bloco.id}>
              <div class="mon-bloco-cab"><h3>${bloco.nome}</h3><span class="mon-muted">${st?.status === 'NULO' ? 'Bloco nulo (N/A)' : `${formatarNota(st?.pontos)} / ${formatarNota(st?.valor_efetivo)}`}</span></div>
              ${bloco.criterios.map((c) => html`
                <div class="mon-criterio" key=${c.id}>
                  <div class="mon-criterio-texto">${c.texto}<small>peso ${formatarNota(c.peso)}</small></div>
                  <span class=${`mon-resposta-chip ${CLASSE_RESP[d.respostas[c.id]] || ''}`}>${ROTULO_RESP[d.respostas[c.id]] || d.respostas[c.id]}</span>
                </div>`)}
            </section>`;
        })}
        <${Painel} titulo="Pilares (não alteram a nota)">
          <dl class="mon-dl">
            <div><dt>Conhecimento (média)</dt><dd>${formatarNota(d.pilar_conhecimento)}</dd></div>
            <div><dt>Encantamento (média)</dt><dd>${formatarNota(d.pilar_encantamento)}</dd></div>
            ${['conhecimento', 'encantamento'].flatMap((t) => Object.entries(d.pilares?.[t] || {}).map(([k, v]) => html`<div key=${t + k}><dt>${k}</dt><dd>${v}</dd></div>`))}
          </dl>
        </${Painel}>
        <${Painel} titulo="Observação e sugestão de feedback">
          <p><strong>Observação:</strong> ${d.observacao || '—'}</p>
          <p><strong>Sugestão de feedback:</strong> ${d.sugestao_feedback || '—'}</p>
        </${Painel}>
      ` : null}

      ${aba === 'linha' ? html`
        <ol class="mon-timeline">
          ${d.eventos.map((e, i) => html`
            <li key=${i}><div><strong>${e.para_rotulo}</strong>${e.automatico ? html` <span class="mon-tag">Automático</span>` : null}
              <div class="quando">${formatarDataHoraCurta(e.em)} · ${e.usuario}${e.perfil && e.perfil !== 'sistema' ? ` (${e.perfil})` : ''}${e.de ? ` · ${e.de} → ${e.para}` : ''}</div>
              ${e.observacao ? html`<div class="mon-muted">${e.observacao}</div>` : null}</div></li>`)}
        </ol>
      ` : null}

      ${aba === 'fluxo' ? html`
        ${d.feedbacks.map((f) => html`<${Painel} titulo=${`Feedback aplicado por ${f.aplicado_por}`} key=${f.id_feedback}>
          <p class="mon-muted">${formatarDataHoraCurta(f.em)} · ${f.dentro_sla === false ? 'fora do prazo' : 'dentro do prazo'}</p>
          <p><strong>Observação:</strong> ${f.observacao}</p>${f.complemento ? html`<p><strong>Complemento:</strong> ${f.complemento}</p>` : null}</${Painel}>`)}
        ${d.contestacoes.map((c) => html`<${Painel} titulo="Contestação do operador" key=${c.id_contestacao}>
          <p class="mon-muted">${formatarDataHoraCurta(c.em)}</p>
          <p><strong>Critérios:</strong> ${c.criterios.map((x) => x.texto).join('; ')}</p>
          <p><strong>Motivo:</strong> ${c.motivo}</p><p><strong>Justificativa:</strong> ${c.justificativa}</p>
          ${c.replicas.map((r, i) => html`<p key=${i}><strong>Réplica (${formatarDataHoraCurta(r.em)}):</strong> ${r.texto}</p>`)}
          ${c.anexos.length ? html`<div class="mon-acoes">${c.anexos.map((a) => html`<button key=${a.id_anexo} type="button" class="btn btn-outline-secondary btn-sm"
            onClick=${async () => baixarArquivo(await baixarEvidencia(a.id_anexo))}>${a.nome}</button>`)}</div>` : null}
          ${c.reanalise ? html`<div class="mon-alerta mon-alerta--info"><strong>Reanálise${c.reanalise.automatico ? ' automática' : ''} — ${c.reanalise.resultado === 'CONFIRMADA' ? 'avaliação mantida' : 'monitoria anulada'}</strong>
            <div>${c.reanalise.observacao}</div><small>${c.reanalise.supervisor || 'Sistema'} · ${formatarDataHoraCurta(c.reanalise.em)}</small></div>` : null}
        </${Painel}>`)}
        ${!d.feedbacks.length && !d.contestacoes.length ? html`<p class="mon-muted">Ainda não há feedback nem contestação.</p>` : null}
      ` : null}

      ${aba === 'compartilhar' ? html`
        <${Painel} titulo="Compartilhar por e-mail">
          <p class="mon-muted">Somente usuários que podem ver esta monitoria aparecem na lista. O envio é registrado no log.</p>
          ${destinatarios === null ? html`<${LoadingState} titulo="Carregando destinatários" />` : html`
            <div class="mon-acoes">${destinatarios.map((u) => html`<label key=${u.id_usuario} class="mon-tag" style=${{ cursor: 'pointer' }}>
              <input type="checkbox" checked=${selecionados.includes(u.id_usuario)} onChange=${(e) => setSelecionados((s) => e.target.checked ? [...s, u.id_usuario] : s.filter((x) => x !== u.id_usuario))} />
              ${u.nome} · ${u.perfil}</label>`)}</div>
            ${!destinatarios.length ? html`<p class="mon-muted">Nenhum usuário elegível.</p>` : null}
            <button type="button" class="btn btn-primary" disabled=${!selecionados.length || ocupado}
              onClick=${() => executar(() => compartilharMonitorias({ ids: [d.id_monitoria], destinatarios: selecionados }), 'Monitoria compartilhada por e-mail.')}>Enviar</button>`}
        </${Painel}>
      ` : null}

      ${podeFeedback ? html`
        <${Painel} titulo="Aplicar feedback (prazo de 72 horas)">
          ${d.sugestao_feedback ? html`<div class="mon-alerta mon-alerta--info"><strong>Sugestão do avaliador:</strong> ${d.sugestao_feedback}</div>` : null}
          <label>Observação do feedback aplicado (obrigatória)<textarea class="form-control" rows="3" value=${feedback.observacao} onInput=${(e) => setFeedback({ ...feedback, observacao: e.target.value })}></textarea></label>
          <label>Complemento (opcional)<textarea class="form-control" rows="2" value=${feedback.complemento} onInput=${(e) => setFeedback({ ...feedback, complemento: e.target.value })}></textarea></label>
          <button type="button" class="btn btn-primary" disabled=${ocupado || !feedback.observacao.trim()}
            onClick=${() => executar(() => aplicarFeedback(d.codigo, feedback), 'Feedback registrado. O operador tem 48 horas para se manifestar.')}>Registrar feedback aplicado</button>
        </${Painel}>` : null}

      ${podeManifestar ? html`
        <${Painel} titulo="Sua manifestação (prazo de 48 horas; sem resposta = confirmada automaticamente)">
          <div class="mon-acoes"><button type="button" class="btn btn-primary" disabled=${ocupado}
            onClick=${() => executar(() => confirmarMonitoria(d.codigo), 'Monitoria confirmada.')}>Confirmar monitoria</button></div>
          <hr />
          <strong>Ou contestar</strong>
          <label>Critério(s) contestado(s)
            <select class="form-select" multiple size="6" value=${contestacao.criterios} onChange=${(e) => setContestacao({ ...contestacao, criterios: Array.from(e.target.selectedOptions).map((o) => o.value) })}>
              ${d.config.blocos.flatMap((b) => b.criterios.map((c) => html`<option key=${c.id} value=${c.id}>${b.nome} — ${c.texto}</option>`))}
            </select></label>
          <label>Motivo<input class="form-control" value=${contestacao.motivo} maxlength="400" onInput=${(e) => setContestacao({ ...contestacao, motivo: e.target.value })} /></label>
          <label>Justificativa<textarea class="form-control" rows="4" value=${contestacao.justificativa} onInput=${(e) => setContestacao({ ...contestacao, justificativa: e.target.value })}></textarea></label>
          <button type="button" class="btn btn-outline-danger" disabled=${ocupado || !contestacao.criterios.length || !contestacao.motivo.trim() || !contestacao.justificativa.trim()}
            onClick=${() => executar(() => contestarMonitoria(d.codigo, contestacao), 'Contestação enviada ao supervisor responsável.')}>Enviar contestação</button>
        </${Painel}>` : null}

      ${podeReplicar ? html`
        <${Painel} titulo="Réplica e evidências">
          <label>Réplica<textarea class="form-control" rows="3" value=${replica} onInput=${(e) => setReplica(e.target.value)}></textarea></label>
          <button type="button" class="btn btn-outline-secondary" disabled=${ocupado || !replica.trim()}
            onClick=${() => executar(async () => { await replicarContestacao(d.codigo, replica); setReplica(''); }, 'Réplica registrada.')}>Enviar réplica</button>
          <label>Anexar evidência (PDF, DOC, DOCX, PNG ou JPG · até 10 MB · máx. 5)
            <input type="file" class="form-control" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
              onChange=${(e) => { const f = e.target.files?.[0]; if (f) executar(() => anexarEvidencia(d.codigo, f), 'Evidência anexada.'); e.target.value = ''; }} /></label>
        </${Painel}>` : null}

      ${podeReanalisar ? html`
        <${Painel} titulo="Reanálise da contestação (prazo de 72 horas; a monitoria original nunca é editada)">
          <div class="mon-acoes">
            ${[['CONFIRMADA', 'Manter avaliação'], ['ANULADA', 'Anular monitoria']].map(([v, r]) => html`<button key=${v} type="button"
              class=${`mon-subnav-btn ${reanalise.resultado === v ? 'is-active' : ''}`} onClick=${() => setReanalise({ ...reanalise, resultado: v })}>${r}</button>`)}
          </div>
          <label>Observação da reanálise (obrigatória)<textarea class="form-control" rows="3" value=${reanalise.observacao} onInput=${(e) => setReanalise({ ...reanalise, observacao: e.target.value })}></textarea></label>
          <button type="button" class="btn btn-primary" disabled=${ocupado || !reanalise.resultado || !reanalise.observacao.trim()}
            onClick=${() => executar(() => reanalisarContestacao(d.codigo, reanalise), 'Reanálise registrada.')}>Concluir reanálise</button>
        </${Painel}>` : null}

      ${pode('monitoria.plano_acao') && d.nivel && ['Desenvolvimento', 'Crítico'].includes(d.faixa?.label) ? html`
        <${Painel} titulo=${`Plano de ação (${d.faixa.label}: ${d.faixa.acao})`}>
          <div class="mon-form-grid">
            <label>Problema identificado<input class="form-control" value=${plano.problema} onInput=${(e) => setPlano({ ...plano, problema: e.target.value })} /></label>
            <label>Critério relacionado<input class="form-control" value=${plano.criterio} onInput=${(e) => setPlano({ ...plano, criterio: e.target.value })} /></label>
            <label>Objetivo<input class="form-control" value=${plano.objetivo} onInput=${(e) => setPlano({ ...plano, objetivo: e.target.value })} /></label>
            <label>Ação proposta<input class="form-control" value=${plano.acao} onInput=${(e) => setPlano({ ...plano, acao: e.target.value })} /></label>
            <label>Prazo<input class="form-control" type="date" value=${plano.prazo} onInput=${(e) => setPlano({ ...plano, prazo: e.target.value })} /></label>
          </div>
          <button type="button" class="btn btn-outline-primary" disabled=${ocupado || !plano.problema || !plano.objetivo || !plano.acao || !plano.prazo}
            onClick=${() => executar(() => criarPlano({ ...plano, id_monitoria: d.id_monitoria }), 'Plano de ação criado.')}>Criar plano de ação</button>
        </${Painel}>` : null}
    </div>
  `;
}

export function ModalDetalheMonitoria({ referencia, ...props }) {
  return html`
    <${ModalPadrao} aberto=${Boolean(referencia)} titulo="Detalhe da monitoria" onClose=${props.onClose} className="mon-modal-largo">
      ${referencia ? html`<${DetalheMonitoria} referencia=${referencia} ...${props} />` : null}
    </${ModalPadrao}>
  `;
}
