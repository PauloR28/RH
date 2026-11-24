"""Configurações › Segurança (Etapa 7b): política global e regra de inatividade."""

from datetime import datetime, timedelta

from rh_api.services import inatividade
from rh_api.services import seguranca_config as sc


def teardown_function():
    sc.definir_carregador(None)


def test_padrao_sem_banco():
    sc.definir_carregador(lambda: {})
    dados = sc.ler()
    assert dados["inatividade_bloqueio_dias"] == 60
    assert dados["inatividade_exclusao_dias"] == 120
    assert dados["senha_tamanho_minimo"] == 8
    assert dados["inatividade_ativa"] is True


def test_limites_e_exclusao_depois_do_bloqueio():
    dados = sc.normalizar({"senha_tamanho_minimo": "3", "inatividade_bloqueio_dias": "90", "inatividade_exclusao_dias": "60", "sessao_maxima_minutos": "10"})
    assert dados["senha_tamanho_minimo"] == 8
    assert dados["inatividade_exclusao_dias"] == 120  # bloqueio + 30
    assert dados["sessao_maxima_minutos"] == 30


def test_sessao_maxima_usa_servidor_quando_nao_gravada():
    sc.definir_carregador(lambda: {})
    assert sc.sessao_maxima_minutos(480) == 480
    sc.definir_carregador(lambda: {"sessao_maxima_minutos": "240"})
    assert sc.sessao_maxima_minutos(480) == 240


def test_mensagem_senha_segue_a_tela():
    sc.definir_carregador(lambda: {"senha_tamanho_minimo": "12"})
    assert sc.tamanho_minimo_senha() == 12
    assert "12 caracteres" in sc.mensagem_senha_curta()


def test_classificar_inatividade():
    agora = datetime(2026, 11, 17, 4, 0)
    config = sc.normalizar({})

    def u(i, dias, status="Ativo"):
        return {"id_usuario": i, "nome": f"U{i}", "email": f"u{i}@x", "perfil": "rh", "status": status, "referencia": agora - timedelta(days=dias)}

    lista = inatividade.classificar([u(1, 10), u(2, 55), u(3, 60), u(4, 119, "Bloqueado"), u(5, 120, "Bloqueado"), u(6, 200)], config, agora)
    assert [x["id_usuario"] for x in lista["avisar"]] == [2]
    assert [x["id_usuario"] for x in lista["bloquear"]] == [3]
    assert [x["id_usuario"] for x in lista["excluir"]] == [5, 6]
