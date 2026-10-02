import { html, useEffect, useRef, useState } from '../../infraestrutura-react.js';
import { ModalPadrao } from '../../ui/components/modals.js?v=20260921-hdr';
import { IconeSvg } from '../../ui/icone.js';
import { baixarArquivo } from '../monitoria/comum.js';
import { baixarModeloUsuariosEmMassa, enviarPlanilhaUsuarios } from '../../services/api/settings.js';

// Configurações > Usuários > Ações > Cadastro em massa.
// 1) baixa a planilha modelo; 2) envia a planilha preenchida e vê a prévia (quem será incluído e quem foi ignorado, com o
// motivo); 3) confirma. A análise e as regras vivem no servidor; a senha da planilha nunca volta para a tela.

const lista = (itens) => (itens && itens.length ? itens.join(', ') : '—');

export function ModalCadastroEmMassa({ aberto, onClose, onFeito }) {
  const [etapa, setEtapa] = useState('envio'); // envio | previa | concluido
  const [arquivo, setArquivo] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const campoArquivo = useRef(null);

  useEffect(() => {
    if (!aberto) return;
    setEtapa('envio'); setArquivo(null); setResultado(null); setErro(''); setOcupado(false);
  }, [aberto]);

  const baixarModelo = async () => {
    setErro('');
    try { baixarArquivo(await baixarModeloUsuariosEmMassa()); } catch (e) { setErro(e?.message || 'Não foi possível baixar o modelo.'); }
  };
  const executar = async (confirmar) => {
    if (!arquivo) { setErro('Escolha a planilha preenchida (.xlsx).'); return; }
    setErro('');
    setOcupado(true);
    try {
      const r = await enviarPlanilhaUsuarios(arquivo, confirmar);
      setResultado(r);
      setEtapa(confirmar ? 'concluido' : 'previa');
    } catch (e) { setErro(e?.message || 'Não foi possível processar a planilha.'); } finally { setOcupado(false); }
  };
  const fechar = () => { if (etapa === 'concluido') onFeito?.(resultado); onClose(); };

  const validos = resultado?.validos || [];
  const ignorados = resultado?.ignorados || [];
  return html`<${ModalPadrao} aberto=${aberto} titulo="Cadastro de usuários em massa" onClose=${fechar} className="wfm-modal usuarios-massa-modal">
    <div class="wfm-form-modal">
      ${etapa === 'envio' ? html`
        <ol class="mon-muted" style=${{ paddingLeft: '24px', margin: 0 }}>
          <li>Baixe a planilha modelo e preencha uma linha por usuário, com todas as colunas.</li>
          <li>Envie a planilha preenchida. O Conecta analisa e mostra quem será incluído.</li>
          <li>Linhas incompletas ou que não puderem ser interpretadas são ignoradas.</li>
        </ol>
        <div class="wfm-acoes">
          <button type="button" class="btn btn-outline-secondary" onClick=${baixarModelo}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('download')}</span>Baixar planilha modelo</button>
        </div>
        <label class="wfm-campo"><span>Planilha preenchida (.xlsx)</span>
          <input ref=${campoArquivo} class="form-control" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange=${(e) => { setArquivo(e.target.files?.[0] || null); setErro(''); }} />
        </label>` : null}

      ${etapa === 'previa' ? html`
        <p><strong>${validos.length}</strong> usuário(s) novo(s) a incluir${ignorados.length ? html` · <strong>${ignorados.length}</strong> linha(s) ignorada(s)` : null} (de ${resultado.total_linhas} linha(s) lidas).</p>
        ${validos.length ? html`<div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Linha</th><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Acesso</th><th>Operação</th><th>Supervisor</th></tr></thead><tbody>
          ${validos.map((u) => html`<tr key=${u.linha}><td>${u.linha}</td><td>${u.nome}<small class="wfm-sub">${u.cargo}</small></td><td>${u.email}</td><td>${u.perfil}</td><td>${u.acesso}</td><td>${lista(u.operacoes)}</td><td>${lista(u.supervisores)}</td></tr>`)}
        </tbody></table></div>` : html`<div class="mon-alerta mon-alerta--danger" role="alert">Nenhuma linha válida para incluir. Corrija a planilha e envie novamente.</div>`}
        ${ignorados.length ? html`<details open>
          <summary><strong>Linhas ignoradas (${ignorados.length})</strong></summary>
          <div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Linha</th><th>Nome</th><th>E-mail</th><th>Motivo</th></tr></thead><tbody>
            ${ignorados.map((i) => html`<tr key=${i.linha}><td>${i.linha}</td><td>${i.nome}</td><td>${i.email || '—'}</td><td>${i.motivo}</td></tr>`)}
          </tbody></table></div></details>` : null}` : null}

      ${etapa === 'concluido' ? html`
        <div class="mon-alerta" role="status"><strong>${(resultado.criados || []).length}</strong> usuário(s) criado(s)${(resultado.falhas || []).length ? html`, <strong>${resultado.falhas.length}</strong> com falha` : null}${ignorados.length ? html` e ${ignorados.length} linha(s) ignorada(s)` : null}.</div>
        ${(resultado.falhas || []).length ? html`<div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Linha</th><th>Nome</th><th>Motivo</th></tr></thead><tbody>
          ${resultado.falhas.map((f) => html`<tr key=${f.linha}><td>${f.linha}</td><td>${f.nome}</td><td>${f.motivo}</td></tr>`)}
        </tbody></table></div>` : null}` : null}

      ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>` : null}
      <div class="wfm-modal-rodape">
        <div>${etapa === 'previa' ? html`<button type="button" class="btn btn-outline-secondary" disabled=${ocupado} onClick=${() => { setEtapa('envio'); setResultado(null); setErro(''); }}>Voltar</button>` : null}</div>
        <div class="wfm-acoes">
          ${etapa === 'concluido' ? html`<button type="button" class="btn btn-primary" onClick=${fechar}>Fechar</button>` : html`
            <button type="button" class="btn btn-outline-secondary" onClick=${fechar}>Cancelar</button>
            ${etapa === 'envio' ? html`<button type="button" class="btn btn-primary" disabled=${ocupado || !arquivo} onClick=${() => executar(false)}>${ocupado ? 'Analisando…' : 'Analisar planilha'}</button>` : null}
            ${etapa === 'previa' ? html`<button type="button" class="btn btn-primary" disabled=${ocupado || !validos.length} onClick=${() => executar(true)}>${ocupado ? 'Cadastrando…' : `Cadastrar ${validos.length} usuário(s)`}</button>` : null}`}
        </div>
      </div>
    </div>
  </${ModalPadrao}>`;
}
