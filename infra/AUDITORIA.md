# Cobertura da auditoria (logs_auditoria)

Levantamento de 27/set/2026: cada rota que altera dados, exporta ou baixa arquivo foi cruzada com o registro em `logs_auditoria` (feito na rota com `audit_action` ou dentro do repositório). A Monitoria tem log próprio e imutável (`monitoria_logs`).

## Cobertas nesta rodada

| Área | Ações que passaram a ser auditadas |
|---|---|
| Provas (RH) | Recalcular nota, reabrir prova, cancelar prova, decisão do RH |
| Currículos | Análise por IA (caixa de e-mail, processo e ficha do candidato), vincular CV do e-mail a processo, enviar ao banco de talentos, ignorar, editar, adicionar ao processo e descartar pré-análise |
| Novas funções | Transferência de operação, duplicar/ativar formulário, restaurar versão, excluir/restaurar monitoria (em `monitoria_logs`); atribuição de treinamento a usuários/operações; tela inicial por perfil; configuração e execução da retenção LGPD |

## Já cobertas antes

Login (sucesso e falha, local, app e Microsoft), usuários, perfis e permissões, catálogos, download de CV, anonimização, processos e candidatos, e-mails, treinamentos.

## Sem auditoria, por decisão (baixo risco ou já rastreado de outra forma)

| Ação | Motivo |
|---|---|
| Etapas da prova feitas pelo candidato (acesso, iniciar, salvar respostas, finalizar), DISC, Fit Cultural e Raciocínio Lógico | É o próprio candidato agindo; cada passo já fica com data/hora e telemetria na própria prova |
| Marcar notificação como lida ou excluir notificação | Estado pessoal do usuário, sem dado de terceiros |
| Rascunhos de monitoria e prévia de nota | Nada é gravado de forma definitiva; a monitoria realizada é auditada em `monitoria_logs` |
| Imagens do Mural, do Calendário e dos módulos de treinamento; logo da operação; modelo JSON do módulo | Conteúdo institucional, sem dado pessoal |

## Pontos de atenção para uma próxima rodada

- Download de anexo de treinamento (`/onboarding/anexos/{id}/arquivo`): se passarem a ser anexados documentos pessoais, auditar.
- Visualização de listas com dados pessoais (ex.: pré-análises de CV de um processo): hoje só o download e as alterações são auditados, não a consulta.
