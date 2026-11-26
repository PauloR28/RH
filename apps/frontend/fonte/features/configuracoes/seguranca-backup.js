// Configurações do Conecta › Segurança e Backup (reestruturação, Etapa 7b — amostra aprovada em 17/nov/2026).
// Segurança = política GLOBAL (senha, inatividade, sessão). O que é pessoal (MFA, e-mail secundário) fica no perfil de
// cada usuário. Backup = só a situação (decisão D5): quem faz o backup é a tarefa agendada do servidor.
import { html, useEffect, useState } from '../../infraestrutura-react.js?v=20261126-painel-relatorios';
import { PainelRh } from '../../ui/componentes-compartilhados.js?v=20261126-painel-relatorios';
import { Ic, Segmento, Selo } from '../../ui/components/ds.js?v=20261126-painel-relatorios';
import { requisitar } from '../../services/api/core.js?v=20261126-painel-relatorios';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const api = {
  ler: () => requisitar('/settings/seguranca', { method: 'GET' }),
  salvar: (dados) => requisitar('/settings/seguranca', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(dados) }),
  previa: () => requisitar('/settings/seguranca/inatividade/previa', { method: 'GET' }),
  backup: () => requisitar('/settings/backup', { method: 'GET' }),
};

const CAMPOS = ['senha_tamanho_minimo', 'senha_troca_dias', 'inatividade_ativa', 'inatividade_bloqueio_dias', 'inatividade_exclusao_dias',
  'inatividade_aviso_dias', 'sessao_maxima_minutos', 'sessao_ociosa_minutos', 'sessao_aviso_minutos'];
const dataHora = (v) => (v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

function Bloco({ titulo, icone, children }) {
  return html`<section class="c-cfg-bloco"><h3>${icone ? html`<${Ic} nome=${icone} />` : null}${titulo}</h3>${children}</section>`;
}

function Mensagem({ mensagem }) {
  if (!mensagem.texto) return null;
  const tom = mensagem.tipo === 'erro' ? 'perigo' : 'informacao';
  return html`<div class=${`c-faixa c-faixa--${tom}`} role=${mensagem.tipo === 'erro' ? 'alert' : 'status'}><div class="c-faixa-txt"><p>${mensagem.texto}</p></div></div>`;
}

export function TelaSegurancaConecta({ controlador }) {
  const podeEditar = controlador.possuiPermissao('configuracoes.editar');
  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState(null);
  const [aba, setAba] = useState('senha');
  const [previa, setPrevia] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState({ tipo: '', texto: '' });

  const carregar = async () => {
    try {
      const dados = await api.ler();
      setConfig(dados);
      setDraft(Object.fromEntries(CAMPOS.map((c) => [c, dados[c]])));
    } catch (erro) {
      setMensagem({ tipo: 'erro', texto: erro?.message || 'Não foi possível carregar a Segurança.' });
    }
  };
  useEffect(() => { carregar(); api.previa().then(setPrevia).catch(() => setPrevia(null)); }, []);

  const alterados = config && draft ? CAMPOS.filter((c) => draft[c] !== config[c]) : [];
  const salvar = async () => {
    setOcupado(true);
    setMensagem({ tipo: '', texto: '' });
    try {
      await api.salvar(draft);
      await carregar();
      setPrevia(await api.previa().catch(() => null));
      setMensagem({ tipo: 'ok', texto: 'Segurança salva.' });
    } catch (erro) {
      setMensagem({ tipo: 'erro', texto: erro?.message || 'Não foi possível salvar.' });
    } finally {
      setOcupado(false);
    }
  };

  const numero = (campo, sufixo) => {
    const lim = config?.campos?.[campo] || {};
    return html`<span class="c-cfg-numero"><input class="c-entrada" type="number" min=${lim.minimo} max=${lim.maximo} disabled=${!podeEditar}
      value=${draft?.[campo] ?? ''} aria-label=${lim.descricao || campo}
      onInput=${(e) => setDraft({ ...draft, [campo]: Number(e.target.value) })} /><span class="c-secundario">${sufixo}</span></span>`;
  };
  const campo = (rotulo, controle, ajuda = '') => html`<div class="c-campo"><span class="c-rotulo">${rotulo}</span>${controle}${ajuda ? html`<small class="c-secundario">${ajuda}</small>` : null}</div>`;

  return html`
    <${PainelRh} screenId="screen-settings-seguranca" navAtiva="screen-settings-seguranca" controlador=${controlador} placeholderBusca="Segurança">
      <section class="c-cartao c-cfg-cartao" aria-label="Segurança">
        <header><h2>Segurança</h2><p>Regras que valem para todo mundo. MFA e e-mail secundário são de cada pessoa e ficam no perfil dela.</p></header>
        <${Mensagem} mensagem=${mensagem} />
        ${draft ? html`
          <${Segmento} rotulo="Partes da Segurança" opcoes=${[['senha', 'Senha e inatividade'], ['sessao', 'Sessão']]} valor=${aba} aoMudar=${setAba} />
          ${aba === 'senha' ? html`
            <${Bloco} titulo="Senha (login local)" icone="lock">
              <div class="c-cfg-par">
                ${campo('Tamanho mínimo', numero('senha_tamanho_minimo', 'caracteres'))}
                ${campo('Pedir troca a cada', numero('senha_troca_dias', 'dias'), '0 = nunca pede.')}
              </div>
              <small class="c-secundario">Quem entra com a conta Microsoft segue a senha da Microsoft.</small>
            </${Bloco}>
            <${Bloco} titulo="Inatividade" icone="clock">
              <div class="c-cfg-linha">
                <span><strong>Bloquear e excluir quem não entra</strong><small>Não vale para o Administrador. Quem tem histórico na Monitoria fica bloqueado, e o histórico continua.</small></span>
                <label class="c-interruptor"><input type="checkbox" checked=${Boolean(draft.inatividade_ativa)} disabled=${!podeEditar}
                  aria-label="Política de inatividade ligada" onChange=${(e) => setDraft({ ...draft, inatividade_ativa: e.target.checked })} /></label>
              </div>
              <div class="c-cfg-par">
                ${campo('Sem acesso por', numero('inatividade_bloqueio_dias', 'dias'), 'O acesso é bloqueado.')}
                ${campo('Sem acesso por', numero('inatividade_exclusao_dias', 'dias'), 'O usuário é excluído (o histórico fica).')}
                ${campo('Avisar a pessoa antes', numero('inatividade_aviso_dias', 'dias'), 'Aviso no sino do Conecta.')}
              </div>
              ${previa ? html`<div class="c-faixa c-faixa--atencao" role="status"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>
                Hoje: ${previa.bloquear} pessoa(s) seriam bloqueadas, ${previa.excluir} excluídas e ${previa.avisar} avisadas.
                A rotina roda todo dia às 04:00.</p></div></div>` : null}
            </${Bloco}>
          ` : html`
            <${Bloco} titulo="Sessão" icone="clock">
              <div class="c-cfg-par">
                ${campo('Tempo máximo da sessão', numero('sessao_maxima_minutos', 'minutos'), `0 = valor do servidor (${config?.sessao_maxima_servidor ?? '—'} minutos). Vale para o próximo login.`)}
                ${campo('Sair sozinho sem uso por', numero('sessao_ociosa_minutos', 'minutos'))}
                ${campo('Avisar antes de sair', numero('sessao_aviso_minutos', 'minutos'))}
              </div>
            </${Bloco}>
          `}
          <div class="c-cfg-rodape">
            <span class="c-secundario">${alterados.length ? `${alterados.length} mudança(s) não salva(s).` : 'Nenhuma mudança.'}</span>
            ${podeEditar ? html`<button type="button" class="c-botao c-botao--principal" disabled=${!alterados.length || ocupado} onClick=${salvar}>
              <${Ic} nome="floppy-disk" />${ocupado ? 'Salvando...' : 'Salvar'}</button>` : null}
          </div>
        ` : null}
      </section>
    </${PainelRh}>
  `;
}

const ESTADO_BACKUP = {
  ok: ['sucesso', 'Em dia'],
  atrasado: ['atencao', 'Atrasado'],
  falha: ['perigo', 'Falhou'],
  sem_registro: ['neutro', 'Sem registro'],
};

export function TelaBackupConecta({ controlador }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [verRegistro, setVerRegistro] = useState(false);
  useEffect(() => { api.backup().then(setDados).catch((e) => setErro(e?.message || 'Não foi possível ler o backup.')); }, []);
  const [tom, rotulo] = ESTADO_BACKUP[dados?.estado] || ESTADO_BACKUP.sem_registro;

  return html`
    <${PainelRh} screenId="screen-settings-backup" navAtiva="screen-settings-backup" controlador=${controlador} placeholderBusca="Backup">
      <section class="c-cartao c-cfg-cartao" aria-label="Backup">
        <header><h2>Backup</h2><p>Só a situação. O backup roda sozinho no servidor todo dia às 02:00 e avisa por e-mail se falhar.</p></header>
        ${erro ? html`<${Mensagem} mensagem=${{ tipo: 'erro', texto: erro }} />` : null}
        ${dados ? html`
          <${Bloco} titulo="Situação" icone="hard-drives">
            <div class="c-cfg-linha">
              <span><strong>Último backup completo</strong><small>${dados.ultimo ? `${dataHora(dados.ultimo.fim)} · ${dados.ultimo.tamanho_mb} MB` : 'Nenhum backup encontrado no histórico do SQL Server.'}</small></span>
              <${Selo} tom=${tom}>${rotulo}</${Selo}>
            </div>
            ${dados.erro ? html`<small class="c-secundario">${dados.erro}</small>` : null}
          </${Bloco}>
          <${Bloco} titulo="Histórico (SQL Server)" icone="clock-counter-clockwise">
            ${dados.historico.length ? html`<div class="c-tabela-caixa"><table class="c-tabela c-tabela--compacta">
              <thead><tr><th>Terminou em</th><th>Tipo</th><th class="c-num">Tamanho</th><th>Situação</th></tr></thead>
              <tbody>${dados.historico.map((h) => html`<tr key=${h.fim}><td>${dataHora(h.fim)}</td><td>${h.tipo}</td><td class="c-num">${h.tamanho_mb} MB</td>
                <td>${h.danificado ? html`<${Selo} tom="perigo">Danificado</${Selo}>` : html`<${Selo} tom="sucesso">OK</${Selo}>`}</td></tr>`)}</tbody>
            </table></div>` : html`<small class="c-secundario">Sem histórico.</small>`}
          </${Bloco}>
          <${Bloco} titulo="Registro detalhado da última execução" icone="list-checks">
            ${dados.registro?.linhas ? html`
              <div class="c-cfg-linha"><span><strong>${dados.registro.arquivo}</strong><small>${dados.registro.pasta}</small></span>
                <button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => setVerRegistro(!verRegistro)}>${verRegistro ? 'Esconder' : 'Ver passo a passo'}</button></div>
              ${verRegistro ? html`<pre class="c-cfg-linha" style=${{ whiteSpace: 'pre-wrap', display: 'block', margin: 0 }}>${dados.registro.linhas.join('\n')}</pre>` : null}
            ` : html`<small class="c-secundario">${dados.registro?.erro || 'Para ver o passo a passo, configure RH_BACKUP_LOG_DIR no servidor com a pasta de logs do backup.'}</small>`}
          </${Bloco}>
        ` : null}
      </section>
    </${PainelRh}>
  `;
}
