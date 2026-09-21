import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { LoadingState, SectionCard } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import {
  enviarLogoOperacao,
  executarZonaDeRisco,
  lerConfigMonitoria,
  listarGuia,
  listarIdentidadeOperacoes,
  salvarConfigMonitoria,
  salvarCorOperacao,
  salvarGuia,
} from '../../services/api/monitoria.js';
import { SelectOperacao } from './comum.js';

// Central de Monitoria (Configurações, só Administrador): prazos e alertas, identidade
// visual por operação e Zona de risco na aba "Geral"; guia de processos em aba própria.
// A zona de risco só mexe em CONFIGURAÇÃO — monitorias, feedbacks, contestações e logs
// nunca são apagados.

const ACOES_RISCO = [
  ['restaurar_matriz', 'Restaurar a matriz ao padrão', 'Cria uma NOVA versão com o formulário padrão. As versões anteriores e todas as monitorias permanecem intactas.'],
  ['remover_identidade', 'Remover cor e logo da operação', 'A operação volta ao tema padrão do Conecta.'],
  ['redefinir_guia', 'Redefinir o guia de processos', 'Arquiva os tópicos atuais e recria o texto padrão do guia.'],
  ['desativar_operacao', 'Desativar a operação', 'Nenhuma edição será permitida enquanto estiver inativa (só reativação pelo Administrador). O histórico permanece.'],
];

const ABAS = [
  ['geral', 'Geral', 'tune'],
  ['guia', 'Guia de processos', 'menu_book'],
];

export function TelaCentralMonitoria({ contexto, showToast, recarregarContexto }) {
  const [aba, setAba] = useState('geral');
  const [config, setConfig] = useState(null);
  const [limiar, setLimiar] = useState(75);
  const [guia, setGuia] = useState([]);
  const [identidade, setIdentidade] = useState([]);
  const [operacao, setOperacao] = useState('');
  const [cor, setCor] = useState('#0a4b8c');
  const [risco, setRisco] = useState({ acao: 'restaurar_matriz', confirmacao: '', justificativa: '' });
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    lerConfigMonitoria().then((c) => { setConfig(c); setLimiar(c.limiar_alerta_pct); }).catch((e) => showToast(e?.message || 'Erro ao carregar a configuração.', 'danger'));
    listarGuia(true).then((r) => setGuia(r.itens || [])).catch(() => setGuia([]));
    listarIdentidadeOperacoes().then((r) => setIdentidade(r.itens || [])).catch(() => setIdentidade([]));
  }, [recarga]);

  const primeiraAtiva = (contexto?.operacoes || []).find((o) => o.ativo)?.chave || '';
  useEffect(() => { if (!operacao && primeiraAtiva) setOperacao(primeiraAtiva); }, [primeiraAtiva]);
  const atual = identidade.find((i) => i.chave === operacao);
  useEffect(() => { if (atual?.cor_primaria) setCor(atual.cor_primaria); }, [operacao, atual?.cor_primaria]);
  const executar = async (fn, msg) => { try { await fn(); showToast(msg, 'success'); setRecarga((r) => r + 1); recarregarContexto?.(); } catch (e) { showToast(e?.message || 'Não foi possível concluir.', 'danger'); } };

  if (!config) return html`<${LoadingState} titulo="Carregando a Central de Monitoria" />`;
  const ativas = (contexto?.operacoes || []).filter((o) => o.ativo);
  const acaoRisco = ACOES_RISCO.find(([k]) => k === risco.acao);

  return html`
    <div class="mon-central">
      <div class="cfg-subabas" role="tablist" aria-label="Seções da Central de Monitoria">
        ${ABAS.map(([id, rotulo, icone]) => html`
          <button key=${id} type="button" role="tab" aria-selected=${aba === id} class=${`cfg-subaba ${aba === id ? 'is-active' : ''}`} onClick=${() => setAba(id)}>
            <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(icone)}</span>${rotulo}
          </button>`)}
      </div>

      ${aba === 'geral' ? html`
        <p class="mon-alerta mon-alerta--info mon-alerta--linha"><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('info')}</span><span>Não há dados legados a importar: a planilha anterior estava vazia. A Monitoria começa do zero neste banco.</span></p>

        <${SectionCard} title="Prazos (SLA) e alertas">
          <div class="mon-central-corpo">
            <p class="mon-muted">Prazos oficiais em horas corridas (24x7): feedback <strong>${config.prazos_oficiais_horas.FEEDBACK}h</strong>, confirmação/contestação do operador <strong>${config.prazos_oficiais_horas.CONFIRMACAO}h</strong>, reanálise <strong>${config.prazos_oficiais_horas.REANALISE}h</strong>. Os prazos não são editáveis; apenas o limiar de alerta.</p>
            <div class="mon-linha-form">
              <label class="mon-campo"><span>Alertar ao consumir (% do prazo)</span><input class="form-control" type="number" min="10" max="99" value=${limiar} onInput=${(e) => setLimiar(Number(e.target.value))} /></label>
              <div class="mon-linha-form-acao"><button type="button" class="btn btn-primary" onClick=${() => executar(() => salvarConfigMonitoria({ limiar_alerta_pct: limiar }), 'Limiar atualizado.')}>Salvar</button></div>
            </div>
          </div>
        </${SectionCard}>

        <${SectionCard} title="Identidade visual por operação">
          <div class="mon-central-corpo">
            <p class="mon-muted">A cor primária e a logo valem somente no ambiente da própria operação. Tags de status, fundo branco e cores de alerta não mudam. Cores sem contraste suficiente para botões com texto branco são recusadas.</p>
            <div class="mon-form-grid mon-form-grid--3">
              <label class="mon-campo"><span>Operação</span><${SelectOperacao} contexto=${{ operacoes: ativas }} valor=${operacao} todas=${false} onChange=${setOperacao} /></label>
              ${operacao ? html`
                <div class="mon-campo"><span>Cor primária</span>
                  <div class="mon-cor-linha"><input type="color" aria-label="Escolher cor" value=${cor} onInput=${(e) => setCor(e.target.value)} /><input class="form-control" aria-label="Código da cor" value=${cor} onInput=${(e) => setCor(e.target.value)} /></div></div>
                <label class="mon-campo"><span>Logo (PNG ou JPG, até 1 MB)</span><input type="file" class="form-control" accept=".png,.jpg,.jpeg"
                  onChange=${(e) => { const f = e.target.files?.[0]; if (f) executar(() => enviarLogoOperacao(operacao, f), 'Logo atualizada.'); e.target.value = ''; }} /></label>` : null}
            </div>
            ${operacao && atual ? html`
              <div class="mon-identidade-atual">
                ${atual.logo_arquivo ? html`<img class="mon-logo-preview" alt="Logo da operação" src=${`/monitoria/logos/${atual.logo_arquivo}`} />` : html`<span class="mon-muted">Sem logo: usa a logo padrão do Conecta.</span>`}
                <span class="mon-cor-amostra" style=${{ background: atual.cor_primaria || 'transparent' }}></span><span class="mon-muted">${atual.cor_primaria || 'Cor padrão do Conecta'}</span>
              </div>
              <div class="mon-form-rodape"><button type="button" class="btn btn-primary" onClick=${() => executar(() => salvarCorOperacao(operacao, cor), 'Cor da operação atualizada.')}>Aplicar cor</button></div>` : null}
          </div>
        </${SectionCard}>

        <div class="mon-risco">
          <h3>Zona de risco</h3>
          <p class="mon-muted">Somente ações sobre configuração, com dupla confirmação e registro em log. Monitorias finalizadas, feedbacks, contestações, planos e logs jamais são apagados (imutabilidade).</p>
          <div class="mon-form-grid">
            <label class="mon-campo"><span>Ação</span><select class="form-select" value=${risco.acao} onChange=${(e) => setRisco({ ...risco, acao: e.target.value })}>${ACOES_RISCO.map(([k, r]) => html`<option key=${k} value=${k}>${r}</option>`)}</select></label>
            <label class="mon-campo"><span>Operação</span><${SelectOperacao} contexto=${{ operacoes: ativas }} valor=${operacao} todas=${false} onChange=${setOperacao} /></label>
            <label class="mon-campo"><span>Digite a chave da operação para confirmar</span><input class="form-control" value=${risco.confirmacao} placeholder=${operacao} onInput=${(e) => setRisco({ ...risco, confirmacao: e.target.value })} /></label>
            <label class="mon-campo"><span>Justificativa</span><input class="form-control" value=${risco.justificativa} onInput=${(e) => setRisco({ ...risco, justificativa: e.target.value })} /></label>
          </div>
          <p class="mon-muted">${acaoRisco?.[2]}</p>
          <div class="mon-form-rodape"><button type="button" class="btn btn-outline-danger" disabled=${!operacao || risco.confirmacao !== operacao || risco.justificativa.trim().length < 5}
            onClick=${() => executar(async () => { await executarZonaDeRisco(risco.acao, { operacao, ...risco }); setRisco({ ...risco, confirmacao: '', justificativa: '' }); }, 'Ação executada e registrada no log.')}>Executar ação</button></div>
        </div>` : html`<${AbaGuia} guia=${guia} executar=${executar} />`}
    </div>`;
}

// Guia de processos: um bloco dobrável por tópico (título, ordem, conteúdo com altura
// ajustável e visibilidade). "Expandir/Recolher tudo" abre ou fecha todos de uma vez.
function AbaGuia({ guia, executar }) {
  const [abertos, setAbertos] = useState({});
  const todosAbertos = guia.length > 0 && guia.every((g) => abertos[g.id_guia]);
  const alternarTodos = () => setAbertos(Object.fromEntries(guia.map((g) => [g.id_guia, !todosAbertos])));
  return html`
    <div class="mon-guia">
      <div class="mon-guia-topo">
        <p class="mon-muted">Conteúdo interno exibido na Central de Ajuda. Editável sem alterar o código; ${guia.length} tópico(s).</p>
        ${guia.length ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${alternarTodos}>${todosAbertos ? 'Recolher tudo' : 'Expandir tudo'}</button>` : null}
      </div>
      <div class="mon-guia-lista">
        ${guia.map((g) => html`<${ItemGuia} key=${g.id_guia} item=${g} aberto=${Boolean(abertos[g.id_guia])} onAlternar=${(v) => setAbertos((a) => ({ ...a, [g.id_guia]: v }))}
          onSalvar=${(dados) => executar(() => salvarGuia(dados, g.id_guia), 'Tópico salvo.')} />`)}
        <${ItemGuia} item=${{ titulo: '', conteudo: '', ordem: guia.length + 1, ativo: true }} novo=${true} onSalvar=${(dados) => executar(() => salvarGuia(dados), 'Tópico criado.')} />
      </div>
    </div>`;
}

function ItemGuia({ item, onSalvar, novo = false, aberto, onAlternar }) {
  const [f, setF] = useState(item);
  const [abertoLocal, setAbertoLocal] = useState(false);
  useEffect(() => setF(item), [item.id_guia, item.titulo, item.conteudo]);
  const estaAberto = novo ? abertoLocal : aberto;
  const alternar = (v) => (novo ? setAbertoLocal(v) : onAlternar(v));
  return html`
    <details class=${`mon-guia-item ${f.ativo ? '' : 'is-oculto'}`} open=${estaAberto} onToggle=${(e) => { if (e.target === e.currentTarget && e.currentTarget.open !== estaAberto) alternar(e.currentTarget.open); }}>
      <summary>
        <span class="mon-guia-ordem">${novo ? '+' : f.ordem}</span>
        <span class="mon-guia-titulo">${novo ? 'Novo tópico' : item.titulo || 'Sem título'}</span>
        ${!novo && !f.ativo ? html`<span class="mon-badge">Oculto</span>` : null}
      </summary>
      <div class="mon-guia-corpo">
        <div class="mon-guia-linha">
          <label class="mon-campo"><span>Título</span><input class="form-control" value=${f.titulo} onInput=${(e) => setF({ ...f, titulo: e.target.value })} /></label>
          <label class="mon-campo mon-campo--curto"><span>Ordem</span><input class="form-control" type="number" value=${f.ordem} onInput=${(e) => setF({ ...f, ordem: Number(e.target.value) })} /></label>
        </div>
        <label class="mon-campo"><span>Conteúdo</span><textarea class="form-control mon-guia-texto" rows="4" value=${f.conteudo} onInput=${(e) => setF({ ...f, conteudo: e.target.value })}></textarea></label>
        <div class="mon-form-rodape mon-form-rodape--entre">
          ${!novo ? html`<label class="mon-check"><input type="checkbox" checked=${f.ativo} onChange=${(e) => setF({ ...f, ativo: e.target.checked })} /> Visível na Central de Ajuda</label>` : html`<span></span>`}
          <button type="button" class="btn btn-outline-primary btn-sm" disabled=${!f.titulo.trim() || !f.conteudo.trim()}
            onClick=${() => { onSalvar(f); if (novo) setF({ titulo: '', conteudo: '', ordem: f.ordem + 1, ativo: true }); }}>${novo ? 'Adicionar tópico' : 'Salvar tópico'}</button>
        </div>
      </div>
    </details>`;
}
