import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { LoadingState, SectionCard } from '../../ui/componentes-compartilhados.js';
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

// Central de Monitoria (Configurações, só Administrador): prazos e alertas, guia de
// processos, identidade visual por operação e Zona de risco. A zona de risco só
// mexe em CONFIGURAÇÃO — monitorias, feedbacks, contestações e logs nunca são apagados.

const ACOES_RISCO = [
  ['restaurar_matriz', 'Restaurar a matriz ao padrão', 'Cria uma NOVA versão com o formulário padrão. As versões anteriores e todas as monitorias permanecem intactas.'],
  ['remover_identidade', 'Remover cor e logo da operação', 'A operação volta ao tema padrão do Conecta.'],
  ['redefinir_guia', 'Redefinir o guia de processos', 'Arquiva os tópicos atuais e recria o texto padrão do guia.'],
  ['desativar_operacao', 'Desativar a operação', 'Nenhuma edição será permitida enquanto estiver inativa (só reativação pelo Administrador). O histórico permanece.'],
];

export function TelaCentralMonitoria({ contexto, showToast, recarregarContexto }) {
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

  const atual = identidade.find((i) => i.chave === operacao);
  useEffect(() => { if (atual?.cor_primaria) setCor(atual.cor_primaria); }, [operacao, atual?.cor_primaria]);
  const executar = async (fn, msg) => { try { await fn(); showToast(msg, 'success'); setRecarga((r) => r + 1); recarregarContexto?.(); } catch (e) { showToast(e?.message || 'Não foi possível concluir.', 'danger'); } };

  if (!config) return html`<${LoadingState} titulo="Carregando a Central de Monitoria" />`;
  const ativas = (contexto?.operacoes || []).filter((o) => o.ativo);
  const acaoRisco = ACOES_RISCO.find(([k]) => k === risco.acao);

  return html`
    <div class="mon-shell">
      <div class="mon-alerta mon-alerta--info">Não há dados legados a importar: a planilha anterior estava vazia. A Monitoria começa do zero neste banco.</div>

      <${SectionCard} title="Prazos (SLA) e alertas">
        <p class="mon-muted">Prazos oficiais em horas corridas (24x7): feedback <strong>${config.prazos_oficiais_horas.FEEDBACK}h</strong>, confirmação/contestação do operador <strong>${config.prazos_oficiais_horas.CONFIRMACAO}h</strong>, reanálise <strong>${config.prazos_oficiais_horas.REANALISE}h</strong>. Os prazos não são editáveis; apenas o limiar de alerta.</p>
        <div class="mon-acoes"><label style=${{ maxWidth: '260px' }}>Alertar ao consumir (% do prazo)<input class="form-control" type="number" min="10" max="99" value=${limiar} onInput=${(e) => setLimiar(Number(e.target.value))} /></label>
          <button type="button" class="btn btn-primary" onClick=${() => executar(() => salvarConfigMonitoria({ limiar_alerta_pct: limiar }), 'Limiar atualizado.')}>Salvar</button></div>
      </${SectionCard}>

      <${SectionCard} title="Identidade visual por operação">
        <p class="mon-muted">A cor primária e a logo valem somente no ambiente da própria operação. Tags de status, fundo branco e cores de alerta não mudam. Cores sem contraste suficiente para botões com texto branco são recusadas.</p>
        <div class="mon-form-grid">
          <label>Operação<${SelectOperacao} contexto=${{ operacoes: ativas }} valor=${operacao} todas=${false} onChange=${setOperacao} /></label>
          ${operacao ? html`
            <label>Cor primária<div class="mon-acoes"><input type="color" value=${cor} onInput=${(e) => setCor(e.target.value)} /><input class="form-control" style=${{ maxWidth: '140px' }} value=${cor} onInput=${(e) => setCor(e.target.value)} /></div></label>
            <label>Logo (PNG ou JPG, até 1 MB)<input type="file" class="form-control" accept=".png,.jpg,.jpeg"
              onChange=${(e) => { const f = e.target.files?.[0]; if (f) executar(() => enviarLogoOperacao(operacao, f), 'Logo atualizada.'); e.target.value = ''; }} /></label>` : null}
        </div>
        ${operacao && atual ? html`
          <div class="mon-acoes">
            ${atual.logo_arquivo ? html`<img class="mon-logo-preview" alt="Logo da operação" src=${`/monitoria/logos/${atual.logo_arquivo}`} />` : html`<span class="mon-muted">Sem logo: usa a logo padrão do Conecta.</span>`}
            <span class="mon-cor-amostra" style=${{ background: atual.cor_primaria || 'transparent' }}></span><span class="mon-muted">${atual.cor_primaria || 'Cor padrão do Conecta'}</span>
          </div>
          <div class="mon-acoes-fixas"><button type="button" class="btn btn-primary" onClick=${() => executar(() => salvarCorOperacao(operacao, cor), 'Cor da operação atualizada.')}>Aplicar cor</button></div>` : null}
      </${SectionCard}>

      <${SectionCard} title="Guia de processos">
        <p class="mon-muted">Conteúdo interno exibido em Monitoria › Guia. Editável sem alterar o código.</p>
        ${guia.map((g) => html`<${ItemGuia} key=${g.id_guia} item=${g} onSalvar=${(dados) => executar(() => salvarGuia(dados, g.id_guia), 'Tópico salvo.')} />`)}
        <${ItemGuia} item=${{ titulo: '', conteudo: '', ordem: guia.length + 1, ativo: true }} novo=${true} onSalvar=${(dados) => executar(() => salvarGuia(dados), 'Tópico criado.')} />
      </${SectionCard}>

      <div class="mon-risco">
        <h3>Zona de risco</h3>
        <p class="mon-muted">Somente ações sobre configuração, com dupla confirmação e registro em log. Monitorias finalizadas, feedbacks, contestações, planos e logs jamais são apagados (imutabilidade).</p>
        <div class="mon-form-grid">
          <label>Ação<select class="form-select" value=${risco.acao} onChange=${(e) => setRisco({ ...risco, acao: e.target.value })}>${ACOES_RISCO.map(([k, r]) => html`<option key=${k} value=${k}>${r}</option>`)}</select></label>
          <label>Operação<${SelectOperacao} contexto=${{ operacoes: ativas }} valor=${operacao} todas=${false} onChange=${setOperacao} /></label>
          <label>Digite a chave da operação para confirmar<input class="form-control" value=${risco.confirmacao} placeholder=${operacao} onInput=${(e) => setRisco({ ...risco, confirmacao: e.target.value })} /></label>
          <label>Justificativa<input class="form-control" value=${risco.justificativa} onInput=${(e) => setRisco({ ...risco, justificativa: e.target.value })} /></label>
        </div>
        <p class="mon-muted">${acaoRisco?.[2]}</p>
        <div class="mon-acoes-fixas"><button type="button" class="btn btn-outline-danger" disabled=${!operacao || risco.confirmacao !== operacao || risco.justificativa.trim().length < 5}
          onClick=${() => executar(async () => { await executarZonaDeRisco(risco.acao, { operacao, ...risco }); setRisco({ ...risco, confirmacao: '', justificativa: '' }); }, 'Ação executada e registrada no log.')}>Executar ação</button></div>
      </div>
    </div>`;
}

function ItemGuia({ item, onSalvar, novo = false }) {
  const [f, setF] = useState(item);
  useEffect(() => setF(item), [item.id_guia, item.titulo, item.conteudo]);
  return html`
    <div class="mon-card" style=${{ marginBottom: '16px', opacity: f.ativo ? 1 : 0.6 }}>
      <div class="mon-form-grid"><label>Título<input class="form-control" value=${f.titulo} onInput=${(e) => setF({ ...f, titulo: e.target.value })} /></label>
        <label>Ordem<input class="form-control" type="number" value=${f.ordem} onInput=${(e) => setF({ ...f, ordem: Number(e.target.value) })} /></label></div>
      <label>Conteúdo<textarea class="form-control" rows="3" value=${f.conteudo} onInput=${(e) => setF({ ...f, conteudo: e.target.value })}></textarea></label>
      <div class="mon-acoes">${!novo ? html`<label class="mon-tag"><input type="checkbox" checked=${f.ativo} onChange=${(e) => setF({ ...f, ativo: e.target.checked })} /> Visível</label>` : null}
        <button type="button" class="btn btn-outline-primary btn-sm" disabled=${!f.titulo.trim() || !f.conteudo.trim()} onClick=${() => { onSalvar(f); if (novo) setF({ titulo: '', conteudo: '', ordem: f.ordem + 1, ativo: true }); }}>${novo ? 'Adicionar tópico' : 'Salvar tópico'}</button></div>
    </div>`;
}
