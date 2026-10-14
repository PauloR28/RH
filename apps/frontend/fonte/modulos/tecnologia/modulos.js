import { html, useCallback, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import { ModalConfirmacaoAcao, ModalPadrao } from '../../ui/componentes-compartilhados.js';
import { DataTable, Section, Toolbar } from '../../ui/components/layout-primitivas.js?v=20261005-redesign16';
import { InterruptorCx } from '../../ui/components/console-primitivas.js?v=20261014-historico';
import { listarUsuarios } from '../../services/api/settings.js';
import {
  definirAcessoModulosPerfil,
  definirAcessoModulosUsuario,
  definirFuncaoModulo,
  definirModuloAtivo,
  definirWfmParticipantes,
  lerAcessosModulos,
  lerWfmParticipantes,
  listarFuncoesModulos,
} from '../../services/api/modulos.js?v=20261014-funcoes';
import { limparEstadoModulos, carregarAcessoModulos } from '../estado.js?v=20261014-funcoes2';

// Tela Módulos (Tecnologia): por módulo, as funções que ele exibe (ligar/desligar), a ativação do módulo, o WFM para participantes
// (fase de teste) e a atribuição de módulos a perfis e pessoas. Toda mudança pede confirmação explícita com as consequências.

const DESCRICAO_MODULO = {
  rh: 'Currículos, Processos, Provas e gestão de Treinamentos.',
  operacao: 'Monitoria e Turnos e Plantões.',
  tecnologia: 'Administração do Conecta e Suporte TI.',
};
const NOME_MODULO = { rh: 'RH', operacao: 'Operação', tecnologia: 'Tecnologia' };
const MODULOS_LIBERAVEIS = ['rh', 'operacao', 'tecnologia'];
const AVISO_VIGENCIA = 'A mudança vale para todos os usuários e aparece para cada pessoa ao recarregar a página ou entrar de novo.';

// Texto de cada confirmação: o que muda, quem é afetado e se dá para desfazer.
function montarConfirmacao(p) {
  if (!p) return null;
  if (p.tipo === 'funcao') {
    return p.ativo
      ? {
        titulo: `Mostrar ${p.nome} no módulo ${p.nomeModulo}?`,
        descricao: `"${p.nome}" passará a aparecer no menu do módulo ${p.nomeModulo}.`,
        consequencia: `Todos os usuários que usam o módulo ${p.nomeModulo} e têm permissão para ${p.nome} passam a ver esse atalho. Nenhuma permissão muda e nada é criado ou apagado. ${AVISO_VIGENCIA}`,
        reversibilidade: 'Pode ser desfeito a qualquer momento desligando a função de novo.',
        textoConfirmar: 'Mostrar no módulo', tipoModal: 'aviso',
      }
      : {
        titulo: `Esconder ${p.nome} do módulo ${p.nomeModulo}?`,
        descricao: `"${p.nome}" deixará de aparecer no menu do módulo ${p.nomeModulo}.`,
        consequencia: `Quem usa o módulo ${p.nomeModulo} perde o atalho para ${p.nome} nesse menu agora. As telas e os dados continuam existindo e as permissões não mudam: a função segue acessível pelos outros módulos onde estiver ligada. Se estiver desligada em todos, ninguém a verá no menu. ${AVISO_VIGENCIA}`,
        reversibilidade: 'Pode ser desfeito a qualquer momento ligando a função de novo.',
        textoConfirmar: 'Esconder do módulo', tipoModal: 'destrutivo',
      };
  }
  if (p.tipo === 'modulo') {
    return p.ativo
      ? {
        titulo: `Ativar o módulo ${p.nome}?`,
        descricao: `O módulo ${p.nome} voltará a funcionar para todos.`,
        consequencia: `As telas e rotas do módulo voltam a abrir para quem tem permissão que o libera. ${AVISO_VIGENCIA}`,
        reversibilidade: 'Pode ser desfeito a qualquer momento.',
        textoConfirmar: 'Ativar módulo', tipoModal: 'aviso',
      }
      : {
        titulo: `Desativar o módulo ${p.nome}?`,
        descricao: `Todo o módulo ${p.nome} será desligado para todos os usuários.`,
        consequencia: `As telas e as rotas do módulo ${p.nome} deixam de funcionar imediatamente e quem só usa este módulo perde o acesso ao sistema de trabalho dele. Os dados não são apagados. O app de treinamento (autoatendimento) continua funcionando.`,
        reversibilidade: 'Pode ser desfeito ativando o módulo de novo.',
        textoConfirmar: 'Desativar módulo', tipoModal: 'destrutivo',
      };
  }
  if (p.tipo === 'wfm') {
    return p.ativo
      ? {
        titulo: 'Liberar Turnos e Plantões para participantes?',
        descricao: 'Operador, Técnico de TI e Qualidade passam a acessar o WFM (fase de teste).',
        consequencia: 'Esses perfis precisarão entrar de novo no sistema para ver Turnos e Plantões. A mudança fica registrada em auditoria (quem, quando, de → para).',
        reversibilidade: 'Pode ser desfeito fechando para participantes.',
        textoConfirmar: 'Liberar', tipoModal: 'aviso',
      }
      : {
        titulo: 'Fechar Turnos e Plantões para participantes?',
        descricao: 'Operador, Técnico de TI e Qualidade perdem o acesso ao WFM.',
        consequencia: 'O acesso desses perfis ao WFM é cortado imediatamente. Escalas e dados já cadastrados não são apagados. A mudança fica registrada em auditoria.',
        reversibilidade: 'Pode ser desfeito liberando de novo.',
        textoConfirmar: 'Fechar', tipoModal: 'destrutivo',
      };
  }
  // atribuição de módulo a perfil ou pessoa
  const alvo = p.alvoTipo === 'perfil' ? `ao perfil ${p.alvoNome}` : `a ${p.alvoNome}`;
  const quem = p.alvoTipo === 'perfil' ? `Todos os usuários do perfil ${p.alvoNome}` : p.alvoNome;
  return p.ativo
    ? {
      titulo: `Liberar o módulo ${p.nomeModulo} ${alvo}?`,
      descricao: `${quem} passará a enxergar o módulo ${p.nomeModulo}.`,
      consequencia: `${quem} verá o módulo ${p.nomeModulo} no seletor no próximo login. As telas dentro dele continuam seguindo as permissões do perfil: liberar o módulo não concede permissões. A mudança fica registrada em auditoria.`,
      reversibilidade: 'Pode ser desfeito retirando a liberação.',
      textoConfirmar: 'Liberar módulo', tipoModal: 'aviso',
    }
    : {
      titulo: `Retirar o módulo ${p.nomeModulo} ${alvo}?`,
      descricao: `${quem} deixará de enxergar o módulo ${p.nomeModulo} por esta liberação.`,
      consequencia: `${quem} perde o acesso a ${p.nomeModulo} no próximo login, a não ser que as permissões do perfil já abram o módulo. Quem ficar com um único módulo deixa de ver o seletor. A mudança fica registrada em auditoria.`,
      reversibilidade: 'Pode ser desfeito liberando o módulo de novo.',
      textoConfirmar: 'Retirar liberação', tipoModal: 'destrutivo',
    };
}

function ConfirmarMudanca({ pendente, salvando, aoCancelar, aoConfirmar }) {
  const c = montarConfirmacao(pendente);
  return html`
    <${ModalConfirmacaoAcao}
      aberto=${Boolean(pendente)}
      titulo=${c?.titulo || ''}
      descricao=${c?.descricao || ''}
      consequencia=${c?.consequencia || ''}
      reversibilidade=${c?.reversibilidade || ''}
      labelJustificativa="Justificativa (opcional)"
      textoConfirmar=${c?.textoConfirmar || 'Confirmar'}
      tipo=${c?.tipoModal || 'aviso'}
      carregando=${salvando}
      onClose=${aoCancelar}
      onConfirm=${aoConfirmar}
    />`;
}

function recarregarMenu() {
  limparEstadoModulos();
  carregarAcessoModulos();
}

function LinhaFuncao({ nome, descricao, ligado, travado, rotulo, aoMudar, extra = null, alterado = false }) {
  return html`
    <li class=${`cx-mod-funcao ${alterado ? 'is-alterado' : ''}`.trim()}>
      <div class="cx-mod-funcao-texto"><strong>${nome}${alterado ? html` <span class="cx-mod-tag">alterado</span>` : null}</strong><small>${descricao}</small>${extra}</div>
      <${InterruptorCx} ativo=${ligado} desabilitado=${travado} rotulo=${rotulo} aoMudar=${aoMudar} />
    </li>`;
}

// Alterações ficam em rascunho na tela e só valem ao clicar em "Aplicar alterações" (uma confirmação para o conjunto, com as consequências).
function ModalAplicar({ aberto, itens, salvando, aoCancelar, aoConfirmar }) {
  const [justificativa, setJustificativa] = useState('');
  useEffect(() => { if (aberto) setJustificativa(''); }, [aberto]);
  const temRisco = itens.some((i) => montarConfirmacao(i).tipoModal === 'destrutivo');
  return html`
    <${ModalPadrao} aberto=${aberto} titulo=${`Aplicar ${itens.length} ${itens.length === 1 ? 'alteração' : 'alterações'}?`}
      subtitulo="Leia as consequências antes de continuar. Tudo fica registrado em auditoria." onClose=${salvando ? () => null : aoCancelar}>
      <div class="rh-details-body">
        ${temRisco ? html`<div class="alert alert-warning" role="alert">Há alterações que escondem funções ou desligam acesso. Elas valem para todos os usuários dos módulos afetados.</div>` : null}
        <ul class="cx-mod-resumo">
          ${itens.map((i) => {
    const c = montarConfirmacao(i);
    return html`<li key=${i.chave}><strong>${c.titulo.replace(/\?$/, '')}</strong><span>${c.consequencia}</span></li>`;
  })}
        </ul>
        <label class="tec-campo"><span>Justificativa (opcional, vale para todas)</span>
          <input class="form-control" value=${justificativa} maxlength="400" disabled=${salvando} onInput=${(e) => setJustificativa(e.target.value)} />
        </label>
      </div>
      <footer class="rh-modal-footer"><div class="rh-modal-footer-actions">
        <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${aoCancelar}>Cancelar</button>
        <button type="button" class=${`btn ${temRisco ? 'btn-danger' : 'btn-primary'}`} disabled=${salvando} onClick=${() => aoConfirmar(justificativa.trim())}>${salvando ? 'Aplicando…' : 'Aplicar alterações'}</button>
      </div></footer>
    <//>`;
}

export function SecaoFuncoes({ podeEditar, showToast, aoMudar }) {
  const [modulos, setModulos] = useState(null);
  const [wfm, setWfm] = useState(null);
  const [erro, setErro] = useState('');
  const [rascunho, setRascunho] = useState({});
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(() => {
    setErro('');
    listarFuncoesModulos().then(setModulos).catch((e) => setErro(e?.message || 'Não foi possível carregar os módulos.'));
    lerWfmParticipantes().then(setWfm).catch(() => setWfm(null));
  }, []);
  useEffect(carregar, [carregar]);

  // Liga/desliga em rascunho: voltar ao valor original desfaz a alteração pendente.
  const alternar = (item, original) => setRascunho((atual) => {
    const novo = { ...atual };
    const valorAtual = item.chave in novo ? novo[item.chave].ativo : original;
    const proximo = !valorAtual;
    if (proximo === original) delete novo[item.chave];
    else novo[item.chave] = { ...item, ativo: proximo };
    return novo;
  });
  const ligado = (chave, original) => (chave in rascunho ? rascunho[chave].ativo : original);
  const pendentes = Object.values(rascunho);

  const aplicar = async (justificativa) => {
    setSalvando(true);
    const falhas = [];
    for (const p of pendentes) {
      try {
        if (p.tipo === 'funcao') await definirFuncaoModulo(p.modulo, p.funcao, p.ativo, justificativa);
        else if (p.tipo === 'modulo') await definirModuloAtivo(p.modulo, p.ativo, justificativa);
        else setWfm(await definirWfmParticipantes(p.ativo, justificativa));
        setRascunho((atual) => { const novo = { ...atual }; delete novo[p.chave]; return novo; });
      } catch (e) {
        falhas.push(`${p.nome}: ${e?.message || 'não foi possível salvar'}`);
      }
    }
    setSalvando(false);
    setConfirmando(false);
    recarregarMenu();
    carregar();
    aoMudar?.();
    if (falhas.length) showToast(`Algumas alterações não foram aplicadas — ${falhas.join('; ')}`, 'error');
    else showToast(`${pendentes.length} ${pendentes.length === 1 ? 'alteração aplicada' : 'alterações aplicadas'}. O menu atualiza para cada pessoa ao recarregar a página ou entrar de novo.`, 'success');
  };

  if (erro) return html`<div class="alert alert-danger" role="alert">${erro} <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${carregar}>Tentar de novo</button></div>`;
  if (!modulos) return html`<p class="tec-ajuda tec-ajuda--topo">Carregando…</p>`;

  const doAmbiente = wfm?.origem === 'ambiente';
  return html`
    <div class="cx-mod-lista">
      <div class="cx-aviso cx-aviso--suave" role="note">
        <span>Cada módulo mostra no menu só as funções ligadas aqui. Desligar uma função não apaga dados nem muda permissões: só esconde o atalho naquele módulo. As mudanças ficam em rascunho até você clicar em <strong>Aplicar alterações</strong>; aí aparece uma confirmação com as consequências e tudo fica registrado em auditoria. ${podeEditar ? '' : 'Você não tem permissão para alterar.'}</span>
      </div>
      ${modulos.map((m) => {
    const chaveModulo = `m:${m.modulo}`;
    return html`
        <section class="cx-card cx-mod-card" key=${m.modulo}>
          <header class="cx-mod-cab">
            <div class="cx-mod-cab-texto">
              <h2 class="cx-h2">${m.nome}</h2>
              <p class="cx-legenda">${DESCRICAO_MODULO[m.modulo] || ''}</p>
            </div>
            ${m.protegido
      ? html`<span class="tec-pill" title="Nunca pode ser desativado, para ninguém ficar sem acesso">módulo protegido</span>`
      : html`<span class="cx-mod-ativacao"><span class=${`tec-pill ${ligado(chaveModulo, m.ativo) ? 'is-ok' : 'is-aviso'}`}>${ligado(chaveModulo, m.ativo) ? 'ativo' : 'desativado'}</span>
                <${InterruptorCx} ativo=${ligado(chaveModulo, m.ativo)} desabilitado=${!podeEditar || salvando} rotulo=${`Módulo ${m.nome}`}
                  aoMudar=${() => alternar({ chave: chaveModulo, tipo: 'modulo', modulo: m.modulo, nome: m.nome }, m.ativo)} /></span>`}
          </header>
          <p class="cx-mod-sub">Funções exibidas no menu de ${m.nome}</p>
          <ul class="cx-mod-funcoes">
            ${m.funcoes.map((f) => {
      const chave = `f:${m.modulo}:${f.chave}`;
      return html`<${LinhaFuncao} key=${f.chave} nome=${f.nome} descricao=${f.descricao} ligado=${ligado(chave, f.ativo)} travado=${!podeEditar || salvando}
              rotulo=${`${f.nome} no módulo ${m.nome}`} alterado=${chave in rascunho}
              aoMudar=${() => alternar({ chave, tipo: 'funcao', modulo: m.modulo, funcao: f.chave, nome: f.nome, nomeModulo: m.nome }, f.ativo)} />`;
    })}
            ${m.modulo === 'operacao' && wfm ? html`<${LinhaFuncao} nome="Turnos e Plantões para participantes" descricao="Libera o WFM para Operador, Técnico de TI e Qualidade (fase de teste). Quem é liberado entra de novo no sistema."
              ligado=${ligado('w', Boolean(wfm.liberado))} travado=${!podeEditar || !wfm.editavel || salvando} rotulo="Turnos e Plantões para participantes" alterado=${'w' in rascunho}
              aoMudar=${() => alternar({ chave: 'w', tipo: 'wfm', nome: 'Turnos e Plantões para participantes' }, Boolean(wfm.liberado))}
              extra=${doAmbiente ? html`<span class="cx-mod-participantes">A variável RH_WFM_LIBERAR_PARTICIPANTES está definida e prevalece. Remova-a do ambiente para usar este interruptor.</span>` : null} />` : null}
          </ul>
        </section>`;
  })}
      ${pendentes.length ? html`
        <div class="cx-mod-barra" role="region" aria-label="Alterações pendentes">
          <span><strong>${pendentes.length}</strong> ${pendentes.length === 1 ? 'alteração pendente' : 'alterações pendentes'} — ainda não aplicada${pendentes.length === 1 ? '' : 's'}</span>
          <span class="cx-mod-barra-acoes">
            <button type="button" class="cx-btn" disabled=${salvando} onClick=${() => setRascunho({})}>Descartar</button>
            <button type="button" class="cx-btn cx-btn--primario" disabled=${salvando} onClick=${() => setConfirmando(true)}>Aplicar alterações</button>
          </span>
        </div>` : null}
    </div>
    <${ModalAplicar} aberto=${confirmando} itens=${pendentes} salvando=${salvando} aoCancelar=${() => setConfirmando(false)} aoConfirmar=${aplicar} />`;
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

export function SecaoAtribuicao({ podeEditar, showToast, aoMudar }) {
  const [aba, setAba] = useState('usuario');
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [encontrados, setEncontrados] = useState([]);
  const [pendente, setPendente] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(() => {
    setErro('');
    lerAcessosModulos().then(setDados).catch((e) => setErro(e?.message || 'Não foi possível carregar os acessos.'));
  }, []);
  useEffect(carregar, [carregar]);

  // Busca de usuários só roda na aba "pessoa", no servidor e com pelo menos 2 letras (nada de baixar todos).
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

  const pedir = (alvoTipo, id, alvoNome, atuais, modulo) => setPendente({
    tipo: 'atribuicao', alvoTipo, id, alvoNome, atuais, modulo, nomeModulo: NOME_MODULO[modulo], ativo: !atuais.includes(modulo),
  });

  const confirmar = async ({ justificativa } = {}) => {
    const p = pendente;
    const novos = p.ativo ? [...p.atuais, p.modulo] : p.atuais.filter((m) => m !== p.modulo);
    setSalvando(true);
    try {
      if (p.alvoTipo === 'perfil') await definirAcessoModulosPerfil(p.id, novos, justificativa);
      else await definirAcessoModulosUsuario(p.id, novos, justificativa);
      setPendente(null);
      recarregarMenu();
      carregar();
      aoMudar?.();
      showToast('Atribuição atualizada. Vale no próximo login da pessoa.', 'success');
    } catch (e) {
      setPendente(null);
      showToast(e?.message || 'Não foi possível salvar a atribuição.', 'error');
    } finally {
      setSalvando(false);
    }
  };

  const derivadosDoPerfil = useMemo(() => Object.fromEntries((dados?.perfis || []).map((p) => [p.id, p.derivados])), [dados]);
  const colunasPerfil = [
    { chave: 'nome', rotulo: 'Perfil', prioridade: 1, fixa: true, render: (p) => html`<strong>${p.nome}</strong>` },
    { chave: 'modulos', rotulo: 'Módulos que o perfil acessa', prioridade: 1,
      render: (p) => html`<${CaixasModulos} derivados=${p.derivados} liberados=${p.liberados} desabilitado=${!podeEditar} rotulo=${p.nome}
        aoAlternar=${(m) => pedir('perfil', p.id, p.nome, p.liberados, m)} />` },
  ];

  // Pessoas com liberação individual + resultado da busca (sem repetir).
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
    { chave: 'nome', rotulo: 'Pessoa', prioridade: 1, fixa: true, render: (u) => html`<strong>${u.nome}</strong>` },
    { chave: 'email', rotulo: 'E-mail', prioridade: 2, render: (u) => u.email },
    { chave: 'modulos', rotulo: 'Módulos que a pessoa acessa', prioridade: 1,
      render: (u) => html`<${CaixasModulos} derivados=${derivadosDoPerfil[u.perfil] || []} liberados=${u.liberados} desabilitado=${!podeEditar} rotulo=${u.nome}
        aoAlternar=${(m) => pedir('usuario', u.id, u.nome, u.liberados, m)} />` },
  ];

  return html`
    <${Section} solta=${true} titulo="Atribuição de módulos"
      descricao="Libere um módulo para uma pessoa específica ou para um perfil inteiro. Liberar o módulo não concede permissões: as telas dentro dele continuam seguindo as permissões do perfil. Quem tiver só um módulo não vê o seletor."
      acoes=${html`<div class="chm-seg" role="tablist" aria-label="Atribuir a">
        <button type="button" role="tab" aria-selected=${aba === 'usuario'} class=${aba === 'usuario' ? 'is-on' : ''} onClick=${() => setAba('usuario')}>Por pessoa</button>
        <button type="button" role="tab" aria-selected=${aba === 'perfil'} class=${aba === 'perfil' ? 'is-on' : ''} onClick=${() => setAba('perfil')}>Por perfil</button>
      </div>`}>
      ${aba === 'usuario' ? html`<${Toolbar} busca=${busca} aoBuscar=${setBusca} placeholder="Buscar pessoa por nome ou e-mail (mín. 2 letras)" />` : null}
      ${aba === 'perfil'
    ? html`<${DataTable} colunas=${colunasPerfil} linhas=${dados?.perfis || []} chaveLinha=${(p) => p.id} carregando=${!dados && !erro} erro=${erro} aoTentar=${carregar}
            vazio=${{ texto: 'Nenhum perfil cadastrado.' }} />`
    : html`<${DataTable} colunas=${colunasUsuario} linhas=${linhasUsuario} chaveLinha=${(u) => u.id} carregando=${!dados && !erro} erro=${erro} aoTentar=${carregar}
            vazio=${{ texto: busca.trim().length >= 2 ? 'Nenhuma pessoa encontrada.' : 'Nenhuma pessoa com liberação individual. Busque pelo nome para liberar um módulo.' }} />`}
    <//>
    <${ConfirmarMudanca} pendente=${pendente} salvando=${salvando} aoCancelar=${() => setPendente(null)} aoConfirmar=${confirmar} />`;
}
