"""Relatório Escalados (lista 10/11, item 17): uma linha por operador e dia, com a troca aprovada do dia."""
from datetime import date

from rh_api.repositories.wfm_relatorios import TIPOS, WfmRelatoriosRepositoryMixin


def _dia(id_op, d, codigo="M1", trabalha=True):
    return {"id_operador": id_op, "data": d, "codigo": codigo, "entrada": "06:00", "saida": "12:20", "trabalha": trabalha, "minutos": 360}


def test_escalados_marca_troca_aprovada_dos_dois_lados():
    d1, d2, d3 = date(2026, 11, 3), date(2026, 11, 4), date(2026, 11, 5)
    dado = {
        "operadores": [{"id_usuario": 1, "nome": "Ana", "equipe": "A"}, {"id_usuario": 2, "nome": "Bruno", "equipe": "B"}],
        "nomes": {1: "Ana", 2: "Bruno"},
        "dias_escala": [_dia(1, d1), _dia(1, d2), _dia(2, d3), _dia(2, d2, trabalha=False)],
        "trocas": [
            {"estado": "APROVADA", "id_solicitante": 1, "id_alvo": 2, "solicitante": "Ana", "alvo": "Bruno", "data_a": d1, "data_b": d3},
            {"estado": "REPROVADA", "id_solicitante": 1, "id_alvo": 2, "solicitante": "Ana", "alvo": "Bruno", "data_a": d2, "data_b": d3},
        ],
        "presencas": {(1, d1): {"status": "PRESENTE", "observacao": "", "lancado_por": "x"}},
        "pausas": {(1, d1): [{"tipo": "DESCANSO", "inicio": "08:00", "duracao_min": 10}, {"tipo": "REFEICAO", "inicio": "09:30", "duracao_min": 20}]},
    }
    colunas, linhas, resumo, _ = WfmRelatoriosRepositoryMixin()._wfm_rel_escalados(dado)
    assert "escalados" in TIPOS
    assert [c["rotulo"] for c in colunas][-3:] == ["Trocou?", "Com quem", "Dia que deu em troca"]
    assert len(linhas) == 3  # folga fica de fora
    ana_d1, ana_d2, bruno_d3 = linhas
    assert (ana_d1["dia"], ana_d1["equipe"], ana_d1["status_troca"], ana_d1["com_quem"], ana_d1["dia_troca"]) == ("Ter", "A", "Sim", "Bruno", "05/11/2026")
    assert ana_d2["status_troca"] == "Não" and ana_d2["com_quem"] == "—"  # troca reprovada não conta
    assert (bruno_d3["status_troca"], bruno_d3["com_quem"], bruno_d3["dia_troca"]) == ("Sim", "Ana", "03/11/2026")
    assert [r["valor"] for r in resumo] == [3, 2, 2]
    # Pausas previstas e presença do dia (pedido do Paulo 25/11)
    assert [c["rotulo"] for c in colunas][6:8] == ["Pausas", "Presença"]
    assert (ana_d1["pausas"], ana_d1["presenca"]) == ("08:00–08:10 · 09:30–09:50", "Presente")
    assert (ana_d2["pausas"], ana_d2["presenca"]) == ("—", "Sem lançamento")


def test_resumo_traz_monitorias_e_nota_media_so_para_quem_ve_monitoria():
    d1 = date(2026, 11, 3)
    base = {
        "operadores": [{"id_usuario": 1, "nome": "Ana", "equipe": "A"}, {"id_usuario": 2, "nome": "Bruno", "equipe": "A"}],
        "nomes": {1: "Ana", 2: "Bruno"}, "dias_escala": [_dia(1, d1)], "presencas": {}, "extras": {}, "trocas": [],
    }
    repo = WfmRelatoriosRepositoryMixin()
    colunas, linhas, _, _ = repo._wfm_rel_resumo({**base, "monitorias": None})
    assert "Monitorias" not in [c["rotulo"] for c in colunas]
    mon = {1: [{"id_operador": 1, "nota": 90.0, "anulada": False}, {"id_operador": 1, "nota": 80.0, "anulada": False}, {"id_operador": 1, "nota": 10.0, "anulada": True}]}
    colunas, linhas, _, calculo = repo._wfm_rel_resumo({**base, "monitorias": mon})
    assert ["Monitorias", "Nota média"] == [c["rotulo"] for c in colunas if c["chave"] in ("monitorias", "nota_media")]
    ana, bruno = linhas
    assert (ana["monitorias"], ana["nota_media"]) == (2, 85.0)  # anulada fica de fora
    assert (bruno["monitorias"], bruno["nota_media"]) == (0, None)
    assert any("Nota média" in c for c in calculo)
