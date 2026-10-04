"""Catálogo de módulos do Conecta (modularização, Etapa 3) — dados puros, sem importar `rbac`.

"Módulo" aqui é o novo conceito (core, rh, operacao, tecnologia). Não confundir com o campo
`PermissionDefinition.module` / `permissoes.modulo`, que é só o *grupo de exibição* ("Candidatos", "WFM"...).

O dono de cada permissão (`modulo_dono`) e se ela "abre" o módulo (`abre_modulo`) têm aqui o valor PADRÃO;
o valor vigente fica em `dbo.permissoes` e pode ser reatribuído em Tecnologia.
"""

from __future__ import annotations

MODULO_CORE = "core"
MODULO_RH = "rh"
MODULO_OPERACAO = "operacao"
MODULO_TECNOLOGIA = "tecnologia"

# Operação interna da equipe de TI no WFM (já semeada pela V051). A tela "Escalas e Plantões" do módulo tecnologia é a do WFM
# filtrada por esta operação; o isolamento real continua no servidor (vínculos em usuarios_operacoes + wfm_scope).
OPERACAO_TI = "TI"

# chave, nome, ordem, protegido (nunca desligável). core e tecnologia são protegidos (decisão 6).
MODULOS_PADRAO: tuple[tuple[str, str, int, bool], ...] = (
    (MODULO_CORE, "Conecta", 0, True),
    (MODULO_RH, "RH", 1, False),
    (MODULO_OPERACAO, "Operação", 2, False),
    (MODULO_TECNOLOGIA, "Tecnologia", 3, True),
)
MODULOS_VALIDOS = frozenset(chave for chave, *_ in MODULOS_PADRAO)
MODULOS_PROTEGIDOS = frozenset(chave for chave, _n, _o, protegido in MODULOS_PADRAO if protegido)

_DONO_POR_GRUPO = {
    "Geral": MODULO_CORE,
    "Notificações": MODULO_CORE,
    "Mural": MODULO_CORE,
    "Vagas": MODULO_RH,
    "Processos": MODULO_RH,
    "Candidatos": MODULO_RH,
    "Entrevistas": MODULO_RH,
    "Provas": MODULO_RH,
    "Documentos": MODULO_RH,
    "Etapas e Trilhas": MODULO_RH,
    "Fit Cultural": MODULO_RH,
    "Templates de Documentos": MODULO_RH,
    "E-mails": MODULO_RH,  # decisão do RH (D-3)
    "OneDrive": MODULO_RH,  # decisão do RH (D-3)
    "Calendário": MODULO_RH,
    "Políticas": MODULO_RH,
    "Onboarding": MODULO_RH,
    "Monitoria": MODULO_OPERACAO,
    "WFM": MODULO_OPERACAO,
    "Configurações": MODULO_TECNOLOGIA,
    "Usuários": MODULO_TECNOLOGIA,
    "Logs": MODULO_TECNOLOGIA,
    "Central de Ajuda": MODULO_TECNOLOGIA,
    "Operações": MODULO_TECNOLOGIA,
    "LGPD": MODULO_TECNOLOGIA,
    "Chamados": MODULO_TECNOLOGIA,
    "Relatórios": MODULO_TECNOLOGIA,  # decisão do RH (D-3); reatribuível, e não abre o módulo (D-8)
}

# Exceções por chave (têm precedência sobre o grupo).
_DONO_POR_CHAVE = {
    # Dado de uso comum: todo perfil precisa listar operações.
    "operacoes.visualizar": MODULO_CORE,
    # Autoatendimento de Treinamentos (D-1) e aplicação pelo Supervisor (D-9): core. Criar/gerenciar = rh.
    "onboarding.visualizar": MODULO_CORE,
    "onboarding.concluir_proprio": MODULO_CORE,
    "onboarding.editar": MODULO_CORE,
    # LGPD operacional é do RH; configurar/anonimizar/exportar ficam em tecnologia.
    "lgpd.visualizar": MODULO_RH,
    "lgpd.registrar_solicitacao": MODULO_RH,
    # Sessões (chaves-mestras por perfil).
    "sessao.curriculos.acessar": MODULO_RH,
    "sessao.processos.acessar": MODULO_RH,
    "sessao.provas.acessar": MODULO_RH,
    "sessao.gestao.acessar": MODULO_CORE,
    "sessao.drive.acessar": MODULO_CORE,
    "sessao.treinamentos.acessar": MODULO_CORE,
    "sessao.monitoria.acessar": MODULO_OPERACAO,
    "sessao.wfm.acessar": MODULO_OPERACAO,
    "sessao.configuracoes.acessar": MODULO_TECNOLOGIA,
}

# Permissões que "abrem" o módulo: com elas (e módulo ativo) o usuário enxerga o módulo (regra D-12).
ABRE_MODULO_PADRAO: dict[str, str] = {
    "sessao.curriculos.acessar": MODULO_RH,
    "sessao.processos.acessar": MODULO_RH,
    "sessao.provas.acessar": MODULO_RH,
    "sessao.monitoria.acessar": MODULO_OPERACAO,
    "sessao.wfm.acessar": MODULO_OPERACAO,
    "configuracoes.visualizar": MODULO_TECNOLOGIA,
    # Chamados: quem abre ou atende enxerga o módulo Tecnologia (o menu é filtrado por permissão dentro dele).
    "chamados.abrir": MODULO_TECNOLOGIA,
    "chamados.atender": MODULO_TECNOLOGIA,
}


def modulo_dono_padrao(chave: str, grupo: str = "") -> str:
    """Dono padrão da permissão. Grupo desconhecido cai em `core` (nunca esconde algo por engano)."""
    if chave in _DONO_POR_CHAVE:
        return _DONO_POR_CHAVE[chave]
    if chave.startswith("sessao."):
        return MODULO_CORE
    return _DONO_POR_GRUPO.get(grupo, MODULO_CORE)


def abre_modulo_padrao(chave: str) -> bool:
    return chave in ABRE_MODULO_PADRAO
