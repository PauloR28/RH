"""Escrita do registro de módulos e do dono das permissões (Tecnologia). Sempre auditada; sempre invalida o cache de acesso."""

from __future__ import annotations

from fastapi import HTTPException, status

from ..config import get_settings
from ..db import get_connection
from ..modulos_catalogo import MODULO_CORE, MODULO_TECNOLOGIA, MODULOS_PADRAO, MODULOS_PROTEGIDOS, MODULOS_VALIDOS
from . import acesso


def _erro(codigo: int, detalhe: str) -> HTTPException:
    return HTTPException(status_code=codigo, detail=detalhe)


def listar_modulos() -> list[dict]:
    est = acesso.estado()
    return [
        {
            "chave": chave,
            "nome": est.nomes.get(chave, nome),
            "ordem": est.ordem.get(chave, ordem),
            "ativo": acesso.modulo_ativo(chave),
            "protegido": chave in MODULOS_PROTEGIDOS,
        }
        for chave, nome, ordem, _p in MODULOS_PADRAO
    ]


def definir_ativo(chave: str, ativo: bool, *, autor: str) -> dict:
    """Liga/desliga um módulo. `core` e `tecnologia` são protegidos (decisão 6): nunca desligam."""
    if chave not in MODULOS_VALIDOS:
        raise _erro(status.HTTP_404_NOT_FOUND, "Módulo não encontrado.")
    if chave in MODULOS_PROTEGIDOS and not ativo:
        raise _erro(status.HTTP_409_CONFLICT, "Este módulo é protegido e não pode ser desativado.")
    anterior = acesso.modulo_ativo(chave)
    conn = get_connection(get_settings(), autocommit=True)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE dbo.modulos_sistema SET ativo = ?, atualizado_em = GETDATE(), atualizado_por = ? WHERE chave = ?",
            (1 if ativo else 0, autor[:180], chave),
        )
        if cursor.rowcount == 0:
            raise _erro(status.HTTP_409_CONFLICT, "Registro de módulos indisponível: aplique a migration V055.")
    finally:
        conn.close()
    acesso.invalidar_cache()
    return {"chave": chave, "ativo_anterior": anterior, "ativo": ativo}


def resumo_inicio() -> dict:
    """Números da tela inicial da Tecnologia em UMA chamada leve (contagens no banco, sem trazer listas)."""
    conn = get_connection(get_settings(), autocommit=True)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT SUM(CASE WHEN status = 'Ativo' THEN 1 ELSE 0 END), SUM(CASE WHEN status = 'Bloqueado' THEN 1 ELSE 0 END) FROM dbo.usuarios")
        ativos, bloqueados = cursor.fetchone()
        try:
            cursor.execute("SELECT COUNT(*) FROM dbo.chamados WHERE status IN ('aberto','em_andamento','aguardando_solicitante')")
            chamados = int(cursor.fetchone()[0])
        except Exception:  # noqa: BLE001 - módulo de chamados ainda não migrado
            chamados = None
    finally:
        conn.close()
    configuraveis = [m for m in listar_modulos() if not m["protegido"]]
    return {
        "modulos_ativos": sum(1 for m in configuraveis if m["ativo"]),
        "modulos_total": len(configuraveis),
        "usuarios_ativos": int(ativos or 0),
        "usuarios_bloqueados": int(bloqueados or 0),
        "chamados_abertos": chamados,
    }


def _modulos_validos(modulos: list[str]) -> list[str]:
    limpos = sorted({str(m).strip() for m in modulos if str(m).strip()})
    invalidos = [m for m in limpos if m not in MODULOS_VALIDOS or m == MODULO_CORE]
    if invalidos:
        raise _erro(status.HTTP_400_BAD_REQUEST, f"Módulo inválido: {', '.join(invalidos)}.")
    return limpos


def listar_acessos() -> dict:
    """Para a tela Módulos > Acesso: cada perfil com o que as permissões dele já abrem (`derivados`, só leitura) e o que foi
    liberado à parte (`liberados`, editável), e os usuários com liberação individual."""
    conn = get_connection(get_settings(), autocommit=True)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id_perfil, nome FROM dbo.perfis WHERE ativo = 1 ORDER BY nome")
        perfis = [{"id": str(r[0]), "nome": str(r[1])} for r in cursor.fetchall()]
        cursor.execute("SELECT id_perfil, chave_permissao FROM dbo.perfil_permissoes WHERE permitido = 1")
        permissoes: dict[str, set[str]] = {}
        for perfil, chave in cursor.fetchall():
            permissoes.setdefault(str(perfil), set()).add(str(chave))
        cursor.execute("SELECT id_perfil, modulo FROM dbo.modulos_acesso_perfil")
        liberados: dict[str, list[str]] = {}
        for perfil, modulo in cursor.fetchall():
            liberados.setdefault(str(perfil), []).append(str(modulo))
        cursor.execute(
            "SELECT a.id_usuario, LTRIM(RTRIM(ISNULL(u.nome,'') + ' ' + ISNULL(u.sobrenome,''))), u.email, u.perfil_id, a.modulo "
            "FROM dbo.modulos_acesso_usuario a JOIN dbo.usuarios u ON u.id_usuario = a.id_usuario ORDER BY 2")
        usuarios: dict[int, dict] = {}
        for uid, nome, email, perfil, modulo in cursor.fetchall():
            item = usuarios.setdefault(int(uid), {"id": int(uid), "nome": str(nome), "email": str(email or ""), "perfil": str(perfil), "liberados": []})
            item["liberados"].append(str(modulo))
    finally:
        conn.close()
    for p in perfis:
        derivados = {m for chave in permissoes.get(p["id"], ()) if (m := acesso.modulo_aberto_por(chave)) and m != MODULO_CORE}
        p["derivados"] = sorted(derivados)
        p["liberados"] = sorted(liberados.get(p["id"], []))
    return {"modulos": [m for m in listar_modulos() if m["chave"] != MODULO_CORE], "perfis": perfis, "usuarios": list(usuarios.values())}


def definir_acesso_perfil(id_perfil: str, modulos: list[str], *, autor: str) -> dict:
    return _definir_acesso("perfil", id_perfil, modulos, autor)


def definir_acesso_usuario(id_usuario: int, modulos: list[str], *, autor: str) -> dict:
    return _definir_acesso("usuario", int(id_usuario), modulos, autor)


def _definir_acesso(tipo: str, chave, modulos: list[str], autor: str) -> dict:
    """Substitui a lista de módulos liberados do perfil/usuário (lista vazia = remove a liberação). Auditável: devolve antes/depois."""
    novos = _modulos_validos(modulos)
    tabela, coluna = ("modulos_acesso_perfil", "id_perfil") if tipo == "perfil" else ("modulos_acesso_usuario", "id_usuario")
    conn = get_connection(get_settings(), autocommit=False)
    try:
        cursor = conn.cursor()
        if tipo == "perfil":
            cursor.execute("SELECT 1 FROM dbo.perfis WHERE id_perfil = ?", (chave,))
        else:
            cursor.execute("SELECT 1 FROM dbo.usuarios WHERE id_usuario = ?", (chave,))
        if not cursor.fetchone():
            raise _erro(status.HTTP_404_NOT_FOUND, "Perfil não encontrado." if tipo == "perfil" else "Usuário não encontrado.")
        cursor.execute(f"SELECT modulo FROM dbo.{tabela} WHERE {coluna} = ?", (chave,))
        anteriores = sorted(str(r[0]) for r in cursor.fetchall())
        cursor.execute(f"DELETE FROM dbo.{tabela} WHERE {coluna} = ?", (chave,))
        for modulo in novos:
            cursor.execute(f"INSERT INTO dbo.{tabela} ({coluna}, modulo, criado_por) VALUES (?, ?, ?)", (chave, modulo, autor[:180]))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return {"alvo": chave, "tipo": tipo, "anteriores": anteriores, "modulos": novos}


def definir_modulo_da_permissao(chave: str, modulo: str, abre_modulo: bool | None, *, autor: str) -> dict:
    """Reatribui o módulo dono de uma permissão (a "configurabilidade" decidida pelo RH, ex.: Relatórios)."""
    from ..rbac import PERMISSION_DEFINITIONS

    if chave not in PERMISSION_DEFINITIONS:
        raise _erro(status.HTTP_404_NOT_FOUND, "Permissão não encontrada.")
    if modulo not in MODULOS_VALIDOS:
        raise _erro(status.HTTP_400_BAD_REQUEST, "Módulo inválido.")
    dono_anterior = acesso.modulo_da_permissao(chave)
    abre_anterior = acesso.modulo_aberto_por(chave)
    abre_novo = abre_anterior is not None if abre_modulo is None else abre_modulo
    # Não deixa a Tecnologia sem a(s) permissão(ões) que a abrem: seria trancar todos para fora (decisão 6).
    if abre_anterior == MODULO_TECNOLOGIA and (modulo != MODULO_TECNOLOGIA or not abre_novo):
        raise _erro(status.HTTP_409_CONFLICT, "Esta permissão abre o módulo Tecnologia e não pode ser movida nem deixar de abri-lo.")
    conn = get_connection(get_settings(), autocommit=True)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE dbo.permissoes SET modulo_dono = ?, abre_modulo = ? WHERE chave = ?",
            (modulo, 1 if abre_novo else 0, chave),
        )
        if cursor.rowcount == 0:
            raise _erro(status.HTTP_409_CONFLICT, "Permissão sem registro no banco ou migration V056 não aplicada.")
    finally:
        conn.close()
    acesso.invalidar_cache()
    return {"chave": chave, "modulo_anterior": dono_anterior, "modulo": modulo, "abre_modulo": abre_novo, "autor": autor}
