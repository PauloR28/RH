// Bloco Senha do cadastro de usuário (fluxo de senha, amostra aprovada em 26/11/2026, quadro 6).
// Criando: senha temporária já sugerida. Editando: botão "Redefinir senha" acima do selo; ao clicar, abre a senha
// temporária com Copiar, Gerar outra e Cancelar. Ao salvar, a pessoa troca a senha no próximo acesso (vale 7 dias).
import { html, useEffect, useState } from '../../infraestrutura-react.js?v=20261126-senha';
import { Ic, Selo } from '../../ui/components/ds.js?v=20261126-senha';
import { sugerirSenhaTemporaria } from '../../services/api/settings.js?v=20261126-senha';
import { RegrasSenha } from '../acesso/senha.js?v=20261126-senha';

export function BlocoSenhaUsuario({ criando, possuiSenha, nome = '', valor, aoMudar }) {
  const [aberto, setAberto] = useState(Boolean(criando || valor));
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState('');

  const gerar = async () => {
    setErro('');
    try {
      const r = await sugerirSenhaTemporaria();
      aoMudar(r?.senha || '');
    } catch (e) {
      setErro(e?.message || 'Não foi possível gerar a senha. Digite uma.');
    }
  };

  useEffect(() => {
    if (criando && !valor) gerar();
  }, []);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(valor || '');
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErro('Não foi possível copiar. Selecione a senha e copie.');
    }
  };

  if (!aberto) {
    return html`<div class="c-campo">
      <span class="c-rotulo">Senha</span>
      <div class="c-senha-pilha">
        <button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => { setAberto(true); if (!valor) gerar(); }}>
          <${Ic} nome="arrow-counter-clockwise" />Redefinir senha
        </button>
        ${possuiSenha ? html`<${Selo} tom="sucesso" icone="lock">Senha definida<//>` : html`<${Selo} tom="neutro" icone="lock">Ainda sem senha<//>`}
      </div>
    </div>`;
  }

  return html`<div class="c-campo c-cheio c-senha-redefinir">
    <span class="c-rotulo">Senha temporária</span>
    <div class="c-grupo">
      <div class="c-senha-caixa">
        <input class="c-entrada" type="text" autocomplete="off" spellcheck="false" aria-label="Senha temporária"
          value=${valor} onInput=${(e) => aoMudar(e.target.value)} />
        <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Copiar" title=${copiado ? 'Copiado' : 'Copiar'} onClick=${copiar}>
          <${Ic} nome=${copiado ? 'check' : 'copy'} />
        </button>
      </div>
      <button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${gerar}><${Ic} nome="arrows-clockwise" />Gerar outra</button>
      ${criando ? null : html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => { aoMudar(''); setAberto(false); setErro(''); }}>Cancelar</button>`}
    </div>
    <${RegrasSenha} senha=${valor} />
    ${erro ? html`<span class="c-ajuda c-erro">${erro}</span>` : null}
    <span class="c-ajuda"><${Ic} nome="info" />${criando
      ? `No 1º acesso, ${nome || 'a pessoa'} cria a própria senha. A temporária vale 7 dias.`
      : `Ao salvar: a senha atual para de valer, ${nome || 'a pessoa'} sai de onde estiver logada e, no próximo acesso, cria a própria senha. A temporária vale 7 dias. O TI é avisado.`}</span>
  </div>`;
}
