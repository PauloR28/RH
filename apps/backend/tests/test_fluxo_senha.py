"""Fluxo de senha do acesso por Login (aprovado em 26/nov/2026): regra, migration V077, avisos ao TI, sessão única,
e-mails e rotas do "Esqueci a senha"."""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from rh_api.dependencies import get_repository
from rh_api.repositories import senha_acesso_schema as schema
from rh_api.routers import auth as auth_routes
from rh_api.services import emails_senha, notificacao_ti, senha_politica, sessao_unica

RAIZ = Path(__file__).resolve().parents[3]
MIGRATIONS = RAIZ / "infra" / "sql" / "migrations"


# ---------------------------------------------------------------- regra da senha
@pytest.mark.parametrize(
    ("senha", "falta"),
    [
        ("Ab1#", "8 caracteres ou mais"),
        ("abcdefg1#", "uma letra maiúscula"),
        ("ABCDEFG1#", "uma letra minúscula"),
        ("Abcdefgh#", "um número"),
        ("Abcdefgh1", "um caractere especial"),
    ],
)
def test_regra_da_senha_diz_o_que_falta(senha, falta):
    assert falta in senha_politica.problemas(senha)
    with pytest.raises(HTTPException) as erro:
        senha_politica.validar(senha)
    assert erro.value.status_code == 422
    assert falta in erro.value.detail


def test_senha_completa_passa_e_nao_pode_repetir_a_atual():
    assert senha_politica.validar("Conecta#2026") == "Conecta#2026"
    with pytest.raises(HTTPException, match="diferente"):
        senha_politica.validar("Conecta#2026", diferente_de=("Conecta#2026",))


def test_senha_gerada_sempre_cumpre_a_regra_e_codigo_tem_6_numeros():
    for _ in range(200):
        assert senha_politica.problemas(senha_politica.gerar_senha()) == []
    codigo = senha_politica.gerar_codigo()
    assert len(codigo) == 6 and codigo.isdigit()


def test_email_mascarado_nao_mostra_o_endereco_inteiro():
    assert senha_politica.mascarar_email("marcia.souza@empresa.com.br") == "ma*****@empresa.com.br"
    assert senha_politica.mascarar_email("sem-arroba") == ""


# ---------------------------------------------------------------- migration
def test_v077_e_gerada_do_mesmo_codigo_e_e_ascii():
    sql = (MIGRATIONS / "V077__senha_acesso.sql").read_text(encoding="utf-8")
    assert sql == schema.render_migration_sql()
    rollback = (MIGRATIONS / "V077__senha_acesso.rollback.sql").read_text(encoding="utf-8")
    assert rollback == schema.render_rollback_sql()
    assert sql.isascii() and rollback.isascii()
    assert "senha_recuperacoes" in sql and "sessao_web_id" in sql


# ---------------------------------------------------------------- avisos ao TI
@pytest.fixture
def config_ti():
    estado: dict = {"texto": None}
    notificacao_ti.definir_carregador(lambda: estado["texto"])
    yield estado
    notificacao_ti.definir_carregador(None)


def test_configuracao_padrao_e_normalizada(config_ti):
    cfg = notificacao_ti.ler()
    assert cfg["destinatarios"] == []
    assert cfg["eventos"]["conta_bloqueada"] == {"quando": "na_hora", "sino": True}
    assert cfg["eventos"]["login"]["quando"] == "resumo"
    lixo = notificacao_ti.normalizar({
        "destinatarios": [{"email": "invalido"}, {"email": "TI@Empresa.com", "grupos": {"senhas": 1}},
                          {"email": "ti@empresa.com"}],
        "eventos": {"login": {"quando": "sempre"}, "senha_trocada": {"quando": "nao", "sino": False}},
        "hora_resumo": "25:00",
    })
    assert [d["email"] for d in lixo["destinatarios"]] == ["ti@empresa.com"]
    assert lixo["destinatarios"][0]["grupos"] == {"logins": False, "senhas": True, "sessoes": False}
    assert lixo["eventos"]["login"]["quando"] == "resumo"
    assert lixo["eventos"]["senha_trocada"] == {"quando": "nao", "sino": False}
    assert lixo["hora_resumo"] == "08:00"


def test_so_quem_passou_no_teste_recebe(config_ti):
    cfg = notificacao_ti.normalizar({"destinatarios": [
        {"email": "a@empresa.com", "grupos": {"senhas": True}, "testado": True, "resumo": True},
        {"email": "b@empresa.com", "grupos": {"senhas": True}, "testado": False, "resumo": True},
        {"email": "c@empresa.com", "grupos": {"logins": True}, "testado": True},
    ]})
    assert notificacao_ti.destinatarios_na_hora(cfg, "senha_redefinida") == ["a@empresa.com"]
    assert notificacao_ti.destinatarios_na_hora(cfg, "conta_bloqueada") == ["c@empresa.com"]
    assert notificacao_ti.destinatarios_resumo(cfg) == ["a@empresa.com"]


def test_aviso_ao_ti_vai_por_email_e_sino_sem_senha(config_ti, monkeypatch):
    import json

    config_ti["texto"] = json.dumps({"destinatarios": [
        {"nome": "TI", "email": "ti@empresa.com", "grupos": {"senhas": True}, "testado": True}]})
    notificacao_ti.invalidar()
    enviados, sinos = [], []
    monkeypatch.setattr(emails_senha, "enviar", lambda settings, nome, para, dados, **kw: enviados.append((nome, para, dados)))
    monkeypatch.setattr(notificacao_ti, "_perfis_da_ti", lambda cursor: ["administrador", "ti"])

    class Repo:
        settings = type("S", (), {"public_frontend_base_url": "https://conecta.exemplo"})()

        def _criar_notificacao(self, cursor, **kw):
            sinos.append(kw)

    notificacao_ti.disparar(Repo(), object(), "senha_redefinida", {"conta_nome": "Ana", "conta_login": "ana"})
    assert [e[0] for e in enviados] == ["aviso_ti"]
    assert enviados[0][1] == ["ti@empresa.com"]
    assert "senha_provisoria" not in enviados[0][2] and "codigo" not in enviados[0][2]  # S7
    assert {s["destinatario_papel"] for s in sinos} == {"administrador", "ti"}
    # Evento só no resumo: nem e-mail nem sino na hora.
    enviados.clear()
    sinos.clear()
    notificacao_ti.disparar(Repo(), object(), "login", {"conta_nome": "Ana"})
    assert enviados == [] and sinos == []


# ---------------------------------------------------------------- sessão única
@pytest.fixture
def sessoes():
    dados: dict = {}
    sessao_unica.definir_carregador(lambda: dict(dados))
    yield dados
    sessao_unica.definir_carregador(None)


def test_conta_aberta_em_outro_computador_derruba_a_sessao_antiga(sessoes):
    agora = datetime.now()
    sessoes[7] = ("novo", agora)
    sessao_unica.invalidar()
    assert sessao_unica.conferir(7, "novo") is None
    quando = sessao_unica.conferir(7, "antigo")
    assert quando == agora
    assert f"hoje às {agora:%H:%M}" in sessao_unica.mensagem_substituida(quando)
    # Sem número (app do celular, token antigo) não é conferido.
    assert sessao_unica.conferir(7, "") is None
    assert sessao_unica.conferir(8, "qualquer") is None


def test_troca_de_senha_encerra_a_sessao(sessoes):
    sessao_unica.registrar(7, sessao_unica.id_encerrada())
    quando = sessao_unica.conferir(7, "aberta")
    assert sessao_unica.atual_encerrada(quando)
    assert "encerrada" in sessao_unica.mensagem_substituida(quando)


def test_token_leva_o_numero_da_sessao(monkeypatch):
    from rh_api import auth

    monkeypatch.setenv("RH_AUTH_TOKEN_SECRET", "segredo-de-teste-com-tamanho-suficiente-123")
    from rh_api.config import get_settings

    get_settings.cache_clear()
    token, user = auth.create_session_for_user_record(
        {"id_usuario": 7, "login": "ana", "perfil": "rh", "status": "Ativo", "sessao_web_id": "abc"})
    assert user.sessao_id == "abc"
    assert auth.validate_access_token(token).sessao_id == "abc"
    get_settings.cache_clear()


# ---------------------------------------------------------------- e-mails
def test_email_escapa_os_dados_e_leva_a_logo_embutida():
    assunto, corpo = emails_senha.montar("codigo_recuperacao", {"nome": "<b>Ana</b>", "codigo": "123456", "data_hora": "x"})
    assert "Código" in assunto
    assert "&lt;b&gt;Ana&lt;/b&gt;" in corpo and "<b>Ana</b>" not in corpo
    assert "123456" in corpo and "cid:conecta-logo" in corpo
    _, corpo_ti = emails_senha.montar("aviso_ti", {"evento": "Conta bloqueada", "conta_nome": "Ana"})
    assert "{conta_nome}" not in corpo_ti and "Ana" in corpo_ti


def test_todos_os_modelos_tem_assunto_e_arquivo():
    for nome in emails_senha.ASSUNTOS:
        assunto, corpo = emails_senha.montar(nome, {})
        assert assunto and "<html" in corpo.lower()


# ---------------------------------------------------------------- rotas do Esqueci a senha
class RepoRecuperacao:
    def __init__(self):
        self.pedidos: list = []
        self.limites: list = []

    def iniciar_recuperacao_senha(self, identificador, *, origem=""):
        self.pedidos.append(identificador)
        return {"tipo": "codigo", "email_mascarado": "an*****@empresa.com", "validade_minutos": 15}

    def concluir_recuperacao_senha(self, identificador, codigo, nova_senha, *, origem=""):
        senha_politica.validar(nova_senha)
        return {"success": True, "message": "Senha criada. Entre com a senha nova."}

    def registrar_limite_recuperacao(self, identificador, *, origem=""):
        self.limites.append(identificador)


@pytest.fixture
def cliente():
    auth_routes.recuperacao_limiter = type(auth_routes.recuperacao_limiter)()
    repo = RepoRecuperacao()
    app = FastAPI()
    app.include_router(auth_routes.router)
    app.dependency_overrides[get_repository] = lambda: repo
    return TestClient(app), repo


def test_pedido_de_codigo_e_limite_de_3_por_hora(cliente):
    client, repo = cliente
    for _ in range(3):
        r = client.post("/auth/recuperar/iniciar", json={"identificador": "ana@empresa.com"})
        assert r.status_code == 200
        assert r.json()["email_mascarado"] == "an*****@empresa.com"
    r = client.post("/auth/recuperar/iniciar", json={"identificador": "ANA@empresa.com"})
    assert r.status_code == 429
    assert "Aguarde 15 minutos" in r.json()["detail"]
    assert repo.limites == ["ana@empresa.com"]
    assert len(repo.pedidos) == 3


def test_concluir_confere_a_regra_da_senha(cliente):
    client, _ = cliente
    fraca = client.post("/auth/recuperar/concluir", json={"identificador": "ana", "codigo": "123456", "nova_senha": "abc"})
    assert fraca.status_code == 422
    ok = client.post("/auth/recuperar/concluir",
                     json={"identificador": "ana", "codigo": "123456", "nova_senha": "Conecta#2026"})
    assert ok.status_code == 200 and "Senha criada" in ok.json()["message"]


def test_regras_publicas_da_senha(cliente):
    client, _ = cliente
    r = client.get("/auth/senha/regras")
    assert r.status_code == 200 and r.json()["tamanho_minimo"] >= 8


def test_prazos_aprovados():
    assert senha_politica.CODIGO_MINUTOS == 15
    assert senha_politica.PROVISORIA_HORAS == 24
    assert senha_politica.TEMPORARIA_DIAS == 7
    assert senha_politica.ERROS_PARA_BLOQUEIO == 5
    assert timedelta(minutes=senha_politica.BLOQUEIO_MINUTOS) == timedelta(minutes=15)
