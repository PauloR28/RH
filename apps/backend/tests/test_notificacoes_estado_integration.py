"""QA T2-NOT-03: lida/oculta das notificações vale em qualquer navegador
(integração contra o banco de desenvolvimento; pulado sem banco)."""

from __future__ import annotations

import uuid

import pytest
from _integracao_dev import repositorio_dev


@pytest.fixture(scope="module")
def repo():
    r = repositorio_dev()
    yield r
    conn = r._connect()
    try:
        conn.cursor().execute("DELETE FROM dbo.notificacoes_estado_usuario WHERE usuario LIKE 'notif_teste_%'")
        conn.commit()
    finally:
        conn.close()


def test_estado_persistido_por_usuario_e_idempotente(repo):
    usuario = f"notif_teste_{uuid.uuid4().hex[:8]}"
    outro = f"notif_teste_{uuid.uuid4().hex[:8]}"
    assert repo.obter_estado_notificacoes_usuario(usuario=usuario) == {"lidas": [], "ocultas": []}

    repo.registrar_estado_notificacoes_usuario(usuario=usuario, lidas=["entrevista-1", "processo-2"], ocultas=[])
    # Repetir não duplica nem falha; ocultar uma já lida mantém as duas marcas.
    repo.registrar_estado_notificacoes_usuario(usuario=usuario, lidas=["entrevista-1"], ocultas=["processo-2"])

    estado = repo.obter_estado_notificacoes_usuario(usuario=usuario)
    assert sorted(estado["lidas"]) == ["entrevista-1", "processo-2"]
    assert estado["ocultas"] == ["processo-2"]
    # Outro usuário não herda o estado.
    assert repo.obter_estado_notificacoes_usuario(usuario=outro) == {"lidas": [], "ocultas": []}


def test_marcar_lida_so_do_destinatario(repo):
    conn = repo._connect()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO dbo.notificacoes (destinatario_usuario, titulo, categoria) OUTPUT INSERTED.id_notificacao VALUES ('notif_teste_dono', 't', 'treinamentos')"
        )
        id_notificacao = int(cursor.fetchone()[0])
        conn.commit()
    finally:
        conn.close()
    try:
        repo.marcar_notificacao_lida(id_notificacao, papel="gestor", usuario="notif_teste_intruso")
        assert repo.list_notificacoes(papel="x", usuario="notif_teste_dono", apenas_nao_lidas=True)
        repo.marcar_notificacao_lida(id_notificacao, papel="x", usuario="notif_teste_dono")
        assert not repo.list_notificacoes(papel="x", usuario="notif_teste_dono", apenas_nao_lidas=True)
    finally:
        conn = repo._connect()
        try:
            conn.cursor().execute("DELETE FROM dbo.notificacoes WHERE id_notificacao = ?", (id_notificacao,))
            conn.commit()
        finally:
            conn.close()
