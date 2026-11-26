import { html, useEffect, useState } from '../../infraestrutura-react.js?v=20261126-senha';
import { ModalPadrao } from '../../ui/componentes-compartilhados.js?v=20261126-senha';
import { escolherDesignOperacao, lerContextoMonitoria, trocarSenhaInicial } from '../../services/api/monitoria.js?v=20261126-senha';
import { salvarSessaoAutenticacao } from '../../services/api/core.js?v=20261126-senha';
import { CrieSuaSenha } from '../acesso/senha.js?v=20261126-senha';
import { definirTemaOperacao, limparTemaOperacao } from '../../shared/tema-operacao.js?v=20261126-senha';

// Peças GLOBAIS da vertente Monitoria (montadas uma vez na raiz do app):
//  * tema/logo por operação;
//  * escolha única de design para quem tem 2+ operações;
//  * troca obrigatória da senha inicial (primeiro acesso).

export const EVENTO_TROCA_SENHA = 'conecta-troca-senha-obrigatoria';

export function TemaOperacao({ controlador }) {
  const autenticado = controlador.estado.autenticado && !controlador.estado.validandoSessao;
  const temAcesso = controlador.possuiPermissao('monitoria.visualizar') || controlador.possuiPermissao('monitoria.dashboard');
  const [ctx, setCtx] = useState(null);
  const [escolhendo, setEscolhendo] = useState(false);
  const [ocultarSessao, setOcultarSessao] = useState(false);

  useEffect(() => {
    if (!autenticado || !temAcesso) {
      limparTemaOperacao();
      setCtx(null);
      return undefined;
    }
    let ativo = true;
    lerContextoMonitoria()
      .then((c) => {
        if (!ativo) return;
        setCtx(c);
        // Perfis globais (Administrador, Gestor, Control Desk) não têm tema por operação.
        const ops = c.global ? [] : c.operacoes || [];
        if (ops.length === 1) definirTemaOperacao(ops[0].cor_primaria || ops[0].logo_url ? ops[0] : null);
        else if (ops.length > 1) {
          const escolhida = ops.find((o) => o.chave === c.vinculos?.tema_operacao);
          definirTemaOperacao(escolhida || null);
          if (!c.vinculos?.tema_alterado) setEscolhendo(true);
        } else limparTemaOperacao();
      })
      .catch(() => limparTemaOperacao());
    return () => {
      ativo = false;
    };
  }, [autenticado, temAcesso]);

  const escolher = async (operacao) => {
    try {
      await escolherDesignOperacao(operacao);
      const ops = ctx?.operacoes || [];
      definirTemaOperacao(ops.find((o) => o.chave === operacao) || null);
      setEscolhendo(false);
    } catch (e) {
      window.alert(e?.message || 'Não foi possível salvar a escolha.');
    }
  };

  if (!escolhendo || ocultarSessao || !ctx) return null;
  return html`
    <${ModalPadrao} aberto=${true} titulo="Escolha o design do seu ambiente" subtitulo="Você trabalha em mais de uma operação. A escolha pode ser feita uma única vez (o Administrador pode liberar uma nova)." onClose=${() => setOcultarSessao(true)}>
      <div class="mon-shell">
        <div class="mon-acoes">
          ${ctx.operacoes.map((o) => html`<button key=${o.chave} type="button" class="btn btn-outline-primary" onClick=${() => escolher(o.chave)}>
            <span class="mon-cor-amostra" style=${{ background: o.cor_primaria || '#0a4b8c' }}></span> ${o.nome}</button>`)}
          <button type="button" class="btn btn-outline-secondary" onClick=${() => escolher('')}>Padrão do Conecta</button>
        </div>
        <p class="mon-muted">Todos os dados das suas operações continuam juntos, cada um identificado por tag e filtrável por operação. Você pode decidir depois: o aviso volta no próximo acesso.</p>
      </div>
    </${ModalPadrao}>`;
}

// Senha temporária (admin) ou provisória (supervisor): tela "Crie a sua senha" no desenho do login, antes de qualquer
// outra tela (fluxo de senha aprovado em 26/11/2026). Não pede a senha atual: a pessoa acabou de entrar com ela.
export function TrocaSenhaObrigatoria({ controlador }) {
  const [aberto, setAberto] = useState(() => Boolean(controlador.estado.autenticado && controlador.estado.exigeTrocaSenha));

  useEffect(() => {
    const abrir = () => setAberto(true);
    window.addEventListener(EVENTO_TROCA_SENHA, abrir);
    return () => window.removeEventListener(EVENTO_TROCA_SENHA, abrir);
  }, []);

  if (!aberto || !controlador.estado.autenticado) return null;
  const salvar = async (novaSenha) => {
    const sessao = await trocarSenhaInicial({ senha_atual: '', nova_senha: novaSenha });
    salvarSessaoAutenticacao(sessao.access_token, sessao);
    window.location.reload();
  };
  return html`<${CrieSuaSenha} aoSalvar=${salvar} aoSair=${() => { setAberto(false); controlador.sair(); }} />`;
}
