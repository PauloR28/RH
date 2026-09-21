import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { LoadingState } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import {
  lerAmbienteOperacao,
  listarCatalogoMonitoria,
  listarEquipesMonitoria,
  salvarAmbienteOperacao,
  salvarCatalogoMonitoria,
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

export function AbaAmbienteOperacao({ chave, nome, podeEditar, podeEditarOrganizacao, onFeedback, onErro }) {
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

  const salvar = async () => {
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
        </div>
      </${Secao}>

      <div class="amb-rodape">
        <button type="button" class="btn btn-primary btn-sm" disabled=${!podeEditar || salvando || !dados.ativa} onClick=${salvar}>
          <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('check')}</span>${salvando ? 'Salvando…' : 'Salvar ambiente'}
        </button>
        ${!dados.ativa ? html`<small>Operação inativa: nenhuma alteração é permitida.</small>` : null}
      </div>
    </div>`;
}
