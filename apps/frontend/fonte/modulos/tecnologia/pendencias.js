// Regras PURAS (sem DOM nem React) da tela Módulos: alterações em rascunho, contagem de pendências e texto da confirmação.
// O rascunho só guarda o que DIFERE do estado salvo: devolver um interruptor ao valor original tira a mudança da contagem.
// Formato de cada item do rascunho: { chave, tipo: 'modulo'|'funcao'|'wfm_participantes', modulo, funcao, nome, nomeModulo, ativo }.

export const CHAVE_WFM_PARTICIPANTES = 'w';
export const chaveModulo = (modulo) => `m:${modulo}`;
export const chaveFuncao = (modulo, funcao) => `f:${modulo}:${funcao}`;

/** Valor que a tela mostra: o do rascunho, se houver, senão o salvo. */
export const valorExibido = (rascunho, chave, salvo) => (chave in rascunho ? rascunho[chave].ativo : salvo);

/** Clique em um interruptor: inverte o valor mostrado; se voltar ao salvo, a alteração some do rascunho. */
export function alternarRascunho(rascunho, item, salvo) {
  const novo = { ...rascunho };
  const proximo = !valorExibido(rascunho, item.chave, salvo);
  if (proximo === salvo) delete novo[item.chave];
  else novo[item.chave] = { ...item, ativo: proximo };
  return novo;
}

const ORDEM_TIPO = { modulo: 0, funcao: 1, wfm_participantes: 2 };
export const listarPendencias = (rascunho) => Object.values(rascunho).sort((a, b) => ORDEM_TIPO[a.tipo] - ORDEM_TIPO[b.tipo]);

/** Quantas alterações pendentes pertencem a um módulo (o WFM para participantes pertence a Operação). */
export function pendenciasDoModulo(rascunho, modulo) {
  return Object.values(rascunho).filter((p) => (p.tipo === 'wfm_participantes' ? modulo === 'operacao' : p.modulo === modulo)).length;
}

/** "N de M funções ligadas" de um módulo, já considerando o rascunho. Função de área desativada não entra na conta. */
export function contarLigadas(modulo, rascunho, wfm) {
  const disponiveis = modulo.funcoes.filter((f) => !f.indisponivel);
  let ligadas = disponiveis.filter((f) => valorExibido(rascunho, chaveFuncao(modulo.modulo, f.chave), f.ativo)).length;
  let total = disponiveis.length;
  if (modulo.modulo === 'operacao' && wfm) {
    total += 1;
    if (valorExibido(rascunho, CHAVE_WFM_PARTICIPANTES, Boolean(wfm.liberado))) ligadas += 1;
  }
  return { ligadas, total };
}

const VERBO = {
  modulo: (ativo) => (ativo ? 'ativar o módulo' : 'desativar o módulo'),
  funcao: (ativo, nome) => `${ativo ? 'ligar' : 'desligar'} ${nome}`,
  wfm_participantes: (ativo) => (ativo ? 'liberar Turnos e Plantões para participantes' : 'fechar Turnos e Plantões para participantes'),
};

/** Linhas da confirmação, agrupadas por módulo: [{ modulo, nomeModulo, texto: 'ligar Gestão, desligar Drive' }]. */
export function descreverLote(pendencias, nomesModulos) {
  const grupos = new Map();
  pendencias.forEach((p) => {
    const modulo = p.tipo === 'wfm_participantes' ? 'operacao' : p.modulo;
    if (!grupos.has(modulo)) grupos.set(modulo, []);
    grupos.get(modulo).push(VERBO[p.tipo](p.ativo, p.nome));
  });
  return [...grupos.entries()].map(([modulo, partes]) => ({ modulo, nomeModulo: nomesModulos[modulo] || modulo, texto: partes.join(', ') }));
}

/** Corpo do PUT /tecnologia/modulos/lote. */
export const paraPayloadLote = (pendencias) => pendencias.map((p) => ({
  tipo: p.tipo, modulo: p.tipo === 'wfm_participantes' ? '' : p.modulo, funcao: p.funcao || '', ativo: p.ativo,
}));

/** Consequências que a confirmação precisa explicar, sem repetir: uma frase por tipo de mudança presente. */
export function consequenciasDoLote(pendencias) {
  const frases = [];
  const tem = (fn) => pendencias.some(fn);
  if (tem((p) => p.tipo === 'modulo' && !p.ativo)) frases.push('Desativar um módulo desliga as telas e rotas dele para todos agora; quem só usa esse módulo perde o acesso. Os dados não são apagados.');
  if (tem((p) => p.tipo === 'modulo' && p.ativo)) frases.push('Ativar um módulo o devolve a quem tem permissão que o abre.');
  if (tem((p) => p.tipo === 'funcao' && !p.ativo)) frases.push('Desligar uma função só esconde o atalho naquele módulo: dados e permissões não mudam, e ela segue acessível pelos outros módulos onde estiver ligada.');
  if (tem((p) => p.tipo === 'funcao' && p.ativo)) frases.push('Ligar uma função mostra o atalho no menu do módulo para quem tem permissão para ela.');
  if (tem((p) => p.tipo === 'wfm_participantes')) frases.push('Mudar o WFM para participantes obriga Operador, Técnico de TI e Qualidade a entrar de novo no sistema.');
  frases.push('A mudança vale para todos os usuários e aparece para cada pessoa ao recarregar a página ou entrar de novo.');
  return frases;
}
