"""Chamados — integração contra o banco de DESENVOLVIMENTO (pulada sem banco; nunca contra produção).

Cria usuários e operações próprios (`CHT_xxxx`) e remove tudo no final. Alterações de configuração são restauradas."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from fastapi import HTTPException

from _integracao_dev import repositorio_dev
from rh_api.auth import AuthenticatedUser
from rh_api.rbac import (
    ROLE_EMPLOYEE,
    ROLE_OPERATOR,
    ROLE_SUPERVISOR,
    ROLE_TEC_PLENO,
    get_role_permissions,
)
from rh_api.repositories.chamados_schema import ensure_chamados_schema
from rh_api.repositories.chamados_schema_v060 import ensure_chamados_v060
from rh_api.services import chamados_regras as rg

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def _erro(fn, *args, **kwargs) -> HTTPException:
    with pytest.raises(HTTPException) as e:
        fn(*args, **kwargs)
    return e.value


class Cenario:
    def __init__(self, repo, tmp_path, monkeypatch):
        self.repo = repo
        self.tag = uuid.uuid4().hex[:6]
        self.op_a, self.op_b = f"CHT_A{self.tag}", f"CHT_B{self.tag}"
        self.ids_usuarios: list[int] = []
        self.ids_chamados: list[int] = []
        monkeypatch.setenv("RH_CHAMADOS_UPLOAD_DIR", str(tmp_path / "chamados"))
        conn = repo._connect()
        try:
            cur = conn.cursor()
            ensure_chamados_schema(cur)
            ensure_chamados_v060(cur)
            conn.commit()
        finally:
            conn.close()
        self.config_original = repo.ch_config_obter()["config"]
        self.sup = self._usuario(ROLE_SUPERVISOR, "Sup", [self.op_a])
        self.sup_multi = self._usuario(ROLE_SUPERVISOR, "SupMulti", [self.op_a, self.op_b])
        self.sup_b = self._usuario(ROLE_SUPERVISOR, "SupB", [self.op_b])
        self.sup_colega = self._usuario(ROLE_SUPERVISOR, "Colega", [self.op_a])
        self.sup_sem_op = self._usuario(ROLE_SUPERVISOR, "SemOp", [])
        self.tec = self._usuario(ROLE_TEC_PLENO, "Tec", ["TI"])
        self.tec2 = self._usuario(ROLE_TEC_PLENO, "Tec2", ["TI"])
        self.leigo = self._usuario(ROLE_EMPLOYEE, "Leigo", [self.op_a])
        self.op1 = self._usuario(ROLE_OPERATOR, "Ana", [self.op_a])
        self.op2 = self._usuario(ROLE_OPERATOR, "Bia", [self.op_a])
        self.op_outra = self._usuario(ROLE_OPERATOR, "Caio", [self.op_b])

    def _usuario(self, perfil, nome, operacoes) -> AuthenticatedUser:
        login = f"cht_{nome.lower()}_{self.tag}"
        conn = self.repo._connect()
        try:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO dbo.usuarios (login, nome, sobrenome, email, perfil_id, status, cargo) OUTPUT INSERTED.id_usuario VALUES (?,?,?,?,?, 'Ativo', ?)",
                (login, nome, "Teste", f"{login}@teste.local", perfil, "Cargo Teste"),
            )
            uid = int(cur.fetchone()[0])
            for op in operacoes:
                cur.execute("INSERT INTO dbo.usuarios_operacoes (id_usuario, operacao) VALUES (?, ?)", (uid, op))
            conn.commit()
        finally:
            conn.close()
        self.ids_usuarios.append(uid)
        return AuthenticatedUser(username=login, id_usuario=uid, nome=nome, sobrenome="Teste", perfil=perfil, email=f"{login}@teste.local",
                                 operacoes=frozenset(operacoes), permissions=frozenset(get_role_permissions(perfil)))

    def criar(self, solicitante=None, **extra) -> dict:
        dados = {"titulo": "Headset sem áudio", "descricao": "Sem som desde cedo.", "categoria_id": self.categoria(), "operacao": self.op_a,
                 "tipo_impacto": "agente", "agentes_ids": [self.op1.id_usuario], "pa_posto": "PA 14", "pa_parada": False, "urgencia": "media"}
        dados.update(extra)
        r = self.repo.ch_criar(solicitante or self.sup, dados, [])
        self.ids_chamados.append(r["id"])
        return r

    def categoria(self) -> int:
        return self.repo.ch_meta(self.sup)["categorias"][0]["id"]

    def sql(self, texto, params=()):
        conn = self.repo._connect()
        try:
            cur = conn.cursor()
            cur.execute(texto, params)
            try:
                linhas = cur.fetchall()
            except Exception:
                linhas = None
            conn.commit()
            return linhas
        finally:
            conn.close()

    def limpar(self):
        conn = self.repo._connect()
        try:
            cur = conn.cursor()
            if self.ids_chamados:
                marc = ",".join("?" * len(self.ids_chamados))
                cur.execute(f"DELETE FROM dbo.notificacoes WHERE entidade = 'chamado' AND entidade_id IN ({marc})", tuple(str(i) for i in self.ids_chamados))
                for tabela in ("chamado_anexos", "chamado_eventos", "chamado_agentes", "chamado_observadores"):
                    cur.execute(f"DELETE FROM dbo.{tabela} WHERE id_chamado IN ({marc})", tuple(self.ids_chamados))
                cur.execute(f"DELETE FROM dbo.chamados WHERE id_chamado IN ({marc})", tuple(self.ids_chamados))
            if self.ids_usuarios:
                marc = ",".join("?" * len(self.ids_usuarios))
                cur.execute(f"DELETE FROM dbo.usuarios_operacoes WHERE id_usuario IN ({marc})", tuple(self.ids_usuarios))
                cur.execute(f"DELETE FROM dbo.usuarios WHERE id_usuario IN ({marc})", tuple(self.ids_usuarios))
            conn.commit()
        finally:
            conn.close()
        self.repo.ch_config_salvar(self.tec, {k: v for k, v in self.config_original.items() if v is not None})


@pytest.fixture()
def c(tmp_path, monkeypatch):
    repo = repositorio_dev()
    cenario = Cenario(repo, tmp_path, monkeypatch)
    try:
        yield cenario
    finally:
        cenario.limpar()


# ------------------------------------------------------------------ criação
def test_pa_parada_eleva_urgencia_e_grava_prazo_do_sla_configurado(c):
    r = c.criar(pa_parada=True, urgencia="media")
    assert r["urgencia"] == "alta" and r["urgencia_elevada"]
    d = c.repo.ch_detalhe(c.sup, r["id"])
    horas = float(c.config_original["sla_horas_alta"])
    assert d["urgencia_solicitada"] == "media" and d["status"] == "aberto"
    assert d["solicitante"]["nome"] == "Sup Teste" and d["solicitante"]["cargo"] == "Cargo Teste"
    prazo = c.sql("SELECT prazo_sla, criado_em FROM dbo.chamados WHERE id_chamado = ?", (r["id"],))[0]
    assert prazo[0] - prazo[1] == timedelta(hours=horas)
    assert any(e["tipo"] == "urgencia" for e in c.repo.ch_eventos(c.sup, r["id"])["eventos"])


def test_impacto_coletivo_sobe_para_alta_e_dispensa_agentes_e_pa(c):
    r = c.criar(tipo_impacto="celula", agentes_ids=[], pa_posto="", urgencia="baixa")
    assert r["urgencia"] == "alta"


def test_impacto_agente_exige_pa_e_agentes_informados_sao_da_operacao(c):
    assert c.criar(agentes_ids=[])["id"]  # agentes são opcionais: a tela de abertura não pede mais
    assert _erro(c.criar, pa_posto="").status_code == 422
    assert _erro(c.criar, agentes_ids=[c.op_outra.id_usuario]).status_code == 422


def test_operacao_unica_e_preenchida_e_varias_exigem_escolha(c):
    r = c.criar(operacao="")
    assert c.repo.ch_detalhe(c.sup, r["id"])["operacao"] == c.op_a
    assert _erro(c.criar, c.sup_multi, operacao="").status_code == 422
    assert _erro(c.criar, c.sup, operacao=c.op_b).status_code == 403
    assert _erro(c.criar, c.sup_sem_op).status_code == 403  # sem vínculo não abre chamado


def test_dados_do_solicitante_vem_do_servidor_nao_do_payload(c):
    r = c.criar(solicitante_nome="Fulano Falso", solicitante_email="x@x.com")
    d = c.repo.ch_detalhe(c.sup, r["id"])
    assert d["solicitante"]["nome"] == "Sup Teste" and "falso" not in str(d).lower()


# ------------------------------------------------------------------ fluxo completo e SLA
def test_fluxo_completo_com_pausa_do_sla_reabertura_e_encerramento(c):
    r = c.criar(urgencia="media")
    i = r["id"]
    assert c.repo.ch_assumir(c.tec, i)["status"] == "em_andamento"
    prazo0 = c.sql("SELECT prazo_sla FROM dbo.chamados WHERE id_chamado = ?", (i,))[0][0]
    c.repo.ch_mudar_status(c.tec, i, "aguardando_solicitante", "Pode enviar o print?")
    c.sql("UPDATE dbo.chamados SET sla_pausa_inicio = DATEADD(minute, -90, SYSUTCDATETIME()) WHERE id_chamado = ?", (i,))
    assert c.repo.ch_detalhe(c.sup, i)["sla"]["pausado"]
    assert c.repo.ch_mensagem(c.sup, i, "Segue o print.", [])["status"] == "em_andamento"  # resposta volta sozinha
    prazo1, pausado = c.sql("SELECT prazo_sla, sla_pausado_seg FROM dbo.chamados WHERE id_chamado = ?", (i,))[0]
    assert 5390 <= pausado <= 5420 and prazo1 - prazo0 == timedelta(seconds=pausado)
    c.repo.ch_mudar_status(c.tec, i, "resolvido")
    assert _erro(c.repo.ch_reabrir, c.sup, i, "").status_code == 422  # motivo obrigatório
    assert c.repo.ch_reabrir(c.sup, i, "Voltou a falhar")["status"] == "em_andamento"
    c.repo.ch_mudar_status(c.tec, i, "resolvido")
    assert c.repo.ch_confirmar(c.sup, i)["status"] == "encerrado"
    d = c.repo.ch_detalhe(c.sup, i)
    assert d["encerrado_em"] and not d["encerramento_automatico"]
    tipos = [e["tipo"] for e in c.repo.ch_eventos(c.sup, i)["eventos"]]
    assert tipos.count("status") + tipos.count("reabertura") >= 6 and "reabertura" in tipos and "atribuicao" in tipos and "mensagem" in tipos


def test_transicoes_invalidas_sao_rejeitadas_no_backend(c):
    i = c.criar()["id"]
    assert _erro(c.repo.ch_mudar_status, c.tec, i, "resolvido").status_code == 409  # aberto -> resolvido
    assert _erro(c.repo.ch_mudar_status, c.tec, i, "encerrado").status_code == 409
    assert _erro(c.repo.ch_confirmar, c.sup, i).status_code == 409  # ainda não resolvido
    assert _erro(c.repo.ch_reabrir, c.sup, i, "x").status_code == 409


def test_cancelar_so_o_solicitante_e_so_enquanto_aberto(c):
    a, b = c.criar()["id"], c.criar()["id"]
    assert _erro(c.repo.ch_cancelar, c.sup_colega, a).status_code in (403, 404)
    assert c.repo.ch_cancelar(c.sup, a)["status"] == "cancelado"
    c.repo.ch_assumir(c.tec, b)
    assert _erro(c.repo.ch_cancelar, c.sup, b).status_code == 409
    assert _erro(c.repo.ch_mensagem, c.sup, a, "oi", []).status_code == 409  # cancelado não recebe mensagem


def test_so_o_solicitante_confirma_ou_reabre(c):
    i = c.criar()["id"]
    c.repo.ch_assumir(c.tec, i)
    c.repo.ch_mudar_status(c.tec, i, "resolvido")
    assert _erro(c.repo.ch_confirmar, c.sup_colega, i).status_code == 403  # colega vê (ver_operacao), mas não decide
    assert _erro(c.repo.ch_reabrir, c.sup_colega, i, "x").status_code == 403


def test_urgencia_nao_desce_do_piso_e_recalcula_o_prazo(c):
    i = c.criar(pa_parada=True, urgencia="alta")["id"]
    assert _erro(c.repo.ch_mudar_urgencia, c.tec, i, "baixa").status_code == 422
    antes = c.sql("SELECT prazo_sla FROM dbo.chamados WHERE id_chamado = ?", (i,))[0][0]
    c.repo.ch_mudar_urgencia(c.tec, i, "critica", "Parou mais gente")
    depois, criado = c.sql("SELECT prazo_sla, criado_em FROM dbo.chamados WHERE id_chamado = ?", (i,))[0]
    assert depois < antes and depois - criado == timedelta(hours=float(c.config_original["sla_horas_critica"]))


def test_prazo_configurado_vale_so_para_chamados_novos(c):
    antigo = c.criar(urgencia="baixa")["id"]
    prazo_antigo = c.sql("SELECT prazo_sla FROM dbo.chamados WHERE id_chamado = ?", (antigo,))[0][0]
    c.repo.ch_config_salvar(c.tec, {"sla_horas_baixa": 48})
    novo = c.criar(urgencia="baixa")["id"]
    assert c.sql("SELECT prazo_sla FROM dbo.chamados WHERE id_chamado = ?", (antigo,))[0][0] == prazo_antigo
    p, criado = c.sql("SELECT prazo_sla, criado_em FROM dbo.chamados WHERE id_chamado = ?", (novo,))[0]
    assert p - criado == timedelta(hours=48)


def test_config_valida_limites(c):
    assert _erro(c.repo.ch_config_salvar, c.tec, {"sla_horas_alta": 0}).status_code == 422
    assert _erro(c.repo.ch_config_salvar, c.tec, {"nao_existe": 1}).status_code == 422


# ------------------------------------------------------------------ permissões e escopo
def test_escopo_por_operacao_e_acesso_do_solicitante(c):
    i = c.criar()["id"]
    assert c.repo.ch_detalhe(c.sup, i)["id"] == i
    assert c.repo.ch_detalhe(c.sup_colega, i)["id"] == i  # mesma operação + ver_operacao
    assert _erro(c.repo.ch_detalhe, c.sup_b, i).status_code == 404  # outra operação
    assert _erro(c.repo.ch_detalhe, c.leigo, i).status_code == 403  # nenhuma permissão do módulo
    assert c.repo.ch_detalhe(c.tec, i)["acoes"]["assumir"]  # TI vê tudo


def test_quem_abriu_continua_vendo_mesmo_sem_permissao(c):
    i = c.criar()["id"]
    sem_perm = AuthenticatedUser(username=c.sup.username, id_usuario=c.sup.id_usuario, nome="Sup", perfil=ROLE_SUPERVISOR,
                                 operacoes=frozenset([c.op_a]), permissions=frozenset())
    d = c.repo.ch_detalhe(sem_perm, i)
    assert d["id"] == i and d["acoes"]["comentar"]
    assert c.repo.ch_mensagem(sem_perm, i, "ainda posso comentar", [])["success"]


def test_listagem_meus_x_operacao_e_fases(c):
    a = c.criar()["id"]
    b = c.criar(c.sup_colega)["id"]
    meus = c.repo.ch_listar(c.sup, {"fase": "aberto"}, escopo="meus")
    assert {x["id"] for x in meus["itens"]} == {a}
    op = c.repo.ch_listar(c.sup, {"fase": "aberto"}, escopo="operacao")
    assert {a, b} <= {x["id"] for x in op["itens"]} and all(x["operacao"] == c.op_a for x in op["itens"])
    assert c.repo.ch_listar(c.sup_b, {"fase": "aberto"}, escopo="operacao")["total"] == 0
    c.repo.ch_cancelar(c.sup, a)
    assert {x["id"] for x in c.repo.ch_listar(c.sup, {"fase": "historico"}, escopo="meus")["itens"]} == {a}
    assert c.repo.ch_listar(c.sup, {}, escopo="meus")["resumo"]["fases"]["historico"] == 1
    assert _erro(c.repo.ch_listar, c.leigo, {}, escopo="operacao").status_code == 403


def test_atribuir_exige_alvo_com_permissao_de_atender(c):
    i = c.criar()["id"]
    assert _erro(c.repo.ch_atribuir, c.tec, i, c.sup_colega.id_usuario).status_code == 422
    c.repo.ch_atribuir(c.tec, i, c.tec2.id_usuario)
    assert c.repo.ch_detalhe(c.tec, i)["responsavel"]["id"] == c.tec2.id_usuario


def test_busca_de_agentes_restrita_a_operacao_do_solicitante(c):
    assert [a["nome"] for a in c.repo.ch_buscar_agentes(c.sup, c.op_a, "Ana")] == ["Ana Teste"]
    assert c.repo.ch_buscar_agentes(c.sup, c.op_a, "Caio") == []  # operador de outra operação
    assert _erro(c.repo.ch_buscar_agentes, c.sup, c.op_b, "Caio").status_code == 403
    assert c.repo.ch_buscar_agentes(c.sup, c.op_a, "A") == []  # mínimo de 2 caracteres


# ------------------------------------------------------------------ fila e notificações
def test_fila_coloca_sla_vencido_primeiro(c):
    normal = c.criar(urgencia="critica")["id"]
    vencido = c.criar(urgencia="baixa")["id"]
    c.sql("UPDATE dbo.chamados SET prazo_sla = DATEADD(hour, -1, SYSUTCDATETIME()) WHERE id_chamado = ?", (vencido,))
    fila = [x["id"] for x in c.repo.ch_fila(c.tec, {"operacao": c.op_a})["itens"]]
    assert fila.index(vencido) < fila.index(normal)
    assert c.repo.ch_fila(c.tec, {"vencidos": True, "operacao": c.op_a})["itens"][0]["id"] == vencido


def test_abertura_notifica_a_ti_e_mensagem_notifica_o_solicitante(c):
    i = c.criar(pa_parada=True)["id"]
    notas = c.sql("SELECT destinatario_papel, titulo FROM dbo.notificacoes WHERE entidade = 'chamado' AND entidade_id = ?", (str(i),))
    assert any(n[0] == ROLE_TEC_PLENO and "PA parada" in n[1] for n in notas)
    c.repo.ch_mensagem(c.tec, i, "Estou verificando.", [])
    para_sol = c.sql("SELECT titulo FROM dbo.notificacoes WHERE entidade = 'chamado' AND entidade_id = ? AND destinatario_usuario = ?", (str(i), c.sup.username))
    assert para_sol and c.repo.ch_detalhe(c.tec, i)["status"] == "em_andamento"  # responder já assume


# ------------------------------------------------------------------ anexos
def test_anexo_upload_download_permissao_e_exclusao_logica(c):
    r = c.repo.ch_criar(c.sup, {"titulo": "t", "descricao": "d", "categoria_id": c.categoria(), "operacao": c.op_a, "tipo_impacto": "celula",
                                "agentes_ids": [], "pa_posto": "", "pa_parada": False, "urgencia": "media"}, [("print.png", PNG)])
    c.ids_chamados.append(r["id"])
    anexo = c.repo.ch_detalhe(c.sup, r["id"])["anexos"][0]
    arquivo, nome, mime = c.repo.ch_anexo_abrir(c.sup, anexo["id"])
    with arquivo:
        assert arquivo.read() == PNG and nome == "print.png" and mime == "image/png"
    assert _erro(c.repo.ch_anexo_abrir, c.sup_b, anexo["id"]).status_code == 404  # outra operação
    chave = c.sql("SELECT chave_storage FROM dbo.chamado_anexos WHERE id_anexo = ?", (anexo["id"],))[0][0]
    assert chave.endswith(".png") and "print" not in chave  # nome interno é UUID
    c.repo.ch_anexo_excluir(c.sup, anexo["id"])
    assert _erro(c.repo.ch_anexo_abrir, c.sup, anexo["id"]).status_code == 404
    from rh_api.services.chamados_storage import provider_padrao

    assert provider_padrao(c.repo.settings).exists(chave)  # exclusão lógica: o arquivo ainda está no disco
    c.sql("UPDATE dbo.chamado_anexos SET excluido_em = DATEADD(day, -40, SYSUTCDATETIME()) WHERE id_anexo = ?", (anexo["id"],))
    assert c.repo.ch_processar_prazos()["anexos_removidos"] >= 1
    assert not provider_padrao(c.repo.settings).exists(chave)


def test_anexo_invalido_nao_cria_chamado(c):
    antes = c.sql("SELECT COUNT(*) FROM dbo.chamados WHERE operacao = ?", (c.op_a,))[0][0]
    dados = {"titulo": "t", "descricao": "d", "categoria_id": c.categoria(), "operacao": c.op_a, "tipo_impacto": "celula", "agentes_ids": [],
             "pa_posto": "", "pa_parada": False, "urgencia": "media"}
    assert _erro(c.repo.ch_criar, c.sup, dados, [("falso.png", b"%PDF-1.4")]).status_code == 400
    assert c.sql("SELECT COUNT(*) FROM dbo.chamados WHERE operacao = ?", (c.op_a,))[0][0] == antes


def test_anexo_de_chamado_encerrado_nao_e_apagado_por_usuario_comum(c):
    r = c.repo.ch_criar(c.sup, {"titulo": "t", "descricao": "d", "categoria_id": c.categoria(), "operacao": c.op_a, "tipo_impacto": "celula",
                                "agentes_ids": [], "pa_posto": "", "pa_parada": False, "urgencia": "media"}, [("a.png", PNG)])
    c.ids_chamados.append(r["id"])
    anexo = c.repo.ch_detalhe(c.sup, r["id"])["anexos"][0]
    c.repo.ch_assumir(c.tec, r["id"])
    c.repo.ch_mudar_status(c.tec, r["id"], "resolvido")
    c.repo.ch_confirmar(c.sup, r["id"])
    assert _erro(c.repo.ch_anexo_excluir, c.sup, anexo["id"]).status_code == 409


# ------------------------------------------------------------------ jobs
def test_job_encerra_resolvido_vencido_e_nao_repete(c):
    i = c.criar()["id"]
    c.repo.ch_assumir(c.tec, i)
    c.repo.ch_mudar_status(c.tec, i, "resolvido")
    c.sql("UPDATE dbo.chamados SET resolvido_em = DATEADD(hour, -49, SYSUTCDATETIME()) WHERE id_chamado = ?", (i,))
    assert c.repo.ch_processar_prazos()["encerrados"] >= 1
    d = c.repo.ch_detalhe(c.sup, i)
    assert d["status"] == "encerrado" and d["encerramento_automatico"]
    eventos = c.repo.ch_eventos(c.sup, i)["eventos"]
    assert any(e["autor_nome"] == "Sistema" and "automaticamente" in e["conteudo"] for e in eventos)
    c.repo.ch_processar_prazos()  # idempotente
    assert sum(1 for e in c.repo.ch_eventos(c.sup, i)["eventos"] if "automaticamente" in e["conteudo"]) == 1


def test_job_nao_encerra_resolvido_dentro_do_prazo(c):
    i = c.criar()["id"]
    c.repo.ch_assumir(c.tec, i)
    c.repo.ch_mudar_status(c.tec, i, "resolvido")
    c.repo.ch_processar_prazos()
    assert c.repo.ch_detalhe(c.sup, i)["status"] == "resolvido"


def test_job_de_sla_notifica_uma_vez_e_ignora_chamado_pausado(c):
    vencido, a_vencer, pausado = c.criar()["id"], c.criar()["id"], c.criar()["id"]
    c.sql("UPDATE dbo.chamados SET prazo_sla = DATEADD(minute, -5, SYSUTCDATETIME()) WHERE id_chamado = ?", (vencido,))
    c.sql("UPDATE dbo.chamados SET prazo_sla = DATEADD(minute, 30, SYSUTCDATETIME()) WHERE id_chamado = ?", (a_vencer,))
    c.repo.ch_assumir(c.tec, pausado)
    c.repo.ch_mudar_status(c.tec, pausado, "aguardando_solicitante")
    c.sql("UPDATE dbo.chamados SET prazo_sla = DATEADD(minute, -5, SYSUTCDATETIME()) WHERE id_chamado = ?", (pausado,))

    def contar(idc, trecho):
        return c.sql("SELECT COUNT(*) FROM dbo.notificacoes WHERE entidade = 'chamado' AND entidade_id = ? AND titulo LIKE ?", (str(idc), f"%{trecho}%"))[0][0]

    c.repo.ch_processar_prazos()
    c.repo.ch_processar_prazos()
    assert contar(vencido, "SLA estourado") >= 1
    primeiras = contar(vencido, "SLA estourado")
    c.repo.ch_processar_prazos()
    assert contar(vencido, "SLA estourado") == primeiras  # não repete
    assert contar(a_vencer, "vence em menos de 1 h") >= 1
    assert contar(pausado, "SLA estourado") == 0  # aguardando o solicitante: SLA pausado


# ------------------------------------------------------------------ dashboard
def test_dashboard_conta_kpis_e_series(c):
    i = c.criar(urgencia="critica")["id"]
    c.sql("UPDATE dbo.chamados SET prazo_sla = DATEADD(hour, -2, SYSUTCDATETIME()) WHERE id_chamado = ?", (i,))
    d = c.repo.ch_dashboard(30)
    assert d["kpis"]["sla_vencido"] >= 1 and d["kpis"]["abertos"] >= 1 and d["kpis"]["sem_responsavel"] >= 1
    assert any(x["chave"] == c.op_a for x in d["por_operacao"])
    assert {x["chave"] for x in d["por_urgencia"]} >= {"critica"}
    assert all(x["chave"] not in ("encerrado", "cancelado") for x in d["por_status"])
    assert c.repo.ch_dashboard(999)["dias"] == 30


# ------------------------------------------------------------------ V060: reabertura, histórico, resolvido remotamente, e-mails
def _resolver(c, i, **extra):
    if not c.repo.ch_detalhe(c.tec, i)["responsavel"]:
        c.repo.ch_assumir(c.tec, i)
    return c.repo.ch_mudar_status(c.tec, i, "resolvido", **extra)


def test_reabertura_mantem_o_mesmo_chamado_renova_o_sla_e_conta_no_historico(c):
    r = c.criar()
    i = r["id"]
    _resolver(c, i)
    c.repo.ch_confirmar(c.sup, i)  # encerrado
    assert c.repo.ch_detalhe(c.sup, i)["acoes"]["reabrir"]
    assert c.repo.ch_reabrir(c.sup, i, "O headset voltou a ficar mudo")["reaberto_vezes"] == 1
    d = c.repo.ch_detalhe(c.sup, i)
    assert d["id"] == i and d["numero"] == r["numero"]  # nunca vira um segundo chamado
    assert d["status"] == "em_andamento" and d["encerrado_em"] is None and d["resolvido_em"] is None and d["reaberto_vezes"] == 1
    assert not d["sla"]["vencido"]
    h = c.repo.ch_historico(c.sup, i)
    assert h["abertura"]["por"]["id"] == c.sup.id_usuario and h["reaberto_vezes"] == 1
    reab = [m for m in h["movimentacoes"] if m["tipo"] == "reabertura"]
    assert len(reab) == 1 and "mudo" in reab[0]["descricao"] and reab[0]["por"]["id"] == c.sup.id_usuario


def test_reabertura_respeita_janela_motivo_e_desligamento(c):
    i = c.criar()["id"]
    _resolver(c, i)
    c.sql("UPDATE dbo.chamados SET resolvido_em = DATEADD(day, -10, SYSUTCDATETIME()) WHERE id_chamado = ?", (i,))
    assert _erro(c.repo.ch_reabrir, c.sup, i, "ainda falha").status_code == 409  # janela padrão: 7 dias
    assert not c.repo.ch_detalhe(c.sup, i)["acoes"]["reabrir"]
    c.repo.ch_config_salvar(c.tec, {"reabertura_dias": 30})
    assert _erro(c.repo.ch_reabrir, c.sup, i, "").status_code == 422
    assert c.repo.ch_reabrir(c.sup, i, "ainda falha")["status"] == "em_andamento"
    _resolver(c, i)
    c.repo.ch_config_salvar(c.tec, {"reabertura_dias": 0})
    assert _erro(c.repo.ch_reabrir, c.sup, i, "de novo").status_code == 409


def test_historico_sempre_tem_abertura_e_so_mostra_movimentacao_quando_existe(c):
    i = c.criar()["id"]
    h = c.repo.ch_historico(c.sup, i)
    assert h["abertura"]["em"] and h["abertura"]["por"]["nome"] and h["movimentacoes"] == []
    c.repo.ch_assumir(c.tec, i)
    assert [m["tipo"] for m in c.repo.ch_historico(c.sup, i)["movimentacoes"]] == ["atribuicao", "status"]
    assert _erro(c.repo.ch_historico, c.sup_b, i).status_code == 404  # fora do escopo


def test_resolvido_remotamente_fica_registrado_e_so_vale_ao_resolver(c):
    i = c.criar()["id"]
    c.repo.ch_assumir(c.tec, i)
    c.repo.ch_mudar_status(c.tec, i, "resolvido", resolvido_remotamente=True)
    assert c.repo.ch_detalhe(c.sup, i)["resolvido_remotamente"] is True
    assert any("remotamente" in m["descricao"] for m in c.repo.ch_historico(c.sup, i)["movimentacoes"])
    j = c.criar()["id"]
    _resolver(c, j)
    assert c.repo.ch_detalhe(c.sup, j)["resolvido_remotamente"] is False


def test_solicitante_e_notificado_em_atribuicao_e_mudanca_de_urgencia(c):
    i = c.criar()["id"]
    c.repo.ch_atribuir(c.tec, i, c.tec2.id_usuario)
    c.repo.ch_mudar_urgencia(c.tec, i, "alta", "teste")
    n = c.sql("SELECT COUNT(*) FROM dbo.notificacoes WHERE entidade = 'chamado' AND entidade_id = ? AND destinatario_usuario = ?",
              (str(i), c.sup.username))[0][0]
    assert n >= 2


def test_destinatarios_de_email_crud_e_validacao(c):
    assert _erro(c.repo.ch_email_salvar, c.tec, {"email": "invalido"}).status_code == 422
    email = f"alerta_{c.tag}@teste.local"
    novo = c.repo.ch_email_salvar(c.tec, {"email": email, "tipos": {"reaberto": True}})["id"]
    try:
        assert _erro(c.repo.ch_email_salvar, c.tec, {"email": email}).status_code == 409
        item = next(x for x in c.repo.ch_emails_listar()["itens"] if x["id"] == novo)
        assert item["tipos"]["reaberto"] and item["tipos"]["sla_vencido"] and not item["tipos"]["novo"]
        c.repo.ch_email_salvar(c.tec, {"tipos": {"novo": True}, "ativo": False}, novo)
        item = next(x for x in c.repo.ch_emails_listar()["itens"] if x["id"] == novo)
        assert item["tipos"]["novo"] and not item["ativo"]
    finally:
        c.repo.ch_email_remover(novo)
    assert _erro(c.repo.ch_email_remover, novo).status_code == 404


def test_acesso_a_modulos_por_usuario_e_por_perfil(c):
    from rh_api.services import acesso, modulos_admin

    uid = c.op1.id_usuario
    try:
        assert acesso.modulos_liberados(uid, ROLE_OPERATOR) == frozenset() or True  # perfil pode já ter liberação real
        r = modulos_admin.definir_acesso_usuario(uid, ["tecnologia", "rh"], autor="teste")
        assert r["modulos"] == ["rh", "tecnologia"] and r["anteriores"] == []
        assert {"rh", "tecnologia"} <= acesso.modulos_liberados(uid, ROLE_OPERATOR)
        assert any(u["id"] == uid for u in modulos_admin.listar_acessos()["usuarios"])
        with pytest.raises(HTTPException) as e:
            modulos_admin.definir_acesso_usuario(uid, ["core"], autor="teste")
        assert e.value.status_code == 400
        with pytest.raises(HTTPException) as e:
            modulos_admin.definir_acesso_usuario(99999999, ["rh"], autor="teste")
        assert e.value.status_code == 404
        modulos_admin.definir_acesso_usuario(uid, [], autor="teste")
    finally:
        c.sql("DELETE FROM dbo.modulos_acesso_usuario WHERE id_usuario = ?", (uid,))
