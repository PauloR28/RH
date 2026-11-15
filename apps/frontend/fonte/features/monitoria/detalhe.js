import { html, useEffect, useRef, useState } from '../../infraestrutura-react.js';
import { marcarNotificacoesEntidadeLidas } from '../../services/api/notifications.js?v=20260921-alertas';
import {
  excluirMonitoria,
  restaurarMonitoria,
  aplicarFeedback,
  anexarEvidencia,
  baixarEvidencia,
  compartilharMonitorias,
  confirmarMonitoria,
  exportarMonitorias,
  lerMonitoria,
  listarDestinatarios,
  reanalisarContestacao,
  replicarContestacao,
} from '../../services/api/monitoria.js';
import { Campo, Esqueleto, Estado, Faixa, Ic, Janela, Segmento, Selo } from '../../ui/components/ds.js?v=20261106-wfm';
import { baixarArquivo, formatarData, formatarDataHoraCurta, formatarNota } from './comum.js';
import { Gabarito, JanelaContestar, SeloSituacao } from './redesign-listas.js?v=20261108-fatia2';
import { JanelaPlano } from './redesign-feedback-planos.js?v=20261109-telas-antigas';
import { AvisoIntercorrencia } from '../../modulos/operacao/diario/ligacoes.js';

// Detalhe de UMA monitoria (redesign Fase 15, fatia 4, amostra Q1 do lote 2): painel lateral de 640 px (padrão c-diario da
// Fase 14) em todas as listas. Cabeçalho com ID + situação, linha curta operador · operação · data · avaliador e ⋯ (Exportar,
// Enviar por e-mail, Excluir); abas Resumo · Linha do tempo · Feedback e contestação; rodapé só com a ação da pessoa.
// A monitoria original nunca é editada: cada ação só acrescenta feedback, contestação, réplica, reanálise ou plano.

const pad = (n) => String(n).padStart(2, '0');
const diaMes = (iso) => { if (!iso) return '—'; const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : iso); return Number.isNaN(d.getTime()) ? '—' : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const idCurto = (codigo) => String(codigo || '').slice(-5);
const limiteDoPrazo = (sla) => (sla && sla.estado !== 'VENCIDO' && Number(sla.restante_h) > 0 ? new Date(Date.now() + Number(sla.restante_h) * 3600000) : null);
const quando = (d) => {
  if (!d) return '';
  const h = new Date(); const am = new Date(h); am.setDate(h.getDate() + 1);
  const mesmo = (a, b) => a.toDateString() === b.toDateString();
  return `${mesmo(d, h) ? 'hoje' : mesmo(d, am) ? 'amanhã' : diaMes(d.toISOString())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const ABAS = [['resumo', 'Resumo'], ['linha', 'Linha do tempo'], ['fluxo', 'Feedback e contestação']];

export function DetalheMonitoria({ referencia, controlador, contexto, onClose, onAlterou, onLida, showToast }) {
  const [d, setD] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aba, setAba] = useState('resumo');
  const [menu, setMenu] = useState(false);
  const [janela, setJanela] = useState(''); // feedback | contestar | replica | reanalise | plano | excluir | email
  const [feedback, setFeedback] = useState({ observacao: '', complemento: '' });
  const [replica, setReplica] = useState('');
  const [reanalise, setReanalise] = useState({ resultado: 'CONFIRMADA', observacao: '' });
  const [confirmarAnular, setConfirmarAnular] = useState(false);
  const [excluindo, setExcluindo] = useState({ motivo: '', confirmacao: '' });
  const [destinatarios, setDestinatarios] = useState(null);
  const [selecionados, setSelecionados] = useState([]);
  const menuRef = useRef(null);

  const perfil = controlador?.estado?.perfilUsuario;
  const pode = (p) => controlador.possuiPermissao(p);

  const carregar = async () => {
    try { setD(await lerMonitoria(referencia)); setErro(''); } catch (e) { setErro(e?.message || 'Não foi possível carregar a monitoria.'); }
  };
  useEffect(() => { setD(null); setAba('resumo'); setJanela(''); carregar(); }, [referencia]);

  // Abrir a monitoria = ciente das novidades dela: some o alerta (bolinha) ligado a ela.
  const idMonitoria = d?.id_monitoria;
  useEffect(() => {
    if (!idMonitoria) return;
    marcarNotificacoesEntidadeLidas('monitoria', idMonitoria).then((r) => { if (r?.atualizadas) onLida?.(); }).catch(() => {});
  }, [idMonitoria]);
  useEffect(() => {
    if (!menu) return undefined;
    const fora = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [menu]);

  const executar = async (acao, mensagem) => {
    setOcupado(true);
    try {
      await acao();
      showToast(mensagem, 'success');
      setJanela('');
      await carregar();
      onAlterou?.();
    } catch (e) {
      showToast(e?.message || 'Não foi possível concluir a ação.', 'danger');
    } finally { setOcupado(false); }
  };

  const cab = (titulo, sub = '', direita = null) => html`<div class="c-janela-cab">
    <h2 id="c-md-titulo">${titulo}${sub ? html`<small>${sub}</small>` : null}</h2>
    <div class="c-md-cab-dir">${direita}
      <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Fechar" title="Fechar" onClick=${onClose}><${Ic} nome="x" /></button></div>
  </div>`;
  if (erro) return html`${cab('Monitoria')}<div class="c-janela-corpo"><${Estado} titulo=${erro} rotuloAcao="Tentar de novo" aoAcao=${() => { setErro(''); carregar(); }} /></div>`;
  if (!d) return html`${cab('Monitoria')}<div class="c-janela-corpo" aria-busy="true"><${Esqueleto} linhas=${8} /></div>`;

  const podeFeedback = d.status === 'FEEDBACK_PENDENTE' && pode('monitoria.feedback_aplicar');
  const ehDono = perfil === 'operador' && pode('monitoria.contestar');
  const podeManifestar = ehDono && d.status === 'AGUARDANDO_CONFIRMACAO';
  const podeReplicar = ehDono && d.status === 'REANALISE';
  const podeReanalisar = d.status === 'REANALISE' && pode('monitoria.reanalisar');
  const podePlano = pode('monitoria.plano_acao') && d.nivel && ['Desenvolvimento', 'Crítico'].includes(d.faixa?.label);
  const podeExportar = pode('monitoria.exportar');
  const ehAdministrador = perfil === 'administrador'; // exclusão lógica: só Administrador (o backend valida de novo)

  const respostas = Object.values(d.respostas || {});
  const avaliados = respostas.filter((v) => v !== 'NA').length;
  const atendidos = respostas.filter((v) => v === 'SIM').length;
  const limite = limiteDoPrazo(d.sla);
  const vencido = d.sla?.estado === 'VENCIDO';
  const escala = d.config?.escala || { min: 1, max: 10 };
  const pct = (v) => Math.max(0, Math.min(100, ((Number(v) - escala.min) / Math.max(1, escala.max - escala.min)) * 100));
  const pilares = [
    ['Conhecimento', d.pilar_conhecimento, 'média'],
    ['Encantamento', d.pilar_encantamento, 'média'],
    ...['conhecimento', 'encantamento'].flatMap((t) => Object.entries(d.pilares?.[t] || {}).map(([n, v]) => [n, v, ''])),
  ];
  const dados = [
    ['Equipe', `${d.equipe_nome || '—'}${d.turno ? ` · ${d.turno}` : ''}`],
    ['Canal', d.canal || '—'],
    ['Tipo', d.tipo_atendimento || '—'],
    ['Contato do cliente', d.contato_cliente || d.telefone || '—'],
    ['Monitoria feita em', formatarDataHoraCurta(d.data_monitoria)],
    ['Formulário', d.numero_versao ? `v${d.numero_versao}` : '—'],
  ];
  const extras = [
    d.nome_cliente || d.cpf_cliente ? ['Cliente', `${d.nome_cliente || '—'}${d.cpf_cliente ? ` · ${d.cpf_cliente}` : ''}`] : null,
    d.id_interacao ? ['Interação', d.id_interacao] : null,
    d.data_contato ? ['Data do contato', formatarData(d.data_contato)] : null,
    (d.supervisores || []).length ? ['Supervisor', d.supervisores.map((s) => s.nome).join(', ')] : null,
  ].filter(Boolean);

  // Ação da pessoa no rodapé (sem ação, sem rodapé) e a frase curta de por que é com ela.
  const acoes = [];
  let porque = '';
  if (podeFeedback) { acoes.push(['feedback', 'Aplicar feedback', 'chat-text', true]); porque = vencido ? 'O feedback é com você · prazo vencido' : `O feedback é com você · até ${quando(limite)}`; }
  if (podeManifestar) { acoes.push(['contestar', 'Contestar', 'flag', false], ['confirmar', 'Confirmar', 'check', true]); porque = limite ? `Responda até ${quando(limite)} · depois confirma sozinha` : 'Confirme ou conteste a avaliação'; }
  if (podeReplicar) { acoes.push(['replica', 'Enviar réplica', 'chat-text', true]); porque = 'Sua contestação está em reanálise'; }
  if (podeReanalisar) { acoes.push(['reanalise', 'Reanalisar', 'scales', true]); porque = limite ? `A reanálise é com você · até ${quando(limite)}` : 'A reanálise é com você'; }
  if (podePlano) { acoes.push(['plano', 'Criar plano', 'list-checks', !acoes.length]); if (!porque) porque = `Faixa ${d.faixa.label}: ${d.faixa.acao || 'plano de ação recomendado'}`; }
  const clicarAcao = (id) => {
    if (id === 'confirmar') return executar(() => confirmarMonitoria(d.codigo), 'Você confirmou a monitoria.');
    return setJanela(id);
  };

  const exportar = async () => { setMenu(false); try { baixarArquivo(await exportarMonitorias([d.id_monitoria])); } catch (e) { showToast(e?.message || 'Não foi possível exportar.', 'danger'); } };
  const abrirEmail = async () => {
    setMenu(false);
    try { setDestinatarios((await listarDestinatarios([d.id_monitoria]))?.itens || []); setSelecionados([]); setJanela('email'); } catch (e) { showToast(e?.message || 'Não foi possível listar os destinatários.', 'danger'); }
  };
  const confirmarExclusao = async () => {
    setOcupado(true);
    try {
      await excluirMonitoria(d.codigo, excluindo.motivo.trim(), excluindo.confirmacao.trim());
      showToast(`Monitoria ${d.codigo} excluída. Ela não aparece mais em listas, painéis e indicadores.`, 'success');
      onAlterou?.(); onClose?.();
    } catch (e) { showToast(e?.message || 'Não foi possível excluir.', 'danger'); } finally { setOcupado(false); }
  };
  const itensMenu = [podeExportar ? ['Exportar (planilha)', 'download', exportar] : null, ['Enviar por e-mail', 'envelope-simple', abrirEmail]].filter(Boolean);

  const direita = html`<button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Mais ações" title="Mais ações" aria-haspopup="menu" aria-expanded=${menu ? 'true' : 'false'} onClick=${() => setMenu((v) => !v)}><${Ic} nome="dots-three" /></button>
    ${menu ? html`<div class="c-md-menu" role="menu" ref=${menuRef}>
      ${itensMenu.map(([r, i, f]) => html`<button key=${r} type="button" role="menuitem" onClick=${f}><${Ic} nome=${i} />${r}</button>`)}
      ${ehAdministrador && !d.excluida ? html`<hr /><button type="button" role="menuitem" class="c-md-perigo" onClick=${() => { setMenu(false); setExcluindo({ motivo: '', confirmacao: '' }); setJanela('excluir'); }}><${Ic} nome="trash" />Excluir</button>` : null}
    </div>` : null}`;

  const resumo = html`
    <div class="c-diario-numeros" style=${{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
      <div><small>Nota</small><b>${formatarNota(d.nota)}</b><em>${d.faixa?.label || d.nivel || 'de 100'}</em></div>
      <div><small>Critérios atendidos</small><b>${atendidos} de ${avaliados}</b><em>${d.blocos_nulos ? `${d.blocos_nulos} bloco(s) nulo(s)` : 'avaliados'}</em></div>
      <div><small>Próximo prazo</small><b class=${vencido ? 'c-prazo--perigo' : limite ? 'c-prazo--atencao' : ''}>${vencido ? 'Venceu' : limite ? `${pad(limite.getHours())}:${pad(limite.getMinutes())}` : '—'}</b><em>${vencido ? `há ${Math.round(Number(d.sla.atraso_h || 0))} h` : limite ? quando(limite).split(' ')[0] : 'sem prazo aberto'}</em></div>
    </div>
    ${d.possui_ncg ? html`<${Faixa} tom="perigo" icone="warning"><b>NCG:</b> ${d.motivo_ncg || 'erro crítico de negócio'}<//>` : null}
    ${d.anulada ? html`<${Faixa} tom="atencao" icone="prohibit"><b>Anulada (menos de 3 blocos):</b> ${d.justificativa_anulacao || ''}<//>` : null}
    <dl class="c-md-dados">${dados.map(([r, v]) => html`<div key=${r}><dt>${r}</dt><dd title=${v}>${v}</dd></div>`)}</dl>
    ${extras.length ? html`<dl class="c-md-dados">${extras.map(([r, v]) => html`<div key=${r}><dt>${r}</dt><dd title=${v}>${v}</dd></div>`)}</dl>` : null}
    ${pilares.some(([, v]) => v != null) ? html`<div><h3>Pilares <small>não alteram a nota · escala de ${escala.min} a ${escala.max}</small></h3>
      <div class="c-md-pilares">${pilares.map(([nome, valor, sub]) => html`<div key=${nome}><span>${nome}${sub ? html` <small>${sub}</small>` : null}</span>
        <span class="c-md-barra" role="img" aria-label=${`${nome}: ${valor == null ? 'sem valor' : formatarNota(valor)}`}><i style=${{ width: `${valor == null ? 0 : pct(valor)}%` }}></i></span><b>${valor == null ? '—' : formatarNota(valor)}</b></div>`)}</div></div>` : null}
    <div><h3>Gabarito</h3><${Gabarito} d=${d} /></div>
    ${d.observacao ? html`<div class="c-feedback"><h3>Observação do avaliador</h3><p>${d.observacao}</p></div>` : null}
    ${d.sugestao_feedback ? html`<div class="c-feedback"><h3>Sugestão do avaliador</h3><p>${d.sugestao_feedback}</p></div>` : null}`;

  const linha = html`<ol class="c-md-linha">${(d.eventos || []).map((e, i) => html`<li key=${i}><span class="c-md-quando">${formatarDataHoraCurta(e.em)}</span>
    <div><b>${e.para_rotulo}</b>${e.automatico ? html` <${Selo} tom="neutro">Automático<//>` : null} · ${e.usuario}${e.perfil && e.perfil !== 'sistema' ? ` (${e.perfil})` : ''}
      ${e.observacao ? html`<p>${e.observacao}</p>` : null}</div></li>`)}
    ${!d.eventos?.length ? html`<li><span class="c-md-quando">—</span><div>Sem eventos.</div></li>` : null}
    ${limite ? html`<li class="c-md-proximo"><span class="c-md-quando">${quando(limite)}</span><div><b>Próximo prazo</b><p>${d.status === 'FEEDBACK_PENDENTE' ? 'Feedback' : d.status === 'AGUARDANDO_CONFIRMACAO' ? 'Confirmação automática' : d.status === 'REANALISE' ? 'Anulação automática se ninguém decidir' : 'Prazo do fluxo'}</p></div></li>` : null}
  </ol>`;

  const fluxo = html`
    <div><h3>Feedback</h3>
      ${(d.feedbacks || []).length ? html`<ol class="c-md-linha">${d.feedbacks.map((f) => html`<li key=${f.id_feedback}><span class="c-md-quando">${formatarDataHoraCurta(f.em)}</span>
        <div><b>${f.aplicado_por}</b> · ${f.dentro_sla === false ? html`<span class="c-tom-perigo">fora do prazo</span>` : 'dentro do prazo'}<p>${f.observacao}</p>${f.complemento ? html`<p>${f.complemento}</p>` : null}</div></li>`)}</ol>`
        : html`<p class="c-ajuda" style=${{ margin: 0 }}>Ainda não há feedback.${d.sugestao_feedback ? ` Sugestão do avaliador: ${d.sugestao_feedback}` : ''}</p>`}
    </div>
    <div><h3>Contestação</h3>
      ${(d.contestacoes || []).length ? d.contestacoes.map((c) => html`<div key=${c.id_contestacao} class="c-feedback" style=${{ marginBottom: 'var(--espaco-2)' }}>
        <p><b>Contestação do operador</b> · ${formatarDataHoraCurta(c.em)}</p>
        <p><b>Critérios:</b> ${c.criterios.map((x) => x.texto).join('; ')}</p>
        <p><b>Motivo:</b> ${c.motivo}</p><p><b>Justificativa:</b> ${c.justificativa}</p>
        ${(c.replicas || []).map((r, i) => html`<p key=${i}><b>Réplica (${formatarDataHoraCurta(r.em)}):</b> ${r.texto}</p>`)}
        ${(c.anexos || []).length ? html`<p class="c-grupo">${c.anexos.map((a) => html`<button key=${a.id_anexo} type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${async () => { try { baixarArquivo(await baixarEvidencia(a.id_anexo)); } catch (err) { showToast(err?.message || 'Não foi possível baixar.', 'danger'); } }}><${Ic} nome="paperclip" />${a.nome}</button>`)}</p>` : null}
        ${c.reanalise ? html`<p><b>Reanálise${c.reanalise.automatico ? ' automática' : ''}: ${c.reanalise.resultado === 'CONFIRMADA' ? 'avaliação mantida' : 'monitoria anulada'}</b> · ${c.reanalise.supervisor || 'Sistema'} · ${formatarDataHoraCurta(c.reanalise.em)}</p><p>${c.reanalise.observacao}</p>` : null}
      </div>`) : html`<p class="c-ajuda" style=${{ margin: 0 }}>Sem contestação.</p>`}
    </div>`;

  return html`
    ${cab(html`ID ${idCurto(d.codigo)} <${SeloSituacao} item=${d} perfil=${perfil} />`, `${d.operador_nome || '—'} · ${d.operacao_nome || d.operacao} · ${diaMes(d.data_monitoria)} · avaliada por ${d.avaliador_nome || '—'}`, direita)}
    <div class="c-janela-corpo">
      ${d.excluida ? html`<${Faixa} tom="perigo" icone="trash" acao=${ehAdministrador ? html`<button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${ocupado || null} onClick=${() => executar(() => restaurarMonitoria(d.id_monitoria), 'Monitoria restaurada.')}>Restaurar</button>` : null}>
        <b>Monitoria excluída</b> por ${d.excluida.por} em ${formatarDataHoraCurta(d.excluida.em)}. Motivo: ${d.excluida.motivo}. Ela não aparece em listas, painéis nem indicadores.<//>` : null}
      <div class="c-md-abas"><${Segmento} rotulo="Seções do detalhe" valor=${aba} aoMudar=${setAba} opcoes=${ABAS} /></div>
      ${aba === 'resumo' ? resumo : aba === 'linha' ? linha : fluxo}
    </div>
    ${acoes.length ? html`<div class="c-janela-rodape">
      <span class="c-md-rodape-txt">${porque}</span>
      ${acoes.map(([id, rotulo, icone, principal]) => html`<button key=${id} type="button" class=${`c-botao ${principal ? 'c-botao--principal' : 'c-botao--secundario'}`} aria-busy=${ocupado && id === 'confirmar' ? 'true' : null} disabled=${ocupado || null} onClick=${() => clicarAcao(id)}><${Ic} nome=${icone} />${rotulo}</button>`)}
    </div>` : null}

    ${janela === 'feedback' ? html`<${Janela} titulo="Aplicar feedback" onClose=${() => setJanela('')}
      rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => setJanela('')}>Cancelar</button>
        <button type="button" class="c-botao c-botao--principal" aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || !feedback.observacao.trim() || null} onClick=${() => executar(() => aplicarFeedback(d.codigo, feedback), 'Feedback registrado. O operador tem 48 horas para se manifestar.')}>Registrar feedback</button>`}>
      <div class="c-janela-corpo">
        ${d.sugestao_feedback ? html`<div class="c-feedback"><h3>Sugestão do avaliador</h3><p>${d.sugestao_feedback}</p></div>` : null}
        <${Campo} rotulo="O que foi conversado" ajuda="Obrigatório. O operador lê este texto."><textarea class="c-entrada" rows="3" value=${feedback.observacao} onInput=${(e) => setFeedback({ ...feedback, observacao: e.target.value })}></textarea><//>
        <${Campo} rotulo="Complemento" opcional=${true}><textarea class="c-entrada" rows="2" value=${feedback.complemento} onInput=${(e) => setFeedback({ ...feedback, complemento: e.target.value })}></textarea><//>
      </div>
    <//>` : null}

    ${janela === 'contestar' ? html`<${JanelaContestar} d=${d} showToast=${showToast} onClose=${() => setJanela('')} onEnviado=${async () => { setJanela(''); await carregar(); onAlterou?.(); }} />` : null}

    ${janela === 'replica' ? html`<${Janela} titulo="Réplica e evidências" onClose=${() => setJanela('')}
      rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => setJanela('')}>Fechar</button>
        <button type="button" class="c-botao c-botao--principal" aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || !replica.trim() || null} onClick=${() => executar(async () => { await replicarContestacao(d.codigo, replica); setReplica(''); }, 'Réplica registrada.')}>Enviar réplica</button>`}>
      <div class="c-janela-corpo">
        <${Campo} rotulo="Réplica"><textarea class="c-entrada" rows="3" value=${replica} onInput=${(e) => setReplica(e.target.value)}></textarea><//>
        <${Campo} rotulo="Anexar evidência" opcional=${true} ajuda="PDF, DOC, DOCX, PNG ou JPG · até 10 MB · no máximo 5"><input type="file" class="c-entrada" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
          onChange=${(e) => { const f = e.target.files?.[0]; if (f) executar(() => anexarEvidencia(d.codigo, f), 'Evidência anexada.'); e.target.value = ''; }} /><//>
      </div>
    <//>` : null}

    ${janela === 'reanalise' ? html`<${Janela} titulo=${`Reanalisar · ${idCurto(d.codigo)}`} onClose=${() => setJanela('')}
      rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => setJanela('')}>Cancelar</button>
        <button type="button" class="c-botao c-botao--principal" aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || !reanalise.observacao.trim() || null}
          onClick=${() => (reanalise.resultado === 'ANULADA' ? setConfirmarAnular(true) : executar(() => reanalisarContestacao(d.codigo, reanalise), 'Nota mantida. O operador foi avisado.'))}>Enviar decisão</button>`}>
      <div class="c-janela-corpo">
        <${AvisoIntercorrencia} controlador=${controlador} operacao=${d.operacao} momento=${String(d.data_contato || '').slice(0, 10)} />
        <div class="c-campo"><span class="c-rotulo">Decisão</span><${Segmento} rotulo="Decisão" valor=${reanalise.resultado} aoMudar=${(v) => setReanalise({ ...reanalise, resultado: v })} opcoes=${[['CONFIRMADA', 'Manter a nota'], ['ANULADA', 'Anular a monitoria']]} /></div>
        <${Campo} rotulo="Explique a decisão" ajuda="O operador vai ler este texto."><textarea class="c-entrada" rows="3" value=${reanalise.observacao} onInput=${(e) => setReanalise({ ...reanalise, observacao: e.target.value })}></textarea><//>
      </div>
    <//>` : null}
    ${confirmarAnular ? html`<${Janela} titulo="Anular a monitoria?" tamanho="pequena" onClose=${() => setConfirmarAnular(false)}
      rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => setConfirmarAnular(false)}>Cancelar</button>
        <button type="button" class="c-botao c-botao--perigo" aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || null} onClick=${async () => { await executar(() => reanalisarContestacao(d.codigo, reanalise), 'Monitoria anulada. O operador foi avisado.'); setConfirmarAnular(false); }}>Anular</button>`}>
      <div class="c-janela-corpo"><p><b>${d.operador_nome}</b> · nota <b>${formatarNota(d.nota)}</b>. A monitoria sai dos indicadores. Isso não pode ser desfeito.</p></div>
    <//>` : null}

    ${janela === 'plano' ? html`<${JanelaPlano} contexto=${contexto} monitoria=${d} showToast=${showToast} onClose=${() => setJanela('')} onCriado=${async () => { setJanela(''); await carregar(); onAlterou?.(); }} />` : null}

    ${janela === 'excluir' ? html`<${Janela} titulo="Excluir monitoria" tamanho="pequena" onClose=${() => !ocupado && setJanela('')}
      rodape=${html`<button type="button" class="c-botao c-botao--secundario" disabled=${ocupado || null} onClick=${() => setJanela('')}>Cancelar</button>
        <button type="button" class="c-botao c-botao--perigo" aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || excluindo.motivo.trim().length < 5 || excluindo.confirmacao.trim() !== d.codigo || null} onClick=${confirmarExclusao}>${ocupado ? 'Excluindo…' : 'Excluir'}</button>`}>
      <div class="c-janela-corpo">
        <p>A monitoria sai de listas, painéis, indicadores e do fluxo de feedback e contestação. Fica no log com o motivo; só o Administrador restaura.</p>
        <${Campo} rotulo="Motivo" ajuda="Mínimo de 5 letras."><input class="c-entrada" maxlength="400" value=${excluindo.motivo} onInput=${(e) => setExcluindo({ ...excluindo, motivo: e.target.value })} /><//>
        <${Campo} rotulo=${`Digite o ID da monitoria (${d.codigo}) para confirmar`}><input class="c-entrada" inputmode="numeric" maxlength="8" value=${excluindo.confirmacao} onInput=${(e) => setExcluindo({ ...excluindo, confirmacao: e.target.value })} /><//>
      </div>
    <//>` : null}

    ${janela === 'email' ? html`<${Janela} titulo="Enviar por e-mail" onClose=${() => setJanela('')}
      rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => setJanela('')}>Cancelar</button>
        <button type="button" class="c-botao c-botao--principal" aria-busy=${ocupado ? 'true' : null} disabled=${!selecionados.length || ocupado || null} onClick=${() => executar(() => compartilharMonitorias({ ids: [d.id_monitoria], destinatarios: selecionados }), 'Monitoria enviada por e-mail.')}>Enviar</button>`}>
      <div class="c-janela-corpo">
        <p class="c-ajuda" style=${{ margin: 0 }}>Só aparece quem pode ver esta monitoria. O envio fica registrado no log.</p>
        ${destinatarios === null ? html`<${Esqueleto} linhas=${3} />` : destinatarios.length ? html`<div class="c-lote-lista">${destinatarios.map((u) => html`<label key=${u.id_usuario} class="c-marcar">
          <input type="checkbox" checked=${selecionados.includes(u.id_usuario)} onChange=${(e) => setSelecionados((s) => (e.target.checked ? [...s, u.id_usuario] : s.filter((x) => x !== u.id_usuario)))} /><span>${u.nome} <span class="c-secundario">· ${u.perfil}</span></span></label>`)}</div>`
          : html`<p class="c-ajuda">Nenhum usuário elegível.</p>`}
      </div>
    <//>` : null}`;
}

// Painel lateral do Detalhe (640 px), por cima da lista de origem. Esc fecha (quando não há janela aberta por cima),
// o foco entra no painel ao abrir e volta à linha de origem ao fechar.
export function ModalDetalheMonitoria({ referencia, ...props }) {
  const aberto = Boolean(referencia);
  const painelRef = useRef(null);
  const origemRef = useRef(null);
  const origemIdRef = useRef('');
  const aoFecharRef = useRef(props.onClose);
  aoFecharRef.current = props.onClose;

  useEffect(() => {
    if (!aberto) return undefined;
    origemRef.current = document.activeElement;
    origemIdRef.current = document.activeElement?.getAttribute?.('data-mon-id') || '';
    painelRef.current?.focus();
    const aoTeclar = (ev) => { if (ev.key === 'Escape' && !document.querySelector('.c-fundo-janela')) { ev.stopPropagation(); aoFecharRef.current?.(); } };
    document.addEventListener('keydown', aoTeclar, true);
    return () => {
      document.removeEventListener('keydown', aoTeclar, true);
      const origem = origemRef.current;
      if (origem && typeof origem.focus === 'function' && document.contains(origem)) origem.focus();
      else if (origemIdRef.current) window.setTimeout(() => document.querySelector(`[data-mon-id="${origemIdRef.current}"]`)?.focus(), 400);
    };
  }, [aberto]);

  if (!aberto) return null;
  return html`<aside ref=${painelRef} tabIndex="-1" class="c-painel-lateral c-diario c-md c-ds" role="dialog" aria-modal="false" aria-labelledby="c-md-titulo">
    <${DetalheMonitoria} referencia=${referencia} ...${props} />
  </aside>`;
}
