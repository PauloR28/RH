"""Chamados — regras puras (sem banco): transições, piso de urgência, SLA, permissões iniciais, armazenamento e migration."""

from __future__ import annotations

import io
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi import HTTPException

from rh_api import rbac
from rh_api.modulos_catalogo import MODULO_TECNOLOGIA, abre_modulo_padrao, modulo_dono_padrao
from rh_api.repositories.chamados_schema import render_migration_sql, render_rollback_sql, schema_statements
from rh_api.services import chamados_regras as rg
from rh_api.services import chamados_storage as st

REPO_ROOT = Path(__file__).resolve().parents[3]
AGORA = datetime(2026, 10, 3, 12, 0, 0)


# ------------------------------------------------------------------ transições
@pytest.mark.parametrize(
    "origem,destino,ator",
    [
        (rg.ABERTO, rg.EM_ANDAMENTO, rg.ATOR_ATENDENTE),
        (rg.ABERTO, rg.CANCELADO, rg.ATOR_SOLICITANTE),
        (rg.EM_ANDAMENTO, rg.AGUARDANDO, rg.ATOR_ATENDENTE),
        (rg.AGUARDANDO, rg.EM_ANDAMENTO, rg.ATOR_SOLICITANTE),
        (rg.AGUARDANDO, rg.EM_ANDAMENTO, rg.ATOR_SISTEMA),
        (rg.EM_ANDAMENTO, rg.RESOLVIDO, rg.ATOR_ATENDENTE),
        (rg.RESOLVIDO, rg.ENCERRADO, rg.ATOR_SOLICITANTE),
        (rg.RESOLVIDO, rg.ENCERRADO, rg.ATOR_SISTEMA),
        (rg.RESOLVIDO, rg.EM_ANDAMENTO, rg.ATOR_SOLICITANTE),
    ],
)
def test_transicoes_do_diagrama_sao_validas(origem, destino, ator):
    assert rg.transicao_valida(origem, destino, ator)


def test_todo_par_fora_do_diagrama_e_rejeitado():
    validos = {
        (rg.ABERTO, rg.EM_ANDAMENTO), (rg.ABERTO, rg.CANCELADO), (rg.EM_ANDAMENTO, rg.AGUARDANDO), (rg.AGUARDANDO, rg.EM_ANDAMENTO),
        (rg.EM_ANDAMENTO, rg.RESOLVIDO), (rg.RESOLVIDO, rg.ENCERRADO), (rg.RESOLVIDO, rg.EM_ANDAMENTO),
        (rg.ENCERRADO, rg.EM_ANDAMENTO),  # reabertura (V060), só o solicitante
    }
    for origem in rg.STATUS:
        for destino in rg.STATUS:
            if (origem, destino) in validos:
                continue
            for ator in (rg.ATOR_ATENDENTE, rg.ATOR_SOLICITANTE, rg.ATOR_SISTEMA):
                assert not rg.transicao_valida(origem, destino, ator), (origem, destino, ator)


def test_so_o_solicitante_cancela_e_so_enquanto_aberto():
    assert not rg.transicao_valida(rg.ABERTO, rg.CANCELADO, rg.ATOR_ATENDENTE)
    assert not rg.transicao_valida(rg.EM_ANDAMENTO, rg.CANCELADO, rg.ATOR_SOLICITANTE)


def test_atendente_nao_encerra_nem_reabre():
    assert not rg.transicao_valida(rg.RESOLVIDO, rg.ENCERRADO, rg.ATOR_ATENDENTE)
    assert not rg.transicao_valida(rg.RESOLVIDO, rg.EM_ANDAMENTO, rg.ATOR_ATENDENTE)


def test_status_finais_nao_tem_saida():
    # Encerrado só sai pela reabertura do solicitante (V060); Cancelado nunca sai.
    for final in rg.STATUS_FINAIS - {rg.ENCERRADO}:
        for destino in rg.STATUS:
            assert not any(rg.transicao_valida(final, destino, a) for a in (rg.ATOR_ATENDENTE, rg.ATOR_SOLICITANTE, rg.ATOR_SISTEMA))


# ------------------------------------------------------------------ urgência
@pytest.mark.parametrize("solicitada", [rg.BAIXA, rg.MEDIA])
def test_pa_parada_eleva_para_alta(solicitada):
    efetiva, elevada = rg.aplicar_piso_urgencia(solicitada, pa_parada=True, tipo_impacto=rg.IMPACTO_AGENTE)
    assert efetiva == rg.ALTA and elevada


@pytest.mark.parametrize("solicitada", [rg.BAIXA, rg.MEDIA])
def test_impacto_coletivo_eleva_para_alta(solicitada):
    efetiva, elevada = rg.aplicar_piso_urgencia(solicitada, pa_parada=False, tipo_impacto=rg.IMPACTO_CELULA)
    assert efetiva == rg.ALTA and elevada


def test_pode_subir_para_critica_e_nunca_desce_de_alta():
    assert rg.aplicar_piso_urgencia(rg.CRITICA, pa_parada=True, tipo_impacto=rg.IMPACTO_AGENTE) == (rg.CRITICA, False)
    assert rg.aplicar_piso_urgencia(rg.ALTA, pa_parada=True, tipo_impacto=rg.IMPACTO_AGENTE) == (rg.ALTA, False)


def test_sem_regra_a_urgencia_escolhida_vale():
    for u in rg.URGENCIAS:
        assert rg.aplicar_piso_urgencia(u, pa_parada=False, tipo_impacto=rg.IMPACTO_AGENTE) == (u, False)


# ------------------------------------------------------------------ SLA
def test_prazo_usa_horas_configuradas_e_soma_pausas():
    assert rg.calcular_prazo(AGORA, 4) == AGORA + timedelta(hours=4)
    assert rg.calcular_prazo(AGORA, 4, 1800) == AGORA + timedelta(hours=4, minutes=30)


def test_fim_da_pausa_empurra_o_prazo_pelo_tempo_parado():
    prazo = AGORA + timedelta(hours=4)
    inicio = AGORA + timedelta(hours=1)
    novo, seg = rg.encerrar_pausa(prazo, inicio, inicio + timedelta(minutes=90))
    assert seg == 5400 and novo == prazo + timedelta(minutes=90)


def test_sla_em_aguardando_esta_pausado_e_nunca_vence():
    prazo = AGORA + timedelta(hours=1)
    estado = rg.estado_sla(status=rg.AGUARDANDO, prazo_sla=prazo, pausa_inicio=AGORA, agora=AGORA + timedelta(days=5))
    assert estado["pausado"] and not estado["vencido"] and not estado["contando"]


def test_sla_vence_quando_ativo_e_passou_do_prazo():
    prazo = AGORA - timedelta(minutes=1)
    assert rg.estado_sla(status=rg.EM_ANDAMENTO, prazo_sla=prazo, pausa_inicio=None, agora=AGORA)["vencido"]
    assert rg.estado_sla(status=rg.ABERTO, prazo_sla=prazo, pausa_inicio=None, agora=AGORA)["vencido"]


@pytest.mark.parametrize("status_", [rg.RESOLVIDO, rg.ENCERRADO, rg.CANCELADO])
def test_sla_nao_conta_depois_de_resolvido(status_):
    estado = rg.estado_sla(status=status_, prazo_sla=AGORA - timedelta(days=9), pausa_inicio=None, agora=AGORA)
    assert not estado["vencido"] and not estado["contando"]


# ------------------------------------------------------------------ permissões iniciais (rbac)
CHAVES = ("chamados.abrir", "chamados.ver_operacao", "chamados.atender", "chamados.atribuir", "chamados.dashboard", "chamados.configurar")


def test_as_seis_permissoes_existem_e_pertencem_a_tecnologia():
    for chave in CHAVES:
        assert chave in rbac.PERMISSION_DEFINITIONS
        assert modulo_dono_padrao(chave, rbac.PERMISSION_DEFINITIONS[chave].module) == MODULO_TECNOLOGIA


def test_so_abrir_e_atender_abrem_o_modulo():
    assert {c for c in CHAVES if abre_modulo_padrao(c)} == {"chamados.abrir", "chamados.atender"}


def test_supervisor_abre_e_ve_a_operacao_mas_nao_ve_dashboard_nem_configura():
    perms = rbac.get_role_permissions(rbac.ROLE_SUPERVISOR)
    assert {"chamados.abrir", "chamados.ver_operacao"} <= perms
    assert not perms & {"chamados.atender", "chamados.atribuir", "chamados.dashboard", "chamados.configurar"}


@pytest.mark.parametrize("perfil", [rbac.ROLE_TEC_JUNIOR, rbac.ROLE_TEC_PLENO, rbac.ROLE_TEC_SENIOR, rbac.ROLE_ANALISTA_TI])
def test_ti_atende_atribui_e_ve_dashboard(perfil):
    perms = rbac.get_role_permissions(perfil)
    assert {"chamados.atender", "chamados.atribuir", "chamados.dashboard"} <= perms
    assert "chamados.configurar" not in perms


def test_administrador_tem_todas():
    assert set(CHAVES) <= rbac.get_role_permissions(rbac.ROLE_ADMIN)


@pytest.mark.parametrize("perfil", [rbac.ROLE_OPERATOR, rbac.ROLE_QUALIDADE, rbac.ROLE_CONTROL_DESK, rbac.ROLE_RH, rbac.ROLE_EMPLOYEE])
def test_demais_perfis_nao_tem_nenhuma(perfil):
    assert not rbac.get_role_permissions(perfil) & set(CHAVES)


def test_permissoes_de_chamados_nao_alteram_a_migration_v057_das_ti():
    assert not any(c.startswith("chamados.") for c in rbac.PERMISSOES_ADMINISTRACAO_TI)


# ------------------------------------------------------------------ armazenamento
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def _docx() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", "<w/>")
    return buf.getvalue()


def test_valida_pelo_conteudo_e_gera_hash():
    a = st.validar_anexo("print.PNG", PNG, max_bytes=1024)
    assert a.mime == "image/png" and len(a.sha256) == 64 and a.tamanho == len(PNG)


def test_rejeita_extensao_nao_permitida():
    with pytest.raises(HTTPException) as e:
        st.validar_anexo("virus.exe", b"MZ" + b"0" * 10, max_bytes=1024)
    assert e.value.status_code == 400


def test_rejeita_conteudo_que_nao_bate_com_a_extensao():
    with pytest.raises(HTTPException):
        st.validar_anexo("foto.png", b"%PDF-1.4 falso", max_bytes=1024)
    with pytest.raises(HTTPException):
        st.validar_anexo("planilha.xlsx", _docx(), max_bytes=1_000_000)  # zip de Word com extensão de Excel


def test_aceita_docx_valido_e_txt():
    assert st.validar_anexo("a.docx", _docx(), max_bytes=1_000_000).mime.endswith("wordprocessingml.document")
    assert st.validar_anexo("a.txt", "olá".encode(), max_bytes=100).mime == "text/plain"


def test_rejeita_vazio_e_acima_do_limite():
    with pytest.raises(HTTPException):
        st.validar_anexo("a.txt", b"", max_bytes=100)
    with pytest.raises(HTTPException):
        st.validar_anexo("a.png", PNG, max_bytes=10)


def test_nome_original_nunca_carrega_caminho():
    assert st.validar_anexo("..\\..\\x\\print.png", PNG, max_bytes=1024).nome_original == "print.png"


def test_provider_local_grava_le_apaga_e_bloqueia_fuga_de_pasta(tmp_path):
    p = st.LocalStorageProvider(tmp_path / "chamados")
    chave = st.nova_chave(".png", AGORA)
    assert chave.startswith("2026/10/") and chave.endswith(".png")
    p.put(chave, PNG)
    assert p.exists(chave)
    with p.open(chave) as f:
        assert f.read() == PNG
    p.delete(chave)
    assert not p.exists(chave)
    with pytest.raises(HTTPException):
        p.put("../fora.png", PNG)


# ------------------------------------------------------------------ migration
def test_migration_v059_e_gerada_do_mesmo_ddl_do_bootstrap():
    arquivo = REPO_ROOT / "infra" / "sql" / "migrations" / "V059__chamados.sql"
    assert arquivo.read_text(encoding="utf-8") == render_migration_sql()


def test_migration_e_aditiva_e_ascii():
    sql = render_migration_sql()
    assert all(ord(c) < 128 for c in sql)  # imune à página de código do sqlcmd
    for proibido in ("DROP ", "DELETE FROM", "TRUNCATE"):
        assert proibido not in sql.upper()
    assert "\n".join(schema_statements()).count("CREATE TABLE") == 7


def test_rollback_recusa_quando_ha_chamados():
    rb = render_rollback_sql()
    assert "THROW 50000" in rb and rb.index("THROW") < rb.index("DROP TABLE")
