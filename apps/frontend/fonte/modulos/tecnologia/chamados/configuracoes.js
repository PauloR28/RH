import { html, useCallback, useEffect, useState } from '../../../infraestrutura-react.js';
import { LoadingState } from '../../../ui/componentes-compartilhados.js';
import { atualizarCategoriaChamado, criarCategoriaChamado, lerConfigChamados, salvarConfigChamados } from '../../../services/api/chamados.js';
import { EstadoErro, Icone } from './comum.js';

// Configurações (`chamados.configurar`): prazos de SLA por urgência, encerramento automático, limites de anexo e categorias.
// Nada fica fixo no código. Alterar um prazo vale só para chamados novos.

const CAMPOS_SLA = [
  { chave: 'sla_horas_critica', rotulo: 'Crítica' },
  { chave: 'sla_horas_alta', rotulo: 'Alta' },
  { chave: 'sla_horas_media', rotulo: 'Média' },
  { chave: 'sla_horas_baixa', rotulo: 'Baixa' },
];
const CAMPOS_OUTROS = [
  { chave: 'encerramento_auto_horas', rotulo: 'Encerrar automaticamente após', sufixo: 'horas sem validação', passo: 1 },
  { chave: 'anexo_max_mb', rotulo: 'Tamanho máximo por arquivo', sufixo: 'MB', passo: 1 },
  { chave: 'anexo_max_mb_chamado', rotulo: 'Total de anexos por chamado', sufixo: 'MB', passo: 1 },
  { chave: 'anexo_retencao_exclusao_dias', rotulo: 'Guardar anexos apagados por', sufixo: 'dias', passo: 1 },
];

function Campo({ chave, rotulo, sufixo = 'horas', valor, aoMudar }) {
  return html`
    <label class="chm-campo-num"><span>${rotulo}</span>
      <div class="chm-num"><input type="number" min="0" step="any" value=${valor ?? ''} onInput=${(e) => aoMudar(chave, e.target.value)} aria-label=${rotulo} /><small>${sufixo}</small></div>
    </label>`;
}

export function ConfiguracoesChamados({ showToast }) {
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

  const alterado = dados && Object.keys(valores).some((k) => String(valores[k]) !== String(dados.config[k]));
  const salvar = async () => {
    setSalvando(true);
    try {
      const enviar = {};
      Object.keys(valores).forEach((k) => { enviar[k] = Number(valores[k]); });
      await salvarConfigChamados(enviar);
      showToast('Configurações salvas.', 'success');
      carregar();
    } catch (ex) {
      showToast(ex?.message || 'Não foi possível salvar.', 'error');
    } finally {
      setSalvando(false);
    }
  };

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
  if (!dados) return html`<${LoadingState} titulo="Carregando configurações" />`;
  const mudar = (chave, valor) => setValores((v) => ({ ...v, [chave]: valor }));

  return html`
    <div class="chm-pagina chm-config">
      <section class="chm-card chm-card--form">
        <h3>Prazos de SLA por urgência</h3>
        <p class="chm-ajuda">Tempo máximo para solução, contado em horas corridas. Vale apenas para chamados novos; os já abertos mantêm o prazo gravado.</p>
        <div class="chm-grade-num">${CAMPOS_SLA.map((c) => html`<${Campo} key=${c.chave} ...${c} valor=${valores[c.chave]} aoMudar=${mudar} />`)}</div>
      </section>
      <section class="chm-card chm-card--form">
        <h3>Encerramento e anexos</h3>
        <div class="chm-grade-num chm-grade-num--col">${CAMPOS_OUTROS.map((c) => html`<${Campo} key=${c.chave} ...${c} valor=${valores[c.chave]} aoMudar=${mudar} />`)}</div>
      </section>
      <div class="chm-rodape-form chm-rodape-form--solto">
        <button type="button" class="btn btn-outline-secondary" disabled=${!alterado || salvando} onClick=${() => setValores(dados.config)}>Descartar</button>
        <button type="button" class="btn btn-primary" disabled=${!alterado || salvando} onClick=${salvar}>${salvando ? 'Salvando…' : 'Salvar alterações'}</button>
      </div>

      <section class="chm-card chm-card--form">
        <h3>Categorias</h3>
        <ul class="chm-categorias">
          ${dados.categorias.map((c) => html`
            <li key=${c.id} class=${c.ativo ? '' : 'is-inativa'}>
              <span>${c.nome}</span>
              <button type="button" role="switch" aria-checked=${c.ativo} aria-label=${`Categoria ${c.nome}`} class=${`tec-switch ${c.ativo ? 'is-on' : ''}`.trim()} onClick=${() => alternar(c)}></button>
            </li>`)}
        </ul>
        <div class="chm-nova-categoria">
          <input class="chm-input" maxlength="80" value=${novaCategoria} placeholder="Nova categoria" aria-label="Nova categoria"
            onInput=${(e) => setNovaCategoria(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') incluirCategoria(); }} />
          <button type="button" class="btn btn-outline-secondary" disabled=${!novaCategoria.trim()} onClick=${incluirCategoria}><${Icone} nome="add" />Adicionar</button>
        </div>
        <p class="chm-ajuda">Categorias desativadas deixam de aparecer para novos chamados, mas continuam nos já abertos.</p>
      </section>
    </div>`;
}
