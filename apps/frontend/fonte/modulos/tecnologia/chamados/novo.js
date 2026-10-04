import { html, useEffect, useRef, useState } from '../../../infraestrutura-react.js';
import { LoadingState } from '../../../ui/componentes-compartilhados.js';
import { buscarAgentesChamado, criarChamado } from '../../../services/api/chamados.js';
import {
  AcoesCompartilhar, EstadoErro, Icone, ORDEM_URGENCIA, ROTULO_URGENCIA, TELA_LISTA, irParaChamado, tamanhoLegivel,
  useDebounce, useMetaChamados,
} from './comum.js';

// Novo chamado: um card, três blocos (o que está acontecendo · quem foi afetado · urgência e anexos).
// Os dados do solicitante vêm do servidor e são somente leitura. O piso de urgência (PA parada / célula) é reforçado no backend.

const FORM_INICIAL = {
  operacao: '', categoriaId: '', titulo: '', descricao: '', impacto: 'agente', agentes: [], pa: '', paParada: false, urgencia: 'media',
};

function BuscaAgentes({ operacao, selecionados, aoMudar }) {
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState([]);
  const [aberto, setAberto] = useState(false);
  const termo = useDebounce(texto.trim(), 300);
  const caixa = useRef(null);

  useEffect(() => {
    if (!operacao || termo.length < 2) { setResultados([]); return undefined; }
    let ativo = true;
    buscarAgentesChamado(operacao, termo).then((r) => { if (ativo) setResultados(r?.itens || []); }).catch(() => { if (ativo) setResultados([]); });
    return () => { ativo = false; };
  }, [operacao, termo]);

  useEffect(() => {
    const fora = (e) => { if (caixa.current && !caixa.current.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  const ids = new Set(selecionados.map((a) => a.id));
  const escolher = (agente) => { aoMudar([...selecionados, agente]); setTexto(''); setAberto(false); };
  return html`
    <div class="chm-agentes" ref=${caixa}>
      <label class="chm-busca chm-busca--campo">
        <${Icone} nome="search" />
        <input type="search" value=${texto} disabled=${!operacao} placeholder=${operacao ? 'Buscar por nome ou e-mail' : 'Escolha a operação primeiro'}
          aria-label="Buscar agentes" onInput=${(e) => { setTexto(e.target.value); setAberto(true); }} onFocus=${() => setAberto(true)} />
      </label>
      ${aberto && termo.length >= 2 ? html`
        <ul class="chm-sugestoes" role="listbox">
          ${resultados.filter((a) => !ids.has(a.id)).map((a) => html`
            <li key=${a.id} role="option"><button type="button" onClick=${() => escolher(a)}>
              <strong>${a.nome}</strong><small>${a.email}</small></button></li>`)}
          ${!resultados.filter((a) => !ids.has(a.id)).length ? html`<li class="chm-sugestoes-vazio">Nenhum agente encontrado nesta operação.</li>` : null}
        </ul>` : null}
      ${selecionados.length ? html`
        <div class="chm-chips">
          ${selecionados.map((a) => html`
            <span class="chm-chip" key=${a.id}>${a.nome}
              <button type="button" aria-label=${`Remover ${a.nome}`} onClick=${() => aoMudar(selecionados.filter((x) => x.id !== a.id))}><${Icone} nome="close" /></button>
            </span>`)}
        </div>` : null}
    </div>`;
}

function CampoArquivos({ arquivos, aoMudar, meta, showToast }) {
  const [arrastando, setArrastando] = useState(false);
  const entrada = useRef(null);
  const limite = (meta?.anexo_max_mb || 25) * 1024 * 1024;
  const adicionar = (lista) => {
    const novos = [];
    Array.from(lista || []).forEach((arquivo) => {
      if (arquivo.size > limite) showToast(`"${arquivo.name}" passa de ${meta?.anexo_max_mb || 25} MB.`, 'error');
      else novos.push(arquivo);
    });
    if (novos.length) aoMudar([...arquivos, ...novos].slice(0, 10));
  };
  return html`
    <div>
      <div class=${`chm-drop ${arrastando ? 'is-arrastando' : ''}`.trim()} role="button" tabIndex="0"
        onClick=${() => entrada.current?.click()} onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); entrada.current?.click(); } }}
        onDragOver=${(e) => { e.preventDefault(); setArrastando(true); }} onDragLeave=${() => setArrastando(false)}
        onDrop=${(e) => { e.preventDefault(); setArrastando(false); adicionar(e.dataTransfer.files); }}>
        <${Icone} nome="attach_file" grande=${true} />
        <strong>Arraste arquivos aqui</strong>
        <span>ou clique para escolher · imagens, vídeos, PDF e documentos · até ${meta?.anexo_max_mb || 25} MB</span>
        <input ref=${entrada} type="file" multiple hidden accept=${(meta?.anexo_tipos || []).join(',')} onChange=${(e) => { adicionar(e.target.files); e.target.value = ''; }} />
      </div>
      ${arquivos.length ? html`
        <ul class="chm-arquivos">
          ${arquivos.map((a, i) => html`
            <li key=${`${a.name}-${i}`}><${Icone} nome="description" /><span class="chm-trunca">${a.name}</span><small>${tamanhoLegivel(a.size)}</small>
              <button type="button" aria-label=${`Remover ${a.name}`} onClick=${() => aoMudar(arquivos.filter((_, j) => j !== i))}><${Icone} nome="close" /></button></li>`)}
        </ul>` : null}
    </div>`;
}

export function NovoChamado({ controlador, showToast }) {
  const { meta, erro: erroMeta } = useMetaChamados();
  const [form, setForm] = useState(FORM_INICIAL);
  const [arquivos, setArquivos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [criado, setCriado] = useState(null);
  const operacoes = meta?.operacoes || [];
  const usuario = controlador.estado || {};
  const mudar = (parcial) => setForm((f) => ({ ...f, ...parcial }));

  useEffect(() => {
    if (meta && operacoes.length === 1 && !form.operacao) mudar({ operacao: operacoes[0].chave });
  }, [meta]);

  const piso = form.paParada || form.impacto === 'celula' ? 'alta' : 'baixa';
  const desabilitada = (u) => ORDEM_URGENCIA.indexOf(u) < ORDEM_URGENCIA.indexOf(piso);
  useEffect(() => { if (desabilitada(form.urgencia)) mudar({ urgencia: piso }); }, [piso]);

  const trocarOperacao = (chave) => mudar({ operacao: chave, agentes: [] });
  const valido = form.operacao && form.categoriaId && form.titulo.trim() && form.descricao.trim()
    && (form.impacto === 'celula' || (form.agentes.length && form.pa.trim()));

  const enviar = async (e) => {
    e.preventDefault();
    if (!valido || enviando) return;
    setEnviando(true);
    setErro('');
    try {
      const r = await criarChamado({
        titulo: form.titulo.trim(), descricao: form.descricao.trim(), categoria_id: Number(form.categoriaId), operacao: form.operacao,
        tipo_impacto: form.impacto, agentes_ids: form.impacto === 'agente' ? form.agentes.map((a) => a.id) : [], pa_posto: form.pa.trim(),
        pa_parada: form.paParada, urgencia: form.urgencia,
      }, arquivos);
      setCriado({ id: r.id, numero: r.numero, titulo: form.titulo.trim(), urgencia: r.urgencia });
    } catch (ex) {
      setErro(ex?.message || 'Não foi possível abrir o chamado.');
    } finally {
      setEnviando(false);
    }
  };

  if (criado) {
    return html`
      <section class="chm-card chm-sucesso">
        <span class="chm-sucesso-icone"><${Icone} nome="check_circle" grande=${true} /></span>
        <h3>Chamado #${criado.numero} aberto</h3>
        <p>A equipe de TI foi avisada. Você acompanha o andamento pelo Conecta e recebe uma notificação a cada atualização.</p>
        <div class="chm-mensagem-pronta"><small>Mensagem a compartilhar</small>
          <p>Chamado #${criado.numero} aberto no Suporte TI: ${criado.titulo} (${ROTULO_URGENCIA[criado.urgencia]}).</p></div>
        <${AcoesCompartilhar} chamado=${{ id: criado.id, numero: criado.numero, titulo: criado.titulo, urgencia: criado.urgencia }} showToast=${showToast} />
        <div class="chm-acoes-fim">
          <button type="button" class="btn btn-outline-secondary" onClick=${() => { setCriado(null); setForm({ ...FORM_INICIAL, operacao: operacoes.length === 1 ? operacoes[0].chave : '' }); setArquivos([]); }}>Abrir outro chamado</button>
          <button type="button" class="btn btn-primary" onClick=${() => irParaChamado(criado.id)}>Ver chamado</button>
        </div>
      </section>`;
  }

  if (!meta && !erroMeta) return html`<${LoadingState} titulo="Preparando o formulário" />`;
  if (erroMeta) return html`<${EstadoErro} erro=${erroMeta} />`;
  if (!operacoes.length) {
    return html`<section class="chm-card chm-restrito"><span class="chm-restrito-icone"><${Icone} nome="apartment" grande=${true} /></span>
      <h3>Sem operação vinculada</h3><p>Você ainda não está vinculado a uma operação. Peça ao administrador para vinculá-lo antes de abrir chamados.</p></section>`;
  }

  return html`
    <form class="chm-card chm-form" onSubmit=${enviar} noValidate>
      <div class="chm-solicitante">
        <div><small>Solicitante</small><b>${[usuario.nomeUsuarioAutenticado, usuario.sobrenomeUsuarioAutenticado].filter(Boolean).join(' ') || usuario.usuarioAutenticado || '—'}</b></div>
        <div><small>E-mail</small><b>${usuario.emailUsuarioAutenticado || '—'}</b></div>
        <div><small>Cargo</small><b>${usuario.cargoUsuarioAutenticado || '—'}</b></div>
      </div>

      <h3 class="chm-bloco">O que está acontecendo?</h3>
      <div class="chm-grade">
        <label class="chm-campo"><span>Operação</span>
          ${operacoes.length === 1
            ? html`<div class="chm-fixo">${operacoes[0].nome}</div>`
            : html`<select class="chm-select" value=${form.operacao} onChange=${(e) => trocarOperacao(e.target.value)}>
                <option value="">Selecione</option>${operacoes.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select>`}
        </label>
        <label class="chm-campo"><span>Categoria</span>
          <select class="chm-select" value=${form.categoriaId} onChange=${(e) => mudar({ categoriaId: e.target.value })}>
            <option value="">Selecione</option>${(meta.categorias || []).map((c) => html`<option key=${c.id} value=${c.id}>${c.nome}</option>`)}</select>
        </label>
        <label class="chm-campo chm-campo--cheio"><span>Título</span>
          <input class="chm-input" maxlength="160" value=${form.titulo} placeholder="Resumo curto do problema" onInput=${(e) => mudar({ titulo: e.target.value })} /></label>
        <label class="chm-campo chm-campo--cheio"><span>Descrição</span>
          <textarea class="chm-input chm-input--area" rows="4" value=${form.descricao} placeholder="O que aconteceu, desde quando e o que já foi tentado" onInput=${(e) => mudar({ descricao: e.target.value })}></textarea></label>
      </div>

      <h3 class="chm-bloco">Quem foi afetado?</h3>
      <div class="chm-grade">
        <div class="chm-campo chm-campo--cheio">
          <div class="chm-opcoes" role="radiogroup" aria-label="Tipo de impacto">
            <button type="button" role="radio" aria-checked=${form.impacto === 'agente'} class=${form.impacto === 'agente' ? 'is-on' : ''} onClick=${() => mudar({ impacto: 'agente' })}><${Icone} nome="person" />Agente(s)</button>
            <button type="button" role="radio" aria-checked=${form.impacto === 'celula'} class=${form.impacto === 'celula' ? 'is-on' : ''} onClick=${() => mudar({ impacto: 'celula', agentes: [] })}><${Icone} nome="group" />Célula inteira</button>
          </div>
        </div>
        ${form.impacto === 'agente' ? html`
          <div class="chm-campo chm-campo--cheio"><span>Agentes</span>
            <${BuscaAgentes} operacao=${form.operacao} selecionados=${form.agentes} aoMudar=${(agentes) => mudar({ agentes })} /></div>` : null}
        <label class="chm-campo"><span>PA / posto${form.impacto === 'celula' ? ' (opcional)' : ''}</span>
          <input class="chm-input" maxlength="40" value=${form.pa} placeholder="Ex.: PA 14" onInput=${(e) => mudar({ pa: e.target.value })} /></label>
        <div class="chm-campo"><span>PA parada?</span>
          <div class="chm-opcoes" role="radiogroup" aria-label="PA parada">
            <button type="button" role="radio" aria-checked=${!form.paParada} class=${!form.paParada ? 'is-on' : ''} onClick=${() => mudar({ paParada: false })}>Não</button>
            <button type="button" role="radio" aria-checked=${form.paParada} class=${form.paParada ? 'is-on' : ''} onClick=${() => mudar({ paParada: true })}>Sim</button>
          </div></div>
      </div>

      <h3 class="chm-bloco">Urgência e anexos</h3>
      <div class="chm-grade">
        <div class="chm-campo chm-campo--cheio"><span>Urgência</span>
          <div class="chm-opcoes" role="radiogroup" aria-label="Urgência">
            ${ORDEM_URGENCIA.map((u) => html`
              <button type="button" role="radio" key=${u} disabled=${desabilitada(u)} aria-checked=${form.urgencia === u} class=${form.urgencia === u ? 'is-on' : ''} onClick=${() => mudar({ urgencia: u })}>${ROTULO_URGENCIA[u]}</button>`)}
          </div>
          ${piso === 'alta' ? html`<small class="chm-dica"><${Icone} nome="info" />Baixa e Média indisponíveis: ${form.paParada ? 'PA parada' : 'impacto coletivo'} exige urgência mínima Alta.</small>` : null}
        </div>
        <div class="chm-campo chm-campo--cheio"><${CampoArquivos} arquivos=${arquivos} aoMudar=${setArquivos} meta=${meta} showToast=${showToast} /></div>
      </div>

      ${erro ? html`<div class="alert alert-danger chm-alerta" role="alert">${erro}</div>` : null}
      <div class="chm-rodape-form">
        <button type="button" class="btn btn-outline-secondary" onClick=${() => controlador.irParaTelaProtegida(TELA_LISTA)}>Cancelar</button>
        <button type="submit" class="btn btn-primary" disabled=${!valido || enviando}><${Icone} nome="send" />${enviando ? 'Abrindo…' : 'Abrir chamado'}</button>
      </div>
    </form>`;
}
