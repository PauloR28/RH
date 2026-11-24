"""Configurações do Conecta › Segurança (reestruturação, Etapa 7b — amostra aprovada em 17/nov/2026).

Política GLOBAL (o que vale para todo mundo). Configurações pessoais (MFA, e-mail secundário) ficam no perfil de cada
usuário, nunca aqui (regra do Paulo, 17/11).

Guardado em ``dbo.parametros_sistema`` (categoria ``sistema_interno``, chaves ``seguranca.*``). Sem banco ou sem a
linha, vale o padrão abaixo — assim nada muda no dia da implantação além do que está escrito aqui.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable

logger = logging.getLogger(__name__)

# chave -> (padrão, mínimo, máximo, descrição). 0 em "senha_troca_dias" = nunca pede troca.
CAMPOS: dict[str, tuple[int, int, int, str]] = {
    "senha_tamanho_minimo": (8, 8, 64, "Tamanho mínimo da senha (login local)."),
    "senha_troca_dias": (0, 0, 365, "Pede troca de senha a cada N dias (0 = nunca)."),
    "inatividade_bloqueio_dias": (60, 15, 365, "Sem acesso por N dias: o acesso é bloqueado."),
    "inatividade_exclusao_dias": (120, 30, 730, "Sem acesso por N dias: o usuário é excluído (o histórico fica)."),
    "inatividade_aviso_dias": (7, 0, 30, "Avisa a pessoa N dias antes do bloqueio."),
    "sessao_maxima_minutos": (0, 0, 1440, "Tempo máximo de uma sessão; depois pede login de novo (0 = valor do servidor)."),
    "sessao_ociosa_minutos": (60, 5, 480, "Sem uso por N minutos: sai sozinho."),
    "sessao_aviso_minutos": (2, 0, 10, "Avisa N minutos antes de sair por falta de uso."),
}
LIGADOS: dict[str, tuple[bool, str]] = {
    "inatividade_ativa": (True, "Bloqueio e exclusão automáticos por falta de acesso."),
}
PREFIXO = "seguranca."
_TTL = 30.0
_lock = threading.Lock()
_cache: tuple[float, dict] | None = None
_carregador: Callable[[], dict[str, str]] | None = None


def padrao() -> dict:
    return {**{k: v[0] for k, v in CAMPOS.items()}, **{k: v[0] for k, v in LIGADOS.items()}}


def _ler_do_banco() -> dict[str, str]:
    from ..config import get_settings
    from ..db import get_connection

    conn = get_connection(get_settings(), autocommit=True)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "IF OBJECT_ID('dbo.parametros_sistema', 'U') IS NOT NULL "
            "SELECT chave, valor FROM dbo.parametros_sistema WHERE chave LIKE ?",
            (PREFIXO + "%",),
        )
        linhas = cursor.fetchall() if cursor.description else []
    finally:
        conn.close()
    return {str(c)[len(PREFIXO):]: str(v) for c, v in linhas}


def normalizar(bruto: dict) -> dict:
    """Valores válidos (limites aplicados); o que vier errado ou faltar volta ao padrão."""
    saida = padrao()
    for chave, (pad, minimo, maximo, _) in CAMPOS.items():
        if chave in bruto and bruto[chave] not in (None, ""):
            try:
                saida[chave] = max(minimo, min(maximo, int(bruto[chave])))
            except (TypeError, ValueError):
                saida[chave] = pad
    for chave in LIGADOS:
        if chave in bruto and bruto[chave] not in (None, ""):
            saida[chave] = str(bruto[chave]).strip().lower() in {"1", "true", "sim", "on"}
    if 0 < saida["sessao_maxima_minutos"] < 30:
        saida["sessao_maxima_minutos"] = 30
    # A exclusão precisa vir depois do bloqueio.
    if saida["inatividade_exclusao_dias"] <= saida["inatividade_bloqueio_dias"]:
        saida["inatividade_exclusao_dias"] = saida["inatividade_bloqueio_dias"] + 30
    return saida


def ler() -> dict:
    global _cache
    agora = time.monotonic()
    atual = _cache
    if atual is not None and atual[0] > agora:
        return dict(atual[1])
    with _lock:
        try:
            bruto = (_carregador or _ler_do_banco)()
        except Exception as exc:  # noqa: BLE001 - sem banco: padrão
            logger.info("Configuração de segurança indisponível (%s); usando o padrão.", exc)
            bruto = {}
        dados = normalizar(bruto)
        _cache = (agora + _TTL, dados)
        return dict(dados)


def invalidar() -> None:
    global _cache
    with _lock:
        _cache = None


def definir_carregador(carregador: Callable[[], dict[str, str]] | None) -> None:
    """Só para testes."""
    global _carregador
    _carregador = carregador
    invalidar()


def salvar(cursor, dados: dict, *, ator: str) -> dict:
    """Grava os valores (já normalizados) na transação do chamador."""
    novos = normalizar({**ler(), **dados})
    descricoes = {**{k: v[3] for k, v in CAMPOS.items()}, **{k: v[1] for k, v in LIGADOS.items()}}
    for chave, valor in novos.items():
        texto = ("1" if valor else "0") if isinstance(valor, bool) else str(valor)
        cursor.execute(
            """
            MERGE dbo.parametros_sistema WITH (HOLDLOCK) AS alvo
            USING (SELECT ? AS chave) AS origem ON alvo.chave = origem.chave
            WHEN MATCHED THEN UPDATE SET valor = ?, atualizado_por = ?, atualizado_em = GETDATE()
            WHEN NOT MATCHED THEN INSERT (chave, valor, categoria, descricao, mascarado, atualizado_por, criado_em, atualizado_em)
                VALUES (?, ?, 'sistema_interno', ?, 0, ?, GETDATE(), GETDATE());
            """,
            (PREFIXO + chave, texto, ator, PREFIXO + chave, texto, descricoes[chave], ator),
        )
    invalidar()
    return novos


def tamanho_minimo_senha() -> int:
    return int(ler()["senha_tamanho_minimo"])


def mensagem_senha_curta() -> str:
    return f"A nova senha deve ter pelo menos {tamanho_minimo_senha()} caracteres."


def sessao_maxima_minutos(padrao_servidor: int) -> int:
    """Tempo do token: o da tela, se gravado; senão o do servidor (RH_AUTH_TOKEN_TTL_MINUTES)."""
    valor = int(ler()["sessao_maxima_minutos"])
    return valor if valor > 0 else int(padrao_servidor)
