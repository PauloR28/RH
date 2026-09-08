import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import {
  buscarCandidatosTreinamento,
  baixarModeloModulo,
  criarTreinamentoWizard,
  uploadAnexoTreinamento,
  uploadSlideTreinamento,
  uploadVideoModulo,
  validarModuloJson,
  alternarDownloadAnexo,
} from '../../servico-api.js?v=20260906-central-treinamentos';
import { listarOperacoes } from '../../services/api/operations.js';
import { PageIntro, PainelRh, SectionCard } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';

const CATEGORIAS_TREINAMENTO = ['LGPD', 'Segurança da Informação', 'Tecnologia', 'Operações', 'Onboarding', 'Produto', 'Outro'];
const MODALIDADES_TREINAMENTO = [
  { value: '', label: 'Não definida' },
  { value: 'presencial', label: 'Presencial' },
  { value: 'virtual', label: 'Virtual' },
  { value: 'hibrido', label: 'Híbrido' },
];
const TIPOS_CONTEUDO = [
  { value: '', label: 'Somente texto/checklist' },
  { value: 'video', label: 'Vídeo' },
  { value: 'texto', label: 'Texto' },
  { value: 'slide', label: 'Slide' },
  { value: 'link', label: 'Link (ex.: intranet/SharePoint)' },
];

const TEXTO_ENCERRAMENTO_PADRAO =
  'Chegamos ao final deste treinamento. Agradecemos sua participação e atenção — o conteúdo ' +
  'apresentado é parte importante do seu desenvolvimento e do trabalho realizado no dia a dia. ' +
  'Em caso de dúvidas sobre o que foi tratado, procure seu supervisor ou o RH.';

const TERMO_LGPD_ANEXO =
  'Ao liberar este documento para download pelos alunos do treinamento, declaro que: (1) o arquivo ' +
  'não contém dados sensíveis, pessoais ou confidenciais da empresa em desacordo com a LGPD; ' +
  '(2) sou responsável pelo conteúdo publicado; (3) esta ação será registrada, com meu usuário e o ' +
  'horário, para fins de auditoria.';

const OCORRENCIA_INICIAL = { data_prevista: '', sem_horario_definido: false, local: '', ministrante: '' };
const MODULO_INICIAL = {
  titulo: '',
  subtitulo: '',
  descricao: '',
  texto_principal: '',
  obrigatorio: true,
  tipo_conteudo: '',
  conteudo_url: '',
  dica_texto: '',
  tabela: null,
  saiba_mais: [],
  _videoFile: null,
};

const FORM_INICIAL = {
  nome: '',
  descricao: '',
  categoria: 'Onboarding',
  id_operacao: '',
  modalidade: '',
  local_padrao: '',
  tipo_obrigatorio: false,
  ocorrencias: [{ ...OCORRENCIA_INICIAL }],
  participantes: [],
  itens: [{ ...MODULO_INICIAL }],
  pptxFile: null,
  saibaMaisTreinamento: { texto_breve: '', links: [] },
  anexosTreinamento: [],
  texto_encerramento: TEXTO_ENCERRAMENTO_PADRAO,
};

const ETAPAS = [
  ['1', 'Dados do Treinamento'],
  ['2', 'Módulos'],
  ['3', 'Slide de Apresentação'],
  ['4', 'Saiba +'],
  ['5', 'Encerramento'],
  ['6', 'Revisão e Publicação'],
];

function gerarId() {
  return Math.random().toString(36).slice(2);
}

export function TelaCriarTreinamento({ controlador }) {
  const [etapaAtual, setEtapaAtual] = useState(1);
  const [formulario, setFormulario] = useState(FORM_INICIAL);
  const [operacoes, setOperacoes] = useState([]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [progressoPublicacao, setProgressoPublicacao] = useState('');

  const [buscaParticipante, setBuscaParticipante] = useState('');
  const [resultadosBusca, setResultadosBusca] = useState([]);
  const [buscandoParticipantes, setBuscandoParticipantes] = useState(false);

  const [modalTermoAberto, setModalTermoAberto] = useState(null); // { tipo: 'treinamento'|'modulo', index }

  useEffect(() => {
    listarOperacoes()
      .then((dados) => setOperacoes(Array.isArray(dados) ? dados : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!buscaParticipante.trim()) {
      setResultadosBusca([]);
      return undefined;
    }
    setBuscandoParticipantes(true);
    const timer = setTimeout(() => {
      buscarCandidatosTreinamento(buscaParticipante.trim())
        .then((dados) => setResultadosBusca(Array.isArray(dados) ? dados : []))
        .catch(() => setResultadosBusca([]))
        .finally(() => setBuscandoParticipantes(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [buscaParticipante]);

  const atualizarCampo = (campo, valor) => setFormulario((atual) => ({ ...atual, [campo]: valor }));

  // -- Etapa 1: ocorrências e participantes -------------------------------

  const atualizarOcorrencia = (index, campo, valor) => {
    setFormulario((atual) => ({
      ...atual,
      ocorrencias: atual.ocorrencias.map((item, idx) => (idx === index ? { ...item, [campo]: valor } : item)),
    }));
  };

  const adicionarOcorrencia = () => {
    setFormulario((atual) => ({ ...atual, ocorrencias: [...atual.ocorrencias, { ...OCORRENCIA_INICIAL }] }));
  };

  const removerOcorrencia = (index) => {
    setFormulario((atual) => ({
      ...atual,
      ocorrencias: atual.ocorrencias.length > 1 ? atual.ocorrencias.filter((_, idx) => idx !== index) : atual.ocorrencias,
    }));
  };

  const adicionarParticipante = (candidato) => {
    setFormulario((atual) =>
      atual.participantes.some((item) => item.id_registro === candidato.id_registro)
        ? atual
        : { ...atual, participantes: [...atual.participantes, candidato] },
    );
    setBuscaParticipante('');
    setResultadosBusca([]);
  };

  const removerParticipante = (idRegistro) => {
    setFormulario((atual) => ({
      ...atual,
      participantes: atual.participantes.filter((item) => item.id_registro !== idRegistro),
    }));
  };

  // -- Etapa 2: módulos -----------------------------------------------------

  const atualizarModulo = (index, campo, valor) => {
    setFormulario((atual) => ({
      ...atual,
      itens: atual.itens.map((item, idx) => (idx === index ? { ...item, [campo]: valor } : item)),
    }));
  };

  const adicionarModulo = () => {
    setFormulario((atual) => ({ ...atual, itens: [...atual.itens, { ...MODULO_INICIAL }] }));
  };

  const removerModulo = (index) => {
    setFormulario((atual) => ({ ...atual, itens: atual.itens.filter((_, idx) => idx !== index) }));
  };

  const moverModulo = (index, direcao) => {
    setFormulario((atual) => {
      const novoIndex = index + direcao;
      if (novoIndex < 0 || novoIndex >= atual.itens.length) return atual;
      const itens = [...atual.itens];
      const [item] = itens.splice(index, 1);
      itens.splice(novoIndex, 0, item);
      return { ...atual, itens };
    });
  };

  const handleUploadJsonModulo = async (event) => {
    const arquivo = event.target.files?.[0];
    event.target.value = '';
    if (!arquivo) return;
    setErro('');
    try {
      const texto = await arquivo.text();
      const modulo = JSON.parse(texto);
      const validado = await validarModuloJson(modulo);
      setFormulario((atual) => ({
        ...atual,
        itens: [
          ...atual.itens,
          {
            ...MODULO_INICIAL,
            ...validado.modulo,
            tabela: validado.modulo.tabela || null,
            saiba_mais: validado.modulo.saiba_mais || [],
          },
        ],
      }));
    } catch (error) {
      setErro(
        error?.message ||
          'O arquivo JSON enviado não é válido ou não bate com o schema esperado (ver "Baixar modelo JSON").',
      );
    }
  };

  const handleBaixarModeloJson = async () => {
    try {
      const { blob } = await baixarModeloModulo();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'modelo-modulo-treinamento.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setErro(error?.message || 'Não foi possível baixar o modelo JSON.');
    }
  };

  // -- Etapa 4: Saiba + (documentos, texto, links) --------------------------

  const atualizarSaibaMaisTreinamento = (campo, valor) => {
    setFormulario((atual) => ({ ...atual, saibaMaisTreinamento: { ...atual.saibaMaisTreinamento, [campo]: valor } }));
  };

  const adicionarLinkSaibaMais = () => {
    setFormulario((atual) => ({
      ...atual,
      saibaMaisTreinamento: {
        ...atual.saibaMaisTreinamento,
        links: [...atual.saibaMaisTreinamento.links, { titulo: '', url: '' }],
      },
    }));
  };

  const atualizarLinkSaibaMais = (index, campo, valor) => {
    setFormulario((atual) => ({
      ...atual,
      saibaMaisTreinamento: {
        ...atual.saibaMaisTreinamento,
        links: atual.saibaMaisTreinamento.links.map((item, idx) => (idx === index ? { ...item, [campo]: valor } : item)),
      },
    }));
  };

  const removerLinkSaibaMais = (index) => {
    setFormulario((atual) => ({
      ...atual,
      saibaMaisTreinamento: {
        ...atual.saibaMaisTreinamento,
        links: atual.saibaMaisTreinamento.links.filter((_, idx) => idx !== index),
      },
    }));
  };

  const adicionarAnexo = (arquivo) => {
    if (!arquivo) return;
    setFormulario((atual) => ({
      ...atual,
      anexosTreinamento: [...atual.anexosTreinamento, { id: gerarId(), file: arquivo, permite_download: false }],
    }));
  };

  const removerAnexo = (id) => {
    setFormulario((atual) => ({ ...atual, anexosTreinamento: atual.anexosTreinamento.filter((item) => item.id !== id) }));
  };

  const confirmarAceiteTermo = () => {
    if (!modalTermoAberto) return;
    setFormulario((atual) => ({
      ...atual,
      anexosTreinamento: atual.anexosTreinamento.map((item) =>
        item.id === modalTermoAberto.id ? { ...item, permite_download: true } : item,
      ),
    }));
    setModalTermoAberto(null);
  };

  const alternarPermiteDownloadAnexo = (item) => {
    if (item.permite_download) {
      setFormulario((atual) => ({
        ...atual,
        anexosTreinamento: atual.anexosTreinamento.map((anexo) =>
          anexo.id === item.id ? { ...anexo, permite_download: false } : anexo,
        ),
      }));
      return;
    }
    setModalTermoAberto(item);
  };

  // -- Validação por etapa ---------------------------------------------------

  const validarEtapa = (etapa) => {
    if (etapa === 1) {
      if (!formulario.nome.trim()) return 'Informe o nome do treinamento.';
      const semData = formulario.ocorrencias.some((item) => !item.data_prevista && !item.sem_horario_definido);
      if (semData) return 'Informe a data/horário de todas as ocorrências, ou marque "sem horário definido".';
      return '';
    }
    if (etapa === 2) {
      const semTitulo = formulario.itens.some((item) => !item.titulo.trim());
      if (semTitulo) return 'Informe o título de todos os módulos.';
      return '';
    }
    return '';
  };

  const avancar = () => {
    const mensagem = validarEtapa(etapaAtual);
    if (mensagem) {
      setErro(mensagem);
      return;
    }
    setErro('');
    setEtapaAtual((atual) => Math.min(6, atual + 1));
  };

  const voltar = () => {
    setErro('');
    setEtapaAtual((atual) => Math.max(1, atual - 1));
  };

  // -- Publicação -------------------------------------------------------------

  const publicar = async () => {
    setSalvando(true);
    setErro('');
    try {
      setProgressoPublicacao('Criando treinamento...');
      const payload = {
        nome: formulario.nome.trim(),
        descricao: formulario.descricao.trim(),
        ativo: true,
        categoria: formulario.categoria,
        id_operacao: formulario.id_operacao ? Number(formulario.id_operacao) : null,
        modalidade: formulario.modalidade,
        local_padrao: formulario.local_padrao.trim(),
        tipo_obrigatorio: !!formulario.tipo_obrigatorio,
        texto_encerramento: formulario.texto_encerramento.trim(),
        saiba_mais_treinamento: {
          texto_breve: formulario.saibaMaisTreinamento.texto_breve.trim(),
          links: formulario.saibaMaisTreinamento.links.filter((item) => item.titulo.trim() || item.url.trim()),
        },
        itens: formulario.itens.map((item, index) => ({
          titulo: item.titulo.trim(),
          descricao: (item.descricao || '').trim(),
          ordem: index,
          obrigatorio: !!item.obrigatorio,
          tipo_conteudo: item.tipo_conteudo || '',
          conteudo_url: (item.conteudo_url || '').trim(),
          subtitulo: (item.subtitulo || '').trim(),
          texto_principal: (item.texto_principal || '').trim(),
          dica_texto: (item.dica_texto || '').trim(),
          tabela: item.tabela,
          saiba_mais: item.saiba_mais || [],
        })),
        ocorrencias: formulario.ocorrencias.map((item) => ({
          data_prevista: item.sem_horario_definido ? null : new Date(item.data_prevista).toISOString(),
          sem_horario_definido: !!item.sem_horario_definido,
          local: item.local.trim(),
          ministrante: item.ministrante.trim(),
        })),
        participantes: formulario.participantes.map((item) => item.id_registro),
      };

      const resultado = await criarTreinamentoWizard(payload);
      const idTrilha = resultado.trilha.id_trilha;
      const itensCriados = resultado.trilha.itens || [];

      if (formulario.pptxFile) {
        setProgressoPublicacao('Enviando slide de apresentação...');
        await uploadSlideTreinamento(idTrilha, formulario.pptxFile);
      }

      for (let index = 0; index < formulario.itens.length; index += 1) {
        const moduloLocal = formulario.itens[index];
        const moduloCriado = itensCriados[index];
        if (moduloLocal._videoFile && moduloCriado?.id_item) {
          setProgressoPublicacao(`Enviando vídeo do módulo "${moduloLocal.titulo}"...`);
          await uploadVideoModulo(moduloCriado.id_item, moduloLocal._videoFile);
        }
      }

      for (const anexo of formulario.anexosTreinamento) {
        setProgressoPublicacao(`Enviando anexo "${anexo.file.name}"...`);
        const resultadoAnexo = await uploadAnexoTreinamento(idTrilha, anexo.file, 0);
        if (anexo.permite_download && resultadoAnexo?.id_anexo) {
          await alternarDownloadAnexo(resultadoAnexo.id_anexo, { permite_download: true, termo_aceito: true });
        }
      }

      controlador.irParaTelaProtegida('screen-training-trilhas');
    } catch (error) {
      setErro(error?.message || 'Não foi possível publicar o treinamento.');
    } finally {
      setSalvando(false);
      setProgressoPublicacao('');
    }
  };

  const nomeOperacao = useMemo(
    () => operacoes.find((operacao) => String(operacao.id_item) === String(formulario.id_operacao))?.nome || 'Todas',
    [operacoes, formulario.id_operacao],
  );

  // -- Renderização das etapas -------------------------------------------------

  const renderEtapa1 = () => html`
    <section class="process-create-card">
      <div class="process-create-section-title">
        <span class="material-symbols-outlined">${IconeSvg('school')}</span>
        <h2>Dados do Treinamento</h2>
      </div>
      <div class="process-create-form-grid">
        <label class="process-create-field is-wide">
          <span>Nome do treinamento</span>
          <input value=${formulario.nome} onInput=${(event) => atualizarCampo('nome', event.target.value)} placeholder="Ex.: LGPD para novos colaboradores" />
        </label>
        <label class="process-create-field">
          <span>Categoria</span>
          <select value=${formulario.categoria} onChange=${(event) => atualizarCampo('categoria', event.target.value)}>
            ${CATEGORIAS_TREINAMENTO.map((categoria) => html`<option key=${categoria} value=${categoria}>${categoria}</option>`)}
          </select>
        </label>
        <label class="process-create-field">
          <span>Operação (opcional)</span>
          <select value=${formulario.id_operacao} onChange=${(event) => atualizarCampo('id_operacao', event.target.value)}>
            <option value="">Todas as operações</option>
            ${operacoes.map((operacao) => html`<option key=${operacao.id_item} value=${operacao.id_item}>${operacao.nome}</option>`)}
          </select>
        </label>
        <label class="process-create-field">
          <span>Modalidade</span>
          <select value=${formulario.modalidade} onChange=${(event) => atualizarCampo('modalidade', event.target.value)}>
            ${MODALIDADES_TREINAMENTO.map((opcao) => html`<option key=${opcao.value} value=${opcao.value}>${opcao.label}</option>`)}
          </select>
        </label>
        <label class="process-create-field">
          <span>Local padrão (opcional)</span>
          <input value=${formulario.local_padrao} onInput=${(event) => atualizarCampo('local_padrao', event.target.value)} placeholder="Sala 2, ou link da sala virtual" />
        </label>
        <label class="process-create-field is-wide">
          <span>Descrição / objetivo do treinamento</span>
          <textarea rows="2" value=${formulario.descricao} onInput=${(event) => atualizarCampo('descricao', event.target.value)}></textarea>
        </label>
      </div>

      <label class="d-flex align-items-center gap-2 mt-2">
        <input type="checkbox" checked=${formulario.tipo_obrigatorio} onChange=${(event) => atualizarCampo('tipo_obrigatorio', !!event.target.checked)} />
        <span>Treinamento obrigatório</span>
      </label>
    </section>

    <section class="process-create-card mt-3">
      <div class="process-create-section-title">
        <span class="material-symbols-outlined">${IconeSvg('event')}</span>
        <h2>Data(s) programada(s)</h2>
      </div>
      <p class="text-muted small">Cadastre uma ou mais ocorrências (recorrência simples — ex.: mesma turma em dias diferentes).</p>
      ${formulario.ocorrencias.map(
        (ocorrencia, index) => html`
          <div key=${index} class="rh-section-card rh-section-card--flat" style=${{ padding: '12px', marginBottom: '8px' }}>
            <div class="row g-2 align-items-end">
              <div class="col-md-3">
                <label class="process-create-field mb-0">
                  <span>Data e horário</span>
                  <input
                    type="datetime-local"
                    disabled=${ocorrencia.sem_horario_definido}
                    value=${ocorrencia.data_prevista}
                    onInput=${(event) => atualizarOcorrencia(index, 'data_prevista', event.target.value)}
                  />
                </label>
              </div>
              <div class="col-md-3">
                <label class="process-create-field mb-0">
                  <span>Local</span>
                  <input value=${ocorrencia.local} onInput=${(event) => atualizarOcorrencia(index, 'local', event.target.value)} />
                </label>
              </div>
              <div class="col-md-3">
                <label class="process-create-field mb-0">
                  <span>Responsável por aplicar</span>
                  <input value=${ocorrencia.ministrante} onInput=${(event) => atualizarOcorrencia(index, 'ministrante', event.target.value)} placeholder="Nome do supervisor/gestor" />
                </label>
              </div>
              <div class="col-md-2">
                <label class="d-flex align-items-center gap-1 mb-2">
                  <input
                    type="checkbox"
                    checked=${ocorrencia.sem_horario_definido}
                    onChange=${(event) => atualizarOcorrencia(index, 'sem_horario_definido', !!event.target.checked)}
                  />
                  <span class="small">Sem horário definido</span>
                </label>
              </div>
              <div class="col-md-1">
                <button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => removerOcorrencia(index)} disabled=${formulario.ocorrencias.length <= 1}>
                  <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                </button>
              </div>
            </div>
          </div>
        `,
      )}
      <button type="button" class="btn btn-outline-primary btn-sm" onClick=${adicionarOcorrencia}>
        <span class="material-symbols-outlined">${IconeSvg('add')}</span>
        Adicionar outra ocorrência
      </button>
    </section>

    <section class="process-create-card mt-3">
      <div class="process-create-section-title">
        <span class="material-symbols-outlined">${IconeSvg('groups')}</span>
        <h2>Participantes esperados (opcional)</h2>
      </div>
      <p class="text-muted small">
        Busque pelo nome do colaborador (candidato já registrado no Conecta). Ajuste manualmente a lista conforme necessário —
        o treinamento pode ser cadastrado sem participantes e reaproveitado em processos seletivos futuros.
      </p>
      <div class="rh-filter-field position-relative">
        <input
          class="form-control"
          placeholder="Buscar participante por nome..."
          value=${buscaParticipante}
          onInput=${(event) => setBuscaParticipante(event.target.value)}
        />
        ${buscaParticipante.trim()
          ? html`
              <div class="rh-section-card rh-section-card--flat mt-1" style=${{ maxHeight: '200px', overflowY: 'auto' }}>
                ${buscandoParticipantes
                  ? html`<div class="p-2 text-muted small">Buscando...</div>`
                  : resultadosBusca.length
                    ? resultadosBusca.map(
                        (candidato) => html`
                          <button
                            key=${candidato.id_registro}
                            type="button"
                            class="btn btn-light btn-sm w-100 text-start"
                            onClick=${() => adicionarParticipante(candidato)}
                          >
                            ${candidato.nome_candidato} <span class="text-muted small">— ${candidato.vaga || ''}</span>
                          </button>
                        `,
                      )
                    : html`<div class="p-2 text-muted small">Nenhum resultado.</div>`}
              </div>
            `
          : null}
      </div>
      <div class="d-flex flex-wrap gap-2 mt-2">
        ${formulario.participantes.map(
          (candidato) => html`
            <span key=${candidato.id_registro} class="rh-chip d-flex align-items-center gap-1">
              ${candidato.nome_candidato}
              <button type="button" class="btn-close btn-close-sm" aria-label="Remover" onClick=${() => removerParticipante(candidato.id_registro)}></button>
            </span>
          `,
        )}
        ${!formulario.participantes.length ? html`<span class="text-muted small">Nenhum participante selecionado ainda.</span>` : null}
      </div>
      ${!formulario.participantes.length
        ? html`
            <p class="text-muted small mt-2 mb-0">
              <span class="material-symbols-outlined align-middle" style=${{ fontSize: '16px' }}>${IconeSvg('info')}</span>
              Sem participantes, o treinamento fica só cadastrado (sem agenda vinculada) — as datas informadas acima poderão
              ser reaproveitadas depois, pela aba Atribuições ou ao liberar vagas de um processo seletivo.
            </p>
          `
        : null}
    </section>
  `;

  const renderModuloForm = (modulo, index) => html`
    <div key=${index} class="rh-section-card rh-section-card--flat mb-2" style=${{ padding: '14px' }}>
      <div class="row g-2">
        <div class="col-md-6">
          <label class="process-create-field mb-2">
            <span>Título do módulo</span>
            <input value=${modulo.titulo} onInput=${(event) => atualizarModulo(index, 'titulo', event.target.value)} />
          </label>
        </div>
        <div class="col-md-6">
          <label class="process-create-field mb-2">
            <span>Subtítulo (opcional)</span>
            <input value=${modulo.subtitulo} onInput=${(event) => atualizarModulo(index, 'subtitulo', event.target.value)} />
          </label>
        </div>
      </div>
      <label class="process-create-field mb-2">
        <span>Texto principal</span>
        <textarea rows="3" value=${modulo.texto_principal} onInput=${(event) => atualizarModulo(index, 'texto_principal', event.target.value)}></textarea>
      </label>
      <div class="row g-2">
        <div class="col-md-4">
          <label class="process-create-field mb-2">
            <span>Tipo de conteúdo</span>
            <select value=${modulo.tipo_conteudo} onChange=${(event) => atualizarModulo(index, 'tipo_conteudo', event.target.value)}>
              ${TIPOS_CONTEUDO.map((opcao) => html`<option key=${opcao.value} value=${opcao.value}>${opcao.label}</option>`)}
            </select>
          </label>
        </div>
        <div class="col-md-4">
          <label class="process-create-field mb-2">
            <span>Link/embed (vídeo, slide, intranet...)</span>
            <input value=${modulo.conteudo_url} onInput=${(event) => atualizarModulo(index, 'conteudo_url', event.target.value)} disabled=${!modulo.tipo_conteudo} />
          </label>
        </div>
        <div class="col-md-4">
          <label class="process-create-field mb-2">
            <span>Ou anexar vídeo (upload)</span>
            <input type="file" accept=".mp4,.webm" onChange=${(event) => atualizarModulo(index, '_videoFile', event.target.files?.[0] || null)} />
            ${modulo._videoFile ? html`<small class="text-muted">${modulo._videoFile.name}</small>` : null}
          </label>
        </div>
      </div>
      <label class="process-create-field mb-2">
        <span>Bloco "Dica" (opcional)</span>
        <textarea rows="2" value=${modulo.dica_texto} onInput=${(event) => atualizarModulo(index, 'dica_texto', event.target.value)}></textarea>
      </label>
      <div class="d-flex align-items-center justify-content-between">
        <label class="d-flex align-items-center gap-2 mb-0">
          <input type="checkbox" checked=${modulo.obrigatorio} onChange=${(event) => atualizarModulo(index, 'obrigatorio', !!event.target.checked)} />
          <span>Módulo obrigatório</span>
        </label>
        <div class="d-flex gap-1">
          <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => moverModulo(index, -1)}>
            <span class="material-symbols-outlined">${IconeSvg('arrow_upward')}</span>
          </button>
          <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => moverModulo(index, 1)}>
            <span class="material-symbols-outlined">${IconeSvg('arrow_downward')}</span>
          </button>
          <button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => removerModulo(index)}>
            <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
            Remover
          </button>
        </div>
      </div>
    </div>
  `;

  const renderEtapa2 = () => html`
    <section class="process-create-card">
      <div class="process-create-section-title">
        <span class="material-symbols-outlined">${IconeSvg('view_module')}</span>
        <h2>Módulos do treinamento</h2>
      </div>
      <div class="d-flex flex-wrap gap-2 mb-3">
        <button type="button" class="btn btn-outline-primary btn-sm" onClick=${adicionarModulo}>
          <span class="material-symbols-outlined">${IconeSvg('add')}</span>
          Adicionar módulo manualmente
        </button>
        <label class="btn btn-outline-secondary btn-sm mb-0">
          <span class="material-symbols-outlined">${IconeSvg('upload_file')}</span>
          Importar módulo via JSON
          <input type="file" accept="application/json" style=${{ display: 'none' }} onChange=${handleUploadJsonModulo} />
        </label>
        <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${handleBaixarModeloJson}>
          <span class="material-symbols-outlined">${IconeSvg('download')}</span>
          Baixar modelo JSON
        </button>
      </div>
      ${formulario.itens.map((modulo, index) => renderModuloForm(modulo, index))}
    </section>
  `;

  const renderEtapa3 = () => html`
    <section class="process-create-card">
      <div class="process-create-section-title">
        <span class="material-symbols-outlined">${IconeSvg('slideshow')}</span>
        <h2>Slide de apresentação (.pptx)</h2>
      </div>
      <p class="text-muted small">
        Este é o material que o responsável vai apresentar ao vivo durante o treinamento (modo "Iniciar Treinamento").
      </p>
      <input
        type="file"
        accept=".pptx"
        onChange=${(event) => atualizarCampo('pptxFile', event.target.files?.[0] || null)}
      />
      ${formulario.pptxFile ? html`<p class="mt-2"><strong>${formulario.pptxFile.name}</strong></p>` : null}
    </section>
  `;

  const renderEtapa4 = () => html`
    <section class="process-create-card">
      <div class="process-create-section-title">
        <span class="material-symbols-outlined">${IconeSvg('info')}</span>
        <h2>Aba "Saiba +"</h2>
      </div>
      <label class="process-create-field mb-2">
        <span>Texto livre breve</span>
        <textarea rows="2" value=${formulario.saibaMaisTreinamento.texto_breve} onInput=${(event) => atualizarSaibaMaisTreinamento('texto_breve', event.target.value)}></textarea>
      </label>

      <div class="mb-3">
        <span class="d-block mb-1">Links externos</span>
        ${formulario.saibaMaisTreinamento.links.map(
          (link, index) => html`
            <div key=${index} class="row g-2 mb-1">
              <div class="col-md-5">
                <input class="form-control" placeholder="Título" value=${link.titulo} onInput=${(event) => atualizarLinkSaibaMais(index, 'titulo', event.target.value)} />
              </div>
              <div class="col-md-6">
                <input class="form-control" placeholder="URL" value=${link.url} onInput=${(event) => atualizarLinkSaibaMais(index, 'url', event.target.value)} />
              </div>
              <div class="col-md-1">
                <button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => removerLinkSaibaMais(index)}>
                  <span class="material-symbols-outlined">${IconeSvg('close')}</span>
                </button>
              </div>
            </div>
          `,
        )}
        <button type="button" class="btn btn-outline-primary btn-sm" onClick=${adicionarLinkSaibaMais}>
          <span class="material-symbols-outlined">${IconeSvg('add')}</span>
          Adicionar link
        </button>
      </div>

      <div>
        <span class="d-block mb-1">Documentos anexos</span>
        <input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onChange=${(event) => { adicionarAnexo(event.target.files?.[0]); event.target.value = ''; }} />
        ${formulario.anexosTreinamento.map(
          (anexo) => html`
            <div key=${anexo.id} class="d-flex align-items-center justify-content-between mt-2 p-2 rh-section-card rh-section-card--flat">
              <span>${anexo.file.name}</span>
              <div class="d-flex align-items-center gap-2">
                <label class="d-flex align-items-center gap-1 mb-0 small">
                  <input type="checkbox" checked=${anexo.permite_download} onChange=${() => alternarPermiteDownloadAnexo(anexo)} />
                  Permitir download pelo aluno
                </label>
                <button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => removerAnexo(anexo.id)}>
                  <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                </button>
              </div>
            </div>
          `,
        )}
      </div>
    </section>
  `;

  const renderEtapa5 = () => html`
    <section class="process-create-card">
      <div class="process-create-section-title">
        <span class="material-symbols-outlined">${IconeSvg('flag')}</span>
        <h2>Texto de encerramento</h2>
      </div>
      <p class="text-muted small">Texto padrão pré-preenchido — edite como preferir.</p>
      <textarea
        class="form-control"
        rows="6"
        value=${formulario.texto_encerramento}
        onInput=${(event) => atualizarCampo('texto_encerramento', event.target.value)}
      ></textarea>
    </section>
  `;

  const renderEtapa6 = () => html`
    <section class="process-create-card">
      <div class="process-create-section-title">
        <span class="material-symbols-outlined">${IconeSvg('publish')}</span>
        <h2>Revisão e Publicação</h2>
      </div>
      <div class="process-final-review">
        ${[
          ['Nome', formulario.nome || '-'],
          ['Categoria', formulario.categoria],
          ['Operação', nomeOperacao],
          ['Modalidade', MODALIDADES_TREINAMENTO.find((m) => m.value === formulario.modalidade)?.label || '-'],
          ['Obrigatório', formulario.tipo_obrigatorio ? 'Sim' : 'Não'],
          ['Ocorrências', String(formulario.ocorrencias.length)],
          ['Participantes', String(formulario.participantes.length)],
          ['Módulos', String(formulario.itens.length)],
          ['Slide (.pptx)', formulario.pptxFile ? formulario.pptxFile.name : 'Não enviado'],
          ['Documentos Saiba+', String(formulario.anexosTreinamento.length)],
        ].map(
          ([label, value]) => html`
            <span key=${label}>
              <strong>${label}</strong>
              ${value}
            </span>
          `,
        )}
      </div>
    </section>
  `;

  const conteudoPorEtapa = {
    1: renderEtapa1,
    2: renderEtapa2,
    3: renderEtapa3,
    4: renderEtapa4,
    5: renderEtapa5,
    6: renderEtapa6,
  };

  return html`
    <${PainelRh}
      screenId="screen-training-create"
      navAtiva="screen-training-create"
      subtituloMarca="Criar treinamento"
      placeholderBusca="Novo treinamento"
      controlador=${controlador}
      acaoPrimaria=${{ label: 'Ver treinamentos', onClick: () => controlador.irParaTelaProtegida('screen-training-trilhas') }}
    >
      <${PageIntro}
        kicker="Central de Treinamentos • Novo treinamento"
        title=${`Etapa ${etapaAtual}: ${ETAPAS[etapaAtual - 1][1]}`}
        description="Cadastre o treinamento em etapas, do jeito mais simples e direto possível."
      />

      <div class="process-create-shell">
        <div class="process-create-stepper" aria-label="Etapas do treinamento">
          ${ETAPAS.map(([numero, label], indice) => {
            const etapa = indice + 1;
            return html`
              <div class=${`process-create-step ${etapaAtual === etapa ? 'is-active' : ''} ${etapaAtual > etapa ? 'is-done' : ''}`} key=${numero}>
                <span>${etapaAtual > etapa ? html`<i class="material-symbols-outlined">${IconeSvg('check')}</i>` : numero}</span>
                <strong>${label}</strong>
              </div>
            `;
          })}
        </div>

        <div class="process-create-grid">
          <div class="process-create-main">
            ${conteudoPorEtapa[etapaAtual]()}
          </div>
          <aside class="process-create-summary">
            <h3><span class="material-symbols-outlined">${IconeSvg('info')}</span>Resumo</h3>
            <dl>
              <div><dt>Nome</dt><dd>${formulario.nome || '-'}</dd></div>
              <div><dt>Ocorrências</dt><dd>${formulario.ocorrencias.length}</dd></div>
              <div><dt>Participantes</dt><dd>${formulario.participantes.length}</dd></div>
              <div><dt>Módulos</dt><dd>${formulario.itens.length}</dd></div>
            </dl>
            ${progressoPublicacao ? html`<div class="process-create-summary-note">${progressoPublicacao}</div>` : null}
          </aside>
        </div>

        ${erro ? html`<div class="alert alert-danger mt-3">${erro}</div>` : null}

        <footer class="process-create-actions">
          <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${() => (etapaAtual > 1 ? voltar() : controlador.irParaTelaProtegida('screen-training-trilhas'))}>
            <span class="material-symbols-outlined">${IconeSvg('arrow_back')}</span>
            Voltar
          </button>
          <div>
            <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${() => controlador.irParaTelaProtegida('screen-training-trilhas')}>
              Cancelar
            </button>
            ${etapaAtual < 6
              ? html`<button type="button" class="btn btn-primary" disabled=${salvando} onClick=${avancar}>Próximo</button>`
              : html`<button type="button" class="btn btn-primary" disabled=${salvando} onClick=${publicar}>${salvando ? 'Publicando...' : 'Publicar treinamento'}</button>`}
          </div>
        </footer>
      </div>

      ${modalTermoAberto
        ? html`
            <div class="modal-backdrop show" style=${{ zIndex: 1050 }}></div>
            <div class="modal d-block" tabindex="-1" style=${{ zIndex: 1060 }}>
              <div class="modal-dialog">
                <div class="modal-content">
                  <div class="modal-header">
                    <h5 class="modal-title">Liberar download do documento</h5>
                  </div>
                  <div class="modal-body">
                    <p>${TERMO_LGPD_ANEXO}</p>
                    <label class="d-flex align-items-start gap-2">
                      <input type="checkbox" onChange=${(event) => setModalTermoAberto({ ...modalTermoAberto, _aceito: event.target.checked })} />
                      <span>Li e aceito o termo de responsabilidade acima.</span>
                    </label>
                  </div>
                  <div class="modal-footer">
                    <button type="button" class="btn btn-outline-secondary" onClick=${() => setModalTermoAberto(null)}>Cancelar</button>
                    <button type="button" class="btn btn-primary" disabled=${!modalTermoAberto._aceito} onClick=${confirmarAceiteTermo}>Confirmar liberação</button>
                  </div>
                </div>
              </div>
            </div>
          `
        : null}
    </${PainelRh}>
  `;
}
