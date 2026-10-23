"""Relatórios e Históricos (23/out/2026): catálogo de permissões por relatório, semente e exportação unificada."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from rh_api import dependencies as dep
from rh_api.auth import AuthenticatedUser
from rh_api.rbac import (
    PERMISSION_DEFINITIONS,
    RELATORIOS_HUB,
    RELHUB_PERMISSAO_BASE,
    ROLE_ADMIN,
    ROLE_OPERATOR,
    ROLE_PERMISSIONS,
    ROLE_SUPERVISOR,
)
from rh_api.routers import relatorios_hub
from rh_api.services import relatorio_exportacao as exportacao


def test_cada_relatorio_tem_permissao_definida_e_base_existente():
    assert len({chave for chave, *_ in RELATORIOS_HUB}) == len(RELATORIOS_HUB)
    for chave, _descricao, base, _critica in RELATORIOS_HUB:
        assert chave in PERMISSION_DEFINITIONS and chave.startswith("relhub.")
        assert base in PERMISSION_DEFINITIONS, f"{chave} aponta para uma base inexistente: {base}"
        assert PERMISSION_DEFINITIONS[chave].module == "Relatórios e Históricos"
    assert "sessao.relatorios.acessar" in PERMISSION_DEFINITIONS
    assert set(relatorios_hub._EXPORTAR) == set(RELHUB_PERMISSAO_BASE)  # toda chave tem permissão de exportar declarada


def test_semente_espelha_o_acesso_e_nunca_da_logs_ao_supervisor_nem_relatorio_ao_operador():
    for papel, perms in ROLE_PERMISSIONS.items():
        hub = {p for p in perms if p.startswith("relhub.")}
        for chave in hub:
            assert RELHUB_PERMISSAO_BASE[chave] in perms, f"{papel} recebeu {chave} sem a permissão de base"
        assert ("sessao.relatorios.acessar" in perms) == bool(hub) or papel == ROLE_OPERATOR
    assert not any(p.startswith("relhub.") or p == "sessao.relatorios.acessar" for p in ROLE_PERMISSIONS[ROLE_OPERATOR])
    assert "relhub.sistema.logs" not in ROLE_PERMISSIONS[ROLE_SUPERVISOR]
    assert "relhub.sistema.logs" in ROLE_PERMISSIONS[ROLE_ADMIN]


def test_exportadores_geram_arquivos_validos_e_protegem_formulas():
    colunas = ["Operador", "Horas", "Obs"]
    linhas = [["Ana", 12.5, "=SOMA(A1)"], ["Bruno", 8, "ok (teste)"]] * 400
    csv = exportacao.gerar_csv(colunas, linhas)
    assert csv.startswith(b"\xef\xbb\xbf") and b"'=SOMA(A1)" in csv
    assert exportacao.gerar_xlsx("Resumo", [("Período", "01/10 a 31/10")], colunas, linhas)[:2] == b"PK"
    pdf = exportacao.gerar_pdf("Resumo", [("Período", "01/10 a 31/10")], colunas, linhas)
    assert pdf.startswith(b"%PDF-1.4") and pdf.rstrip().endswith(b"%%EOF") and pdf.count(b"/Type /Page ") > 1  # várias páginas


def _cliente(perms: set[str], perfil: str = ROLE_SUPERVISOR) -> TestClient:
    app = FastAPI()
    app.include_router(relatorios_hub.router)
    usuario = AuthenticatedUser(username="u", perfil=perfil, permissions=frozenset(perms))
    app.dependency_overrides[dep.get_current_user] = lambda: usuario
    app.dependency_overrides[dep.get_repository] = lambda: None
    return TestClient(app)


CORPO = {"relatorio": "wfm.resumo", "formato": "csv", "titulo": "Resumo", "filtros": [["Período", "mês"]], "colunas": ["A", "B"], "linhas": [["x", 1]]}


@pytest.mark.parametrize("formato,tipo", [("csv", "text/csv"), ("xlsx", "spreadsheetml"), ("pdf", "application/pdf")])
def test_exportar_exige_visualizar_base_e_exportar(formato, tipo):
    liberado = {"sessao.relatorios.acessar", "relhub.wfm.resumo", "wfm.relatorios"}
    resposta = _cliente(liberado).post("/relatorios-hub/exportar", json={**CORPO, "formato": formato})
    assert resposta.status_code == 200 and tipo in resposta.headers["content-type"]
    assert "attachment" in resposta.headers["content-disposition"] and formato in resposta.headers["content-disposition"]


@pytest.mark.parametrize("faltando", ["relhub.wfm.resumo", "wfm.relatorios", "sessao.relatorios.acessar"])
def test_exportar_recusa_sem_alguma_das_permissoes(faltando):
    perms = {"sessao.relatorios.acessar", "relhub.wfm.resumo", "wfm.relatorios"} - {faltando}
    assert _cliente(perms).post("/relatorios-hub/exportar", json=CORPO).status_code == 403


def test_exportar_valida_relatorio_formato_e_limite():
    perms = {"sessao.relatorios.acessar", "relhub.wfm.resumo", "wfm.relatorios"}
    cliente = _cliente(perms)
    assert cliente.post("/relatorios-hub/exportar", json={**CORPO, "relatorio": "wfm.inexistente"}).status_code == 404
    assert cliente.post("/relatorios-hub/exportar", json={**CORPO, "formato": "docx"}).status_code == 400
    grande = {**CORPO, "formato": "pdf", "linhas": [["x", 1]] * (exportacao.LIMITE_LINHAS_PDF + 1)}
    assert cliente.post("/relatorios-hub/exportar", json=grande).status_code == 413
