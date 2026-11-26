// Fluxo de senha do acesso por Login (amostra aprovada pelo Paulo em 26/11/2026,
// CONECTA_REBRANDING/27_SENHA_E_ACESSO). Peças da tela de login: Recuperar acesso, Pedido enviado (operador),
// Criar nova senha (código do e-mail), Crie a sua senha (1º acesso) e Sessão encerrada.
// Só tokens e peças c-; o servidor confere a regra da senha de novo (a lista aqui é só ajuda ao vivo).
import { html, useState } from '../../infraestrutura-react.js?v=20261126-senha';
import { Faixa, Ic } from '../../ui/components/ds.js?v=20261126-senha';
import { concluirRecuperacaoSenhaApi, iniciarRecuperacaoSenhaApi } from '../../services/api/auth.js?v=20261126-senha';

export const REGRAS_SENHA = [
  ['tamanho', '8 caracteres ou mais', (s) => s.length >= 8],
  ['maiuscula', 'Uma letra maiúscula (A–Z)', (s) => /\p{Lu}/u.test(s)],
  ['minuscula', 'Uma letra minúscula (a–z)', (s) => /\p{Ll}/u.test(s)],
  ['numero', 'Um número (0–9)', (s) => /\d/.test(s)],
  ['especial', 'Um caractere especial (! @ # $ % & * ?)', (s) => /[^\p{L}\d\s]/u.test(s)],
];

export const senhaCumpreRegras = (senha) => REGRAS_SENHA.every(([, , ok]) => ok(String(senha || '')));

export function RegrasSenha({ senha }) {
  const valor = String(senha || '');
  return html`<ul class="c-senha-regras" aria-label="Regras da senha">
    ${REGRAS_SENHA.map(([chave, texto, ok]) => {
      const cumpre = ok(valor);
      return html`<li key=${chave} class=${cumpre ? 'c-ok' : ''}><${Ic} nome=${cumpre ? 'check-circle' : 'x-circle'} /><span>${texto}</span></li>`;
    })}
  </ul>`;
}

export function CampoSenha({ id, rotulo, valor, aoMudar, autoComplete = 'new-password', invalido = false }) {
  const [visivel, setVisivel] = useState(false);
  return html`<div class="c-login-campo">
    <label for=${id}>${rotulo}</label>
    <div class="c-senha-caixa">
      <input id=${id} class="c-entrada" type=${visivel ? 'text' : 'password'} autocomplete=${autoComplete}
        aria-invalid=${invalido ? 'true' : null} value=${valor} onInput=${(e) => aoMudar(e.target.value)} />
      <button class="c-botao c-botao--texto c-botao--icone c-botao--compacto c-senha-olho" type="button"
        aria-label=${visivel ? 'Esconder senha' : 'Mostrar senha'} title=${visivel ? 'Esconder senha' : 'Mostrar senha'}
        onClick=${() => setVisivel(!visivel)}><${Ic} nome=${visivel ? 'eye-slash' : 'eye'} /></button>
    </div>
  </div>`;
}

function Erro({ children, tom = 'perigo', icone = 'warning-octagon' }) {
  return html`<div class=${`c-faixa c-faixa--${tom}`} role=${tom === 'perigo' ? 'alert' : 'status'}>
    <${Ic} nome=${icone} className="c-ic--20" /><div class="c-faixa-txt"><p>${children}</p></div>
  </div>`;
}

// A primeira frase do servidor vira o destaque, como na amostra ("<b>Não encontramos...</b> Confira...").
function MensagemServidor({ texto }) {
  const t = String(texto || '');
  const corte = t.indexOf('. ');
  if (corte < 0) return html`<b>${t}</b>`;
  return html`<b>${t.slice(0, corte + 1)}</b> ${t.slice(corte + 2)}`;
}

function Voltar({ aoVoltar }) {
  return html`<a class="c-login-link" href="#" onClick=${(e) => { e.preventDefault(); aoVoltar(); }}><${Ic} nome="arrow-left" /> Voltar para o login</a>`;
}

function Cab({ titulo, children }) {
  return html`<div class="c-login-cab"><h1>${titulo}</h1>${children ? html`<p>${children}</p>` : null}</div>`;
}

const tomDoErro = (msg) => {
  const t = String(msg || '');
  if (t.includes('Microsoft')) return ['informacao', 'info'];
  if (t.includes('Aguarde 15 minutos')) return ['atencao', 'clock'];
  return ['perigo', 'warning-octagon'];
};

// ── Recuperar acesso → (operador) Pedido enviado | (os demais) Criar nova senha ──
export function RecuperarAcesso({ identificadorInicial = '', aoVoltar, aoConcluir }) {
  const [etapa, setEtapa] = useState('pedir');
  const [identificador, setIdentificador] = useState(identificadorInicial);
  const [resposta, setResposta] = useState(null);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [nova, setNova] = useState('');
  const [repetir, setRepetir] = useState('');

  const pedir = async () => {
    if (!identificador.trim() || enviando) return;
    setEnviando(true);
    setErro('');
    try {
      const r = await iniciarRecuperacaoSenhaApi(identificador.trim());
      setResposta(r);
      setEtapa(r.tipo === 'codigo' ? 'codigo' : 'enviado');
    } catch (e) {
      setErro(e?.message || 'Não foi possível enviar agora. Tente de novo em alguns minutos.');
    } finally {
      setEnviando(false);
    }
  };

  const salvar = async () => {
    if (enviando) return;
    setEnviando(true);
    setErro('');
    try {
      await concluirRecuperacaoSenhaApi(identificador.trim(), codigo.trim(), nova);
      aoConcluir?.(identificador.trim());
    } catch (e) {
      setErro(e?.message || 'Não foi possível salvar a senha nova.');
    } finally {
      setEnviando(false);
    }
  };

  if (etapa === 'enviado') {
    return html`
      <${Cab} titulo="Pedido enviado" />
      <div class="c-login-bloco">
        <${Faixa} tom="informacao" icone="paper-plane-tilt">
          <b>${resposta?.tipo === 'ti' ? 'Enviamos uma senha provisória para o TI.' : 'Enviamos uma senha provisória para o seu supervisor.'}</b>
        </${Faixa}>
        <p>A senha nova é válida até: <b>${resposta?.validade || ''}</b>.</p>
        <p>Use sua senha provisória para gerar uma nova ao se conectar.</p>
      </div>
      <button class="c-botao c-botao--principal" type="button" onClick=${() => aoVoltar(identificador.trim())}>Voltar para o login</button>`;
  }

  if (etapa === 'codigo') {
    const [tom, icone] = tomDoErro(erro);
    const confere = repetir && repetir === nova;
    const pronto = /^\d{6}$/.test(codigo.trim()) && senhaCumpreRegras(nova) && confere;
    return html`
      <${Cab} titulo="Criar nova senha">
        Enviamos um código de 6 números para <b>${resposta?.email_mascarado || 'o seu e-mail'}</b>. Ele vale <b>${resposta?.validade_minutos || 15} minutos</b>.
      </${Cab}>
      <div class="c-login-campo">
        <div class="c-login-campo-cab">
          <label for="rec-codigo">Código</label>
          <a href="#" onClick=${(e) => { e.preventDefault(); setCodigo(''); pedir(); }}>Reenviar código</a>
        </div>
        <input id="rec-codigo" class="c-entrada c-codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
          value=${codigo} aria-invalid=${erro.startsWith('Código') ? 'true' : null}
          onInput=${(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} />
      </div>
      ${erro ? html`<${Erro} tom=${tom} icone=${icone}><${MensagemServidor} texto=${erro} /></${Erro}>` : null}
      <${CampoSenha} id="rec-nova" rotulo="Nova senha" valor=${nova} aoMudar=${setNova} />
      <${RegrasSenha} senha=${nova} />
      <${CampoSenha} id="rec-repetir" rotulo="Repita a nova senha" valor=${repetir} aoMudar=${setRepetir} invalido=${repetir && !confere} />
      ${repetir ? html`<p class=${`c-ajuda ${confere ? 'c-senha-confere' : ''}`}>${confere ? html`<${Ic} nome="check-circle" /> As duas senhas são iguais.` : 'As duas senhas ainda não são iguais.'}</p>` : null}
      <button class="c-botao c-botao--principal" type="submit" disabled=${!pronto || enviando}
        onClick=${(e) => { e.preventDefault(); salvar(); }}>${enviando ? 'Salvando…' : 'Salvar nova senha'}</button>
      <${Voltar} aoVoltar=${() => aoVoltar(identificador.trim())} />`;
  }

  const [tom, icone] = tomDoErro(erro);
  const microsoft = erro.includes('Microsoft');
  const esperar = erro.includes('Aguarde 15 minutos');
  return html`
    <${Cab} titulo="Recuperar acesso">Digite o e-mail ou o login que você usa para entrar no Conecta.</${Cab}>
    <div class="c-login-campo">
      <label for="rec-identificador">E-mail ou login</label>
      <input id="rec-identificador" class="c-entrada" type="text" autocomplete="username" value=${identificador}
        aria-invalid=${erro && !microsoft && !esperar ? 'true' : null}
        onInput=${(e) => { setIdentificador(e.target.value); if (erro) setErro(''); }} />
    </div>
    ${erro ? html`<${Erro} tom=${tom} icone=${icone}><${MensagemServidor} texto=${erro} /></${Erro}>` : null}
    ${microsoft
      ? html`<a class="c-botao c-botao--secundario" href="/auth/microsoft/login">Entrar com a Microsoft</a>`
      : html`<button class="c-botao c-botao--principal" type="submit" disabled=${!identificador.trim() || enviando || esperar}
          onClick=${(e) => { e.preventDefault(); pedir(); }}>${enviando ? 'Enviando…' : 'Continuar'}</button>`}
    <${Voltar} aoVoltar=${() => aoVoltar(identificador.trim())} />`;
}

// ── Sessão encerrada (a conta abriu em outro computador ou a senha mudou) ──
export function SessaoEncerrada({ mensagem, aoEntrar, aoEsqueci }) {
  const texto = String(mensagem || '');
  const outro = texto.includes('outro computador');
  const corte = texto.indexOf(' hoje') > 0 ? texto.indexOf(' hoje') : texto.indexOf(' em ');
  return html`
    <h1>Sessão encerrada</h1>
    <${Faixa} tom="atencao" icone="warning">
      ${outro && corte > 0 ? html`<b>${texto.slice(0, corte)}</b>${texto.slice(corte)}` : html`<b>${texto || 'Sua sessão foi encerrada.'}</b>`}
    </${Faixa}>
    <p class="c-login-texto">Se foi você, é só entrar de novo aqui. Se não foi você, troque a senha e avise o TI.</p>
    <button class="c-botao c-botao--principal" type="button" onClick=${aoEntrar}>Entrar de novo</button>
    <a class="c-login-link" href="#" onClick=${(e) => { e.preventDefault(); aoEsqueci(); }}>Esqueci a senha</a>`;
}

// ── Crie a sua senha (1º acesso e depois de qualquer senha temporária ou provisória) ──
export function CrieSuaSenha({ aoSalvar, aoSair }) {
  const [nova, setNova] = useState('');
  const [repetir, setRepetir] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const confere = repetir && repetir === nova;
  const pronto = senhaCumpreRegras(nova) && confere;

  const salvar = async (e) => {
    e?.preventDefault?.();
    if (!pronto || salvando) return;
    setSalvando(true);
    setErro('');
    try {
      await aoSalvar(nova);
    } catch (err) {
      setErro(err?.message || 'Não foi possível salvar a senha.');
      setSalvando(false);
    }
  };

  return html`
    <section class="active screen c-login-tela c-crie-senha" id="screen-crie-sua-senha" role="dialog" aria-modal="true" aria-label="Crie a sua senha">
      <div class="c-login c-login--so-form">
        <div class="c-login-form">
          <form class="c-login-caixa" onSubmit=${salvar}>
            <span class="c-login-logo"><img alt="Conecta, da Central 24 Horas" src="/estilos/marca/conecta_colorido_assinatura.svg" /></span>
            <h1>Crie a sua senha</h1>
            <${Faixa} tom="informacao" icone="lock">Você entrou com uma <b>senha temporária</b>. Para usar o Conecta, crie a sua senha agora.</${Faixa}>
            ${erro ? html`<${Erro}><${MensagemServidor} texto=${erro} /></${Erro}>` : null}
            <${CampoSenha} id="crie-nova" rotulo="Nova senha" valor=${nova} aoMudar=${setNova} />
            <${RegrasSenha} senha=${nova} />
            <${CampoSenha} id="crie-repetir" rotulo="Repita a nova senha" valor=${repetir} aoMudar=${setRepetir} invalido=${repetir && !confere} />
            ${repetir ? html`<p class=${`c-ajuda ${confere ? 'c-senha-confere' : ''}`}>${confere ? html`<${Ic} nome="check-circle" /> As duas senhas são iguais.` : 'As duas senhas ainda não são iguais.'}</p>` : null}
            <button class="c-botao c-botao--principal" type="submit" disabled=${!pronto || salvando}>${salvando ? 'Salvando…' : 'Salvar e entrar'}</button>
            <a class="c-login-link" href="#" onClick=${(e) => { e.preventDefault(); aoSair(); }}>Sair</a>
          </form>
        </div>
      </div>
    </section>`;
}
