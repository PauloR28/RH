# Changelog

Todas as mudanças relevantes seguem [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Adicionado

- Estrutura incremental de Clean Architecture em `apps/backend/conecta`.
- Frontend executável consolidado em `apps/frontend`.
- Documentação de performance, cache, Loading Spinner e índices SQL em
  `docs/performance-cache-loading.md`.
- Script idempotente de índices recomendados em
  `infra/sql/performance_indexes_recommended.sql`.
- RBAC com perfis Administrador, RH, Gestor, DP, Estagiário e Candidato.
- Preparação completa de MFA TOTP com segredo criptografado e reset auditado.
- Rate limit de login, logs JSON e correlação por `request_id`.
- Endpoints `/health`, `/ready`, `/version` e `/metrics`.
- Dockerfiles, Compose DEV/HML/PROD, Caddy/TLS e migrations SQL.
- CI, verificações de segurança, ADRs e runbooks.

- **Monitoria (vertente nova, 20/set/2026):** Central de Monitoria com formulário versionado por operação
  (matriz 1.0 com 8 blocos), motor de nota único (SIM/NÃO/NCG/N/A, bloco nulo com redistribuição, mínimo de
  3 blocos, NCG zera), monitoria realizada imutável (snapshot + trigger), ID de 8 dígitos, feedback (72h),
  confirmação/contestação do operador (48h, evidências) e reanálise (72h, manter ou anular), job de SLA idempotente,
  planos de ação, dashboard (Geral/Equipe/Período/Operador, Top 3/5/10/15), relatórios e exportação XLSX/CSV,
  compartilhamento por e-mail, logs imutáveis com IP, guia de processos, equipes/turnos/canais administráveis,
  perfis Qualidade e Control Desk, escopo por operação (deny por padrão), tema/logo por operação, tela inicial por
  sessões e chaves-mestras de sessão em Perfis e Permissões. Migrations `V037__monitoria.sql` e
  `V038__monitoria_inicio_supervisor.sql`.
- Operador com vínculo de operação passa a acessar a web; troca obrigatória de senha no primeiro acesso para contas
  com login por senha; "Esqueci a senha" na tela de login (ainda desativado).
- Isolamento por operação (aditivo) nas trilhas, atribuições e relatórios de Treinamentos.

### Alterado (Monitoria)

- Tela de login sem referências diretas a RH ("Conecta" / "Acesse sua conta"); perfil `rh` passa a exibir "Analista".
- Supervisor e Operador deixam de abrir direto na Central de Treinamentos: o Início lista uma div por sessão liberada.

### Alterado

- O bootstrap administrativo não usa mais senha padrão conhecida.
- DEV/HML são bloqueados ao apontar para `Conecta_PROD`.
- API FastAPI passa a usar GZip para respostas acima de 1 KB.
- Endpoints `/processes`, `/process-candidates` e `/talent-bank` aceitam
  paginação opcional sem quebrar o formato legado.
- Cache do frontend passa a usar TTL por política, com dados sensíveis apenas
  em memória temporária.
- Queries ativas remanescentes com `SELECT *` foram trocadas por colunas
  explícitas.

### Segurança

- Tokens permanecem em `sessionStorage`, não em `localStorage`.
- MFA exige `cryptography` e chave externa `RH_MFA_ENCRYPTION_KEY`.
