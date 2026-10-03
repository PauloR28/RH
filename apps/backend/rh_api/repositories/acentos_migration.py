"""Reparo de acentos gravados com mojibake pelas migrations antigas (V058). Fonte ÚNICA: `render_migration_sql()` gera
`infra/sql/migrations/V058__corrige_acentos_seeds.sql` (um teste garante que coincidem) e `render_diagnostico_sql()` gera
`infra/sql/diagnostico_acentos.sql` (somente leitura).

Causa: `aplicar-migrations.ps1` rodava `sqlcmd` sem `-f 65001`; ele leu os arquivos UTF-8 na página de código ANSI do Windows
(1252) e gravou "ã" (bytes C3 A3) como os dois caracteres "Ã£". Só 5 migrations semeiam texto acentuado em dados:
V001/V024 (perfis), V009 (trilha padrão de onboarding), V036 (motivos de eliminação) e V051 (tipos de escala da TI).

O reparo é por IGUALDADE EXATA com o texto corrompido (nunca toca em valor que alguém editou) e escrito só com ASCII
(NCHAR), imune à codificação do arquivo. Aditivo no sentido de não apagar nada que não seja duplicata gerada pela própria
V036 (ver `_dedup_motivos`)."""

from __future__ import annotations

# (tabela, coluna, texto correto)
TEXTOS_SEMEADOS: tuple[tuple[str, str, str], ...] = (
    ("perfis", "nivel", "Avançado"),
    ("perfis", "nivel", "Básico"),
    ("perfis", "nivel", "Intermediário"),
    ("perfis", "nome", "Funcionário"),
    ("perfis", "descricao", "Operação completa de recrutamento e seleção."),
    ("perfis", "descricao", "Acesso aos próprios fluxos."),
    ("perfis", "descricao", "Colaborador com acesso de autoatendimento e à Central de Treinamentos."),
    ("perfis", "descricao", "Acompanhamento de equipe, entrevistas e aplicação de treinamentos."),
    ("perfis", "descricao", "Colaborador operacional com acesso de autoatendimento e à Central de Treinamentos."),
    ("trilhas_onboarding", "nome", "Trilha padrão de onboarding"),
    ("trilhas_onboarding", "descricao", "Trilha inicial sugerida pelo RH. Edite os itens conforme a necessidade da operação."),
    ("trilhas_onboarding_itens", "titulo", "Documentação admissional"),
    ("trilhas_onboarding_itens", "titulo", "Apresentação da equipe"),
    ("trilhas_onboarding_itens", "titulo", "Treinamento inicial da operação"),
    ("trilhas_onboarding_itens", "titulo", "Alinhamento de metas do primeiro mês"),
    ("trilhas_onboarding_itens", "descricao", "Coletar e validar os documentos exigidos para a admissão."),
    ("trilhas_onboarding_itens", "descricao", "Criar usuário, e-mail e acessos aos sistemas internos."),
    ("trilhas_onboarding_itens", "descricao", "Apresentar o novo colaborador ao time e aos líderes diretos."),
    ("trilhas_onboarding_itens", "descricao", "Entregar crachá, equipamentos e materiais de trabalho."),
    ("motivos_eliminacao", "nome", "Candidato não compareceu"),
    ("motivos_eliminacao", "nome", "Optou por não prosseguir"),
    ("motivos_eliminacao", "nome", "Baixa aderência a vaga"),
    ("motivos_eliminacao", "nome", "Não atendeu aos requisitos"),
    ("wfm_tipos_escala", "nome", "Plantão de sábado"),
    ("wfm_tipos_escala", "descricao", "Escala de plantão de sábado da equipe de TI."),
)

# Perfis de motivos de eliminação semeados pela V036 (chave -> nome correto), para a deduplicação.
CHAVES_MOTIVOS = ("candidato_nao_compareceu", "optou_nao_prosseguir", "baixa_aderencia_vaga", "nao_atendeu_requisitos")


def mojibake(texto: str) -> str:
    """Como o sqlcmd (página de código 1252) gravou o texto UTF-8: cada byte vira um caractere."""
    return texto.encode("utf-8").decode("cp1252")


def nstr(texto: str) -> str:
    """Literal NVARCHAR 100% ASCII (acentos viram NCHAR)."""
    partes, atual = [], ""
    for ch in texto:
        if ord(ch) < 128:
            atual += ch.replace("'", "''")
        else:
            if atual:
                partes.append(f"N'{atual}'")
                atual = ""
            partes.append(f"NCHAR({ord(ch)})")
    if atual or not partes:
        partes.append(f"N'{atual}'")
    return " + ".join(partes)


def _updates() -> list[str]:
    instrucoes = []
    for tabela, coluna, correto in TEXTOS_SEMEADOS:
        errado = mojibake(correto)
        assert errado != correto
        instrucoes.append(
            f"IF OBJECT_ID('dbo.{tabela}', 'U') IS NOT NULL AND COL_LENGTH('dbo.{tabela}', '{coluna}') IS NOT NULL\n"
            f"    UPDATE dbo.{tabela} SET {coluna} = {nstr(correto)} WHERE {coluna} COLLATE Latin1_General_BIN2 = {nstr(errado)};"
        )
    return instrucoes


def _dedup_motivos() -> str:
    """A V036 checava só o NOME: com o texto corrompido (ou já semeado pelo aplicativo) ela inseriu uma linha a mais por motivo.
    Depois do reparo, remove a cópia mais nova que ficou idêntica (mesma chave e nome), apenas se NUNCA foi usada."""
    return (
        "IF OBJECT_ID('dbo.motivos_eliminacao', 'U') IS NOT NULL\n"
        "    DELETE m FROM dbo.motivos_eliminacao m\n"
        "    WHERE m.usado = 0\n"
        "      AND m.chave IN (" + ", ".join(f"N'{c}'" for c in CHAVES_MOTIVOS) + ")\n"
        "      AND EXISTS (SELECT 1 FROM dbo.motivos_eliminacao o WHERE o.chave = m.chave AND o.nome = m.nome AND o.id_item < m.id_item);"
    )


def statements() -> list[str]:
    return _updates() + [_dedup_motivos()]


def render_migration_sql() -> str:
    cabecalho = (
        "-- Conecta - V058: corrige textos acentuados semeados com mojibake pelas migrations antigas (sqlcmd sem -f 65001).\n"
        "-- Igualdade exata com o texto corrompido (nao altera o que foi editado), 100% ASCII, idempotente. Remove apenas\n"
        "-- duplicatas de motivos de eliminacao criadas pela propria V036 e nunca usadas. Gerada de\n"
        "-- rh_api/repositories/acentos_migration.py.\n\n"
    )
    return cabecalho + "\n\n".join(statements()) + "\n"


def render_rollback_sql() -> str:
    return (
        "-- Rollback da V058: nao ha o que desfazer. A migration so troca texto corrompido pelo texto correto; restaurar o\n"
        "-- mojibake nao e desejavel. Para voltar ao estado anterior use o backup feito antes do deploy.\n"
        "SELECT 'V058 nao tem rollback de dados; restaure o backup se necessario.' AS aviso;\n"
    )


def render_diagnostico_sql() -> str:
    """Consulta SOMENTE LEITURA: procura mojibake (UTF-8 lido como ANSI/OEM) nas colunas de texto das tabelas de seeds e
    de catálogos. Padroes: caractere 195 (A-til, cp1252), 194 e 9500 (cp850), comparados em colacao binaria (a padrao ignora acentos)."""
    tabelas = sorted({(t, c) for t, c, _ in TEXTOS_SEMEADOS} | {("motivos_eliminacao", "descricao"), ("operacoes", "nome")})
    selects = []
    for tabela, coluna in tabelas:
        selects.append(
            f"IF OBJECT_ID('dbo.{tabela}', 'U') IS NOT NULL AND COL_LENGTH('dbo.{tabela}', '{coluna}') IS NOT NULL\n"
            f"    SELECT '{tabela}.{coluna}' AS onde, COUNT(*) AS suspeitos FROM dbo.{tabela}\n"
            f"    WHERE {coluna} COLLATE Latin1_General_BIN2 LIKE N'%[' + NCHAR(195) + NCHAR(194) + NCHAR(9500) + N']%';"
        )
    return (
        "-- Diagnostico de mojibake (SOMENTE LEITURA). Rode com: sqlcmd -S <srv> -d <banco> -E -I -f 65001 -i infra\\sql\\diagnostico_acentos.sql\n"
        "-- Cada linha traz quantos registros da coluna tem caracteres tipicos de UTF-8 lido como ANSI (A-til, A-circunflexo) ou OEM (caixa de desenho).\n"
        "-- Gerado de rh_api/repositories/acentos_migration.py.\n\n" + "\n\n".join(selects) + "\n"
    )
