import {
  html,
  useEffect,
  useMemo,
  useState,
} from '../../infraestrutura-react.js?v=20261126-painel-graficos';
import {
  enviarCandidaturaPublica,
  lerPaginaPublicaCandidatura,
} from '../../servico-api.js?v=20261126-painel-graficos';
import { obterSlugCandidaturaPorHash } from '../../rotas.js?v=20261126-painel-graficos';

function quebrarTextoEmLinhas(valor) {
  return String(valor || '')
    .split(/\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function TelaCandidaturaPublica() {
  const [slug, setSlug] = useState(() =>
    obterSlugCandidaturaPorHash(window.location.hash),
  );
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const [dados, setDados] = useState(null);
  const [formulario, setFormulario] = useState({
    nome_completo: '',
    email: '',
    telefone: '',
    area_interesse: '',
    resumo_profissional: '',
    cidade: '',
    bairro: '',
    lgpd_aceito: false,
    curriculo: null,
  });

  useEffect(() => {
    const aoTrocarHash = () =>
      setSlug(obterSlugCandidaturaPorHash(window.location.hash));
    window.addEventListener('hashchange', aoTrocarHash);
    return () => window.removeEventListener('hashchange', aoTrocarHash);
  }, []);

  useEffect(() => {
    const carregar = async () => {
      if (!slug) {
        setDados(null);
        setErro('Link de candidatura inválido.');
        setCarregando(false);
        return;
      }

      setCarregando(true);
      setErro('');
      setMensagemSucesso('');

      try {
        const resposta = await lerPaginaPublicaCandidatura(slug);
        setDados(resposta || null);
        if (resposta?.vaga) {
          setFormulario((anterior) => ({
            ...anterior,
            area_interesse: resposta.vaga,
          }));
          document.title = `Envie seu currículo - Central 24h - Vaga: ${resposta.vaga}`;
        }
      } catch (error) {
        setDados(null);
        setErro(
          error?.message ||
            'Não foi possível carregar os detalhes desta vaga agora.',
        );
      } finally {
        setCarregando(false);
      }
    };

    carregar();
  }, [slug]);

  const requisitos = useMemo(
    () => quebrarTextoEmLinhas(dados?.requisitos_publicos || ''),
    [dados],
  );

  const responsabilidades = useMemo(
    () => quebrarTextoEmLinhas(dados?.responsabilidades_publicas || ''),
    [dados],
  );

  const observacoesRh = useMemo(
    () => quebrarTextoEmLinhas(dados?.observacoes_publicas_vaga || ''),
    [dados],
  );

  const descricaoLinhas = useMemo(
    () => quebrarTextoEmLinhas(dados?.descricao_publica || ''),
    [dados],
  );

  const tituloPagina = `Envie seu currículo - Central 24h - Vaga: ${
    dados?.vaga || 'Carregando vaga'
  }`;

  const validarArquivoCurriculo = (arquivo) => {
    if (!arquivo) return 'Anexe o currículo antes de enviar a candidatura.';

    const extensao = `.${String(arquivo.name || '').split('.').pop() || ''}`.toLowerCase();
    if (!['.pdf', '.doc', '.docx'].includes(extensao)) {
      return 'Formato de currículo não suportado. Envie um arquivo PDF, DOC ou DOCX.';
    }

    if (arquivo.size > 5 * 1024 * 1024) {
      return 'O currículo excede o limite de 5 MB permitido.';
    }

    return '';
  };

  const validarCamposObrigatorios = () => {
    const camposObrigatorios = [
      formulario.nome_completo,
      formulario.email,
      formulario.telefone,
      formulario.area_interesse || dados?.vaga,
      formulario.cidade,
      formulario.bairro,
    ];

    if (camposObrigatorios.some((valor) => !String(valor || '').trim())) {
      return 'Preencha todos os campos obrigatórios antes de enviar sua candidatura.';
    }

    if (!formulario.lgpd_aceito) {
      return 'É obrigatório aceitar o termo de uso de dados (LGPD).';
    }

    return validarArquivoCurriculo(formulario.curriculo);
  };

  const atualizarCampo = (campo, valor) =>
    setFormulario((anterior) => ({
      ...anterior,
      [campo]: valor,
    }));

  const enviar = async (event) => {
    event?.preventDefault?.();
    if (!slug || !dados?.disponivel) {
      setErro('Esta vaga não está mais disponível para candidatura.');
      return;
    }

    const erroValidacao = validarCamposObrigatorios();
    if (erroValidacao) {
      setErro(erroValidacao);
      return;
    }

    setEnviando(true);
    setErro('');

    try {
      const formData = new FormData();
      formData.append('nome_completo', formulario.nome_completo);
      formData.append('email', formulario.email);
      formData.append('telefone', formulario.telefone);
      formData.append('area_interesse', formulario.area_interesse || dados?.vaga || '');
      formData.append('resumo_profissional', formulario.resumo_profissional);
      formData.append('cidade', formulario.cidade);
      formData.append('bairro', formulario.bairro);
      formData.append('lgpd_aceito', formulario.lgpd_aceito ? '1' : '0');
      formData.append('curriculo', formulario.curriculo);

      const resposta = await enviarCandidaturaPublica(slug, formData);
      setMensagemSucesso(
        resposta?.message ||
          'Candidatura enviada com sucesso. Recebemos suas informações e seu currículo. O RH analisará seu perfil e poderá entrar em contato pelo telefone ou e-mail informado.',
      );
      setFormulario({
        nome_completo: '',
        email: '',
        telefone: '',
        area_interesse: dados?.vaga || '',
        resumo_profissional: '',
        cidade: '',
        bairro: '',
        lgpd_aceito: false,
        curriculo: null,
      });
      const inputArquivo = document.getElementById('candidatura-curriculo');
      if (inputArquivo) {
        inputArquivo.value = '';
      }
    } catch (error) {
      setErro(
        error?.message ||
          'Não foi possível enviar sua candidatura agora. Tente novamente em instantes.',
      );
    } finally {
      setEnviando(false);
    }
  };

  return html`
    <section class="active screen" id="screen-public-candidacy">
      <div class="rh-public-application-shell">
        <header class="rh-public-application-header">
          <div class="rh-public-application-brand">
            <img
              alt="Central 24h"
              class="rh-public-application-logo"
              src="/estilos/marca/conecta_colorido_assinatura.svg"
            />
          </div>
        </header>

        <main class="rh-public-application-main">
          <section class="rh-public-application-info">
            <div class="rh-public-application-title-row">
              <p class="rh-modern-kicker">Candidatura pública</p>
              <h1 class="rh-public-application-title">${tituloPagina}</h1>
              ${dados
                ? html`
                    <span
                      class=${`rh-status-pill ${dados.disponivel ? 'is-approved' : 'is-eliminated'}`}
                    >
                      ${dados.status || '-'}
                    </span>
                  `
                : null}
            </div>

            ${carregando
              ? html`
                  <div class="alert alert-secondary mb-0">
                    Carregando informações da vaga...
                  </div>
                `
              : erro && !dados
                ? html`<div class="alert alert-danger mb-0">${erro}</div>`
                : html`
                    <div class="rh-public-copy-stack">
                      <section>
                        <h3 class="rh-public-copy-title">Descrição da vaga</h3>
                        ${descricaoLinhas.length
                          ? descricaoLinhas.map(
                              (linha, indice) => html`
                                <p key=${indice} class="rh-public-copy-text">
                                  ${linha}
                                </p>
                              `,
                            )
                          : html`
                              <p class="rh-public-copy-text">
                                Informações públicas desta vaga serão apresentadas aqui.
                              </p>
                            `}
                      </section>

                      <section class="rh-public-privacy-card">
                        <h3 class="rh-public-copy-title">Privacidade garantida</h3>
                        <p class="rh-public-copy-text">
                          Seus dados pessoais e profissionais serão utilizados exclusivamente para fins de recrutamento e seleção, seguindo as diretrizes da LGPD.
                        </p>
                      </section>

                      ${requisitos.length
                        ? html`
                            <section>
                              <h3 class="rh-public-copy-title">Requisitos da vaga</h3>
                              <ul class="rh-public-copy-list">
                                ${requisitos.map(
                                  (item, indice) => html`
                                    <li key=${indice}>${item}</li>
                                  `,
                                )}
                              </ul>
                            </section>
                          `
                        : null}

                      ${responsabilidades.length
                        ? html`
                            <section>
                              <h3 class="rh-public-copy-title">Responsabilidades da vaga</h3>
                              <ul class="rh-public-copy-list">
                                ${responsabilidades.map(
                                  (item, indice) => html`
                                    <li key=${indice}>${item}</li>
                                  `,
                                )}
                              </ul>
                            </section>
                          `
                        : null}

                      ${observacoesRh.length
                        ? html`
                            <section>
                              <h3 class="rh-public-copy-title">Observações específicas do RH</h3>
                              <ul class="rh-public-copy-list">
                                ${observacoesRh.map(
                                  (item, indice) => html`
                                    <li key=${indice}>${item}</li>
                                  `,
                                )}
                              </ul>
                            </section>
                          `
                        : null}
                    </div>
                  `}
          </section>

          <article class="rh-public-card">
            <div class="rh-public-card-header">
              <div>
                <p class="rh-modern-kicker">Formulário</p>
                <h2 class="rh-public-card-title">Enviar candidatura</h2>
              </div>
            </div>

            ${erro && dados
              ? html`<div class="alert alert-danger">${erro}</div>`
              : null}

            ${mensagemSucesso
              ? html`
                  <div class="alert alert-success mb-0">
                    ${mensagemSucesso}
                  </div>
                `
              : !dados?.disponivel
                ? html`
                    <div class="alert alert-warning mb-0">
                      ${dados?.mensagem ||
                      'Esta vaga está encerrada e não aceita novas candidaturas.'}
                    </div>
                  `
                : html`
                    <form class="rh-public-form" onSubmit=${enviar}>
                      <div class="row g-3">
                        <div class="col-md-12">
                          <label class="form-label">Nome completo</label>
                          <input
                            class="form-control"
                            required
                            value=${formulario.nome_completo}
                            onInput=${(event) =>
                              atualizarCampo(
                                'nome_completo',
                                event.target.value,
                              )}
                          />
                        </div>

                        <div class="col-md-6">
                          <label class="form-label">E-mail</label>
                          <input
                            class="form-control"
                            type="email"
                            required
                            value=${formulario.email}
                            onInput=${(event) =>
                              atualizarCampo('email', event.target.value)}
                          />
                        </div>

                        <div class="col-md-6">
                          <label class="form-label">Telefone</label>
                          <input
                            class="form-control"
                            required
                            value=${formulario.telefone}
                            onInput=${(event) =>
                              atualizarCampo('telefone', event.target.value)}
                          />
                        </div>

                        <div class="col-md-12">
                          <label class="form-label">Área de interesse</label>
                          <input
                            class="form-control"
                            required
                            value=${formulario.area_interesse || dados?.vaga || ''}
                            onInput=${(event) =>
                              atualizarCampo('area_interesse', event.target.value)}
                          />
                        </div>

                        <div class="col-md-6">
                          <label class="form-label">Cidade</label>
                          <input
                            class="form-control"
                            required
                            value=${formulario.cidade}
                            onInput=${(event) =>
                              atualizarCampo('cidade', event.target.value)}
                          />
                        </div>

                        <div class="col-md-6">
                          <label class="form-label">Bairro</label>
                          <input
                            class="form-control"
                            required
                            value=${formulario.bairro}
                            onInput=${(event) =>
                              atualizarCampo('bairro', event.target.value)}
                          />
                        </div>

                        <div class="col-md-12">
                          <label class="form-label">Breve resumo profissional</label>
                          <textarea
                            class="form-control"
                            rows="4"
                            value=${formulario.resumo_profissional}
                            onInput=${(event) =>
                              atualizarCampo(
                                'resumo_profissional',
                                event.target.value,
                              )}
                          ></textarea>
                        </div>

                        <div class="col-md-12">
                          <label class="form-label">Currículo</label>
                          <div class="rh-public-upload-box">
                            <input
                              id="candidatura-curriculo"
                              class="form-control"
                              type="file"
                              accept=".pdf,.doc,.docx"
                              required
                              onChange=${(event) => {
                                const arquivo = event.target.files?.[0] || null;
                                const mensagem = validarArquivoCurriculo(arquivo);
                                atualizarCampo('curriculo', arquivo);
                                setErro(mensagem);
                              }}
                            />
                          </div>
                          <div class="form-text">
                            Formatos aceitos: PDF, DOC ou DOCX. Tamanho máximo: 5 MB.
                          </div>
                        </div>

                        <div class="col-md-12">
                          <div class="form-check rh-public-lgpd-check">
                            <input
                              class="form-check-input"
                              id="public-lgpd"
                              type="checkbox"
                              required
                              checked=${formulario.lgpd_aceito}
                              onChange=${(event) =>
                                atualizarCampo(
                                  'lgpd_aceito',
                                  !!event.target.checked,
                                )}
                            />
                            <label
                              class="form-check-label"
                              for="public-lgpd"
                            >
                              Autorizo o uso dos meus dados neste processo seletivo,
                              conforme a LGPD.
                            </label>
                          </div>
                        </div>
                      </div>

                      <div class="rh-public-form-footer">
                        <p class="rh-public-form-note">
                          Seus dados não exibem notas, classificações internas ou
                          informações administrativas.
                        </p>
                        <button
                          type="submit"
                          class="btn btn-primary"
                          disabled=${enviando}
                        >
                          ${enviando ? 'Enviando candidatura...' : 'Enviar candidatura'}
                        </button>
                      </div>
                    </form>
                  `}
          </article>
        </main>
      </div>
    </section>
  `;
}
