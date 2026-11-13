from __future__ import annotations

import json

from conecta.infrastructure.security.html_sanitizer import sanitize_rich_text_html

from rh_api.repositories.generated_exams import GeneratedExamRepositoryMixin


class _FakeCursor:
    def __init__(self) -> None:
        self.executed: list[tuple[str, tuple]] = []

    def execute(self, sql: str, params: tuple = ()) -> None:
        self.executed.append((sql, params))


def test_sanitizer_strips_script_tags_and_event_handlers():
    payload = '<script>alert(1)</script><b onclick="steal()">Minha resposta</b>'
    assert sanitize_rich_text_html(payload) == "<b>Minha resposta</b>"


def test_sanitizer_strips_javascript_href_and_style_expression():
    payload = '<div style="background:url(javascript:alert(1))">texto</div>'
    assert sanitize_rich_text_html(payload) == "<div>texto</div>"


def test_sanitizer_keeps_legitimate_rich_text_formatting():
    payload = '<div style="text-align:center"><b>Negrito</b> e <font size="4" color="#ff0000">colorido</font></div>'
    assert sanitize_rich_text_html(payload) == payload


def test_sanitizer_is_a_no_op_on_plain_text_without_tags():
    assert sanitize_rich_text_html("resposta simples sem html") == "resposta simples sem html"


def test_save_answer_rows_sanitizes_string_answers_before_persisting():
    repository = GeneratedExamRepositoryMixin()
    cursor = _FakeCursor()
    row = {"id_prova": 1, "id_teste": "CP-TESTE"}
    questions = [{"id": "q1", "title": "Dissertativa"}]
    answers = ['<img src=x onerror="alert(document.cookie)">texto legítimo da resposta']

    repository._save_answer_rows(cursor, row, answers, questions)

    insert_sql, params = cursor.executed[1]
    assert "INSERT INTO dbo.respostas_provas" in insert_sql
    resposta_json = params[6]  # posição do parâmetro resposta_json no INSERT
    stored_answer = json.loads(resposta_json)
    assert "onerror" not in stored_answer
    assert "<img" not in stored_answer
    assert "texto legítimo da resposta" in stored_answer
