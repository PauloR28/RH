import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState, ModalPadrao } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import { useToast } from '../../shared/hooks/use-toast.js';
import {
  lerVinculosUsuarioMonitoria,
  listarCatalogoMonitoria,
  listarEquipesMonitoria,
  listarLogsMonitoria,
  listarUsuariosMonitoria,
  salvarCatalogoMonitoria,
  salvarEquipeMonitoria,
  transferirOperacaoUsuario,
  transferirSupervisao,
} from '../../services/api/monitoria.js';
import { SelectMultiplo, SelectOperacao, formatarDataHoraCurta, useContextoMonitoria } from '../monitoria/comum.js';
import { lerContratoOperadorWfm, listarContratosWfm } from '../../services/api/wfm.js';

// Administração da vertente Monitoria dentro de Configurações (função do Administrador):
// equipes e catálogos, logs de auditoria, vínculos do usuário (operação, equipe, turno e
// supervisores) e transferência de supervisão. As regras continuam sendo aplicadas no backend.

// ---------------------------------------------------------------------------
// Vínculos organizacionais no formulário de usuário
// ---------------------------------------------------------------------------
export const PERFIS_MONITORIA = ['operador', 'supervisor', 'qualidade', 'control_desk'];
const LIMITE_OPERACOES = { operador: 1, supervisor: 3, qualidade: 2, control_desk: 99 };
const NOME_PERFIL = { operador: 'O Operador', supervisor: 'O Supervisor', qualidade: 'A Qualidade' };
export const VINCULOS_INICIAIS = { supervisores: [], id_equipe: '', turno: '', canais: [], id_contrato: '', contrato_atual: '', vigencia_ini: '' };

// Espelha `validar_vinculos` do backend para avisar antes de gravar o usuário.
export function validarVinculosMonitoria(perfil, operacoes, vinculos) {
  const erros = [];
  if (!PERFIS_MONITORIA.includes(perfil) || perfil === 'control_desk') return erros; // vínculo do Control Desk é opcional
  const limite = LIMITE_OPERACOES[perfil];
  if (perfil === 'operador' && operacoes.length !== 1) erros.push('O Operador deve estar vinculado a exatamente 1 operação.');
  else if (operacoes.length > limite) erros.push(`${NOME_PERFIL[perfil]} pode ter no máximo ${limite} operação(ões).`);
  else if (!operacoes.length) erros.push(`${NOME_PERFIL[perfil]} precisa estar vinculado(a) a ao menos 1 operação.`);
  if (perfil === 'operador') {
    if (!vinculos.supervisores.length) erros.push('O Operador precisa de ao menos 1 supervisor responsável.');
    if (vinculos.supervisores.length > 2) erros.push('O Operador pode ter no máximo 2 supervisores.');
  }
  return erros;
}

// Campos de operação e vínculos do formulário de usuário (Configurações): operação em select
// (Operador) ou dropdown com caixas (demais perfis), supervisores, turno, equipe e canais.
export function CamposVinculosMonitoria({ perfil, idUsuario, operacoes, setOperacoes, operacoesDisponiveis = [], vinculos, setVinculos, bloqueado = false }) {
  const [supervisores, setSupervisores] = useState([]);
  const [equipes, setEquipes] = useState([]);
  const [turnos, setTurnos] = useState([]);
  const [canais, setCanais] = useState([]);
  const chavesOperacoes = operacoes.join('|');

  useEffect(() => {
    listarUsuariosMonitoria().then((r) => setSupervisores((r.itens || []).filter((u) => u.perfil === 'supervisor' && u.status === 'Ativo'))).catch(() => setSupervisores([]));
    listarEquipesMonitoria().then((r) => setEquipes(r.itens || [])).catch(() => setEquipes([]));
    listarCatalogoMonitoria('turno').then((r) => setTurnos(r.itens || [])).catch(() => setTurnos([]));
  }, []);

  // Contratos de jornada da operação do Operador (WFM). Sem permissão/sem contratos o campo fica oculto.
  const [contratosWfm, setContratosWfm] = useState([]);
  useEffect(() => {
    let ativo = true;
    if (perfil !== 'operador' || !operacoes[0]) { setContratosWfm([]); return undefined; }
    listarContratosWfm(operacoes[0]).then((r) => ativo && setContratosWfm((r.itens || []).filter((c) => c.ativo))).catch(() => ativo && setContratosWfm([]));
    return () => { ativo = false; };
  }, [perfil, operacoes[0]]);

  useEffect(() => {
    let ativo = true;
    if (!operacoes.length) {
      setCanais([]);
      return undefined;
    }
    Promise.all(operacoes.map((op) => listarCatalogoMonitoria('canal', op).then((r) => (r.itens || []).filter((i) => i.operacao)).catch(() => [])))
      .then((listas) => ativo && setCanais(listas.flat()));
    return () => { ativo = false; };
  }, [chavesOperacoes]);

  useEffect(() => {
    if (!idUsuario) {
      setVinculos(VINCULOS_INICIAIS);
      return undefined;
    }
    let ativo = true;
    lerVinculosUsuarioMonitoria(idUsuario)
      .then(async (v) => {
        // Contrato de jornada vigente (WFM): leitura tolerante — sem permissão, o campo simplesmente não aparece.
        const op = (v.operacoes || [])[0];
        const c = op ? await lerContratoOperadorWfm(op, idUsuario).catch(() => null) : null;
        const atual = c?.atual ? String(c.atual.id_contrato) : '';
        if (ativo) setVinculos({
          supervisores: (v.supervisores || []).map((s) => s.id_usuario),
          id_equipe: v.id_equipe ? String(v.id_equipe) : '',
          turno: v.turno || '',
          canais: (v.canais || []).map((c2) => c2.id_item),
          id_contrato: atual,
          contrato_atual: atual,
          vigencia_ini: '',
        });
      })
      .catch(() => ativo && setVinculos(VINCULOS_INICIAIS));
    return () => { ativo = false; };
  }, [idUsuario]);

  const ehMonitoria = PERFIS_MONITORIA.includes(perfil);
  const ehOperador = perfil === 'operador';
  const ehControlDesk = perfil === 'control_desk';
  const precisaTurno = ehOperador || perfil === 'supervisor';
  const precisaCanais = ehOperador || perfil === 'supervisor';
  const opcoesOperacao = operacoesDisponiveis.map((op) => ({ valor: op.chave || op.nome, rotulo: op.nome }));
  const equipesDaOperacao = equipes.filter((e) => e.ativo && operacoes.includes(e.operacao));
  const supervisoresDaOperacao = supervisores.filter((s) => (s.operacoes || []).some((o) => operacoes.includes(o)));
  const dica = {
    operador: 'Escolha a operação do operador; a equipe, os supervisores e os canais dependem dela.',
    supervisor: 'Marque de 1 a 3 operações.',
    qualidade: 'Marque 1 ou 2 operações.',
    control_desk: 'Na Monitoria o Control Desk enxerga todas as operações. Vincule as operações em que ele trabalha nos Turnos e Plantões.',
  }[perfil] || 'Sem seleção, o usuário mantém acesso a todas as operações.';
  const definir = (campo, valor) => setVinculos({ ...vinculos, [campo]: valor });

  // Ao trocar a operação, descarta o que só fazia sentido na operação anterior.
  const trocarOperacoes = (novas) => {
    setOperacoes(novas);
    if (!ehMonitoria) return;
    const equipeValida = equipes.some((e) => String(e.id_equipe) === String(vinculos.id_equipe) && novas.includes(e.operacao));
    const supervisoresValidos = vinculos.supervisores.filter((id) => supervisores.some((s) => s.id_usuario === id && (s.operacoes || []).some((o) => novas.includes(o))));
    setVinculos({ ...vinculos, id_equipe: equipeValida ? vinculos.id_equipe : '', supervisores: supervisoresValidos, canais: [] });
  };

  return html`
    <div class="users-drawer-field-wide mon-vinculos">
      <div class="mon-vinculos-grid">
        <div class="mon-campo">
          <span>${ehOperador ? 'Operação vinculada' : 'Operações vinculadas'}</span>
          ${ehOperador ? html`
            <select class="form-select" disabled=${bloqueado} value=${operacoes[0] || ''} onChange=${(e) => trocarOperacoes(e.target.value ? [e.target.value] : [])}>
              <option value="">Selecione a operação</option>${opcoesOperacao.map((o) => html`<option key=${o.valor} value=${o.valor}>${o.rotulo}</option>`)}
            </select>` : html`
            <${SelectMultiplo} rotulo="Operações vinculadas" opcoes=${opcoesOperacao} valores=${operacoes} onChange=${trocarOperacoes}
              desabilitado=${bloqueado} limite=${LIMITE_OPERACOES[perfil] || 0}
              placeholder=${ehControlDesk ? 'Selecione as operações (Turnos e Plantões)' : ehMonitoria ? 'Selecione as operações' : 'Todas as operações'} vazio="Nenhuma operação cadastrada." />`}
        </div>
        ${ehOperador ? html`
          <div class="mon-campo">
            <span>Supervisores responsáveis <small class="mon-muted">(1 ou 2)</small></span>
            <${SelectMultiplo} rotulo="Supervisores responsáveis" opcoes=${supervisoresDaOperacao.map((s) => ({ valor: s.id_usuario, rotulo: s.nome }))}
              valores=${vinculos.supervisores} onChange=${(lista) => definir('supervisores', lista)} desabilitado=${bloqueado} limite=${2}
              placeholder="Selecione os supervisores" vazio=${operacoes.length ? 'Nenhum supervisor nesta operação.' : 'Escolha a operação para listar os supervisores.'} />
          </div>` : null}
        ${precisaTurno ? html`
          <label class="mon-campo"><span>Turno</span>
            <select class="form-select" disabled=${bloqueado} value=${vinculos.turno} onChange=${(e) => definir('turno', e.target.value)}>
              <option value="">Sem turno</option>${turnos.map((t) => html`<option key=${t.id_item} value=${t.valor}>${t.valor}</option>`)}
            </select>
          </label>` : null}
        ${ehOperador ? html`
          <label class="mon-campo"><span>Equipe</span>
            <select class="form-select" disabled=${bloqueado || !operacoes.length} value=${vinculos.id_equipe} onChange=${(e) => definir('id_equipe', e.target.value)}>
              <option value="">Sem equipe</option>${equipesDaOperacao.map((t) => html`<option key=${t.id_equipe} value=${String(t.id_equipe)}>${t.nome}</option>`)}
            </select>
          </label>` : null}
        ${ehOperador && contratosWfm.length ? html`
          <label class="mon-campo"><span>Contrato de jornada <small class="mon-muted">(Turnos e Plantões)</small></span>
            <select class="form-select" disabled=${bloqueado} value=${vinculos.id_contrato || ''} onChange=${(e) => definir('id_contrato', e.target.value)}>
              <option value="">Sem contrato</option>${contratosWfm.map((c) => html`<option key=${c.id_contrato} value=${String(c.id_contrato)}>${c.codigo} · ${Math.floor(c.jornada_diaria_max_min / 60)}h${String(c.jornada_diaria_max_min % 60).padStart(2, '0')}</option>`)}
            </select>
          </label>
          ${vinculos.id_contrato && String(vinculos.id_contrato) !== String(vinculos.contrato_atual) ? html`
            <label class="mon-campo"><span>Contrato vale a partir de</span>
              <input class="form-control" type="date" disabled=${bloqueado} value=${vinculos.vigencia_ini || ''} onInput=${(e) => definir('vigencia_ini', e.target.value)} />
            </label>` : null}` : null}
        ${precisaCanais ? html`
          <div class="mon-campo">
            <span>Canais de atendimento</span>
            <${SelectMultiplo} rotulo="Canais de atendimento" opcoes=${canais.map((c) => ({ valor: c.id_item, rotulo: operacoes.length > 1 ? `${c.valor} (${c.operacao})` : c.valor }))}
              valores=${vinculos.canais || []} onChange=${(lista) => definir('canais', lista)} desabilitado=${bloqueado || !operacoes.length}
              placeholder="Selecione os canais" vazio="Nenhum canal cadastrado nesta operação." />
          </div>` : null}
      </div>
      <p class="mon-muted mon-vinculos-dica">${dica}</p>
    </div>`;
}

// ---------------------------------------------------------------------------
// Transferência de supervisão (ex.: férias)
// ---------------------------------------------------------------------------
export function ModalTransferirSupervisao({ aberto, onClose, onFeito, showToast }) {
  const { contexto } = useContextoMonitoria();
  const [supervisores, setSupervisores] = useState([]);
  const [f, setF] = useState({ operacao: '', id_de: '', id_para: '', justificativa: '' });
  useEffect(() => {
    if (!aberto) return;
    setF({ operacao: '', id_de: '', id_para: '', justificativa: '' });
    listarUsuariosMonitoria().then((r) => setSupervisores((r.itens || []).filter((u) => u.perfil === 'supervisor'))).catch(() => setSupervisores([]));
  }, [aberto]);
  const candidatos = supervisores.filter((s) => !f.operacao || (s.operacoes || []).includes(f.operacao));
  const ativas = (contexto?.operacoes || []).filter((o) => o.ativo);
  return html`
    <${ModalPadrao} aberto=${aberto} titulo="Transferir supervisão" subtitulo="Ex.: férias. O supervisor sai da operação, o substituto assume os operadores e as pendências abertas. As monitorias já realizadas mantêm o supervisor original." onClose=${onClose}>
      <div class="mon-form-grid">
        <label class="mon-campo">Operação<${SelectOperacao} contexto=${{ operacoes: ativas }} valor=${f.operacao} todas=${false} onChange=${(v) => setF({ ...f, operacao: v, id_de: '', id_para: '' })} /></label>
        <label class="mon-campo">Supervisor que sai<select class="form-select" value=${f.id_de} onChange=${(e) => setF({ ...f, id_de: e.target.value })}><option value="">Selecione…</option>${candidatos.map((s) => html`<option key=${s.id_usuario} value=${s.id_usuario}>${s.nome}</option>`)}</select></label>
        <label class="mon-campo">Supervisor que assume<select class="form-select" value=${f.id_para} onChange=${(e) => setF({ ...f, id_para: e.target.value })}><option value="">Selecione…</option>${supervisores.filter((s) => String(s.id_usuario) !== String(f.id_de)).map((s) => html`<option key=${s.id_usuario} value=${s.id_usuario}>${s.nome}</option>`)}</select></label>
        <label class="mon-campo">Justificativa<input class="form-control" value=${f.justificativa} onInput=${(e) => setF({ ...f, justificativa: e.target.value })} /></label>
      </div>
      <div class="mon-acoes-fixas"><button type="button" class="btn btn-primary" disabled=${!f.operacao || !f.id_de || !f.id_para}
        onClick=${async () => { try { const r = await transferirSupervisao({ ...f, id_de: Number(f.id_de), id_para: Number(f.id_para) }); showToast(`${r.operadores_transferidos} operador(es) transferido(s).`, 'success'); onFeito(); } catch (e) { showToast(e?.message || 'Erro na transferência.', 'danger'); } }}>Transferir</button></div>
    </${ModalPadrao}>`;
}

// ---------------------------------------------------------------------------
// Transferência de operação (QA T2-TRC-02/03): Operador ou Supervisor muda de
// operação. O backend valida escopo, limites e supervisores do destino.
// ---------------------------------------------------------------------------
const TRANSFERENCIA_INICIAL = { id_usuario: '', origem: '', destino: '', supervisores: [], id_substituto: '', justificativa: '' };

export function ModalTransferirOperacao({ aberto, onClose, onFeito, showToast }) {
  const { contexto } = useContextoMonitoria();
  const [usuarios, setUsuarios] = useState([]);
  const [f, setF] = useState(TRANSFERENCIA_INICIAL);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  useEffect(() => {
    if (!aberto) return;
    setF(TRANSFERENCIA_INICIAL);
    setErro('');
    listarUsuariosMonitoria()
      .then((r) => setUsuarios((r.itens || []).filter((u) => u.status === 'Ativo')))
      .catch(() => setUsuarios([]));
  }, [aberto]);

  const elegiveis = usuarios.filter((u) => u.perfil === 'operador' || u.perfil === 'supervisor');
  const usuario = elegiveis.find((u) => String(u.id_usuario) === String(f.id_usuario)) || null;
  const ativas = (contexto?.operacoes || []).filter((o) => o.ativo);
  const nomeOperacao = (chave) => ativas.find((o) => o.chave === chave)?.nome || chave;
  const destinos = ativas.filter((o) => !(usuario?.operacoes || []).includes(o.chave));
  const supervisoresDestino = usuarios.filter((u) => u.perfil === 'supervisor' && f.destino && (u.operacoes || []).includes(f.destino));
  const operadoresNaOrigem = usuario?.perfil === 'supervisor'
    ? usuarios.filter((u) => u.perfil === 'operador' && (u.operacoes || []).includes(f.origem) && (u.supervisores || []).includes(usuario.id_usuario))
    : [];
  const substitutos = usuarios.filter((u) => u.perfil === 'supervisor' && usuario && u.id_usuario !== usuario.id_usuario);

  const escolherUsuario = (id) => {
    const escolhido = elegiveis.find((u) => String(u.id_usuario) === String(id));
    const origem = escolhido && (escolhido.operacoes || []).length === 1 ? escolhido.operacoes[0] : '';
    setF({ ...TRANSFERENCIA_INICIAL, id_usuario: id, origem });
    setErro('');
  };
  const alternarSupervisor = (id) => {
    const atual = new Set(f.supervisores);
    if (atual.has(id)) atual.delete(id);
    else if (atual.size < 2) atual.add(id);
    setF({ ...f, supervisores: Array.from(atual) });
  };

  const faltando = !usuario || !f.origem || !f.destino
    || (usuario.perfil === 'operador' && !f.supervisores.length)
    || (usuario.perfil === 'supervisor' && operadoresNaOrigem.length > 0 && !f.id_substituto);

  const transferir = async () => {
    setSalvando(true);
    setErro('');
    try {
      const resultado = await transferirOperacaoUsuario(usuario.id_usuario, {
        origem: f.origem,
        destino: f.destino,
        supervisores: f.supervisores.map(Number),
        id_substituto: f.id_substituto ? Number(f.id_substituto) : null,
        justificativa: f.justificativa.trim(),
      });
      const extra = resultado?.operadores_reatribuidos ? ` ${resultado.operadores_reatribuidos} operador(es) passaram para o substituto.` : '';
      showToast(`${usuario.nome} foi transferido(a) de ${nomeOperacao(f.origem)} para ${nomeOperacao(f.destino)}.${extra}`, 'success');
      onFeito();
    } catch (e) {
      setErro(e?.message || 'Não foi possível transferir.');
    } finally {
      setSalvando(false);
    }
  };

  return html`
    <${ModalPadrao}
      aberto=${aberto}
      titulo="Transferir de operação"
      subtitulo="Move um Operador ou Supervisor para outra operação. As monitorias já realizadas continuam na operação e com o supervisor da época."
      onClose=${onClose}
    >
      ${erro ? html`<div class="alert alert-danger">${erro}</div>` : null}
      <div class="mon-form-grid">
        <label class="mon-campo">Quem muda de operação
          <select class="form-select" value=${f.id_usuario} onChange=${(e) => escolherUsuario(e.target.value)}>
            <option value="">Selecione…</option>
            ${elegiveis.map((u) => html`<option key=${u.id_usuario} value=${u.id_usuario}>${u.nome} — ${u.perfil_nome} (${(u.operacoes || []).join(', ') || 'sem operação'})</option>`)}
          </select>
        </label>
        <label class="mon-campo">Operação de origem
          <select class="form-select" value=${f.origem} disabled=${!usuario} onChange=${(e) => setF({ ...f, origem: e.target.value, id_substituto: '' })}>
            <option value="">Selecione…</option>
            ${(usuario?.operacoes || []).map((chave) => html`<option key=${chave} value=${chave}>${nomeOperacao(chave)}</option>`)}
          </select>
        </label>
        <label class="mon-campo">Operação de destino
          <select class="form-select" value=${f.destino} disabled=${!usuario} onChange=${(e) => setF({ ...f, destino: e.target.value, supervisores: [] })}>
            <option value="">Selecione…</option>
            ${destinos.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}
          </select>
        </label>
        <label class="mon-campo">Justificativa
          <input class="form-control" value=${f.justificativa} maxlength="400" onInput=${(e) => setF({ ...f, justificativa: e.target.value })} />
        </label>
      </div>
      ${usuario?.perfil === 'operador' && f.destino
        ? html`
            <div class="mt-3">
              <p class="mon-campo mb-2">Supervisor(es) responsável(is) no destino (até 2)</p>
              ${supervisoresDestino.length
                ? supervisoresDestino.map((s) => html`
                    <label key=${s.id_usuario} class="d-flex align-items-center gap-2">
                      <input type="checkbox" checked=${f.supervisores.includes(s.id_usuario)} onChange=${() => alternarSupervisor(s.id_usuario)} />
                      ${s.nome}
                    </label>`)
                : html`<p class="mon-muted">Nenhum supervisor ativo nesta operação. Vincule um supervisor a ela antes de transferir.</p>`}
            </div>`
        : null}
      ${usuario?.perfil === 'supervisor' && f.origem
        ? html`
            <div class="mt-3">
              <p class="mon-muted mb-2">
                ${operadoresNaOrigem.length
                  ? `${usuario.nome} supervisiona ${operadoresNaOrigem.length} operador(es) em ${nomeOperacao(f.origem)}. Escolha quem assume a supervisão deles.`
                  : `${usuario.nome} não tem operadores em ${nomeOperacao(f.origem)}: ninguém precisa assumir.`}
              </p>
              ${operadoresNaOrigem.length
                ? html`
                    <label class="mon-campo">Supervisor que assume
                      <select class="form-select" value=${f.id_substituto} onChange=${(e) => setF({ ...f, id_substituto: e.target.value })}>
                        <option value="">Selecione…</option>
                        ${substitutos.map((s) => html`<option key=${s.id_usuario} value=${s.id_usuario}>${s.nome} (${(s.operacoes || []).join(', ') || 'sem operação'})</option>`)}
                      </select>
                    </label>`
                : null}
            </div>`
        : null}
      <div class="mon-acoes-fixas">
        <button type="button" class="btn btn-primary" disabled=${faltando || salvando} onClick=${transferir}>
          ${salvando ? 'Transferindo…' : 'Transferir'}
        </button>
      </div>
    </${ModalPadrao}>`;
}

// ---------------------------------------------------------------------------
// Aba "Equipes e catálogos"
// ---------------------------------------------------------------------------
export function CartaoLista({ titulo, itens, podeEditar, aoAlternar, aoAdicionar, placeholder, vazio }) {
  const [valor, setValor] = useState('');
  const adicionar = () => {
    if (!valor.trim()) return;
    aoAdicionar(valor.trim());
    setValor('');
  };
  return html`
    <section class="mon-lista-card">
      <header><h3>${titulo}</h3><span class="mon-badge">${itens.length}</span></header>
      <ul>
        ${itens.map((item) => html`
          <li key=${item.id} class=${item.ativo ? '' : 'is-inativo'}>
            <span class="mon-lista-nome">${item.nome}${item.detalhe ? html` <small class="mon-muted">${item.detalhe}</small>` : null}</span>
            ${podeEditar ? html`<button type="button" class="btn btn-link btn-sm" onClick=${() => aoAlternar(item)}>${item.ativo ? 'Inativar' : 'Ativar'}</button>` : null}
          </li>`)}
        ${!itens.length ? html`<li class="mon-lista-vazio">${vazio}</li>` : null}
      </ul>
      ${podeEditar ? html`
        <div class="mon-lista-novo">
          <input class="form-control" placeholder=${placeholder} value=${valor} onInput=${(e) => setValor(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') adicionar(); }} />
          <button type="button" class="btn btn-outline-primary btn-sm" disabled=${!valor.trim()} onClick=${adicionar}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Adicionar</button>
        </div>` : null}
    </section>`;
}

export function AbaEquipesCatalogos() {
  const { showToast, ToastHost } = useToast();
  const { contexto, erro } = useContextoMonitoria();
  const ativas = useMemo(() => (contexto?.operacoes || []).filter((o) => o.ativo), [contexto]);
  const [operacao, setOperacao] = useState('');
  const [equipes, setEquipes] = useState([]);
  const [catalogos, setCatalogos] = useState({ turno: [], canal: [], tipo_atendimento: [] });
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    if (!operacao) return;
    listarEquipesMonitoria(operacao).then((r) => setEquipes(r.itens || [])).catch(() => setEquipes([]));
    Promise.all([listarCatalogoMonitoria('turno', '', true), listarCatalogoMonitoria('canal', operacao, true), listarCatalogoMonitoria('tipo_atendimento', operacao, true)])
      .then(([t, c, ta]) => setCatalogos({ turno: t.itens || [], canal: (c.itens || []).filter((i) => i.operacao), tipo_atendimento: (ta.itens || []).filter((i) => i.operacao) }))
      .catch(() => null);
  }, [operacao, recarga]);

  const executar = async (fn, msg) => {
    try { await fn(); showToast(msg, 'success'); setRecarga((r) => r + 1); } catch (e) { showToast(e?.message || 'Erro ao salvar.', 'danger'); }
  };
  const itensCatalogo = (lista) => lista.map((i) => ({ id: i.id_item, nome: i.valor, ativo: i.ativo }));
  const acoesCatalogo = (tipo, operacaoItem) => ({
    aoAlternar: (i) => executar(() => salvarCatalogoMonitoria({ tipo, operacao: operacaoItem, valor: i.nome, ativo: !i.ativo }, i.id), i.ativo ? 'Item inativado.' : 'Item ativado.'),
    aoAdicionar: (valor) => executar(() => salvarCatalogoMonitoria({ tipo, operacao: operacaoItem, valor }), 'Item adicionado.'),
  });

  if (erro) return html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  if (!contexto) return html`<${LoadingState} titulo="Carregando equipes e catálogos" />`;
  if (!ativas.length) return html`<${EmptyState} icon="groups" title="Sem operações ativas" text="Cadastre uma operação na aba Operações para gerenciar equipes e catálogos." />`;
  return html`
    <div class="mon-shell">
      <${ToastHost} />
      <div class="mon-filtros mon-filtros--linha">
        <label class="mon-filtro mon-filtro--select">Operação<${SelectOperacao} contexto=${{ operacoes: ativas }} valor=${operacao} todas=${true} rotuloTodas="Selecione uma operação" onChange=${setOperacao} /></label>
        <p class="mon-muted mon-filtros-nota">Equipes, canais e tipos pertencem à operação escolhida; turnos valem para todas. Equipes e turnos aparecem no cadastro de usuário.</p>
      </div>
      ${!operacao
        ? html`<${EmptyState} icon="apartment" title="Selecione uma operação" text="Escolha a operação acima para ver e cadastrar equipes, canais e tipos de atendimento dela." />`
        : html`<div class="mon-config-grid">
        <${CartaoLista} titulo="Equipes" placeholder="Nova equipe" vazio="Nenhuma equipe nesta operação." podeEditar=${true}
          itens=${equipes.map((e) => ({ id: e.id_equipe, nome: e.nome, ativo: e.ativo, detalhe: `${e.membros} membro(s)` }))}
          aoAlternar=${(e) => executar(() => salvarEquipeMonitoria({ nome: e.nome, ativo: !e.ativo }, e.id), e.ativo ? 'Equipe inativada.' : 'Equipe ativada.')}
          aoAdicionar=${(nome) => executar(() => salvarEquipeMonitoria({ operacao, nome }), 'Equipe criada.')} />
        <${CartaoLista} titulo="Turnos (todas as operações)" placeholder="Novo turno" vazio="Nenhum turno cadastrado." podeEditar=${true} itens=${itensCatalogo(catalogos.turno)} ...${acoesCatalogo('turno', '')} />
        <${CartaoLista} titulo="Canais de atendimento" placeholder="Novo canal" vazio="Nenhum canal nesta operação." podeEditar=${true} itens=${itensCatalogo(catalogos.canal)} ...${acoesCatalogo('canal', operacao)} />
        <${CartaoLista} titulo="Tipos de atendimento" placeholder="Novo tipo" vazio="Nenhum tipo nesta operação." podeEditar=${true} itens=${itensCatalogo(catalogos.tipo_atendimento)} ...${acoesCatalogo('tipo_atendimento', operacao)} />
      </div>`}
    </div>`;
}

// ---------------------------------------------------------------------------
// Aba "Logs da Monitoria" (somente leitura)
// ---------------------------------------------------------------------------
const FILTROS_LOG = { usuario: '', acao: '', operacao: '', resultado: '', data_inicio: '', data_fim: '' };

export function AbaLogsMonitoria() {
  const { showToast, ToastHost } = useToast();
  const { contexto } = useContextoMonitoria();
  const [rascunho, setRascunho] = useState(FILTROS_LOG);
  const [filtros, setFiltros] = useState(FILTROS_LOG);
  const [dados, setDados] = useState({ itens: [], total: 0 });
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [detalhe, setDetalhe] = useState(null);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    listarLogsMonitoria({ ...filtros, pagina, por_pagina: 50 })
      .then((r) => ativo && setDados(r))
      .catch((e) => ativo && showToast(e?.message || 'Erro ao carregar os logs.', 'danger'))
      .finally(() => ativo && setCarregando(false));
    return () => { ativo = false; };
  }, [filtros, pagina]);

  const campo = (k, v) => setRascunho((f) => ({ ...f, [k]: v }));
  const aplicar = () => { setFiltros(rascunho); setPagina(1); };
  const limpar = () => { setRascunho(FILTROS_LOG); setFiltros(FILTROS_LOG); setPagina(1); };

  return html`
    <div class="mon-shell">
      <${ToastHost} />
      <p class="mon-muted">Registro imutável de tudo o que acontece na Monitoria. Não há edição nem exclusão.</p>
      <div class="mon-filtros" onKeyDown=${(e) => { if (e.key === 'Enter') aplicar(); }}>
        <label class="mon-filtro">Usuário<input class="form-control" value=${rascunho.usuario} onInput=${(e) => campo('usuario', e.target.value)} /></label>
        <label class="mon-filtro">Ação<input class="form-control" value=${rascunho.acao} placeholder="ex.: realizar_monitoria" onInput=${(e) => campo('acao', e.target.value)} /></label>
        ${(contexto?.operacoes || []).length > 1 ? html`<label class="mon-filtro">Operação<${SelectOperacao} contexto=${contexto} valor=${rascunho.operacao} onChange=${(v) => campo('operacao', v)} /></label>` : null}
        <label class="mon-filtro">Resultado<select class="form-select" value=${rascunho.resultado} onChange=${(e) => campo('resultado', e.target.value)}><option value="">Todos</option><option value="SUCESSO">Sucesso</option><option value="FALHA">Falha</option></select></label>
        <label class="mon-filtro mon-filtro--data">De<input class="form-control" type="date" value=${rascunho.data_inicio} onInput=${(e) => campo('data_inicio', e.target.value)} /></label>
        <label class="mon-filtro mon-filtro--data">Até<input class="form-control" type="date" value=${rascunho.data_fim} onInput=${(e) => campo('data_fim', e.target.value)} /></label>
        <div class="mon-filtros-acoes">
          <button type="button" class="mon-icone-btn" title="Limpar filtros" aria-label="Limpar filtros" onClick=${limpar}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('delete')}</span></button>
          <button type="button" class="btn btn-primary" onClick=${aplicar}>Aplicar filtros</button>
        </div>
      </div>
      ${carregando ? html`<${LoadingState} titulo="Carregando logs" />` : html`
        <div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Quando</th><th>Usuário</th><th>Perfil</th><th>Operação</th><th>Ação</th><th>Entidade</th><th>IP</th><th>Resultado</th></tr></thead><tbody>
          ${dados.itens.map((l) => html`<tr key=${l.id_log} class="is-clicavel" onClick=${() => setDetalhe(l)}><td>${formatarDataHoraCurta(l.em)}</td><td>${l.usuario}</td><td>${l.perfil}</td><td>${l.operacao || '—'}</td><td>${l.acao}</td><td>${l.entidade} ${l.entidade_id}</td><td>${l.ip || '—'}</td><td>${l.resultado}</td></tr>`)}
        </tbody></table></div>
        <div class="mon-paginacao"><span>${dados.total} registro(s)</span><div class="mon-acoes">
          <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${pagina <= 1} onClick=${() => setPagina(pagina - 1)}>Anterior</button>
          <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${pagina * 50 >= dados.total} onClick=${() => setPagina(pagina + 1)}>Próxima</button></div></div>`}
      <${ModalPadrao} aberto=${Boolean(detalhe)} titulo=${`Log #${detalhe?.id_log || ''}`} onClose=${() => setDetalhe(null)}>
        ${detalhe ? html`<dl class="mon-dl"><div><dt>Ação</dt><dd>${detalhe.acao}</dd></div><div><dt>Detalhes</dt><dd>${detalhe.detalhes || '—'}</dd></div><div><dt>Estado anterior</dt><dd>${detalhe.estado_anterior || '—'}</dd></div><div><dt>Estado posterior</dt><dd>${detalhe.estado_posterior || '—'}</dd></div></dl>` : null}
      </${ModalPadrao}>
    </div>`;
}
