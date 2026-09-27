import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { PageIntro, PainelRh, SectionCard } from '../../ui/componentes-compartilhados.js';
import { ToggleSwitch } from '../../ui/components/primitives.js';
import { IconeSvg } from '../../ui/icone.js';
import { requisitar } from '../../services/api/core.js';

// Configurações > LGPD e Retenção (Correções 27/set/2026). Regras do RH:
// prazo contado da candidatura (ou da entrada no banco de talentos), aviso
// prévio ao Administrador e ao Gestor, exclusão definitiva dos dados.
// Contratados e candidatos em processo aberto nunca são excluídos.

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const api = {
  ler: () => requisitar('/settings/lgpd/retencao', { method: 'GET' }),
  salvar: (dados) => requisitar('/settings/lgpd/retencao', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(dados) }),
  simular: () => requisitar('/settings/lgpd/retencao/simulacao', { method: 'GET' }),
  executar: (confirmacao) =>
    requisitar('/settings/lgpd/retencao/executar', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ confirmacao }) }),
};

const CAMPOS = ['ativo', 'meses_candidatura', 'meses_banco_talentos', 'dias_aviso', 'excluir_cvs_nao_vinculados'];
const formatarData = (valor) => (valor ? new Date(valor).toLocaleDateString('pt-BR') : '—');
const formatarDataHora = (valor) => (valor ? new Date(valor).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

function TabelaPessoas({ itens }) {
  if (!itens.length) return html`<p class="text-muted small mb-0">Ninguém nesta situação hoje.</p>`;
  return html`
    <div class="table-responsive">
      <table class="table table-sm align-middle mb-0">
        <thead><tr><th>Candidato</th><th>Conta a partir de</th><th class="text-end">Dias</th><th>Prazo</th></tr></thead>
        <tbody>
          ${itens.slice(0, 200).map((item) => html`
            <tr key=${item.id_teste}>
              <td>${item.nome || item.id_teste}</td>
              <td>${item.origem === 'banco_talentos' ? 'Entrada no banco de talentos' : 'Candidatura'}</td>
              <td class="text-end">${item.dias}</td>
              <td>${formatarData(item.limite)}</td>
            </tr>`)}
        </tbody>
      </table>
      ${itens.length > 200 ? html`<p class="text-muted small">Mostrando 200 de ${itens.length}.</p>` : null}
    </div>
  `;
}

export function TelaLgpdRetencao({ controlador }) {
  const podeVer = controlador.possuiPermissao('lgpd.visualizar');
  const podeConfigurar = controlador.possuiPermissao('lgpd.configurar');
  const podeExecutar = podeConfigurar && controlador.possuiPermissao('lgpd.anonimizar');
  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState(null);
  const [previa, setPrevia] = useState(null);
  const [ocupado, setOcupado] = useState('');
  const [mensagem, setMensagem] = useState({ tipo: '', texto: '' });
  const [confirmacao, setConfirmacao] = useState('');

  const carregar = async () => {
    try {
      const dados = await api.ler();
      setConfig(dados);
      setDraft(Object.fromEntries(CAMPOS.map((c) => [c, dados[c]])));
    } catch (error) {
      setMensagem({ tipo: 'danger', texto: error?.message || 'Não foi possível carregar a retenção.' });
    }
  };
  useEffect(() => { if (podeVer) carregar(); }, []);

  const acao = async (nome, fn, sucesso) => {
    setOcupado(nome);
    setMensagem({ tipo: '', texto: '' });
    try {
      const resultado = await fn();
      if (sucesso) setMensagem({ tipo: 'success', texto: typeof sucesso === 'function' ? sucesso(resultado) : sucesso });
      return resultado;
    } catch (error) {
      setMensagem({ tipo: 'danger', texto: error?.message || 'Não foi possível concluir.' });
      return null;
    } finally {
      setOcupado('');
    }
  };

  const salvar = () => acao('salvar', async () => { await api.salvar(draft); await carregar(); }, 'Configuração salva.');
  const simular = async () => { const r = await acao('simular', api.simular); if (r) setPrevia(r); };
  const executar = () => acao('executar', async () => {
    const r = await api.executar(confirmacao);
    setConfirmacao('');
    setPrevia(null);
    await carregar();
    return r;
  }, (r) => `Execução concluída: ${r.candidaturas_excluidas} candidatura(s) excluída(s), ${r.avisos_enviados} aviso(s) enviado(s).`);

  const alterado = config && draft && CAMPOS.some((c) => draft[c] !== config[c]);
  const numero = (campo, min, max) => html`
    <input class="form-control" type="number" min=${min} max=${max} disabled=${!podeConfigurar} value=${draft?.[campo] ?? ''}
      onInput=${(e) => setDraft({ ...draft, [campo]: Number(e.target.value) })} />`;
  const ultimo = config?.ultimo_resultado;

  return html`
    <${PainelRh} screenId="screen-settings-lgpd" navAtiva="screen-settings-lgpd" controlador=${controlador} placeholderBusca="LGPD e Retenção">
      <${PageIntro} kicker="Configurações" title="LGPD e Retenção" description="Exclusão automática dos dados de candidatos após o prazo de retenção." />
      ${!podeVer ? html`<div class="alert alert-warning">Seu perfil não tem acesso às informações de LGPD.</div>` : null}
      ${mensagem.texto ? html`<div class=${`alert alert-${mensagem.tipo}`}>${mensagem.texto}</div>` : null}
      ${podeVer && draft ? html`
        <${SectionCard} title="Retenção automática de candidatos">
          <p class="text-muted small">
            Todo dia, de madrugada, os dados de quem passou do prazo são <strong>excluídos definitivamente</strong> (candidatura,
            currículo, provas, entrevistas, banco de talentos). Antes, o Administrador e o Gestor recebem um aviso. Candidatos
            aprovados/contratados e quem está em processo seletivo aberto nunca são excluídos.
          </p>
          <div class="d-flex align-items-center gap-2 mb-3">
            <${ToggleSwitch} checked=${Boolean(draft.ativo)} disabled=${!podeConfigurar} onChange=${() => setDraft({ ...draft, ativo: !draft.ativo })} />
            <strong>${draft.ativo ? 'Retenção automática ligada' : 'Retenção automática desligada'}</strong>
          </div>
          <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', alignItems: 'end' }}>
            <label class="d-grid gap-1"><span class="form-label small">Prazo após a candidatura (meses)</span>${numero('meses_candidatura', 1, 120)}</label>
            <label class="d-grid gap-1"><span class="form-label small">Prazo no banco de talentos (meses)</span>${numero('meses_banco_talentos', 1, 120)}</label>
            <label class="d-grid gap-1"><span class="form-label small">Aviso prévio (dias)</span>${numero('dias_aviso', 0, 60)}</label>
            <label class="d-flex align-items-center gap-2">
              <input type="checkbox" class="form-check-input" disabled=${!podeConfigurar} checked=${Boolean(draft.excluir_cvs_nao_vinculados)}
                onChange=${() => setDraft({ ...draft, excluir_cvs_nao_vinculados: !draft.excluir_cvs_nao_vinculados })} />
              <span class="small">Excluir também CVs recebidos que não viraram candidatura</span>
            </label>
          </div>
          <div class="d-flex flex-wrap gap-2 mt-3">
            <button type="button" class="btn btn-primary btn-sm" disabled=${!podeConfigurar || !alterado || ocupado} onClick=${salvar}>
              ${ocupado === 'salvar' ? 'Salvando...' : 'Salvar configuração'}
            </button>
            <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${Boolean(ocupado)} onClick=${simular}>
              <span class="material-symbols-outlined">${IconeSvg('visibility')}</span>
              ${ocupado === 'simular' ? 'Simulando...' : 'Simular (não apaga nada)'}
            </button>
          </div>
          <p class="text-muted small mt-3 mb-0">
            Última execução: ${formatarDataHora(config.ultima_execucao)}
            ${ultimo?.executado ? ` · ${ultimo.candidaturas_excluidas} candidatura(s) excluída(s), ${ultimo.avisos_enviados} aviso(s), ${ultimo.arquivos_apagados} arquivo(s) apagado(s)` : ''}
          </p>
        </${SectionCard}>

        ${previa ? html`
          <${SectionCard} title=${`Simulação de hoje — ${previa.total_avaliados} candidatura(s) avaliada(s), ${previa.protegidos} protegida(s)`}>
            <h3 class="h6">Seriam excluídos agora (${previa.excluir.length})</h3>
            <${TabelaPessoas} itens=${previa.excluir} />
            <h3 class="h6 mt-3">Recebem aviso prévio (${previa.avisar.length})</h3>
            <${TabelaPessoas} itens=${previa.avisar} />
            ${podeExecutar && previa.excluir.length ? html`
              <div class="alert alert-danger mt-3 mb-0">
                <p class="mb-2"><strong>Executar agora</strong> apaga definitivamente os ${previa.excluir.length} candidato(s) acima. Esta ação não pode ser desfeita (só pelo backup).</p>
                <div class="d-flex flex-wrap gap-2 align-items-center">
                  <input class="form-control form-control-sm" style=${{ maxWidth: '200px' }} placeholder="Digite EXCLUIR" value=${confirmacao}
                    onInput=${(e) => setConfirmacao(e.target.value)} />
                  <button type="button" class="btn btn-danger btn-sm" disabled=${confirmacao.trim().toUpperCase() !== 'EXCLUIR' || Boolean(ocupado)} onClick=${executar}>
                    ${ocupado === 'executar' ? 'Excluindo...' : 'Executar agora'}
                  </button>
                </div>
              </div>` : null}
          </${SectionCard}>` : null}
      ` : null}
    </${PainelRh}>
  `;
}
