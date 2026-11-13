import { html, useCallback, useEffect, useState } from '../../../infraestrutura-react.js';
import { PainelRh } from '../../../ui/componentes-compartilhados.js';
import { useToast } from '../../../shared/hooks/use-toast.js';
import {
  adicionarOperadorEquipe,
  API_MURAL_EQUIPE,
  lerContextoEquipes,
  lerMonitoriasEquipe,
  listarCandidatosEquipe,
  listarSupervisoresDestinoEquipe,
  removerOperadorEquipe,
} from '../../../services/api/equipes.js';
import { TelaMural } from '../../../features/mural/index.js?v=20261109-telas-antigas';
import { mesAtual, useContextoWfm } from '../wfm/comum.js?v=20261112-modulo-unico2';
import { CalendarioEquipe } from '../wfm/calendario-equipe.js?v=20261112-modulo-unico2';
import { TelaPresenca } from '../wfm/presenca.js?v=20261112-modulo-unico2';
import { TelaCadastros } from '../wfm/cadastros.js?v=20261112-modulo-unico2';
import { rotuloMesAno, somarMes } from '../wfm/escala-ui.js?v=20261112-modulo-unico2';
import { Campo, Esqueleto, Estado, Ic, Janela, MenuAcoes, Navegar, Segmento, Selo } from '../../../ui/components/ds.js?v=20261106-wfm';
import { tomarFocoPessoa } from '../wfm/foco-pessoa.js';

// Equipes (redesign Fase 15, amostra "Equipe" da Fase 12): visão macro da própria equipe do Supervisor. Presença, escala e
// horários reaproveitam as telas do WFM (com o escopo de operação/equipe aplicado no servidor); equipe, monitorias e Mural
// usam as rotas /equipes. Nada de regra mudou: só o desenho.

const SECOES = [
  { id: 'equipe', rotulo: 'Equipe' },
  { id: 'presenca', rotulo: 'Presença', permissao: 'wfm.presenca.lancar' },
  { id: 'monitorias', rotulo: 'Monitorias', permissao: 'monitoria.visualizar' },
  { id: 'escala', rotulo: 'Escala', permissao: 'wfm.escala.visualizar' },
  { id: 'horarios', rotulo: 'Horários', permissao: 'wfm.cadastros.visualizar' },
  { id: 'mural', rotulo: 'Mural', permissao: 'equipes.mural.publicar' },
];

const DESCRICAO = {
  equipe: 'Adicionar, transferir ou remover aqui atualiza o cadastro do operador.',
  presenca: 'Presença, falta e atestado da sua equipe, por semana.',
  monitorias: 'Notas das monitorias dos operadores da sua equipe.',
  escala: 'Escala mensal da sua equipe (ou de todas as equipes). Para montar ou alterar, use Turnos e Plantões.',
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

function JanelaAdicionar({ aoFechar, aoAdicionar }) {
  const [itens, setItens] = useState(null);
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(0);
  const [erro, setErro] = useState('');
  useEffect(() => {
    listarCandidatosEquipe().then((r) => setItens(r.itens || []), (e) => { setErro(e?.message || 'Não foi possível listar os operadores.'); setItens([]); });
  }, []);
  const filtrados = (itens || []).filter((i) => i.nome.toLowerCase().includes(busca.trim().toLowerCase()));
  const adicionar = async (item) => {
    setSalvando(item.id_usuario); setErro('');
    try { await aoAdicionar(item); } catch (e) { setErro(e?.message || 'Não foi possível adicionar.'); } finally { setSalvando(0); }
  };
  return html`<${Janela} titulo="Adicionar pessoa" onClose=${aoFechar}>
    <div class="c-janela-corpo">
      <p>Operadores das suas operações que ainda não estão na sua equipe.</p>
      <div class="c-com-icone"><${Ic} nome="magnifying-glass" /><input class="c-entrada" type="search" autofocus placeholder="Buscar pelo nome" aria-label="Buscar operador" value=${busca} onInput=${(e) => setBusca(e.target.value)} /></div>
      ${erro ? html`<div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${erro}</p></div></div>` : null}
      ${itens === null ? html`<${Esqueleto} linhas=${3} />` : filtrados.length ? html`<div class="c-tabela-caixa"><table class="c-tabela">
        <tbody>${filtrados.map((item) => html`<tr key=${item.id_usuario}>
          <td class="c-estica"><div class="c-duas"><span class="c-forte">${item.nome}</span><small>${item.turno || 'Sem turno definido'} · ${item.qtd_supervisores} ${item.qtd_supervisores === 1 ? 'supervisor' : 'supervisores'}</small></div></td>
          <td class="c-acoes"><button type="button" class="c-botao c-botao--secundario c-botao--compacto" aria-busy=${salvando === item.id_usuario ? 'true' : null} disabled=${!item.disponivel || salvando === item.id_usuario || null} title=${item.disponivel ? null : 'O operador já tem o máximo de supervisores'} onClick=${() => adicionar(item)}>
            ${salvando === item.id_usuario ? 'Adicionando…' : item.disponivel ? 'Adicionar' : 'Sem vaga'}</button></td>
        </tr>`)}</tbody>
      </table></div>` : html`<${Estado} titulo=${busca ? 'Nenhum operador encontrado.' : 'Não há operadores disponíveis nas suas operações.'} />`}
    </div>
  <//>`;
}

// Remover ou transferir: os dois tiram o operador da sua equipe; transferir sempre pede o supervisor de destino,
// remover só pede quando você é o único supervisor dele. Mesma rota de antes (removerOperadorEquipe).
function JanelaSaida({ operador, transferir, aoFechar, aoConfirmar }) {
  const [destinos, setDestinos] = useState(null);
  const [novo, setNovo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const unico = operador.qtd_supervisores === 1;
  const precisaDestino = transferir || unico;
  useEffect(() => {
    if (precisaDestino) listarSupervisoresDestinoEquipe().then((r) => setDestinos(r.itens || []), () => setDestinos([]));
    else setDestinos([]);
  }, [operador.id_usuario, transferir]);
  const confirmar = async () => {
    setSalvando(true); setErro('');
    try { await aoConfirmar(operador, novo ? Number(novo) : null, (destinos || []).find((d) => String(d.id_usuario) === novo)?.nome || ''); } catch (e) { setErro(e?.message || (transferir ? 'Não foi possível transferir.' : 'Não foi possível remover.')); } finally { setSalvando(false); }
  };
  const texto = transferir ? 'O operador sai da sua equipe e passa para a equipe do supervisor escolhido. O cadastro dele é atualizado na hora.'
    : unico ? 'Você é o único supervisor deste operador. Escolha quem vai recebê-lo na equipe para concluir a remoção.'
      : 'O operador continua na equipe do outro supervisor e deixa a sua.';
  return html`<${Janela} titulo=${`${transferir ? 'Transferir' : 'Remover da equipe'} · ${operador.nome}`} tamanho="pequena" onClose=${aoFechar}
    rodape=${html`<button type="button" class="c-botao c-botao--secundario" disabled=${salvando || null} onClick=${aoFechar}>Cancelar</button>
      <button type="button" class=${`c-botao ${transferir ? 'c-botao--principal' : 'c-botao--perigo'}`} aria-busy=${salvando ? 'true' : null} disabled=${salvando || (precisaDestino && !novo) || null} onClick=${confirmar}>
        ${salvando ? (transferir ? 'Transferindo…' : 'Removendo…') : (transferir ? 'Confirmar transferência' : 'Remover')}</button>`}>
    <div class="c-janela-corpo">
      <p>${texto}</p>
      ${precisaDestino ? html`<${Campo} rotulo=${transferir ? 'Equipe do supervisor' : 'Novo supervisor'}>
        <select class="c-entrada" value=${novo} onChange=${(e) => setNovo(e.target.value)} disabled=${destinos === null || null}>
          <option value="">${destinos === null ? 'Carregando…' : destinos.length ? 'Selecione' : 'Nenhum supervisor disponível'}</option>
          ${(destinos || []).map((d) => html`<option key=${d.id_usuario} value=${d.id_usuario}>${d.nome}</option>`)}
        </select>
      <//>` : null}
      ${erro ? html`<div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${erro}</p></div></div>` : null}
    </div>
  <//>`;
}

function SecaoEquipe({ contexto, setContexto, showToast, adicionando, setAdicionando }) {
  const [saida, setSaida] = useState(null); // { operador, transferir }
  const [busca, setBusca] = useState(() => tomarFocoPessoa('equipes')); // vindo do Painel do dia ("Ver diário")
  const [turno, setTurno] = useState('');
  const [operacao, setOperacao] = useState('');
  const sup = contexto.supervisor;
  const operadores = contexto.operadores || [];
  const sem = operadores.filter((o) => !o.turno).length;
  const turnos = [...new Set(operadores.map((o) => o.turno).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const operacoesLista = [...new Set(operadores.flatMap((o) => o.operacoes || []))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const termo = busca.trim().toLowerCase();
  const visiveis = operadores.filter((o) => (!termo || `${o.nome} ${o.email || ''}`.toLowerCase().includes(termo))
    && (!turno || (turno === '__sem' ? !o.turno : o.turno === turno))
    && (!operacao || (o.operacoes || []).includes(operacao)));
  const adicionar = async (item) => {
    const novo = await adicionarOperadorEquipe(item.id_usuario);
    setContexto(novo); setAdicionando(false); showToast(`${item.nome} entrou na sua equipe.`, 'success');
  };
  const confirmarSaida = async (operador, idNovo, nomeNovo) => {
    const novo = await removerOperadorEquipe(operador.id_usuario, idNovo);
    const transferiu = saida?.transferir;
    setContexto(novo); setSaida(null);
    showToast(transferiu ? `${operador.nome} foi transferido${nomeNovo ? ` para a equipe de ${nomeNovo}` : ''}.` : `${operador.nome} saiu da sua equipe.`, 'success');
  };
  return html`
    <div class="c-tabela-caixa">
      <div class="c-contexto">
        <span>Supervisor <b>${sup.nome}</b></span>
        <span>Operação <b>${(contexto.operacoes || []).map((o) => o.nome).join(', ') || '—'}</b></span>
        <span>Seu turno <b>${sup.turno || 'Não definido'}</b></span>
        <span><b>${operadores.length}</b> ${operadores.length === 1 ? 'pessoa' : 'pessoas'}${sem ? html` · <b class="c-tom-atencao">${sem} sem turno</b>` : null}</span>
      </div>
      <div class="c-filtros c-filtros--suave">
        <div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" /><input class="c-entrada c-entrada--compacta" type="search" placeholder="Buscar pessoa" aria-label="Buscar pessoa" value=${busca} onInput=${(e) => setBusca(e.target.value)} /></div>
        ${turnos.length || sem ? html`<select class="c-entrada c-entrada--compacta" aria-label="Turno" value=${turno} onChange=${(e) => setTurno(e.target.value)}>
          <option value="">Turno: todos</option>${turnos.map((t) => html`<option key=${t} value=${t}>${t}</option>`)}${sem ? html`<option value="__sem">Sem turno</option>` : null}</select>` : null}
        ${operacoesLista.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Operação" value=${operacao} onChange=${(e) => setOperacao(e.target.value)}>
          <option value="">Operação: todas</option>${operacoesLista.map((o) => html`<option key=${o} value=${o}>${o}</option>`)}</select>` : null}
        <span class="c-contador">${visiveis.length} de ${operadores.length}</span>
      </div>
      ${!operadores.length ? html`<${Estado} icone="users" titulo="Nenhum operador na sua equipe ainda." rotuloAcao=${contexto.pode_editar_membros ? 'Adicionar pessoa' : undefined} aoAcao=${contexto.pode_editar_membros ? () => setAdicionando(true) : undefined} />`
        : !visiveis.length ? html`<${Estado} titulo="Ninguém com estes filtros." rotuloAcao="Limpar filtros" aoAcao=${() => { setBusca(''); setTurno(''); setOperacao(''); }} />`
          : html`<table class="c-tabela">
          <thead><tr><th scope="col">Nome</th><th scope="col">Turno</th><th scope="col" class="c-estica">Operação</th>${contexto.pode_editar_membros ? html`<th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th>` : null}</tr></thead>
          <tbody>${visiveis.map((o) => html`<tr key=${o.id_usuario}>
            <td><div class="c-duas"><span class="c-forte">${o.nome}</span>${o.email ? html`<small>${o.email}</small>` : null}</div></td>
            <td>${o.turno ? html`<span class="c-turno-linha"><span class="c-traco"></span>${o.turno}</span>` : html`<${Selo} tom="atencao" icone="warning">Sem turno<//>`}</td>
            <td class="c-estica c-secundario">${(o.operacoes || []).join(', ') || '—'}</td>
            ${contexto.pode_editar_membros ? html`<td class="c-acoes"><${MenuAcoes} rotulo=${`Ações de ${o.nome}`}
              acoes=${[{ label: 'Transferir para outra equipe', icon: 'arrows-left-right', onClick: () => setSaida({ operador: o, transferir: true }) },
                { label: 'Remover da equipe', icon: 'user-minus', perigo: true, onClick: () => setSaida({ operador: o, transferir: false }) }]} /></td>` : null}
          </tr>`)}</tbody>
        </table>`}
    </div>
    ${adicionando ? html`<${JanelaAdicionar} aoFechar=${() => setAdicionando(false)} aoAdicionar=${adicionar} />` : null}
    ${saida ? html`<${JanelaSaida} operador=${saida.operador} transferir=${saida.transferir} aoFechar=${() => setSaida(null)} aoConfirmar=${confirmarSaida} />` : null}`;
}

function SecaoMonitorias({ idSupervisor }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [dias, setDias] = useState(90);
  useEffect(() => {
    let ativo = true;
    setDados(null); setErro('');
    lerMonitoriasEquipe(idSupervisor, dias).then((r) => ativo && setDados(r), (e) => ativo && setErro(e?.message || 'Não foi possível carregar as monitorias.'));
    return () => { ativo = false; };
  }, [idSupervisor, dias]);
  const filtro = html`<div class="c-filtros c-filtros--suave">
    <select class="c-entrada c-entrada--compacta" aria-label="Período" value=${dias} onChange=${(e) => setDias(Number(e.target.value))}>
      <option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="180">Últimos 180 dias</option><option value="365">Últimos 12 meses</option>
    </select>
  </div>`;
  if (erro) return html`<div class="c-tabela-caixa">${filtro}<${Estado} titulo=${erro} /></div>`;
  if (!dados) return html`<div class="c-tabela-caixa">${filtro}<${Esqueleto} linhas=${5} /></div>`;
  const r = dados.resumo;
  if (!r || !r.quantidade_realizadas) return html`<div class="c-tabela-caixa">${filtro}<${Estado} icone="clipboard-text" titulo="Nenhuma monitoria dos operadores da sua equipe neste período." /></div>`;
  return html`
    <div class="c-tabela-caixa">
      ${filtro}
      <div class="c-indicadores c-indicadores--embutido">
        <div class="c-indicador"><span class="c-ind-rotulo">Nota média da equipe</span><span class="c-ind-valor">${formatarNota(r.nota_media)}</span><span class="c-ind-nota">${r.faixa?.nome || ''}</span></div>
        <div class="c-indicador"><span class="c-ind-rotulo">Realizadas</span><span class="c-ind-valor">${r.quantidade_realizadas}</span><span class="c-ind-nota">${r.quantidade_anuladas ? `${r.quantidade_anuladas} anuladas` : ''}</span></div>
        <div class="c-indicador"><span class="c-ind-rotulo">Melhor nota</span><span class="c-ind-valor">${formatarNota(r.melhor_nota)}</span><span class="c-ind-nota"></span></div>
        <div class="c-indicador"><span class="c-ind-rotulo">Com NCG</span><span class="c-ind-valor">${r.ncg}</span><span class=${`c-ind-nota ${r.ncg ? 'c-tom-perigo' : ''}`.trim()}>${r.ncg ? 'nota zerada por erro crítico' : ''}</span></div>
      </div>
    </div>
    <section class="c-cartao" aria-labelledby="eq-mon-op">
      <div class="c-cartao-cab"><h2 id="eq-mon-op">Nota por operador</h2></div>
      <div class="c-tabela-caixa"><table class="c-tabela">
        <thead><tr><th scope="col" class="c-estica">Operador</th><th scope="col" class="c-num">Monitorias</th><th scope="col" class="c-num">Válidas</th><th scope="col" class="c-num">Nota média</th><th scope="col" class="c-num">NCG</th></tr></thead>
        <tbody>${dados.por_operador.map((o) => html`<tr key=${o.chave}><td class="c-estica c-forte">${o.rotulo}</td><td class="c-num">${o.quantidade_realizadas}</td><td class="c-num">${o.quantidade_validas}</td><td class="c-num c-forte">${formatarNota(o.nota_media)}</td><td class="c-num">${o.ncg}</td></tr>`)}</tbody>
      </table></div>
    </section>
    <section class="c-cartao" aria-labelledby="eq-mon-lista">
      <div class="c-cartao-cab"><h2 id="eq-mon-lista">Monitorias realizadas</h2></div>
      <div class="c-tabela-caixa"><table class="c-tabela">
        <thead><tr><th scope="col">Operador</th><th scope="col">Data</th><th scope="col">Código</th><th scope="col">Canal</th><th scope="col" class="c-estica">Avaliador</th><th scope="col" class="c-num">Nota</th></tr></thead>
        <tbody>${dados.itens.map((m) => html`<tr key=${m.id_monitoria}>
          <td class="c-forte">${m.operador_nome}</td><td>${dataBr(m.data)}</td><td class="c-secundario">${m.codigo}</td><td>${m.canal || '—'}</td><td class="c-estica c-secundario">${m.avaliador_nome}</td>
          <td class="c-num">${m.anulada ? html`<${Selo} tom="neutro">Anulada<//>` : html`<b>${formatarNota(m.nota)}</b>${m.possui_ncg ? html` <${Selo} tom="perigo">NCG<//>` : null}`}</td></tr>`)}</tbody>
      </table></div>
    </section>`;
}

export function TelaEquipesControle({ controlador }) {
  const { showToast, ToastHost } = useToast();
  const [aba, setAba] = useState('equipe');
  const [idSupervisor, setIdSupervisor] = useState('');
  const [adicionando, setAdicionando] = useState(false);
  const { contexto, setContexto, erro } = useContextoEquipes(idSupervisor);
  const wfm = useContextoWfm();
  const [operacao, setOperacao] = useState('');
  const [anoMes, setAnoMes] = useState(mesAtual());

  const secoes = SECOES.filter((a) => !a.permissao || controlador.possuiPermissao(a.permissao));
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

  const corpoSecao = () => {
    if (aba === 'equipe') return html`<${SecaoEquipe} contexto=${contexto} setContexto=${setContexto} showToast=${showToast} adicionando=${adicionando} setAdicionando=${setAdicionando} />`;
    if (aba === 'monitorias') return html`<${SecaoMonitorias} idSupervisor=${idSupervisor} />`;
    if (aba === 'mural') return html`<${TelaMural} controlador=${controlador} embutido=${true} api=${API_MURAL_EQUIPE} rotuloAmbientes="Publicar nas intranets das operações da sua equipe" />`;
    if (wfm.erro) return html`<div class="c-tabela-caixa"><${Estado} titulo=${wfm.erro} /></div>`;
    if (!wfm.contexto) return html`<div class="c-tabela-caixa"><${Esqueleto} linhas=${5} /></div>`;
    if (!escalas.length || !operacao) return html`<div class="c-tabela-caixa"><${Estado} icone="calendar-blank" titulo="Nenhuma escala ativa" texto="Não há escala ativa para a sua equipe. Quem gere as escalas pode criar ou ativar uma em Turnos e Plantões." /></div>`;
    const props = { controlador, contexto: wfm.contexto, operacao, anoMes, showToast, recarregarContexto: wfm.recarregar, aoTrocarEscala: setOperacao };
    const seletores = aba === 'horarios' || (aba === 'presenca' && escalas.length > 1) ? html`<div class="c-filtros c-filtros--suave c-filtros--solto">
      ${escalas.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Escala / operação" value=${operacao} onChange=${(e) => setOperacao(e.target.value)}>${escalas.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select>` : null}
      ${aba === 'horarios' ? html`<${Navegar} grupo="Mês" rotulo=${rotuloMesAno(anoMes)} rotuloAnterior="Mês anterior" rotuloProximo="Próximo mês" aoAnterior=${() => setAnoMes(somarMes(anoMes, -1))} aoProximo=${() => setAnoMes(somarMes(anoMes, 1))} />` : null}
    </div>` : null;
    return html`
      ${seletores}
      ${aba === 'presenca' ? html`<${TelaPresenca} controlador=${controlador} operacao=${operacao} showToast=${showToast} embutido=${true} />`
        : aba === 'escala' ? html`<${CalendarioEquipe} aoVerPainel=${controlador.podeAcessarTela('screen-wfm-dia') ? () => controlador.irParaTelaProtegida('screen-wfm-dia') : undefined} ehSupervisor=${controlador.estado?.perfilUsuario === 'supervisor'} operacao=${operacao} anoMes=${anoMes} aoMudarMes=${setAnoMes} aoTrocarEscala=${setOperacao} opcoesEscala=${escalas.length > 1 ? escalas.map((o) => [o.chave, o.nome]) : null} />`
          : html`<${TelaCadastros} ...${props} />`}`;
  };

  let corpo;
  if (erro) corpo = html`<div class="c-tabela-caixa"><${Estado} titulo=${erro} /></div>`;
  else if (!contexto) corpo = html`<div class="c-tabela-caixa"><${Esqueleto} linhas=${6} /></div>`;
  else if (!contexto.supervisor) corpo = html`<div class="c-tabela-caixa"><${Estado} icone="users" titulo="Escolha um supervisor" texto="Não há supervisores nas operações a que você tem acesso." /></div>`;
  else corpo = corpoSecao();

  const titulo = contexto?.supervisor?.nome ? `Equipe de ${contexto.supervisor.nome}` : 'Equipe';
  return html`
    <${PainelRh} screenId="screen-equipes-controle" navAtiva="screen-equipes-controle" subtituloMarca="Equipes" placeholderBusca="Equipes" controlador=${controlador}>
      <${ToastHost} />
      <main class="c-pagina c-conteudo">
        <div class="c-cab-linha">
          <h1>${titulo}</h1>
          <span class="c-ajuda">${DESCRICAO[aba]}</span>
          <div class="c-cab-dir">
            ${contexto && !contexto.eh_supervisor && contexto.supervisores?.length ? html`<select class="c-entrada c-entrada--compacta" aria-label="Supervisor" value=${idSupervisor} onChange=${(e) => setIdSupervisor(e.target.value)}>
              ${contexto.supervisores.map((s) => html`<option key=${s.id_usuario} value=${String(s.id_usuario)}>${s.nome}</option>`)}</select>` : null}
            ${aba === 'equipe' && contexto?.pode_editar_membros ? html`<button type="button" class="c-botao c-botao--principal c-botao--compacto" onClick=${() => setAdicionando(true)}><${Ic} nome="user-plus" />Adicionar pessoa</button>` : null}
          </div>
        </div>
        ${secoes.length > 1 ? html`<div><${Segmento} rotulo="Seções da equipe" valor=${aba} aoMudar=${setAba} opcoes=${secoes.map((s) => [s.id, s.rotulo])} /></div>` : null}
        ${corpo}
      </main>
    </${PainelRh}>`;
}
