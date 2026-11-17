"""LGPD › catálogo único dos dados sensíveis (Etapa 7c)."""

from rh_api.services import lgpd_catalogo as cat


def test_todo_tipo_tem_acao_valida_e_ids_unicos():
    assert len(cat.POR_ID) == len(cat.TIPOS)
    for tipo in cat.TIPOS:
        assert tipo.acao in tipo.acoes, tipo.id
        assert set(tipo.acoes) <= set(cat.ACOES), tipo.id
        assert tipo.modulo in {"rh", "operacao", "tecnologia"}, tipo.id


def test_tipo_sem_rotina_nunca_liga():
    tipo = cat.POR_ID["monitoria_anexos"]
    assert tipo.rotina is False
    assert cat.normalizar(tipo, {"ativo": "1", "meses": "300", "acao": "anonimizar"}) == {"ativo": False, "meses": 120, "acao": "apagar_arquivos"}


def test_candidatos_nao_duplicam_configuracao():
    assert {t.id for t in cat.TIPOS if t.origem == "candidatos"} == {"candidaturas", "banco_talentos", "cvs_email"}
    assert not ({"candidaturas", "banco_talentos", "cvs_email"} & cat.EDITAVEIS)


class _Cursor:
    def __init__(self, linhas):
        self.linhas, self.description, self.sql = linhas, [("c",)], []

    def execute(self, sql, params=()):
        self.sql.append((sql, params))

    def fetchall(self):
        return self.linhas


def test_ler_monta_por_tipo():
    cursor = _Cursor([("lgpd.atestados.meses", "48"), ("lgpd.atestados.acao", "anonimizar"), ("lgpd.lixo", "x")])
    dados = cat.ler(cursor)
    assert dados["atestados"] == {"ativo": False, "meses": 48, "acao": "anonimizar"}
    assert dados["chamados_anexos"]["meses"] == 12
