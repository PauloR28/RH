import { html, useRef } from '../../infraestrutura-react.js';
import { ModalPadrao } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import { formatarDataHoraCurta, formatarNota } from './comum.js';

// Peças compartilhadas pela lista de formulários e pela tela do formulário:
// chips de situação/versão, abas de situação, linha de versão e comparação.

export const SITUACOES = {
  ativo: { texto: 'Ativo', icone: 'check_circle', tom: 'ok', ajuda: 'Em uso. É a versão que aparece em Nova monitoria para esta operação.', acao: 'desativar' },
  desativado: { texto: 'Desativado', icone: 'block', tom: 'atencao', ajuda: 'Não aparece em Nova monitoria. As monitorias antigas continuam com a versão em que foram feitas.', acao: 'ativar' },
  arquivado: { texto: 'Arquivado', icone: 'archive', tom: 'neutro', ajuda: 'Fora de uso e guardado só para consulta. As monitorias antigas continuam intactas.', acao: 'restaurar' },
};

export const ROTULO_ACAO = { desativar: 'Desativar', ativar: 'Ativar', restaurar: 'Restaurar', arquivar: 'Arquivar' };

// Situação com ícone + texto (nunca só cor); o ícone é decorativo.
export function ChipSituacao({ situacao }) {
  const info = SITUACOES[situacao];
  if (!info) return null;
  return html`<span class=${`mon-chip-sit mon-chip-sit--${info.tom}`}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(info.icone)}</span>${info.texto}</span>`;
}

export function ChipVersao({ ativa }) {
  return html`<span class=${`mon-chip-ver ${ativa ? 'mon-chip-ver--atual' : ''}`}>${ativa ? 'Atual' : 'Arquivada'}</span>`;
}

// Abas de situação: tablist, setas trocam de aba, contagem no nome acessível ("Ativos, 5").
export function AbasSituacao({ itens, ativa, aoMudar }) {
  const refs = useRef({});
  const aoTeclar = (ev, indice) => {
    const passo = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
    if (!passo) return;
    ev.preventDefault();
    const alvo = itens[(indice + passo + itens.length) % itens.length];
    aoMudar(alvo.id);
    refs.current[alvo.id]?.focus();
  };
  return html`
    <div class="mon-abas-sit" role="tablist" aria-label="Situação do formulário">
      ${itens.map((item, i) => {
        const info = SITUACOES[item.id];
        return html`
          <button key=${item.id} type="button" role="tab" ref=${(el) => { refs.current[item.id] = el; }}
            class=${`mon-aba-sit ${info ? `mon-aba-sit--${info.tom}` : 'mon-aba-sit--todos'} ${ativa === item.id ? 'is-active' : ''}`}
            aria-selected=${ativa === item.id} tabIndex=${ativa === item.id ? 0 : -1}
            aria-label=${`${item.rotulo}, ${item.total}`}
            onClick=${() => aoMudar(item.id)} onKeyDown=${(ev) => aoTeclar(ev, i)}>
            <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(info ? info.icone : 'format_list_bulleted')}</span>
            <span>${item.rotulo}</span><span class="mon-aba-sit-num" aria-hidden="true">${item.total}</span>
          </button>`;
      })}
    </div>`;
}

export function VersionRow({ versao, marcada, desabilitada, motivoDesabilitada, aoMarcar, aoVer, aoRestaurar }) {
  const dataQuem = [formatarDataHoraCurta(versao.criado_em), versao.criado_por].filter(Boolean).join(' · ');
  const nota = versao.nota_media == null ? '—' : formatarNota(versao.nota_media);
  return html`
    <li class=${`mon-ver-linha ${marcada ? 'is-marcada' : ''}`}>
      <input type="checkbox" checked=${marcada} disabled=${desabilitada && !marcada}
        aria-label=${`Marcar v${versao.numero} para comparar`}
        title=${desabilitada && !marcada ? motivoDesabilitada : `Marcar v${versao.numero} para comparar`}
        onChange=${() => aoMarcar(versao.id_versao)} />
      <div class="mon-ver-corpo">
        <div class="mon-ver-topo"><strong>v${versao.numero}</strong><${ChipVersao} ativa=${versao.ativa} /></div>
        <div class="mon-ver-meta">${dataQuem}</div>
        ${versao.observacao ? html`<div class="mon-ver-obs" title=${versao.observacao}>${versao.observacao}</div>` : null}
        <div class="mon-ver-meta">${versao.monitorias} monitoria(s) · nota média ${nota}</div>
      </div>
      <div class="mon-ver-acoes">
        <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => aoVer(versao)}>Ver</button>
        ${aoRestaurar && !versao.ativa ? html`<button type="button" class="btn btn-outline-secondary btn-sm" title="Cria uma nova versão com este conteúdo" onClick=${() => aoRestaurar(versao)}>Restaurar</button>` : null}
      </div>
    </li>`;
}

// Regra do "Comparar (n/2)": no máximo 2 marcadas; marcar a terceira troca a mais antiga das marcadas.
export const alternarMarcadas = (atual, id) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id].slice(-2));

// Diferenças entre duas versões do formulário (Correções 27/set/2026): blocos e
// perguntas incluídos/removidos, pesos e textos alterados, escala e faixas.
export function compararConfigs(antes, depois) {
  const mudancas = [];
  const chave = (item, i) => String(item?.id || item?.nome || item?.texto || i);
  const blocosA = new Map((antes?.blocos || []).map((b, i) => [chave(b, i), b]));
  const blocosB = new Map((depois?.blocos || []).map((b, i) => [chave(b, i), b]));
  blocosB.forEach((b, k) => { if (!blocosA.has(k)) mudancas.push({ tipo: 'incluido', texto: `Bloco "${b.nome}" (valor ${formatarNota(b.valor)})` }); });
  blocosA.forEach((a, k) => { if (!blocosB.has(k)) mudancas.push({ tipo: 'removido', texto: `Bloco "${a.nome}"` }); });
  blocosA.forEach((a, k) => {
    const b = blocosB.get(k);
    if (!b) return;
    if (a.nome !== b.nome) mudancas.push({ tipo: 'alterado', texto: `Bloco renomeado: "${a.nome}" → "${b.nome}"` });
    if (Number(a.valor) !== Number(b.valor)) mudancas.push({ tipo: 'alterado', texto: `"${b.nome}": valor ${formatarNota(a.valor)} → ${formatarNota(b.valor)}` });
    const critA = new Map((a.criterios || []).map((c, i) => [chave(c, i), c]));
    const critB = new Map((b.criterios || []).map((c, i) => [chave(c, i), c]));
    critB.forEach((c, kc) => { if (!critA.has(kc)) mudancas.push({ tipo: 'incluido', texto: `"${b.nome}": pergunta "${c.texto}" (peso ${formatarNota(c.peso)})` }); });
    critA.forEach((c, kc) => { if (!critB.has(kc)) mudancas.push({ tipo: 'removido', texto: `"${b.nome}": pergunta "${c.texto}"` }); });
    critA.forEach((c, kc) => {
      const d = critB.get(kc);
      if (!d) return;
      if (c.texto !== d.texto) mudancas.push({ tipo: 'alterado', texto: `"${b.nome}": pergunta "${c.texto}" → "${d.texto}"` });
      if (Number(c.peso) !== Number(d.peso)) mudancas.push({ tipo: 'alterado', texto: `"${b.nome}" / "${d.texto}": peso ${formatarNota(c.peso)} → ${formatarNota(d.peso)}` });
    });
  });
  if (JSON.stringify(antes?.escala) !== JSON.stringify(depois?.escala)) {
    mudancas.push({ tipo: 'alterado', texto: `Escala ${antes?.escala?.min}–${antes?.escala?.max} → ${depois?.escala?.min}–${depois?.escala?.max}` });
  }
  if (Number(antes?.min_blocos) !== Number(depois?.min_blocos)) {
    mudancas.push({ tipo: 'alterado', texto: `Mínimo de blocos avaliados: ${antes?.min_blocos} → ${depois?.min_blocos}` });
  }
  if (JSON.stringify(antes?.faixas) !== JSON.stringify(depois?.faixas)) {
    const faixas = (lista) => (lista || []).map((f) => `${f.label} ≥ ${f.min}`).join(', ');
    mudancas.push({ tipo: 'alterado', texto: `Faixas de nota: ${faixas(antes?.faixas)} → ${faixas(depois?.faixas)}` });
  }
  return mudancas;
}

const ROTULO_MUDANCA = { incluido: 'Incluído', removido: 'Removido', alterado: 'Alterado' };

export function ModalComparacao({ comparacao, aoFechar }) {
  return html`
    <${ModalPadrao} aberto=${Boolean(comparacao)} titulo=${comparacao ? `O que mudou da v${comparacao.antes.numero} para a v${comparacao.depois.numero}` : ''} onClose=${aoFechar}>
      ${comparacao ? (comparacao.mudancas.length
        ? html`<div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th scope="col">Mudança</th><th scope="col">Detalhe</th></tr></thead><tbody>
            ${comparacao.mudancas.map((m, i) => html`<tr key=${i}><td><span class=${`mon-badge ${m.tipo === 'incluido' ? 'mon-badge--ok' : ''}`}>${ROTULO_MUDANCA[m.tipo]}</span></td><td>${m.texto}</td></tr>`)}
          </tbody></table></div>`
        : html`<p class="mon-muted">As duas versões têm o mesmo conteúdo.</p>`) : null}
    </${ModalPadrao}>`;
}

// Diálogo de confirmação das ações de situação/versão (mesmo cromado do ModalPadrao).
export function DialogoConfirmar({ aberto, titulo, descricao, textoConfirmar, perigo = false, ocupado = false, erro = '', aoCancelar, aoConfirmar }) {
  return html`
    <${ModalPadrao} aberto=${aberto} titulo=${titulo} subtitulo=${descricao} onClose=${ocupado ? () => null : aoCancelar}>
      ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>` : null}
      <footer class="rh-modal-footer">
        <button type="button" class="btn btn-outline-secondary" disabled=${ocupado} onClick=${aoCancelar}>Cancelar</button>
        <button type="button" class=${`btn ${perigo ? 'btn-danger' : 'btn-primary'}`} disabled=${ocupado} onClick=${aoConfirmar}>${ocupado ? 'Processando…' : textoConfirmar}</button>
      </footer>
    </${ModalPadrao}>`;
}
