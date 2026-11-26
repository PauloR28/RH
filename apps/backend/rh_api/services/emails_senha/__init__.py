"""E-mails do fluxo de senha (modelos aprovados pelo Paulo em 26/nov/2026).

Os arquivos .html desta pasta são gerados por CONECTA_REBRANDING/27_SENHA_E_ACESSO/ferramentas/montar_emails.mjs (mesmas
cores do tokens.css, escritas dentro do e-mail, porque leitor de e-mail não entende variáveis CSS). A logo vai junto como
anexo embutido (cid), então aparece mesmo sem endereço público do Conecta.

Variáveis `{assim}`: o valor é escapado (HTML); só as chaves terminadas em `_html` entram sem escapar (montadas aqui).
O envio roda numa thread à parte: e-mail lento ou fora do ar nunca segura o login nem a tela.
"""

from __future__ import annotations

import base64
import html
import logging
import re
import threading
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

PASTA = Path(__file__).resolve().parent
CID_LOGO = "conecta-logo"
_VARIAVEL = re.compile(r"{\s*([a-zA-Z0-9_]+)\s*}")

ASSUNTOS = {
    "senha_provisoria_supervisor": "Conecta · Senha provisória para {operador_nome}",
    "codigo_recuperacao": "Conecta · Código para criar sua nova senha",
    "aviso_ti": "[Conecta · Segurança] {evento}: {conta_nome}",
    "aviso_ti_bloqueio": "[Conecta · Segurança] Conta bloqueada: {conta_nome}",
    "aviso_senha_alterada": "Conecta · Sua senha foi alterada",
    "resumo_ti": "[Conecta · Segurança] Resumo de {data}",
    "teste_ti": "[Conecta · Segurança] E-mail de teste",
}


@lru_cache(maxsize=16)
def _modelo(nome: str) -> str:
    return (PASTA / f"{nome}.html").read_text(encoding="utf-8")


@lru_cache(maxsize=1)
def _logo_base64() -> str:
    return base64.b64encode((PASTA / "logo_email_branco.png").read_bytes()).decode("ascii")


def _preencher(texto: str, dados: dict, *, escapar: bool) -> str:
    def trocar(m: re.Match) -> str:
        chave = m.group(1)
        if chave not in dados:
            return "—" if chave != "logo_url" else f"cid:{CID_LOGO}"
        valor = "" if dados[chave] is None else str(dados[chave])
        if chave.endswith("_html") or not escapar:
            return valor
        return html.escape(valor) or "—"

    return _VARIAVEL.sub(trocar, texto)


def montar(nome: str, dados: dict) -> tuple[str, str]:
    """(assunto, corpo_html) do modelo com os dados."""
    dados = {**dados, "logo_url": f"cid:{CID_LOGO}"}
    assunto = _preencher(ASSUNTOS[nome], dados, escapar=False)
    return assunto, _preencher(_modelo(nome), dados, escapar=True)


def _anexo_logo() -> dict:
    return {
        "nome": "conecta.png",
        "mime_type": "image/png",
        "conteudo_base64": _logo_base64(),
        "content_id": CID_LOGO,
    }


def enviar(settings, nome: str, destinatarios: list[str], dados: dict, *, esperar: bool = False) -> bool:
    """Envia o modelo. Sem e-mail configurado ou sem destinatário: só registra no log e devolve False.

    `esperar=True` envia na hora e propaga o erro (usado quando a tela precisa saber se saiu, ex.: Enviar teste e o
    "Esqueci a senha"). Senão, envia numa thread e só registra falhas no log."""
    from ..email_send_service import EmailSendService

    lista = sorted({str(e).strip().lower() for e in destinatarios if str(e or "").strip()})
    servico = EmailSendService(settings)
    if not lista:
        return False
    if not servico.configured:
        logger.warning("E-mail '%s' não enviado: envio de e-mail não configurado no servidor.", nome)
        if esperar:
            from fastapi import HTTPException, status

            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="O envio de e-mail do Conecta não está configurado. Fale com o TI.",
            )
        return False
    assunto, corpo = montar(nome, dados)

    def _mandar() -> None:
        servico.send_mail(destinatarios=lista, assunto=assunto, corpo_html=corpo, anexos=[_anexo_logo()])

    if esperar:
        _mandar()
        return True

    def _seguro() -> None:
        try:
            _mandar()
        except Exception:  # noqa: BLE001 - e-mail nunca derruba o fluxo
            logger.exception("Falha ao enviar o e-mail '%s'.", nome)

    threading.Thread(target=_seguro, name=f"email-{nome}", daemon=True).start()
    return True
