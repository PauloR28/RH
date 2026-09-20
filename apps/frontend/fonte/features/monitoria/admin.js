import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState, ModalPadrao, SectionCard } from '../../ui/componentes-compartilhados.js';
import {
  atualizarUsuarioMonitoria,
  criarUsuarioMonitoria,
  liberarTrocaDesign,
  lerVersaoMatriz,
  lerMatriz,
  listarCatalogoMonitoria,
  listarEquipesMonitoria,
  listarUsuariosMonitoria,
  listarVersoesMatriz,
  salvarCatalogoMonitoria,
  salvarEquipeMonitoria,
  salvarMatriz,
  transferirSupervisao,
} from '../../services/api/monitoria.js';
import { SelectOperacao, TagOperacao, formatarDataHoraCurta, formatarNota } from './comum.js';

const PERFIS_CRIAVEIS = {
  administrador: [['supervisor', 'Supervisor'], ['qualidade', 'Qualidade'], ['control_desk', 'Control Desk'], ['operador', 'Operador']],
  supervisor: [['qualidade', 'Qualidade'], ['control_desk', 'Control Desk'], ['operador', 'Operador']],
  qualidade: [['operador', 'Operador']],
};
const LIMITE_OPERACOES = { operador: 1, supervisor: 3, qualidade: 2, control_desk: 0 };
const ROTULO_PERFIL = { supervisor: 'Supervisor', qualidade: 'Qualidade', control_desk: 'Control Desk', operador: 'Operador' };

// ---------------------------------------------------------------------------
// Usuários da Monitoria (hierarquia: quem pode criar/alterar quem)
// ---------------------------------------------------------------------------
export function TelaUsuariosMonitoria({ controlador, contexto, showToast }) {
  const perfilAtor = controlador?.estado?.perfilUsuario;
  const opcoesPerfil = PERFIS_CRIAVEIS[perfilAtor] || [];
  const [usuarios, setUsuarios] = useState(null);
  const [filtros, setFiltros] = useState({ busca: '', operacao: '', perfil: '', status: '' });
  const [edicao, setEdicao] = useState(null);
  const [transferindo, setTransferindo] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [equipes, setEquipes] = useState([]);
  const [turnos, setTurnos] = useState([]);

  useEffect(() => {
    listarUsuariosMonitoria().then((r) => setUsuarios(r.itens || [])).catch((e) => { showToast(e?.message || 'Erro ao carregar usuários.', 'danger'); setUsuarios([]); });
  }, [recarga]);
  useEffect(() => {
    listarEquipesMonitoria().then((r) => setEquipes(r.itens || [])).catch(() => setEquipes([]));
    listarCatalogoMonitoria('turno').then((r) => setTurnos(r.itens || [])).catch(() => setTurnos([]));
  }, []);

  const filtrados = useMemo(() => (usuarios || []).filter((u) => {
    const busca = filtros.busca.toLowerCase();
    if (busca && !`${u.nome} ${u.sobrenome} ${u.email}`.toLowerCase().includes(busca)) return false;
    if (filtros.operacao && !u.operacoes.includes(filtros.operacao)) return false;
    if (filtros.perfil && u.perfil !== filtros.perfil) return false;
    if (filtros.status && u.status !== filtros.status) return false;
    return true;
  }), [usuarios, filtros]);

  const supervisores = (usuarios || []).filter((u) => u.perfil === 'supervisor');
  const novo = () => setEdicao({ perfil: opcoesPerfil[opcoesPerfil.length - 1]?.[0] || 'operador', nome: '', sobrenome: '', email: '', operacoes: [], supervisores: [], id_equipe: '', turno: '', provedor_autenticacao: 'microsoft', senha: '', status: 'Ativo' });

  return html`
    <div class="mon-shell">
      <div class="mon-filtros">
        <label>Buscar<input class="form-control" placeholder="Nome ou e-mail" value=${filtros.busca} onInput=${(e) => setFiltros({ ...filtros, busca: e.target.value })} /></label>
        <label>Operação<${SelectOperacao} contexto=${contexto} valor=${filtros.operacao} onChange=${(v) => setFiltros({ ...filtros, operacao: v })} /></label>
        <label>Perfil<select class="form-select" value=${filtros.perfil} onChange=${(e) => setFiltros({ ...filtros, perfil: e.target.value })}><option value="">Todos</option>${Object.entries(ROTULO_PERFIL).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></label>
        <label>Status<select class="form-select" value=${filtros.status} onChange=${(e) => setFiltros({ ...filtros, status: e.target.value })}><option value="">Todos</option><option>Ativo</option><option>Inativo</option></select></label>
        <div class="mon-acoes"><button type="button" class="btn btn-primary" onClick=${novo}>Criar usuário</button>
          <button type="button" class="btn btn-outline-secondary" onClick=${() => setTransferindo(true)}>Transferir supervisão</button></div>
      </div>
      ${usuarios === null ? html`<${LoadingState} titulo="Carregando usuários" />` : !filtrados.length ? html`<${EmptyState} icon="groups" title="Nenhum usuário" text="Ajuste os filtros ou crie um usuário." />` : html`
        <div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Nome</th><th>Perfil</th><th>Operação</th><th>Equipe / turno</th><th>Acesso</th><th>Status</th></tr></thead><tbody>
          ${filtrados.map((u) => html`<tr key=${u.id_usuario} class="is-clicavel" onClick=${() => setEdicao({ ...u, senha: '' })}>
            <td><strong>${u.nome} ${u.sobrenome}</strong><br /><small class="mon-muted">${u.email}</small></td><td>${u.perfil_nome}</td>
            <td>${u.operacoes.length ? u.operacoes.map((o) => html`<${TagOperacao} key=${o} chave=${o} contexto=${contexto} />`) : html`<span class="mon-muted">${u.perfil === 'control_desk' ? 'Todas' : 'Sem vínculo'}</span>`}</td>
            <td>${u.equipe_nome || '—'}${u.turno ? ` · ${u.turno}` : ''}</td>
            <td>${u.provedor_autenticacao === 'local' ? (u.deve_trocar_senha ? 'Senha (troca pendente)' : 'Senha') : 'Microsoft'}</td>
            <td><span class=${`mon-badge ${u.status === 'Ativo' ? 'mon-badge--ok' : ''}`}>${u.status}</span></td></tr>`)}
        </tbody></table></div>`}
      <${FormUsuario} edicao=${edicao} setEdicao=${setEdicao} opcoesPerfil=${opcoesPerfil} contexto=${contexto} equipes=${equipes} turnos=${turnos} supervisores=${supervisores}
        ehAdmin=${perfilAtor === 'administrador'} onSalvo=${() => { setEdicao(null); setRecarga((r) => r + 1); }} showToast=${showToast} />
      <${ModalTransferir} aberto=${transferindo} contexto=${contexto} supervisores=${supervisores} onClose=${() => setTransferindo(false)} onFeito=${() => { setTransferindo(false); setRecarga((r) => r + 1); }} showToast=${showToast} />
    </div>`;
}

function FormUsuario({ edicao, setEdicao, opcoesPerfil, contexto, equipes, turnos, supervisores, ehAdmin, onSalvo, showToast }) {
  const [salvando, setSalvando] = useState(false);
  if (!edicao) return null;
  const novoUsuario = !edicao.id_usuario;
  const limite = LIMITE_OPERACOES[edicao.perfil] ?? 1;
  const opsAtivas = (contexto?.operacoes || []).filter((o) => o.ativo || edicao.operacoes.includes(o.chave));
  const set = (k, v) => setEdicao({ ...edicao, [k]: v });
  const alternarOp = (chave, marcado) => {
    let ops = marcado ? [...edicao.operacoes, chave] : edicao.operacoes.filter((o) => o !== chave);
    if (edicao.perfil === 'operador' && marcado) ops = [chave];
    if (limite && ops.length > limite) { showToast(`Este perfil pode ter no máximo ${limite} operação(ões).`, 'warning'); return; }
    setEdicao({ ...edicao, operacoes: ops, id_equipe: '', supervisores: edicao.supervisores.filter((id) => supervisores.some((s) => s.id_usuario === id && s.operacoes.some((o) => ops.includes(o)))) });
  };
  const equipesDaOp = equipes.filter((e) => edicao.operacoes.includes(e.operacao) && e.ativo);
  const supervisoresDaOp = supervisores.filter((s) => s.operacoes.some((o) => edicao.operacoes.includes(o)));
  const alternarSup = (id, marcado) => {
    const lista = marcado ? [...edicao.supervisores, id] : edicao.supervisores.filter((x) => x !== id);
    if (lista.length > 2) { showToast('Um operador pode ter no máximo 2 supervisores.', 'warning'); return; }
    set('supervisores', lista);
  };
  const precisaTurno = ['operador', 'supervisor'].includes(edicao.perfil);

  const salvar = async () => {
    setSalvando(true);
    try {
      const corpo = {
        nome: edicao.nome, sobrenome: edicao.sobrenome, email: edicao.email, perfil: edicao.perfil, status: edicao.status,
        operacoes: edicao.perfil === 'control_desk' ? [] : edicao.operacoes,
        supervisores: edicao.perfil === 'operador' ? edicao.supervisores : [],
        id_equipe: edicao.id_equipe ? Number(edicao.id_equipe) : null, turno: edicao.turno || null,
      };
      if (novoUsuario) {
        await criarUsuarioMonitoria({ ...corpo, provedor_autenticacao: edicao.provedor_autenticacao, senha: edicao.senha });
        showToast('Usuário criado.', 'success');
      } else {
        await atualizarUsuarioMonitoria(edicao.id_usuario, corpo);
        showToast('Usuário atualizado.', 'success');
      }
      onSalvo();
    } catch (e) {
      showToast(e?.message || 'Não foi possível salvar o usuário.', 'danger');
    } finally {
      setSalvando(false);
    }
  };

  return html`
    <${ModalPadrao} aberto=${true} titulo=${novoUsuario ? 'Criar usuário' : 'Editar usuário'} subtitulo="Operação e vínculos são obrigatórios conforme o perfil." onClose=${() => setEdicao(null)}>
      <div class="mon-shell">
        <div class="mon-form-grid">
          <label>Perfil<select class="form-select" disabled=${!novoUsuario && !opcoesPerfil.length} value=${edicao.perfil} onChange=${(e) => setEdicao({ ...edicao, perfil: e.target.value, operacoes: [], supervisores: [], id_equipe: '' })}>
            ${(novoUsuario ? opcoesPerfil : Object.entries(ROTULO_PERFIL)).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></label>
          <label>Nome<input class="form-control" value=${edicao.nome} onInput=${(e) => set('nome', e.target.value)} /></label>
          <label>Sobrenome<input class="form-control" value=${edicao.sobrenome || ''} onInput=${(e) => set('sobrenome', e.target.value)} /></label>
          <label>E-mail<input class="form-control" type="email" value=${edicao.email} onInput=${(e) => set('email', e.target.value)} /></label>
          ${!novoUsuario ? html`<label>Status<select class="form-select" value=${edicao.status} onChange=${(e) => set('status', e.target.value)}><option>Ativo</option><option>Inativo</option></select></label>` : null}
        </div>
        ${edicao.perfil !== 'control_desk' ? html`
          <div><strong>Operação${limite === 1 ? '' : 'ões'}</strong> <span class="mon-muted">(${limite === 1 ? 'exatamente 1' : `até ${limite}`})</span>
            <div class="mon-acoes" style=${{ marginTop: '8px' }}>${opsAtivas.map((o) => html`<label key=${o.chave} class="mon-tag" style=${{ cursor: 'pointer' }}>
              <input type=${limite === 1 ? 'radio' : 'checkbox'} name="op" checked=${edicao.operacoes.includes(o.chave)} onChange=${(e) => alternarOp(o.chave, e.target.checked)} /> ${o.nome}</label>`)}</div></div>` : html`<div class="mon-alerta mon-alerta--info">O Control Desk enxerga todas as operações, cada uma identificada por tag.</div>`}
        ${precisaTurno ? html`<div class="mon-form-grid">
          <label>Turno<select class="form-select" value=${edicao.turno || ''} onChange=${(e) => set('turno', e.target.value)}><option value="">Selecione…</option>${turnos.map((t) => html`<option key=${t.id_item} value=${t.valor}>${t.valor}</option>`)}</select></label>
          ${edicao.perfil === 'operador' ? html`<label>Equipe<select class="form-select" value=${edicao.id_equipe || ''} onChange=${(e) => set('id_equipe', e.target.value)}><option value="">Sem equipe</option>${equipesDaOp.map((t) => html`<option key=${t.id_equipe} value=${t.id_equipe}>${t.nome}</option>`)}</select></label>` : null}
        </div>` : null}
        ${edicao.perfil === 'operador' ? html`<div><strong>Supervisor(es) responsável(is)</strong> <span class="mon-muted">(1 ou 2 — troca por horário/escala)</span>
          <div class="mon-acoes" style=${{ marginTop: '8px' }}>${supervisoresDaOp.map((s) => html`<label key=${s.id_usuario} class="mon-tag" style=${{ cursor: 'pointer' }}>
            <input type="checkbox" checked=${edicao.supervisores.includes(s.id_usuario)} onChange=${(e) => alternarSup(s.id_usuario, e.target.checked)} /> ${s.nome}</label>`)}
            ${!supervisoresDaOp.length ? html`<span class="mon-muted">Selecione a operação para listar os supervisores.</span>` : null}</div></div>` : null}
        ${novoUsuario ? html`<div class="mon-form-grid">
          <label>Acesso<select class="form-select" value=${edicao.provedor_autenticacao} onChange=${(e) => set('provedor_autenticacao', e.target.value)}><option value="microsoft">Microsoft (padrão)</option><option value="local">Usuário e senha (casos específicos)</option></select></label>
          ${edicao.provedor_autenticacao === 'local' ? html`<label>Senha inicial (troca obrigatória no 1º acesso)<input class="form-control" type="password" autocomplete="new-password" value=${edicao.senha} onInput=${(e) => set('senha', e.target.value)} /></label>` : null}</div>` : null}
        ${!novoUsuario && ehAdmin && edicao.operacoes.length > 1 ? html`<div class="mon-acoes"><button type="button" class="btn btn-outline-secondary btn-sm"
          onClick=${async () => { try { await liberarTrocaDesign(edicao.id_usuario); showToast('Nova escolha de design liberada.', 'success'); } catch (e) { showToast(e?.message || 'Erro.', 'danger'); } }}>Liberar nova escolha de design</button></div>` : null}
        <div class="mon-acoes-fixas"><button type="button" class="btn btn-outline-secondary" onClick=${() => setEdicao(null)}>Cancelar</button>
          <button type="button" class="btn btn-primary" disabled=${salvando || !edicao.nome || !edicao.email} onClick=${salvar}>${salvando ? 'Salvando…' : 'Salvar'}</button></div>
      </div>
    </${ModalPadrao}>`;
}

function ModalTransferir({ aberto, contexto, supervisores, onClose, onFeito, showToast }) {
  const [f, setF] = useState({ operacao: '', id_de: '', id_para: '', justificativa: '' });
  const candidatos = supervisores.filter((s) => !f.operacao || s.operacoes.includes(f.operacao));
  return html`
    <${ModalPadrao} aberto=${aberto} titulo="Transferir supervisão" subtitulo="Ex.: férias. O supervisor sai da operação, o substituto assume os operadores e as pendências abertas. As monitorias já realizadas mantêm o supervisor original." onClose=${onClose}>
      <div class="mon-form-grid">
        <label>Operação<${SelectOperacao} contexto=${contexto} valor=${f.operacao} todas=${false} onChange=${(v) => setF({ ...f, operacao: v, id_de: '', id_para: '' })} /></label>
        <label>Supervisor que sai<select class="form-select" value=${f.id_de} onChange=${(e) => setF({ ...f, id_de: e.target.value })}><option value="">Selecione…</option>${candidatos.map((s) => html`<option key=${s.id_usuario} value=${s.id_usuario}>${s.nome}</option>`)}</select></label>
        <label>Supervisor que assume<select class="form-select" value=${f.id_para} onChange=${(e) => setF({ ...f, id_para: e.target.value })}><option value="">Selecione…</option>${supervisores.filter((s) => String(s.id_usuario) !== String(f.id_de)).map((s) => html`<option key=${s.id_usuario} value=${s.id_usuario}>${s.nome}</option>`)}</select></label>
        <label>Justificativa<input class="form-control" value=${f.justificativa} onInput=${(e) => setF({ ...f, justificativa: e.target.value })} /></label>
      </div>
      <div class="mon-acoes-fixas"><button type="button" class="btn btn-primary" disabled=${!f.operacao || !f.id_de || !f.id_para}
        onClick=${async () => { try { const r = await transferirSupervisao({ ...f, id_de: Number(f.id_de), id_para: Number(f.id_para) }); showToast(`${r.operadores_transferidos} operador(es) transferido(s).`, 'success'); onFeito(); } catch (e) { showToast(e?.message || 'Erro na transferência.', 'danger'); } }}>Transferir</button></div>
    </${ModalPadrao}>`;
}


function ListaCatalogo({ tipo, titulo, operacaoItem, podeEditar, itens, executar }) {
  const [valor, setValor] = useState('');
  return html`<div class="mon-card"><h3>${titulo}</h3>
    ${itens.map((i) => html`<div class="mon-acoes" key=${i.id_item}><span style=${{ minWidth: '160px', opacity: i.ativo ? 1 : 0.5 }}>${i.valor}</span>
      ${podeEditar ? html`<button type="button" class="btn btn-link btn-sm" onClick=${() => executar(() => salvarCatalogoMonitoria({ tipo, operacao: operacaoItem, valor: i.valor, ativo: !i.ativo }, i.id_item), i.ativo ? 'Item inativado.' : 'Item ativado.')}>${i.ativo ? 'Inativar' : 'Ativar'}</button>` : null}</div>`)}
    ${podeEditar ? html`<div class="mon-acoes"><input class="form-control" style=${{ maxWidth: '220px' }} placeholder="Novo item" value=${valor} onInput=${(e) => setValor(e.target.value)} />
      <button type="button" class="btn btn-outline-primary btn-sm" disabled=${!valor.trim()} onClick=${() => executar(async () => { await salvarCatalogoMonitoria({ tipo, operacao: operacaoItem, valor }); setValor(''); }, 'Item adicionado.')}>Adicionar</button></div>` : null}</div>`;
}

// ---------------------------------------------------------------------------
// Equipes, turnos, canais e tipos de atendimento (administráveis)
// ---------------------------------------------------------------------------
export function TelaEquipes({ controlador, contexto, showToast }) {
  const ehAdmin = controlador?.estado?.perfilUsuario === 'administrador';
  const ativas = (contexto?.operacoes || []).filter((o) => o.ativo);
  const [operacao, setOperacao] = useState(ativas[0]?.chave || '');
  const [equipes, setEquipes] = useState([]);
  const [catalogos, setCatalogos] = useState({ turno: [], canal: [], tipo_atendimento: [] });
  const [nova, setNova] = useState('');
  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    if (!operacao) return;
    listarEquipesMonitoria(operacao).then((r) => setEquipes(r.itens || [])).catch(() => setEquipes([]));
    Promise.all([listarCatalogoMonitoria('turno', '', true), listarCatalogoMonitoria('canal', operacao, true), listarCatalogoMonitoria('tipo_atendimento', operacao, true)])
      .then(([t, c, ta]) => setCatalogos({ turno: t.itens || [], canal: c.itens.filter((i) => i.operacao) || [], tipo_atendimento: ta.itens.filter((i) => i.operacao) || [] })).catch(() => null);
  }, [operacao, recarga]);
  const executar = async (fn, msg) => { try { await fn(); showToast(msg, 'success'); setRecarga((r) => r + 1); } catch (e) { showToast(e?.message || 'Erro ao salvar.', 'danger'); } };
  return html`
    <div class="mon-shell">
      <div class="mon-filtros"><label>Operação<${SelectOperacao} contexto=${{ operacoes: ativas }} valor=${operacao} todas=${false} onChange=${setOperacao} /></label></div>
      <div class="mon-grid-2">
        <div class="mon-card"><h3>Equipes</h3>
          ${equipes.map((e) => html`<div class="mon-acoes" key=${e.id_equipe}><span style=${{ minWidth: '160px', opacity: e.ativo ? 1 : 0.5 }}>${e.nome} <small class="mon-muted">(${e.membros} membro(s))</small></span>
            <button type="button" class="btn btn-link btn-sm" onClick=${() => executar(() => salvarEquipeMonitoria({ nome: e.nome, ativo: !e.ativo }, e.id_equipe), e.ativo ? 'Equipe inativada.' : 'Equipe ativada.')}>${e.ativo ? 'Inativar' : 'Ativar'}</button></div>`)}
          ${!equipes.length ? html`<p class="mon-muted">Nenhuma equipe nesta operação.</p>` : null}
          <div class="mon-acoes"><input class="form-control" style=${{ maxWidth: '220px' }} placeholder="Nova equipe" value=${nova} onInput=${(e) => setNova(e.target.value)} />
            <button type="button" class="btn btn-outline-primary btn-sm" disabled=${!nova.trim() || !operacao} onClick=${() => executar(async () => { await salvarEquipeMonitoria({ operacao, nome: nova }); setNova(''); }, 'Equipe criada.')}>Adicionar</button></div></div>
        <${ListaCatalogo} tipo="turno" titulo="Turnos (todas as operações)" operacaoItem="" podeEditar=${ehAdmin} itens=${catalogos.turno} executar=${executar} />
        <${ListaCatalogo} tipo="canal" titulo="Canais de atendimento" operacaoItem=${operacao} podeEditar=${true} itens=${catalogos.canal} executar=${executar} />
        <${ListaCatalogo} tipo="tipo_atendimento" titulo="Tipos de atendimento" operacaoItem=${operacao} podeEditar=${true} itens=${catalogos.tipo_atendimento} executar=${executar} />
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Formulários (matriz versionada por operação)
// ---------------------------------------------------------------------------
function somaPesos(bloco) {
  return (bloco.criterios || []).reduce((t, c) => t + (Number(c.peso) || 0), 0);
}

export function TelaFormularios({ controlador, contexto, showToast }) {
  const podeEditar = controlador.possuiPermissao('monitoria.matriz');
  const ativas = (contexto?.operacoes || []).filter((o) => o.ativo);
  const [operacao, setOperacao] = useState(ativas[0]?.chave || '');
  const [matriz, setMatriz] = useState(null);
  const [config, setConfig] = useState(null);
  const [versoes, setVersoes] = useState([]);
  const [visualizando, setVisualizando] = useState(null);
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    if (!operacao) return;
    lerMatriz(operacao).then((m) => { setMatriz(m.versao_ativa); setConfig(JSON.parse(JSON.stringify(m.versao_ativa.config))); }).catch((e) => showToast(e?.message || 'Erro ao carregar a matriz.', 'danger'));
    listarVersoesMatriz(operacao).then((r) => setVersoes(r.itens || [])).catch(() => setVersoes([]));
  }, [operacao, recarga]);

  const erros = [];
  (config?.blocos || []).forEach((b) => {
    if (Math.abs(somaPesos(b) - Number(b.valor || 0)) > 0.0001) erros.push(`${b.nome || 'Bloco'}: a soma dos pesos (${formatarNota(somaPesos(b))}) deve ser igual ao valor do bloco (${formatarNota(b.valor)}).`);
  });
  const alterou = config && matriz && JSON.stringify(config) !== JSON.stringify(matriz.config);

  const setBloco = (i, campo, valor) => setConfig({ ...config, blocos: config.blocos.map((b, j) => (j === i ? { ...b, [campo]: valor } : b)) });
  const setCriterio = (i, k, campo, valor) => setConfig({ ...config, blocos: config.blocos.map((b, j) => (j === i ? { ...b, criterios: b.criterios.map((c, l) => (l === k ? { ...c, [campo]: valor } : c)) } : b)) });
  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await salvarMatriz(operacao, config, observacao);
      showToast(`Nova versão ${r.numero} criada. As monitorias antigas permanecem com a versão original.`, 'success');
      setObservacao('');
      setRecarga((x) => x + 1);
    } catch (e) { showToast(e?.message || 'Não foi possível salvar.', 'danger'); } finally { setSalvando(false); }
  };

  if (!ativas.length) return html`<${EmptyState} icon="rule" title="Sem operações" text="Você não está vinculado a nenhuma operação ativa." />`;
  return html`
    <div class="mon-shell">
      <div class="mon-filtros"><label>Operação<${SelectOperacao} contexto=${{ operacoes: ativas }} valor=${operacao} todas=${false} onChange=${setOperacao} /></label>
        ${matriz ? html`<div class="mon-alerta mon-alerta--info">Versão ativa: <strong>v${matriz.numero}</strong> · ${matriz.nome}. Salvar cria uma nova versão; as anteriores ficam arquivadas.</div>` : null}</div>
      ${!config ? html`<${LoadingState} titulo="Carregando formulário" />` : html`
        ${config.blocos.map((b, i) => html`
          <div class="mon-matriz-bloco" key=${b.id || i}>
            <div class="mon-matriz-linha"><label>Bloco<input class="form-control" disabled=${!podeEditar} value=${b.nome} onInput=${(e) => setBloco(i, 'nome', e.target.value)} /></label>
              <label>Valor<input class="form-control" type="number" step="0.5" disabled=${!podeEditar} value=${b.valor} onInput=${(e) => setBloco(i, 'valor', e.target.value)} /></label>
              ${podeEditar ? html`<button type="button" class="btn btn-link text-danger" onClick=${() => setConfig({ ...config, blocos: config.blocos.filter((_, j) => j !== i) })}>Remover bloco</button>` : null}</div>
            ${b.criterios.map((c, k) => html`<div class="mon-matriz-linha" key=${c.id || k}>
              <input class="form-control" disabled=${!podeEditar} value=${c.texto} onInput=${(e) => setCriterio(i, k, 'texto', e.target.value)} />
              <input class="form-control" type="number" step="0.5" disabled=${!podeEditar} value=${c.peso} onInput=${(e) => setCriterio(i, k, 'peso', e.target.value)} />
              ${podeEditar ? html`<button type="button" class="btn btn-link btn-sm text-danger" onClick=${() => setBloco(i, 'criterios', b.criterios.filter((_, l) => l !== k))}>Remover</button>` : null}</div>`)}
            <div class="mon-acoes"><span class=${`mon-muted ${Math.abs(somaPesos(b) - Number(b.valor || 0)) > 0.0001 ? 'mon-sla--vencido' : ''}`}>Soma dos pesos: ${formatarNota(somaPesos(b))} / ${formatarNota(b.valor)}</span>
              ${podeEditar ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setBloco(i, 'criterios', [...b.criterios, { texto: '', peso: 0 }])}>Adicionar critério</button>` : null}</div>
          </div>`)}
        ${podeEditar ? html`<div class="mon-acoes"><button type="button" class="btn btn-outline-secondary" onClick=${() => setConfig({ ...config, blocos: [...config.blocos, { nome: '', valor: 0, criterios: [{ texto: '', peso: 0 }] }] })}>Adicionar bloco</button></div>` : null}
        <${SectionCard} title="Pilares, escala e faixas de nota">
          <div class="mon-form-grid">
            <label>Escala mínima<input class="form-control" type="number" disabled=${!podeEditar} value=${config.escala.min} onInput=${(e) => setConfig({ ...config, escala: { ...config.escala, min: Number(e.target.value) } })} /></label>
            <label>Escala máxima<input class="form-control" type="number" disabled=${!podeEditar} value=${config.escala.max} onInput=${(e) => setConfig({ ...config, escala: { ...config.escala, max: Number(e.target.value) } })} /></label>
            <label>Mínimo de blocos avaliados<input class="form-control" type="number" disabled=${!podeEditar} value=${config.min_blocos} onInput=${(e) => setConfig({ ...config, min_blocos: Number(e.target.value) })} /></label>
          </div>
          <div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Faixa</th><th>De</th><th>Cor</th><th>Ação recomendada</th></tr></thead><tbody>
            ${config.faixas.map((f, i) => html`<tr key=${i}><td><input class="form-control" disabled=${!podeEditar} value=${f.label} onInput=${(e) => setConfig({ ...config, faixas: config.faixas.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} /></td>
              <td><input class="form-control" type="number" disabled=${!podeEditar} value=${f.min} onInput=${(e) => setConfig({ ...config, faixas: config.faixas.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)) })} /></td>
              <td><input type="color" disabled=${!podeEditar} value=${f.cor || '#0a4b8c'} onInput=${(e) => setConfig({ ...config, faixas: config.faixas.map((x, j) => (j === i ? { ...x, cor: e.target.value } : x)) })} /></td>
              <td><input class="form-control" disabled=${!podeEditar} value=${f.acao || ''} onInput=${(e) => setConfig({ ...config, faixas: config.faixas.map((x, j) => (j === i ? { ...x, acao: e.target.value } : x)) })} /></td></tr>`)}
          </tbody></table></div>
        </${SectionCard}>
        ${erros.length ? html`<ul class="mon-erros">${erros.map((e) => html`<li key=${e}>${e}</li>`)}</ul>` : null}
        ${podeEditar ? html`<div class="mon-acoes-fixas"><input class="form-control" style=${{ maxWidth: '360px' }} placeholder="O que mudou nesta versão? (opcional)" value=${observacao} onInput=${(e) => setObservacao(e.target.value)} />
          <button type="button" class="btn btn-primary" disabled=${!alterou || erros.length > 0 || salvando} onClick=${salvar}>${salvando ? 'Salvando…' : 'Salvar como nova versão'}</button></div>` : null}
        <${SectionCard} title="Histórico de versões (somente leitura)">
          <div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Versão</th><th>Criada em</th><th>Por</th><th>Observação</th><th class="num">Monitorias</th><th></th></tr></thead><tbody>
            ${versoes.map((v) => html`<tr key=${v.id_versao}><td><strong>v${v.numero}</strong> ${v.ativa ? html`<span class="mon-badge mon-badge--ok">Ativa</span>` : html`<span class="mon-badge">Arquivada</span>`}</td><td>${formatarDataHoraCurta(v.criado_em)}</td><td>${v.criado_por}</td><td>${v.observacao || '—'}</td><td class="num">${v.monitorias}</td>
              <td><button type="button" class="btn btn-link btn-sm" onClick=${async () => setVisualizando(await lerVersaoMatriz(v.id_versao))}>Ver</button></td></tr>`)}
          </tbody></table></div>
        </${SectionCard}>`}
      <${ModalPadrao} aberto=${Boolean(visualizando)} titulo=${`Formulário v${visualizando?.numero || ''} (somente leitura)`} onClose=${() => setVisualizando(null)}>
        ${visualizando ? html`<div class="mon-shell">${visualizando.config.blocos.map((b) => html`<div key=${b.id}><strong>${b.nome}</strong> <span class="mon-muted">(peso ${formatarNota(b.valor)})</span><ul>${b.criterios.map((c) => html`<li key=${c.id}>${c.texto} — ${formatarNota(c.peso)}</li>`)}</ul></div>`)}</div>` : null}
      </${ModalPadrao}>
    </div>`;
}
