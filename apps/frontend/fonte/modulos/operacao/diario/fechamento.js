import { html, useEffect, useMemo, useState } from '../../../infraestrutura-react.js';
import { registrarEnvioDiario } from '../../../services/api/diario.js';
import { Ic, Janela, Segmento } from '../../../ui/components/ds.js?v=20261106-wfm';
import { avisosDoTurno, consolidar, diaLongo, hhmm, nf, pct } from './regras.js';

// Fechamento para o grupo (D9, amostra quadro 3): imagem em pé (PNG de 1080 px gerado no navegador) e texto no formato do
// WhatsApp, os dois a partir dos DADOS SALVOS. O Conecta não envia nada sozinho: 3 passos (gerado → copiado/baixado →
// "Marquei: enviei ao grupo"), e só a pessoa marca o último.

const SECOES = [['totais', 'Totais do dia'], ['demandas', 'Demandas por tipo'], ['ns', 'Nível de serviço'], ['parciais', 'Parciais'], ['abs', 'ABS'], ['interc', 'Intercorrências'], ['passagem', 'Passagem']];
const CHAVE_SECOES = 'conecta.diario.secoesFechamento';
const lerSecoes = () => {
  try { const v = JSON.parse(window.localStorage.getItem(CHAVE_SECOES) || 'null'); if (Array.isArray(v)) return new Set(v); } catch { /* sem armazenamento: usa o padrão */ }
  return new Set(SECOES.map(([k]) => k).filter((k) => k !== 'parciais'));
};
const gravarSecoes = (s) => { try { window.localStorage.setItem(CHAVE_SECOES, JSON.stringify([...s])); } catch { /* ignora */ } };
const agoraHHMM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// Monta o conteúdo (o mesmo para a imagem, a prévia e o texto).
export function montarFechamento({ dados, escopo, turnoSel, secoes, operacaoNome, autor }) {
  const cad = Object.fromEntries(dados.cadastros.map((c) => [String(c.id_item), c]));
  const salvos = {};
  dados.turnos.forEach((t) => { if (t.estado !== 'vazio') salvos[t.turno] = { demandas: t.demandas, ns: t.ns }; });
  const soTurno = escopo === 'turno' && turnoSel;
  const base = soTurno ? { [turnoSel.turno]: salvos[turnoSel.turno] || { demandas: {}, ns: {} } } : salvos;
  const cons = consolidar(base, dados.ids_demanda.map(String), dados.ids_ns.map(String));
  const turnosAlvo = soTurno ? [turnoSel] : dados.turnos;
  const avisos = turnosAlvo.filter((t) => t.status !== 'concluido').reduce((s, t) => {
    const linhas = dados.ids_demanda.map((id) => ({ id_item: id, nome: cad[id]?.nome, inicio: t.demandas[id]?.inicio ?? null, fim: t.demandas[id]?.fim ?? null }));
    return s + avisosDoTurno(linhas).length;
  }, 0);
  const pendentes = turnosAlvo.filter((t) => t.status !== 'concluido').map((t) => t.rotulo);
  const abs = dados.abs?.vigente;
  const interc = dados.intercorrencias.filter((i) => !i.excluida && (!soTurno || i.turno === turnoSel.turno));
  const canaisParcial = dados.cadastros.filter((c) => c.tipo === 'canal_parcial');
  return {
    titulo: `Diário de bordo · ${operacaoNome}`,
    subtitulo: `${diaLongo(dados.data)} · ${soTurno ? turnoSel.rotulo : 'Dia todo'}`,
    rascunho: pendentes.length ? `RASCUNHO · ${pendentes.join(', ')} sem concluir${avisos ? ` · ${avisos} aviso${avisos > 1 ? 's' : ''}` : ''}` : '',
    secoes,
    totais: cons.totais,
    rotulosTotais: soTurno ? ['início do turno', 'tratadas', 'fim do turno'] : ['início do dia', 'tratadas', 'pendentes'],
    demandas: cons.demandas.map((d) => ({ nome: cad[d.id_item]?.nome || '', inicio: d.inicio, tratadas: d.tratadas, pendente: d.pendente })),
    ns: cons.ns.map((n) => ({ nome: cad[n.id_item]?.nome || '', valor: n.valor })),
    abs,
    parciais: dados.parciais.map((p) => ({ hora: p.hora, texto: canaisParcial.map((c) => `${c.nome} ${nf(p.valores[c.id_item] ?? null)}`).join(' · '), total: p.total })),
    interc: interc.map((i) => ({ quando: `${hhmm(i.inicio)}${i.fim ? `–${hhmm(i.fim)}` : ''}`, ferramenta: i.ferramenta, aberta: !i.fim })),
    passagem: soTurno ? '' : (dados.dia?.passagem || ''),
    rodape: `Gerado ${agoraHHMM()} por ${autor} · Conecta · Central 24 Horas`,
  };
}

export function textoWhatsapp(f) {
  const s = f.secoes;
  const l = [`📘 *${f.titulo.toUpperCase()}*`, `📅 ${f.subtitulo}`];
  if (f.rascunho) l.push(`_(${f.rascunho.toLowerCase()})_`);
  if (s.has('totais')) l.push('', `📊 *Demandas*: ${f.rotulosTotais[0]} ${nf(f.totais.inicio)} · tratadas ${nf(f.totais.tratadas)} · ${f.rotulosTotais[2]} ${nf(f.totais.pendente)}`);
  if (s.has('demandas')) { if (!s.has('totais')) l.push('', '📊 *Demandas* (início · tratadas · pendentes)'); f.demandas.forEach((d) => l.push(`• ${d.nome}: ${nf(d.inicio)} · ${nf(d.tratadas)} · ${nf(d.pendente)}`)); }
  if (s.has('ns')) l.push('', `🎯 *Nível de serviço*: ${f.ns.map((n) => `${n.nome} ${n.valor === null ? 'não informado' : pct(n.valor)}`).join(' · ')}`);
  if (s.has('parciais') && f.parciais.length) { l.push('', '📈 *Parciais*'); f.parciais.forEach((p) => l.push(`• ${p.hora}: ${p.texto} · total ${nf(p.total)}`)); }
  if (s.has('abs') && f.abs) l.push(`👥 *ABS*: ${pct(f.abs.abs)} (${f.abs.faltas} faltas, ${f.abs.justificadas} justificadas)`);
  if (s.has('interc')) { l.push('', '⚠️ *Intercorrências*'); if (!f.interc.length) l.push('• Nenhuma'); f.interc.forEach((i) => l.push(`• ${i.quando} ${i.ferramenta} (${i.aberta ? 'em aberto' : 'encerrada'})`)); }
  if (s.has('passagem') && f.passagem) l.push('', `🌙 *Passagem*: ${f.passagem}`);
  l.push('', `_${f.rodape}_`);
  return l.join('\n');
}

// ── Prévia em tela (mesmo desenho da imagem) ──
function CartaoImagem({ f }) {
  const s = f.secoes;
  return html`<div class="c-db-img" role="img" aria-label="Prévia da imagem do fechamento">
    <div class="c-db-img-cab"><img src="/estilos/marca/conecta_branco.svg" alt="" /><span><b>${f.titulo}</b>${f.subtitulo}</span></div>
    ${f.rascunho ? html`<div class="c-db-img-rasc">${f.rascunho}</div>` : null}
    ${s.has('totais') ? html`<div class="c-db-img-sec"><div class="c-db-img-kpi"><div><b>${nf(f.totais.inicio)}</b><span>${f.rotulosTotais[0]}</span></div><div><b>${nf(f.totais.tratadas)}</b><span>${f.rotulosTotais[1]}</span></div><div><b>${nf(f.totais.pendente)}</b><span>${f.rotulosTotais[2]}</span></div></div></div>` : null}
    ${s.has('demandas') ? html`<div class="c-db-img-sec"><h4>Demandas</h4><table><thead><tr><th>Tipo</th><th>Início</th><th>Trat.</th><th>Pend.</th></tr></thead>
      <tbody>${f.demandas.map((d) => html`<tr key=${d.nome}><td>${d.nome}</td><td>${nf(d.inicio)}</td><td>${nf(d.tratadas)}</td><td>${nf(d.pendente)}</td></tr>`)}</tbody></table></div>` : null}
    ${s.has('ns') || s.has('abs') ? html`<div class="c-db-img-sec c-db-img-duas">
      ${s.has('ns') ? html`<div><h4>Nível de serviço</h4>${f.ns.map((n, i) => html`<span key=${n.nome}>${i ? html`<br />` : null}${n.nome} <b>${pct(n.valor)}</b></span>`)}</div>` : html`<div></div>`}
      ${s.has('abs') && f.abs ? html`<div><h4>ABS</h4><b>${pct(f.abs.abs)}</b><br />${f.abs.faltas} faltas · ${f.abs.justificadas} justificadas</div>` : null}</div>` : null}
    ${s.has('parciais') && f.parciais.length ? html`<div class="c-db-img-sec"><h4>Parciais</h4>${f.parciais.map((p) => html`<div key=${p.hora}>${p.hora} · ${p.texto} · <b>${nf(p.total)}</b></div>`)}</div>` : null}
    ${s.has('interc') ? html`<div class="c-db-img-sec"><h4>Intercorrências</h4>${f.interc.length ? f.interc.map((i) => html`<div key=${i.quando + i.ferramenta} class=${i.aberta ? 'c-db-img-alerta' : null}>${i.quando} · <b>${i.ferramenta}</b> · ${i.aberta ? 'em aberto' : 'encerrada'}</div>`) : html`<div>Nenhuma</div>`}</div>` : null}
    ${s.has('passagem') && f.passagem ? html`<div class="c-db-img-sec"><h4>Passagem</h4>${f.passagem}</div>` : null}
    <div class="c-db-img-rod">${f.rodape}</div></div>`;
}

// ── PNG de 1080 px desenhado no canvas (sem biblioteca), com as cores dos tokens ──
function cores() {
  const cs = getComputedStyle(document.documentElement);
  const t = (n) => (cs.getPropertyValue(n) || '').trim(); // só tokens (o branco do cartão é o mesmo #fff do CSS aprovado)
  return {
    m900: t('--cor-marinho-900'), m800: t('--cor-marinho-800'), m600: t('--cor-marinho-600'), m100: t('--cor-marinho-100'),
    m50: t('--cor-marinho-50'), ouro: t('--cor-marca-ouro'), atencaoFundo: t('--cor-status-atencao-fundo'), atencaoTexto: t('--cor-status-atencao-texto'),
    alerta: t('--cor-status-perigo-texto'),
  };
}
const carregarImagem = (src) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; });

function desenhar(ctx, f, c, logo) {
  const W = 340; const P = 16; const s = f.secoes;
  const fonte = (peso, tam) => `${peso} ${tam}px "Nunito Sans", sans-serif`;
  let y = 0;
  const texto = (t, x, yy, { peso = 400, tam = 12, cor = c.m900, alinhar = 'left' } = {}) => { ctx.font = fonte(peso, tam); ctx.fillStyle = cor; ctx.textAlign = alinhar; ctx.fillText(String(t), x, yy); };
  const quebrar = (t, larg, tam = 12) => {
    ctx.font = fonte(400, tam); const linhas = []; let atual = '';
    String(t).split(/\s+/).forEach((p) => { const prova = atual ? `${atual} ${p}` : p; if (ctx.measureText(prova).width > larg && atual) { linhas.push(atual); atual = p; } else atual = prova; });
    if (atual) linhas.push(atual); return linhas;
  };
  const linhaSep = () => { ctx.fillStyle = c.m100; ctx.fillRect(0, y, W, 1); y += 1; };
  const tituloSec = (t) => { y += 8; texto(t.toUpperCase(), P, y + 10, { peso: 700, tam: 11, cor: c.m600 }); y += 16; };
  // Cabeçalho
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, 4000);
  ctx.fillStyle = c.m800; ctx.fillRect(0, 0, W, 46); ctx.fillStyle = c.ouro; ctx.fillRect(0, 46, W, 3);
  if (logo) { const h = 18; const w = (logo.width / logo.height) * h || 80; ctx.drawImage(logo, P, 14, w, h); }
  texto(f.titulo, W - P, 20, { peso: 700, tam: 12, cor: '#fff', alinhar: 'right' });
  texto(f.subtitulo, W - P, 35, { tam: 11, cor: '#fff', alinhar: 'right' });
  y = 49;
  if (f.rascunho) { ctx.fillStyle = c.atencaoFundo; ctx.fillRect(0, y, W, 16); texto(f.rascunho, P, y + 12, { peso: 700, tam: 10, cor: c.atencaoTexto }); y += 16; }
  if (s.has('totais')) {
    y += 8; const col = (W - 2 * P) / 3;
    [[f.totais.inicio, f.rotulosTotais[0]], [f.totais.tratadas, f.rotulosTotais[1]], [f.totais.pendente, f.rotulosTotais[2]]].forEach(([n, r], i) => {
      const x = P + col * i + col / 2; texto(nf(n), x, y + 22, { peso: 700, tam: 22, alinhar: 'center' }); texto(r, x, y + 38, { tam: 11, cor: c.m600, alinhar: 'center' });
    });
    y += 46; linhaSep();
  }
  if (s.has('demandas')) {
    tituloSec('Demandas');
    const cols = [W - P - 96, W - P - 48, W - P];
    texto('Tipo', P, y + 9, { peso: 600, tam: 10, cor: c.m600 }); ['Início', 'Trat.', 'Pend.'].forEach((h, i) => texto(h, cols[i], y + 9, { peso: 600, tam: 10, cor: c.m600, alinhar: 'right' })); y += 14;
    f.demandas.forEach((d) => { texto(d.nome, P, y + 12); [d.inicio, d.tratadas, d.pendente].forEach((v, i) => texto(nf(v), cols[i], y + 12, { alinhar: 'right' })); y += 18; });
    y += 4; linhaSep();
  }
  if (s.has('ns') || (s.has('abs') && f.abs)) {
    const y0 = y; let yE = y; let yD = y; const meio = W / 2;
    if (s.has('ns')) { y = y0; tituloSec('Nível de serviço'); f.ns.forEach((n) => { texto(`${n.nome}`, P, y + 14); ctx.font = fonte(400, 12); const w = ctx.measureText(`${n.nome} `).width; texto(pct(n.valor), P + w, y + 14, { peso: 700, tam: 16 }); y += 20; }); yE = y; }
    if (s.has('abs') && f.abs) {
      y = y0; ctx.save(); ctx.translate(meio - P, 0); tituloSec('ABS'); texto(pct(f.abs.abs), P, y + 14, { peso: 700, tam: 16 }); y += 20;
      texto(`${f.abs.faltas} faltas · ${f.abs.justificadas} justificadas`, P, y + 12); y += 18; ctx.restore(); yD = y;
    }
    y = Math.max(yE, yD) + 4; linhaSep();
  }
  if (s.has('parciais') && f.parciais.length) { tituloSec('Parciais'); f.parciais.forEach((p) => { quebrar(`${p.hora} · ${p.texto} · ${nf(p.total)}`, W - 2 * P).forEach((ln) => { texto(ln, P, y + 12); y += 16; }); }); y += 4; linhaSep(); }
  if (s.has('interc')) {
    tituloSec('Intercorrências');
    if (!f.interc.length) { texto('Nenhuma', P, y + 12); y += 16; }
    f.interc.forEach((i) => { texto(`${i.quando} · ${i.ferramenta} · ${i.aberta ? 'em aberto' : 'encerrada'}`, P, y + 12, { cor: i.aberta ? c.alerta : c.m900, peso: i.aberta ? 600 : 400 }); y += 16; });
    y += 4; linhaSep();
  }
  if (s.has('passagem') && f.passagem) { tituloSec('Passagem'); quebrar(f.passagem, W - 2 * P).forEach((ln) => { texto(ln, P, y + 12); y += 16; }); y += 4; linhaSep(); }
  ctx.fillStyle = c.m50; ctx.fillRect(0, y, W, 24); texto(f.rodape, P, y + 16, { tam: 10, cor: c.m600 }); y += 24;
  return y;
}

export async function gerarPng(f) {
  try { await document.fonts?.load('700 12px "Nunito Sans"'); await document.fonts?.load('400 12px "Nunito Sans"'); } catch { /* usa a letra que houver */ }
  const logo = await carregarImagem('/estilos/marca/conecta_branco.svg');
  const c = cores();
  const escala = 1080 / 340;
  const medida = document.createElement('canvas').getContext('2d');
  const altura = desenhar(medida, f, c, null);
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = Math.ceil(altura * escala);
  const ctx = canvas.getContext('2d'); ctx.scale(escala, escala);
  desenhar(ctx, f, c, logo);
  return new Promise((ok, falha) => canvas.toBlob((b) => (b ? ok(b) : falha(new Error('Não foi possível gerar a imagem.'))), 'image/png'));
}

async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); return true; } catch {
    const t = document.createElement('textarea'); t.value = texto; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  }
}

export function JanelaFechamento({ dados, ver, operacaoNome, controlador, onClose }) {
  const turnoSel = dados.turnos.find((t) => t.turno === ver) || null;
  const [previa, setPrevia] = useState('img');
  const [escopo, setEscopo] = useState(turnoSel ? 'turno' : 'dia');
  const [secoes, setSecoes] = useState(lerSecoes);
  const [envio, setEnvio] = useState(() => ({ ...dados.dia }));
  const [erro, setErro] = useState('');
  const autor = controlador?.estado?.nomeUsuarioAutenticado || 'você';
  const f = useMemo(() => montarFechamento({ dados, escopo, turnoSel, secoes, operacaoNome, autor }), [dados, escopo, secoes]);
  const texto = useMemo(() => textoWhatsapp(f), [f]);
  const salvoEm = dados.turnos.map((t) => t.salvo_em).filter(Boolean).sort().pop();

  const registrar = async (passo) => { try { setEnvio(await registrarEnvioDiario(dados.dia.id_dia, passo)); } catch (e) { setErro(e?.message || 'Não foi possível registrar o passo.'); } };
  useEffect(() => { registrar('gerado'); }, []);
  const alternar = (k) => setSecoes((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); gravarSecoes(n); return n; });

  const baixar = async () => {
    setErro('');
    try {
      const blob = await gerarPng(f);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `diario-de-bordo-${dados.operacao}-${dados.data}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      await registrar('baixado');
    } catch (e) { setErro(e?.message || 'Não foi possível gerar a imagem.'); }
  };
  const copiarTexto = async () => { setErro(''); if (await copiar(texto)) await registrar('copiado'); else setErro('O navegador não deixou copiar. Selecione o texto da prévia e copie.'); };

  const passo = (feito, titulo, sub) => html`<li class=${feito ? 'c-db-feito' : 'c-db-falta'}><${Ic} nome=${feito ? 'check-circle' : 'circle-dashed'} /><span>${titulo}${sub ? html`<small>${sub}</small>` : null}</span></li>`;
  const quando = (iso) => (iso ? hhmm(iso) : '');
  return html`<${Janela} titulo="Fechamento para o grupo" tamanho="grande" onClose=${onClose}
    rodape=${html`<span class="c-ajuda" style=${{ marginRight: 'auto', alignSelf: 'center' }}>${f.rascunho ? 'Há turno sem concluir ou com avisos: a imagem sai com "rascunho".' : 'Tudo concluído.'}</span>
      <button type="button" class="c-botao c-botao--secundario" onClick=${baixar}><${Ic} nome="tray-arrow-down" />Baixar imagem</button>
      <button type="button" class="c-botao c-botao--principal" onClick=${copiarTexto}><${Ic} nome="copy" />Copiar texto</button>`}>
    <div class="c-janela-corpo"><div class="c-db-fech">
      <div class="c-db-fech-esq">
        <div class="c-grupo"><${Segmento} rotulo="Prévia" valor=${previa} aoMudar=${setPrevia} opcoes=${[['img', 'Imagem'], ['txt', 'Texto']]} />
          ${turnoSel ? html`<div class="c-fim"><${Segmento} rotulo="De qual registro" valor=${escopo} aoMudar=${setEscopo} opcoes=${[['turno', `Só ${turnoSel.rotulo}`], ['dia', 'Dia todo']]} /></div>` : null}</div>
        ${previa === 'img' ? html`<div class="c-db-previa"><${CartaoImagem} f=${f} /></div>` : html`<div class="c-db-previa"><pre class="c-db-texto">${texto}</pre></div>`}
      </div>
      <div class="c-db-fech-dir">
        <h3 class="c-rotulo">O que entra</h3>
        <div class="c-db-oque">${SECOES.map(([k, r]) => html`<label key=${k} class="c-marcar"><input type="checkbox" checked=${secoes.has(k)} onChange=${() => alternar(k)} /> ${r}</label>`)}</div>
        <span class="c-ajuda">A escolha fica salva para a próxima vez.</span>
        <div class="c-db-sep"></div>
        <h3 class="c-rotulo">Situação do envio</h3>
        <ol class="c-db-passos">
          ${passo(Boolean(envio.envio_gerado_em), `Gerado ${quando(envio.envio_gerado_em)}`, salvoEm ? `com os dados salvos às ${hhmm(salvoEm)}` : '')}
          ${passo(Boolean(envio.envio_copiado_em || envio.envio_baixado_em), envio.envio_copiado_em ? `Texto copiado ${quando(envio.envio_copiado_em)}` : envio.envio_baixado_em ? `Imagem baixada ${quando(envio.envio_baixado_em)}` : 'Copiado ou baixado')}
          ${passo(Boolean(envio.envio_enviado_em), envio.envio_enviado_em ? `Enviado ao grupo ${quando(envio.envio_enviado_em)}` : 'Enviado ao grupo', envio.envio_enviado_em ? `marcado por ${envio.envio_enviado_por}` : 'o Conecta não envia sozinho: marque quando enviar')}
        </ol>
        <div><button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${Boolean(envio.envio_enviado_em) || null} onClick=${() => registrar('enviado')}><${Ic} nome="paper-plane-tilt" />Marquei: enviei ao grupo</button></div>
        ${erro ? html`<div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${erro}</p></div></div>` : null}
      </div>
    </div></div>
  <//>`;
}

