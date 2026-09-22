"""Convite de calendário (.ics) para o Outlook do ministrante de um treinamento.

Opção 1 do roadmap (Correções.txt — lembrete de agenda do Outlook): anexa um
convite iCalendar (método REQUEST) ao e-mail já enviado via
``EmailSendService`` (Microsoft Graph sendMail). Não usa a API de calendário
do Graph nem exige nenhuma permissão nova no Azure AD — o Outlook reconhece
o anexo .ics e oferece "Aceitar", que ocupa a agenda do destinatário.
"""

from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
from uuid import uuid4

DURACAO_PADRAO_MINUTOS = 60


def _escapar_ics(texto: str) -> str:
    safe = str(texto or "")
    safe = safe.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
    safe = safe.replace("\r\n", "\\n").replace("\n", "\\n")
    return safe


def _formatar_data_local(momento: datetime) -> str:
    return momento.strftime("%Y%m%dT%H%M%S")


def _formatar_data_utc(momento: datetime) -> str:
    return momento.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def novo_uid() -> str:
    return f"{uuid4()}@conecta.local"


def build_ics_convite(
    *,
    uid: str,
    titulo: str,
    inicio: datetime,
    local: str = "",
    descricao: str = "",
    organizador_email: str,
    organizador_nome: str = "Conecta RH",
    participante_email: str,
    participante_nome: str = "",
    duracao_minutos: int = DURACAO_PADRAO_MINUTOS,
) -> bytes:
    """Gera um convite iCalendar (VEVENT, METHOD:REQUEST) em bytes UTF-8.

    ``inicio`` é tratado como horário local America/Sao_Paulo (sem horário de
    verão desde 2019) — o convite usa TZID explícito, que o Outlook reconhece
    mesmo sem um bloco VTIMEZONE embutido. Sem campo de duração no
    treinamento, usa ``DURACAO_PADRAO_MINUTOS`` como estimativa.
    """
    fim = inicio + timedelta(minutes=max(1, int(duracao_minutos or DURACAO_PADRAO_MINUTOS)))
    agora_utc = datetime.now(timezone.utc)

    linhas = [
        "BEGIN:VCALENDAR",
        "PRODID:-//Conecta RH//Treinamentos//PT-BR",
        "VERSION:2.0",
        "METHOD:REQUEST",
        "CALSCALE:GREGORIAN",
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{_formatar_data_utc(agora_utc)}",
        f"DTSTART;TZID=America/Sao_Paulo:{_formatar_data_local(inicio)}",
        f"DTEND;TZID=America/Sao_Paulo:{_formatar_data_local(fim)}",
        f"SUMMARY:{_escapar_ics(titulo)}",
    ]
    if local:
        linhas.append(f"LOCATION:{_escapar_ics(local)}")
    if descricao:
        linhas.append(f"DESCRIPTION:{_escapar_ics(descricao)}")
    linhas.append(f"ORGANIZER;CN={_escapar_ics(organizador_nome)}:mailto:{organizador_email}")
    linhas.append(
        f"ATTENDEE;CN={_escapar_ics(participante_nome or participante_email)};"
        f"ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:{participante_email}"
    )
    linhas.extend(
        [
            "SEQUENCE:0",
            "STATUS:CONFIRMED",
            "TRANSP:OPAQUE",
            "END:VEVENT",
            "END:VCALENDAR",
        ]
    )
    return ("\r\n".join(linhas) + "\r\n").encode("utf-8")


def build_ics_attachment(*, nome_arquivo: str = "convite.ics", **kwargs) -> dict:
    """Monta o anexo no formato esperado por ``EmailSendService.send_mail``."""
    conteudo = build_ics_convite(**kwargs)
    return {
        "nome": nome_arquivo,
        "mime_type": "text/calendar; charset=utf-8; method=REQUEST",
        "conteudo_base64": base64.b64encode(conteudo).decode("ascii"),
    }
