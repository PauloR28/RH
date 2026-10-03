"""Ponto ÚNICO de decisão de acesso por módulo (modularização, Etapa 3).

Responde: "este usuário enxerga/pode usar este módulo e esta permissão?". Rotas (via `dependencies.get_current_user`)
e frontend (via `GET /core/acesso`) consultam só este serviço. O backend garante; o frontend apenas esconde.

Regras (PLANO.md §2.3 e §3):
  * Módulo visível = módulo ativo E o perfil tem >= 1 permissão que "abre" o módulo (`permissoes.abre_modulo`).
    O `core` é sempre ativo e nunca aparece como módulo no seletor.
  * Módulo desativado => as permissões que ele possui (`permissoes.modulo_dono`) deixam de valer NO PEDIDO (sem relogin).
  * `core` e `tecnologia` são protegidos: nunca desativáveis (evita trancar todos para fora).
  * Falha ao ler o estado (tabelas ainda não migradas, banco indisponível) = defaults do catálogo em código, tudo ativo.
    A checagem de permissão em si continua valendo; só a camada nova de módulo é que "falha aberta".
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Iterable

from ..modulos_catalogo import (
    ABRE_MODULO_PADRAO,
    MODULO_CORE,
    MODULOS_PADRAO,
    MODULOS_PROTEGIDOS,
    MODULOS_VALIDOS,
    modulo_dono_padrao,
)

logger = logging.getLogger(__name__)

_TTL_SEGUNDOS = 15.0
_TTL_FALHA_SEGUNDOS = 5.0


@dataclass(frozen=True)
class EstadoModulos:
    """Fotografia do registro de módulos e do dono de cada permissão."""

    ativos: frozenset[str] = frozenset(chave for chave, *_ in MODULOS_PADRAO)
    nomes: dict[str, str] = field(default_factory=lambda: {c: n for c, n, _o, _p in MODULOS_PADRAO})
    ordem: dict[str, int] = field(default_factory=lambda: {c: o for c, _n, o, _p in MODULOS_PADRAO})
    donos: dict[str, str] = field(default_factory=dict)  # permissão -> módulo (só as que o banco definiu)
    abre: dict[str, bool] = field(default_factory=dict)  # permissão -> abre o módulo dono (só as que o banco definiu)
    de_banco: bool = False


_lock = threading.Lock()
_cache: tuple[float, EstadoModulos] | None = None
_carregador: Callable[[], EstadoModulos] | None = None  # injetável nos testes


def _carregar_do_banco() -> EstadoModulos:
    from ..config import get_settings
    from ..db import get_connection

    conn = get_connection(get_settings(), autocommit=True)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT chave, nome, ordem, ativo FROM dbo.modulos_sistema")
        linhas = cursor.fetchall()
        cursor.execute("SELECT chave, modulo_dono, abre_modulo FROM dbo.permissoes WHERE modulo_dono IS NOT NULL")
        permissoes = cursor.fetchall()
    finally:
        conn.close()
    base = EstadoModulos()
    nomes, ordem = dict(base.nomes), dict(base.ordem)
    ativos = set(base.ativos)
    for chave, nome, ordem_linha, ativo in linhas:
        chave = str(chave)
        if chave not in MODULOS_VALIDOS:
            continue
        nomes[chave], ordem[chave] = str(nome), int(ordem_linha or 0)
        if not ativo:
            ativos.discard(chave)
    donos = {str(c): str(d) for c, d, _a in permissoes if str(d) in MODULOS_VALIDOS}
    abre = {str(c): bool(a) for c, d, a in permissoes if str(d) in MODULOS_VALIDOS}
    return EstadoModulos(ativos=frozenset(ativos | MODULOS_PROTEGIDOS), nomes=nomes, ordem=ordem, donos=donos, abre=abre, de_banco=True)


def estado() -> EstadoModulos:
    global _cache
    agora = time.monotonic()
    atual = _cache
    if atual is not None and atual[0] > agora:
        return atual[1]
    with _lock:
        atual = _cache
        if atual is not None and atual[0] > agora:
            return atual[1]
        try:
            carregado = (_carregador or _carregar_do_banco)()
            _cache = (agora + _TTL_SEGUNDOS, carregado)
        except Exception as exc:  # noqa: BLE001 - qualquer falha de leitura cai nos defaults do catálogo
            logger.warning("Estado de módulos indisponível (%s); usando padrões do catálogo (tudo ativo).", exc)
            carregado = EstadoModulos()
            _cache = (agora + _TTL_FALHA_SEGUNDOS, carregado)
        return carregado


def invalidar_cache() -> None:
    """Chamar após qualquer escrita em módulos/donos: o próximo pedido relê o banco."""
    global _cache
    with _lock:
        _cache = None


def definir_carregador(carregador: Callable[[], EstadoModulos] | None) -> None:
    """Só para testes: substitui a leitura do banco."""
    global _carregador
    _carregador = carregador
    invalidar_cache()


# ---------------------------------------------------------------- consultas
def modulo_ativo(modulo: str) -> bool:
    return modulo in MODULOS_PROTEGIDOS or modulo in estado().ativos


def modulo_da_permissao(chave: str, grupo: str = "") -> str:
    """Dono vigente (banco) com fallback no catálogo em código."""
    dono = estado().donos.get(chave)
    if dono:
        return dono
    if not grupo:
        from ..rbac import PERMISSION_DEFINITIONS

        definicao = PERMISSION_DEFINITIONS.get(chave)
        grupo = definicao.module if definicao else ""
    return modulo_dono_padrao(chave, grupo)


def modulo_aberto_por(chave: str) -> str | None:
    """Módulo que esta permissão abre, ou None."""
    est = estado()
    if chave in est.abre:
        return modulo_da_permissao(chave) if est.abre[chave] else None
    return ABRE_MODULO_PADRAO.get(chave)


def filtrar_permissoes(permissoes: Iterable[str]) -> frozenset[str]:
    """Remove as permissões de módulos desativados. Com todos ativos devolve exatamente o mesmo conjunto."""
    todas = frozenset(permissoes)
    est = estado()
    inativos = {chave for chave, *_ in MODULOS_PADRAO} - set(est.ativos) - MODULOS_PROTEGIDOS
    if not inativos:
        return todas
    return frozenset(p for p in todas if modulo_da_permissao(p) not in inativos)


def modulos_visiveis(permissoes: Iterable[str]) -> list[str]:
    """Módulos (exceto core) que o conjunto de permissões abre, módulos ativos, na ordem de exibição."""
    est = estado()
    abertos = {m for p in permissoes if (m := modulo_aberto_por(p)) and m != MODULO_CORE and modulo_ativo(m)}
    return sorted(abertos, key=lambda m: (est.ordem.get(m, 99), m))


def pode(permissoes: Iterable[str], permissao: str) -> bool:
    """Permissão concedida E módulo dono ativo."""
    return permissao in permissoes and modulo_ativo(modulo_da_permissao(permissao))


def descrever(permissoes: Iterable[str]) -> dict:
    """Payload de `GET /core/acesso`: módulos, padrão e permissões efetivas (já sem as de módulos desativados)."""
    efetivas = filtrar_permissoes(permissoes)
    est = estado()
    visiveis = modulos_visiveis(efetivas)
    modulos = [
        {
            "chave": chave,
            "nome": est.nomes.get(chave, nome),
            "ativo": modulo_ativo(chave),
            "protegido": chave in MODULOS_PROTEGIDOS,
            "visivel": chave in visiveis,
        }
        for chave, nome, _o, _p in sorted(MODULOS_PADRAO, key=lambda m: est.ordem.get(m[0], m[2]))
        if chave != MODULO_CORE
    ]
    return {
        "modulos": modulos,
        "modulo_padrao": visiveis[0] if visiveis else MODULO_CORE,
        "permissoes": sorted(efetivas),
    }


# ---------------------------------------------------------------- liberação do WFM (fase de teste)
# Substitui a leitura da variável de ambiente na importação (rbac.py). Valor em `dbo.parametros_sistema`, categoria
# `sistema_interno` (a tela de parâmetros esconde e não deixa editar), alterado pelo botão de Tecnologia com auditoria.
# Enquanto a mudança não for validada em homologação, a variável de ambiente, se DEFINIDA (mesmo vazia), prevalece.
# Para remover o fallback: apagar RH_WFM_LIBERAR_PARTICIPANTES do .env e reiniciar; depois, num commit à parte, apagar
# o ramo `os.environ` de `_ler_ambiente()` (ver HOMOLOGACAO.md).
PARAM_WFM_PARTICIPANTES = "wfm.liberar_participantes"
VAR_AMBIENTE_WFM = "RH_WFM_LIBERAR_PARTICIPANTES"
_VERDADEIROS = {"1", "true", "sim", "yes", "on"}
_TTL_WFM_SEGUNDOS = 5.0

_wfm_cache: tuple[float, bool] | None = None
_wfm_log_emitido = False


def _interpretar(texto: str | None) -> bool:
    return str(texto or "").strip().lower() in _VERDADEIROS


def _ler_ambiente() -> bool | None:
    """None = variável ausente (a configuração do banco decide); valor = variável definida (prevalece)."""
    import os

    bruto = os.environ.get(VAR_AMBIENTE_WFM)
    return None if bruto is None else _interpretar(bruto)


def _ler_banco_wfm(semente: bool) -> bool:
    """Lê a configuração; se a linha não existe, cria com `semente` (valor atual do ambiente) — assim nada muda no dia da
    implantação. INSERT guardado contra requisições simultâneas."""
    from ..config import get_settings
    from ..db import get_connection

    conn = get_connection(get_settings(), autocommit=True)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT valor FROM dbo.parametros_sistema WHERE chave = ?", (PARAM_WFM_PARTICIPANTES,))
        linha = cursor.fetchone()
        if linha is None:
            cursor.execute(
                """
                IF NOT EXISTS (SELECT 1 FROM dbo.parametros_sistema WITH (UPDLOCK, HOLDLOCK) WHERE chave = ?)
                    INSERT INTO dbo.parametros_sistema (chave, valor, categoria, descricao, mascarado, atualizado_por, criado_em, atualizado_em)
                    VALUES (?, ?, 'sistema_interno', ?, 0, 'sistema', GETDATE(), GETDATE())
                """,
                (
                    PARAM_WFM_PARTICIPANTES,
                    PARAM_WFM_PARTICIPANTES,
                    "1" if semente else "0",
                    "Libera o WFM (Turnos e Plantões) para Operador, Técnico de TI e Qualidade (fase de teste).",
                ),
            )
            cursor.execute("SELECT valor FROM dbo.parametros_sistema WHERE chave = ?", (PARAM_WFM_PARTICIPANTES,))
            linha = cursor.fetchone()
        return _interpretar(linha[0] if linha else None)
    finally:
        conn.close()


def wfm_participantes_liberado() -> bool:
    """O WFM está liberado para Operador/Técnico de TI/Qualidade? (ponto ÚNICO de leitura.)

    Ordem: variável de ambiente (se definida) > banco. Falha ao ler o banco = FECHADO (o desenho de hoje quando a variável
    não existe): é mais seguro não abrir o acesso por engano do que abrir."""
    global _wfm_cache, _wfm_log_emitido
    ambiente = _ler_ambiente()
    if ambiente is not None:
        if not _wfm_log_emitido:
            _wfm_log_emitido = True
            try:
                no_banco = _ler_banco_wfm(ambiente)
            except Exception:  # noqa: BLE001
                no_banco = None
            logger.warning(
                "WFM: %s=%s (variável de ambiente) PREVALECE sobre a configuração do banco (%s). "
                "Remova a variável do ambiente para passar o controle ao botão de Tecnologia.",
                VAR_AMBIENTE_WFM,
                int(ambiente),
                "indisponível" if no_banco is None else int(no_banco),
            )
        return ambiente
    agora = time.monotonic()
    atual = _wfm_cache
    if atual is not None and atual[0] > agora:
        return atual[1]
    try:
        valor = _ler_banco_wfm(False)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Configuração de liberação do WFM indisponível (%s); mantendo FECHADO.", exc)
        _wfm_cache = (agora + _TTL_FALHA_SEGUNDOS, False)
        return False
    _wfm_cache = (agora + _TTL_WFM_SEGUNDOS, valor)
    return valor


def invalidar_cache_wfm() -> None:
    global _wfm_cache
    _wfm_cache = None


def situacao_wfm_participantes() -> dict:
    """Para o botão em Tecnologia: valor efetivo, origem e se o botão pode alterar."""
    ambiente = _ler_ambiente()
    try:
        no_banco: bool | None = _ler_banco_wfm(bool(ambiente))
    except Exception:  # noqa: BLE001
        no_banco = None
    return {
        "liberado": ambiente if ambiente is not None else bool(no_banco),
        "origem": "ambiente" if ambiente is not None else "banco",
        "valor_ambiente": ambiente,
        "valor_banco": no_banco,
        "editavel": ambiente is None and no_banco is not None,
    }


def definir_wfm_participantes(valor: bool, *, autor: str) -> dict:
    """Altera a configuração (botão de Tecnologia). Recusa enquanto a variável de ambiente prevalecer: a mudança não teria efeito."""
    from fastapi import HTTPException, status

    from ..config import get_settings
    from ..db import get_connection

    if _ler_ambiente() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A liberação está controlada pela variável de ambiente {VAR_AMBIENTE_WFM}. Remova-a do ambiente para usar este botão.",
        )
    anterior = _ler_banco_wfm(False)
    conn = get_connection(get_settings(), autocommit=True)
    try:
        conn.cursor().execute(
            "UPDATE dbo.parametros_sistema SET valor = ?, atualizado_por = ?, atualizado_em = GETDATE() WHERE chave = ?",
            ("1" if valor else "0", autor[:180], PARAM_WFM_PARTICIPANTES),
        )
    finally:
        conn.close()
    invalidar_cache_wfm()
    return {"valor_anterior": anterior, "valor": bool(valor)}
