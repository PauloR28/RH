import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { ModalPadrao } from '../../ui/componentes-compartilhados.js';
import { escolherDesignOperacao, lerContextoMonitoria, trocarSenhaInicial } from '../../services/api/monitoria.js';
import { salvarSessaoAutenticacao } from '../../services/api/core.js';
import { definirTemaOperacao, limparTemaOperacao } from '../../shared/tema-operacao.js';

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

export function TrocaSenhaObrigatoria({ controlador }) {
  const [aberto, setAberto] = useState(() => Boolean(controlador.estado.autenticado && controlador.estado.exigeTrocaSenha));
  const [f, setF] = useState({ senha_atual: '', nova_senha: '', confirmar: '' });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const abrir = () => setAberto(true);
    window.addEventListener(EVENTO_TROCA_SENHA, abrir);
    return () => window.removeEventListener(EVENTO_TROCA_SENHA, abrir);
  }, []);

  if (!aberto || !controlador.estado.autenticado) return null;
  const invalido = f.nova_senha.length < 8 || f.nova_senha !== f.confirmar || !f.senha_atual;
  const trocar = async () => {
    setSalvando(true);
    setErro('');
    try {
      const sessao = await trocarSenhaInicial({ senha_atual: f.senha_atual, nova_senha: f.nova_senha });
      salvarSessaoAutenticacao(sessao.access_token, sessao);
      window.location.reload();
    } catch (e) {
      setErro(e?.message || 'Não foi possível trocar a senha.');
    } finally {
      setSalvando(false);
    }
  };
  return html`
    <${ModalPadrao} aberto=${true} ocultarFechar=${true} titulo="Defina sua nova senha" subtitulo="Este é o seu primeiro acesso: a senha inicial precisa ser trocada para liberar o Conecta." onClose=${() => null}>
      <div class="mon-shell">
        <label>Senha atual (inicial)<input class="form-control" type="password" autocomplete="current-password" value=${f.senha_atual} onInput=${(e) => setF({ ...f, senha_atual: e.target.value })} /></label>
        <label>Nova senha (mínimo de 8 caracteres)<input class="form-control" type="password" autocomplete="new-password" value=${f.nova_senha} onInput=${(e) => setF({ ...f, nova_senha: e.target.value })} /></label>
        <label>Confirmar nova senha<input class="form-control" type="password" autocomplete="new-password" value=${f.confirmar} onInput=${(e) => setF({ ...f, confirmar: e.target.value })} /></label>
        ${f.confirmar && f.confirmar !== f.nova_senha ? html`<div class="mon-alerta">As senhas não conferem.</div>` : null}
        ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>` : null}
        <div class="mon-acoes-fixas"><button type="button" class="btn btn-primary" disabled=${invalido || salvando} onClick=${trocar}>${salvando ? 'Salvando…' : 'Trocar senha e continuar'}</button></div>
      </div>
    </${ModalPadrao}>`;
}
