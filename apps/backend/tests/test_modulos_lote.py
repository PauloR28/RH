"""Salvar em lote da tela Módulos: validação antes de gravar, tudo-ou-nada, recusas e auditoria com id_lote. Sem banco real."""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from rh_api import areas
from rh_api.auth import AuthenticatedUser
from rh_api.dependencies import get_current_user, get_repository
from rh_api.rbac import ROLE_ADMIN, get_role_permissions
from rh_api.services import acesso, modulos_admin


class FalsoCursor:
    def __init__(self, conexao):
        self.conexao = conexao
        self.rowcount = 1

    def execute(self, sql, params=()):
        self.conexao.comandos.append((" ".join(sql.split()), tuple(params)))
        if self.conexao.falhar_no is not None and len(self.conexao.comandos) == self.conexao.falhar_no:
            raise RuntimeError("falha simulada")
        self.rowcount = 1


class FalsaConexao:
    def __init__(self, falhar_no=None):
        self.comandos, self.falhar_no = [], falhar_no
        self.commitada = self.desfeita = self.fechada = False

    def cursor(self):
        return FalsoCursor(self)

    def commit(self):
        self.commitada = True

    def rollback(self):
        self.desfeita = True

    def close(self):
        self.fechada = True


@pytest.fixture
def ambiente(monkeypatch):
    """Estado de módulos conhecido (sem banco), áreas de RH inativas (padrão) e uma conexão falsa para observar o que é gravado."""
    monkeypatch.delenv(areas.VARIAVEL, raising=False)
    acesso.definir_carregador(lambda: acesso.EstadoModulos(
        ativos=frozenset({"core", "rh", "operacao", "tecnologia"}),
        funcoes={"rh": frozenset({"gestao", "drive"}), "operacao": frozenset({"monitoria", "wfm"}), "tecnologia": frozenset({"wfm"})},
    ))
    monkeypatch.setattr(acesso, "situacao_wfm_participantes", lambda: {"liberado": False, "origem": "banco", "editavel": True})
    contexto = {"conexao": FalsaConexao()}
    monkeypatch.setattr(modulos_admin, "get_connection", lambda *a, **k: contexto["conexao"])
    yield contexto
    acesso.definir_carregador(None)


def _item(tipo, modulo="", funcao="", ativo=True):
    return {"tipo": tipo, "modulo": modulo, "funcao": funcao, "ativo": ativo}


def test_lote_valido_grava_tudo_em_uma_transacao_e_devolve_de_para(ambiente):
    resultado = modulos_admin.aplicar_lote(
        [_item("funcao", "operacao", "gestao", True), _item("funcao", "operacao", "drive", False), _item("modulo", "rh", ativo=False),
         _item("wfm_participantes", ativo=True)], autor="paulo")
    con = ambiente["conexao"]
    assert con.commitada and not con.desfeita and con.fechada
    assert len(con.comandos) == 3  # drive já estava desligado em Operação: o item é ignorado
    aplicadas = {(a["tipo"], a["modulo"], a["funcao"]): (a["ativo_anterior"], a["ativo"]) for a in resultado["aplicadas"]}
    assert aplicadas == {("funcao", "operacao", "gestao"): (False, True), ("modulo", "rh", ""): (True, False), ("wfm_participantes", "", ""): (False, True)}
    assert len(resultado["id_lote"]) == 12


def test_item_que_ja_esta_no_valor_pedido_e_ignorado_e_lote_vazio_nao_abre_transacao(ambiente):
    resultado = modulos_admin.aplicar_lote([_item("funcao", "operacao", "monitoria", True)], autor="x")  # já ligada
    assert resultado["aplicadas"] == [] and ambiente["conexao"].comandos == []
    with pytest.raises(HTTPException) as erro:
        modulos_admin.aplicar_lote([], autor="x")
    assert erro.value.status_code == 400


def test_modulo_protegido_nao_pode_ser_desativado_e_nada_e_gravado(ambiente):
    with pytest.raises(HTTPException) as erro:
        modulos_admin.aplicar_lote([_item("funcao", "operacao", "gestao", True), _item("modulo", "tecnologia", ativo=False)], autor="x")
    assert erro.value.status_code == 409 and "protegido" in erro.value.detail
    assert ambiente["conexao"].comandos == []  # a validação vem ANTES: nem a primeira mudança (válida) foi gravada


@pytest.mark.parametrize("item,codigo", [
    (_item("funcao", "tecnologia", "suporte", True), 409),      # Suporte TI está desativado no Conecta
    (_item("funcao", "rh", "processos", True), 409),            # área de Processos desativada
    (_item("funcao", "tecnologia", "monitoria", True), 404),    # função que não existe naquele módulo
    (_item("modulo", "modulo_x", ativo=True), 404),
])
def test_recusas_de_validacao_nao_gravam_nada(ambiente, item, codigo):
    with pytest.raises(HTTPException) as erro:
        modulos_admin.aplicar_lote([_item("funcao", "operacao", "gestao", True), item], autor="x")
    assert erro.value.status_code == codigo and ambiente["conexao"].comandos == []


def test_itens_repetidos_sao_recusados(ambiente):
    with pytest.raises(HTTPException) as erro:
        modulos_admin.aplicar_lote([_item("funcao", "operacao", "gestao", True), _item("funcao", "operacao", "gestao", False)], autor="x")
    assert erro.value.status_code == 400


def test_wfm_controlado_pelo_ambiente_recusa_o_lote_inteiro(ambiente, monkeypatch):
    monkeypatch.setattr(acesso, "situacao_wfm_participantes", lambda: {"liberado": True, "origem": "ambiente", "editavel": False})
    with pytest.raises(HTTPException) as erro:
        modulos_admin.aplicar_lote([_item("funcao", "operacao", "gestao", True), _item("wfm_participantes", ativo=False)], autor="x")
    assert erro.value.status_code == 409 and ambiente["conexao"].comandos == []


def test_falha_no_meio_desfaz_tudo_e_nao_confirma(ambiente):
    ambiente["conexao"] = FalsaConexao(falhar_no=2)  # a 2ª escrita explode
    with pytest.raises(HTTPException) as erro:
        modulos_admin.aplicar_lote([_item("funcao", "operacao", "gestao", True), _item("funcao", "operacao", "drive", True)], autor="x")
    con = ambiente["conexao"]
    assert erro.value.status_code == 500 and "Nada foi aplicado" in erro.value.detail
    assert con.desfeita and not con.commitada and con.fechada


# ---------------------------------------------------------------- rota + auditoria
class FalsoRepositorio:
    def __init__(self):
        self.auditoria = []

    def record_audit_log(self, **dados):
        self.auditoria.append(dados)


def _cliente(repositorio):
    from rh_api.main import create_app

    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        username="adm", id_usuario=1, nome="Adm", perfil=ROLE_ADMIN, operacoes=frozenset(), permissions=frozenset(get_role_permissions(ROLE_ADMIN)))
    app.dependency_overrides[get_repository] = lambda: repositorio
    return TestClient(app)


def test_rota_grava_uma_linha_de_auditoria_por_mudanca_com_o_mesmo_id_lote(ambiente, monkeypatch):
    monkeypatch.setattr(modulos_admin, "listar_funcoes", lambda: [])
    repositorio = FalsoRepositorio()
    resposta = _cliente(repositorio).put("/tecnologia/modulos/lote", json={
        "alteracoes": [_item("funcao", "operacao", "gestao", True), _item("modulo", "rh", ativo=False), _item("wfm_participantes", ativo=True)],
        "justificativa": "piloto"})
    assert resposta.status_code == 200, resposta.text
    corpo = resposta.json()
    assert len(repositorio.auditoria) == 3
    assert {a["valor_novo"]["id_lote"] for a in repositorio.auditoria} == {corpo["id_lote"]}
    por_acao = {a["acao"]: a for a in repositorio.auditoria}
    assert set(por_acao) == {"modulo_funcao_alterada", "modulo_ativacao_alterada", "wfm_participantes_alterado"}
    funcao = por_acao["modulo_funcao_alterada"]
    assert funcao["entidade_id"] == "operacao:gestao" and funcao["valor_anterior"]["ativo"] is False and funcao["valor_novo"]["ativo"] is True
    assert funcao["justificativa"] == "piloto"
    assert "funcoes" in corpo and "wfm" in corpo


def test_rota_recusada_nao_audita_e_a_rota_lote_nao_vira_chave_de_modulo(ambiente):
    repositorio = FalsoRepositorio()
    cliente = _cliente(repositorio)
    resposta = cliente.put("/tecnologia/modulos/lote", json={"alteracoes": [_item("modulo", "tecnologia", ativo=False)]})
    assert resposta.status_code == 409 and repositorio.auditoria == []
    assert cliente.put("/tecnologia/modulos/lote", json={"alteracoes": []}).status_code == 422  # corpo inválido, não "módulo lote"
