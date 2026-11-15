import { html, useState } from '../../../infraestrutura-react.js';
import { Campo, Ic, Janela, JanelaForm } from '../../../ui/components/ds.js?v=20261106-wfm';
import { CANAIS, ROTULO_TURNO, numeroOuVazio, turnoPelaHora } from './regras.js';

// Janelas do Diário de bordo: intercorrência, parcial, motivo (reabrir/excluir) e correção do ABS.
// Erro do servidor aparece DENTRO da janela; nada some do que foi digitado.

const msg = (e) => e?.message || 'Não foi possível gravar. Tente de novo.';

export function JanelaMotivo({ titulo, texto, rotulo = 'Motivo', salvarRotulo = 'Confirmar', onClose, onConfirmar }) {
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const enviar = async (ev) => {
    ev.preventDefault();
    if (!motivo.trim()) { setErro('Escreva o motivo.'); return; }
    setSalvando(true); setErro('');
    try { await onConfirmar(motivo.trim()); onClose(); } catch (e) { setErro(msg(e)); setSalvando(false); }
  };
  return html`<${JanelaForm} titulo=${titulo} onClose=${onClose} onSubmit=${enviar} erro=${erro} salvando=${salvando} salvarRotulo=${salvarRotulo}>
    ${texto ? html`<p class="c-ajuda" style=${{ margin: 0 }}>${texto}</p>` : null}
    <${Campo} rotulo=${rotulo} cheio=${true}><textarea class="c-entrada" rows="3" autofocus value=${motivo} onInput=${(e) => setMotivo(e.target.value)}></textarea><//>
  <//>`;
}

export function JanelaIntercorrencia({ operacao, data, item, ferramentas, onClose, onSalvar }) {
  const ativas = ferramentas.filter((f) => f.ativo || f.id_item === item?.id_ferramenta);
  const agora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const padrao = `${data}T${pad(agora.getHours())}:${pad(agora.getMinutes())}`;
  const [f, setF] = useState(() => ({
    id_ferramenta: item?.id_ferramenta ? String(item.id_ferramenta) : '',
    canal: item?.canal || '',
    inicio: item?.inicio ? item.inicio.slice(0, 16) : padrao,
    fim: item?.fim ? item.fim.slice(0, 16) : '',
    descricao: item?.descricao || '',
    acao: item?.acao || '',
    chamado: item?.chamado || '',
  }));
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const mudar = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const enviar = async (ev) => {
    ev.preventDefault();
    if (!f.id_ferramenta) return setErro('Escolha a ferramenta.');
    if (!f.canal) return setErro('Escolha o canal afetado.');
    if (!f.inicio) return setErro('Informe quando começou.');
    if (f.fim && f.fim < f.inicio) return setErro('O fim não pode ser antes do começo.');
    if (!f.descricao.trim()) return setErro('Escreva o que aconteceu.');
    setSalvando(true); setErro('');
    try {
      await onSalvar({ ...f, id_ferramenta: Number(f.id_ferramenta), fim: f.fim || null, operacao, versao: item?.versao });
      onClose();
    } catch (e) { setErro(msg(e)); setSalvando(false); }
  };
  const turno = f.inicio ? ROTULO_TURNO[turnoPelaHora(f.inicio.slice(11, 16))] : '—';
  return html`<${Janela} titulo=${item ? 'Intercorrência' : 'Registrar intercorrência'} onClose=${onClose}>
    <form class="c-janela-form" noValidate onSubmit=${enviar}>
      <div class="c-janela-corpo"><div class="c-form" style=${{ '--colunas': 2 }}>
        <${Campo} rotulo="Ferramenta"><select class="c-entrada" value=${f.id_ferramenta} onChange=${mudar('id_ferramenta')}>
          <option value="">Escolha</option>${ativas.map((x) => html`<option key=${x.id_item} value=${String(x.id_item)}>${x.nome}</option>`)}</select><//>
        <${Campo} rotulo="Canal afetado"><select class="c-entrada" value=${f.canal} onChange=${mudar('canal')}>
          <option value="">Escolha</option>${CANAIS.map(([v, r]) => html`<option key=${v} value=${v}>${r}</option>`)}</select><//>
        <${Campo} rotulo="Começou"><input class="c-entrada" type="datetime-local" value=${f.inicio} onInput=${mudar('inicio')} /><//>
        <${Campo} rotulo="Terminou" opcional=${false} ajuda="Vazio = em aberto"><input class="c-entrada" type="datetime-local" value=${f.fim} onInput=${mudar('fim')} /><//>
        <${Campo} rotulo="O que aconteceu" cheio=${true} ajuda="Sem nome, CPF ou telefone de cliente."><textarea class="c-entrada" rows="2" value=${f.descricao} onInput=${mudar('descricao')}></textarea><//>
        <${Campo} rotulo="O que foi feito" opcional=${true}><input class="c-entrada" value=${f.acao} onInput=${mudar('acao')} /><//>
        <${Campo} rotulo="Chamado" opcional=${true}><input class="c-entrada" placeholder="Nº do chamado de TI" value=${f.chamado} onInput=${mudar('chamado')} /><//>
      </div>
      ${erro ? html`<div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${erro}</p></div></div>` : null}
      </div>
      <div class="c-janela-rodape"><span class="c-ajuda" style=${{ marginRight: 'auto', alignSelf: 'center' }}>Turno: ${turno} (pela hora de início)</span>
        <button type="button" class="c-botao c-botao--secundario" onClick=${onClose}>Cancelar</button>
        <button type="submit" class="c-botao c-botao--principal" disabled=${salvando || null}>${salvando ? 'Salvando…' : item ? 'Salvar' : 'Registrar'}</button></div>
    </form>
  <//>`;
}

export function JanelaParcial({ canais, item, onClose, onSalvar }) {
  const [hora, setHora] = useState(item?.hora || '');
  const [valores, setValores] = useState(() => Object.fromEntries(canais.map((c) => [c.id_item, item?.valores?.[c.id_item] ?? ''])));
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const enviar = async (ev) => {
    ev.preventDefault();
    if (!/^\d{2}:\d{2}$/.test(hora)) return setErro('Informe o horário da parcial.');
    setSalvando(true); setErro('');
    try {
      await onSalvar({ hora, valores: Object.fromEntries(Object.entries(valores).map(([k, v]) => [k, numeroOuVazio(v)])) });
      onClose();
    } catch (e) { setErro(msg(e)); setSalvando(false); }
  };
  return html`<${JanelaForm} titulo=${item ? `Parcial das ${item.hora}` : 'Nova parcial'} onClose=${onClose} onSubmit=${enviar} erro=${erro} salvando=${salvando}>
    <div class="c-form" style=${{ '--colunas': 2 }}>
      <${Campo} rotulo="Horário"><input class="c-entrada" type="time" value=${hora} onInput=${(e) => setHora(e.target.value)} /><//>
      ${canais.map((c) => html`<${Campo} key=${c.id_item} rotulo=${c.nome} ajuda="Vazio = não informado"><input class="c-entrada" inputmode="numeric" placeholder="—" value=${valores[c.id_item]} onInput=${(e) => setValores((v) => ({ ...v, [c.id_item]: e.target.value }))} /><//>`)}
    </div>
  <//>`;
}

const CAMPOS_ABS = [['presentes', 'Presentes'], ['faltas', 'Faltas'], ['justificadas', 'Justificadas'], ['folgas', 'Folgas'], ['ferias', 'Férias']];

export function JanelaAbs({ atual, onClose, onSalvar }) {
  const [v, setV] = useState(() => Object.fromEntries(CAMPOS_ABS.map(([k]) => [k, String(atual?.[k] ?? 0)])));
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const enviar = async (ev) => {
    ev.preventDefault();
    if (CAMPOS_ABS.some(([k]) => numeroOuVazio(v[k]) === null)) return setErro('Preencha todos os números (use 0 quando não houver).');
    if (!motivo.trim()) return setErro('O motivo da correção é obrigatório.');
    setSalvando(true); setErro('');
    try { await onSalvar({ ...Object.fromEntries(CAMPOS_ABS.map(([k]) => [k, numeroOuVazio(v[k])])), motivo: motivo.trim() }); onClose(); } catch (e) { setErro(msg(e)); setSalvando(false); }
  };
  return html`<${JanelaForm} titulo="Corrigir ABS" onClose=${onClose} onSubmit=${enviar} erro=${erro} salvando=${salvando} salvarRotulo="Salvar correção">
    <p class="c-ajuda" style=${{ margin: 0 }}>O valor da Presença continua guardado no histórico. A imagem e o texto do fechamento passam a usar o corrigido.</p>
    <div class="c-form" style=${{ '--colunas': 3 }}>
      ${CAMPOS_ABS.map(([k, r]) => html`<${Campo} key=${k} rotulo=${r}><input class="c-entrada" inputmode="numeric" value=${v[k]} onInput=${(e) => setV((x) => ({ ...x, [k]: e.target.value }))} /><//>`)}
    </div>
    <${Campo} rotulo="Motivo" cheio=${true}><textarea class="c-entrada" rows="2" value=${motivo} onInput=${(e) => setMotivo(e.target.value)} placeholder="Ex.: 2 atestados chegaram depois do lançamento da Presença"></textarea><//>
  <//>`;
}
