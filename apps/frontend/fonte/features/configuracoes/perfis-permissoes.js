import { html, useMemo, useState } from '../../infraestrutura-react.js';
import { Ic, Janela } from '../../ui/components/ds.js';

// Perfis e permissões no desenho do rebranding (DEC-073, v3.1): Perfil (lista em caixa branca)
// → Área (abas) → faixa "Acesso à seção" → Módulo (lista com ligadas/total) → Permissões
// (interruptores em 2 colunas). Tudo numa tela, sem rolar. Só apresentação e estado local:
// perfis, rascunho, edição, salvamento e regras continuam no pai (configuracoes/index.js).

const TELA_INICIAL = '__tela_inicial__';
// Na lista, sem o complemento entre parênteses: "Departamento Pessoal (DP)" → "Departamento Pessoal".
const nomeCurto = (nome) => String(nome || '').replace(/\s*\([^)]*\)\s*$/, '');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Áreas (abas) e os módulos do catálogo (rbac.py) que cada uma junta. Mesmo mapa da amostra aprovada.
const AREAS = [
  { id: 'geral', nome: 'Geral', modulos: ['Geral'], secoes: [] },
  { id: 'turnos', nome: 'Turnos', modulos: ['WFM'], secoes: ['wfm'] },
  { id: 'monitoria', nome: 'Monitoria', modulos: ['Monitoria'], secoes: ['monitoria'] },
  { id: 'equipes', nome: 'Equipes', modulos: ['Equipes'], secoes: ['equipe'] },
  { id: 'diario', nome: 'Diário de bordo', modulos: ['Diário de bordo'], secoes: ['diario'] },
  { id: 'relatorios', nome: 'Relatórios', modulos: ['Relatórios e Históricos', 'Relatórios'], secoes: ['relatorios'] },
  { id: 'recrutamento', nome: 'Recrutamento', modulos: ['Vagas', 'Processos', 'Candidatos', 'Entrevistas', 'Provas', 'Etapas e Trilhas', 'Fit Cultural', 'Documentos', 'Templates de Documentos', 'E-mails', 'Onboarding'], secoes: ['curriculos', 'processos', 'provas', 'gestao', 'treinamentos'] },
  { id: 'comunicacao', nome: 'Comunicação', modulos: ['Mural', 'Notificações', 'Calendário', 'Políticas', 'Central de Ajuda', 'OneDrive'], secoes: ['drive'] },
  { id: 'tecnologia', nome: 'Tecnologia', modulos: ['Usuários', 'Operações', 'Configurações', 'Chamados', 'Logs', 'LGPD'], secoes: ['configuracoes'] },
];

const ROTULO = {
  visualizar: 'Ver', criar: 'Criar', editar: 'Editar', excluir: 'Excluir', configurar: 'Configurar', exportar: 'Exportar', ativar: 'Ativar', desativar: 'Desativar',
  bloquear: 'Bloquear', desbloquear: 'Desbloquear', redefinir_senha: 'Redefinir senha', alterar_email: 'Alterar e-mail', alterar_perfil: 'Alterar perfil', ver_logs: 'Ver logs de acesso',
  feedback_aplicar: 'Aplicar feedback', plano_acao: 'Criar e revisar', plano_acao_visualizar: 'Ver', questoes_criar: 'Criar questão', questoes_editar: 'Editar questão', questoes_excluir: 'Excluir questão',
  configurar_criterios: 'Critérios de aprovação', configurar_pesos: 'Pesos', configurar_modelos: 'Configurar modelos', enviar_modelo: 'Enviar com modelo', enviar_livre: 'Enviar livre',
  dados_sensiveis: 'Dados sensíveis', editar_basico: 'Editar dados básicos', editar_admissional: 'Editar dados admissionais', aprovar_operacional: 'Aprovar etapa operacional', aprovar_final: 'Aprovar final',
  reverter_eliminacao: 'Reverter eliminação', alterar_nota: 'Alterar nota final', avaliar_curriculo: 'Avaliar currículo', baixar_curriculo: 'Baixar currículo', consultar_historico: 'Ver histórico', mover_etapa: 'Mover de etapa',
  marcar_presenca: 'Marcar presença', marcar_recebido: 'Marcar recebido', reenvio: 'Pedir reenvio', solicitar_abertura: 'Pedir abertura', editar_limitado: 'Editar (limitado)', registrar_solicitacao: 'Registrar pedido',
  exportar_dados: 'Exportar dados pessoais', concluir_proprio: 'Concluir o próprio', configurar_acesso: 'Quem cria treinamentos', gerenciar: 'Gerenciar', upload: 'Enviar arquivos', ver_operacao: 'Ver da operação',
  abrir: 'Abrir chamado', atender: 'Atender', atribuir: 'Atribuir', dashboard: 'Dashboard', relatorios: 'Relatórios', logs: 'Logs', matriz: 'Formulários (matriz)', equipes: 'Equipes e canais', usuarios: 'Usuários subordinados',
  contestar: 'Confirmar e contestar', reanalisar: 'Reanalisar contestação', seguranca: 'Aba Segurança', enviar: 'Enviar', corrigir: 'Corrigir', avaliar: 'Avaliar', cancelar: 'Cancelar', eliminar: 'Eliminar', anonimizar: 'Anonimizar',
  validar: 'Validar', recusar: 'Recusar', solicitar: 'Solicitar', pausar: 'Pausar', encerrar: 'Encerrar', aprovar: 'Aprovar',
};
const ROTULO_CHAVE = {
  'inicio.visualizar': 'Início', 'dashboard.visualizar': 'Dashboard inicial',
  'wfm.escala.propria': 'Ver a própria', 'wfm.escala.visualizar': 'Ver', 'wfm.escala.criar': 'Criar e configurar', 'wfm.escala.publicar_com_violacao': 'Publicar com violação', 'wfm.escala.fechar': 'Fechar o mês', 'wfm.escala.corrigir_fechada': 'Corrigir mês fechado',
  'wfm.tipos_escala.editar': 'Tipos de escala (TI)', 'wfm.presenca.lancar': 'Lançar presença e atestado', 'wfm.cadastros.visualizar': 'Ver cadastros', 'wfm.cadastros.editar': 'Editar turnos, skills e feriados', 'wfm.contratos.editar': 'Editar contratos',
  'wfm.relatorios': 'Relatórios', 'wfm.auditoria': 'Auditoria completa', 'wfm.troca.visualizar': 'Ver', 'wfm.troca.solicitar': 'Pedir e responder', 'wfm.troca.desfazer': 'Desfazer aprovada',
  'equipes.controle.visualizar': 'Ver a própria equipe', 'equipes.membros.editar': 'Adicionar e remover pessoas', 'equipes.mural.publicar': 'Publicar no Mural',
  'relhub.wfm.historico': 'Histórico de alterações', 'relhub.monitoria.historico': 'Histórico de monitorias', 'relhub.wfm.resumo': 'Resumo por operador', 'relhub.wfm.aprovacoes': 'Aprovações de escala', 'relhub.wfm.presencas': 'Presenças',
  'relhub.wfm.painel': 'Painel', 'relhub.wfm.escalas': 'Escalas', 'relhub.wfm.trocas': 'Trocas', 'relhub.monitoria.qualidade': 'Qualidade', 'relhub.monitoria.planos': 'Planos de ação', 'relhub.monitoria.dashboard': 'Dashboard',
  'relhub.monitoria.logs': 'Logs', 'relhub.rh.processos': 'Processos', 'relhub.rh.candidatos': 'Candidatos', 'relhub.rh.ranking': 'Ranking', 'relhub.rh.funil': 'Funil', 'relhub.rh.exames': 'Exames e provas', 'relhub.sistema.logs': 'Logs do sistema',
  'relatorios.visualizar': 'Ver (antigo)', 'relatorios.exportar': 'Exportar (antigo)', 'documentos_templates.visualizar': 'Ver e gerar', 'operacoes.editar': 'Cadastrar e inativar', 'etapas.configurar': 'Configurar etapas', 'trilhas.configurar': 'Configurar trilhas',
};

export function rotuloPermissao(chave, descricao = '') {
  if (ROTULO_CHAVE[chave]) return ROTULO_CHAVE[chave];
  if (chave.startsWith('sessao.')) return String(descricao).replace(/^Acessar a sess[aã]o /, '').replace(/\s*\(.*\)/, '').replace(/\.$/, '');
  const fim = chave.split('.').pop();
  return ROTULO[fim] || (fim.charAt(0).toUpperCase() + fim.slice(1).replace(/_/g, ' '));
}

// Módulo (linha da lista do meio) de cada permissão.
function moduloDe(chave, modulo) {
  const [a, b] = chave.split('.');
  if (modulo === 'Geral') return 'Início';
  if (a === 'wfm') return { escala: 'Escala', tipos_escala: 'Escala', presenca: 'Presença e cadastros', cadastros: 'Presença e cadastros', contratos: 'Presença e cadastros', troca: 'Trocas', relatorios: 'Relatórios e auditoria', auditoria: 'Relatórios e auditoria' }[b] || 'Outras';
  if (a === 'monitoria') return { visualizar: 'Monitorias', criar: 'Monitorias', feedback_aplicar: 'Monitorias', contestar: 'Monitorias', reanalisar: 'Monitorias', plano_acao: 'Planos de ação', plano_acao_visualizar: 'Planos de ação', dashboard: 'Análise', relatorios: 'Análise', exportar: 'Análise', logs: 'Análise' }[b] || 'Configuração';
  if (a === 'relhub') return { wfm: 'Turnos e Plantões', monitoria: 'Monitoria', rh: 'RH', sistema: 'Sistema' }[b] || 'Outros';
  if (a === 'relatorios') return 'Relatórios antigos';
  if (modulo === 'Templates de Documentos') return 'Templates';
  return modulo;
}

// Monta Área → Módulos → permissões a partir do catálogo real. Módulo novo no rbac.py
// (sem área no mapa) cai em Tecnologia, para nunca sumir da tela.
function montarEstrutura(permissoes) {
  const areas = AREAS.map((area) => ({ ...area, mods: new Map(), itens: [] }));
  const ultima = areas[areas.length - 1];
  permissoes.forEach((p) => {
    if (p.chave.startsWith('sessao.') || p.modulo === 'Sessões') return;
    const area = areas.find((a) => a.modulos.includes(p.modulo)) || ultima;
    const nome = moduloDe(p.chave, p.modulo);
    if (!area.mods.has(nome)) area.mods.set(nome, []);
    area.mods.get(nome).push(p);
    area.itens.push(p);
  });
  return areas.map((area) => ({ ...area, mods: [...area.mods].map(([nome, itens]) => ({ id: `${area.id}:${nome}`, nome, itens })) }));
}

export function PerfisPermissoes({
  perfis, permissoes, ordemModulos, nomesModulos,
  perfilId, aoSelecionarPerfil,
  draft, desbloqueado, podeEditar, aoDesbloquear, aoAlternar, aoGrupo,
  contagemUsuarios = {}, usuariosCarregados = false, aoVerUsuarios,
  pendentes, salvando, aoSalvar, aoRestaurar, justificativa, aoJustificativa,
  podeMover, aoMover, wfmFechado, telaInicial, avisos = null,
}) {
  const [areaId, setAreaId] = useState('turnos');
  const [modId, setModId] = useState('');
  const [busca, setBusca] = useState('');
  const [comparaCom, setComparaCom] = useState('');
  const [comparando, setComparando] = useState(false);
  const [mostrarDono, setMostrarDono] = useState(false);
  const [confirmar, setConfirmar] = useState(null);

  const perfil = perfis.find((p) => p.id === perfilId) || null;
  const ativas = useMemo(() => new Set(draft), [draft]);
  const originais = useMemo(() => new Set(perfil?.permissoes || []), [perfil?.id, (perfil?.permissoes || []).join('|')]);
  const outro = perfis.find((p) => p.id === comparaCom) || null;
  const doOutro = useMemo(() => new Set(outro?.permissoes || []), [outro?.id]);
  const estrutura = useMemo(() => montarEstrutura(permissoes), [permissoes]);
  const porChave = useMemo(() => new Map(permissoes.map((p) => [p.chave, p])), [permissoes]);
  const contar = (itens) => itens.filter((p) => ativas.has(p.chave)).length;
  const totalAtivas = permissoes.filter((p) => ativas.has(p.chave)).length;

  const ehTela = areaId === TELA_INICIAL;
  const area = estrutura.find((a) => a.id === areaId) || estrutura[0];
  const mod = area.mods.find((m) => m.id === modId) || area.mods[0] || null;
  const termo = norm(busca.trim());
  const resultados = termo
    ? permissoes.filter((p) => !p.chave.startsWith('sessao.') && norm(`${rotuloPermissao(p.chave, p.descricao)} ${p.descricao} ${p.chave}`).includes(termo))
    : [];

  const secoes = area.secoes.map((id) => porChave.get(`sessao.${id}.acessar`)).filter(Boolean);
  const secaoLigada = !secoes.length || secoes.some((p) => ativas.has(p.chave));

  const escolherArea = (id) => { setAreaId(id); setModId(''); setBusca(''); };
  const pedirLigarTodas = (itens) => {
    const criticas = itens.filter((p) => p.critica && !ativas.has(p.chave)).length;
    if (criticas) setConfirmar({ itens, criticas }); else aoGrupo(itens, true);
  };

  const item = (p, prefixo = '') => {
    const ligada = ativas.has(p.chave);
    const mudou = ligada !== originais.has(p.chave);
    const difere = outro && ligada !== doOutro.has(p.chave);
    return html`<label key=${p.chave} class=${`c-interruptor c-pv-item ${mudou ? 'c-mudou' : ''} ${difere ? 'c-pv-difere' : ''}`.trim()} title=${`${p.descricao || ''}${p.critica ? ' · Crítica' : ''} · ${p.chave}`}>
      <input type="checkbox" role="switch" checked=${ligada} disabled=${!desbloqueado || null} onChange=${() => aoAlternar(p.chave)} />
      <span>${prefixo}${rotuloPermissao(p.chave, p.descricao)}</span>
      ${p.critica ? html`<i class="c-pv-critica" aria-label="crítica"></i>` : null}
      ${difere ? html`<small class="c-pv-outro">${outro.nome}: ${doOutro.has(p.chave) ? 'ligada' : 'desligada'}</small>` : null}
      ${mostrarDono && podeMover && p.modulo_dono
        ? html`<select class="c-entrada c-entrada--compacta c-pv-dono" aria-label=${`Módulo de ${p.chave}`} value=${p.modulo_dono} onClick=${(e) => e.preventDefault()} onChange=${(e) => aoMover(p.chave, e.target.value)}>
            ${ordemModulos.map((m) => html`<option key=${m} value=${m}>${nomesModulos[m] || m}</option>`)}
          </select>`
        : null}
    </label>`;
  };

  const contagemPerfil = (id) => (usuariosCarregados ? html`<small>${contagemUsuarios[id] || 0}</small>` : null);
  const nUsuarios = contagemUsuarios[perfilId] || 0;

  return html`
    <main class="c-pagina c-conteudo c-perfis">
      <div class="c-rel">
        <nav class="c-rel-lista c-rel-lista--caixa" aria-label="Perfis">
          <h3>Perfis · ${perfis.length}</h3>
          ${perfis.map((p) => html`<a key=${p.id} href="#" aria-current=${p.id === perfilId ? 'page' : null} title=${p.nome} onClick=${(e) => { e.preventDefault(); aoSelecionarPerfil(p.id); }}>${nomeCurto(p.nome)}${contagemPerfil(p.id)}</a>`)}
        </nav>

        <div class="c-perfis-direita">
          ${avisos}
          <div class="c-cab-linha">
            <h1 title=${perfil?.nome || ''}>${nomeCurto(perfil?.nome) || 'Perfil'}</h1>
            <span class="c-secundario c-perfis-resumo">
              ${usuariosCarregados
                ? html`<a href="#" onClick=${(e) => { e.preventDefault(); if (nUsuarios) aoVerUsuarios(); }}>${nUsuarios} ${nUsuarios === 1 ? 'usuário' : 'usuários'}</a> · `
                : null}${totalAtivas} de ${permissoes.length} permissões
            </span>
            <div class="c-cab-dir">
              <div class="c-com-icone c-com-icone--compacta c-busca c-perfis-busca">
                <${Ic} nome="magnifying-glass" />
                <input class="c-entrada c-entrada--compacta" type="search" placeholder="Buscar permissão" aria-label="Buscar permissão" value=${busca} onInput=${(e) => setBusca(e.target.value)} />
              </div>
              ${comparando
                ? html`<select class="c-entrada c-entrada--compacta c-perfis-compara" aria-label="Comparar com" value=${comparaCom} onChange=${(e) => setComparaCom(e.target.value)}>
                    <option value="">Comparar com…</option>
                    ${perfis.filter((p) => p.id !== perfilId).map((p) => html`<option key=${p.id} value=${p.id}>${p.nome}</option>`)}
                  </select>
                  <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Parar de comparar" title="Parar de comparar" onClick=${() => { setComparando(false); setComparaCom(''); }}><${Ic} nome="x" /></button>`
                : perfis.length > 1
                  ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => setComparando(true)}><${Ic} nome="arrows-left-right" />Comparar</button>`
                  : null}
              ${podeEditar && !desbloqueado
                ? html`<button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${aoDesbloquear}><${Ic} nome="pencil-simple" />Editar</button>`
                : null}
            </div>
          </div>

          <div class=${`c-tabela-caixa ${!ehTela && !secaoLigada && !termo ? 'c-pv--off' : ''}`.trim()}>
            <div class="c-abas c-pv-abas" role="tablist" aria-label="Áreas">
              ${estrutura.map((a) => html`<button key=${a.id} type="button" class="c-aba" role="tab" aria-selected=${!termo && a.id === areaId ? 'true' : 'false'} title=${`${contar(a.itens)} de ${a.itens.length} ligadas`} onClick=${() => escolherArea(a.id)}>${a.nome}</button>`)}
              ${telaInicial ? html`<button type="button" class="c-aba" role="tab" aria-selected=${!termo && ehTela ? 'true' : 'false'} onClick=${() => escolherArea(TELA_INICIAL)}>Tela inicial</button>` : null}
            </div>

            ${termo
              ? html`
                  <div class="c-pv-faixa"><span class="c-secundario">${resultados.length} ${resultados.length === 1 ? 'permissão encontrada' : 'permissões encontradas'} para "${busca.trim()}"</span>
                    <button type="button" class="c-botao c-botao--texto c-botao--compacto c-pv-limpar" onClick=${() => setBusca('')}>Limpar busca</button></div>
                  <div class="c-pv-painel ${desbloqueado ? 'c-pv--editando' : ''}">
                    ${resultados.length
                      ? html`<div class="c-pv-grade">${resultados.map((p) => {
                          const a = estrutura.find((ar) => ar.itens.includes(p));
                          const m = a?.mods.find((mm) => mm.itens.includes(p));
                          return item(p, `${m?.nome || ''} › `);
                        })}</div>`
                      : html`<p class="c-secundario">Nenhuma permissão com esse nome.</p>`}
                  </div>`
              : ehTela
                ? html`<div class="c-pv-painel c-perfis-tela">${telaInicial}</div>`
                : html`
                    <div class=${`c-pv-faixa ${secaoLigada ? '' : 'c-pv-faixa--off'}`.trim()}>
                      ${secoes.length
                        ? html`${secoes.length > 1 ? html`<b>Seções:</b>` : null}
                            ${secoes.map((p) => html`<label key=${p.chave} class=${`c-interruptor c-pv-sec ${ativas.has(p.chave) !== originais.has(p.chave) ? 'c-mudou' : ''}`.trim()} title=${`${p.descricao} · ${p.chave}`}>
                              <input type="checkbox" role="switch" checked=${ativas.has(p.chave)} disabled=${!desbloqueado || null} onChange=${() => aoAlternar(p.chave)} />
                              <span>${secoes.length > 1 ? rotuloPermissao(p.chave, p.descricao) : `Acesso à seção ${rotuloPermissao(p.chave, p.descricao)}`}</span>
                            </label>`)}`
                        : html`<span class="c-secundario">Sempre visível para todos os perfis</span>`}
                      ${area.id === 'turnos' && wfmFechado ? html`<span class="c-pv-aviso">Fechado para ${perfil?.nome} na fase de teste: libera em Tecnologia › Módulos.</span>` : null}
                      <span class="c-pv-off">Desligada: ninguém deste perfil vê a seção. As permissões abaixo ficam guardadas.</span>
                    </div>
                    <div class=${`c-pv ${desbloqueado ? 'c-pv--editando' : ''}`.trim()}>
                      <nav class="c-pv-mods" aria-label="Módulos">
                        ${area.mods.map((m) => html`<a key=${m.id} href="#" aria-current=${m.id === mod?.id ? 'page' : null} onClick=${(e) => { e.preventDefault(); setModId(m.id); }}>${m.nome}<small>${contar(m.itens)}/${m.itens.length}</small></a>`)}
                      </nav>
                      ${mod
                        ? html`<div class="c-pv-painel">
                            <div class="c-pv-cab">
                              <b>${mod.nome}</b>
                              <span class="c-secundario">${contar(mod.itens)} de ${mod.itens.length} ligadas</span>
                              <span class="c-pv-todas">
                                ${podeMover ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" aria-pressed=${mostrarDono ? 'true' : 'false'} onClick=${() => setMostrarDono((v) => !v)}>Módulo dono</button>` : null}
                                <button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => pedirLigarTodas(mod.itens)}>Ligar todas</button>
                                <button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => aoGrupo(mod.itens, false)}>Desligar todas</button>
                              </span>
                            </div>
                            <div class="c-pv-grade">${mod.itens.map((p) => item(p))}</div>
                          </div>`
                        : html`<div class="c-pv-painel"><p class="c-secundario">Nenhuma permissão nesta área.</p></div>`}
                    </div>
                  `}
          </div>
          ${desbloqueado
            ? html`<div class="c-perfis-edicao" role="region" aria-label="Edição do perfil">
                <span class=${pendentes ? 'c-forte' : 'c-secundario'}>${pendentes ? `${pendentes} ${pendentes === 1 ? 'alteração' : 'alterações'} sem salvar` : 'Editando. Nada mudou ainda.'}</span>
                ${pendentes ? html`<input class="c-entrada c-entrada--compacta c-perfis-motivo" placeholder="Motivo (opcional)" aria-label="Motivo da alteração" value=${justificativa} onInput=${(e) => aoJustificativa(e.target.value)} />` : null}
                <span class="c-perfis-edicao-acoes">
                  <button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${salvando || null} onClick=${() => { if (pendentes) aoRestaurar(); aoDesbloquear(); setMostrarDono(false); }}>${pendentes ? 'Descartar' : 'Sair da edição'}</button>
                  <button type="button" class="c-botao c-botao--principal c-botao--compacto" aria-busy=${salvando ? 'true' : null} disabled=${salvando || !pendentes || !podeEditar || null} onClick=${aoSalvar}>${salvando ? 'Salvando…' : 'Salvar'}</button>
                </span>
              </div>`
            : null}
          <p class="c-legenda c-perfis-legenda"><span><i class="c-pv-critica" aria-hidden="true"></i>Crítica</span><span>Passe o mouse numa permissão para ver o que ela faz.</span></p>
        </div>
      </div>

      ${confirmar
        ? html`<${Janela} titulo="Ligar permissões críticas?" tamanho="pequena" onClose=${() => setConfirmar(null)}
            rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => setConfirmar(null)}>Cancelar</button>
              <button type="button" class="c-botao c-botao--principal" onClick=${() => { aoGrupo(confirmar.itens, true); setConfirmar(null); }}>Ligar todas</button>`}>
            <div class="c-janela-corpo"><p>${confirmar.criticas} ${confirmar.criticas === 1 ? 'permissão crítica vai' : 'permissões críticas vão'} ser ligadas para ${perfil?.nome}. Só vale depois de Salvar.</p></div>
          <//>`
        : null}
    </main>`;
}
