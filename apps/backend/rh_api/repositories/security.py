from __future__ import annotations

import csv
import io
import json
import re
from datetime import datetime

import pyodbc
from fastapi import HTTPException, status

from ..auth import AuthenticatedUser
from ..passwords import hash_password, verify_password
from .bootstrap import ensure_email_change_requests_table, ensure_notifications_table
from conecta.infrastructure.security.encryption import (
    SecretEncryptionError,
    decrypt_secret,
    encrypt_secret,
)
from conecta.infrastructure.security.totp import (
    generate_secret,
    provisioning_uri,
    verify_code,
)
from ..rbac import (
    PERMISSION_DEFINITIONS,
    ROLE_ADMIN,
    ROLE_DEFINITIONS,
    ROLE_EMPLOYEE,
    ROLE_INTERN,
    SETTINGS_CATALOGS,
    get_role_definition,
    get_role_permissions,
    normalize_role_id,
    sanitize_permissions,
)
from ..services.helpers import normalize_compare_text, normalize_text, rows_to_dicts, safe_json_loads


AUTH_PROVIDER_LOCAL = "local"
AUTH_PROVIDER_MICROSOFT = "microsoft"
_VALID_AUTH_PROVIDERS = {AUTH_PROVIDER_LOCAL, AUTH_PROVIDER_MICROSOFT}
_EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_AVATAR_ILUSTRADO_PATTERN = re.compile(r"^avatar-(0[1-9]|[12]\d|3\d|40)$")


def _normalize_email(value) -> str:
    return normalize_text(value).lower()


def _normalize_auth_provider(value, *, default: str = AUTH_PROVIDER_LOCAL) -> str:
    provider = normalize_text(value).lower() or default
    if provider not in _VALID_AUTH_PROVIDERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tipo de acesso inválido.",
        )
    return provider


def _mask_email(value) -> str:
    email = _normalize_email(value)
    if "@" not in email:
        return "conta-nao-identificada"
    local, domain = email.split("@", 1)
    visible = local[:1] if local else "*"
    return f"{visible}***@{domain}"


def _mask_phone(value) -> str:
    digits = re.sub(r"\D", "", normalize_text(value))
    if len(digits) < 4:
        return "telefone-nao-identificado"
    return f"{'*' * (len(digits) - 4)}{digits[-4:]}"


def _json_dump(value) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except TypeError:
        return str(value)


def _actor_payload(user: AuthenticatedUser | dict | None) -> dict:
    if isinstance(user, AuthenticatedUser):
        return {
            "id_usuario": user.id_usuario,
            "nome": user.nome or user.username,
            "email": user.email or user.username,
            "perfil_id": user.perfil,
            "perfil_nome": user.perfil_nome,
        }
    if isinstance(user, dict):
        role = get_role_definition(user.get("perfil") or user.get("perfil_id"))
        return {
            "id_usuario": user.get("id_usuario"),
            "nome": normalize_text(user.get("nome") or user.get("login") or user.get("email")),
            "email": normalize_text(user.get("email") or user.get("login")),
            "perfil_id": role.id,
            "perfil_nome": normalize_text(user.get("perfil_nome")) or role.name,
        }
    return {
        "id_usuario": None,
        "nome": "",
        "email": "",
        "perfil_id": "",
        "perfil_nome": "",
    }


def _display_audit_module(value: str) -> str:
    safe_value = normalize_text(value)
    if normalize_text(safe_value).lower().replace("ç", "c").replace("ã", "a") == "autenticacao":
        return "Autenticação"
    return safe_value


class SecurityRepositoryMixin:
    def _insert_audit_log(
        self,
        cursor,
        *,
        user: AuthenticatedUser | dict | None = None,
        modulo: str = "",
        acao: str = "",
        entidade: str = "",
        entidade_id: str = "",
        valor_anterior=None,
        valor_novo=None,
        justificativa: str = "",
        origem: str = "",
        sucesso: bool = True,
    ) -> None:
        actor = _actor_payload(user)
        cursor.execute(
            """
            INSERT INTO logs_auditoria
            (
                id_usuario,
                nome_usuario,
                email_usuario,
                perfil_id,
                perfil_nome,
                data_hora,
                modulo,
                acao,
                entidade,
                entidade_id,
                valor_anterior,
                valor_novo,
                justificativa,
                origem,
                sucesso,
                criado_em
            )
            VALUES (?, ?, ?, ?, ?, GETDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE())
            """,
            (
                actor.get("id_usuario"),
                actor.get("nome"),
                actor.get("email"),
                actor.get("perfil_id"),
                actor.get("perfil_nome"),
                _display_audit_module(modulo),
                normalize_text(acao),
                normalize_text(entidade),
                normalize_text(entidade_id),
                _json_dump(valor_anterior),
                _json_dump(valor_novo),
                normalize_text(justificativa),
                normalize_text(origem),
                1 if sucesso else 0,
            ),
        )

    def record_audit_log(
        self,
        *,
        user: AuthenticatedUser | dict | None = None,
        modulo: str = "",
        acao: str = "",
        entidade: str = "",
        entidade_id: str = "",
        valor_anterior=None,
        valor_novo=None,
        justificativa: str = "",
        origem: str = "",
        sucesso: bool = True,
    ) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            self._insert_audit_log(
                cursor,
                user=user,
                modulo=modulo,
                acao=acao,
                entidade=entidade,
                entidade_id=entidade_id,
                valor_anterior=valor_anterior,
                valor_novo=valor_novo,
                justificativa=justificativa,
                origem=origem,
                sucesso=sucesso,
            )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def _get_role_permissions_from_db(self, cursor, role_id: str) -> list[str]:
        safe_role = normalize_role_id(role_id)
        cursor.execute(
            """
            SELECT chave_permissao, permitido
            FROM perfil_permissoes
            WHERE id_perfil = ?
            """,
            (safe_role,),
        )
        rows = cursor.fetchall()
        if not rows:
            return sorted(get_role_permissions(safe_role))
        permissions = [
            normalize_text(row[0])
            for row in rows
            if normalize_text(row[0]) and bool(row[1])
        ]
        return permissions

    def _get_user_operacoes(self, cursor, id_usuario) -> list[str]:
        """Operações às quais o usuário tem acesso — lista vazia = sem
        restrição (comportamento atual, preservado por padrão). Ver achado
        SEC-002 do programa de evolução."""
        if not id_usuario:
            return []
        cursor.execute(
            "SELECT operacao FROM dbo.usuarios_operacoes WHERE id_usuario = ?",
            (id_usuario,),
        )
        return [normalize_text(row[0]) for row in cursor.fetchall() if normalize_text(row[0])]

    def _sync_user_operacoes(self, cursor, id_usuario: int, operacoes: list) -> None:
        """Substitui as operações vinculadas ao usuário (Correções.txt, rodada
        de 08/set/2026: administrador poder editar tudo relacionado ao
        usuário, incluindo as operações às quais ele tem acesso)."""
        valores = sorted({normalize_text(item) for item in (operacoes or []) if normalize_text(item)})
        cursor.execute("DELETE FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (id_usuario,))
        for operacao in valores:
            cursor.execute(
                "INSERT INTO dbo.usuarios_operacoes (id_usuario, operacao, criado_em) VALUES (?, ?, GETDATE())",
                (id_usuario, operacao),
            )

    def _serialize_system_user(
        self,
        row: dict,
        permissions: list[str] | None = None,
        operacoes: list[str] | None = None,
    ) -> dict:
        role = get_role_definition(row.get("perfil_id"))
        status_value = normalize_text(row.get("status")) or "Ativo"
        return {
            "id_usuario": row.get("id_usuario"),
            "login": normalize_text(row.get("login")),
            "nome": normalize_text(row.get("nome")),
            "sobrenome": normalize_text(row.get("sobrenome")),
            "cargo": normalize_text(row.get("cargo")),
            "email": normalize_text(row.get("email")),
            "perfil": role.id,
            "perfil_nome": normalize_text(row.get("perfil_nome")) or role.name,
            "nivel": normalize_text(row.get("nivel")) or role.level,
            "status": status_value,
            "provedor_autenticacao": _normalize_auth_provider(
                row.get("provedor_autenticacao"),
            ),
            "avatar_ilustrado": normalize_text(row.get("avatar_ilustrado")),
            "criado_em": row.get("criado_em"),
            "ultimo_acesso": row.get("ultimo_acesso_em"),
            "ultimo_login_microsoft": row.get("ultimo_login_microsoft"),
            "criado_por": normalize_text(row.get("criado_por")),
            "atualizado_por": normalize_text(row.get("atualizado_por")),
            "atualizado_em": row.get("atualizado_em"),
            "permissoes": permissions or [],
            "operacoes": operacoes or [],
            "deve_trocar_senha": bool(row.get("deve_trocar_senha")),
        }

    def authenticate_system_user(
        self,
        usuario: str,
        senha: str,
        *,
        origem: str = "",
        mfa_code: str = "",
    ) -> dict:
        safe_login = normalize_text(usuario)
        if not safe_login:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuário ou senha inválidos.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT TOP 1
                    usuarios.id_usuario,
                    usuarios.login,
                    usuarios.nome,
                    usuarios.sobrenome,
                    usuarios.cargo,
                    usuarios.email,
                    usuarios.perfil_id,
                    perfis.nome AS perfil_nome,
                    perfis.nivel,
                    usuarios.status,
                    usuarios.senha_hash,
                    usuarios.mfa_enabled,
                    usuarios.mfa_secret_encrypted,
                    usuarios.avatar_ilustrado,
                    usuarios.provedor_autenticacao,
                    ISNULL(usuarios.deve_trocar_senha, 0) AS deve_trocar_senha,
                    usuarios.criado_em,
                    usuarios.ultimo_acesso_em,
                    usuarios.criado_por,
                    usuarios.atualizado_por,
                    usuarios.atualizado_em
                FROM usuarios
                LEFT JOIN perfis ON perfis.id_perfil = usuarios.perfil_id
                WHERE LOWER(usuarios.login) = LOWER(?) OR LOWER(usuarios.email) = LOWER(?)
                ORDER BY usuarios.id_usuario
                """,
                (safe_login, safe_login),
            )
            row = cursor.fetchone()
            if not row:
                self._insert_audit_log(
                    cursor,
                    user={"email": safe_login, "nome": safe_login},
                    modulo="Autenticação",
                    acao="login_negado",
                    entidade="usuario",
                    entidade_id=safe_login,
                    justificativa="Usuário não encontrado.",
                    origem=origem,
                    sucesso=False,
                )
                conn.commit()
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuário ou senha inválidos.")

            user_row = rows_to_dicts(cursor, [row])[0]
            user_context = self._serialize_system_user(user_row)
            if normalize_text(user_row.get("status")).lower() != "ativo":
                self._insert_audit_log(
                    cursor,
                    user=user_context,
                    modulo="Autenticação",
                    acao="login_negado",
                    entidade="usuario",
                    entidade_id=str(user_row.get("id_usuario") or ""),
                    justificativa=f"Usuário com status {user_row.get('status') or 'indefinido'}.",
                    origem=origem,
                    sucesso=False,
                )
                conn.commit()
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuário inativo ou bloqueado.")

            if not verify_password(senha, user_row.get("senha_hash")):
                self._insert_audit_log(
                    cursor,
                    user=user_context,
                    modulo="Autenticação",
                    acao="login_negado",
                    entidade="usuario",
                    entidade_id=str(user_row.get("id_usuario") or ""),
                    justificativa="Senha inválida.",
                    origem=origem,
                    sucesso=False,
                )
                conn.commit()
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuário ou senha inválidos.")

            if bool(user_row.get("mfa_enabled")):
                try:
                    mfa_secret = decrypt_secret(
                        user_row.get("mfa_secret_encrypted") or "",
                        self.settings.mfa_encryption_key,
                    )
                except SecretEncryptionError as exc:
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="MFA indisponível por configuração do servidor.",
                    ) from exc
                if not verify_code(mfa_secret, mfa_code):
                    self._insert_audit_log(
                        cursor,
                        user=user_context,
                        modulo="Autenticação",
                        acao="mfa_falha",
                        entidade="usuario",
                        entidade_id=str(user_row.get("id_usuario") or ""),
                        justificativa="Código TOTP ausente ou inválido.",
                        origem=origem,
                        sucesso=False,
                    )
                    conn.commit()
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Código MFA inválido.",
                    )

            permissions = self._get_role_permissions_from_db(cursor, user_row.get("perfil_id"))
            cursor.execute(
                """
                UPDATE usuarios
                SET ultimo_acesso_em = GETDATE(), atualizado_em = GETDATE()
                WHERE id_usuario = ?
                """,
                (user_row.get("id_usuario"),),
            )
            operacoes = self._get_user_operacoes(cursor, user_row.get("id_usuario"))
            result = self._serialize_system_user(user_row, permissions, operacoes)
            self._insert_audit_log(
                cursor,
                user=result,
                modulo="Autenticação",
                acao="login",
                entidade="usuario",
                entidade_id=str(user_row.get("id_usuario") or ""),
                origem=origem,
                sucesso=True,
            )
            conn.commit()
            return result
        finally:
            conn.close()

    # Correções.txt (rodada 16/set/2026): "APLICATIVO CONECTA - APP" — o
    # aluno/colaborador do app-treinamento-colaborador entra só com o
    # e-mail, sem senha, "independente do que está configurado para aquele
    # usuário". Restrito aos perfis "operador"/"funcionario" (autoatendimento
    # + Central de Treinamentos, sem nenhuma tela administrativa — ver
    # ROLE_OPERATOR/ROLE_EMPLOYEE em rbac.py) para não virar um jeito de
    # entrar sem senha em contas RH/Admin. Reaproveita create_session_for_
    # user_record (mesmo mecanismo do login Microsoft, que também não usa
    # senha).
    APP_EMAIL_LOGIN_PERFIS = ("operador", "funcionario")

    def authenticate_app_email(self, email: str, *, origem: str = "") -> dict:
        safe_email = _normalize_email(email)
        if not safe_email:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Informe o e-mail cadastrado.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT TOP 1
                    usuarios.id_usuario,
                    usuarios.login,
                    usuarios.nome,
                    usuarios.sobrenome,
                    usuarios.cargo,
                    usuarios.email,
                    usuarios.perfil_id,
                    perfis.nome AS perfil_nome,
                    perfis.nivel,
                    usuarios.status,
                    usuarios.avatar_ilustrado,
                    usuarios.provedor_autenticacao,
                    usuarios.criado_em,
                    usuarios.ultimo_acesso_em,
                    usuarios.criado_por,
                    usuarios.atualizado_por,
                    usuarios.atualizado_em
                FROM usuarios
                LEFT JOIN perfis ON perfis.id_perfil = usuarios.perfil_id
                WHERE LOWER(LTRIM(RTRIM(usuarios.email))) = LOWER(?)
                ORDER BY usuarios.id_usuario
                """,
                (safe_email,),
            )
            row = cursor.fetchone()
            if not row:
                self._insert_audit_log(
                    cursor,
                    modulo="Autenticação",
                    acao="login_app_negado",
                    entidade="usuario",
                    entidade_id=_mask_email(safe_email),
                    justificativa="E-mail não cadastrado.",
                    origem=origem,
                    sucesso=False,
                )
                conn.commit()
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="E-mail não encontrado.")

            user_row = rows_to_dicts(cursor, [row])[0]
            user_context = self._serialize_system_user(user_row)
            perfil_id = normalize_text(user_row.get("perfil_id")).lower()

            if perfil_id not in self.APP_EMAIL_LOGIN_PERFIS:
                self._insert_audit_log(
                    cursor,
                    user=user_context,
                    modulo="Autenticação",
                    acao="login_app_negado",
                    entidade="usuario",
                    entidade_id=str(user_row.get("id_usuario") or ""),
                    justificativa=f"Perfil {perfil_id or 'indefinido'} não usa login só por e-mail.",
                    origem=origem,
                    sucesso=False,
                )
                conn.commit()
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Este e-mail não está liberado para o aplicativo. Fale com o RH.",
                )

            if normalize_text(user_row.get("status")).lower() != "ativo":
                self._insert_audit_log(
                    cursor,
                    user=user_context,
                    modulo="Autenticação",
                    acao="login_app_negado",
                    entidade="usuario",
                    entidade_id=str(user_row.get("id_usuario") or ""),
                    justificativa=f"Usuário com status {user_row.get('status') or 'indefinido'}.",
                    origem=origem,
                    sucesso=False,
                )
                conn.commit()
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuário inativo ou bloqueado.")

            permissions = self._get_role_permissions_from_db(cursor, user_row.get("perfil_id"))
            cursor.execute(
                """
                UPDATE usuarios
                SET ultimo_acesso_em = GETDATE(), atualizado_em = GETDATE()
                WHERE id_usuario = ?
                """,
                (user_row.get("id_usuario"),),
            )
            operacoes = self._get_user_operacoes(cursor, user_row.get("id_usuario"))
            result = self._serialize_system_user(user_row, permissions, operacoes)
            self._insert_audit_log(
                cursor,
                user=result,
                modulo="Autenticação",
                acao="login_app",
                entidade="usuario",
                entidade_id=str(user_row.get("id_usuario") or ""),
                origem=origem,
                sucesso=True,
            )
            conn.commit()
            return result
        finally:
            conn.close()

    def authenticate_microsoft_user(
        self,
        *,
        microsoft_oid: str,
        microsoft_tenant_id: str,
        email: str = "",
        nome: str = "",
        origem: str = "",
    ) -> dict:
        safe_oid = normalize_text(microsoft_oid)
        safe_tenant_id = normalize_text(microsoft_tenant_id)
        safe_email = _normalize_email(email)
        if not safe_oid or not safe_tenant_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Não foi possível identificar sua conta Microsoft.",
            )

        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT TOP 1
                    usuarios.id_usuario,
                    usuarios.login,
                    usuarios.nome,
                    usuarios.email,
                    usuarios.perfil_id,
                    perfis.nome AS perfil_nome,
                    perfis.nivel,
                    usuarios.status,
                    usuarios.microsoft_oid,
                    usuarios.microsoft_tenant_id,
                    usuarios.provedor_autenticacao,
                    usuarios.ultimo_login_microsoft,
                    usuarios.avatar_ilustrado,
                    usuarios.criado_em,
                    usuarios.ultimo_acesso_em,
                    usuarios.criado_por,
                    usuarios.atualizado_por,
                    usuarios.atualizado_em
                FROM usuarios
                LEFT JOIN perfis ON perfis.id_perfil = usuarios.perfil_id
                WHERE usuarios.microsoft_oid = ?
                  AND usuarios.microsoft_tenant_id = ?
                ORDER BY usuarios.id_usuario
                """,
                (safe_oid, safe_tenant_id),
            )
            row = cursor.fetchone()
            first_link = False

            if row:
                user_row = rows_to_dicts(cursor, [row])[0]
            else:
                if not safe_email:
                    self._insert_audit_log(
                        cursor,
                        modulo="Autenticação",
                        acao="login_microsoft_negado",
                        entidade="usuario",
                        entidade_id="conta-nao-identificada",
                        justificativa="E-mail corporativo ausente no retorno da Microsoft.",
                        origem=origem,
                        sucesso=False,
                    )
                    conn.commit()
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Sua conta Microsoft foi autenticada, mas não possui autorização de acesso ao Conecta.",
                    )

                cursor.execute(
                    """
                    SELECT TOP 1
                        usuarios.id_usuario,
                        usuarios.login,
                        usuarios.nome,
                        usuarios.email,
                        usuarios.perfil_id,
                        perfis.nome AS perfil_nome,
                        perfis.nivel,
                        usuarios.status,
                        usuarios.microsoft_oid,
                        usuarios.microsoft_tenant_id,
                        usuarios.provedor_autenticacao,
                        usuarios.ultimo_login_microsoft,
                        usuarios.avatar_ilustrado,
                        usuarios.criado_em,
                        usuarios.ultimo_acesso_em,
                        usuarios.criado_por,
                        usuarios.atualizado_por,
                        usuarios.atualizado_em
                    FROM usuarios
                    LEFT JOIN perfis ON perfis.id_perfil = usuarios.perfil_id
                    WHERE LOWER(LTRIM(RTRIM(usuarios.email))) = LOWER(?)
                    ORDER BY usuarios.id_usuario
                    """,
                    (safe_email,),
                )
                row = cursor.fetchone()
                if not row:
                    self._insert_audit_log(
                        cursor,
                        modulo="Autenticação",
                        acao="login_microsoft_negado",
                        entidade="usuario",
                        entidade_id=_mask_email(safe_email),
                        justificativa="Conta autenticada sem cadastro no Conecta.",
                        origem=origem,
                        sucesso=False,
                    )
                    conn.commit()
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Sua conta Microsoft foi autenticada, mas não possui autorização de acesso ao Conecta.",
                    )

                user_row = rows_to_dicts(cursor, [row])[0]
                linked_oid = normalize_text(user_row.get("microsoft_oid"))
                linked_tenant_id = normalize_text(user_row.get("microsoft_tenant_id"))
                if (linked_oid or linked_tenant_id) and (
                    linked_oid != safe_oid or linked_tenant_id.lower() != safe_tenant_id.lower()
                ):
                    user_context = self._serialize_system_user(user_row)
                    self._insert_audit_log(
                        cursor,
                        user=user_context,
                        modulo="Autenticação",
                        acao="conflito_vinculo_microsoft",
                        entidade="usuario",
                        entidade_id=str(user_row.get("id_usuario") or ""),
                        justificativa="Cadastro já vinculado a outra identidade Microsoft.",
                        origem=origem,
                        sucesso=False,
                    )
                    conn.commit()
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Não foi possível concluir o acesso. Contate o administrador do Conecta.",
                    )
                first_link = True

            user_context = self._serialize_system_user(user_row)
            if normalize_text(user_row.get("status")).lower() != "ativo":
                self._insert_audit_log(
                    cursor,
                    user=user_context,
                    modulo="Autenticação",
                    acao="login_microsoft_negado",
                    entidade="usuario",
                    entidade_id=str(user_row.get("id_usuario") or ""),
                    justificativa=f"Usuário com status {user_row.get('status') or 'indefinido'}.",
                    origem=origem,
                    sucesso=False,
                )
                conn.commit()
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Seu acesso ao Conecta está desativado.",
                )

            try:
                cursor.execute(
                    """
                    UPDATE usuarios
                    SET microsoft_oid = ?,
                        microsoft_tenant_id = ?,
                        provedor_autenticacao = ?,
                        ultimo_login_microsoft = GETDATE(),
                        ultimo_acesso_em = GETDATE(),
                        atualizado_em = GETDATE()
                    WHERE id_usuario = ?
                    """,
                    (
                        safe_oid,
                        safe_tenant_id,
                        AUTH_PROVIDER_MICROSOFT,
                        user_row.get("id_usuario"),
                    ),
                )
            except pyodbc.IntegrityError as exc:
                conn.rollback()
                self.logger.warning(
                    "Conflito de unicidade ao vincular login Microsoft ao usuario %s.",
                    user_row.get("id_usuario"),
                )
                try:
                    self.record_audit_log(
                        user=user_context,
                        modulo="Autenticação",
                        acao="conflito_vinculo_microsoft",
                        entidade="usuario",
                        entidade_id=str(user_row.get("id_usuario") or ""),
                        justificativa="Identidade Microsoft já vinculada a outro cadastro.",
                        origem=origem,
                        sucesso=False,
                    )
                except Exception as audit_exc:
                    self.logger.debug("Falha ao registrar log de auditoria de conflito Microsoft: %s", audit_exc)
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Não foi possível concluir o acesso. Contate o administrador do Conecta.",
                ) from exc

            permissions = self._get_role_permissions_from_db(cursor, user_row.get("perfil_id"))
            operacoes = self._get_user_operacoes(cursor, user_row.get("id_usuario"))
            result = self._serialize_system_user(
                {
                    **user_row,
                    "provedor_autenticacao": AUTH_PROVIDER_MICROSOFT,
                },
                permissions,
                operacoes,
            )
            if first_link:
                self._insert_audit_log(
                    cursor,
                    user=result,
                    modulo="Autenticação",
                    acao="vincular_conta_microsoft",
                    entidade="usuario",
                    entidade_id=str(user_row.get("id_usuario") or ""),
                    valor_novo={"provedor_autenticacao": AUTH_PROVIDER_MICROSOFT},
                    origem=origem,
                    sucesso=True,
                )
            self._insert_audit_log(
                cursor,
                user=result,
                modulo="Autenticação",
                acao="login_microsoft",
                entidade="usuario",
                entidade_id=str(user_row.get("id_usuario") or ""),
                origem=origem,
                sucesso=True,
            )
            conn.commit()
            return result
        except HTTPException:
            raise
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def get_system_user_for_session(self, id_usuario: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            user_row = self._get_system_user_by_id(cursor, id_usuario)
            if normalize_text(user_row.get("status")).lower() != "ativo":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Seu acesso ao Conecta está desativado.",
                )
            permissions = self._get_role_permissions_from_db(cursor, user_row.get("perfil_id"))
            operacoes = self._get_user_operacoes(cursor, user_row.get("id_usuario"))
            return self._serialize_system_user(user_row, permissions, operacoes)
        finally:
            conn.close()

    def update_own_avatar(self, id_usuario: int, avatar_ilustrado: str) -> dict:
        safe_avatar = normalize_text(avatar_ilustrado)
        if safe_avatar and not _AVATAR_ILUSTRADO_PATTERN.fullmatch(safe_avatar):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Avatar inválido.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE usuarios
                SET avatar_ilustrado = ?, atualizado_em = GETDATE()
                WHERE id_usuario = ?
                """,
                (safe_avatar or None, int(id_usuario)),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado.")
            conn.commit()
            return {"success": True, "avatar_ilustrado": safe_avatar}
        finally:
            conn.close()

    def update_own_name(self, id_usuario: int, nome: str) -> dict:
        safe_name = normalize_text(nome)
        if not safe_name:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Informe um nome válido.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE usuarios
                SET nome = ?, atualizado_em = GETDATE()
                WHERE id_usuario = ?
                """,
                (safe_name, int(id_usuario)),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado.")
            conn.commit()
            return {"success": True, "nome": safe_name}
        finally:
            conn.close()

    def update_own_password(self, id_usuario: int, senha_atual: str, nova_senha: str) -> dict:
        safe_current = normalize_text(senha_atual)
        safe_new = normalize_text(nova_senha)
        if not safe_new or len(safe_new) < 8:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A nova senha deve ter pelo menos 8 caracteres.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT senha_hash, provedor_autenticacao FROM usuarios WHERE id_usuario = ?",
                (int(id_usuario),),
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado.")
            senha_hash, provedor = row[0], row[1]
            if normalize_text(provedor) != AUTH_PROVIDER_LOCAL:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Este usuário autentica pela Microsoft; a senha é gerenciada por lá.",
                )
            if not verify_password(safe_current, senha_hash):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Senha atual incorreta.")

            cursor.execute(
                "UPDATE usuarios SET senha_hash = ?, atualizado_em = GETDATE() WHERE id_usuario = ?",
                (hash_password(safe_new), int(id_usuario)),
            )
            cursor.execute(
                "IF COL_LENGTH('dbo.usuarios', 'deve_trocar_senha') IS NOT NULL "
                "UPDATE dbo.usuarios SET deve_trocar_senha = 0 WHERE id_usuario = ?",
                (int(id_usuario),),
            )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def update_own_surname(self, id_usuario: int, sobrenome: str) -> dict:
        safe_surname = normalize_text(sobrenome)
        if len(safe_surname) > 180:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Sobrenome muito longo.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE usuarios
                SET sobrenome = ?, atualizado_em = GETDATE()
                WHERE id_usuario = ?
                """,
                (safe_surname or None, int(id_usuario)),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado.")
            conn.commit()
            return {"success": True, "sobrenome": safe_surname}
        finally:
            conn.close()

    def update_own_cargo(self, id_usuario: int, cargo: str) -> dict:
        safe_cargo = normalize_text(cargo)
        if len(safe_cargo) > 180:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Cargo muito longo.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE usuarios
                SET cargo = ?, atualizado_em = GETDATE()
                WHERE id_usuario = ?
                """,
                (safe_cargo or None, int(id_usuario)),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado.")
            conn.commit()
            return {"success": True, "cargo": safe_cargo}
        finally:
            conn.close()

    def activate_local_login(self, id_usuario: int, nova_senha: str) -> dict:
        safe_new = normalize_text(nova_senha)
        if len(safe_new) < 8:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A nova senha deve ter pelo menos 8 caracteres.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT email FROM usuarios WHERE id_usuario = ?", (int(id_usuario),))
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado.")
            if not normalize_text(row[0]):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Você não possui e-mail cadastrado. Peça ao administrador para cadastrar um e-mail antes de continuar.",
                )

            cursor.execute(
                """
                UPDATE usuarios
                SET senha_hash = ?, provedor_autenticacao = ?, atualizado_em = GETDATE()
                WHERE id_usuario = ?
                """,
                (hash_password(safe_new), AUTH_PROVIDER_LOCAL, int(id_usuario)),
            )
            conn.commit()
            return {"success": True, "provedor_autenticacao": AUTH_PROVIDER_LOCAL}
        finally:
            conn.close()

    def update_own_auth_provider(self, id_usuario: int, provedor: str) -> dict:
        safe_provider = _normalize_auth_provider(provedor)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            if safe_provider == AUTH_PROVIDER_LOCAL:
                cursor.execute("SELECT senha_hash FROM usuarios WHERE id_usuario = ?", (int(id_usuario),))
                row = cursor.fetchone()
                if not row:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado.")
                if not normalize_text(row[0]):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Crie uma senha de acesso local antes de desativar o login pela Microsoft.",
                    )

            cursor.execute(
                """
                UPDATE usuarios
                SET provedor_autenticacao = ?, atualizado_em = GETDATE()
                WHERE id_usuario = ?
                """,
                (safe_provider, int(id_usuario)),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado.")
            conn.commit()
            return {"success": True, "provedor_autenticacao": safe_provider}
        finally:
            conn.close()

    def create_email_change_request(self, id_usuario: int, email_atual: str, email_novo: str) -> dict:
        safe_new_email = _normalize_email(email_novo)
        if not _EMAIL_PATTERN.fullmatch(safe_new_email):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Informe um e-mail válido.")
        if safe_new_email == _normalize_email(email_atual):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Este já é o seu e-mail atual.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_email_change_requests_table(cursor)
            cursor.execute(
                """
                SELECT COUNT(*) FROM solicitacoes_alteracao_email
                WHERE id_usuario = ? AND status = 'pendente'
                """,
                (int(id_usuario),),
            )
            if int(cursor.fetchone()[0] or 0) > 0:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Você já tem uma solicitação de alteração de e-mail aguardando aprovação.",
                )

            cursor.execute(
                """
                INSERT INTO solicitacoes_alteracao_email (id_usuario, email_atual, email_novo, status)
                VALUES (?, ?, ?, 'pendente')
                """,
                (int(id_usuario), normalize_text(email_atual), safe_new_email),
            )
            conn.commit()
            return {"success": True, "email_novo": safe_new_email}
        finally:
            conn.close()

    def list_pending_email_change_requests(self) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_email_change_requests_table(cursor)
            cursor.execute(
                """
                SELECT
                    solicitacoes_alteracao_email.id,
                    solicitacoes_alteracao_email.id_usuario,
                    solicitacoes_alteracao_email.email_atual,
                    solicitacoes_alteracao_email.email_novo,
                    solicitacoes_alteracao_email.status,
                    solicitacoes_alteracao_email.solicitado_em,
                    usuarios.nome AS nome_usuario,
                    usuarios.login AS login_usuario
                FROM solicitacoes_alteracao_email
                LEFT JOIN usuarios ON usuarios.id_usuario = solicitacoes_alteracao_email.id_usuario
                WHERE solicitacoes_alteracao_email.status = 'pendente'
                ORDER BY solicitacoes_alteracao_email.solicitado_em ASC
                """
            )
            return rows_to_dicts(cursor, cursor.fetchall())
        finally:
            conn.close()

    def _decide_email_change_request(
        self,
        id_solicitacao: int,
        *,
        aprovar: bool,
        decidido_por: str,
        motivo_rejeicao: str = "",
    ) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_email_change_requests_table(cursor)
            cursor.execute(
                """
                SELECT id_usuario, email_novo, status
                FROM solicitacoes_alteracao_email
                WHERE id = ?
                """,
                (int(id_solicitacao),),
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Solicitação não encontrada.")
            id_usuario, email_novo, status_atual = row[0], row[1], normalize_text(row[2])
            if status_atual != "pendente":
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Esta solicitação já foi decidida.")

            novo_status = "aprovado" if aprovar else "rejeitado"
            if aprovar:
                cursor.execute(
                    "UPDATE usuarios SET email = ?, atualizado_em = GETDATE() WHERE id_usuario = ?",
                    (normalize_text(email_novo), int(id_usuario)),
                )

            cursor.execute(
                """
                UPDATE solicitacoes_alteracao_email
                SET status = ?, decidido_em = GETDATE(), decidido_por = ?, motivo_rejeicao = ?
                WHERE id = ?
                """,
                (novo_status, normalize_text(decidido_por), normalize_text(motivo_rejeicao) or None, int(id_solicitacao)),
            )
            conn.commit()
            return {"success": True, "status": novo_status}
        finally:
            conn.close()

    def approve_email_change_request(self, id_solicitacao: int, *, decidido_por: str) -> dict:
        return self._decide_email_change_request(id_solicitacao, aprovar=True, decidido_por=decidido_por)

    def reject_email_change_request(self, id_solicitacao: int, *, decidido_por: str, motivo: str = "") -> dict:
        return self._decide_email_change_request(
            id_solicitacao, aprovar=False, decidido_por=decidido_por, motivo_rejeicao=motivo
        )

    def begin_mfa_enrollment(self, id_usuario: int, *, actor=None) -> dict:
        secret = generate_secret()
        try:
            encrypted = encrypt_secret(secret, self.settings.mfa_encryption_key)
        except SecretEncryptionError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(exc),
            ) from exc
        conn = self._connect()
        try:
            cursor = conn.cursor()
            user_row = self._get_system_user_by_id(cursor, id_usuario)
            cursor.execute(
                """
                UPDATE usuarios
                SET mfa_secret_encrypted = ?, mfa_enabled = 0, atualizado_em = GETDATE()
                WHERE id_usuario = ?
                """,
                (encrypted, int(id_usuario)),
            )
            self._insert_audit_log(
                cursor,
                user=actor,
                modulo="Autenticação",
                acao="mfa_iniciar_ativacao",
                entidade="usuario",
                entidade_id=str(id_usuario),
                sucesso=True,
            )
            conn.commit()
            account = normalize_text(user_row.get("email") or user_row.get("login"))
            return {
                "secret": secret,
                "provisioning_uri": provisioning_uri(secret, account, self.settings.mfa_issuer),
            }
        finally:
            conn.close()

    def enable_mfa(self, id_usuario: int, code: str, *, actor=None) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT TOP 1 mfa_secret_encrypted FROM usuarios WHERE id_usuario = ?",
                (int(id_usuario),),
            )
            row = cursor.fetchone()
            if not row or not row[0]:
                raise HTTPException(status_code=400, detail="Inicie a ativação do MFA primeiro.")
            try:
                secret = decrypt_secret(row[0], self.settings.mfa_encryption_key)
            except SecretEncryptionError as exc:
                raise HTTPException(status_code=503, detail=str(exc)) from exc
            if not verify_code(secret, code):
                raise HTTPException(status_code=400, detail="Código MFA inválido.")
            cursor.execute(
                "UPDATE usuarios SET mfa_enabled = 1, atualizado_em = GETDATE() WHERE id_usuario = ?",
                (int(id_usuario),),
            )
            self._insert_audit_log(
                cursor,
                user=actor,
                modulo="Autenticação",
                acao="mfa_ativar",
                entidade="usuario",
                entidade_id=str(id_usuario),
                sucesso=True,
            )
            conn.commit()
            return {"success": True, "message": "MFA ativado."}
        finally:
            conn.close()

    def reset_user_mfa(self, id_usuario: int, *, actor=None, reason: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            self._get_system_user_by_id(cursor, id_usuario)
            cursor.execute(
                """
                UPDATE usuarios
                SET mfa_enabled = 0, mfa_secret_encrypted = NULL, atualizado_em = GETDATE()
                WHERE id_usuario = ?
                """,
                (int(id_usuario),),
            )
            self._insert_audit_log(
                cursor,
                user=actor,
                modulo="Usuários",
                acao="mfa_reset_administrativo",
                entidade="usuario",
                entidade_id=str(id_usuario),
                justificativa=normalize_text(reason),
                sucesso=True,
            )
            conn.commit()
            return {"success": True, "message": "MFA redefinido."}
        finally:
            conn.close()

    def list_roles(self) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            return [
                {
                    "id": role.id,
                    "nome": role.name,
                    "nivel": role.level,
                    "descricao": role.description,
                    "oculto": role.hidden,
                    "permissoes": self._get_role_permissions_from_db(cursor, role.id),
                }
                for role in ROLE_DEFINITIONS.values()
            ]
        finally:
            conn.close()

    def list_permissions(self) -> list[dict]:
        return [
            {
                "chave": item.key,
                "modulo": item.module,
                "descricao": item.description,
                "critica": item.critical,
            }
            for item in PERMISSION_DEFINITIONS.values()
        ]

    def update_role_permissions(
        self,
        role_id: str,
        data: dict,
        *,
        actor: AuthenticatedUser | dict | None = None,
    ) -> dict:
        safe_role = normalize_role_id(role_id)
        if safe_role not in ROLE_DEFINITIONS:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Perfil não encontrado.")

        requested_permissions = sanitize_permissions(data.get("permissoes") or data.get("permissions"))
        conn = self._connect()
        try:
            cursor = conn.cursor()
            previous = self._get_role_permissions_from_db(cursor, safe_role)
            for permission_key in PERMISSION_DEFINITIONS:
                allowed = 1 if permission_key in requested_permissions else 0
                cursor.execute(
                    """
                    IF NOT EXISTS (
                        SELECT 1
                        FROM perfil_permissoes
                        WHERE id_perfil = ? AND chave_permissao = ?
                    )
                    BEGIN
                        INSERT INTO perfil_permissoes
                        (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
                        VALUES (?, ?, ?, GETDATE(), GETDATE())
                    END
                    ELSE
                    BEGIN
                        UPDATE perfil_permissoes
                        SET permitido = ?, atualizado_em = GETDATE()
                        WHERE id_perfil = ? AND chave_permissao = ?
                    END
                    """,
                    (
                        safe_role,
                        permission_key,
                        safe_role,
                        permission_key,
                        allowed,
                        allowed,
                        safe_role,
                        permission_key,
                    ),
                )
            self._insert_audit_log(
                cursor,
                user=actor,
                modulo="Configurações",
                acao="atualizar_permissoes_perfil",
                entidade="perfil",
                entidade_id=safe_role,
                valor_anterior={"permissoes": previous},
                valor_novo={"permissoes": sorted(requested_permissions)},
                justificativa=normalize_text(data.get("justificativa")),
                sucesso=True,
            )
            conn.commit()
            return {"success": True, "permissoes": sorted(requested_permissions)}
        finally:
            conn.close()

    def list_system_users(self, *, search: str = "", perfil: str = "", status_usuario: str = "") -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT
                    usuarios.id_usuario,
                    usuarios.login,
                    usuarios.nome,
                    usuarios.sobrenome,
                    usuarios.email,
                    usuarios.perfil_id,
                    perfis.nome AS perfil_nome,
                    perfis.nivel,
                    usuarios.status,
                    usuarios.provedor_autenticacao,
                    usuarios.ultimo_login_microsoft,
                    usuarios.avatar_ilustrado,
                    usuarios.criado_em,
                    usuarios.ultimo_acesso_em,
                    usuarios.criado_por,
                    usuarios.atualizado_por,
                    usuarios.atualizado_em
                FROM usuarios
                LEFT JOIN perfis ON perfis.id_perfil = usuarios.perfil_id
                ORDER BY usuarios.nome, usuarios.email
                """
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            cursor.execute("SELECT id_usuario, operacao FROM dbo.usuarios_operacoes")
            operacoes_por_usuario: dict = {}
            for id_usuario, operacao in cursor.fetchall():
                valor = normalize_text(operacao)
                if not valor:
                    continue
                operacoes_por_usuario.setdefault(id_usuario, []).append(valor)
            users = [
                self._serialize_system_user(row, operacoes=operacoes_por_usuario.get(row.get("id_usuario"), []))
                for row in rows
            ]
        finally:
            conn.close()

        safe_search = normalize_text(search).lower()
        safe_role = normalize_role_id(perfil)
        safe_status = normalize_text(status_usuario).lower()
        if safe_search:
            users = [
                item
                for item in users
                if safe_search in item["nome"].lower()
                or safe_search in item["email"].lower()
                or safe_search in item["login"].lower()
            ]
        if safe_role:
            users = [item for item in users if item["perfil"] == safe_role]
        if safe_status:
            users = [item for item in users if item["status"].lower() == safe_status]
        return users

    @staticmethod
    def _ensure_user_identity_available(
        cursor,
        *,
        email: str,
        login: str,
        exclude_id: int | None = None,
    ) -> None:
        """Recusa e-mail/login já usados por outro usuário com mensagem clara
        (antes o índice único UX_usuarios_email/UX_usuarios_login estourava
        como erro técnico de banco na tela)."""
        cursor.execute(
            """
            SELECT TOP 1 id_usuario, nome, sobrenome, email, login, status
            FROM usuarios
            WHERE (LOWER(email) = LOWER(?) OR LOWER(login) = LOWER(?) OR LOWER(login) = LOWER(?) OR LOWER(email) = LOWER(?))
              AND id_usuario <> ?
            """,
            (email, email, login, login, int(exclude_id or 0)),
        )
        row = cursor.fetchone()
        if not row:
            return
        existing_name = " ".join(part for part in (normalize_text(row[1]), normalize_text(row[2])) if part) or "sem nome"
        existing_status = normalize_text(row[5]) or "sem status"
        conflict_on_email = (normalize_text(row[3]).lower() == email.lower()) or (normalize_text(row[4]).lower() == email.lower())
        subject = f"o e-mail {email}" if conflict_on_email else f"o login {login}"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Já existe um usuário cadastrado com {subject} ({existing_name} — {existing_status}). "
                "Use outro e-mail/login ou edite o usuário existente."
            ),
        )

    def create_system_user(self, data: dict, *, actor: AuthenticatedUser | dict | None = None) -> dict:
        safe_name = normalize_text(data.get("nome"))
        safe_surname = normalize_text(data.get("sobrenome"))
        safe_email = _normalize_email(data.get("email"))
        safe_login = normalize_text(data.get("login")) or safe_email
        safe_password = normalize_text(data.get("senha") or data.get("password"))
        role = get_role_definition(data.get("perfil") or data.get("perfil_id") or ROLE_INTERN)
        safe_cargo = normalize_text(data.get("cargo"))
        safe_status = normalize_text(data.get("status")) or "Ativo"
        auth_provider = _normalize_auth_provider(data.get("provedor_autenticacao"))

        if not safe_name or not safe_email or not safe_login:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Nome, e-mail e login são obrigatórios.",
            )
        if not _EMAIL_PATTERN.fullmatch(safe_email):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Informe um e-mail válido.",
            )
        if auth_provider == AUTH_PROVIDER_LOCAL and not safe_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A senha é obrigatória para usuários com acesso Local.",
            )

        password_hash = hash_password(safe_password) if safe_password else None

        actor_info = _actor_payload(actor)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            self._ensure_user_identity_available(cursor, email=safe_email, login=safe_login)
            cursor.execute(
                """
                INSERT INTO usuarios
                (
                    login,
                    nome,
                    sobrenome,
                    email,
                    perfil_id,
                    cargo,
                    status,
                    senha_hash,
                    provedor_autenticacao,
                    criado_por,
                    atualizado_por,
                    criado_em,
                    atualizado_em
                )
                OUTPUT INSERTED.id_usuario
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())
                """,
                (
                    safe_login,
                    safe_name,
                    safe_surname,
                    safe_email,
                    role.id,
                    safe_cargo,
                    safe_status,
                    password_hash,
                    auth_provider,
                    actor_info.get("email") or actor_info.get("nome"),
                    actor_info.get("email") or actor_info.get("nome"),
                ),
            )
            id_usuario = int(cursor.fetchone()[0])
            if "operacoes" in data:
                self._sync_user_operacoes(cursor, id_usuario, data.get("operacoes"))
            self._insert_audit_log(
                cursor,
                user=actor,
                modulo="Usuários",
                acao="criar_usuario",
                entidade="usuario",
                entidade_id=str(id_usuario),
                valor_novo={
                    "nome": safe_name,
                    "sobrenome": safe_surname,
                    "email": safe_email,
                    "login": safe_login,
                    "perfil": role.id,
                    "cargo": safe_cargo,
                    "status": safe_status,
                    "provedor_autenticacao": auth_provider,
                },
                sucesso=True,
            )
            conn.commit()
            return {"success": True, "id_usuario": id_usuario}
        finally:
            conn.close()

    def create_quick_training_user(self, data: dict, *, actor: AuthenticatedUser | dict | None = None) -> dict:
        """Botão "Criar usuário rápido": cadastra login (nome/e-mail/senha) para
        um candidato aprovado que vai fazer treinamento — perfil fixo
        `funcionario` (Central de Treinamentos), sem atribuir treinamento
        nenhum (isso continua a cargo da Gestão de Treinamentos). O vínculo
        com o candidato é automático por e-mail (ver
        `_resolve_id_registros_por_email`, `email_login_vinculado`) desde que
        o e-mail usado aqui seja o mesmo do cadastro no processo seletivo.
        """
        safe_name = normalize_text(data.get("nome"))
        safe_email = _normalize_email(data.get("email"))
        safe_password = normalize_text(data.get("senha"))

        if not safe_name or not safe_email or not safe_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Nome, e-mail e senha são obrigatórios.",
            )

        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT id_usuario FROM usuarios WHERE LOWER(email) = LOWER(?)", (safe_email,))
            if cursor.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Já existe um usuário cadastrado com este e-mail.",
                )
        finally:
            conn.close()

        resultado = self.create_system_user(
            {
                "nome": safe_name,
                "email": safe_email,
                "login": safe_email,
                "senha": safe_password,
                "perfil": ROLE_EMPLOYEE,
                "status": "Ativo",
                "provedor_autenticacao": "local",
            },
            actor=actor,
        )

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_notifications_table(cursor)
            # Mesmo grupo de papéis notificado pelos outros eventos de
            # treinamento (ver _PAPEIS_GESTAO_TREINAMENTO em onboarding.py).
            for papel in ("rh", "gestor", "administrador"):
                self._criar_notificacao(
                    cursor,
                    destinatario_papel=papel,
                    titulo="Novo usuário de treinamento criado",
                    mensagem=f"{safe_name} ({safe_email}) já pode ser atribuído a um treinamento.",
                    categoria="usuario_colaborador_criado",
                    entidade="usuario",
                    entidade_id=str(resultado.get("id_usuario") or ""),
                )
            conn.commit()
        finally:
            conn.close()

        return resultado

    def _get_system_user_by_id(self, cursor, id_usuario: int) -> dict:
        cursor.execute(
            """
            SELECT TOP 1
                usuarios.id_usuario,
                usuarios.login,
                usuarios.nome,
                usuarios.sobrenome,
                usuarios.cargo,
                usuarios.email,
                usuarios.perfil_id,
                perfis.nome AS perfil_nome,
                perfis.nivel,
                usuarios.status,
                usuarios.provedor_autenticacao,
                usuarios.ultimo_login_microsoft,
                usuarios.avatar_ilustrado,
                usuarios.criado_em,
                usuarios.ultimo_acesso_em,
                usuarios.criado_por,
                usuarios.atualizado_por,
                usuarios.atualizado_em
            FROM usuarios
            LEFT JOIN perfis ON perfis.id_perfil = usuarios.perfil_id
            WHERE usuarios.id_usuario = ?
            """,
            (int(id_usuario),),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado.")
        return rows_to_dicts(cursor, [row])[0]

    def update_system_user(self, id_usuario: int, data: dict, *, actor: AuthenticatedUser | dict | None = None) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            previous = self._serialize_system_user(self._get_system_user_by_id(cursor, id_usuario))
            role = get_role_definition(data.get("perfil") or data.get("perfil_id") or previous["perfil"])
            requested_email = _normalize_email(data.get("email")) or previous["email"]
            if not _EMAIL_PATTERN.fullmatch(requested_email):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Informe um e-mail válido.",
                )
            new_values = {
                "login": normalize_text(data.get("login")) or previous["login"],
                "nome": normalize_text(data.get("nome")) or previous["nome"],
                "sobrenome": normalize_text(data.get("sobrenome")) if "sobrenome" in data else previous.get("sobrenome", ""),
                "email": requested_email,
                "perfil_id": role.id,
                "cargo": normalize_text(data.get("cargo")) if "cargo" in data else previous.get("cargo", ""),
                "status": normalize_text(data.get("status")) or previous["status"],
                "provedor_autenticacao": _normalize_auth_provider(
                    data.get("provedor_autenticacao"),
                    default=previous["provedor_autenticacao"],
                ),
            }
            self._ensure_user_identity_available(
                cursor,
                email=new_values["email"],
                login=new_values["login"],
                exclude_id=int(id_usuario),
            )
            actor_info = _actor_payload(actor)
            cursor.execute(
                """
                UPDATE usuarios
                SET
                    login = ?,
                    nome = ?,
                    sobrenome = ?,
                    email = ?,
                    perfil_id = ?,
                    cargo = ?,
                    status = ?,
                    provedor_autenticacao = ?,
                    atualizado_por = ?,
                    atualizado_em = GETDATE()
                WHERE id_usuario = ?
                """,
                (
                    new_values["login"],
                    new_values["nome"],
                    new_values["sobrenome"],
                    new_values["email"],
                    new_values["perfil_id"],
                    new_values["cargo"],
                    new_values["status"],
                    new_values["provedor_autenticacao"],
                    actor_info.get("email") or actor_info.get("nome"),
                    int(id_usuario),
                ),
            )
            if data.get("operacoes") is not None:
                self._sync_user_operacoes(cursor, id_usuario, data.get("operacoes"))
            if previous["provedor_autenticacao"] != new_values["provedor_autenticacao"]:
                action = "alterar_tipo_autenticacao"
            elif previous["perfil"] != role.id:
                action = "alterar_perfil"
            else:
                action = "editar_usuario"
            self._insert_audit_log(
                cursor,
                user=actor,
                modulo="Usuários",
                acao=action,
                entidade="usuario",
                entidade_id=str(id_usuario),
                valor_anterior=previous,
                valor_novo=new_values,
                justificativa=normalize_text(data.get("justificativa")),
                sucesso=True,
            )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def reset_system_user_password(self, id_usuario: int, data: dict, *, actor: AuthenticatedUser | dict | None = None) -> dict:
        safe_password = normalize_text(data.get("senha") or data.get("password"))
        if not safe_password:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe a nova senha.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            self._get_system_user_by_id(cursor, id_usuario)
            actor_info = _actor_payload(actor)
            cursor.execute(
                """
                UPDATE usuarios
                SET senha_hash = ?, atualizado_por = ?, atualizado_em = GETDATE()
                WHERE id_usuario = ?
                """,
                (
                    hash_password(safe_password),
                    actor_info.get("email") or actor_info.get("nome"),
                    int(id_usuario),
                ),
            )
            self._insert_audit_log(
                cursor,
                user=actor,
                modulo="Usuários",
                acao="redefinir_senha",
                entidade="usuario",
                entidade_id=str(id_usuario),
                justificativa=normalize_text(data.get("justificativa")),
                sucesso=True,
            )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def set_system_user_status(self, id_usuario: int, data: dict, *, actor: AuthenticatedUser | dict | None = None) -> dict:
        action = normalize_text(data.get("acao")).lower()
        status_by_action = {
            "ativar": "Ativo",
            "desativar": "Inativo",
            "bloquear": "Bloqueado",
            "desbloquear": "Ativo",
        }
        if action not in status_by_action:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ação de status inválida.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            previous = self._serialize_system_user(self._get_system_user_by_id(cursor, id_usuario))
            new_status = status_by_action[action]
            actor_info = _actor_payload(actor)
            cursor.execute(
                """
                UPDATE usuarios
                SET
                    status = ?,
                    atualizado_por = ?,
                    atualizado_em = GETDATE(),
                    bloqueado_em = CASE WHEN ? = 'Bloqueado' THEN GETDATE() ELSE bloqueado_em END,
                    desativado_em = CASE WHEN ? = 'Inativo' THEN GETDATE() ELSE desativado_em END
                WHERE id_usuario = ?
                """,
                (
                    new_status,
                    actor_info.get("email") or actor_info.get("nome"),
                    new_status,
                    new_status,
                    int(id_usuario),
                ),
            )
            self._insert_audit_log(
                cursor,
                user=actor,
                modulo="Usuários",
                acao=f"{action}_usuario",
                entidade="usuario",
                entidade_id=str(id_usuario),
                valor_anterior=previous,
                valor_novo={"status": new_status},
                justificativa=normalize_text(data.get("justificativa")),
                sucesso=True,
            )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    # Tabelas de vínculo/pendência do usuário que são apagadas junto com ele.
    _USER_LINK_TABLES = (
        ("usuarios_operacoes", "id_usuario"),
        ("usuarios_operacoes_historico", "id_usuario"),
        ("usuarios_canais", "id_usuario"),
        ("usuarios_supervisores", "id_operador"),
        ("usuarios_supervisores", "id_supervisor"),
        ("solicitacoes_alteracao_email", "id_usuario"),
        ("politicas_confirmacoes", "id_usuario"),
        ("monitoria_rascunhos", "id_avaliador"),
    )
    # Histórico de Monitoria é imutável (regra de domínio): quem aparece nele só pode ser desativado.
    _USER_MONITORIA_HISTORY = (
        ("monitorias", "id_operador", "como operador"),
        ("monitorias", "id_avaliador", "como avaliador"),
        ("monitoria_contestacoes", "id_operador", "em contestações"),
        ("monitoria_planos_acao", "id_operador", "em planos de ação"),
        ("monitoria_planos_acao", "id_responsavel", "como responsável de plano de ação"),
        ("monitoria_reanalises", "id_supervisor", "em reanálises"),
    )

    def delete_system_user(self, id_usuario: int, *, actor: AuthenticatedUser | dict | None = None, justificativa: str = "") -> dict:
        """Exclusão DEFINITIVA do usuário (linha em `usuarios` + vínculos).

        Logs de auditoria são mantidos (guardam nome/e-mail). Recusa excluir a si
        mesmo, o último administrador ativo e quem tem histórico de Monitoria.
        """
        target_id = int(id_usuario)
        actor_id = getattr(actor, "id_usuario", None) if not isinstance(actor, dict) else actor.get("id_usuario")
        if actor_id is not None and int(actor_id) == target_id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Você não pode excluir o próprio usuário.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            previous = self._serialize_system_user(self._get_system_user_by_id(cursor, target_id))

            if previous.get("perfil") == ROLE_ADMIN:
                cursor.execute(
                    "SELECT COUNT(*) FROM usuarios WHERE perfil_id = ? AND status = 'Ativo' AND id_usuario <> ?",
                    (ROLE_ADMIN, target_id),
                )
                if int(cursor.fetchone()[0]) == 0:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Este é o último administrador ativo; não pode ser excluído.",
                    )

            for table, column, label in self._USER_MONITORIA_HISTORY:
                cursor.execute("SELECT OBJECT_ID(?)", (f"dbo.{table}",))
                if cursor.fetchone()[0] is None:
                    continue
                cursor.execute(f"SELECT COUNT(*) FROM dbo.{table} WHERE {column} = ?", (target_id,))
                total = int(cursor.fetchone()[0])
                if total:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=(
                            f"Este usuário aparece {label} no histórico da Monitoria ({total} registro(s)), "
                            "que é imutável e não pode ficar sem o usuário. Desative o usuário em vez de excluir."
                        ),
                    )

            for table, column in self._USER_LINK_TABLES:
                cursor.execute("SELECT OBJECT_ID(?)", (f"dbo.{table}",))
                if cursor.fetchone()[0] is not None:
                    cursor.execute(f"DELETE FROM dbo.{table} WHERE {column} = ?", (target_id,))

            cursor.execute("DELETE FROM usuarios WHERE id_usuario = ?", (target_id,))
            self._insert_audit_log(
                cursor,
                user=actor,
                modulo="Usuários",
                acao="excluir_usuario",
                entidade="usuario",
                entidade_id=str(target_id),
                valor_anterior=previous,
                justificativa=normalize_text(justificativa) or "Exclusão definitiva solicitada.",
                sucesso=True,
            )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def deactivate_system_user(self, id_usuario: int, *, actor: AuthenticatedUser | dict | None = None, justificativa: str = "") -> dict:
        return self.set_system_user_status(
            id_usuario,
            {"acao": "desativar", "justificativa": justificativa or "Exclusão lógica solicitada."},
            actor=actor,
        )

    def list_audit_logs(
        self,
        *,
        limit: int = 100,
        modulo: str = "",
        acao: str = "",
        usuario: str = "",
    ) -> list[dict]:
        safe_limit = min(max(int(limit or 100), 1), 500)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            # Duas etapas: ordenar direto com as colunas nvarchar(max)
            # (valor_anterior/valor_novo) fazia o SQL Server levar ~25 s para 160
            # linhas; escolher os ids pelo índice e só então buscar as colunas
            # largas mantém a mesma ordenação em ~50 ms.
            cursor.execute(
                f"""
                SELECT
                    l.id_log,
                    l.id_usuario,
                    l.nome_usuario,
                    l.email_usuario,
                    l.perfil_id,
                    l.perfil_nome,
                    l.data_hora,
                    l.modulo,
                    l.acao,
                    l.entidade,
                    l.entidade_id,
                    l.valor_anterior,
                    l.valor_novo,
                    l.justificativa,
                    l.origem,
                    l.sucesso
                FROM (
                    SELECT TOP {safe_limit} id_log
                    FROM logs_auditoria
                    ORDER BY data_hora DESC, id_log DESC
                ) AS recentes
                JOIN logs_auditoria AS l ON l.id_log = recentes.id_log
                ORDER BY l.data_hora DESC, l.id_log DESC
                """
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
        finally:
            conn.close()

        safe_module = normalize_text(modulo).lower()
        safe_action = normalize_text(acao).lower()
        safe_user = normalize_text(usuario).lower()
        if safe_module:
            safe_module_compare = normalize_compare_text(safe_module)
            rows = [
                item
                for item in rows
                if safe_module_compare in normalize_compare_text(item.get("modulo"))
            ]
        if safe_action:
            rows = [item for item in rows if safe_action in normalize_text(item.get("acao")).lower()]
        if safe_user:
            rows = [
                item
                for item in rows
                if safe_user in normalize_text(item.get("nome_usuario")).lower()
                or safe_user in normalize_text(item.get("email_usuario")).lower()
            ]
        for item in rows:
            item["modulo"] = _display_audit_module(item.get("modulo"))
        return rows

    def export_audit_logs_csv(self, *, limit: int = 500) -> tuple[str, str]:
        rows = self.list_audit_logs(limit=limit)
        output = io.StringIO()
        columns = [
            "id_log",
            "data_hora",
            "nome_usuario",
            "email_usuario",
            "perfil_nome",
            "modulo",
            "acao",
            "entidade",
            "entidade_id",
            "justificativa",
            "origem",
            "sucesso",
        ]
        writer = csv.DictWriter(output, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
        return f"logs_auditoria_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv", output.getvalue()

    def list_catalog_items_by_type(self, tipo: str, *, apenas_ativos: bool = True) -> list[dict]:
        """Leitura enxuta de um único catálogo (ex.: "operacoes"), só os campos
        necessários para preencher um <select> — usada por telas operacionais
        (criar processo, gerar prova) que não têm permissão de configurações."""
        definition = SETTINGS_CATALOGS.get(normalize_text(tipo))
        if not definition:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catálogo de configuração não encontrado.")
        table = definition["table"]
        conn = self._connect()
        try:
            cursor = conn.cursor()
            where_ativo = "WHERE ativo = 1" if apenas_ativos else ""
            cursor.execute(
                f"""
                SELECT id_item, chave, nome, descricao, categoria, payload_json
                FROM {table}
                {where_ativo}
                ORDER BY nome
                """
            )
            items = []
            for row in rows_to_dicts(cursor, cursor.fetchall()):
                item = dict(row)
                item["payload"] = safe_json_loads(item.get("payload_json"), {})
                item.pop("payload_json", None)
                items.append(item)
            return items
        finally:
            conn.close()

    # Vertente Monitoria (promt.txt §2, respostas R-12/R-13/R3-4): operação
    # inativa não aceita nenhuma edição (só reativação pelo Administrador) e
    # uma operação com monitorias/matrizes nunca muda de chave nem é excluída.
    def _operacao_em_uso_monitoria(self, cursor, chave: str) -> bool:
        cursor.execute(
            "SELECT TOP 1 1 FROM dbo.monitoria_matrizes WHERE operacao = ?", (chave,)
        )
        if cursor.fetchone():
            return True
        cursor.execute("SELECT TOP 1 1 FROM dbo.monitorias WHERE operacao = ?", (chave,))
        return bool(cursor.fetchone())

    def _guard_operacao_update(self, cursor, previous: dict, values: dict) -> dict:
        ativo_anterior = bool(previous.get("ativo"))
        if not ativo_anterior:
            if not values.get("ativo"):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Operação inativa não pode ser editada. Reative-a primeiro.",
                )
            # Reativação: só o status muda, nenhum outro campo é aplicado.
            return {
                "chave": normalize_text(previous.get("chave")),
                "nome": normalize_text(previous.get("nome")),
                "descricao": normalize_text(previous.get("descricao")),
                "categoria": normalize_text(previous.get("categoria")),
                "payload_json": previous.get("payload_json") or "{}",
                "ativo": 1,
            }
        chave_anterior = normalize_text(previous.get("chave"))
        if values.get("chave") != chave_anterior and self._operacao_em_uso_monitoria(cursor, chave_anterior):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Esta operação já possui matriz/monitorias: a chave não pode ser alterada.",
            )
        return values

    def _guard_operacao_delete(self, cursor, previous: dict) -> None:
        if self._operacao_em_uso_monitoria(cursor, normalize_text(previous.get("chave"))):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Esta operação possui monitorias e não pode ser excluída. Desative-a.",
            )

    def list_configuration_catalog(self) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            sections = []
            for key, definition in SETTINGS_CATALOGS.items():
                table = definition["table"]
                cursor.execute(
                    f"""
                    SELECT
                        id_item,
                        chave,
                        nome,
                        descricao,
                        categoria,
                        payload_json,
                        ativo,
                        usado,
                        criado_em,
                        atualizado_em
                    FROM {table}
                    ORDER BY categoria, nome, id_item
                    """
                )
                items = []
                for row in rows_to_dicts(cursor, cursor.fetchall()):
                    item = dict(row)
                    item["payload"] = safe_json_loads(item.get("payload_json"), {})
                    item["ativo"] = bool(item.get("ativo"))
                    item["usado"] = bool(item.get("usado"))
                    items.append(item)
                sections.append(
                    {
                        "tipo": key,
                        "label": definition["label"],
                        "items": items,
                    }
                )
            return {"sections": sections}
        finally:
            conn.close()

    def upsert_configuration_item(
        self,
        tipo: str,
        data: dict,
        *,
        id_item: int | None = None,
        actor: AuthenticatedUser | dict | None = None,
    ) -> dict:
        definition = SETTINGS_CATALOGS.get(normalize_text(tipo))
        if not definition:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catálogo de configuração não encontrado.")

        table = definition["table"]
        payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
        values = {
            "chave": normalize_text(data.get("chave")),
            "nome": normalize_text(data.get("nome")),
            "descricao": normalize_text(data.get("descricao")),
            "categoria": normalize_text(data.get("categoria")),
            "payload_json": json.dumps(payload, ensure_ascii=False),
            "ativo": 1 if data.get("ativo", True) else 0,
        }
        if not values["nome"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nome da configuração é obrigatório.")
        if not values["chave"]:
            values["chave"] = values["nome"].lower().replace(" ", "_")[:120]

        conn = self._connect()
        try:
            cursor = conn.cursor()
            previous = None
            if id_item:
                cursor.execute(f"SELECT TOP 1 * FROM {table} WHERE id_item = ?", (int(id_item),))
                row = cursor.fetchone()
                if not row:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item de configuração não encontrado.")
                previous = rows_to_dicts(cursor, [row])[0]
                if normalize_text(tipo) == "operacoes":
                    values = self._guard_operacao_update(cursor, previous, values)
                cursor.execute(
                    f"""
                    UPDATE {table}
                    SET
                        chave = ?,
                        nome = ?,
                        descricao = ?,
                        categoria = ?,
                        payload_json = ?,
                        ativo = ?,
                        atualizado_em = GETDATE()
                    WHERE id_item = ?
                    """,
                    (
                        values["chave"],
                        values["nome"],
                        values["descricao"],
                        values["categoria"],
                        values["payload_json"],
                        values["ativo"],
                        int(id_item),
                    ),
                )
                resolved_id = int(id_item)
                action = "editar_configuracao"
            else:
                cursor.execute(
                    f"""
                    INSERT INTO {table}
                    (
                        chave,
                        nome,
                        descricao,
                        categoria,
                        payload_json,
                        ativo,
                        usado,
                        criado_em,
                        atualizado_em
                    )
                    OUTPUT INSERTED.id_item
                    VALUES (?, ?, ?, ?, ?, ?, 0, GETDATE(), GETDATE())
                    """,
                    (
                        values["chave"],
                        values["nome"],
                        values["descricao"],
                        values["categoria"],
                        values["payload_json"],
                        values["ativo"],
                    ),
                )
                resolved_id = int(cursor.fetchone()[0])
                action = "criar_configuracao"

            self._insert_audit_log(
                cursor,
                user=actor,
                modulo="Configurações",
                acao=action,
                entidade=table,
                entidade_id=str(resolved_id),
                valor_anterior=previous,
                valor_novo=values,
                justificativa=normalize_text(data.get("justificativa")),
                sucesso=True,
            )
            conn.commit()
            return {"success": True, "id_item": resolved_id}
        finally:
            conn.close()

    def deactivate_configuration_item(
        self,
        tipo: str,
        id_item: int,
        *,
        actor: AuthenticatedUser | dict | None = None,
        justificativa: str = "",
    ) -> dict:
        definition = SETTINGS_CATALOGS.get(normalize_text(tipo))
        if not definition:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catálogo de configuração não encontrado.")

        table = definition["table"]
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(f"SELECT TOP 1 * FROM {table} WHERE id_item = ?", (int(id_item),))
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item de configuração não encontrado.")
            previous = rows_to_dicts(cursor, [row])[0]
            cursor.execute(
                f"""
                UPDATE {table}
                SET ativo = 0, atualizado_em = GETDATE()
                WHERE id_item = ?
                """,
                (int(id_item),),
            )
            self._insert_audit_log(
                cursor,
                user=actor,
                modulo="Configurações",
                acao="desativar_configuracao",
                entidade=table,
                entidade_id=str(id_item),
                valor_anterior=previous,
                valor_novo={"ativo": False},
                justificativa=justificativa,
                sucesso=True,
            )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def delete_configuration_item(
        self,
        tipo: str,
        id_item: int,
        *,
        actor: AuthenticatedUser | dict | None = None,
        justificativa: str = "",
    ) -> dict:
        """Exclusão física de um item de catálogo genérico (diferente de
        deactivate_configuration_item, que só marca ativo=0). Usado pelas
        telas que pedem um botão de "Excluir" além de "Ativar/Desativar"
        (ex.: Motivos de Eliminação, Modelos de E-mail). As tabelas destes
        catálogos não têm FK — outras tabelas guardam o texto/nome como
        valor livre, não uma referência — então excluir aqui não quebra
        registros históricos já salvos."""
        definition = SETTINGS_CATALOGS.get(normalize_text(tipo))
        if not definition:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catálogo de configuração não encontrado.")

        table = definition["table"]
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(f"SELECT TOP 1 * FROM {table} WHERE id_item = ?", (int(id_item),))
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item de configuração não encontrado.")
            previous = rows_to_dicts(cursor, [row])[0]
            if normalize_text(tipo) == "operacoes":
                self._guard_operacao_delete(cursor, previous)
            cursor.execute(f"DELETE FROM {table} WHERE id_item = ?", (int(id_item),))
            self._insert_audit_log(
                cursor,
                user=actor,
                modulo="Configurações",
                acao="excluir_configuracao",
                entidade=table,
                entidade_id=str(id_item),
                valor_anterior=previous,
                valor_novo=None,
                justificativa=justificativa,
                sucesso=True,
            )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def register_lgpd_request(self, data: dict, *, actor: AuthenticatedUser | dict | None = None) -> dict:
        payload = {
            "tipo_solicitacao": normalize_text(data.get("tipo_solicitacao")),
            "titular": normalize_text(data.get("titular")),
            "email": normalize_text(data.get("email")),
            "descricao": normalize_text(data.get("descricao")),
            "status": "Registrada",
        }
        if not payload["tipo_solicitacao"] or not payload["titular"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tipo de solicitação e titular são obrigatórios.")
        return self.upsert_configuration_item(
            "lgpd",
            {
                "chave": f"solicitacao_{datetime.now().strftime('%Y%m%d%H%M%S')}",
                "nome": f"{payload['tipo_solicitacao']} - {payload['titular']}",
                "descricao": payload["descricao"],
                "categoria": "Solicitações LGPD",
                "payload": payload,
                "ativo": True,
                "justificativa": "Solicitação LGPD operacional registrada.",
            },
            actor=actor,
        )
