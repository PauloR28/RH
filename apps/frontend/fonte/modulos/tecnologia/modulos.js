import { html, useCallback, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import { ModalConfirmacaoAcao, ModalPadrao } from '../../ui/componentes-compartilhados.js';
import { DataTable, Section, Toolbar } from '../../ui/components/layout-primitivas.js?v=20261005-redesign16';
import { IconeCx, InterruptorCx, PilulaStatus } from '../../ui/components/console-primitivas.js?v=20261014-historico';
import { listarUsuarios } from '../../services/api/settings.js';
import {
  aplicarLoteModulos,
  definirAcessoModulosPerfil,
  definirAcessoModulosUsuario,
  lerAcessosModulos,
  lerWfmParticipantes,
  listarFuncoesModulos,
} from '../../services/api/modulos.js?v=20261014-funcoes';
import { limparEstadoModulos, carregarAcessoModulos } from '../estado.js?v=20261014-funcoes2';
import {
  CHAVE_WFM_PARTICIPANTES, alternarRascunho, chaveFuncao, chaveModulo, consequenciasDoLote, contarLigadas, descreverLote,
  listarPendencias, paraPayloadLote, pendenciasDoModulo, valorExibido,
} from './pendencias.js';

// Tela Módulos (Tecnologia): lista de módulos à esquerda e, à direita, as funções do módulo escolhido (ligar/desligar), a ativação do
// módulo e o WFM para participantes (fase de teste). As mudanças ficam em RASCUNHO e são salvas de uma vez (PUT /tecnologia/modulos/lote,
// atômico, com auditoria). A aba "Atribuição" libera módulos a perfis e pessoas (conteúdo inalterado).

const DESCRICAO_MODULO = {
  rh: 'Currículos, Processos, Provas e gestão de Treinamentos.',
  operacao: 'Monitoria e Turnos e Plantões.',
  tecnologia: 'Administração do Conecta e Suporte TI.',
};
const NOME_MODULO = { rh: 'RH', operacao: 'Operação', tecnologia: 'Tecnologia' };
const MODULOS_LIBERAVEIS = ['rh', 'operacao', 'tecnologia'];

// Confirmação da aba Atribuição (libera/retira um módulo de um perfil ou pessoa): cada clique pede confirmação.
function montarConfirmacao(p) {
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
  const c = pendente ? montarConfirmacao(pendente) : null;
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

// ---- Confirmação do lote: mudanças agrupadas por módulo + consequências ----
function ModalSalvarLote({ aberto, pendencias, salvando, erro, aoCancelar, aoConfirmar }) {
  const [justificativa, setJustificativa] = useState('');
  useEffect(() => { if (aberto) setJustificativa(''); }, [aberto]);
  const linhas = descreverLote(pendencias, NOME_MODULO);
  return html`
    <${ModalPadrao} aberto=${aberto} titulo="Confirmar alterações?"
      subtitulo="Tudo é salvo de uma vez e fica registrado em auditoria." onClose=${salvando ? () => null : aoCancelar}>
      <div class="rh-details-body">
        <ul class="cx-mod-resumo">
          ${linhas.map((l) => html`<li key=${l.modulo}><strong>${l.nomeModulo}</strong><span>${l.texto}</span></li>`)}
        </ul>
        <ul class="cx-mod-consequencias">${consequenciasDoLote(pendencias).map((f) => html`<li key=${f}>${f}</li>`)}</ul>
        <label class="tec-campo"><span>Justificativa (opcional, vale para todas)</span>
          <input class="form-control" value=${justificativa} maxlength="400" disabled=${salvando} onInput=${(e) => setJustificativa(e.target.value)} />
        </label>
        ${erro ? html`<div class="alert alert-danger mt-3 mb-0" role="alert">${erro}</div>` : null}
      </div>
      <footer class="rh-modal-footer"><div class="rh-modal-footer-actions">
        <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${aoCancelar}>Cancelar</button>
        <button type="button" class="btn btn-primary" disabled=${salvando} onClick=${() => aoConfirmar(justificativa.trim())}>${salvando ? 'Salvando…' : 'Confirmar'}</button>
      </div></footer>
    <//>`;
}

function LinhaFuncao({ nome, descricao, ligado, travado, rotulo, aoMudar, nota = null, alterado = false, larga = false }) {
  return html`
    <li class=${`cx-mod2-funcao ${larga ? 'is-larga' : ''} ${alterado ? 'is-alterado' : ''}`.trim()}>
      <div class="cx-mod2-funcao-texto"><strong>${nome}${alterado ? html` <span class="cx-mod-tag">alterado</span>` : null}</strong><small>${descricao}</small>${nota}</div>
      <${InterruptorCx} ativo=${ligado} desabilitado=${travado} rotulo=${rotulo} aoMudar=${aoMudar} />
    </li>`;
}

export function SecaoFuncoes({ podeEditar, showToast, aoMudar, aoMudarPendentes, aoIrParaAtribuicao }) {
  const [dados, setDados] = useState(null);
  const [wfm, setWfm] = useState(null);
  const [erro, setErro] = useState('');
  const [selecionado, setSelecionado] = useState('');
  const [rascunho, setRascunho] = useState({});
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState('');

  const carregar = useCallback(() => {
    setErro('');
    setDados(null);
    Promise.all([listarFuncoesModulos(), lerWfmParticipantes().catch(() => null)])
      .then(([lista, situacao]) => { setDados(lista); setWfm(situacao); })
      .catch((e) => setErro(e?.message || 'Não foi possível carregar os módulos.'));
  }, []);
  useEffect(carregar, [carregar]);

  // Abre no primeiro módulo ativo (ou no primeiro, se nenhum estiver ativo).
  useEffect(() => {
    if (!dados || selecionado) return;
    setSelecionado((dados.find((m) => m.ativo) || dados[0])?.modulo || '');
  }, [dados, selecionado]);

  const pendencias = useMemo(() => listarPendencias(rascunho), [rascunho]);
  useEffect(() => { aoMudarPendentes?.(pendencias.length); }, [pendencias.length]);

  const alternar = (item, salvo) => setRascunho((atual) => alternarRascunho(atual, item, salvo));

  const salvar = async (justificativa) => {
    setSalvando(true);
    setErroSalvar('');
    try {
      const resposta = await aplicarLoteModulos(paraPayloadLote(pendencias), justificativa);
      setDados(resposta.funcoes);
      if (resposta.wfm) setWfm(resposta.wfm);
      setRascunho({});
      setConfirmando(false);
      recarregarMenu();
      aoMudar?.();
      showToast(`${pendencias.length} ${pendencias.length === 1 ? 'alteração salva' : 'alterações salvas'}. O menu atualiza para cada pessoa ao recarregar a página ou entrar de novo.`, 'success');
    } catch (e) {
      // Falha: nada é perdido. O rascunho continua na tela e dá para tentar de novo.
      setErroSalvar(e?.message || 'Não foi possível salvar. Nenhuma alteração foi aplicada.');
    } finally {
      setSalvando(false);
    }
  };

  if (erro) {
    const falha = html`<div class="cx-estado" role="alert"><span>${erro}</span><button type="button" class="cx-btn cx-btn--sm" onClick=${carregar}>Tentar de novo</button></div>`;
    return html`<div class="cx-mod2 cx-cresce"><section class="cx-card">${falha}</section><section class="cx-card">${falha}</section></div>`;
  }
  if (!dados) {
    const linhas = (n, altura) => Array.from({ length: n }, (_, i) => html`<div key=${i} class="cx-esqueleto" style=${{ height: `${altura}px` }}></div>`);
    return html`<div class="cx-mod2 cx-cresce" aria-busy="true"><section class="cx-card cx-mod2-lista">${linhas(3, 92)}</section><section class="cx-card cx-mod2-detalhe"><div class="cx-mod2-funcoes-area">${linhas(6, 60)}</div></section></div>`;
  }

  const atual = dados.find((m) => m.modulo === selecionado) || dados[0];
  const nomeMod = (m) => m.nome || NOME_MODULO[m.modulo] || m.modulo;
  const modLigado = (m) => valorExibido(rascunho, chaveModulo(m.modulo), m.ativo);
  const { ligadas, total } = contarLigadas(atual, rascunho, wfm);
  const disponiveis = atual.funcoes.filter((f) => !f.indisponivel);
  const indisponiveis = atual.funcoes.filter((f) => f.indisponivel);
  const doAmbiente = wfm?.origem === 'ambiente';
  const n = pendencias.length;

  return html`
    <div class="cx-mod2 cx-cresce">
      <section class="cx-card cx-mod2-lista" aria-label="Módulos">
        <h2 class="cx-mod2-rotulo">MÓDULOS</h2>
        <ul class="cx-mod2-linhas">
          ${dados.map((m) => {
    const c = contarLigadas(m, rascunho, wfm);
    const pend = pendenciasDoModulo(rascunho, m.modulo);
    return html`<li key=${m.modulo}>
              <button type="button" class=${`cx-mod2-linha ${m.modulo === atual.modulo ? 'is-ativa' : ''}`.trim()} aria-pressed=${m.modulo === atual.modulo} onClick=${() => setSelecionado(m.modulo)}>
                <span class="cx-mod2-linha-texto">
                  <span class="cx-mod2-linha-nome"><span class="cx-trunca">${nomeMod(m)}</span>${pend ? html`<span class="cx-mod2-ponto" aria-hidden="true"></span><span class="cx-sr">alteração pendente</span>` : null}</span>
                  <span class="cx-mod2-linha-desc cx-trunca" title=${DESCRICAO_MODULO[m.modulo] || ''}>${DESCRICAO_MODULO[m.modulo] || ''}</span>
                  <span class="cx-mod2-linha-meta">${c.ligadas} de ${c.total} funções ligadas</span>
                </span>
                ${m.protegido ? html`<${PilulaStatus} variante="protegido">módulo protegido<//>` : html`<${PilulaStatus} variante=${modLigado(m) ? 'ativo' : 'desativado'}>${modLigado(m) ? 'ativo' : 'desativado'}<//>`}
              </button>
            </li>`;
  })}
        </ul>
        <div class="cx-mod2-lista-rodape">
          <strong>Quem enxerga cada módulo?</strong>
          <span>Libere módulos para perfis ou pessoas na aba Atribuição.</span>
          <button type="button" class="cx-btn cx-btn--sm" onClick=${aoIrParaAtribuicao}>Ir para Atribuição</button>
        </div>
      </section>

      <section class="cx-card cx-mod2-detalhe" aria-label=${`Funções do módulo ${nomeMod(atual)}`}>
        <header class="cx-mod2-cab">
          <div class="cx-mod2-cab-texto"><h2 class="cx-mod2-titulo">${nomeMod(atual)}</h2><p>${DESCRICAO_MODULO[atual.modulo] || ''}</p></div>
          <div class="cx-mod2-cab-acoes">
            ${atual.protegido
      ? html`<${PilulaStatus} variante="protegido">módulo protegido<//><span class="cx-mod2-cadeado" role="img" aria-label="Sempre ativo" title="Sempre ativo"><${IconeCx} nome="lock" /></span>`
      : html`<${PilulaStatus} variante=${modLigado(atual) ? 'ativo' : 'desativado'}>${modLigado(atual) ? 'ativo' : 'desativado'}<//>
                <${InterruptorCx} ativo=${modLigado(atual)} desabilitado=${!podeEditar || salvando} rotulo=${`Ativar ou desativar o módulo ${nomeMod(atual)}`}
                  aoMudar=${() => alternar({ chave: chaveModulo(atual.modulo), tipo: 'modulo', modulo: atual.modulo, nome: nomeMod(atual), nomeModulo: nomeMod(atual) }, atual.ativo)} />`}
          </div>
        </header>
        <div class="cx-mod2-faixa"><span>FUNÇÕES EXIBIDAS NO MENU DE ${nomeMod(atual).toLocaleUpperCase('pt-BR')}</span><span>${ligadas} de ${total} ligadas</span></div>

        <div class="cx-mod2-funcoes-area">
          ${erroSalvar ? html`<div class="alert alert-danger" role="alert">${erroSalvar}</div>` : null}
          ${atual.funcoes.length || (atual.modulo === 'operacao' && wfm) ? html`<ul class="cx-mod2-funcoes">
            ${disponiveis.map((f) => {
      const chave = chaveFuncao(atual.modulo, f.chave);
      return html`<${LinhaFuncao} key=${f.chave} nome=${f.nome} descricao=${f.descricao} ligado=${valorExibido(rascunho, chave, f.ativo)} travado=${!podeEditar || salvando}
              rotulo=${f.nome} alterado=${chave in rascunho}
              aoMudar=${() => alternar({ chave, tipo: 'funcao', modulo: atual.modulo, funcao: f.chave, nome: f.nome, nomeModulo: nomeMod(atual) }, f.ativo)} />`;
    })}
            ${indisponiveis.map((f) => html`<${LinhaFuncao} key=${f.chave} nome=${f.nome} descricao=${f.descricao} ligado=${false} travado=${true} rotulo=${f.nome}
              nota=${html`<span class="cx-mod-participantes">Desativada no Conecta por decisão da empresa. Não pode ser ativada por aqui.</span>`} />`)}
            ${atual.modulo === 'operacao' && wfm ? html`<${LinhaFuncao} larga=${true} nome="Turnos e Plantões para participantes"
              descricao="Libera o WFM para Operador, Técnico de TI e Qualidade (fase de teste). Quem é liberado entra de novo no sistema."
              ligado=${valorExibido(rascunho, CHAVE_WFM_PARTICIPANTES, Boolean(wfm.liberado))} travado=${!podeEditar || !wfm.editavel || salvando}
              rotulo="Turnos e Plantões para participantes" alterado=${CHAVE_WFM_PARTICIPANTES in rascunho}
              aoMudar=${() => alternar({ chave: CHAVE_WFM_PARTICIPANTES, tipo: 'wfm_participantes', nome: 'Turnos e Plantões para participantes', nomeModulo: 'Operação' }, Boolean(wfm.liberado))}
              nota=${doAmbiente ? html`<span class="cx-mod-participantes">A variável RH_WFM_LIBERAR_PARTICIPANTES está definida e prevalece. Remova-a do ambiente para usar este interruptor.</span>` : null} />` : null}
          </ul>` : html`<p class="cx-mod2-vazio">Este módulo não tem funções configuráveis.</p>`}
        </div>

        <footer class="cx-mod2-rodape">
          <div class="cx-mod2-rodape-texto">
            <span role="status" class=${n ? 'cx-mod2-pendente' : 'cx-mod2-sem-pendencia'}>${n ? `${n} ${n === 1 ? 'alteração pendente' : 'alterações pendentes'}` : 'Nenhuma alteração pendente'}</span>
            <span class="cx-mod2-rodape-nota">Ao salvar, você confirma tudo de uma vez. Fica registrado em auditoria.</span>
          </div>
          <div class="cx-mod2-rodape-acoes">
            <button type="button" class="cx-btn" disabled=${!n || salvando} onClick=${() => { setRascunho({}); setErroSalvar(''); }}>Descartar</button>
            <button type="button" class="cx-btn cx-btn--primario" disabled=${!n || salvando || !podeEditar} onClick=${() => { setErroSalvar(''); setConfirmando(true); }}>
              <${IconeCx} nome="check" />Salvar alterações</button>
          </div>
        </footer>
      </section>
    </div>
    <${ModalSalvarLote} aberto=${confirmando} pendencias=${pendencias} salvando=${salvando} erro=${erroSalvar}
      aoCancelar=${() => setConfirmando(false)} aoConfirmar=${salvar} />`;
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
