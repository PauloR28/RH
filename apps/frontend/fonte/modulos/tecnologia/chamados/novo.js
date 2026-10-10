import { html, useEffect, useRef, useState } from '../../../infraestrutura-react.js';
import { criarChamado } from '../../../services/api/chamados.js?v=20261005-redesign16';
import { Campo, FormGrid, PageHeader, PageShell, Section } from '../../../ui/components/layout-primitivas.js?v=20261005-redesign16';
import {
  AcoesCompartilhar, EstadoErro, Icone, ORDEM_URGENCIA, ROTULO_URGENCIA, TELA_LISTA, irParaChamado, tamanhoLegivel, textoCompartilhar, useMetaChamados,
} from './comum.js?v=20261005-redesign16';

// Novo chamado: uma linha de solicitante (somente leitura), grade de 3 colunas e as ações no cabeçalho (sempre visíveis).
// O piso de urgência (PA parada / célula inteira) é reforçado no backend.

const FORM_INICIAL = { operacao: '', categoriaId: '', titulo: '', descricao: '', impacto: 'agente', pa: '', paParada: false, urgencia: 'media' };
const ID_FORM = 'form-novo-chamado';

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
        <${Icone} nome="attach_file" />
        <span><strong>Arraste arquivos aqui</strong> ou clique para escolher · imagens, vídeos, PDF e documentos · até ${meta?.anexo_max_mb || 25} MB</span>
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

function Opcoes({ rotulo, valor, itens, aoEscolher }) {
  return html`
    <div class="chm-opcoes" role="radiogroup" aria-label=${rotulo}>
      ${itens.map((i) => html`
        <button type="button" role="radio" key=${i.valor} disabled=${i.desabilitado} aria-checked=${valor === i.valor} class=${valor === i.valor ? 'is-on' : ''}
          onClick=${() => aoEscolher(i.valor)}>${i.rotulo}</button>`)}
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

  const valido = form.operacao && form.categoriaId && form.titulo.trim() && form.descricao.trim();

  const enviar = async (e) => {
    e.preventDefault();
    if (!valido || enviando) return;
    setEnviando(true);
    setErro('');
    try {
      const r = await criarChamado({
        titulo: form.titulo.trim(), descricao: form.descricao.trim(), categoria_id: Number(form.categoriaId), operacao: form.operacao,
        tipo_impacto: form.impacto, agentes_ids: [], pa_posto: form.pa.trim(), pa_parada: form.paParada, urgencia: form.urgencia,
      }, arquivos);
      setCriado({ id: r.id, numero: r.numero, titulo: form.titulo.trim(), descricao: form.descricao.trim(), urgencia: r.urgencia });
    } catch (ex) {
      setErro(ex?.message || 'Não foi possível abrir o chamado.');
    } finally {
      setEnviando(false);
    }
  };

  const cancelar = () => controlador.irParaTelaProtegida(TELA_LISTA);
  const acoes = html`
    <button type="button" class="btn btn-outline-secondary" onClick=${cancelar}>Cancelar</button>
    <button type="submit" form=${ID_FORM} class="btn btn-primary" disabled=${!valido || enviando}><${Icone} nome="send" />${enviando ? 'Abrindo…' : 'Abrir chamado'}</button>`;

  if (criado) {
    const dadosCompartilhar = { id: criado.id, numero: criado.numero, titulo: criado.titulo, descricao: criado.descricao, status: 'aberto', urgencia: criado.urgencia };
    return html`<${PageShell}>
      <${PageHeader} titulo=${`Chamado #${criado.numero} aberto`} subtitulo="A equipe de TI foi avisada. Você acompanha o andamento pelo Conecta e recebe uma notificação a cada atualização." />
      <${Section}>
        <div class="chm-sucesso-corpo">
        <div class="chm-mensagem-pronta"><small>Mensagem a compartilhar</small>
          <pre>${textoCompartilhar(dadosCompartilhar)}</pre></div>
        <${AcoesCompartilhar} chamado=${dadosCompartilhar} showToast=${showToast} />
        <div class="chm-acoes-fim">
          <button type="button" class="btn btn-outline-secondary" onClick=${() => { setCriado(null); setForm({ ...FORM_INICIAL, operacao: operacoes.length === 1 ? operacoes[0].chave : '' }); setArquivos([]); }}>Abrir outro chamado</button>
          <button type="button" class="btn btn-primary" onClick=${() => irParaChamado(criado.id)}>Ver chamado</button>
        </div>
        </div>
      <//>
    <//>`;
  }

  if (erroMeta) return html`<${EstadoErro} erro=${erroMeta} />`;
  if (meta && !operacoes.length) {
    return html`<${PageShell}>
      <${PageHeader} titulo="Novo chamado" />
      <${Section}><p class="chm-vazio">Você ainda não está vinculado a uma operação. Peça ao administrador para vinculá-lo antes de abrir chamados.</p><//>
    <//>`;
  }

  return html`<${PageShell}>
    <${PageHeader} titulo="Novo chamado" subtitulo="Descreva o problema para a equipe de TI priorizar pelo impacto na operação." acoes=${acoes} />
    <form id=${ID_FORM} class="chm-form-novo" onSubmit=${enviar} noValidate>
      <${Section}>
        <p class="chm-solicitante-linha"><span class="chm-muted">Solicitante</span>
          <b>${[usuario.nomeUsuarioAutenticado, usuario.sobrenomeUsuarioAutenticado].filter(Boolean).join(' ') || usuario.usuarioAutenticado || '—'}</b>
          <span class="chm-muted">·</span><span>${usuario.emailUsuarioAutenticado || '—'}</span></p>
        <${FormGrid}>
          <${Campo} rotulo="Operação">
            ${operacoes.length === 1
              ? html`<div class="chm-fixo">${operacoes[0].nome}</div>`
              : html`<select value=${form.operacao} onChange=${(e) => mudar({ operacao: e.target.value })} disabled=${!meta}>
                  <option value="">Selecione</option>${operacoes.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select>`}
          <//>
          <${Campo} rotulo="Categoria">
            <select value=${form.categoriaId} onChange=${(e) => mudar({ categoriaId: e.target.value })} disabled=${!meta}>
              <option value="">Selecione</option>${(meta?.categorias || []).map((c) => html`<option key=${c.id} value=${c.id}>${c.nome}</option>`)}</select>
          <//>
          <${Campo} rotulo="PA / posto (opcional)">
            <input maxlength="40" value=${form.pa} placeholder="Ex.: PA 14" onInput=${(e) => mudar({ pa: e.target.value })} />
          <//>
          <div class="lp-campo"><span class="lp-campo-rotulo">Quem foi afetado?</span>
            <${Opcoes} rotulo="Quem foi afetado" valor=${form.impacto} aoEscolher=${(impacto) => mudar({ impacto })}
              itens=${[{ valor: 'agente', rotulo: 'Um posto' }, { valor: 'celula', rotulo: 'Célula inteira' }]} /></div>
          <div class="lp-campo"><span class="lp-campo-rotulo">PA parada?</span>
            <${Opcoes} rotulo="PA parada" valor=${form.paParada} aoEscolher=${(paParada) => mudar({ paParada })}
              itens=${[{ valor: false, rotulo: 'Não' }, { valor: true, rotulo: 'Sim' }]} /></div>
          <div class="lp-campo"><span class="lp-campo-rotulo">Urgência</span>
            <${Opcoes} rotulo="Urgência" valor=${form.urgencia} aoEscolher=${(urgencia) => mudar({ urgencia })}
              itens=${ORDEM_URGENCIA.map((u) => ({ valor: u, rotulo: ROTULO_URGENCIA[u], desabilitado: desabilitada(u) }))} />
            ${piso === 'alta' ? html`<small class="lp-campo-ajuda">${form.paParada ? 'PA parada' : 'Impacto coletivo'} exige urgência mínima Alta.</small>` : null}</div>
          <${Campo} rotulo="Título" cheio=${true}>
            <input maxlength="160" value=${form.titulo} placeholder="Resumo curto do problema" onInput=${(e) => mudar({ titulo: e.target.value })} />
          <//>
          <${Campo} rotulo="Descrição" cheio=${true}>
            <textarea rows="3" value=${form.descricao} placeholder="O que aconteceu, desde quando e o que já foi tentado" onInput=${(e) => mudar({ descricao: e.target.value })}></textarea>
          <//>
          <div class="lp-campo lp-campo--cheio"><span class="lp-campo-rotulo">Anexos (opcional)</span>
            <${CampoArquivos} arquivos=${arquivos} aoMudar=${setArquivos} meta=${meta} showToast=${showToast} /></div>
        <//>
        ${erro ? html`<div class="alert alert-danger" role="alert">${erro}</div>` : null}
      <//>
    </form>
    <//>`;
}
