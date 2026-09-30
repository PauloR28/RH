"""CV manual vira candidato na Central (sem processo), decisão do RH reflete no
status e prova agendada ocupa horário no Calendário. Roda contra o banco de DEV."""

from __future__ import annotations

from uuid import uuid4

from ._integracao_dev import repositorio_dev


def _limpar(repo, id_teste: str, item_id: str) -> None:
    conn = repo._connect()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM dbo.email_inbox_items WHERE id = ?", (item_id,))
        cursor.execute("DELETE FROM dbo.candidatos_anexos WHERE id_teste = ?", (id_teste,))
        cursor.execute("DELETE FROM dbo.historico_provas WHERE id_teste = ?", (id_teste,))
        cursor.execute("DELETE FROM dbo.provas_geradas WHERE id_teste = ?", (id_teste,))
        cursor.execute("DELETE FROM dbo.candidatos_metadata WHERE id_teste = ?", (id_teste,))
        conn.commit()
    finally:
        conn.close()


def test_cv_manual_aparece_na_central_e_sai_da_caixa_de_emails():
    repo = repositorio_dev()
    nome = f"Teste CV Manual {uuid4().hex[:6]}"
    result = repo.create_manual_structured_email_inbox_item(
        dados={"nome": nome, "email": f"{uuid4().hex[:8]}@example.com", "telefone": "(11) 91234-5678"},
        actor="pytest",
    )
    item_id = result["item"]["id"]
    id_teste = f"EMAIL-{item_id}"
    try:
        conn = repo._connect()
        try:
            listadas = repo._list_email_inbox_rows(
                conn.cursor(), limit=200, include_ignored=False, with_attachments_only=False, query=""
            )
        finally:
            conn.close()
        assert item_id not in {item["id"] for item in listadas}

        central = {c["id_teste"]: c for c in repo.list_process_candidates()}
        assert id_teste in central
        assert central[id_teste]["nome_candidato"] == nome
        assert central[id_teste]["origem"] == "CV manual"

        # Aprovar sem processo: passa a constar como Aprovado na Central.
        repo.update_standalone_candidate_status(
            id_teste, {"status_candidato": "Aprovado", "mensagem_aprovacao": "ok"}
        )
        historico = repo.list_process_candidates()
        aprovado = [c for c in historico if c["id_teste"] == id_teste]
        assert aprovado and aprovado[0]["status_candidato"] == "Aprovado"
    finally:
        _limpar(repo, id_teste, item_id)


def test_prova_individual_agendada_ocupa_calendario_e_decisao_aprovado_reflete_no_status():
    repo = repositorio_dev()
    nome = f"Teste Individual {uuid4().hex[:6]}"
    id_teste = f"EMAIL-teste-{uuid4().hex[:10]}"
    resultado = repo.create_generated_exam(
        {
            "id_teste": id_teste,
            "nome_candidato": nome,
            "email": f"{uuid4().hex[:8]}@example.com",
            "telefone": "(11) 91234-5678",
            "vaga": "Atendente",
            "area_prova": "Atendimento",
            "nivel": "Junior",
            "questoes_snapshot": [
                {"id": "q1", "tipo": "multipla_escolha", "enunciado": "Pergunta?", "opcoes": ["a", "b"], "gabarito": "a"}
            ],
            "agendada_para": "2030-01-15T14:30",
            "agendada_duracao_min": 90,
        },
        generated_by="pytest",
    )
    try:
        eventos = [e for e in repo.list_calendar_events(include_exams=True) if e["tipo"] == "prova"]
        evento = next(e for e in eventos if e["id"] == f"prova-{resultado['id_prova']}")
        assert nome in evento["titulo"]
        assert evento["data"].startswith("2030-01-15T14:30")
        assert evento["duracao_minutos"] == 90

        # Sem include_exams o calendário não muda para quem não vê provas.
        assert not [e for e in repo.list_calendar_events() if e["tipo"] == "prova"]

        # Candidato de prova avulsa aparece na Central e a decisão Aprovado reflete no status.
        repo.register_rh_decision(
            resultado["id_prova"],
            {"decisao": "Aprovado", "mensagem_aprovacao": "Parabéns", "documentos_aprovacao": ["RG"]},
            user_name="pytest",
        )
        central = [c for c in repo.list_process_candidates() if c["id_teste"] == id_teste]
        assert central and central[0]["status_candidato"] == "Aprovado"
    finally:
        conn = repo._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM dbo.decisoes_rh WHERE id_teste = ?", (id_teste,))
            cursor.execute("DELETE FROM dbo.historico_provas WHERE id_teste = ?", (id_teste,))
            cursor.execute("DELETE FROM dbo.provas_geradas WHERE id_teste = ?", (id_teste,))
            cursor.execute("DELETE FROM dbo.candidatos_metadata WHERE id_teste = ?", (id_teste,))
            conn.commit()
        finally:
            conn.close()
