// Bloco "Módulos" (16/nov/2026, amostra aprovada pelo Paulo): liga/desliga de cada módulo no cadastro do usuário
// (Perfis e Permissões saiu na Etapa 10, nov/2026: o perfil abre o módulo pelas funções marcadas em Acessos). Dobrável para poupar espaço. Ligar só põe o módulo no
// seletor do topo; as telas dentro dele seguem as permissões do perfil. Módulo desligado no Conecta fica travado.
import { html } from '../../infraestrutura-react.js?v=20261126-painel-relatorios';
import { Selo } from '../../ui/components/ds.js?v=20261126-painel-relatorios';

function linhaPessoa(item, valor, nomePerfil) {
  if (!item.ativo) return { texto: 'Desligado em Configurações › Módulos. Vale para todos.', selo: ['neutro', 'Desligado'] };
  if (item.travado) return { texto: 'O perfil administra a Tecnologia: não pode ser tirado.', selo: ['neutro', 'Pelo perfil'] };
  if (valor && item.do_perfil) return { texto: `Vem do perfil ${nomePerfil}`, selo: ['neutro', 'Pelo perfil'] };
  if (valor) return { texto: 'Liberado só para esta pessoa', selo: ['informacao', 'Só a pessoa'] };
  if (item.do_perfil) return { texto: 'O perfil dá, mas foi tirado só desta pessoa', selo: ['atencao', 'Tirado'] };
  return { texto: `Fora do perfil ${nomePerfil}`, selo: null };
}

export function BlocoModulos({ itens = [], valores = {}, aoMudar, desabilitado = false, nomePerfil = '', carregando = false, erro = '' }) {
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
        const info = linhaPessoa(m, valor, nomePerfil);
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
    <span class="c-ajuda">Ligar libera o módulo no seletor do topo. As telas dentro dele continuam seguindo as permissões do perfil.</span>
  </details>`;
}

// Só o que mudou em relação ao que veio do servidor (evita gravar exceção à toa).
export function mudancasModulos(itens = [], valores = {}) {
  const saida = {};
  itens.forEach((m) => { if (Boolean(valores[m.chave]) !== Boolean(m.valor)) saida[m.chave] = Boolean(valores[m.chave]); });
  return saida;
}

export const valoresDosModulos = (itens = []) => Object.fromEntries(itens.map((m) => [m.chave, Boolean(m.valor)]));
