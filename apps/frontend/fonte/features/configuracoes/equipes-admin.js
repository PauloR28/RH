import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js?v=20261126-painel-relatorios';
import { Campo, Estado, Esqueleto, Faixa, Ic, Janela, JanelaForm, MenuAcoes, Selo } from '../../ui/components/ds.js?v=20261126-painel-relatorios';
import { listarOperacoes } from '../../services/api/operations.js?v=20261126-painel-relatorios';
import {
  excluirEquipeAdmin,
  exportarEquipesAdmin,
  listarEquipesAdmin,
  membrosEquipeAdmin,
  moverEquipe,
  previaMoverEquipe,
  salvarEquipeAdmin,
} from '../../services/api/equipes-admin.js?v=20261126-painel-relatorios';
import { baixarBlob } from '../../utilitarios.js?v=20261126-painel-relatorios';

// Tecnologia › Acessos › Equipes (24/11/2026, amostra 22_EQUIPES_TECNOLOGIA aprovada).
// Cada operador fica em 1 equipe; o supervisor responsável recebe as pendências. Mover mostra antes o que migra.

const msg = (falha, padrao) => falha?.message || padrao;
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function JanelaEquipe({ equipe, operacoes, supervisores, aoFechar, aoSalvar }) {
  const [form, setForm] = useState({
    nome: equipe?.nome || '',
    operacao: equipe?.operacao || operacoes[0]?.chave || '',
    id_supervisor: equipe?.id_supervisor || '',
    id_apoio: equipe?.id_apoio || '',
    ativo: equipe ? equipe.ativo : true,
  });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const sups = supervisores[form.operacao] || [];
  const mudar = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));
  const enviar = async (ev) => {
    ev.preventDefault();
    setErro('');
    if (!form.nome.trim()) { setErro('Informe o nome da equipe.'); return; }
    setSalvando(true);
    try {
      await salvarEquipeAdmin({
        nome: form.nome.trim(), operacao: form.operacao, ativo: form.ativo,
        id_supervisor: Number(form.id_supervisor) || null, id_apoio: Number(form.id_apoio) || null,
      }, equipe?.id_equipe || null);
      aoSalvar(equipe ? `Equipe ${form.nome.trim()} salva.` : `Equipe ${form.nome.trim()} criada.`);
    } catch (falha) {
      setErro(msg(falha, 'Não foi possível salvar a equipe.'));
    } finally {
      setSalvando(false);
    }
  };
  return html`<${JanelaForm} titulo=${equipe ? `Editar equipe ${equipe.nome}` : 'Nova equipe'} onClose=${aoFechar} onSubmit=${enviar} erro=${erro} salvando=${salvando}
    salvarRotulo=${equipe ? 'Salvar' : 'Criar equipe'}>
    <${Campo} rotulo="Operação" ajuda=${equipe ? 'A operação não muda. Para outra operação, crie outra equipe.' : ''}>
      <select class="c-entrada" value=${form.operacao} disabled=${equipe ? true : null} onChange=${(e) => setForm((f) => ({ ...f, operacao: e.target.value, id_supervisor: '', id_apoio: '' }))}>
        ${operacoes.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}
      </select>
    <//>
    <${Campo} rotulo="Nome da equipe">
      <input class="c-entrada" maxLength="80" value=${form.nome} onInput=${(e) => mudar('nome', e.target.value)} autofocus />
    <//>
    <${Campo} rotulo="Supervisor responsável" ajuda="Recebe as pendências dos operadores (monitorias, trocas, planos).">
      <select class="c-entrada" value=${form.id_supervisor} onChange=${(e) => mudar('id_supervisor', e.target.value)}>
        <option value="">Escolha…</option>
        ${sups.map((s) => html`<option key=${s.id_usuario} value=${s.id_usuario}>${s.nome}</option>`)}
      </select>
    <//>
    <${Campo} rotulo="Apoio" opcional ajuda="Vê a equipe, não recebe pendências.">
      <select class="c-entrada" value=${form.id_apoio} onChange=${(e) => mudar('id_apoio', e.target.value)}>
        <option value="">Ninguém</option>
        ${sups.filter((s) => String(s.id_usuario) !== String(form.id_supervisor)).map((s) => html`<option key=${s.id_usuario} value=${s.id_usuario}>${s.nome}</option>`)}
      </select>
    <//>
    <p class="c-ajuda">Os turnos da equipe são os turnos do supervisor responsável (Turnos e Plantões › Cadastros).</p>
    <label class="c-grupo"><span class="c-interruptor"><input type="checkbox" checked=${form.ativo} onChange=${(e) => mudar('ativo', e.target.checked)} aria-label="Equipe ativa" /></span>Equipe ativa</label>
  <//>`;
}

function JanelaExcluirEquipe({ equipe, aoFechar, aoExcluir }) {
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const temOperadores = equipe.membros > 0;
  const excluir = async () => {
    setSalvando(true); setErro('');
    try { await excluirEquipeAdmin(equipe.id_equipe); aoExcluir(); }
    catch (f) { setErro(msg(f, 'Não foi possível excluir a equipe.')); } finally { setSalvando(false); }
  };
  return html`<${Janela} titulo=${`Excluir ${equipe.nome}`} tamanho="pequena" onClose=${aoFechar}
    rodape=${temOperadores
      ? html`<button type="button" class="c-botao c-botao--secundario" onClick=${aoFechar}>Fechar</button>`
      : html`<button type="button" class="c-botao c-botao--secundario" onClick=${aoFechar}>Cancelar</button><button type="button" class="c-botao c-botao--perigo" aria-busy=${salvando ? 'true' : null} disabled=${salvando || null} onClick=${excluir}><${Ic} nome="trash" />Excluir equipe</button>`}>
    <div class="c-janela-corpo">
      ${temOperadores
        ? html`<${Faixa} tom="aviso" icone="warning"><b>Esta equipe tem ${equipe.membros} ${equipe.membros === 1 ? 'operador' : 'operadores'}.</b> Mova todos para outra equipe antes de excluir. Use "Mover" no painel da equipe.<//>`
        : html`<p>Excluir a <b>${equipe.nome}</b> (${equipe.operacao_nome})? Ela sai da lista e não volta.</p>
          <p class="c-ajuda">O histórico não muda: monitorias e relatórios já feitos continuam com o nome desta equipe.</p>`}
      ${erro ? html`<${Faixa} tom="perigo" icone="warning">${erro}<//>` : null}
    </div>
  <//>`;
}

const MODOS_ESCALA = [
  { chave: 'levar', titulo: 'Levar o turno junto', texto: (t, sup) => `${t} passa a ser de ${sup}. A escala não muda.` },
  { chave: 'manter', titulo: 'Manter a escala como está', texto: (t, sup, dono) => `Os dias continuam em ${t}, de ${dono}.` },
  { chave: 'outro', titulo: 'Passar para outro turno', texto: (t, sup) => `Os dias vão para um turno de ${sup}, que já existe ou novo.` },
  { chave: 'refazer', titulo: 'Montar escala nova', texto: (t, sup) => `Os dias ficam vazios para ${sup} montar.` },
];

function JanelaMover({ origem, operadores, equipes, aoFechar, aoMover }) {
  const destinos = equipes.filter((e) => e.operacao === origem.operacao && e.ativo && e.id_equipe !== origem.id_equipe && e.id_supervisor);
  const [idDestino, setIdDestino] = useState(destinos[0]?.id_equipe || '');
  const [previa, setPrevia] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [modo, setModo] = useState('');
  const [turnos, setTurnos] = useState({});
  const [excluirOrigem, setExcluirOrigem] = useState(true);
  const [movendo, setMovendo] = useState(false);
  const ids = operadores.map((o) => o.id_usuario);
  const fusao = operadores.length >= (origem.membros || 0);

  useEffect(() => {
    if (!idDestino) { setPrevia(null); return undefined; }
    let vivo = true;
    setCarregando(true); setErro(''); setTurnos({});
    previaMoverEquipe({ ids_operadores: ids, id_equipe_destino: Number(idDestino) })
      .then((d) => { if (vivo) setPrevia(d); })
      .catch((f) => { if (vivo) { setPrevia(null); setErro(msg(f, 'Não foi possível calcular o que migra.')); } })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [idDestino]);

  const sup = previa?.destino?.supervisor_nome || '';
  const outros = (previa?.turnos || []);
  const compartilhado = outros.filter((t) => t.ficam > 0);
  const modoEfetivo = modo || (outros.length && !compartilhado.length ? 'levar' : 'manter');
  const faltam = modoEfetivo === 'outro' ? outros.filter((t) => !t.id_destino_auto && !turnos[t.id_turno]).length : 0;
  const c = previa?.contagens || {};
  const desde = c.escala_desde ? c.escala_desde.split('-').reverse().slice(0, 2).join('/') : '';
  const linhas = [
    ['Monitorias aguardando feedback', c.monitorias_feedback],
    ['Contestações aguardando reanálise', c.monitorias_contestacao],
    ['Trocas aguardando resposta ou aprovação', c.trocas],
    ['Planos de ação abertos', c.planos],
  ];
  const nomes = operadores.map((o) => o.nome);
  const resumoNomes = nomes.length <= 3 ? nomes.join(', ').replace(/, ([^,]*)$/, ' e $1') : `${nomes.slice(0, 2).join(', ')} e mais ${nomes.length - 2}`;
  const rotTurnos = outros.length === 1 ? outros[0].rotulo.split(' · ')[0] : `os ${outros.length} turnos`;
  const dono = outros[0]?.rotulo.split(' · ')[1] || origem.supervisor_nome || 'o supervisor de antes';

  const confirmar = async () => {
    setMovendo(true); setErro('');
    try {
      const r = await moverEquipe({ ids_operadores: ids, id_equipe_destino: Number(idDestino), modo_escala: modoEfetivo, turnos, excluir_origem: fusao && excluirOrigem });
      aoMover(`${r.movidos} ${r.movidos === 1 ? 'operador movido' : 'operadores movidos'} para a equipe ${r.destino?.nome}. O que estava em aberto passou para ${r.destino?.supervisor_nome}.${(r.equipes_excluidas || []).length ? ` ${r.equipes_excluidas.join(', ')} excluída.` : ''}`);
    } catch (falha) {
      setErro(msg(falha, 'Não foi possível mover.'));
    } finally {
      setMovendo(false);
    }
  };

  const rodape = html`
    ${faltam ? html`<span class="c-md-rodape-txt">Escolha ${faltam === 1 ? 'o turno que falta' : `os ${faltam} turnos que faltam`} para concluir.</span>` : null}
    <button type="button" class="c-botao c-botao--secundario" onClick=${aoFechar}>Cancelar</button>
    <button type="button" class="c-botao c-botao--principal" disabled=${(!previa || faltam || movendo || carregando) ? true : null} aria-busy=${movendo ? 'true' : null} onClick=${confirmar}>
      <${Ic} nome="arrows-left-right" />${movendo ? 'Movendo…' : `Mover ${ids.length} ${ids.length === 1 ? 'operador' : 'operadores'}`}
    </button>`;

  return html`<${Janela} tamanho="grande" titulo=${`Mover ${ids.length} ${ids.length === 1 ? 'operador' : 'operadores'}`} onClose=${aoFechar} rodape=${rodape}>
    <div class="c-janela-corpo c-eqa-mover">
      <p class="c-secundario">${resumoNomes} · saem da ${origem.nome}${origem.supervisor_nome ? ` (${origem.supervisor_nome})` : ''}</p>
      ${destinos.length ? html`<${Campo} rotulo="Equipe de destino" ajuda="Só equipes ativas da mesma operação, com supervisor responsável.">
        <select class="c-entrada" value=${idDestino} onChange=${(e) => setIdDestino(e.target.value)}>
          ${destinos.map((d) => html`<option key=${d.id_equipe} value=${d.id_equipe}>${d.nome} · ${d.supervisor_nome}</option>`)}
        </select>
      <//>` : html`<${Faixa} tom="atencao" icone="warning">Não há outra equipe ativa com supervisor nesta operação. Crie a equipe antes.<//>`}
      ${carregando ? html`<${Esqueleto} linhas=${4} />` : null}
      ${previa && !carregando ? html`
        ${fusao ? html`<${Faixa} tom="informacao" icone="users"><b>Fusão:</b> todos os operadores da ${origem.nome} vão para a ${previa.destino.nome}.
          <label class="c-marcar"><input type="checkbox" checked=${excluirOrigem} onChange=${(e) => setExcluirOrigem(e.target.checked)} />Excluir a ${origem.nome} ao concluir (fica vazia)</label><//>` : null}
        <div><p class="c-forte">Passa para ${sup} (o que está em aberto)</p>
          <table class="c-tabela c-tabela--compacta"><tbody>
            ${linhas.map(([rot, n]) => html`<tr key=${rot}><td><${Ic} nome="arrow-right" /> ${rot}</td><td class="c-num c-forte">${n || 0}</td></tr>`)}
          </tbody></table>
        </div>
        ${outros.length ? html`<div class="c-eqa-escala">
          <div class="c-eqa-titulo"><span class="c-forte">Escala de ${desde} em diante · ${c.escala_pessoas} ${c.escala_pessoas === 1 ? 'pessoa' : 'pessoas'} · ${c.escala_dias} dias</span><span class="c-ajuda">Turno de hoje: ${outros.map((t) => t.rotulo).join(' | ')}</span></div>
          <table class="c-tabela c-tabela--compacta c-tabela--opcoes"><tbody>
            ${MODOS_ESCALA.map((m) => {
              const bloqueado = m.chave === 'levar' && compartilhado.length;
              return html`<tr key=${m.chave} aria-selected=${modoEfetivo === m.chave ? 'true' : null}>
                <td><label class="c-marcar"><input type="radio" name="modo-escala" checked=${modoEfetivo === m.chave} disabled=${bloqueado ? true : null} onChange=${() => setModo(m.chave)} />
                  <span><span class="c-forte">${m.titulo}</span>
                  <small>${bloqueado ? `Indisponível: ${compartilhado[0].ficam} ${compartilhado[0].ficam === 1 ? 'operador que fica usa' : 'operadores que ficam usam'} este turno.` : m.texto(rotTurnos, sup, dono)}</small></span></label></td>
              </tr>`;
            })}
          </tbody></table>
          ${modoEfetivo === 'outro' ? html`<table class="c-tabela c-tabela--compacta">
            <thead><tr><th>Turno de hoje</th><th>Vai para</th></tr></thead>
            <tbody>${outros.map((t) => html`<tr key=${t.id_turno}>
              <td>${t.rotulo}<br /><span class="c-secundario">${t.pessoas} ${t.pessoas === 1 ? 'pessoa' : 'pessoas'} · ${t.dias} dias</span></td>
              <td><select class="c-entrada c-entrada--compacta" aria-label=${`Turno de destino para ${t.rotulo}`} value=${turnos[t.id_turno] || t.id_destino_auto || ''}
                  onChange=${(e) => setTurnos((mapa) => ({ ...mapa, [t.id_turno]: e.target.value === 'novo' ? 'novo' : Number(e.target.value) || undefined }))}>
                  <option value="">Escolha o turno…</option>
                  <option value="novo">Criar turno novo de ${sup} (cópia, mesmo horário)</option>
                  ${t.opcoes.map((o) => html`<option key=${o.id_turno} value=${o.id_turno}>${o.rotulo}</option>`)}
                </select></td>
            </tr>`)}</tbody>
          </table>` : null}
          ${modoEfetivo === 'refazer' ? html`<${Faixa} tom="atencao" icone="warning">${c.escala_dias} dias ficam vazios e ${c.trocas || 0} ${c.trocas === 1 ? 'troca em aberto é cancelada' : 'trocas em aberto são canceladas'}. Se o mês já foi publicado, publique de novo depois de montar.<//>` : null}
        </div>` : null}
        <${Faixa} tom="informacao" icone="lock"><b>Não muda (histórico):</b> monitorias finalizadas, trocas já decididas, escala até hoje, avisos já enviados e registros de quem fez o quê.<//>
      ` : null}
      ${erro ? html`<div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${erro}</p></div></div>` : null}
    </div>
  <//>`;
}

export function AbaEquipesAdmin() {
  const [dados, setDados] = useState(null);
  const [operacoes, setOperacoes] = useState([]);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [filtros, setFiltros] = useState({ busca: '', operacao: '', situacao: 'ativas' });
  const [idSel, setIdSel] = useState(null);
  const [membros, setMembros] = useState({ itens: [], carregando: false });
  const [marcados, setMarcados] = useState(new Set());
  const [janela, setJanela] = useState(null); // {tipo: 'nova'|'editar'|'mover', equipe}
  const [exportando, setExportando] = useState(false);

  const carregar = () => {
    setErro('');
    return listarEquipesAdmin()
      .then((d) => setDados(d))
      .catch((f) => setErro(msg(f, 'Não foi possível carregar as equipes.')));
  };
  useEffect(() => {
    carregar();
    listarOperacoes().then((l) => setOperacoes((Array.isArray(l) ? l : l?.itens || []).filter((o) => o.ativo !== false))).catch(() => setOperacoes([]));
  }, []);

  const equipes = dados?.equipes || [];
  const visiveis = useMemo(() => equipes.filter((e) => {
    if (filtros.operacao && e.operacao !== filtros.operacao) return false;
    if (filtros.situacao === 'ativas' && !e.ativo) return false;
    if (filtros.situacao === 'desativadas' && e.ativo) return false;
    const b = semAcento(filtros.busca.trim());
    return !b || [e.nome, e.supervisor_nome, e.apoio_nome, e.operacao_nome].some((t) => semAcento(t).includes(b));
  }), [equipes, filtros]);
  const sel = equipes.find((e) => e.id_equipe === idSel) || null;

  useEffect(() => {
    if (!idSel) { setMembros({ itens: [], carregando: false }); return undefined; }
    let vivo = true;
    setMarcados(new Set());
    setMembros({ itens: [], carregando: true });
    membrosEquipeAdmin(idSel)
      .then((d) => { if (vivo) setMembros({ itens: d?.itens || [], carregando: false }); })
      .catch(() => { if (vivo) setMembros({ itens: [], carregando: false }); });
    return () => { vivo = false; };
  }, [idSel, dados]);

  const opsDoFiltro = useMemo(() => {
    const mapa = new Map();
    equipes.forEach((e) => mapa.set(e.operacao, e.operacao_nome));
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [equipes]);
  const opsDaJanela = operacoes.length
    ? operacoes.map((o) => ({ chave: o.chave || o.nome, nome: o.nome })).filter((o) => !dados?.supervisores || o.chave in dados.supervisores || opsDoFiltro.some(([k]) => k === o.chave))
    : opsDoFiltro.map(([chave, nome]) => ({ chave, nome }));

  const pode = dados?.pode || {};
  const eu = dados?.eu || {};
  const podeMoverSel = pode.mover && sel && (!eu.eh_supervisor || sel.id_supervisor === eu.id_usuario);
  const totalOps = visiveis.reduce((s, e) => s + e.membros, 0);

  const exportar = async () => {
    setExportando(true);
    try {
      const r = await exportarEquipesAdmin(filtros.operacao);
      baixarBlob(r.filename || 'equipes.csv', r.blob);
    } catch (f) {
      setErro(msg(f, 'Não foi possível exportar.'));
    } finally {
      setExportando(false);
    }
  };
  const fecharJanela = (texto = '') => {
    setJanela(null);
    if (texto) { setAviso(texto); carregar(); }
  };
  const alternar = (id) => setMarcados((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const todosMarcados = membros.itens.length > 0 && membros.itens.every((m) => marcados.has(m.id_usuario));

  if (!dados && !erro) return html`<main class="c-pagina c-conteudo"><${Esqueleto} linhas=${6} /></main>`;

  return html`<main class="c-pagina c-conteudo c-ds">
    <div class="c-cab-linha">
      <h1>Equipes</h1>
      <span class="c-ajuda">Cada operador fica em 1 equipe. O supervisor responsável recebe as pendências.</span>
      <div class="c-cab-dir">
        ${pode.exportar ? html`<button type="button" class="c-botao c-botao--secundario" disabled=${exportando || null} onClick=${exportar}><${Ic} nome="tray-arrow-down" />${exportando ? 'Exportando…' : 'Exportar'}</button>` : null}
        ${pode.administrar ? html`<button type="button" class="c-botao c-botao--principal" onClick=${() => setJanela({ tipo: 'nova' })}><${Ic} nome="plus" />Nova equipe</button>` : null}
      </div>
    </div>
    ${aviso ? html`<${Faixa} tom="informacao" icone="check-circle" acao=${html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => setAviso('')}>Fechar</button>`}>${aviso}<//>` : null}
    ${erro ? html`<${Faixa} tom="perigo" icone="warning">${erro}<//>` : null}
    <div class="c-fm-corpo">
      <div class="c-tabela-caixa">
        <div class="c-filtros c-filtros--suave">
          <div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" />
            <input class="c-entrada c-entrada--compacta" type="search" placeholder="Buscar equipe ou supervisor" aria-label="Buscar equipe ou supervisor"
              value=${filtros.busca} onInput=${(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))} />
          </div>
          <select class="c-entrada c-entrada--compacta" aria-label="Operação" value=${filtros.operacao} onChange=${(e) => setFiltros((f) => ({ ...f, operacao: e.target.value }))}>
            <option value="">Operação: todas</option>
            ${opsDoFiltro.map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}
          </select>
          <select class="c-entrada c-entrada--compacta" aria-label="Situação" value=${filtros.situacao} onChange=${(e) => setFiltros((f) => ({ ...f, situacao: e.target.value }))}>
            <option value="ativas">Ativas</option><option value="desativadas">Desativadas</option><option value="">Situação: todas</option>
          </select>
        </div>
        ${visiveis.length ? html`<table class="c-tabela c-tabela--justa">
          <thead><tr><th class="c-col-nome">Equipe</th><th>Operação</th><th>Supervisor responsável</th><th>Apoio</th><th class="c-num">Operadores</th><th>Turnos</th><th>Situação</th><th class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead>
          <tbody>${visiveis.map((e) => html`<tr key=${e.id_equipe} class="c-clicavel" aria-selected=${e.id_equipe === idSel ? 'true' : null} onClick=${() => setIdSel(e.id_equipe)}>
            <td class="c-forte c-col-nome">${e.nome}</td>
            <td>${e.operacao_nome}</td>
            <td>${e.supervisor_nome || html`<span class="c-secundario">sem supervisor</span>`}</td>
            <td class="c-secundario">${e.apoio_nome || '—'}</td>
            <td class="c-num">${e.membros}</td>
            <td>${e.turnos.length ? e.turnos.join(' · ') : '—'}</td>
            <td>${e.ativo ? html`<${Selo} tom="sucesso">Ativa<//>` : html`<${Selo} tom="neutro" icone="prohibit">Desativada<//>`}</td>
            <td class="c-acoes" onClick=${(ev) => ev.stopPropagation()}>
              <${MenuAcoes} acoes=${[
                pode.administrar ? { label: 'Editar', icon: 'pencil-simple', onClick: () => setJanela({ tipo: 'editar', equipe: e }) } : null,
                pode.exportar ? { label: 'Exportar a operação', icon: 'tray-arrow-down', onClick: () => exportarEquipesAdmin(e.operacao).then((r) => baixarBlob(r.filename || 'equipes.csv', r.blob)).catch((f) => setErro(msg(f, 'Não foi possível exportar.'))) } : null,
                pode.administrar ? { label: 'Excluir', icon: 'trash', perigo: true, onClick: () => setJanela({ tipo: 'excluir', equipe: e }) } : null,
              ]} />
            </td>
          </tr>`)}</tbody>
        </table>` : html`<${Estado} icone="users" titulo="Nenhuma equipe encontrada" texto="Mude os filtros ou crie uma equipe." />`}
        <div class="c-tabela-rodape"><span>${visiveis.length} ${visiveis.length === 1 ? 'equipe' : 'equipes'} · ${totalOps} operadores</span></div>
      </div>

      ${sel ? html`<aside class="c-db-bloco c-fm-lado" aria-label=${`Equipe ${sel.nome}`}>
        <div class="c-db-bloco-cab"><h3>${sel.nome}</h3>${sel.ativo ? html`<${Selo} tom="sucesso">Ativa<//>` : html`<${Selo} tom="neutro">Desativada<//>`}</div>
        <div class="c-db-bloco-corpo">
          <dl class="c-md-dados c-md-dados--2">
            <div><dt>Operação</dt><dd>${sel.operacao_nome}</dd></div>
            <div><dt>Supervisor responsável</dt><dd>${sel.supervisor_nome || '—'}</dd></div>
            <div><dt>Apoio</dt><dd>${sel.apoio_nome || '—'}</dd></div>
            <div><dt>Turnos</dt><dd>${sel.turnos.join(' · ') || '—'}</dd></div>
          </dl>
          ${membros.carregando ? html`<${Esqueleto} linhas=${4} />` : membros.itens.length ? html`<table class="c-tabela c-tabela--compacta c-tabela--membros">
            <thead><tr>
              <th style=${{ width: '32px' }}>${podeMoverSel ? html`<label class="c-marcar"><input type="checkbox" aria-label="Marcar todos" checked=${todosMarcados}
                onChange=${() => setMarcados(todosMarcados ? new Set() : new Set(membros.itens.map((m) => m.id_usuario)))} /></label>` : null}</th>
              <th>Operador <span class="c-secundario">· turno do mês</span></th>
            </tr></thead>
            <tbody>${membros.itens.map((m) => html`<tr key=${m.id_usuario} aria-selected=${marcados.has(m.id_usuario) ? 'true' : null}>
              <td>${podeMoverSel ? html`<label class="c-marcar"><input type="checkbox" aria-label=${`Marcar ${m.nome}`} checked=${marcados.has(m.id_usuario)} onChange=${() => alternar(m.id_usuario)} /></label>` : null}</td>
              <td><span class="c-forte">${m.nome}</span><small title=${m.turno || ''}>${m.turno || 'Sem turno no mês'}</small></td>
            </tr>`)}</tbody>
          </table>` : html`<p class="c-secundario">Nenhum operador nesta equipe.</p>`}
        </div>
        ${podeMoverSel ? html`<div class="c-fm-lado-acoes">
          <button type="button" class="c-botao c-botao--principal" disabled=${!marcados.size || null}
            onClick=${() => setJanela({ tipo: 'mover', equipe: sel })}><${Ic} nome="arrows-left-right" />${marcados.size ? `Mover ${marcados.size} ${marcados.size === 1 ? 'selecionado' : 'selecionados'}` : 'Marque quem vai mudar'}</button>
        </div>` : null}
      </aside>` : html`<aside class="c-db-bloco c-fm-lado"><div class="c-db-bloco-corpo"><${Estado} icone="users" titulo="Escolha uma equipe" texto="Clique numa linha para ver os operadores e mover." /></div></aside>`}
    </div>

    ${janela && (janela.tipo === 'nova' || janela.tipo === 'editar') ? html`<${JanelaEquipe} equipe=${janela.equipe || null} operacoes=${opsDaJanela}
      supervisores=${dados?.supervisores || {}} aoFechar=${() => fecharJanela()} aoSalvar=${(t) => fecharJanela(t)} />` : null}
    ${janela?.tipo === 'excluir' ? html`<${JanelaExcluirEquipe} equipe=${janela.equipe} aoFechar=${() => fecharJanela()}
      aoExcluir=${() => { if (idSel === janela.equipe.id_equipe) setIdSel(null); fecharJanela(`${janela.equipe.nome} excluída.`); }} />` : null}
    ${janela?.tipo === 'mover' ? html`<${JanelaMover} origem=${janela.equipe} equipes=${equipes}
      operadores=${membros.itens.filter((m) => marcados.has(m.id_usuario))} aoFechar=${() => fecharJanela()} aoMover=${(t) => fecharJanela(t)} />` : null}
  </main>`;
}
