from __future__ import annotations

import re
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
INTERVIEW_SQL_FILES = (
    BACKEND_ROOT / "rh_api" / "repositories" / "bootstrap.py",
    BACKEND_ROOT / "rh_api" / "repositories" / "interviews.py",
)


def _source_text() -> str:
    return "\n".join(path.read_text(encoding="utf-8") for path in INTERVIEW_SQL_FILES)


def test_interview_sql_does_not_reference_legacy_id_agendamento():
    assert "id_agendamento" not in _source_text()


def test_interview_sql_never_updates_interview_identity_column():
    interview_updates = re.finditer(
        r"UPDATE\s+(?:dbo\.)?entrevistas_agendadas\b.*?\bSET\b(?P<set_clause>.*?)\bWHERE\b",
        _source_text(),
        re.IGNORECASE | re.DOTALL,
    )

    for update in interview_updates:
        assert re.search(r"\bid_entrevista\b", update.group("set_clause"), flags=re.IGNORECASE) is None


def test_interview_insert_does_not_include_identity_column():
    insert_blocks = re.findall(
        r"INSERT\s+INTO\s+(?:dbo\.)?entrevistas_agendadas\s*\((.*?)\)\s*OUTPUT",
        _source_text(),
        flags=re.IGNORECASE | re.DOTALL,
    )

    assert insert_blocks
    for columns_block in insert_blocks:
        assert re.search(r"\bid_entrevista\b", columns_block, flags=re.IGNORECASE) is None


def test_withdrawn_candidates_are_eliminated_and_hidden_from_operational_interviews():
    source = (BACKEND_ROOT / "rh_api" / "repositories" / "interviews.py").read_text(encoding="utf-8")

    assert "cp.status_candidato AS status_candidato_processo" in source
    assert "CANDIDATE_STATUS_ELIMINATED" in source
    assert "CANDIDATE_STATUS_WITHDREW" in source
    assert '"motivo_eliminacao": "Desistência do candidato"' in source


def test_candidate_status_sync_is_scoped_to_current_process():
    """Regression test: updating a candidate's status in one selection process must
    never affect entrevistas_agendadas/banco_talentos rows that belong to a
    different process for the same id_teste (a candidate can apply to multiple
    processos_seletivos with the same id_teste)."""
    source = (BACKEND_ROOT / "rh_api" / "repositories" / "base.py").read_text(encoding="utf-8")

    interview_sync_match = re.search(
        r"UPDATE\s+entrevistas_agendadas\s*\bSET\b.*?\bWHERE\b(?P<where_clause>.*?)\"\"\"",
        source,
        re.IGNORECASE | re.DOTALL,
    )
    assert interview_sync_match, "Could not locate the entrevistas_agendadas sync query in base.py"
    where_clause = interview_sync_match.group("where_clause")

    # The id_teste branch must never match rows unconditionally: it must be
    # scoped by id_processo/id_processo_ref (with a legacy fallback only when
    # the interview row has no process information at all).
    id_teste_branch_match = re.search(
        r"id_teste\s*=\s*\?.*", where_clause, re.IGNORECASE | re.DOTALL
    )
    assert id_teste_branch_match, "Could not locate the id_teste branch of the WHERE clause"
    id_teste_branch = id_teste_branch_match.group(0)
    assert "id_processo" in id_teste_branch
    assert "id_processo_ref" in id_teste_branch

    delete_match = re.search(
        r"DELETE\s+FROM\s+banco_talentos\s*\bWHERE\b(?P<where_clause>.*?)\"\"\"",
        source,
        re.IGNORECASE | re.DOTALL,
    )
    assert delete_match, "Could not locate the banco_talentos DELETE query in base.py"
    assert "id_processo" in delete_match.group("where_clause")
