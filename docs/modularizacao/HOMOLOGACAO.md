# Modularização do Conecta — Etapa 8: Verificação e homologação

Branch: `modularizacao` (de `wfm`). **Nada foi enviado à `main` nem a produção. Nenhum deploy foi executado por mim** (§3 explica).

## 1. Diferença de matriz de acesso (final × snapshot da Etapa 2)

Gerada comparando `apps/backend/tests/snapshots/matriz_acesso.json` (antes de qualquer mudança) com a matriz atual, com a flag do WFM fechada e aberta:

| Perfil | Permissões | Rotas já existentes liberadas | Telas já existentes liberadas |
|---|---|---|---|
| Analista de TI | **+37** | +103 | +24 |
| Técnico Júnior / Pleno / Sênior | **+38** | +104 | +24 (flag aberta) · +21 e −1 (flag fechada) |
| **Todos os outros 11 perfis** (Administrador, Gestor, Analista, DP, Estagiário, Supervisor, Control Desk, Qualidade, Operador, Funcionário, Candidato) | **0** | **0** | **0** |

- As permissões novas dos perfis de TI são **só dos módulos core e tecnologia** (administração do Conecta; 40 permissões), nenhuma de RH/Operação/WFM. `wfm.escala.criar`/`editar` continuam só com o Analista de TI. É a mudança aprovada (decisão 2 + D-10).
- A única perda é `screen-processes-open` nos Técnicos com a flag fechada: tela vazia que não exige permissão e que só ficava aberta porque esses perfis não tinham nenhuma chave `sessao.*`; ao recebê-las passam a ser restringidos como todo mundo.
- Rotas novas (aditivas): `GET /core/acesso`, `GET /tecnologia/modulos`, `PUT /tecnologia/modulos/{chave}`, `PUT /tecnologia/permissoes/{chave}/modulo`, `GET|PUT /tecnologia/parametros/wfm-participantes`. **Nenhuma rota existente mudou de endereço ou contrato** (teste do OpenAPI, e as rotas do app Android estão inalteradas).
- `services/wfm_regras.py`: `git diff 7f1eff5 -- services/wfm_regras.py` vazio.

### Matriz perfil × módulo (verificada por teste)
Administrador: RH · Operação · Tecnologia — Gestor: RH · Operação — Analista/DP/Estagiário: RH — Supervisor/Control Desk/Qualidade/Operador: Operação — Funcionário/Candidato: só Núcleo — **Analista de TI: Operação · Tecnologia** — **Técnicos de TI: Tecnologia** (+ Operação quando o WFM é liberado a participantes). Quem tem um módulo só não vê seletor.

## 2. Evidências de teste
- Suíte do backend contra a cópia do DEV (`RH_Provas_modularizacao`): ver §2.1 (resultado final desta execução).
- **Caracterização de acesso** (Etapa 2) verde: permissões, rotas, telas e OpenAPI idênticos ao snapshot, exceto os perfis de TI.
- **Migrations**: V055/V056/V057 com rollback testados em banco descartável (aplicar → reaplicar → rollback → estado idêntico: 897 linhas e mesmo checksum em `perfil_permissoes`; reaplicar não desfaz decisão posterior do Administrador).
- **Frontend** testado com o servidor rodando (Etapa 7): seletor, menu por módulo, Tecnologia, ativar/desativar módulo (rota de RH → 403 e volta a 200), botão do WFM (banco + auditoria), Escalas e Plantões filtradas pela TI.
- `node --check` em todo `fonte/**/*.js`.

### 2.1 Resultado da suíte
(preenchido no final deste arquivo)

## 3. Roteiro de deploy em TESTE e HOMOLOGAÇÃO
> Não executei deploy: não tenho acesso nem o procedimento dos ambientes de teste/homologação (a decisão D-5 não trouxe os dados). O que existe no repositório é `infra/scripts/powershell/deploy-producao.ps1` (parâmetros `-Branch`, `-AppDir`, `-SqlServer`, `-SqlDatabase`…) e `compose.hml.yml`. **Cuidado:** o workflow `deploy-producao.yml` publica em **produção a cada push na `main`**; esta branch não deve ser mesclada nem ter push na `main`.

**Antes**
1. Combine o horário: **todos os usuários precisarão entrar de novo** (a versão de permissões mudou).
2. Backup do banco do ambiente (`infra/scripts/powershell/backup-comum.ps1` ou `BACKUP DATABASE … COPY_ONLY`).
3. Anote o valor atual de `RH_WFM_LIBERAR_PARTICIPANTES` no `.env` do ambiente (a Etapa 4 usa esse valor como inicial; **não altere a variável nesta leva**).

**Migrations** (idempotentes; o script aplica todas e ignora `*.rollback.sql`)
4. Com a branch `modularizacao` no servidor do ambiente:
   `powershell -ExecutionPolicy Bypass -File infra\scripts\powershell\aplicar-migrations.ps1 -Server <servidor> -Database <banco> [-TrustedConnection | -Username … -Password …]`
5. Conferir no banco:
   - `SELECT chave, nome, ativo, protegido FROM dbo.modulos_sistema` → 4 linhas (core/tecnologia protegidos; "Operação" com acento correto);
   - `SELECT COUNT(*) FROM dbo.permissoes WHERE modulo_dono IS NULL` → 0; `SELECT COUNT(*) FROM dbo.permissoes WHERE abre_modulo = 1` → 6;
   - `SELECT id_perfil, COUNT(*) FROM dbo.modularizacao_grants_log GROUP BY id_perfil` → só `analista_ti`, `tecnico_junior/pleno/senior`;
   - **Acentos:** `sqlcmd -S <servidor> -d <banco> -E -I -f 65001 -i infra\sql\diagnostico_acentos.sql` antes (anote o que aparecer com valor > 0) e depois (deve ficar tudo 0);
   - `SELECT id_perfil, SUM(CAST(permitido AS int)) FROM dbo.perfil_permissoes WHERE id_perfil IN ('analista_ti','tecnico_junior','tecnico_pleno','tecnico_senior') GROUP BY id_perfil`.

**Aplicação**
6. Atualizar o código (para o ambiente de teste, por exemplo `deploy-producao.ps1 -Branch modularizacao -AppDir <pasta do teste> -SqlDatabase <banco do teste> …` — **nunca com os parâmetros de produção**), reiniciar o serviço e conferir `GET /health`.
7. Limpar o cache do navegador (os arquivos do frontend mudaram de `?v=`; Ctrl+F5 resolve).

**Verificação rápida (10 min)**
8. Login como Administrador: seletor RH · Operação · Tecnologia; `/administracao-ti` abre; `Módulos` mostra RH e Operação ativos.
9. Roteiro por perfil (§4).

**Remover o fallback da variável de ambiente (só depois de aprovado em homologação)**
10. Apagar `RH_WFM_LIBERAR_PARTICIPANTES` do `.env` do ambiente e reiniciar: o botão em Tecnologia passa a controlar (o valor do banco foi semeado com o valor da variável). Remover o ramo `os.environ` de `acesso._ler_ambiente()` num commit à parte.

## 4. Roteiro de teste manual por perfil (9 perfis em uso)
Anotar "ok / falhou / observação". Todos: entrar, conferir que a tela inicial abre, trocar de módulo (se houver seletor), abrir 2 telas de cada grupo do menu.

| Perfil | O que conferir |
|---|---|
| **Administrador** | Seletor com 3 módulos. Em **RH**: menu de RH completo. Em **Tecnologia**: início com indicadores, áreas, ativação de módulos (Núcleo/Tecnologia travados), botão do WFM. Desligar **RH** → entrar com um Analista de RH e confirmar bloqueio (403/tela de acesso negado); religar. Em **Perfis e permissões**: módulos como cabeçalhos, resumo "enxerga os módulos", chip do módulo de cada permissão; mover "Relatórios" de módulo e voltar. Em **Escalas e Plantões** (Tecnologia): só a escala da TI. |
| **Gestor** | Seletor RH · Operação. RH como antes. Operação: Monitoria/WFM como antes. **Sem** módulo Tecnologia. |
| **Analista (RH)** | **Sem seletor**; menu igual ao de antes. |
| **Supervisor** | **Sem seletor**; Início · Treinamentos · Monitoria · Turnos e Plantões como antes. Não vê a escala da TI. |
| **Control Desk** | **Sem seletor**; Monitoria/WFM como antes; não vê a escala da TI. |
| **Operador** | **Sem seletor**; Minhas monitorias; Treinamentos atribuídos. Com o WFM fechado: sem Turnos e Plantões. |
| **Qualidade** | **Sem seletor**; Monitoria como antes; sem WFM enquanto fechado. |
| **Analista de TI** | Seletor Operação · Tecnologia. Tecnologia: Início, Acessos, Sistema, Auditoria, **Escalas e Plantões** (só TI). Monta escala (única que cria). Usuários: **não** consegue criar/editar um Administrador nem trocar o perfil de alguém para Administrador (mensagem de 403). |
| **Técnico (Pleno)** | **Cai direto em Tecnologia, sem seletor**; **não** vê "Escalas e Plantões" com o WFM fechado; com o botão liberado (e novo login) passa a ver só a própria escala. **Não** cria escala. |

**Botão do WFM** (Tecnologia, Administrador ou TI): com a variável de ambiente **definida** o botão fica desabilitado e explica; sem ela, liberar → Operador/Qualidade/Técnico entram de novo e veem Turnos e Plantões; fechar → perdem na hora. Conferir em `logs_auditoria`: `wfm_participantes_alterado` (antes/depois, quem).
**App Android de treinamento:** login por e-mail, lista de treinamentos, concluir item e vídeo continuam funcionando (rotas inalteradas); com RH **desligado** o app segue funcionando.

## 5. Plano de rollback
**Código:** voltar para a versão anterior (`wfm` @ `7f1eff5` ou a imagem anterior). O código antigo ignora as tabelas/colunas novas (tudo aditivo). Todos precisarão entrar de novo (a versão de permissões muda nos dois sentidos).
**Banco (só se precisar desfazer o schema), nesta ordem, com o app parado:**
```
sqlcmd -S <servidor> -d <banco> -E -I -b -i infra\sql\migrations\V057__perfis_ti_administracao.rollback.sql
sqlcmd … -i infra\sql\migrations\V056__modulo_dono_permissoes.rollback.sql
sqlcmd … -i infra\sql\migrations\V055__modulos_sistema.rollback.sql
```
A V058 (acentos) não tem rollback de dados (só troca texto corrompido pelo correto); para voltar, use o backup.
A V057 restaura exatamente o que ela mexeu (linhas ligadas voltam a 0; linhas inseridas são removidas; o log guia). Conferir `COUNT(*)` e checksum de `perfil_permissoes` com o backup. A linha `wfm.liberar_participantes` em `parametros_sistema` (categoria `sistema_interno`) pode ficar (inofensiva) ou ser apagada.
**Sem rollback de banco:** se só a tela der problema, desligar **RH/Operação** em Tecnologia ou, se `GET /core/acesso` falhar, o frontend trata como "sem filtro" e o menu volta ao de antes.

## 6. Riscos e pontos de atenção
- **Todos refazem o login** no deploy. Operador/Qualidade/Técnicos refazem de novo ao abrir o WFM.
- **O banco manda, não o código** (achado da Etapa 2): no DEV o Gestor não tem 10 permissões WFM e o Supervisor 6 que o código lhe dá (edição do Administrador). Em cada ambiente a V057 só mexe nos 4 perfis de TI; nada mais é reescrito.
- Perfis de TI ganham poder amplo de administração: trava de servidor impede mexer no perfil Administrador; tudo é auditado.
- **`sqlcmd` e acentos — CORRIGIDO numa leva à parte** (ver `ACENTOS.md`): `aplicar-migrations.ps1` agora usa `sqlcmd -f 65001` e a nova **V058** repara os textos já gravados com mojibake. Rode `infra\sql\diagnostico_acentos.sql` (somente leitura) antes e depois.
- Falhas de teste **pré-existentes** (não relacionadas): 8 de `test_onedrive_upload_guardrails`, `test_e2e_login_bypass`, `test_lgpd_retencao::test_executar_apaga_so_quem_venceu`, `test_monitoria_fluxo_integration::test_tipos_de_atendimento_pertencem_a_operacao_e_canal`; 5 dos 6 smoke tests de frontend do CI (expectativas antigas).
- `test_trigger_bloqueia_update_e_delete_direto` (monitoria) fica >5 min no SQL Express local; desselecionado nas minhas execuções.

## 7. Pendente para a próxima leva
1. Mover fisicamente RH, Monitoria, Provas e Treinamentos para `modulos/` (frontend) e reorganizar `routers/services/repositories` por módulo; o endpoint `/core/acesso` passar a devolver o mapa tela→permissão para remover `PERMISSOES_TELAS`/`SESSAO_DA_TELA` do controlador.
2. Remover o fallback da variável `RH_WFM_LIBERAR_PARTICIPANTES` (após aprovação).
3. Notificações via Teams e de aprovação do WFM; chamados de suporte (fora de escopo desta leva).
4. Tela de Perfis e Permissões em abas por módulo (hoje: cabeçalhos dentro da árvore existente).
5. Endpoint/indicadores de "acessos negados" e atividade recente na Tecnologia.
6. Corrigir/atualizar os smoke tests de frontend e as 11 falhas de teste pré-existentes.
7. Roteiro do tour guiado específico da Tecnologia; dark mode/mobile da nova UI (não testados).
8. Revisar as permissões do Gestor/Supervisor no DEV (divergência código × banco).

## 2.1 Resultado da suíte (execução final, contra a cópia do DEV)
**757 passam, 11 falham, 5 desselecionados** (3 min 18 s). As 11 falhas são exatamente as pré-existentes e não relacionadas (8 `test_onedrive_upload_guardrails`, `test_e2e_login_bypass`, `test_lgpd_retencao::test_executar_apaga_so_quem_venceu`, `test_monitoria_fluxo_integration::test_tipos_de_atendimento_pertencem_a_operacao_e_canal`). Os 5 desselecionados são `test_trigger_bloqueia_update_e_delete_direto` (lento no SQL Express local).

**Instabilidade conhecida (anterior a esta tarefa):** em 2 de 6 execuções completas a suíte travou por mais de 25 minutos num teste de concorrência do WFM (`test_wfm_integration`, semeio simultâneo com `UPDLOCK, HOLDLOCK` em `wfm_turnos`/`wfm_contratos`: 6 sessões bloqueadas entre si, sem o SQL Server resolver). Reexecutar resolve; os testes de WFM passam isolados (58 em ~2,5 min). Não mexi nesse código; vale uma investigação à parte porque o mesmo padrão pode aparecer com requisições simultâneas reais.
