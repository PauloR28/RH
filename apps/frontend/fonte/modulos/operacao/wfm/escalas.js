import { html, useEffect, useState } from '../../../infraestrutura-react.js';
import { aprovarEscalaWfm, criarEscalaWfm, declinarEscalaWfm, duplicarEscalaMesWfm, gestaoEscalasWfm, publicarEscalaWfm } from '../../../services/api/wfm.js?v=20261111-modulos-op';
import { dataHora, falhaAo } from './comum.js?v=20261111-modulos-op';
import { CabPagina, Campo, Esqueleto, Estado, Faixa, Ic, Janela, JanelaForm, MenuAcoes, Navegar, Selo } from '../../../ui/components/ds.js?v=20261106-wfm';

// Tela inicial da aba Escalas: a lista de escalas do mês (redesign Fase 15, amostra "Escalas" da Fase 12).
//  - Quem cria escalas (Supervisor, Control Desk, Analista de TI): vê todas (ativas e inativas), abre a escala para montar,
//    visualiza o mês inteiro, configura (⚙) e cria novas.
//  - Gestor: tela simples; só as escalas ativas que já saíram de rascunho.
//  - Demais perfis de leitura: só as escalas ativas.
// O que cada perfil pode fazer é decidido no servidor; aqui só se escolhe o que mostrar.

// Situação no mês → [rótulo, tom do selo, ícone]. A cor nunca vem sozinha (DEC-046).
const ESTADO = {
  RASCUNHO: ['Rascunho', 'neutro', 'pencil-simple'],
  EM_APROVACAO: ['Aguardando aprovação', 'atencao', 'hourglass'],
  APROVADA: ['Aprovada', 'sucesso', 'check-circle'],
};

// Escala "sai de rascunho" quando foi enviada, aprovada ou publicada, ou o período já foi fechado.
export const foraDeRascunho = (e) => !e.declinada && (e.aprovacao === 'EM_APROVACAO' || e.aprovacao === 'APROVADA' || e.versao_publicada > 0 || e.fechada);

function ModalCriarEscala({ operacoes, operacaoInicial, onClose, onCriada, showToast }) {
  const [operacao, setOperacao] = useState(operacaoInicial || operacoes[0]?.chave || '');
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const salvar = async (ev) => {
    ev.preventDefault();
    if (!nome.trim()) { setErro('Informe o nome da escala.'); return; }
    setErro('');
    setSalvando(true);
    try {
      const r = await criarEscalaWfm({ operacao_base: operacao, nome: nome.trim() });
      showToast?.('Escala criada.', 'success');
      onCriada(r.chave);
    } catch (e) { setErro(e?.message || 'Não foi possível criar a escala.'); } finally { setSalvando(false); }
  };
  return html`<${JanelaForm} titulo="Criar escala" onClose=${onClose} onSubmit=${salvar} erro=${erro} salvando=${salvando} salvarRotulo="Criar escala">
    <${Campo} rotulo="Nome da escala" ajuda="Ex.: Plantão de sábado, Escala 6x1 manhã.">
      <input class="c-entrada" maxlength="120" autofocus value=${nome} onInput=${(e) => setNome(e.target.value)} />
    <//>
    <${Campo} rotulo="Operação">
      <select class="c-entrada" value=${operacao} onChange=${(e) => setOperacao(e.target.value)}>
        ${operacoes.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}
      </select>
    <//>
    <p class="c-ajuda">Depois de criar, use as configurações da escala para definir quem aprova, a jornada e outras opções.</p>
  <//>`;
}

const nomeMes = (anoMes) => {
  const [a, m] = anoMes.split('-').map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
};
const rotuloMesAno = (anoMes) => `${nomeMes(anoMes)} de ${anoMes.split('-')[0]}`;
const somarMes = (anoMes, delta) => {
  const [a, m] = anoMes.split('-').map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
// Rascunho só existe se alguém começou a montar a escala (tem colaboradores escalados) e ainda não enviou/publicou.
const ehRascunho = (e) => !e.declinada && !foraDeRascunho(e) && Number(e.escalados) > 0;
const semEscala = (e) => !e.declinada && !foraDeRascunho(e) && !(Number(e.escalados) > 0);
const ehPublicada = (e) => e.versao_publicada > 0;

// Regra de hoje para publicar (a mesma da tela da escala aberta): aprovada (ou período fechado) e com colaboradores.
const motivoSemPublicar = (e) => {
  if (!e.ativa) return 'A escala está inativa.';
  if (!e.escalados) return 'Adicione colaboradores antes de publicar';
  if (!e.fechada && e.aprovacao !== 'APROVADA') return 'A escala precisa ser aprovada por quem tem permissão para aprovar antes de publicar.';
  return '';
};

// Aprovações pendentes: o aprovador decide aqui mesmo (Aprovar / Declinar com justificativa), sem abrir a escala inteira.
// "Ver escala" abre o mês para conferir antes de decidir. Quem pode aprovar e o que acontece ao aprovar é decidido no servidor.
function CartaoAprovacoes({ itens, aoVer, aoDecidiu, showToast }) {
  const [declinando, setDeclinando] = useState(null); // item em declínio (abre a janela)
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState('');
  const idDe = (e) => `${e.chave}|${e.ano_mes}`;
  const aprovar = async (e) => {
    if (!window.confirm(`Aprovar a escala "${e.nome}" de ${rotuloMesAno(e.ano_mes)}? A aprovação publica a escala para os colaboradores.`)) return;
    setOcupado(idDe(e));
    try {
      const r = await aprovarEscalaWfm({ operacao: e.chave, ano_mes: e.ano_mes });
      if (r?.publicada) showToast?.(`Escala "${e.nome}" aprovada e publicada (versão ${r.versao}).`, 'success');
      else showToast?.(`Escala "${e.nome}" aprovada, mas não foi publicada automaticamente: ${r?.aviso || 'publique manualmente.'}`, 'warning');
      aoDecidiu();
    } catch (err) { showToast?.(falhaAo(`aprovar a escala "${e.nome}"`, err), 'error'); aoDecidiu(); } finally { setOcupado(''); }
  };
  const declinar = async (ev) => {
    ev?.preventDefault?.();
    const e = declinando;
    if (!e || motivo.trim().length < 3) return;
    setOcupado(idDe(e));
    try {
      await declinarEscalaWfm({ operacao: e.chave, ano_mes: e.ano_mes, justificativa: motivo });
      showToast?.(`Escala "${e.nome}" declinada e devolvida para correção.`, 'success');
      setDeclinando(null); setMotivo('');
      aoDecidiu();
    } catch (err) { showToast?.(falhaAo(`declinar a escala "${e.nome}"`, err), 'error'); aoDecidiu(); } finally { setOcupado(''); }
  };
  return html`<section class="c-cartao" aria-labelledby="wfm-aprov-titulo">
    <div class="c-cartao-cab"><h2 id="wfm-aprov-titulo">Aguardando a sua aprovação</h2><span class="c-nota">${itens.length} escala(s)</span></div>
    <div class="c-tabela-caixa">
      <table class="c-tabela">
        <thead><tr><th scope="col">Escala</th><th scope="col">Mês</th><th scope="col" class="c-num">Colaboradores</th><th scope="col" class="c-estica">Enviada por</th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead>
        <tbody>${itens.map((e) => html`<tr key=${idDe(e)}>
          <td class="c-forte">${e.nome}</td>
          <td class="c-secundario">${rotuloMesAno(e.ano_mes)}</td>
          <td class="c-num">${e.colaboradores}</td>
          <td class="c-estica c-secundario">${e.enviado_por || '—'}${e.enviado_em ? ` · ${dataHora(e.enviado_em)}` : ''}</td>
          <td class="c-acoes"><div class="c-grupo">
            <button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => aoVer(e)}>Ver escala</button>
            ${e.pode_declinar ? html`<button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${ocupado === idDe(e) || null} onClick=${() => { setDeclinando(e); setMotivo(''); }}>Declinar</button>` : null}
            <button type="button" class="c-botao c-botao--principal c-botao--compacto" aria-busy=${ocupado === idDe(e) ? 'true' : null} disabled=${ocupado === idDe(e) || null} onClick=${() => aprovar(e)}><${Ic} nome="check" />Aprovar</button>
          </div></td>
        </tr>`)}</tbody>
      </table>
    </div>
    ${declinando ? html`<${Janela} titulo="Declinar escala" tamanho="pequena" onClose=${() => setDeclinando(null)}>
      <form class="c-janela-form" onSubmit=${declinar}>
        <div class="c-janela-corpo">
          <p>A escala "${declinando.nome}" de ${rotuloMesAno(declinando.ano_mes)} volta para correção.</p>
          <${Campo} rotulo="O que precisa ser corrigido?" ajuda="Obrigatório (mínimo 3 letras).">
            <textarea class="c-entrada" maxlength="400" autofocus value=${motivo} onInput=${(ev) => setMotivo(ev.target.value)}></textarea>
          <//>
        </div>
        <div class="c-janela-rodape">
          <button type="button" class="c-botao c-botao--secundario" onClick=${() => setDeclinando(null)}>Cancelar</button>
          <button type="submit" class="c-botao c-botao--perigo" disabled=${ocupado === idDe(declinando) || motivo.trim().length < 3 || null}>Confirmar declínio</button>
        </div>
      </form>
    <//>` : null}
  </section>`;
}

export function ListaEscalas({ controlador, anoMes, aoMudarMes, versao, showToast, aoAbrir, aoConfigurar, aoMudou, aprovacoes = [], aoRecarregarAprovacoes }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [tentativa, setTentativa] = useState(0);
  const [criando, setCriando] = useState(false);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('todas');
  const [operacaoFiltro, setOperacaoFiltro] = useState('');
  const [verAprovacoes, setVerAprovacoes] = useState(false);
  const [publicando, setPublicando] = useState('');
  useEffect(() => {
    let ativo = true;
    setErro('');
    setDados(null);
    gestaoEscalasWfm(anoMes)
      .then((r) => { if (ativo) setDados(r); })
      .catch((e) => { if (ativo) setErro(e?.message || 'Não foi possível carregar as escalas.'); });
    return () => { ativo = false; };
  }, [anoMes, versao, tentativa]);

  const gere = Boolean(dados?.pode_criar);
  const podeAprovar = Boolean(controlador?.possuiPermissao?.('wfm.escala.aprovar'));
  const pendenteNoMes = new Set(aprovacoes.filter((a) => a.ano_mes === anoMes).map((a) => a.chave));
  const ehGestor = controlador?.estado?.perfilUsuario === 'gestor';
  const podePublicar = controlador?.possuiPermissao?.('wfm.escala.publicar');
  const base = dados ? dados.itens.filter((e) => (gere || e.ativa) && (!ehGestor || foraDeRascunho(e))) : [];
  const operacoesLista = [...new Set(base.map((e) => e.operacao).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const termo = busca.trim().toLowerCase();
  const itens = base.filter((e) => (filtro === 'todas' || (filtro === 'aprovacao' ? pendenteNoMes.has(e.chave) : filtro === 'rascunho' ? ehRascunho(e) : ehPublicada(e)))
    && (!operacaoFiltro || e.operacao === operacaoFiltro)
    && (!termo || `${e.nome} ${e.operacao}`.toLowerCase().includes(termo)));
  const totais = {
    todas: base.length,
    rascunho: base.filter(ehRascunho).length,
    publicadas: base.filter(ehPublicada).length,
  };
  const mes = nomeMes(anoMes);

  const publicar = async (e) => {
    if (!window.confirm(`Publicar a escala "${e.nome}" de ${rotuloMesAno(anoMes)}?`)) return;
    setPublicando(e.chave);
    try {
      await publicarEscalaWfm({ operacao: e.chave, ano_mes: anoMes, justificativa: '' });
      showToast?.('Escala publicada.', 'success');
      aoMudou?.();
    } catch (err) {
      showToast?.(`${falhaAo('publicar', err)} Se for preciso justificar, abra a escala para publicar.`, 'error');
    } finally { setPublicando(''); }
  };

  const duplicarMes = async (e) => {
    const proximo = somarMes(anoMes, 1);
    if (!window.confirm(`Copiar a escala "${e.nome}" de ${rotuloMesAno(anoMes)} para ${rotuloMesAno(proximo)}?

Os colaboradores, turnos e horários combinados são copiados pelo mesmo dia da semana. O que já estiver lançado em ${nomeMes(proximo)} não é alterado. Pausas, presenças e horas extras não são copiadas.`)) return;
    try {
      const r = await duplicarEscalaMesWfm({ operacao: e.chave, ano_mes: anoMes });
      showToast?.(`Escala copiada para ${rotuloMesAno(r.ano_mes)}: ${r.colaboradores} colaborador(es), ${r.dias_copiados} dia(s).`, 'success');
      aoMudarMes?.(r.ano_mes);
    } catch (err) {
      showToast?.(falhaAo('copiar a escala para o mês seguinte', err), 'error');
    }
  };

  const limpar = () => { setBusca(''); setFiltro('todas'); setOperacaoFiltro(''); };
  const corpoTabela = () => {
    if (erro) return html`<${Estado} titulo=${erro} rotuloAcao="Tentar de novo" aoAcao=${() => setTentativa((t) => t + 1)} />`;
    if (!dados) return html`<${Esqueleto} linhas=${5} />`;
    if (!base.length) return html`<${Estado} icone="calendar-blank" titulo=${gere ? `Nenhuma escala em ${mes}` : ehGestor ? 'Quando uma escala for enviada para aprovação ou publicada, ela aparece aqui.' : `Não há escalas ativas em ${mes}.`} rotuloAcao=${gere ? 'Nova escala' : undefined} aoAcao=${() => setCriando(true)} />`;
    if (!itens.length) return html`<${Estado} titulo="Nenhuma escala encontrada." rotuloAcao="Limpar filtros" aoAcao=${limpar} />`;
    return html`
      <table class="c-tabela">
        <thead><tr>
          <th scope="col">Escala</th><th scope="col">Operação</th><th scope="col">Situação no mês</th>
          <th scope="col" class="c-num">Colaboradores</th><th scope="col" class="c-estica">Publicação</th>
          <th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th>
        </tr></thead>
        <tbody>${itens.map((e) => {
    const [rotulo, tom, icone] = e.declinada ? ['Declinada', 'perigo', 'x-circle'] : semEscala(e) ? ['Sem colaboradores', 'neutro', 'circle'] : (ESTADO[e.aprovacao] || ESTADO.RASCUNHO);
    const motivo = motivoSemPublicar(e);
    const extras = [e.principal ? 'principal' : '', e.jornada ? `jornada ${e.jornada}` : '', gere && !e.ativa ? 'inativa' : ''].filter(Boolean).join(' · ');
    return html`<tr key=${e.chave} class="c-clicavel" onClick=${(ev) => { if (!ev.target.closest('button, a, .c-abre-menu')) aoAbrir(e.chave, 'mes'); }}>
            <td><div class="c-duas"><span class="c-forte">${pendenteNoMes.has(e.chave) ? html`<span class="c-bolinha" role="img" aria-label="Aguardando a sua aprovação" title="Aguardando a sua aprovação"></span>` : null}${e.nome}</span>${extras ? html`<small>${extras}</small>` : null}</div></td>
            <td class="c-secundario">${e.operacao}</td>
            <td>${e.fechada ? html`<${Selo} tom="neutro" icone="lock">Fechada<//>` : html`<${Selo} tom=${tom} icone=${icone}>${rotulo}<//>`}</td>
            <td class="c-num">${e.escalados}</td>
            <td class="c-estica c-secundario">${e.versao_publicada ? `Versão ${e.versao_publicada}` : 'Não publicada'}</td>
            <td class="c-acoes"><div class="c-grupo">
              <button type="button" class="c-botao c-botao--secundario c-botao--compacto" title="Ver a escala do mês inteiro" onClick=${() => aoAbrir(e.chave, 'mes')}>Abrir</button>
              ${podePublicar && !(e.aprovacao === 'APROVADA' && e.versao_publicada > 0) ? html`<span title=${motivo || undefined}><button type="button" class="c-botao c-botao--secundario c-botao--compacto" aria-busy=${publicando === e.chave ? 'true' : null} disabled=${Boolean(motivo) || publicando === e.chave || null} onClick=${() => publicar(e)}>${publicando === e.chave ? 'Publicando…' : 'Publicar'}</button></span>` : null}
              ${gere ? html`<${MenuAcoes} rotulo=${`Mais ações de ${e.nome}`}
                acoes=${[
        { label: 'Abrir escala', icon: 'pencil-simple', disabled: !e.ativa, onClick: () => aoAbrir(e.chave, 'mes') },
        { label: 'Duplicar para o mês seguinte', icon: 'copy', disabled: !e.ativa || !e.escalados, onClick: () => duplicarMes(e) },
        { label: 'Configurações da escala', icon: 'gear-six', onClick: () => aoConfigurar(e) },
      ]} />` : null}
            </div></td>
          </tr>`;
  })}</tbody>
      </table>`;
  };

  const opcoesSituacao = [['todas', `Todas as situações (${totais.todas})`], ['rascunho', `Rascunho (${totais.rascunho})`], ['publicadas', `Publicadas (${totais.publicadas})`],
    ...(podeAprovar && pendenteNoMes.size ? [['aprovacao', `Aguardando aprovação (${pendenteNoMes.size})`]] : [])];
  return html`
    <main class="c-pagina c-conteudo">
      <${CabPagina} titulo="Escalas" descricao="Dia sem turno é DSR. Turnos, pausas, presença e hora extra ficam dentro de cada escala."
        acoes=${gere ? html`<button type="button" class="c-botao c-botao--principal" onClick=${() => setCriando(true)}><${Ic} nome="plus" />Nova escala</button>` : null} />
      ${podeAprovar && aprovacoes.length ? html`<${Faixa} tom="atencao" icone="hourglass"
        acao=${html`<button type="button" class="c-botao c-botao--secundario c-botao--compacto" aria-expanded=${verAprovacoes ? 'true' : 'false'} onClick=${() => setVerAprovacoes((v) => !v)}>${verAprovacoes ? 'Esconder' : 'Ver escalas'}</button>`}>
        <b>${aprovacoes.length} ${aprovacoes.length === 1 ? 'escala aguarda' : 'escalas aguardam'}</b> a sua aprovação.
      <//>` : null}
      ${podeAprovar && aprovacoes.length && verAprovacoes ? html`<${CartaoAprovacoes} itens=${aprovacoes} showToast=${showToast}
        aoVer=${(e) => { aoMudarMes?.(e.ano_mes); aoAbrir(e.chave, 'mes'); }}
        aoDecidiu=${() => { aoRecarregarAprovacoes?.(); aoMudou?.(); }} />` : null}
      <div class="c-tabela-caixa" aria-busy=${!dados && !erro ? 'true' : null}>
        <div class="c-filtros" role="search">
          <div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" /><input class="c-entrada c-entrada--compacta" type="search" value=${busca} placeholder="Buscar escala" aria-label="Buscar escala" onInput=${(ev) => setBusca(ev.target.value)} /></div>
          <${Navegar} grupo="Mês" rotulo=${rotuloMesAno(anoMes)} rotuloAnterior="Mês anterior" rotuloProximo="Próximo mês" aoAnterior=${() => aoMudarMes?.(somarMes(anoMes, -1))} aoProximo=${() => aoMudarMes?.(somarMes(anoMes, 1))} />
          <select class="c-entrada c-entrada--compacta" aria-label="Situação" value=${filtro} onChange=${(ev) => setFiltro(ev.target.value)}>
            ${opcoesSituacao.map(([v, r]) => html`<option key=${v} value=${v}>${r}</option>`)}
          </select>
          ${operacoesLista.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Operação" value=${operacaoFiltro} onChange=${(ev) => setOperacaoFiltro(ev.target.value)}>
            <option value="">Todas as operações</option>
            ${operacoesLista.map((o) => html`<option key=${o} value=${o}>${o}</option>`)}
          </select>` : null}
          <span class="c-contador" aria-live="polite">${dados ? `${itens.length} ${itens.length === 1 ? 'escala' : 'escalas'}` : ''}</span>
        </div>
        ${corpoTabela()}
      </div>
    </main>
    ${criando ? html`<${ModalCriarEscala} operacoes=${dados?.operacoes_criacao || []} showToast=${showToast} onClose=${() => setCriando(false)} onCriada=${(chave) => { setCriando(false); aoMudou?.(chave); }} />` : null}`;
}
