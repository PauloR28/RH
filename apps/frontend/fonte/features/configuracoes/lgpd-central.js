// Configurações do Conecta › LGPD (reestruturação, Etapa 7c — amostra aprovada em 17/nov/2026).
// Regra do Paulo: TODA retenção de dado sensível, de qualquer módulo, é configurada aqui. Nenhuma outra tela tem prazo.
// Os 3 tipos de candidato usam a configuração que já existia (/settings/lgpd/retencao); os demais, /settings/lgpd/dados.
import { html, useEffect, useState } from '../../infraestrutura-react.js?v=20261124-cache';
import { PainelRh } from '../../ui/componentes-compartilhados.js?v=20261124-cache';
import { Ic, Segmento, Selo } from '../../ui/components/ds.js?v=20261124-cache';
import { requisitar } from '../../services/api/core.js?v=20261124-cache';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const api = {
  dados: () => requisitar('/settings/lgpd/dados', { method: 'GET' }),
  salvarDados: (mudancas) => requisitar('/settings/lgpd/dados', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ mudancas }) }),
  contagens: () => requisitar('/settings/lgpd/dados/simulacao', { method: 'GET' }),
  salvarCandidatos: (dados) => requisitar('/settings/lgpd/retencao', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(dados) }),
  simularCandidatos: () => requisitar('/settings/lgpd/retencao/simulacao', { method: 'GET' }),
  executarCandidatos: (confirmacao) => requisitar('/settings/lgpd/retencao/executar', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ confirmacao }) }),
};

const MODULOS = [['todos', 'Todos'], ['rh', 'RH'], ['operacao', 'Operação'], ['tecnologia', 'Tecnologia']];
const NOME_MODULO = { rh: 'RH', operacao: 'Operação', tecnologia: 'Tecnologia' };
const CAMPOS_CANDIDATOS = ['ativo', 'meses_candidatura', 'meses_banco_talentos', 'dias_aviso', 'excluir_cvs_nao_vinculados'];
const dataHora = (v) => (v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

function situacao(tipo) {
  if (tipo.origem === 'futuro') return ['neutro', 'Quando o chat entrar'];
  if (tipo.origem === 'seguranca') return ['neutro', 'Vem da Segurança'];
  if (tipo.origem === 'logs') return ['neutro', 'Vem dos Logs (servidor)'];
  if (!tipo.rotina) return ['atencao', 'Rotina em construção'];
  return tipo.ativo ? ['sucesso', 'Rotina ligada'] : ['neutro', 'Rotina desligada'];
}

export function TelaLgpdCentral({ controlador }) {
  const podeVer = controlador.possuiPermissao('lgpd.visualizar');
  const podeEditar = controlador.possuiPermissao('lgpd.configurar');
  const podeExecutar = podeEditar && controlador.possuiPermissao('lgpd.anonimizar');
  const [base, setBase] = useState(null); // { tipos, candidatos } como veio do servidor
  const [tipos, setTipos] = useState({}); // rascunho dos tipos do catálogo: id -> { ativo, meses, acao }
  const [cand, setCand] = useState(null); // rascunho da configuração de candidatos
  const [filtro, setFiltro] = useState('todos');
  const [contagens, setContagens] = useState(null);
  const [previa, setPrevia] = useState(null);
  const [confirmacao, setConfirmacao] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [mensagem, setMensagem] = useState({ tipo: '', texto: '' });

  const carregar = async () => {
    try {
      const dados = await api.dados();
      setBase(dados);
      setTipos(Object.fromEntries(dados.tipos.filter((t) => t.origem === 'catalogo').map((t) => [t.id, { ativo: t.ativo, meses: t.meses, acao: t.acao }])));
      setCand(Object.fromEntries(CAMPOS_CANDIDATOS.map((c) => [c, dados.candidatos[c]])));
    } catch (erro) {
      setMensagem({ tipo: 'erro', texto: erro?.message || 'Não foi possível carregar a LGPD.' });
    }
  };
  useEffect(() => { if (podeVer) carregar(); }, []);

  const mudancasTipos = base ? Object.fromEntries(base.tipos.filter((t) => t.origem === 'catalogo')
    .filter((t) => ['ativo', 'meses', 'acao'].some((c) => tipos[t.id]?.[c] !== t[c])).map((t) => [t.id, tipos[t.id]])) : {};
  const candAlterado = base && cand ? CAMPOS_CANDIDATOS.some((c) => cand[c] !== base.candidatos[c]) : false;
  const total = Object.keys(mudancasTipos).length + (candAlterado ? 1 : 0);

  const acao = async (nome, fn, sucesso) => {
    setOcupado(nome);
    setMensagem({ tipo: '', texto: '' });
    try {
      const r = await fn();
      if (sucesso) setMensagem({ tipo: 'ok', texto: typeof sucesso === 'function' ? sucesso(r) : sucesso });
      return r;
    } catch (erro) {
      setMensagem({ tipo: 'erro', texto: erro?.message || 'Não foi possível concluir.' });
      return null;
    } finally {
      setOcupado('');
    }
  };
  const salvar = () => acao('salvar', async () => {
    if (Object.keys(mudancasTipos).length) await api.salvarDados(mudancasTipos);
    if (candAlterado) await api.salvarCandidatos(cand);
    await carregar();
  }, 'LGPD salva.');
  const simular = () => acao('simular', async () => {
    const [c, p] = await Promise.all([api.contagens(), api.simularCandidatos()]);
    setContagens(c.contagens || {});
    setPrevia(p);
  });
  const executar = () => acao('executar', async () => {
    const r = await api.executarCandidatos(confirmacao);
    setConfirmacao('');
    setPrevia(null);
    await carregar();
    return r;
  }, (r) => `Execução concluída: ${r.candidaturas_excluidas} candidatura(s) excluída(s), ${r.avisos_enviados} aviso(s) enviado(s).`);

  // Valor e edição de cada linha, conforme de onde a regra vem.
  const valor = (t) => {
    if (t.origem === 'catalogo') return tipos[t.id] || t;
    if (t.origem === 'candidatos' && cand) {
      const meses = t.id === 'banco_talentos' ? cand.meses_banco_talentos : cand.meses_candidatura;
      const ativo = Boolean(cand.ativo) && (t.id !== 'cvs_email' || Boolean(cand.excluir_cvs_nao_vinculados));
      return { ativo, meses, acao: t.acao };
    }
    return t;
  };
  const mudarMeses = (t, n) => {
    if (t.origem === 'catalogo') setTipos({ ...tipos, [t.id]: { ...tipos[t.id], meses: n } });
    else if (t.id === 'banco_talentos') setCand({ ...cand, meses_banco_talentos: n });
    else if (t.id === 'candidaturas') setCand({ ...cand, meses_candidatura: n });
  };
  const mudarLigado = (t, on) => {
    if (t.origem === 'catalogo') setTipos({ ...tipos, [t.id]: { ...tipos[t.id], ativo: on } });
    else if (t.id === 'cvs_email') setCand({ ...cand, excluir_cvs_nao_vinculados: on, ativo: on ? true : cand.ativo });
    else setCand({ ...cand, ativo: on });
  };
  const editaMeses = (t) => podeEditar && (t.origem === 'catalogo' || t.id === 'candidaturas' || t.id === 'banco_talentos');
  const editaLigado = (t) => podeEditar && ((t.origem === 'catalogo' && t.rotina) || t.origem === 'candidatos');

  const visiveis = (base?.tipos || []).filter((t) => filtro === 'todos' || t.modulo === filtro);
  const grupos = ['rh', 'operacao', 'tecnologia'].map((m) => [m, visiveis.filter((t) => t.modulo === m)]).filter(([, l]) => l.length);
  const ultimo = base?.candidatos?.ultimo_resultado;

  return html`
    <${PainelRh} screenId="screen-settings-lgpd" navAtiva="screen-settings-lgpd" controlador=${controlador} placeholderBusca="LGPD">
      <section class="c-cartao c-cfg-cartao" aria-label="LGPD">
        <header><h2>LGPD</h2><p>Todo dado sensível que o Conecta guarda, de qualquer módulo, com o prazo e o que acontece depois.</p></header>
        ${!podeVer ? html`<div class="c-faixa c-faixa--atencao" role="alert"><div class="c-faixa-txt"><p>Seu perfil não tem acesso às informações de LGPD.</p></div></div>` : null}
        ${mensagem.texto ? html`<div class=${`c-faixa c-faixa--${mensagem.tipo === 'erro' ? 'perigo' : 'informacao'}`} role=${mensagem.tipo === 'erro' ? 'alert' : 'status'}><div class="c-faixa-txt"><p>${mensagem.texto}</p></div></div>` : null}
        ${base && cand ? html`
          <section class="c-cfg-bloco"><h3><${Ic} nome="clock" />Rotina de retenção</h3>
            <div class="c-cfg-par">
              <div class="c-campo"><span class="c-rotulo">Avisar antes de apagar</span>
                <span class="c-cfg-numero"><input class="c-entrada" type="number" min="0" max="60" disabled=${!podeEditar} value=${cand.dias_aviso}
                  aria-label="Dias de aviso antes de apagar" onInput=${(e) => setCand({ ...cand, dias_aviso: Number(e.target.value) })} /><span class="c-secundario">dias</span></span>
                <small class="c-secundario">O Administrador e o Gestor recebem o aviso.</small></div>
              <div class="c-campo"><span class="c-rotulo">Última execução</span>
                <span>${dataHora(base.candidatos.ultima_execucao)}</span>
                <small class="c-secundario">${ultimo?.executado ? `${ultimo.candidaturas_excluidas} candidatura(s) apagada(s), ${ultimo.avisos_enviados} aviso(s), ${ultimo.arquivos_apagados} arquivo(s)` : 'Roda todo dia de madrugada.'}</small></div>
            </div>
            <small class="c-secundario">Nunca apaga: candidato aprovado ou contratado e quem está em processo seletivo aberto.</small>
          </section>

          <section class="c-cfg-bloco"><h3><${Ic} nome="scales" />Dados sensíveis e prazos</h3>
            <div class="c-cfg-rodape">
              <${Segmento} rotulo="Módulo" opcoes=${MODULOS} valor=${filtro} aoMudar=${setFiltro} />
              <button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${Boolean(ocupado)} onClick=${simular}>
                <${Ic} nome="eye" />${ocupado === 'simular' ? 'Simulando...' : 'Simular (não apaga nada)'}</button>
            </div>
            <div class="c-tabela-caixa"><table class="c-tabela c-tabela--compacta">
              <thead><tr><th>Tipo de dado</th><th>Guardar por</th><th>Depois do prazo</th><th>Ligado</th><th>Hoje</th>${contagens ? html`<th class="c-num">Passaram do prazo</th>` : null}</tr></thead>
              <tbody>
                ${grupos.map(([m, lista]) => html`
                  <tr key=${m}><td colspan=${contagens ? 6 : 5} class="c-forte" style=${{ background: 'var(--cor-fundo-sutil)' }}>${NOME_MODULO[m]}</td></tr>
                  ${lista.map((t) => {
                    const v = valor(t);
                    const [tom, rotulo] = situacao({ ...t, ativo: v.ativo });
                    return html`<tr key=${t.id}>
                      <td><strong>${t.nome}</strong><br /><small class="c-secundario">${t.exemplo}</small>
                        ${t.aviso ? html`<br /><small class="c-secundario"><${Ic} nome="warning" /> ${t.aviso}</small>` : null}</td>
                      <td><span class="c-cfg-numero"><input class="c-entrada" type="number" min="1" max="120" disabled=${!editaMeses(t)} value=${v.meses}
                        aria-label=${`Prazo de ${t.nome}`} onInput=${(e) => mudarMeses(t, Number(e.target.value))} /><span class="c-secundario">${t.unidade}</span></span>
                        <br /><small class="c-secundario">${t.base}</small></td>
                      <td>${t.acoes.length > 1 && t.origem === 'catalogo'
                        ? html`<select class="c-entrada" disabled=${!podeEditar} aria-label=${`O que acontece com ${t.nome}`} value=${v.acao}
                            onChange=${(e) => setTipos({ ...tipos, [t.id]: { ...tipos[t.id], acao: e.target.value } })}>
                            ${t.acoes.map((a) => html`<option key=${a.id} value=${a.id}>${a.nome}</option>`)}</select>`
                        : (t.acoes.find((a) => a.id === v.acao) || t.acoes[0]).nome}</td>
                      <td><label class="c-interruptor"><input type="checkbox" checked=${Boolean(v.ativo)} disabled=${!editaLigado(t)}
                        aria-label=${`${t.nome} ligado`} onChange=${(e) => mudarLigado(t, e.target.checked)} /></label></td>
                      <td><${Selo} tom=${tom}>${rotulo}</${Selo}></td>
                      ${contagens ? html`<td class="c-num">${contagens[t.id] ?? '—'}</td>` : null}
                    </tr>`;
                  })}
                `)}
              </tbody>
            </table></div>
            <small class="c-secundario">Apagar só arquivos: o registro fica (data, nota, quem fez), o arquivo some. Anonimizar: nome, CPF, telefone e e-mail viram "removido"; os números e relatórios continuam. Os prazos sugeridos são só sugestão: quem decide é o RH ou o jurídico.</small>
          </section>

          ${previa ? html`<section class="c-cfg-bloco"><h3><${Ic} nome="list-checks" />Candidatos: simulação de hoje</h3>
            <p class="c-secundario">${previa.total_avaliados} candidatura(s) avaliada(s), ${previa.protegidos} protegida(s). Seriam apagadas agora: ${previa.excluir.length}. Recebem aviso: ${previa.avisar.length}.</p>
            ${podeExecutar && previa.excluir.length ? html`<div class="c-faixa c-faixa--perigo" role="alert"><div class="c-faixa-txt">
              <p><strong>Executar agora</strong> apaga definitivamente ${previa.excluir.length} candidato(s). Não dá para desfazer (só pelo backup).</p>
              <div class="c-cfg-numero"><input class="c-entrada" style=${{ width: '180px', textAlign: 'left' }} placeholder="Digite EXCLUIR" value=${confirmacao}
                aria-label="Digite EXCLUIR para confirmar" onInput=${(e) => setConfirmacao(e.target.value)} />
              <button type="button" class="c-botao c-botao--perigo c-botao--compacto" disabled=${confirmacao.trim().toUpperCase() !== 'EXCLUIR' || Boolean(ocupado)} onClick=${executar}>
                ${ocupado === 'executar' ? 'Excluindo...' : 'Executar agora'}</button></div>
            </div></div>` : null}
          </section>` : null}

          <div class="c-cfg-rodape">
            <span class="c-secundario">${total ? `${total} mudança(s) não salva(s).` : 'Nenhuma mudança.'}</span>
            ${podeEditar ? html`<button type="button" class="c-botao c-botao--principal" disabled=${!total || Boolean(ocupado)} onClick=${salvar}>
              <${Ic} nome="floppy-disk" />${ocupado === 'salvar' ? 'Salvando...' : 'Salvar'}</button>` : null}
          </div>
        ` : null}
      </section>
    </${PainelRh}>
  `;
}
