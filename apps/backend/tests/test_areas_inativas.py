from __future__ import annotations

import pytest

from rh_api import areas
from rh_api.services import acesso


@pytest.fixture(autouse=True)
def estado_padrao():
    """Isola do banco: módulos todos ativos e funções no padrão (o DEV pode ter módulos desligados pela tela Módulos)."""
    acesso.definir_carregador(lambda: acesso.EstadoModulos())
    yield
    acesso.definir_carregador(None)


@pytest.fixture
def ambiente(monkeypatch):
    def definir(valor):
        if valor is None:
            monkeypatch.delenv(areas.VARIAVEL, raising=False)
        else:
            monkeypatch.setenv(areas.VARIAVEL, valor)

    return definir


def test_padrao_desliga_todas_as_areas_sem_uso(ambiente):
    ambiente(None)
    assert areas.areas_inativas() == {areas.SUPORTE_TI, areas.TREINAMENTOS, areas.PROCESSOS, areas.PROVAS, areas.CURRICULOS}
    assert not areas.area_ativa(areas.SUPORTE_TI)
    # sem Treinamentos nem Processos o onboarding também fica fora; com um dos dois ativo, volta
    assert not areas.onboarding_ativo()
    ambiente("suporte_ti,processos,provas,curriculos")
    assert areas.onboarding_ativo()


def test_vazio_reativa_tudo_e_valor_invalido_e_ignorado(ambiente):
    ambiente("")
    assert areas.areas_inativas() == frozenset()
    ambiente("treinamentos, qualquer_coisa")
    assert areas.areas_inativas() == {areas.TREINAMENTOS}


def test_suporte_ti_inativo_remove_permissoes_chamados_e_informa_o_frontend(ambiente):
    permissoes = {"chamados.abrir", "chamados.atender", "onboarding.visualizar"}
    ambiente("")
    assert "chamados.abrir" in acesso.filtrar_permissoes(permissoes)
    ambiente(areas.SUPORTE_TI)
    assert acesso.filtrar_permissoes(permissoes) == {"onboarding.visualizar"}
    payload = acesso.descrever(permissoes)
    assert payload["areas_inativas"] == [areas.SUPORTE_TI]
    assert not any(p.startswith("chamados.") for p in payload["permissoes"])


def test_permissoes_exclusivas_das_areas_de_rh_deixam_de_valer(ambiente):
    permissoes = {"vagas.visualizar", "processos.editar", "entrevistas.criar", "candidatos.visualizar", "provas.enviar",
                  "fit_cultural.editar", "sessao.curriculos.acessar", "sessao.processos.acessar", "sessao.provas.acessar",
                  # o que continua valendo: Monitoria, WFM, Tecnologia, Mural, Calendário, Drive, Configurações, e-mail (Microsoft)
                  "monitoria.visualizar", "wfm.escala.criar", "usuarios.editar", "configuracoes.editar", "mural.visualizar",
                  "calendario.visualizar", "onedrive.visualizar", "emails.enviar_modelo", "lgpd.visualizar", "documentos.visualizar"}
    ambiente("")
    assert acesso.filtrar_permissoes(permissoes) == permissoes
    ambiente(",".join((areas.PROCESSOS, areas.PROVAS, areas.CURRICULOS)))
    mantidas = acesso.filtrar_permissoes(permissoes)
    assert mantidas == {"monitoria.visualizar", "wfm.escala.criar", "usuarios.editar", "configuracoes.editar", "mural.visualizar",
                        "calendario.visualizar", "onedrive.visualizar", "emails.enviar_modelo", "lgpd.visualizar", "documentos.visualizar"}


def test_candidatos_so_deixa_de_valer_com_processos_e_curriculos_inativos(ambiente):
    ambiente(areas.PROCESSOS)
    assert "candidatos.visualizar" in acesso.filtrar_permissoes({"candidatos.visualizar", "vagas.visualizar"})  # banco de talentos segue
    ambiente(f"{areas.PROCESSOS},{areas.CURRICULOS}")
    assert acesso.filtrar_permissoes({"candidatos.visualizar", "vagas.visualizar"}) == frozenset()


def test_funcao_de_area_inativa_nao_pode_ser_ligada_e_aparece_indisponivel(ambiente):
    from fastapi import HTTPException

    from rh_api.services import modulos_admin

    ambiente(None)
    assert not areas.funcao_disponivel("suporte") and not areas.funcao_disponivel("processos") and not areas.funcao_disponivel("cx-curriculos")
    assert areas.funcao_disponivel("monitoria") and areas.funcao_disponivel("wfm") and areas.funcao_disponivel("gestao")
    with pytest.raises(HTTPException) as erro:
        modulos_admin.definir_funcao("tecnologia", "suporte", True, autor="x")
    assert erro.value.status_code == 409
    por_modulo = {m["modulo"]: {f["chave"]: f for f in m["funcoes"]} for m in modulos_admin.listar_funcoes()}
    assert por_modulo["tecnologia"]["suporte"]["indisponivel"] is True and por_modulo["tecnologia"]["suporte"]["ativo"] is False
    assert por_modulo["operacao"]["wfm"]["indisponivel"] is False
    ambiente("")
    assert areas.funcao_disponivel("suporte")


def _caminhos(monkeypatch, valor):
    from rh_api import main

    if valor is None:
        monkeypatch.delenv(areas.VARIAVEL, raising=False)
    else:
        monkeypatch.setenv(areas.VARIAVEL, valor)
    return {r.path for r in main.create_app().routes if hasattr(r, "path")}


MANTIDAS = ("/monitoria", "/wfm", "/tecnologia", "/onedrive", "/emails", "/settings", "/mural", "/auth", "/core", "/notificacoes",
            "/policies", "/operacoes", "/document-templates", "/documentos-biblioteca", "/celebratory-dates")
DESLIGADAS = ("/processes", "/process-candidates", "/candidate-pipeline", "/interviews", "/candidate-analytics", "/history",
              "/conecta-provas-api", "/disc", "/fit-cultural", "/raciocinio-logico", "/email-inbox", "/chamados", "/onboarding")


def test_rotas_das_areas_inativas_nao_existem_e_as_demais_continuam(monkeypatch):
    desligado = _caminhos(monkeypatch, None)
    for prefixo in MANTIDAS:
        assert any(c.startswith(prefixo) for c in desligado), f"{prefixo} deveria continuar montada"
    for prefixo in DESLIGADAS:
        assert not any(c.startswith(prefixo) for c in desligado), f"{prefixo} deveria estar fora do ar"
    ligado = _caminhos(monkeypatch, "")
    for prefixo in MANTIDAS + DESLIGADAS:
        assert any(c.startswith(prefixo) for c in ligado), f"{prefixo} deveria existir com tudo ativo"
    assert len(desligado) < len(ligado) * 0.7  # compactação real: bem menos rotas montadas
