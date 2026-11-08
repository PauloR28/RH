from __future__ import annotations

import os
import sys
import unittest
from copy import deepcopy
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import HTTPException

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from rh_api.auth import validate_access_token
from rh_api.config import get_settings
from rh_api.dependencies import get_current_user
from rh_api.repositories import is_deadlock_error
from rh_api.routers.auth import login, me
from rh_api.routers.history import get_history
from rh_api.routers.interviews import create_interview, get_interviews, update_interview
from rh_api.routers.pipeline import (
    create_candidate_pipeline_card,
    delete_candidate_pipeline_card,
    get_candidate_pipeline,
    move_candidate_pipeline_card,
)
from rh_api.schemas.auth import LoginRequest
from rh_api.schemas.interviews import InterviewCreateRequest, InterviewUpdateRequest
from rh_api.schemas.pipeline import PipelineCardCreateRequest, PipelineCardMoveRequest
from rh_api.services.pipeline import map_pipeline_stage_to_status, normalize_pipeline_stage
from rh_api.services.process_flow import CANDIDATE_STATUS_PENDING_CONFIRMATION


class FakeRepository:
    def __init__(self):
        self.history_calls: list[dict] = []
        self.pipeline_cards: list[dict] = []
        self.interviews: list[dict] = []

    def list_history(
        self,
        page: int | None = None,
        page_size: int = 10,
        nome: str = "",
        vaga: str = "",
        data: str = "",
    ):
        self.history_calls.append(
            {
                "page": page,
                "page_size": page_size,
                "nome": nome,
                "vaga": vaga,
                "data": data,
            }
        )

        if page is None and not nome and not vaga and not data:
            return []

        return {
            "items": [
                {
                    "id_teste": "TESTE-001",
                    "id_processo": "PROC.ANL.001",
                    "nome_candidato": nome or "Ana Souza",
                    "vaga": vaga or "Analista",
                    "data_iso": data or "2026-04-18T10:00:00",
                    "status": "Finalizado",
                }
            ],
            "page": page or 1,
            "page_size": page_size,
            "total_items": 1,
            "total_pages": 1,
        }

    def list_pipeline_cards(self, id_processo: str = "", search: str = "") -> list[dict]:
        processo = str(id_processo or "").strip().lower()
        termo = str(search or "").strip().lower()
        cards = self.pipeline_cards

        if processo:
            cards = [item for item in cards if str(item.get("id_processo", "")).strip().lower() == processo]

        if termo:
            cards = [
                item
                for item in cards
                if termo in str(item.get("nome_candidato", "")).lower()
                or termo in str(item.get("vaga", "")).lower()
                or termo in str(item.get("id_processo", "")).lower()
            ]

        return [deepcopy(item) for item in cards]

    def create_pipeline_candidate(self, data: dict) -> dict:
        stage = normalize_pipeline_stage(data.get("etapa_pipeline"))
        id_registro = max((int(item["id_registro"]) for item in self.pipeline_cards), default=0) + 1
        card = {
            "id_registro": id_registro,
            "id_processo": data["id_processo"],
            "id_teste": data.get("id_teste") or f"PIPE-{id_registro:03d}",
            "nome_candidato": data["nome_candidato"],
            "vaga": data.get("vaga") or "Analista",
            "status_candidato": map_pipeline_stage_to_status(stage),
            "pontuacao_final": data.get("pontuacao_final") or "",
            "data_prova": data.get("data_prova") or "2026-04-18T10:00:00",
            "origem": data.get("origem") or "Pipeline manual",
            "etapa_pipeline": stage,
            "data_atualizacao_pipeline": "2026-04-18T10:00:00",
            "status_processo": "Aberto",
        }
        self.pipeline_cards.append(card)
        return {"success": True, "id_registro": id_registro}

    def move_pipeline_card(self, id_registro: int, data: dict) -> dict:
        stage = normalize_pipeline_stage(data.get("etapa_pipeline"))

        for item in self.pipeline_cards:
            if int(item["id_registro"]) != int(id_registro):
                continue

            item["etapa_pipeline"] = stage
            item["status_candidato"] = map_pipeline_stage_to_status(stage, item.get("status_candidato"))
            item["data_atualizacao_pipeline"] = data.get("data_movimentacao") or "2026-04-18T11:00:00"
            return {"success": True}

        raise HTTPException(status_code=404, detail="Card do pipeline nao encontrado.")

    def delete_pipeline_card(self, id_registro: int) -> dict:
        antes = len(self.pipeline_cards)
        self.pipeline_cards = [
            item for item in self.pipeline_cards if int(item["id_registro"]) != int(id_registro)
        ]
        self.interviews = [
            item for item in self.interviews if int(item.get("id_registro") or 0) != int(id_registro)
        ]

        if len(self.pipeline_cards) == antes:
            raise HTTPException(status_code=404, detail="Card do pipeline nao encontrado.")

        return {"success": True}

    def list_interviews(
        self,
        id_processo: str = "",
        status_entrevista: str = "",
        search: str = "",
    ) -> list[dict]:
        processo = str(id_processo or "").strip().lower()
        status = str(status_entrevista or "").strip().lower()
        termo = str(search or "").strip().lower()
        dados = self.interviews

        if processo:
            dados = [
                item
                for item in dados
                if str(item.get("id_processo", "")).strip().lower() == processo
            ]

        if status:
            dados = [
                item
                for item in dados
                if str(item.get("status_entrevista", "")).strip().lower() == status
            ]

        if termo:
            dados = [
                item
                for item in dados
                if termo in str(item.get("nome_candidato", "")).lower()
                or termo in str(item.get("vaga", "")).lower()
                or termo in str(item.get("id_processo", "")).lower()
            ]

        return [deepcopy(item) for item in dados]

    def create_interview(self, data: dict) -> dict:
        candidato = next(
            (
                item
                for item in self.pipeline_cards
                if int(item.get("id_registro") or 0) == int(data["id_registro"])
            ),
            None,
        )
        if not candidato:
            raise HTTPException(status_code=404, detail="Candidato do processo nao encontrado para agendamento.")

        novo_id = max((int(item["id_entrevista"]) for item in self.interviews), default=0) + 1
        mensagem = (
            f"Ola, {candidato['nome_candidato']}. "
            f"Entrevista para {candidato['vaga']} em {data['data_entrevista'].isoformat()}."
        )
        entrevista = {
            "id_entrevista": novo_id,
            "id_processo": candidato["id_processo"],
            "id_registro": candidato["id_registro"],
            "id_teste": candidato["id_teste"],
            "nome_candidato": candidato["nome_candidato"],
            "vaga": candidato["vaga"],
            "data_entrevista": data["data_entrevista"],
            "status_entrevista": CANDIDATE_STATUS_PENDING_CONFIRMATION,
            "link_agendamento": data.get("link_agendamento", ""),
            "observacoes_rh": data.get("observacoes_rh", ""),
            "mensagem_base": mensagem,
        }
        self.interviews.append(entrevista)
        candidato["etapa_pipeline"] = "Entrevista"
        candidato["status_candidato"] = entrevista["status_entrevista"]
        candidato["status_entrevista"] = entrevista["status_entrevista"]
        candidato["data_entrevista"] = entrevista["data_entrevista"].isoformat()
        candidato["link_entrevista"] = entrevista["link_agendamento"]
        return {"success": True, "id_entrevista": novo_id, "mensagem_base": mensagem}

    def update_interview(self, id_entrevista: int, data: dict) -> dict:
        for item in self.interviews:
            if int(item["id_entrevista"]) != int(id_entrevista):
                continue

            item.update(data)
            mensagem = f"Entrevista atualizada para {item.get('status_entrevista', CANDIDATE_STATUS_PENDING_CONFIRMATION)}."
            item["mensagem_base"] = mensagem

            for card in self.pipeline_cards:
                if int(card.get("id_registro") or 0) == int(item.get("id_registro") or 0):
                    card["status_candidato"] = item.get("status_entrevista", "")
                    card["status_entrevista"] = item.get("status_entrevista", "")
                    card["data_entrevista"] = (
                        item["data_entrevista"].isoformat()
                        if isinstance(item.get("data_entrevista"), datetime)
                        else item.get("data_entrevista", "")
                    )
            return {"success": True, "mensagem_base": mensagem}

        raise HTTPException(status_code=404, detail="Entrevista nao encontrada.")


class AuthAndPipelineApiTests(unittest.TestCase):
    def setUp(self):
        self.env_keys = (
            "RH_APP_ENV",
            "RH_AUTH_USER",
            "RH_AUTH_PASSWORD",
            "RH_AUTH_TOKEN_SECRET",
        )
        self.original_env = {key: os.environ.get(key) for key in self.env_keys}
        os.environ["RH_APP_ENV"] = "development"
        os.environ["RH_AUTH_USER"] = "rh.local"
        os.environ["RH_AUTH_PASSWORD"] = "senha-segura"
        os.environ["RH_AUTH_TOKEN_SECRET"] = "segredo-de-teste"
        get_settings.cache_clear()

    def tearDown(self):
        for key, value in self.original_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        get_settings.cache_clear()

    def test_login_success_and_session_validation(self):
        payload = login(LoginRequest(usuario="rh.local", senha="senha-segura"))

        self.assertEqual(payload.usuario, "rh.local")
        self.assertEqual(payload.token_type, "bearer")
        self.assertTrue(payload.access_token)

        usuario = validate_access_token(payload.access_token)
        me_response = me(user=usuario)
        session_payload = me_response.model_dump()
        self.assertEqual(session_payload["authenticated"], True)
        self.assertEqual(session_payload["usuario"], "rh.local")
        self.assertEqual(session_payload["perfil"], "administrador")
        self.assertIn("usuarios.criar", session_payload["permissoes"])
        self.assertIn("configuracoes.visualizar", session_payload["permissoes"])

    def test_protected_history_requires_authentication(self):
        with self.assertRaises(HTTPException) as context:
            get_current_user(None)

        self.assertEqual(context.exception.status_code, 401)
        self.assertEqual(context.exception.detail, "Autentica\u00e7\u00e3o obrigat\u00f3ria.")

    def test_history_uses_server_side_pagination(self):
        repository = FakeRepository()

        payload = get_history(
            page=2,
            page_size=5,
            nome="Ana",
            vaga="",
            data="",
            repository=repository,
        )

        self.assertEqual(payload["page"], 2)
        self.assertEqual(payload["page_size"], 5)
        self.assertEqual(payload["total_items"], 1)
        self.assertEqual(payload["items"][0]["nome_candidato"], "Ana")
        self.assertEqual(
            repository.history_calls[-1],
            {
                "page": 2,
                "page_size": 5,
                "nome": "Ana",
                "vaga": "",
                "data": "",
            },
        )

    def test_pipeline_card_creation_and_move_persist_status(self):
        repository = FakeRepository()
        create_response = create_candidate_pipeline_card(
            PipelineCardCreateRequest(
                id_processo="PROC.ANL.001",
                nome_candidato="Ana Souza",
                vaga="Analista",
                etapa_pipeline="Triagem",
            ),
            repository=repository,
        )

        self.assertTrue(create_response["success"])

        cards = get_candidate_pipeline(id_processo="", search="", repository=repository)
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["etapa_pipeline"], "Triagem")
        self.assertEqual(cards[0]["status_candidato"], "Analise")

        move_response = move_candidate_pipeline_card(
            1,
            PipelineCardMoveRequest(
                etapa_pipeline="Aprovado",
                data_movimentacao="2026-04-18T11:00:00",
            ),
            repository=repository,
        )

        self.assertEqual(move_response, {"success": True})

        cards_after_move = get_candidate_pipeline(id_processo="", search="", repository=repository)
        self.assertEqual(cards_after_move[0]["etapa_pipeline"], "Aprovado")
        self.assertEqual(cards_after_move[0]["status_candidato"], "Aprovado")

    def test_pipeline_card_deletion_removes_card(self):
        repository = FakeRepository()
        create_candidate_pipeline_card(
            PipelineCardCreateRequest(
                id_processo="PROC.ANL.001",
                nome_candidato="Ana Souza",
                vaga="Analista",
                etapa_pipeline="Prova",
            ),
            repository=repository,
        )

        delete_response = delete_candidate_pipeline_card(1, repository=repository)

        self.assertEqual(delete_response, {"success": True})
        self.assertEqual(get_candidate_pipeline(id_processo="", search="", repository=repository), [])

    def test_interview_creation_and_update_are_integrated(self):
        repository = FakeRepository()
        create_candidate_pipeline_card(
            PipelineCardCreateRequest(
                id_processo="PROC.ANL.001",
                nome_candidato="Ana Souza",
                vaga="Analista",
                etapa_pipeline="Triagem",
            ),
            repository=repository,
        )

        data_entrevista = datetime.now() + timedelta(days=1)
        create_payload = create_interview(
            InterviewCreateRequest(
                id_registro=1,
                id_processo="PROC.ANL.001",
                data_entrevista=data_entrevista,
                link_agendamento="https://bookings.cloud.microsoft/example",
                observacoes_rh="Chegar com 10 minutos de antecedencia.",
            ),
            repository=repository,
        )

        self.assertTrue(create_payload["success"])
        self.assertIn("Ana Souza", create_payload["mensagem_base"])

        entrevistas = get_interviews(
            id_processo="PROC.ANL.001",
            status_entrevista="",
            search="Ana",
            repository=repository,
        )
        self.assertEqual(len(entrevistas), 1)
        self.assertEqual(entrevistas[0]["status_entrevista"], CANDIDATE_STATUS_PENDING_CONFIRMATION)
        cards = get_candidate_pipeline(id_processo="", search="", repository=repository)
        self.assertEqual(cards[0]["status_candidato"], CANDIDATE_STATUS_PENDING_CONFIRMATION)

        update_payload = update_interview(
            1,
            InterviewUpdateRequest(status_entrevista="Agendado"),
            repository=repository,
        )

        self.assertEqual(update_payload["success"], True)
        entrevistas_atualizadas = get_interviews(
            id_processo="PROC.ANL.001",
            status_entrevista="Agendado",
            search="",
            repository=repository,
        )
        self.assertEqual(entrevistas_atualizadas[0]["status_entrevista"], "Agendado")
        cards_atualizados = get_candidate_pipeline(id_processo="", search="", repository=repository)
        self.assertEqual(cards_atualizados[0]["status_candidato"], "Agendado")

    def test_deadlock_error_detection_matches_sql_server_signature(self):
        error = Exception(
            "[40001] [Microsoft][ODBC Driver 17 for SQL Server][SQL Server]Transaction (Process ID 61) was deadlocked on lock resources with another process and has been chosen as the deadlock victim. (1205)"
        )
        self.assertTrue(is_deadlock_error(error))

    def test_deadlock_error_detection_ignores_unrelated_errors(self):
        error = Exception(
            "[42S02] [Microsoft][ODBC Driver 17 for SQL Server][SQL Server]Invalid object name 'dbo.entrevistas_agendadas'."
        )
        self.assertFalse(is_deadlock_error(error))
