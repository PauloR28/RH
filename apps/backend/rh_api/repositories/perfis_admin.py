"""Perfis no banco (reestruturação, Etapa 9 — amostra aprovada em 21/nov/2026).

A janela Perfis (tela Acessos) cria, renomeia e apaga perfis. Um perfil novo:
  * diz com que perfil do código ele FUNCIONA (``funciona_como``): é o que valem as regras sobre a pessoa;
  * começa com uma CÓPIA de outro perfil: permissões, alcance, Início dos módulos, módulos, exceções e painéis.
Depois, cada perfil segue sozinho (as permissões continuam sendo marcadas só na tela Acessos).

Apagar: só perfil com 0 pessoas e que não seja fixo (Administrador, Candidato). Perfil criado é apagado de verdade, com o
que é dele. Perfil do código fica com ``ativo = 0`` (o bootstrap não o recria) e some das listas.
"""

from __future__ import annotations

import re

from fastapi import HTTPException, status

from ..rbac import (
    PERFIS_FIXOS,
    PERMISSION_DEFINITIONS,
    ROLE_ADMIN,
    ROLE_DEFINITIONS,
    get_role_definition,
    invalidar_perfis,
    normalize_role_id,
    papel,
    perfil_existe,
    perfis_ativos,
)
from ..services.helpers import normalize_text
from .perfis_schema import ensure_perfis_schema

# Tabelas com o que é de cada perfil: copiadas na criação e apagadas junto com um perfil criado.
# (tabela, colunas copiadas além de id_perfil, filtro extra)
_TABELAS_DO_PERFIL = (
    ("perfil_permissoes", "chave_permissao, permitido", ""),
    ("perfis_alcance", "area, nivel", ""),
    ("perfis_tela_inicial", "config_json", ""),
    ("modulos_acesso_perfil", "modulo", ""),
    ("acesso_excecoes", "alvo_tipo, id_usuario, unidade, chave_permissao, efeito, motivo", "AND alvo_tipo = N'perfil'"),
    ("painel_perfil", "id_painel", ""),
)
_ID_VALIDO = re.compile(r"^[a-z0-9_]{2,40}$")


def _ator_perfil(actor) -> str:
    return normalize_role_id(actor.get("perfil") if isinstance(actor, dict) else getattr(actor, "perfil", ""))


def _so_admin_mexe_no_admin(actor, *perfis: str) -> None:
    if actor is None or _ator_perfil(actor) == ROLE_ADMIN:
        return
    if any(papel(p) == ROLE_ADMIN for p in perfis if p):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Somente o Administrador pode criar ou mudar perfis que funcionam como Administrador.")


def _novo_id(nome: str, existentes: set[str]) -> str:
    base = re.sub(r"[^a-z0-9_]", "", normalize_role_id(nome))[:36] or "perfil"
    # Um id que o código já entende de outro jeito (apelidos como "admin", "analista") não serve.
    candidato, n = base, 2
    while candidato in existentes or candidato in ROLE_DEFINITIONS or normalize_role_id(candidato) != candidato:
        candidato, n = f"{base}_{n}", n + 1
    return candidato


class PerfisAdminRepositoryMixin:
    def _tabela_existe(self, cursor, tabela: str) -> bool:
        cursor.execute("SELECT OBJECT_ID(?)", (f"dbo.{tabela}",))
        return cursor.fetchone()[0] is not None

    def create_role(self, data: dict, *, actor=None) -> dict:
        nome = normalize_text(data.get("nome"))[:80]
        descricao = normalize_text(data.get("descricao"))[:500]
        funciona_como = normalize_role_id(data.get("funciona_como"))
        copiar_de = normalize_role_id(data.get("copiar_de") or funciona_como)
        if len(nome) < 2:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dê um nome ao perfil.")
        if funciona_como not in ROLE_DEFINITIONS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Escolha com que perfil ele funciona.")
        if not perfil_existe(copiar_de):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Escolha de qual perfil copiar as permissões.")
        _so_admin_mexe_no_admin(actor, funciona_como, copiar_de)
        if any(normalize_text(r.name).lower() == nome.lower() for r in perfis_ativos()):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Já existe um perfil com esse nome.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_perfis_schema(cursor)
            cursor.execute("SELECT id_perfil FROM dbo.perfis")
            novo = _novo_id(nome, {normalize_role_id(r[0]) for r in cursor.fetchall()})
            if not _ID_VALIDO.match(novo):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nome inválido para perfil.")
            cursor.execute(
                "INSERT INTO dbo.perfis (id_perfil, nome, nivel, descricao, ativo, sistema, funciona_como, criado_em, atualizado_em) "
                "VALUES (?, ?, ?, ?, 1, 0, ?, GETDATE(), GETDATE())",
                (novo, nome, get_role_definition(funciona_como).level, descricao or None, funciona_como),
            )
            # Permissões: as que valem hoje para o perfil de origem (banco ou, sem linhas, o padrão do código).
            permitidas = set(self._get_role_permissions_from_db(cursor, copiar_de))
            for chave in PERMISSION_DEFINITIONS:
                cursor.execute(
                    "INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido) VALUES (?, ?, ?)",
                    (novo, chave, 1 if chave in permitidas else 0),
                )
            for tabela, colunas, filtro in _TABELAS_DO_PERFIL[1:]:
                if self._tabela_existe(cursor, tabela):
                    cursor.execute(
                        f"INSERT INTO dbo.{tabela} (id_perfil, {colunas}) SELECT ?, {colunas} FROM dbo.{tabela} WHERE id_perfil = ? {filtro}",  # noqa: S608 - nomes fixos
                        (novo, copiar_de),
                    )
            conn.commit()
        finally:
            conn.close()
        self._perfis_mudaram()
        return {"id": novo, "nome": nome, "funciona_como": funciona_como}

    def update_role(self, role_id: str, data: dict, *, actor=None) -> dict:
        chave = normalize_role_id(role_id)
        if not perfil_existe(chave):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Perfil não encontrado.")
        if chave in PERFIS_FIXOS:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Este perfil é fixo.")
        _so_admin_mexe_no_admin(actor, chave)
        nome = normalize_text(data.get("nome"))[:80]
        descricao = normalize_text(data.get("descricao"))[:500]
        if len(nome) < 2:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dê um nome ao perfil.")
        if any(r.id != chave and normalize_text(r.name).lower() == nome.lower() for r in perfis_ativos()):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Já existe um perfil com esse nome.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("UPDATE dbo.perfis SET nome = ?, descricao = ?, atualizado_em = GETDATE() WHERE id_perfil = ?", (nome, descricao or None, chave))
            conn.commit()
        finally:
            conn.close()
        self._perfis_mudaram()
        return {"id": chave, "nome": nome, "descricao": descricao}

    def delete_role(self, role_id: str, *, actor=None) -> dict:
        chave = normalize_role_id(role_id)
        if not perfil_existe(chave):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Perfil não encontrado.")
        if chave in PERFIS_FIXOS:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Este perfil é fixo e não pode ser apagado.")
        _so_admin_mexe_no_admin(actor, chave)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM dbo.usuarios WHERE LOWER(perfil_id) = ?", (chave,))
            if int(cursor.fetchone()[0]):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Este perfil tem pessoas. Mude as pessoas de perfil antes de apagar.")
            if chave in ROLE_DEFINITIONS:
                cursor.execute("UPDATE dbo.perfis SET ativo = 0, atualizado_em = GETDATE() WHERE id_perfil = ?", (chave,))
            else:
                for tabela, _colunas, _filtro in _TABELAS_DO_PERFIL:
                    if self._tabela_existe(cursor, tabela):
                        cursor.execute(f"DELETE FROM dbo.{tabela} WHERE id_perfil = ?", (chave,))  # noqa: S608 - nomes fixos
                cursor.execute("DELETE FROM dbo.perfis WHERE id_perfil = ? AND sistema = 0", (chave,))
            conn.commit()
        finally:
            conn.close()
        self._perfis_mudaram()
        return {"id": chave, "apagado": True}

    @staticmethod
    def _perfis_mudaram() -> None:
        from .. import alcance
        from ..services import acesso_cache

        invalidar_perfis()
        alcance.invalidar()
        acesso_cache.invalidar()
