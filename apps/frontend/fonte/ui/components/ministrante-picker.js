import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { buscarUsuariosMinistrante } from '../../services/api/onboarding.js';

/** Busca rápida de usuário do sistema para o campo "ministrante" (Correções.txt,
 * rodada 22/set/2026) — continua aceitando texto livre (pessoa sem cadastro no
 * Conecta): só preenche o e-mail quando o usuário escolhe uma sugestão. */
export function MinistrantePicker({
  nome = '',
  onChange,
  placeholder = 'Nome do responsável...',
  inputClassName = 'form-control',
}) {
  const [busca, setBusca] = useState(nome);
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    setBusca(nome || '');
  }, [nome]);

  useEffect(() => {
    if (!aberto || !busca.trim()) {
      setResultados([]);
      return undefined;
    }
    setBuscando(true);
    const timer = setTimeout(() => {
      buscarUsuariosMinistrante(busca.trim())
        .then((dados) => setResultados(Array.isArray(dados) ? dados : []))
        .catch(() => setResultados([]))
        .finally(() => setBuscando(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [busca, aberto]);

  const selecionar = (usuario) => {
    setBusca(usuario.nome);
    setAberto(false);
    setResultados([]);
    onChange(usuario.nome, usuario.email || '');
  };

  return html`
    <div class="ministrante-picker">
      <input
        class=${inputClassName}
        value=${busca}
        placeholder=${placeholder}
        onInput=${(event) => {
          const valor = event.target.value;
          setBusca(valor);
          setAberto(true);
          onChange(valor, '');
        }}
        onFocus=${() => setAberto(true)}
        onBlur=${() => setTimeout(() => setAberto(false), 150)}
      />
      ${aberto && busca.trim()
        ? html`
            <div class="ministrante-picker-results">
              ${buscando
                ? html`<div class="p-2 text-muted small">Buscando...</div>`
                : resultados.length
                  ? resultados.map(
                      (usuario) => html`
                        <button
                          key=${usuario.id_usuario}
                          type="button"
                          class="ministrante-picker-result"
                          onMouseDown=${(event) => event.preventDefault()}
                          onClick=${() => selecionar(usuario)}
                        >
                          ${usuario.nome} <small>${usuario.email}</small>
                        </button>
                      `,
                    )
                  : html`<div class="p-2 text-muted small">Nenhum usuário encontrado — pode digitar livremente.</div>`}
            </div>
          `
        : null}
    </div>
  `;
}
