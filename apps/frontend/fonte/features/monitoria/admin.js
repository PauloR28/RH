import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState, ModalPadrao, SectionCard } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import { lerVersaoMatriz, listarVersoesMatriz, salvarMatriz } from '../../services/api/monitoria.js';
import { SelectOperacao, formatarDataHoraCurta, formatarNota } from './comum.js';

// Formulários (matriz de qualidade versionada por operação).
// Usuários, equipes/catálogos e logs de auditoria da Monitoria são administrados em
// Configurações (features/configuracoes/monitoria-config.js).

function somaPesos(bloco) {
  return (bloco.criterios || []).reduce((t, c) => t + (Number(c.peso) || 0), 0);
}

const clonar = (valor) => JSON.parse(JSON.stringify(valor));
const BLOCO_VAZIO = () => ({ nome: '', valor: 0, criterios: [{ texto: '', peso: 0 }] });

function BotaoIcone({ icone, titulo, onClick, perigo = false, desabilitado = false }) {
  return html`
    <button type="button" class=${`mon-icone-btn ${perigo ? 'mon-icone-btn--perigo' : ''}`} title=${titulo} aria-label=${titulo} disabled=${desabilitado} onClick=${onClick}>
      <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(icone)}</span>
    </button>`;
}

export function TelaFormularios({ controlador, contexto, showToast }) {
  const podeEditar = controlador.possuiPermissao('monitoria.matriz');
  const ativas = (contexto?.operacoes || []).filter((o) => o.ativo);
  const [operacao, setOperacao] = useState(ativas[0]?.chave || '');
  const [versoes, setVersoes] = useState(null);
  const [idVersao, setIdVersao] = useState('');
  const [versao, setVersao] = useState(null);
  const [config, setConfig] = useState(null);
  const [editando, setEditando] = useState(false);
  const [criando, setCriando] = useState(false);
  const [visualizando, setVisualizando] = useState(null);
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [fechados, setFechados] = useState({});

  const cancelarEdicao = () => {
    setEditando(false);
    setCriando(false);
    setObservacao('');
    if (versao) setConfig(clonar(versao.config));
  };

  // Lista as versões do formulário da operação (a ativa vem selecionada).
  useEffect(() => {
    if (!operacao) return;
    let ativo = true;
    setVersoes(null);
    setVersao(null);
    setConfig(null);
    listarVersoesMatriz(operacao)
      .then((r) => {
        if (!ativo) return;
        const itens = r.itens || [];
        setVersoes(itens);
        setIdVersao((atual) => (itens.some((v) => String(v.id_versao) === String(atual)) ? atual : String(itens.find((v) => v.ativa)?.id_versao || itens[0]?.id_versao || '')));
      })
      .catch((e) => { if (ativo) { setVersoes([]); showToast(e?.message || 'Erro ao carregar os formulários.', 'danger'); } });
    return () => { ativo = false; };
  }, [operacao, recarga]);

  // Carrega a versão escolhida no segundo select.
  useEffect(() => {
    if (!idVersao) return;
    let ativo = true;
    lerVersaoMatriz(idVersao)
      .then((v) => { if (ativo) { setVersao(v); setConfig(clonar(v.config)); } })
      .catch((e) => { if (ativo) showToast(e?.message || 'Erro ao carregar o formulário.', 'danger'); });
    return () => { ativo = false; };
  }, [idVersao]);

  const erros = [];
  if (config && !(config.blocos || []).length) erros.push('O formulário precisa de ao menos um bloco.');
  (config?.blocos || []).forEach((b) => {
    if (!String(b.nome || '').trim()) erros.push('Todo bloco precisa de um nome.');
    else if ((b.criterios || []).some((c) => !String(c.texto || '').trim())) erros.push(`${b.nome}: preencha o texto de todas as perguntas ou remova as vazias.`);
    if (Math.abs(somaPesos(b) - Number(b.valor || 0)) > 0.0001) erros.push(`${b.nome || 'Bloco'}: a soma dos pesos (${formatarNota(somaPesos(b))}) deve ser igual ao valor do bloco (${formatarNota(b.valor)}).`);
  });
  const alterou = Boolean(config && versao && (criando || JSON.stringify(config) !== JSON.stringify(versao.config)));
  const versaoAtiva = (versoes || []).find((v) => v.ativa);

  const setBloco = (i, campo, valor) => setConfig({ ...config, blocos: config.blocos.map((b, j) => (j === i ? { ...b, [campo]: valor } : b)) });
  const setCriterio = (i, k, campo, valor) => setConfig({ ...config, blocos: config.blocos.map((b, j) => (j === i ? { ...b, criterios: b.criterios.map((c, l) => (l === k ? { ...c, [campo]: valor } : c)) } : b)) });
  const criar = () => {
    setConfig({ ...clonar(config), blocos: [BLOCO_VAZIO()] });
    setCriando(true);
    setEditando(true);
  };
  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await salvarMatriz(operacao, config, observacao);
      showToast(`Nova versão ${r.numero} criada. As monitorias antigas permanecem com a versão original.`, 'success');
      setObservacao('');
      setEditando(false);
      setCriando(false);
      setIdVersao('');
      setRecarga((x) => x + 1);
    } catch (e) { showToast(e?.message || 'Não foi possível salvar.', 'danger'); } finally { setSalvando(false); }
  };

  if (!ativas.length) return html`<${EmptyState} icon="rule" title="Sem operações" text="Você não está vinculado a nenhuma operação ativa." />`;
  const nota = versao
    ? `${criando ? 'Novo formulário' : `Versão v${versao.numero}${versaoAtiva?.id_versao === versao.id_versao ? ' (ativa)' : ' (arquivada)'}`} · Salvar cria uma nova versão; as anteriores ficam arquivadas.`
    : '';

  return html`
    <div class="mon-shell">
      <div class="mon-filtros mon-filtros--linha">
        <label class="mon-filtro mon-filtro--select">Operação<${SelectOperacao} contexto=${{ operacoes: ativas }} valor=${operacao} todas=${false} desabilitado=${editando} onChange=${(v) => { setOperacao(v); setIdVersao(''); }} /></label>
        <label class="mon-filtro mon-filtro--select">Formulário
          <select class="form-select" value=${idVersao} disabled=${editando || !versoes?.length} onChange=${(e) => setIdVersao(e.target.value)}>
            ${(versoes || []).map((v) => html`<option key=${v.id_versao} value=${String(v.id_versao)}>v${v.numero}${v.ativa ? ' · ativa' : ''}${v.observacao ? ` · ${v.observacao}` : ''}</option>`)}
          </select>
        </label>
        ${podeEditar ? html`
          <div class="mon-filtros-acoes">
            ${editando ? html`<button type="button" class="btn btn-outline-secondary" onClick=${cancelarEdicao}>Cancelar edição</button>` : html`
              <button type="button" class="btn btn-outline-primary" disabled=${!config} onClick=${criar}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Criar formulário</button>
              <button type="button" class="btn btn-primary" disabled=${!config} onClick=${() => setEditando(true)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('edit')}</span>Editar formulário</button>`}
          </div>` : null}
      </div>
      ${nota ? html`<p class="mon-alerta mon-alerta--info mon-alerta--linha" title=${nota}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('info')}</span><span>${nota}</span></p>` : null}

      ${!config ? html`<${LoadingState} titulo="Carregando formulário" />` : html`
        <div class="mon-matriz">
          <div class="mon-matriz-colunas" aria-hidden="true"><span>Pergunta</span><span>Valor / peso</span><span>${editando ? 'Ações' : ''}</span></div>
          ${config.blocos.map((b, i) => {
            const chaveBloco = b.id || i;
            const fechado = Boolean(fechados[chaveBloco]);
            const botaoDobrar = html`<button type="button" class=${`mon-bloco-toggle ${fechado ? 'is-fechado' : ''}`} aria-expanded=${!fechado} aria-label=${`${fechado ? 'Expandir' : 'Recolher'} bloco ${b.nome || ''}`.trim()}
              onClick=${() => setFechados((f) => ({ ...f, [chaveBloco]: !fechado }))}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('expand_more')}</span></button>`;
            return html`
            <section class=${`mon-matriz-bloco ${fechado ? 'is-fechado' : ''}`} key=${chaveBloco}>
              <div class="mon-matriz-linha is-bloco">
                ${editando ? html`
                  <div class="mon-bloco-nome">${botaoDobrar}<input class="form-control" aria-label="Nome do bloco" placeholder="Nome do bloco" value=${b.nome} onInput=${(e) => setBloco(i, 'nome', e.target.value)} /></div>
                  <input class="form-control" type="number" step="0.5" aria-label="Valor do bloco" value=${b.valor} onInput=${(e) => setBloco(i, 'valor', e.target.value)} />
                  <${BotaoIcone} icone="delete" titulo="Remover bloco" perigo=${true} onClick=${() => setConfig({ ...config, blocos: config.blocos.filter((_, j) => j !== i) })} />
                ` : html`<div class="mon-bloco-nome">${botaoDobrar}<strong>${b.nome}</strong>${fechado ? html`<small class="mon-muted">${b.criterios.length} pergunta(s)</small>` : null}</div><span class="mon-valor">${formatarNota(b.valor)}</span><span></span>`}
              </div>
              ${fechado ? null : html`<div class="mon-bloco-corpo">
              ${b.criterios.map((c, k) => html`
                <div class="mon-matriz-linha" key=${c.id || k}>
                  ${editando ? html`
                    <input class="form-control" aria-label="Pergunta" placeholder="Texto da pergunta" value=${c.texto} onInput=${(e) => setCriterio(i, k, 'texto', e.target.value)} />
                    <input class="form-control" type="number" step="0.5" aria-label="Peso" value=${c.peso} onInput=${(e) => setCriterio(i, k, 'peso', e.target.value)} />
                    <${BotaoIcone} icone="delete" titulo="Remover pergunta" perigo=${true} onClick=${() => setBloco(i, 'criterios', b.criterios.filter((_, l) => l !== k))} />
                  ` : html`<span>${c.texto}</span><span class="mon-valor">${formatarNota(c.peso)}</span><span></span>`}
                </div>`)}
              <div class="mon-matriz-rodape">
                <span class=${`mon-muted ${Math.abs(somaPesos(b) - Number(b.valor || 0)) > 0.0001 ? 'mon-sla--vencido' : ''}`}>Soma dos pesos: ${formatarNota(somaPesos(b))} / ${formatarNota(b.valor)}</span>
                ${editando ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setBloco(i, 'criterios', [...b.criterios, { texto: '', peso: 0 }])}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Adicionar pergunta</button>` : null}
              </div></div>`}
            </section>`;
          })}
          ${editando ? html`<button type="button" class="btn btn-outline-secondary mon-matriz-novo-bloco" onClick=${() => setConfig({ ...config, blocos: [...config.blocos, BLOCO_VAZIO()] })}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Adicionar bloco</button>` : null}
        </div>

        <${SectionCard} title="Escala e faixas de nota">
          <div class="mon-form-grid">
            <label class="mon-campo">Escala mínima<input class="form-control" type="number" disabled=${!editando} value=${config.escala.min} onInput=${(e) => setConfig({ ...config, escala: { ...config.escala, min: Number(e.target.value) } })} /></label>
            <label class="mon-campo">Escala máxima<input class="form-control" type="number" disabled=${!editando} value=${config.escala.max} onInput=${(e) => setConfig({ ...config, escala: { ...config.escala, max: Number(e.target.value) } })} /></label>
            <label class="mon-campo">Mínimo de blocos avaliados<input class="form-control" type="number" disabled=${!editando} value=${config.min_blocos} onInput=${(e) => setConfig({ ...config, min_blocos: Number(e.target.value) })} /></label>
          </div>
          <div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Faixa</th><th>De</th><th>Cor</th><th>Ação recomendada</th></tr></thead><tbody>
            ${config.faixas.map((f, i) => html`<tr key=${i}><td><input class="form-control" disabled=${!editando} value=${f.label} onInput=${(e) => setConfig({ ...config, faixas: config.faixas.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} /></td>
              <td><input class="form-control" type="number" disabled=${!editando} value=${f.min} onInput=${(e) => setConfig({ ...config, faixas: config.faixas.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)) })} /></td>
              <td><input type="color" disabled=${!editando} value=${f.cor || '#0a4b8c'} onInput=${(e) => setConfig({ ...config, faixas: config.faixas.map((x, j) => (j === i ? { ...x, cor: e.target.value } : x)) })} /></td>
              <td><input class="form-control" disabled=${!editando} value=${f.acao || ''} onInput=${(e) => setConfig({ ...config, faixas: config.faixas.map((x, j) => (j === i ? { ...x, acao: e.target.value } : x)) })} /></td></tr>`)}
          </tbody></table></div>
        </${SectionCard}>
        ${editando && erros.length ? html`<ul class="mon-erros">${erros.map((e) => html`<li key=${e}>${e}</li>`)}</ul>` : null}
        ${editando ? html`<div class="mon-acoes-fixas"><input class="form-control mon-obs-versao" placeholder="O que mudou nesta versão? (opcional)" value=${observacao} onInput=${(e) => setObservacao(e.target.value)} />
          <button type="button" class="btn btn-primary" disabled=${!alterou || erros.length > 0 || salvando} onClick=${salvar}>${salvando ? 'Salvando…' : 'Salvar como nova versão'}</button></div>` : null}
        <${SectionCard} title="Histórico de versões (somente leitura)">
          <div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Versão</th><th>Criada em</th><th>Por</th><th>Observação</th><th class="num">Monitorias</th><th></th></tr></thead><tbody>
            ${(versoes || []).map((v) => html`<tr key=${v.id_versao}><td><strong>v${v.numero}</strong> ${v.ativa ? html`<span class="mon-badge mon-badge--ok">Ativa</span>` : html`<span class="mon-badge">Arquivada</span>`}</td><td>${formatarDataHoraCurta(v.criado_em)}</td><td>${v.criado_por}</td><td>${v.observacao || '—'}</td><td class="num">${v.monitorias}</td>
              <td><button type="button" class="btn btn-link btn-sm" onClick=${async () => setVisualizando(await lerVersaoMatriz(v.id_versao))}>Ver</button></td></tr>`)}
          </tbody></table></div>
        </${SectionCard}>`}
      <${ModalPadrao} aberto=${Boolean(visualizando)} titulo=${`Formulário v${visualizando?.numero || ''} (somente leitura)`} onClose=${() => setVisualizando(null)}>
        ${visualizando ? html`<div class="mon-shell">${visualizando.config.blocos.map((b) => html`<div key=${b.id}><strong>${b.nome}</strong> <span class="mon-muted">(peso ${formatarNota(b.valor)})</span><ul>${b.criterios.map((c) => html`<li key=${c.id}>${c.texto} — ${formatarNota(c.peso)}</li>`)}</ul></div>`)}</div>` : null}
      </${ModalPadrao}>
    </div>`;
}
