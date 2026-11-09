import { html, useEffect, useMemo, useRef, useState } from '../../infraestrutura-react.js';
import {
  calcularPrevia,
  descartarRascunho,
  lerMatriz,
  listarCatalogoMonitoria,
  listarOperadoresMonitoria,
  listarRascunhos,
  realizarMonitoria,
  salvarRascunho,
} from '../../services/api/monitoria.js';
import { Campo, Esqueleto, Estado, Faixa, Ic, Janela, Segmento } from '../../ui/components/ds.js?v=20261106-wfm';
import { RESPOSTAS, formatarNota, hoje } from './comum.js';
import { AvisoIntercorrencia } from '../../modulos/operacao/diario/ligacoes.js';

// Nova monitoria no desenho novo (amostra Fase 12, DEC-068): etapas no topo com a nota viva à direita,
// dados do contato numa linha fina sempre à vista, critérios em tabela e "Finalizar" só na Revisão.
// A nota é SEMPRE a do servidor (mesmo motor da gravação). Contato do cliente obrigatório (DEC-095).

const ESTADO_INICIAL = {
  id_operador: '', canal: '', tipo_atendimento: '', data_contato: hoje(), telefone: '', id_interacao: '',
  nome_cliente: '', cpf_cliente: '', contato_cliente: '', respostas: {}, pilares: { conhecimento: {}, encantamento: {} },
  motivo_ncg: '', justificativa_anulacao: '', observacao: '', sugestao_feedback: '',
};
const CONTATO = 'contato';
const PILARES = 'pilares';
const REVISAO = 'revisao';
const idBloco = (b) => `bloco:${b.id}`;
const pad = (n) => String(n).padStart(2, '0');
const brDia = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');

const mascararCpf = (valor) => {
  const d = String(valor || '').replace(/\D/g, '').slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
};
const cpfValido = (valor) => {
  const d = String(valor || '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  return [9, 10].every((n) => ((d.slice(0, n).split('').reduce((soma, c, i) => soma + Number(c) * (n + 1 - i), 0) * 10) % 11) % 10 === Number(d[n]));
};
// Mesma regra do servidor: e-mail, ou telefone com DDD (10 ou 11 números; o 0 da operadora é ignorado).
export const contatoValido = (valor) => {
  const t = String(valor || '').trim();
  if (!t) return false;
  if (t.includes('@')) { const [u, dom = ''] = t.toLowerCase().split('@'); return Boolean(u) && dom.includes('.') && !dom.startsWith('.') && !dom.endsWith('.') && !/\s/.test(t); }
  let d = t.replace(/\D/g, '');
  if (d.startsWith('0')) d = d.slice(1);
  return (d.length === 10 || d.length === 11) && d[0] !== '0';
};

const ROTULO_RESP = { SIM: 'Sim', NAO: 'Não', NCG: 'NCG', NA: 'N/A' };

export function TelaNovaMonitoriaRedesign({ controlador, contexto, aoConcluir, showToast }) {
  const operacoesAtivas = (contexto?.operacoes || []).filter((op) => op.ativo);
  const [operacao, setOperacao] = useState(operacoesAtivas.length === 1 ? operacoesAtivas[0].chave : '');
  const [dados, setDados] = useState(ESTADO_INICIAL);
  const [matriz, setMatriz] = useState(null);
  const [operadores, setOperadores] = useState([]);
  const [canais, setCanais] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [previa, setPrevia] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [rascunhos, setRascunhos] = useState([]);
  const [idRascunho, setIdRascunho] = useState(0);
  const [salvoEm, setSalvoEm] = useState(null);
  const [erro, setErro] = useState('');
  const [tentativa, setTentativa] = useState(0);
  const [etapa, setEtapa] = useState(CONTATO);
  const [mostrarFaltas, setMostrarFaltas] = useState(false);
  const temporizador = useRef(null);
  const caixaRef = useRef(null);

  useEffect(() => { listarRascunhos().then((r) => setRascunhos(r?.itens || [])).catch(() => setRascunhos([])); }, []);
  useEffect(() => {
    if (!operacao) { setMatriz(null); return undefined; }
    let ativo = true;
    setCarregando(true); setErro('');
    Promise.all([lerMatriz(operacao, true), listarOperadoresMonitoria(operacao), listarCatalogoMonitoria('canal', operacao), listarCatalogoMonitoria('tipo_atendimento', operacao)])
      .then(([m, ops, cs, ts]) => { if (!ativo) return; setMatriz(m?.versao_ativa || null); setOperadores(ops?.itens || []); setCanais(cs?.itens || []); setTipos(ts?.itens || []); })
      .catch((e) => { if (ativo) { setMatriz(null); setErro(e?.message || 'Não foi possível carregar o formulário desta operação.'); } })
      .finally(() => ativo && setCarregando(false));
    return () => { ativo = false; };
  }, [operacao, tentativa]);
  useEffect(() => {
    if (!operacao || !matriz) return undefined;
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => { calcularPrevia(operacao, dados.respostas).then(setPrevia).catch(() => setPrevia(null)); }, 250);
    return () => clearTimeout(temporizador.current);
  }, [operacao, matriz, dados.respostas]);

  const config = matriz?.config;
  const blocos = config?.blocos || [];
  const temPilares = ['conhecimento', 'encantamento'].some((t) => (config?.pilares?.[t] || []).length);
  const operador = operadores.find((o) => String(o.id_usuario) === String(dados.id_operador));
  const statusBloco = useMemo(() => Object.fromEntries((previa?.blocos || []).map((b) => [b.id, b])), [previa]);
  const atualizar = (campo, valor) => setDados((a) => ({ ...a, [campo]: valor }));
  const canalSel = canais.find((c) => c.valor === dados.canal);
  const tiposDisp = tipos.filter((t) => !t.id_item_canal || !canalSel || t.id_item_canal === canalSel.id_item).filter((t, i, l) => l.findIndex((o) => o.valor === t.valor) === i);
  const trocarCanal = (valor) => {
    const canal = canais.find((c) => c.valor === valor);
    setDados((a) => {
      const mantem = !a.tipo_atendimento || !canal || tipos.some((t) => t.valor === a.tipo_atendimento && (!t.id_item_canal || t.id_item_canal === canal.id_item));
      return { ...a, canal: valor, tipo_atendimento: mantem ? a.tipo_atendimento : '' };
    });
  };
  const responder = (id, valor) => setDados((a) => {
    const respostas = { ...a.respostas };
    if (valor == null || respostas[id] === valor) delete respostas[id]; else respostas[id] = valor;
    return { ...a, respostas };
  });
  const notaPilar = (tipo, chave, valor) => setDados((a) => ({ ...a, pilares: { ...a.pilares, [tipo]: { ...a.pilares[tipo], [chave]: valor } } }));

  const pendPilares = ['conhecimento', 'encantamento'].reduce((t, tipo) => t + (config?.pilares?.[tipo] || []).filter((p) => !dados.pilares[tipo]?.[p.chave]).length, 0);
  const totalPilares = ['conhecimento', 'encantamento'].reduce((t, tipo) => t + (config?.pilares?.[tipo] || []).length, 0);
  const faltasContato = [];
  if (!dados.id_operador) faltasContato.push('Escolha o operador.');
  if (!dados.canal || !dados.tipo_atendimento) faltasContato.push('Informe o canal e o tipo de atendimento.');
  if (!dados.data_contato) faltasContato.push('Informe a data do contato.');
  if (!contatoValido(dados.contato_cliente)) faltasContato.push('Informe o contato do cliente: telefone com DDD ou e-mail.');
  if (dados.cpf_cliente && !cpfValido(dados.cpf_cliente)) faltasContato.push('CPF do cliente inválido: confira os 11 números.');
  const respondidos = (b) => b.criterios.filter((c) => dados.respostas[c.id]).length;
  const problemas = [...faltasContato];
  if (previa && previa.pendentes > 0) problemas.push(`Responda todos os critérios (${previa.pendentes} sem resposta).`);
  if (pendPilares > 0) problemas.push('Avalie todos os indicadores dos pilares.');
  if (previa?.possui_ncg && !dados.motivo_ncg.trim()) problemas.push('Informe o motivo da NCG.');
  if (previa?.anulada && !dados.justificativa_anulacao.trim()) problemas.push('Informe a justificativa da anulação (menos blocos avaliados que o mínimo).');

  const etapas = [
    { id: CONTATO, rotulo: 'Contato', feita: faltasContato.length === 0 && Boolean(config) },
    ...blocos.map((b) => ({ id: idBloco(b), rotulo: b.nome, feita: respondidos(b) === b.criterios.length })),
    ...(config && temPilares ? [{ id: PILARES, rotulo: 'Pilares', feita: pendPilares === 0 }] : []),
    ...(config ? [{ id: REVISAO, rotulo: 'Revisão', feita: false }] : []),
  ];
  const i = Math.max(0, etapas.findIndex((e) => e.id === etapa));
  const atual = etapas[i] || etapas[0];
  const bloco = blocos.find((b) => idBloco(b) === etapa) || null;

  const salvarRascunhoAgora = async (silencioso = true) => {
    if (!operacao) return;
    try {
      const r = await salvarRascunho({ operacao, payload: dados }, idRascunho || null);
      setIdRascunho(r.id_rascunho); setSalvoEm(new Date());
      if (!silencioso) showToast?.('Rascunho salvo. Só você o vê e pode descartá-lo.', 'success');
    } catch (e) { if (!silencioso) showToast?.(e?.message || 'Não foi possível salvar o rascunho.', 'danger'); }
  };
  // Rascunho salva sozinho ao trocar de etapa (a partir do momento em que há operador escolhido).
  const irPara = (id) => {
    if (id === etapa) return;
    if (operacao && dados.id_operador) salvarRascunhoAgora(true);
    setEtapa(id); setMostrarFaltas(false);
    setTimeout(() => caixaRef.current?.scrollIntoView?.({ block: 'nearest' }), 0);
  };
  const continuar = () => {
    if (etapa === CONTATO && faltasContato.length) { setMostrarFaltas(true); return; }
    if (bloco && respondidos(bloco) < bloco.criterios.length) { setMostrarFaltas(true); }
    if (i < etapas.length - 1) irPara(etapas[i + 1].id);
  };
  const abrirRascunho = (r) => { setOperacao(r.operacao); setDados({ ...ESTADO_INICIAL, ...r.payload }); setIdRascunho(r.id_rascunho); setEtapa(CONTATO); };
  const tentarFinalizar = () => {
    if (problemas.length) { setMostrarFaltas(true); return; }
    setConfirmando(true);
  };
  const finalizar = async () => {
    setSalvando(true); setErro('');
    try {
      const r = await realizarMonitoria({ ...dados, operacao, id_operador: Number(dados.id_operador) }, idRascunho);
      setConfirmando(false);
      showToast?.(`Monitoria ${r.codigo} finalizada. Nota ${formatarNota(r.nota)}${r.anulada ? ' (anulada)' : ''}.`, 'success');
      aoConcluir?.(r);
    } catch (e) { setErro(e?.message || 'Não foi possível finalizar a monitoria.'); setConfirmando(false); } finally { setSalvando(false); }
  };

  const cab = html`<div class="c-cab-linha"><h1>Nova monitoria</h1>
    <div class="c-cab-dir"><span class="c-secundario" style=${{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><${Ic} nome="lock" />Depois de finalizada, não muda mais</span></div></div>`;
  if (!operacoesAtivas.length) return html`${cab}<div class="c-tabela-caixa"><${Estado} icone="lock" titulo="Nenhuma operação ativa" texto="Você não está vinculado a nenhuma operação ativa para realizar monitorias." /></div>`;

  const notaViva = html`<span class="c-nota-viva" role="status" aria-live="polite"><small>Nota</small><b>${previa ? formatarNota(previa.nota) : '—'}</b>
    <small>/ 100${previa?.pendentes > 0 ? ` · ${previa.pendentes === 1 ? 'falta 1 resposta' : `faltam ${previa.pendentes} respostas`}` : ''}${previa?.possui_ncg ? ' · NCG' : ''}</small></span>`;
  const faixaEtapas = html`<div class="c-etapa-faixa">
    ${etapa === REVISAO ? html`<span class="c-forte">Revisão</span>` : null}
    <ol class="c-etapas" aria-label="Etapas" hidden=${etapa === REVISAO || null}>${etapas.map((e) => html`<li key=${e.id} class=${`c-etapa ${e.feita && e.id !== etapa ? 'c-feita' : ''}`.trim()} aria-current=${e.id === atual.id ? 'step' : null}>
      <button type="button" style=${{ all: 'unset', cursor: 'pointer' }} onClick=${() => irPara(e.id)}>${e.rotulo}</button></li>`)}</ol>
    ${config ? notaViva : null}
  </div>`;
  const linhaContexto = etapa !== CONTATO && config ? html`<div class="c-contexto">
    <span>Operador <b>${operador?.nome || '—'}</b></span>
    <span>Operação <b>${operacoesAtivas.find((o) => o.chave === operacao)?.nome || operacao}</b></span>
    <span>Equipe <b>${operador?.equipe_nome || '—'}</b></span>
    <span>Contato <b>${brDia(dados.data_contato)}${dados.contato_cliente ? ` · ${dados.contato_cliente}` : ''}</b></span>
  </div>` : null;

  const corpoContato = html`<div class="c-cartao-corpo" style=${{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
    ${rascunhos.length ? html`<div class="c-grupo" role="group" aria-label="Meus rascunhos"><span class="c-rotulo">Meus rascunhos</span>
      ${rascunhos.map((r) => html`<span key=${r.id_rascunho} class="c-grupo" style=${{ gap: 0 }}>
        <button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => abrirRascunho(r)}>${r.operacao} · ${new Date(r.atualizado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</button>
        <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Descartar rascunho" title="Descartar rascunho"
          onClick=${async () => { await descartarRascunho(r.id_rascunho); setRascunhos((l) => l.filter((x) => x.id_rascunho !== r.id_rascunho)); if (idRascunho === r.id_rascunho) setIdRascunho(0); }}><${Ic} nome="trash" /></button></span>`)}
    </div>` : null}
    <div class="c-form" style=${{ '--colunas': 4 }}>
      <${Campo} rotulo="Operação"><select class="c-entrada" value=${operacao} onChange=${(e) => { setOperacao(e.target.value); setDados({ ...ESTADO_INICIAL }); setIdRascunho(0); setPrevia(null); }}>
        <option value="">Escolha…</option>${operacoesAtivas.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select><//>
      ${operacao ? html`
        <${Campo} rotulo="Operador"><select class="c-entrada" value=${dados.id_operador} onChange=${(e) => atualizar('id_operador', e.target.value)}>
          <option value="">Escolha…</option>${operadores.map((o) => html`<option key=${o.id_usuario} value=${o.id_usuario}>${o.nome}</option>`)}</select><//>
        <${Campo} rotulo="Equipe"><input class="c-entrada" disabled value=${operador?.equipe_nome || (dados.id_operador ? 'Sem equipe' : '')} /><//>
        <${Campo} rotulo="Data do contato"><input class="c-entrada" type="date" max=${hoje()} value=${dados.data_contato} onInput=${(e) => atualizar('data_contato', e.target.value)} /><//>
        <${Campo} rotulo="Canal"><select class="c-entrada" value=${dados.canal} onChange=${(e) => trocarCanal(e.target.value)}>
          <option value="">Escolha…</option>${canais.map((c) => html`<option key=${c.id_item} value=${c.valor}>${c.valor}</option>`)}</select><//>
        <${Campo} rotulo="Tipo de atendimento"><select class="c-entrada" value=${dados.tipo_atendimento} onChange=${(e) => atualizar('tipo_atendimento', e.target.value)}>
          <option value="">Escolha…</option>${tiposDisp.map((c) => html`<option key=${c.id_item} value=${c.valor}>${c.valor}</option>`)}</select><//>
        <${Campo} rotulo="Contato do cliente" ajuda="Telefone com DDD ou e-mail"
          erro=${mostrarFaltas && !contatoValido(dados.contato_cliente) ? (dados.contato_cliente ? 'Confira: telefone com DDD (10 ou 11 números) ou e-mail.' : 'Obrigatório.') : ''}>
          <input class="c-entrada" maxlength="180" autocomplete="off" placeholder="(11) 98765-4321 ou nome@email.com" value=${dados.contato_cliente}
            aria-invalid=${mostrarFaltas && !contatoValido(dados.contato_cliente) ? 'true' : null} onInput=${(e) => atualizar('contato_cliente', e.target.value)} /><//>
        <${Campo} rotulo="Nome do cliente" opcional=${true}><input class="c-entrada" maxlength="180" autocomplete="off" value=${dados.nome_cliente} onInput=${(e) => atualizar('nome_cliente', e.target.value)} /><//>
        <${Campo} rotulo="CPF do cliente" opcional=${true} erro=${dados.cpf_cliente.length === 14 && !cpfValido(dados.cpf_cliente) ? 'CPF inválido: confira os números.' : ''}>
          <input class="c-entrada" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" autocomplete="off" value=${dados.cpf_cliente} onInput=${(e) => atualizar('cpf_cliente', mascararCpf(e.target.value))} /><//>
        <${Campo} rotulo="Telefone" opcional=${true}><input class="c-entrada" maxlength="40" value=${dados.telefone} onInput=${(e) => atualizar('telefone', e.target.value)} /><//>
        <${Campo} rotulo="ID da interação" opcional=${true}><input class="c-entrada" maxlength="120" value=${dados.id_interacao} onInput=${(e) => atualizar('id_interacao', e.target.value)} /><//>` : null}
    </div>
    ${operacao && dados.data_contato ? html`<${AvisoIntercorrencia} controlador=${controlador} operacao=${operacao} momento=${dados.data_contato} />` : null}
    ${operacao && matriz ? html`<p class="c-ajuda" style=${{ margin: 0 }}>Formulário ${matriz.nome} · versão ${matriz.numero}. O ID é gerado ao finalizar.</p>` : null}
  </div>`;

  const corpoBloco = bloco ? html`<table class="c-tabela c-tabela--justa">
    <thead><tr><th scope="col" class="c-estica">Critério</th><th scope="col" class="c-num">Peso</th><th scope="col">Resposta</th></tr></thead>
    <tbody>${bloco.criterios.map((c) => {
    const v = dados.respostas[c.id] || null;
    return html`<tr key=${c.id} class=${mostrarFaltas && !v ? 'c-falta-resp' : ''}>
        <td class="c-forte c-estica" style=${{ whiteSpace: 'normal' }}>${c.texto}</td><td class="c-num c-secundario">${formatarNota(c.peso)}</td>
        <td><div class="c-segmento c-segmento--mini c-segmento--resposta" role="group" aria-label=${`Resposta: ${c.texto}`}>
          ${RESPOSTAS.map((r) => html`<button key=${r.valor} type="button" class="c-botao" data-resp=${r.valor} aria-pressed=${v === r.valor ? 'true' : 'false'} onClick=${() => responder(c.id, r.valor)}>${ROTULO_RESP[r.valor]}</button>`)}
        </div></td></tr>`;
  })}</tbody></table>` : null;

  const corpoPilares = html`<table class="c-tabela c-tabela--justa">
    <thead><tr><th scope="col" class="c-estica">Indicador (não altera a nota de 0 a 100)</th><th scope="col">Nota de ${config?.escala?.min ?? 1} a ${config?.escala?.max ?? 10}</th></tr></thead>
    ${['conhecimento', 'encantamento'].map((tipo) => html`<tbody key=${tipo}>
      <tr><td colspan="2" class="c-forte" style=${{ background: 'var(--tabela-cabecalho-fundo)' }}>Pilar de ${tipo === 'conhecimento' ? 'Conhecimento' : 'Encantamento'}</td></tr>
      ${(config?.pilares?.[tipo] || []).map((p) => {
    const v = dados.pilares[tipo]?.[p.chave] || null;
    const notas = Array.from({ length: (config.escala.max - config.escala.min) + 1 }, (_, k) => config.escala.min + k);
    return html`<tr key=${p.chave} class=${mostrarFaltas && !v ? 'c-falta-resp' : ''}>
          <td class="c-estica" style=${{ whiteSpace: 'normal' }}><span class="c-forte">${p.chave}</span>${p.desc ? html` <span class="c-secundario">· ${p.desc}</span>` : null}</td>
          <td><${Segmento} mini=${true} rotulo=${`${p.chave}: nota`} valor=${v} aoMudar=${(n) => notaPilar(tipo, p.chave, n)} opcoes=${notas.map((n) => [n, String(n)])} /></td></tr>`;
  })}</tbody>`)}
  </table>`;

  const corpoRevisao = html`<table class="c-tabela c-tabela--justa">
    <thead><tr><th scope="col">Bloco</th><th scope="col" class="c-num">Pontos</th><th scope="col" class="c-num">Respondidos</th><th scope="col" class="c-estica"></th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead>
    <tbody>
      <tr><td class="c-forte">Dados do contato</td><td class="c-num">—</td><td class="c-num c-secundario">${faltasContato.length ? `${faltasContato.length} pendência(s)` : 'completo'}</td>
        <td class="c-estica">${faltasContato.length ? html`<span class="c-selo c-selo--atencao">falta preencher</span>` : null}</td>
        <td class="c-acoes"><button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => irPara(CONTATO)}><${Ic} nome="pencil-simple" />Editar</button></td></tr>
      ${blocos.map((b) => {
    const st = statusBloco[b.id];
    const naos = b.criterios.filter((c) => ['NAO', 'NCG'].includes(dados.respostas[c.id])).length;
    return html`<tr key=${b.id}><td class="c-forte">${b.nome}</td>
          <td class="c-num">${st?.status === 'NULO' ? 'nulo (N/A)' : st ? `${formatarNota(st.pontos)} / ${formatarNota(st.valor_efetivo)}` : '—'}</td>
          <td class="c-num c-secundario">${respondidos(b)} de ${b.criterios.length}</td>
          <td class="c-estica">${naos ? html`<span class="c-selo c-selo--atencao">${naos} não</span>` : null}</td>
          <td class="c-acoes"><button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => irPara(idBloco(b))}><${Ic} nome="pencil-simple" />Editar</button></td></tr>`;
  })}
      ${temPilares ? html`<tr><td class="c-forte">Pilares</td><td class="c-num">—</td><td class="c-num c-secundario">${totalPilares - pendPilares} de ${totalPilares}</td><td class="c-estica"></td>
        <td class="c-acoes"><button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => irPara(PILARES)}><${Ic} nome="pencil-simple" />Editar</button></td></tr>` : null}
    </tbody></table>
    <div class="c-cartao-corpo" style=${{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: 'var(--borda-fina) solid var(--tabela-linha)' }}>
      ${previa?.possui_ncg ? html`<${Campo} rotulo="Motivo da NCG" erro=${mostrarFaltas && !dados.motivo_ncg.trim() ? 'Obrigatório quando há NCG.' : ''}><textarea class="c-entrada" rows="2" placeholder="Ex.: rudeza, discussão ou ofensa ao cliente" value=${dados.motivo_ncg} onInput=${(e) => atualizar('motivo_ncg', e.target.value)}></textarea><//>` : null}
      ${previa?.anulada ? html`<${Campo} rotulo="Justificativa da anulação" erro=${mostrarFaltas && !dados.justificativa_anulacao.trim() ? 'Obrigatória.' : ''}><textarea class="c-entrada" rows="2" value=${dados.justificativa_anulacao} onInput=${(e) => atualizar('justificativa_anulacao', e.target.value)}></textarea><//>` : null}
      <div class="c-form" style=${{ '--colunas': 2 }}>
        <${Campo} rotulo="Observação" opcional=${true}><textarea class="c-entrada" rows="2" value=${dados.observacao} onInput=${(e) => atualizar('observacao', e.target.value)}></textarea><//>
        <${Campo} rotulo="Sugestão de feedback" opcional=${true} ajuda="Aparece como sugestão para quem aplicar o feedback."><textarea class="c-entrada" rows="2" value=${dados.sugestao_feedback} onInput=${(e) => atualizar('sugestao_feedback', e.target.value)}></textarea><//>
      </div>
      ${previa?.anulada ? html`<${Faixa} tom="atencao" icone="warning">Menos de ${previa.min_blocos} blocos avaliados: a monitoria será anulada e ficará só no histórico.<//>` : null}
    </div>`;

  const corpo = carregando ? html`<${Esqueleto} linhas=${6} />`
    : etapa === CONTATO || !config ? corpoContato : etapa === PILARES ? corpoPilares : etapa === REVISAO ? corpoRevisao : corpoBloco;
  const faltasDaEtapa = etapa === CONTATO ? faltasContato : etapa === REVISAO ? problemas : [];

  return html`
    ${cab}
    <div class="c-tabela-caixa" ref=${caixaRef}>
      ${faixaEtapas}
      ${linhaContexto}
      ${erro ? html`<div style=${{ padding: '8px 12px' }}><${Faixa} tom="perigo" icone="warning" acao=${operacao && !matriz ? html`<button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => setTentativa((n) => n + 1)}>Tentar de novo</button>` : null}>${erro}<//></div>` : null}
      ${corpo}
      ${mostrarFaltas && faltasDaEtapa.length ? html`<div style=${{ padding: '0 12px 8px' }}><${Faixa} tom="atencao" icone="warning">${faltasDaEtapa.join(' ')}<//></div>` : null}
      <div class="c-etapa-rodape">
        <button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${i <= 0 || null} onClick=${() => irPara(etapas[i - 1].id)}><${Ic} nome="arrow-left" />Voltar</button>
        <span class="c-salvo">${salvoEm ? `Rascunho salvo ${pad(salvoEm.getHours())}:${pad(salvoEm.getMinutes())}` : operacao ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" disabled=${!operacao || null} onClick=${() => salvarRascunhoAgora(false)}><${Ic} nome="floppy-disk" />Salvar rascunho</button>` : ''}</span>
        ${etapa === REVISAO
    ? html`<button type="button" class="c-botao c-botao--principal c-botao--compacto" disabled=${salvando || null} onClick=${tentarFinalizar}><${Ic} nome="check" />Finalizar monitoria</button>`
    : html`<button type="button" class="c-botao c-botao--principal c-botao--compacto" disabled=${!config || null} onClick=${continuar}>Continuar<${Ic} nome="arrow-right" /></button>`}
      </div>
    </div>
    ${confirmando ? html`<${Janela} titulo="Finalizar monitoria?" tamanho="pequena" onClose=${() => setConfirmando(false)}
      rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => setConfirmando(false)}>Cancelar</button>
        <button type="button" class="c-botao c-botao--perigo" aria-busy=${salvando ? 'true' : null} disabled=${salvando || null} onClick=${finalizar}>${salvando ? 'Finalizando…' : 'Finalizar'}</button>`}>
      <div class="c-janela-corpo"><p style=${{ margin: '0 0 8px' }}><b>${operador?.nome || '—'}</b> · ${operacoesAtivas.find((o) => o.chave === operacao)?.nome || operacao} · nota <b>${previa ? formatarNota(previa.nota) : '—'}</b>${previa?.faixa?.label ? ` (${previa.faixa.label})` : ''}</p>
        <p style=${{ margin: 0 }}>Isso não pode ser desfeito.</p></div>
    <//>` : null}`;
}
