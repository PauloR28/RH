// Configurações do Conecta › Início dos módulos (reestruturação, Etapa 8 — amostra aprovada em 17/nov/2026).
// Um lugar só para os 3 módulos: o que cada perfil vê quando entra em cada módulo. Só esconde ou muda a ordem; um bloco
// ou atalho que o perfil não pode abrir continua escondido, mesmo ligado aqui. Substitui a aba "Tela inicial" que
// ficava em Perfis e Permissões.
import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js?v=20261124-equipes4';
import { PainelRh } from '../../ui/componentes-compartilhados.js?v=20261124-equipes4';
import { Ic, Segmento } from '../../ui/components/ds.js?v=20261124-equipes4';
import { listarPerfis } from '../../services/api/settings.js?v=20261124-equipes4';
import {
  ATALHOS_POR_MODULO,
  BLOCOS_POR_MODULO,
  MODULOS_INICIO,
  PERFIS_INICIO_POR_SESSOES,
  atalhosDoInicioPorPerfil,
  configTelaInicialPadrao,
  listarTelaInicialPerfis,
  salvarTelaInicialPerfil,
} from '../../shared/tela-inicial.js?v=20261124-equipes4';

const NOTA_PERMISSAO = 'Só esconde ou muda a ordem. Um bloco que o perfil não pode abrir (sem acesso à função) continua escondido, mesmo ligado aqui.';
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function Bloco({ titulo, icone, children }) {
  return html`<section class="c-cfg-bloco"><h3>${icone ? html`<${Ic} nome=${icone} />` : null}${titulo}</h3>${children}</section>`;
}

function Interruptor({ ligado, rotulo, desabilitado, aoMudar }) {
  return html`<label class="c-interruptor"><input type="checkbox" checked=${ligado} disabled=${desabilitado} aria-label=${rotulo} onChange=${aoMudar} /></label>`;
}

/** Como o Início deste perfil é montado neste módulo: 'blocos' (tabela de blocos + atalhos), 'atalhos' (só atalhos). */
function formato(modulo, perfilId) {
  if (modulo === 'rh') return PERFIS_INICIO_POR_SESSOES.has(perfilId) ? 'atalhos' : 'blocos';
  if (modulo === 'operacao' && perfilId === 'operador') return 'atalhos';
  return 'blocos';
}

function atalhosDisponiveis(modulo, perfil) {
  if (modulo === 'rh') return atalhosDoInicioPorPerfil(perfil.id, perfil.permissoes || []).map((a) => ({ id: a.id, label: a.label }));
  if (modulo === 'operacao' && perfil.id === 'operador') return atalhosDoInicioPorPerfil('operador', perfil.permissoes || []).map((a) => ({ id: a.id, label: a.label }));
  return ATALHOS_POR_MODULO[modulo] || [];
}

export function TelaInicioModulos({ controlador }) {
  const podeEditar = controlador.possuiPermissao('configuracoes.editar');
  const [dados, setDados] = useState(null);
  const [perfis, setPerfis] = useState([]);
  const [modulo, setModulo] = useState('operacao');
  const [perfilId, setPerfilId] = useState('');
  const [copiando, setCopiando] = useState(false);
  const [draft, setDraft] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState({ tipo: '', texto: '' });

  useEffect(() => {
    let ativo = true;
    Promise.all([listarTelaInicialPerfis(), listarPerfis()])
      .then(([cfg, lista]) => {
        if (!ativo) return;
        const ps = (Array.isArray(lista) ? lista : lista?.perfis || []).filter((p) => p.id !== 'candidato');
        setDados(cfg || {});
        setPerfis(ps);
        setPerfilId((atual) => atual || ps.find((p) => p.id === 'gestor')?.id || ps[0]?.id || '');
      })
      .catch((erro) => { if (ativo) setMensagem({ tipo: 'erro', texto: erro?.message || 'Não foi possível carregar o Início dos módulos.' }); });
    return () => { ativo = false; };
  }, []);

  const perfil = perfis.find((p) => p.id === perfilId) || null;
  const salvoDe = (id, mod) => {
    const salvo = dados?.perfis?.[id];
    const parte = salvo?.modulos?.[mod];
    const padrao = dados?.padroes?.[mod] || configTelaInicialPadrao(mod);
    // Ainda não configurado neste módulo: os atalhos escondidos no formato antigo continuam valendo (mesma regra do Início).
    const ocultos = parte?.personalizado ? parte.atalhos_ocultos : salvo?.atalhos_ocultos;
    return { blocos: (parte?.blocos || padrao.blocos).map((b) => ({ id: b.id, visivel: Boolean(b.visivel) })), atalhos_ocultos: [...(ocultos || [])] };
  };
  const original = useMemo(() => (perfilId && dados ? salvoDe(perfilId, modulo) : null), [dados, perfilId, modulo]);
  useEffect(() => { setDraft(original); setCopiando(false); }, [original]);
  useEffect(() => { setMensagem({ tipo: '', texto: '' }); }, [perfilId, modulo]);

  const alterado = draft && original && !igual(draft, original);
  const forma = formato(modulo, perfilId);
  const catalogo = new Map((BLOCOS_POR_MODULO[modulo] || []).map((b) => [b.id, b]));
  const temPermissao = (bloco) => !bloco?.permissao || (perfil?.permissoes || []).includes(bloco.permissao);
  const atalhos = perfil ? atalhosDisponiveis(modulo, perfil) : [];

  const mover = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= draft.blocos.length) return;
    const blocos = draft.blocos.slice();
    [blocos[i], blocos[j]] = [blocos[j], blocos[i]];
    setDraft({ ...draft, blocos });
  };
  const alternarBloco = (i) => setDraft({ ...draft, blocos: draft.blocos.map((b, k) => (k === i ? { ...b, visivel: !b.visivel } : b)) });
  const alternarAtalho = (id) => setDraft({ ...draft, atalhos_ocultos: draft.atalhos_ocultos.includes(id) ? draft.atalhos_ocultos.filter((x) => x !== id) : [...draft.atalhos_ocultos, id] });
  const copiarDe = (id) => { if (id) { setDraft(salvoDe(id, modulo)); setCopiando(false); } };

  const salvar = async () => {
    setOcupado(true);
    setMensagem({ tipo: '', texto: '' });
    try {
      const r = await salvarTelaInicialPerfil(perfilId, draft.blocos, draft.atalhos_ocultos, modulo);
      setDados((atual) => ({ ...(atual || {}), perfis: { ...(atual?.perfis || {}), [perfilId]: { ...(atual?.perfis?.[perfilId] || {}), modulos: r.modulos } } }));
      setMensagem({ tipo: 'ok', texto: 'Início salvo. Vale no próximo acesso das pessoas deste perfil.' });
    } catch (erro) {
      setMensagem({ tipo: 'erro', texto: erro?.message || 'Não foi possível salvar.' });
    } finally {
      setOcupado(false);
    }
  };

  const nomeModulo = MODULOS_INICIO.find(([id]) => id === modulo)?.[1] || modulo;
  return html`
    <${PainelRh} screenId="screen-settings-inicio" navAtiva="screen-settings-inicio" controlador=${controlador} placeholderBusca="Início dos módulos">
      <section class="c-cartao c-cfg-cartao" aria-label="Início dos módulos">
        <header><h2>Início dos módulos</h2><p>O que cada perfil vê quando entra em cada módulo. Um lugar só para os 3 módulos.</p></header>
        ${mensagem.texto ? html`<div class=${`c-faixa c-faixa--${mensagem.tipo === 'erro' ? 'perigo' : 'informacao'}`} role=${mensagem.tipo === 'erro' ? 'alert' : 'status'}><div class="c-faixa-txt"><p>${mensagem.texto}</p></div></div>` : null}
        ${!dados ? null : html`
          <${Bloco} titulo="Para quem" icone="users">
            <div class="c-cfg-par" style=${{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              <div class="c-campo"><span class="c-rotulo">Módulo</span>
                <${Segmento} rotulo="Módulo" opcoes=${MODULOS_INICIO} valor=${modulo} aoMudar=${setModulo} /></div>
              <label class="c-campo"><span class="c-rotulo">Perfil</span>
                <select class="c-entrada" value=${perfilId} onChange=${(e) => setPerfilId(e.target.value)}>
                  ${perfis.map((p) => html`<option key=${p.id} value=${p.id}>${p.nome}</option>`)}
                </select></label>
              <div class="c-campo"><span class="c-rotulo">Começar de</span>
                ${copiando ? html`<select class="c-entrada" aria-label="Copiar de qual perfil" value="" onChange=${(e) => copiarDe(e.target.value)}>
                    <option value="">Escolha o perfil…</option>
                    ${perfis.filter((p) => p.id !== perfilId && formato(modulo, p.id) === forma).map((p) => html`<option key=${p.id} value=${p.id}>${p.nome}</option>`)}
                  </select>`
                  : html`<button type="button" class="c-botao c-botao--secundario" disabled=${!podeEditar} onClick=${() => setCopiando(true)}><${Ic} nome="copy" />Copiar de outro perfil</button>`}
              </div>
            </div>
          </${Bloco}>
          ${draft && forma === 'blocos' ? html`
            <${Bloco} titulo=${`Blocos do Início · ${nomeModulo} · ${perfil?.nome || ''}`} icone="squares-four">
              <div class="c-tabela-caixa"><table class="c-tabela c-tabela--compacta">
                <thead><tr><th scope="col" class="c-num">Ordem</th><th scope="col">Bloco</th><th scope="col">Aparece</th><th scope="col"><span class="c-oculto">Mover</span></th></tr></thead>
                <tbody>${draft.blocos.map((item, i) => {
                  const bloco = catalogo.get(item.id);
                  if (!bloco) return null;
                  return html`<tr key=${item.id}>
                    <td class="c-num">${i + 1}</td>
                    <td><span class="c-forte">${bloco.label}</span>${!temPermissao(bloco) ? html`<br /><small class="c-secundario">Sem acesso à função neste perfil: não aparece.</small>` : null}</td>
                    <td><${Interruptor} ligado=${item.visivel} rotulo=${bloco.label} desabilitado=${!podeEditar} aoMudar=${() => alternarBloco(i)} /></td>
                    <td class="c-grupo">
                      <button type="button" class="c-botao c-botao--texto" aria-label=${`Subir ${bloco.label}`} disabled=${!podeEditar || i === 0} onClick=${() => mover(i, -1)}><${Ic} nome="caret-up" /></button>
                      <button type="button" class="c-botao c-botao--texto" aria-label=${`Descer ${bloco.label}`} disabled=${!podeEditar || i === draft.blocos.length - 1} onClick=${() => mover(i, 1)}><${Ic} nome="caret-down" /></button>
                    </td>
                  </tr>`;
                })}</tbody>
              </table></div>
              <small class="c-secundario">${NOTA_PERMISSAO}</small>
            </${Bloco}>` : null}
          ${draft && forma === 'atalhos' ? html`<div class="c-faixa c-faixa--informacao" role="note"><${Ic} nome="info" /><div class="c-faixa-txt"><p>
            ${perfil?.nome || 'Este perfil'} tem um Início próprio neste módulo. Aqui só se escolhe quais atalhos aparecem.</p></div></div>` : null}
          ${draft && (modulo !== 'rh' || forma === 'atalhos') ? html`
            <${Bloco} titulo="Acessos rápidos" icone="lightning">
              ${atalhos.length ? html`<div class="c-atalhos">${atalhos.map((a) => html`<label key=${a.id} class="c-atalho">
                <${Interruptor} ligado=${!draft.atalhos_ocultos.includes(a.id)} rotulo=${a.label} desabilitado=${!podeEditar} aoMudar=${() => alternarAtalho(a.id)} />${a.label}</label>`)}</div>`
                : html`<small class="c-secundario">Nenhuma área liberada para este perfil: o Início fica sem atalhos.</small>`}
              <small class="c-secundario">Desligar só tira o atalho do Início. A pessoa continua abrindo pelo menu, se tiver acesso.</small>
            </${Bloco}>` : null}
          <div class="c-cfg-rodape">
            <span class="c-secundario">${alterado ? 'Mudanças não salvas.' : 'Nenhuma mudança.'}</span>
            ${podeEditar ? html`
              <button type="button" class="c-botao c-botao--secundario" disabled=${ocupado || !draft} onClick=${() => setDraft({ blocos: (dados?.padroes?.[modulo] || configTelaInicialPadrao(modulo)).blocos.map((b) => ({ id: b.id, visivel: Boolean(b.visivel) })), atalhos_ocultos: [] })}>
                <${Ic} nome="arrow-counter-clockwise" />Voltar ao padrão</button>
              <button type="button" class="c-botao c-botao--principal" disabled=${!alterado || ocupado} onClick=${salvar}>
                <${Ic} nome="floppy-disk" />${ocupado ? 'Salvando...' : 'Salvar'}</button>` : null}
          </div>
        `}
      </section>
    </${PainelRh}>
  `;
}
