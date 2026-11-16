// Bloco "Módulos" (16/nov/2026, amostra aprovada pelo Paulo): liga/desliga de cada módulo no cadastro do usuário
// (modo 'pessoa') e em Perfis e Permissões (modo 'perfil'). Dobrável para poupar espaço. Ligar só põe o módulo no
// seletor do topo; as telas dentro dele seguem as permissões do perfil. Módulo desligado no Conecta fica travado.
import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { Selo } from '../../ui/components/ds.js';

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function linhaPessoa(item, valor, nomePerfil) {
  if (!item.ativo) return { texto: 'Desligado em Configurações › Módulos. Vale para todos.', selo: ['neutro', 'Desligado'] };
  if (item.travado) return { texto: 'O perfil administra a Tecnologia: não pode ser tirado.', selo: ['neutro', 'Pelo perfil'] };
  if (valor && item.do_perfil) return { texto: `Vem do perfil ${nomePerfil}`, selo: ['neutro', 'Pelo perfil'] };
  if (valor) return { texto: 'Liberado só para esta pessoa', selo: ['informacao', 'Só a pessoa'] };
  if (item.do_perfil) return { texto: 'O perfil dá, mas foi tirado só desta pessoa', selo: ['atencao', 'Tirado'] };
  return { texto: `Fora do perfil ${nomePerfil}`, selo: null };
}

function linhaPerfil(item, valor) {
  if (!item.ativo) return { texto: 'Desligado em Configurações › Módulos. Vale para todos.', selo: ['neutro', 'Desligado'] };
  if (item.travado) return { texto: 'Este perfil administra a Tecnologia: não pode ser tirado.', selo: null };
  const base = valor === item.pelas_permissoes
    ? (valor ? 'Abre pelas permissões do perfil' : 'Fora das permissões do perfil')
    : (valor ? 'Liberado para o perfil todo' : 'Tirado do perfil todo');
  const extra = item.pessoas_com_excecao ? ` · ${plural(item.pessoas_com_excecao, 'pessoa tem', 'pessoas têm')} por exceção` : '';
  return { texto: base + extra, selo: valor !== item.pelas_permissoes ? ['informacao', 'Exceção do perfil'] : null };
}

export function BlocoModulos({ modo = 'pessoa', itens = [], valores = {}, aoMudar, desabilitado = false, nomePerfil = '', carregando = false, erro = '' }) {
  const ligados = itens.filter((m) => m.ativo && valores[m.chave]).map((m) => m.nome);
  const resumo = carregando ? 'Carregando…' : erro ? 'Não foi possível carregar' : (ligados.length ? ligados.join(', ') : 'Nenhum módulo');
  return html`<details class="c-modulos-acesso">
    <summary>
      <span class="c-rotulo">Módulos</span>
      <span class="c-modulos-resumo">${resumo}</span>
    </summary>
    ${erro ? html`<p class="c-erro">${erro}</p>` : html`<ul>
      ${itens.map((m) => {
        const valor = Boolean(valores[m.chave]);
        const info = modo === 'perfil' ? linhaPerfil(m, valor) : linhaPessoa(m, valor, nomePerfil);
        const travado = desabilitado || !m.ativo || (m.travado && valor);
        return html`<li key=${m.chave} aria-disabled=${!m.ativo ? 'true' : null}>
          <span class="c-mod-nome"><strong>${m.nome}</strong><small>${info.texto}</small></span>
          <span class="c-grupo">
            ${info.selo ? html`<${Selo} tom=${info.selo[0]}>${info.selo[1]}<//>` : null}
            <label class="c-interruptor">
              <input type="checkbox" role="switch" aria-label=${m.nome} checked=${valor} disabled=${travado || null}
                onChange=${() => aoMudar?.({ ...valores, [m.chave]: !valor })} />
            </label>
          </span>
        </li>`;
      })}
    </ul>`}
    <span class="c-ajuda">${modo === 'perfil'
      ? 'Vale para todas as pessoas deste perfil. A exceção de uma pessoa (no cadastro dela) vence a do perfil. Módulo desligado no Conecta vence tudo.'
      : 'Ligar libera o módulo no seletor do topo. As telas dentro dele continuam seguindo as permissões do perfil.'}</span>
  </details>`;
}

// Só o que mudou em relação ao que veio do servidor (evita gravar exceção à toa).
export function mudancasModulos(itens = [], valores = {}) {
  const saida = {};
  itens.forEach((m) => { if (Boolean(valores[m.chave]) !== Boolean(m.valor)) saida[m.chave] = Boolean(valores[m.chave]); });
  return saida;
}

export const valoresDosModulos = (itens = []) => Object.fromEntries(itens.map((m) => [m.chave, Boolean(m.valor)]));

// Perfis e Permissões: bloco no topo do perfil, com salvar próprio (não mistura com o salvar das permissões).
export function ModulosDoPerfil({ perfilId, podeEditar = false, lerModulos, salvarModulos }) {
  const [estado, setEstado] = useState({ itens: [], valores: {}, pessoas: 0, carregando: true, erro: '' });
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState('');
  const carregar = () => {
    if (!perfilId) return () => {};
    let vivo = true;
    setEstado((a) => ({ ...a, carregando: true, erro: '' }));
    lerModulos(perfilId)
      .then((d) => { if (vivo) setEstado({ itens: d?.modulos || [], valores: valoresDosModulos(d?.modulos), pessoas: d?.pessoas || 0, carregando: false, erro: '' }); })
      .catch((e) => { if (vivo) setEstado({ itens: [], valores: {}, pessoas: 0, carregando: false, erro: e?.message || 'Não foi possível carregar os módulos.' }); });
    return () => { vivo = false; };
  };
  useEffect(() => { setAviso(''); return carregar(); }, [perfilId]);
  const mudancas = mudancasModulos(estado.itens, estado.valores);
  const temMudanca = Object.keys(mudancas).length > 0;
  const salvar = async () => {
    setSalvando(true); setAviso('');
    try {
      const d = await salvarModulos(perfilId, mudancas, 'Módulos alterados em Perfis e Permissões.');
      setEstado({ itens: d?.modulos || [], valores: valoresDosModulos(d?.modulos), pessoas: d?.pessoas || 0, carregando: false, erro: '' });
      setAviso('Módulos do perfil salvos. Vale no próximo clique de cada pessoa.');
    } catch (e) {
      setAviso(e?.message || 'Não foi possível salvar os módulos.');
    } finally {
      setSalvando(false);
    }
  };
  return html`<div class="c-modulos-perfil">
    <${BlocoModulos} modo="perfil" itens=${estado.itens} valores=${estado.valores} desabilitado=${!podeEditar || salvando}
      aoMudar=${(valores) => setEstado((a) => ({ ...a, valores }))} carregando=${estado.carregando} erro=${estado.erro} />
    ${temMudanca || aviso
      ? html`<div class="c-grupo c-grupo--fim">
          ${aviso ? html`<span class="c-ajuda" role="status">${aviso}</span>` : null}
          ${temMudanca ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" disabled=${salvando || null} onClick=${() => setEstado((a) => ({ ...a, valores: valoresDosModulos(a.itens) }))}>Desfazer</button>
            <button type="button" class="c-botao c-botao--principal c-botao--compacto" disabled=${salvando || null} onClick=${salvar}>${salvando ? 'Salvando…' : 'Salvar módulos'}</button>` : null}
        </div>`
      : null}
  </div>`;
}
