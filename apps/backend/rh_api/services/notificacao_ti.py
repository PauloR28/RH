"""Avisos de segurança ao TI (Configurações do Conecta › Notificações › aba Avançada; amostra aprovada em 26/nov/2026).

  * Quem recebe: lista de destinatários (nome + e-mail, sem limite). Cada um marca os grupos que recebe na hora
    (Logins, Senhas, Sessões) e se recebe o Resumo do dia. E-mail novo só recebe depois do "Enviar teste".
  * Quais eventos: cada evento escolhe o e-mail ("na_hora", "resumo", "nao") e se avisa no sino do perfil TI.
  * Tudo vai para a Auditoria sempre; aqui só se decide o que TAMBÉM chega por e-mail ou sino.

Guardado em ``dbo.parametros_sistema`` (chave ``notificacao_ti.config``, JSON). Sem a linha, vale o padrão abaixo.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from collections.abc import Callable
from datetime import datetime

logger = logging.getLogger(__name__)

CHAVE = "notificacao_ti.config"
GRUPOS = ("logins", "senhas", "sessoes")
QUANDO = ("na_hora", "resumo", "nao")
_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

# evento -> (grupo, título, descrição, quando padrão, sino padrão, ações da Auditoria que contam no resumo)
EVENTOS: dict[str, tuple[str, str, str, str, bool, tuple[str, ...]]] = {
    "login": ("logins", "Todo login com sucesso", "Cada entrada no Conecta, por login ou Microsoft.", "resumo", False,
              ("login", "login_microsoft")),
    "login_negado": ("logins", "Login negado (senha errada)", "Cada tentativa errada.", "resumo", False, ("login_negado",)),
    "conta_bloqueada": ("logins", "Conta bloqueada", "5 senhas erradas seguidas. Bloqueia 15 minutos.", "na_hora", True,
                        ("conta_bloqueada",)),
    "login_conta_parada": ("logins", "Login de conta desativada ou sem acesso", "Alguém tentou entrar numa conta parada.",
                           "na_hora", True, ("login_conta_parada",)),
    "esqueci_senha": ("senhas", 'Pedido de "Esqueci a senha"', "Inclui para quem a senha provisória ou o código foi enviado.",
                      "na_hora", True, ("senha_esqueci_pedido",)),
    "codigo_errado": ("senhas", "Código errado 5 vezes", "O código foi cancelado.", "na_hora", True,
                      ("senha_codigo_cancelado",)),
    "senha_primeiro_acesso": ("senhas", "Senha criada no 1º acesso", "Depois de senha temporária ou provisória.", "resumo",
                              False, ("trocar_senha_primeiro_acesso",)),
    "senha_trocada": ("senhas", "Senha trocada pela pessoa", "Em Meu perfil ou com o código do e-mail.", "na_hora", True,
                      ("alterar_propria_senha", "senha_recuperada_codigo")),
    "senha_redefinida": ("senhas", "Senha redefinida por um administrador", "Em Tecnologia › Acessos › Usuários.", "na_hora",
                         True, ("redefinir_senha",)),
    "sessao_substituida": ("sessoes", "Conta aberta em outro computador", "A sessão anterior foi encerrada.", "na_hora", True,
                           ("sessao_substituida",)),
    "pedidos_limite": ("sessoes", "Muitos pedidos seguidos", 'Limite de pedidos de "Esqueci a senha" atingido.', "na_hora",
                       True, ("senha_pedidos_limite",)),
}

_TTL = 30.0
_lock = threading.Lock()
_cache: tuple[float, dict] | None = None
_carregador: Callable[[], str | None] | None = None


def padrao() -> dict:
    return {
        "destinatarios": [],
        "sino_ti": True,
        "hora_resumo": "08:00",
        "eventos": {k: {"quando": v[3], "sino": v[4]} for k, v in EVENTOS.items()},
    }


def normalizar(bruto: dict | None) -> dict:
    """Só valores válidos; o que vier errado volta ao padrão. Nunca levanta erro."""
    base = padrao()
    bruto = bruto if isinstance(bruto, dict) else {}
    destinatarios: list[dict] = []
    vistos: set[str] = set()
    for item in bruto.get("destinatarios") or []:
        if not isinstance(item, dict):
            continue
        email = str(item.get("email") or "").strip().lower()
        if not _EMAIL.match(email) or email in vistos:
            continue
        vistos.add(email)
        grupos = item.get("grupos") if isinstance(item.get("grupos"), dict) else {}
        destinatarios.append({
            "nome": str(item.get("nome") or "").strip()[:80] or email,
            "email": email,
            "grupos": {g: bool(grupos.get(g)) for g in GRUPOS},
            "resumo": bool(item.get("resumo")),
            "testado": bool(item.get("testado")),
            "testado_em": str(item.get("testado_em") or "")[:32],
        })
    base["destinatarios"] = destinatarios
    if "sino_ti" in bruto:
        base["sino_ti"] = bool(bruto.get("sino_ti"))
    hora = str(bruto.get("hora_resumo") or "")
    if re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", hora):
        base["hora_resumo"] = hora
    eventos = bruto.get("eventos") if isinstance(bruto.get("eventos"), dict) else {}
    for chave, atual in base["eventos"].items():
        novo = eventos.get(chave) if isinstance(eventos.get(chave), dict) else {}
        if novo.get("quando") in QUANDO:
            atual["quando"] = novo["quando"]
        if "sino" in novo:
            atual["sino"] = bool(novo.get("sino"))
    return base


def _ler_do_banco() -> str | None:
    from ..config import get_settings
    from ..db import get_connection

    conn = get_connection(get_settings(), autocommit=True)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "IF OBJECT_ID('dbo.parametros_sistema', 'U') IS NOT NULL SELECT valor FROM dbo.parametros_sistema WHERE chave = ?",
            (CHAVE,),
        )
        linha = cursor.fetchone() if cursor.description else None
    finally:
        conn.close()
    return str(linha[0]) if linha and linha[0] else None


def ler() -> dict:
    global _cache
    agora = time.monotonic()
    atual = _cache
    if atual is not None and atual[0] > agora:
        return json.loads(json.dumps(atual[1]))
    with _lock:
        try:
            texto = (_carregador or _ler_do_banco)()
            bruto = json.loads(texto) if texto else {}
        except Exception as exc:  # noqa: BLE001 - sem banco: padrão
            logger.info("Configuração dos avisos ao TI indisponível (%s); usando o padrão.", exc)
            bruto = {}
        dados = normalizar(bruto)
        _cache = (agora + _TTL, dados)
        return json.loads(json.dumps(dados))


def invalidar() -> None:
    global _cache
    with _lock:
        _cache = None


def definir_carregador(carregador: Callable[[], str | None] | None) -> None:
    """Só para testes."""
    global _carregador
    _carregador = carregador
    invalidar()


def salvar(cursor, dados: dict, *, ator: str) -> dict:
    """Grava (já normalizado) na transação do chamador. Quem não foi testado continua sem receber até o teste.

    E-mail que já estava testado mantém o teste; e-mail novo ou trocado volta para "Falta testar"."""
    anteriores = {d["email"]: d for d in ler()["destinatarios"]}
    novos = normalizar(dados)
    for d in novos["destinatarios"]:
        antes = anteriores.get(d["email"])
        d["testado"] = bool(antes and antes.get("testado"))
        d["testado_em"] = antes.get("testado_em", "") if antes else ""
    _gravar(cursor, novos, ator=ator)
    return novos


def marcar_testado(cursor, email: str, *, ator: str) -> dict:
    atual = ler()
    alvo = str(email or "").strip().lower()
    for d in atual["destinatarios"]:
        if d["email"] == alvo:
            d["testado"] = True
            d["testado_em"] = datetime.now().strftime("%d/%m às %H:%M")
    _gravar(cursor, atual, ator=ator)
    return atual


def _gravar(cursor, dados: dict, *, ator: str) -> None:
    texto = json.dumps(dados, ensure_ascii=False)
    cursor.execute(
        """
        MERGE dbo.parametros_sistema WITH (HOLDLOCK) AS alvo
        USING (SELECT ? AS chave) AS origem ON alvo.chave = origem.chave
        WHEN MATCHED THEN UPDATE SET valor = ?, atualizado_por = ?, atualizado_em = GETDATE()
        WHEN NOT MATCHED THEN INSERT (chave, valor, categoria, descricao, mascarado, atualizado_por, criado_em, atualizado_em)
            VALUES (?, ?, 'sistema_interno', ?, 0, ?, GETDATE(), GETDATE());
        """,
        (CHAVE, texto, ator, CHAVE, texto, "Avisos de segurança ao TI (Notificações › Avançada).", ator),
    )
    invalidar()


def catalogo() -> list[dict]:
    """Eventos para a tela, na ordem dos grupos."""
    return [
        {"chave": k, "grupo": v[0], "titulo": v[1], "descricao": v[2]}
        for k, v in EVENTOS.items()
    ]


def evento_da_acao(acao: str) -> str | None:
    for chave, v in EVENTOS.items():
        if acao in v[5]:
            return chave
    return None


def destinatarios_na_hora(config: dict, evento: str) -> list[str]:
    grupo = EVENTOS[evento][0]
    return [d["email"] for d in config["destinatarios"] if d["testado"] and d["grupos"].get(grupo)]


def destinatarios_resumo(config: dict) -> list[str]:
    return [d["email"] for d in config["destinatarios"] if d["testado"] and d["resumo"]]


def disparar(repository, cursor, evento: str, dados: dict) -> None:
    """Aviso de UM evento, conforme a configuração. Nunca levanta erro (aviso não pode quebrar login/senha).

    `dados`: conta_nome, conta_login, perfil, operacao, feito_por, motivo, data_hora, ip. O sino entra na transação do
    chamador (cursor); o e-mail sai numa thread depois."""
    try:
        if evento not in EVENTOS:
            return
        config = ler()
        regra = config["eventos"][evento]
        titulo = EVENTOS[evento][1]
        if regra.get("sino") and config.get("sino_ti") and cursor is not None and hasattr(repository, "_criar_notificacao"):
            texto = f"{dados.get('conta_nome') or dados.get('conta_login') or ''}".strip()
            for papel in _perfis_da_ti(cursor):
                repository._criar_notificacao(
                    cursor, destinatario_papel=papel, titulo=f"Segurança: {titulo}", mensagem=texto[:200],
                    categoria="seguranca", entidade="auditoria", entidade_id=str(dados.get("conta_login") or ""),
                )
        if regra.get("quando") != "na_hora":
            return
        para = destinatarios_na_hora(config, evento)
        if not para:
            return
        from . import emails_senha

        modelo = "aviso_ti_bloqueio" if evento == "conta_bloqueada" else "aviso_ti"
        emails_senha.enviar(repository.settings, modelo, para, {"evento": titulo, "link_auditoria": _link_auditoria(repository), **dados})
    except Exception:  # noqa: BLE001
        logger.exception("Falha ao avisar o TI do evento %s.", evento)


def _perfis_da_ti(cursor) -> list[str]:
    """Perfis que atendem o TI (têm `chamados.atender`) mais o Administrador — o mesmo grupo dos chamados."""
    from ..rbac import ROLE_ADMIN

    perfis = {ROLE_ADMIN}
    try:
        cursor.execute(
            "IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL "
            "SELECT id_perfil FROM dbo.perfil_permissoes WHERE chave_permissao = 'chamados.atender' AND permitido = 1"
        )
        if cursor.description:
            perfis |= {str(r[0]).strip() for r in cursor.fetchall() if r[0]}
    except Exception as exc:  # noqa: BLE001 - sem a tabela: só o Administrador recebe
        logger.info("Perfis da TI indisponíveis (%s); avisando só o Administrador.", exc)
    return sorted(perfis)


def _link_auditoria(repository) -> str:
    base = str(getattr(repository.settings, "public_frontend_base_url", "") or "").rstrip("/")
    return f"{base}/configuracoes/senhas-e-acessos" if base else "#"


CHAVE_RESUMO = "notificacao_ti.resumo_enviado_em"


def _hoje_brasilia() -> datetime:
    try:
        from zoneinfo import ZoneInfo

        return datetime.now(ZoneInfo("America/Sao_Paulo")).replace(tzinfo=None)
    except Exception:  # noqa: BLE001
        return datetime.now()


def montar_tabela_resumo(linhas: list[tuple[str, int, int]]) -> str:
    import html

    if not linhas:
        return "<p style=\"margin:0\">Nenhum evento no dia.</p>"
    celula = "padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;"
    corpo = "".join(
        f"<tr><td style=\"{celula}\">{html.escape(ev)}</td><td style=\"{celula}text-align:right\">{ok}</td>"
        f"<td style=\"{celula}text-align:right\">{neg}</td></tr>"
        for ev, ok, neg in sorted(linhas)
    )
    cab = "padding:8px 12px;font-size:12px;text-transform:uppercase;color:#6b7280;"
    return (
        "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;border-collapse:collapse\">"
        f"<tr><th style=\"{cab}text-align:left\">Evento</th><th style=\"{cab}text-align:right\">Deu certo</th>"
        f"<th style=\"{cab}text-align:right\">Negado</th></tr>{corpo}</table>"
    )


def enviar_resumo_se_hora(repository) -> bool:
    """Job a cada 15 min: no horário escolhido, manda UMA vez por dia o resumo do dia anterior.

    Vários processos podem rodar o job; quem marcar a data primeiro (MERGE com condição) é quem envia."""
    from datetime import timedelta

    config = ler()
    para = destinatarios_resumo(config)
    if not para:
        return False
    agora = _hoje_brasilia()
    if agora.strftime("%H:%M") < config["hora_resumo"]:
        return False
    hoje = agora.date().isoformat()
    conn = repository._connect()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            MERGE dbo.parametros_sistema WITH (HOLDLOCK) AS alvo
            USING (SELECT ? AS chave) AS origem ON alvo.chave = origem.chave
            WHEN MATCHED AND ISNULL(alvo.valor, '') <> ? THEN UPDATE SET valor = ?, atualizado_em = GETDATE()
            WHEN NOT MATCHED THEN INSERT (chave, valor, categoria, descricao, mascarado, atualizado_por, criado_em, atualizado_em)
                VALUES (?, ?, 'sistema_interno', 'Último resumo do dia enviado ao TI.', 0, 'sistema', GETDATE(), GETDATE());
            """,
            (CHAVE_RESUMO, hoje, hoje, CHAVE_RESUMO, hoje),
        )
        ganhou = cursor.rowcount > 0
        conn.commit()
    finally:
        conn.close()
    if not ganhou:
        return False
    ontem = agora - timedelta(days=1)
    linhas = repository.resumo_senhas_acessos(ontem)
    from . import emails_senha

    emails_senha.enviar(repository.settings, "resumo_ti", para, {
        "data": ontem.strftime("%d/%m/%Y"),
        "total": str(sum(ok + neg for _, ok, neg in linhas)),
        "tabela_html": montar_tabela_resumo(linhas),
        "link_auditoria": _link_auditoria(repository),
    }, esperar=True)
    return True
