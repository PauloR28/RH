// Configurações › Painéis (14/11/2026, amostra v3 aprovada): a Tecnologia monta cada painel (módulo + unidade):
// métricas, forma de mostrar, ordem, de quanto em quanto tempo atualiza e quais perfis podem ver.
// Rebranding: só peças c- e tokens (estilos/painel.css). Regras e validação ficam no servidor (/painel/config).
import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js?v=20261124-equipes4';
import { Esqueleto, Estado, Ic } from '../../ui/components/ds.js?v=20261124-equipes4';
import { lerConfigPaineis, salvarConfigPainel } from '../../services/api/painel.js?v=20261124-equipes4';

const NOME_INTERVALO = { 60: '1 minuto', 300: '5 minutos', 900: '15 minutos' };

function Editor({ config, painel, aoFechar, aoSalvar }) {
  const novo = !painel;
  const [modulo, setModulo] = useState(painel?.modulo || 'operacao');
  const unidadesDoModulo = config.unidades.filter((u) => u.ativo && u.modulo === modulo);
  const [operacao, setOperacao] = useState(painel?.operacao || unidadesDoModulo[0]?.chave || '');
  const [intervalo, setIntervalo] = useState(painel?.intervalo_seg || 60);
  const [ativo, setAtivo] = useState(painel ? painel.ativo : true);
  const [metricas, setMetricas] = useState(() => (painel?.metricas || []).map((m) => ({ metrica: m.metrica, forma: m.forma })));
  const [perfis, setPerfis] = useState(painel?.perfis || ['gestor']);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const catalogo = config.metricas.filter((m) => m.modulo === modulo);
  const semFuncao = new Set(painel && painel.operacao === operacao ? painel.sem_funcao || [] : []);
  const ligadas = metricas.map((m) => m.metrica);
  const ordem = [...metricas.map((m) => catalogo.find((c) => c.id === m.metrica)).filter(Boolean), ...catalogo.filter((c) => !ligadas.includes(c.id))];

  const trocarModulo = (valor) => {
    setModulo(valor);
    setOperacao((config.unidades.find((u) => u.ativo && u.modulo === valor) || {}).chave || '');
    setMetricas([]);
  };
  const ligar = (id, sim) => setMetricas((lista) => (sim ? [...lista, { metrica: id, forma: catalogo.find((c) => c.id === id).formas[0].id }] : lista.filter((m) => m.metrica !== id)));
  const mudarForma = (id, forma) => setMetricas((lista) => lista.map((m) => (m.metrica === id ? { ...m, forma } : m)));
  const mover = (id, passo) => setMetricas((lista) => {
    const i = lista.findIndex((m) => m.metrica === id);
    const j = i + passo;
    if (i < 0 || j < 0 || j >= lista.length) return lista;
    const copia = [...lista];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    return copia;
  });
  const marcarPerfil = (id, sim) => setPerfis((lista) => (sim ? [...lista, id] : lista.filter((p) => p !== id)));

  const salvar = async () => {
    setSalvando(true); setErro('');
    try {
      const salvo = await salvarConfigPainel(painel?.id_painel, { modulo, operacao, ativo, intervalo_seg: Number(intervalo), metricas, perfis });
      aoSalvar(salvo);
    } catch (e) {
      setErro(e?.message || 'Não foi possível salvar o painel.');
      setSalvando(false);
    }
  };

  const nomeUnidade = (config.unidades.find((u) => u.chave === operacao) || {}).nome || operacao;
  return html`
    <div class="c-pg-fundo" onClick=${aoFechar}></div>
    <aside class="c-painel-lateral c-pg-editor c-ds" role="dialog" aria-modal="true" aria-labelledby="c-pg-editor-titulo">
      <div class="c-janela-cab"><h2 id="c-pg-editor-titulo">${novo ? 'Novo painel' : `Editar painel · ${config.modulos.find((m) => m.chave === modulo)?.nome || modulo} · ${nomeUnidade}`}</h2>
        <button type="button" class="c-botao c-botao--icone c-botao--texto" aria-label="Fechar" onClick=${aoFechar}><${Ic} nome="x" /></button></div>
      <div class="c-janela-corpo">
        ${erro ? html`<div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${erro}</p></div></div>` : null}
        <div class="c-form" style=${{ '--colunas': 3 }}>
          <label class="c-pg-campo"><span>Módulo</span>
            <select class="c-entrada" value=${modulo} onChange=${(e) => trocarModulo(e.target.value)}>
              ${config.modulos.map((m) => html`<option key=${m.chave} value=${m.chave}>${m.nome}</option>`)}
            </select></label>
          <label class="c-pg-campo"><span>${modulo === 'rh' ? 'Setor' : 'Operação'}</span>
            <select class="c-entrada" value=${operacao} disabled=${!unidadesDoModulo.length || null} onChange=${(e) => setOperacao(e.target.value)}>
              ${unidadesDoModulo.length ? unidadesDoModulo.map((u) => html`<option key=${u.chave} value=${u.chave}>${u.nome}</option>`) : html`<option value="">Nenhuma unidade deste módulo</option>`}
            </select></label>
          <label class="c-pg-campo"><span>Atualizar a cada</span>
            <select class="c-entrada" value=${String(intervalo)} onChange=${(e) => setIntervalo(Number(e.target.value))}>
              ${config.intervalos.map((s) => html`<option key=${s} value=${String(s)}>${NOME_INTERVALO[s] || `${s} s`}</option>`)}
            </select></label>
        </div>
        ${!unidadesDoModulo.length ? html`<p class="c-ajuda">Cadastre uma unidade deste módulo em Configurações › Unidades para montar o painel.</p>` : null}
        <section>
          <h3>Métricas do painel (ligue, escolha como aparece e a ordem)</h3>
          <ul class="c-pg-blocos">
            ${ordem.map((m) => {
              const ligada = ligadas.includes(m.id);
              const bloqueada = semFuncao.has(m.id);
              const pos = ligadas.indexOf(m.id);
              const atual = metricas.find((x) => x.metrica === m.id);
              return html`<li key=${m.id} data-off=${ligada ? null : ''}>
                <label class="c-interruptor"><input type="checkbox" checked=${ligada} disabled=${bloqueada && !ligada ? true : null} aria-label=${`Mostrar ${m.nome}`} onChange=${(e) => ligar(m.id, e.target.checked)} /></label>
                <span class="c-pg-estica"><span>${m.nome}</span><small>${bloqueada ? 'Esta unidade não usa esta função (tela Módulos)' : `Aba ${m.area} · ${m.descricao}`}</small></span>
                <select class="c-entrada c-entrada--compacta" aria-label=${`Como mostrar ${m.nome}`} value=${atual?.forma || m.formas[0].id} disabled=${!ligada || m.formas.length < 2 || null} onChange=${(e) => mudarForma(m.id, e.target.value)}>
                  ${m.formas.map((f) => html`<option key=${f.id} value=${f.id}>${f.nome}</option>`)}
                </select>
                <button type="button" class="c-botao c-botao--icone c-botao--texto c-botao--compacto" aria-label=${`Subir ${m.nome}`} disabled=${!ligada || pos === 0 || null} onClick=${() => mover(m.id, -1)}><${Ic} nome="arrow-up" /></button>
                <button type="button" class="c-botao c-botao--icone c-botao--texto c-botao--compacto" aria-label=${`Descer ${m.nome}`} disabled=${!ligada || pos === ligadas.length - 1 || null} onClick=${() => mover(m.id, 1)}><${Ic} nome="arrow-down" /></button>
              </li>`;
            })}
          </ul>
        </section>
        <section>
          <h3>Quem pode ver este painel</h3>
          <div class="c-pg-perfis">
            ${config.perfis.map((p) => html`<label key=${p.id} class="c-marcar"><input type="checkbox" checked=${perfis.includes(p.id)} onChange=${(e) => marcarPerfil(p.id, e.target.checked)} />${p.nome}</label>`)}
          </div>
          <p class="c-ajuda">A pessoa também precisa da permissão de ver painéis (em Acessos) e de acesso a esta unidade. Cada métrica pede ainda o acesso ao módulo de origem.</p>
        </section>
        <label class="c-interruptor"><input type="checkbox" checked=${ativo} onChange=${(e) => setAtivo(e.target.checked)} />Painel ligado</label>
      </div>
      <div class="c-janela-rodape">
        <button type="button" class="c-botao c-botao--secundario" onClick=${aoFechar}>Cancelar</button>
        <button type="button" class="c-botao c-botao--principal" disabled=${salvando || !operacao || !metricas.length || null} onClick=${salvar}>${salvando ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </aside>`;
}

export function ConfigPaineis() {
  const [config, setConfig] = useState(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [busca, setBusca] = useState('');
  const [filtroModulo, setFiltroModulo] = useState('');
  const [editando, setEditando] = useState(null); // null = fechado; {} = novo; painel = editar

  const carregar = () => lerConfigPaineis().then((c) => { setConfig(c); setErro(''); }).catch((e) => setErro(e?.message || 'Não foi possível carregar os painéis.'));
  useEffect(() => { carregar(); }, []);

  const nomeModulo = (chave) => (config?.modulos.find((m) => m.chave === chave) || {}).nome || chave;
  const nomePerfil = (id) => (config?.perfis.find((p) => p.id === id) || {}).nome || id;
  const lista = useMemo(() => {
    if (!config) return [];
    const termo = busca.trim().toLowerCase();
    return config.paineis.filter((p) => (!filtroModulo || p.modulo === filtroModulo)
      && (!termo || `${nomeModulo(p.modulo)} ${p.operacao_nome}`.toLowerCase().includes(termo)));
  }, [config, busca, filtroModulo]);

  const aoSalvar = (salvo) => {
    setEditando(null);
    setAviso(`Painel ${nomeModulo(salvo.modulo)} · ${salvo.operacao_nome} salvo. Quem tem acesso já vê a mudança.`);
    carregar();
  };

  return html`
    <div class="c-pagina c-pg-config">
      <div class="c-pagina-cab">
        <div class="c-titulo">
          <h1>Painéis</h1>
          <p>Cada painel mostra uma operação de um módulo. A Tecnologia escolhe as métricas, como aparecem e quem pode ver.</p>
        </div>
        <button type="button" class="c-botao c-botao--principal" disabled=${!config || null} onClick=${() => { setAviso(''); setEditando({}); }}><${Ic} nome="plus" />Novo painel</button>
      </div>
      ${erro ? html`<div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${erro}</p></div></div>` : null}
      ${aviso ? html`<div class="c-faixa c-faixa--informacao" role="status"><${Ic} nome="check" /><div class="c-faixa-txt"><p>${aviso}</p></div></div>` : null}
      <div class="c-tabela-caixa">
        <div class="c-filtros">
          <label class="c-com-icone c-busca"><${Ic} nome="magnifying-glass" />
            <input class="c-entrada" type="search" placeholder="Buscar painel" aria-label="Buscar painel" value=${busca} onInput=${(e) => setBusca(e.target.value)} /></label>
          <select class="c-entrada" aria-label="Módulo" value=${filtroModulo} onChange=${(e) => setFiltroModulo(e.target.value)}>
            <option value="">Todos os módulos</option>
            ${(config?.modulos || []).map((m) => html`<option key=${m.chave} value=${m.chave}>${m.nome}</option>`)}
          </select>
          <span class="c-contador">${lista.length} ${lista.length === 1 ? 'painel' : 'painéis'}</span>
        </div>
        ${!config && !erro ? html`<${Esqueleto} linhas=${4} />`
          : !lista.length ? html`<${Estado} icone="chart-bar" titulo=${config?.paineis.length ? 'Nenhum painel com esse filtro.' : 'Nenhum painel ainda.'} texto=${config?.paineis.length ? '' : 'Crie o primeiro: escolha o módulo, a operação, as métricas e quem pode ver.'} />`
            : html`<table class="c-tabela">
              <thead><tr><th>Painel</th><th>Módulo</th><th>Operação</th><th class="c-centro">Métricas</th><th>Quem pode ver</th><th>Situação</th><th class="c-acoes"></th></tr></thead>
              <tbody>${lista.map((p) => {
                const total = config.metricas.filter((m) => m.modulo === p.modulo).length;
                return html`<tr key=${p.id_painel}>
                  <td class="c-forte" data-papel="titulo">${nomeModulo(p.modulo)} · ${p.operacao_nome}</td>
                  <td>${nomeModulo(p.modulo)}</td>
                  <td>${p.operacao_nome}</td>
                  <td class="c-centro">${p.metricas.length} de ${total}</td>
                  <td data-papel="info" data-prioridade="1" data-primeira="">${p.perfis.length ? p.perfis.map(nomePerfil).join(', ') : 'Ninguém marcado'}</td>
                  <td data-papel="selo"><span class=${`c-selo c-selo--${p.ativo ? 'sucesso' : 'neutro'}`}>${p.ativo ? 'Ligado' : 'Desligado'}</span></td>
                  <td class="c-acoes" data-papel="acoes"><div class="c-grupo">
                    <button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => { setAviso(''); setEditando(p); }}><${Ic} nome="pencil-simple" />Editar</button>
                  </div></td>
                </tr>`;
              })}</tbody>
            </table>`}
      </div>
    </div>
    ${editando && config ? html`<${Editor} config=${config} painel=${editando.id_painel ? editando : null} aoFechar=${() => setEditando(null)} aoSalvar=${aoSalvar} />` : null}`;
}
