// Auditoria › Senhas e acessos (fluxo de senha, amostra aprovada em 26/11/2026, quadro 7).
// Logins, trocas, pedidos de "Esqueci a senha", bloqueios e sessões derrubadas. Filtro e paginação no servidor,
// 20 por página, para a lista nunca ficar comprida. Exporta o que está filtrado.
import { html, useEffect, useState } from '../../infraestrutura-react.js?v=20261126-senha';
import { Estado, Esqueleto, Ic, Selo } from '../../ui/components/ds.js?v=20261126-senha';
import { baixarSenhasAcessos, listarSenhasAcessos } from '../../services/api/settings.js?v=20261126-senha';
import { baixarBlob } from '../../utilitarios.js?v=20261126-senha';

const TIPOS = [['', 'Tipo: todos'], ['logins', 'Logins'], ['senhas', 'Senhas'], ['sessoes', 'Sessões']];
const PERIODOS = [['hoje', 'Hoje'], ['7d', 'Últimos 7 dias'], ['30d', 'Últimos 30 dias'], ['90d', 'Últimos 90 dias']];
const RESULTADOS = [['', 'Resultado: todos'], ['sucesso', 'Deu certo'], ['falha', 'Negado']];

const quando = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

export function AbaSenhasAcessos({ podeExportar = false }) {
  const [filtros, setFiltros] = useState({ tipo: '', periodo: '7d', resultado: '', busca: '' });
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [buscaDigitada, setBuscaDigitada] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setFiltros((f) => (f.busca === buscaDigitada ? f : { ...f, busca: buscaDigitada }));
      setPagina(1);
    }, 350);
    return () => clearTimeout(t);
  }, [buscaDigitada]);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro('');
    listarSenhasAcessos({ ...filtros, pagina, tamanho: 20 })
      .then((r) => { if (ativo) setDados(r); })
      .catch((e) => { if (ativo) setErro(e?.message || 'Não foi possível carregar os eventos.'); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [filtros, pagina]);

  const mudar = (campo, valor) => {
    setFiltros({ ...filtros, [campo]: valor });
    setPagina(1);
  };

  const exportar = async () => {
    try {
      const arquivo = await baixarSenhasAcessos(filtros);
      baixarBlob(arquivo.filename || 'senhas_e_acessos.csv', arquivo.blob);
    } catch (e) {
      setErro(e?.message || 'Não foi possível exportar.');
    }
  };

  const sel = (campo, opcoes, rotulo) => html`<select class="c-entrada c-entrada--compacta" aria-label=${rotulo} value=${filtros[campo]}
    onChange=${(e) => mudar(campo, e.target.value)}>${opcoes.map(([v, r]) => html`<option key=${v} value=${v}>${r}</option>`)}</select>`;

  const itens = dados?.itens || [];
  return html`<div class="c-ds c-senhas-acessos">
    <div class="c-cab-linha">
      <span class="c-ajuda">Logins, trocas de senha, pedidos de "Esqueci a senha", bloqueios e sessões encerradas.</span>
      <div class="c-cab-dir">
        ${podeExportar ? html`<button class="c-botao c-botao--secundario" type="button" onClick=${exportar}><${Ic} nome="tray-arrow-down" />Exportar</button>` : null}
      </div>
    </div>
    <div class="c-tabela-caixa">
      <div class="c-filtros c-filtros--suave">
        <div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" />
          <input class="c-entrada c-entrada--compacta" type="search" placeholder="Buscar pessoa ou login" aria-label="Buscar pessoa ou login"
            value=${buscaDigitada} onInput=${(e) => setBuscaDigitada(e.target.value)} />
        </div>
        ${sel('tipo', TIPOS, 'Tipo')}
        ${sel('periodo', PERIODOS, 'Período')}
        ${sel('resultado', RESULTADOS, 'Resultado')}
      </div>
      ${erro ? html`<${Estado} titulo="Não foi possível carregar" texto=${erro} icone="warning" />`
    : !dados ? html`<${Esqueleto} linhas=${6} />`
      : !itens.length ? html`<${Estado} titulo="Nenhum evento" texto="Nada com esses filtros. Tente outro período." icone="clock-counter-clockwise" />`
        : html`<table class="c-tabela c-tabela--justa" aria-busy=${carregando ? 'true' : 'false'}>
          <thead><tr><th>Quando</th><th class="c-col-nome">Evento</th><th>Conta</th><th>Feito por</th><th>Rede</th><th>Resultado</th></tr></thead>
          <tbody>${itens.map((i) => html`<tr key=${i.id} title=${i.detalhe || ''}>
            <td class="c-num">${quando(i.quando)}</td>
            <td class="c-forte">${i.evento}${i.detalhe ? html`<small class="c-nf-desc">${i.detalhe}</small>` : null}</td>
            <td>${i.conta}${i.conta_login && i.conta_login !== i.conta ? html`<small class="c-nf-desc">${i.conta_login}</small>` : null}</td>
            <td class="c-secundario">${i.feito_por}</td>
            <td class="c-num c-secundario">${i.rede || '—'}</td>
            <td>${i.sucesso ? html`<${Selo} tom="sucesso">Deu certo<//>` : html`<${Selo} tom=${i.acao === 'conta_bloqueada' ? 'perigo' : 'atencao'}>${i.acao === 'conta_bloqueada' ? 'Bloqueado 15 min' : 'Negado'}<//>`}</td>
          </tr>`)}</tbody>
        </table>`}
      ${dados && itens.length ? html`<div class="c-tabela-rodape">
        <span>${itens.length} de ${dados.total} evento${dados.total === 1 ? '' : 's'} · página ${dados.pagina} de ${dados.paginas}</span>
        <div class="c-grupo">
          <button class="c-botao c-botao--texto c-botao--compacto" type="button" disabled=${pagina <= 1 || carregando} onClick=${() => setPagina(pagina - 1)}>Anterior</button>
          <button class="c-botao c-botao--texto c-botao--compacto" type="button" disabled=${pagina >= dados.paginas || carregando} onClick=${() => setPagina(pagina + 1)}>Próxima</button>
        </div>
      </div>` : null}
    </div>
  </div>`;
}
