// Configurações do Conecta › Notificações › Avançada: avisos de segurança ao TI (amostra aprovada em 26/11/2026,
// CONECTA_REBRANDING/27_SENHA_E_ACESSO/amostra_notificacao_avancada.html). Quem recebe (cada e-mail marca o que
// recebe, sem limite, 4 por vez), quais eventos avisam (na hora / resumo do dia / não avisar + sino) e o horário do resumo.
import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js?v=20261126-senha';
import { Estado, Esqueleto, Faixa, Ic, Selo } from '../../ui/components/ds.js?v=20261126-senha';
import { lerNotificacaoTi, salvarNotificacaoTi, testarNotificacaoTi } from '../../services/api/settings.js?v=20261126-senha';

const COLUNAS = [['logins', 'Logins'], ['senhas', 'Senhas'], ['sessoes', 'Sessões']];
const GRUPOS = [['logins', 'Logins'], ['senhas', 'Senhas'], ['sessoes', 'Sessões']];
const QUANDO = [['na_hora', 'Na hora'], ['resumo', 'Resumo do dia'], ['nao', 'Não avisar']];
const HORAS = ['06:00', '07:00', '08:00', '09:00', '10:00', '12:00', '18:00'];
const VISIVEIS = 4;
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function NotificacaoAvancada({ podeEditar = true }) {
  const [salvo, setSalvo] = useState(null);
  const [config, setConfig] = useState(null);
  const [eventos, setEventos] = useState([]);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState('');
  const [verTodos, setVerTodos] = useState(false);
  const [novo, setNovo] = useState({ nome: '', email: '' });
  const [testando, setTestando] = useState('');
  const [abertos, setAbertos] = useState({ logins: true, senhas: true, sessoes: false });

  const aplicar = (r) => {
    setSalvo(r.config);
    setConfig(r.config);
    setEventos(r.eventos || []);
  };

  useEffect(() => {
    lerNotificacaoTi().then(aplicar).catch((e) => setErro(e?.message || 'Não foi possível abrir os avisos ao TI.'));
  }, []);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const lista = config?.destinatarios || [];
    return termo ? lista.filter((d) => `${d.nome} ${d.email}`.toLowerCase().includes(termo)) : lista;
  }, [config, busca]);

  if (erro && !config) return html`<${Estado} titulo="Não foi possível abrir" texto=${erro} icone="warning" />`;
  if (!config) return html`<${Esqueleto} linhas=${6} />`;

  const mudou = !igual(config, salvo);
  const mostrar = verTodos || busca ? filtrados : filtrados.slice(0, VISIVEIS);
  const setDest = (email, mudar) => setConfig({
    ...config,
    destinatarios: config.destinatarios.map((d) => (d.email === email ? mudar(d) : d)),
  });
  const setEvento = (chave, campo, valor) => setConfig({
    ...config,
    eventos: { ...config.eventos, [chave]: { ...config.eventos[chave], [campo]: valor } },
  });

  const adicionar = () => {
    const email = novo.email.trim().toLowerCase();
    if (!EMAIL_VALIDO.test(email)) { setErro('Digite um e-mail válido.'); return; }
    if (config.destinatarios.some((d) => d.email === email)) { setErro('Esse e-mail já está na lista.'); return; }
    setErro('');
    setConfig({
      ...config,
      destinatarios: [...config.destinatarios, {
        nome: novo.nome.trim() || email, email, grupos: { logins: true, senhas: true, sessoes: true }, resumo: true, testado: false,
      }],
    });
    setNovo({ nome: '', email: '' });
  };

  const salvar = async () => {
    setSalvando(true);
    setErro('');
    setAviso('');
    try {
      aplicar(await salvarNotificacaoTi(config));
      setAviso('Avisos ao TI salvos.');
    } catch (e) {
      setErro(e?.message || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  // Enviar teste: salva antes (o e-mail precisa estar na lista guardada) e testa quem ainda falta.
  const enviarTeste = async () => {
    const alvos = (config.destinatarios || []).filter((d) => !d.testado).map((d) => d.email);
    const lista = alvos.length ? alvos : (config.destinatarios || []).map((d) => d.email);
    if (!lista.length) { setErro('Adicione um e-mail antes de enviar o teste.'); return; }
    setErro('');
    setAviso('');
    try {
      if (mudou) aplicar(await salvarNotificacaoTi(config));
      const falhas = [];
      for (const email of lista) {
        setTestando(email);
        try {
          aplicar(await testarNotificacaoTi(email));
        } catch (e) {
          falhas.push(`${email}: ${e?.message || 'não saiu'}`);
        }
      }
      if (falhas.length) setErro(falhas.join(' '));
      else setAviso(`E-mail de teste enviado para ${lista.length === 1 ? lista[0] : `${lista.length} e-mails`}. Confira a caixa de entrada.`);
    } catch (e) {
      setErro(e?.message || 'Não foi possível enviar o teste.');
    } finally {
      setTestando('');
    }
  };

  const remover = (email) => setConfig({ ...config, destinatarios: config.destinatarios.filter((d) => d.email !== email) });
  const contar = (grupo, quando) => eventos.filter((e) => e.grupo === grupo && config.eventos[e.chave]?.quando === quando).length;

  return html`
    ${aviso ? html`<${Faixa} tom="informacao" icone="check-circle">${aviso}</${Faixa}>` : null}
    ${erro ? html`<div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning-octagon" /><div class="c-faixa-txt"><p>${erro}</p></div></div>` : null}

    <section class="c-cfg-bloco c-nf-bloco">
      <div class="c-nf-bloco-cab">
        <div><h3><${Ic} nome="at" />Quem recebe os avisos de segurança</h3><p class="c-nf-txt">Marque o que cada e-mail recebe.</p></div>
        <div class="c-grupo">
          <div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" />
            <input class="c-entrada c-entrada--compacta" type="search" placeholder="Buscar nome ou e-mail" aria-label="Buscar destinatário"
              value=${busca} onInput=${(e) => setBusca(e.target.value)} />
          </div>
          <button class="c-botao c-botao--secundario c-botao--compacto" type="button" disabled=${!podeEditar || Boolean(testando)} onClick=${enviarTeste}>
            <${Ic} nome="paper-plane-tilt" />${testando ? 'Enviando…' : 'Enviar teste'}
          </button>
        </div>
      </div>
      <div class="c-tabela-caixa">
        <table class="c-tabela c-nf-tabela">
          <thead><tr>
            <th>Destinatário</th>
            ${COLUNAS.map(([, r]) => html`<th key=${r} class="c-nf-centro c-nf-col">${r}</th>`)}
            <th class="c-nf-centro c-nf-col">Resumo do dia</th>
            <th class="c-nf-col-situacao">Situação</th>
            <th class="c-acoes"><span class="c-oculto">Ações</span></th>
          </tr></thead>
          <tbody>
            ${mostrar.length ? mostrar.map((d) => html`<tr key=${d.email}>
              <td><strong>${d.nome}</strong><small class="c-nf-desc">${d.email}</small></td>
              ${COLUNAS.map(([g, r]) => html`<td key=${g} class="c-nf-centro"><label class="c-marcar">
                <input type="checkbox" aria-label=${`${r} para ${d.email}`} checked=${Boolean(d.grupos?.[g])} disabled=${!podeEditar}
                  onChange=${(e) => setDest(d.email, (x) => ({ ...x, grupos: { ...x.grupos, [g]: e.target.checked } }))} /></label></td>`)}
              <td class="c-nf-centro"><label class="c-marcar">
                <input type="checkbox" aria-label=${`Resumo do dia para ${d.email}`} checked=${Boolean(d.resumo)} disabled=${!podeEditar}
                  onChange=${(e) => setDest(d.email, (x) => ({ ...x, resumo: e.target.checked }))} /></label></td>
              <td>${d.testado
                ? html`<${Selo} tom="sucesso" icone="check" title=${d.testado_em ? `Testado em ${d.testado_em}` : ''}>Teste ok<//>`
                : html`<${Selo} tom="atencao" icone="warning">${testando === d.email ? 'Enviando…' : 'Falta testar'}<//>`}</td>
              <td class="c-acoes">${podeEditar ? html`<button class="c-botao c-botao--texto c-botao--icone c-botao--compacto" type="button"
                aria-label=${`Remover ${d.email}`} title="Remover" onClick=${() => remover(d.email)}><${Ic} nome="trash" /></button>` : null}</td>
            </tr>`) : html`<tr><td colspan=${COLUNAS.length + 4} class="c-secundario">${busca ? 'Nenhum e-mail com essa busca.' : 'Nenhum e-mail cadastrado ainda.'}</td></tr>`}
            ${podeEditar ? html`<tr class="c-nf-novo"><td colspan=${COLUNAS.length + 4}>
              <div class="c-grupo">
                <input class="c-entrada c-entrada--compacta c-nf-novo-nome" placeholder="Nome (ex.: Caixa do TI)" aria-label="Nome"
                  value=${novo.nome} onInput=${(e) => setNovo({ ...novo, nome: e.target.value })} />
                <input class="c-entrada c-entrada--compacta c-nf-novo-email" type="email" placeholder="nome@empresa.com.br" aria-label="E-mail"
                  value=${novo.email} onInput=${(e) => setNovo({ ...novo, email: e.target.value })}
                  onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); adicionar(); } }} />
                <button class="c-botao c-botao--secundario c-botao--compacto" type="button" onClick=${adicionar}><${Ic} nome="plus" />Adicionar e-mail</button>
              </div>
            </td></tr>` : null}
          </tbody>
        </table>
        <div class="c-tabela-rodape">
          <span>Mostrando ${mostrar.length} de ${filtrados.length} e-mail${filtrados.length === 1 ? '' : 's'}
            ${!busca && filtrados.length > VISIVEIS ? html` <button class="c-botao c-botao--texto c-botao--compacto" type="button" onClick=${() => setVerTodos(!verTodos)}>
              <${Ic} nome=${verTodos ? 'caret-up' : 'caret-down'} />${verTodos ? 'Ver menos' : `Ver mais ${filtrados.length - VISIVEIS}`}</button>` : null}</span>
          <span class="c-secundario">O e-mail novo só começa a receber depois do teste.</span>
        </div>
      </div>
      <div class="c-cfg-linha">
        <div>Avisar também no sino quem tem o perfil <b>TI</b><small>Recebem os eventos marcados com Sino abaixo.</small></div>
        <label class="c-interruptor"><input type="checkbox" role="switch" aria-label="Avisar no sino" checked=${Boolean(config.sino_ti)} disabled=${!podeEditar}
          onChange=${(e) => setConfig({ ...config, sino_ti: e.target.checked })} /></label>
      </div>
    </section>

    <section class="c-cfg-bloco">
      <h3><${Ic} nome="bell" />Quais eventos avisam o TI</h3>
      <p class="c-nf-txt">Tudo vai para a Auditoria, sempre. Aqui você escolhe só o que também chega por e-mail.</p>
      <div class="c-tabela-caixa">
        <table class="c-tabela c-nf-tabela">
          <thead><tr><th>Evento</th><th class="c-nf-col-quando">E-mail</th><th class="c-nf-centro c-nf-col-sino">Sino</th></tr></thead>
          ${GRUPOS.map(([g, rotulo]) => html`<tbody key=${g}>
            <tr class="c-nf-grupo"><th colspan="3">
              <button class="c-botao c-botao--texto c-botao--compacto" type="button" aria-expanded=${abertos[g] ? 'true' : 'false'}
                onClick=${() => setAbertos({ ...abertos, [g]: !abertos[g] })}>
                <${Ic} nome=${abertos[g] ? 'caret-down' : 'caret-right'} />${rotulo}
                <span class="c-secundario">· ${contar(g, 'na_hora')} na hora · ${contar(g, 'resumo')} no resumo</span>
              </button>
            </th></tr>
            ${abertos[g] ? eventos.filter((e) => e.grupo === g).map((ev) => {
              const regra = config.eventos[ev.chave] || {};
              return html`<tr key=${ev.chave}>
                <td><strong>${ev.titulo}</strong><small class="c-nf-desc">${ev.descricao}</small></td>
                <td><select class="c-entrada c-entrada--compacta" aria-label=${`Quando avisar: ${ev.titulo}`} value=${regra.quando} disabled=${!podeEditar}
                  onChange=${(e) => setEvento(ev.chave, 'quando', e.target.value)}>
                  ${QUANDO.map(([v, r]) => html`<option key=${v} value=${v}>${r}</option>`)}
                </select></td>
                <td class="c-nf-centro"><label class="c-interruptor"><input type="checkbox" role="switch" aria-label=${`Sino: ${ev.titulo}`}
                  checked=${Boolean(regra.sino) && regra.quando !== 'nao'} disabled=${!podeEditar || regra.quando === 'nao'}
                  onChange=${(e) => setEvento(ev.chave, 'sino', e.target.checked)} /></label></td>
              </tr>`;
            }) : null}
          </tbody>`)}
        </table>
      </div>
      <div class="c-cfg-linha">
        <div>Horário do resumo do dia<small>Um e-mail só, com a contagem do dia anterior.</small></div>
        <select class="c-entrada c-entrada--compacta c-nf-hora" aria-label="Horário do resumo" value=${config.hora_resumo} disabled=${!podeEditar}
          onChange=${(e) => setConfig({ ...config, hora_resumo: e.target.value })}>
          ${(HORAS.includes(config.hora_resumo) ? HORAS : [...HORAS, config.hora_resumo].sort()).map((h) => html`<option key=${h} value=${h}>${h}</option>`)}
        </select>
      </div>
    </section>

    ${podeEditar ? html`<div class="c-grupo c-grupo--fim">
      <span class="c-secundario">Toda mudança aqui fica no Registro de alterações.</span>
      <button class="c-botao c-botao--secundario" type="button" disabled=${!mudou || salvando} onClick=${() => { setConfig(salvo); setErro(''); }}>Desfazer</button>
      <button class="c-botao c-botao--principal" type="button" disabled=${!mudou || salvando} onClick=${salvar}><${Ic} nome="check" />${salvando ? 'Salvando…' : 'Salvar'}</button>
    </div>` : null}`;
}
