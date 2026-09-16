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
import { atualizarTrilhaOnboarding, lerTrilhaOnboarding, uploadImagemSecaoModulo } from '../../services/api/onboarding.js';
import { LoadingState, PageIntro, PainelRh, SectionCard, WizardStepper, WizardSummaryStrip } from '../../ui/componentes-compartilhados.js';
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
  secoes: [],
  anexos: [],
  _videoFile: null,
};

const SAIBA_MAIS_ITEM_INICIAL = { tipo: 'dica', texto: '', url: '' };
const SECAO_MODULO_INICIAL = { subtitulo: '', texto: '', imagens: [] };

// Chave usada para passar o id da trilha a editar para esta tela (mesmo
// padrão de CHAVE_PROCESSO_DETALHE em features/processos/state.js) — setada
// por abrirEdicaoTrilha em treinamentos/index.js antes de navegar para cá.
export const CHAVE_TRILHA_EDICAO = 'rh_trilha_edicao_atual';

// Converte a trilha carregada da API (GET /onboarding/trilhas/{id}) para o
// formato interno do formulário do wizard, reaproveitando a mesma UI rica de
// criação para editar (Correções.txt: conteúdo do módulo — texto/imagem
// intercalados, Dica, Saiba+, tabela — precisa ficar visível e editável).
function mapearTrilhaParaFormulario(trilha) {
  const itens = (trilha.itens || []).map((item) => ({
    id_item: item.id_item || null,
    titulo: item.titulo || '',
    subtitulo: item.subtitulo || '',
    descricao: item.descricao || '',
    texto_principal: item.texto_principal || '',
    obrigatorio: item.obrigatorio !== false,
    tipo_conteudo: item.tipo_conteudo || '',
    conteudo_url: item.conteudo_url || '',
    dica_texto: item.dica_texto || '',
    tabela: item.tabela || null,
    saiba_mais: Array.isArray(item.saiba_mais) ? item.saiba_mais : [],
    secoes: normalizarSecoesImportadas(item.secoes),
    anexos: [],
    _videoFile: null,
    video_nome_original: item.video_nome_original || '',
  }));
  return {
    nome: trilha.nome || '',
    descricao: trilha.descricao || '',
    categoria: trilha.categoria || 'Onboarding',
    id_operacao: trilha.id_operacao ? String(trilha.id_operacao) : '',
    modalidade: trilha.modalidade || '',
    local_padrao: trilha.local_padrao || '',
    tipo_obrigatorio: !!trilha.tipo_obrigatorio,
    ocorrencias: [{ ...OCORRENCIA_INICIAL }],
    participantes: [],
    itens: itens.length ? itens : [{ ...MODULO_INICIAL }],
    pptxFile: null,
    texto_encerramento: trilha.texto_encerramento || TEXTO_ENCERRAMENTO_PADRAO,
  };
}

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
  texto_encerramento: TEXTO_ENCERRAMENTO_PADRAO,
};

const ETAPAS = [
  ['1', 'Dados do Treinamento'],
  ['2', 'Montar Treinamento'],
  ['3', 'Módulos'],
  ['4', 'Slide de Apresentação'],
  ['5', 'Encerramento'],
  ['6', 'Revisão e Publicação'],
];

function gerarId() {
  return Math.random().toString(36).slice(2);
}

// JSON traz `imagens` como lista de URLs (string); no estado local do wizard
// cada imagem vira { tipo: 'link', valor } ou { tipo: 'upload', file, nome } —
// ver adicionarImagemLinkSecao/adicionarImagemUploadSecao.
function normalizarSecoesImportadas(secoes) {
  return (Array.isArray(secoes) ? secoes : []).map((secao) => ({
    subtitulo: secao?.subtitulo || '',
    texto: secao?.texto || '',
    imagens: (Array.isArray(secao?.imagens) ? secao.imagens : [])
      .filter((url) => typeof url === 'string' && url.trim())
      .map((url) => ({ tipo: 'link', valor: url })),
  }));
}

export function TelaCriarTreinamento({ controlador }) {
  const [idTrilhaEdicao] = useState(() => sessionStorage.getItem(CHAVE_TRILHA_EDICAO) || '');
  const modoEdicao = !!idTrilhaEdicao;

  const [etapaAtual, setEtapaAtual] = useState(1);
  const [formulario, setFormulario] = useState(FORM_INICIAL);
  const [operacoes, setOperacoes] = useState([]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [progressoPublicacao, setProgressoPublicacao] = useState('');

  const [trilhaOriginal, setTrilhaOriginal] = useState(null);
  const [carregandoEdicao, setCarregandoEdicao] = useState(modoEdicao);

  useEffect(() => {
    if (!modoEdicao) return;
    lerTrilhaOnboarding(idTrilhaEdicao)
      .then((dados) => {
        setTrilhaOriginal(dados);
        setFormulario(mapearTrilhaParaFormulario(dados));
      })
      .catch((error) => setErro(error?.message || 'Não foi possível carregar o treinamento para edição.'))
      .finally(() => setCarregandoEdicao(false));
  }, [modoEdicao, idTrilhaEdicao]);

  const [buscaParticipante, setBuscaParticipante] = useState('');
  const [resultadosBusca, setResultadosBusca] = useState([]);
  const [buscandoParticipantes, setBuscandoParticipantes] = useState(false);

  const [modalTermoAberto, setModalTermoAberto] = useState(null); // { moduloIndex, anexoId }
  const [importandoTreinamento, setImportandoTreinamento] = useState(false);
  const [modulosColapsados, setModulosColapsados] = useState(() => new Set());
  const alternarColapsoModulo = (index) => {
    setModulosColapsados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(index)) proximo.delete(index);
      else proximo.add(index);
      return proximo;
    });
  };

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

  // -- Etapa 3: módulos -----------------------------------------------------

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
            secoes: normalizarSecoesImportadas(validado.modulo.secoes),
            anexos: [],
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

  // -- Etapa 2: importar o treinamento completo via JSON ---------------------

  const handleBaixarModeloTreinamentoCompleto = async () => {
    try {
      const { blob } = await baixarModeloModulo();
      const moduloExemplo = JSON.parse(await blob.text());
      const modeloCompleto = {
        nome: 'Ex: Nome do treinamento (opcional — mantém o que já foi preenchido na Etapa 1 se deixar em branco)',
        descricao: 'Ex: Objetivo do treinamento (opcional).',
        categoria: 'Onboarding',
        modalidade: '',
        local_padrao: '',
        tipo_obrigatorio: false,
        texto_encerramento: TEXTO_ENCERRAMENTO_PADRAO,
        itens: [moduloExemplo],
      };
      const conteudo = JSON.stringify(modeloCompleto, null, 2);
      const url = URL.createObjectURL(new Blob([conteudo], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'modelo-treinamento-completo.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setErro(error?.message || 'Não foi possível baixar o modelo JSON do treinamento completo.');
    }
  };

  const handleUploadJsonTreinamentoCompleto = async (event) => {
    const arquivo = event.target.files?.[0];
    event.target.value = '';
    if (!arquivo) return;
    setErro('');
    setImportandoTreinamento(true);
    try {
      const dados = JSON.parse(await arquivo.text());
      const itensBrutos = Array.isArray(dados.itens) ? dados.itens : [];
      if (!itensBrutos.length) {
        throw new Error('O JSON do treinamento completo precisa ter ao menos um módulo em "itens".');
      }
      const itensValidados = [];
      for (const itemBruto of itensBrutos) {
        const validado = await validarModuloJson(itemBruto);
        itensValidados.push({
          ...MODULO_INICIAL,
          ...validado.modulo,
          tabela: validado.modulo.tabela || null,
          saiba_mais: validado.modulo.saiba_mais || [],
          secoes: normalizarSecoesImportadas(validado.modulo.secoes),
          anexos: [],
        });
      }
      setFormulario((atual) => ({
        ...atual,
        nome: String(dados.nome || '').trim() || atual.nome,
        descricao: dados.descricao !== undefined ? String(dados.descricao || '') : atual.descricao,
        categoria: dados.categoria || atual.categoria,
        modalidade: dados.modalidade !== undefined ? String(dados.modalidade || '') : atual.modalidade,
        local_padrao: dados.local_padrao !== undefined ? String(dados.local_padrao || '') : atual.local_padrao,
        tipo_obrigatorio: dados.tipo_obrigatorio !== undefined ? !!dados.tipo_obrigatorio : atual.tipo_obrigatorio,
        texto_encerramento:
          dados.texto_encerramento !== undefined && String(dados.texto_encerramento).trim()
            ? String(dados.texto_encerramento)
            : atual.texto_encerramento,
        itens: itensValidados,
      }));
      setEtapaAtual(3);
    } catch (error) {
      setErro(error?.message || 'O arquivo JSON do treinamento completo não é válido (ver "Baixar molde").');
    } finally {
      setImportandoTreinamento(false);
    }
  };

  // -- Etapa 3: "Saiba +" e documentos por módulo -----------------------------

  const adicionarSaibaMaisModulo = (moduloIndex) => {
    setFormulario((atual) => ({
      ...atual,
      itens: atual.itens.map((item, idx) =>
        idx === moduloIndex ? { ...item, saiba_mais: [...(item.saiba_mais || []), { ...SAIBA_MAIS_ITEM_INICIAL }] } : item,
      ),
    }));
  };

  const atualizarSaibaMaisModulo = (moduloIndex, itemIndex, campo, valor) => {
    setFormulario((atual) => ({
      ...atual,
      itens: atual.itens.map((item, idx) =>
        idx === moduloIndex
          ? {
              ...item,
              saiba_mais: (item.saiba_mais || []).map((entrada, idxEntrada) =>
                idxEntrada === itemIndex ? { ...entrada, [campo]: valor } : entrada,
              ),
            }
          : item,
      ),
    }));
  };

  const removerSaibaMaisModulo = (moduloIndex, itemIndex) => {
    setFormulario((atual) => ({
      ...atual,
      itens: atual.itens.map((item, idx) =>
        idx === moduloIndex
          ? { ...item, saiba_mais: (item.saiba_mais || []).filter((_, idxEntrada) => idxEntrada !== itemIndex) }
          : item,
      ),
    }));
  };

  // Seções de conteúdo (subtítulos + imagens ao longo do módulo — diferente
  // do vídeo, que é um único arquivo por módulo, aqui pode haver zero, uma ou
  // várias imagens, espalhadas em vários subtítulos).
  const adicionarSecaoModulo = (moduloIndex) => {
    setFormulario((atual) => ({
      ...atual,
      itens: atual.itens.map((item, idx) =>
        idx === moduloIndex ? { ...item, secoes: [...(item.secoes || []), { ...SECAO_MODULO_INICIAL, imagens: [] }] } : item,
      ),
    }));
  };

  const atualizarSecaoModulo = (moduloIndex, secaoIndex, campo, valor) => {
    setFormulario((atual) => ({
      ...atual,
      itens: atual.itens.map((item, idx) =>
        idx === moduloIndex
          ? {
              ...item,
              secoes: (item.secoes || []).map((secao, idxSecao) =>
                idxSecao === secaoIndex ? { ...secao, [campo]: valor } : secao,
              ),
            }
          : item,
      ),
    }));
  };

  const removerSecaoModulo = (moduloIndex, secaoIndex) => {
    setFormulario((atual) => ({
      ...atual,
      itens: atual.itens.map((item, idx) =>
        idx === moduloIndex ? { ...item, secoes: (item.secoes || []).filter((_, idxSecao) => idxSecao !== secaoIndex) } : item,
      ),
    }));
  };

  // Cada imagem entra como { tipo: 'link', valor } ou { tipo: 'upload', file, nome } —
  // o upload só é enviado ao servidor na publicação (mesmo padrão do vídeo do módulo,
  // que também fica local até a trilha existir).
  const adicionarImagemLinkSecao = (moduloIndex, secaoIndex) => {
    setFormulario((atual) => ({
      ...atual,
      itens: atual.itens.map((item, idx) =>
        idx === moduloIndex
          ? {
              ...item,
              secoes: (item.secoes || []).map((secao, idxSecao) =>
                idxSecao === secaoIndex
                  ? { ...secao, imagens: [...(secao.imagens || []), { tipo: 'link', valor: '' }] }
                  : secao,
              ),
            }
          : item,
      ),
    }));
  };

  const adicionarImagemUploadSecao = (moduloIndex, secaoIndex, arquivo) => {
    if (!arquivo) return;
    setFormulario((atual) => ({
      ...atual,
      itens: atual.itens.map((item, idx) =>
        idx === moduloIndex
          ? {
              ...item,
              secoes: (item.secoes || []).map((secao, idxSecao) =>
                idxSecao === secaoIndex
                  ? { ...secao, imagens: [...(secao.imagens || []), { tipo: 'upload', file: arquivo, nome: arquivo.name }] }
                  : secao,
              ),
            }
          : item,
      ),
    }));
  };

  const atualizarImagemSecao = (moduloIndex, secaoIndex, imagemIndex, valor) => {
    setFormulario((atual) => ({
      ...atual,
      itens: atual.itens.map((item, idx) =>
        idx === moduloIndex
          ? {
              ...item,
              secoes: (item.secoes || []).map((secao, idxSecao) =>
                idxSecao === secaoIndex
                  ? {
                      ...secao,
                      imagens: (secao.imagens || []).map((imagem, idxImagem) =>
                        idxImagem === imagemIndex ? { ...imagem, valor } : imagem,
                      ),
                    }
                  : secao,
              ),
            }
          : item,
      ),
    }));
  };

  const removerImagemSecao = (moduloIndex, secaoIndex, imagemIndex) => {
    setFormulario((atual) => ({
      ...atual,
      itens: atual.itens.map((item, idx) =>
        idx === moduloIndex
          ? {
              ...item,
              secoes: (item.secoes || []).map((secao, idxSecao) =>
                idxSecao === secaoIndex
                  ? { ...secao, imagens: (secao.imagens || []).filter((_, idxImagem) => idxImagem !== imagemIndex) }
                  : secao,
              ),
            }
          : item,
      ),
    }));
  };

  const adicionarAnexoModulo = (moduloIndex, arquivo) => {
    if (!arquivo) return;
    setFormulario((atual) => ({
      ...atual,
      itens: atual.itens.map((item, idx) =>
        idx === moduloIndex
          ? { ...item, anexos: [...(item.anexos || []), { id: gerarId(), file: arquivo, permite_download: false }] }
          : item,
      ),
    }));
  };

  const removerAnexoModulo = (moduloIndex, anexoId) => {
    setFormulario((atual) => ({
      ...atual,
      itens: atual.itens.map((item, idx) =>
        idx === moduloIndex ? { ...item, anexos: (item.anexos || []).filter((anexo) => anexo.id !== anexoId) } : item,
      ),
    }));
  };

  const confirmarAceiteTermo = () => {
    if (!modalTermoAberto) return;
    const { moduloIndex, anexoId } = modalTermoAberto;
    setFormulario((atual) => ({
      ...atual,
      itens: atual.itens.map((item, idx) =>
        idx === moduloIndex
          ? {
              ...item,
              anexos: (item.anexos || []).map((anexo) =>
                anexo.id === anexoId ? { ...anexo, permite_download: true } : anexo,
              ),
            }
          : item,
      ),
    }));
    setModalTermoAberto(null);
  };

  const alternarPermiteDownloadAnexoModulo = (moduloIndex, anexo) => {
    if (anexo.permite_download) {
      setFormulario((atual) => ({
        ...atual,
        itens: atual.itens.map((item, idx) =>
          idx === moduloIndex
            ? {
                ...item,
                anexos: (item.anexos || []).map((item2) =>
                  item2.id === anexo.id ? { ...item2, permite_download: false } : item2,
                ),
              }
            : item,
        ),
      }));
      return;
    }
    setModalTermoAberto({ moduloIndex, anexoId: anexo.id });
  };

  // -- Validação por etapa ---------------------------------------------------

  const validarEtapa = (etapa) => {
    if (etapa === 1) {
      if (!formulario.nome.trim()) return 'Informe o nome do treinamento.';
      // Correções.txt item 8: ao editar um treinamento já realizado, as
      // ocorrências passadas não precisam de data/horário reconfirmados.
      if (!modoEdicao) {
        const semData = formulario.ocorrencias.some((item) => !item.data_prevista && !item.sem_horario_definido);
        if (semData) return 'Informe a data/horário de todas as ocorrências, ou marque "sem horário definido".';
      }
      return '';
    }
    if (etapa === 3) {
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

  // Imagens do tipo "upload" só viram URL depois que o módulo existe (id_item),
  // então na criação elas entram vazias e, se houver alguma pendente, um
  // segundo PUT finaliza a trilha já com as URLs resolvidas — mesma lógica de
  // "sobe o binário depois de criar" já usada para vídeo/anexo, um nível mais
  // fundo (por seção, não só por módulo).
  const montarPayloadItem = (item, index, idItem) => ({
    ...(idItem ? { id_item: idItem } : {}),
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
    secoes: (item.secoes || []).map((secao) => ({
      subtitulo: (secao.subtitulo || '').trim(),
      texto: (secao.texto || '').trim(),
      imagens: (secao.imagens || [])
        .map((imagem) => (imagem.tipo === 'upload' ? imagem._urlResolvida : imagem.valor))
        .map((url) => (url || '').trim())
        .filter(Boolean),
    })),
  });

  // Envia vídeo/anexos/imagens pendentes de cada módulo (upload que só é
  // possível depois que o módulo já existe, com id_item) e devolve os itens
  // locais com as URLs de imagem resolvidas + se algo foi enviado — usado
  // tanto na criação quanto na edição (mesma lógica, muda só o payload base).
  const enviarArquivosPendentesDosModulos = async (idTrilha, itensCriados) => {
    const itensAtualizados = formulario.itens.map((item) => ({
      ...item,
      secoes: (item.secoes || []).map((secao) => ({ ...secao, imagens: [...(secao.imagens || [])] })),
    }));
    let houveUploadDeImagem = false;

    for (let index = 0; index < formulario.itens.length; index += 1) {
      const moduloLocal = formulario.itens[index];
      const moduloCriado = itensCriados[index];
      if (!moduloCriado?.id_item) continue;

      if (moduloLocal._videoFile) {
        setProgressoPublicacao(`Enviando vídeo do módulo "${moduloLocal.titulo}"...`);
        await uploadVideoModulo(moduloCriado.id_item, moduloLocal._videoFile);
      }

      for (const anexo of moduloLocal.anexos || []) {
        setProgressoPublicacao(`Enviando anexo "${anexo.file.name}" (${moduloLocal.titulo})...`);
        const resultadoAnexo = await uploadAnexoTreinamento(idTrilha, anexo.file, moduloCriado.id_item);
        if (anexo.permite_download && resultadoAnexo?.id_anexo) {
          await alternarDownloadAnexo(resultadoAnexo.id_anexo, { permite_download: true, termo_aceito: true });
        }
      }

      const secoesModulo = moduloLocal.secoes || [];
      for (let s = 0; s < secoesModulo.length; s += 1) {
        const imagensSecao = secoesModulo[s].imagens || [];
        for (let i = 0; i < imagensSecao.length; i += 1) {
          const imagem = imagensSecao[i];
          if (imagem.tipo !== 'upload' || !imagem.file) continue;
          setProgressoPublicacao(`Enviando imagem "${imagem.nome}" (${moduloLocal.titulo})...`);
          const resultadoImagem = await uploadImagemSecaoModulo(moduloCriado.id_item, imagem.file);
          itensAtualizados[index].secoes[s].imagens[i] = { ...imagem, _urlResolvida: resultadoImagem.url };
          houveUploadDeImagem = true;
        }
      }
    }

    return { itensAtualizados, houveUploadDeImagem };
  };

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
        itens: formulario.itens.map((item, index) => montarPayloadItem(item, index, null)),
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

      const { itensAtualizados, houveUploadDeImagem } = await enviarArquivosPendentesDosModulos(idTrilha, itensCriados);

      if (houveUploadDeImagem) {
        setProgressoPublicacao('Salvando imagens dos módulos...');
        await atualizarTrilhaOnboarding(idTrilha, {
          nome: formulario.nome.trim(),
          descricao: formulario.descricao.trim(),
          ativo: true,
          categoria: formulario.categoria,
          id_operacao: formulario.id_operacao ? Number(formulario.id_operacao) : null,
          modalidade: formulario.modalidade,
          local_padrao: formulario.local_padrao.trim(),
          tipo_obrigatorio: !!formulario.tipo_obrigatorio,
          texto_encerramento: formulario.texto_encerramento.trim(),
          itens: itensAtualizados.map((item, index) => montarPayloadItem(item, index, itensCriados[index]?.id_item)),
        });
      }

      controlador.irParaTelaProtegida('screen-training-trilhas');
    } catch (error) {
      setErro(error?.message || 'Não foi possível publicar o treinamento.');
    } finally {
      setSalvando(false);
      setProgressoPublicacao('');
    }
  };

  // Payload base da edição: nome/categoria/etc. vêm do formulário (editável
  // aqui), mas `ativo`/`conteudo_json` (slides legados)/`saiba_mais_treinamento`
  // não têm campo nesta tela — são devolvidos sem alteração a partir da trilha
  // original para não apagar dado que este wizard não gerencia (mesmo cuidado
  // do bug de perda de dados já corrigido em abrirEdicaoTrilha/normalizarItensParaEnvio).
  const montarPayloadBaseEdicao = (itens) => ({
    nome: formulario.nome.trim(),
    descricao: formulario.descricao.trim(),
    ativo: trilhaOriginal?.ativo !== false,
    categoria: formulario.categoria,
    id_operacao: formulario.id_operacao ? Number(formulario.id_operacao) : null,
    modalidade: formulario.modalidade,
    local_padrao: formulario.local_padrao.trim(),
    tipo_obrigatorio: !!formulario.tipo_obrigatorio,
    texto_encerramento: formulario.texto_encerramento.trim(),
    conteudo_json: trilhaOriginal?.conteudo_json ?? null,
    saiba_mais_treinamento: trilhaOriginal?.saiba_mais_treinamento ?? null,
    itens,
  });

  const salvarEdicao = async () => {
    setSalvando(true);
    setErro('');
    try {
      const idTrilha = trilhaOriginal.id_trilha;
      setProgressoPublicacao('Salvando alterações...');
      let resultado = await atualizarTrilhaOnboarding(
        idTrilha,
        montarPayloadBaseEdicao(formulario.itens.map((item, index) => montarPayloadItem(item, index, item.id_item || null))),
      );
      let itensAtuais = resultado.itens || [];

      if (formulario.pptxFile) {
        setProgressoPublicacao('Enviando novo slide de apresentação...');
        await uploadSlideTreinamento(idTrilha, formulario.pptxFile);
      }

      const { itensAtualizados, houveUploadDeImagem } = await enviarArquivosPendentesDosModulos(idTrilha, itensAtuais);

      if (houveUploadDeImagem) {
        setProgressoPublicacao('Salvando imagens dos módulos...');
        await atualizarTrilhaOnboarding(
          idTrilha,
          montarPayloadBaseEdicao(itensAtualizados.map((item, index) => montarPayloadItem(item, index, itensAtuais[index]?.id_item || item.id_item || null))),
        );
      }

      sessionStorage.removeItem(CHAVE_TRILHA_EDICAO);
      controlador.irParaTelaProtegida('screen-training-trilhas');
    } catch (error) {
      setErro(error?.message || 'Não foi possível salvar as alterações do treinamento.');
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

    ${modoEdicao
      ? null
      : html`
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
      `}
  `;

  const renderModuloForm = (modulo, index) => {
    const colapsado = modulosColapsados.has(index);
    return html`
    <div key=${index} class="rh-section-card rh-section-card--flat mb-2" style=${{ padding: '14px' }}>
      <div class="d-flex align-items-start gap-2">
        <button
          type="button"
          class="btn btn-outline-secondary btn-sm"
          title=${colapsado ? 'Expandir módulo' : 'Recolher módulo'}
          onClick=${() => alternarColapsoModulo(index)}
        >
          <span class="material-symbols-outlined">${IconeSvg(colapsado ? 'expand_more' : 'expand_less')}</span>
        </button>
        <div class="row g-2 flex-grow-1">
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
      </div>
      ${colapsado
        ? null
        : html`
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
            ${modulo._videoFile
              ? html`<small class="text-muted">${modulo._videoFile.name}</small>`
              : modulo.video_nome_original
                ? html`<small class="text-muted">Atual: ${modulo.video_nome_original}</small>`
                : null}
          </label>
        </div>
      </div>
      <label class="process-create-field mb-2">
        <span>Bloco "Dica" (opcional)</span>
        <textarea rows="2" value=${modulo.dica_texto} onInput=${(event) => atualizarModulo(index, 'dica_texto', event.target.value)}></textarea>
      </label>

      <div class="mb-2">
        <span class="d-block mb-1 small text-muted">
          Seções de conteúdo (subtítulos ao longo do módulo, cada um com zero, uma ou várias imagens — opcional)
        </span>
        ${(modulo.secoes || []).map(
          (secao, secaoIndex) => html`
            <div key=${secaoIndex} class="rh-section-card rh-section-card--flat mb-2" style=${{ padding: '10px' }}>
              <div class="d-flex align-items-center justify-content-between mb-1">
                <input
                  class="form-control form-control-sm"
                  style=${{ maxWidth: '70%' }}
                  placeholder="Subtítulo desta seção"
                  value=${secao.subtitulo}
                  onInput=${(event) => atualizarSecaoModulo(index, secaoIndex, 'subtitulo', event.target.value)}
                />
                <button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => removerSecaoModulo(index, secaoIndex)}>
                  <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                  Remover seção
                </button>
              </div>
              <textarea
                class="form-control form-control-sm mb-2"
                rows="2"
                placeholder="Texto desta seção"
                value=${secao.texto}
                onInput=${(event) => atualizarSecaoModulo(index, secaoIndex, 'texto', event.target.value)}
              ></textarea>
              <span class="d-block mb-1 small text-muted">Imagens desta seção (opcional — link ou upload)</span>
              ${(secao.imagens || []).map(
                (imagem, imagemIndex) => html`
                  <div key=${imagemIndex} class="d-flex gap-2 mb-1 align-items-center">
                    ${imagem.tipo === 'upload'
                      ? html`
                          <span class="form-control form-control-sm d-flex align-items-center gap-1 text-truncate">
                            <span class="material-symbols-outlined" style=${{ fontSize: '16px' }}>${IconeSvg('image')}</span>
                            ${imagem.nome}
                          </span>
                        `
                      : html`
                          <input
                            class="form-control form-control-sm"
                            placeholder="Ex.: https://exemplo.sharepoint.com/imagem.png"
                            value=${imagem.valor}
                            onInput=${(event) => atualizarImagemSecao(index, secaoIndex, imagemIndex, event.target.value)}
                          />
                        `}
                    <button
                      type="button"
                      class="btn btn-outline-danger btn-sm"
                      onClick=${() => removerImagemSecao(index, secaoIndex, imagemIndex)}
                    >
                      <span class="material-symbols-outlined">${IconeSvg('close')}</span>
                    </button>
                  </div>
                `,
              )}
              <div class="d-flex flex-wrap gap-2">
                <button
                  type="button"
                  class="btn btn-outline-secondary btn-sm"
                  onClick=${() => adicionarImagemLinkSecao(index, secaoIndex)}
                >
                  <span class="material-symbols-outlined">${IconeSvg('add')}</span>
                  Adicionar link de imagem
                </button>
                <label class="btn btn-outline-secondary btn-sm mb-0">
                  <span class="material-symbols-outlined">${IconeSvg('upload_file')}</span>
                  Enviar imagem do computador
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg"
                    style=${{ display: 'none' }}
                    onChange=${(event) => {
                      adicionarImagemUploadSecao(index, secaoIndex, event.target.files?.[0]);
                      event.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
          `,
        )}
        <button type="button" class="btn btn-outline-primary btn-sm" onClick=${() => adicionarSecaoModulo(index)}>
          <span class="material-symbols-outlined">${IconeSvg('add')}</span>
          Adicionar seção
        </button>
      </div>

      <div class="mb-2">
        <span class="d-block mb-1 small text-muted">Saiba + (dicas e links externos do módulo)</span>
        ${(modulo.saiba_mais || []).map(
          (entrada, entradaIndex) => html`
            <div key=${entradaIndex} class="row g-2 mb-1 align-items-center">
              <div class="col-md-2">
                <select
                  class="form-select form-select-sm"
                  value=${entrada.tipo}
                  onChange=${(event) => atualizarSaibaMaisModulo(index, entradaIndex, 'tipo', event.target.value)}
                >
                  <option value="dica">Dica</option>
                  <option value="link">Link</option>
                </select>
              </div>
              <div class=${entrada.tipo === 'link' ? 'col-md-4' : 'col-md-9'}>
                <input
                  class="form-control form-control-sm"
                  placeholder=${entrada.tipo === 'link' ? 'Título do link' : 'Texto da dica'}
                  value=${entrada.texto}
                  onInput=${(event) => atualizarSaibaMaisModulo(index, entradaIndex, 'texto', event.target.value)}
                />
              </div>
              ${entrada.tipo === 'link'
                ? html`
                    <div class="col-md-5">
                      <input
                        class="form-control form-control-sm"
                        placeholder="URL"
                        value=${entrada.url}
                        onInput=${(event) => atualizarSaibaMaisModulo(index, entradaIndex, 'url', event.target.value)}
                      />
                    </div>
                  `
                : null}
              <div class="col-md-1">
                <button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => removerSaibaMaisModulo(index, entradaIndex)}>
                  <span class="material-symbols-outlined">${IconeSvg('close')}</span>
                </button>
              </div>
            </div>
          `,
        )}
        <button type="button" class="btn btn-outline-primary btn-sm" onClick=${() => adicionarSaibaMaisModulo(index)}>
          <span class="material-symbols-outlined">${IconeSvg('add')}</span>
          Adicionar item Saiba +
        </button>
      </div>

      <div class="mb-2">
        <span class="d-block mb-1 small text-muted">Documentos anexos do módulo (opcional)</span>
        <input
          type="file"
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
          onChange=${(event) => { adicionarAnexoModulo(index, event.target.files?.[0]); event.target.value = ''; }}
        />
        ${(modulo.anexos || []).map(
          (anexo) => html`
            <div key=${anexo.id} class="d-flex align-items-center justify-content-between mt-2 p-2 rh-section-card rh-section-card--flat">
              <span class="small">${anexo.file.name}</span>
              <div class="d-flex align-items-center gap-2">
                <label class="d-flex align-items-center gap-1 mb-0 small">
                  <input type="checkbox" checked=${anexo.permite_download} onChange=${() => alternarPermiteDownloadAnexoModulo(index, anexo)} />
                  Permitir download pelo aluno
                </label>
                <button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => removerAnexoModulo(index, anexo.id)}>
                  <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                </button>
              </div>
            </div>
          `,
        )}
      </div>
      `}

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
  };

  const renderEtapa2 = () => html`
    <section class="process-create-card">
      <div class="process-create-section-title">
        <span class="material-symbols-outlined">${IconeSvg('upload_file')}</span>
        <h2>Como montar o treinamento?</h2>
      </div>
      <p class="text-muted small">
        Escolha entre importar o treinamento completo (todos os módulos de uma vez) via um arquivo JSON, ou montar os
        módulos manualmente na próxima etapa.
      </p>
      <div class="process-create-choice-grid">
        <div class="process-create-choice-card">
          <span class="material-symbols-outlined">${IconeSvg('upload_file')}</span>
          <h3>Adicionar treinamento completo via JSON</h3>
          <p class="text-muted small">
            Suba um arquivo com todos os módulos do treinamento de uma vez só. Baixe o molde para ver o formato esperado.
          </p>
          <div class="d-flex flex-wrap gap-2">
            <label class="btn btn-primary btn-sm mb-0">
              <span class="material-symbols-outlined">${IconeSvg('upload_file')}</span>
              ${importandoTreinamento ? 'Importando...' : 'Importar JSON'}
              <input
                type="file"
                accept="application/json"
                style=${{ display: 'none' }}
                disabled=${importandoTreinamento}
                onChange=${handleUploadJsonTreinamentoCompleto}
              />
            </label>
            <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${handleBaixarModeloTreinamentoCompleto}>
              <span class="material-symbols-outlined">${IconeSvg('download')}</span>
              Baixar molde
            </button>
          </div>
        </div>
        <div class="process-create-choice-card">
          <span class="material-symbols-outlined">${IconeSvg('edit_note')}</span>
          <h3>Criar manualmente</h3>
          <p class="text-muted small">Monte os módulos um a um, com todos os campos disponíveis para preencher na tela.</p>
          <button type="button" class="btn btn-primary btn-sm" onClick=${() => setEtapaAtual(3)}>
            <span class="material-symbols-outlined">${IconeSvg('arrow_forward')}</span>
            Criar módulos manualmente
          </button>
        </div>
      </div>
    </section>
  `;

  const renderEtapa3 = () => html`
    <section class="process-create-card">
      <div class="process-create-section-title">
        <span class="material-symbols-outlined">${IconeSvg('grid_view')}</span>
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

  const renderEtapa4 = () => html`
    <section class="process-create-card">
      <div class="process-create-section-title">
        <span class="material-symbols-outlined">${IconeSvg('slideshow')}</span>
        <h2>Slide de apresentação (.pptx)</h2>
      </div>
      <p class="text-muted small">
        Este é o material que o responsável vai apresentar ao vivo durante o treinamento (modo "Iniciar Treinamento").
      </p>
      ${modoEdicao && trilhaOriginal?.pptx_nome_original && !formulario.pptxFile
        ? html`<p class="text-muted small mb-2">Slide atual: <strong>${trilhaOriginal.pptx_nome_original}</strong> — escolha um novo arquivo abaixo para substituir.</p>`
        : null}
      <input
        type="file"
        accept=".pptx"
        onChange=${(event) => atualizarCampo('pptxFile', event.target.files?.[0] || null)}
      />
      ${formulario.pptxFile ? html`<p class="mt-2"><strong>${formulario.pptxFile.name}</strong></p>` : null}
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
          ...(modoEdicao
            ? []
            : [
                ['Ocorrências', String(formulario.ocorrencias.length)],
                ['Participantes', String(formulario.participantes.length)],
              ]),
          ['Módulos', String(formulario.itens.length)],
          [
            'Slide (.pptx)',
            formulario.pptxFile
              ? formulario.pptxFile.name
              : modoEdicao && trilhaOriginal?.pptx_nome_original
                ? `${trilhaOriginal.pptx_nome_original} (atual, mantido)`
                : 'Não enviado',
          ],
          [
            'Documentos anexos (por módulo)',
            String(formulario.itens.reduce((total, item) => total + (item.anexos?.length || 0), 0)),
          ],
          [
            'Imagens (por módulo)',
            String(
              formulario.itens.reduce(
                (total, item) => total + (item.secoes || []).reduce((sub, secao) => sub + (secao.imagens?.length || 0), 0),
                0,
              ),
            ),
          ],
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

  if (carregandoEdicao) {
    return html`
      <${PainelRh} screenId="screen-training-create" navAtiva="screen-training-create" controlador=${controlador}>
        <${LoadingState} titulo="Carregando treinamento" />
      <//>
    `;
  }

  const cancelarEVoltar = () => {
    if (modoEdicao) sessionStorage.removeItem(CHAVE_TRILHA_EDICAO);
    controlador.irParaTelaProtegida('screen-training-trilhas');
  };

  return html`
    <${PainelRh}
      screenId="screen-training-create"
      navAtiva="screen-training-create"
      subtituloMarca=${modoEdicao ? 'Editar treinamento' : 'Criar treinamento'}
      placeholderBusca=${modoEdicao ? 'Editar treinamento' : 'Novo treinamento'}
      controlador=${controlador}
      acaoPrimaria=${etapaAtual < 6
        ? { label: 'Próximo', icon: 'arrow_forward', onClick: avancar, disabled: salvando }
        : modoEdicao
          ? { label: salvando ? 'Salvando...' : 'Salvar alterações', icon: 'check', onClick: salvarEdicao, disabled: salvando }
          : { label: salvando ? 'Publicando...' : 'Publicar treinamento', icon: 'check', onClick: publicar, disabled: salvando }}
    >
      <${PageIntro}
        kicker=${`Central de Treinamentos • ${modoEdicao ? 'Editar treinamento' : 'Novo treinamento'}`}
        title=${`Etapa ${etapaAtual}: ${ETAPAS[etapaAtual - 1][1]}`}
        description=${modoEdicao
          ? 'Atualize os módulos, textos, imagens e demais conteúdos deste treinamento.'
          : 'Cadastre o treinamento em etapas, do jeito mais simples e direto possível.'}
      />

      <div class="process-create-shell">
        <${WizardStepper} etapas=${ETAPAS} etapaAtual=${etapaAtual} />

        <${WizardSummaryStrip}
          items=${[
            ['Nome', formulario.nome || '-'],
            ...(modoEdicao
              ? []
              : [
                  ['Ocorrências', formulario.ocorrencias.length],
                  ['Participantes', formulario.participantes.length],
                ]),
            ['Módulos', formulario.itens.length],
          ]}
          note=${progressoPublicacao}
        />

        <div class="process-create-main">
          ${conteudoPorEtapa[etapaAtual]()}
        </div>

        ${erro ? html`<div class="alert alert-danger mt-3">${erro}</div>` : null}

        <footer class="process-create-actions">
          <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${() => (etapaAtual > 1 ? voltar() : cancelarEVoltar())}>
            <span class="material-symbols-outlined">${IconeSvg('arrow_back')}</span>
            Voltar
          </button>
          <div>
            <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${cancelarEVoltar}>
              Cancelar
            </button>
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
