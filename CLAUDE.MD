# Projeto Conecta - Padrões Profissionais de Interface (UI)

## Regras de Design (Anti-Estética de IA)

- **Visual SaaS Moderno**: Evite gradientes genéricos, sombras pesadas e o visual padrão "Bootstrap".
- **Sistema de Grade de 8px**: Use uma convenção de espaçamento onde todas as dimensões (margens, preenchimentos, lacunas) são múltiplos de 8 pixels (8px, 16px, 24px, etc.) para garantir consistência visual.
- **Espaço em Branco (White Space)**: Aumente o "respiro" entre os elementos (microspace e macrospace) para melhorar o foco na ação do usuário e reduzir a distração.
- **Hierarquia Tipográfica**: Use pesos e tamanhos de fonte distintos para separar claramente títulos, subtítulos e corpo de texto, facilitando a leitura.
- **Componentes**: Utilize bordas sutis (1px), sombras suaves e cantos arredondados consistentes (entre 6px e 8px).
- **Cores**: Mantenha uma paleta sóbria e limitada, focada na legibilidade dos dados.

## Restrições Técnicas e Segurança

- **Modo padrão (ajustes de UI)**: para pedidos de ajuste visual/estético, é proibido alterar rotas de backend, lógica de banco de dados ou funcionalidades existentes. As alterações devem se limitar estritamente a classes CSS/Tailwind ou estruturas visuais de componentes.
- **Trabalho full-stack autorizado explicitamente**: quando o usuário solicitar explicitamente uma nova funcionalidade/integração full-stack (ex.: integração Microsoft 365), é permitido criar/alterar rotas de backend, serviços, migrations de banco e RBAC, desde que:
  - a implementação siga os padrões arquiteturais já existentes no Conecta (camadas `routers/services/repositories/schemas` em `apps/backend/rh_api/`, SQL puro via `pyodbc`, migrations idempotentes em `infra/sql/migrations/`);
  - funcionalidades e rotas já existentes não sejam reescritas, removidas ou comportamento alterado sem necessidade;
  - toda mudança seja auditável e verificada de ponta a ponta (backend, frontend, permissões, menu) antes de ser considerada concluída.
- **Identidade visual**: novos componentes de UI devem seguir as Regras de Design acima; não alterar o design de telas já existentes.
- **Eficiência de Tokens**: Retorne apenas as alterações necessárias (estilo diff) ou substitua blocos específicos de código. Não gere arquivos inteiros desnecessariamente.

### Exceção autorizada: roadmap de expansão (respostas.txt)

As regras acima continuam valendo como padrão para qualquer manutenção, correção de bug ou tarefa não relacionada ao roadmap. Para as ideias explicitamente aprovadas pelo RH em `respostas.txt` (categorias "Pode aplicar" e "Pode aplicar mas com alteração", registradas no relatório `Correções Conecta`), o RH autorizou pontualmente ir além de UI quando a ideia exigir:

- Novas rotas de backend, lógica de negócio e alterações de schema/banco, desde que aditivas (novas tabelas/colunas) e sem quebrar rotas, dados ou fluxos já existentes.
- Nova infraestrutura leve quando a própria ideia pedir (ex.: Redis para cache/fila, Playwright para testes), desde que documentada e opcional/degradável (o sistema deve continuar funcionando sem essas peças, caso não estejam disponíveis no ambiente).
- Identidade visual e padrões de design continuam obrigatórios (grade de 8px, sem gradiente genérico, cores sóbrias) mesmo para as telas novas.

Fora do escopo do roadmap aprovado em respostas.txt, a restrição original de "zero alteração lógica / só UI" continua em vigor.

### Exceção estendida: próxima evolução (respostas.txt, rodada de 25/ago/2026)

A mesma exceção acima é estendida às novas frentes descritas na rodada seguinte de `respostas.txt` (Central de Treinamentos, entidade "Operação" cascateando por Provas/Processos/Treinamentos, expansão de Configurações, redesign do Drive-Conecta, sistema de notificações e relacionamento entre usuários), sob as mesmas condições: aditivo, sem quebrar rotas/dados/fluxos existentes, seguindo os padrões arquiteturais já em uso.

Ressalva de segurança explícita: o pedido de tornar credenciais do arquivo `.env` (segredos, chaves de API, senhas) editáveis pela UI **não é implementado como pedido literalmente** — segredos de infraestrutura não devem transitar em texto plano por tela alguma. Configurações de negócio (catálogos, regras, cadastros) continuam liberadas para virar UI de administração.

Os dois aplicativos móveis (Conecta mobile e Central de Treinamento mobile) tiveram a produção pausada pelo próprio RH nesta rodada — não devem ser iniciados até nova instrução.

### Nova convenção de arquivos de roadmap (a partir de 27/ago/2026)

O arquivo `respostas.txt` foi descontinuado e seu conteúdo migrado para `Correções.txt`. A partir desta data, o roadmap é mantido em dois arquivos na raiz do projeto:

- **`Prompt.txt`**: ideias e implementações novas (o conteúdo é substituído a cada nova rodada; o que já foi tratado sai daqui).
- **`Correções.txt`**: ajustes, correções de bugs e o backlog de ideias aprovadas ("Pode aplicar" / "Pode aplicar mas com alteração") registradas no relatório `Correções Conecta`.

As menções a `respostas.txt` nas seções acima são histórico das rodadas em que foram aprovadas; o conteúdo equivalente hoje vive em `Correções.txt`, sob as mesmas condições (aditivo, sem quebrar rotas/dados/fluxos existentes).

### Exceção estendida: redesign da tela inicial e novas funcionalidades (Prompt.txt, rodada de 27/ago/2026) — CONCLUÍDA

> Rodada já implementada (ver commit `ff3c3ba`, "Aplica novo design da tela inicial, avatares ilustrados, disponibilidade de horarios..."). A pasta `docs/Desing/` continha os assets brutos de referência (imagens/paleta) usados nesta rodada e não existe mais no repositório — já foi consumida; não é uma referência quebrada a corrigir, é material de entrada já processado. Achado DOC-003 do [programa de evolução do Conecta](connecta-evolution/README.md) verificado e fechado.

A mesma exceção segue valendo para o pedido descrito em `Prompt.txt` desta rodada: aplicar o novo design da tela inicial (assets de referência que estiveram em `docs/Desing/`, já consumidos), com as seguintes frentes full-stack autorizadas:

- Nova etapa de "disponibilidade de horários" na criação de processo seletivo, gerando slots (com ou sem horário definido) integrados ao agendamento de Entrevistas/Calendário já existente.
- Sistema de avatares ilustrados como foto de perfil (aditivo — usuário sem avatar escolhido continua com o avatar de iniciais atual).
- Aba "Ambiente" em Configurações (modo escuro, ativar tour guiado, escolher avatar, configurar notificações).

Mesmas condições de sempre: aditivo, sem quebrar rotas/dados/fluxos existentes, seguindo os padrões arquiteturais já em uso e a identidade visual (grade de 8px, sem gradiente genérico, cores sóbrias).


### Exceção estendida: vertente Monitoria (promt.txt, rodada de 20/set/2026)

O RH autorizou explicitamente a nova vertente **Monitoria** (Central de Monitoria) no mesmo nível de App, Centro de Treinamentos e Conecta Provas, incluindo alterações full-stack (novas tabelas/migrations V037–V038, rotas `/monitoria/*`, RBAC, perfis Qualidade e Control Desk, escopo por operação, tela inicial por sessões, tema/logo por operação). Condições mantidas: aditivo, sem quebrar rotas/dados/fluxos existentes, padrões de `routers/services/repositories/schemas`, SQL puro via `pyodbc`, identidade visual do Conecta (grade de 8px, sem gradiente, cores sóbrias). Regras de domínio inegociáveis: monitoria realizada é IMUTÁVEL (trigger de banco + sem rotas de update/delete + testes), "Baixada" foi renomeada para "Anulada", todo indicador usa o motor único `services/monitoria_indicadores.py`, e a Zona de Risco da Monitoria só altera configuração. Estado e decisões da rodada: `MONITORIA_PROGRESSO.md`. Os apps móveis continuam fora do escopo desta rodada.
