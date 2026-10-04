# Chamados (Suporte TI) — Entrega das Fases 1 e 2

Branch `chamados` (a partir de `modularizacao`). Nada foi enviado à `main` nem a produção. Banco usado nos testes: DEV local.

## 1. O que foi feito

**Backend (Fase 1):** permissões `chamados.*`, migration V059, regras puras de status/urgência/SLA, `StorageProvider` de anexos, repositório (acesso, criação, atendimento, timeline, anexos, dashboard, configuração), rotas `/chamados/*`, jobs de prazo (a cada 15 min) e notificações.

**Frontend (Fase 2):** módulo `modulos/tecnologia/chamados/` com Chamados (Meus / Da operação · Em aberto / Resolvidos / Histórico), Novo chamado (com compartilhar por WhatsApp, e-mail e link), Detalhe (timeline, anexos, dados, validação, ações da TI), Fila, Dashboard e Configurações. Item "Suporte TI" na navbar de Tecnologia; notificação do sino abre o chamado.

## 2. Arquivos

**Criados**
- `apps/backend/rh_api/repositories/chamados_schema.py`, `chamados.py`, `chamados_admin.py`
- `apps/backend/rh_api/services/chamados_regras.py`, `chamados_storage.py`
- `apps/backend/rh_api/routers/chamados.py`, `schemas/chamados.py`
- `infra/sql/migrations/V059__chamados.sql` e `V059__chamados.rollback.sql`
- `apps/frontend/fonte/modulos/tecnologia/chamados/` (`index`, `comum`, `lista`, `novo`, `detalhe`, `fila`, `dashboard`, `configuracoes`)
- `apps/frontend/fonte/services/api/chamados.js`, `apps/frontend/estilos/chamados.css`
- Testes: `test_chamados_regras.py`, `test_chamados_rotas.py`, `test_chamados_integracao.py`

**Alterados**
- `rbac.py` (6 permissões, seed, `PERMISSIONS_VERSION`), `modulos_catalogo.py` (dono e `abre_modulo`), `main.py`, `scheduler.py`, `db_repository.py`, `bootstrap.py`, `modulos_schema.py` (V056 passa a ignorar `chamados.*` para continuar idêntica à já aplicada)
- Frontend: `rotas.js`, `controlador-aplicacao.js` (permissão por tela aceita lista), `aplicacao-raiz.js`, `registro.js`, `componentes.js`, `shared/notificacoes.js`, `ui/components/layout.js` (clique da notificação), `ui/icones-svg.js`, `features/configuracoes/index.js` (grupo "Chamados" em Perfis e Permissões), `estilos.css`, `index.html` (cache-busting `?v=`)
- Testes ajustados por mudança aprovada: `test_acesso_modulos.py`, `test_matriz_acesso_caracterizacao.py`, `test_modulos_integration.py`, `test_modulos_schema.py`, `snapshots/rotas_sem_permissao.json`
- `infra/scripts/powershell/testar-restauracao.ps1` (confere anexos de chamados no zip), `CLAUDE.MD`

## 3. Como rodar

```powershell
# Migration (idempotente; o deploy já reaplica todas): 
infra\scripts\powershell\aplicar-migrations.ps1 -Server "localhost\SQLEXPRESS" -Database "RH_Provas_C24H" -Username rh_app -Password <senha>
# Em DEV o bootstrap do app cria o schema ao subir.
.venv\Scripts\python.exe -m pytest apps/backend/tests/test_chamados_regras.py apps/backend/tests/test_chamados_rotas.py apps/backend/tests/test_chamados_integracao.py
```

Anexos: pasta `RH_CHAMADOS_UPLOAD_DIR` (opcional); sem ela, `<RH_TRAINING_UPLOAD_DIR>\chamados`. **Depois do deploy todos precisam entrar de novo** (`PERMISSIONS_VERSION` subiu).

## 4. Seed inicial (editável em Perfis e Permissões)

| Perfil | Permissões |
|---|---|
| Supervisor | `abrir`, `ver_operacao` |
| Técnico Jr/Pleno/Sr e Analista de TI | `atender`, `atribuir`, `dashboard` |
| Administrador | todas |

Quem tem só `abrir`/`ver_operacao` vê apenas a aba Chamados (sem Fila, Dashboard ou Configurações). Efeito colateral intencional: `chamados.abrir` abre o módulo Tecnologia, então o Supervisor passa a ter o seletor de módulos (Operação e Tecnologia, com só "Suporte TI" no menu de Tecnologia).

## 5. Testes

- `test_chamados_regras.py` (50): transições, piso de urgência, SLA/pausa, permissões do seed, upload por conteúdo, migration.
- `test_chamados_rotas.py` (32): cada permissão libera só o que deve na API (403 sem permissão, 401 sem token).
- `test_chamados_integracao.py` (26, banco DEV): fluxo completo com pausa de SLA, reabertura, auto-encerramento, escopo por operação, solicitante sem permissão, anexos (upload, download, exclusão lógica, purga), jobs idempotentes, dashboard, configuração.
- Suíte completa (sem `test_monitoria_fluxo_integration.py`, que trava no DEV por causa de trigger/transação e já travava antes): ver o resultado da última execução no resumo final. Falhas que **já existiam** e não têm relação com Chamados: `test_e2e_login_bypass` (segredo de PROD no `.env`), `test_lgpd_retencao` (coluna `id_registro` do DEV), `test_onedrive_upload_guardrails` (OneDrive configurado no `.env`) e 4 checagens estáticas de frontend sobre Processos/Provas.
- Frontend: `node --check` em todos os `.js` passou; verificado no navegador com Supervisor e Técnico de teste (menu, lista, novo chamado, compartilhar, detalhe, assumir, fila, dashboard).

## 6. Roteiro de teste manual

1. **Supervisor com uma operação:** Tecnologia → Suporte TI. Só há a aba Chamados. Novo chamado: operação fixa, busca de agentes (mín. 2 letras), PA parada = Sim bloqueia Baixa/Média, anexar print, abrir. Na confirmação testar WhatsApp, E-mail e Copiar link.
2. **Supervisor com várias operações:** o campo Operação é um seletor obrigatório; a aba "Da operação" tem filtro por operação.
3. **Técnico (só `atender`+`atribuir`+`dashboard`):** menu abre na Fila; assumir, pedir informação (SLA pausa), resolver; Dashboard.
4. **Solicitante:** responder faz o chamado voltar a Em andamento; em Resolvido, Confirmar ou Reabrir (motivo obrigatório).
5. **Usuário sem nenhuma permissão `chamados.*`:** item de menu não aparece; URL direta mostra "Acesso restrito"; API responde 403.
6. **Cada permissão isolada:** em Perfis e Permissões, marcar uma de cada vez (`abrir`, `ver_operacao`, `atender`, `atribuir`, `dashboard`, `configurar`) e conferir menu e abas. Refazer login após cada alteração.
7. **Configurações:** mudar o prazo da Alta para 6 h e abrir um chamado novo (o antigo mantém o prazo).

## 7. Teste de backup e restauração de um anexo

1. Abrir um chamado com anexo de teste e anotar o nome interno (`chave_storage` em `dbo.chamado_anexos`).
2. `Start-ScheduledTask Conecta-Backup-Diario` e conferir o log em `C:\Backups\logs`.
3. Apagar o arquivo físico em `<uploads>\chamados\AAAA\MM\<uuid>.ext`.
4. `Start-ScheduledTask Conecta-Backup-TesteRestauracao`: o script agora também confere uma amostra de anexos de chamados no zip.
5. Extrair o arquivo do zip, comparar o SHA-256 com a coluna `sha256` e devolver à pasta.

Além do backup, o próprio sistema só apaga o arquivo físico 30 dias depois de o anexo ser removido (exclusão lógica).
**Não executei este teste:** não tenho acesso ao servidor. Precisa de quem opera o servidor.

## 8. Pendências, riscos e TODO

- **Servidor:** confirmar em que pasta ficam os uploads hoje (`.env`: `RH_TRAINING_UPLOAD_DIR`) e se a tarefa de backup cobre essa pasta. O runbook cita `D:\ConectaDados`, que pode não ser o caso.
- **Relogin geral** ao subir (`PERMISSIONS_VERSION`).
- **Deploy automático:** nenhum merge/push na `main` foi feito; o push na `main` publica em produção.
- Matrícula não existe: busca de agentes só por nome e e-mail (decisão do RH). Cargo vem de `usuarios.cargo`; site/unidade = operação.
- O SLA conta horas corridas (24x7). Não há notas internas, observadores com interface, base de conhecimento, e-mail de entrada nem pesquisa de satisfação (fora do escopo).
- Se a pessoa que abre é Operador sem conta no Conecta, não há como abrir por ele: os agentes precisam existir em `usuarios` com perfil Operador e vínculo à operação.
- `test_monitoria_fluxo_integration.py` trava no DEV (não relacionado); investigar à parte.
- Dependências de produção sem mudança. Os dois jobs usam o APScheduler já existente; com mais de um processo do backend os jobs rodam duplicados, mas são idempotentes.
