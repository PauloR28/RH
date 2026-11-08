import { html, useEffect, useState } from '../../../infraestrutura-react.js';
import { PainelRh } from '../../../ui/componentes-compartilhados.js';
import { useToast } from '../../../shared/hooks/use-toast.js';
import { aceitarTermosDiario, lerContextoDiario } from '../../../services/api/diario.js';
import { Esqueleto, Estado, Ic } from '../../../ui/components/ds.js?v=20261106-wfm';
import { AbaHoje } from './hoje.js';
import { AbaHistorico } from './historico.js';
import { AbaCadastros } from './cadastros.js';
import { tomarDiaPedido } from './ligacoes.js';

// Diário de bordo (seção própria na barra de cima, D1 aprovada em 08/11/2026): Hoje · Histórico · Cadastros.
// O registro do DIA DA OPERAÇÃO por turno (não é o "Diário do operador" de Equipes, que é sobre uma pessoa).

export { pedirDiaDiario } from './ligacoes.js';

function Termos({ onAceitar }) {
  const [li, setLi] = useState(false);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const aceitar = async () => {
    setSalvando(true); setErro('');
    try { await onAceitar(); } catch (e) { setErro(e?.message || 'Não foi possível registrar o aceite.'); setSalvando(false); }
  };
  const ITENS = [
    ['Para que serve.', 'O Diário de bordo registra o dia da operação: demandas, nível de serviço, intercorrências e o fechamento de cada turno. É uma ferramenta interna da Central 24 Horas.'],
    ['Onde ficam os dados.', 'Os registros ficam no banco de dados do Conecta, nos servidores da empresa. Não ficam no seu navegador. Quem tem permissão vê os mesmos dados em qualquer computador.'],
    ['Quem vê e quem muda.', 'O acesso segue o seu perfil no Conecta. Cada registro guarda quem fez, quando e o que mudou. Reabrir um turno pede motivo.'],
    ['Dados pessoais (LGPD).', 'Escreva só o necessário para a operação. Não coloque nome, CPF, telefone ou outro dado de cliente nos campos de texto. O tratamento tem como base o legítimo interesse na gestão da operação.'],
    ['Fechamento para o grupo.', 'A imagem e o texto saem dos dados salvos. Você é responsável por enviar só ao grupo autorizado.'],
    ['Guarda dos dados.', 'Os registros ficam guardados pelo prazo definido pela empresa.'],
  ];
  return html`<div class="c-tabela-caixa c-db-termos">
    <div class="c-db-bloco-cab"><h3>Diário de bordo · Termos de uso</h3></div>
    <div class="c-db-bloco-corpo">
      <ol class="c-db-termos-lista">${ITENS.map(([t, x]) => html`<li key=${t}><b>${t}</b> ${x}</li>`)}</ol>
      <label class="c-marcar"><input type="checkbox" checked=${li} onChange=${(e) => setLi(e.target.checked)} /> Li e concordo.</label>
      ${erro ? html`<div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${erro}</p></div></div>` : null}
      <div><button type="button" class="c-botao c-botao--principal" disabled=${!li || salvando || null} onClick=${aceitar}>${salvando ? 'Registrando…' : 'Aceitar e continuar'}</button></div>
      <span class="c-ajuda">Aparece uma vez. O aceite fica guardado com data e hora.</span>
    </div></div>`;
}

export function TelaDiario({ controlador, telaAtual = 'screen-diario' }) {
  const { showToast, ToastHost } = useToast();
  const [contexto, setContexto] = useState(null);
  const [erro, setErro] = useState('');
  const [operacao, setOperacao] = useState('');
  const [data, setData] = useState('');

  useEffect(() => {
    lerContextoDiario().then((c) => {
      const pedido = tomarDiaPedido();
      setContexto(c);
      setOperacao((pedido && c.operacoes.some((o) => o.chave === pedido.operacao) ? pedido.operacao : '') || c.operacoes[0]?.chave || '');
      setData(pedido?.data || c.hoje);
    }).catch((e) => setErro(e?.message || 'Não foi possível abrir o Diário de bordo.'));
  }, []);

  const irParaDia = (dia) => { setData(dia); controlador.irParaTelaProtegida('screen-diario'); };

  let corpo;
  if (erro) corpo = html`<div class="c-tabela-caixa"><${Estado} titulo=${erro} /></div>`;
  else if (!contexto) corpo = html`<div class="c-tabela-caixa"><${Esqueleto} linhas=${6} /></div>`;
  else if (!contexto.termos_aceitos_em) corpo = html`<div class="c-cab-linha"><h1>Diário de bordo</h1></div><${Termos} onAceitar=${async () => { const r = await aceitarTermosDiario(); setContexto((c) => ({ ...c, ...r })); }} />`;
  else if (!contexto.operacoes.length) corpo = html`<div class="c-cab-linha"><h1>Diário de bordo</h1></div><div class="c-tabela-caixa"><${Estado} icone="notebook" titulo="Nenhuma operação com Diário de bordo no seu acesso" texto="O diário começa na CRF / Flamengo. Peça a quem administra para liberar a operação." /></div>`;
  else {
    const props = { contexto, operacao, setOperacao, controlador, showToast };
    corpo = telaAtual === 'screen-diario-historico' ? html`<${AbaHistorico} ...${props} irParaDia=${irParaDia} />`
      : telaAtual === 'screen-diario-cadastros' ? html`<${AbaCadastros} ...${props} />`
        : html`<${AbaHoje} ...${props} data=${data} setData=${setData} />`;
  }

  return html`<${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Diário de bordo" placeholderBusca="Diário de bordo" controlador=${controlador}>
    <${ToastHost} />
    <main class="c-pagina c-conteudo c-pd c-db">${corpo}</main>
  </${PainelRh}>`;
}
