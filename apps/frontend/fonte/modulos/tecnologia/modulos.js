import { html, useCallback, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import { ModalPadrao } from '../../ui/componentes-compartilhados.js';
import { DataTable, PageShell, Section, Toolbar } from '../../ui/components/layout-primitivas.js?v=20261005-redesign15';
import { listarUsuarios } from '../../services/api/settings.js';
import {
  definirAcessoModulosPerfil,
  definirAcessoModulosUsuario,
  definirModuloAtivo,
  definirWfmParticipantes,
  lerAcessosModulos,
  lerWfmParticipantes,
  listarModulosTecnologia,
} from '../../services/api/modulos.js?v=20261005-redesign15';
import { limparEstadoModulos, carregarAcessoModulos } from '../estado.js?v=20261004-chamados2';

// Tela Módulos (Tecnologia): ativação, WFM para participantes e acesso por perfil/usuário. Montada com as primitivas de layout.

const DESCRICAO_MODULO = {
  core: 'Login, usuários, perfis, operações, notificações e autoatendimento.',
  rh: 'Currículos, Processos, Provas e gestão de Treinamentos.',
  operacao: 'Monitoria e Turnos e Plantões.',
  tecnologia: 'Administração do Conecta e Suporte TI.',
};
const NOME_MODULO = { rh: 'RH', operacao: 'Operação', tecnologia: 'Tecnologia' };
const MODULOS_LIBERAVEIS = ['rh', 'operacao', 'tecnologia'];

function Interruptor({ ligado, travado, rotulo, onChange }) {
  return html`
    <button type="button" role="switch" aria-checked=${ligado} aria-label=${rotulo} disabled=${travado}
      class=${`tec-switch ${ligado ? 'is-on' : ''}`.trim()} onClick=${onChange}></button>`;
}

function Aviso({ children }) {
  return html`<div class="alert alert-warning" role="alert">${children}</div>`;
}

function RodapeConfirmar({ onCancelar, onConfirmar, salvando }) {
  return html`
    <footer class="rh-modal-footer"><div class="rh-modal-footer-actions">
      <button type="button" class="btn btn-outline-secondary" onClick=${onCancelar}>Cancelar</button>
      <button type="button" class="btn btn-primary" disabled=${salvando} onClick=${onConfirmar}>${salvando ? 'Salvando…' : 'Confirmar'}</button>
    </div></footer>`;
}

export function SecaoAtivacao({ podeEditar, showToast, aoMudar }) {
  const [modulos, setModulos] = useState(null);
  const [erro, setErro] = useState('');
  const [pendente, setPendente] = useState(null);
  const [justificativa, setJustificativa] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(() => {
    setErro('');
    listarModulosTecnologia().then(setModulos).catch((e) => setErro(e?.message || 'Não foi possível carregar os módulos.'));
  }, []);
  useEffect(carregar, [carregar]);

  const confirmar = async () => {
    setSalvando(true);
    try {
      await definirModuloAtivo(pendente.chave, pendente.ativo, justificativa);
      showToast(`Módulo ${pendente.nome} ${pendente.ativo ? 'ativado' : 'desativado'}.`, 'success');
      setPendente(null);
      setJustificativa('');
      limparEstadoModulos();
      carregarAcessoModulos();
      carregar();
      aoMudar?.();
    } catch (e) {
      showToast(e?.message || 'Não foi possível alterar o módulo.', 'error');
    } finally {
      setSalvando(false);
    }
  };

  const colunas = [
    { chave: 'nome', rotulo: 'Módulo', prioridade: 1, largura: '20%', render: (m) => html`<strong>${m.nome}</strong>` },
    { chave: 'desc', rotulo: 'O que contém', prioridade: 2, render: (m) => DESCRICAO_MODULO[m.chave] || '' },
    { chave: 'situacao', rotulo: 'Situação', prioridade: 1, largura: '144px',
      render: (m) => (m.protegido ? html`<span class="tec-pill">protegido</span>` : html`<span class=${`tec-pill ${m.ativo ? 'is-ok' : 'is-aviso'}`}>${m.ativo ? 'ativo' : 'desativado'}</span>`) },
    { chave: 'acao', rotulo: 'Ativo', prioridade: 1, largura: '80px', alinhar: 'direita',
      render: (m) => html`<${Interruptor} ligado=${m.ativo} travado=${m.protegido || !podeEditar} rotulo=${`Módulo ${m.nome}`}
        onChange=${() => setPendente({ chave: m.chave, nome: m.nome, ativo: !m.ativo })} />` },
  ];

  return html`
    <${PageShell}>
    <${Section} solta=${true} titulo="Ativação de módulos" descricao="Desligar um módulo esconde as telas e bloqueia as rotas dele. O app de treinamento (autoatendimento) continua funcionando.">
      ${podeEditar ? null : html`<p class="tec-ajuda tec-ajuda--topo">Você não tem permissão para alterar.</p>`}
      <${DataTable} colunas=${colunas} linhas=${modulos || []} chaveLinha=${(m) => m.chave} carregando=${!modulos && !erro} erro=${erro} aoTentar=${carregar}
        vazio=${{ texto: 'Nenhum módulo cadastrado.' }} />
    <//>
    <${ModalPadrao} aberto=${Boolean(pendente)} titulo=${pendente ? `${pendente.ativo ? 'Ativar' : 'Desativar'} o módulo ${pendente.nome}?` : ''}
      subtitulo="A mudança vale para todos os usuários e fica registrada em auditoria." onClose=${() => setPendente(null)}>
      <div class="rh-details-body">
        ${pendente && !pendente.ativo ? html`<${Aviso}>Quem só usa este módulo perde o acesso às telas dele agora.<//>` : null}
        <label class="tec-campo"><span>Justificativa (opcional)</span>
          <input class="form-control" value=${justificativa} maxlength="400" onInput=${(e) => setJustificativa(e.target.value)} />
        </label>
      </div>
      <${RodapeConfirmar} onCancelar=${() => setPendente(null)} onConfirmar=${confirmar} salvando=${salvando} />
    <//>
    <//>`;
}

export function SecaoWfmParticipantes({ podeEditar, showToast, aoMudar }) {
  const [situacao, setSituacao] = useState(null);
  const [erro, setErro] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(() => {
    setErro('');
    lerWfmParticipantes().then(setSituacao).catch((e) => setErro(e?.message || 'Não foi possível ler a configuração do WFM.'));
  }, []);
  useEffect(carregar, [carregar]);

  const alvo = situacao ? !situacao.liberado : true;
  const doAmbiente = situacao?.origem === 'ambiente';
  const confirmar = async () => {
    setSalvando(true);
    try {
      const nova = await definirWfmParticipantes(alvo, justificativa);
      setSituacao(nova);
      setConfirmando(false);
      setJustificativa('');
      showToast(alvo ? 'Turnos e Plantões liberado para os participantes.' : 'Turnos e Plantões fechado para os participantes.', 'success');
      aoMudar?.();
    } catch (e) {
      showToast(e?.message || 'Não foi possível alterar a liberação.', 'error');
    } finally {
      setSalvando(false);
    }
  };

  const botao = situacao ? html`
    <button type="button" class="btn btn-primary" disabled=${!podeEditar || !situacao.editavel} onClick=${() => setConfirmando(true)}>
      ${doAmbiente ? 'Controlado pelo ambiente' : situacao.liberado ? 'Fechar para participantes…' : 'Liberar para participantes…'}
    </button>` : null;

  return html`
    <${PageShell}>
    <${Section} titulo="WFM para participantes" descricao="Libera Turnos e Plantões para Operador, Técnico de TI e Qualidade (fase de teste)." acoes=${botao}>
      ${erro ? html`<${Aviso}>${erro}<//>` : null}
      ${situacao ? html`
        <div class="tec-linha">
          <div class="tec-linha-texto"><strong>${situacao.liberado ? 'Liberado' : 'Fechado'}</strong>
            <small>Ao liberar, só esses perfis refazem o login. A alteração fica em auditoria (quem, quando, de → para).</small></div>
          <span class=${`tec-pill ${doAmbiente ? 'is-aviso' : ''}`.trim()}>${doAmbiente ? 'origem: variável de ambiente' : 'origem: banco'}</span>
        </div>
        ${doAmbiente ? html`<p class="tec-ajuda">A variável RH_WFM_LIBERAR_PARTICIPANTES está definida e prevalece. Remova-a do ambiente para usar este botão.</p>` : null}`
        : (!erro ? html`<p class="tec-ajuda tec-ajuda--topo">Carregando…</p>` : null)}
    <//>
    <${ModalPadrao} aberto=${confirmando} titulo=${alvo ? 'Liberar Turnos e Plantões?' : 'Fechar Turnos e Plantões?'}
      subtitulo="Esta ação é registrada em auditoria." onClose=${() => setConfirmando(false)}>
      <div class="rh-details-body">
        <p>${alvo ? 'Operador, Técnico de TI e Qualidade passam a acessar o WFM e precisarão entrar de novo.' : 'Operador, Técnico de TI e Qualidade perdem o acesso ao WFM imediatamente.'}</p>
        <label class="tec-campo"><span>Justificativa (opcional)</span>
          <input class="form-control" value=${justificativa} maxlength="400" placeholder="ex.: início do piloto com a equipe de atendimento" onInput=${(e) => setJustificativa(e.target.value)} />
        </label>
      </div>
      <${RodapeConfirmar} onCancelar=${() => setConfirmando(false)} onConfirmar=${confirmar} salvando=${salvando} />
    <//>
    <//>`;
}

// Uma caixa por módulo: marcada e travada = o perfil já abre o módulo pelas permissões; marcada e livre = liberada à parte aqui.
function CaixasModulos({ derivados = [], liberados = [], desabilitado, aoAlternar, rotulo }) {
  return html`
    <div class="tec-caixas">
      ${MODULOS_LIBERAVEIS.map((m) => {
        const porPermissao = derivados.includes(m);
        const marcado = porPermissao || liberados.includes(m);
        return html`
          <label key=${m} class=${`tec-caixa ${porPermissao ? 'is-derivado' : ''}`.trim()} title=${porPermissao ? 'Já aberto pelas permissões do perfil' : `Liberar ${NOME_MODULO[m]}`}>
            <input type="checkbox" checked=${marcado} disabled=${desabilitado || porPermissao} aria-label=${`${rotulo}: ${NOME_MODULO[m]}`} onChange=${() => aoAlternar(m)} />
            <span>${NOME_MODULO[m]}</span>
          </label>`;
      })}
    </div>`;
}

export function SecaoAcesso({ podeEditar, showToast, aoMudar }) {
  const [aba, setAba] = useState('perfil');
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [encontrados, setEncontrados] = useState([]);

  const carregar = useCallback(() => {
    setErro('');
    lerAcessosModulos().then(setDados).catch((e) => setErro(e?.message || 'Não foi possível carregar os acessos.'));
  }, []);
  useEffect(carregar, [carregar]);

  // Busca de usuários só roda na aba "usuário", no servidor e com pelo menos 2 letras (nada de baixar todos).
  useEffect(() => {
    if (aba !== 'usuario' || busca.trim().length < 2) { setEncontrados([]); return undefined; }
    let ativo = true;
    const espera = setTimeout(() => {
      listarUsuarios({ search: busca.trim() })
        .then((r) => { if (ativo) setEncontrados((Array.isArray(r) ? r : r?.usuarios || []).slice(0, 20)); })
        .catch(() => { if (ativo) setEncontrados([]); });
    }, 300);
    return () => { ativo = false; clearTimeout(espera); };
  }, [aba, busca]);

  const salvar = async (tipo, id, atuais, modulo) => {
    const novos = atuais.includes(modulo) ? atuais.filter((m) => m !== modulo) : [...atuais, modulo];
    try {
      if (tipo === 'perfil') await definirAcessoModulosPerfil(id, novos);
      else await definirAcessoModulosUsuario(id, novos);
      limparEstadoModulos();
      carregarAcessoModulos();
      carregar();
      aoMudar?.();
      showToast('Acesso atualizado. Vale no próximo login da pessoa.', 'success');
    } catch (e) {
      showToast(e?.message || 'Não foi possível salvar o acesso.', 'error');
    }
  };

  const derivadosDoPerfil = useMemo(() => Object.fromEntries((dados?.perfis || []).map((p) => [p.id, p.derivados])), [dados]);
  const colunasPerfil = [
    { chave: 'nome', rotulo: 'Perfil', prioridade: 1, fixa: true, render: (p) => html`<strong>${p.nome}</strong>` },
    { chave: 'modulos', rotulo: 'Módulos que o perfil acessa', prioridade: 1,
      render: (p) => html`<${CaixasModulos} derivados=${p.derivados} liberados=${p.liberados} desabilitado=${!podeEditar} rotulo=${p.nome}
        aoAlternar=${(m) => salvar('perfil', p.id, p.liberados, m)} />` },
  ];

  // Usuários com liberação individual + resultado da busca (sem repetir).
  const linhasUsuario = useMemo(() => {
    const porId = new Map((dados?.usuarios || []).map((u) => [u.id, { ...u }]));
    encontrados.forEach((u) => {
      if (!porId.has(u.id_usuario)) {
        porId.set(u.id_usuario, { id: u.id_usuario, nome: `${u.nome || ''} ${u.sobrenome || ''}`.trim(), email: u.email, perfil: u.perfil, liberados: [] });
      }
    });
    const termo = busca.trim().toLowerCase();
    return [...porId.values()].filter((u) => !termo || `${u.nome} ${u.email}`.toLowerCase().includes(termo));
  }, [dados, encontrados, busca]);
  const colunasUsuario = [
    { chave: 'nome', rotulo: 'Usuário', prioridade: 1, fixa: true, render: (u) => html`<strong>${u.nome}</strong>` },
    { chave: 'email', rotulo: 'E-mail', prioridade: 2, render: (u) => u.email },
    { chave: 'modulos', rotulo: 'Módulos que a pessoa acessa', prioridade: 1,
      render: (u) => html`<${CaixasModulos} derivados=${derivadosDoPerfil[u.perfil] || []} liberados=${u.liberados} desabilitado=${!podeEditar} rotulo=${u.nome}
        aoAlternar=${(m) => salvar('usuario', u.id, u.liberados, m)} />` },
  ];

  return html`
    <${Section} solta=${true} titulo="Acesso por perfil e por usuário"
      descricao="Libere um módulo para um perfil inteiro ou para uma pessoa. Quem tiver só um módulo não vê o seletor de módulos. As telas dentro do módulo continuam seguindo as permissões do perfil."
      acoes=${html`<div class="chm-seg" role="tablist" aria-label="Tipo de acesso">
        <button type="button" role="tab" aria-selected=${aba === 'perfil'} class=${aba === 'perfil' ? 'is-on' : ''} onClick=${() => setAba('perfil')}>Por perfil</button>
        <button type="button" role="tab" aria-selected=${aba === 'usuario'} class=${aba === 'usuario' ? 'is-on' : ''} onClick=${() => setAba('usuario')}>Por usuário</button>
      </div>`}>
      ${aba === 'usuario' ? html`<${Toolbar} busca=${busca} aoBuscar=${setBusca} placeholder="Buscar usuário por nome ou e-mail (mín. 2 letras)" />` : null}
      ${aba === 'perfil'
        ? html`<${DataTable} colunas=${colunasPerfil} linhas=${dados?.perfis || []} chaveLinha=${(p) => p.id} carregando=${!dados && !erro} erro=${erro} aoTentar=${carregar}
            vazio=${{ texto: 'Nenhum perfil cadastrado.' }} />`
        : html`<${DataTable} colunas=${colunasUsuario} linhas=${linhasUsuario} chaveLinha=${(u) => u.id} carregando=${!dados && !erro} erro=${erro} aoTentar=${carregar}
            vazio=${{ texto: busca.trim().length >= 2 ? 'Nenhum usuário encontrado.' : 'Nenhum usuário com liberação individual. Busque pelo nome para liberar um módulo.' }} />`}
    <//>`;
}
