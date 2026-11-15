import { html, useEffect, useMemo, useState } from '../../../infraestrutura-react.js';
import { exportarAlteracoesDiario, exportarHistoricoDiario, lerAlteracoesDiario, lerHistoricoDiario } from '../../../services/api/diario.js';
import { Esqueleto, Estado, Ic, MenuAcoes, Selo } from '../../../ui/components/ds.js?v=20261106-wfm';
import { SinalTurno } from './hoje.js';
import { ROTULO_ENCERRAMENTO, ROTULO_TURNO, diaHist, nf, pct, rotuloMes, somarMes } from './regras.js';

// Diário de bordo › Histórico (amostra quadro 5): 1 linha por dia e a gaveta com tudo o que mudou no dia (antes → depois).

const SITUACOES = [['', 'Situação'], ['rascunho', 'Com rascunho'], ['reaberto', 'Reaberto'], ['com_pendencias', 'Com pendências'], ['encerrado', 'Encerrado']];
const ENVIOS = [['', 'Envio'], ['enviado', 'Enviado'], ['nao_marcado', 'Não marcado']];
const SELO_ENVIO = { enviado: ['sucesso', 'Enviado', 'paper-plane-tilt'], copiado: ['neutro', 'Copiado', 'copy'], baixado: ['neutro', 'Baixado', 'tray-arrow-down'], nao_marcado: ['atencao', 'Não marcado', ''] };
const ACAO = {
  criou: 'Dia aberto', concluiu: 'concluído', reabriu: 'reaberto', alterou: 'mudou', encerrou: 'encerrado', registrou: 'registrada', excluiu: 'excluída',
  corrigiu: 'ABS corrigido', editou_mesmo_assim: 'editou mesmo com outra pessoa editando', copiou_texto: 'Texto do fechamento copiado',
  baixou_imagem: 'Imagem do fechamento baixada', marcou_enviado: 'Marcado como enviado ao grupo', exportou: 'Exportado', importou: 'Importado do diário antigo',
};

const baixarArquivo = ({ blob, filename }) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

export function descreverAlteracao(a) {
  const turno = a.turno ? ROTULO_TURNO[a.turno] : '';
  const curto = (v) => { if (v === null || v === undefined) return '—'; try { const o = JSON.parse(v); if (o && typeof o === 'object') return Object.entries(o).map(([k, x]) => `${k}: ${x ?? '—'}`).join(', '); } catch { /* texto simples */ } return v; };
  if (a.entidade === 'turno' && ['concluiu', 'reabriu'].includes(a.acao)) return `${turno} ${ACAO[a.acao]}`;
  if (a.entidade === 'turno' && a.acao === 'editou_mesmo_assim') return `${turno}: ${ACAO[a.acao]}`;
  if (a.entidade === 'dia') return a.acao === 'criou' ? 'Dia aberto no diário' : a.acao === 'importou' ? `${ACAO.importou}: ${a.campo}` : `Dia ${ACAO[a.acao] || a.acao}`;
  if (a.entidade === 'intercorrencia') return `Intercorrência ${ACAO[a.acao] || a.acao}: ${a.campo}${a.acao === 'alterou' || a.acao === 'encerrou' ? ` (${curto(a.antes)} → ${curto(a.depois)})` : ''}`;
  if (a.entidade === 'parcial') return `${a.campo} ${a.acao === 'registrou' ? 'registrada' : a.acao === 'excluiu' ? 'excluída' : `mudou (${curto(a.antes)} → ${curto(a.depois)})`}`;
  if (a.entidade === 'abs') return `ABS corrigido: ${curto(a.antes)} → ${curto(a.depois)}`;
  if (a.entidade === 'envio' || a.entidade === 'exportacao') return `${ACAO[a.acao] || a.acao}${a.campo ? `: ${a.campo}` : ''}`;
  if (a.campo) return `${a.campo}: ${curto(a.antes)} → ${curto(a.depois)}`;
  return `${a.entidade} ${a.acao}`;
}

export function GavetaAlteracoes({ dia, podeExportar, onClose }) {
  const [itens, setItens] = useState(null);
  const [erro, setErro] = useState('');
  useEffect(() => { lerAlteracoesDiario(dia.id_dia).then((r) => setItens(r.itens || [])).catch((e) => setErro(e?.message || 'Não foi possível ler as alterações.')); }, [dia.id_dia]);
  useEffect(() => { const esc = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc); }, [onClose]);
  return html`<aside class="c-painel-lateral c-diario c-ds" role="dialog" aria-label=${`Alterações de ${diaHist(dia.data)}`}>
    <div class="c-janela-cab"><h2>${diaHist(dia.data)} · alterações<small>Tudo o que foi criado, mudado, reaberto e exportado neste dia</small></h2>
      <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Fechar" title="Fechar" onClick=${onClose}><${Ic} nome="x" /></button></div>
    <div class="c-janela-corpo">${erro ? html`<${Estado} titulo=${erro} />` : !itens ? html`<${Esqueleto} linhas=${6} />` : !itens.length ? html`<${Estado} titulo="Nenhuma alteração registrada" />`
      : html`<ol class="c-db-linha-tempo">${itens.map((a) => html`<li key=${a.id_alteracao} class=${a.acao === 'reabriu' || a.acao === 'editou_mesmo_assim' || a.acao === 'excluiu' ? 'c-db-lt-alerta' : null}>${descreverAlteracao(a)}
          <small>${a.criado_em.slice(11, 16)} · ${a.usuario_nome || '—'}${a.turno && !['concluiu', 'reabriu'].includes(a.acao) ? ` · ${ROTULO_TURNO[a.turno]}` : ''}</small>${a.motivo ? html`<q>${a.motivo}</q>` : null}</li>`)}</ol>`}</div>
    ${podeExportar ? html`<div class="c-janela-rodape"><button type="button" class="c-botao c-botao--secundario" onClick=${() => exportarAlteracoesDiario(dia.id_dia).then(baixarArquivo).catch((e) => setErro(e?.message || 'Não foi possível exportar.'))}><${Ic} nome="tray-arrow-down" />Exportar</button></div>` : null}
  </aside>`;
}

export function AbaHistorico({ contexto, operacao, setOperacao, irParaDia }) {
  const [anoMes, setAnoMes] = useState(contexto.hoje.slice(0, 7));
  const [itens, setItens] = useState(null);
  const [erro, setErro] = useState('');
  const [situacao, setSituacao] = useState('');
  const [quem, setQuem] = useState('');
  const [envio, setEnvio] = useState('');
  const [aberto, setAberto] = useState(null);
  const [exportando, setExportando] = useState(false);
  useEffect(() => { setItens(null); setErro(''); lerHistoricoDiario(operacao, anoMes).then((r) => setItens(r.itens || [])).catch((e) => setErro(e?.message || 'Não foi possível ler o histórico.')); }, [operacao, anoMes]);
  const autores = useMemo(() => [...new Set((itens || []).flatMap((i) => i.autores))].sort(), [itens]);
  const canais = useMemo(() => [...new Set((itens || []).flatMap((i) => Object.keys(i.ns)))], [itens]);
  const filtrados = (itens || []).filter((i) => (!situacao || (situacao === 'encerrado' ? i.status === 'encerrado' : situacao === 'com_pendencias' ? i.encerramento_tipo === 'com_pendencias' : i.turnos.includes(situacao)))
    && (!quem || i.autores.includes(quem)) && (!envio || (envio === 'enviado' ? i.envio === 'enviado' : i.envio !== 'enviado')));
  const exportar = async () => { setExportando(true); try { baixarArquivo(await exportarHistoricoDiario(operacao, anoMes, 'xlsx')); } catch (e) { setErro(e?.message || 'Não foi possível exportar.'); } setExportando(false); };
  const sel = (rot, valor, set, ops) => html`<select class="c-entrada c-entrada--compacta" aria-label=${rot} value=${valor} onChange=${(e) => set(e.target.value)}>${ops.map(([v, r]) => html`<option key=${v} value=${v}>${r}</option>`)}</select>`;

  return html`<div class="c-cab-linha"><h1>Histórico</h1><div class="c-cab-dir">
      ${contexto.pode.exportar ? html`<button type="button" class="c-botao c-botao--secundario" disabled=${exportando || !itens?.length || null} onClick=${exportar}><${Ic} nome="tray-arrow-down" />${exportando ? 'Exportando…' : 'Exportar'}</button>` : null}</div></div>
    <div class="c-tabela-caixa c-db-caixa c-db-caixa--justa">
      <div class="c-filtros c-filtros--suave">
        <div class="c-grupo c-navegar" role="group" aria-label="Mês" style=${{ gap: 0, flexWrap: 'nowrap' }}>
          <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Mês anterior" title="Mês anterior" onClick=${() => setAnoMes(somarMes(anoMes, -1))}><${Ic} nome="caret-left" /></button>
          <span class="c-botao c-botao--texto c-botao--compacto c-db-dia-rot" aria-live="polite">${rotuloMes(anoMes)}</span>
          <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Próximo mês" title="Próximo mês" disabled=${anoMes >= contexto.hoje.slice(0, 7) || null} onClick=${() => setAnoMes(somarMes(anoMes, 1))}><${Ic} nome="caret-right" /></button>
        </div>
        ${contexto.operacoes.length > 1 ? sel('Operação', operacao, setOperacao, contexto.operacoes.map((o) => [o.chave, o.nome])) : html`<span class="c-db-op">${contexto.operacoes[0]?.nome}</span>`}
        ${sel('Situação', situacao, setSituacao, SITUACOES)}
        ${sel('Quem registrou', quem, setQuem, [['', 'Quem registrou'], ...autores.map((a) => [a, a])])}
        ${sel('Envio', envio, setEnvio, ENVIOS)}
      </div>
      ${erro ? html`<${Estado} titulo=${erro} /> ` : !itens ? html`<${Esqueleto} linhas=${6} />` : !filtrados.length ? html`<${Estado} icone="notebook" titulo=${itens.length ? 'Nenhum dia com esses filtros' : 'Nenhum dia registrado neste mês'} />`
        : html`<table class="c-tabela c-tabela--compacta c-tabela--junta">
          <thead><tr><th scope="col">Dia</th><th scope="col" title="Abertura · Intermediário · Fechamento">Turnos</th><th class="c-num" scope="col">Tratadas</th><th class="c-num c-db-opc" scope="col">Pendentes</th>
            ${canais.map((c) => html`<th key=${c} class="c-num" scope="col">NS ${c}</th>`)}<th class="c-num" scope="col">ABS</th><th class="c-num c-db-opc" scope="col">Intercorr.</th><th scope="col">Encerramento</th><th scope="col">Envio ao grupo</th><th class="c-estica c-db-opc" scope="col"></th><th class="c-acoes" scope="col"><span class="c-oculto">Ações</span></th></tr></thead>
          <tbody>${filtrados.map((i) => {
            const [tomE, rotE, icE] = SELO_ENVIO[i.envio] || SELO_ENVIO.nao_marcado;
            return html`<tr key=${i.id_dia} class="c-clicavel" aria-selected=${aberto?.id_dia === i.id_dia ? 'true' : null} onClick=${() => setAberto(i)}>
              <td class="c-forte" data-papel="titulo">${diaHist(i.data)}${i.importado ? html` <small class="c-secundario" title="Importado do diário antigo">(importado)</small>` : null}</td>
              <td data-papel="acoes"><span class="c-db-tres">${i.turnos.map((t, k) => html`<${SinalTurno} key=${k} estado=${t} />`)}</span></td>
              <td class="c-num" data-papel="info" data-prioridade="1" data-primeira=""><span class="c-db-so-cel">Tratadas </span>${nf(i.tratadas)}</td><td class="c-num c-db-opc">${nf(i.pendentes)}</td>
              ${canais.map((c) => html`<td key=${c} class=${`c-num${i.ns[c] === null || i.ns[c] === undefined ? ' c-db-nada' : ''}`}>${pct(i.ns[c])}</td>`)}
              <td class="c-num" data-papel="info" data-prioridade="1" title=${i.abs_origem === 'correcao' ? 'Corrigido' : 'Da Presença'}><span class="c-db-so-cel">ABS </span>${pct(i.abs)}${i.abs_origem === 'correcao' ? '*' : ''}</td>
              <td class="c-num c-db-opc">${i.intercorrencias || html`<span class="c-db-nada">0</span>`}</td>
              <td data-papel="info" data-prioridade="1">${i.encerramento_tipo ? html`<${Selo} tom=${i.encerramento_tipo === 'sem_pendencias' ? 'sucesso' : 'atencao'}>${i.encerramento_tipo === 'com_pendencias' ? 'Com pendências' : ROTULO_ENCERRAMENTO[i.encerramento_tipo]}<//>` : html`<span class="c-db-nada">—</span>`}</td>
              <td data-papel="selo"><${Selo} tom=${tomE} icone=${icE}>${rotE}<//></td><td class="c-estica c-db-opc"></td>
              <td class="c-acoes" onClick=${(e) => e.stopPropagation()}><${MenuAcoes} rotulo=${`Ações de ${diaHist(i.data)}`} acoes=${[
                { label: 'Abrir o dia', icon: 'arrow-right', onClick: () => irParaDia(i.data) },
                { label: 'Ver alterações', icon: 'clock-counter-clockwise', onClick: () => setAberto(i) },
              ]} /></td></tr>`;
          })}</tbody></table>
          <div class="c-tabela-rodape"><span>${filtrados.length} ${filtrados.length === 1 ? 'dia' : 'dias'}</span>
            <span class="c-secundario c-db-legenda"><${SinalTurno} estado="concluido" /> concluído · <${SinalTurno} estado="rascunho" /> rascunho · <${SinalTurno} estado="reaberto" /> reaberto · <${SinalTurno} estado="vazio" /> não feito · * ABS corrigido</span></div>`}
    </div>
    ${aberto ? html`<${GavetaAlteracoes} dia=${aberto} podeExportar=${contexto.pode.exportar} onClose=${() => setAberto(null)} />` : null}`;
}
