import { html, useEffect, useMemo, useRef, useState } from '../../infraestrutura-react.js';
import { IconeSvg } from '../../ui/icone.js';
import { ModalPadrao } from '../../ui/components/modals.js?v=20260921-hdr';

// Perfis e permissões em três painéis (Perfis | Sessões do perfil | Permissões da sessão) numa tela que não rola.
// Só apresentação e estado local (sessão, grupo, filtros, modo comparar): perfis, rascunho, desbloqueio, salvamento em
// lote e regras vêm do pai (configuracoes/index.js) e continuam exatamente como eram. Estilos: estilos/perfis-permissoes.css.

const TELA_INICIAL = '__tela_inicial__';
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const Ico = ({ nome }) => html`<span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(nome)}</span>`;

// Setas sobem e descem entre os itens marcados com data-roving (tabindex móvel).
function setas(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const itens = [...e.currentTarget.querySelectorAll('[data-roving]')];
  const i = itens.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  itens[Math.max(0, Math.min(itens.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
}

// Interruptor: button role="switch"; trilho visual de 36x20 e alvo de 44x40.
export function Interruptor({ marcado, desabilitado, aoAlternar, rotulo }) {
  return html`<button type="button" role="switch" aria-checked=${marcado ? 'true' : 'false'} aria-label=${rotulo} disabled=${desabilitado}
    class=${`pp-switch ${marcado ? 'is-on' : ''}`} onClick=${aoAlternar}><span class="pp-switch-trilho"><span class="pp-switch-bolinha"></span></span></button>`;
}

function Classe({ critica }) {
  return html`<span class=${`pp-classe ${critica ? 'is-critica' : ''}`}><i aria-hidden="true"></i>${critica ? 'Crítica' : 'Operacional'}</span>`;
}

// Abas em pílula dos grupos (rolam na horizontal quando são muitas).
function AbasGrupo({ grupos, ativo, aoEscolher, rotuloDe, semResultado }) {
  return html`<div class="pp-abas" role="tablist" aria-label="Grupos da sessão">
    ${grupos.map((g) => html`<button key=${g} type="button" role="tab" aria-selected=${g === ativo} class=${`${g === ativo ? 'is-ativo' : ''} ${semResultado?.(g) ? 'is-vazio' : ''}`.trim()} onClick=${() => aoEscolher(g)}>${rotuloDe(g)}</button>`)}
  </div>`;
}

export function PerfisPermissoes({
  perfis, permissoes, grupos, sessoes, ordemModulos, nomesModulos, iconePerfil,
  perfilId, aoSelecionarPerfil, sessaoId, aoSelecionarSessao,
  draft, desbloqueado, podeEditar, aoDesbloquear, aoAlternar, aoGrupo,
  modulosVisiveis, usuarios, aoVerUsuarios,
  pendentes, salvando, aoSalvar, aoRestaurar, justificativa, aoJustificativa,
  podeMover, aoMover, wfmFechado, telaInicial,
}) {
  const raiz = useRef(null);
  const [comparar, setComparar] = useState(false);
  const [cmp, setCmp] = useState({ a: '', b: '', proximo: 'b' });
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('todas');
  const [grupoEsc, setGrupoEsc] = useState('');
  const [somenteDif, setSomenteDif] = useState(false);
  const [confirmar, setConfirmar] = useState(null);

  // A página não rola: o painel ocupa do topo dele até o fim da janela (descontando o respiro do contêiner).
  useEffect(() => {
    const ajustar = () => {
      const el = raiz.current;
      if (!el) return;
      const topo = el.getBoundingClientRect().top + window.scrollY;
      const pai = el.parentElement;
      const folga = pai ? parseFloat(getComputedStyle(pai).paddingBottom) || 0 : 0;
      el.style.height = `${Math.max(420, Math.floor(window.innerHeight - topo - folga))}px`;
    };
    ajustar();
    window.addEventListener('resize', ajustar);
    return () => window.removeEventListener('resize', ajustar);
  });

  const perfil = perfis.find((p) => p.id === perfilId) || null;
  const ativas = useMemo(() => new Set(draft), [draft]);
  const gruposDa = (sessao) => Object.entries(grupos).filter(([modulo]) => sessao.modulos.includes(modulo));
  const itensDa = (sessao) => gruposDa(sessao).flatMap(([, itens]) => itens);
  const sessaoAtual = sessoes.find((s) => s.id === sessaoId) || null;
  const ehTela = sessaoId === TELA_INICIAL;
  const totalPerms = permissoes.length;
  const totalCriticas = permissoes.filter((p) => p.critica).length;

  // ---- seleção no modo comparar ----
  const perfilA = perfis.find((p) => p.id === cmp.a) || null;
  const perfilB = perfis.find((p) => p.id === cmp.b) || null;
  const clicarPerfil = (id) => {
    if (!comparar) { aoSelecionarPerfil(id); return; }
    setCmp((c) => {
      if (c.a === id) return { ...c, a: '' };
      if (c.b === id) return { ...c, b: '' };
      if (!c.a) return { ...c, a: id };
      if (!c.b) return { ...c, b: id };
      return c.proximo === 'b' ? { ...c, b: id, proximo: 'a' } : { ...c, a: id, proximo: 'b' };
    });
  };
  const alternarComparar = () => {
    setComparar((v) => !v);
    setCmp({ a: '', b: '', proximo: 'b' });
    setSomenteDif(false);
  };
  const trocarAB = (lado, id) => setCmp((c) => (id === c[lado === 'a' ? 'b' : 'a'] ? { ...c, a: c.b, b: c.a } : { ...c, [lado]: id }));

  // ---- painel 3 (normal): grupos, filtros e linhas visíveis ----
  const gruposSessao = sessaoAtual ? gruposDa(sessaoAtual) : [];
  const termo = norm(busca.trim());
  const casa = (p) => {
    const on = ativas.has(p.chave);
    if (filtro === 'ativas' && !on) return false;
    if (filtro === 'inativas' && on) return false;
    if (filtro === 'criticas' && !p.critica) return false;
    return !termo || norm(`${p.chave} ${p.descricao}`).includes(termo);
  };
  const nomesGrupos = gruposSessao.map(([m]) => m);
  const itensDoGrupo = (g) => (gruposSessao.find(([m]) => m === g)?.[1] || []);
  const grupoAtual = (() => {
    const base = nomesGrupos.includes(grupoEsc) ? grupoEsc : nomesGrupos[0];
    if (itensDoGrupo(base).some(casa) || !(termo || filtro !== 'todas')) return base;
    return nomesGrupos.find((g) => itensDoGrupo(g).some(casa)) || base;
  })();
  const linhas = itensDoGrupo(grupoAtual).filter(casa);
  const todasDaSessao = sessaoAtual ? itensDa(sessaoAtual) : [];
  const nAtivasSessao = todasDaSessao.filter((p) => ativas.has(p.chave)).length;
  const sessaoLiberada = sessaoAtual ? ativas.has(`sessao.${sessaoAtual.id}.acessar`) : false;
  const limpar = () => { setBusca(''); setFiltro('todas'); };
  const pedirAtivarTodas = () => {
    const alvo = linhas.filter((p) => !ativas.has(p.chave));
    const criticas = alvo.filter((p) => p.critica).length;
    if (criticas) setConfirmar({ itens: linhas, criticas }); else aoGrupo(linhas, true);
  };

  // ---- painel 3 (comparar) ----
  const sessaoCmp = ehTela ? sessoes[0] : sessaoAtual;
  const gruposCmp = sessaoCmp ? gruposDa(sessaoCmp) : [];
  const nomesCmp = gruposCmp.map(([m]) => m);
  const grupoCmp = nomesCmp.includes(grupoEsc) ? grupoEsc : nomesCmp[0];
  const setPerm = (p) => new Set(p?.permissoes || []);
  const setA = setPerm(perfilA); const setB = setPerm(perfilB);
  const linhasCmp = (gruposCmp.find(([m]) => m === grupoCmp)?.[1] || []).map((p) => ({ p, a: setA.has(p.chave), b: setB.has(p.chave) }));
  const nDif = linhasCmp.filter((l) => l.a !== l.b).length;
  const linhasCmpVis = somenteDif ? linhasCmp.filter((l) => l.a !== l.b) : linhasCmp;

  // ---- painel 2 ----
  const contagemSessao = (s) => {
    const itens = itensDa(s);
    if (comparar) return String(itens.length);
    return `${itens.filter((p) => ativas.has(p.chave)).length}/${itens.length}`;
  };
  const sessoesPorModulo = ordemModulos.map((m) => ({ modulo: m, itens: sessoes.filter((s) => s.modulo === m) })).filter((g) => g.itens.length);
  const nomesVisiveis = ordemModulos.filter((m) => m !== 'core' && modulosVisiveis.has(m)).map((m) => nomesModulos[m] || m);
  const perfisMarcados = comparar ? [cmp.a, cmp.b].filter(Boolean) : [perfilId];
  const perfilTab = perfis.some((p) => perfisMarcados.includes(p.id)) ? perfisMarcados[0] : perfis[0]?.id;
  const sessaoTab = sessaoId || sessoes[0]?.id;

  const opcaoSessao = (s) => `${s.label} — ${contagemSessao(s)}`;

  return html`
    <div class="pp-raiz" ref=${raiz}>
      <header class="pp-cab">
        <div class="pp-cab-txt">
          <span class="pp-eyebrow">CONSOLE · ADMINISTRAÇÃO</span>
          <h1>Perfis e permissões</h1>
        </div>
      </header>

      <section class="pp-resumo" aria-label="Resumo e ações">
        <div class="pp-resumo-esq">
          <span class="pp-pilula">${perfis.length} perfis</span>
          <span class="pp-pilula">${totalPerms} permissões</span>
          <span class="pp-pilula is-critica">${totalCriticas} críticas</span>
          <span class="pp-estado"><${Ico} nome=${desbloqueado ? 'lock_open' : 'lock'} />${desbloqueado ? 'Edição liberada' : 'Somente leitura. Desbloqueie para editar permissões de qualquer perfil e sessão.'}</span>
        </div>
        <div class="pp-resumo-dir">
          ${desbloqueado && !comparar ? html`
            ${pendentes ? html`<label class="pp-just"><span class="visually-hidden">Justificativa da alteração</span><input class="pp-campo" value=${justificativa} placeholder="Justificativa (opcional)" onInput=${(e) => aoJustificativa(e.target.value)} /></label>` : null}
            <button type="button" class="pp-btn" disabled=${salvando || !pendentes} onClick=${aoRestaurar}><${Ico} nome="settings_backup_restore" />Restaurar</button>
            <button type="button" class="pp-btn pp-btn--prim" disabled=${salvando || !pendentes || !podeEditar} onClick=${aoSalvar}><${Ico} nome="save" />${salvando ? 'Salvando...' : `Salvar alterações${pendentes ? ` (${pendentes})` : ''}`}</button>` : null}
          ${perfis.length > 1 ? html`<button type="button" class=${`pp-btn pp-btn--cor ${comparar ? 'is-ativo' : ''}`} aria-pressed=${comparar} onClick=${alternarComparar}><${Ico} nome="compare_arrows" />${comparar ? 'Comparando dois perfis' : 'Comparar dois perfis'}</button>` : null}
          ${podeEditar ? html`<button type="button" class="pp-btn pp-btn--prim" onClick=${aoDesbloquear}><${Ico} nome=${desbloqueado ? 'lock_open' : 'lock'} />${desbloqueado ? 'Bloquear edição' : 'Editar configurações padrão'}</button>` : null}
        </div>
      </section>

      <div class="pp-paineis">
        <nav class="pp-painel pp-p1" aria-label="Perfis">
          <div class="pp-p-cab">
            <div class="pp-p-cab-linha"><span class="pp-rotulo">PERFIS</span><span class="pp-num pp-muted">${perfis.length}</span></div>
            ${comparar ? html`<span class="pp-muted pp-p-sub">Escolha dois para comparar</span>` : null}
          </div>
          <div class="pp-lista" onKeyDown=${setas}>
            ${perfis.map((p) => {
              const marca = comparar ? (cmp.a === p.id ? 'A' : cmp.b === p.id ? 'B' : '') : '';
              const sel = comparar ? !!marca : p.id === perfilId;
              return html`<button key=${p.id} type="button" data-roving class=${`pp-item ${sel ? 'is-ativo' : ''}`} aria-current=${sel ? 'true' : undefined} tabIndex=${p.id === perfilTab ? 0 : -1} title=${p.nome} onClick=${() => clicarPerfil(p.id)}>
                <span class="pp-icone"><${Ico} nome=${iconePerfil(p.id)} /></span><span class="pp-item-nome">${p.nome}</span>${marca ? html`<span class="pp-selo">${marca}</span>` : null}</button>`;
            })}
          </div>
        </nav>

        <nav class="pp-painel pp-p2" aria-label="Sessões do perfil">
          <div class="pp-p-cab pp-p-cab--div">
            ${comparar ? html`<span class="pp-rotulo">SESSÕES</span><span class="pp-p2-sub">Todas as sessões, de qualquer módulo</span>` : html`
              <span class="pp-rotulo">SESSÕES DE</span>
              <div class="pp-p2-linha"><strong class="pp-p2-nome" title=${perfil?.nome}>${perfil?.nome || '—'}</strong>
                <span class="pp-enxerga" title=${nomesVisiveis.join(', ')}><i aria-hidden="true"></i>${nomesVisiveis.length ? `Enxerga: ${nomesVisiveis.join(', ')}` : 'Sem módulos'}</span></div>`}
          </div>
          <div class="pp-lista pp-lista--sessoes" onKeyDown=${setas}>
            ${sessoesPorModulo.map(({ modulo, itens }) => {
              const vis = modulosVisiveis.has(modulo);
              return html`<div key=${modulo} class="pp-grupo">
                ${comparar ? html`<div class="pp-grupo-tit"><span>${nomesModulos[modulo] || modulo}</span></div>`
                  : html`<div class="pp-grupo-tit"><i class=${vis ? 'is-vis' : ''} aria-hidden="true"></i><span>${nomesModulos[modulo] || modulo}</span><small>${vis ? 'visível' : 'sem acesso'}</small></div>`}
                ${itens.map((s) => html`<button key=${s.id} type="button" data-roving class=${`pp-item pp-item--sessao ${sessaoId === s.id ? 'is-ativo' : ''}`} aria-current=${sessaoId === s.id ? 'true' : undefined} tabIndex=${s.id === sessaoTab ? 0 : -1} title=${s.label} onClick=${() => aoSelecionarSessao(s.id)}>
                  <span class="pp-item-nome">${s.label}</span><span class="pp-num pp-muted">${contagemSessao(s)}</span></button>`)}
              </div>`;
            })}
            ${comparar ? null : html`<div class="pp-grupo pp-grupo--tela"><button type="button" data-roving class=${`pp-item pp-item--sessao ${ehTela ? 'is-ativo' : ''}`} aria-current=${ehTela ? 'true' : undefined} tabIndex=${TELA_INICIAL === sessaoTab ? 0 : -1} onClick=${() => aoSelecionarSessao(TELA_INICIAL)}>
              <span class="pp-item-nome">Tela inicial</span><span class="pp-muted">blocos</span></button></div>`}
          </div>
        </nav>

        <section class="pp-painel pp-p3" aria-label=${comparar ? 'Comparação de perfis' : 'Permissões da sessão'}>
          <div class="pp-estreito">
            ${comparar ? null : html`<label class="pp-lab"><span class="visually-hidden">Perfil</span><select class="pp-campo" value=${perfilId} onChange=${(e) => aoSelecionarPerfil(e.target.value)}>${perfis.map((p) => html`<option key=${p.id} value=${p.id}>${p.nome}</option>`)}</select></label>`}
            <label class="pp-lab"><span class="visually-hidden">Sessão</span><select class="pp-campo" value=${sessaoTab} onChange=${(e) => aoSelecionarSessao(e.target.value)}>${sessoes.map((s) => html`<option key=${s.id} value=${s.id}>${opcaoSessao(s)}</option>`)}${comparar ? null : html`<option value=${TELA_INICIAL}>Tela inicial — blocos</option>`}</select></label>
          </div>

          ${comparar ? (perfilA && perfilB ? html`
            <header class="pp-p3-cab">
              <div class="pp-p3-tit"><span class="pp-eyebrow">SESSÃO · COMPARAÇÃO</span><h2><span title=${perfilA.nome}>${perfilA.nome}</span> <em>vs</em> <span title=${perfilB.nome}>${perfilB.nome}</span></h2></div>
              <div class="pp-ab">
                <label class="pp-lab"><span class="visually-hidden">Perfil A</span><select class="pp-campo" value=${cmp.a} onChange=${(e) => trocarAB('a', e.target.value)}>${perfis.map((p) => html`<option key=${p.id} value=${p.id}>A: ${p.nome}</option>`)}</select></label>
                <span class="pp-troca" aria-hidden="true"><${Ico} nome="compare_arrows" /></span>
                <label class="pp-lab"><span class="visually-hidden">Perfil B</span><select class="pp-campo" value=${cmp.b} onChange=${(e) => trocarAB('b', e.target.value)}>${perfis.map((p) => html`<option key=${p.id} value=${p.id}>B: ${p.nome}</option>`)}</select></label>
              </div>
            </header>
            <div class="pp-linha-ctl">
              ${nomesCmp.length > 1 ? html`<${AbasGrupo} grupos=${nomesCmp} ativo=${grupoCmp} aoEscolher=${setGrupoEsc} rotuloDe=${(g) => g} />` : html`<span class="pp-rotulo">${grupoCmp}</span>`}
              <div class="pp-ctl-dir"><span class="pp-ambar" aria-live="polite">${nDif} de ${linhasCmp.length} diferem</span>
                <label class="pp-sw-rot"><${Interruptor} marcado=${somenteDif} aoAlternar=${() => setSomenteDif(!somenteDif)} rotulo="Só diferenças" /><span>Só diferenças</span></label></div>
            </div>
            <div class="pp-corpo">
              <div class="pp-tab" role="table" aria-label="Comparação de permissões">
                <div class="pp-tab-lin pp-tab-cab" role="row">
                  <span role="columnheader">PERMISSÃO</span><span role="columnheader">CLASSE</span><span role="columnheader" title=${perfilA.nome}>A · ${perfilA.nome}</span><span role="columnheader" title=${perfilB.nome}>B · ${perfilB.nome}</span><span role="columnheader">DIFERENÇA</span>
                </div>
                ${linhasCmpVis.length ? linhasCmpVis.map(({ p, a, b }) => html`<div key=${p.chave} role="row" class=${`pp-tab-lin ${a !== b ? 'is-dif' : ''}`}>
                  <span role="cell" class="pp-copia"><strong title=${p.chave}>${p.chave}</strong><small title=${p.descricao}>${p.descricao || '-'}</small></span>
                  <span role="cell"><${Classe} critica=${p.critica} /></span>
                  <span role="cell" class=${`pp-estadoab ${a ? 'on' : ''}`}><i aria-hidden="true">${a ? '✓' : '–'}</i>${a ? 'Ativa' : 'Inativa'}</span>
                  <span role="cell" class=${`pp-estadoab ${b ? 'on' : ''}`}><i aria-hidden="true">${b ? '✓' : '–'}</i>${b ? 'Ativa' : 'Inativa'}</span>
                  <span role="cell" class=${`pp-dif ${a !== b ? 'is-dif' : ''}`}>${a !== b ? 'Diferente' : 'Igual'}</span>
                </div>`) : html`<div class="pp-vazio"><p>${somenteDif ? 'Nenhuma diferença neste grupo.' : 'Nenhuma permissão neste grupo.'}</p></div>`}
              </div>
            </div>` : html`<div class="pp-vazio pp-vazio--cheio"><strong>Escolha dois perfis para comparar</strong><p>Clique nos perfis da esquerda: o primeiro vira A e o segundo vira B.</p></div>`)
          : ehTela ? html`
            <header class="pp-p3-cab"><div class="pp-p3-tit"><span class="pp-eyebrow">TELA INICIAL</span><h2 title=${perfil?.nome}>${perfil?.nome}</h2></div></header>
            <div class="pp-corpo pp-corpo--livre">${telaInicial}</div>`
          : html`
            <header class="pp-p3-cab">
              <div class="pp-p3-tit"><span class="pp-eyebrow">${(sessaoAtual?.label || '').toUpperCase()}</span><h2 title=${perfil?.nome}>${perfil?.nome}</h2></div>
              <div class="pp-p3-dir">
                <span class="pp-usuarios"><i aria-hidden="true"></i><span aria-live="polite">${usuarios} usuário(s)</span></span>
                ${usuarios ? html`<button type="button" class="pp-btn pp-btn--sm" onClick=${aoVerUsuarios}>Ver usuários</button>` : null}
                <label class=${`pp-sw-rot ${sessaoLiberada ? '' : 'is-destaque'}`}><${Interruptor} marcado=${sessaoLiberada} desabilitado=${!desbloqueado || !sessaoAtual} aoAlternar=${() => aoAlternar(`sessao.${sessaoAtual.id}.acessar`)} rotulo=${`Sessão liberada: ${sessaoAtual?.label || ''}`} /><strong>Sessão liberada</strong></label>
              </div>
            </header>
            ${!sessaoLiberada ? html`<p class="pp-aviso" role="status">Sessão não liberada para este perfil.${desbloqueado ? '' : ' Desbloqueie a edição para liberar.'}</p>` : null}
            ${sessaoAtual?.id === 'wfm' && wfmFechado ? html`<p class="pp-aviso pp-aviso--atencao" role="status">Turnos e Plantões está fechado para ${perfil?.nome} (fase de teste): as permissões desta sessão são gravadas, mas não valem até o WFM ser liberado em Tecnologia &gt; Módulos.</p>` : null}
            <div class="pp-filtros">
              <div class="pp-busca"><span class="pp-busca-ico" aria-hidden="true"><${Ico} nome="search" /></span><label class="visually-hidden" for="pp-busca">Buscar permissão</label><input id="pp-busca" type="search" class="pp-campo" placeholder="Buscar permissão" value=${busca} onInput=${(e) => setBusca(e.target.value)} /></div>
              <div class="pp-chips" role="group" aria-label="Filtrar permissões">
                ${[['todas', `Todas ${todasDaSessao.length}`], ['ativas', `Ativas ${nAtivasSessao}`], ['inativas', `Inativas ${todasDaSessao.length - nAtivasSessao}`], ['criticas', 'Críticas']].map(([id, r]) => html`<button key=${id} type="button" class=${`pp-chip ${filtro === id ? 'is-ativo' : ''}`} aria-pressed=${filtro === id} onClick=${() => setFiltro(id)}>${r}</button>`)}
              </div>
              <span class="pp-contagem pp-num" aria-live="polite">${nAtivasSessao} de ${todasDaSessao.length} ativas</span>
            </div>
            <div class="pp-linha-ctl">
              ${nomesGrupos.length > 1 ? html`<${AbasGrupo} grupos=${nomesGrupos} ativo=${grupoAtual} aoEscolher=${setGrupoEsc}
                rotuloDe=${(g) => `${g} ${itensDoGrupo(g).filter((p) => ativas.has(p.chave)).length}/${itensDoGrupo(g).length}`}
                semResultado=${(g) => (termo || filtro !== 'todas') && !itensDoGrupo(g).some(casa)} />` : html`<span class="pp-rotulo">${grupoAtual}</span>`}
              <div class="pp-ctl-dir">
                <button type="button" class="pp-btn pp-btn--sm" disabled=${!desbloqueado || !linhas.length} onClick=${pedirAtivarTodas}>Ativar todas</button>
                <button type="button" class="pp-btn pp-btn--sm" disabled=${!desbloqueado || !linhas.length} onClick=${() => aoGrupo(linhas, false)}>Desativar todas</button>
              </div>
            </div>
            <div class="pp-corpo">
              ${linhas.length ? html`<div class="pp-grade">${linhas.map((p) => {
                const on = ativas.has(p.chave);
                return html`<div key=${p.chave} class=${`pp-perm ${on ? 'is-on' : ''}`}>
                  <${Interruptor} marcado=${on} desabilitado=${!desbloqueado} aoAlternar=${() => aoAlternar(p.chave)} rotulo=${p.chave} />
                  <span class="pp-copia"><strong title=${p.chave}>${p.chave}</strong><small title=${p.descricao}>${p.descricao || '-'}</small></span>
                  ${podeMover && p.modulo_dono ? html`<select class="pp-campo pp-dono" aria-label=${`Módulo de ${p.chave}`} value=${p.modulo_dono} onChange=${(e) => aoMover(p.chave, e.target.value)}>${ordemModulos.map((m) => html`<option key=${m} value=${m}>${nomesModulos[m] || m}</option>`)}</select>` : null}
                  <${Classe} critica=${p.critica} />
                </div>`;
              })}</div>` : html`<div class="pp-vazio pp-vazio--cheio"><strong>Nenhuma permissão encontrada</strong>${termo || filtro !== 'todas' ? html`<button type="button" class="pp-link" onClick=${limpar}>Limpar busca e filtros</button>` : null}</div>`}
            </div>`}
        </section>
      </div>

      <${ModalPadrao} aberto=${!!confirmar} titulo="Ativar permissões críticas?" subtitulo="Confirmação de interface antes de ativar em massa." onClose=${() => setConfirmar(null)}>
        <div class="pp-confirmar">
          <p>Este conjunto inclui <strong>${confirmar?.criticas || 0} permissão(ões) crítica(s)</strong> que ainda estão inativas e serão ativadas para <strong>${perfil?.nome}</strong>. A alteração só vale depois de "Salvar alterações".</p>
          <footer class="rh-modal-footer">
            <button type="button" class="btn btn-outline-secondary" onClick=${() => setConfirmar(null)}>Cancelar</button>
            <button type="button" class="btn btn-primary" onClick=${() => { aoGrupo(confirmar.itens, true); setConfirmar(null); }}>Ativar todas</button>
          </footer>
        </div>
      <//>
    </div>`;
}
