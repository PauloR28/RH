import { html, useEffect, useMemo, useState } from '../../../infraestrutura-react.js';
import { duplicarEscalaWfm, excluirEscalaWfm, lerConfigEscalaWfm, salvarConfigEscalaWfm } from '../../../services/api/wfm.js?v=20261104-leitura';
import { Campo, Esqueleto, Ic, Janela } from '../../../ui/components/ds.js?v=20261106-wfm';

// Configurações da escala (redesign Fase 15, amostra Q4 do lote 1): janela de 560 px com Nome · Jornada · Escala ativa ·
// Escalas por pessoa · Antecedência para pedir troca; "Quem aprova" em fichas com × e a linha Perfil + Usuário + Adicionar;
// rodapé Excluir (vermelho, à esquerda, com confirmação forte) · Duplicar · Salvar. Sem nenhum aprovador vale o padrão:
// Supervisor ou Gestor. Quem decide é sempre o servidor; mesmas rotas de antes.

const ROTULO_PERFIL = { supervisor: 'Supervisor', gestor: 'Gestor', analista_ti: 'Analista de TI' };
const ROTULO_PLURAL = { supervisor: 'Todos os Supervisores', gestor: 'Todos os Gestores', analista_ti: 'Analista de TI' };

const Erro = ({ texto }) => (texto ? html`<div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${texto}</p></div></div>` : null);

export function ModalConfigEscala({ operacao, nomePadrao, onClose, onSalvo, onMudouLista, showToast }) {
  const [cfg, setCfg] = useState(null);
  const [nome, setNome] = useState('');
  const [perfis, setPerfis] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [perfilSel, setPerfilSel] = useState('');
  const [usuarioSel, setUsuarioSel] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [ativa, setAtiva] = useState(true);
  const [idContrato, setIdContrato] = useState('');
  const [trocaDias, setTrocaDias] = useState('3');
  const [maxEscalas, setMaxEscalas] = useState('4');
  const [destino, setDestino] = useState('');
  const [nomeCopia, setNomeCopia] = useState('');
  const [janela, setJanela] = useState(''); // '' | 'duplicar' | 'excluir'
  const [confirmacao, setConfirmacao] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let ativo = true;
    lerConfigEscalaWfm(operacao).then((c) => {
      if (!ativo) return;
      setCfg(c); setNome(c.nome_escala || ''); setPerfis(c.aprovadores?.perfis || []); setUsuarios(c.aprovadores?.usuarios || []);
      setAtiva(c.ativa !== false); setIdContrato(c.id_contrato ? String(c.id_contrato) : ''); setTrocaDias(String(c.troca_antecedencia_dias ?? 3)); setMaxEscalas(String(c.max_escalas_operador ?? 4)); setDestino((c.operacoes_destino || [])[0]?.chave || '');
    }).catch((e) => ativo && setErro(e?.message || 'Não foi possível carregar as configurações.'));
    return () => { ativo = false; };
  }, [operacao]);

  const candidatos = cfg?.candidatos || [];
  const perfisDisponiveis = useMemo(() => [...new Set(candidatos.map((c) => c.perfil))].filter((p) => ROTULO_PERFIL[p]), [candidatos]);
  // Usuários do perfil escolhido; sem perfil, todos. Quem já foi adicionado sai da lista.
  const usuariosDoPerfil = candidatos.filter((c) => (!perfilSel || c.perfil === perfilSel) && !usuarios.includes(c.id_usuario));
  const nomeDe = (id) => candidatos.find((c) => c.id_usuario === id);
  const podeEditar = cfg?.pode_editar;
  const nomeEscala = (nome || nomePadrao || '').trim();

  const trocarPerfil = (valor) => {
    setPerfilSel(valor);
    const atual = candidatos.find((c) => String(c.id_usuario) === usuarioSel);
    if (atual && valor && atual.perfil !== valor) setUsuarioSel('');
  };
  const trocarUsuario = (valor) => {
    setUsuarioSel(valor);
    const u = candidatos.find((c) => String(c.id_usuario) === valor);
    if (u) setPerfilSel(u.perfil);
  };
  const adicionar = () => {
    if (usuarioSel) setUsuarios([...usuarios, Number(usuarioSel)]);
    else if (perfilSel && !perfis.includes(perfilSel)) setPerfis([...perfis, perfilSel]);
    else return;
    setPerfilSel(''); setUsuarioSel('');
  };
  const salvar = async (ev) => {
    ev.preventDefault();
    if (!podeEditar) { onClose(); return; }
    setErro('');
    setSalvando(true);
    try {
      await salvarConfigEscalaWfm({
        operacao, nome_escala: nome, perfis, usuarios,
        ...(trocaDias !== '' ? { troca_antecedencia_dias: Math.max(0, Math.min(30, Number(trocaDias))) } : {}),
        ...(maxEscalas !== '' ? { max_escalas_operador: Math.max(1, Math.min(7, Number(maxEscalas))) } : {}),
        ...(cfg.pode_gerir ? { ativa, alterar_jornada: true, id_contrato: idContrato ? Number(idContrato) : null } : {}),
      });
      showToast?.('Configurações da escala salvas.', 'success');
      onSalvo();
    } catch (e) { setErro(`Falha ao salvar as configurações: ${e?.message || 'motivo não informado pelo servidor.'}`); } finally { setSalvando(false); }
  };

  const duplicar = async () => {
    setErro('');
    setOcupado(true);
    try {
      const r = await duplicarEscalaWfm({ operacao, operacao_destino: destino, nome: nomeCopia.trim() });
      showToast?.(`Escala duplicada como "${r.nome}".`, 'success');
      onMudouLista?.(r.chave);
    } catch (e) { setErro(e?.message || 'Não foi possível duplicar a escala.'); setJanela(''); } finally { setOcupado(false); }
  };
  const excluir = async () => {
    setErro('');
    setOcupado(true);
    try {
      await excluirEscalaWfm(operacao);
      showToast?.('Escala excluída.', 'success');
      onMudouLista?.(null);
    } catch (e) { setErro(e?.message || 'Não foi possível excluir a escala.'); setJanela(''); } finally { setOcupado(false); }
  };

  const total = perfis.length + usuarios.length;
  const chip = (chave, texto, sub, aoRemover) => html`<span key=${chave} class="c-cfg-chip"><${Ic} nome=${sub ? 'user' : 'users'} />${texto}${sub ? html` <span class="c-secundario">· ${sub}</span>` : null}
    ${aoRemover ? html`<button type="button" aria-label=${`Remover ${texto}`} title=${`Remover ${texto}`} onClick=${aoRemover}><${Ic} nome="x" /></button>` : null}</span>`;

  return html`
    <${Janela} titulo="Configurações da escala" onClose=${() => { if (!janela) onClose(); }}>
      <form class="c-janela-form" noValidate onSubmit=${salvar}>
        <div class="c-janela-corpo">
          ${!cfg && !erro ? html`<${Esqueleto} linhas=${5} />` : null}
          ${cfg ? html`
            <div class="c-form" style=${{ '--colunas': 2 }}>
              <${Campo} rotulo="Nome" cheio=${true} ajuda="Aparece no título da tela e nos arquivos exportados.">
                <input class="c-entrada" maxlength="120" disabled=${!podeEditar} value=${nome} onInput=${(e) => setNome(e.target.value)} placeholder=${nomePadrao} />
              <//>
              ${cfg.pode_gerir ? html`<${Campo} rotulo="Jornada" ajuda="Para quem não tem jornada própria.">
                <select class="c-entrada" value=${idContrato} onChange=${(e) => setIdContrato(e.target.value)}>
                  <option value="">Nenhuma</option>
                  ${(cfg.contratos || []).map((c) => html`<option key=${c.id_contrato} value=${c.id_contrato}>${c.codigo} · ${c.nome}</option>`)}
                </select>
              <//>
              <div class="c-campo"><span class="c-rotulo">Situação</span>
                <label class="c-interruptor"><input type="checkbox" role="switch" checked=${ativa} onChange=${(e) => setAtiva(e.target.checked)} />Escala ativa</label>
                ${!ativa ? html`<span class="c-ajuda">Inativa: some das telas e não aceita alterações.</span>` : null}
              </div>` : null}
              <${Campo} rotulo="Escalas por pessoa" ajuda="Máximo; Escala Especial não conta. Padrão 4.">
                <input class="c-entrada" type="number" min="1" max="7" disabled=${!podeEditar} value=${maxEscalas} onInput=${(e) => setMaxEscalas(e.target.value)} />
              <//>
              <${Campo} rotulo="Antecedência para pedir troca (dias)" ajuda="Padrão 3.">
                <input class="c-entrada" type="number" min="0" max="30" disabled=${!podeEditar} value=${trocaDias} onInput=${(e) => setTrocaDias(e.target.value)} />
              <//>
            </div>

            <section aria-label="Quem aprova esta escala">
              <p class="c-rotulo" style=${{ margin: '0 0 var(--espaco-2)' }}>Quem aprova</p>
              <div class="c-cfg-aprov" aria-live="polite">
                ${total ? [
                  ...perfis.map((p) => chip(`p-${p}`, ROTULO_PLURAL[p] || p, '', podeEditar ? () => setPerfis(perfis.filter((x) => x !== p)) : null)),
                  ...usuarios.map((id) => { const c = nomeDe(id); return chip(`u-${id}`, c ? c.nome : `Usuário ${id}`, c ? (ROTULO_PERFIL[c.perfil] || c.perfil) : 'Usuário', podeEditar ? () => setUsuarios(usuarios.filter((x) => x !== id)) : null); }),
                ] : html`<span class="c-ajuda">Padrão: qualquer Supervisor ou Gestor. Ninguém aprova a escala que enviou.</span>`}
              </div>
              ${podeEditar ? html`<div class="c-grupo c-cfg-linha">
                <${Campo} rotulo="Perfil"><select class="c-entrada" value=${perfilSel} onChange=${(e) => trocarPerfil(e.target.value)}>
                  <option value="">Selecione</option>${perfisDisponiveis.map((p) => html`<option key=${p} value=${p}>${ROTULO_PERFIL[p]}</option>`)}</select><//>
                <${Campo} rotulo="Usuário"><select class="c-entrada" value=${usuarioSel} onChange=${(e) => trocarUsuario(e.target.value)}>
                  <option value="">${perfilSel ? `Todos (${ROTULO_PERFIL[perfilSel]})` : 'Selecione'}</option>
                  ${usuariosDoPerfil.map((c) => html`<option key=${c.id_usuario} value=${c.id_usuario}>${c.nome}${perfilSel ? '' : ` · ${ROTULO_PERFIL[c.perfil] || c.perfil}`}</option>`)}</select><//>
                <button type="button" class="c-botao c-botao--secundario" disabled=${!perfilSel && !usuarioSel || null} onClick=${adicionar}><${Ic} nome="plus" />Adicionar</button>
              </div>` : null}
            </section>` : null}
          <${Erro} texto=${erro} />
        </div>
        <div class="c-janela-rodape">
          ${cfg?.pode_gerir ? html`<button type="button" class="c-botao c-botao--texto c-tom-perigo" style=${{ marginRight: 'auto' }} onClick=${() => { setConfirmacao(''); setJanela('excluir'); }}><${Ic} nome="trash" />Excluir</button>` : null}
          ${cfg?.pode_gerir ? html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => setJanela('duplicar')}><${Ic} nome="copy" />Duplicar</button>` : null}
          ${podeEditar === false ? html`<button type="button" class="c-botao c-botao--secundario" onClick=${onClose}>Fechar</button>`
            : html`<button type="submit" class="c-botao c-botao--principal" aria-busy=${salvando ? 'true' : null} disabled=${salvando || !cfg || null}>${salvando ? 'Salvando…' : 'Salvar'}</button>`}
        </div>
      </form>
    <//>

    ${janela === 'duplicar' ? html`<${Janela} titulo="Duplicar escala" tamanho="pequena" onClose=${() => setJanela('')}
      rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => setJanela('')}>Cancelar</button>
        <button type="button" class="c-botao c-botao--principal" aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || !destino || null} onClick=${duplicar}>Duplicar</button>`}>
      <div class="c-janela-corpo">
        <p class="c-ajuda">Cria uma escala nova com o nome, a jornada, os turnos de trabalho e os aprovadores desta. Não copia colaboradores nem lançamentos.</p>
        <${Campo} rotulo="Para a operação"><select class="c-entrada" value=${destino} onChange=${(e) => setDestino(e.target.value)}>
          ${(cfg?.operacoes_destino || []).map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select><//>
        <${Campo} rotulo="Nome da cópia" opcional=${true}><input class="c-entrada" maxlength="120" value=${nomeCopia} onInput=${(e) => setNomeCopia(e.target.value)} /><//>
      </div>
    <//>` : null}

    ${janela === 'excluir' ? html`<${Janela} titulo="Excluir escala" tamanho="pequena" onClose=${() => setJanela('')}
      rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => setJanela('')}>Cancelar</button>
        <button type="button" class="c-botao c-botao--perigo" aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || confirmacao.trim().toLowerCase() !== nomeEscala.toLowerCase() || null} onClick=${excluir}>Excluir escala</button>`}>
      <div class="c-janela-corpo">
        <p>Escala sem lançamentos é apagada de vez. Com histórico (versões publicadas, presenças, trocas), ela sai das telas e o histórico é preservado.</p>
        <${Campo} rotulo=${`Para confirmar, digite o nome da escala: ${nomeEscala}`}><input class="c-entrada" autocomplete="off" value=${confirmacao} onInput=${(e) => setConfirmacao(e.target.value)} /><//>
      </div>
    <//>` : null}`;
}
