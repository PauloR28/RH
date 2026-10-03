# Acentos nas migrations (sqlcmd) — verificação e correção

## O problema (reproduzido)
`infra/scripts/powershell/aplicar-migrations.ps1` chamava `sqlcmd` **sem `-f 65001`**. Os arquivos `.sql` são UTF-8 sem BOM; o `sqlcmd` os leu na página de código ANSI do Windows (1252) e gravou cada byte como um caractere: `ã` (C3 A3) virou `Ã£`, `ç` virou `Ã§`, `ê` virou `Ãª`. Reproduzido em duas situações num banco de teste (cópia do DEV):
1. **Banco que já tinha os motivos de eliminação (semeados pelo aplicativo):** a V036 só checa o *nome*; com o nome corrompido a checagem não bateu e ela **inseriu uma cópia a mais de cada um dos 4 motivos**, com o texto quebrado ("Candidato nÃ£o compareceu"). 7 → 11 linhas.
2. **Banco em que a V036 foi a primeira a semear:** as 4 linhas nascem corrompidas.
Só **5 das 13 migrations** com acento têm texto acentuado em *dados* (as outras 8 só em comentários): V001 e V024 (perfis), V009 (trilha padrão de onboarding e 6 itens), V036 (4 motivos de eliminação) e V051 (tipos de escala da TI). A conferência é automática (`test_o_reparo_cobre_todos_os_textos…`): qualquer literal acentuado novo sem reparo derruba o teste.

## O que foi corrigido
1. **`aplicar-migrations.ps1`**: `-f 65001` nas duas chamadas (login integrado e usuário/senha). Também protege migrations futuras.
2. **V058 `corrige_acentos_seeds`** (`infra/sql/migrations`, gerada de `rh_api/repositories/acentos_migration.py`):
   - troca o texto corrompido pelo correto, **por igualdade exata em colação binária** (24 pares tabela/coluna/texto) — nunca toca em texto que alguém editou;
   - 100% ASCII (acentos via `NCHAR`), imune à codificação do arquivo;
   - remove **apenas** a cópia mais nova de motivo de eliminação que ficou idêntica (mesma chave e nome) **e nunca foi usada** (`usado = 0`) — as duplicatas criadas pela própria V036;
   - idempotente; **sem rollback de dados** (restaurar mojibake não é desejável; use o backup).
3. **`infra/sql/diagnostico_acentos.sql`**: consulta *somente leitura* que conta, por tabela/coluna, registros com caracteres típicos de UTF-8 lido como ANSI (A-til/A-circunflexo) ou OEM (caixa de desenho), em colação binária. Rode antes e depois do deploy.

## Verificação feita
- **Banco de teste (cópia do DEV) com a situação 1** (7 corretos + 4 corrompidos): o script corrigido aplicou as **58 migrations** com sucesso; ficaram 7 motivos, todos corretos (bytes conferidos: `ê` = 00EA, `ã` = 00E3), diagnóstico zerado.
- **Situação 2** (só linhas corrompidas, como se a V036 tivesse semeado sozinha): depois do script, 4 motivos corretos (a V036 com `-f` insere as corretas, a V058 conserta as corrompidas e a deduplicação remove a cópia nova — fica a mais antiga, já corrigida).
- Rodar o script **de novo**: 58 migrations ok, continua 7 linhas (sem duplicar).
- **DEV real (`RH_Provas`)**: diagnóstico **limpo** (zero suspeitos). O DEV foi semeado pelo aplicativo, não pelo `sqlcmd`, por isso nunca teve o problema. **Não consegui consultar homologação nem produção**: lá é que o risco existe, principalmente nos motivos de eliminação (V036) e nas descrições dos perfis (V001/V024).
- Testes: `test_acentos_migration.py` (6): geração = arquivos, ASCII, o mojibake gerado é o observado no banco, cobertura de todos os literais acentuados, igualdade exata + `usado = 0`, as duas chamadas do `sqlcmd` com `-f 65001`.

## O que ficou fora (e por quê)
- **Dados de negócio já gravados com o texto quebrado** (ex.: o motivo de eliminação *escolhido* para um candidato quando a lista mostrava a opção corrompida, nomes de operação criados via migration…): o diagnóstico só varre as tabelas de seeds. Se aparecerem suspeitos em outras tabelas, trate caso a caso — a mesma técnica (`COLLATE Latin1_General_BIN2` + igualdade exata) serve.
- **Outra página de código:** o reparo assume a página 1252 (a observada). Em um servidor com outra página ANSI/OEM o mojibake seria diferente (ex.: `├`); o diagnóstico procura os dois padrões, mas a V058 só repara o 1252. Nesse caso, avise e geramos a variante.
- Os arquivos `infra/sql/seeds|security|backup/*.sql` têm acentos só em mensagens de erro/comentários; sem impacto em dados.
