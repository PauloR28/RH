"""Testes do convite de calendário (.ics) para o ministrante de um
treinamento (Correções.txt — lembrete de agenda do Outlook).

Testes puros (sem tocar banco de dados real), no mesmo espírito de
`test_central_treinamentos.py`."""

from __future__ import annotations

import base64
import sys
from datetime import datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from rh_api.schemas.onboarding import OcorrenciaTreinamentoInput
from rh_api.services.calendar_invite import build_ics_attachment, build_ics_convite, novo_uid


def test_ocorrencia_aceita_sem_email_do_ministrante():
    ocorrencia = OcorrenciaTreinamentoInput(data_prevista=datetime(2026, 10, 1, 9, 0))
    assert ocorrencia.ministrante_email == ""


def test_ocorrencia_aceita_email_valido_do_ministrante():
    ocorrencia = OcorrenciaTreinamentoInput(
        data_prevista=datetime(2026, 10, 1, 9, 0),
        ministrante="Fulano de Tal",
        ministrante_email="fulano@empresa.com",
    )
    assert ocorrencia.ministrante_email == "fulano@empresa.com"


def test_ocorrencia_duracao_padrao_e_uma_hora():
    ocorrencia = OcorrenciaTreinamentoInput(data_prevista=datetime(2026, 10, 1, 9, 0))
    assert ocorrencia.duracao_minutos == 60


@pytest.mark.parametrize("minutos", [10, 20, 30, 60, 90, 120])
def test_ocorrencia_aceita_duracoes_do_select(minutos):
    ocorrencia = OcorrenciaTreinamentoInput(data_prevista=datetime(2026, 10, 1, 9, 0), duracao_minutos=minutos)
    assert ocorrencia.duracao_minutos == minutos


def test_ocorrencia_rejeita_duracao_fora_do_select():
    with pytest.raises(ValidationError) as excinfo:
        OcorrenciaTreinamentoInput(data_prevista=datetime(2026, 10, 1, 9, 0), duracao_minutos=45)
    erros = excinfo.value.errors()
    assert any(erro["loc"] == ("duracao_minutos",) for erro in erros)


def test_ocorrencia_rejeita_email_invalido_do_ministrante():
    with pytest.raises(ValidationError) as excinfo:
        OcorrenciaTreinamentoInput(data_prevista=datetime(2026, 10, 1, 9, 0), ministrante_email="nao-e-email")
    erros = excinfo.value.errors()
    assert any(erro["loc"] == ("ministrante_email",) for erro in erros)


def test_build_ics_convite_gera_vevent_com_campos_essenciais():
    conteudo = build_ics_convite(
        uid="abc123@conecta.local",
        titulo="Treinamento: Atendimento ao Cliente",
        inicio=datetime(2026, 10, 1, 9, 0),
        local="Sala 2",
        descricao="Você foi designado(a) como responsável por aplicar este treinamento.",
        organizador_email="recrutamento@empresa.com",
        participante_email="fulano@empresa.com",
        participante_nome="Fulano de Tal",
    )
    texto = conteudo.decode("utf-8")

    assert texto.startswith("BEGIN:VCALENDAR\r\n")
    assert texto.endswith("END:VCALENDAR\r\n")
    assert "METHOD:REQUEST" in texto
    assert "UID:abc123@conecta.local" in texto
    assert "DTSTART;TZID=America/Sao_Paulo:20261001T090000" in texto
    assert "DTEND;TZID=America/Sao_Paulo:20261001T100000" in texto
    assert "SUMMARY:Treinamento: Atendimento ao Cliente" in texto
    assert "LOCATION:Sala 2" in texto
    assert "ORGANIZER;CN=Conecta RH:mailto:recrutamento@empresa.com" in texto
    assert "ATTENDEE;CN=Fulano de Tal;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:fulano@empresa.com" in texto


def test_build_ics_convite_respeita_duracao_customizada():
    conteudo = build_ics_convite(
        uid="abc123@conecta.local",
        titulo="Treinamento X",
        inicio=datetime(2026, 10, 1, 9, 0),
        organizador_email="recrutamento@empresa.com",
        participante_email="fulano@empresa.com",
        duracao_minutos=30,
    )
    texto = conteudo.decode("utf-8")
    assert "DTSTART;TZID=America/Sao_Paulo:20261001T090000" in texto
    assert "DTEND;TZID=America/Sao_Paulo:20261001T093000" in texto


def test_build_ics_convite_escapa_virgula_e_ponto_e_virgula():
    conteudo = build_ics_convite(
        uid=novo_uid(),
        titulo="Treinamento: Vendas, Atendimento; Pós-venda",
        inicio=datetime(2026, 10, 1, 9, 0),
        organizador_email="recrutamento@empresa.com",
        participante_email="fulano@empresa.com",
    )
    texto = conteudo.decode("utf-8")
    assert "SUMMARY:Treinamento: Vendas\\, Atendimento\\; Pós-venda" in texto


def test_build_ics_attachment_retorna_payload_pronto_para_email_send_service():
    anexo = build_ics_attachment(
        uid=novo_uid(),
        titulo="Treinamento X",
        inicio=datetime(2026, 10, 1, 9, 0),
        organizador_email="recrutamento@empresa.com",
        participante_email="fulano@empresa.com",
    )
    assert anexo["nome"] == "convite.ics"
    assert anexo["mime_type"] == "text/calendar; charset=utf-8; method=REQUEST"
    conteudo = base64.b64decode(anexo["conteudo_base64"])
    assert conteudo.startswith(b"BEGIN:VCALENDAR")
