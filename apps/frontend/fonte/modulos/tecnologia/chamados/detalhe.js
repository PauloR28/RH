import { html, useCallback, useEffect, useRef, useState } from '../../../infraestrutura-react.js';
import { LoadingState, ModalPadrao } from '../../../ui/componentes-compartilhados.js';
import { obterRotaAtual } from '../../../rotas.js';
import { marcarNotificacoesEntidadeLidas } from '../../../services/api/notifications.js?v=20260927-estado-usuario';
import { atualizarChamadosNaoLidos } from '../../../shared/chamados-nao-lidos.js?v=20261006-areas-inativas';
import { PageHeader, PageShell } from '../../../ui/components/layout-primitivas.js?v=20261005-redesign15';
import {
  assumirChamado, atribuirChamado, baixarAnexoChamado, buscarAtendentesChamado, cancelarChamado, confirmarEncerramentoChamado,
  enviarMensagemChamado, excluirAnexoChamado, lerChamado, lerHistoricoChamado, listarEventosChamado, mudarStatusChamado,
  mudarUrgenciaChamado, reabrirChamado,
} from '../../../services/api/chamados.js?v=20261005-redesign15';
import {
  AcessoRestrito, Avatar, EstadoErro, Icone, MenuCompartilhar, ORDEM_URGENCIA, Pill, PillSla, PillStatus, PillUrgencia, ROTULO_STATUS,
  ROTULO_URGENCIA, TELA_LISTA, formatarDataCompleta, formatarDataHora, tamanhoLegivel, useDebounce,
} from './comum.js?v=20261005-redesign15';

// Detalhe do chamado. Vive em dois lugares com o mesmo componente: painel ao lado da lista (`embutido`) e a rota própria
// /suporte-ti/chamado/:id (links de notificação). Descrição sempre à vista; Conversa, Histórico e Anexos em abas; ações numa barra só.
// `acoes` vem do servidor e cada ação é validada de novo no backend.

export const idChamadoDaRota = () => {
  const m = String(obterRotaAtual() || '').match(/suporte-ti\/chamado\/(\d+)/);
  return m ? Number(m[1]) : 0;
};

const ABAS = [{ id: 'conversa', rotulo: 'Conversa' }, { id: 'historico', rotulo: 'Histórico' }, { id: 'anexos', rotulo: 'Anexos' }];

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

function textoSistema(evento) {
  const d = evento.dados || {};
  const autor = evento.autor_nome && evento.autor_nome !== 'Sistema' ? evento.autor_nome : '';
  if (evento.tipo === 'reabertura') return `${autor || 'O solicitante'} reabriu o chamado${evento.conteudo ? `: "${evento.conteudo}"` : ''}`;
  if (evento.tipo === 'status' && d.para) {
    const base = `${autor ? `${autor}: ` : ''}status alterado para ${ROTULO_STATUS[d.para] || d.para}`;
    return evento.conteudo ? `${base}. ${evento.conteudo}` : base;
  }
  if (evento.conteudo === 'Chamado aberto.') return `${autor || 'Alguém'} abriu o chamado`;
  return evento.conteudo || '';
}

function EventoLinha({ evento, aoBaixar }) {
  const sistema = evento.tipo !== 'mensagem';
  const icone = evento.tipo === 'status' ? 'task_alt' : evento.tipo === 'anexo' ? 'attach_file' : evento.tipo === 'reabertura' ? 'refresh' : 'build';
  return html`
    <div class=${`chm-ev ${sistema ? 'is-sistema' : ''}`.trim()}>
      <span class="chm-ev-ponto">${sistema ? html`<${Icone} nome=${icone} />` : html`<${Avatar} nome=${evento.autor_nome} />`}</span>
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

function descricaoMovimento(m) {
  const d = m.dados || {};
  if (m.tipo === 'reabertura') return { titulo: `Reaberto por ${m.por.nome}`, detalhe: m.descricao ? `Alegação do solicitante: "${m.descricao}"` : '' };
  if (m.tipo === 'status' && d.para) {
    return { titulo: `Status: ${ROTULO_STATUS[d.de] || d.de || '—'} → ${ROTULO_STATUS[d.para] || d.para}${d.automatico ? ' (automático)' : ''}`, detalhe: m.descricao || '' };
  }
  return { titulo: m.descricao || 'Atualização', detalhe: '' };
}

// Histórico: a abertura aparece SEMPRE; movimentações (reabertura, mudança de status, atribuição, urgência) só quando existirem.
function AbaHistorico({ id, versao }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    let ativo = true;
    setErro('');
    lerHistoricoChamado(id).then((r) => ativo && setDados(r)).catch((e) => ativo && setErro(e?.message || 'Não foi possível carregar o histórico.'));
    return () => { ativo = false; };
  }, [id, versao]);
  if (erro) return html`<${EstadoErro} erro=${erro} />`;
  if (!dados) return html`<${LoadingState} titulo="Carregando histórico" />`;
  return html`
    <ol class="chm-hist">
      <li><span class="chm-hist-data">${formatarDataCompleta(dados.abertura.em)}</span>
        <div><b>Aberto por ${dados.abertura.por.nome}</b><small>Operação ${dados.abertura.operacao}</small></div></li>
      ${dados.movimentacoes.map((m) => {
        const d = descricaoMovimento(m);
        return html`<li key=${m.id}><span class="chm-hist-data">${formatarDataCompleta(m.em)}</span>
          <div><b>${d.titulo}</b>${d.detalhe ? html`<small>${d.detalhe}</small>` : null}<small>por ${m.por.nome}</small></div></li>`;
      })}
    </ol>
    ${dados.reaberto_vezes ? html`<p class="chm-hist-resumo">Reaberto ${dados.reaberto_vezes} vez${dados.reaberto_vezes === 1 ? '' : 'es'}: continua sendo o mesmo chamado.</p>` : null}`;
}

export function DetalheChamado({ id, controlador, showToast, embutido = false, aoMudar }) {
  const [chamado, setChamado] = useState(null);
  const [erro, setErro] = useState('');
  const [aba, setAba] = useState('conversa');
  const [versao, setVersao] = useState(0);
  const [eventos, setEventos] = useState([]);
  const [temMais, setTemMais] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [mensagem, setMensagem] = useState('');
  const [arquivos, setArquivos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [modal, setModal] = useState('');
  const entradaArquivo = useRef(null);

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const [c, e] = await Promise.all([lerChamado(id), listarEventosChamado(id, { limite: 50 })]);
      setChamado(c);
      setEventos(e.eventos || []);
      setTemMais(Boolean(e.tem_mais));
      setCursor(e.proximo_cursor);
      setVersao((v) => v + 1);
    } catch (ex) {
      setErro(ex?.message || 'Não foi possível carregar o chamado.');
    }
  }, [id]);
  useEffect(() => { if (id) carregar(); }, [id, carregar]);
  // Abrir o chamado conta como ler as notificações dele (apaga a bolinha vermelha do Suporte TI quando não restar nenhuma).
  useEffect(() => {
    if (!id) return;
    marcarNotificacoesEntidadeLidas('chamado', id).then(atualizarChamadosNaoLidos).catch(() => {});
  }, [id]);

  const executar = async (acao, sucesso) => {
    try {
      await acao();
      if (sucesso) showToast(sucesso, 'success');
      setModal('');
      await carregar();
      aoMudar?.();
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
      aoMudar?.();
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
  const botoes = html`
    ${acoes.assumir ? html`<button type="button" class="btn btn-primary" onClick=${() => executar(() => assumirChamado(id), 'Você assumiu o chamado.')}>Assumir</button>` : null}
    ${acoes.atribuir ? html`<button type="button" class="btn btn-outline-secondary" onClick=${() => setModal('atribuir')}>Atribuir</button>` : null}
    ${acoes.mudar_status?.length ? html`<button type="button" class="btn btn-outline-secondary" onClick=${() => setModal('status')}>Mudar status</button>` : null}
    ${acoes.alterar_urgencia ? html`<button type="button" class="btn btn-outline-secondary" onClick=${() => setModal('urgencia')}>Alterar urgência</button>` : null}
    ${acoes.confirmar_encerramento ? html`<button type="button" class="btn btn-primary" onClick=${() => executar(() => confirmarEncerramentoChamado(id), 'Chamado encerrado.')}>Confirmar encerramento</button>` : null}
    ${acoes.reabrir ? html`<button type="button" class="btn btn-outline-secondary" onClick=${() => setModal('reabrir')}>Reabrir</button>` : null}
    ${acoes.cancelar ? html`<button type="button" class="btn btn-outline-danger" onClick=${() => setModal('cancelar')}>Cancelar chamado</button>` : null}
    <${MenuCompartilhar} chamado=${chamado} showToast=${showToast} />`;

  const corpo = html`
    <div class=${`chm-det ${embutido ? 'is-embutido' : ''}`.trim()}>
      ${embutido ? html`
        <div class="chm-det-cab">
          <h3 class="chm-det-titulo"><span class="chm-muted">#${chamado.numero}</span> ${chamado.titulo}</h3>
        </div>` : null}
      <div class="chm-det-pills">
        <${PillUrgencia} urgencia=${chamado.urgencia} /><${PillStatus} status=${chamado.status} /><${PillSla} item=${chamado} />
        ${chamado.reaberto_vezes ? html`<${Pill} tom="warn" semPonto=${true}>Reaberto ${chamado.reaberto_vezes}×</${Pill}>` : null}
        ${chamado.resolvido_remotamente ? html`<${Pill} tom="info" semPonto=${true}>Resolvido remotamente</${Pill}>` : null}
        ${chamado.pa_parada ? html`<${Pill} tom="bad">PA parada</${Pill}>` : null}
      </div>
      <div class="chm-det-acoes">${botoes}</div>

      <dl class="chm-det-meta">
        <div><dt>Solicitante</dt><dd>${chamado.solicitante.nome}</dd></div>
        <div><dt>Operação · PA</dt><dd>${chamado.operacao}${chamado.pa_posto ? ` · ${chamado.pa_posto}` : ''}</dd></div>
        <div><dt>Responsável</dt><dd>${chamado.responsavel?.nome || 'Sem responsável'}</dd></div>
        <div><dt>Categoria</dt><dd>${chamado.categoria}</dd></div>
        <div><dt>Aberto em</dt><dd>${formatarDataCompleta(chamado.criado_em)}</dd></div>
        <div><dt>Prazo (SLA)</dt><dd>${chamado.sla?.contando || chamado.sla?.pausado ? formatarDataCompleta(chamado.prazo_sla) : chamado.resolvido_em ? 'Atendido' : '—'}</dd></div>
      </dl>
      <div class="chm-det-descricao"><dt>Descrição do problema</dt><p>${chamado.descricao}</p></div>

      <div class="chm-abas" role="tablist">
        ${ABAS.map((a) => html`<button type="button" role="tab" key=${a.id} aria-selected=${aba === a.id} class=${aba === a.id ? 'is-on' : ''} onClick=${() => setAba(a.id)}>
          ${a.rotulo}${a.id === 'anexos' && chamado.anexos.length ? html` <span class="chm-cnt">${chamado.anexos.length}</span>` : null}</button>`)}
      </div>

      ${aba === 'conversa' ? html`
        <div class="chm-timeline">
          ${temMais ? html`<button type="button" class="btn btn-sm btn-outline-secondary chm-mais" onClick=${maisAntigos}>Ver mensagens anteriores</button>` : null}
          ${eventos.map((e) => html`<${EventoLinha} key=${e.id} evento=${e} aoBaixar=${abrirAnexo} />`)}
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
          </div>` : html`<p class="chm-composer-fim">Este chamado está ${chamado.status === 'cancelado' ? 'cancelado' : chamado.status === 'resolvido' ? 'resolvido' : 'encerrado'}: não recebe mais mensagens.</p>`}` : null}

      ${aba === 'historico' ? html`<${AbaHistorico} id=${id} versao=${versao} />` : null}

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

      <${ModalMotivo} aberto=${modal === 'reabrir'} titulo="Reabrir chamado" rotulo="O que continua acontecendo? (obrigatório)" obrigatorio=${true} confirmar="Reabrir"
        aoFechar=${() => setModal('')} aoConfirmar=${(motivo) => executar(() => reabrirChamado(id, motivo), 'Chamado reaberto.')} />
      <${ModalMotivo} aberto=${modal === 'cancelar'} titulo="Cancelar chamado" rotulo="Motivo (opcional)" obrigatorio=${false} confirmar="Cancelar chamado"
        aoFechar=${() => setModal('')} aoConfirmar=${(motivo) => executar(() => cancelarChamado(id, motivo), 'Chamado cancelado.')} />
      <${ModalStatus} aberto=${modal === 'status'} destinos=${acoes.mudar_status || []} aoFechar=${() => setModal('')}
        aoConfirmar=${(status, just, remoto) => executar(() => mudarStatusChamado(id, status, just, remoto), 'Status atualizado.')} />
      <${ModalUrgencia} aberto=${modal === 'urgencia'} chamado=${chamado} aoFechar=${() => setModal('')}
        aoConfirmar=${(urg, just) => executar(() => mudarUrgenciaChamado(id, urg, just), 'Urgência atualizada.')} />
      <${ModalAtribuir} aberto=${modal === 'atribuir'} aoFechar=${() => setModal('')}
        aoConfirmar=${(resp) => executar(() => atribuirChamado(id, resp), 'Chamado atribuído.')} />
    </div>`;

  if (embutido) return corpo;
  return html`
    <${PageShell}>
      <${PageHeader} titulo=${`Chamado #${chamado.numero}`} subtitulo=${chamado.titulo}
        acoes=${html`<button type="button" class="btn btn-outline-secondary" onClick=${() => controlador.irParaTelaProtegida(TELA_LISTA)}><${Icone} nome="arrow_back" />Voltar</button>`} />
      ${corpo}
    <//>`;
}

// Rota própria do chamado (links de notificação e compartilhamento).
export function PaginaDetalheChamado({ controlador, showToast }) {
  return html`<${DetalheChamado} id=${idChamadoDaRota()} controlador=${controlador} showToast=${showToast} />`;
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
  const [remoto, setRemoto] = useState(false);
  useEffect(() => { if (aberto) { setStatus(destinos[0] || ''); setJust(''); setRemoto(false); } }, [aberto]);
  return html`
    <${ModalPadrao} aberto=${aberto} titulo="Mudar status" onClose=${aoFechar}>
      <div class="rh-details-body">
        <div class="chm-opcoes chm-opcoes--coluna" role="radiogroup">${destinos.map((d) => html`
          <button type="button" role="radio" key=${d} aria-checked=${status === d} class=${status === d ? 'is-on' : ''} onClick=${() => setStatus(d)}>${ROTULO_STATUS[d]}</button>`)}</div>
        <label class="chm-campo"><span>${status === 'aguardando_solicitante' ? 'O que você precisa do solicitante?' : 'Observação (opcional)'}</span>
          <textarea class="chm-input chm-input--area" rows="3" maxlength="1000" value=${just} onInput=${(e) => setJust(e.target.value)}></textarea></label>
        ${status === 'resolvido' ? html`
          <label class="chm-check"><input type="checkbox" checked=${remoto} onChange=${(e) => setRemoto(e.target.checked)} />Resolvido remotamente (sem ir até o posto)</label>` : null}
        ${status === 'aguardando_solicitante' ? html`<p class="chm-dica"><${Icone} nome="info" />O prazo (SLA) fica pausado até o solicitante responder.</p>` : null}
      </div>
      <${RodapeModal} aoFechar=${aoFechar} desabilitado=${!status} aoConfirmar=${() => aoConfirmar(status, just.trim(), status === 'resolvido' && remoto)} />
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
