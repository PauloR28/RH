// Central de Acessos (Etapa 6, desenho aprovado em 12/nov/2026): módulos, funções e permissões dos perfis num lugar só.
// Rebranding: só peças c- (conecta-ds.css) e tokens; estilos próprios em estilos/central-acessos.css.
// Fluxo: escolher o módulo > "Vale para" (todos, uma unidade do módulo ou uma pessoa) > clicar nas células > Salvar.
import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import { Ic, Segmento, Selo } from '../../ui/components/ds.js';
import { definirModuloAtivo } from '../../services/api/modulos.js';
import { lerAcessos, lerEscoposAcessos, padronizarAcessos, salvarAcessos } from '../../services/api/central-acessos.js';
import { obterEstadoModulos } from '../../modulos/estado.js?v=20261112-modulo-unico2';

const POR_PAGINA = 5;
const MODULOS_PADRAO = [{ chave: 'tecnologia', nome: 'Tecnologia', ativo: true, protegido: true }, { chave: 'rh', nome: 'RH', ativo: true }, { chave: 'operacao', nome: 'Operação', ativo: true }];

function listaModulos() {
  const lista = (obterEstadoModulos()?.modulos || []).filter((m) => m && m.chave && m.chave !== 'core');
  return lista.length ? lista : MODULOS_PADRAO;
}

const chavePerm = (funcao, chave, perfil) => `p|${funcao}|${chave}|${perfil}`;
const chaveFunc = (funcao) => `f|${funcao}`;

export function CentralAcessos({ controlador }) {
  const podeEditar = Boolean(controlador?.possuiPermissao?.('configuracoes.editar'));
  const [modulos, setModulos] = useState(listaModulos);
  const [modulo, setModulo] = useState(() => (listaModulos().find((m) => m.chave === 'operacao') || listaModulos()[0]).chave);
  const [escopo, setEscopo] = useState('padrao');
  const [escopos, setEscopos] = useState({ unidades: [], pessoas: [] });
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [rascunho, setRascunho] = useState({});
  const [abertas, setAbertas] = useState({});
  const [busca, setBusca] = useState('');
  const [mostrar, setMostrar] = useState('todas');
  const [pagina, setPagina] = useState(1);
  const [salvando, setSalvando] = useState(false);
  const [confirmarPadronizar, setConfirmarPadronizar] = useState(false);

  const carregar = async (mod = modulo, esc = escopo) => {
    setCarregando(true);
    setErro('');
    try {
      const [matriz, opcoes] = await Promise.all([lerAcessos(mod, esc), lerEscoposAcessos(mod)]);
      setDados(matriz);
      setEscopos(opcoes || { unidades: [], pessoas: [] });
    } catch (e) {
      setErro(e?.message || 'Não foi possível carregar os acessos.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregar(); }, [modulo, escopo]);

  const trocarModulo = (chave) => {
    if (chave === modulo) return;
    if (Object.keys(rascunho).length) { setErro('Salve ou desfaça as mudanças antes de trocar de módulo.'); return; }
    setModulo(chave); setEscopo('padrao'); setPagina(1); setBusca(''); setAviso('');
  };
  const trocarEscopo = (valor) => {
    if (Object.keys(rascunho).length) { setErro('Salve ou desfaça as mudanças antes de trocar o "Vale para".'); return; }
    setEscopo(valor); setPagina(1); setAviso('');
  };

  const funcoes = dados?.funcoes || [];
  const perfis = dados?.perfis || [];
  const tipo = dados?.tipo || 'padrao';
  const perfilPessoa = dados?.perfil_da_pessoa || '';

  const ligada = (f) => (rascunho[chaveFunc(f.id)] !== undefined ? rascunho[chaveFunc(f.id)] : f.ligada);
  const valor = (f, acao, perfil) => {
    const k = chavePerm(f.id, acao.chave, perfil);
    return rascunho[k] !== undefined ? rascunho[k] : Boolean(acao.valores?.[perfil]);
  };
  const alternar = (k, novo, original) => {
    setAviso('');
    setRascunho((r) => {
      const prox = { ...r };
      if (novo === original) delete prox[k]; else prox[k] = novo;
      return prox;
    });
  };

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return funcoes
      .filter((f) => (mostrar === 'todas' || ligada(f)) && (!termo || f.nome.toLowerCase().includes(termo)))
      .sort((a, b) => Number(ligada(b)) - Number(ligada(a)) || a.n - b.n);
  }, [funcoes, busca, mostrar, rascunho]);
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * POR_PAGINA;
  const visiveis = filtradas.slice(inicio, inicio + POR_PAGINA);
  const nLigadas = funcoes.filter((f) => ligada(f)).length;
  const pendentes = Object.keys(rascunho).length;

  const salvar = async () => {
    const mudancas = Object.entries(rascunho).map(([k, v]) => {
      const partes = k.split('|');
      return partes[0] === 'f' ? { tipo: 'funcao', funcao: partes[1], ligada: v } : { tipo: 'perm', chave: partes[2], perfil: partes[3], valor: v };
    });
    setSalvando(true); setErro('');
    try {
      await salvarAcessos({ modulo, escopo, mudancas });
      setRascunho({});
      setAviso('Salvo. Já vale no próximo clique de quem foi afetado, sem sair e entrar.');
      await carregar();
    } catch (e) {
      setErro(e?.message || 'Não foi possível salvar. Nada foi alterado.');
    } finally {
      setSalvando(false);
    }
  };

  const padronizar = async () => {
    setConfirmarPadronizar(false); setErro('');
    try {
      const r = await padronizarAcessos({ modulo, escopo });
      setRascunho({});
      setAviso(`Pronto: ${r?.apagadas || 0} exceção(ões) apagada(s). Agora tudo segue o padrão do perfil.`);
      await carregar();
    } catch (e) {
      setErro(e?.message || 'Não foi possível padronizar.');
    }
  };

  const ligarModulo = async (m, ativo) => {
    setErro('');
    try {
      await definirModuloAtivo(m.chave, ativo, 'Central de Acessos');
      setModulos((lista) => lista.map((x) => (x.chave === m.chave ? { ...x, ativo } : x)));
    } catch (e) {
      setErro(e?.message || 'Não foi possível mudar o módulo.');
    }
  };

  const nomeModulo = (modulos.find((m) => m.chave === modulo) || {}).nome || modulo;
  const textoEscopo = tipo === 'unidade'
    ? html`Mudanças valem só em <strong>${(escopos.unidades.find((u) => `unidade:${u.chave}` === escopo) || {}).nome || ''}</strong>. Desligar uma função aqui desliga só nesta unidade.`
    : tipo === 'pessoa'
      ? html`Mudanças valem só para <strong>${(escopos.pessoas.find((p) => `pessoa:${p.id}` === escopo) || {}).nome || ''}</strong>, na coluna do perfil dela. Não reabrem função desligada.`
      : html`Você está mudando o <strong>padrão de ${nomeModulo}</strong>. Vale para todas as unidades do módulo, menos onde há exceção.`;

  return html`
    <div class="c-pagina c-acessos-pagina">
      <div class="c-pagina-cab">
        <div class="c-titulo">
          <h1>Acessos</h1>
          <p>Escolha um módulo, depois diga para quem vale a regra. O que você salvar vale na hora, sem sair e entrar de novo.</p>
        </div>
      </div>

      ${erro ? html`<div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${erro}</p></div></div>` : null}
      ${aviso ? html`<div class="c-faixa c-faixa--informacao" role="status"><${Ic} nome="check" /><div class="c-faixa-txt"><p>${aviso}</p></div></div>` : null}

      <div class="c-acessos">
        <section class="c-cartao c-acessos-mods" aria-label="Módulos">
          <div class="c-cartao-cab"><h2>Módulos</h2><span class="c-selo c-selo--neutro">${modulos.length} módulos</span></div>
          <ul class="c-acessos-mods-lista">
            ${modulos.map((m) => html`<li key=${m.chave}>
              <div class="c-acessos-mod" role="button" tabindex="0" aria-current=${m.chave === modulo ? 'true' : 'false'}
                onClick=${() => trocarModulo(m.chave)} onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trocarModulo(m.chave); } }}>
                <span class="c-acessos-mod-texto"><strong>${m.nome}</strong><small>${m.protegido ? 'Base · sempre ligado' : (m.ativo ? 'Ligado' : 'Desligado')}</small></span>
                ${m.protegido
    ? html`<span class="c-acessos-cadeado" title="Módulo base, não pode ser desligado"><${Ic} nome="lock" />Base</span>`
    : html`<label class="c-interruptor" onClick=${(e) => e.stopPropagation()}><input type="checkbox" checked=${Boolean(m.ativo)} disabled=${!podeEditar} aria-label=${`${m.nome} ligado`} onChange=${(e) => ligarModulo(m, e.target.checked)} /></label>`}
              </div>
            </li>`)}
          </ul>
          <p class="c-acessos-nota">Um módulo novo aparece nesta lista sozinho, com as 49 funções listadas. Você liga as que ele usa.</p>
        </section>

        <section class="c-cartao c-acessos-detalhe" aria-label=${`Acessos de ${nomeModulo}`}>
          <div class="c-acessos-detalhe-cab">
            <div class="c-acessos-cresce">
              <h2>${nomeModulo} ${(modulos.find((m) => m.chave === modulo) || {}).protegido ? html`<${Selo} tom="neutro">Base</${Selo}>` : html`<${Selo} tom="sucesso">Ligado</${Selo}>`}</h2>
              <p>Abra uma função para ver o que cada perfil pode fazer. A chave ao lado do nome liga ou desliga a função.</p>
            </div>
            <label class="c-campo c-acessos-vale"><span class="c-rotulo">Vale para</span>
              <select class="c-entrada" value=${escopo} onChange=${(e) => trocarEscopo(e.target.value)}>
                <option value="padrao">Todos (padrão de ${nomeModulo})</option>
                ${escopos.unidades.length ? html`<optgroup label=${`Unidades de ${nomeModulo}`}>${escopos.unidades.map((u) => html`<option key=${u.chave} value=${`unidade:${u.chave}`}>${u.tipo === 'setor' ? 'Setor' : 'Operação'} · ${u.nome}</option>`)}</optgroup>` : null}
                ${escopos.pessoas.length ? html`<optgroup label="Pessoas">${escopos.pessoas.map((p) => html`<option key=${p.id} value=${`pessoa:${p.id}`}>${p.nome} · ${p.perfil}</option>`)}</optgroup>` : null}
              </select>
            </label>
          </div>

          <div class="c-faixa c-faixa--informacao c-acessos-faixa">
            <${Ic} nome="info" />
            <div class="c-faixa-txt"><p>${textoEscopo}</p></div>
            <button type="button" class="c-botao c-botao--texto c-botao--compacto" disabled=${!podeEditar || !dados?.excecoes} onClick=${() => setConfirmarPadronizar(true)}>
              ${dados?.excecoes ? `Padronizar (${dados.excecoes} ${dados.excecoes === 1 ? 'exceção' : 'exceções'})` : 'Padronizar'}
            </button>
          </div>
          ${confirmarPadronizar ? html`<div class="c-faixa c-faixa--atencao c-acessos-faixa" role="alertdialog">
            <${Ic} nome="warning" />
            <span class="c-faixa-txt">Apagar ${dados?.excecoes} exceção(ões) deste "Vale para" e voltar ao padrão do perfil? Dá para refazer depois, uma a uma.</span>
            <button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => setConfirmarPadronizar(false)}>Cancelar</button>
            <button type="button" class="c-botao c-botao--principal c-botao--compacto" onClick=${padronizar}>Padronizar</button>
          </div>` : null}

          <div class="c-acessos-barra">
            <label class="c-com-icone c-acessos-busca"><${Ic} nome="magnifying-glass" /><input class="c-entrada" type="search" placeholder="Buscar função" aria-label="Buscar função" value=${busca} onInput=${(e) => { setBusca(e.target.value); setPagina(1); }} /></label>
            <${Segmento} rotulo="Mostrar" valor=${mostrar} aoMudar=${(v) => { setMostrar(v); setPagina(1); }}
              opcoes=${[['todas', 'Todas', funcoes.length], ['ligadas', 'Ligadas', nLigadas]]} />
            <span class="c-acessos-cresce"></span>
            <button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => {
              const fechar = visiveis.every((f) => abertas[f.id]);
              setAbertas((a) => ({ ...a, ...Object.fromEntries(visiveis.map((f) => [f.id, !fechar])) }));
            }}>${visiveis.length && visiveis.every((f) => abertas[f.id]) ? 'Fechar todas' : 'Abrir todas'}</button>
          </div>

          ${carregando && !dados ? html`<div class="c-esqueleto" aria-busy="true"></div>` : html`<ul class="c-acessos-funcoes">
            ${visiveis.length ? visiveis.map((f) => {
    const on = ligada(f);
    const aberta = Boolean(abertas[f.id]);
    const travada = f.base;
    const semChave = tipo === 'pessoa' || (tipo === 'unidade' && !f.ligada_no_modulo);
    return html`<li key=${f.id} class=${`c-acessos-funcao ${on ? '' : 'is-desligada'}`.trim()}>
                <div class="c-acessos-funcao-cab">
                  <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-expanded=${aberta ? 'true' : 'false'}
                    aria-label=${`${aberta ? 'Fechar' : 'Abrir'} ${f.nome}`} onClick=${() => setAbertas((a) => ({ ...a, [f.id]: !aberta }))}><${Ic} nome=${aberta ? 'caret-down' : 'caret-right'} /></button>
                  <button type="button" class="c-acessos-funcao-nome" onClick=${() => setAbertas((a) => ({ ...a, [f.id]: !aberta }))}>
                    <strong>${f.nome}</strong>${f.base ? html` <${Selo} tom="neutro">Base</${Selo}>` : f.futura ? html` <${Selo} tom="informacao">Futura</${Selo}>` : null}
                    <small>${on ? (f.acoes.length ? `${f.acoes.length} ${f.acoes.length === 1 ? 'ação' : 'ações'}` : (f.futura ? 'Ainda não existe no Conecta' : 'Sem ações próprias')) : (f.ligada_no_modulo ? 'Desligada nesta unidade. Nenhum perfil tem acesso.' : `Desligada em ${nomeModulo}. Nenhum perfil tem acesso.`)}</small>
                  </button>
                  ${travada ? html`<span class="c-acessos-cadeado"><${Ic} nome="lock" />Sempre ligada</span>`
    : semChave ? (tipo === 'unidade' ? html`<span class="c-acessos-cadeado" title="Ligue primeiro no padrão do módulo"><${Ic} nome="lock" />Desligada no módulo</span>` : null)
      : html`<label class="c-interruptor"><input type="checkbox" checked=${on} disabled=${!podeEditar} aria-label=${`${f.nome} ligada`} onChange=${(e) => alternar(chaveFunc(f.id), e.target.checked, f.ligada)} /></label>`}
                </div>
                ${aberta ? html`<div class="c-acessos-funcao-corpo">
                  ${f.acoes.length ? html`<div class="c-tabela-caixa c-acessos-tabela"><table class="c-tabela c-tabela--compacta">
                    <thead><tr><th scope="col">Ação</th>${perfis.map((p) => html`<th key=${p.id} scope="col">${p.nome}</th>`)}</tr></thead>
                    <tbody>${f.acoes.map((a) => html`<tr key=${a.chave}><th scope="row" title=${a.chave}>${a.nome}</th>
                      ${perfis.map((p) => {
    const v = valor(f, a, p.id);
    const original = Boolean(a.valores?.[p.id]);
    const difere = tipo !== 'padrao' && v !== Boolean(a.padrao?.[p.id]);
    const fora = tipo === 'pessoa' && p.id !== perfilPessoa;
    return html`<td key=${p.id}><button type="button" class=${`c-acessos-cel ${v ? 'is-pode' : ''} ${difere ? 'is-difere' : ''} ${rascunho[chavePerm(f.id, a.chave, p.id)] !== undefined ? 'is-alterada' : ''}`.trim()}
                          disabled=${!podeEditar || !on || fora} aria-pressed=${v ? 'true' : 'false'} aria-label=${`${f.nome}, ${a.nome}, ${p.nome}: ${v ? 'pode' : 'não pode'}`}
                          onClick=${() => alternar(chavePerm(f.id, a.chave, p.id), !v, original)}>${v ? html`<${Ic} nome="check" />` : html`<span aria-hidden="true">–</span>`}</button></td>`;
  })}
                    </tr>`)}</tbody></table></div>`
    : html`<p class="c-acessos-vazio">${f.futura ? 'Ainda não existe no Conecta. As ações aparecem aqui quando a função for criada.' : 'Esta função não tem permissões próprias: segue a Área administrativa.'}</p>`}
                </div>` : null}
              </li>`;
  }) : html`<li class="c-acessos-vazio">${busca ? 'Nenhuma função com esse nome.' : 'Nenhuma função ligada neste módulo. Clique em Todas para ver o catálogo.'}</li>`}
          </ul>`}

          ${totalPaginas > 1 ? html`<nav class="c-acessos-paginas" aria-label="Páginas de funções">
            <span class="c-acessos-cresce">${inicio + 1}–${Math.min(inicio + POR_PAGINA, filtradas.length)} de ${filtradas.length} funções</span>
            <button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${paginaAtual === 1} aria-label="Página anterior" onClick=${() => setPagina(paginaAtual - 1)}>‹</button>
            ${Array.from({ length: totalPaginas }, (_, i) => i + 1).map((n) => html`<button key=${n} type="button" class=${`c-botao c-botao--compacto ${n === paginaAtual ? 'c-botao--principal' : 'c-botao--secundario'}`} aria-current=${n === paginaAtual ? 'page' : null} onClick=${() => setPagina(n)}>${n}</button>`)}
            <button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${paginaAtual === totalPaginas} aria-label="Próxima página" onClick=${() => setPagina(paginaAtual + 1)}>›</button>
          </nav>` : null}

          <div class="c-acessos-salvar">
            <span class="c-acessos-cresce">${pendentes ? `${pendentes} ${pendentes === 1 ? 'mudança' : 'mudanças'} sem salvar` : 'Nenhuma mudança.'}</span>
            <button type="button" class="c-botao c-botao--secundario" disabled=${!pendentes || salvando} onClick=${() => { setRascunho({}); setErro(''); }}>Desfazer</button>
            <button type="button" class="c-botao c-botao--principal" disabled=${!pendentes || salvando || !podeEditar} onClick=${salvar}>${salvando ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </section>
      </div>
    </div>
  `;
}
