import { html } from '../../infraestrutura-react.js';
import { Ic, Janela, Selo } from '../../ui/components/ds.js?v=20261106-wfm';
import { formatarDataHoraCurta, formatarNota } from './comum.js';

// Peças compartilhadas pela lista de formulários e pela tela do formulário (redesign Fase 15, fatia 4, amostras Q2 e Q3
// do lote 2): selo de situação, linha de versão (com caixinha para Comparar), comparação e confirmação.

export const SITUACOES = {
  ativo: { texto: 'Ativo', icone: 'check-circle', tom: 'sucesso', ajuda: 'Em uso. É a versão que aparece em Nova monitoria para esta operação.', acao: 'desativar' },
  desativado: { texto: 'Desativado', icone: 'prohibit', tom: 'atencao', ajuda: 'Não aparece em Nova monitoria. As monitorias antigas continuam com a versão em que foram feitas.', acao: 'ativar' },
  arquivado: { texto: 'Arquivado', icone: 'archive', tom: 'neutro', ajuda: 'Fora de uso e guardado só para consulta. As monitorias antigas continuam intactas.', acao: 'restaurar' },
};

export const ROTULO_ACAO = { desativar: 'Desativar', ativar: 'Ativar', restaurar: 'Restaurar', arquivar: 'Arquivar' };

// Situação com ícone + texto (nunca só cor). `extra` acrescenta "· v3" no mesmo selo.
export function ChipSituacao({ situacao, extra = '' }) {
  const info = SITUACOES[situacao];
  if (!info) return null;
  return html`<${Selo} tom=${info.tom} icone=${info.icone}>${info.texto}${extra ? ` · ${extra}` : ''}<//>`;
}

export function ChipVersao({ ativa }) {
  return ativa ? html`<${Selo} tom="sucesso">Atual<//>` : html`<${Selo} tom="neutro">Arquivada<//>`;
}

// Linha de versão (coluna da direita): caixinha para Comparar · vN · data e quem (ou o que mudou) · nota média.
// Clique na linha abre a versão; "Restaurar" aparece nas versões arquivadas quando permitido.
export function VersionRow({ versao, marcada, desabilitada, motivoDesabilitada, aoMarcar, aoVer, aoRestaurar, atual = false }) {
  const dataQuem = [formatarDataHoraCurta(versao.criado_em), versao.criado_por].filter(Boolean).join(' · ');
  const nota = versao.nota_media == null ? '—' : formatarNota(versao.nota_media);
  return html`<div class="c-fm-versao" role="listitem" aria-current=${atual ? 'true' : null} onClick=${(e) => { if (!e.target.closest('input, button')) aoVer?.(versao); }}>
    <input type="checkbox" checked=${marcada} disabled=${(desabilitada && !marcada) || null}
      aria-label=${`Marcar v${versao.numero} para comparar`} title=${desabilitada && !marcada ? motivoDesabilitada : `Marcar v${versao.numero} para comparar`}
      onChange=${() => aoMarcar(versao.id_versao)} />
    <b>v${versao.numero}</b>
    <span><small title=${versao.observacao || dataQuem}>${versao.observacao || dataQuem}</small><small>${versao.monitorias ?? 0} monit. · nota ${nota}${versao.ativa ? ' · atual' : ''}</small></span>
    ${aoRestaurar && !versao.ativa
      ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" title="Cria uma nova versão com este conteúdo" onClick=${() => aoRestaurar(versao)}>Restaurar</button>`
      : html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => aoVer?.(versao)}>Ver</button>`}
  </div>`;
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

const ROTULO_MUDANCA = { incluido: ['Incluído', 'sucesso'], removido: ['Removido', 'perigo'], alterado: ['Alterado', 'informacao'] };

export function ModalComparacao({ comparacao, aoFechar }) {
  if (!comparacao) return null;
  return html`<${Janela} titulo=${`O que mudou da v${comparacao.antes.numero} para a v${comparacao.depois.numero}`} tamanho="grande" onClose=${aoFechar}
    rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${aoFechar}>Fechar</button>`}>
    <div class="c-janela-corpo">
      ${comparacao.mudancas.length
        ? html`<div class="c-tabela-caixa"><table class="c-tabela"><thead><tr><th scope="col">Mudança</th><th scope="col" class="c-estica">Detalhe</th></tr></thead><tbody>
            ${comparacao.mudancas.map((m, i) => html`<tr key=${i}><td><${Selo} tom=${ROTULO_MUDANCA[m.tipo][1]}>${ROTULO_MUDANCA[m.tipo][0]}<//></td><td class="c-estica c-quebra">${m.texto}</td></tr>`)}
          </tbody></table></div>`
        : html`<p class="c-ajuda">As duas versões têm o mesmo conteúdo.</p>`}
    </div>
  <//>`;
}

// Confirmação das ações de situação/versão.
export function DialogoConfirmar({ aberto, titulo, descricao, textoConfirmar, perigo = false, ocupado = false, erro = '', aoCancelar, aoConfirmar }) {
  if (!aberto) return null;
  return html`<${Janela} titulo=${titulo} tamanho="pequena" onClose=${ocupado ? () => null : aoCancelar}
    rodape=${html`<button type="button" class="c-botao c-botao--secundario" disabled=${ocupado || null} onClick=${aoCancelar}>Cancelar</button>
      <button type="button" class=${`c-botao ${perigo ? 'c-botao--perigo' : 'c-botao--principal'}`} aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || null} onClick=${aoConfirmar}>${ocupado ? 'Processando…' : textoConfirmar}</button>`}>
    <div class="c-janela-corpo">
      ${descricao ? html`<p>${descricao}</p>` : null}
      ${erro ? html`<div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${erro}</p></div></div>` : null}
    </div>
  <//>`;
}
