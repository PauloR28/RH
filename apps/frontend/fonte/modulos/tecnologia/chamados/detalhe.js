import { html, useCallback, useEffect, useRef, useState } from '../../../infraestrutura-react.js';
import { LoadingState, ModalPadrao } from '../../../ui/componentes-compartilhados.js';
import { obterRotaAtual } from '../../../rotas.js';
import {
  assumirChamado, atribuirChamado, baixarAnexoChamado, buscarAtendentesChamado, cancelarChamado, confirmarEncerramentoChamado,
  enviarMensagemChamado, excluirAnexoChamado, lerChamado, listarEventosChamado, mudarStatusChamado, mudarUrgenciaChamado, reabrirChamado,
} from '../../../services/api/chamados.js';
import {
  AcessoRestrito, Avatar, EstadoErro, Icone, MenuCompartilhar, ORDEM_URGENCIA, Pill, PillSla, PillStatus, PillUrgencia, ROTULO_STATUS,
  ROTULO_URGENCIA, TELA_LISTA, descreverSla, formatarDataCompleta, formatarDataHora, tamanhoLegivel, useDebounce,
} from './comum.js';

// Detalhe do chamado (rota própria /suporte-ti/chamado/:id): cabeçalho, timeline única, anexos, dados e painel de ações.
// O painel só mostra o que a pessoa pode fazer agora (`acoes` vem do servidor); cada ação é validada de novo no backend.

export const idChamadoDaRota = () => {
  const m = String(obterRotaAtual() || '').match(/suporte-ti\/chamado\/(\d+)/);
  return m ? Number(m[1]) : 0;
};

const ABAS = [{ id: 'timeline', rotulo: 'Timeline' }, { id: 'anexos', rotulo: 'Anexos' }, { id: 'dados', rotulo: 'Dados' }];

function baixar({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'arquivo';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function EventoLinha({ evento, aoBaixar }) {
  const sistema = evento.tipo !== 'mensagem';
  return html`
    <div class=${`chm-ev ${sistema ? 'is-sistema' : ''}`.trim()}>
      <span class="chm-ev-ponto">${sistema ? html`<${Icone} nome=${evento.tipo === 'status' ? 'task_alt' : evento.tipo === 'anexo' ? 'attach_file' : 'build'} />` : html`<${Avatar} nome=${evento.autor_nome} />`}</span>
      <div class="chm-ev-corpo">
        ${sistema
          ? html`<p class="chm-ev-sistema">${textoSistema(evento)} <span class="chm-muted">· ${formatarDataHora(evento.criado_em)}</span></p>`
          : html`<div class="chm-ev-cab"><b>${evento.autor_nome}</b><span class="chm-muted">${formatarDataHora(evento.criado_em)}</span></div>
              <div class="chm-balao">${evento.conteudo}</div>`}
        ${evento.anexos?.length ? html`<div class="chm-ev-anexos">${evento.anexos.map((a) => html`
          <button type="button" class="chm-anexo-chip" key=${a.id} onClick=${() => aoBaixar(a)}><${Icone} nome="attach_file" />${a.nome}</button>`)}</div>` : null}
      </div>
    </div>`;
}

function textoSistema(evento) {
  const d = evento.dados || {};
  if (evento.tipo === 'status' && d.para) {
    const base = `${evento.autor_nome === 'Sistema' ? '' : `${evento.autor_nome}: `}status alterado para ${ROTULO_STATUS[d.para] || d.para}`;
    return evento.conteudo ? `${base}. ${evento.conteudo}` : base;
  }
  return evento.conteudo || '';
}

export function DetalheChamado({ controlador, showToast }) {
  const id = idChamadoDaRota();
  const [chamado, setChamado] = useState(null);
  const [erro, setErro] = useState('');
  const [aba, setAba] = useState('timeline');
  const [eventos, setEventos] = useState([]);
  const [temMais, setTemMais] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [mensagem, setMensagem] = useState('');
  const [arquivos, setArquivos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [modal, setModal] = useState('');
  const fimTimeline = useRef(null);
  const entradaArquivo = useRef(null);

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const [c, e] = await Promise.all([lerChamado(id), listarEventosChamado(id, { limite: 50 })]);
      setChamado(c);
      setEventos(e.eventos || []);
      setTemMais(Boolean(e.tem_mais));
      setCursor(e.proximo_cursor);
    } catch (ex) {
      setErro(ex?.message || 'Não foi possível carregar o chamado.');
    }
  }, [id]);
  useEffect(() => { if (id) carregar(); }, [id, carregar]);
  useEffect(() => { fimTimeline.current?.scrollIntoView?.({ block: 'nearest' }); }, [eventos.length]);

  const executar = async (acao, sucesso) => {
    try {
      await acao();
      if (sucesso) showToast(sucesso, 'success');
      setModal('');
      await carregar();
    } catch (ex) {
      showToast(ex?.message || 'Não foi possível concluir a ação.', 'error');
    }
  };

  const maisAntigos = async () => {
    const e = await listarEventosChamado(id, { limite: 50, antes_de: cursor });
    setEventos((atual) => [...(e.eventos || []), ...atual]);
    setTemMais(Boolean(e.tem_mais));
    setCursor(e.proximo_cursor);
  };

  const enviar = async () => {
    if (enviando || (!mensagem.trim() && !arquivos.length)) return;
    setEnviando(true);
    try {
      await enviarMensagemChamado(id, mensagem.trim(), arquivos);
      setMensagem('');
      setArquivos([]);
      await carregar();
    } catch (ex) {
      showToast(ex?.message || 'Não foi possível enviar a mensagem.', 'error');
    } finally {
      setEnviando(false);
    }
  };

  const abrirAnexo = async (anexo) => {
    try {
      baixar(await baixarAnexoChamado(anexo.id));
    } catch (ex) {
      showToast(ex?.message || 'Não foi possível baixar o arquivo.', 'error');
    }
  };

  if (!id) return html`<${EstadoErro} erro="Chamado não encontrado." />`;
  if (erro) {
    if (/permiss/i.test(erro)) return html`<${AcessoRestrito} controlador=${controlador} />`;
    return html`<${EstadoErro} erro=${erro} aoTentar=${carregar} />`;
  }
  if (!chamado) return html`<${LoadingState} titulo="Carregando chamado" />`;

  const acoes = chamado.acoes || {};
  const sla = descreverSla(chamado);
  const temAcoesTi = acoes.assumir || acoes.atribuir || acoes.mudar_status?.length || acoes.alterar_urgencia;
  const validacao = acoes.confirmar_encerramento || acoes.reabrir || acoes.cancelar;

  return html`
    <div class="chm-pagina">
      <div class="chm-cab-detalhe">
        <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => controlador.irParaTelaProtegida(TELA_LISTA)}><${Icone} nome="arrow_back" />Voltar</button>
        <h2 class="chm-titulo-detalhe"><span class="chm-muted">#${chamado.numero}</span> ${chamado.titulo}</h2>
        <${PillUrgencia} urgencia=${chamado.urgencia} /><${PillStatus} status=${chamado.status} />
        <${MenuCompartilhar} chamado=${chamado} showToast=${showToast} />
      </div>

      <div class="chm-detalhe">
        <div class="chm-coluna">
          <section class="chm-card chm-meta">
            <div><small><${Icone} nome="schedule" />Prazo (SLA)</small>
              ${sla ? html`<b>${formatarDataCompleta(chamado.prazo_sla)}</b><${Pill} tom=${sla.tom}>${sla.texto}</${Pill}>` : html`<b>${chamado.resolvido_em ? 'Atendido' : '—'}</b>`}</div>
            <div><small><${Icone} nome="apartment" />Operação · PA</small><b>${chamado.operacao}${chamado.pa_posto ? ` · ${chamado.pa_posto}` : ''}</b>${chamado.pa_parada ? html`<${Pill} tom="bad">PA parada</${Pill}>` : null}</div>
            <div><small><${Icone} nome="build" />Responsável</small><b>${chamado.responsavel?.nome || 'Sem responsável'}</b></div>
            <div><small><${Icone} nome="person" />Solicitante</small><b>${chamado.solicitante.nome}</b></div>
          </section>

          <section class="chm-card chm-card--tabela">
            <div class="chm-abas" role="tablist">
              ${ABAS.map((a) => html`<button type="button" role="tab" key=${a.id} aria-selected=${aba === a.id} class=${aba === a.id ? 'is-on' : ''} onClick=${() => setAba(a.id)}>
                ${a.rotulo}${a.id === 'anexos' && chamado.anexos.length ? html` <span class="chm-cnt">${chamado.anexos.length}</span>` : null}</button>`)}
            </div>

            ${aba === 'timeline' ? html`
              <div class="chm-timeline">
                ${temMais ? html`<button type="button" class="btn btn-sm btn-outline-secondary chm-mais" onClick=${maisAntigos}>Ver mensagens anteriores</button>` : null}
                ${eventos.map((e) => html`<${EventoLinha} key=${e.id} evento=${e} aoBaixar=${abrirAnexo} />`)}
                <span ref=${fimTimeline}></span>
              </div>
              ${acoes.comentar ? html`
                <div class="chm-composer">
                  <div class="chm-composer-campo">
                    <textarea rows="2" class="chm-input chm-input--area" value=${mensagem} placeholder="Escreva uma mensagem" aria-label="Mensagem"
                      onInput=${(e) => setMensagem(e.target.value)}
                      onKeyDown=${(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) enviar(); }}></textarea>
                    ${arquivos.length ? html`<div class="chm-chips">${arquivos.map((a, i) => html`<span class="chm-chip" key=${i}>${a.name}
                      <button type="button" aria-label="Remover" onClick=${() => setArquivos(arquivos.filter((_, j) => j !== i))}><${Icone} nome="close" /></button></span>`)}</div>` : null}
                  </div>
                  <input ref=${entradaArquivo} type="file" multiple hidden onChange=${(e) => { setArquivos([...arquivos, ...Array.from(e.target.files || [])].slice(0, 10)); e.target.value = ''; }} />
                  <button type="button" class="btn btn-outline-secondary chm-btn-icone" aria-label="Anexar arquivo" onClick=${() => entradaArquivo.current?.click()}><${Icone} nome="attach_file" /></button>
                  <button type="button" class="btn btn-primary" disabled=${enviando || (!mensagem.trim() && !arquivos.length)} onClick=${enviar}><${Icone} nome="send" />${enviando ? 'Enviando…' : 'Enviar'}</button>
                </div>` : html`<p class="chm-composer-fim">Este chamado foi ${chamado.status === 'cancelado' ? 'cancelado' : 'encerrado'}: não recebe mais mensagens.</p>`}` : null}

            ${aba === 'anexos' ? html`
              <div class="chm-lista-anexos">
                ${!chamado.anexos.length ? html`<p class="chm-vazio">Nenhum anexo neste chamado.</p>` : null}
                ${chamado.anexos.map((a) => html`
                  <div class="chm-anexo-linha" key=${a.id}>
                    <span class="chm-anexo-icone"><${Icone} nome=${a.mime.startsWith('image/') ? 'image' : 'description'} /></span>
                    <div class="chm-anexo-info"><b class="chm-trunca">${a.nome}</b><small>${tamanhoLegivel(a.tamanho)} · ${formatarDataHora(a.criado_em)}</small></div>
                    <button type="button" class="btn btn-sm btn-outline-secondary" onClick=${() => abrirAnexo(a)}><${Icone} nome="download" />Baixar</button>
                    ${acoes.excluir_anexo ? html`<button type="button" class="btn btn-sm btn-outline-danger" aria-label=${`Remover ${a.nome}`}
                      onClick=${() => executar(() => excluirAnexoChamado(a.id), 'Anexo removido.')}><${Icone} nome="close" /></button>` : null}
                  </div>`)}
              </div>` : null}

            ${aba === 'dados' ? html`
              <dl class="chm-dados">
                <div class="chm-dados-cheio"><dt>Descrição</dt><dd class="chm-pre">${chamado.descricao}</dd></div>
                <div><dt>Categoria</dt><dd>${chamado.categoria}</dd></div>
                <div><dt>Tipo de impacto</dt><dd>${chamado.tipo_impacto === 'celula' ? 'Célula / operação inteira' : 'Agente(s)'}</dd></div>
                <div><dt>Urgência</dt><dd>${ROTULO_URGENCIA[chamado.urgencia]}${chamado.urgencia_solicitada !== chamado.urgencia ? html` <span class="chm-muted">(solicitada: ${ROTULO_URGENCIA[chamado.urgencia_solicitada]})</span>` : ''}</dd></div>
                <div><dt>Aberto em</dt><dd>${formatarDataCompleta(chamado.criado_em)}</dd></div>
                <div class="chm-dados-cheio"><dt>Agentes impactados</dt><dd>${chamado.agentes.length ? chamado.agentes.map((a) => html`<span class="chm-chip chm-chip--ro" key=${a.id}>${a.nome}</span>`) : '—'}</dd></div>
                <div><dt>Solicitante</dt><dd>${chamado.solicitante.nome}<br /><span class="chm-muted">${chamado.solicitante.email || ''}${chamado.solicitante.cargo ? ` · ${chamado.solicitante.cargo}` : ''}</span></dd></div>
                ${chamado.encerrado_em ? html`<div><dt>Encerrado em</dt><dd>${formatarDataCompleta(chamado.encerrado_em)}${chamado.encerramento_automatico ? ' (automático)' : ''}</dd></div>` : null}
              </dl>` : null}
          </section>
        </div>

        <aside class="chm-lateral">
          ${validacao ? html`
            <section class="chm-card chm-card--lado">
              <h3>${acoes.cancelar && !acoes.confirmar_encerramento ? 'Seu chamado' : 'Validação'}</h3>
              ${acoes.confirmar_encerramento ? html`
                <p>O suporte marcou como resolvido. Confirme se o problema foi solucionado.</p>
                <button type="button" class="btn btn-primary" onClick=${() => executar(() => confirmarEncerramentoChamado(id), 'Chamado encerrado.')}><${Icone} nome="check_circle" />Confirmar encerramento</button>
                <button type="button" class="btn btn-outline-danger" onClick=${() => setModal('reabrir')}>Reabrir chamado</button>` : null}
              ${acoes.cancelar ? html`<p>Ainda não foi atendido. Você pode cancelar enquanto estiver aberto.</p>
                <button type="button" class="btn btn-outline-danger" onClick=${() => setModal('cancelar')}>Cancelar chamado</button>` : null}
            </section>` : null}

          ${sla ? html`<section class="chm-card chm-card--lado"><h3>Prazo</h3><div class="chm-sla-linha"><${Icone} nome=${sla.icone} /><${PillSla} item=${chamado} /></div>
            ${chamado.sla_pausado_seg ? html`<small class="chm-muted">Tempo pausado aguardando o solicitante já é descontado do prazo.</small>` : null}</section>` : null}

          ${temAcoesTi ? html`
            <section class="chm-card chm-card--lado">
              <h3>Ações da TI</h3>
              ${acoes.assumir ? html`<button type="button" class="btn btn-primary" onClick=${() => executar(() => assumirChamado(id), 'Você assumiu o chamado.')}>Assumir</button>` : null}
              ${acoes.atribuir ? html`<button type="button" class="btn btn-outline-secondary" onClick=${() => setModal('atribuir')}>Atribuir</button>` : null}
              ${acoes.mudar_status?.length ? html`<button type="button" class="btn btn-outline-secondary" onClick=${() => setModal('status')}>Mudar status</button>` : null}
              ${acoes.alterar_urgencia ? html`<button type="button" class="btn btn-outline-secondary" onClick=${() => setModal('urgencia')}>Alterar urgência</button>` : null}
            </section>` : null}
        </aside>
      </div>

      <${ModalMotivo} aberto=${modal === 'reabrir'} titulo="Reabrir chamado" rotulo="Motivo da reabertura (obrigatório)" obrigatorio=${true} confirmar="Reabrir"
        aoFechar=${() => setModal('')} aoConfirmar=${(motivo) => executar(() => reabrirChamado(id, motivo), 'Chamado reaberto.')} />
      <${ModalMotivo} aberto=${modal === 'cancelar'} titulo="Cancelar chamado" rotulo="Motivo (opcional)" obrigatorio=${false} confirmar="Cancelar chamado"
        aoFechar=${() => setModal('')} aoConfirmar=${(motivo) => executar(() => cancelarChamado(id, motivo), 'Chamado cancelado.')} />
      <${ModalStatus} aberto=${modal === 'status'} destinos=${acoes.mudar_status || []} aoFechar=${() => setModal('')}
        aoConfirmar=${(status, just) => executar(() => mudarStatusChamado(id, status, just), 'Status atualizado.')} />
      <${ModalUrgencia} aberto=${modal === 'urgencia'} chamado=${chamado} aoFechar=${() => setModal('')}
        aoConfirmar=${(urg, just) => executar(() => mudarUrgenciaChamado(id, urg, just), 'Urgência atualizada.')} />
      <${ModalAtribuir} aberto=${modal === 'atribuir'} aoFechar=${() => setModal('')}
        aoConfirmar=${(resp) => executar(() => atribuirChamado(id, resp), 'Chamado atribuído.')} />
    </div>`;
}

function RodapeModal({ aoFechar, aoConfirmar, rotulo = 'Confirmar', desabilitado = false }) {
  return html`<footer class="rh-modal-footer"><div class="rh-modal-footer-actions">
    <button type="button" class="btn btn-outline-secondary" onClick=${aoFechar}>Fechar</button>
    <button type="button" class="btn btn-primary" disabled=${desabilitado} onClick=${aoConfirmar}>${rotulo}</button>
  </div></footer>`;
}

function ModalMotivo({ aberto, titulo, rotulo, obrigatorio, confirmar, aoFechar, aoConfirmar }) {
  const [motivo, setMotivo] = useState('');
  useEffect(() => { if (aberto) setMotivo(''); }, [aberto]);
  return html`
    <${ModalPadrao} aberto=${aberto} titulo=${titulo} onClose=${aoFechar}>
      <div class="rh-details-body"><label class="chm-campo"><span>${rotulo}</span>
        <textarea class="chm-input chm-input--area" rows="3" maxlength="1000" value=${motivo} onInput=${(e) => setMotivo(e.target.value)}></textarea></label></div>
      <${RodapeModal} aoFechar=${aoFechar} rotulo=${confirmar} desabilitado=${obrigatorio && !motivo.trim()} aoConfirmar=${() => aoConfirmar(motivo.trim())} />
    </${ModalPadrao}>`;
}

function ModalStatus({ aberto, destinos, aoFechar, aoConfirmar }) {
  const [status, setStatus] = useState('');
  const [just, setJust] = useState('');
  useEffect(() => { if (aberto) { setStatus(destinos[0] || ''); setJust(''); } }, [aberto]);
  return html`
    <${ModalPadrao} aberto=${aberto} titulo="Mudar status" onClose=${aoFechar}>
      <div class="rh-details-body">
        <div class="chm-opcoes chm-opcoes--coluna" role="radiogroup">${destinos.map((d) => html`
          <button type="button" role="radio" key=${d} aria-checked=${status === d} class=${status === d ? 'is-on' : ''} onClick=${() => setStatus(d)}>${ROTULO_STATUS[d]}</button>`)}</div>
        <label class="chm-campo"><span>${status === 'aguardando_solicitante' ? 'O que você precisa do solicitante?' : 'Observação (opcional)'}</span>
          <textarea class="chm-input chm-input--area" rows="3" maxlength="1000" value=${just} onInput=${(e) => setJust(e.target.value)}></textarea></label>
        ${status === 'aguardando_solicitante' ? html`<p class="chm-dica"><${Icone} nome="info" />O prazo (SLA) fica pausado até o solicitante responder.</p>` : null}
      </div>
      <${RodapeModal} aoFechar=${aoFechar} desabilitado=${!status} aoConfirmar=${() => aoConfirmar(status, just.trim())} />
    </${ModalPadrao}>`;
}

function ModalUrgencia({ aberto, chamado, aoFechar, aoConfirmar }) {
  const [urg, setUrg] = useState('');
  const [just, setJust] = useState('');
  useEffect(() => { if (aberto) { setUrg(chamado.urgencia); setJust(''); } }, [aberto]);
  const piso = chamado.pa_parada || chamado.tipo_impacto === 'celula' ? 'alta' : 'baixa';
  return html`
    <${ModalPadrao} aberto=${aberto} titulo="Alterar urgência" onClose=${aoFechar}>
      <div class="rh-details-body">
        <div class="chm-opcoes" role="radiogroup">${ORDEM_URGENCIA.map((u) => html`
          <button type="button" role="radio" key=${u} aria-checked=${urg === u} disabled=${ORDEM_URGENCIA.indexOf(u) < ORDEM_URGENCIA.indexOf(piso)}
            class=${urg === u ? 'is-on' : ''} onClick=${() => setUrg(u)}>${ROTULO_URGENCIA[u]}</button>`)}</div>
        ${piso === 'alta' ? html`<p class="chm-dica"><${Icone} nome="info" />PA parada ou impacto coletivo exige urgência mínima Alta.</p>` : null}
        <label class="chm-campo"><span>Motivo (opcional)</span>
          <textarea class="chm-input chm-input--area" rows="3" maxlength="1000" value=${just} onInput=${(e) => setJust(e.target.value)}></textarea></label>
        <p class="chm-dica"><${Icone} nome="info" />O prazo (SLA) é recalculado a partir da abertura.</p>
      </div>
      <${RodapeModal} aoFechar=${aoFechar} desabilitado=${!urg || urg === chamado.urgencia} aoConfirmar=${() => aoConfirmar(urg, just.trim())} />
    </${ModalPadrao}>`;
}

function ModalAtribuir({ aberto, aoFechar, aoConfirmar }) {
  const [texto, setTexto] = useState('');
  const [lista, setLista] = useState([]);
  const [escolhido, setEscolhido] = useState(null);
  const termo = useDebounce(texto.trim(), 300);
  useEffect(() => { if (aberto) { setTexto(''); setEscolhido(null); } }, [aberto]);
  useEffect(() => {
    if (!aberto) return undefined;
    let ativo = true;
    buscarAtendentesChamado(termo).then((r) => ativo && setLista(r?.itens || [])).catch(() => ativo && setLista([]));
    return () => { ativo = false; };
  }, [aberto, termo]);
  return html`
    <${ModalPadrao} aberto=${aberto} titulo="Atribuir chamado" subtitulo="Escolha quem fica responsável" onClose=${aoFechar}>
      <div class="rh-details-body">
        <label class="chm-busca chm-busca--campo"><${Icone} nome="search" />
          <input type="search" value=${texto} placeholder="Buscar técnico por nome ou e-mail" onInput=${(e) => setTexto(e.target.value)} /></label>
        <ul class="chm-escolha">${lista.map((u) => html`
          <li key=${u.id}><button type="button" class=${escolhido === u.id ? 'is-on' : ''} onClick=${() => setEscolhido(u.id)}>
            <${Avatar} nome=${u.nome} pequeno=${true} /><span><b>${u.nome}</b><small>${u.email}</small></span></button></li>`)}
          ${!lista.length ? html`<li class="chm-sugestoes-vazio">Nenhum técnico encontrado.</li>` : null}</ul>
      </div>
      <${RodapeModal} aoFechar=${aoFechar} rotulo="Atribuir" desabilitado=${!escolhido} aoConfirmar=${() => aoConfirmar(escolhido)} />
    </${ModalPadrao}>`;
}
