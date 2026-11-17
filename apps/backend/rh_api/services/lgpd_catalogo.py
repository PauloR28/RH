"""LGPD › todos os dados sensíveis do Conecta (reestruturação, Etapa 7c — 17/nov/2026).

Regra do Paulo: TODA retenção de dado sensível, de qualquer módulo, é configurada num lugar só (Configurações › LGPD).
Nenhum recurso novo que guarde dado sensível entra no Conecta sem uma linha neste catálogo.

Cada tipo diz onde o dado fica, de quando o prazo conta e o que pode acontecer depois do prazo. Os prazos de cada tipo
ficam em ``dbo.parametros_sistema`` (``lgpd.<id>.ativo|meses|acao``). Tipos sem rotina ainda (``rotina=False``) podem
ser configurados, mas não ligam: a tela mostra "Rotina em construção". Os 3 tipos de candidato continuam usando a
configuração que já existia (``dbo.lgpd_retencao_config``), sem duplicar.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

APAGAR_TUDO = "apagar_tudo"
APAGAR_ARQUIVOS = "apagar_arquivos"
ANONIMIZAR = "anonimizar"
ACOES = {APAGAR_TUDO: "Apagar tudo", APAGAR_ARQUIVOS: "Apagar só arquivos", ANONIMIZAR: "Anonimizar"}


@dataclass(frozen=True)
class TipoDado:
    id: str
    modulo: str  # rh | operacao | tecnologia
    nome: str
    exemplo: str
    base: str  # de quando o prazo conta (texto da tela)
    meses: int  # sugestão; quem decide é o RH/jurídico
    acao: str
    acoes: tuple[str, ...]
    origem: str = "catalogo"  # catalogo | candidatos (config antiga) | seguranca | logs | futuro
    rotina: bool = False  # já existe rotina que aplica a regra?
    tabela: str = ""  # para a contagem da simulação
    coluna_data: str = ""
    filtro: str = ""  # SQL fixo (sem entrada do usuário)
    aviso: str = ""
    extras: dict = field(default_factory=dict)


TIPOS: tuple[TipoDado, ...] = (
    TipoDado("candidaturas", "rh", "Candidaturas e provas", "Ficha, provas, DISC, entrevistas, anotações", "da candidatura",
             24, APAGAR_TUDO, (APAGAR_TUDO,), origem="candidatos", rotina=True),
    TipoDado("banco_talentos", "rh", "Banco de talentos", "Quem ficou guardado para outra vaga", "da entrada no banco",
             36, APAGAR_TUDO, (APAGAR_TUDO,), origem="candidatos", rotina=True),
    TipoDado("cvs_email", "rh", "Currículos da caixa de e-mail", "CVs recebidos que não viraram candidatura, e a análise deles",
             "do recebimento (mesmo prazo das candidaturas)", 24, APAGAR_TUDO, (APAGAR_TUDO,), origem="candidatos", rotina=True),
    TipoDado("monitoria_anexos", "operacao", "Anexos de monitoria", "Prints e arquivos de contestação e plano de ação", "do envio",
             6, APAGAR_ARQUIVOS, (APAGAR_ARQUIVOS,), tabela="monitoria_anexos", coluna_data="criado_em"),
    TipoDado("monitoria_cliente", "operacao", "Cliente atendido na monitoria", "Nome, CPF e contato do cliente", "da monitoria",
             24, ANONIMIZAR, (ANONIMIZAR,), tabela="monitorias", coluna_data="data_monitoria",
             filtro="(nome_cliente IS NOT NULL OR cpf_cliente IS NOT NULL OR contato_cliente IS NOT NULL)",
             aviso="A monitoria é imutável hoje. Anonimizar o cliente precisa de uma exceção a essa regra."),
    TipoDado("diario_intercorrencias", "operacao", "Intercorrências do Diário de bordo", "Texto livre que pode citar cliente",
             "do dia do registro", 24, ANONIMIZAR, (ANONIMIZAR, APAGAR_TUDO), tabela="diario_intercorrencia", coluna_data="inicio"),
    TipoDado("atestados", "operacao", "Atestados (WFM)", "Dado de saúde: período e tipo do afastamento", "do fim do atestado",
             60, APAGAR_TUDO, (APAGAR_TUDO, ANONIMIZAR), tabela="wfm_atestados", coluna_data="data_fim"),
    TipoDado("chamados_anexos", "tecnologia", "Anexos de chamados", "Prints e arquivos enviados ao Suporte TI", "do envio",
             12, APAGAR_ARQUIVOS, (APAGAR_ARQUIVOS,), tabela="chamado_anexos", coluna_data="criado_em", filtro="excluido_em IS NULL"),
    TipoDado("chat_mensagens", "tecnologia", "Chat: mensagens", "Conversas dos canais e diretas", "do envio",
             12, APAGAR_TUDO, (APAGAR_TUDO,), origem="futuro"),
    TipoDado("chat_arquivos", "tecnologia", "Chat: imagens e arquivos", "Tudo que for compartilhado no chat", "do envio",
             3, APAGAR_ARQUIVOS, (APAGAR_ARQUIVOS,), origem="futuro"),
    TipoDado("usuarios_inativos", "tecnologia", "Usuários sem acesso", "Nome, e-mail e telefone de quem não entra mais",
             "do último acesso", 4, APAGAR_TUDO, (APAGAR_TUDO,), origem="seguranca", rotina=True),
    TipoDado("logs", "tecnologia", "Registros de acesso (logs)", "Quem entrou, de onde (IP), o que mudou", "do registro",
             3, APAGAR_TUDO, (APAGAR_TUDO,), origem="logs", rotina=True),
)
POR_ID = {t.id: t for t in TIPOS}
EDITAVEIS = {t.id for t in TIPOS if t.origem == "catalogo"}
PREFIXO = "lgpd."


def padrao(tipo: TipoDado) -> dict:
    return {"ativo": False, "meses": tipo.meses, "acao": tipo.acao}


def normalizar(tipo: TipoDado, bruto: dict) -> dict:
    """Valores válidos. Tipo sem rotina nunca fica ligado (a tela não pode prometer o que não roda)."""
    saida = padrao(tipo)
    if "meses" in bruto and bruto["meses"] not in (None, ""):
        try:
            saida["meses"] = max(1, min(120, int(bruto["meses"])))
        except (TypeError, ValueError):
            pass
    if str(bruto.get("acao") or "") in tipo.acoes:
        saida["acao"] = str(bruto["acao"])
    if "ativo" in bruto:
        saida["ativo"] = str(bruto["ativo"]).strip().lower() in {"1", "true", "sim", "on"} and tipo.rotina
    return saida


def ler(cursor) -> dict[str, dict]:
    cursor.execute(
        "IF OBJECT_ID('dbo.parametros_sistema', 'U') IS NOT NULL "
        "SELECT chave, valor FROM dbo.parametros_sistema WHERE chave LIKE ?",
        (PREFIXO + "%",),
    )
    linhas = cursor.fetchall() if cursor.description else []
    bruto: dict[str, dict] = {}
    for chave, valor in linhas:
        partes = str(chave).split(".")
        if len(partes) == 3:
            bruto.setdefault(partes[1], {})[partes[2]] = valor
    return {t.id: normalizar(t, bruto.get(t.id, {})) for t in TIPOS if t.id in EDITAVEIS}


def salvar(cursor, mudancas: dict[str, dict], *, ator: str) -> dict[str, dict]:
    atuais = ler(cursor)
    for id_tipo, dados in mudancas.items():
        if id_tipo not in EDITAVEIS:
            continue
        tipo = POR_ID[id_tipo]
        novo = normalizar(tipo, {**atuais[id_tipo], **(dados or {})})
        for campo, valor in novo.items():
            texto = ("1" if valor else "0") if isinstance(valor, bool) else str(valor)
            cursor.execute(
                """
                MERGE dbo.parametros_sistema WITH (HOLDLOCK) AS alvo
                USING (SELECT ? AS chave) AS origem ON alvo.chave = origem.chave
                WHEN MATCHED THEN UPDATE SET valor = ?, atualizado_por = ?, atualizado_em = GETDATE()
                WHEN NOT MATCHED THEN INSERT (chave, valor, categoria, descricao, mascarado, atualizado_por, criado_em, atualizado_em)
                    VALUES (?, ?, 'sistema_interno', ?, 0, ?, GETDATE(), GETDATE());
                """,
                (f"{PREFIXO}{id_tipo}.{campo}", texto, ator, f"{PREFIXO}{id_tipo}.{campo}", texto, f"LGPD · {tipo.nome} · {campo}", ator),
            )
        atuais[id_tipo] = novo
    return atuais


def somar_meses(data: datetime, meses: int) -> datetime:
    from .lgpd_retencao import somar_meses as _somar

    return _somar(data, meses)


def contar(cursor, tipo: TipoDado, meses: int, agora: datetime) -> int | None:
    """Quantos registros já passaram do prazo (só leitura). None = sem tabela para contar."""
    if not tipo.tabela or not tipo.coluna_data:
        return None
    cursor.execute("SELECT OBJECT_ID(?)", (f"dbo.{tipo.tabela}",))
    if cursor.fetchone()[0] is None:
        return None
    corte = somar_meses(agora, -int(meses))
    filtro = f" AND {tipo.filtro}" if tipo.filtro else ""
    cursor.execute(f"SELECT COUNT(*) FROM dbo.[{tipo.tabela}] WHERE [{tipo.coluna_data}] < ?{filtro}", (corte,))  # noqa: S608 - nomes fixos do catálogo
    return int(cursor.fetchone()[0])


def descrever(tipo: TipoDado) -> dict:
    return {
        "id": tipo.id, "modulo": tipo.modulo, "nome": tipo.nome, "exemplo": tipo.exemplo, "base": tipo.base,
        "acoes": [{"id": a, "nome": ACOES[a]} for a in tipo.acoes], "origem": tipo.origem, "rotina": tipo.rotina,
        "sugestao_meses": tipo.meses, "aviso": tipo.aviso,
    }
