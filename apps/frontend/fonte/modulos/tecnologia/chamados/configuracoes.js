import { html, useCallback, useEffect, useState } from '../../../infraestrutura-react.js';
import {
  atualizarCategoriaChamado, atualizarEmailChamados, criarCategoriaChamado, criarEmailChamados, lerConfigChamados, listarEmailsChamados,
  removerEmailChamados, salvarConfigChamados,
} from '../../../services/api/chamados.js?v=20261005-redesign16';
import { DataTable, FormGrid, Section, SettingsLayout } from '../../../ui/components/layout-primitivas.js?v=20261005-redesign16';
import { EstadoErro, Icone } from './comum.js?v=20261005-redesign16';

// Configurações (`chamados.configurar`): subnavegação à esquerda e uma seção por assunto. Nada fica fixo no código.
// Alterar um prazo vale só para chamados novos. Cada seção de números tem o seu próprio Salvar.

const SECOES = [
  { chave: 'sla', rotulo: 'Prazos de SLA', icone: 'schedule' },
  { chave: 'encerramento', rotulo: 'Encerrar e reabrir', icone: 'task_alt' },
  { chave: 'anexos', rotulo: 'Anexos', icone: 'attach_file' },
  { chave: 'categorias', rotulo: 'Categorias', icone: 'inbox' },
  { chave: 'lembretes', rotulo: 'Lembretes por e-mail', icone: 'mail' },
];
const CAMPOS = {
  sla: [
    { chave: 'sla_horas_critica', rotulo: 'Crítica', sufixo: 'horas' },
    { chave: 'sla_horas_alta', rotulo: 'Alta', sufixo: 'horas' },
    { chave: 'sla_horas_media', rotulo: 'Média', sufixo: 'horas' },
    { chave: 'sla_horas_baixa', rotulo: 'Baixa', sufixo: 'horas' },
  ],
  encerramento: [
    { chave: 'encerramento_auto_horas', rotulo: 'Encerrar automaticamente após', sufixo: 'horas sem validação' },
    { chave: 'reabertura_dias', rotulo: 'Prazo para o solicitante reabrir', sufixo: 'dias (0 desliga)', ajuda: 'Conta a partir de quando o chamado foi resolvido ou encerrado.' },
  ],
  anexos: [
    { chave: 'anexo_max_mb', rotulo: 'Tamanho máximo por arquivo', sufixo: 'MB' },
    { chave: 'anexo_max_mb_chamado', rotulo: 'Total de anexos por chamado', sufixo: 'MB' },
    { chave: 'anexo_retencao_exclusao_dias', rotulo: 'Guardar anexos apagados por', sufixo: 'dias' },
  ],
  lembretes: [
    { chave: 'lembrete_sla_horas_antes', rotulo: 'Avisar quando faltar até', sufixo: 'horas para o SLA estourar' },
    { chave: 'lembrete_parado_horas', rotulo: 'Avisar chamado parado há', sufixo: 'horas sem movimentação' },
  ],
};
const DESCRICAO = {
  sla: 'Tempo máximo para solução, em horas corridas. Vale apenas para chamados novos; os já abertos mantêm o prazo gravado.',
  encerramento: 'O que acontece depois que o chamado é resolvido: validação automática e janela para reabrir.',
  anexos: 'Limites de tamanho e por quanto tempo guardar arquivos apagados.',
};

function Interruptor({ ligado, rotulo, onChange, travado = false }) {
  return html`<button type="button" role="switch" aria-checked=${ligado} aria-label=${rotulo} disabled=${travado}
    class=${`tec-switch ${ligado ? 'is-on' : ''}`.trim()} onClick=${onChange}></button>`;
}

function CampoNumero({ chave, rotulo, sufixo, ajuda, valor, aoMudar }) {
  return html`
    <label class="lp-campo"><span class="lp-campo-rotulo">${rotulo}</span>
      <span class="chm-num"><input type="number" inputmode="decimal" min="0" step="any" value=${valor ?? ''} onInput=${(e) => aoMudar(chave, e.target.value)} aria-label=${rotulo} /><small>${sufixo}</small></span>
      ${ajuda ? html`<small class="lp-campo-ajuda">${ajuda}</small>` : null}
    </label>`;
}

const TIPOS_PADRAO = [
  { chave: 'novo', rotulo: 'Novo chamado' }, { chave: 'sla_proximo', rotulo: 'SLA perto de estourar' }, { chave: 'sla_vencido', rotulo: 'SLA estourado' },
  { chave: 'parado', rotulo: 'Chamado parado' }, { chave: 'reaberto', rotulo: 'Reaberto' },
];

function SecaoEmails({ valores, aoMudar, alterado, salvando, aoSalvar, aoDescartar, showToast }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [novo, setNovo] = useState('');
  const carregar = useCallback(() => {
    setErro('');
    listarEmailsChamados().then(setDados).catch((e) => setErro(e?.message || 'Não foi possível carregar os destinatários.'));
  }, []);
  useEffect(carregar, [carregar]);

  const tentar = async (acao, sucesso) => {
    try {
      await acao();
      if (sucesso) showToast(sucesso, 'success');
      carregar();
    } catch (ex) {
      showToast(ex?.message || 'Não foi possível salvar.', 'error');
    }
  };
  const tipos = dados?.tipos || TIPOS_PADRAO;
  const ligado = Number(valores.lembrete_email_ativo) > 0;
  const colunas = [
    { chave: 'email', rotulo: 'Destinatário', prioridade: 1, fixa: true, largura: '280px', render: (d) => html`<span title=${d.email}>${d.email}</span>` },
    { chave: 'tipos', rotulo: 'Recebe', prioridade: 1,
      render: (d) => html`<div class="tec-caixas">${tipos.map((t) => html`
        <label key=${t.chave} class="tec-caixa"><input type="checkbox" checked=${Boolean(d.tipos[t.chave])} disabled=${!d.ativo}
          onChange=${() => tentar(() => atualizarEmailChamados(d.id, { tipos: { [t.chave]: !d.tipos[t.chave] } }))} /><span>${t.rotulo}</span></label>`)}</div>` },
    { chave: 'ativo', rotulo: 'Ativo', prioridade: 1, largura: '72px', alinhar: 'direita',
      render: (d) => html`<${Interruptor} ligado=${d.ativo} rotulo=${`Enviar para ${d.email}`} onChange=${() => tentar(() => atualizarEmailChamados(d.id, { ativo: !d.ativo }))} />` },
    { chave: 'remover', rotulo: '', prioridade: 1, largura: '56px', alinhar: 'direita',
      render: (d) => html`<button type="button" class="btn btn-sm btn-outline-secondary" aria-label=${`Remover ${d.email}`}
        onClick=${() => tentar(() => removerEmailChamados(d.id), 'Destinatário removido.')}><${Icone} nome="close" /></button>` },
  ];
  const adicionar = () => {
    const email = novo.trim();
    if (!email) return;
    tentar(async () => { await criarEmailChamados({ email }); setNovo(''); }, 'Destinatário adicionado.');
  };

  return html`
    <div class="lp-settings-conteudo">
      <${Section} titulo="Lembretes por e-mail" descricao="Alerta enviado por e-mail para chamados perto de estourar o SLA ou parados em aberto. As notificações dentro do Conecta continuam como antes."
        acoes=${html`
          <button type="button" class="btn btn-outline-secondary" disabled=${!alterado || salvando} onClick=${aoDescartar}>Descartar</button>
          <button type="button" class="btn btn-primary" disabled=${!alterado || salvando} onClick=${aoSalvar}>${salvando ? 'Salvando…' : 'Salvar'}</button>`}>
        <div class="tec-linha">
          <div class="tec-linha-texto"><strong>Enviar lembretes por e-mail</strong><small>Desligado: nenhum e-mail de chamado é enviado, para ninguém.</small></div>
          <${Interruptor} ligado=${ligado} rotulo="Enviar lembretes por e-mail" onChange=${() => aoMudar('lembrete_email_ativo', ligado ? '0' : '1')} />
        </div>
        <${FormGrid} colunas=${2}>
          ${CAMPOS.lembretes.map((c) => html`<${CampoNumero} key=${c.chave} ...${c} valor=${valores[c.chave]} aoMudar=${aoMudar} />`)}
        <//>
      <//>
      <${Section} titulo="Quem recebe" descricao="Cada pessoa recebe só os tipos marcados. As alterações desta tabela valem na hora.">
        <div class="chm-nova-categoria">
          <input class="chm-input" type="email" maxlength="180" value=${novo} placeholder="email@empresa.com.br" aria-label="Novo destinatário"
            onInput=${(e) => setNovo(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') adicionar(); }} />
          <button type="button" class="btn btn-outline-secondary" disabled=${!novo.trim()} onClick=${adicionar}><${Icone} nome="add" />Adicionar</button>
        </div>
        <${DataTable} colunas=${colunas} linhas=${dados?.itens || []} carregando=${!dados && !erro} erro=${erro} aoTentar=${carregar}
          vazio=${{ texto: 'Nenhum destinatário. Adicione um e-mail para começar a receber os alertas.' }} />
      <//>
    </div>`;
}

export function ConfiguracoesChamados({ showToast }) {
  const [secao, setSecao] = useState('sla');
  const [dados, setDados] = useState(null);
  const [valores, setValores] = useState({});
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [novaCategoria, setNovaCategoria] = useState('');

  const carregar = useCallback(() => {
    setErro('');
    lerConfigChamados()
      .then((r) => { setDados(r); setValores(r.config || {}); })
      .catch((e) => setErro(e?.message || 'Não foi possível carregar as configurações.'));
  }, []);
  useEffect(carregar, [carregar]);

  const mudar = (chave, valor) => setValores((v) => ({ ...v, [chave]: valor }));
  const chavesDa = (s) => (CAMPOS[s] || []).map((c) => c.chave).concat(s === 'lembretes' ? ['lembrete_email_ativo'] : []);
  const alteradaSecao = (s) => Boolean(dados) && chavesDa(s).some((k) => String(valores[k]) !== String(dados.config[k]));

  const salvarSecao = async (s) => {
    setSalvando(true);
    try {
      const enviar = {};
      chavesDa(s).forEach((k) => { enviar[k] = Number(valores[k]); });
      await salvarConfigChamados(enviar);
      showToast('Configurações salvas.', 'success');
      carregar();
    } catch (ex) {
      showToast(ex?.message || 'Não foi possível salvar.', 'error');
    } finally {
      setSalvando(false);
    }
  };
  const descartarSecao = (s) => setValores((v) => ({ ...v, ...Object.fromEntries(chavesDa(s).map((k) => [k, dados.config[k]])) }));

  const incluirCategoria = async () => {
    const nome = novaCategoria.trim();
    if (!nome) return;
    try {
      await criarCategoriaChamado({ nome });
      setNovaCategoria('');
      showToast('Categoria criada.', 'success');
      carregar();
    } catch (ex) {
      showToast(ex?.message || 'Não foi possível criar a categoria.', 'error');
    }
  };
  const alternar = async (categoria) => {
    try {
      await atualizarCategoriaChamado(categoria.id, { ativo: !categoria.ativo });
      carregar();
    } catch (ex) {
      showToast(ex?.message || 'Não foi possível atualizar a categoria.', 'error');
    }
  };

  if (erro) return html`<${EstadoErro} erro=${erro} aoTentar=${carregar} />`;
  if (!dados) return html`<p class="chm-vazio">Carregando configurações…</p>`;

  const botoesSalvar = (s) => html`
    <button type="button" class="btn btn-outline-secondary" disabled=${!alteradaSecao(s) || salvando} onClick=${() => descartarSecao(s)}>Descartar</button>
    <button type="button" class="btn btn-primary" disabled=${!alteradaSecao(s) || salvando} onClick=${() => salvarSecao(s)}>${salvando ? 'Salvando…' : 'Salvar'}</button>`;
  const meta = SECOES.find((x) => x.chave === secao);

  return html`
    <${SettingsLayout} itens=${SECOES} ativo=${secao} aoMudar=${setSecao}>
      ${CAMPOS[secao] && secao !== 'lembretes' ? html`
        <${Section} titulo=${meta.rotulo} descricao=${DESCRICAO[secao]} acoes=${botoesSalvar(secao)}>
          <${FormGrid} colunas=${secao === 'sla' ? 4 : 2}>
            ${CAMPOS[secao].map((c) => html`<${CampoNumero} key=${c.chave} ...${c} valor=${valores[c.chave]} aoMudar=${mudar} />`)}
          <//>
        <//>` : null}

      ${secao === 'categorias' ? html`
        <${Section} titulo="Categorias" descricao="Categorias desativadas deixam de aparecer para novos chamados, mas continuam nos já abertos.">
          <ul class="chm-categorias">
            ${dados.categorias.map((c) => html`
              <li key=${c.id} class=${c.ativo ? '' : 'is-inativa'}>
                <span>${c.nome}</span>
                <${Interruptor} ligado=${c.ativo} rotulo=${`Categoria ${c.nome}`} onChange=${() => alternar(c)} />
              </li>`)}
          </ul>
          <div class="chm-nova-categoria">
            <input class="chm-input" maxlength="80" value=${novaCategoria} placeholder="Nova categoria" aria-label="Nova categoria"
              onInput=${(e) => setNovaCategoria(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') incluirCategoria(); }} />
            <button type="button" class="btn btn-outline-secondary" disabled=${!novaCategoria.trim()} onClick=${incluirCategoria}><${Icone} nome="add" />Adicionar</button>
          </div>
        <//>` : null}

      ${secao === 'lembretes' ? html`<${SecaoEmails} valores=${valores} aoMudar=${mudar} alterado=${alteradaSecao('lembretes')} salvando=${salvando}
        aoSalvar=${() => salvarSecao('lembretes')} aoDescartar=${() => descartarSecao('lembretes')} showToast=${showToast} />` : null}
    <//>`;
}
