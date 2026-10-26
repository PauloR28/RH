import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { LoadingState } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import {
  enviarLogoOperacao,
  lerAmbienteOperacao,
  listarIdentidadeOperacoes,
  listarCatalogoMonitoria,
  listarEquipesMonitoria,
  salvarAmbienteOperacao,
  salvarCatalogoMonitoria,
  salvarCorOperacao,
  salvarEquipeMonitoria,
} from '../../services/api/monitoria.js';
import { SelectMultiplo } from '../monitoria/comum.js';
import { CartaoLista } from './monitoria-config.js';

// Aba "Configurar ambiente" da operação (Configurações > Operações): quem trabalha nela
// (supervisores, Qualidade), se ela tem Qualidade, turnos/equipes e as intranets (ambientes
// SharePoint) atribuídas. Regras e limites por perfil são aplicados no backend.

const VAZIO = { possui_qualidade: false, supervisores: [], qualidade: [], intranets: [] };

function Secao({ titulo, resumo, aberta = true, children }) {
  return html`
    <details class="amb-secao" open=${aberta}>
      <summary><span>${titulo}</span>${resumo ? html`<small>${resumo}</small>` : null}</summary>
      <div class="amb-secao-corpo">${children}</div>
    </details>`;
}

// Cor primária e logo próprias da operação (só o Administrador). Valem apenas no ambiente da própria operação.
function SecaoIdentidade({ chave, ativa, onFeedback, onErro }) {
  const [atual, setAtual] = useState(null);
  const [cor, setCor] = useState('#0a4b8c');
  const [ocupado, setOcupado] = useState(false);
  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    let vivo = true;
    listarIdentidadeOperacoes().then((r) => {
      if (!vivo) return;
      const item = (r.itens || []).find((i) => i.chave === chave) || null;
      setAtual(item);
      if (item?.cor_primaria) setCor(item.cor_primaria);
    }).catch(() => vivo && setAtual(null));
    return () => { vivo = false; };
  }, [chave, recarga]);
  const executar = async (fn, msg) => {
    setOcupado(true);
    try { await fn(); onFeedback?.(msg); setRecarga((n) => n + 1); } catch (e) { onErro?.(e?.message || 'Não foi possível salvar a identidade visual.'); } finally { setOcupado(false); }
  };
  return html`
    <${Secao} titulo="Identidade visual" resumo=${atual?.cor_primaria ? atual.cor_primaria : 'Padrão do Conecta'} aberta=${false}>
      <p class="amb-explicacao">A cor primária e a logo valem somente no ambiente desta operação. Cores sem contraste suficiente para botões com texto branco são recusadas.</p>
      <div class="amb-identidade">
        <div class="amb-campo"><span>Cor primária</span>
          <div class="mon-cor-linha"><input type="color" aria-label="Escolher cor" value=${cor} disabled=${!ativa || ocupado} onInput=${(e) => setCor(e.target.value)} />
            <input class="form-control" aria-label="Código da cor" value=${cor} disabled=${!ativa || ocupado} onInput=${(e) => setCor(e.target.value)} /></div>
          <div class="amb-identidade-acoes">
            <button type="button" class="btn btn-primary btn-sm" disabled=${!ativa || ocupado} onClick=${() => executar(() => salvarCorOperacao(chave, cor), 'Cor da operação atualizada.')}>Aplicar cor</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${!ativa || ocupado || !atual?.cor_primaria} onClick=${() => executar(() => salvarCorOperacao(chave, ''), 'Cor removida: a operação usa a cor padrão.')}>Usar cor padrão</button>
          </div>
        </div>
        <label class="amb-campo"><span>Logo (PNG ou JPG, até 1 MB)</span>
          <input type="file" class="form-control" accept=".png,.jpg,.jpeg" disabled=${!ativa || ocupado}
            onChange=${(e) => { const f = e.target.files?.[0]; if (f) executar(() => enviarLogoOperacao(chave, f), 'Logo atualizada.'); e.target.value = ''; }} />
          <div class="amb-identidade-previa">
            ${atual?.logo_arquivo ? html`<img class="mon-logo-preview" alt="Logo da operação" src=${`/monitoria/logos/${atual.logo_arquivo}`} />` : html`<small>Sem logo: usa a logo padrão do Conecta.</small>`}
          </div>
        </label>
      </div>
    </${Secao}>`;
}

export function AbaAmbienteOperacao({ chave, nome, podeEditar, podeEditarOrganizacao, podeIdentidade = false, onFeedback, onErro }) {
  const [dados, setDados] = useState(null);
  const [form, setForm] = useState(VAZIO);
  const [equipes, setEquipes] = useState([]);
  const [turnos, setTurnos] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  const aplicar = (r) => {
    setDados(r);
    setForm({
      possui_qualidade: r.possui_qualidade,
      supervisores: r.supervisores.filter((u) => u.vinculado).map((u) => u.id_usuario),
      qualidade: r.qualidade.filter((u) => u.vinculado).map((u) => u.id_usuario),
      intranets: r.intranets.filter((i) => i.vinculada).map((i) => i.id_ambiente),
    });
  };

  useEffect(() => {
    if (!chave) return undefined;
    let ativo = true;
    setDados(null);
    lerAmbienteOperacao(chave)
      .then((r) => ativo && aplicar(r))
      .catch((e) => ativo && onErro?.(e?.message || 'Não foi possível carregar o ambiente da operação.'));
    return () => { ativo = false; };
  }, [chave]);

  useEffect(() => {
    if (!chave) return undefined;
    let ativo = true;
    listarEquipesMonitoria(chave).then((r) => ativo && setEquipes(r.itens || [])).catch(() => ativo && setEquipes([]));
    listarCatalogoMonitoria('turno', '', true).then((r) => ativo && setTurnos(r.itens || [])).catch(() => ativo && setTurnos([]));
    return () => { ativo = false; };
  }, [chave, recarga]);

  if (!chave) {
    return html`<div class="amb-vazio"><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('apartment')}</span>
      <strong>Selecione uma operação</strong><p>Escolha uma operação na lista ao lado (ou salve o cadastro de uma nova) para configurar o ambiente dela.</p></div>`;
  }
  if (!dados) return html`<${LoadingState} titulo="Carregando o ambiente" />`;

  const definir = (campo, valor) => setForm((atual) => ({ ...atual, [campo]: valor }));
  const opcoesUsuarios = (lista) => lista.map((u) => ({ valor: u.id_usuario, rotulo: `${u.nome}${u.ativo ? '' : ' (inativo)'}`, desabilitado: !u.ativo }));
  const opcoesIntranets = dados.intranets.map((i) => ({
    valor: i.id_ambiente,
    rotulo: `${i.nome}${i.outra_operacao ? ` — hoje em ${i.outra_operacao}` : ''}${i.ativo ? '' : ' (inativa)'}`,
  }));

  // Intranets marcadas que hoje pertencem a outra operação: serão movidas ao salvar.
  const intranetsMovidas = dados.intranets.filter((i) => i.outra_operacao && !i.vinculada && form.intranets.includes(i.id_ambiente));

  const salvar = async () => {
    if (intranetsMovidas.length) {
      const lista = intranetsMovidas.map((i) => `• ${i.nome} (sai de ${i.outra_operacao})`).join('\n');
      if (!window.confirm(`Cada intranet pertence a uma única operação. Ao salvar, estas intranets serão movidas para ${nome || chave}:\n\n${lista}\n\nDeseja continuar?`)) return;
    }
    setSalvando(true);
    try {
      aplicar(await salvarAmbienteOperacao(chave, form));
      onFeedback?.('Ambiente da operação atualizado.');
    } catch (e) {
      onErro?.(e?.message || 'Não foi possível salvar o ambiente.');
    } finally {
      setSalvando(false);
    }
  };
  const executar = async (fn, msg) => {
    try { await fn(); onFeedback?.(msg); setRecarga((n) => n + 1); } catch (e) { onErro?.(e?.message || 'Não foi possível salvar.'); }
  };

  const totais = [
    ['Supervisores', form.supervisores.length],
    ['Qualidade', form.possui_qualidade ? form.qualidade.length : '—'],
    ['Operadores', dados.total_operadores],
    ['Intranets', form.intranets.length],
  ];

  return html`
    <div class="amb">
      ${!dados.ativa ? html`<div class="alert alert-warning amb-aviso" role="alert">Esta operação está inativa: o ambiente fica somente para consulta. Reative-a no Cadastro para alterar.</div>` : null}
      <div class="amb-totais" aria-label=${`Resumo do ambiente ${nome || chave}`}>
        ${totais.map(([rotulo, valor]) => html`<div key=${rotulo} class="amb-total"><strong>${valor}</strong><span>${rotulo}</span></div>`)}
      </div>

      <${Secao} titulo="Supervisão" resumo=${`${form.supervisores.length} supervisor(es)`}>
        <div class="amb-campo"><span>Supervisores da operação</span>
          <${SelectMultiplo} rotulo="Supervisores da operação" opcoes=${opcoesUsuarios(dados.supervisores)} valores=${form.supervisores}
            onChange=${(lista) => definir('supervisores', lista)} desabilitado=${!podeEditar} placeholder="Selecione os supervisores" vazio="Nenhum supervisor cadastrado." />
          <small>A quantidade acima é calculada pela seleção. Um supervisor pode atuar em até 3 operações; para tirar quem ainda supervisiona operadores, use "Transferir supervisão" em Usuários.</small>
        </div>
      </${Secao}>

      <${Secao} titulo="Qualidade" resumo=${form.possui_qualidade ? `${form.qualidade.length} pessoa(s)` : 'Sem Qualidade'}>
        <label class="amb-toggle">
          <input type="checkbox" checked=${form.possui_qualidade} disabled=${!podeEditar}
            onChange=${(e) => setForm((atual) => ({ ...atual, possui_qualidade: e.target.checked, qualidade: e.target.checked ? atual.qualidade : [] }))} />
          <span>Esta operação possui Qualidade</span>
        </label>
        <div class="amb-campo"><span>Pessoas da Qualidade</span>
          <${SelectMultiplo} rotulo="Pessoas da Qualidade" opcoes=${opcoesUsuarios(dados.qualidade)} valores=${form.qualidade}
            onChange=${(lista) => definir('qualidade', lista)} desabilitado=${!podeEditar || !form.possui_qualidade}
            placeholder=${form.possui_qualidade ? 'Selecione as pessoas' : 'Ative "Possui Qualidade" para vincular'} vazio="Nenhum usuário com perfil Qualidade." />
          <small>Cada pessoa da Qualidade pode atuar em até 2 operações.</small>
        </div>
      </${Secao}>

      <${Secao} titulo="Turnos e equipes" resumo=${`${equipes.length} equipe(s) · ${turnos.length} turno(s)`}>
        <p class="amb-explicacao">
          <strong>Equipes</strong> são grupos de operadores <em>desta operação</em> (ex.: "Equipe Manhã"); o operador é colocado na equipe em Configurações › Usuários.
          <strong>Turnos</strong> são um catálogo único, compartilhado por todas as operações (ex.: Manhã, Tarde, Noite).
          Estas listas salvam na hora — não dependem do botão "Salvar ambiente". Inativar esconde o item das novas seleções, mas mantém o histórico.
        </p>
        <div class="amb-listas">
          <${CartaoLista} titulo="Equipes desta operação" placeholder="Nova equipe" vazio="Nenhuma equipe nesta operação." podeEditar=${podeEditarOrganizacao}
            itens=${equipes.map((e) => ({ id: e.id_equipe, nome: e.nome, ativo: e.ativo, detalhe: `${e.membros} membro(s)` }))}
            aoAlternar=${(e) => executar(() => salvarEquipeMonitoria({ nome: e.nome, ativo: !e.ativo }, e.id), e.ativo ? 'Equipe inativada.' : 'Equipe ativada.')}
            aoAdicionar=${(nomeEquipe) => executar(() => salvarEquipeMonitoria({ operacao: chave, nome: nomeEquipe }), 'Equipe criada.')} />
          <${CartaoLista} titulo="Turnos (valem para todas as operações)" placeholder="Novo turno" vazio="Nenhum turno cadastrado." podeEditar=${podeEditarOrganizacao}
            itens=${turnos.map((t) => ({ id: t.id_item, nome: t.valor, ativo: t.ativo }))}
            aoAlternar=${(t) => executar(() => salvarCatalogoMonitoria({ tipo: 'turno', operacao: '', valor: t.nome, ativo: !t.ativo }, t.id), t.ativo ? 'Turno inativado.' : 'Turno ativado.')}
            aoAdicionar=${(valor) => executar(() => salvarCatalogoMonitoria({ tipo: 'turno', operacao: '', valor }), 'Turno adicionado.')} />
        </div>
        ${!podeEditarOrganizacao ? html`<small>Somente o Administrador cria turnos e equipes.</small>` : null}
      </${Secao}>

      <${Secao} titulo="Intranets (SharePoint)" resumo=${`${form.intranets.length} atribuída(s)`}>
        <div class="amb-campo"><span>Intranets desta operação</span>
          <${SelectMultiplo} rotulo="Intranets desta operação" opcoes=${opcoesIntranets} valores=${form.intranets}
            onChange=${(lista) => definir('intranets', lista)} desabilitado=${!podeEditar} placeholder="Selecione as intranets"
            vazio="Nenhuma intranet cadastrada em Parâmetros > Conectores Externos." />
          <small>Cada intranet pertence a uma única operação: marcar uma que hoje está em outra operação a move para esta.</small>
          ${intranetsMovidas.length ? html`<div class="alert alert-warning amb-aviso" role="alert">
            ${intranetsMovidas.map((i) => html`<div key=${i.id_ambiente}><strong>${i.nome}</strong> será movida de <strong>${i.outra_operacao}</strong> para esta operação ao salvar.</div>`)}
          </div>` : null}
        </div>
      </${Secao}>

      ${podeIdentidade ? html`<${SecaoIdentidade} chave=${chave} ativa=${dados.ativa} onFeedback=${onFeedback} onErro=${onErro} />` : null}

      <div class="amb-rodape">
        <button type="button" class="btn btn-primary btn-sm" disabled=${!podeEditar || salvando || !dados.ativa} onClick=${salvar}>
          <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('check')}</span>${salvando ? 'Salvando…' : 'Salvar ambiente'}
        </button>
        ${!dados.ativa ? html`<small>Operação inativa: nenhuma alteração é permitida.</small>` : null}
      </div>
    </div>`;
}
