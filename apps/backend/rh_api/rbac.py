from __future__ import annotations

import unicodedata
from dataclasses import dataclass


ROLE_INTERN = "estagiario"
ROLE_DP = "dp"
ROLE_MANAGER = "gestor"
ROLE_RH = "rh"
ROLE_CANDIDATE = "candidato"
ROLE_ADMIN = "administrador"
ROLE_EMPLOYEE = "funcionario"
ROLE_SUPERVISOR = "supervisor"
ROLE_OPERATOR = "operador"
# Vertente Monitoria (promt.txt, rodada 20/set/2026): dois perfis novos.
ROLE_QUALIDADE = "qualidade"
ROLE_CONTROL_DESK = "control_desk"


# Versão do catálogo de permissões embutido nos tokens. Muda quando perfis/permissões
# são reorganizados (ex.: vertente Monitoria, 20/set/2026): tokens emitidos antes
# são recusados (401) e a pessoa entra de novo já com as permissões atuais.
PERMISSIONS_VERSION = "2026-09-22-operador-treinamentos"

ACCESS_DENIED_MESSAGE = "Você não possui permissão para acessar esta área ou executar esta ação."


@dataclass(frozen=True)
class PermissionDefinition:
    key: str
    module: str
    description: str
    critical: bool = False


@dataclass(frozen=True)
class RoleDefinition:
    id: str
    name: str
    level: str
    description: str
    # Perfis mantidos no código/banco por compatibilidade (ex.: o app usa
    # "funcionario") mas que não aparecem nas listas de criação de usuário nem
    # em Perfis e Permissões — o RH definiu o conjunto visível de níveis.
    hidden: bool = False


ROLE_DEFINITIONS: dict[str, RoleDefinition] = {
    ROLE_INTERN: RoleDefinition(
        id=ROLE_INTERN,
        name="Estagiário",
        level="Básico",
        description="Operação principal do processo seletivo.",
    ),
    ROLE_DP: RoleDefinition(
        id=ROLE_DP,
        name="Departamento Pessoal (DP)",
        level="Alto",
        description="Documentação, admissão e substituição operacional do processo seletivo.",
    ),
    ROLE_MANAGER: RoleDefinition(
        id=ROLE_MANAGER,
        name="Gestor",
        level="Avançado",
        description="Decisão, aprovação, análise e acompanhamento.",
    ),
    ROLE_RH: RoleDefinition(
        id=ROLE_RH,
        # Nome exibido "Analista" (o funcionário regular do RH). O identificador
        # interno continua "rh" para não quebrar usuários, tokens e permissões.
        name="Analista",
        level="Avançado",
        description="Operação completa do recrutamento e seleção.",
    ),
    ROLE_CANDIDATE: RoleDefinition(
        id=ROLE_CANDIDATE,
        name="Candidato",
        level="Portal",
        description="Acesso somente aos próprios fluxos públicos e de prova.",
        hidden=True,
    ),
    ROLE_ADMIN: RoleDefinition(
        id=ROLE_ADMIN,
        name="Administrador",
        level="Completo",
        description="Controle total do sistema.",
    ),
    ROLE_EMPLOYEE: RoleDefinition(
        id=ROLE_EMPLOYEE,
        name="Funcionário",
        level="Básico",
        description="Colaborador com acesso de autoatendimento e à Central de Treinamentos.",
        hidden=True,
    ),
    ROLE_SUPERVISOR: RoleDefinition(
        id=ROLE_SUPERVISOR,
        name="Supervisor",
        level="Intermediário",
        description="Acompanhamento de equipe, entrevistas e aplicação de treinamentos.",
    ),
    ROLE_OPERATOR: RoleDefinition(
        id=ROLE_OPERATOR,
        name="Operador",
        level="Básico",
        description="Colaborador operacional com acesso de autoatendimento, à Central de Treinamentos e às próprias monitorias.",
    ),
    ROLE_QUALIDADE: RoleDefinition(
        id=ROLE_QUALIDADE,
        name="Qualidade",
        level="Intermediário",
        description="Analista de Qualidade: realiza monitorias, aplica feedback e acompanha a qualidade das operações vinculadas.",
    ),
    ROLE_CONTROL_DESK: RoleDefinition(
        id=ROLE_CONTROL_DESK,
        name="Control Desk",
        level="Intermediário",
        description="Visualiza dashboards e relatórios de qualidade de todas as operações, cada uma identificada por tag.",
    ),
}


def _permission(
    key: str,
    module: str,
    description: str,
    *,
    critical: bool = False,
) -> PermissionDefinition:
    return PermissionDefinition(
        key=key,
        module=module,
        description=description,
        critical=critical,
    )


PERMISSION_DEFINITIONS: dict[str, PermissionDefinition] = {
    item.key: item
    for item in (
        _permission("inicio.visualizar", "Geral", "Acessar página inicial e resumo do dia."),
        _permission("dashboard.visualizar", "Geral", "Visualizar dashboard e indicadores iniciais."),
        _permission("notificacoes.visualizar", "Notificações", "Visualizar notificações permitidas."),
        _permission(
            "notificacoes.configurar",
            "Notificações",
            "Configurar eventos, destinatários e regras de alerta.",
            critical=True,
        ),
        _permission("vagas.visualizar", "Vagas", "Visualizar vagas e processos seletivos."),
        _permission("vagas.solicitar_abertura", "Vagas", "Solicitar abertura de vaga."),
        _permission("vagas.criar", "Vagas", "Criar vaga ou processo seletivo.", critical=True),
        _permission("vagas.editar", "Vagas", "Editar vaga ou processo seletivo.", critical=True),
        _permission("vagas.editar_limitado", "Vagas", "Editar dados limitados da vaga."),
        _permission("vagas.pausar", "Vagas", "Pausar vaga.", critical=True),
        _permission("vagas.encerrar", "Vagas", "Encerrar vaga com confirmação.", critical=True),
        _permission("vagas.cancelar", "Vagas", "Cancelar vaga com justificativa.", critical=True),
        _permission("vagas.excluir", "Vagas", "Excluir vaga quando permitido.", critical=True),
        _permission("processos.visualizar", "Processos", "Visualizar processos seletivos."),
        _permission("processos.criar", "Processos", "Criar processo seletivo.", critical=True),
        _permission("processos.editar", "Processos", "Editar processo seletivo.", critical=True),
        _permission("processos.excluir", "Processos", "Excluir processo seletivo.", critical=True),
        _permission("candidatos.visualizar", "Candidatos", "Visualizar candidatos permitidos."),
        _permission("candidatos.criar", "Candidatos", "Cadastrar candidato manualmente."),
        _permission("candidatos.editar", "Candidatos", "Editar dados do candidato.", critical=True),
        _permission("candidatos.editar_basico", "Candidatos", "Editar dados básicos do candidato."),
        _permission("candidatos.editar_admissional", "Candidatos", "Editar dados admissionais do candidato."),
        _permission("candidatos.excluir", "Candidatos", "Excluir candidato quando permitido.", critical=True),
        _permission("candidatos.anonimizar", "Candidatos", "Anonimizar candidato.", critical=True),
        _permission("candidatos.avaliar_curriculo", "Candidatos", "Avaliar currículo e dar nota."),
        _permission("candidatos.baixar_curriculo", "Candidatos", "Baixar currículo quando permitido."),
        _permission("candidatos.consultar_historico", "Candidatos", "Consultar histórico do candidato."),
        _permission("candidatos.mover_etapa", "Candidatos", "Mover candidato entre etapas operacionais.", critical=True),
        _permission("candidatos.aprovar_operacional", "Candidatos", "Aprovar candidato para etapa operacional."),
        _permission("candidatos.aprovar_final", "Candidatos", "Aprovar candidato final.", critical=True),
        _permission("candidatos.eliminar", "Candidatos", "Eliminar candidato com motivo obrigatório.", critical=True),
        _permission("candidatos.reverter_eliminacao", "Candidatos", "Reverter eliminação com log.", critical=True),
        _permission("candidatos.alterar_nota", "Candidatos", "Alterar nota final consolidada.", critical=True),
        _permission("candidatos.dados_sensiveis", "Candidatos", "Acessar dados sensíveis autorizados."),
        _permission("entrevistas.visualizar", "Entrevistas", "Visualizar entrevistas."),
        _permission("entrevistas.criar", "Entrevistas", "Agendar entrevista."),
        _permission("entrevistas.editar", "Entrevistas", "Reagendar ou editar entrevista."),
        _permission("entrevistas.cancelar", "Entrevistas", "Cancelar entrevista com motivo.", critical=True),
        _permission("entrevistas.marcar_presenca", "Entrevistas", "Marcar presença ou ausência."),
        _permission("entrevistas.avaliar", "Entrevistas", "Avaliar entrevista e registrar parecer."),
        _permission("entrevistas.configurar", "Entrevistas", "Configurar tipos, horários e lembretes.", critical=True),
        _permission("provas.visualizar", "Provas", "Visualizar provas e resultados."),
        _permission("provas.enviar", "Provas", "Enviar prova ao candidato."),
        _permission("provas.corrigir", "Provas", "Corrigir prova manual quando permitido.", critical=True),
        _permission("provas.criar", "Provas", "Criar prova.", critical=True),
        _permission("provas.editar", "Provas", "Editar prova.", critical=True),
        _permission("provas.excluir", "Provas", "Excluir ou desativar prova.", critical=True),
        _permission("provas.questoes_criar", "Provas", "Criar questão.", critical=True),
        _permission("provas.questoes_editar", "Provas", "Editar questão.", critical=True),
        _permission("provas.questoes_excluir", "Provas", "Excluir ou desativar questão.", critical=True),
        _permission("provas.configurar_criterios", "Provas", "Alterar critérios de aprovação.", critical=True),
        _permission("provas.configurar_pesos", "Provas", "Alterar pesos de etapas e provas.", critical=True),
        _permission("documentos.visualizar", "Documentos", "Visualizar documentos permitidos."),
        _permission("documentos.solicitar", "Documentos", "Solicitar documentos usando pacotes prontos."),
        _permission("documentos.marcar_recebido", "Documentos", "Marcar documento como recebido ou pendente."),
        _permission("documentos.validar", "Documentos", "Validar documentos oficialmente.", critical=True),
        _permission("documentos.recusar", "Documentos", "Recusar documentos com motivo.", critical=True),
        _permission("documentos.reenvio", "Documentos", "Solicitar reenvio de documentos."),
        _permission("documentos.configurar", "Documentos", "Configurar tipos e pacotes documentais.", critical=True),
        _permission("emails.enviar_modelo", "E-mails", "Enviar e-mail usando modelos aprovados."),
        _permission("emails.enviar_livre", "E-mails", "Enviar e-mail livre quando permitido."),
        _permission("emails.configurar_modelos", "E-mails", "Configurar modelos de e-mail.", critical=True),
        _permission("onedrive.visualizar", "OneDrive", "Visualizar e navegar no repositório de arquivos M365."),
        _permission("onedrive.upload", "OneDrive", "Enviar (upload) arquivos para o repositório M365."),
        _permission("onedrive.excluir", "OneDrive", "Excluir arquivos ou pastas do repositório M365.", critical=True),
        _permission("configuracoes.visualizar", "Configurações", "Visualizar configurações globais."),
        _permission("configuracoes.editar", "Configurações", "Editar configurações globais.", critical=True),
        _permission("usuarios.visualizar", "Usuários", "Listar e consultar usuários."),
        _permission("usuarios.criar", "Usuários", "Cadastrar ou adicionar usuário.", critical=True),
        _permission("usuarios.editar", "Usuários", "Editar usuário.", critical=True),
        _permission("usuarios.excluir", "Usuários", "Excluir ou desativar usuário.", critical=True),
        _permission("usuarios.ativar", "Usuários", "Ativar usuário.", critical=True),
        _permission("usuarios.desativar", "Usuários", "Desativar usuário.", critical=True),
        _permission("usuarios.bloquear", "Usuários", "Bloquear usuário.", critical=True),
        _permission("usuarios.desbloquear", "Usuários", "Desbloquear usuário.", critical=True),
        _permission("usuarios.redefinir_senha", "Usuários", "Definir ou redefinir senha.", critical=True),
        _permission("usuarios.alterar_email", "Usuários", "Definir, alterar ou redefinir e-mail.", critical=True),
        _permission("usuarios.alterar_perfil", "Usuários", "Definir ou alterar perfil.", critical=True),
        _permission("usuarios.ver_logs", "Usuários", "Consultar logs de acesso de usuários."),
        _permission("lgpd.visualizar", "LGPD", "Consultar informações LGPD permitidas."),
        _permission("lgpd.registrar_solicitacao", "LGPD", "Registrar solicitação LGPD operacional.", critical=True),
        _permission("lgpd.configurar", "LGPD", "Configurar aviso de privacidade e retenção.", critical=True),
        _permission("lgpd.anonimizar", "LGPD", "Executar anonimização.", critical=True),
        _permission("lgpd.exportar_dados", "LGPD", "Exportar dados pessoais.", critical=True),
        _permission("logs.visualizar", "Logs", "Visualizar logs de auditoria."),
        _permission("logs.exportar", "Logs", "Exportar logs de auditoria.", critical=True),
        _permission("relatorios.visualizar", "Relatórios", "Visualizar relatórios."),
        _permission("relatorios.exportar", "Relatórios", "Exportar relatórios.", critical=True),
        _permission("etapas.configurar", "Etapas e Trilhas", "Configurar etapas do processo.", critical=True),
        _permission("trilhas.configurar", "Etapas e Trilhas", "Configurar trilhas de avaliação.", critical=True),
        _permission("politicas.visualizar", "Políticas", "Visualizar políticas institucionais cadastradas."),
        _permission(
            "politicas.editar",
            "Políticas",
            "Cadastrar ou editar políticas institucionais.",
            critical=True,
        ),
        _permission("calendario.visualizar", "Calendário", "Visualizar datas comemorativas cadastradas."),
        _permission(
            "calendario.editar",
            "Calendário",
            "Cadastrar, editar ou remover datas comemorativas.",
            critical=True,
        ),
        _permission("onboarding.visualizar", "Onboarding", "Visualizar trilhas de onboarding e o progresso do checklist do candidato."),
        _permission(
            "onboarding.editar",
            "Onboarding",
            "Cadastrar/editar trilhas de onboarding, iniciar onboarding e marcar itens do checklist.",
            critical=True,
        ),
        _permission(
            "onboarding.criar",
            "Onboarding",
            "Criar treinamentos novos pelo assistente da Central de Treinamentos.",
            critical=True,
        ),
        _permission(
            "onboarding.gerenciar",
            "Onboarding",
            "Acessar a área de Gestão de Treinamento (editar existentes, histórico de presença, relatórios).",
            critical=True,
        ),
        _permission(
            "onboarding.configurar_acesso",
            "Onboarding",
            "Configurar quem pode criar/gerenciar treinamentos na Central de Treinamentos.",
            critical=True,
        ),
        _permission(
            "onboarding.concluir_proprio",
            "Onboarding",
            "Marcar como concluído um módulo do próprio treinamento (app do colaborador).",
        ),
        _permission("documentos_templates.visualizar", "Templates de Documentos", "Visualizar templates e gerar documentos a partir deles."),
        _permission(
            "documentos_templates.editar",
            "Templates de Documentos",
            "Cadastrar ou editar templates de documentos.",
            critical=True,
        ),
        _permission(
            "documentos_biblioteca.visualizar",
            "Central de Ajuda",
            "Visualizar e baixar documentos da biblioteca (Central de Ajuda). Somente Administrador.",
            critical=True,
        ),
        _permission(
            "documentos_biblioteca.editar",
            "Central de Ajuda",
            "Cadastrar, editar ou remover documentos da biblioteca (Central de Ajuda). Somente Administrador.",
            critical=True,
        ),
        _permission("fit_cultural.visualizar", "Fit Cultural", "Visualizar valores da empresa e resultados de fit cultural dos candidatos."),
        _permission(
            "fit_cultural.editar",
            "Fit Cultural",
            "Cadastrar/editar valores e frases de fit cultural.",
            critical=True,
        ),
        _permission(
            "operacoes.visualizar",
            "Operações",
            "Visualizar operações cadastradas (usadas em processos, provas e treinamentos).",
        ),
        _permission("mural.visualizar", "Mural", "Visualizar o feed de avisos e comunicados do Mural."),
        _permission(
            "mural.criar",
            "Mural",
            "Criar publicações no Mural (texto, imagens e envio para intranets).",
            critical=True,
        ),
        _permission(
            "mural.editar",
            "Mural",
            "Editar, fixar/desafixar e arquivar publicações do Mural.",
            critical=True,
        ),
        _permission(
            "mural.excluir",
            "Mural",
            "Excluir publicações do Mural.",
            critical=True,
        ),
        _permission("sessao.curriculos.acessar", "Sessões", "Acessar a sessão Caixa de Currículos."),
        _permission("sessao.processos.acessar", "Sessões", "Acessar a sessão Processos."),
        _permission("sessao.provas.acessar", "Sessões", "Acessar a sessão Provas."),
        _permission("sessao.gestao.acessar", "Sessões", "Acessar a sessão Gestão."),
        _permission("sessao.drive.acessar", "Sessões", "Acessar a sessão Drive."),
        _permission("sessao.treinamentos.acessar", "Sessões", "Acessar a sessão Treinamentos."),
        _permission("sessao.configuracoes.acessar", "Sessões", "Acessar a sessão Configurações."),
        _permission("sessao.monitoria.acessar", "Sessões", "Acessar a sessão Monitoria."),
        _permission("monitoria.visualizar", "Monitoria", "Consultar monitorias dentro do escopo de operação/equipe do perfil."),
        _permission("monitoria.criar", "Monitoria", "Realizar (registrar) novas monitorias.", critical=True),
        _permission("monitoria.feedback_aplicar", "Monitoria", "Aplicar feedback em monitorias pendentes.", critical=True),
        _permission("monitoria.contestar", "Monitoria", "Confirmar, contestar e replicar as próprias monitorias (Operador).", critical=True),
        _permission("monitoria.reanalisar", "Monitoria", "Reanalisar contestações (manter ou anular a monitoria).", critical=True),
        _permission("monitoria.dashboard", "Monitoria", "Ver o dashboard de qualidade no escopo permitido."),
        _permission("monitoria.relatorios", "Monitoria", "Consultar relatórios de monitorias, qualidade e planos de ação."),
        _permission("monitoria.exportar", "Monitoria", "Exportar monitorias e relatórios (XLSX/CSV) e compartilhar por e-mail.", critical=True),
        _permission("monitoria.plano_acao", "Monitoria", "Criar e revisar planos de ação de operadores.", critical=True),
        _permission("monitoria.plano_acao_visualizar", "Monitoria", "Visualizar planos de ação dentro do escopo."),
        _permission("monitoria.logs", "Monitoria", "Consultar os logs de auditoria da Monitoria (escopo da operação).", critical=True),
        _permission("monitoria.matriz", "Monitoria", "Criar e editar formulários (matriz) versionados por operação.", critical=True),
        _permission("monitoria.equipes", "Monitoria", "Gerenciar equipes, turnos, canais e tipos de atendimento.", critical=True),
        _permission("monitoria.configurar", "Monitoria", "Acessar a Central de Monitoria nas Configurações (SLAs, guia, zona de risco).", critical=True),
        _permission("monitoria.usuarios", "Monitoria", "Criar/editar usuários subordinados na hierarquia da Monitoria.", critical=True),
    )
}


OPERATIONAL_SELECTION_PERMISSIONS = {
    "inicio.visualizar",
    "dashboard.visualizar",
    "notificacoes.visualizar",
    "vagas.visualizar",
    "processos.visualizar",
    "candidatos.visualizar",
    "candidatos.criar",
    "candidatos.editar",
    "candidatos.editar_basico",
    "candidatos.avaliar_curriculo",
    "candidatos.baixar_curriculo",
    "candidatos.consultar_historico",
    "candidatos.mover_etapa",
    "candidatos.aprovar_operacional",
    "candidatos.eliminar",
    "entrevistas.visualizar",
    "entrevistas.criar",
    "entrevistas.editar",
    "entrevistas.cancelar",
    "entrevistas.marcar_presenca",
    "provas.visualizar",
    "provas.enviar",
    "provas.corrigir",
    "documentos.visualizar",
    "documentos.solicitar",
    "documentos.marcar_recebido",
    "emails.enviar_modelo",
    "operacoes.visualizar",
    "mural.visualizar",
}


DOCUMENTATION_PERMISSIONS = {
    "documentos.visualizar",
    "documentos.solicitar",
    "documentos.marcar_recebido",
    "documentos.validar",
    "documentos.recusar",
    "documentos.reenvio",
    "candidatos.editar_admissional",
    "lgpd.visualizar",
    "lgpd.registrar_solicitacao",
    "relatorios.visualizar",
    "relatorios.exportar",
    "onedrive.visualizar",
    "onedrive.upload",
}


ROLE_PERMISSIONS: dict[str, set[str]] = {
    ROLE_INTERN: set(OPERATIONAL_SELECTION_PERMISSIONS),
    ROLE_DP: set(OPERATIONAL_SELECTION_PERMISSIONS) | set(DOCUMENTATION_PERMISSIONS),
    ROLE_MANAGER: {
        "inicio.visualizar",
        "dashboard.visualizar",
        "notificacoes.visualizar",
        "vagas.visualizar",
        "vagas.solicitar_abertura",
        "vagas.criar",
        "vagas.editar_limitado",
        "vagas.pausar",
        "vagas.encerrar",
        "vagas.cancelar",
        "processos.visualizar",
        "candidatos.visualizar",
        "candidatos.avaliar_curriculo",
        "candidatos.baixar_curriculo",
        "candidatos.consultar_historico",
        "candidatos.mover_etapa",
        "candidatos.aprovar_operacional",
        "candidatos.aprovar_final",
        "candidatos.eliminar",
        "candidatos.reverter_eliminacao",
        "entrevistas.visualizar",
        "entrevistas.criar",
        "entrevistas.editar",
        "entrevistas.cancelar",
        "entrevistas.avaliar",
        "provas.visualizar",
        "emails.enviar_modelo",
        "relatorios.visualizar",
        "relatorios.exportar",
        "lgpd.visualizar",
        "onedrive.visualizar",
        "operacoes.visualizar",
        "mural.visualizar",
        # Prompt.txt (rodada 06/set/2026): Gestor precisa ver e criar
        # treinamentos na Central de Treinamentos — faltava por completo
        # (achado da auditoria em docs/central-treinamentos/00-auditoria-inicial.md §3).
        "onboarding.visualizar",
        "onboarding.criar",
        "onboarding.gerenciar",
    },
    ROLE_RH: set(OPERATIONAL_SELECTION_PERMISSIONS)
    | {
        "candidatos.aprovar_final",
        "candidatos.reverter_eliminacao",
        "entrevistas.avaliar",
        "provas.criar",
        "provas.editar",
        "relatorios.visualizar",
        "relatorios.exportar",
        "notificacoes.configurar",
        "politicas.visualizar",
        "politicas.editar",
        "calendario.visualizar",
        "calendario.editar",
        "onboarding.visualizar",
        "onboarding.editar",
        "onboarding.criar",
        "onboarding.gerenciar",
        "documentos_templates.visualizar",
        "documentos_templates.editar",
        "fit_cultural.visualizar",
        "fit_cultural.editar",
        "provas.questoes_criar",
        "provas.questoes_editar",
        "provas.questoes_excluir",
        "onedrive.visualizar",
        "onedrive.upload",
        "onedrive.excluir",
        "emails.enviar_livre",
        "emails.configurar_modelos",
        "mural.criar",
        "mural.editar",
        "mural.excluir",
    },
    ROLE_CANDIDATE: set(),
    ROLE_ADMIN: set(PERMISSION_DEFINITIONS.keys()),
    ROLE_EMPLOYEE: {
        "inicio.visualizar",
        "notificacoes.visualizar",
        "onboarding.visualizar",
        # Promt.txt (app mobile "Conecta App"): colaborador conclui os
        # próprios módulos, nunca os de terceiros (auto-escopo na rota).
        "onboarding.concluir_proprio",
        "mural.visualizar",
    },
    # Correções.txt (22/set/2026): o Operador volta a acessar a Central de
    # Treinamentos, mas só como autoatendimento dos PRÓPRIOS treinamentos
    # atribuídos (mesmo nível do ROLE_EMPLOYEE acima) — sem onboarding.criar/
    # editar/gerenciar, que ficam exclusivos de quem administra a área. A
    # sessão-mestra "treinamentos" volta a ser concedida automaticamente pelo
    # loop de SESSION_MODULES logo abaixo. O front-end (Início por sessões e
    # app-treinamento-colaborador) só mostra a div/tela quando GET
    # /onboarding/meus-treinamentos devolve algum treinamento atribuído.
    ROLE_OPERATOR: {
        "inicio.visualizar",
        "notificacoes.visualizar",
        "mural.visualizar",
        "onboarding.visualizar",
        "onboarding.concluir_proprio",
    },
    ROLE_SUPERVISOR: {
        # Correções.txt (rodada 16/set/2026): visão do Supervisor é
        # obrigatoriamente a Central de Treinamentos — sem "inicio.visualizar"
        # nem "mural.visualizar" o topo do menu para de listar Início/Mural
        # (o link de Calendário já não era concedido a este perfil).
        "dashboard.visualizar",
        "notificacoes.visualizar",
        "candidatos.visualizar",
        "processos.visualizar",
        "entrevistas.visualizar",
        "entrevistas.marcar_presenca",
        "onboarding.visualizar",
        "onboarding.editar",
        "operacoes.visualizar",
    },
}


SCREEN_PERMISSIONS: dict[str, str] = {
    "screen-menu": "inicio.visualizar",
    "screen-email-inbox": "candidatos.criar",
    "screen-history": "candidatos.consultar_historico",
    "screen-process-create": "vagas.criar",
    "screen-processes": "vagas.visualizar",
    "screen-processes-open": "vagas.visualizar",
    "screen-processes-closed": "vagas.visualizar",
    "screen-process-decisions": "vagas.visualizar",
    "screen-candidates": "candidatos.visualizar",
    "screen-candidate-details": "candidatos.visualizar",
    "screen-candidate-pipeline": "candidatos.mover_etapa",
    "screen-process-details": "processos.visualizar",
    "screen-interviews": "entrevistas.visualizar",
    "screen-analysis-candidates": "relatorios.visualizar",
    "screen-talent-bank": "candidatos.visualizar",
    "screen-training": "onboarding.visualizar",
    "screen-training-trilhas": "onboarding.visualizar",
    "screen-training-mine": "onboarding.visualizar",
    "screen-training-assignments": "onboarding.visualizar",
    "screen-training-create": "onboarding.criar",
    "screen-training-manage": "onboarding.gerenciar",
    "screen-onedrive-files": "onedrive.visualizar",
    "screen-mural": "mural.visualizar",
    "screen-settings": "configuracoes.visualizar",
    "screen-settings-users": "usuarios.visualizar",
    "screen-settings-profiles": "configuracoes.visualizar",
    "screen-settings-logs": "logs.visualizar",
    "screen-settings-policies": "politicas.editar",
    "screen-settings-onboarding": "onboarding.editar",
    "screen-settings-document-templates": "documentos_templates.editar",
    "screen-settings-operations": "configuracoes.visualizar",
    "screen-settings-catalog": "configuracoes.visualizar",
    "screen-settings-administracao": "configuracoes.visualizar",
    "screen-provas-configuracao": "configuracoes.visualizar",
    "screen-generated-exams": "provas.visualizar",
    "screen-process-analytical-results": "provas.visualizar",
    "screen-config": "provas.enviar",
    "screen-candidate": "provas.enviar",
    "screen-exam": "provas.enviar",
    "screen-result": "provas.visualizar",
    "screen-thanks": "provas.enviar",
}


# ---------------------------------------------------------------------------
# Vertente Monitoria (promt.txt, rodada 20/set/2026)
# ---------------------------------------------------------------------------
# Permissões-base (escopo padrão) dos perfis na Central de Monitoria. Tudo é
# editável pelo Administrador em Perfis e Permissões; o que o docx chama de
# "conforme permissão" fica DESLIGADO por padrão.
_MONITORIA_READ = {"sessao.monitoria.acessar", "monitoria.visualizar", "monitoria.dashboard", "monitoria.relatorios", "monitoria.plano_acao_visualizar"}
_MONITORIA_ROLE_PERMISSIONS: dict[str, set[str]] = {
    # Gestor: leitura total + exportar (todas as operações; escopo aplicado no serviço).
    ROLE_MANAGER: _MONITORIA_READ | {"monitoria.exportar"},
    ROLE_SUPERVISOR: _MONITORIA_READ
    | {
        "inicio.visualizar",  # Início por sessões (Treinamentos + Monitorias)
        "monitoria.criar",
        "monitoria.feedback_aplicar",
        "monitoria.reanalisar",
        "monitoria.exportar",
        "monitoria.plano_acao",
        "monitoria.logs",
        "monitoria.equipes",
        "monitoria.usuarios",
        "operacoes.visualizar",
    },
    ROLE_QUALIDADE: _MONITORIA_READ
    | {
        "inicio.visualizar",
        "notificacoes.visualizar",
        "monitoria.criar",
        "monitoria.feedback_aplicar",
        "monitoria.exportar",
        "monitoria.plano_acao",
        "monitoria.usuarios",
        "operacoes.visualizar",
    },
    ROLE_CONTROL_DESK: _MONITORIA_READ
    | {
        "inicio.visualizar",
        "notificacoes.visualizar",
        "monitoria.exportar",
        "operacoes.visualizar",
    },
    # Correções.txt (21/set/2026): o Operador vê apenas "Minhas monitorias" e o histórico das
    # PRÓPRIAS monitorias — sem Dashboard nem Planos de ação.
    ROLE_OPERATOR: {
        "sessao.monitoria.acessar",
        "monitoria.visualizar",
        "monitoria.contestar",
    },
}
for _role_id, _perms in _MONITORIA_ROLE_PERMISSIONS.items():
    ROLE_PERMISSIONS.setdefault(_role_id, set()).update(_perms)

# Sessões do Conecta (Perfis e Permissões: uma chave-mestra liga/desliga a
# sessão inteira para o nível). Perfis existentes recebem a chave das sessões
# em que já possuem alguma permissão (sem regressão de acesso); o Administrador
# ajusta depois.
SESSION_MODULES: dict[str, set[str]] = {
    "curriculos": {"Candidatos", "Vagas"},
    "processos": {"Processos", "Entrevistas", "Etapas e Trilhas"},
    "provas": {"Provas", "Fit Cultural"},
    "gestao": {"Relatórios", "Calendário"},
    "drive": {"OneDrive", "Documentos"},
    "treinamentos": {"Onboarding"},
    "configuracoes": {"Configurações", "Usuários", "LGPD", "E-mails", "Templates de Documentos", "Central de Ajuda", "Logs", "Políticas"},
}
# O Supervisor trabalha em Treinamentos e Monitoria (promt.txt §3.3): as sessões de RH
# (Caixa de Currículos e Processos) não são liberadas por padrão; o Administrador pode ligar.
_SESSOES_NAO_PADRAO = {ROLE_SUPERVISOR: {"curriculos", "processos"}}
for _role_id, _perms in list(ROLE_PERMISSIONS.items()):
    if _role_id in (ROLE_ADMIN, ROLE_CANDIDATE):
        continue
    for _session_id, _modules in SESSION_MODULES.items():
        if _session_id in _SESSOES_NAO_PADRAO.get(_role_id, ()):
            continue
        if any(
            PERMISSION_DEFINITIONS[key].module in _modules
            for key in _perms
            if key in PERMISSION_DEFINITIONS
        ):
            _perms.add(f"sessao.{_session_id}.acessar")

SCREEN_PERMISSIONS.update(
    {
        "screen-monitoria": "monitoria.visualizar",
        "screen-monitoria-nova": "monitoria.criar",
        "screen-monitoria-feedback": "monitoria.feedback_aplicar",
        "screen-monitoria-contestacoes": "monitoria.reanalisar",
        "screen-monitoria-minhas": "monitoria.contestar",
        "screen-monitoria-dashboard": "monitoria.dashboard",
        "screen-monitoria-relatorios": "monitoria.relatorios",
        "screen-monitoria-planos": "monitoria.plano_acao_visualizar",
        "screen-monitoria-formularios": "monitoria.matriz",
        "screen-settings-monitoria": "monitoria.configurar",
        "screen-settings-monitoria-equipes": "monitoria.equipes",
        "screen-settings-monitoria-logs": "monitoria.logs",
    }
)


SETTINGS_CATALOGS: dict[str, dict[str, str]] = {
    "geral": {"table": "configuracoes_sistema", "label": "Geral"},
    "lgpd": {"table": "configuracoes_lgpd", "label": "LGPD e Retenção"},
    "motivos_eliminacao": {"table": "motivos_eliminacao", "label": "Motivos de eliminação"},
    "modelos_email": {"table": "modelos_email", "label": "Modelos de e-mail"},
    "etapas": {"table": "etapas", "label": "Etapas do processo"},
    "operacoes": {"table": "operacoes", "label": "Operações"},
}
# Correções.txt item 5: "Status dos candidatos", "Tipos de documentos",
# "Pacotes documentais", "Trilhas de avaliação", "Questões" e "Regras de
# notificação" foram removidos deste catálogo — auditoria confirmou que
# nenhum tinha código lendo essas tabelas fora deste próprio mecanismo
# genérico (o bootstrap simplesmente para de criar/tocar essas tabelas;
# dados existentes não são apagados fisicamente). "lgpd", "motivos_
# eliminacao", "modelos_email" e "etapas" continuam aqui (mesmas tabelas,
# mesmos endpoints) mas ganharam páginas dedicadas no frontend — ver
# apps/frontend/fonte/features/catalogo-dedicado/index.js — em vez do
# switcher interno de Operações.


def normalize_role_id(value: str | None) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""

    normalized = "".join(
        char
        for char in unicodedata.normalize("NFD", text)
        if unicodedata.category(char) != "Mn"
    )
    normalized = normalized.replace(" ", "_").replace("-", "_")

    aliases = {
        "estagiario": ROLE_INTERN,
        "estagiario_nivel_basico": ROLE_INTERN,
        "dp": ROLE_DP,
        "departamento_pessoal": ROLE_DP,
        "gestor": ROLE_MANAGER,
        "administrador": ROLE_ADMIN,
        "admin": ROLE_ADMIN,
        "rh": ROLE_RH,
        "candidato": ROLE_CANDIDATE,
        "funcionario": ROLE_EMPLOYEE,
        "colaborador": ROLE_EMPLOYEE,
        "supervisor": ROLE_SUPERVISOR,
        "operador": ROLE_OPERATOR,
        "analista": ROLE_RH,
        "qualidade": ROLE_QUALIDADE,
        "analista_de_qualidade": ROLE_QUALIDADE,
        "control_desk": ROLE_CONTROL_DESK,
        "controldesk": ROLE_CONTROL_DESK,
    }
    return aliases.get(normalized, normalized)


def get_role_definition(role_id: str | None) -> RoleDefinition:
    return ROLE_DEFINITIONS.get(normalize_role_id(role_id), ROLE_DEFINITIONS[ROLE_ADMIN])


def get_role_permissions(role_id: str | None) -> set[str]:
    return set(ROLE_PERMISSIONS.get(normalize_role_id(role_id), set()))


def is_known_permission(permission: str | None) -> bool:
    return str(permission or "").strip() in PERMISSION_DEFINITIONS


def is_critical_permission(permission: str | None) -> bool:
    definition = PERMISSION_DEFINITIONS.get(str(permission or "").strip())
    return bool(definition and definition.critical)


def sanitize_permissions(permissions: list[str] | set[str] | tuple[str, ...] | None) -> set[str]:
    return {
        item
        for item in (str(value or "").strip() for value in (permissions or []))
        if item in PERMISSION_DEFINITIONS
    }
