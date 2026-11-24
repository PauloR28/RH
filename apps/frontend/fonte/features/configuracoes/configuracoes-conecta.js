// Configurações do Conecta (reestruturação, Etapa 7 — amostra aprovada em 17/nov/2026).
// Uma página só, com seções na lateral. Cada seção abre a tela que já existia (mesmo conteúdo, mesmo endereço);
// o que muda é o lugar: as telas saem do menu e passam a viver aqui. Peças c- e tokens do rebranding.
import { html } from '../../infraestrutura-react.js?v=20261124-equipes4';
import { Ic, Segmento } from '../../ui/components/ds.js?v=20261124-equipes4';

// Entrada única no menu (Tecnologia › Administração › Configurações). Abre a 1ª seção que a pessoa pode ver.
export const TELA_CONFIGURACOES_CONECTA = 'screen-settings-conecta';

// Catálogos: listas usadas nas telas do Conecta, uma aba por lista.
export const ABAS_CATALOGOS = [
  { tela: 'screen-settings-etapas', label: 'Etapas do processo' },
  { tela: 'screen-settings-motivos-eliminacao', label: 'Motivos de eliminação' },
  { tela: 'screen-settings-modelos-email', label: 'Modelos de e-mail' },
];

export const SECOES_CONFIGURACOES = [
  { id: 'seguranca', label: 'Segurança', descricao: 'Senha, inatividade e sessão', icone: 'shield-check', telas: ['screen-settings-seguranca'] },
  { id: 'inicio', label: 'Início dos módulos', descricao: 'O que cada perfil vê ao entrar', icone: 'house', telas: ['screen-settings-inicio'] },
  { id: 'logs', label: 'Logs', descricao: 'Acesso, alterações, erros, APIs', icone: 'clock-counter-clockwise', telas: ['screen-settings-logs', 'screen-settings-monitoria-logs'] },
  { id: 'backup', label: 'Backup', descricao: 'Situação, avisos e registro', icone: 'hard-drives', telas: ['screen-settings-backup'] },
  { id: 'notificacoes', label: 'Notificações', descricao: 'Tipos, som e navegador', icone: 'bell', telas: ['screen-settings-notifications'] },
  { id: 'integracoes', label: 'Integrações', descricao: 'Microsoft 365, SharePoint, e-mail', icone: 'link', telas: ['screen-settings-administracao', 'screen-settings-sharepoint-ambiente'] },
  { id: 'lgpd', label: 'LGPD', descricao: 'Políticas e retenção', icone: 'scales', telas: ['screen-settings-lgpd'] },
  { id: 'ajuda', label: 'Central de Ajuda', descricao: 'Conteúdo, arquivos, base', icone: 'book-open', telas: ['screen-settings-document-templates'] },
  { id: 'catalogos', label: 'Catálogos', descricao: 'Etapas, motivos, modelos', icone: 'list-checks', telas: ABAS_CATALOGOS.map((aba) => aba.tela) },
];

export const TELAS_CONFIGURACOES_CONECTA = new Set(SECOES_CONFIGURACOES.flatMap((secao) => secao.telas));

const podeAbrir = (controlador, tela) => controlador?.podeAcessarTela?.(tela) !== false;

/** Telas que a pessoa pode abrir em cada seção (a seção some quando não sobra nenhuma). */
function secoesVisiveis(controlador) {
  return SECOES_CONFIGURACOES
    .map((secao) => ({ ...secao, abriveis: secao.telas.filter((tela) => podeAbrir(controlador, tela)) }))
    .filter((secao) => secao.abriveis.length);
}

/** Primeira tela que a pessoa pode abrir nas Configurações (destino da entrada do menu). */
export function primeiraTelaConfiguracoes(controlador) {
  return secoesVisiveis(controlador)[0]?.abriveis[0] || '';
}

/** Moldura da página: seções na lateral e a tela da seção ao lado. Usada pelo PainelRh nas telas da lista acima. */
export function MolduraConfiguracoes({ controlador, telaAtual, children }) {
  const secoes = secoesVisiveis(controlador);
  const atual = secoes.find((secao) => secao.telas.includes(telaAtual));
  const abrir = (tela) => { if (tela && tela !== telaAtual) controlador.irParaTelaProtegida(tela); };
  const abasCatalogo = atual?.id === 'catalogos' ? ABAS_CATALOGOS.filter((aba) => podeAbrir(controlador, aba.tela)) : [];
  return html`
    <div class="c-cfg-topo">
      <h1>Configurações do Conecta</h1>
      <p>Tudo que vale para o Conecta inteiro, num lugar só.</p>
    </div>
    <div class="c-acessos c-cfg-pagina">
      <nav class="c-cartao c-acessos-mods" aria-label="Seções das configurações">
        <div class="c-cartao-cab"><h2>Seções</h2></div>
        <ul class="c-acessos-mods-lista">
          ${secoes.map((secao) => html`<li key=${secao.id}>
            <a class="c-acessos-mod c-cfg-secao" href="#" aria-current=${secao === atual ? 'page' : 'false'}
              onClick=${(e) => { e.preventDefault(); abrir(secao.abriveis[0]); }}>
              <${Ic} nome=${secao.icone} />
              <span class="c-acessos-mod-texto"><strong>${secao.label}</strong><small>${secao.descricao}</small></span>
            </a>
          </li>`)}
        </ul>
        <p class="c-acessos-nota">Segredos (senhas, chaves) ficam no servidor. Aqui só aparece "configurado" e o botão Testar.</p>
      </nav>
      <div class="c-cfg-conteudo">
        ${abasCatalogo.length > 1 ? html`<div class="c-cfg-abas">
          <${Segmento} rotulo="Catálogos" opcoes=${abasCatalogo.map((aba) => [aba.tela, aba.label])} valor=${telaAtual} aoMudar=${abrir} />
        </div>` : null}
        ${children}
      </div>
    </div>
  `;
}
