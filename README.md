# Conecta C24h

Sistema de RH com frontend estático em JavaScript, backend FastAPI e persistência
em SQL Server.

## Estrutura oficial

```text
.
├── apps/
│   ├── backend/
│   │   ├── conecta/        # arquitetura canônica e entrypoint HTTP
│   │   ├── rh_api/         # implementação funcional compatível
│   │   └── tests/
│   └── frontend/
│       ├── fonte/          # JavaScript ESM
│       ├── estilos/
│       ├── data/
│       ├── Exames/
│       └── tests/
├── infra/
│   ├── docker/
│   ├── scripts/
│   └── sql/
├── docs/
├── tools/
├── _legacy/                # material preservado, fora do runtime
├── run.py
└── start_conecta.ps1
```

O backend oficial fica em `apps/backend`; o frontend oficial fica em
`apps/frontend`. As antigas árvores de raiz `api/`, `Front/` e `fonte/` não
fazem mais parte do runtime.

## Pré-requisitos

- Python 3.13;
- Microsoft ODBC Driver 18 para SQL Server;
- Docker Compose v2, quando a execução for em contêiner;
- Node.js 22 apenas para os smoke tests JavaScript.

## Configuração segura

Copie `.env.example` para `.env` e preencha somente no ambiente local:

```powershell
Copy-Item .env.example .env
```

O `.env` real, ambientes virtuais, dados privados, caches e artefatos de build
são ignorados pelo Git. Exemplos específicos também estão em
`apps/backend/.env.example` e `apps/frontend/.env.example`.

## Executar pela raiz

Este é o modo mais simples: FastAPI e frontend usam a mesma origem.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python run.py
```

Abra `http://127.0.0.1:8000`. Para desenvolvimento:

```powershell
python run.py --reload
# ou
.\start_conecta.ps1 -Reload
```

## Executar o backend

```powershell
cd apps/backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn conecta.interfaces.http.main:app --reload --host 127.0.0.1 --port 8000
```

Endpoints operacionais:

- `/health`: processo ativo;
- `/ready`: dependências prontas;
- `/version`: versão implantada;
- `/docs`: OpenAPI interativa.

## Executar o frontend isoladamente

O frontend atual é estático e não exige `npm install`:

```powershell
cd apps/frontend
python -m http.server 5500
```

Abra `http://127.0.0.1:5500`. Para usar a API, ajuste
`apps/frontend/runtime-config.js` ou as variáveis documentadas no arquivo
`.env.example`.

## Executar com Docker

```powershell
Copy-Item infra/docker/env/dev.env.example infra/docker/env/dev.env
cd infra/docker
docker compose -f compose.dev.yml up --build
```

Acesse `http://localhost:8080`.

## Vertente Monitoria

Central de Monitoria de qualidade de atendimento, integrada ao Conecta (mesma autenticação, RBAC e banco).

- **Backend:** `apps/backend/rh_api/routers/monitoria.py` (rotas `/monitoria/*`), regras puras em
  `services/monitoria_{engine,workflow,scope,indicadores,export,tema}.py`, dados em
  `repositories/monitoria*.py`. DDL em uma só fonte: `repositories/monitoria_schema.py` (gera
  `infra/sql/migrations/V037__monitoria.sql`; um teste garante que coincidem). Tabelas de fluxo/histórico têm
  trigger `INSTEAD OF UPDATE, DELETE` (imutabilidade em camada de banco).
- **Frontend:** `apps/frontend/fonte/features/monitoria/` (rotas SPA em `monitorias/*` para não colidir com a API
  `/monitoria/*`); nova tela inicial por sessões e chaves-mestras `sessao.<id>.acessar` em Perfis e Permissões.
- **SLAs** (horas corridas): feedback 72h, confirmação/contestação do operador 48h, reanálise 72h. O job roda a cada
  5 minutos no APScheduler e também por `POST /monitoria/sla/processar` (Administrador).
- **Testes:** `pytest apps/backend/tests/test_monitoria_*.py`. Os `*_integration.py` usam o banco de DESENVOLVIMENTO
  (criam/desativam a operação `TESTE_AUTO`) e são pulados sem banco.
- Roadmap/decisões desta vertente: `MONITORIA_PROGRESSO.md`.

## Testes

Da raiz:

```powershell
python -m pytest
```

Testes reais do frontend (carregam e executam o módulo de origem contra dados de fixture), quando o Node.js estiver disponível:

```powershell
node apps/frontend/tests/run-rh-business-rules-smoke.cjs
node apps/frontend/tests/run-excel-correction-smoke.cjs
```

Checagens estáticas do frontend (grep programático de trechos-chave do código-fonte — ver [`apps/frontend/tests/static-checks/README.md`](apps/frontend/tests/static-checks/README.md)):

```powershell
node apps/frontend/tests/static-checks/run-process-details-rules-smoke.cjs
node apps/frontend/tests/static-checks/run-exam-analytics-smoke.cjs
node apps/frontend/tests/static-checks/run-conecta-provas-flow-smoke.cjs
node apps/frontend/tests/static-checks/run-refresh-performance-smoke.cjs
```

## Onde alterar

- entrada FastAPI: `apps/backend/conecta/interfaces/http/main.py`;
- configuração: `apps/backend/rh_api/config.py`;
- rotas: `apps/backend/rh_api/routers/`;
- persistência: `apps/backend/rh_api/repositories/`;
- entrada web: `apps/frontend/index.html`;
- telas: `apps/frontend/fonte/features/`;
- cliente HTTP: `apps/frontend/fonte/services/api/`;
- estilos: `apps/frontend/estilos/`.

## Performance e cache

A estrategia de paginacao, cache com TTL, carregamento sob demanda, Loading
Spinner e indices recomendados esta documentada em
[`docs/performance-cache-loading.md`](docs/performance-cache-loading.md).

## Case Tecnico

O case tecnico publico e anonimizado da plataforma de apoio ao recrutamento esta
disponivel em
[`docs/case-tecnico-plataforma-recrutamento.md`](docs/case-tecnico-plataforma-recrutamento.md).

## Dados e legado

`data/private/` contém dados locais potencialmente pessoais e nunca deve ser
versionado. Dados de teste controlados permanecem em `data/email-inbox-test/`.
A pasta `_legacy/` é uma área de preservação: nenhum arquivo nela participa da
execução ou do deploy sem revisão explícita.

A documentação técnica e operacional começa em
[`docs/README.md`](docs/README.md). O relatório desta reorganização está em
[`docs/RELATORIO_ORGANIZACAO_CONECTA.md`](docs/RELATORIO_ORGANIZACAO_CONECTA.md).
