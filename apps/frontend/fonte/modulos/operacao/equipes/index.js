import { html, useCallback, useEffect, useState } from '../../../infraestrutura-react.js';
import { EmptyState, LoadingState, ModalPadrao, PainelRh } from '../../../ui/componentes-compartilhados.js';
import { CardResumo, EstadoConsole, IconeCx, PaginaConsole } from '../../../ui/components/console-primitivas.js?v=20261022-equipes';
import { ContextField, ModuleHeader, ModuleTabs, Stepper } from '../../../ui/components/modulo-primitivas.js?v=20261023-ajustes';
import { useToast } from '../../../shared/hooks/use-toast.js';
import { MenuAcoesProcesso } from '../../../ui/components/menu-acoes.js';
import {
  adicionarOperadorEquipe,
  API_MURAL_EQUIPE,
  lerContextoEquipes,
  lerMonitoriasEquipe,
  listarCandidatosEquipe,
  listarSupervisoresDestinoEquipe,
  removerOperadorEquipe,
} from '../../../services/api/equipes.js';
import { TelaMural } from '../../../features/mural/index.js?v=20261022-equipes';
import { mesAtual, useContextoWfm } from '../wfm/comum.js?v=20261029-fix';
import { TelaEscala } from '../wfm/escala.js?v=20261029-fix';
import { CalendarioEquipe } from '../wfm/calendario-equipe.js?v=20261029-fix';
import { TelaPresenca } from '../wfm/presenca.js?v=20261029-fix';
import { TelaCadastros } from '../wfm/cadastros.js?v=20261029-fix';
import { rotuloMesAno, somarMes } from '../wfm/escala-ui.js?v=20261029-fix';

// Controle de Equipes e Turnos (Supervisor): visão macro da própria equipe. Presença, escala e horários reaproveitam as telas do
// WFM (com o escopo de operação/equipe aplicado no servidor); equipe, monitorias e Mural usam as rotas /equipes.

const ABAS = [
  { id: 'equipe', rotulo: 'Equipe', icone: 'groups' },
  { id: 'presenca', rotulo: 'Presença', icone: 'fact_check', permissao: 'wfm.presenca.lancar' },
  { id: 'monitorias', rotulo: 'Monitorias', icone: 'rate_review', permissao: 'monitoria.visualizar' },
  { id: 'escala', rotulo: 'Escala', icone: 'calendar_month', permissao: 'wfm.escala.visualizar' },
  { id: 'horarios', rotulo: 'Horários', icone: 'schedule', permissao: 'wfm.cadastros.visualizar' },
  { id: 'mural', rotulo: 'Mural', icone: 'campaign', permissao: 'equipes.mural.publicar' },
];

const DESCRICAO = {
  equipe: 'Operadores da sua equipe e o seu turno. Adicionar ou remover aqui atualiza o cadastro do operador.',
  presenca: 'Presença, falta e atestado da sua equipe, por semana.',
  monitorias: 'Notas das monitorias dos operadores da sua equipe.',
  escala: 'Escala mensal da sua equipe, ou de todas as equipes (escolha ao lado). Para montar ou alterar, use Turnos e Plantões.',
  horarios: 'Turnos, horários e pausas aplicados à sua equipe.',
  mural: 'Publique avisos direto nas intranets das operações da sua equipe.',
};

const dataBr = (valor) => (valor ? new Date(valor).toLocaleDateString('pt-BR') : '—');
const formatarNota = (valor) => (valor === null || valor === undefined ? '—' : Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

function useContextoEquipes(idSupervisor) {
  const [contexto, setContexto] = useState(null);
  const [erro, setErro] = useState('');
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    let ativo = true;
    setErro('');
    lerContextoEquipes(idSupervisor)
      .then((dados) => { if (ativo) setContexto(dados); })
      .catch((e) => { if (ativo) setErro(e?.message || 'Não foi possível carregar a equipe.'); });
    return () => { ativo = false; };
  }, [idSupervisor, versao]);
  return { contexto, setContexto, erro, recarregar: useCallback(() => setVersao((v) => v + 1), []) };
}

function ModalAdicionar({ aberto, aoFechar, aoAdicionar }) {
  const [itens, setItens] = useState(null);
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(0);
  const [erro, setErro] = useState('');
  useEffect(() => {
    if (!aberto) return;
    setItens(null); setBusca(''); setErro('');
    listarCandidatosEquipe().then((r) => setItens(r.itens || []), (e) => { setErro(e?.message || 'Não foi possível listar os operadores.'); setItens([]); });
  }, [aberto]);
  const filtrados = (itens || []).filter((i) => i.nome.toLowerCase().includes(busca.trim().toLowerCase()));
  const adicionar = async (item) => {
    setSalvando(item.id_usuario); setErro('');
    try { await aoAdicionar(item); } catch (e) { setErro(e?.message || 'Não foi possível adicionar.'); } finally { setSalvando(0); }
  };
  return html`<${ModalPadrao} aberto=${aberto} titulo="Adicionar operador" subtitulo="Operadores das suas operações que ainda não estão na sua equipe." onClose=${aoFechar}>
    <div class="eq-modal">
      <input class="form-control" type="search" placeholder="Buscar pelo nome" aria-label="Buscar operador" value=${busca} onInput=${(e) => setBusca(e.target.value)} />
      ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>` : null}
      ${itens === null ? html`<${LoadingState} titulo="Carregando operadores" />` : filtrados.length ? html`<ul class="eq-lista">
        ${filtrados.map((item) => html`<li key=${item.id_usuario} class="eq-lista-item">
          <span class="eq-lista-nome"><strong>${item.nome}</strong><small>${item.turno || 'Sem turno definido'} · ${item.qtd_supervisores} ${item.qtd_supervisores === 1 ? 'supervisor' : 'supervisores'}</small></span>
          <button type="button" class="cx-btn cx-btn--sm cx-btn--primario" disabled=${!item.disponivel || salvando === item.id_usuario} title=${item.disponivel ? '' : 'O operador já tem o máximo de supervisores'} onClick=${() => adicionar(item)}>
            ${salvando === item.id_usuario ? 'Adicionando...' : item.disponivel ? 'Adicionar' : 'Sem vaga'}</button>
        </li>`)}
      </ul>` : html`<${EstadoConsole} mensagem=${busca ? 'Nenhum operador encontrado.' : 'Não há operadores disponíveis nas suas operações.'} />`}
    </div>
  </${ModalPadrao}>`;
}

function ModalRemover({ operador, aoFechar, aoConfirmar }) {
  const [destinos, setDestinos] = useState([]);
  const [novo, setNovo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const unico = operador?.qtd_supervisores === 1;
  useEffect(() => {
    if (!operador) return;
    setNovo(''); setErro('');
    if (operador.qtd_supervisores === 1) listarSupervisoresDestinoEquipe().then((r) => setDestinos(r.itens || []), () => setDestinos([]));
  }, [operador]);
  if (!operador) return null;
  const confirmar = async () => {
    setSalvando(true); setErro('');
    try { await aoConfirmar(operador, novo ? Number(novo) : null); } catch (e) { setErro(e?.message || 'Não foi possível remover.'); } finally { setSalvando(false); }
  };
  return html`<${ModalPadrao} aberto=${true} titulo="Remover da equipe" subtitulo=${operador.nome} onClose=${aoFechar}>
    <div class="eq-modal">
      <p class="eq-texto">${unico
        ? 'Você é o único supervisor deste operador. Escolha quem vai recebê-lo na equipe para concluir a remoção.'
        : 'O operador continua na equipe do outro supervisor e deixa a sua.'}</p>
      ${unico ? html`<label class="form-field"><span class="form-label">Novo supervisor</span>
        <select class="form-select" value=${novo} onChange=${(e) => setNovo(e.target.value)}>
          <option value="">Selecione</option>
          ${destinos.map((d) => html`<option key=${d.id_usuario} value=${d.id_usuario}>${d.nome}</option>`)}
        </select></label>` : null}
      ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>` : null}
      <footer class="rh-modal-footer">
        <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${aoFechar}>Cancelar</button>
        <button type="button" class="btn btn-primary" disabled=${salvando || (unico && !novo)} onClick=${confirmar}>${salvando ? 'Removendo...' : 'Remover'}</button>
      </footer>
    </div>
  </${ModalPadrao}>`;
}

// Transferir = tirar o operador da minha equipe e entregá-lo a outro supervisor (confirmação obrigatória).
function ModalTransferir({ operador, aoFechar, aoConfirmar }) {
  const [destinos, setDestinos] = useState(null);
  const [novo, setNovo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  useEffect(() => {
    if (!operador) return;
    setNovo(''); setErro(''); setDestinos(null);
    listarSupervisoresDestinoEquipe().then((r) => setDestinos(r.itens || []), () => setDestinos([]));
  }, [operador]);
  if (!operador) return null;
  const confirmar = async () => {
    setSalvando(true); setErro('');
    try { await aoConfirmar(operador, Number(novo), (destinos || []).find((d) => String(d.id_usuario) === novo)?.nome || ''); } catch (e) { setErro(e?.message || 'Não foi possível transferir.'); } finally { setSalvando(false); }
  };
  return html`<${ModalPadrao} aberto=${true} titulo="Transferir operador" subtitulo=${operador.nome} onClose=${aoFechar}>
    <div class="eq-modal">
      <p class="eq-texto">O operador sai da sua equipe e passa para a equipe do supervisor escolhido. O cadastro dele é atualizado na hora.</p>
      <label class="form-field"><span class="form-label">Equipe do supervisor</span>
        <select class="form-select" value=${novo} onChange=${(e) => setNovo(e.target.value)} disabled=${destinos === null}>
          <option value="">${destinos === null ? 'Carregando…' : destinos.length ? 'Selecione' : 'Nenhum supervisor disponível'}</option>
          ${(destinos || []).map((d) => html`<option key=${d.id_usuario} value=${d.id_usuario}>${d.nome}</option>`)}
        </select></label>
      ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>` : null}
      <footer class="rh-modal-footer">
        <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${aoFechar}>Cancelar</button>
        <button type="button" class="btn btn-primary" disabled=${salvando || !novo} onClick=${confirmar}>${salvando ? 'Transferindo...' : 'Confirmar transferência'}</button>
      </footer>
    </div>
  </${ModalPadrao}>`;
}

function AbaEquipe({ contexto, setContexto, showToast }) {
  const [adicionando, setAdicionando] = useState(false);
  const [removendo, setRemovendo] = useState(null);
  const [transferindo, setTransferindo] = useState(null);
  const sup = contexto.supervisor;
  const operadores = contexto.operadores || [];
  const sem = operadores.filter((o) => !o.turno).length;
  const adicionar = async (item) => {
    const novo = await adicionarOperadorEquipe(item.id_usuario);
    setContexto(novo); setAdicionando(false); showToast(`${item.nome} entrou na sua equipe.`, 'success');
  };
  const remover = async (operador, idNovo) => {
    const novo = await removerOperadorEquipe(operador.id_usuario, idNovo);
    setContexto(novo); setRemovendo(null); showToast(`${operador.nome} saiu da sua equipe.`, 'success');
  };
  const transferir = async (operador, idNovo, nomeNovo) => {
    const novo = await removerOperadorEquipe(operador.id_usuario, idNovo);
    setContexto(novo); setTransferindo(null); showToast(`${operador.nome} foi transferido${nomeNovo ? ` para a equipe de ${nomeNovo}` : ''}.`, 'success');
  };
  const primeiroSegundo = (nome) => String(nome || '').trim().split(/\s+/).slice(0, 2).join(' ');
  return html`<div class="eq-aba">
    <div class="cx-resumos eq-resumos">
      <${CardResumo} icone="person" rotulo="Supervisor" valor=${sup.nome} texto=${true} />
      <${CardResumo} icone="schedule" rotulo="Seu turno" valor=${sup.turno || 'Não definido'} texto=${true} />
      <${CardResumo} icone="apartment" rotulo="Operações" valor=${(contexto.operacoes || []).map((o) => o.nome).join(', ') || '—'} texto=${true} />
      <${CardResumo} icone="groups" rotulo="Operadores" valor=${String(operadores.length)} complemento=${sem ? `· ${sem} sem turno` : ''} />
    </div>
    <section class="eq-card" aria-label="Operadores da equipe">
      <header class="eq-card-cab">
        <h2 class="eq-card-titulo">Operadores da equipe</h2>
        ${contexto.pode_editar_membros ? html`<${MenuAcoesProcesso} label="Ações" mostrarLabel=${true} icon="expand_more" ariaLabel="Ações da equipe" triggerClassName="cx-btn cx-btn--primario"
          acoes=${[{ label: 'Adicionar operador', icon: 'person_add', onClick: () => setAdicionando(true) }]} />` : null}
      </header>
      ${operadores.length ? html`<div class="eq-tabela-rolagem"><table class="cx-tabela eq-compacta">
        <thead><tr><th>Operador</th><th>Operação</th><th>Turno</th>${contexto.pode_editar_membros ? html`<th class="eq-acoes">Ações</th>` : null}</tr></thead>
        <tbody>${operadores.map((o) => html`<tr key=${o.id_usuario}>
          <td><strong class="eq-nome" title=${`${o.nome} · ${o.email}`}>${primeiroSegundo(o.nome)}</strong></td>
          <td>${o.operacoes.join(', ') || '—'}</td>
          <td>${o.turno || '—'}</td>
          ${contexto.pode_editar_membros ? html`<td class="eq-acoes"><${MenuAcoesProcesso} icon="more_horiz" ariaLabel=${`Ações de ${o.nome}`}
            acoes=${[{ label: 'Transferir operador', icon: 'swap_horiz', onClick: () => setTransferindo(o) }, { separator: true }, { label: 'Remover da equipe', icon: 'person_remove', danger: true, onClick: () => setRemovendo(o) }]} /></td>` : null}
        </tr>`)}</tbody>
      </table></div>` : html`<${EstadoConsole} mensagem="Nenhum operador na sua equipe ainda." rotuloAcao=${contexto.pode_editar_membros ? 'Adicionar operador' : undefined} aoAcao=${contexto.pode_editar_membros ? () => setAdicionando(true) : undefined} />`}
    </section>
    <${ModalAdicionar} aberto=${adicionando} aoFechar=${() => setAdicionando(false)} aoAdicionar=${adicionar} />
    <${ModalRemover} operador=${removendo} aoFechar=${() => setRemovendo(null)} aoConfirmar=${remover} />
    <${ModalTransferir} operador=${transferindo} aoFechar=${() => setTransferindo(null)} aoConfirmar=${transferir} />
  </div>`;
}

function AbaMonitorias({ idSupervisor }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [dias, setDias] = useState(90);
  useEffect(() => {
    let ativo = true;
    setDados(null); setErro('');
    lerMonitoriasEquipe(idSupervisor, dias).then((r) => ativo && setDados(r), (e) => ativo && setErro(e?.message || 'Não foi possível carregar as monitorias.'));
    return () => { ativo = false; };
  }, [idSupervisor, dias]);
  if (erro) return html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  if (!dados) return html`<${LoadingState} titulo="Carregando monitorias" />`;
  const r = dados.resumo;
  return html`<div class="eq-aba">
    <div class="eq-filtro">
      <label class="form-field eq-filtro-campo"><span class="form-label">Período</span>
        <select class="form-select" value=${dias} onChange=${(e) => setDias(Number(e.target.value))}>
          <option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="180">Últimos 180 dias</option><option value="365">Últimos 12 meses</option>
        </select></label>
    </div>
    ${!r || !r.quantidade_realizadas ? html`<${EstadoConsole} mensagem="Nenhuma monitoria dos operadores da sua equipe neste período." />` : html`
      <div class="cx-resumos eq-resumos">
        <${CardResumo} icone="star" rotulo="Nota média da equipe" valor=${formatarNota(r.nota_media)} complemento=${r.faixa?.nome ? `· ${r.faixa.nome}` : ''} />
        <${CardResumo} icone="fact_check" rotulo="Realizadas" valor=${String(r.quantidade_realizadas)} complemento=${r.quantidade_anuladas ? `· ${r.quantidade_anuladas} anuladas` : ''} />
        <${CardResumo} icone="emoji_events" rotulo="Melhor nota" valor=${formatarNota(r.melhor_nota)} />
        <${CardResumo} icone="report" rotulo="Com NCG" valor=${String(r.ncg)} />
      </div>
      <section class="eq-card" aria-label="Nota por operador">
        <header class="eq-card-cab"><h2 class="eq-card-titulo">Nota por operador</h2></header>
        <div class="eq-tabela-rolagem"><table class="cx-tabela">
          <thead><tr><th>Operador</th><th>Monitorias</th><th>Válidas</th><th>Nota média</th><th>NCG</th></tr></thead>
          <tbody>${dados.por_operador.map((o) => html`<tr key=${o.chave}><td><strong class="eq-nome">${o.rotulo}</strong></td><td>${o.quantidade_realizadas}</td><td>${o.quantidade_validas}</td><td>${formatarNota(o.nota_media)}</td><td>${o.ncg}</td></tr>`)}</tbody>
        </table></div>
      </section>
      <section class="eq-card" aria-label="Monitorias realizadas">
        <header class="eq-card-cab"><h2 class="eq-card-titulo">Monitorias realizadas</h2></header>
        <div class="eq-tabela-rolagem"><table class="cx-tabela">
          <thead><tr><th>Operador</th><th>Data</th><th>Código</th><th>Canal</th><th>Avaliador</th><th>Nota</th></tr></thead>
          <tbody>${dados.itens.map((m) => html`<tr key=${m.id_monitoria}>
            <td><strong class="eq-nome">${m.operador_nome}</strong></td><td>${dataBr(m.data)}</td><td>${m.codigo}</td><td>${m.canal || '—'}</td><td>${m.avaliador_nome}</td>
            <td>${m.anulada ? 'Anulada' : html`<strong>${formatarNota(m.nota)}</strong>${m.possui_ncg ? ' · NCG' : ''}`}</td></tr>`)}</tbody>
        </table></div>
      </section>`}
  </div>`;
}

export function TelaEquipesControle({ controlador }) {
  const { showToast, ToastHost } = useToast();
  const [aba, setAba] = useState('equipe');
  const [idSupervisor, setIdSupervisor] = useState('');
  const { contexto, setContexto, erro } = useContextoEquipes(idSupervisor);
  const wfm = useContextoWfm();
  const [operacao, setOperacao] = useState('');
  const [anoMes, setAnoMes] = useState(mesAtual());

  const abas = ABAS.filter((a) => !a.permissao || controlador.possuiPermissao(a.permissao));
  useEffect(() => {
    if (contexto && !contexto.eh_supervisor && !idSupervisor && contexto.supervisores?.length) setIdSupervisor(String(contexto.supervisores[0].id_usuario));
  }, [contexto, idSupervisor]);
  // Escalas ativas das operações da equipe: o WFM decide o que o usuário enxerga.
  const operacoesWfm = (wfm.contexto?.operacoes || []).filter((o) => o.escala_ativa !== false);
  const chavesEquipe = new Set((contexto?.operacoes || []).map((o) => o.chave));
  const daEquipe = operacoesWfm.filter((o) => chavesEquipe.has(o.chave));
  const escalas = daEquipe.length ? daEquipe : operacoesWfm;
  useEffect(() => {
    if (escalas.length && !escalas.some((o) => o.chave === operacao)) setOperacao(escalas[0].chave);
  }, [escalas.map((o) => o.chave).join('|')]);

  const titulo = 'Controle de Equipes e Turnos';
  const corpoAba = () => {
    if (aba === 'equipe') return html`<${AbaEquipe} contexto=${contexto} setContexto=${setContexto} showToast=${showToast} />`;
    if (aba === 'monitorias') return html`<${AbaMonitorias} idSupervisor=${idSupervisor} />`;
    if (aba === 'mural') return html`<${TelaMural} controlador=${controlador} embutido=${true} api=${API_MURAL_EQUIPE} rotuloAmbientes="Publicar nas intranets das operações da sua equipe" />`;
    if (wfm.erro) return html`<div class="mon-alerta mon-alerta--danger" role="alert">${wfm.erro}</div>`;
    if (!wfm.contexto) return html`<${LoadingState} titulo="Carregando" />`;
    if (!escalas.length || !operacao) return html`<${EmptyState} icon="calendar_month" title="Nenhuma escala ativa" text="Não há escala ativa para a sua equipe. Quem gere as escalas pode criar ou ativar uma em Turnos e Plantões." />`;
    const props = { controlador, contexto: wfm.contexto, operacao, anoMes, showToast, recarregarContexto: wfm.recarregar, aoTrocarEscala: setOperacao };
    return html`
      ${aba === 'horarios' || (aba === 'presenca' && escalas.length > 1) ? html`<div class="mo-contexto cx-fixo">
        <${ContextField} rotulo="Escala / operação" valor=${operacao} opcoes=${escalas.map((o) => [o.chave, o.nome])} aoMudar=${setOperacao} ocultar=${escalas.length < 2} />
        ${aba === 'horarios' ? html`<${Stepper} rotulo="Mês" valor=${rotuloMesAno(anoMes)} rotuloAnterior="Mês anterior" rotuloProximo="Próximo mês" aoAnterior=${() => setAnoMes(somarMes(anoMes, -1))} aoProximo=${() => setAnoMes(somarMes(anoMes, 1))} />` : null}
      </div>` : null}
      ${aba === 'presenca' ? html`<${TelaPresenca} controlador=${controlador} operacao=${operacao} showToast=${showToast} />`
        : aba === 'escala' ? html`<${CalendarioEquipe} ehSupervisor=${controlador.estado?.perfilUsuario === 'supervisor'} operacao=${operacao} anoMes=${anoMes} aoMudarMes=${setAnoMes} aoTrocarEscala=${setOperacao} opcoesEscala=${escalas.length > 1 ? escalas.map((o) => [o.chave, o.nome]) : null} />`
          : html`<${TelaCadastros} ...${props} />`}`;
  };

  let corpo;
  if (erro) corpo = html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  else if (!contexto) corpo = html`<${LoadingState} titulo="Carregando a equipe" />`;
  else if (!contexto.supervisor) corpo = html`<${EmptyState} icon="groups" title="Escolha um supervisor" text="Não há supervisores nas operações a que você tem acesso." />`;
  else corpo = corpoAba();

  return html`
    <${PainelRh} screenId="screen-equipes-controle" navAtiva="screen-equipes-controle" subtituloMarca="Equipes e Turnos" placeholderBusca="Equipes e Turnos" controlador=${controlador}>
      <${ToastHost} />
      <${PaginaConsole} className="cx-pagina--modulo cx-pagina--rolavel">
        <${ModuleHeader} titulo=${titulo} subtitulo=${DESCRICAO[aba]}
          abas=${html`<${ModuleTabs} itens=${abas} ativa=${aba} aoMudar=${setAba} rotulo="Seções do Controle de Equipes e Turnos" />`} />
        ${contexto && !contexto.eh_supervisor && contexto.supervisores?.length ? html`<div class="mo-contexto cx-fixo">
          <${ContextField} rotulo="Supervisor" valor=${idSupervisor} opcoes=${contexto.supervisores.map((s) => [String(s.id_usuario), s.nome])} aoMudar=${setIdSupervisor} />
        </div>` : null}
        ${corpo}
      <//>
    </${PainelRh}>`;
}
