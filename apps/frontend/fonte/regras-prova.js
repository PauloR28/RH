import { ROTULOS_ETAPAS } from './rotulos-etapas.js';
import { obterDadosBaseExcel } from './features/prova/services/excel-base-data.js';
import { corrigirRespostaDiscursivaInteligente } from './features/prova/services/analise-resposta.js';
import {
  baixarBlob,
  contarFrases,
  contarItensListaNoHtml,
  removerHtml,
  sanitizarNomeArquivo,
  textoMaiusculoSeguro,
} from './utilitarios.js';

function obterBibliotecaXlsx() {
  if (!window.XLSX) {
    throw new Error('A biblioteca XLSX não foi carregada.');
  }

  return window.XLSX;
}

function criarResultadoPontuacao(
  score,
  max,
  notes = [],
  pendingManual = false,
  completedTasks = [],
  extra = {},
) {
  return { score, max, notes, pendingManual, completedTasks, ...extra };
}

function criarResultadoChecklist(tarefas, pontos, notas = []) {
  const listaValida = Array.isArray(tarefas) ? tarefas : [];
  const concluidas = listaValida.filter((tarefa) => !!tarefa.done).length;
  const score =
    listaValida.length > 0
      ? Math.round((concluidas / listaValida.length) * pontos)
      : 0;

  return {
    score,
    max: pontos,
    notes: notas,
    pendingManual: true,
    completedTasks: listaValida.map(
      (tarefa) => `${tarefa.done ? '[x]' : '[ ]'} ${tarefa.label}`,
    ),
    taskDetails: listaValida.map(normalizarDetalheTarefa),
  };
}

function resumirConclusaoChecklist(completedTasks = []) {
  const lista = Array.isArray(completedTasks) ? completedTasks : [];
  const total = lista.length;
  const concluidas = lista.filter((item) => String(item || '').startsWith('[x]')).length;

  return { total, concluidas };
}

function possuiValidacaoExcelImplementada(validation) {
  const notas = Array.isArray(validation?.notes) ? validation.notes : [];
  return !notas.some((item) =>
    String(item || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .includes('validacao nao implementada'),
  );
}

function obterPlanilha(workbook, nome) {
  return workbook.Sheets[nome];
}

function obterValorCelula(planilha, endereco) {
  if (!planilha || !planilha[endereco]) return '';
  if (planilha[endereco].w !== undefined) return planilha[endereco].w;
  if (planilha[endereco].v !== undefined) return planilha[endereco].v;
  return '';
}

function obterCelula(planilha, endereco) {
  return planilha && planilha[endereco] ? planilha[endereco] : null;
}

function celulaTemDados(planilha, endereco) {
  const celula = obterCelula(planilha, endereco);
  if (!celula) return false;

  if (celula.f !== undefined && celula.f !== null && String(celula.f).trim()) {
    return true;
  }

  const valor = obterValorCelula(planilha, endereco);
  return String(valor ?? '').trim() !== '';
}

function planilhaTemAutofiltro(planilha) {
  return !!(planilha && planilha['!autofilter']);
}

const LIMIAR_CONFIANCA_MEDIA = 0.55;
const LIMIAR_CONFIANCA_ALTA = 0.75;
const LIMIAR_CONFIANCA_BAIXA = 0.35;

function limitarNumero(valor, minimo = 0, maximo = 1) {
  const numero = Number(valor || 0);
  if (Number.isNaN(numero)) return minimo;
  return Math.min(maximo, Math.max(minimo, numero));
}

function normalizarTextoBusca(valor) {
  return String(valor ?? '')
    .replace(/[ÃÀÁÂÃÄÅ][\u0080-\u00bf]*/g, (trecho) => {
      const mapa = {
        'Ã¡': 'a',
        'Ã ': 'a',
        'Ã¢': 'a',
        'Ã£': 'a',
        'Ã¤': 'a',
        'Ã©': 'e',
        'Ãª': 'e',
        'Ã¨': 'e',
        'Ã«': 'e',
        'Ã­': 'i',
        'Ã®': 'i',
        'Ã¬': 'i',
        'Ã¯': 'i',
        'Ã³': 'o',
        'Ã´': 'o',
        'Ãµ': 'o',
        'Ã²': 'o',
        'Ã¶': 'o',
        'Ãº': 'u',
        'Ã»': 'u',
        'Ã¹': 'u',
        'Ã¼': 'u',
        'Ã§': 'c',
        'Ã‡': 'c',
      };
      return mapa[trecho] || trecho;
    })
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9%$.,=:+\-*/\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizarListaBusca(lista) {
  return (Array.isArray(lista) ? lista : [lista])
    .map((item) => normalizarTextoBusca(item))
    .filter(Boolean);
}

function textoContemAlgum(textoNormalizado, termos) {
  const termosNormalizados = normalizarListaBusca(termos);
  return termosNormalizados.some((termo) => textoNormalizado.includes(termo));
}

function contarTermosEncontrados(textoNormalizado, termos) {
  return normalizarListaBusca(termos).filter((termo) =>
    textoNormalizado.includes(termo),
  ).length;
}

function classificarConfianca(confidence) {
  const valor = limitarNumero(confidence);
  if (valor >= LIMIAR_CONFIANCA_ALTA) return 'alta confiança';
  if (valor >= LIMIAR_CONFIANCA_MEDIA) return 'média confiança';
  if (valor >= LIMIAR_CONFIANCA_BAIXA) return 'baixa confiança';
  return 'não encontrado';
}

function decodificarEndereco(endereco) {
  const partes = String(endereco || '').toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!partes) return null;

  let coluna = 0;
  for (const letra of partes[1]) {
    coluna = coluna * 26 + (letra.charCodeAt(0) - 64);
  }

  return {
    address: `${partes[1]}${partes[2]}`,
    col: coluna - 1,
    row: Number(partes[2]),
  };
}

function normalizarEndereco(endereco) {
  const coords = decodificarEndereco(endereco);
  return coords?.address || String(endereco || '').toUpperCase();
}

function normalizarNomePlanilha(nome) {
  return normalizarTextoBusca(nome);
}

function planilhaEhBase(nomePlanilha) {
  return normalizarNomePlanilha(nomePlanilha).startsWith('base ');
}

function obterTextoCelulaBruto(celula) {
  if (!celula) return '';
  if (celula.w !== undefined && celula.w !== null) return String(celula.w);
  if (celula.v !== undefined && celula.v !== null) return String(celula.v);
  return '';
}

function obterFormulaCelula(celula) {
  if (!celula || celula.f === undefined || celula.f === null) return '';
  const formula = String(celula.f).trim();
  return formula ? `=${formula.replace(/^=/, '')}` : '';
}

function celulaPossuiConteudo(celula) {
  return (
    !!obterFormulaCelula(celula) ||
    String(obterTextoCelulaBruto(celula) || '').trim() !== ''
  );
}

function converterNumeroSeguro(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;

  const texto = String(valor ?? '').trim();
  if (!texto) return null;

  let normalizado = texto.replace(/[^\d,.-]/g, '');
  if (!normalizado || normalizado === '-' || normalizado === ',') return null;

  if (normalizado.includes(',') && normalizado.includes('.')) {
    normalizado = normalizado.replace(/\./g, '').replace(',', '.');
  } else if (normalizado.includes(',')) {
    normalizado = normalizado.replace(',', '.');
  }

  const numero = Number(normalizado);
  return Number.isNaN(numero) ? null : numero;
}

function celulaEhInstrucao(celulaIndexada) {
  if (!celulaIndexada || celulaIndexada.formula) return false;
  if (converterNumeroSeguro(celulaIndexada.rawValue) !== null) return false;

  const texto = celulaIndexada.normalized;
  return (
    texto.startsWith('questao') ||
    /^\d+\)/.test(texto) ||
    texto.includes('utilize ') ||
    texto.includes('calcule ') ||
    texto.includes('crie ') ||
    texto.includes('insira ') ||
    texto.includes('organize ') ||
    texto.includes('com base ') ||
    texto.includes('baixe ') ||
    texto.includes('teste de conhecimentos')
  );
}

function criarIndiceWorkbook(workbook) {
  const sheetNames = Array.isArray(workbook?.SheetNames)
    ? workbook.SheetNames
    : Object.keys(workbook?.Sheets || {});
  const cells = [];
  const bySheet = {};
  const lookup = {};

  sheetNames.forEach((sheetName) => {
    const planilha = workbook?.Sheets?.[sheetName];
    if (!planilha) return;

    bySheet[sheetName] = [];
    lookup[sheetName] = {};

    Object.entries(planilha).forEach(([address, cell]) => {
      const coords = decodificarEndereco(address);
      if (!coords || !celulaPossuiConteudo(cell)) return;

      const rawText = obterTextoCelulaBruto(cell);
      const formula = obterFormulaCelula(cell);
      const indexedCell = {
        sheetName,
        sheet: planilha,
        address: coords.address,
        row: coords.row,
        col: coords.col,
        cell,
        rawValue: cell?.v,
        text: rawText,
        normalized: normalizarTextoBusca(rawText),
        formula,
        formulaNormalized: normalizarTextoBusca(formula),
      };

      cells.push(indexedCell);
      bySheet[sheetName].push(indexedCell);
      lookup[sheetName][`${coords.row}:${coords.col}`] = indexedCell;
    });
  });

  return { sheetNames, cells, bySheet, lookup };
}

function normalizarEstiloCelula(celula) {
  const estilo = celula?.s || {};
  return {
    z: celula?.z || estilo.numFmt || '',
    fill: estilo.fill || null,
    font: estilo.font || null,
    alignment: estilo.alignment || null,
    border: estilo.border || null,
    numFmt: estilo.numFmt || '',
  };
}

function normalizarCelulaComparacao(celula) {
  if (!celula) return null;
  return {
    t: celula.t || '',
    v: celula.v ?? '',
    f: celula.f || '',
    z: celula.z || '',
    s: normalizarEstiloCelula(celula),
  };
}

function serializarComparacao(valor) {
  return JSON.stringify(valor ?? null);
}

function celulasIguaisParaCorrecao(celulaModelo, celulaCandidato) {
  return (
    serializarComparacao(normalizarCelulaComparacao(celulaModelo)) ===
    serializarComparacao(normalizarCelulaComparacao(celulaCandidato))
  );
}

function obterEnderecosPlanilha(planilha) {
  return Object.keys(planilha || {}).filter((chave) => decodificarEndereco(chave));
}

function normalizarPlanilhaComparacao(planilha) {
  const cells = {};
  obterEnderecosPlanilha(planilha)
    .sort()
    .forEach((endereco) => {
      cells[normalizarEndereco(endereco)] = normalizarCelulaComparacao(planilha[endereco]);
    });

  return {
    ref: planilha?.['!ref'] || '',
    autofilter: planilha?.['!autofilter'] || null,
    merges: planilha?.['!merges'] || null,
    cols: planilha?.['!cols'] || null,
    rows: planilha?.['!rows'] || null,
    cells,
  };
}

function normalizarWorkbookComparacao(workbook) {
  const sheetNames = Array.isArray(workbook?.SheetNames)
    ? workbook.SheetNames
    : Object.keys(workbook?.Sheets || {});
  const sheets = {};
  sheetNames
    .slice()
    .sort((a, b) => String(a).localeCompare(String(b)))
    .forEach((sheetName) => {
      sheets[sheetName] = normalizarPlanilhaComparacao(workbook?.Sheets?.[sheetName]);
    });

  return {
    sheetNames: sheetNames.slice().sort((a, b) => String(a).localeCompare(String(b))),
    sheets,
  };
}

export function isArquivoExcelInalterado(modelo, candidato) {
  return (
    serializarComparacao(normalizarWorkbookComparacao(modelo)) ===
    serializarComparacao(normalizarWorkbookComparacao(candidato))
  );
}

function obterCelulaPorEndereco(workbook, sheetName, address) {
  const endereco = normalizarEndereco(address);
  return workbook?.Sheets?.[sheetName]?.[endereco] || null;
}

function celulaCandidatoDiferenteDoModelo(modelo, candidato, sheetName, address) {
  if (!sheetName || !address) return false;
  const celulaModelo = obterCelulaPorEndereco(modelo, sheetName, address);
  const celulaCandidato = obterCelulaPorEndereco(candidato, sheetName, address);
  return !celulasIguaisParaCorrecao(celulaModelo, celulaCandidato);
}

function planilhaCandidatoDiferenteDoModelo(modelo, candidato, sheetName) {
  if (!sheetName) return false;
  return (
    serializarComparacao(normalizarPlanilhaComparacao(modelo?.Sheets?.[sheetName])) !==
    serializarComparacao(normalizarPlanilhaComparacao(candidato?.Sheets?.[sheetName]))
  );
}

function detalhePossuiDiferencaDoModelo(detalhe, modelo, candidato) {
  const locais = [];
  if (detalhe?.sheetName || detalhe?.address) {
    locais.push({ sheetName: detalhe.sheetName, address: detalhe.address });
  }
  (Array.isArray(detalhe?.candidates) ? detalhe.candidates : []).forEach((item) => {
    locais.push({ sheetName: item.sheetName, address: item.address });
  });

  if (
    locais.some((local) =>
      celulaCandidatoDiferenteDoModelo(modelo, candidato, local.sheetName, local.address),
    )
  ) {
    return true;
  }

  const planilhas = [...new Set(locais.map((local) => local.sheetName).filter(Boolean))];
  return planilhas.some((sheetName) =>
    planilhaCandidatoDiferenteDoModelo(modelo, candidato, sheetName),
  );
}

function celulasAnalisadasDoDetalhe(detalhe) {
  const locais = [];
  if (detalhe?.sheetName || detalhe?.address) {
    locais.push(
      [detalhe.sheetName, detalhe.address].filter(Boolean).join('!') ||
      'local nao determinado',
    );
  }
  (Array.isArray(detalhe?.candidates) ? detalhe.candidates : []).forEach((item) => {
    const local = [item.sheetName, item.address].filter(Boolean).join('!');
    if (local) locais.push(local);
  });
  return [...new Set(locais)];
}

function criarDetalheNaoDetectadoPorModelo(detalhe, motivo) {
  const normalizado = normalizarDetalheTarefa(detalhe);
  return {
    ...normalizado,
    tarefa: normalizado.label,
    detectada: false,
    done: false,
    confidence: 0,
    confidenceLabel: 'nao encontrado',
    description: motivo,
    motivo,
    diferenca_encontrada: false,
    celulas_analisadas: celulasAnalisadasDoDetalhe(normalizado),
  };
}

function normalizarDetalheComEvidenciaModelo(detalhe, diferencaEncontrada) {
  const normalizado = normalizarDetalheTarefa(detalhe);
  const motivo = normalizado.done
    ? normalizado.description
    : normalizado.description ||
    'Nenhuma resposta com evidência suficiente foi encontrada para esta tarefa.';
  return {
    ...normalizado,
    tarefa: normalizado.label,
    detectada: !!normalizado.done,
    motivo,
    diferenca_encontrada: !!diferencaEncontrada,
    celulas_analisadas: celulasAnalisadasDoDetalhe(normalizado),
  };
}

function criarResultadoExcelNaoRespondido(resultado, pontos) {
  const detalhesBase = Array.isArray(resultado?.taskDetails)
    ? resultado.taskDetails
    : [];
  const detalhes = detalhesBase.map((detalhe) =>
    criarDetalheNaoDetectadoPorModelo(
      detalhe,
      'Nenhuma diferenca relevante foi encontrada em relacao ao modelo original.',
    ),
  );
  const mensagem =
    'Arquivo analisado, mas nenhuma resposta foi detectada. Verifique se voce enviou o arquivo correto apos realizar as atividades.';

  return {
    score: 0,
    max: pontos,
    notes: [mensagem],
    pendingManual: true,
    completedTasks: detalhes.map(formatarDetalheTarefa),
    taskDetails: detalhes,
    status: 'nao_respondido',
    mensagem,
    unanswered: true,
  };
}

function aplicarComparacaoComModelo(resultado, modelo, candidato, pontos) {
  if (!modelo || !candidato) return resultado;

  if (isArquivoExcelInalterado(modelo, candidato)) {
    return criarResultadoExcelNaoRespondido(resultado, pontos);
  }

  const detalhes = (Array.isArray(resultado?.taskDetails) ? resultado.taskDetails : []).map(
    (detalhe) => {
      const diferencaEncontrada = detalhePossuiDiferencaDoModelo(detalhe, modelo, candidato);
      if (detalhe?.done && !diferencaEncontrada) {
        return criarDetalheNaoDetectadoPorModelo(
          detalhe,
          'A evidencia encontrada ja existia no modelo original ou nao teve alteracao valida feita pelo candidato.',
        );
      }
      return normalizarDetalheComEvidenciaModelo(detalhe, diferencaEncontrada);
    },
  );
  const concluidas = detalhes.filter((detalhe) => detalhe.done).length;

  return {
    ...resultado,
    score: detalhes.length ? Math.round((concluidas / detalhes.length) * pontos) : 0,
    max: pontos,
    completedTasks: detalhes.map(formatarDetalheTarefa),
    taskDetails: detalhes,
  };
}

function obterCelulaIndexada(indice, sheetName, row, col) {
  return indice?.lookup?.[sheetName]?.[`${row}:${col}`] || null;
}

function obterCelulasAoRedor(indice, celula, raio = 3) {
  if (!indice || !celula) return [];

  const vizinhas = [];
  for (let linha = celula.row - raio; linha <= celula.row + raio; linha += 1) {
    for (let coluna = celula.col - raio; coluna <= celula.col + raio; coluna += 1) {
      if (linha === celula.row && coluna === celula.col) continue;
      const vizinha = obterCelulaIndexada(indice, celula.sheetName, linha, coluna);
      if (vizinha) vizinhas.push(vizinha);
    }
  }

  return vizinhas;
}

function obterTextoContexto(indice, celula, raio = 3) {
  return obterCelulasAoRedor(indice, celula, raio)
    .map((vizinha) => `${vizinha.normalized} ${vizinha.formulaNormalized}`)
    .join(' ');
}

function criarEvidencia({ score, reason, cell = null, value, formula, extra = {} }) {
  return {
    score: limitarNumero(score),
    reason,
    cell,
    value: value !== undefined ? value : cell?.text || '',
    formula: formula !== undefined ? formula : cell?.formula || '',
    sheetName: extra.sheetName || cell?.sheetName || '',
    address: extra.address || cell?.address || '',
    candidates: extra.candidates || [],
  };
}

function escolherMelhorEvidencia(evidencias) {
  return (Array.isArray(evidencias) ? evidencias : [])
    .filter((item) => item && Number(item.score || 0) > 0)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0] || null;
}

function descreverLocalEvidencia(evidencia) {
  const sheetName = evidencia?.sheetName || evidencia?.cell?.sheetName;
  const address = evidencia?.address || evidencia?.cell?.address;
  if (sheetName && address) return `aba ${sheetName}, célula ${address}`;
  if (sheetName) return `aba ${sheetName}`;
  if (address) return `célula ${address}`;
  return 'local não determinado';
}

function descreverValorFormula(evidencia) {
  const partes = [];
  const valor = String(evidencia?.value ?? '').trim();
  const formula = String(evidencia?.formula ?? '').trim();

  if (valor) partes.push(`Valor encontrado: ${valor}.`);
  if (formula) partes.push(`Fórmula encontrada: ${formula}.`);
  return partes.join(' ');
}

function criarDescricaoEvidencia(label, evidencia, done) {
  if (!evidencia) {
    return 'Nenhuma resposta com evidência suficiente foi encontrada para esta tarefa.';
  }

  const local = descreverLocalEvidencia(evidencia);
  const valorFormula = descreverValorFormula(evidencia);
  const motivo = evidencia.reason || 'foram encontrados sinais relacionados à tarefa';

  if (done) {
    return `Resposta localizada na ${local}. ${valorFormula}A resposta foi considerada relacionada à tarefa porque ${motivo}.`;
  }

  return `Foi encontrado possível candidato na ${local}, mas a confiança ficou baixa para a tarefa "${label}". ${valorFormula}Motivo: ${motivo}.`;
}

function criarTarefaComEvidencias(label, evidencias) {
  const melhor = escolherMelhorEvidencia(evidencias);
  const confidence = limitarNumero(melhor?.score || 0);
  const done = confidence >= LIMIAR_CONFIANCA_MEDIA;

  return {
    label,
    done,
    confidence,
    confidenceLabel: classificarConfianca(confidence),
    sheetName: melhor?.sheetName || melhor?.cell?.sheetName || '',
    address: melhor?.address || melhor?.cell?.address || '',
    value: melhor?.value ?? melhor?.cell?.text ?? '',
    formula: melhor?.formula ?? melhor?.cell?.formula ?? '',
    description: criarDescricaoEvidencia(label, melhor, done),
    candidates: (Array.isArray(evidencias) ? evidencias : [])
      .filter((item) => item?.score >= LIMIAR_CONFIANCA_BAIXA)
      .slice(0, 5)
      .map((item) => ({
        confidence: limitarNumero(item.score),
        sheetName: item.sheetName || item.cell?.sheetName || '',
        address: item.address || item.cell?.address || '',
        value: item.value ?? item.cell?.text ?? '',
        formula: item.formula ?? item.cell?.formula ?? '',
        reason: item.reason || '',
      })),
  };
}

function evidenciaDeTarefa(tarefa) {
  if (!tarefa || tarefa.confidence <= 0) return null;
  return criarEvidencia({
    score: tarefa.confidence,
    reason: tarefa.description || tarefa.confidenceLabel || 'evidência relacionada encontrada',
    value: tarefa.value,
    formula: tarefa.formula,
    extra: {
      sheetName: tarefa.sheetName,
      address: tarefa.address,
      candidates: tarefa.candidates,
    },
  });
}

function normalizarDetalheTarefa(tarefa) {
  const confidence = limitarNumero(
    tarefa?.confidence !== undefined ? tarefa.confidence : tarefa?.done ? 1 : 0,
  );

  return {
    label: tarefa?.label || 'Tarefa sem descrição',
    done: !!tarefa?.done,
    confidence,
    confidenceLabel: tarefa?.confidenceLabel || classificarConfianca(confidence),
    sheetName: tarefa?.sheetName || '',
    address: tarefa?.address || '',
    value: tarefa?.value ?? '',
    formula: tarefa?.formula || '',
    description:
      tarefa?.description ||
      (tarefa?.done
        ? 'Tarefa identificada pela validação automática.'
        : 'Nenhuma resposta com evidência suficiente foi encontrada para esta tarefa.'),
    candidates: Array.isArray(tarefa?.candidates) ? tarefa.candidates : [],
  };
}

function formatarDetalheTarefa(detalheBruto) {
  const detalhe = normalizarDetalheTarefa(detalheBruto);
  const marcador = detalhe.done ? '[x]' : '[ ]';
  const partes = [
    `${marcador} ${detalhe.label}`,
    `${detalhe.confidenceLabel} (${Math.round(detalhe.confidence * 100)}%)`,
  ];

  if (detalhe.sheetName || detalhe.address) {
    partes.push(`Local: ${descreverLocalEvidencia(detalhe)}`);
  }
  if (String(detalhe.value || '').trim()) {
    partes.push(`Valor: ${detalhe.value}`);
  }
  if (String(detalhe.formula || '').trim()) {
    partes.push(`Fórmula: ${detalhe.formula}`);
  }
  if (detalhe.description) {
    partes.push(detalhe.description);
  }

  return partes.join(' | ');
}

function pontuarPlanilha(celula, nomesEsperados = []) {
  const esperados = normalizarListaBusca(nomesEsperados);
  if (!esperados.length) return 0;

  const nome = normalizarNomePlanilha(celula?.sheetName);
  if (esperados.some((esperado) => nome === esperado)) return 0.18;
  if (esperados.some((esperado) => nome.includes(esperado) || esperado.includes(nome))) {
    return 0.1;
  }

  return 0;
}

function distanciaAteRange(celula, range) {
  const partes = String(range || '').split(':');
  const inicio = decodificarEndereco(partes[0]);
  const fim = decodificarEndereco(partes[1] || partes[0]);
  if (!celula || !inicio || !fim) return null;

  const minRow = Math.min(inicio.row, fim.row);
  const maxRow = Math.max(inicio.row, fim.row);
  const minCol = Math.min(inicio.col, fim.col);
  const maxCol = Math.max(inicio.col, fim.col);
  const rowDistance =
    celula.row < minRow ? minRow - celula.row : celula.row > maxRow ? celula.row - maxRow : 0;
  const colDistance =
    celula.col < minCol ? minCol - celula.col : celula.col > maxCol ? celula.col - maxCol : 0;

  return rowDistance + colDistance;
}

function pontuarLocal(celula, { addresses = [], ranges = [] } = {}) {
  if (!celula) return 0;

  const endereco = normalizarEndereco(celula.address);
  if (normalizarListaBusca(addresses).length) {
    const enderecos = (Array.isArray(addresses) ? addresses : [addresses])
      .map((item) => normalizarEndereco(item))
      .filter(Boolean);
    if (enderecos.includes(endereco)) return 0.35;
  }

  const distancias = (Array.isArray(ranges) ? ranges : [ranges])
    .map((range) => distanciaAteRange(celula, range))
    .filter((distancia) => distancia !== null);

  if (!distancias.length) return 0;

  const menorDistancia = Math.min(...distancias);
  if (menorDistancia === 0) return 0.3;
  if (menorDistancia <= 2) return 0.18;
  if (menorDistancia <= 5) return 0.1;
  return 0;
}

function tipoCelulaCombina(celula, tipos = []) {
  const tiposNormalizados = normalizarListaBusca(tipos);
  if (!tiposNormalizados.length) return 0;

  const texto = `${celula?.text || ''} ${celula?.formula || ''}`;
  const textoNormalizado = normalizarTextoBusca(texto);
  const valorNumerico = converterNumeroSeguro(celula?.rawValue ?? celula?.text);
  const formato = String(
    celula?.cell?.z || celula?.cell?.s?.numFmt || celula?.cell?.w || '',
  ).toLowerCase();
  let score = 0;

  if (tiposNormalizados.includes('formula') && celula?.formula) score += 0.16;
  if (tiposNormalizados.includes('numero') && valorNumerico !== null) score += 0.12;
  if (
    tiposNormalizados.includes('percentual') &&
    (textoNormalizado.includes('%') || formato.includes('%'))
  ) {
    score += 0.14;
  }
  if (
    tiposNormalizados.includes('moeda') &&
    (/r\$|\$|contabil|accounting/i.test(texto) || /r\$|\$|contabil|accounting/i.test(formato))
  ) {
    score += 0.14;
  }
  if (tiposNormalizados.includes('texto') && textoNormalizado) score += 0.08;

  return Math.min(score, 0.18);
}

function avaliarCelulasPorCriterio(indice, criterios = {}) {
  const evidencias = [];
  const keywords = normalizarListaBusca(criterios.keywords || []);
  const formulaKeywords = normalizarListaBusca(criterios.formulaKeywords || []);
  const contextKeywords = normalizarListaBusca(criterios.contextKeywords || []);

  indice.cells.forEach((celula) => {
    if (!criterios.incluirPlanilhasBase && planilhaEhBase(celula.sheetName)) return;
    if (criterios.ignorarInstrucoes !== false && celulaEhInstrucao(celula)) return;

    const textoCompleto = `${celula.normalized} ${celula.formulaNormalized}`;
    const contexto = obterTextoContexto(indice, celula, criterios.contextRadius || 4);
    let score = 0.05;
    const motivos = [];

    const pontosPlanilha = pontuarPlanilha(celula, criterios.sheetNames || []);
    if (pontosPlanilha) {
      score += pontosPlanilha;
      motivos.push('está em aba relacionada');
    }

    const pontosLocal = pontuarLocal(celula, {
      addresses: criterios.addresses || [],
      ranges: criterios.ranges || [],
    });
    if (pontosLocal) {
      score += pontosLocal;
      motivos.push('está em célula ou região esperada/próxima');
    }

    const termosNaCelula = contarTermosEncontrados(textoCompleto, keywords);
    if (termosNaCelula) {
      score += Math.min(0.24, termosNaCelula * 0.1);
      motivos.push('contém palavra-chave da tarefa');
    }

    const termosNaFormula = contarTermosEncontrados(celula.formulaNormalized, formulaKeywords);
    if (termosNaFormula) {
      score += Math.min(0.36, termosNaFormula * 0.18);
      motivos.push('possui fórmula compatível');
    }

    const termosNoContexto = contarTermosEncontrados(contexto, contextKeywords);
    if (termosNoContexto) {
      score += Math.min(0.2, termosNoContexto * 0.07);
      motivos.push('está perto de palavras-chave da tarefa');
    }

    const pontosTipo = tipoCelulaCombina(celula, criterios.types || []);
    if (pontosTipo) {
      score += pontosTipo;
      motivos.push('tem tipo de resposta esperado');
    }

    if (criterios.expectedValues?.length) {
      const valores = normalizarListaBusca(criterios.expectedValues);
      if (valores.some((valor) => textoCompleto.includes(valor))) {
        score += 0.25;
        motivos.push('possui valor esperado');
      }
    }

    if (criterios.requireFormula && !celula.formula) return;
    if (criterios.requireKeywords && !termosNaCelula && !termosNaFormula) return;
    if (criterios.requireContext && !termosNoContexto) return;
    if (criterios.requireNumeric && converterNumeroSeguro(celula.rawValue ?? celula.text) === null) {
      return;
    }

    const minScore = criterios.minCandidateScore ?? 0.3;
    if (score >= minScore) {
      evidencias.push(
        criarEvidencia({
          score,
          cell: celula,
          reason: motivos.join(', ') || 'há conteúdo preenchido relacionado',
        }),
      );
    }
  });

  return evidencias;
}

function avaliarCabecalhoComPreenchimento(indice, label, opcoes = {}) {
  const evidencias = [];
  const headers = normalizarListaBusca(opcoes.headers || []);
  const minFilled = Number(opcoes.minFilled || 1);

  indice.cells.forEach((celula) => {
    if (!headers.length || planilhaEhBase(celula.sheetName)) return;
    if (!headers.some((header) => celula.normalized === header || celula.normalized.includes(header))) {
      return;
    }

    const preenchidas = [];
    const limiteLinhas = Number(opcoes.maxRows || 40);
    for (let offset = 1; offset <= limiteLinhas; offset += 1) {
      const abaixo = obterCelulaIndexada(indice, celula.sheetName, celula.row + offset, celula.col);
      if (!abaixo) continue;
      if (celulaEhInstrucao(abaixo)) continue;
      if (celulaPossuiConteudo(abaixo.cell)) preenchidas.push(abaixo);
    }

    const contexto = obterTextoContexto(indice, celula, opcoes.contextRadius || 4);
    const termosContexto = contarTermosEncontrados(contexto, opcoes.contextKeywords || []);
    let score =
      0.18 +
      pontuarPlanilha(celula, opcoes.sheetNames || []) +
      pontuarLocal(celula, { addresses: opcoes.addresses || [], ranges: opcoes.ranges || [] });

    if (termosContexto) score += Math.min(0.18, termosContexto * 0.08);
    if (preenchidas.length >= minFilled) score += 0.38;
    else if (opcoes.headerOnly) score += 0.25;
    if (preenchidas.some((item) => item.formula)) score += 0.12;

    if (score >= 0.3) {
      evidencias.push(
        criarEvidencia({
          score,
          cell: celula,
          value: celula.text,
          formula: preenchidas.find((item) => item.formula)?.formula || '',
          reason:
            preenchidas.length >= minFilled
              ? `cabeçalho relacionado encontrado com ${preenchidas.length} célula(s) preenchida(s) abaixo`
              : 'cabeçalho relacionado encontrado, mas sem preenchimento suficiente abaixo',
        }),
      );
    }
  });

  return criarTarefaComEvidencias(label, evidencias);
}

function avaliarOrdenacaoPorCabecalho(indice, label, opcoes = {}) {
  const evidencias = [];
  const headers = normalizarListaBusca(opcoes.headers || ['operador']);

  indice.cells.forEach((celula) => {
    if (planilhaEhBase(celula.sheetName)) return;
    if (!headers.some((header) => celula.normalized === header || celula.normalized.includes(header))) {
      return;
    }

    const valores = [];
    for (let offset = 1; offset <= 80; offset += 1) {
      const abaixo = obterCelulaIndexada(indice, celula.sheetName, celula.row + offset, celula.col);
      if (!abaixo) {
        if (offset > 8) break;
        continue;
      }
      const texto = String(abaixo.text || '').trim();
      if (!texto || celulaEhInstrucao(abaixo)) continue;
      valores.push(texto);
    }

    if (valores.length < Number(opcoes.minRows || 4)) return;

    const normalizados = valores.map((valor) => normalizarTextoBusca(valor));
    const ordenado = normalizados.every(
      (valor, indiceValor) => indiceValor === 0 || normalizados[indiceValor - 1] <= valor,
    );
    const score = ordenado
      ? 0.62 + pontuarPlanilha(celula, opcoes.sheetNames || []) + pontuarLocal(celula, opcoes)
      : 0.25 + pontuarPlanilha(celula, opcoes.sheetNames || []);

    evidencias.push(
      criarEvidencia({
        score,
        cell: celula,
        value: valores.slice(0, 4).join(', '),
        reason: ordenado
          ? `coluna ${celula.text} possui ${valores.length} registro(s) em ordem alfabética`
          : `coluna ${celula.text} foi localizada, mas a ordem alfabética não ficou consistente`,
      }),
    );
  });

  return criarTarefaComEvidencias(label, evidencias);
}

function avaliarFormatoMoeda(indice, label, opcoes = {}) {
  const evidencias = [];

  indice.cells.forEach((celula) => {
    if (planilhaEhBase(celula.sheetName) || celulaEhInstrucao(celula)) return;
    const textoFormato = String(
      celula.cell?.z || celula.cell?.s?.numFmt || celula.cell?.w || celula.text || '',
    );
    if (!/r\$|\$|contabil|accounting/i.test(textoFormato)) return;

    const contexto = obterTextoContexto(indice, celula, 4);
    const contextoEsperado = contarTermosEncontrados(contexto, opcoes.contextKeywords || []);
    const score =
      0.48 +
      Math.min(0.18, contextoEsperado * 0.08) +
      pontuarPlanilha(celula, opcoes.sheetNames || []) +
      pontuarLocal(celula, opcoes);

    evidencias.push(
      criarEvidencia({
        score,
        cell: celula,
        reason: 'formato de moeda/contábil detectado em região relacionada',
      }),
    );
  });

  return criarTarefaComEvidencias(label, evidencias);
}

function celulaTemPreenchimentoVisual(celula) {
  const estilo = celula?.cell?.s || {};
  const fill = estilo.fill || estilo.patternType || estilo.fgColor || estilo.bgColor;
  const font = estilo.font || {};
  const border = estilo.border;
  const alignment = estilo.alignment;

  return !!(
    fill ||
    border ||
    alignment ||
    font.bold ||
    font.color ||
    celula?.cell?.z ||
    estilo.numFmt
  );
}

function avaliarEstiloVisual(indice, label, opcoes = {}) {
  const evidencias = [];

  indice.cells.forEach((celula) => {
    if (planilhaEhBase(celula.sheetName) || celulaEhInstrucao(celula)) return;
    if (!celulaTemPreenchimentoVisual(celula)) return;

    const contexto = obterTextoContexto(indice, celula, 4);
    const contextoEsperado = contarTermosEncontrados(contexto, opcoes.contextKeywords || []);
    const score =
      0.38 +
      Math.min(0.2, contextoEsperado * 0.08) +
      pontuarPlanilha(celula, opcoes.sheetNames || []) +
      pontuarLocal(celula, opcoes);

    evidencias.push(
      criarEvidencia({
        score,
        cell: celula,
        reason: 'formatação visual detectada em célula relacionada',
      }),
    );
  });

  return criarTarefaComEvidencias(label, evidencias);
}

function avaliarFiltroOrdenacao(indice, label, opcoes = {}) {
  const evidencias = [];

  indice.sheetNames.forEach((sheetName) => {
    if (planilhaEhBase(sheetName)) return;

    const planilha = indice.bySheet[sheetName]?.[0]?.sheet;
    if (!planilhaTemAutofiltro(planilha)) return;

    let score = 0.56 + pontuarPlanilha({ sheetName }, opcoes.sheetNames || []);
    let reason = 'filtro/autofiltro encontrado na planilha';

    const celulasDaPlanilha = indice.bySheet[sheetName] || [];

    // Avalia SOMENTE a coluna C, da linha 3 até a linha 9.
    // Isso evita considerar a linha de Total na validação da ordenação.
    const valoresC3AteC9 = celulasDaPlanilha
      .filter((celula) => {
        const coluna = String(celula.col || '').toUpperCase();
        const linha = Number(celula.row);

        return coluna === 'C' && linha >= 3 && linha <= 9;
      })
      .sort((a, b) => Number(a.row) - Number(b.row))
      .map((celula) => converterNumeroSeguro(celula.rawValue ?? celula.text))
      .filter((valor) => valor !== null);

    const colunaCOrdenadaDecrescente =
      valoresC3AteC9.length >= 3 &&
      valoresC3AteC9.every((valor, indiceValor) => {
        return indiceValor === 0 || valoresC3AteC9[indiceValor - 1] >= valor;
      });

    if (colunaCOrdenadaDecrescente) {
      score += 0.18;
      reason = 'filtro encontrado e coluna C3:C9 está em ordem decrescente';
    }

    evidencias.push(
      criarEvidencia({
        score,
        reason,
        extra: {
          sheetName,
          intervaloAvaliado: 'C3:C9',
          valoresAvaliados: valoresC3AteC9,
        },
      }),
    );
  });

  return criarTarefaComEvidencias(label, evidencias);
}

function avaliarLinhaTotal(indice, label, opcoes = {}) {
  const evidencias = [];

  indice.cells.forEach((celula) => {
    if (planilhaEhBase(celula.sheetName)) return;
    if (!celula.normalized.includes('total')) return;

    const vizinhas = obterCelulasAoRedor(indice, celula, 4).filter(
      (item) => !celulaEhInstrucao(item),
    );
    const calculos = vizinhas.filter(
      (item) =>
        item.formula ||
        converterNumeroSeguro(item.rawValue ?? item.text) !== null ||
        textoContemAlgum(item.normalized, opcoes.keywords || []),
    );

    const score =
      0.34 +
      Math.min(0.32, calculos.length * 0.12) +
      pontuarPlanilha(celula, opcoes.sheetNames || []) +
      pontuarLocal(celula, opcoes);

    evidencias.push(
      criarEvidencia({
        score,
        cell: calculos[0] || celula,
        value: calculos[0]?.text || celula.text,
        formula: calculos[0]?.formula || '',
        reason: `rótulo Total encontrado com ${calculos.length} célula(s) calculada(s) ou preenchida(s) próximas`,
      }),
    );
  });

  return criarTarefaComEvidencias(label, evidencias);
}

function avaliarPreenchimentoPorAncora(indice, label, opcoes = {}) {
  const evidencias = [];
  const anchors = normalizarListaBusca(opcoes.anchors || []);
  const minCount = Number(opcoes.minCount || 1);

  indice.cells.forEach((ancora) => {
    if (planilhaEhBase(ancora.sheetName)) return;
    if (!anchors.some((item) => ancora.normalized.includes(item))) return;

    const vizinhas = obterCelulasAoRedor(indice, ancora, opcoes.radius || 4).filter(
      (celula) =>
        !celulaEhInstrucao(celula) &&
        (celula.formula ||
          converterNumeroSeguro(celula.rawValue ?? celula.text) !== null ||
          textoContemAlgum(celula.normalized, opcoes.responseKeywords || [])),
    );

    if (!vizinhas.length) return;

    const score =
      0.28 +
      Math.min(0.36, (vizinhas.length / minCount) * 0.24) +
      pontuarPlanilha(ancora, opcoes.sheetNames || []) +
      pontuarLocal(vizinhas[0], opcoes);

    evidencias.push(
      criarEvidencia({
        score,
        cell: vizinhas[0],
        value: vizinhas[0]?.text || '',
        formula: vizinhas[0]?.formula || '',
        reason: `${vizinhas.length} resposta(s) encontrada(s) perto de ${ancora.text}`,
      }),
    );
  });

  return criarTarefaComEvidencias(label, evidencias);
}

function avaliarListaPreenchida(indice, label, opcoes = {}) {
  const anchors = normalizarListaBusca(opcoes.anchors || []);
  const minMatches = Number(opcoes.minMatches || 2);
  const matches = [];

  indice.cells.forEach((ancora) => {
    if (planilhaEhBase(ancora.sheetName)) return;
    const anchorTerm = anchors.find((item) => ancora.normalized.includes(item));
    if (!anchorTerm) return;

    const vizinhas = obterCelulasAoRedor(indice, ancora, opcoes.radius || 4).filter((celula) => {
      if (celulaEhInstrucao(celula)) return false;
      if (opcoes.onlyRight && celula.col <= ancora.col) return false;
      if (opcoes.onlyBelow && celula.row <= ancora.row) return false;
      return (
        celula.formula ||
        converterNumeroSeguro(celula.rawValue ?? celula.text) !== null ||
        textoContemAlgum(celula.normalized, opcoes.responseKeywords || [])
      );
    });

    if (!vizinhas.length) return;
    matches.push({ anchorTerm, anchor: ancora, response: vizinhas[0] });
  });

  const unicos = [];
  const vistos = new Set();
  matches.forEach((match) => {
    if (vistos.has(match.anchorTerm)) return;
    vistos.add(match.anchorTerm);
    unicos.push(match);
  });

  const evidencias = [];
  if (unicos.length) {
    const primeiro = unicos[0].response || unicos[0].anchor;
    let score =
      0.24 +
      Math.min(0.44, (unicos.length / minMatches) * 0.36) +
      pontuarPlanilha(primeiro, opcoes.sheetNames || []) +
      pontuarLocal(primeiro, opcoes);
    if (unicos.length < minMatches) score = Math.min(score, 0.5);

    evidencias.push(
      criarEvidencia({
        score,
        cell: primeiro,
        value: primeiro.text,
        formula: primeiro.formula,
        reason: `${unicos.length} item(ns) esperado(s) possuem resposta próxima`,
        extra: {
          candidates: unicos.map((match) =>
            criarEvidencia({
              score: 0.55,
              cell: match.response,
              reason: `resposta encontrada perto de ${match.anchor.text}`,
            }),
          ),
        },
      }),
    );
  }

  return criarTarefaComEvidencias(label, evidencias);
}

function avaliarTextosEsperados(indice, label, opcoes = {}) {
  const evidenciasPorTexto = {};
  const textos = normalizarListaBusca(opcoes.texts || []);

  indice.cells.forEach((celula) => {
    if (planilhaEhBase(celula.sheetName) || celulaEhInstrucao(celula)) return;
    const textoEncontrado = textos.find((texto) => celula.normalized.includes(texto));
    if (!textoEncontrado) return;

    const score =
      0.28 +
      pontuarPlanilha(celula, opcoes.sheetNames || []) +
      pontuarLocal(celula, { addresses: opcoes.addresses || [], ranges: opcoes.ranges || [] }) +
      Math.min(0.18, contarTermosEncontrados(obterTextoContexto(indice, celula, 5), opcoes.contextKeywords || []) * 0.08);
    if (score < (opcoes.minIndividualScore ?? 0.3)) return;

    const atual = evidenciasPorTexto[textoEncontrado];
    if (!atual || score > atual.score) {
      evidenciasPorTexto[textoEncontrado] = criarEvidencia({
        score,
        cell: celula,
        reason: `texto esperado "${celula.text}" localizado em contexto relacionado`,
      });
    }
  });

  const evidencias = Object.values(evidenciasPorTexto);
  if (evidencias.length >= Number(opcoes.minMatches || 1)) {
    evidencias.push(
      criarEvidencia({
        score: Math.min(0.88, 0.44 + evidencias.length * 0.12),
        reason: `${evidencias.length} texto(s) esperado(s) localizado(s)`,
        extra: {
          sheetName: evidencias[0]?.sheetName,
          address: evidencias[0]?.address,
          candidates: evidencias,
        },
      }),
    );
  }

  return criarTarefaComEvidencias(label, evidencias);
}

function avaliarProcvPreenchido(indice, label, opcoes = {}) {
  const formulas = avaliarCelulasPorCriterio(indice, {
    sheetNames: opcoes.sheetNames || [],
    formulaKeywords: ['procv', 'vlookup', 'xlookup', 'procx', 'indice', 'corresp'],
    contextKeywords: opcoes.contextKeywords || ['operador', 'supervisor', 'status', 'volume'],
    types: ['formula'],
    minCandidateScore: 0.42,
  });
  const preenchidos = avaliarPreenchimentoPorAncora(indice, label, {
    anchors: opcoes.anchors || [],
    responseKeywords: opcoes.responseKeywords || [],
    sheetNames: opcoes.sheetNames || [],
    minCount: opcoes.minCount || 3,
    radius: opcoes.radius || 5,
  });
  const evidencias = [...formulas];
  if (preenchidos.confidence >= LIMIAR_CONFIANCA_BAIXA) {
    evidencias.push(
      criarEvidencia({
        score: preenchidos.confidence,
        reason: preenchidos.description,
        extra: {
          sheetName: preenchidos.sheetName,
          address: preenchidos.address,
        },
      }),
    );
  }

  return criarTarefaComEvidencias(label, evidencias);
}

function avaliarGraficoCriado(indice, label, opcoes = {}) {
  const evidencias = [];

  indice.sheetNames.forEach((sheetName) => {
    if (planilhaEhBase(sheetName)) return;
    const planilha = indice.bySheet[sheetName]?.[0]?.sheet;
    if (!planilha) return;

    const possuiObjetoGrafico = !!(planilha['!images'] || planilha['!drawings'] || planilha['!charts']);
    if (possuiObjetoGrafico) {
      evidencias.push(
        criarEvidencia({
          score: 0.86 + pontuarPlanilha({ sheetName }, opcoes.sheetNames || []),
          reason: 'objeto gráfico detectado no arquivo',
          extra: { sheetName },
        }),
      );
      return;
    }

    const celulas = indice.bySheet[sheetName] || [];
    const contexto = celulas.map((celula) => celula.normalized).join(' ');
    const termos = contarTermosEncontrados(contexto, opcoes.contextKeywords || []);
    const adicionais = celulas.filter((celula) => {
      if (celulaEhInstrucao(celula)) return false;
      if (opcoes.minRow && celula.row < opcoes.minRow) return false;
      return textoContemAlgum(celula.normalized, opcoes.contextKeywords || []) ||
        converterNumeroSeguro(celula.rawValue ?? celula.text) !== null;
    });

    if (termos >= Number(opcoes.minTerms || 2) && adicionais.length >= Number(opcoes.minCells || 3)) {
      evidencias.push(
        criarEvidencia({
          score: 0.58 + pontuarPlanilha({ sheetName }, opcoes.sheetNames || []),
          reason: 'dados auxiliares de gráfico encontrados em contexto relacionado',
          extra: {
            sheetName,
            address: adicionais[0]?.address,
          },
        }),
      );
    }
  });

  return criarTarefaComEvidencias(label, evidencias);
}

function adicionarLinhas(planilha, linhas, origem = 'A1') {
  const XLSX = obterBibliotecaXlsx();
  XLSX.utils.sheet_add_aoa(planilha, linhas, { origin: origem });
}

function converterMatrizParaPlanilha(matriz) {
  const XLSX = obterBibliotecaXlsx();
  return XLSX.utils.aoa_to_sheet(matriz);
}

function coletarValoresAteLinhaVazia(
  planilha,
  coluna,
  linhaInicial,
  maximo = 500,
) {
  const valores = [];

  for (let linha = linhaInicial; linha <= maximo; linha += 1) {
    const valor = String(
      obterValorCelula(planilha, `${coluna}${linha}`) || '',
    ).trim();
    if (!valor) break;
    valores.push(valor);
  }

  return valores;
}

function htmlTemNegrito(html) {
  if (/<(b|strong)[^>]*>[\s\S]*?<\/(b|strong)>/i.test(html)) return true;
  if (/font-weight\s*:\s*(bold|[6-9]\d{2}|[1-9]\d{3})/i.test(html)) return true;
  return false;
}

function htmlTemCentralizacao(html) {
  if (/text-align\s*:\s*center/i.test(html)) return true;
  if (/align\s*=\s*["']?center["']?/i.test(html)) return true;
  if (/<div[^>]*style\s*=\s*["'][^"']*center[^"']*["']/i.test(html))
    return true;
  return false;
}

function tituloTemNegritoNoHtml(html, textoTitulo) {
  if (!textoTitulo) return false;
  const tituloEscapado = textoTitulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regexTag = new RegExp(
    '<(b|strong)[^>]*>[\\s\\S]*?' +
    tituloEscapado +
    '[\\s\\S]*?<\\/(b|strong)>',
    'i',
  );

  if (regexTag.test(html)) return true;

  const regexEstilo = new RegExp(
    'font-weight\\s*:\\s*(bold|[6-9]\\d{2}|[1-9]\\d{3})[^"\']*["\'][^>]*>[\\s\\S]*?' +
    tituloEscapado,
    'i',
  );

  if (regexEstilo.test(html)) return true;

  return htmlTemNegrito(html);
}

function tituloTemCentralizacaoNoHtml(html, textoTitulo) {
  if (!textoTitulo) return false;
  const tituloEscapado = textoTitulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const regexAntes = new RegExp(
    '(text-align\\s*:\\s*center|align\\s*=\\s*["\']?center["\']?)[\\s\\S]{0,300}' +
    tituloEscapado,
    'i',
  );

  const regexDepois = new RegExp(
    tituloEscapado +
    '[\\s\\S]{0,300}(text-align\\s*:\\s*center|align\\s*=\\s*["\']?center["\']?)',
    'i',
  );

  return (
    regexAntes.test(html) ||
    regexDepois.test(html) ||
    htmlTemCentralizacao(html)
  );
}

function htmlTemItalico(html) {
  return /<(i|em)[^>]*>[\s\S]*?<\/(i|em)>/i.test(html) ||
    /font-style\s*:\s*italic/i.test(html);
}

function htmlTemSublinhado(html) {
  return /<u[^>]*>[\s\S]*?<\/u>/i.test(html) ||
    /text-decoration(?:-line)?\s*:[^;"']*underline/i.test(html);
}

function htmlTemTachado(html) {
  return /<(s|strike|del)[^>]*>[\s\S]*?<\/(s|strike|del)>/i.test(html) ||
    /text-decoration(?:-line)?\s*:[^;"']*line-through/i.test(html);
}

function obterAlinhamentosNoHtml(html) {
  const alinhamentos = new Set();
  const regex = /(?:text-align\s*:\s*|align\s*=\s*["']?)(left|center|right|justify)/gi;
  let match = regex.exec(html);
  while (match) {
    alinhamentos.add(match[1].toLowerCase());
    match = regex.exec(html);
  }
  if (!alinhamentos.size) alinhamentos.add('left');
  return [...alinhamentos];
}

function obterTamanhosFonteNoHtml(html) {
  const tamanhos = new Set();
  const mapaFontSizeLegado = { 2: 12, 3: 14, 4: 16, 5: 18, 6: 24 };
  const regexFont = /<font[^>]*\bsize\s*=\s*["']?([2-6])["']?/gi;
  const regexCss = /font-size\s*:\s*(12|14|16|18|24)(?:px|pt)?/gi;
  let match = regexFont.exec(html);
  while (match) {
    tamanhos.add(mapaFontSizeLegado[Number(match[1])]);
    match = regexFont.exec(html);
  }
  match = regexCss.exec(html);
  while (match) {
    tamanhos.add(Number(match[1]));
    match = regexCss.exec(html);
  }
  return [...tamanhos].filter(Boolean).sort((a, b) => a - b);
}

export function obterFormatacoesAplicadas(resposta = {}) {
  const html = String(resposta?.content || '');
  return {
    negrito: htmlTemNegrito(html),
    italico: htmlTemItalico(html),
    sublinhado: htmlTemSublinhado(html),
    tachado: htmlTemTachado(html),
    tamanhosFonte: obterTamanhosFonteNoHtml(html),
    alinhamentos: obterAlinhamentosNoHtml(html),
    lista: /<(ul|ol)[^>]*>/i.test(html),
    listaOrdenada: /<ol[^>]*>/i.test(html),
    listaNaoOrdenada: /<ul[^>]*>/i.test(html),
  };
}

export function avaliarRespostaTexto(resposta, esperado = {}, pontos) {
  if (!resposta || !resposta.content) return 0;

  const html = resposta.content;
  const textoPlano = removerHtml(html);
  const textoMaiusculo = textoPlano.toUpperCase();
  const formatacoes = obterFormatacoesAplicadas(resposta);

  if (textoPlano.trim().length < 5) return 0;

  let score = 0;
  let pesoTotal = 0;

  const verificacoes = [
    esperado.titleText
      ? {
        ok: textoMaiusculo.includes(esperado.titleText.toUpperCase()),
        weight: 2,
      }
      : null,
    esperado.titleBold
      ? {
        ok: tituloTemNegritoNoHtml(html, esperado.titleText),
        weight: 1.5,
      }
      : null,
    esperado.titleCenter
      ? {
        ok: tituloTemCentralizacaoNoHtml(html, esperado.titleText),
        weight: 1.5,
      }
      : null,
    esperado.minTextLength
      ? { ok: textoPlano.length >= esperado.minTextLength, weight: 1.5 }
      : null,
    esperado.requiresList
      ? {
        ok:
          esperado.requiredListType === 'ordered'
            ? formatacoes.listaOrdenada || /^\s*\d+[.)]\s+/m.test(textoPlano)
            : esperado.requiredListType === 'unordered'
              ? formatacoes.listaNaoOrdenada || /^\s*[-*•]\s+/m.test(textoPlano)
              : formatacoes.lista || /^\s*[-*•]\s+/m.test(textoPlano),
        weight: 1.5,
      }
      : null,
    esperado.minListItems
      ? {
        ok:
          contarItensListaNoHtml(html) >= esperado.minListItems ||
          (textoPlano.match(/^\s*[-*•]\s+\S/gm) || []).length >=
          esperado.minListItems,
        weight: 1.5,
      }
      : null,
    esperado.anyBold ? { ok: htmlTemNegrito(html), weight: 1.2 } : null,
    esperado.requiresItalic ? { ok: formatacoes.italico, weight: 1.2 } : null,
    esperado.requiresUnderline ? { ok: formatacoes.sublinhado, weight: 1.2 } : null,
    esperado.requiresStrike ? { ok: formatacoes.tachado, weight: 1.2 } : null,
    esperado.requiredFontSize
      ? {
        ok: formatacoes.tamanhosFonte.includes(Number(esperado.requiredFontSize)),
        weight: 1.2,
      }
      : null,
    esperado.requiredAlignment
      ? {
        ok: formatacoes.alinhamentos.includes(String(esperado.requiredAlignment)),
        weight: 1.5,
      }
      : null,
    esperado.minSentences
      ? { ok: contarFrases(textoPlano) >= esperado.minSentences, weight: 1.3 }
      : null,
  ].filter(Boolean);

  verificacoes.forEach((item) => {
    pesoTotal += item.weight;
    if (item.ok) score += item.weight;
  });

  if (!verificacoes.length) return 0;

  const scoreBruto = (score / pesoTotal) * pontos;
  return Math.max(textoPlano.trim().length >= 5 ? 1 : 0, Math.round(scoreBruto));
}

export function avaliarRespostaMultiplaEscolha(resposta, questao, pontos) {
  const indiceEsperado =
    questao?.answer !== undefined && questao?.answer !== null
      ? questao.answer
      : questao?.correctIndex;

  return resposta && resposta.selected === indiceEsperado ? pontos : 0;
}

export function avaliarRespostaGrupoCompacto(resposta, questao, pontos) {
  const itens = Array.isArray(questao?.items)
    ? questao.items
    : Array.isArray(questao?.itens)
      ? questao.itens
      : [];
  const selecoes = resposta?.selections || {};
  const avaliaveis = itens.filter((item) => Number(item?.answer) >= 0);
  const respondidos = itens.filter(
    (item) => selecoes[String(item.id)] !== undefined && selecoes[String(item.id)] !== null,
  );

  if (!itens.length) {
    return criarResultadoPontuacao(
      0,
      pontos,
      ['Questão agrupada sem itens internos configurados.'],
      true,
    );
  }

  if (avaliaveis.length) {
    const corretos = avaliaveis.filter(
      (item) => Number(selecoes[String(item.id)]) === Number(item.answer),
    );
    const score = Math.round((corretos.length / avaliaveis.length) * pontos);
    return criarResultadoPontuacao(
      score,
      pontos,
      [],
      false,
      avaliaveis.map(
        (item, indice) =>
          `Item ${indice + 1}: ${
            Number(selecoes[String(item.id)]) === Number(item.answer) ? 'correto' : 'incorreto'
          }`,
      ),
      {
        compactChoiceDetails: avaliaveis.map((item, indice) => ({
          itemId: item.id,
          itemNumber: indice + 1,
          selected: selecoes[String(item.id)],
          expected: item.answer,
          correct: Number(selecoes[String(item.id)]) === Number(item.answer),
        })),
      },
    );
  }

  const score = Math.round((respondidos.length / itens.length) * pontos);
  return criarResultadoPontuacao(
    score,
    pontos,
    ['Questão sem gabarito único; revisar coerência e maturidade das escolhas.'],
    true,
    itens.map((item, indice) =>
      `Item ${indice + 1}: ${
        selecoes[String(item.id)] !== undefined ? 'respondido' : 'sem resposta'
      }`,
    ),
  );
}

export function obterCapacidadesDaTarefa(taskId) {
  const capacidades = {
    basic_exam: [
      'linhas de grade',
      'cópia da tabela para G9',
      'preenchimento de célula',
      'comentário',
      'filtro na tabela',
      'cálculo de total com fórmula',
    ],
    qualid_exam: [
      'ordenação por operador',
      'criação da coluna Valor Total',
      'multiplicação de Valor (R$) por Quantidade',
      'PROCV de supervisores',
      'lista de não encontrados a partir de BC255',
      'resumo do supervisor Lula',
      'copiar e colar',
      'filtro por Wesley Nunes',
      'gráfico de colunas agrupadas',
    ],
    planning_exam: [
      'CONT.SE',
      'ordenação decrescente',
      'PROCV de status',
      'tabela por DDD',
      'gráfico Pizza 3D',
      'média por zona',
      'percentual',
      'SE / condição lógica',
      'formatação condicional',
      'análise de vendas com PROCV e percentuais',
    ],
    advanced_exam: [
      'CONT.SE',
      'ordenação por cidade',
      'PROCV de status',
      'gráfico combinado com eixo secundário',
      'soma do RJ em F10',
      'análise completa de vendas',
      'totais e percentuais',
    ],
  };

  return capacidades[taskId] || ['atividade de planilha externa'];
}

export function obterGabaritoDaTarefa(taskId) {
  const gabaritos = {
    basic_exam: [
      'Criar coluna Subtotal ao final da tabela',
      'Calcular Subtotal = Valor do produto x Quantidade',
      'Formatar Valor Unitário e Subtotal como contábil',
      'Aplicar à nova coluna o mesmo estilo visual da planilha',
      'Alterar as cores de A1 e da linha A2',
      'Aplicar filtro e ordenar do maior para o menor valor unitário',
      'Criar linha de total e somar Quantidade e Valor R$',
    ],
    qualid_exam: [
      'Planilha A em ordem alfabética por Operador',
      'Coluna F com título Valor Total',
      'Valor Total = Valor (R$) x Quantidade',
      'PROCV preenchido na aba PROCV',
      'Operadores não encontrados listados a partir de BC255',
      'Resumo do supervisor Lula criado na aba TAB_DIN',
      'Tabela copiada e filtrada para Wesley Nunes',
      'Gráfico de colunas agrupadas criado com supervisores e março',
    ],
    planning_exam: [
      'CONT.SE preenchido por cidade e ordenado',
      'PROCV preenchido na aba Q2.',
      'Tabela por DDD e gráfico Pizza 3D',
      'Percentual e situação por zona',
      'Análise de vendas preenchida com totais e percentuais',
    ],
    advanced_exam: [
      'CONT.SE e ordenação por cidade',
      'PROCV preenchido',
      'Gráfico combinado com eixo secundário',
      'Soma do RJ em F10',
      'Análise de vendas completa',
    ],
  };

  return gabaritos[taskId] || [];
}

function obterConfiguracaoModeloExcel(taskId) {
  const pastaExames = 'Exames';

  const mapa = {
    basic_exam: {
      fileName: `${pastaExames}/exame_basico.xlsx`,
      outputBaseName: 'exame_basico',
    },
    qualid_exam: {
      fileName: `${pastaExames}/exame_medio.xlsx`,
      outputBaseName: 'exame_medio',
    },
    planning_exam: {
      fileName: `${pastaExames}/exame_avancado_nvl2.xlsx`,
      outputBaseName: 'exame_avancado_nvl2',
    },
    advanced_exam: {
      fileName: `${pastaExames}/exame_avancado.xlsx`,
      outputBaseName: 'exame_avancado',
    },
  };

  return mapa[taskId] || null;
}

async function carregarModeloExcel(taskId) {
  const configuracao = obterConfiguracaoModeloExcel(taskId);
  if (!configuracao) {
    throw new Error(`Nenhum arquivo-base configurado para o taskId: ${taskId}`);
  }

  const resposta = await fetch(configuracao.fileName, { cache: 'no-store' });
  if (!resposta.ok) {
    throw new Error(
      `Falha ao carregar o arquivo-base ${configuracao.fileName}. Status: ${resposta.status}`,
    );
  }

  return {
    ...configuracao,
    arrayBuffer: await resposta.arrayBuffer(),
  };
}

export async function baixarModeloExcel(taskId, nomeCandidato = 'candidato') {
  const info = await carregarModeloExcel(taskId);
  const nomeArquivo = sanitizarNomeArquivo(
    `${info.outputBaseName}_${nomeCandidato || 'candidato'}.xlsx`,
  );

  baixarBlob(
    nomeArquivo,
    new Blob([info.arrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
}

async function adicionarPlanilhasBase(workbook) {
  const XLSX = obterBibliotecaXlsx();
  const dadosBaseExcel = await obterDadosBaseExcel();

  Object.entries(dadosBaseExcel).forEach(([nomePlanilha, linhas]) => {
    const nomeSeguro = `Base - ${nomePlanilha}`.slice(0, 31);
    if (workbook.SheetNames.includes(nomeSeguro)) return;

    const ws = converterMatrizParaPlanilha(
      linhas.map((linha) =>
        linha.map((celula) => (celula === undefined ? null : celula)),
      ),
    );

    XLSX.utils.book_append_sheet(workbook, ws, nomeSeguro);
  });
}

function montarPlanilhaBasica(workbook) {
  const XLSX = obterBibliotecaXlsx();
  const ws = converterMatrizParaPlanilha([]);

  adicionarLinhas(ws, [['Teste de conhecimentos de Excel']], 'B7');
  adicionarLinhas(
    ws,
    [
      ['Produto', 'Quantidade', 'Valor (R$)', 'Sub Total'],
      ['Processador', 2, 170, null],
      ['Indira', 4, 120, null],
      ['Placa mãe', 7, 250, null],
      ['TOTAL', null, null, null],
    ],
    'A9',
  );
  adicionarLinhas(
    ws,
    [
      ['1) Insira linhas de grade na planilha acima.'],
      ['2) Copie a planilha acima para a célula G9.'],
      ['3) Coloque o preenchimento Azul claro na célula D9.'],
      ['4) Insira um comentário na célula A11.'],
      ['5) Insira filtro na planilha.'],
      ['6) Calcule o total dos produtos inserindo fórmula.'],
    ],
    'A17',
  );

  XLSX.utils.book_append_sheet(workbook, ws, 'Teste de Excel');
  return workbook;
}

async function montarPlanilhaQualidade(workbook) {
  const XLSX = obterBibliotecaXlsx();

  const planilhaA = converterMatrizParaPlanilha([]);
  adicionarLinhas(
    planilhaA,
    [
      ['Operador', 'Supervisor', 'Produto', 'Valor (R$)', 'Quantidade'],
      ['Wesley Nunes', 'Tony', 'Net Fone', 8, 7],
      ['Amanda Gilena', 'Lula', 'Total Cine Plus HD', 60, 2],
      ['Rafael Luiz', 'Tony', 'Total Cine', 25, 8],
      ['Fatima Osorio', 'Angela', 'Premium Basico', 17, 1],
      ['Jorge Ponteio', 'Lula', 'Virtua 6 MB', 20, 3],
      ['Elenilda Hilda', 'Barack', 'Net Fone', 8, 12],
      ['Simone Maria', 'Lula', 'Premium Conforto', 18, 1],
      ['Antonio Carlos', 'Angela', 'Virtua 2 MB', 10, 3],
      ['Luis Mario', 'Barack', 'Virtua 2 MB', 10, 4],
      ['Mariana Souza', 'Angela', 'Total Cine Top HD', 80, 1],
    ],
    'A2',
  );
  adicionarLinhas(
    planilhaA,
    [
      ["1) Coloque a tabela em ordem alfabética crescente por 'Operador';"],
      [
        "2) Insira uma nova coluna a direita de 'Quantidade' e nomeie como 'Valor Total'.",
      ],
      [
        "3) Calcule o 'Valor Total' multiplicando 'Valor (R$)' por 'Quantidade'.",
      ],
      [
        "4) Formate os resultados da coluna 'Valor (R$)' e da coluna 'Valor Total' para o formato contábil.",
      ],
    ],
    'A16',
  );
  XLSX.utils.book_append_sheet(workbook, planilhaA, 'Planilha A');

  const procv = converterMatrizParaPlanilha([
    ['Operador', 'Supervisor', 'Resultado do PROCV'],
  ]);
  [
    'Fatima Osorio',
    'Antonio Carlos',
    'Elenilda Hilda',
    'Tania Santana',
    'Nancy Vanderley',
    'Jorge Ponteio',
    'Luis Mario',
    'Luzia Mendonca',
    'Eloisa Gouvea',
    'Rafael Luiz',
    'Amanda Gilena',
    'Simone Maria',
    'Wesley Nunes',
  ].forEach((nome, indice) => adicionarLinhas(procv, [[nome, '', '']], `A${indice + 2}`));
  adicionarLinhas(
    procv,
    [
      ['1) Utilize PROCV para localizar os supervisores existentes na Planilha A.'],
      ['2) Liste, a partir da célula BC255, os operadores que não foram encontrados.'],
    ],
    'A17',
  );
  XLSX.utils.book_append_sheet(workbook, procv, 'PROCV');

  const tabdin = converterMatrizParaPlanilha([
    [
      '1) Crie abaixo, começando na célula A5, um resumo dos produtos do supervisor Lula, contendo o Valor Total desse supervisor.',
    ],
    ['A tabela sera criada a partir da tabela da aba Planilha A.'],
  ]);
  XLSX.utils.book_append_sheet(workbook, tabdin, 'TAB_DIN');

  const copiar = converterMatrizParaPlanilha([
    [
      '1) Copie a tabela trabalhada na Planilha A e cole a partir da célula A5. Depois, filtre para exibir apenas Wesley Nunes.',
    ],
  ]);
  XLSX.utils.book_append_sheet(workbook, copiar, 'Copiar_Colar');

  const grafico = converterMatrizParaPlanilha([
    ['META (R$)', 'Jan', 'Fev', 'Mar', 'Abr'],
    ['Angela', 5000, 2000, 6000, 5000],
    ['Barack', 3200, 2500, 4700, 4000],
    ['Lula', 5000, 2000, 6000, 5000],
    ['Tony', 2000, 1200, 3000, 3000],
    [],
    [
      '1) Crie um gráfico de colunas agrupadas com os supervisores e os valores do mês de março.',
    ],
  ]);
  XLSX.utils.book_append_sheet(workbook, grafico, 'Gráfico');

  await adicionarPlanilhasBase(workbook);
  return workbook;
}

async function montarPlanilhaPlanejamento(workbook) {
  const XLSX = obterBibliotecaXlsx();

  const q1 = converterMatrizParaPlanilha([
    ['Questão 1.'],
    ['* Utilize CONT.SE para descobrir quantos nomes foram listados para cada cidade abaixo.'],
    ['* Organize em ordem decrescente de acordo com a quantidade de nomes.'],
    [],
    ['Cidade', 'Qtde de Nomes'],
    ['Campinas', ''],
    ['Guarulhos', ''],
    ['Limeira', ''],
    ['Jacarei', ''],
    ['Embu', ''],
    ['Catanduva', ''],
    ['Lins', ''],
    ['Itapolis', ''],
    ['Jandira', ''],
    ['Lorena', ''],
    ['Guaratingueta', ''],
    ['Juquia', ''],
  ]);
  XLSX.utils.book_append_sheet(workbook, q1, 'Q1.');

  const q2 = converterMatrizParaPlanilha([
    ['Questão 2.'],
    ['Com base na planilha Dados, utilize PROCV e localize o volume de cada um dos status abaixo.'],
    [],
    ['Status da Chamada', 'Volume'],
    ['DISPONIBILIDADE / CSO', ''],
    ['ERRO DE CADASTRO', ''],
    ['FAX', ''],
    ['INSATISFACAO COM A TELEFONICA', ''],
    ['JA FOI CONTATADO', ''],
    ['LIGACOES NAO COMPLETADAS', ''],
    ['MENSAGEM DE OPERADORA (TELEFONIA)', ''],
    ['MUDANCA DE ENDERECO', ''],
    ['NAO ATENDE', ''],
    ['NAO AUTORIZOU RET DO MULTILINK', ''],
    ['NAO CONCORDA C/ A PERMANENCIA MINIMA', ''],
    ['NAO OBTEVE TODAS AS INFORMACOES DE PROMOCAO', ''],
    ['NAO POSSUI COMPUTADOR', ''],
    ['NAO POSSUI CONFIGURACAO MINIMA DO PC', ''],
    ['NAO TEM INTERNET', ''],
    ['NECESSIDADE E BENEFICIO EM BANDA LARGA', ''],
  ]);
  XLSX.utils.book_append_sheet(workbook, q2, 'Q2.');

  const q3 = converterMatrizParaPlanilha([
    ['Questão 3.'],
    ['* Crie uma tabela com todos os DDD e a quantidade de chamadas que cada um recebeu.'],
    ['* Utilizando a tabela criada, insira um gráfico em Pizza 3D.'],
    ['* Título: Controle de Ligação por DDD.'],
    ['* Exibir rotulo em percentual na extremidade externa.'],
  ]);
  XLSX.utils.book_append_sheet(workbook, q3, 'Q3.');

  const q4 = converterMatrizParaPlanilha([
    ['Questão 4.'],
    ['Calcule a média da quantidade de clientes por zona.'],
    ['Calcule o percentual de cada zona de acordo com o total de clientes.'],
    ['Utilize SE / lógica para identificar a situação de cada zona.'],
    ['Insira formatação condicional de acordo com a situação.'],
    [],
    ['Zonas', 'Qtde de Clientes', 'Percentual', 'Situação'],
    ['OESTE', 506, '', ''],
    ['CENTRO SUL', 365, '', ''],
    ['SUDESTE', 361, '', ''],
    ['NORDESTE', 293, '', ''],
    ['SUL', 267, '', ''],
    ['CENTRO', 258, '', ''],
    ['LESTE2', 169, '', ''],
    ['LESTE1', 115, '', ''],
    ['NOROESTE', 76, '', ''],
    ['Media', ''],
    ['', 2410],
  ]);
  XLSX.utils.book_append_sheet(workbook, q4, 'Q4.');

  const q5 = converterMatrizParaPlanilha([
    ['Questão 5.'],
    ['Utilizando PROCV localize as informações dos status de venda.'],
    ['Calcule a quantidade não vendida, total de contatos, % de vendido e % não vendido.'],
    [],
    [
      'OPERADOR',
      'VENDA ATENDENTE',
      'NAO ATENDE',
      'CLIENTE INDISPONIVEL',
      'OCUPADO',
      'FAX',
      'QTDE NAO VENDIDA',
      'TOTAL DE CONTATOS',
      '% DE VENDIDO',
      '% NAO VENDIDO',
    ],
    ['ADIEL PASSOS DOS SANTOS', '', '', '', '', '', '', '', '', ''],
    ['NOEMI SOARES DE SOUZA', '', '', '', '', '', '', '', '', ''],
    ['NORMA SUELI SANTOS', '', '', '', '', '', '', '', '', ''],
    ['NUBIA ROSA PEREIRA', '', '', '', '', '', '', '', '', ''],
    ['ALINE MACIEL BARROSO', '', '', '', '', '', '', '', '', ''],
    ['VANIA ELISABETE GOMES', '', '', '', '', '', '', '', '', ''],
    ['ROGERIO FIRMO DE ALMEIDA', '', '', '', '', '', '', '', '', ''],
    ['CINTIA FERREIRA DE OLIVEIRA SILVA', '', '', '', '', '', '', '', '', ''],
    ['TAIS HERMESDORFF RODRIGUES', '', '', '', '', '', '', '', '', ''],
    ['DAVID LEANDRO SILVA', '', '', '', '', '', '', '', '', ''],
    ['ELAINE CRISTINA RISSO NISHIMARU', '', '', '', '', '', '', '', '', ''],
    ['TATIANE APARECIDA DE PAULA', '', '', '', '', '', '', '', '', ''],
    ['PEDRO', '', '', '', '', '', '', '', '', ''],
  ]);
  XLSX.utils.book_append_sheet(workbook, q5, 'Q5.');

  await adicionarPlanilhasBase(workbook);
  return workbook;
}

async function montarPlanilhaAvancada(workbook) {
  const XLSX = obterBibliotecaXlsx();
  await montarPlanilhaPlanejamento(workbook);

  const q6 = converterMatrizParaPlanilha([
    ['Questão 6.'],
    [
      'Crie um gráfico analítico com colunas para os indicadores gerais e linhas em eixo secundário para Nível de Serviço e % Aban.',
    ],
    [],
    ['', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro', 'Janeiro'],
    ['Chamadas Realizadas', 2350, 2597, 2778, 3058, 2371, 3243, 4061, 1861],
    ['Chamadas Recebidas', 5614, 5528, 5582, 5025, 5162, 5078, 4691, 5103],
    ['Chamadas Atendidas', 4636, 4974, 4873, 4448, 4319, 4024, 3648, 4922],
    ['Nível Serviço', 0.81, 0.89, 0.8583, 0.8675, 0.81, 0.75, 0.7401256661, 0.9592374289],
    ['% Aban', 0.1742073388, 0.1002170767, 0.1270154066, 0.1148258706, 0.163308795, 0.2075620323, 0.2223406523, 0.0121497158],
  ]);
  XLSX.utils.book_append_sheet(workbook, q6, 'Q6.');

  const q7 = converterMatrizParaPlanilha([
    ['Questão 7: some todos os valores apenas do Estado do RJ e informe o resultado na célula F10.'],
    [],
    ['ESTADO', 'VALORES'],
    ['RJ', 10],
    ['SP', 20],
    ['SP', 30],
    ['SP', 54],
    ['SP', 87],
    ['RJ', 45],
    ['RJ', 2],
    ['RJ', 3],
    ['RJ', 5],
    ['RJ', 98],
    ['SP', 7],
    ['RJ', 5],
  ]);
  XLSX.utils.book_append_sheet(workbook, q7, 'Q7.');

  return workbook;
}

export async function montarWorkbookDaTarefa(taskId, titulo) {
  const XLSX = obterBibliotecaXlsx();
  const workbook = XLSX.utils.book_new();

  if (taskId === 'basic_exam') return { workbook: montarPlanilhaBasica(workbook) };
  if (taskId === 'qualid_exam') return { workbook: await montarPlanilhaQualidade(workbook) };
  if (taskId === 'planning_exam') return { workbook: await montarPlanilhaPlanejamento(workbook) };
  if (taskId === 'advanced_exam') return { workbook: await montarPlanilhaAvancada(workbook) };

  const planilha = converterMatrizParaPlanilha([['Arquivo de prova'], [titulo]]);
  XLSX.utils.book_append_sheet(workbook, planilha, 'Questão');
  return { workbook };
}

function validarExameBasico(workbook, pontos) {
  const indice = criarIndiceWorkbook(workbook);
  const planilha = obterPlanilha(workbook, 'Teste de Excel');
  const notas = [
    'Formatação visual, cores e estilo devem ser revisados visualmente pelo RH.',
  ];
  if (!planilha) {
    notas.push("Aba 'Teste de Excel' não encontrada; a busca flexível analisou as demais abas.");
  }

  function normalizarCabecalho(valor) {
    return String(valor || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[()]/g, '')
      .trim()
      .toUpperCase();
  }

  function obterInformacoesCabecalho() {
    const XLSX = obterBibliotecaXlsx();
    const faixa = XLSX.utils.decode_range(planilha['!ref'] || 'A1:Z50');

    for (let linha = faixa.s.r + 1; linha <= Math.min(faixa.e.r + 1, 20); linha += 1) {
      let colunaProduto = null;
      let colunaQuantidade = null;
      let colunaValor = null;
      let colunaSubtotal = null;

      for (let coluna = faixa.s.c; coluna <= faixa.e.c; coluna += 1) {
        const letraColuna = XLSX.utils.encode_col(coluna);
        const cabecalho = normalizarCabecalho(
          obterValorCelula(planilha, `${letraColuna}${linha}`),
        );

        if (cabecalho === 'PRODUTO') colunaProduto = letraColuna;
        if (cabecalho === 'QUANTIDADE') colunaQuantidade = letraColuna;
        if (
          cabecalho === 'VALOR UNITARIO R$' ||
          cabecalho === 'VALOR UNITARIO R' ||
          cabecalho === 'VALOR UNITARIO' ||
          cabecalho === 'VALOR R$' ||
          cabecalho === 'VALOR R'
        ) {
          colunaValor = letraColuna;
        }
        if (cabecalho === 'SUBTOTAL') colunaSubtotal = letraColuna;
      }

      if (colunaProduto && colunaQuantidade && colunaValor) {
        return {
          headerRow: linha,
          produtoCol: colunaProduto,
          quantidadeCol: colunaQuantidade,
          valorCol: colunaValor,
          subtotalCol: colunaSubtotal,
        };
      }
    }

    return null;
  }

  function obterIndexada(sheetName, address) {
    const coords = decodificarEndereco(address);
    if (!coords) return null;
    return obterCelulaIndexada(indice, sheetName, coords.row, coords.col);
  }

  function linhaEstaOculta(numeroLinha) {
    return !!(
      planilha &&
      planilha['!rows'] &&
      planilha['!rows'][numeroLinha - 1] &&
      planilha['!rows'][numeroLinha - 1].hidden
    );
  }

  function obterLinhasDados(colunaProduto, linhaInicial, maximo = 100) {
    const linhas = [];

    for (let linha = linhaInicial; linha <= linhaInicial + maximo; linha += 1) {
      const valor = String(
        obterValorCelula(planilha, `${colunaProduto}${linha}`) || '',
      ).trim();
      if (!valor) break;
      linhas.push(linha);
    }

    return linhas;
  }

  const info = planilha ? obterInformacoesCabecalho() : null;
  if (!info) {
    notas.push('A estrutura principal da tabela não foi localizada no ponto esperado; foram usadas evidências por proximidade e palavras-chave.');
  }

  let subtotalCriado = false;
  let subtotalPreenchido = false;
  let formatoContabil = false;
  let estiloAplicado = false;
  let corAlterada = false;
  let filtroOrdenado = false;
  let rotuloTotal = false;
  let totalQuantidade = false;
  let totalValor = false;
  let subtotalHeaderCell = null;
  let moedaCell = null;
  let estiloCell = null;
  let corCell = null;
  let totalCell = null;

  if (info) {
    const { headerRow, produtoCol, quantidadeCol, valorCol, subtotalCol } = info;
    const linhaInicial = headerRow + 1;
    const linhasDados = obterLinhasDados(produtoCol, linhaInicial, 100);
    const ultimaLinha = linhasDados.length
      ? linhasDados[linhasDados.length - 1]
      : linhaInicial;
    const linhaTotal = ultimaLinha + 1;

    subtotalHeaderCell = subtotalCol
      ? obterIndexada('Teste de Excel', `${subtotalCol}${headerRow}`)
      : null;
    subtotalCriado =
      !!subtotalCol &&
      ['SUBTOTAL', 'SUB TOTAL'].includes(
        normalizarCabecalho(obterValorCelula(planilha, `${subtotalCol}${headerRow}`)),
      );

    subtotalPreenchido =
      subtotalCriado &&
      linhasDados.length > 0 &&
      linhasDados.filter((linha) => celulaTemDados(planilha, `${subtotalCol}${linha}`))
        .length >= Math.max(1, linhasDados.length - 1);

    formatoContabil =
      !!subtotalCol &&
      linhasDados.some((linha) => {
        const valorIndexada = obterIndexada('Teste de Excel', `${valorCol}${linha}`);
        const subtotalIndexada = obterIndexada('Teste de Excel', `${subtotalCol}${linha}`);
        const valorCell = valorIndexada?.cell;
        const subtotalCell = subtotalIndexada?.cell;
        const formatoValor = String(
          valorCell?.z || valorCell?.w || valorCell?.s?.numFmt || '',
        ).toUpperCase();
        const formatoSubtotal = String(
          subtotalCell?.z || subtotalCell?.w || subtotalCell?.s?.numFmt || '',
        ).toUpperCase();
        const ok =
          /R\$|_-\*|[$]|CONTABIL|ACCOUNTING/.test(formatoValor) ||
          /R\$|_-\*|[$]|CONTABIL|ACCOUNTING/.test(formatoSubtotal) ||
          /\d,\d{2}/.test(String(valorCell?.w || '')) ||
          /\d,\d{2}/.test(String(subtotalCell?.w || ''));
        if (ok && !moedaCell) moedaCell = subtotalIndexada || valorIndexada;
        return ok;
      });

    estiloAplicado =
      !!subtotalCol &&
      linhasDados.some((linha) => {
        const subtotalIndexada = obterIndexada('Teste de Excel', `${subtotalCol}${linha}`);
        const ok = celulaTemPreenchimentoVisual(subtotalIndexada);
        if (ok && !estiloCell) estiloCell = subtotalIndexada;
        return ok;
      });

    const celulasCor = [
      obterIndexada('Teste de Excel', 'A1'),
      obterIndexada('Teste de Excel', `${produtoCol}${headerRow}`),
      obterIndexada('Teste de Excel', `${quantidadeCol}${headerRow}`),
      obterIndexada('Teste de Excel', `${valorCol}${headerRow}`),
    ];
    corCell = celulasCor.find((celula) => celulaTemPreenchimentoVisual(celula));
    corAlterada = !!corCell;

    if (planilhaTemAutofiltro(planilha)) {
      const linhasVisiveis = linhasDados.filter((linha) => !linhaEstaOculta(linha));
      const linhasReferencia = linhasVisiveis.length ? linhasVisiveis : linhasDados;
      const valores = linhasReferencia
        .map((linha) => converterNumeroSeguro(obterValorCelula(planilha, `${valorCol}${linha}`)))
        .filter((numero) => numero !== null);

      if (valores.length >= 2) {
        filtroOrdenado = valores.every(
          (valor, indiceValor) => indiceValor === 0 || valores[indiceValor - 1] >= valor,
        );
      } else {
        filtroOrdenado = true;
      }
    }

    rotuloTotal = textoMaiusculoSeguro(
      obterValorCelula(planilha, `${produtoCol}${linhaTotal}`),
    ).includes('TOTAL');
    totalQuantidade = celulaTemDados(planilha, `${quantidadeCol}${linhaTotal}`);
    totalValor = celulaTemDados(planilha, `${subtotalCol || valorCol}${linhaTotal}`);
    totalCell =
      obterIndexada('Teste de Excel', `${subtotalCol || valorCol}${linhaTotal}`) ||
      obterIndexada('Teste de Excel', `${quantidadeCol}${linhaTotal}`) ||
      obterIndexada('Teste de Excel', `${produtoCol}${linhaTotal}`);
  }

  const subtotalFlex = avaliarCabecalhoComPreenchimento(
    indice,
    'Coluna Subtotal criada e preenchida',
    {
      headers: ['Subtotal', 'Sub Total', 'Valor Total'],
      sheetNames: ['Teste de Excel'],
      contextKeywords: ['produto', 'quantidade', 'valor'],
      ranges: ['D9:G20'],
      minFilled: 2,
    },
  );
  const formatoFlex = avaliarFormatoMoeda(
    indice,
    'Valor Unitário e Subtotal em formato contábil',
    {
      sheetNames: ['Teste de Excel'],
      contextKeywords: ['valor', 'subtotal', 'produto'],
      ranges: ['C9:G20'],
    },
  );
  const estiloFlex = avaliarEstiloVisual(
    indice,
    'Nova coluna com estilo visual aplicado',
    {
      sheetNames: ['Teste de Excel'],
      contextKeywords: ['subtotal', 'valor', 'produto'],
      ranges: ['D9:G20'],
    },
  );
  const corFlex = avaliarEstiloVisual(indice, 'Cores alteradas em A1 e na linha A2', {
    sheetNames: ['Teste de Excel'],
    addresses: ['A1'],
    ranges: ['A2:D2'],
  });
  const filtroFlex = avaliarFiltroOrdenacao(
    indice,
    'Filtro aplicado e ordenação por maior valor unitário',
    {
      sheetNames: ['Teste de Excel'],
    },
  );
  const totalFlex = avaliarLinhaTotal(indice, 'Linha de total criada com soma final', {
    sheetNames: ['Teste de Excel'],
    contextKeywords: ['produto', 'quantidade', 'valor', 'subtotal'],
    keywords: ['soma', 'sum'],
  });

  return criarResultadoChecklist(
    [
      criarTarefaComEvidencias(
        'Coluna Subtotal criada e preenchida',
        [
          subtotalCriado && subtotalPreenchido
            ? criarEvidencia({
              score: 0.94,
              cell: subtotalHeaderCell,
              reason: 'cabeçalho Subtotal foi localizado e a coluna possui preenchimento nas linhas da tabela',
            })
            : null,
          evidenciaDeTarefa(subtotalFlex),
        ].filter(Boolean),
      ),
      criarTarefaComEvidencias(
        'Valor Unitário e Subtotal em formato contábil',
        [
          formatoContabil
            ? criarEvidencia({
              score: 0.86,
              cell: moedaCell,
              reason: 'formato contábil/moeda foi identificado na região de Valor Unitário ou Subtotal',
            })
            : null,
          evidenciaDeTarefa(formatoFlex),
        ].filter(Boolean),
      ),
      criarTarefaComEvidencias(
        'Nova coluna com estilo visual aplicado',
        [
          estiloAplicado
            ? criarEvidencia({
              score: 0.82,
              cell: estiloCell,
              reason: 'formatação visual foi identificada na coluna relacionada ao Subtotal',
            })
            : null,
          evidenciaDeTarefa(estiloFlex),
        ].filter(Boolean),
      ),
      criarTarefaComEvidencias(
        'Cores alteradas em A1 e na linha A2',
        [
          corAlterada
            ? criarEvidencia({
              score: 0.78,
              cell: corCell,
              reason: 'formatação visual/cor foi identificada em A1 ou cabeçalhos próximos',
            })
            : null,
          evidenciaDeTarefa(corFlex),
        ].filter(Boolean),
      ),
      criarTarefaComEvidencias(
        'Filtro aplicado e ordenação por maior valor unitário',
        [
          filtroOrdenado
            ? criarEvidencia({
              score: 0.86,
              reason: 'autofiltro encontrado e valores em ordem decrescente na tabela esperada',
              extra: { sheetName: 'Teste de Excel' },
            })
            : null,
          evidenciaDeTarefa(filtroFlex),
        ].filter(Boolean),
      ),
      criarTarefaComEvidencias(
        'Linha de total criada com soma final',
        [
          rotuloTotal && (totalQuantidade || totalValor)
            ? criarEvidencia({
              score: 0.9,
              cell: totalCell,
              reason: 'linha Total foi localizada com valores ou fórmulas de soma preenchidos',
            })
            : null,
          evidenciaDeTarefa(totalFlex),
        ].filter(Boolean),
      ),
    ],
    pontos,
    notas,
  );
}

function validarExameQualidade(workbook, pontos) {
  const indice = criarIndiceWorkbook(workbook);
  const notas = [
    'Itens visuais, gráfico e alguns posicionamentos podem precisar de revisão manual do RH.',
  ];

  const planilhaA = obterPlanilha(workbook, 'Planilha A');
  const procv = obterPlanilha(workbook, 'PROCV');
  const tabdin = obterPlanilha(workbook, 'TAB_DIN');
  const copiarColar = obterPlanilha(workbook, 'Copiar_Colar');
  const grafico = obterPlanilha(workbook, 'Grafico') || obterPlanilha(workbook, 'Gráfico');

  const operadoresOrdenados = coletarValoresAteLinhaVazia(planilhaA, 'A', 3).filter(
    (valor) => !textoMaiusculoSeguro(valor).includes('OPERADOR'),
  );
  const estaOrdenado =
    operadoresOrdenados.length > 1
      ? operadoresOrdenados.every(
        (valor, indice) =>
          indice === 0 ||
          textoMaiusculoSeguro(operadoresOrdenados[indice - 1]) <=
          textoMaiusculoSeguro(valor),
      )
      : false;

  const cabecalhoValorTotal =
    textoMaiusculoSeguro(obterValorCelula(planilhaA, 'F2')) === 'VALOR TOTAL';
  const valorTotalCalculado = ['F3', 'F4', 'F5', 'F6', 'F7', 'F8'].some((endereco) =>
    celulaTemDados(planilhaA, endereco),
  );

  const resultadosProcv = ['C2', 'C3', 'C4', 'C5', 'C6', 'C7'].filter((endereco) =>
    celulaTemDados(procv, endereco),
  ).length;

  const listaNaoEncontrados =
    celulaTemDados(procv, 'BC255') ||
    celulaTemDados(procv, 'BD255') ||
    celulaTemDados(procv, 'BC256');

  const resumoTabDin =
    celulaTemDados(tabdin, 'A5') ||
    celulaTemDados(tabdin, 'B5') ||
    celulaTemDados(tabdin, 'C5') ||
    celulaTemDados(tabdin, 'D5');

  const tabelaCopiada =
    celulaTemDados(copiarColar, 'A5') &&
    celulaTemDados(copiarColar, 'B5') &&
    planilhaTemAutofiltro(copiarColar);

  const possuiGrafico =
    grafico &&
    celulaTemDados(grafico, 'A2') &&
    celulaTemDados(grafico, 'D2') &&
    (grafico['!images'] || grafico['!drawings'] || grafico['!charts']);

  const ordenacaoFlex = avaliarOrdenacaoPorCabecalho(
    indice,
    'Planilha A em ordem alfabética por Operador',
    {
      sheetNames: ['Planilha A'],
      headers: ['Operador'],
      minRows: 4,
    },
  );
  const cabecalhoValorFlex = avaliarCabecalhoComPreenchimento(
    indice,
    'Coluna F com titulo Valor Total',
    {
      headers: ['Valor Total'],
      sheetNames: ['Planilha A'],
      contextKeywords: ['valor', 'quantidade', 'operador'],
      ranges: ['F2:H20'],
      headerOnly: true,
      minFilled: 0,
    },
  );
  const valorTotalFlex = criarTarefaComEvidencias(
    'Valor Total = Valor (R$) x Quantidade',
    [
      ...avaliarCelulasPorCriterio(indice, {
        sheetNames: ['Planilha A'],
        formulaKeywords: ['*', 'mult', 'product'],
        contextKeywords: ['valor total', 'quantidade', 'valor'],
        types: ['formula', 'numero'],
        ranges: ['F3:H30'],
        minCandidateScore: 0.42,
      }),
      evidenciaDeTarefa(
        avaliarCabecalhoComPreenchimento(indice, 'Valor Total = Valor (R$) x Quantidade', {
          headers: ['Valor Total'],
          sheetNames: ['Planilha A'],
          contextKeywords: ['valor', 'quantidade'],
          ranges: ['F2:H30'],
          minFilled: 3,
        }),
      ),
    ].filter(Boolean),
  );
  const procvFlex = avaliarProcvPreenchido(indice, 'PROCV preenchido na aba PROCV', {
    sheetNames: ['PROCV'],
    anchors: [
      'Fatima Osorio',
      'Antonio Carlos',
      'Elenilda Hilda',
      'Jorge Ponteio',
      'Rafael Luiz',
      'Amanda Gilena',
      'Simone Maria',
      'Wesley Nunes',
    ],
    responseKeywords: ['Tony', 'Lula', 'Angela', 'Barack'],
    contextKeywords: ['operador', 'supervisor', 'resultado'],
    minCount: 4,
    radius: 4,
  });
  const naoEncontradosFlex = avaliarTextosEsperados(
    indice,
    'Operadores nao encontrados listados a partir de BC255',
    {
      texts: ['Tania Santana', 'Nancy Vanderley', 'Luzia Mendonca', 'Eloisa Gouvea'],
      sheetNames: ['PROCV'],
      ranges: ['BC255:BE280'],
      contextKeywords: ['nao encontrado', 'operadores'],
      minMatches: 2,
      minIndividualScore: 0.55,
    },
  );
  const resumoLulaFlex = avaliarPreenchimentoPorAncora(
    indice,
    'Resumo do supervisor Lula criado na aba TAB_DIN',
    {
      anchors: ['Lula'],
      responseKeywords: ['valor total', 'premium', 'virtua', 'total cine'],
      sheetNames: ['TAB_DIN'],
      radius: 6,
      minCount: 2,
    },
  );
  const tabelaWesleyFlex = avaliarPreenchimentoPorAncora(
    indice,
    'Tabela copiada e filtrada para Wesley Nunes',
    {
      anchors: ['Wesley Nunes'],
      responseKeywords: ['operador', 'supervisor', 'produto', 'valor', 'quantidade'],
      sheetNames: ['Copiar_Colar'],
      radius: 6,
      minCount: 3,
    },
  );
  const graficoFlex = avaliarGraficoCriado(
    indice,
    'Gráfico de colunas agrupadas criado com supervisores e março',
    {
      sheetNames: ['Grafico', 'Gráfico'],
      contextKeywords: ['mar', 'marco', 'angela', 'barack', 'lula', 'tony'],
      minRow: 8,
      minTerms: 2,
      minCells: 3,
    },
  );

  const tarefas = [
    criarTarefaComEvidencias(
      'Planilha A em ordem alfabética por Operador',
      [
        estaOrdenado
          ? criarEvidencia({
            score: 0.92,
            reason: 'a coluna Operador está em ordem alfabética na Planilha A',
            extra: { sheetName: 'Planilha A', address: 'A3' },
          })
          : null,
        evidenciaDeTarefa(ordenacaoFlex),
      ].filter(Boolean),
    ),
    criarTarefaComEvidencias(
      'Coluna F com titulo Valor Total',
      [
        cabecalhoValorTotal
          ? criarEvidencia({
            score: 0.9,
            cell: indice.lookup['Planilha A']?.['2:5'],
            reason: 'cabeçalho Valor Total localizado na coluna esperada',
          })
          : null,
        evidenciaDeTarefa(cabecalhoValorFlex),
      ].filter(Boolean),
    ),
    criarTarefaComEvidencias(
      'Valor Total = Valor (R$) x Quantidade',
      [
        valorTotalCalculado
          ? criarEvidencia({
            score: 0.82,
            cell: indice.lookup['Planilha A']?.['3:5'],
            reason: 'a coluna Valor Total possui células preenchidas na região esperada',
          })
          : null,
        evidenciaDeTarefa(valorTotalFlex),
      ].filter(Boolean),
    ),
    criarTarefaComEvidencias(
      'PROCV preenchido na aba PROCV',
      [
        resultadosProcv >= 4
          ? criarEvidencia({
            score: 0.9,
            cell: indice.lookup.PROCV?.['2:2'],
            reason: `${resultadosProcv} resultado(s) preenchido(s) na área esperada de PROCV`,
          })
          : null,
        evidenciaDeTarefa(procvFlex),
      ].filter(Boolean),
    ),
    criarTarefaComEvidencias(
      'Operadores nao encontrados listados a partir de BC255',
      [
        listaNaoEncontrados
          ? criarEvidencia({
            score: 0.86,
            cell: indice.lookup.PROCV?.['255:54'] || indice.lookup.PROCV?.['255:55'],
            reason: 'lista de não encontrados localizada a partir da região BC255',
          })
          : null,
        evidenciaDeTarefa(naoEncontradosFlex),
      ].filter(Boolean),
    ),
    criarTarefaComEvidencias(
      'Resumo do supervisor Lula criado na aba TAB_DIN',
      [
        resumoTabDin
          ? criarEvidencia({
            score: 0.84,
            cell: indice.lookup.TAB_DIN?.['5:0'] || indice.lookup.TAB_DIN?.['5:1'],
            reason: 'resumo preenchido na área esperada da aba TAB_DIN',
          })
          : null,
        evidenciaDeTarefa(resumoLulaFlex),
      ].filter(Boolean),
    ),
    criarTarefaComEvidencias(
      'Tabela copiada e filtrada para Wesley Nunes',
      [
        tabelaCopiada
          ? criarEvidencia({
            score: 0.88,
            cell: indice.lookup.Copiar_Colar?.['5:0'],
            reason: 'tabela copiada a partir de A5 e autofiltro aplicado',
          })
          : null,
        evidenciaDeTarefa(tabelaWesleyFlex),
      ].filter(Boolean),
    ),
    criarTarefaComEvidencias(
      'Gráfico de colunas agrupadas criado com supervisores e março',
      [
        possuiGrafico
          ? criarEvidencia({
            score: 0.86,
            reason: 'objeto gráfico detectado na aba Gráfico',
            extra: { sheetName: grafico === obterPlanilha(workbook, 'Gráfico') ? 'Gráfico' : 'Grafico' },
          })
          : null,
        evidenciaDeTarefa(graficoFlex),
      ].filter(Boolean),
    ),
  ];

  return criarResultadoChecklist(tarefas, pontos, notas);
}

function validarExamePlanejamento(workbook, pontos) {
  const indice = criarIndiceWorkbook(workbook);
  const notas = [
    'Gráficos, formatação condicional e parte visual devem ser validados manualmente pelo RH.',
  ];

  const q1 = obterPlanilha(workbook, 'Q1.');
  const q2 = obterPlanilha(workbook, 'Q2.');
  const q3 = obterPlanilha(workbook, 'Q3.');
  const q4 = obterPlanilha(workbook, 'Q4.');
  const q5 = obterPlanilha(workbook, 'Q5.');

  const q1Pronto = ['B6', 'B7', 'B8', 'B9', 'B10'].filter((endereco) => celulaTemDados(q1, endereco)).length >= 3;

  const q2Pronto = ['B4', 'B5', 'B6', 'B7', 'B8'].filter((endereco) => celulaTemDados(q2, endereco)).length >= 3;

  const q3Pronto =
    (q3 && celulaTemDados(q3, 'A5')) ||
    (q3 && celulaTemDados(q3, 'B5')) ||
    (q3 && (q3['!images'] || q3['!drawings'] || q3['!charts']));

  const q4Pronto = ['C7', 'C8', 'C9', 'D7', 'D8', 'D9'].filter((endereco) => celulaTemDados(q4, endereco)).length >= 4;

  const q5Pronto = ['G5', 'H5', 'I5', 'J5', 'G6', 'H6', 'I6', 'J6'].filter((endereco) => celulaTemDados(q5, endereco)).length >= 4;

  const cidades = [
    'Campinas',
    'Guarulhos',
    'Limeira',
    'Jacarei',
    'Embu',
    'Catanduva',
    'Lins',
    'Itapolis',
    'Jandira',
    'Lorena',
    'Guaratingueta',
    'Juquia',
  ];
  const statusChamadas = [
    'DISPONIBILIDADE / CSO',
    'ERRO DE CADASTRO',
    'FAX',
    'INSATISFACAO COM A TELEFONICA',
    'JA FOI CONTATADO',
    'LIGACOES NAO COMPLETADAS',
  ];
  const zonas = [
    'OESTE',
    'CENTRO SUL',
    'SUDESTE',
    'NORDESTE',
    'SUL',
    'CENTRO',
    'LESTE2',
    'LESTE1',
    'NOROESTE',
  ];
  const operadoresVendas = [
    'ADIEL PASSOS DOS SANTOS',
    'NOEMI SOARES DE SOUZA',
    'NORMA SUELI SANTOS',
    'NUBIA ROSA PEREIRA',
    'ALINE MACIEL BARROSO',
    'VANIA ELISABETE GOMES',
  ];

  const q1Flex = criarTarefaComEvidencias(
    'CONT.SE preenchido por cidade e ordenado',
    [
      ...avaliarCelulasPorCriterio(indice, {
        sheetNames: ['Q1.'],
        formulaKeywords: ['cont.se', 'countif'],
        contextKeywords: ['cidade', 'qtde', 'nomes'],
        types: ['formula', 'numero'],
        ranges: ['B6:B30'],
        minCandidateScore: 0.42,
      }),
      evidenciaDeTarefa(
        avaliarListaPreenchida(indice, 'CONT.SE preenchido por cidade e ordenado', {
          anchors: cidades,
          sheetNames: ['Q1.'],
          onlyRight: true,
          minMatches: 3,
          radius: 3,
          ranges: ['B6:B30'],
        }),
      ),
    ].filter(Boolean),
  );
  const q2Flex = criarTarefaComEvidencias(
    'PROCV preenchido na aba Q2.',
    [
      ...avaliarCelulasPorCriterio(indice, {
        sheetNames: ['Q2.'],
        formulaKeywords: ['procv', 'vlookup', 'xlookup', 'procx'],
        contextKeywords: ['status', 'volume'],
        types: ['formula', 'numero'],
        ranges: ['B4:B30'],
        minCandidateScore: 0.42,
      }),
      evidenciaDeTarefa(
        avaliarListaPreenchida(indice, 'PROCV preenchido na aba Q2.', {
          anchors: statusChamadas,
          sheetNames: ['Q2.'],
          onlyRight: true,
          minMatches: 3,
          radius: 3,
          ranges: ['B4:B30'],
        }),
      ),
    ].filter(Boolean),
  );
  const q3Flex = criarTarefaComEvidencias(
    'Tabela por DDD e gráfico Pizza 3D',
    [
      ...avaliarCelulasPorCriterio(indice, {
        sheetNames: ['Q3.'],
        keywords: ['ddd'],
        contextKeywords: ['grafico', 'pizza', 'percentual', 'controle de ligacao'],
        types: ['numero', 'texto'],
        ranges: ['A5:D80'],
        minCandidateScore: 0.42,
      }),
      evidenciaDeTarefa(
        avaliarGraficoCriado(indice, 'Tabela por DDD e gráfico Pizza 3D', {
          sheetNames: ['Q3.'],
          contextKeywords: ['ddd', 'grafico', 'pizza', 'percentual'],
          minRow: 5,
          minTerms: 1,
          minCells: 3,
        }),
      ),
    ].filter(Boolean),
  );
  const q4Flex = criarTarefaComEvidencias(
    'Percentual e situação por zona',
    [
      ...avaliarCelulasPorCriterio(indice, {
        sheetNames: ['Q4.'],
        formulaKeywords: ['se', 'if', '/', '%'],
        contextKeywords: ['zonas', 'percentual', 'situacao', 'media'],
        types: ['formula', 'percentual', 'texto'],
        ranges: ['C7:D20'],
        minCandidateScore: 0.42,
      }),
      evidenciaDeTarefa(
        avaliarListaPreenchida(indice, 'Percentual e situação por zona', {
          anchors: zonas,
          sheetNames: ['Q4.'],
          onlyRight: true,
          responseKeywords: ['ok', 'alto', 'baixo', 'media', 'acima', 'abaixo'],
          minMatches: 4,
          radius: 4,
          ranges: ['C7:D20'],
        }),
      ),
    ].filter(Boolean),
  );
  const q5Flex = criarTarefaComEvidencias(
    'Análise de vendas preenchida com totais e percentuais',
    [
      ...avaliarCelulasPorCriterio(indice, {
        sheetNames: ['Q5.'],
        formulaKeywords: ['procv', 'vlookup', 'xlookup', 'procx', '/', 'soma', 'sum'],
        contextKeywords: ['total de contatos', 'vendido', 'nao vendido', 'operador'],
        types: ['formula', 'numero', 'percentual'],
        ranges: ['G5:J40'],
        minCandidateScore: 0.42,
      }),
      evidenciaDeTarefa(
        avaliarListaPreenchida(
          indice,
          'Análise de vendas preenchida com totais e percentuais',
          {
            anchors: operadoresVendas,
            sheetNames: ['Q5.'],
            onlyRight: true,
            minMatches: 3,
            radius: 8,
            ranges: ['G5:J40'],
          },
        ),
      ),
    ].filter(Boolean),
  );

  const tarefas = [
    criarTarefaComEvidencias(
      'CONT.SE preenchido por cidade e ordenado',
      [
        q1Pronto
          ? criarEvidencia({
            score: 0.86,
            cell: indice.lookup['Q1.']?.['6:1'],
            reason: 'valores de CONT.SE preenchidos na região esperada da Q1',
          })
          : null,
        evidenciaDeTarefa(q1Flex),
      ].filter(Boolean),
    ),
    criarTarefaComEvidencias(
      'PROCV preenchido na aba Q2.',
      [
        q2Pronto
          ? criarEvidencia({
            score: 0.86,
            cell: indice.lookup['Q2.']?.['4:1'],
            reason: 'volumes preenchidos na região esperada da Q2',
          })
          : null,
        evidenciaDeTarefa(q2Flex),
      ].filter(Boolean),
    ),
    criarTarefaComEvidencias(
      'Tabela por DDD e gráfico Pizza 3D',
      [
        q3Pronto
          ? criarEvidencia({
            score: 0.82,
            cell: indice.lookup['Q3.']?.['5:0'] || indice.lookup['Q3.']?.['5:1'],
            reason: 'tabela ou objeto gráfico localizado na região esperada da Q3',
          })
          : null,
        evidenciaDeTarefa(q3Flex),
      ].filter(Boolean),
    ),
    criarTarefaComEvidencias(
      'Percentual e situação por zona',
      [
        q4Pronto
          ? criarEvidencia({
            score: 0.86,
            cell: indice.lookup['Q4.']?.['7:2'] || indice.lookup['Q4.']?.['7:3'],
            reason: 'percentuais e/ou situações preenchidos na região esperada da Q4',
          })
          : null,
        evidenciaDeTarefa(q4Flex),
      ].filter(Boolean),
    ),
    criarTarefaComEvidencias(
      'Análise de vendas preenchida com totais e percentuais',
      [
        q5Pronto
          ? criarEvidencia({
            score: 0.86,
            cell: indice.lookup['Q5.']?.['5:6'] || indice.lookup['Q5.']?.['5:7'],
            reason: 'campos de totais e percentuais preenchidos na região esperada da Q5',
          })
          : null,
        evidenciaDeTarefa(q5Flex),
      ].filter(Boolean),
    ),
  ];

  return criarResultadoChecklist(tarefas, pontos, notas);
}

function validarExameAvancado(workbook, pontos) {
  const base = validarExamePlanejamento(workbook, pontos);
  const indice = criarIndiceWorkbook(workbook);
  const tarefas = Array.isArray(base.taskDetails)
    ? base.taskDetails.map(normalizarDetalheTarefa)
    : base.completedTasks.map((item) => ({
      label: item.replace(/^\[(x| )\]\s*/, ''),
      done: item.startsWith('[x]'),
    }));
  const notas = Array.isArray(base.notes) ? [...base.notes] : [];

  const q6 = obterPlanilha(workbook, 'Q6.');
  const q7 = obterPlanilha(workbook, 'Q7.');

  const graficoCombinadoFlex = avaliarGraficoCriado(
    indice,
    'Gráfico combinado com eixo secundário',
    {
      sheetNames: ['Q6.'],
      contextKeywords: ['nivel servico', 'aban', 'chamadas', 'eixo secundario'],
      minRow: 8,
      minTerms: 2,
      minCells: 3,
    },
  );
  const somaRjFlex = criarTarefaComEvidencias(
    'Soma do RJ em F10',
    [
      ...avaliarCelulasPorCriterio(indice, {
        sheetNames: ['Q7.'],
        addresses: ['F10'],
        formulaKeywords: ['somase', 'sumif', 'soma', 'sum'],
        contextKeywords: ['rj', 'estado', 'valores'],
        expectedValues: ['168'],
        types: ['formula', 'numero'],
        minCandidateScore: 0.42,
      }),
    ],
  );

  tarefas.push(
    criarTarefaComEvidencias(
      'Gráfico combinado com eixo secundário',
      [
        q6 && (q6['!images'] || q6['!drawings'] || q6['!charts'])
          ? criarEvidencia({
            score: 0.86,
            reason: 'objeto gráfico detectado na aba Q6',
            extra: { sheetName: 'Q6.' },
          })
          : null,
        evidenciaDeTarefa(graficoCombinadoFlex),
      ].filter(Boolean),
    ),
  );
  tarefas.push(
    criarTarefaComEvidencias(
      'Soma do RJ em F10',
      [
        celulaTemDados(q7, 'F10')
          ? criarEvidencia({
            score: 0.9,
            cell: indice.lookup['Q7.']?.['10:5'],
            reason: 'resposta preenchida na célula F10 solicitada',
          })
          : null,
        evidenciaDeTarefa(somaRjFlex),
      ].filter(Boolean),
    ),
  );

  return criarResultadoChecklist(tarefas, pontos, notas);
}

export function validarWorkbookPorTarefa(taskId, workbook, pontos, opcoes = {}) {
  let resultado;
  if (taskId === 'basic_exam') resultado = validarExameBasico(workbook, pontos);
  else if (taskId === 'qualid_exam') resultado = validarExameQualidade(workbook, pontos);
  else if (taskId === 'planning_exam') resultado = validarExamePlanejamento(workbook, pontos);
  else if (taskId === 'advanced_exam') resultado = validarExameAvancado(workbook, pontos);
  else return criarResultadoPontuacao(0, pontos, ['Validação não implementada.'], true);

  return aplicarComparacaoComModelo(
    resultado,
    opcoes.modeloWorkbook,
    workbook,
    pontos,
  );
}

export async function validarArquivoExcel(taskId, arquivo, pontos) {
  const XLSX = obterBibliotecaXlsx();
  const arrayBuffer = await arquivo.arrayBuffer();
  const dados = new Uint8Array(arrayBuffer);
  const workbook = XLSX.read(dados, {
    type: 'array',
    cellFormula: true,
    cellStyles: true,
    cellNF: true,
    cellHTML: false,
  });
  let modeloWorkbook = null;
  try {
    const modelo = await carregarModeloExcel(taskId);
    modeloWorkbook = XLSX.read(new Uint8Array(modelo.arrayBuffer), {
      type: 'array',
      cellFormula: true,
      cellStyles: true,
      cellNF: true,
      cellHTML: false,
    });
  } catch (error) {
    console.warn('Nao foi possivel carregar o modelo Excel para comparacao.', error);
  }

  const validation = validarWorkbookPorTarefa(taskId, workbook, pontos, {
    modeloWorkbook,
  });
  const validacaoImplementada = possuiValidacaoExcelImplementada(validation);
  // Correções.txt item 8: nunca expor quantidade de tarefas feitas/detectadas
  // ao candidato — apenas a mensagem de status, sem números de checklist.
  const statusText = validation.unanswered
    ? 'Arquivo analisado, mas nenhuma tarefa respondida foi detectada.'
    : validacaoImplementada
      ? 'Arquivo recebido.'
      : 'Arquivo recebido, mas esta etapa ainda não possui validação automática completa.';

  return {
    type: 'excel_external',
    uploaded: true,
    filename: arquivo.name,
    validation,
    statusText,
    statusClass:
      validacaoImplementada && !validation.unanswered
        ? 'excel-status-ok'
        : 'excel-status-warn',
    uploadedArrayBuffer: arrayBuffer,
  };
}

export function validarEntregaObrigatoriaDaProva({ questoes, respostas }) {
  const listaQuestoes = Array.isArray(questoes) ? questoes : [];
  const listaRespostas = Array.isArray(respostas) ? respostas : [];

  for (let indice = 0; indice < listaQuestoes.length; indice += 1) {
    const questao = listaQuestoes[indice];
    if (questao?.type !== 'excel_external') continue;

    const resposta = listaRespostas[indice];
    if (!resposta?.uploaded || !resposta?.validation || !resposta?.uploadedArrayBuffer) {
      return {
        ok: false,
        tipo: 'excel_nao_enviado',
        indice,
        mensagem: `Envie o arquivo Excel da etapa "${questao.stage || questao.title || 'Excel'}" antes de finalizar a prova.`,
      };
    }

    if (!possuiValidacaoExcelImplementada(resposta.validation)) {
      return {
        ok: false,
        tipo: 'excel_sem_validacao',
        indice,
        mensagem: `A etapa "${questao.stage || questao.title || 'Excel'}" ainda não conseguiu ser analisada automaticamente. Envie novamente o arquivo ou valide o checklist configurado.`,
      };
    }
  }

  return { ok: true };
}

export function formatarDocumentoRichText(comando, valor = null) {
  document.execCommand(comando, false, valor);
}

export function obterDescricaoMacroEtapa(stageKey, candidato = {}) {
  const role = String(candidato?.role || '').trim();
  const track = String(candidato?.track || '').trim();
  const roleUpper = textoMaiusculoSeguro(role);
  const trackUpper = textoMaiusculoSeguro(track);

  const mapaBase = {
    word_basic:
      'Será avaliado formatação de texto, organização visual do conteúdo, digitação, interpretação escrita e nível de escrita do candidato.',
    word_intermediate:
      'Será avaliado formatação de texto, estruturação de conteúdo, clareza na escrita, organização de informações e domínio intermediário de edição de documentos.',
    word_advanced:
      'Será avaliado domínio avançado de edição de documentos, padronização visual, construção textual, coesão da escrita e aplicação de recursos de formatação.',
    excel_basic:
      'Será avaliado cálculos básicos, preenchimento de planilhas, organização de dados, formatação de tabelas e interpretação de informações.',
    excel_intermediate:
      'Será avaliado cálculos intermediários, organização e análise de dados, formatação de tabelas, uso de fórmulas e raciocínio em planilhas.',
    excel_advanced:
      'Será avaliado cálculos avançados, análise de dados, construção de tabelas, lógica em planilhas, fórmulas, gráficos e recursos avançados como PROCV.',
    excel_operational:
      'Será avaliado cálculos operacionais, organização de planilhas, controle de dados, formatação de tabelas e aplicação prática de fórmulas no contexto da operação.',
    excel_planning:
      'Será avaliado raciocínio analítico, cálculos em planilhas, organização de bases, construção de tabelas, gráficos, indicadores e uso de PROCV.',
    excel_quality:
      'Será avaliado manipulação de planilhas, cálculos, organização de dados, filtros, formatação de tabelas e uso de PROCV em contexto de controle de qualidade.',
    logic:
      'Será avaliado raciocínio lógico, interpretação de cenários, tomada de decisão e capacidade analítica.',
    technical_support:
      'Será avaliado conhecimento técnico, interpretação de incidentes, raciocínio de suporte, análise de causa e tomada de decisão em cenários práticos.',
    customer_service:
      'Será avaliado comunicação, interpretação de atendimento, postura profissional, clareza de resposta e raciocínio aplicado ao contexto operacional.',
    general_knowledge:
      'Será avaliado conhecimentos gerais, interpretação textual, atenção, raciocínio e repertório básico profissional.',
    adm:
      'Será avaliado organização, interpretação de informações, raciocínio administrativo, controles operacionais e análise de dados.',
    rh:
      'Será avaliado interpretação de cenário, organização de informações, escrita profissional, raciocínio analítico e conhecimentos aplicados à rotina de RH.',
    professional_essay:
      'Será avaliada redação profissional em estudo de caso, considerando clareza, coesão, coerência, organização das ideias, argumentação, interpretação do cenário e adequação ao contexto da vaga.',
  };

  if (stageKey === 'professional_essay') {
    return mapaBase.professional_essay;
  }

  if (
    roleUpper.includes('JOVEM APRENDIZ') ||
    roleUpper.includes('OPERADOR') ||
    roleUpper.includes('ESTAGIÁRIO')
  ) {
    if (stageKey.includes('word')) {
      return 'Será avaliado formatação de texto, digitação, organização do conteúdo, compreensão escrita e nível de escrita do candidato.';
    }
    if (stageKey.includes('excel')) {
      return 'Será avaliado cálculos, preenchimento de planilhas, formatação de tabelas, organização de dados e uso de fórmulas básicas e intermediárias, incluindo PROCV quando aplicável.';
    }
  }

  if (
    roleUpper.includes('SUPERVISOR') ||
    roleUpper.includes('CONTROL DESK') ||
    roleUpper.includes('PLANEJAMENTO')
  ) {
    if (stageKey.includes('word')) {
      return 'Será avaliado escrita profissional, clareza textual, organização de informações, estruturação de conteúdo e domínio de formatação de documentos.';
    }
    if (stageKey.includes('excel')) {
      return 'Será avaliado cálculos, análise de indicadores, construção e formatação de tabelas, organização de bases, gráficos e uso de fórmulas como PROCV.';
    }
  }

  if (
    roleUpper.includes('TI') ||
    roleUpper.includes('ANALISTA') ||
    trackUpper === 'TI'
  ) {
    if (stageKey.includes('word')) {
      return 'Será avaliado clareza técnica na escrita, organização de conteúdo, padronização textual, interpretação e estruturação de respostas profissionais.';
    }
    if (stageKey.includes('excel')) {
      return 'Será avaliado análise de dados, cálculos, organização de planilhas, formatação de tabelas, cruzamento de informações e uso de fórmulas como PROCV.';
    }
    if (stageKey.includes('technical')) {
      return 'Será avaliado raciocínio técnico, interpretação de problemas, análise de cenário, lógica de suporte e tomada de decisão.';
    }
  }

  if (trackUpper === 'RH') {
    if (stageKey.includes('word')) {
      return 'Será avaliado escrita corporativa, clareza textual, organização de informações e formatação de documentos.';
    }
    if (stageKey.includes('excel')) {
      return 'Será avaliado cálculos, organização de planilhas, controle de dados, formatação de tabelas e uso de fórmulas aplicadas à rotina administrativa.';
    }
  }

  if (trackUpper === 'ADM') {
    if (stageKey.includes('word')) {
      return 'Será avaliado escrita profissional, clareza, estruturação do conteúdo e padronização de documentos.';
    }
    if (stageKey.includes('excel')) {
      return 'Será avaliado cálculos, organização de dados, formatação de tabelas, análise de informações e uso de fórmulas como PROCV.';
    }
  }

  return (
    mapaBase[stageKey] ||
    'Será avaliado conhecimento prático da etapa, interpretação, organização de informações e domínio dos recursos exigidos para a vaga.'
  );
}

export function montarResumoRegrasDoCandidato(blueprint, candidato) {
  if (!blueprint?.stages?.length) return [];

  return blueprint.stages.map((stage) => ({
    key: stage.key,
    label: ROTULOS_ETAPAS[stage.key] || 'Etapa',
    description: obterDescricaoMacroEtapa(stage.key, candidato),
  }));
}

export function obterTextoGabaritoQuestao(questao) {
  if (questao.type === 'multiple') {
    const indiceEsperado =
      questao?.answer !== undefined && questao?.answer !== null
        ? questao.answer
        : questao?.correctIndex;

    if (
      indiceEsperado !== undefined &&
      indiceEsperado !== null &&
      Array.isArray(questao.options)
    ) {
      return (
        questao.options[indiceEsperado] ||
        'Alternativa correta definida no sistema.'
      );
    }

    return 'Alternativa correta definida no sistema.';
  }

  if (questao.type === 'compact_choice_group') {
    const itens = Array.isArray(questao.items) ? questao.items : [];
    const respostas = itens
      .map((item, indice) => {
        if (Number(item?.answer) < 0) return null;
        const letra = String.fromCharCode(65 + Number(item.answer));
        return `Item ${indice + 1}: ${letra}`;
      })
      .filter(Boolean);
    return respostas.length
      ? respostas.join(' | ')
      : 'Questão agrupada sem gabarito único; revisar por rubrica interna.';
  }

  if (questao.type === 'word') {
    if (questao.gabarito?.tipo === 'rubrica' && Array.isArray(questao.gabarito.criterios)) {
      return questao.gabarito.criterios
        .map((criterio) =>
          `${criterio.nome || 'Critério'} (${Number(criterio.peso || 0)}%): ${criterio.descricao || ''}`.trim(),
        )
        .join(' | ');
    }

    const criterios = [];
    if (questao.expected?.titleText)
      criterios.push(`Título esperado: ${questao.expected.titleText}`);
    if (questao.expected?.titleBold) criterios.push('Título em negrito');
    if (questao.expected?.titleCenter) criterios.push('Título centralizado');
    if (questao.expected?.minTextLength)
      criterios.push(
        `Texto com no mínimo ${questao.expected.minTextLength} caracteres`,
      );
    if (questao.expected?.minSentences)
      criterios.push(`Texto com pelo menos ${questao.expected.minSentences} frases`);
    if (questao.expected?.requiresList) criterios.push('Uso de lista');
    if (questao.expected?.minListItems)
      criterios.push(`Lista com ao menos ${questao.expected.minListItems} itens`);
    if (questao.expected?.anyBold) criterios.push('Uso de negrito no conteúdo');
    if (questao.expected?.essay) {
      criterios.push(
        'Redação em texto corrido com clareza, coesão, coerência, argumentação e postura profissional',
      );
    }

    return criterios.length
      ? criterios.join(' | ')
      : 'Critérios práticos definidos no sistema.';
  }

  if (questao.type === 'excel_external') {
    const gabarito = obterGabaritoDaTarefa(questao.taskId);
    return gabarito.length ? gabarito.join(' | ') : 'Checklist prático do Excel.';
  }

  return '';
}

export function obterTextoRespostaCandidato(questao, resposta) {
  if (!resposta) return 'Sem resposta.';
  if (questao.type === 'multiple') {
    return resposta.selected === null || resposta.selected === undefined
      ? 'Sem resposta.'
      : questao.options?.[resposta.selected] ?? `Opção ${resposta.selected}`;
  }
  if (questao.type === 'compact_choice_group') {
    const selecoes = resposta.selections || {};
    const itens = Array.isArray(questao.items) ? questao.items : [];
    const partes = itens.map((item, indice) => {
      const selecionado = selecoes[String(item.id)];
      const letra = selecionado !== undefined && selecionado !== null
        ? String.fromCharCode(65 + Number(selecionado))
        : 'sem resposta';
      const texto = item.options?.[selecionado] || '';
      return `Item ${indice + 1}: ${letra}${texto ? ` - ${texto}` : ''}`;
    });
    return partes.length ? partes.join(' | ') : 'Sem resposta.';
  }
  if (questao.type === 'word') {
    return removerHtml(resposta.content || '') || 'Sem resposta.';
  }
  if (questao.type === 'excel_external') {
    const partes = [
      resposta.filename
        ? `Arquivo enviado: ${resposta.filename}`
        : 'Arquivo não enviado.',
    ];
    if (resposta.validation?.completedTasks?.length) {
      partes.push(
        `Itens detectados: ${resposta.validation.completedTasks.join('; ')}`,
      );
    }
    if (resposta.validation?.notes?.length) {
      partes.push(`Observações: ${resposta.validation.notes.join('; ')}`);
    }
    if (resposta.validation?.taskDetails?.length) {
      partes.push(
        `Correção detalhada: ${resposta.validation.taskDetails
          .map(formatarDetalheTarefa)
          .join(' ; ')}`,
      );
    }
    return partes.join(' | ');
  }
  return 'Sem resposta.';
}

export function finalizarProva({ questoes, respostas, blueprint }) {
  const resultados = [];
  let totalScore = 0;
  let totalMax = 0;

  questoes.forEach((questao, indice) => {
    const resposta = respostas[indice];
    let resultado;

    if (questao.type === 'word') {
      const score = avaliarRespostaTexto(resposta, questao.expected, questao.points);
      const respostaParaAnalise = resposta
        ? {
          ...resposta,
          formatacoesAplicadas: obterFormatacoesAplicadas(resposta),
        }
        : resposta;
      const correcaoInteligente = corrigirRespostaDiscursivaInteligente(
        questao,
        respostaParaAnalise,
        score,
        questao.points,
      );
      const notasCorrecao = correcaoInteligente
        ? [
          `Correção inteligente sugerida: ${correcaoInteligente.nota_sugerida}/${correcaoInteligente.nota_maxima}. Revisão final do RH obrigatória.`,
          ...(correcaoInteligente.alertas || []),
        ]
        : [];
      resultado = criarResultadoPontuacao(
        score,
        questao.points,
        notasCorrecao,
        Boolean(correcaoInteligente?.revisao_humana),
        [],
        { intelligentCorrection: correcaoInteligente },
      );
    } else if (questao.type === 'multiple') {
      const score = avaliarRespostaMultiplaEscolha(resposta, questao, questao.points);
      resultado = criarResultadoPontuacao(score, questao.points, [], false);
    } else if (questao.type === 'compact_choice_group') {
      resultado = avaliarRespostaGrupoCompacto(resposta, questao, questao.points);
    } else if (questao.type === 'excel_external') {
      if (!resposta || !resposta.uploaded || !resposta.validation) {
        resultado = criarResultadoPontuacao(
          0,
          questao.points,
          ['Arquivo não enviado ou inválido.'],
          true,
          [],
        );
      } else {
        resultado = {
          score: resposta.validation.score,
          max: resposta.validation.max,
          notes: resposta.validation.notes || [],
          pendingManual: !!resposta.validation.pendingManual,
          completedTasks: resposta.validation.completedTasks || [],
          taskDetails: resposta.validation.taskDetails || [],
        };
      }
    } else {
      resultado = criarResultadoPontuacao(
        0,
        questao.points,
        ['Tipo de questão não suportado.'],
      );
    }

    resultados.push(resultado);
    totalScore += resultado.score;
    totalMax += resultado.max;
  });

  const agrupado = {};

  questoes.forEach((questao, indice) => {
    const stageKey = questao.stageKey || 'geral';
    if (!agrupado[stageKey]) {
      const configEtapa = blueprint?.stages?.find((stage) => stage.key === stageKey);
      agrupado[stageKey] = {
        key: stageKey,
        label: ROTULOS_ETAPAS[stageKey] || questao.stage || 'Etapa',
        weight: configEtapa?.weight || 0,
        rawScore: 0,
        rawMax: 0,
        questionCount: 0,
        pendings: 0,
      };
    }

    agrupado[stageKey].rawScore += resultados[indice].score;
    agrupado[stageKey].rawMax += resultados[indice].max;
    agrupado[stageKey].questionCount += 1;
    if (resultados[indice].pendingManual) agrupado[stageKey].pendings += 1;
  });

  const resumoEtapas = Object.values(agrupado).map((etapa) => {
    const percent = etapa.rawMax ? etapa.rawScore / etapa.rawMax : 0;
    const weightedScore = percent * 10;
    const weightedContribution = weightedScore * (Number(etapa.weight || 0) / 100);

    return {
      ...etapa,
      percent,
      weightedScore,
      weightedContribution,
    };
  });

  const totalPesosEtapas = resumoEtapas.reduce(
    (soma, etapa) => soma + Number(etapa.weight || 0),
    0,
  );
  const notaFinalPonderada =
    resumoEtapas.length > 0
      ? totalPesosEtapas > 0
        ? resumoEtapas.reduce(
          (soma, etapa) =>
            soma + Number(etapa.weight || 0) * Number(etapa.weightedScore || 0),
          0,
        ) / totalPesosEtapas
        : resumoEtapas.reduce((soma, etapa) => {
          const scoreEtapa = etapa.rawMax ? (etapa.rawScore / etapa.rawMax) * 10 : 0;
          return soma + scoreEtapa;
        }, 0) / resumoEtapas.length
      : 0;

  const pendenciasManuais = questoes
    .map((questao, indice) => ({
      q: questao,
      idx: indice,
      result: resultados[indice],
      answer: respostas[indice],
      title: questao.title,
      notes: resultados[indice].notes || [],
      completedTasks: resultados[indice].completedTasks || [],
      taskDetails: resultados[indice].taskDetails || [],
      intelligentCorrection: resultados[indice].intelligentCorrection || null,
      answerKey:
        questao.type === 'excel_external'
          ? obterGabaritoDaTarefa(questao.taskId)
          : [],
    }))
    .filter((item) => item.result.pendingManual);

  return {
    resultados,
    totalScore,
    totalMax,
    resumoEtapas,
    notaFinalPonderada,
    pendenciasManuais,
  };
}

export function converterArrayBufferParaBase64(buffer) {
  if (!buffer) return '';

  let binario = '';
  const bytes = new Uint8Array(buffer);
  const tamanhoBloco = 0x8000;

  for (let indice = 0; indice < bytes.length; indice += tamanhoBloco) {
    const bloco = bytes.subarray(indice, indice + tamanhoBloco);
    binario += String.fromCharCode(...bloco);
  }

  return btoa(binario);
}

export function converterBase64ParaUint8Array(base64) {
  if (!base64) return null;
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);

  for (let indice = 0; indice < binario.length; indice += 1) {
    bytes[indice] = binario.charCodeAt(indice);
  }

  return bytes;
}

export function montarTextoCompletoDoGabarito({
  candidato,
  questoes,
  respostas,
  resultados,
  notaFinalPonderada,
  observacaoRh,
}) {
  const linhas = [
    `Candidato: ${candidato?.name || ''}`,
    `Perfil: ${candidato?.role || ''}`,
    `Nível: ${candidato?.level || ''}`,
    `Nota final: ${notaFinalPonderada?.toFixed ? notaFinalPonderada.toFixed(2) : '0.00'}`,
    `Data: ${new Date().toLocaleString('pt-BR')}`,
    `Observações do RH: ${(observacaoRh || '').trim() || 'Nenhuma observação registrada.'}`,
    '',
    '=== GABARITO COMPLETO ===',
  ];

  questoes.forEach((questao, indice) => {
    const resposta = respostas[indice];
    const resultado = resultados[indice];

    linhas.push(`Questão ${indice + 1}`);
    linhas.push(`Etapa: ${questao.stage}`);
    linhas.push(`Título: ${questao.title}`);
    linhas.push(`Enunciado: ${questao.description}`);
    linhas.push(`Gabarito / critério: ${obterTextoGabaritoQuestao(questao)}`);
    linhas.push(`Resposta do candidato: ${obterTextoRespostaCandidato(questao, resposta)}`);
    if (resultado) linhas.push(`Pontuação obtida: ${resultado.score}/${resultado.max}`);
    const detalhesCorrecao =
      resultado?.taskDetails ||
      resposta?.validation?.taskDetails ||
      [];
    if (questao.type === 'excel_external' && detalhesCorrecao.length) {
      linhas.push('Descrição da correção:');
      detalhesCorrecao.forEach((detalhe) => {
        linhas.push(`- ${formatarDetalheTarefa(detalhe)}`);
      });
    }
    linhas.push('');
  });

  return linhas.join('\n');
}

export function montarResumoHistoricoDaProva({
  questoes,
  respostas,
  totalScore,
  totalMax,
}) {
  const partes = [`Pontuação bruta: ${totalScore}/${totalMax}`];

  (Array.isArray(questoes) ? questoes : []).forEach((questao, indice) => {
    if (questao?.type !== 'excel_external') return;

    const resposta = Array.isArray(respostas) ? respostas[indice] : null;
    if (!resposta?.uploaded || !resposta?.validation) {
      partes.push(`${questao.stage || 'Excel'}: arquivo não enviado.`);
      return;
    }

    const resumo = resumirConclusaoChecklist(resposta.validation.completedTasks);
    partes.push(
      `${questao.stage || 'Excel'}: ${resumo.concluidas}/${resumo.total} tarefa(s) detectada(s) em ${resposta.filename || 'arquivo enviado'}.`,
    );

    if (resposta.validation.completedTasks?.length) {
      partes.push(
        resposta.validation.completedTasks.slice(0, 4).join(" ; "),
      );
    }
    if (resposta.validation.taskDetails?.length) {
      const detalhes = resposta.validation.taskDetails
        .slice(0, 4)
        .map((detalhe) => normalizarDetalheTarefa(detalhe).description)
        .filter(Boolean);
      if (detalhes.length) partes.push(detalhes.join(' ; '));
    }
  });

  return partes.join(' | ');
}

export function montarPayloadGabarito({
  idResultado,
  candidato,
  blueprint,
  resumoEtapas,
  totalScore,
  totalMax,
  notaFinalPonderada,
  observacaoRh,
  questoes,
  respostas,
  resultados,
  personalizacaoProva = null,
}) {
  const arquivosEnviados = questoes
    .map((questao, indice) => {
      const resposta = respostas[indice];
      if (
        questao.type !== 'excel_external' ||
        !resposta?.uploadedArrayBuffer ||
        !resposta?.filename
      ) {
        return null;
      }

      return {
        questionIndex: indice,
        taskId: questao.taskId || '',
        filename: resposta.filename,
        contentBase64: converterArrayBufferParaBase64(resposta.uploadedArrayBuffer),
      };
    })
    .filter(Boolean);
  const excelCorrectionDetails = questoes
    .map((questao, indice) => {
      if (questao.type !== 'excel_external') return null;
      const resposta = respostas[indice];
      const resultado = resultados[indice];
      return {
        questionIndex: indice,
        taskId: questao.taskId || '',
        filename: resposta?.filename || '',
        taskDetails:
          resultado?.taskDetails ||
          resposta?.validation?.taskDetails ||
          [],
      };
    })
    .filter(Boolean);

  return {
    id_teste: idResultado,
    candidate: candidato,
    blueprint,
    stageSummary: resumoEtapas,
    totalScore,
    totalMax,
    weightedFinalScore: notaFinalPonderada,
    rhObservation: observacaoRh || '',
    generatedAt: new Date().toISOString(),
    textContent: montarTextoCompletoDoGabarito({
      candidato,
      questoes,
      respostas,
      resultados,
      notaFinalPonderada,
      observacaoRh,
    }),
    uploadedFiles: arquivosEnviados,
    excelCorrectionDetails,
    personalization: personalizacaoProva,
  };
}

export async function baixarPacoteDaProva({
  candidato,
  questoes,
  respostas,
  resultados,
  notaFinalPonderada,
  observacaoRh,
}) {
  if (!window.JSZip) {
    throw new Error('A biblioteca JSZip não foi carregada.');
  }

  const nomeBase = sanitizarNomeArquivo(
    `${candidato?.name || 'candidato'}_${candidato?.role || 'prova'}`,
  );

  const zip = new window.JSZip();
  zip.file(
    `gabarito_${nomeBase}.txt`,
    montarTextoCompletoDoGabarito({
      candidato,
      questoes,
      respostas,
      resultados,
      notaFinalPonderada,
      observacaoRh,
    }),
  );

  for (let indice = 0; indice < questoes.length; indice += 1) {
    const questao = questoes[indice];
    const resposta = respostas[indice];

    if (
      questao.type === 'excel_external' &&
      resposta?.uploadedArrayBuffer &&
      resposta?.filename
    ) {
      zip.file(
        `excel_respondido_${sanitizarNomeArquivo(resposta.filename)}`,
        resposta.uploadedArrayBuffer,
      );
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  baixarBlob(`prova_${nomeBase}.zip`, blob);
}
