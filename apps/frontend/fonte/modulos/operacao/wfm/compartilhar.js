import { html, useEffect, useRef, useState } from '../../infraestrutura-react.js';
import { IconeSvg } from '../../ui/icone.js';
import { exportarEscalaWfm } from '../../services/api/wfm.js';
import { baixarArquivo } from '../monitoria/comum.js';
import { infoDia } from './comum.js';

// Compartilhar / exportar a escala do mês: planilha (xlsx) e CSV vêm do servidor (já filtrados pelo escopo do
// usuário); PDF e imagem (PNG) são desenhados aqui, a partir da grade que o usuário está vendo, sem bibliotecas.
// "Compartilhar" usa o compartilhamento do sistema (Web Share) com o PDF; sem ele, baixa o PDF e copia o link.

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function tituloEscala(nomeOperacao, anoMes) {
  const [a, m] = anoMes.split('-').map(Number);
  return `Escala — ${nomeOperacao} — ${MESES[m - 1]} de ${a}`;
}

// Nome de arquivo seguro: sem acento, espaço ou caractere especial.
function nomeArquivo(nomeOperacao, anoMes, ext) {
  const base = String(nomeOperacao || 'escala').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `escala_${base}_${anoMes}.${ext}`;
}

function textoLegivel(cor) {
  const hex = String(cor || '#1f5fbf').replace('#', '');
  const cheio = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex.slice(0, 6);
  const r = parseInt(cheio.slice(0, 2), 16), g = parseInt(cheio.slice(2, 4), 16), b = parseInt(cheio.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1f2937' : '#ffffff';
}

// Desenha a grade (colaboradores x dias) em um canvas. `dados` = resposta de /wfm/escala.
export function desenharEscala(dados, titulo, subtitulo) {
  const turnos = Object.fromEntries((dados.turnos || []).map((t) => [t.id_turno, t]));
  const itens = Object.fromEntries((dados.itens || []).map((i) => [`${i.id_operador}:${i.data}`, i]));
  const dias = dados.dias || [];
  const operadores = dados.operadores || [];
  const escala = 2; // resolução (nítido ao ampliar/imprimir)
  const margem = 24, nomeW = 208, linhaH = 28, cabH = 44, topoH = 72;
  const usados = (dados.turnos || []).filter((t) => dias.some((d) => operadores.some((o) => itens[`${o.id_usuario}:${d}`]?.id_turno === t.id_turno)));
  // Mede os textos antes de desenhar: código e nome do turno nunca são cortados (célula, chip e legenda se ajustam).
  const medida = document.createElement('canvas').getContext('2d');
  const medir = (peso, tam, texto) => { medida.font = `${peso} ${tam}px "Segoe UI", system-ui, -apple-system, Arial, sans-serif`; return Math.ceil(medida.measureText(texto).width); };
  const maxCodigo = usados.reduce((m, t) => Math.max(m, medir(700, 10, String(t.codigo))), 0);
  const celW = Math.max(32, maxCodigo + 12);
  const chipW = Math.max(28, maxCodigo + 12);
  const rotuloTurno = (t) => `${t.nome}${t.entrada ? ` · ${t.entrada}–${t.saida}` : ''}`;
  const maxRotulo = usados.reduce((m, t) => Math.max(m, medir(400, 11, rotuloTurno(t))), 0);
  const colunaLegendaW = chipW + 8 + maxRotulo + 24;
  const gradeW = nomeW + celW * dias.length;
  const colunasLegenda = Math.max(1, Math.min(3, Math.floor(gradeW / colunaLegendaW)));
  const legendaH = usados.length ? 32 + Math.ceil(usados.length / colunasLegenda) * 24 : 0;
  const largura = margem * 2 + Math.max(gradeW, usados.length ? colunaLegendaW : 0);
  const altura = topoH + cabH + linhaH * operadores.length + legendaH + margem;
  const canvas = document.createElement('canvas');
  canvas.width = largura * escala;
  canvas.height = altura * escala;
  const c = canvas.getContext('2d');
  c.scale(escala, escala);
  const fonte = (peso, tam) => { c.font = `${peso} ${tam}px "Segoe UI", system-ui, -apple-system, Arial, sans-serif`; };
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, largura, altura);

  c.fillStyle = '#111827'; fonte(700, 18); c.textBaseline = 'alphabetic';
  c.fillText(titulo, margem, margem + 18);
  c.fillStyle = '#6b7280'; fonte(400, 12);
  c.fillText(subtitulo, margem, margem + 40);

  const x0 = margem, y0 = topoH;
  // cabeçalho
  c.fillStyle = '#f3f4f6'; c.fillRect(x0, y0, nomeW + celW * dias.length, cabH);
  c.fillStyle = '#374151'; fonte(600, 12); c.textBaseline = 'middle';
  c.fillText('Colaborador', x0 + 8, y0 + cabH / 2);
  dias.forEach((d, i) => {
    const inf = infoDia(d);
    const x = x0 + nomeW + i * celW;
    if (inf.fimDeSemana) { c.fillStyle = '#e5e7eb'; c.fillRect(x, y0, celW, cabH); }
    c.fillStyle = '#374151'; c.textAlign = 'center';
    fonte(700, 12); c.fillText(String(inf.dia), x + celW / 2, y0 + 17);
    fonte(400, 10); c.fillStyle = '#6b7280'; c.fillText(inf.semana, x + celW / 2, y0 + 33);
    c.textAlign = 'left';
  });
  // linhas
  operadores.forEach((op, r) => {
    const y = y0 + cabH + r * linhaH;
    if (r % 2) { c.fillStyle = '#fafafa'; c.fillRect(x0, y, nomeW + celW * dias.length, linhaH); }
    c.fillStyle = '#111827'; fonte(500, 12); c.textAlign = 'left';
    let nome = op.nome;
    while (c.measureText(nome).width > nomeW - 16 && nome.length > 4) nome = nome.slice(0, -2);
    c.fillText(nome === op.nome ? nome : `${nome}…`, x0 + 8, y + linhaH / 2);
    dias.forEach((d, i) => {
      const t = turnos[itens[`${op.id_usuario}:${d}`]?.id_turno];
      if (!t) return;
      const x = x0 + nomeW + i * celW;
      c.fillStyle = t.cor || '#1f5fbf';
      const w = celW - 6, h = linhaH - 8, rx = x + 3, ry = y + 4, raio = 4;
      c.beginPath();
      c.moveTo(rx + raio, ry); c.arcTo(rx + w, ry, rx + w, ry + h, raio); c.arcTo(rx + w, ry + h, rx, ry + h, raio);
      c.arcTo(rx, ry + h, rx, ry, raio); c.arcTo(rx, ry, rx + w, ry, raio); c.closePath(); c.fill();
      c.fillStyle = textoLegivel(t.cor); fonte(700, 10); c.textAlign = 'center';
      c.fillText(String(t.codigo), x + celW / 2, y + linhaH / 2 + 0.5);
      c.textAlign = 'left';
    });
  });
  // grade
  c.strokeStyle = '#e5e7eb'; c.lineWidth = 1;
  for (let r = 0; r <= operadores.length; r += 1) {
    const y = y0 + cabH + r * linhaH + 0.5;
    c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + nomeW + celW * dias.length, y); c.stroke();
  }
  for (let i = 0; i <= dias.length; i += 1) {
    const x = x0 + nomeW + i * celW + 0.5;
    c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y0 + cabH + linhaH * operadores.length); c.stroke();
  }
  c.strokeStyle = '#d1d5db'; c.strokeRect(x0 + 0.5, y0 + 0.5, nomeW + celW * dias.length, cabH + linhaH * operadores.length);
  // legenda
  if (usados.length) {
    const yl = y0 + cabH + linhaH * operadores.length + 24;
    c.fillStyle = '#374151'; fonte(700, 12); c.textAlign = 'left'; c.fillText('Legenda', x0, yl);
    const larg = Math.max(gradeW / colunasLegenda, colunaLegendaW);
    usados.forEach((t, i) => {
      const x = x0 + (i % colunasLegenda) * larg, y = yl + 18 + Math.floor(i / colunasLegenda) * 24;
      c.fillStyle = t.cor || '#1f5fbf'; c.fillRect(x, y - 10, chipW, 16);
      c.fillStyle = textoLegivel(t.cor); fonte(700, 10); c.textAlign = 'center'; c.fillText(String(t.codigo), x + chipW / 2, y - 2);
      c.textAlign = 'left'; c.fillStyle = '#374151'; fonte(400, 11);
      c.fillText(rotuloTurno(t), x + chipW + 8, y - 2);
    });
  }
  return canvas;
}

const paraBlob = (canvas, tipo, qualidade) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Não foi possível gerar o arquivo.'))), tipo, qualidade));

// PDF de uma página com a imagem da grade (JPEG embutido). Sem dependências.
export async function canvasParaPdf(canvas) {
  const jpeg = new Uint8Array(await (await paraBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
  const larg = Math.round(canvas.width * 0.375), alt = Math.round(canvas.height * 0.375); // 2x px -> pontos (0,75 pt/px)
  const enc = new TextEncoder();
  const partes = [];
  const offsets = [];
  let tamanho = 0;
  const empurrar = (dados) => { const b = typeof dados === 'string' ? enc.encode(dados) : dados; partes.push(b); tamanho += b.length; };
  const objeto = (n, corpo) => { offsets[n] = tamanho; empurrar(`${n} 0 obj\n`); empurrar(corpo); empurrar('\nendobj\n'); };
  const conteudo = `q ${larg} 0 0 ${alt} 0 0 cm /Im0 Do Q`;
  empurrar('%PDF-1.4\n');
  objeto(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objeto(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objeto(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${larg} ${alt}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = tamanho;
  empurrar(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  empurrar(jpeg);
  empurrar('\nendstream\nendobj\n');
  objeto(5, `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`);
  const xref = tamanho;
  let tabela = 'xref\n0 6\n0000000000 65535 f \n';
  for (let n = 1; n <= 5; n += 1) tabela += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  empurrar(`${tabela}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(partes, { type: 'application/pdf' });
}

// Menu da escala. Com `aoVerMes`/`aoConfigurar` vira o botão "Ações" (Ver mês, Compartilhar, Configurações); sem eles,
// só Compartilhar/exportar (visão do mês).
export function MenuCompartilharEscala({ operacao, anoMes, dados, nomeOperacao, showToast, aoVerMes, aoConfigurar, rotuloVer = 'Visualizar escala (mês)', iconeVer = 'calendar_month' }) {
  const comAcoes = !!(aoVerMes || aoConfigurar);
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const raiz = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (raiz.current && !raiz.current.contains(e.target)) setAberto(false); };
    const esc = (e) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);

  const rotuloSub = () => {
    const ap = dados?.aprovacao?.estado;
    const situacao = dados?.status?.versao_publicada ? `versão publicada ${dados.status.versao_publicada}` : 'ainda não publicada';
    const aprov = ap === 'APROVADA' ? ' · aprovada' : ap === 'EM_APROVACAO' ? ' · em aprovação' : '';
    return `${situacao}${aprov} · gerada em ${new Date().toLocaleString('pt-BR')}`;
  };
  const gerar = async (formato) => {
    const titulo = tituloEscala(nomeOperacao, anoMes);
    const canvas = desenharEscala(dados, titulo, rotuloSub());
    if (formato === 'png') return { blob: await paraBlob(canvas, 'image/png'), filename: nomeArquivo(nomeOperacao, anoMes, 'png') };
    return { blob: await canvasParaPdf(canvas), filename: nomeArquivo(nomeOperacao, anoMes, 'pdf') };
  };
  const executar = async (acao) => {
    setOcupado(true);
    setAberto(false);
    try { await acao(); } catch (e) { showToast?.(e?.message || 'Não foi possível concluir.', 'error'); } finally { setOcupado(false); }
  };
  const baixarServidor = (formato) => executar(async () => baixarArquivo(await exportarEscalaWfm(operacao, anoMes, formato)));
  const baixarLocal = (formato) => executar(async () => baixarArquivo(await gerar(formato)));
  const compartilhar = () => executar(async () => {
    const { blob, filename } = await gerar('pdf');
    const arquivo = new File([blob], filename, { type: 'application/pdf' });
    const titulo = tituloEscala(nomeOperacao, anoMes);
    if (navigator.canShare?.({ files: [arquivo] })) {
      try { await navigator.share({ files: [arquivo], title: titulo, text: titulo }); } catch (e) { if (e?.name !== 'AbortError') throw e; }
      return;
    }
    baixarArquivo({ blob, filename });
    try { await navigator.clipboard.writeText(window.location.href); showToast?.('PDF baixado e link da escala copiado. Anexe o arquivo ou cole o link na conversa.', 'success'); }
    catch { showToast?.('PDF baixado. Anexe o arquivo à conversa para compartilhar.', 'success'); }
  });

  const vazio = !dados || !(dados.operadores || []).length;
  return html`
    <div class="wfm-menu" ref=${raiz}>
      <button type="button" class="btn btn-outline-secondary btn-sm" aria-haspopup="menu" aria-expanded=${aberto} disabled=${ocupado || (vazio && !comAcoes)} onClick=${() => setAberto(!aberto)}>
        <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(comAcoes ? 'more_vert' : 'share')}</span>${comAcoes ? 'Ações' : 'Compartilhar'}
      </button>
      ${aberto ? html`
        <div class="wfm-menu-lista" role="menu">
          ${aoVerMes ? html`<button type="button" role="menuitem" onClick=${() => { setAberto(false); aoVerMes(); }}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(iconeVer)}</span>${rotuloVer}</button>` : null}
          <button type="button" role="menuitem" disabled=${vazio} onClick=${compartilhar}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('share')}</span>Compartilhar escala</button>
          <hr />
          <button type="button" role="menuitem" onClick=${() => baixarServidor('xlsx')}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('table_view')}</span>Exportar Excel (.xlsx)</button>
          <button type="button" role="menuitem" onClick=${() => baixarServidor('csv')}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('description')}</span>Exportar CSV</button>
          <button type="button" role="menuitem" onClick=${() => baixarLocal('pdf')}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('picture_as_pdf')}</span>Exportar PDF</button>
          <button type="button" role="menuitem" onClick=${() => baixarLocal('png')}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('image')}</span>Exportar imagem (PNG)</button>
          ${aoConfigurar ? html`<hr /><button type="button" role="menuitem" onClick=${() => { setAberto(false); aoConfigurar(); }}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('settings')}</span>Configurações</button>` : null}
        </div>` : null}
    </div>`;
}
