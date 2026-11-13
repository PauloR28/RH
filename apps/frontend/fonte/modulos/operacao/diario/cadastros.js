import { html, useEffect, useState } from '../../../infraestrutura-react.js';
import { importarDiario, listarCadastrosDiario, salvarCadastroDiario } from '../../../services/api/diario.js';
import { Campo, Esqueleto, Estado, Ic, JanelaForm, Segmento, Selo } from '../../../ui/components/ds.js?v=20261106-wfm';
import { diaHist } from './regras.js';

// Diário de bordo › Cadastros (só Administração, D5): tipos de demanda, canais e ferramentas por operação. Desligar não apaga
// histórico (o item some das telas novas e continua nos dias em que foi usado). Mais a importação única dos .json antigos (D7).

const LISTAS = [
  ['demanda', 'Tipos de demanda', 'Linhas da tabela do turno (início e fim).'],
  ['canal_ns', 'Canais de nível de serviço', 'Campos de NS (%) de cada turno.'],
  ['canal_parcial', 'Canais das parciais', 'Colunas das parciais do dia.'],
  ['ferramenta', 'Ferramentas', 'Lista da intercorrência.'],
];

function JanelaItem({ operacao, tipo, item, onClose, onSalvo }) {
  const [nome, setNome] = useState(item?.nome || '');
  const [ativo, setAtivo] = useState(item ? item.ativo : true);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const enviar = async (ev) => {
    ev.preventDefault();
    if (!nome.trim()) return setErro('Escreva o nome.');
    setSalvando(true); setErro('');
    try { await salvarCadastroDiario(item?.id_item, { operacao, tipo, nome: nome.trim(), ativo, ordem: item?.ordem ?? null }); onSalvo(); onClose(); } catch (e) { setErro(e?.message || 'Não foi possível salvar.'); setSalvando(false); }
  };
  return html`<${JanelaForm} titulo=${item ? 'Editar item' : `Novo item · ${LISTAS.find((l) => l[0] === tipo)[1]}`} onClose=${onClose} onSubmit=${enviar} erro=${erro} salvando=${salvando}>
    <${Campo} rotulo="Nome"><input class="c-entrada" autofocus maxLength="120" value=${nome} onInput=${(e) => setNome(e.target.value)} /><//>
    <label class="c-interruptor"><input type="checkbox" checked=${ativo} onChange=${(e) => setAtivo(e.target.checked)} /><span>Ligado (aparece nas telas novas)</span></label>
    ${item ? html`<p class="c-ajuda" style=${{ margin: 0 }}>Mudar o nome muda também nos dias antigos. Desligar não apaga nada.</p>` : null}
  <//>`;
}

function Importacao({ operacao }) {
  const [arquivos, setArquivos] = useState([]);
  const [previa, setPrevia] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [feito, setFeito] = useState(null);
  const ler = async (lista) => {
    setErro(''); setPrevia(null); setFeito(null);
    const conteudos = [];
    for (const f of Array.from(lista || [])) {
      try { conteudos.push(JSON.parse(await f.text())); } catch { setErro(`O arquivo "${f.name}" não é um .json válido do diário antigo.`); return; }
    }
    setArquivos(conteudos);
    if (!conteudos.length) return;
    setOcupado(true);
    try { setPrevia(await importarDiario(operacao, conteudos, false)); } catch (e) { setErro(e?.message || 'Não foi possível ler os arquivos.'); }
    setOcupado(false);
  };
  const gravar = async () => {
    setOcupado(true); setErro('');
    try { setFeito(await importarDiario(operacao, arquivos, true)); setPrevia(null); } catch (e) { setErro(e?.message || 'Não foi possível importar.'); }
    setOcupado(false);
  };
  return html`<section class="c-tabela-caixa c-db-import">
    <div class="c-db-bloco-cab"><h3>Importar o diário antigo</h3></div>
    <div class="c-db-bloco-corpo">
      <p class="c-ajuda" style=${{ margin: 0 }}>Uma vez só: escolha os .json exportados do diário antigo (um por computador). Antes de gravar aparece a prévia. Dia que já existe no Conecta nunca é sobrescrito. O ABS digitado no diário antigo entra como correção ("importação").</p>
      <div class="c-grupo"><label class="c-botao c-botao--secundario c-botao--compacto"><${Ic} nome="tray-arrow-down" />Escolher arquivos .json
        <input type="file" accept="application/json,.json" multiple class="c-oculto" onChange=${(e) => ler(e.target.files)} /></label>
        ${arquivos.length ? html`<span class="c-secundario">${arquivos.length} arquivo(s)</span>` : null}</div>
      ${erro ? html`<div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${erro}</p></div></div>` : null}
      ${ocupado ? html`<${Esqueleto} linhas=${3} />` : null}
      ${feito ? html`<div class="c-faixa c-faixa--informacao" role="status"><${Ic} nome="check-circle" /><div class="c-faixa-txt"><p><b>${feito.gravados} dia(s) importado(s).</b> ${feito.ignorados ? `${feito.ignorados} já existiam e ficaram como estavam.` : ''} Veja no Histórico (aparecem como "importado").</p></div></div>` : null}
    </div>
    ${previa ? html`<table class="c-tabela c-tabela--compacta"><thead><tr><th scope="col">Dia</th><th scope="col">Turnos</th><th class="c-num" scope="col">Intercorr.</th><th class="c-num" scope="col">Parciais</th><th scope="col">ABS</th><th scope="col">Encerramento</th><th class="c-estica" scope="col">Atenção</th><th scope="col">Situação</th></tr></thead>
      <tbody>${previa.dias.map((d) => html`<tr key=${d.data}><td class="c-forte" data-papel="titulo">${diaHist(d.data)}/${d.data.slice(0, 4)}</td><td data-papel="info" data-prioridade="1" data-primeira="">${d.turnos.length} de 3 turnos</td><td class="c-num">${d.intercorrencias}</td><td class="c-num">${d.parciais}</td>
        <td>${d.tem_abs ? 'sim' : '—'}</td><td>${d.tem_encerramento ? 'sim' : '—'}</td>
        <td class="c-estica c-secundario">${[d.repetido_nos_arquivos ? 'veio em mais de um arquivo (vale o mais recente de cada turno)' : '', d.nao_reconhecidos.length ? `não reconhecidos: ${d.nao_reconhecidos.join(', ')}` : ''].filter(Boolean).join(' · ') || '—'}</td>
        <td data-papel="selo">${d.ja_existe ? html`<${Selo} tom="neutro">Já existe: ignorado<//>` : html`<${Selo} tom="informacao" icone="plus">Novo<//>`}</td></tr>`)}</tbody></table>
      <div class="c-tabela-rodape"><span>${previa.novos} novo(s) · ${previa.ja_existem} já existe(m)</span>
        <button type="button" class="c-botao c-botao--principal c-botao--compacto" disabled=${!previa.novos || ocupado || null} onClick=${gravar}>Gravar ${previa.novos} dia(s)</button></div>` : null}
  </section>`;
}

export function AbaCadastros({ contexto, operacao, setOperacao }) {
  const [itens, setItens] = useState(null);
  const [erro, setErro] = useState('');
  const [lista, setLista] = useState('demanda');
  const [janela, setJanela] = useState(null);
  const carregar = () => listarCadastrosDiario(operacao).then((r) => setItens(r.itens || [])).catch((e) => setErro(e?.message || 'Não foi possível ler os cadastros.'));
  useEffect(() => { setItens(null); carregar(); }, [operacao]);
  const desc = LISTAS.find((l) => l[0] === lista);
  const daLista = (itens || []).filter((i) => i.tipo === lista);
  return html`<div class="c-cab-linha"><h1>Cadastros</h1><span class="c-ajuda">${desc[2]} Desligar não apaga o histórico.</span><div class="c-cab-dir">
      <button type="button" class="c-botao c-botao--principal c-botao--compacto" onClick=${() => setJanela({})}><${Ic} nome="plus" />Adicionar</button></div></div>
    <div class="c-grupo"><${Segmento} rotulo="Lista" valor=${lista} aoMudar=${setLista} opcoes=${LISTAS.map(([v, r]) => [v, r, (itens || []).filter((i) => i.tipo === v && i.ativo).length])} />
      ${contexto.operacoes.length > 1 ? html`<select class="c-entrada c-entrada--compacta c-fim" aria-label="Operação" value=${operacao} onChange=${(e) => setOperacao(e.target.value)}>${contexto.operacoes.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select>` : null}</div>
    <div class="c-tabela-caixa c-db-caixa c-db-caixa--justa">${erro ? html`<${Estado} titulo=${erro} />` : !itens ? html`<${Esqueleto} linhas=${5} />` : html`<table class="c-tabela c-tabela--compacta c-tabela--junta">
      <thead><tr><th class="c-col-nome" scope="col">Nome</th><th scope="col">Situação</th><th class="c-estica" scope="col"></th><th class="c-acoes" scope="col"><span class="c-oculto">Ações</span></th></tr></thead>
      <tbody>${daLista.map((i) => html`<tr key=${i.id_item}><td class="c-col-nome c-forte" data-papel="titulo">${i.nome}</td><td data-papel="selo">${i.ativo ? html`<${Selo} tom="sucesso" icone="check-circle">Ligado<//>` : html`<${Selo} tom="neutro">Desligado<//>`}</td><td class="c-estica"></td>
        <td class="c-acoes" data-papel="acoes"><button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => setJanela({ item: i })}><${Ic} nome="pencil-simple" />Editar</button></td></tr>`)}</tbody></table>
      <div class="c-tabela-rodape"><span>${daLista.length} ${daLista.length === 1 ? 'item' : 'itens'}</span></div>`}</div>
    <${Importacao} operacao=${operacao} />
    ${janela ? html`<${JanelaItem} operacao=${operacao} tipo=${janela.item?.tipo || lista} item=${janela.item} onClose=${() => setJanela(null)} onSalvo=${carregar} />` : null}`;
}
