import { html, useEffect, useMemo, useState } from '../../../infraestrutura-react.js';
import { LoadingState } from '../../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../../ui/icone.js';
import { duplicarEscalaWfm, excluirEscalaWfm, lerConfigEscalaWfm, salvarConfigEscalaWfm } from '../../../services/api/wfm.js';
import { Campo, Marca, ModalForm } from './formulario.js';

// Configurações da escala: nome, ativa/inativa, jornada (escala de trabalho), duplicar, excluir e QUEM aprova. Cada aprovador é escolhido em dois selects
// lado a lado: o Perfil e o Usuário (a lista de usuários acompanha o perfil escolhido). "Todos do perfil" aprova
// por perfil; escolhendo um usuário, só ele. Sem nenhum aprovador vale o padrão: Supervisor ou Gestor.
// Quem decide é sempre o servidor.

const ROTULO_PERFIL = { supervisor: 'Supervisor', gestor: 'Gestor', analista_ti: 'Analista de TI' };
const ROTULO_PLURAL = { supervisor: 'Todos os Supervisores', gestor: 'Todos os Gestores', analista_ti: 'Analista de TI' };

export function ModalConfigEscala({ operacao, nomePadrao, onClose, onSalvo, onMudouLista, showToast }) {
  const [cfg, setCfg] = useState(null);
  const [nome, setNome] = useState('');
  const [perfis, setPerfis] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [perfilSel, setPerfilSel] = useState('');
  const [usuarioSel, setUsuarioSel] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [ativa, setAtiva] = useState(true);
  const [idContrato, setIdContrato] = useState('');
  const [trocaDias, setTrocaDias] = useState('3');
  const [destino, setDestino] = useState('');
  const [nomeCopia, setNomeCopia] = useState('');
  const [confirmaExcluir, setConfirmaExcluir] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let ativo = true;
    lerConfigEscalaWfm(operacao).then((c) => {
      if (!ativo) return;
      setCfg(c); setNome(c.nome_escala || ''); setPerfis(c.aprovadores.perfis || []); setUsuarios(c.aprovadores.usuarios || []);
      setAtiva(c.ativa !== false); setIdContrato(c.id_contrato ? String(c.id_contrato) : ''); setTrocaDias(String(c.troca_antecedencia_dias ?? 3)); setDestino((c.operacoes_destino || [])[0]?.chave || '');
    }).catch((e) => ativo && setErro(e?.message || 'Não foi possível carregar as configurações.'));
    return () => { ativo = false; };
  }, [operacao]);

  const candidatos = cfg?.candidatos || [];
  const perfisDisponiveis = useMemo(() => [...new Set(candidatos.map((c) => c.perfil))].filter((p) => ROTULO_PERFIL[p]), [candidatos]);
  // Usuários do perfil escolhido; sem perfil, todos. Quem já foi adicionado sai da lista.
  const usuariosDoPerfil = candidatos.filter((c) => (!perfilSel || c.perfil === perfilSel) && !usuarios.includes(c.id_usuario));
  const nomeDe = (id) => candidatos.find((c) => c.id_usuario === id);
  const podeEditar = cfg?.pode_editar;

  const trocarPerfil = (valor) => {
    setPerfilSel(valor);
    const atual = candidatos.find((c) => String(c.id_usuario) === usuarioSel);
    if (atual && valor && atual.perfil !== valor) setUsuarioSel('');
  };
  const trocarUsuario = (valor) => {
    setUsuarioSel(valor);
    const u = candidatos.find((c) => String(c.id_usuario) === valor);
    if (u) setPerfilSel(u.perfil);
  };
  const adicionar = () => {
    if (usuarioSel) setUsuarios([...usuarios, Number(usuarioSel)]);
    else if (perfilSel && !perfis.includes(perfilSel)) setPerfis([...perfis, perfilSel]);
    else return;
    setPerfilSel(''); setUsuarioSel('');
  };
  const salvar = async (ev) => {
    ev.preventDefault();
    if (!podeEditar) { onClose(); return; }
    setErro('');
    setSalvando(true);
    try {
      await salvarConfigEscalaWfm({
        operacao, nome_escala: nome, perfis, usuarios,
        ...(podeEditar && trocaDias !== '' ? { troca_antecedencia_dias: Math.max(0, Math.min(30, Number(trocaDias))) } : {}),
        ...(cfg.pode_gerir ? { ativa, alterar_jornada: true, id_contrato: idContrato ? Number(idContrato) : null } : {}),
      });
      showToast?.('Configurações da escala salvas.', 'success');
      onSalvo();
    } catch (e) { setErro(e?.message || 'Não foi possível salvar.'); } finally { setSalvando(false); }
  };

  const duplicar = async () => {
    setErro('');
    setOcupado(true);
    try {
      const r = await duplicarEscalaWfm({ operacao, operacao_destino: destino, nome: nomeCopia.trim() });
      showToast?.(`Escala duplicada como "${r.nome}".`, 'success');
      onMudouLista?.(r.chave);
    } catch (e) { setErro(e?.message || 'Não foi possível duplicar a escala.'); } finally { setOcupado(false); }
  };
  const excluir = async () => {
    setErro('');
    setOcupado(true);
    try {
      await excluirEscalaWfm(operacao);
      showToast?.('Escala excluída.', 'success');
      onMudouLista?.(null);
    } catch (e) { setErro(e?.message || 'Não foi possível excluir a escala.'); setConfirmaExcluir(false); } finally { setOcupado(false); }
  };

  const total = perfis.length + usuarios.length;
  return html`<${ModalForm} titulo="Configurações da escala" onClose=${onClose} onSubmit=${salvar} erro=${erro} salvando=${salvando} salvarRotulo=${podeEditar === false ? 'Fechar' : 'Salvar'}>
    ${!cfg && !erro ? html`<${LoadingState} titulo="Carregando" />` : cfg ? html`
      <div class="wfm-grade-form">
        <${Campo} rotulo="Nome da escala" span=${12} dica="Aparece no título da tela e nos arquivos exportados.">
          <input class="form-control" maxlength="120" disabled=${!podeEditar} value=${nome} onInput=${(e) => setNome(e.target.value)} placeholder=${nomePadrao} />
        </${Campo}>
        <${Campo} rotulo="Antecedência mínima para trocas (dias)" span=${12} dica="A troca de plantão pode ser pedida em qualquer dia, desde que falte pelo menos este número de dias para o turno. Padrão: 3.">
          <input class="form-control" type="number" min="0" max="30" disabled=${!podeEditar} value=${trocaDias} onInput=${(e) => setTrocaDias(e.target.value)} />
        </${Campo}>
        ${cfg.pode_gerir ? html`
          <${Campo} rotulo="Escala de trabalho (jornada)" span=${8} dica="Jornada aplicada a quem não tem contrato próprio nesta escala.">
            <select class="form-select" value=${idContrato} onChange=${(e) => setIdContrato(e.target.value)}>
              <option value="">Nenhuma</option>
              ${(cfg.contratos || []).map((c) => html`<option key=${c.id_contrato} value=${c.id_contrato}>${c.codigo} · ${c.nome}</option>`)}
            </select>
          </${Campo}>
          <${Marca} rotulo="Escala ativa" span=${4} checked=${ativa} onChange=${setAtiva} />` : null}
      </div>
      ${cfg.pode_gerir && !ativa ? html`<p class="mon-muted">Escala inativa: some das telas de operação e não aceita alterações. Reative para voltar a editar.</p>` : null}

      <section class="wfm-aprovadores" aria-label="Quem aprova esta escala">
        <h4>Quem aprova esta escala</h4>
        <p class="mon-muted">Escolha o perfil e/ou o usuário e clique em Adicionar. Sem nenhum aprovador, qualquer Supervisor ou Gestor aprova. Ninguém aprova a escala que enviou.</p>
        ${podeEditar ? html`<div class="wfm-grade-form wfm-aprovadores-form">
          <${Campo} rotulo="Perfil" span=${4}>
            <select class="form-select" value=${perfilSel} onChange=${(e) => trocarPerfil(e.target.value)}>
              <option value="">Selecione</option>
              ${perfisDisponiveis.map((p) => html`<option key=${p} value=${p}>${ROTULO_PERFIL[p]}</option>`)}
            </select>
          </${Campo}>
          <${Campo} rotulo="Usuário" span=${5} dica="A lista acompanha o perfil escolhido ao lado.">
            <select class="form-select" value=${usuarioSel} onChange=${(e) => trocarUsuario(e.target.value)}>
              <option value="">${perfilSel ? `Todos (${ROTULO_PERFIL[perfilSel]})` : 'Selecione'}</option>
              ${usuariosDoPerfil.map((c) => html`<option key=${c.id_usuario} value=${c.id_usuario}>${c.nome}${perfilSel ? '' : ` · ${ROTULO_PERFIL[c.perfil] || c.perfil}`}</option>`)}
            </select>
          </${Campo}>
          <div class="wfm-aprovadores-add" style=${{ gridColumn: 'span 3' }}>
            <button type="button" class="btn btn-outline-primary" disabled=${!perfilSel && !usuarioSel} onClick=${adicionar}>
              <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Adicionar
            </button>
          </div>
        </div>` : null}

        <div class="wfm-aprovadores-chips" aria-live="polite">
          ${total ? [
            ...perfis.map((p) => html`<span key=${`p-${p}`} class="wfm-aprovador-chip"><span>${ROTULO_PLURAL[p] || p}</span>${podeEditar ? html`<button type="button" aria-label=${`Remover ${ROTULO_PLURAL[p] || p}`} onClick=${() => setPerfis(perfis.filter((x) => x !== p))}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('close')}</span></button>` : null}</span>`),
            ...usuarios.map((id) => { const c = nomeDe(id); return html`<span key=${`u-${id}`} class="wfm-aprovador-chip"><span>${c ? c.nome : `Usuário ${id}`}${c ? html` <small>${ROTULO_PERFIL[c.perfil] || c.perfil}</small>` : null}</span>${podeEditar ? html`<button type="button" aria-label=${`Remover ${c ? c.nome : id}`} onClick=${() => setUsuarios(usuarios.filter((x) => x !== id))}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('close')}</span></button>` : null}</span>`; }),
          ] : html`<span class="mon-muted">Padrão: qualquer Supervisor ou Gestor.</span>`}
        </div>
      </section>

      ${cfg.pode_gerir ? html`
        <section class="wfm-aprovadores" aria-label="Duplicar escala">
          <h4>Duplicar escala</h4>
          <p class="mon-muted">Cria uma nova escala com o nome, a jornada, os turnos de trabalho e os aprovadores desta (não copia colaboradores nem lançamentos).</p>
          <div class="wfm-grade-form wfm-aprovadores-form">
            <${Campo} rotulo="Para a operação" span=${5}>
              <select class="form-select" value=${destino} onChange=${(e) => setDestino(e.target.value)}>
                ${(cfg.operacoes_destino || []).map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}
              </select>
            </${Campo}>
            <${Campo} rotulo="Nome da cópia (opcional)" span=${4}>
              <input class="form-control" maxlength="120" value=${nomeCopia} onInput=${(e) => setNomeCopia(e.target.value)} />
            </${Campo}>
            <div class="wfm-aprovadores-add" style=${{ gridColumn: 'span 3' }}>
              <button type="button" class="btn btn-outline-primary" disabled=${ocupado || !destino} onClick=${duplicar}>
                <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('content_copy')}</span>Duplicar
              </button>
            </div>
          </div>
        </section>

        <section class="wfm-aprovadores wfm-zona-risco" aria-label="Excluir escala">
          <h4>Excluir escala</h4>
          <p class="mon-muted">Escala sem lançamentos é apagada de vez. Escala com histórico (versões publicadas, presenças, trocas) sai das telas, mas o histórico é preservado.</p>
          ${confirmaExcluir ? html`<div class="wfm-acoes"><span>Excluir esta escala?</span>
            <button type="button" class="btn btn-danger btn-sm" disabled=${ocupado} onClick=${excluir}>Sim, excluir</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setConfirmaExcluir(false)}>Não</button></div>`
            : html`<div><button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => setConfirmaExcluir(true)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('delete')}</span>Excluir escala</button></div>`}
        </section>` : null}` : null}
  </${ModalForm}>`;
}
