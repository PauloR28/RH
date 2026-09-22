import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState, ModalConfirmacaoAcao, ModalPadrao, SectionCard } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import { useToast } from '../../shared/hooks/use-toast.js';
import {
  excluirTipoAtendimento,
  listarCatalogoMonitoria,
  listarTiposAtendimento,
  salvarTipoAtendimento,
} from '../../services/api/monitoria.js';
import { useContextoMonitoria } from '../monitoria/comum.js';

// Configurações > Parâmetros > "Tipos de atendimentos": cada tipo pertence a uma operação e a um
// canal de atendimento (usados no formulário de Nova monitoria). As regras de escopo e de
// duplicidade são aplicadas no backend.

const FORM_VAZIO = { id_item: null, operacao: '', id_item_canal: '', valor: '' };

export function AbaTiposAtendimento() {
  const { showToast, ToastHost } = useToast();
  const { contexto, erro: erroContexto } = useContextoMonitoria();
  const operacoes = useMemo(() => (contexto?.operacoes || []).filter((o) => o.ativo), [contexto]);
  const [itens, setItens] = useState(null);
  const [erro, setErro] = useState('');
  const [recarga, setRecarga] = useState(0);
  const [form, setForm] = useState(null);
  const [canais, setCanais] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState('');
  const [excluindo, setExcluindo] = useState(null);

  useEffect(() => {
    let ativo = true;
    listarTiposAtendimento()
      .then((r) => { if (ativo) { setItens(r.itens || []); setErro(''); } })
      .catch((e) => { if (ativo) setErro(e?.message || 'Não foi possível carregar os tipos de atendimento.'); });
    return () => { ativo = false; };
  }, [recarga]);

  const operacaoDoForm = form?.operacao || '';
  useEffect(() => {
    let ativo = true;
    if (!operacaoDoForm) {
      setCanais([]);
      return undefined;
    }
    listarCatalogoMonitoria('canal', operacaoDoForm)
      .then((r) => { if (ativo) setCanais((r.itens || []).filter((i) => i.operacao)); })
      .catch(() => { if (ativo) setCanais([]); });
    return () => { ativo = false; };
  }, [operacaoDoForm]);

  const abrirNovo = () => { setErroForm(''); setForm({ ...FORM_VAZIO }); };
  const abrirEdicao = (item) => {
    setErroForm('');
    setForm({ id_item: item.id_item, operacao: item.operacao, id_item_canal: item.id_item_canal ? String(item.id_item_canal) : '', valor: item.valor });
  };
  const fecharForm = () => { if (!salvando) setForm(null); };
  const atualizarForm = (campo, valor) => setForm((atual) => ({ ...atual, [campo]: valor }));

  const salvar = async () => {
    if (!form.operacao || !form.id_item_canal || !form.valor.trim()) {
      setErroForm('Selecione a operação e o canal de atendimento e informe o tipo de atendimento.');
      return;
    }
    setSalvando(true);
    setErroForm('');
    try {
      await salvarTipoAtendimento(
        { operacao: form.operacao, id_item_canal: Number(form.id_item_canal), valor: form.valor.trim() },
        form.id_item,
      );
      showToast(form.id_item ? 'Tipo de atendimento atualizado.' : 'Tipo de atendimento criado.', 'success');
      setForm(null);
      setRecarga((n) => n + 1);
    } catch (e) {
      setErroForm(e?.message || 'Não foi possível salvar o tipo de atendimento.');
    } finally {
      setSalvando(false);
    }
  };

  const confirmarExclusao = async () => {
    setSalvando(true);
    try {
      await excluirTipoAtendimento(excluindo.id_item);
      showToast('Tipo de atendimento excluído.', 'success');
      setExcluindo(null);
      setRecarga((n) => n + 1);
    } catch (e) {
      showToast(e?.message || 'Não foi possível excluir o tipo de atendimento.', 'danger');
    } finally {
      setSalvando(false);
    }
  };

  if (erro || erroContexto) return html`<div class="alert alert-danger">${erro || erroContexto}</div>`;
  if (!itens || !contexto) return html`<${LoadingState} titulo="Carregando tipos de atendimento" />`;

  return html`
    <${SectionCard} title="Tipos de atendimentos" className="rh-section-card--flat">
      <${ToastHost} />
      <p class="rh-admin-hint">Tipos de atendimento usados nas monitorias. Cada tipo pertence a uma operação e a um canal de atendimento.</p>
      <div class="mon-tipos-toolbar">
        <button type="button" class="btn btn-primary btn-sm" onClick=${abrirNovo} disabled=${!operacoes.length}>
          <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>
          Novo tipo de atendimento
        </button>
      </div>
      ${itens.length
      ? html`
          <div class="table-responsive">
            <table class="table rh-table-compact align-middle mb-0 mon-tipos-tabela">
              <thead>
                <tr>
                  <th>Operação</th>
                  <th>Canal de Atendimento</th>
                  <th>Tipo de atendimento</th>
                  <th class="mon-tipos-acoes-col">Ações</th>
                </tr>
              </thead>
              <tbody>
                ${itens.map((item) => html`
                  <tr key=${item.id_item}>
                    <td>${item.operacao_nome}</td>
                    <td>${item.canal || html`<span class="text-muted">Todos os canais</span>`}</td>
                    <td>${item.valor}</td>
                    <td class="mon-tipos-acoes-col">
                      <div class="mon-tipos-acoes">
                        <button type="button" class="c24-icon-btn" title="Editar" aria-label=${`Editar ${item.valor}`} onClick=${() => abrirEdicao(item)}>
                          <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('edit')}</span>
                        </button>
                        <button type="button" class="c24-icon-btn is-danger" title="Excluir" aria-label=${`Excluir ${item.valor}`} onClick=${() => setExcluindo(item)}>
                          <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('delete')}</span>
                        </button>
                      </div>
                    </td>
                  </tr>`)}
              </tbody>
            </table>
          </div>`
      : html`<${EmptyState} icon="support_agent" title="Nenhum tipo de atendimento" text="Cadastre o primeiro tipo com o botão “Novo tipo de atendimento”." />`}

      <${ModalPadrao}
        aberto=${Boolean(form)}
        titulo=${form?.id_item ? 'Editar tipo de atendimento' : 'Novo tipo de atendimento'}
        subtitulo="Escolha a operação e o canal aos quais o tipo pertence."
        onClose=${fecharForm}
      >
        ${form ? html`
          <div class="rh-action-modal-body">
            <label class="form-label" for="tipo-atend-operacao">Operação</label>
            <select id="tipo-atend-operacao" class="form-select mb-3" value=${form.operacao} disabled=${salvando}
              onChange=${(e) => setForm((atual) => ({ ...atual, operacao: e.target.value, id_item_canal: '' }))}>
              <option value="">Selecione…</option>
              ${operacoes.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}
            </select>
            <label class="form-label" for="tipo-atend-canal">Canal de Atendimento</label>
            <select id="tipo-atend-canal" class="form-select mb-3" value=${form.id_item_canal} disabled=${salvando || !form.operacao}
              onChange=${(e) => atualizarForm('id_item_canal', e.target.value)}>
              <option value="">${form.operacao ? 'Selecione…' : 'Escolha a operação primeiro'}</option>
              ${canais.map((c) => html`<option key=${c.id_item} value=${String(c.id_item)}>${c.valor}</option>`)}
            </select>
            <label class="form-label" for="tipo-atend-valor">Tipo de atendimento</label>
            <input id="tipo-atend-valor" type="text" class="form-control mb-3" maxLength=${120} placeholder="Ex.: Dúvida sobre fatura"
              value=${form.valor} disabled=${salvando} onInput=${(e) => atualizarForm('valor', e.target.value)}
              onKeyDown=${(e) => { if (e.key === 'Enter') salvar(); }} />
            ${erroForm ? html`<div class="alert alert-danger mb-0" role="alert">${erroForm}</div>` : null}
          </div>
          <footer class="rh-modal-footer">
            <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${fecharForm}>Cancelar</button>
            <button type="button" class="btn btn-primary" disabled=${salvando} onClick=${salvar}>${salvando ? 'Salvando...' : 'Salvar'}</button>
          </footer>` : null}
      </${ModalPadrao}>

      <${ModalConfirmacaoAcao}
        aberto=${Boolean(excluindo)}
        titulo="Excluir tipo de atendimento"
        descricao=${excluindo ? `Excluir “${excluindo.valor}” (${excluindo.operacao_nome}${excluindo.canal ? ` · ${excluindo.canal}` : ''})?` : ''}
        consequencia="O tipo deixa de aparecer em novas monitorias. Monitorias já realizadas não são alteradas."
        textoConfirmar="Excluir"
        tipo="destrutivo"
        carregando=${salvando}
        onClose=${() => { if (!salvando) setExcluindo(null); }}
        onConfirm=${confirmarExclusao}
      />
    </${SectionCard}>
  `;
}
