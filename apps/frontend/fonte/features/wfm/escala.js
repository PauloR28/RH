import { html, useCallback, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import {
  fecharPeriodoWfm,
  lerEscalaWfm,
  listarVersoesEscalaWfm,
  publicarEscalaWfm,
  salvarItensEscalaWfm,
  validarEscalaWfm,
} from '../../services/api/wfm.js';
import { dataHora, infoDia } from './comum.js';

// Escala mensal (Supervisor/Control Desk/Gestor editam; Qualidade lê; Operador lê a própria
// escala PUBLICADA). Toda validação (jornada, interjornada, pausas, DSR) roda no servidor;
// a tela só exibe o resultado. Conflito de edição concorrente volta como 409 e recarrega.

function Celula({ turno, editavel, valor, onMudar, turnos, titulo }) {
  if (editavel) {
    return html`
      <select class="wfm-select" aria-label=${titulo} value=${valor ?? ''} onChange=${(e) => onMudar(e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">—</option>
        ${turnos.map((t) => html`<option key=${t.id_turno} value=${t.id_turno}>${t.codigo}</option>`)}
      </select>`;
  }
  if (!turno) return html`<span class="wfm-vazio" title=${titulo}>·</span>`;
  return html`<span class="wfm-chip" style=${{ '--wfm-cor': turno.cor }} title=${`${titulo}: ${turno.nome}${turno.entrada ? ` (${turno.entrada}–${turno.saida})` : ''}`}>${turno.codigo}</span>`;
}

export function TelaEscala({ controlador, contexto, operacao, anoMes, showToast, somentePropria = false }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [validacao, setValidacao] = useState(null);
  const [pendentes, setPendentes] = useState({});
  const [justificativa, setJustificativa] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [versoes, setVersoes] = useState([]);

  const pode = (p) => controlador.possuiPermissao(p);

  const carregar = useCallback(async () => {
    if (!operacao) return;
    setErro('');
    try {
      const d = await lerEscalaWfm(operacao, anoMes);
      setDados(d);
      setPendentes({});
      if (!somentePropria && pode('wfm.escala.visualizar')) {
        validarEscalaWfm(operacao, anoMes).then(setValidacao).catch(() => setValidacao(null));
        listarVersoesEscalaWfm(operacao, anoMes).then((r) => setVersoes(r.itens || [])).catch(() => setVersoes([]));
      }
    } catch (e) {
      setDados(null);
      setErro(e?.message || 'Não foi possível carregar a escala.');
    }
  }, [operacao, anoMes, somentePropria]);

  useEffect(() => { setDados(null); carregar(); }, [carregar]);

  const turnosPorId = useMemo(() => Object.fromEntries((dados?.turnos || []).map((t) => [t.id_turno, t])), [dados]);
  const itensPorChave = useMemo(() => Object.fromEntries((dados?.itens || []).map((i) => [`${i.id_operador}:${i.data}`, i])), [dados]);
  const eventosPorDia = useMemo(() => {
    const mapa = {};
    (dados?.eventos || []).forEach((ev) => (dados?.dias || []).forEach((d) => {
      if (d >= ev.data_ini && d <= ev.data_fim) (mapa[d] = mapa[d] || []).push(ev);
    }));
    return mapa;
  }, [dados]);
  const violacoesPorCelula = useMemo(() => {
    const mapa = {};
    (validacao?.violacoes || []).forEach((v) => { (mapa[`${v.id_operador}:${v.data}`] = mapa[`${v.id_operador}:${v.data}`] || []).push(v); });
    return mapa;
  }, [validacao]);

  if (erro) return html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  if (!dados) return html`<${LoadingState} titulo="Carregando a escala" />`;

  const fechada = dados.status.fechada;
  const editavel = dados.pode_editar && !somentePropria;
  const totalPend = Object.keys(pendentes).length;
  const exigeJustFechada = fechada && editavel;

  const mudar = (idOperador, data, idTurno) => {
    const chave = `${idOperador}:${data}`;
    const atual = itensPorChave[chave]?.id_turno ?? null;
    setPendentes((p) => {
      const novo = { ...p };
      if (idTurno === atual) delete novo[chave];
      else novo[chave] = { id_operador: idOperador, data, id_turno: idTurno, versao_linha: itensPorChave[chave]?.versao_linha ?? null };
      return novo;
    });
  };

  const executar = async (fn, sucesso) => {
    setOcupado(true);
    try {
      const r = await fn();
      if (sucesso) showToast?.(typeof sucesso === 'function' ? sucesso(r) : sucesso, 'success');
      return r;
    } catch (e) {
      showToast?.(e?.message || 'Não foi possível concluir a operação.', 'error');
      await carregar();
      return null;
    } finally {
      setOcupado(false);
    }
  };

  const salvar = async () => {
    const r = await executar(
      () => salvarItensEscalaWfm({ operacao, ano_mes: anoMes, itens: Object.values(pendentes), justificativa }),
      (x) => `${x.alteradas} alteração(ões) salva(s).`,
    );
    if (r) { setJustificativa(''); await carregar(); }
  };
  const publicar = async () => {
    const r = await executar(
      () => publicarEscalaWfm({ operacao, ano_mes: anoMes, justificativa }),
      (x) => `Escala publicada (versão ${x.versao}).`,
    );
    if (r) { setJustificativa(''); await carregar(); }
  };
  const fechar = async () => {
    if (!window.confirm('Fechar o período? Depois disso só o Gestor/RH pode corrigir, com justificativa.')) return;
    const r = await executar(() => fecharPeriodoWfm({ operacao, ano_mes: anoMes }), 'Período fechado.');
    if (r) await carregar();
  };

  const semItens = !dados.operadores.length;
  const bloqueio = validacao?.bloqueio;
  const duro = validacao?.bloqueio_duro;
  const podePublicarComViolacao = pode('wfm.escala.publicar_com_violacao');
  const publicarBloqueado = ocupado || totalPend > 0 || duro || (bloqueio && !podePublicarComViolacao)
    || ((bloqueio || exigeJustFechada) && !justificativa.trim());

  return html`
    <section class="mon-card wfm-escala">
      <div class="wfm-cabecalho">
        <div>
          <h3>${somentePropria ? 'Minha escala' : 'Escala mensal'}</h3>
          <p class="mon-muted">
            ${dados.status.versao_publicada ? `Versão publicada: ${dados.status.versao_publicada}` : 'Nenhuma versão publicada ainda'}
            ${fechada ? ` · Período fechado por ${dados.status.fechada_por || '—'} em ${dataHora(dados.status.fechada_em)}` : ''}
            ${somentePropria ? ' · Exibe sempre a última versão publicada.' : ''}
          </p>
        </div>
        ${fechada ? html`<span class="mon-badge mon-badge--info">Período fechado</span>` : null}
      </div>

      ${semItens ? html`<${EmptyState} icon="calendar_month" title="Nenhum operador" text="Não há operadores visíveis para você nesta operação." />` : html`
        <div class="wfm-grade-wrap" role="region" aria-label="Escala do mês" tabindex="0">
          <table class="wfm-grade">
            <thead>
              <tr>
                <th class="wfm-col-nome">Operador</th>
                ${dados.dias.map((d) => {
                  const inf = infoDia(d);
                  const evs = eventosPorDia[d] || [];
                  return html`<th key=${d} class=${`wfm-col-dia ${inf.fimDeSemana ? 'is-fds' : ''} ${evs.length ? 'has-evento' : ''}`} title=${evs.map((e) => e.descricao).join(' · ')}>
                    <span>${inf.dia}</span><small>${inf.semana}</small>${evs.length ? html`<i class="wfm-ponto" aria-hidden="true"></i>` : null}
                  </th>`;
                })}
              </tr>
            </thead>
            <tbody>
              ${dados.operadores.map((op) => html`
                <tr key=${op.id_usuario}>
                  <th class="wfm-col-nome" scope="row">${op.nome}${op.contratos?.length ? html`<small>${op.contratos[op.contratos.length - 1].codigo}</small>` : html`<small class="wfm-alerta-txt">sem contrato</small>`}</th>
                  ${dados.dias.map((d) => {
                    const chave = `${op.id_usuario}:${d}`;
                    const pend = chave in pendentes;
                    const idTurno = pend ? pendentes[chave].id_turno : itensPorChave[chave]?.id_turno ?? null;
                    const viol = violacoesPorCelula[chave];
                    return html`<td key=${d} class=${`${infoDia(d).fimDeSemana ? 'is-fds' : ''} ${pend ? 'is-pendente' : ''} ${viol ? 'is-violacao' : ''}`.trim()} title=${viol ? viol.map((v) => v.mensagem).join('\n') : ''}>
                      <${Celula} turno=${turnosPorId[idTurno]} editavel=${editavel} valor=${idTurno} turnos=${dados.turnos} titulo=${`${op.nome}, dia ${infoDia(d).dia}`} onMudar=${(v) => mudar(op.id_usuario, d, v)} />
                    </td>`;
                  })}
                </tr>`)}
            </tbody>
          </table>
        </div>
        <div class="wfm-legenda">
          ${dados.turnos.map((t) => html`<span key=${t.id_turno} class="wfm-chip" style=${{ '--wfm-cor': t.cor }}>${t.codigo}</span><span class="wfm-legenda-txt">${t.nome}${t.entrada ? ` ${t.entrada}–${t.saida}` : ''}</span>`)}
        </div>`}

      ${!somentePropria && validacao ? html`
        <div class=${`wfm-validacao ${validacao.violacoes.length ? (bloqueio ? 'is-bloqueio' : 'is-alerta') : 'is-ok'}`} role="status">
          <strong>${validacao.violacoes.length ? `${validacao.violacoes.length} violação(ões) nas regras trabalhistas` : 'Escala dentro das regras trabalhistas'}</strong>
          ${duro ? html`<p>Há violação de lei que nem o Gestor/RH pode publicar. Corrija a escala.</p>` : bloqueio ? html`<p>${podePublicarComViolacao ? 'Você pode publicar com justificativa (fica registrada em auditoria).' : 'Não é possível publicar até corrigir. Somente o Gestor/RH publica com violação pendente.'}</p>` : null}
          <ul>${validacao.violacoes.slice(0, 40).map((v, i) => html`<li key=${i}><b>${v.operador}</b> · ${v.data.split('-').reverse().join('/')} · ${v.mensagem}${v.permite_override ? '' : ' (lei)'}</li>`)}</ul>
        </div>` : null}

      ${editavel || (!somentePropria && pode('wfm.escala.publicar')) ? html`
        <div class="wfm-acoes">
          ${(bloqueio && podePublicarComViolacao) || exigeJustFechada || totalPend > 0 && fechada ? html`
            <label class="mon-campo wfm-just"><span>Justificativa ${exigeJustFechada || bloqueio ? '(obrigatória)' : ''}</span>
              <input class="form-control" maxlength="400" value=${justificativa} onInput=${(e) => setJustificativa(e.target.value)} placeholder=${exigeJustFechada ? 'Motivo da correção após o fechamento' : 'Motivo para publicar com violação pendente'} />
            </label>` : null}
          ${editavel ? html`<button type="button" class="btn btn-primary" disabled=${ocupado || totalPend === 0 || (fechada && !justificativa.trim())} onClick=${salvar}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('check')}</span>Salvar alterações${totalPend ? ` (${totalPend})` : ''}</button>` : null}
          ${totalPend ? html`<button type="button" class="btn btn-outline-secondary" onClick=${() => setPendentes({})}>Descartar</button>` : null}
          ${pode('wfm.escala.publicar') ? html`<button type="button" class="btn btn-outline-primary" disabled=${publicarBloqueado} title=${totalPend ? 'Salve as alterações antes de publicar.' : ''} onClick=${publicar}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('event_available')}</span>Publicar nova versão</button>` : null}
          ${pode('wfm.escala.fechar') && !fechada ? html`<button type="button" class="btn btn-outline-secondary" disabled=${ocupado || !dados.status.versao_publicada} onClick=${fechar}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('lock')}</span>Fechar período</button>` : null}
        </div>` : null}

      ${!somentePropria && versoes.length ? html`
        <details class="wfm-versoes">
          <summary>Histórico de versões (${versoes.length})</summary>
          <div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Versão</th><th>Publicada por</th><th>Em</th><th>Violação</th><th>Justificativa</th></tr></thead>
            <tbody>${versoes.map((v) => html`<tr key=${v.versao}><td>v${v.versao}</td><td>${v.publicado_por || '—'}</td><td>${dataHora(v.publicado_em)}</td><td>${v.com_violacao ? 'Sim' : 'Não'}</td><td>${v.justificativa || '—'}</td></tr>`)}</tbody></table></div>
        </details>` : null}
    </section>`;
}
