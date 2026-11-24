// Janela Perfis da tela Acessos (reestruturação, Etapa 9 — amostra aprovada em 21/nov/2026).
// Uma janela, não uma página: lista os perfis (funciona como, pessoas), cria, renomeia e apaga. As ações ficam no botão ⋯
// (MenuAcoes, como nas outras áreas); o perfil fixo mostra só o cadeado. As permissões continuam só na tabela de Acessos.
import { html, useEffect, useState } from '../../infraestrutura-react.js?v=20261124-equipes4';
import { Ic, Janela, JanelaForm, MenuAcoes, Selo } from '../../ui/components/ds.js?v=20261124-equipes4';
import { apagarPerfil, criarPerfil, editarPerfil, listarPerfisAtualizados } from '../../services/api/settings.js?v=20261124-equipes4';

const AJUDA_FUNCIONA = 'Diz como o Conecta trata as pessoas deste perfil: quem pode liderar equipe, quem é avaliado na Monitoria, quem entra na escala.';
const AJUDA_COPIA = 'Copia permissões, alcance e Início. Depois você ajusta na tela Acessos.';

function FormPerfil({ perfil, perfis, aoFechar, aoSalvar }) {
  const novo = !perfil;
  const bases = perfis.filter((p) => !p.criado && p.id !== 'candidato');
  const [dados, setDados] = useState(() => ({
    nome: perfil?.nome || '', descricao: perfil?.descricao || '',
    funciona_como: perfil?.funciona_como || 'supervisor', copiar_de: perfil?.funciona_como || 'supervisor',
  }));
  const [copiaMexida, setCopiaMexida] = useState(false);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const mudar = (campo) => (e) => {
    const valor = e.target.value;
    setDados((d) => ({ ...d, [campo]: valor, ...(campo === 'funciona_como' && !copiaMexida ? { copiar_de: valor } : {}) }));
    if (campo === 'copiar_de') setCopiaMexida(true);
  };
  const enviar = async (ev) => {
    ev.preventDefault();
    if (dados.nome.trim().length < 2) { setErro('Dê um nome ao perfil.'); return; }
    setSalvando(true);
    setErro('');
    try {
      if (novo) await criarPerfil(dados);
      else await editarPerfil(perfil.id, { nome: dados.nome, descricao: dados.descricao });
      aoSalvar(novo ? `Perfil ${dados.nome} criado. A coluna dele já está em Acessos.` : 'Perfil salvo.');
    } catch (e) {
      setErro(e?.message || 'Não foi possível salvar o perfil.');
      setSalvando(false);
    }
  };
  return html`<${JanelaForm} titulo=${novo ? 'Novo perfil' : `Editar ${perfil.nome}`} onClose=${aoFechar} onSubmit=${enviar} erro=${erro} salvando=${salvando}
    salvarRotulo=${novo ? 'Criar perfil' : 'Salvar'}>
    <div style=${{ display: 'grid', gap: 'var(--espaco-4)' }}>
      <label class="c-campo"><span class="c-rotulo">Nome</span><input class="c-entrada" maxLength="80" value=${dados.nome} onInput=${mudar('nome')} autoFocus /></label>
      <label class="c-campo"><span class="c-rotulo">Descrição <span class="c-opcional">(opcional)</span></span><input class="c-entrada" maxLength="500" value=${dados.descricao} onInput=${mudar('descricao')} /></label>
      ${novo ? html`
        <label class="c-campo"><span class="c-rotulo">Funciona como</span>
          <select class="c-entrada" value=${dados.funciona_como} onChange=${mudar('funciona_como')}>${bases.map((p) => html`<option key=${p.id} value=${p.id}>${p.nome}</option>`)}</select>
          <span class="c-ajuda">${AJUDA_FUNCIONA}</span></label>
        <label class="c-campo"><span class="c-rotulo">Começar com as permissões de</span>
          <select class="c-entrada" value=${dados.copiar_de} onChange=${mudar('copiar_de')}>${perfis.filter((p) => p.id !== 'candidato').map((p) => html`<option key=${p.id} value=${p.id}>${p.nome}</option>`)}</select>
          <span class="c-ajuda">${AJUDA_COPIA}</span></label>`
        : html`<p class="c-secundario">Funciona como <strong>${(perfis.find((p) => p.id === perfil.funciona_como) || {}).nome || perfil.funciona_como}</strong>. Para mudar o que ele pode fazer, use a tabela de Acessos.</p>`}
    </div>
  <//>`;
}

export function JanelaPerfis({ podeEditar, aoFechar, aoMudar }) {
  const [perfis, setPerfis] = useState(null);
  const [busca, setBusca] = useState('');
  const [form, setForm] = useState(null); // null | { perfil: null (novo) | perfil }
  const [apagando, setApagando] = useState(null);
  const [mensagem, setMensagem] = useState({ tipo: '', texto: '' });
  const carregar = () => listarPerfisAtualizados()
    .then((lista) => setPerfis((Array.isArray(lista) ? lista : []).filter((p) => !p.oculto)))
    .catch((e) => setMensagem({ tipo: 'erro', texto: e?.message || 'Não foi possível ler os perfis.' }));
  useEffect(() => { carregar(); }, []);

  const nomeDe = (id) => (perfis || []).find((p) => p.id === id)?.nome || id;
  const termo = busca.trim().toLowerCase();
  const visiveis = (perfis || []).filter((p) => p.id !== 'candidato' && (!termo || p.nome.toLowerCase().includes(termo)));
  const depois = (texto) => { setForm(null); setMensagem({ tipo: 'ok', texto }); carregar(); aoMudar?.(); };
  const confirmarApagar = async () => {
    const p = apagando;
    try {
      await apagarPerfil(p.id);
      setApagando(null);
      depois(`Perfil ${p.nome} apagado.`);
    } catch (e) {
      setApagando(null);
      setMensagem({ tipo: 'erro', texto: e?.message || 'Não foi possível apagar o perfil.' });
    }
  };

  if (form) return html`<${FormPerfil} perfil=${form.perfil} perfis=${perfis || []} aoFechar=${() => setForm(null)} aoSalvar=${depois} />`;
  return html`<${Janela} titulo="Perfis" tamanho="grande" onClose=${aoFechar}>
    <div class="c-janela-corpo" style=${{ display: 'grid', gap: 'var(--espaco-3)' }}>
      <p>Os perfis que aparecem como colunas em Acessos. As permissões de cada um continuam sendo marcadas na tela Acessos.</p>
      ${mensagem.texto ? html`<div class=${`c-faixa c-faixa--${mensagem.tipo === 'erro' ? 'perigo' : 'informacao'}`} role=${mensagem.tipo === 'erro' ? 'alert' : 'status'}><div class="c-faixa-txt"><p>${mensagem.texto}</p></div></div>` : null}
      ${apagando ? html`<div class="c-faixa c-faixa--atencao c-acessos-faixa" role="alertdialog">
        <${Ic} nome="warning" /><span class="c-faixa-txt">Apagar o perfil <strong>${apagando.nome}</strong>? Ele não tem ninguém. As permissões dele somem junto.</span>
        <button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => setApagando(null)}>Cancelar</button>
        <button type="button" class="c-botao c-botao--perigo c-botao--compacto" onClick=${confirmarApagar}>Apagar</button>
      </div>` : null}
      <div class="c-grupo" style=${{ justifyContent: 'space-between' }}>
        <label class="c-com-icone c-acessos-busca"><${Ic} nome="magnifying-glass" /><input class="c-entrada" type="search" placeholder="Buscar perfil" aria-label="Buscar perfil" value=${busca} onInput=${(e) => setBusca(e.target.value)} /></label>
        ${podeEditar ? html`<button type="button" class="c-botao c-botao--principal" onClick=${() => setForm({ perfil: null })}><${Ic} nome="plus" />Novo perfil</button>` : null}
      </div>
      ${!perfis ? html`<div class="c-esqueleto" aria-busy="true"></div>` : html`<div class="c-tabela-caixa"><table class="c-tabela c-tabela--compacta">
        <thead><tr><th scope="col">Perfil</th><th scope="col">Funciona como</th><th scope="col" class="c-num">Pessoas</th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead>
        <tbody>${visiveis.map((p) => html`<tr key=${p.id}>
          <td class="c-forte">${p.nome}${p.criado ? html` <${Selo} tom="informacao">Novo<//>` : null}</td>
          <td>${p.funciona_como === p.id ? html`<span class="c-secundario">ele mesmo</span>` : nomeDe(p.funciona_como)}</td>
          <td class="c-num">${p.pessoas ? p.pessoas : html`<${Selo} tom="atencao">0<//>`}</td>
          <td class="c-acoes">${p.fixo ? html`<span class="c-acessos-cadeado" role="img" aria-label="Perfil fixo" title="Perfil fixo: não pode ser editado nem apagado"><${Ic} nome="lock" /></span>`
            : podeEditar ? html`<${MenuAcoes} rotulo=${`Ações de ${p.nome}`} acoes=${[
              { label: 'Editar', icon: 'pencil-simple', onClick: () => setForm({ perfil: p }) },
              p.pessoas ? null : { label: 'Apagar', icon: 'trash', perigo: true, onClick: () => setApagando(p) },
            ]} />` : null}</td>
        </tr>`)}</tbody></table></div>`}
      <p class="c-secundario">O botão ⋯ junta as ações. Apagar só aparece em perfil sem ninguém. O cadeado marca o perfil fixo.</p>
    </div>
  <//>`;
}
