from __future__ import annotations

import json
import logging
import re
import threading
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status

from ..config import Settings
from ..db import get_connection
from ..passwords import hash_password
from ..rbac import PERMISSION_DEFINITIONS, ROLE_ADMIN, ROLE_DEFINITIONS, ROLE_PERMISSIONS, SETTINGS_CATALOGS
from ..services.helpers import (
    normalize_compare_text,
    normalize_indication_type,
    normalize_text,
    rows_to_dicts,
)
from ..services.process_flow import (
    PROCESS_STATUS_CLOSED,
    PROCESS_STATUS_TRAINING,
    normalize_process_status,
    resolve_effective_process_status,
)
from .exam_analytics_schema import ensure_exam_analytics_tables


logger = logging.getLogger(__name__)
_SCHEMA_BOOTSTRAP_LOCK = threading.Lock()
_SCHEMA_BOOTSTRAPPED = False
_SQL_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
PROCESS_REF_SEPARATOR = "@@"
LOCAL_TIMEZONE = ZoneInfo("America/Sao_Paulo")
RESET_FLAG_KEY = "sistema.dados_resetados"


def ensure_security_tables(cursor, settings: Settings) -> None:
    cursor.execute(
        """
        IF OBJECT_ID('dbo.perfis', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.perfis (
                id_perfil NVARCHAR(40) NOT NULL PRIMARY KEY,
                nome NVARCHAR(80) NOT NULL,
                nivel NVARCHAR(40) NULL,
                descricao NVARCHAR(500) NULL,
                ativo BIT NOT NULL CONSTRAINT DF_perfis_ativo DEFAULT 1,
                sistema BIT NOT NULL CONSTRAINT DF_perfis_sistema DEFAULT 1,
                criado_em DATETIME NOT NULL DEFAULT GETDATE(),
                atualizado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )
    cursor.execute(
        """
        IF OBJECT_ID('dbo.permissoes', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.permissoes (
                chave NVARCHAR(120) NOT NULL PRIMARY KEY,
                modulo NVARCHAR(80) NULL,
                descricao NVARCHAR(500) NULL,
                critica BIT NOT NULL CONSTRAINT DF_permissoes_critica DEFAULT 0,
                criado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )
    cursor.execute(
        """
        IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.perfil_permissoes (
                id_perfil NVARCHAR(40) NOT NULL,
                chave_permissao NVARCHAR(120) NOT NULL,
                permitido BIT NOT NULL CONSTRAINT DF_perfil_permissoes_permitido DEFAULT 1,
                criado_em DATETIME NOT NULL DEFAULT GETDATE(),
                atualizado_em DATETIME NOT NULL DEFAULT GETDATE(),
                CONSTRAINT PK_perfil_permissoes PRIMARY KEY (id_perfil, chave_permissao)
            )
        END
        """
    )
    cursor.execute(
        """
        IF OBJECT_ID('dbo.usuarios', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.usuarios (
                id_usuario INT IDENTITY(1,1) PRIMARY KEY,
                login NVARCHAR(120) NOT NULL,
                nome NVARCHAR(180) NOT NULL,
                email NVARCHAR(180) NOT NULL,
                perfil_id NVARCHAR(40) NOT NULL,
                status NVARCHAR(30) NOT NULL CONSTRAINT DF_usuarios_status DEFAULT 'Ativo',
                senha_hash NVARCHAR(500) NULL,
                microsoft_oid NVARCHAR(64) NULL,
                microsoft_tenant_id NVARCHAR(64) NULL,
                provedor_autenticacao NVARCHAR(30) NULL CONSTRAINT DF_usuarios_provedor_autenticacao DEFAULT 'local',
                ultimo_login_microsoft DATETIME NULL,
                mfa_enabled BIT NOT NULL CONSTRAINT DF_usuarios_mfa_enabled DEFAULT 0,
                mfa_secret_encrypted NVARCHAR(1000) NULL,
                criado_por NVARCHAR(180) NULL,
                atualizado_por NVARCHAR(180) NULL,
                ultimo_acesso_em DATETIME NULL,
                bloqueado_em DATETIME NULL,
                desativado_em DATETIME NULL,
                criado_em DATETIME NOT NULL DEFAULT GETDATE(),
                atualizado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )
    for column_name, sql_type in (
        ("login", "NVARCHAR(120)"),
        ("nome", "NVARCHAR(180)"),
        ("email", "NVARCHAR(180)"),
        ("perfil_id", "NVARCHAR(40)"),
        ("status", "NVARCHAR(30)"),
        ("senha_hash", "NVARCHAR(500)"),
        ("mfa_enabled", "BIT"),
        ("mfa_secret_encrypted", "NVARCHAR(1000)"),
        ("criado_por", "NVARCHAR(180)"),
        ("atualizado_por", "NVARCHAR(180)"),
        ("ultimo_acesso_em", "DATETIME"),
        ("bloqueado_em", "DATETIME"),
        ("desativado_em", "DATETIME"),
        ("criado_em", "DATETIME"),
        ("atualizado_em", "DATETIME"),
        ("avatar_ilustrado", "NVARCHAR(60)"),
        ("sobrenome", "NVARCHAR(180)"),
        ("cargo", "NVARCHAR(180)"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.usuarios', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.usuarios
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    cursor.execute(
        """
        IF OBJECT_ID('dbo.logs_auditoria', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.logs_auditoria (
                id_log INT IDENTITY(1,1) PRIMARY KEY,
                id_usuario INT NULL,
                nome_usuario NVARCHAR(180) NULL,
                email_usuario NVARCHAR(180) NULL,
                perfil_id NVARCHAR(40) NULL,
                perfil_nome NVARCHAR(80) NULL,
                data_hora DATETIME NOT NULL DEFAULT GETDATE(),
                modulo NVARCHAR(80) NULL,
                acao NVARCHAR(120) NULL,
                entidade NVARCHAR(120) NULL,
                entidade_id NVARCHAR(180) NULL,
                valor_anterior NVARCHAR(MAX) NULL,
                valor_novo NVARCHAR(MAX) NULL,
                justificativa NVARCHAR(MAX) NULL,
                origem NVARCHAR(180) NULL,
                sucesso BIT NOT NULL CONSTRAINT DF_logs_auditoria_sucesso DEFAULT 1,
                criado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )
    for column_name, sql_type in (
        ("id_usuario", "INT"),
        ("nome_usuario", "NVARCHAR(180)"),
        ("email_usuario", "NVARCHAR(180)"),
        ("perfil_id", "NVARCHAR(40)"),
        ("perfil_nome", "NVARCHAR(80)"),
        ("data_hora", "DATETIME"),
        ("modulo", "NVARCHAR(80)"),
        ("acao", "NVARCHAR(120)"),
        ("entidade", "NVARCHAR(120)"),
        ("entidade_id", "NVARCHAR(180)"),
        ("valor_anterior", "NVARCHAR(MAX)"),
        ("valor_novo", "NVARCHAR(MAX)"),
        ("justificativa", "NVARCHAR(MAX)"),
        ("origem", "NVARCHAR(180)"),
        ("sucesso", "BIT"),
        ("criado_em", "DATETIME"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.logs_auditoria', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.logs_auditoria
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    for role in ROLE_DEFINITIONS.values():
        cursor.execute(
            """
            IF NOT EXISTS (SELECT 1 FROM perfis WHERE id_perfil = ?)
            BEGIN
                INSERT INTO perfis (id_perfil, nome, nivel, descricao, ativo, sistema, criado_em, atualizado_em)
                VALUES (?, ?, ?, ?, 1, 1, GETDATE(), GETDATE())
            END
            ELSE
            BEGIN
                UPDATE perfis
                SET nome = ?, nivel = ?, descricao = ?, ativo = 1, sistema = 1, atualizado_em = GETDATE()
                WHERE id_perfil = ?
            END
            """,
            (
                role.id,
                role.id,
                role.name,
                role.level,
                role.description,
                role.name,
                role.level,
                role.description,
                role.id,
            ),
        )

    for permission in PERMISSION_DEFINITIONS.values():
        cursor.execute(
            """
            IF NOT EXISTS (SELECT 1 FROM permissoes WHERE chave = ?)
            BEGIN
                INSERT INTO permissoes (chave, modulo, descricao, critica, criado_em)
                VALUES (?, ?, ?, ?, GETDATE())
            END
            ELSE
            BEGIN
                UPDATE permissoes
                SET modulo = ?, descricao = ?, critica = ?
                WHERE chave = ?
            END
            """,
            (
                permission.key,
                permission.key,
                permission.module,
                permission.description,
                1 if permission.critical else 0,
                permission.module,
                permission.description,
                1 if permission.critical else 0,
                permission.key,
            ),
        )

    for role_id, permissions in ROLE_PERMISSIONS.items():
        for permission_key in permissions:
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
                    VALUES (?, ?, 1, GETDATE(), GETDATE())
                END
                """,
                (role_id, permission_key, role_id, permission_key),
            )

    cursor.execute(
        """
        IF NOT EXISTS (
            SELECT 1
            FROM sys.indexes
            WHERE name = 'UX_usuarios_login'
              AND object_id = OBJECT_ID('dbo.usuarios')
        )
        BEGIN
            CREATE UNIQUE INDEX UX_usuarios_login ON dbo.usuarios(login)
        END
        """
    )
    cursor.execute(
        """
        IF NOT EXISTS (
            SELECT 1
            FROM sys.indexes
            WHERE name = 'UX_usuarios_email'
              AND object_id = OBJECT_ID('dbo.usuarios')
        )
        BEGIN
            CREATE UNIQUE INDEX UX_usuarios_email ON dbo.usuarios(email)
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.usuarios', 'microsoft_oid') IS NOT NULL
           AND COL_LENGTH('dbo.usuarios', 'microsoft_tenant_id') IS NOT NULL
           AND NOT EXISTS (
               SELECT 1
               FROM sys.indexes
               WHERE name = 'UX_usuarios_microsoft_identity'
                 AND object_id = OBJECT_ID('dbo.usuarios')
           )
        BEGIN
            CREATE UNIQUE INDEX UX_usuarios_microsoft_identity
            ON dbo.usuarios(microsoft_oid, microsoft_tenant_id)
            WHERE microsoft_oid IS NOT NULL AND microsoft_tenant_id IS NOT NULL
        END
        """
    )

    default_login = settings.auth_user or "rh"
    default_password = settings.auth_password
    if not default_password:
        logger.warning(
            "Usuário administrativo inicial não foi criado: RH_AUTH_PASSWORD não configurada."
        )
        return
    cursor.execute(
        """
        IF NOT EXISTS (
            SELECT 1
            FROM usuarios
            WHERE LOWER(login) = LOWER(?) OR LOWER(email) = LOWER(?)
        )
        BEGIN
            INSERT INTO usuarios
            (
                login,
                nome,
                email,
                perfil_id,
                status,
                senha_hash,
                criado_por,
                atualizado_por,
                criado_em,
                atualizado_em
            )
            VALUES (?, ?, ?, ?, 'Ativo', ?, 'bootstrap', 'bootstrap', GETDATE(), GETDATE())
        END
        """,
        (
            default_login,
            default_login,
            default_login,
            default_login,
            default_login,
            ROLE_ADMIN,
            hash_password(default_password),
        ),
    )


def ensure_reusable_config_tables(cursor) -> None:
    for definition in SETTINGS_CATALOGS.values():
        table = definition["table"]
        cursor.execute(
            f"""
            IF OBJECT_ID('dbo.{table}', 'U') IS NULL
            BEGIN
                CREATE TABLE dbo.{table} (
                    id_item INT IDENTITY(1,1) PRIMARY KEY,
                    chave NVARCHAR(120) NULL,
                    nome NVARCHAR(180) NOT NULL,
                    descricao NVARCHAR(MAX) NULL,
                    categoria NVARCHAR(120) NULL,
                    payload_json NVARCHAR(MAX) NULL,
                    ativo BIT NOT NULL CONSTRAINT DF_{table}_ativo DEFAULT 1,
                    usado BIT NOT NULL CONSTRAINT DF_{table}_usado DEFAULT 0,
                    criado_em DATETIME NOT NULL DEFAULT GETDATE(),
                    atualizado_em DATETIME NOT NULL DEFAULT GETDATE()
                )
            END
            """
        )
        for column_name, sql_type in (
            ("chave", "NVARCHAR(120)"),
            ("nome", "NVARCHAR(180)"),
            ("descricao", "NVARCHAR(MAX)"),
            ("categoria", "NVARCHAR(120)"),
            ("payload_json", "NVARCHAR(MAX)"),
            ("ativo", "BIT"),
            ("usado", "BIT"),
            ("criado_em", "DATETIME"),
            ("atualizado_em", "DATETIME"),
        ):
            cursor.execute(
                f"""
                IF COL_LENGTH('dbo.{table}', '{column_name}') IS NULL
                BEGIN
                    ALTER TABLE dbo.{table}
                    ADD {column_name} {sql_type} NULL
                END
                """
            )
        cursor.execute(
            f"""
            UPDATE dbo.{table}
            SET ativo = 1
            WHERE ativo IS NULL
            """
        )
        cursor.execute(
            f"""
            UPDATE dbo.{table}
            SET usado = 0
            WHERE usado IS NULL
            """
        )


def ensure_parametros_sistema_table(cursor) -> None:
    """Correcoes.txt (rodada de 06/set/2026): configuracoes de negocio (ex.:
    integracao SharePoint/intranets) editaveis pelo Administrador em vez de
    hardcoded no codigo. Segredos de infraestrutura (.env) nunca ficam aqui.

    Também guarda, sob categoria 'sistema_interno', a flag que "Limpar o
    Conecta" grava para impedir que os seeds padrão (operações, trilha de
    onboarding, DISC, valores da empresa, raciocínio lógico) voltem sozinhos
    no próximo restart — ver `conecta_reset_flag_ativo`.
    """
    cursor.execute(
        """
        IF OBJECT_ID('dbo.parametros_sistema', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.parametros_sistema (
                id_parametro INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                chave NVARCHAR(120) NOT NULL,
                valor NVARCHAR(MAX) NULL,
                categoria NVARCHAR(60) NOT NULL CONSTRAINT DF_parametros_sistema_categoria DEFAULT 'geral',
                descricao NVARCHAR(400) NULL,
                mascarado BIT NOT NULL CONSTRAINT DF_parametros_sistema_mascarado DEFAULT 0,
                atualizado_por NVARCHAR(180) NULL,
                criado_em DATETIME NOT NULL DEFAULT GETDATE(),
                atualizado_em DATETIME NOT NULL DEFAULT GETDATE(),
                CONSTRAINT UQ_parametros_sistema_chave UNIQUE (chave)
            )
        END
        """
    )


def ensure_ambientes_sharepoint_table(cursor) -> None:
    """Correcoes.txt (08/set/2026): cada "ambiente" liga uma intranet
    (site SharePoint) de uma operação ao Conecta, para uso restrito ao Mural
    (publicações simultâneas). Substitui o uso do "Novo parâmetro" genérico
    para SharePoint por uma entidade própria — a conexão exige mais campos
    (operação, URL do site, biblioteca de destino) do que uma chave/valor
    solta permitiria. As credenciais do app Microsoft (tenant/client/secret)
    continuam únicas e compartilhadas, vindas do .env (ver Settings.sharepoint_*).
    """
    cursor.execute(
        """
        IF OBJECT_ID('dbo.ambientes_sharepoint', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.ambientes_sharepoint (
                id_ambiente INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                nome NVARCHAR(180) NOT NULL,
                operacao_id INT NULL,
                site_url NVARCHAR(500) NOT NULL,
                hostname NVARCHAR(255) NULL,
                site_path NVARCHAR(255) NULL,
                site_id NVARCHAR(255) NULL,
                biblioteca_destino NVARCHAR(255) NULL,
                status NVARCHAR(30) NOT NULL CONSTRAINT DF_ambientes_sharepoint_status DEFAULT 'pendente',
                ultima_mensagem_teste NVARCHAR(500) NULL,
                testado_em DATETIME NULL,
                ativo BIT NOT NULL CONSTRAINT DF_ambientes_sharepoint_ativo DEFAULT 1,
                criado_por NVARCHAR(180) NULL,
                atualizado_por NVARCHAR(180) NULL,
                criado_em DATETIME NOT NULL CONSTRAINT DF_ambientes_sharepoint_criado_em DEFAULT GETDATE(),
                atualizado_em DATETIME NOT NULL CONSTRAINT DF_ambientes_sharepoint_atualizado_em DEFAULT GETDATE()
            )
        END
        """
    )


def conecta_reset_flag_ativo(cursor) -> bool:
    """True quando "Limpar o Conecta" já zerou os dados operacionais — os
    seeds padrão (ensure_operacoes_seed, trilha de onboarding, DISC, valores
    da empresa, raciocínio lógico) checam isso antes de se recriar sozinhos."""
    cursor.execute(
        """
        SELECT CASE
            WHEN OBJECT_ID('dbo.parametros_sistema', 'U') IS NULL THEN 0
            WHEN EXISTS (
                SELECT 1 FROM dbo.parametros_sistema WHERE chave = ?
            ) THEN 1
            ELSE 0
        END
        """,
        (RESET_FLAG_KEY,),
    )
    row = cursor.fetchone()
    return bool(row and int(row[0] or 0) == 1)


def ensure_operacoes_seed(cursor) -> None:
    """Semeia as operações hoje hardcoded em OPERATION_OPTIONS (perguntas.js).

    Mantém sincronizado com infra/sql/migrations/V013__operacoes.sql — este
    bootstrap cobre DEV/HML (autobootstrap), a migration versionada cobre PROD.
    """
    if conecta_reset_flag_ativo(cursor):
        return
    operacoes_iniciais = (
        ("CRF", "CRF / Flamengo", "Receptivo"),
        ("DAVITA", "Davita", "Receptivo"),
        ("ENDOVIEW", "Endoview", "Receptivo"),
        ("NEWE", "Newe Seguros", "Receptivo"),
        ("C24H", "Central24Horas", "Administrativo"),
        ("BRAVA", "Brava", "Receptivo"),
    )
    for chave, nome, categoria in operacoes_iniciais:
        cursor.execute(
            "SELECT 1 FROM dbo.operacoes WHERE nome = ?",
            (nome,),
        )
        if cursor.fetchone():
            continue
        cursor.execute(
            """
            INSERT INTO dbo.operacoes (chave, nome, descricao, categoria, payload_json, ativo, usado)
            VALUES (?, ?, NULL, ?, N'{}', 1, 1)
            """,
            (chave, nome, categoria),
        )


def ensure_user_operacoes_table(cursor) -> None:
    """Escopo de operação por usuário (achado SEC-002 do programa de evolução:
    RBAC hoje só valida permissão de módulo, não escopo de recurso).

    Tabela vazia por padrão para todo usuário existente = sem restrição (mesmo
    comportamento de hoje, aditivo e sem regressão). Só passa a restringir o
    acesso de um usuário quando alguém explicitamente inserir linhas aqui.
    Sem FK para dbo.operacoes.chave porque a coluna não tem constraint
    UNIQUE (tabela de catálogo genérico via SETTINGS_CATALOGS) — mesmo
    padrão sem FK já usado em todo o restante do schema criado por este
    bootstrap (achado DB-004, pendente de tratamento incremental à parte).
    """
    cursor.execute(
        """
        IF OBJECT_ID('dbo.usuarios_operacoes', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.usuarios_operacoes (
                id_usuario INT NOT NULL,
                operacao NVARCHAR(60) NOT NULL,
                criado_em DATETIME NOT NULL DEFAULT GETDATE(),
                CONSTRAINT PK_usuarios_operacoes PRIMARY KEY (id_usuario, operacao)
            )
        END
        """
    )


def ensure_email_change_requests_table(cursor) -> None:
    """Correcoes.txt (rodada de 02/set/2026): aba Perfil permite pedir troca
    do proprio e-mail, mas a troca so e aplicada apos aprovacao de um
    administrador (permissao "usuarios.alterar_email", ja existente).
    """
    cursor.execute(
        """
        IF OBJECT_ID('dbo.solicitacoes_alteracao_email', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.solicitacoes_alteracao_email (
                id INT IDENTITY(1,1) PRIMARY KEY,
                id_usuario INT NOT NULL,
                email_atual NVARCHAR(180) NULL,
                email_novo NVARCHAR(180) NOT NULL,
                status NVARCHAR(20) NOT NULL DEFAULT 'pendente',
                solicitado_em DATETIME NOT NULL DEFAULT GETDATE(),
                decidido_em DATETIME NULL,
                decidido_por NVARCHAR(180) NULL,
                motivo_rejeicao NVARCHAR(500) NULL
            )
        END
        """
    )
    cursor.execute(
        """
        IF NOT EXISTS (
            SELECT 1 FROM sys.indexes WHERE name = 'IX_solicitacoes_email_usuario'
        )
        CREATE INDEX IX_solicitacoes_email_usuario ON dbo.solicitacoes_alteracao_email(id_usuario)
        """
    )
    cursor.execute(
        """
        IF NOT EXISTS (
            SELECT 1 FROM sys.indexes WHERE name = 'IX_solicitacoes_email_status'
        )
        CREATE INDEX IX_solicitacoes_email_status ON dbo.solicitacoes_alteracao_email(status)
        """
    )


def ensure_cv_pre_analises_table(cursor) -> None:
    cursor.execute(
        """
        IF OBJECT_ID('dbo.cv_pre_analises', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.cv_pre_analises (
                id_pre_analise INT IDENTITY(1,1) PRIMARY KEY,
                id_processo NVARCHAR(60) NULL,
                id_processo_ref NVARCHAR(255) NULL,
                nome_candidato NVARCHAR(255) NULL,
                email NVARCHAR(255) NULL,
                telefone NVARCHAR(50) NULL,
                whatsapp NVARCHAR(50) NULL,
                palavras_chave NVARCHAR(MAX) NULL,
                score_final DECIMAL(5,2) NULL,
                classificacao NVARCHAR(80) NULL,
                classificacao_slug NVARCHAR(80) NULL,
                problemas NVARCHAR(MAX) NULL,
                texto_extraido NVARCHAR(MAX) NULL,
                nome_arquivo NVARCHAR(255) NULL,
                mime_type NVARCHAR(120) NULL,
                arquivo_original_base64 NVARCHAR(MAX) NULL,
                ja_adicionado_ao_processo BIT NULL,
                oculto_na_lista BIT NULL,
                origem NVARCHAR(120) NULL,
                email_uid NVARCHAR(120) NULL,
                email_message_id NVARCHAR(255) NULL,
                email_attachment_name NVARCHAR(255) NULL,
                email_remetente NVARCHAR(255) NULL,
                email_assunto NVARCHAR(500) NULL,
                email_data DATETIME NULL,
                criado_em DATETIME NULL
            )
        END
        """
    )

    for column_name, sql_type in (
        ("id_pre_analise", "INT"),
        ("id_processo", "NVARCHAR(60)"),
        ("id_processo_ref", "NVARCHAR(255)"),
        ("nome_candidato", "NVARCHAR(255)"),
        ("email", "NVARCHAR(255)"),
        ("telefone", "NVARCHAR(50)"),
        ("whatsapp", "NVARCHAR(50)"),
        ("palavras_chave", "NVARCHAR(MAX)"),
        ("score_final", "DECIMAL(5,2)"),
        ("classificacao", "NVARCHAR(80)"),
        ("classificacao_slug", "NVARCHAR(80)"),
        ("problemas", "NVARCHAR(MAX)"),
        ("texto_extraido", "NVARCHAR(MAX)"),
        ("nome_arquivo", "NVARCHAR(255)"),
        ("mime_type", "NVARCHAR(120)"),
        ("arquivo_original_base64", "NVARCHAR(MAX)"),
        ("ja_adicionado_ao_processo", "BIT"),
        ("oculto_na_lista", "BIT"),
        ("origem", "NVARCHAR(120)"),
        ("email_uid", "NVARCHAR(120)"),
        ("email_message_id", "NVARCHAR(255)"),
        ("email_attachment_name", "NVARCHAR(255)"),
        ("email_remetente", "NVARCHAR(255)"),
        ("email_assunto", "NVARCHAR(500)"),
        ("email_data", "DATETIME"),
        ("criado_em", "DATETIME"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.cv_pre_analises', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.cv_pre_analises
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    cursor.execute(
        """
        UPDATE dbo.cv_pre_analises
        SET ja_adicionado_ao_processo = 0
        WHERE ja_adicionado_ao_processo IS NULL
        """
    )

    cursor.execute(
        """
        UPDATE dbo.cv_pre_analises
        SET oculto_na_lista = 0
        WHERE oculto_na_lista IS NULL
        """
    )

    cursor.execute(
        """
        UPDATE dbo.cv_pre_analises
        SET origem = 'Analise direta do CV'
        WHERE origem IS NULL OR LTRIM(RTRIM(origem)) = ''
        """
    )

    cursor.execute(
        """
        UPDATE dbo.cv_pre_analises
        SET criado_em = GETDATE()
        WHERE criado_em IS NULL
        """
    )


def ensure_pipeline_columns(cursor) -> None:
    cursor.execute(
        """
        IF COL_LENGTH('dbo.candidatos_processos', 'etapa_pipeline') IS NULL
        BEGIN
            ALTER TABLE dbo.candidatos_processos
            ADD etapa_pipeline NVARCHAR(30) NULL
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.candidatos_processos', 'data_atualizacao_pipeline') IS NULL
        BEGIN
            ALTER TABLE dbo.candidatos_processos
            ADD data_atualizacao_pipeline DATETIME NULL
        END
        """
    )
    ensure_candidate_approval_columns(cursor)


def ensure_candidate_approval_columns(cursor) -> None:
    for column_name, sql_type in (
        ("mensagem_aprovacao", "NVARCHAR(MAX)"),
        ("data_comparecimento_aprovacao", "NVARCHAR(40)"),
        ("documentos_aprovacao_json", "NVARCHAR(MAX)"),
        ("anexo_aprovacao_nome", "NVARCHAR(255)"),
        ("anexo_aprovacao_tipo", "NVARCHAR(120)"),
        ("anexo_aprovacao_tamanho", "BIGINT"),
        ("anexo_aprovacao_base64", "NVARCHAR(MAX)"),
        ("aprovado_em", "DATETIME"),
        ("eliminado_em", "DATETIME"),
        ("motivo_eliminacao", "NVARCHAR(120)"),
        ("etapa_eliminacao", "NVARCHAR(120)"),
        ("sub_causa_eliminacao", "NVARCHAR(180)"),
        ("banco_talentos_em", "DATETIME"),
        ("mensagem_aprovacao_enviada_whatsapp_em", "DATETIME"),
        ("mensagem_aprovacao_enviada_email_em", "DATETIME"),
        ("eh_indicacao", "BIT"),
        ("tipo_indicacao", "NVARCHAR(80)"),
        ("indicacao_em", "DATETIME"),
        ("indicado_por", "NVARCHAR(255)"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.candidatos_processos', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.candidatos_processos
                ADD {column_name} {sql_type} NULL
            END
            """
        )


def ensure_candidate_training_link_column(cursor) -> None:
    """Promt.txt (rodada do app mobile "Conecta App"): o colaborador loga no
    app com e-mail (dbo.usuarios.email), mas o registro de treinamento fica em
    candidatos_processos/candidatos_metadata (mundo do processo seletivo) —
    tabelas sem nenhum vínculo hoje. O vínculo padrão é automático (mesmo
    e-mail); esta coluna é só a exceção manual, para o RH corrigir quando o
    e-mail de login não bate com o e-mail usado no processo seletivo.
    """
    cursor.execute(
        """
        IF COL_LENGTH('dbo.candidatos_processos', 'email_login_vinculado') IS NULL
        BEGIN
            ALTER TABLE dbo.candidatos_processos
            ADD email_login_vinculado NVARCHAR(180) NULL
        END
        """
    )


def ensure_process_columns(cursor) -> None:
    cursor.execute(
        """
        IF COL_LENGTH('dbo.processos_seletivos', 'link_agendamento') IS NULL
        BEGIN
            ALTER TABLE dbo.processos_seletivos
            ADD link_agendamento NVARCHAR(MAX) NULL
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.processos_seletivos', 'link_publico_slug') IS NULL
        BEGIN
            ALTER TABLE dbo.processos_seletivos
            ADD link_publico_slug NVARCHAR(255) NULL
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.processos_seletivos', 'link_publico_token') IS NULL
        BEGIN
            ALTER TABLE dbo.processos_seletivos
            ADD link_publico_token NVARCHAR(120) NULL
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.processos_seletivos', 'link_publico_ativo') IS NULL
        BEGIN
            ALTER TABLE dbo.processos_seletivos
            ADD link_publico_ativo BIT NOT NULL CONSTRAINT DF_processos_link_publico_ativo DEFAULT 0
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.processos_seletivos', 'link_publico_criado_em') IS NULL
        BEGIN
            ALTER TABLE dbo.processos_seletivos
            ADD link_publico_criado_em DATETIME NULL
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.processos_seletivos', 'link_publico_desativado_em') IS NULL
        BEGIN
            ALTER TABLE dbo.processos_seletivos
            ADD link_publico_desativado_em DATETIME NULL
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.processos_seletivos', 'descricao_publica') IS NULL
        BEGIN
            ALTER TABLE dbo.processos_seletivos
            ADD descricao_publica NVARCHAR(MAX) NULL
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.processos_seletivos', 'requisitos_publicos') IS NULL
        BEGIN
            ALTER TABLE dbo.processos_seletivos
            ADD requisitos_publicos NVARCHAR(MAX) NULL
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.processos_seletivos', 'responsabilidades_publicas') IS NULL
        BEGIN
            ALTER TABLE dbo.processos_seletivos
            ADD responsabilidades_publicas NVARCHAR(MAX) NULL
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.processos_seletivos', 'observacoes_publicas_vaga') IS NULL
        BEGIN
            ALTER TABLE dbo.processos_seletivos
            ADD observacoes_publicas_vaga NVARCHAR(MAX) NULL
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.processos_seletivos', 'configuracao_prova_json') IS NULL
        BEGIN
            ALTER TABLE dbo.processos_seletivos
            ADD configuracao_prova_json NVARCHAR(MAX) NULL
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.processos_seletivos', 'prova_configurada_em') IS NULL
        BEGIN
            ALTER TABLE dbo.processos_seletivos
            ADD prova_configurada_em DATETIME NULL
        END
        """
    )
    for column_name, sql_type in (
        ("status_anterior", "NVARCHAR(80)"),
        ("status_operacional_anterior", "NVARCHAR(80)"),
        ("justificativa_status", "NVARCHAR(MAX)"),
        ("status_alterado_por", "NVARCHAR(180)"),
        ("status_alterado_em", "DATETIME"),
        ("ultima_movimentacao_relevante_em", "DATETIME"),
        ("ultimo_alerta_inatividade_em", "DATETIME"),
        ("tempo_pausa", "NVARCHAR(80)"),
        ("pausa_inicio_em", "DATETIME"),
        ("pausa_previsao_termino", "DATETIME"),
        ("pausa_retomada_em", "DATETIME"),
        ("urgente_marcado_em", "DATETIME"),
        ("urgente_marcado_por", "NVARCHAR(180)"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.processos_seletivos', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.processos_seletivos
                ADD {column_name} {sql_type} NULL
            END
            """
        )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.processos_seletivos', 'urgente') IS NULL
        BEGIN
            ALTER TABLE dbo.processos_seletivos
            ADD urgente BIT NOT NULL CONSTRAINT DF_processos_urgente DEFAULT 0
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.processos_seletivos', 'ia_analise_desabilitada') IS NULL
        BEGIN
            ALTER TABLE dbo.processos_seletivos
            ADD ia_analise_desabilitada BIT NOT NULL CONSTRAINT DF_processos_ia_analise_desabilitada DEFAULT 0
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.processos_seletivos', 'detalhes_vaga_json') IS NULL
        BEGIN
            ALTER TABLE dbo.processos_seletivos
            ADD detalhes_vaga_json NVARCHAR(MAX) NULL
        END
        """
    )


def ensure_candidate_metadata_table(cursor) -> None:
    cursor.execute(
        """
        IF OBJECT_ID('dbo.candidatos_metadata', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.candidatos_metadata (
                id_teste NVARCHAR(120) NOT NULL PRIMARY KEY,
                nome_candidato NVARCHAR(255) NULL,
                habilidades_json NVARCHAR(MAX) NULL,
                tags_json NVARCHAR(MAX) NULL,
                observacao_rh NVARCHAR(MAX) NULL,
                classificacao_indicacao NVARCHAR(80) NULL,
                justificativa_indicacao NVARCHAR(MAX) NULL,
                email NVARCHAR(255) NULL,
                telefone NVARCHAR(50) NULL,
                whatsapp NVARCHAR(50) NULL,
                cep NVARCHAR(12) NULL,
                endereco NVARCHAR(255) NULL,
                numero NVARCHAR(30) NULL,
                cidade NVARCHAR(120) NULL,
                bairro NVARCHAR(120) NULL,
                idade INT NULL,
                escolaridade NVARCHAR(160) NULL,
                possui_experiencia NVARCHAR(20) NULL,
                musica NVARCHAR(255) NULL,
                prato NVARCHAR(255) NULL,
                futebol NVARCHAR(255) NULL,
                time NVARCHAR(255) NULL,
                rede_social NVARCHAR(500) NULL,
                criado_em DATETIME NOT NULL DEFAULT GETDATE(),
                atualizado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )

def ensure_candidate_metadata_columns(cursor) -> None:
    for column_name, sql_type in (
        ("id_teste", "NVARCHAR(120)"),
        ("nome_candidato", "NVARCHAR(255)"),
        ("habilidades_json", "NVARCHAR(MAX)"),
        ("tags_json", "NVARCHAR(MAX)"),
        ("observacao_rh", "NVARCHAR(MAX)"),
        ("classificacao_indicacao", "NVARCHAR(80)"),
        ("justificativa_indicacao", "NVARCHAR(MAX)"),
        ("email", "NVARCHAR(255)"),
        ("telefone", "NVARCHAR(50)"),
        ("whatsapp", "NVARCHAR(50)"),
        ("cep", "NVARCHAR(12)"),
        ("endereco", "NVARCHAR(255)"),
        ("numero", "NVARCHAR(30)"),
        ("cidade", "NVARCHAR(120)"),
        ("bairro", "NVARCHAR(120)"),
        ("idade", "INT"),
        ("data_nascimento", "DATE"),
        ("escolaridade", "NVARCHAR(160)"),
        ("possui_experiencia", "NVARCHAR(20)"),
        ("musica", "NVARCHAR(255)"),
        ("prato", "NVARCHAR(255)"),
        ("futebol", "NVARCHAR(255)"),
        ("time", "NVARCHAR(255)"),
        ("rede_social", "NVARCHAR(500)"),
        # Achado SEC-003 do programa de evolução: consentimento LGPD era
        # validado no fluxo público mas nunca persistido. Colunas nulas por
        # padrão (candidato cadastrado antes desta correção, ou sem passar
        # pelo fluxo público, simplesmente não tem consentimento registrado
        # ainda — não é retroativo).
        ("lgpd_consentimento_aceito_em", "DATETIME"),
        ("lgpd_consentimento_versao", "NVARCHAR(40)"),
        ("lgpd_consentimento_ip", "NVARCHAR(64)"),
        ("lgpd_anonimizado_em", "DATETIME"),
        ("criado_em", "DATETIME"),
        ("atualizado_em", "DATETIME"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.candidatos_metadata', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.candidatos_metadata
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    cursor.execute(
        """
        UPDATE dbo.candidatos_metadata
        SET criado_em = GETDATE()
        WHERE criado_em IS NULL
        """
    )

    cursor.execute(
        """
        UPDATE dbo.candidatos_metadata
        SET atualizado_em = GETDATE()
        WHERE atualizado_em IS NULL
        """
    )

def ensure_candidate_attachments_table(cursor) -> None:
    cursor.execute(
        """
        IF OBJECT_ID('dbo.candidatos_anexos', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.candidatos_anexos (
                id_anexo INT IDENTITY(1,1) PRIMARY KEY,
                id_teste NVARCHAR(120) NULL,
                id_processo NVARCHAR(60) NULL,
                id_processo_ref NVARCHAR(255) NULL,
                nome_arquivo_original NVARCHAR(255) NULL,
                nome_arquivo_armazenado NVARCHAR(255) NULL,
                tipo_arquivo NVARCHAR(120) NULL,
                caminho_arquivo NVARCHAR(500) NULL,
                tamanho_bytes BIGINT NULL,
                criado_em DATETIME NULL,
                atualizado_em DATETIME NULL
            )
        END
        """
    )

    for column_name, sql_type in (
        ("id_teste", "NVARCHAR(120)"),
        ("id_processo", "NVARCHAR(60)"),
        ("id_processo_ref", "NVARCHAR(255)"),
        ("nome_arquivo_original", "NVARCHAR(255)"),
        ("nome_arquivo_armazenado", "NVARCHAR(255)"),
        ("tipo_arquivo", "NVARCHAR(120)"),
        ("caminho_arquivo", "NVARCHAR(500)"),
        ("tamanho_bytes", "BIGINT"),
        ("criado_em", "DATETIME"),
        ("atualizado_em", "DATETIME"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.candidatos_anexos', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.candidatos_anexos
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    cursor.execute(
        """
        UPDATE dbo.candidatos_anexos
        SET criado_em = GETDATE()
        WHERE criado_em IS NULL
        """
    )

    cursor.execute(
        """
        UPDATE dbo.candidatos_anexos
        SET atualizado_em = GETDATE()
        WHERE atualizado_em IS NULL
        """
    )


def ensure_curriculo_ia_table(cursor) -> None:
    cursor.execute(
        """
        IF OBJECT_ID('dbo.analises_curriculo_ia', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.analises_curriculo_ia (
                id_analise INT IDENTITY(1,1) PRIMARY KEY,
                id_candidato NVARCHAR(120) NOT NULL,
                id_processo NVARCHAR(60) NULL,
                provedor_ia NVARCHAR(50) NULL,
                modelo_ia NVARCHAR(100) NULL,
                versao_prompt NVARCHAR(50) NULL,
                nota_aderencia DECIMAL(5,2) NULL,
                parecer NVARCHAR(50) NULL,
                resumo NVARCHAR(MAX) NULL,
                pontos_fortes NVARCHAR(MAX) NULL,
                pontos_atencao NVARCHAR(MAX) NULL,
                riscos NVARCHAR(MAX) NULL,
                justificativa NVARCHAR(MAX) NULL,
                perguntas_sugeridas_entrevista NVARCHAR(MAX) NULL,
                json_resultado NVARCHAR(MAX) NULL,
                status_analise NVARCHAR(30) NOT NULL
                    CONSTRAINT DF_analises_curriculo_ia_status DEFAULT 'CONCLUIDA',
                erro_analise NVARCHAR(MAX) NULL,
                tokens_entrada INT NULL,
                tokens_saida INT NULL,
                custo_estimado DECIMAL(10,4) NULL,
                revisado_por_humano BIT NOT NULL
                    CONSTRAINT DF_analises_curriculo_ia_revisada DEFAULT 0,
                id_usuario_revisao INT NULL,
                criado_em DATETIME NOT NULL
                    CONSTRAINT DF_analises_curriculo_ia_criado DEFAULT GETDATE(),
                revisado_em DATETIME NULL
            )
        END

        IF NOT EXISTS (
            SELECT 1
            FROM sys.indexes
            WHERE name = 'IX_analises_curriculo_ia_candidato'
              AND object_id = OBJECT_ID('dbo.analises_curriculo_ia')
        )
            CREATE INDEX IX_analises_curriculo_ia_candidato
                ON dbo.analises_curriculo_ia (id_candidato)

        IF NOT EXISTS (
            SELECT 1
            FROM sys.indexes
            WHERE name = 'IX_analises_curriculo_ia_processo'
              AND object_id = OBJECT_ID('dbo.analises_curriculo_ia')
        )
            CREATE INDEX IX_analises_curriculo_ia_processo
                ON dbo.analises_curriculo_ia (id_processo)

        IF NOT EXISTS (
            SELECT 1
            FROM sys.indexes
            WHERE name = 'IX_analises_curriculo_ia_criado_em'
              AND object_id = OBJECT_ID('dbo.analises_curriculo_ia')
        )
            CREATE INDEX IX_analises_curriculo_ia_criado_em
                ON dbo.analises_curriculo_ia (criado_em DESC)
        """
    )


def ensure_process_inactivity_alerts_table(cursor) -> None:
    cursor.execute(
        """
        IF OBJECT_ID('dbo.processos_alertas_inatividade', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.processos_alertas_inatividade (
                id_alerta INT IDENTITY(1,1) PRIMARY KEY,
                id_processo NVARCHAR(120) NOT NULL,
                id_processo_ref NVARCHAR(255) NULL,
                tipo NVARCHAR(80) NOT NULL,
                titulo NVARCHAR(180) NOT NULL,
                mensagem NVARCHAR(MAX) NOT NULL,
                destinatarios NVARCHAR(MAX) NULL,
                status_envio NVARCHAR(80) NULL,
                dias_sem_movimentacao INT NOT NULL,
                data_abertura DATETIME NULL,
                data_ultima_movimentacao DATETIME NULL,
                criado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )


def ensure_talent_bank_table(cursor) -> None:
    cursor.execute(
        """
        IF OBJECT_ID('dbo.banco_talentos', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.banco_talentos (
                id_banco INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                id_processo NVARCHAR(60) NULL,
                id_processo_ref NVARCHAR(255) NULL,
                id_teste NVARCHAR(120) NULL,
                nome_candidato NVARCHAR(255) NULL,
                vaga NVARCHAR(255) NULL,
                pontuacao_final NVARCHAR(60) NULL,
                data_movimentacao DATETIME NULL,
                origem NVARCHAR(120) NULL,
                eh_indicacao BIT NULL,
                tipo_indicacao NVARCHAR(80) NULL,
                indicacao_em DATETIME NULL
            )
        END
        """
    )

    cursor.execute(
        """
        IF COL_LENGTH('dbo.banco_talentos', 'id_banco') IS NULL
        BEGIN
            ALTER TABLE dbo.banco_talentos
            ADD id_banco INT IDENTITY(1,1) NOT NULL
        END
        """
    )

    for column_name, sql_type in (
        ("id_processo", "NVARCHAR(60)"),
        ("id_processo_ref", "NVARCHAR(255)"),
        ("id_teste", "NVARCHAR(120)"),
        ("nome_candidato", "NVARCHAR(255)"),
        ("vaga", "NVARCHAR(255)"),
        ("pontuacao_final", "NVARCHAR(60)"),
        ("data_movimentacao", "DATETIME"),
        ("origem", "NVARCHAR(120)"),
        ("eh_indicacao", "BIT"),
        ("tipo_indicacao", "NVARCHAR(80)"),
        ("indicacao_em", "DATETIME"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.banco_talentos', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.banco_talentos
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    cursor.execute(
        """
        UPDATE dbo.banco_talentos
        SET eh_indicacao = 0
        WHERE eh_indicacao IS NULL
        """
    )

    cursor.execute(
        """
        SELECT COLUMNPROPERTY(
            OBJECT_ID('dbo.banco_talentos'),
            'id_banco',
            'IsIdentity'
        )
        """
    )
    identity_row = cursor.fetchone()
    id_banco_is_identity = bool(identity_row and int(identity_row[0] or 0) == 1)

    if not id_banco_is_identity:
        cursor.execute(
            """
            DECLARE @max_id_banco INT;
            SELECT @max_id_banco = ISNULL(MAX(id_banco), 0)
            FROM dbo.banco_talentos
            WHERE id_banco IS NOT NULL;

            ;WITH pendentes AS (
                SELECT
                    id_banco,
                    ROW_NUMBER() OVER (
                        ORDER BY
                            ISNULL(data_movimentacao, CONVERT(DATETIME, '19000101', 112)),
                            ISNULL(id_teste, ''),
                            ISNULL(nome_candidato, '')
                    ) AS ordem
                FROM dbo.banco_talentos
                WHERE id_banco IS NULL
            )
            UPDATE pendentes
            SET id_banco = @max_id_banco + ordem;

            IF NOT EXISTS (
                SELECT 1
                FROM dbo.banco_talentos
                WHERE id_banco IS NULL
            )
            AND NOT EXISTS (
                SELECT id_banco
                FROM dbo.banco_talentos
                GROUP BY id_banco
                HAVING COUNT(*) > 1
            )
            BEGIN
                ALTER TABLE dbo.banco_talentos
                ALTER COLUMN id_banco INT NOT NULL
            END
            """
        )

    cursor.execute(
        """
        IF NOT EXISTS (
            SELECT 1
            FROM sys.key_constraints
            WHERE parent_object_id = OBJECT_ID('dbo.banco_talentos')
              AND type = 'PK'
        )
        AND NOT EXISTS (
            SELECT 1
            FROM dbo.banco_talentos
            WHERE id_banco IS NULL
        )
        AND NOT EXISTS (
            SELECT id_banco
            FROM dbo.banco_talentos
            GROUP BY id_banco
            HAVING COUNT(*) > 1
        )
        BEGIN
            ALTER TABLE dbo.banco_talentos
            ADD CONSTRAINT PK_banco_talentos_id_banco PRIMARY KEY (id_banco)
        END
        """
    )


def ensure_email_inbox_items_table(cursor) -> None:
    cursor.execute(
        """
        IF OBJECT_ID('dbo.email_inbox_items', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.email_inbox_items (
                id NVARCHAR(120) NOT NULL PRIMARY KEY,
                message_uid NVARCHAR(120) NULL,
                message_id NVARCHAR(500) NULL,
                remetente NVARCHAR(500) NULL,
                remetente_nome NVARCHAR(255) NULL,
                assunto NVARCHAR(500) NULL,
                data_recebimento DATETIME NULL,
                resumo NVARCHAR(MAX) NULL,
                corpo_texto NVARCHAR(MAX) NULL,
                nome_detectado NVARCHAR(255) NULL,
                telefone_detectado NVARCHAR(50) NULL,
                email_detectado NVARCHAR(255) NULL,
                vaga_detectada NVARCHAR(255) NULL,
                experiencia_detectada NVARCHAR(20) NULL,
                trabalhe_conosco BIT NULL,
                campos_formulario_json NVARCHAR(MAX) NULL,
                curriculo_anexado_informado NVARCHAR(20) NULL,
                inconsistencias_json NVARCHAR(MAX) NULL,
                status NVARCHAR(80) NULL,
                origem NVARCHAR(120) NULL,
                caminho_anexo NVARCHAR(500) NULL,
                nome_anexo NVARCHAR(255) NULL,
                content_type NVARCHAR(120) NULL,
                tamanho_anexo BIGINT NULL,
                attachments_json NVARCHAR(MAX) NULL,
                metadata_path NVARCHAR(500) NULL,
                processo_id NVARCHAR(255) NULL,
                candidato_id NVARCHAR(120) NULL,
                id_pre_analise INT NULL,
                id_registro INT NULL,
                id_banco INT NULL,
                criado_em DATETIME NULL,
                atualizado_em DATETIME NULL,
                ignorado BIT NULL,
                lido BIT NULL
            )
        END
        """
    )

    for column_name, sql_type in (
        ("id", "NVARCHAR(120)"),
        ("message_uid", "NVARCHAR(120)"),
        ("message_id", "NVARCHAR(500)"),
        ("remetente", "NVARCHAR(500)"),
        ("remetente_nome", "NVARCHAR(255)"),
        ("assunto", "NVARCHAR(500)"),
        ("data_recebimento", "DATETIME"),
        ("resumo", "NVARCHAR(MAX)"),
        ("corpo_texto", "NVARCHAR(MAX)"),
        ("nome_detectado", "NVARCHAR(255)"),
        ("telefone_detectado", "NVARCHAR(50)"),
        ("email_detectado", "NVARCHAR(255)"),
        ("vaga_detectada", "NVARCHAR(255)"),
        ("experiencia_detectada", "NVARCHAR(20)"),
        ("trabalhe_conosco", "BIT"),
        ("campos_formulario_json", "NVARCHAR(MAX)"),
        ("curriculo_anexado_informado", "NVARCHAR(20)"),
        ("inconsistencias_json", "NVARCHAR(MAX)"),
        ("status", "NVARCHAR(80)"),
        ("origem", "NVARCHAR(120)"),
        ("caminho_anexo", "NVARCHAR(500)"),
        ("nome_anexo", "NVARCHAR(255)"),
        ("content_type", "NVARCHAR(120)"),
        ("tamanho_anexo", "BIGINT"),
        ("attachments_json", "NVARCHAR(MAX)"),
        ("metadata_path", "NVARCHAR(500)"),
        ("processo_id", "NVARCHAR(255)"),
        ("candidato_id", "NVARCHAR(120)"),
        ("id_pre_analise", "INT"),
        ("id_registro", "INT"),
        ("id_banco", "INT"),
        ("criado_em", "DATETIME"),
        ("atualizado_em", "DATETIME"),
        ("ignorado", "BIT"),
        ("lido", "BIT"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.email_inbox_items', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.email_inbox_items
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    cursor.execute(
        """
        UPDATE dbo.email_inbox_items
        SET status = 'Recebido'
        WHERE status IS NULL OR LTRIM(RTRIM(status)) = ''
        """
    )
    cursor.execute(
        """
        UPDATE dbo.email_inbox_items
        SET origem = 'Recebimento de e-mail'
        WHERE origem IS NULL OR LTRIM(RTRIM(origem)) = ''
        """
    )
    cursor.execute(
        """
        UPDATE dbo.email_inbox_items
        SET criado_em = GETDATE()
        WHERE criado_em IS NULL
        """
    )
    cursor.execute(
        """
        UPDATE dbo.email_inbox_items
        SET atualizado_em = GETDATE()
        WHERE atualizado_em IS NULL
        """
    )
    cursor.execute(
        """
        UPDATE dbo.email_inbox_items
        SET ignorado = 0
        WHERE ignorado IS NULL
        """
    )

    cursor.execute(
        """
        IF NOT EXISTS (
            SELECT 1
            FROM sys.indexes
            WHERE name = 'IX_email_inbox_items_message_id'
              AND object_id = OBJECT_ID('dbo.email_inbox_items')
        )
        BEGIN
            CREATE INDEX IX_email_inbox_items_message_id
            ON dbo.email_inbox_items(message_id)
        END
        """
    )


def ensure_candidate_movements_table(cursor) -> None:
    cursor.execute(
        """
        IF OBJECT_ID('dbo.candidatos_movimentacoes', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.candidatos_movimentacoes (
                id_movimentacao INT IDENTITY(1,1) PRIMARY KEY,
                id_teste NVARCHAR(120) NULL,
                id_registro INT NULL,
                id_processo NVARCHAR(60) NULL,
                id_processo_ref NVARCHAR(255) NULL,
                nome_candidato NVARCHAR(255) NULL,
                vaga NVARCHAR(255) NULL,
                origem_inicial NVARCHAR(120) NULL,
                tipo_movimentacao NVARCHAR(120) NULL,
                status_anterior NVARCHAR(80) NULL,
                status_novo NVARCHAR(80) NULL,
                observacao NVARCHAR(MAX) NULL,
                usuario_responsavel NVARCHAR(120) NULL,
                processo_destino NVARCHAR(255) NULL,
                criado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )

    for column_name, sql_type in (
        ("id_teste", "NVARCHAR(120)"),
        ("id_registro", "INT"),
        ("id_entrevista", "INT"),
        ("id_processo", "NVARCHAR(60)"),
        ("id_processo_ref", "NVARCHAR(255)"),
        ("nome_candidato", "NVARCHAR(255)"),
        ("vaga", "NVARCHAR(255)"),
        ("origem_inicial", "NVARCHAR(120)"),
        ("tipo_movimentacao", "NVARCHAR(120)"),
        ("status_anterior", "NVARCHAR(80)"),
        ("status_novo", "NVARCHAR(80)"),
        ("observacao", "NVARCHAR(MAX)"),
        ("usuario_responsavel", "NVARCHAR(120)"),
        ("processo_destino", "NVARCHAR(255)"),
        ("criado_em", "DATETIME"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.candidatos_movimentacoes', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.candidatos_movimentacoes
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    cursor.execute(
        """
        UPDATE dbo.candidatos_movimentacoes
        SET criado_em = GETDATE()
        WHERE criado_em IS NULL
        """
    )


def ensure_process_dossier_notes_table(cursor) -> None:
    cursor.execute(
        """
        IF OBJECT_ID('dbo.processos_dossie_anotacoes', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.processos_dossie_anotacoes (
                id_anotacao INT IDENTITY(1,1) PRIMARY KEY,
                id_processo NVARCHAR(60) NULL,
                id_processo_ref NVARCHAR(255) NULL,
                id_teste NVARCHAR(120) NULL,
                nome_candidato NVARCHAR(255) NULL,
                texto NVARCHAR(MAX) NULL,
                usuario_responsavel NVARCHAR(180) NULL,
                criado_em DATETIME NOT NULL DEFAULT GETDATE(),
                atualizado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )

    for column_name, sql_type in (
        ("id_processo", "NVARCHAR(60)"),
        ("id_processo_ref", "NVARCHAR(255)"),
        ("id_teste", "NVARCHAR(120)"),
        ("nome_candidato", "NVARCHAR(255)"),
        ("texto", "NVARCHAR(MAX)"),
        ("usuario_responsavel", "NVARCHAR(180)"),
        ("criado_em", "DATETIME"),
        ("atualizado_em", "DATETIME"),
        ("mencoes_json", "NVARCHAR(MAX)"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.processos_dossie_anotacoes', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.processos_dossie_anotacoes
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    cursor.execute(
        """
        UPDATE dbo.processos_dossie_anotacoes
        SET criado_em = GETDATE()
        WHERE criado_em IS NULL
        """
    )
    cursor.execute(
        """
        UPDATE dbo.processos_dossie_anotacoes
        SET atualizado_em = criado_em
        WHERE atualizado_em IS NULL
        """
    )


def ensure_scorecards_table(cursor) -> None:
    """Cria/atualiza a tabela de scorecards de avaliacao (Kanban de vagas).

    Roadmap de expansao (respostas.txt): "Kanban de vagas com scorecard".
    Aditivo e idempotente: nenhuma tabela ou coluna existente e alterada/removida.
    Cada linha representa a nota (1 a 5) de UM criterio de avaliacao para um
    candidato em uma etapa do funil. Varias linhas com o mesmo
    candidato_processo_id + etapa_avaliada compoem o scorecard daquela etapa.
    """
    cursor.execute(
        """
        IF OBJECT_ID('dbo.scorecards_avaliacao', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.scorecards_avaliacao (
                id INT IDENTITY(1,1) PRIMARY KEY,
                candidato_processo_id INT NOT NULL,
                etapa_avaliada NVARCHAR(60) NULL,
                criterio NVARCHAR(120) NOT NULL,
                nota INT NOT NULL,
                comentario NVARCHAR(MAX) NULL,
                avaliado_por NVARCHAR(180) NULL,
                avaliado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )

    for column_name, sql_type in (
        ("candidato_processo_id", "INT"),
        ("etapa_avaliada", "NVARCHAR(60)"),
        ("criterio", "NVARCHAR(120)"),
        ("nota", "INT"),
        ("comentario", "NVARCHAR(MAX)"),
        ("avaliado_por", "NVARCHAR(180)"),
        ("avaliado_em", "DATETIME"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.scorecards_avaliacao', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.scorecards_avaliacao
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    cursor.execute(
        """
        UPDATE dbo.scorecards_avaliacao
        SET avaliado_em = GETDATE()
        WHERE avaliado_em IS NULL
        """
    )

    cursor.execute(
        """
        IF NOT EXISTS (
            SELECT 1 FROM sys.indexes
            WHERE name = 'IX_scorecards_avaliacao_candidato'
              AND object_id = OBJECT_ID('dbo.scorecards_avaliacao')
        )
        BEGIN
            CREATE INDEX IX_scorecards_avaliacao_candidato
            ON dbo.scorecards_avaliacao (candidato_processo_id, etapa_avaliada)
        END
        """
    )


def ensure_policies_tables(cursor) -> None:
    """Cria/atualiza as tabelas de políticas institucionais e confirmações de leitura.

    Aditivo e idempotente: nenhuma tabela ou coluna existente é alterada/removida.
    """
    cursor.execute(
        """
        IF OBJECT_ID('dbo.politicas', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.politicas (
                id_politica INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                titulo NVARCHAR(255) NOT NULL,
                corpo_texto NVARCHAR(MAX) NOT NULL,
                versao INT NOT NULL,
                ativo BIT NOT NULL,
                criado_por NVARCHAR(180) NULL,
                atualizado_por NVARCHAR(180) NULL,
                criado_em DATETIME NOT NULL DEFAULT GETDATE(),
                atualizado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )

    for column_name, sql_type in (
        ("titulo", "NVARCHAR(255)"),
        ("corpo_texto", "NVARCHAR(MAX)"),
        ("versao", "INT"),
        ("ativo", "BIT"),
        ("criado_por", "NVARCHAR(180)"),
        ("atualizado_por", "NVARCHAR(180)"),
        ("criado_em", "DATETIME"),
        ("atualizado_em", "DATETIME"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.politicas', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.politicas
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    cursor.execute(
        """
        UPDATE dbo.politicas SET versao = 1 WHERE versao IS NULL
        """
    )
    cursor.execute(
        """
        UPDATE dbo.politicas SET ativo = 1 WHERE ativo IS NULL
        """
    )
    cursor.execute(
        """
        UPDATE dbo.politicas SET criado_em = GETDATE() WHERE criado_em IS NULL
        """
    )
    cursor.execute(
        """
        UPDATE dbo.politicas SET atualizado_em = criado_em WHERE atualizado_em IS NULL
        """
    )

    cursor.execute(
        """
        IF OBJECT_ID('dbo.politicas_confirmacoes', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.politicas_confirmacoes (
                id_confirmacao INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                id_politica INT NOT NULL,
                id_usuario INT NULL,
                usuario_login NVARCHAR(180) NOT NULL,
                usuario_nome NVARCHAR(180) NULL,
                versao_confirmada INT NOT NULL CONSTRAINT DF_politicas_confirmacoes_versao DEFAULT 1,
                confirmado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )

    for column_name, sql_type in (
        ("id_politica", "INT"),
        ("id_usuario", "INT"),
        ("usuario_login", "NVARCHAR(180)"),
        ("usuario_nome", "NVARCHAR(180)"),
        ("versao_confirmada", "INT"),
        ("confirmado_em", "DATETIME"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.politicas_confirmacoes', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.politicas_confirmacoes
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    cursor.execute(
        """
        UPDATE dbo.politicas_confirmacoes SET versao_confirmada = 1 WHERE versao_confirmada IS NULL
        """
    )

    cursor.execute(
        """
        IF NOT EXISTS (
            SELECT 1 FROM sys.indexes
            WHERE object_id = OBJECT_ID('dbo.politicas_confirmacoes')
              AND name = 'UX_politicas_confirmacoes_usuario'
        )
        CREATE UNIQUE INDEX UX_politicas_confirmacoes_usuario
            ON dbo.politicas_confirmacoes(id_politica, usuario_login)
        """
    )


def ensure_celebratory_dates_table(cursor) -> None:
    """Cria/atualiza a tabela de datas comemorativas (aditivo/idempotente)."""
    cursor.execute(
        """
        IF OBJECT_ID('dbo.datas_comemorativas', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.datas_comemorativas (
                id_data INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                titulo NVARCHAR(255) NOT NULL,
                dia INT NOT NULL,
                mes INT NOT NULL,
                descricao NVARCHAR(1000) NULL,
                criado_por NVARCHAR(180) NULL,
                criado_em DATETIME NOT NULL DEFAULT GETDATE(),
                atualizado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )

    for column_name, sql_type in (
        ("titulo", "NVARCHAR(255)"),
        ("dia", "INT"),
        ("mes", "INT"),
        ("descricao", "NVARCHAR(1000)"),
        ("criado_por", "NVARCHAR(180)"),
        ("criado_em", "DATETIME"),
        ("atualizado_em", "DATETIME"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.datas_comemorativas', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.datas_comemorativas
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    cursor.execute(
        """
        UPDATE dbo.datas_comemorativas SET criado_em = GETDATE() WHERE criado_em IS NULL
        """
    )
    cursor.execute(
        """
        UPDATE dbo.datas_comemorativas SET atualizado_em = criado_em WHERE atualizado_em IS NULL
        """
    )


def ensure_notification_automation_table(cursor) -> None:
    """Cria/atualiza a tabela de configuracao (linha unica) que liga/desliga a
    automacao de e-mail por etapa (aditivo/idempotente). Default desligado."""
    cursor.execute(
        """
        IF OBJECT_ID('dbo.configuracoes_notificacoes_automaticas', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.configuracoes_notificacoes_automaticas (
                id_configuracao INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                email_automatico_ativo BIT NOT NULL CONSTRAINT DF_configuracoes_notificacoes_email_ativo DEFAULT 0,
                atualizado_por NVARCHAR(180) NULL,
                atualizado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.configuracoes_notificacoes_automaticas', 'email_automatico_ativo') IS NULL
        BEGIN
            ALTER TABLE dbo.configuracoes_notificacoes_automaticas
            ADD email_automatico_ativo BIT NOT NULL CONSTRAINT DF_configuracoes_notificacoes_email_ativo2 DEFAULT 0
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.configuracoes_notificacoes_automaticas', 'lembretes_automaticos_ativos') IS NULL
        BEGIN
            ALTER TABLE dbo.configuracoes_notificacoes_automaticas
            ADD lembretes_automaticos_ativos BIT NOT NULL CONSTRAINT DF_configuracoes_notificacoes_lembretes_ativos DEFAULT 0
        END
        """
    )


def ensure_onboarding_tables(cursor) -> None:
    """Trilhas de onboarding (checklist) e instâncias por candidato.

    Aditivo e idempotente: nenhuma tabela ou coluna existente é alterada/removida.
    Reflete a migration V009__onboarding_trilhas_e_templates_documentos.sql.
    """
    cursor.execute(
        """
        IF OBJECT_ID('dbo.trilhas_onboarding', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.trilhas_onboarding (
                id_trilha INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                nome NVARCHAR(255) NOT NULL,
                descricao NVARCHAR(MAX) NULL,
                ativo BIT NOT NULL CONSTRAINT DF_trilhas_onboarding_ativo DEFAULT 1,
                criado_por NVARCHAR(180) NULL,
                criado_em DATETIME NOT NULL DEFAULT GETDATE(),
                atualizado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )
    for column_name, sql_type in (
        ("nome", "NVARCHAR(255)"),
        ("descricao", "NVARCHAR(MAX)"),
        ("ativo", "BIT"),
        ("criado_por", "NVARCHAR(180)"),
        ("criado_em", "DATETIME"),
        ("atualizado_em", "DATETIME"),
        # Extensão "Central de Treinamentos" (respostas.txt, rodada 25/ago/2026):
        # a mesma trilha de onboarding passa a carregar categoria (LGPD,
        # Segurança da Informação, Onboarding, Produto), a operação a que se
        # aplica (NULL = genérica) e como o treinamento é ministrado.
        ("categoria", "NVARCHAR(60)"),
        ("id_operacao", "INT"),
        ("modalidade", "NVARCHAR(20)"),
        ("local_padrao", "NVARCHAR(180)"),
        # Correcoes.txt (rodada 03/set/2026): conteudo do treinamento (slides +
        # script) que o Conecta "transcreve" na tela de Comecar Treinamento.
        ("conteudo_json", "NVARCHAR(MAX)"),
        # Prompt.txt (rodada 06/set/2026): texto de encerramento editavel, slide
        # .pptx real (upload + PDF convertido) e aba "Saiba +" do treinamento.
        # Ver docs/central-treinamentos/01-plano-tecnico.md.
        ("texto_encerramento", "NVARCHAR(MAX)"),
        ("pptx_path", "NVARCHAR(500)"),
        ("pptx_nome_original", "NVARCHAR(255)"),
        ("pptx_pdf_path", "NVARCHAR(500)"),
        ("saiba_mais_treinamento_json", "NVARCHAR(MAX)"),
        # prompt.txt §3.1: "Tipo: Obrigatório/Não obrigatório" do treinamento
        # (distinto do "obrigatorio" por módulo, já existente).
        ("tipo_obrigatorio", "BIT"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.trilhas_onboarding', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.trilhas_onboarding
                ADD {column_name} {sql_type} NULL
            END
            """
        )
    cursor.execute("UPDATE dbo.trilhas_onboarding SET ativo = 1 WHERE ativo IS NULL")
    cursor.execute("UPDATE dbo.trilhas_onboarding SET categoria = 'Onboarding' WHERE categoria IS NULL")
    cursor.execute("UPDATE dbo.trilhas_onboarding SET tipo_obrigatorio = 0 WHERE tipo_obrigatorio IS NULL")
    cursor.execute("UPDATE dbo.trilhas_onboarding SET criado_em = GETDATE() WHERE criado_em IS NULL")
    cursor.execute("UPDATE dbo.trilhas_onboarding SET atualizado_em = criado_em WHERE atualizado_em IS NULL")

    cursor.execute(
        """
        IF OBJECT_ID('dbo.trilhas_onboarding_itens', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.trilhas_onboarding_itens (
                id_item INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                trilha_id INT NOT NULL,
                titulo NVARCHAR(255) NOT NULL,
                descricao NVARCHAR(MAX) NULL,
                ordem INT NOT NULL CONSTRAINT DF_trilhas_onboarding_itens_ordem DEFAULT 0,
                obrigatorio BIT NOT NULL CONSTRAINT DF_trilhas_onboarding_itens_obrigatorio DEFAULT 1,
                criado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )
    for column_name, sql_type in (
        ("trilha_id", "INT"),
        ("titulo", "NVARCHAR(255)"),
        ("descricao", "NVARCHAR(MAX)"),
        ("ordem", "INT"),
        ("obrigatorio", "BIT"),
        ("criado_em", "DATETIME"),
        # Cada item pode carregar um conteúdo (vídeo, texto, slide ou link),
        # não só um checklist — ver extensão "Central de Treinamentos" acima.
        ("tipo_conteudo", "NVARCHAR(20)"),
        ("conteudo_url", "NVARCHAR(500)"),
        # Prompt.txt (rodada 06/set/2026): campos ricos do modulo (subtitulo,
        # texto principal, video proprio, tabela, dica, lista "Saiba +").
        ("subtitulo", "NVARCHAR(255)"),
        ("texto_principal", "NVARCHAR(MAX)"),
        ("video_path", "NVARCHAR(500)"),
        ("video_nome_original", "NVARCHAR(255)"),
        ("tabela_json", "NVARCHAR(MAX)"),
        ("dica_texto", "NVARCHAR(MAX)"),
        ("saiba_mais_itens_json", "NVARCHAR(MAX)"),
        # Correções.txt (rodada de 08/set/2026): imagens do módulo — zero, uma
        # ou várias, distribuídas em vários subtítulos ao longo do conteúdo.
        ("secoes_json", "NVARCHAR(MAX)"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.trilhas_onboarding_itens', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.trilhas_onboarding_itens
                ADD {column_name} {sql_type} NULL
            END
            """
        )
    cursor.execute("UPDATE dbo.trilhas_onboarding_itens SET ordem = 0 WHERE ordem IS NULL")
    cursor.execute("UPDATE dbo.trilhas_onboarding_itens SET obrigatorio = 1 WHERE obrigatorio IS NULL")
    cursor.execute("UPDATE dbo.trilhas_onboarding_itens SET criado_em = GETDATE() WHERE criado_em IS NULL")

    cursor.execute(
        """
        IF OBJECT_ID('dbo.onboarding_candidatos', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.onboarding_candidatos (
                id_onboarding INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                id_registro INT NOT NULL,
                trilha_id INT NOT NULL,
                iniciado_por NVARCHAR(180) NULL,
                iniciado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )
    for column_name, sql_type in (
        ("id_registro", "INT"),
        ("trilha_id", "INT"),
        ("iniciado_por", "NVARCHAR(180)"),
        ("iniciado_em", "DATETIME"),
        # Agenda/local do treinamento (RH: "poderá ver o horário, tempo, sala")
        # e status geral do check/OK do supervisor, além do checklist por item.
        ("data_prevista", "DATETIME"),
        ("local", "NVARCHAR(180)"),
        ("ministrante", "NVARCHAR(180)"),
        ("status", "NVARCHAR(20)"),
        # Correcoes.txt (rodada 03/set/2026): acesso ao aplicativo/plataforma
        # auxiliar do treinamento e forma de login, alem da lista de presenca.
        ("acesso_plataforma", "BIT"),
        ("metodo_login", "NVARCHAR(20)"),
        ("presenca", "NVARCHAR(20)"),
        # Prompt.txt (rodada 06/set/2026): marca idempotente do job de
        # escalonamento de chamada pendente (3/5 dias) - evita notificar o RH
        # mais de uma vez pela mesma pendencia.
        ("notificado_pendente_em", "DATETIME"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.onboarding_candidatos', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.onboarding_candidatos
                ADD {column_name} {sql_type} NULL
            END
            """
        )
    cursor.execute("UPDATE dbo.onboarding_candidatos SET iniciado_em = GETDATE() WHERE iniciado_em IS NULL")
    cursor.execute("UPDATE dbo.onboarding_candidatos SET status = 'em_andamento' WHERE status IS NULL")
    cursor.execute(
        """
        IF NOT EXISTS (
            SELECT 1 FROM sys.indexes
            WHERE name = 'IX_onboarding_candidatos_id_registro'
              AND object_id = OBJECT_ID('dbo.onboarding_candidatos')
        )
        BEGIN
            CREATE INDEX IX_onboarding_candidatos_id_registro
            ON dbo.onboarding_candidatos(id_registro)
        END
        """
    )

    cursor.execute(
        """
        IF OBJECT_ID('dbo.onboarding_candidatos_itens', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.onboarding_candidatos_itens (
                id_onboarding_item INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                onboarding_candidato_id INT NOT NULL,
                trilha_item_id INT NULL,
                titulo NVARCHAR(255) NOT NULL,
                descricao NVARCHAR(MAX) NULL,
                ordem INT NOT NULL CONSTRAINT DF_onboarding_candidatos_itens_ordem DEFAULT 0,
                obrigatorio BIT NOT NULL CONSTRAINT DF_onboarding_candidatos_itens_obrigatorio DEFAULT 1,
                concluido BIT NOT NULL CONSTRAINT DF_onboarding_candidatos_itens_concluido DEFAULT 0,
                concluido_em DATETIME NULL,
                concluido_por NVARCHAR(180) NULL
            )
        END
        """
    )
    for column_name, sql_type in (
        ("onboarding_candidato_id", "INT"),
        ("trilha_item_id", "INT"),
        ("titulo", "NVARCHAR(255)"),
        ("descricao", "NVARCHAR(MAX)"),
        ("ordem", "INT"),
        ("obrigatorio", "BIT"),
        ("concluido", "BIT"),
        ("concluido_em", "DATETIME"),
        ("concluido_por", "NVARCHAR(180)"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.onboarding_candidatos_itens', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.onboarding_candidatos_itens
                ADD {column_name} {sql_type} NULL
            END
            """
        )
    cursor.execute("UPDATE dbo.onboarding_candidatos_itens SET ordem = 0 WHERE ordem IS NULL")
    cursor.execute("UPDATE dbo.onboarding_candidatos_itens SET obrigatorio = 1 WHERE obrigatorio IS NULL")
    cursor.execute("UPDATE dbo.onboarding_candidatos_itens SET concluido = 0 WHERE concluido IS NULL")

    # Prompt.txt (rodada 06/set/2026): documentos da aba "Saiba +" (nivel
    # treinamento ou modulo, via trilha_item_id opcional), com o toggle de
    # download LGPD persistido na propria linha (mesmo padrao coluna-a-coluna
    # do consentimento LGPD de candidatos, migration V019).
    cursor.execute(
        """
        IF OBJECT_ID('dbo.trilhas_onboarding_anexos', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.trilhas_onboarding_anexos (
                id_anexo INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                trilha_id INT NOT NULL,
                trilha_item_id INT NULL,
                nome_arquivo_original NVARCHAR(255) NOT NULL,
                nome_arquivo_armazenado NVARCHAR(255) NOT NULL,
                tipo_arquivo NVARCHAR(120) NULL,
                caminho_arquivo NVARCHAR(500) NOT NULL,
                tamanho_bytes INT NOT NULL CONSTRAINT DF_trilhas_onboarding_anexos_tamanho DEFAULT 0,
                permite_download BIT NOT NULL CONSTRAINT DF_trilhas_onboarding_anexos_permite_download DEFAULT 0,
                termo_aceito_em DATETIME NULL,
                termo_aceito_por NVARCHAR(180) NULL,
                termo_versao NVARCHAR(40) NULL,
                criado_por NVARCHAR(180) NULL,
                criado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )
    cursor.execute(
        """
        IF NOT EXISTS (
            SELECT 1 FROM sys.indexes
            WHERE name = 'IX_trilhas_onboarding_anexos_trilha_id'
              AND object_id = OBJECT_ID('dbo.trilhas_onboarding_anexos')
        )
        BEGIN
            CREATE INDEX IX_trilhas_onboarding_anexos_trilha_id
            ON dbo.trilhas_onboarding_anexos(trilha_id)
        END
        """
    )

    cursor.execute("SELECT COUNT(1) FROM dbo.trilhas_onboarding")
    row = cursor.fetchone()
    if (not row or int(row[0] or 0) == 0) and not conecta_reset_flag_ativo(cursor):
        cursor.execute(
            """
            INSERT INTO dbo.trilhas_onboarding (nome, descricao, ativo, criado_por, criado_em, atualizado_em)
            OUTPUT INSERTED.id_trilha
            VALUES (?, ?, 1, 'bootstrap', GETDATE(), GETDATE())
            """,
            (
                "Trilha padrão de onboarding",
                "Trilha inicial sugerida pelo RH. Edite os itens conforme a necessidade da operação.",
            ),
        )
        inserted = cursor.fetchone()
        id_trilha_padrao = int(inserted[0] or 0)
        itens_padrao = (
            ("Documentação admissional", "Coletar e validar os documentos exigidos para a admissão.", 1, 1),
            ("Provisionar acessos/e-mail corporativo", "Criar usuário, e-mail e acessos aos sistemas internos.", 2, 1),
            ("Apresentação da equipe", "Apresentar o novo colaborador ao time e aos líderes diretos.", 3, 0),
            ("Treinamento inicial da operação", "Realizar o treinamento inicial sobre processos e ferramentas.", 4, 1),
            ("Entrega de materiais/equipamento", "Entregar crachá, equipamentos e materiais de trabalho.", 5, 1),
            ("Alinhamento de metas do primeiro mês", "Alinhar expectativas e metas para os primeiros 30 dias.", 6, 0),
        )
        for titulo, descricao, ordem, obrigatorio in itens_padrao:
            cursor.execute(
                """
                INSERT INTO dbo.trilhas_onboarding_itens (trilha_id, titulo, descricao, ordem, obrigatorio, criado_em)
                VALUES (?, ?, ?, ?, ?, GETDATE())
                """,
                (id_trilha_padrao, titulo, descricao, ordem, obrigatorio),
            )


def ensure_process_trainings_table(cursor) -> None:
    """Treinamentos vinculados a um processo seletivo (Correcoes.txt, rodada
    03/set/2026): ao criar o processo com treinamentos selecionados, cada um
    vira uma linha aqui com o total de vagas do processo bloqueado
    (tag AGUARDANDO PROCESSO). O Gestor "libera" parte das vagas antes do
    encerramento (tag ABERTO) escolhendo quais candidatos aprovados entram —
    aí sim cria-se o onboarding_candidatos real de cada um deles.

    Aditivo e idempotente: nenhuma tabela ou coluna existente é alterada/removida.
    """
    cursor.execute(
        """
        IF OBJECT_ID('dbo.processos_treinamentos', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.processos_treinamentos (
                id_processo_treinamento INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                id_processo NVARCHAR(80) NOT NULL,
                trilha_id INT NOT NULL,
                vagas_totais INT NOT NULL CONSTRAINT DF_processos_treinamentos_vagas_totais DEFAULT 0,
                vagas_liberadas INT NOT NULL CONSTRAINT DF_processos_treinamentos_vagas_liberadas DEFAULT 0,
                criado_em DATETIME NOT NULL CONSTRAINT DF_processos_treinamentos_criado_em DEFAULT GETDATE(),
                atualizado_em DATETIME NOT NULL CONSTRAINT DF_processos_treinamentos_atualizado_em DEFAULT GETDATE()
            )
        END
        """
    )
    cursor.execute(
        """
        IF NOT EXISTS (
            SELECT 1 FROM sys.indexes
            WHERE name = 'IX_processos_treinamentos_id_processo'
              AND object_id = OBJECT_ID('dbo.processos_treinamentos')
        )
        BEGIN
            CREATE INDEX IX_processos_treinamentos_id_processo
            ON dbo.processos_treinamentos(id_processo)
        END
        """
    )


def ensure_notifications_table(cursor) -> None:
    """Central de notificações in-app (Prompt.txt, rodada 06/set/2026).

    Não existia nenhuma persistência de notificação antes desta rodada — o
    sino no header era 100% client-side (derivava "notificações" filtrando
    listas já carregadas). Escopo inicial: eventos da Central de
    Treinamentos, mas a tabela é genérica o bastante para outros módulos.

    Aditivo e idempotente: nenhuma tabela ou coluna existente é alterada/removida.
    """
    cursor.execute(
        """
        IF OBJECT_ID('dbo.notificacoes', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.notificacoes (
                id_notificacao INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                destinatario_papel NVARCHAR(30) NULL,
                destinatario_usuario NVARCHAR(180) NULL,
                titulo NVARCHAR(255) NOT NULL,
                mensagem NVARCHAR(MAX) NULL,
                categoria NVARCHAR(60) NOT NULL,
                entidade NVARCHAR(60) NULL,
                entidade_id NVARCHAR(80) NULL,
                lida BIT NOT NULL CONSTRAINT DF_notificacoes_lida DEFAULT 0,
                lida_em DATETIME NULL,
                criado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )
    cursor.execute(
        """
        IF NOT EXISTS (
            SELECT 1 FROM sys.indexes
            WHERE name = 'IX_notificacoes_papel_lida'
              AND object_id = OBJECT_ID('dbo.notificacoes')
        )
        BEGIN
            CREATE INDEX IX_notificacoes_papel_lida
            ON dbo.notificacoes(destinatario_papel, lida)
        END
        """
    )


def ensure_document_templates_table(cursor) -> None:
    """Templates de documentos com placeholders {{variavel}} (aditivo/idempotente)."""
    cursor.execute(
        """
        IF OBJECT_ID('dbo.templates_documentos', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.templates_documentos (
                id_template INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                titulo NVARCHAR(255) NOT NULL,
                corpo_texto NVARCHAR(MAX) NOT NULL,
                ativo BIT NOT NULL CONSTRAINT DF_templates_documentos_ativo DEFAULT 1,
                criado_em DATETIME NOT NULL DEFAULT GETDATE(),
                atualizado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )
    for column_name, sql_type in (
        ("titulo", "NVARCHAR(255)"),
        ("corpo_texto", "NVARCHAR(MAX)"),
        ("ativo", "BIT"),
        ("criado_em", "DATETIME"),
        ("atualizado_em", "DATETIME"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.templates_documentos', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.templates_documentos
                ADD {column_name} {sql_type} NULL
            END
            """
        )
    cursor.execute("UPDATE dbo.templates_documentos SET ativo = 1 WHERE ativo IS NULL")
    cursor.execute("UPDATE dbo.templates_documentos SET criado_em = GETDATE() WHERE criado_em IS NULL")
    cursor.execute("UPDATE dbo.templates_documentos SET atualizado_em = criado_em WHERE atualizado_em IS NULL")


def ensure_documentos_biblioteca_table(cursor) -> None:
    """Central de Documentos: biblioteca de arquivos de referência por tópico/área (aditivo/idempotente)."""
    cursor.execute(
        """
        IF OBJECT_ID('dbo.documentos_biblioteca', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.documentos_biblioteca (
                id_documento INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                titulo NVARCHAR(255) NOT NULL,
                topico NVARCHAR(120) NOT NULL,
                area NVARCHAR(120) NULL,
                descricao NVARCHAR(500) NULL,
                url_arquivo NVARCHAR(1000) NOT NULL,
                ativo BIT NOT NULL CONSTRAINT DF_documentos_biblioteca_ativo DEFAULT 1,
                criado_por NVARCHAR(200) NULL,
                criado_em DATETIME NOT NULL DEFAULT GETDATE(),
                atualizado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )
    for column_name, sql_type in (
        ("titulo", "NVARCHAR(255)"),
        ("topico", "NVARCHAR(120)"),
        ("area", "NVARCHAR(120)"),
        ("descricao", "NVARCHAR(500)"),
        ("url_arquivo", "NVARCHAR(1000)"),
        ("ativo", "BIT"),
        ("criado_por", "NVARCHAR(200)"),
        ("criado_em", "DATETIME"),
        ("atualizado_em", "DATETIME"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.documentos_biblioteca', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.documentos_biblioteca
                ADD {column_name} {sql_type} NULL
            END
            """
        )
    cursor.execute("UPDATE dbo.documentos_biblioteca SET ativo = 1 WHERE ativo IS NULL")
    cursor.execute("UPDATE dbo.documentos_biblioteca SET criado_em = GETDATE() WHERE criado_em IS NULL")
    cursor.execute("UPDATE dbo.documentos_biblioteca SET atualizado_em = criado_em WHERE atualizado_em IS NULL")


_DISC_SEED_BLOCOS: list[list[tuple[str, str]]] = [
    [
        ("D", "Gosto de tomar decisões rápidas quando o problema é urgente."),
        ("I", "Prefiro conversar com as pessoas para resolver as coisas juntos."),
        ("S", "Sinto-me mais seguro seguindo uma rotina já conhecida."),
        ("C", "Gosto de checar os detalhes antes de dar uma resposta."),
    ],
    [
        ("D", "Não tenho medo de assumir a liderança de uma tarefa."),
        ("I", "Fico animado(a) ao conhecer pessoas novas no trabalho."),
        ("S", "Prefiro terminar uma tarefa antes de começar outra."),
        ("C", "Sigo as regras e procedimentos à risca."),
    ],
    [
        ("D", "Costumo ir direto ao ponto quando estou falando com alguém."),
        ("I", "Uso o bom humor para deixar o ambiente mais leve."),
        ("S", "Sou paciente mesmo quando a tarefa é repetitiva."),
        ("C", "Prefiro ter tudo documentado e organizado."),
    ],
    [
        ("D", "Gosto de desafios e metas ambiciosas."),
        ("I", "Costumo falar bastante e gosto de ser ouvido(a)."),
        ("S", "Prefiro um ambiente de trabalho estável e previsível."),
        ("C", "Analiso os dados com cuidado antes de agir."),
    ],
    [
        ("D", "Tomo iniciativa mesmo sem esperar instruções."),
        ("I", "Gosto de motivar os colegas ao meu redor."),
        ("S", "Levo em conta os sentimentos da equipe antes de decidir."),
        ("C", "Prefiro seguir um roteiro/script já validado."),
    ],
    [
        ("D", "Não me abalo diante de um cliente mais exaltado."),
        ("I", "Consigo me adaptar facilmente a pessoas diferentes."),
        ("S", "Mantenho a calma mesmo em dias de muita repetição."),
        ("C", "Prefiro confirmar as informações antes de responder o cliente."),
    ],
    [
        ("D", "Gosto de resultados rápidos e objetivos."),
        ("I", "Acredito que um bom relacionamento facilita o trabalho em equipe."),
        ("S", "Prefiro apoiar os colegas a competir com eles."),
        ("C", "Sigo os critérios de qualidade estabelecidos pela empresa."),
    ],
    [
        ("D", "Não tenho problema em dizer o que penso, mesmo que seja direto."),
        ("I", "Gosto de elogiar e reconhecer o trabalho dos colegas."),
        ("S", "Prefiro ambientes de trabalho tranquilos e sem conflitos."),
        ("C", "Presto atenção nos mínimos detalhes de uma instrução."),
    ],
    [
        ("D", "Gosto de assumir responsabilidade por resultados do time."),
        ("I", "Fico à vontade falando em público ou por telefone."),
        ("S", "Prefiro rotinas de trabalho bem definidas."),
        ("C", "Gosto de seguir processos passo a passo."),
    ],
    [
        ("D", "Prefiro agir logo a ficar esperando aprovação demorada."),
        ("I", "Gosto de manter contato próximo com clientes e colegas."),
        ("S", "Sou uma pessoa confiável para tarefas repetitivas do dia a dia."),
        ("C", "Prefiro dados concretos a opiniões pessoais."),
    ],
]


def ensure_disc_tables(cursor) -> None:
    """Teste DISC proprio: blocos de 4 frases (mais/menos) e aplicacoes por candidato.

    Aditivo e idempotente. Reflete V010__disc_fit_cultural_raciocinio_logico.sql.
    Ao criar as tabelas pela primeira vez, popula um banco inicial de blocos DISC
    (frases originais no estilo do modelo de Marston, dominio publico).
    """
    cursor.execute(
        """
        IF OBJECT_ID('dbo.disc_blocos', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.disc_blocos (
                id_bloco INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                ordem INT NOT NULL CONSTRAINT DF_disc_blocos_ordem DEFAULT 0,
                ativo BIT NOT NULL CONSTRAINT DF_disc_blocos_ativo DEFAULT 1,
                criado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )
    cursor.execute(
        """
        IF OBJECT_ID('dbo.disc_frases', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.disc_frases (
                id_frase INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                bloco_id INT NOT NULL,
                dimensao CHAR(1) NOT NULL,
                texto NVARCHAR(500) NOT NULL,
                ordem INT NOT NULL CONSTRAINT DF_disc_frases_ordem DEFAULT 0
            )
        END
        """
    )
    cursor.execute(
        """
        IF OBJECT_ID('dbo.disc_aplicacoes', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.disc_aplicacoes (
                id_aplicacao INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                id_teste NVARCHAR(60) NOT NULL,
                id_processo_ref INT NULL,
                status NVARCHAR(30) NOT NULL CONSTRAINT DF_disc_aplicacoes_status DEFAULT 'Disponivel',
                iniciada_em DATETIME NULL,
                finalizada_em DATETIME NULL,
                resultado_json NVARCHAR(MAX) NULL,
                criada_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )
    cursor.execute(
        """
        IF OBJECT_ID('dbo.disc_respostas', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.disc_respostas (
                id_resposta INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                aplicacao_id INT NOT NULL,
                bloco_id INT NOT NULL,
                frase_mais_id INT NOT NULL,
                frase_menos_id INT NOT NULL,
                respondido_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )

    cursor.execute("SELECT COUNT(*) FROM dbo.disc_blocos")
    row = cursor.fetchone()
    if (not row or int(row[0] or 0) == 0) and not conecta_reset_flag_ativo(cursor):
        for ordem, bloco in enumerate(_DISC_SEED_BLOCOS):
            cursor.execute(
                "INSERT INTO dbo.disc_blocos (ordem, ativo, criado_em) OUTPUT INSERTED.id_bloco VALUES (?, 1, GETDATE())",
                (ordem,),
            )
            id_bloco = int(cursor.fetchone()[0])
            for frase_ordem, (dimensao, texto) in enumerate(bloco):
                cursor.execute(
                    """
                    INSERT INTO dbo.disc_frases (bloco_id, dimensao, texto, ordem)
                    VALUES (?, ?, ?, ?)
                    """,
                    (id_bloco, dimensao, texto, frase_ordem),
                )


_VALORES_EMPRESA_SEED: list[tuple[str, str, list[str]]] = [
    (
        "Foco no cliente",
        "Coloca a experiência do cliente/candidato no centro de toda decisão.",
        [
            "Procuro sempre entender o que o cliente realmente precisa, mesmo quando ele não sabe explicar.",
            "Trato cada atendimento como se fosse o mais importante do dia.",
        ],
    ),
    (
        "Colaboração",
        "Trabalha em equipe, compartilha conhecimento e ajuda os colegas.",
        [
            "Ofereço ajuda a colegas mesmo quando não é minha obrigação direta.",
            "Prefiro resolver problemas em conjunto a competir com o time.",
        ],
    ),
    (
        "Resiliência",
        "Mantém o desempenho estável mesmo sob pressão, repetição ou rotina intensa.",
        [
            "Consigo manter a qualidade do meu trabalho mesmo em dias muito corridos.",
            "Não desanimo quando preciso repetir a mesma tarefa várias vezes ao dia.",
        ],
    ),
    (
        "Comunicação clara",
        "Se expressa de forma objetiva, educada e fácil de entender.",
        [
            "Procuro explicar as coisas de um jeito simples, sem gerar dúvidas.",
            "Tenho facilidade para ouvir e me adaptar ao jeito de falar do outro.",
        ],
    ),
]


def ensure_fit_cultural_tables(cursor) -> None:
    """Fit cultural: valores da empresa, frases associadas e respostas Likert 1-5.

    Aditivo e idempotente. Reflete V010__disc_fit_cultural_raciocinio_logico.sql.
    """
    cursor.execute(
        """
        IF OBJECT_ID('dbo.valores_empresa', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.valores_empresa (
                id_valor INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                nome NVARCHAR(150) NOT NULL,
                descricao NVARCHAR(MAX) NULL,
                ativo BIT NOT NULL CONSTRAINT DF_valores_empresa_ativo DEFAULT 1,
                criado_em DATETIME NOT NULL DEFAULT GETDATE(),
                atualizado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )
    cursor.execute(
        """
        IF OBJECT_ID('dbo.valores_empresa_frases', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.valores_empresa_frases (
                id_frase INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                valor_id INT NOT NULL,
                frase NVARCHAR(500) NOT NULL,
                ordem INT NOT NULL CONSTRAINT DF_valores_empresa_frases_ordem DEFAULT 0
            )
        END
        """
    )
    cursor.execute(
        """
        IF OBJECT_ID('dbo.fit_cultural_respostas', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.fit_cultural_respostas (
                id_resposta INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                candidato_processo_id INT NOT NULL,
                frase_id INT NOT NULL,
                nota_concordancia INT NOT NULL,
                respondido_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )

    cursor.execute("SELECT COUNT(*) FROM dbo.valores_empresa")
    row = cursor.fetchone()
    if (not row or int(row[0] or 0) == 0) and not conecta_reset_flag_ativo(cursor):
        for nome, descricao, frases in _VALORES_EMPRESA_SEED:
            cursor.execute(
                """
                INSERT INTO dbo.valores_empresa (nome, descricao, ativo, criado_em, atualizado_em)
                OUTPUT INSERTED.id_valor
                VALUES (?, ?, 1, GETDATE(), GETDATE())
                """,
                (nome, descricao),
            )
            id_valor = int(cursor.fetchone()[0])
            for ordem, frase in enumerate(frases):
                cursor.execute(
                    """
                    INSERT INTO dbo.valores_empresa_frases (valor_id, frase, ordem)
                    VALUES (?, ?, ?)
                    """,
                    (id_valor, frase, ordem),
                )


_RACIOCINIO_SEED: list[tuple[str, str, list[str], int, str, str]] = [
    (
        "Complete a sequência: 2, 4, 6, 8, ?",
        "sequencia_logica",
        ["9", "10", "12", "16"],
        1,
        "facil",
        "Revise progressões aritméticas simples (cada termo soma um valor fixo ao anterior).",
    ),
    (
        "Complete a sequência: 1, 1, 2, 3, 5, 8, ?",
        "sequencia_logica",
        ["11", "13", "12", "10"],
        1,
        "medio",
        "Essa é uma sequência de Fibonacci: cada termo é a soma dos dois anteriores.",
    ),
    (
        "Qual número completa a sequência: 3, 6, 12, 24, ?",
        "sequencia_logica",
        ["30", "36", "48", "42"],
        2,
        "facil",
        "Observe que cada termo é o dobro do anterior (progressão geométrica).",
    ),
    (
        "Na sequência A, C, F, J, ?, qual é a próxima letra (avançando 2, 3, 4, 5 posições no alfabeto)?",
        "sequencia_logica",
        ["N", "O", "P", "M"],
        1,
        "dificil",
        "Conte quantas posições o alfabeto avança a cada passo: 2, depois 3, depois 4, depois 5.",
    ),
    (
        "Uma central de atendimento recebeu 120 ligações em 4 horas. Qual a média de ligações por hora?",
        "interpretacao_numerica",
        ["20", "25", "30", "40"],
        2,
        "facil",
        "Divida o total de ligações pelo número de horas: 120 ÷ 4.",
    ),
    (
        "A tabela mostra chamadas atendidas por turno: Manhã=80, Tarde=95, Noite=65. Qual turno teve o maior volume?",
        "interpretacao_numerica",
        ["Manhã", "Tarde", "Noite", "Todos iguais"],
        1,
        "facil",
        "Compare os três valores da tabela: o maior número indica o turno de maior volume.",
    ),
    (
        "Em uma operação, 30% de 200 atendimentos foram resolvidos no primeiro contato. Quantos atendimentos isso representa?",
        "interpretacao_numerica",
        ["50", "60", "70", "80"],
        1,
        "medio",
        "Calcule 30% de 200: multiplique 200 por 0,30.",
    ),
    (
        "Se o índice de satisfação subiu de 80 para 92 pontos, qual foi o aumento percentual aproximado?",
        "interpretacao_numerica",
        ["10%", "12%", "15%", "20%"],
        2,
        "dificil",
        "Calcule a variação (92-80=12) dividida pelo valor inicial (80) e multiplique por 100.",
    ),
    (
        "Um atendente resolve 15 chamados a cada 2 horas. Mantendo o ritmo, quantos chamados resolve em 8 horas?",
        "problema_matematico",
        ["45", "60", "75", "90"],
        1,
        "medio",
        "Calcule quantos blocos de 2 horas cabem em 8 horas e multiplique pelo ritmo por bloco.",
    ),
    (
        "Uma meta mensal é de 900 atendimentos, distribuídos igualmente em 30 dias. Quantos atendimentos por dia são necessários?",
        "problema_matematico",
        ["25", "30", "35", "40"],
        1,
        "facil",
        "Divida a meta mensal pelo número de dias: 900 ÷ 30.",
    ),
    (
        "Dois atendentes juntos resolvem 50 chamados em 1 hora, trabalhando no mesmo ritmo. Quanto cada um resolve, em média?",
        "problema_matematico",
        ["20", "25", "30", "15"],
        1,
        "facil",
        "Divida o total resolvido pela quantidade de atendentes: 50 ÷ 2.",
    ),
    (
        "Um script de atendimento tem 5 etapas. Se cada etapa leva em média 40 segundos, quanto tempo leva o atendimento completo?",
        "problema_matematico",
        ["3 minutos e 20 segundos", "3 minutos", "4 minutos", "2 minutos e 40 segundos"],
        0,
        "medio",
        "Multiplique o tempo de cada etapa pelo número de etapas e converta o total de segundos para minutos.",
    ),
    (
        "Uma fila tem 45 pessoas e cresce à razão de 3 pessoas por minuto. Quantas pessoas estarão na fila após 10 minutos, sem atendimento?",
        "problema_matematico",
        ["65", "70", "75", "80"],
        2,
        "dificil",
        "Some ao valor inicial o produto da taxa de crescimento pelo tempo decorrido: 45 + (3 × 10).",
    ),
    (
        "Complete a sequência: 100, 90, 81, 73, ?",
        "sequencia_logica",
        ["64", "66", "68", "70"],
        1,
        "dificil",
        "Observe que a diferença entre os termos diminui 1 unidade a cada passo (10, 9, 8...).",
    ),
    (
        "Um relatório mostra que 3 em cada 10 candidatos avançam de etapa. Em um grupo de 250 candidatos, quantos avançam?",
        "interpretacao_numerica",
        ["65", "70", "75", "80"],
        2,
        "medio",
        "Calcule a proporção 3/10 aplicada a 250 candidatos: (3 ÷ 10) × 250.",
    ),
]


def ensure_raciocinio_tables(cursor) -> None:
    """Raciocinio logico/numerico: banco de questoes de multipla escolha com gabarito,
    dificuldade e feedback de erro opcional; aplicacoes e respostas por candidato.

    Aditivo e idempotente. Reflete V010__disc_fit_cultural_raciocinio_logico.sql.
    """
    cursor.execute(
        """
        IF OBJECT_ID('dbo.raciocinio_perguntas', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.raciocinio_perguntas (
                id_pergunta INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                enunciado NVARCHAR(MAX) NOT NULL,
                tipo NVARCHAR(30) NOT NULL,
                alternativas_json NVARCHAR(MAX) NOT NULL,
                gabarito INT NOT NULL,
                dificuldade NVARCHAR(20) NOT NULL,
                feedback_erro NVARCHAR(500) NULL,
                ativo BIT NOT NULL CONSTRAINT DF_raciocinio_perguntas_ativo DEFAULT 1,
                criado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )
    cursor.execute(
        """
        IF OBJECT_ID('dbo.raciocinio_aplicacoes', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.raciocinio_aplicacoes (
                id_aplicacao INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                id_teste NVARCHAR(60) NOT NULL,
                id_processo_ref INT NULL,
                perguntas_snapshot_json NVARCHAR(MAX) NOT NULL,
                tempo_limite_minutos INT NULL,
                status NVARCHAR(30) NOT NULL CONSTRAINT DF_raciocinio_aplicacoes_status DEFAULT 'Disponivel',
                iniciada_em DATETIME NULL,
                finalizada_em DATETIME NULL,
                resultado_json NVARCHAR(MAX) NULL,
                criada_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.raciocinio_aplicacoes', 'modo_adaptativo') IS NULL
        BEGIN
            ALTER TABLE dbo.raciocinio_aplicacoes
            ADD modo_adaptativo BIT NOT NULL CONSTRAINT DF_raciocinio_aplicacoes_modo_adaptativo DEFAULT 0
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.raciocinio_aplicacoes', 'nivel_vaga') IS NULL
        BEGIN
            ALTER TABLE dbo.raciocinio_aplicacoes
            ADD nivel_vaga NVARCHAR(20) NULL
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.raciocinio_aplicacoes', 'estado_adaptativo_json') IS NULL
        BEGIN
            ALTER TABLE dbo.raciocinio_aplicacoes
            ADD estado_adaptativo_json NVARCHAR(MAX) NULL
        END
        """
    )
    cursor.execute(
        """
        IF OBJECT_ID('dbo.raciocinio_respostas', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.raciocinio_respostas (
                id_resposta INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                aplicacao_id INT NOT NULL,
                pergunta_id INT NOT NULL,
                alternativa_marcada INT NULL,
                correta BIT NOT NULL CONSTRAINT DF_raciocinio_respostas_correta DEFAULT 0,
                respondido_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )

    cursor.execute("SELECT COUNT(*) FROM dbo.raciocinio_perguntas")
    row = cursor.fetchone()
    if (not row or int(row[0] or 0) == 0) and not conecta_reset_flag_ativo(cursor):
        for enunciado, tipo, alternativas, gabarito, dificuldade, feedback_erro in _RACIOCINIO_SEED:
            cursor.execute(
                """
                INSERT INTO dbo.raciocinio_perguntas
                (enunciado, tipo, alternativas_json, gabarito, dificuldade, feedback_erro, ativo, criado_em)
                VALUES (?, ?, ?, ?, ?, ?, 1, GETDATE())
                """,
                (enunciado, tipo, json.dumps(list(alternativas), ensure_ascii=False), gabarito, dificuldade, feedback_erro),
            )


_conecta_exams_tables_ready = False


def ensure_conecta_exams_tables(cursor) -> None:
    """Correções.txt item 2: esta checagem faz ~110 round-trips síncronos ao
    SQL Server (CREATE TABLE/ALTER TABLE condicionais) e era refeita em toda
    chamada de repositório de provas geradas, inclusive múltiplas vezes numa
    única requisição (ex.: salvar avaliação manual -> recalcular score ->
    registrar histórico), fazendo a tela travar ao salvar. O schema não muda
    em runtime, então validar uma vez por processo é suficiente."""
    global _conecta_exams_tables_ready
    if _conecta_exams_tables_ready:
        return
    cursor.execute(
        """
        IF OBJECT_ID('dbo.provas_geradas', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.provas_geradas (
                id_prova INT IDENTITY(1,1) PRIMARY KEY,
                id_teste NVARCHAR(120) NOT NULL,
                id_registro INT NULL,
                id_entrevista INT NULL,
                id_processo NVARCHAR(60) NULL,
                id_processo_ref NVARCHAR(255) NULL,
                nome_candidato NVARCHAR(255) NULL,
                email_acesso NVARCHAR(255) NULL,
                telefone_acesso NVARCHAR(50) NULL,
                cpf NVARCHAR(30) NULL,
                vaga NVARCHAR(255) NULL,
                operacao NVARCHAR(255) NULL,
                trilha NVARCHAR(120) NULL,
                nivel NVARCHAR(80) NULL,
                tempo_total INT NULL,
                quantidade_questoes INT NULL,
                etapas_json NVARCHAR(MAX) NULL,
                categorias_json NVARCHAR(MAX) NULL,
                competencias_json NVARCHAR(MAX) NULL,
                configuracao_json NVARCHAR(MAX) NULL,
                questoes_json NVARCHAR(MAX) NULL,
                instrucoes_operacao NVARCHAR(MAX) NULL,
                status NVARCHAR(80) NOT NULL DEFAULT 'Gerada',
                codigo_acesso NVARCHAR(4) NOT NULL,
                token_sessao_publica NVARCHAR(160) NULL,
                token_expira_em DATETIME NULL,
                metodo_acesso NVARCHAR(40) NULL,
                tentativas_acesso INT NULL,
                gerada_por NVARCHAR(180) NULL,
                gerada_em DATETIME NOT NULL DEFAULT GETDATE(),
                iniciada_em DATETIME NULL,
                revisada_em DATETIME NULL,
                finalizada_em DATETIME NULL,
                expira_em DATETIME NULL,
                reaberta_em DATETIME NULL,
                reaberta_por NVARCHAR(180) NULL,
                motivo_reabertura NVARCHAR(MAX) NULL,
                respostas_anteriores_mantidas BIT NULL,
                cancelada_em DATETIME NULL,
                cancelada_por NVARCHAR(180) NULL,
                motivo_cancelamento NVARCHAR(MAX) NULL,
                dados_confirmados_em DATETIME NULL,
                atualizado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )

    for column_name, sql_type in (
        ("id_teste", "NVARCHAR(120)"),
        ("id_registro", "INT"),
        ("id_processo", "NVARCHAR(60)"),
        ("id_processo_ref", "NVARCHAR(255)"),
        ("nome_candidato", "NVARCHAR(255)"),
        ("email_acesso", "NVARCHAR(255)"),
        ("telefone_acesso", "NVARCHAR(50)"),
        ("cpf", "NVARCHAR(30)"),
        ("vaga", "NVARCHAR(255)"),
        ("operacao", "NVARCHAR(255)"),
        ("trilha", "NVARCHAR(120)"),
        ("nivel", "NVARCHAR(80)"),
        ("tempo_total", "INT"),
        ("quantidade_questoes", "INT"),
        ("etapas_json", "NVARCHAR(MAX)"),
        ("categorias_json", "NVARCHAR(MAX)"),
        ("competencias_json", "NVARCHAR(MAX)"),
        ("configuracao_json", "NVARCHAR(MAX)"),
        ("questoes_json", "NVARCHAR(MAX)"),
        ("instrucoes_operacao", "NVARCHAR(MAX)"),
        ("status", "NVARCHAR(80)"),
        ("codigo_acesso", "NVARCHAR(4)"),
        ("token_sessao_publica", "NVARCHAR(160)"),
        ("token_expira_em", "DATETIME"),
        ("metodo_acesso", "NVARCHAR(40)"),
        ("login_method", "NVARCHAR(40)"),
        ("tentativas_acesso", "INT"),
        ("gerada_por", "NVARCHAR(180)"),
        ("gerada_em", "DATETIME"),
        ("iniciada_em", "DATETIME"),
        ("revisada_em", "DATETIME"),
        ("finalizada_em", "DATETIME"),
        ("expira_em", "DATETIME"),
        ("reaberta_em", "DATETIME"),
        ("reaberta_por", "NVARCHAR(180)"),
        ("motivo_reabertura", "NVARCHAR(MAX)"),
        ("respostas_anteriores_mantidas", "BIT"),
        ("cancelada_em", "DATETIME"),
        ("cancelada_por", "NVARCHAR(180)"),
        ("motivo_cancelamento", "NVARCHAR(MAX)"),
        ("dados_confirmados_em", "DATETIME"),
        ("atualizado_em", "DATETIME"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.provas_geradas', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.provas_geradas
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    cursor.execute(
        """
        IF NOT EXISTS (
            SELECT 1
            FROM sys.indexes
            WHERE name = 'UX_provas_geradas_codigo_acesso'
              AND object_id = OBJECT_ID('dbo.provas_geradas')
        )
        BEGIN
            CREATE UNIQUE INDEX UX_provas_geradas_codigo_acesso
            ON dbo.provas_geradas(codigo_acesso)
        END
        """
    )
    cursor.execute(
        """
        IF NOT EXISTS (
            SELECT 1
            FROM sys.indexes
            WHERE name = 'IX_provas_geradas_email_status'
              AND object_id = OBJECT_ID('dbo.provas_geradas')
        )
        BEGIN
            CREATE INDEX IX_provas_geradas_email_status
            ON dbo.provas_geradas(email_acesso, status)
        END
        """
    )

    cursor.execute(
        """
        IF OBJECT_ID('dbo.respostas_provas', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.respostas_provas (
                id_resposta INT IDENTITY(1,1) PRIMARY KEY,
                id_prova INT NOT NULL,
                id_teste NVARCHAR(120) NOT NULL,
                questao_indice INT NOT NULL,
                questao_id NVARCHAR(120) NULL,
                texto_questao_snapshot NVARCHAR(MAX) NULL,
                alternativas_snapshot NVARCHAR(MAX) NULL,
                resposta_json NVARCHAR(MAX) NULL,
                resposta_correta NVARCHAR(MAX) NULL,
                categoria NVARCHAR(120) NULL,
                peso DECIMAL(8,2) NULL,
                correta BIT NULL,
                nota DECIMAL(8,2) NULL,
                tempo_resposta_segundos INT NULL,
                respondida_em DATETIME NOT NULL DEFAULT GETDATE(),
                atualizado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )
    for column_name, sql_type in (
        ("id_prova", "INT"),
        ("id_teste", "NVARCHAR(120)"),
        ("questao_indice", "INT"),
        ("questao_id", "NVARCHAR(120)"),
        ("texto_questao_snapshot", "NVARCHAR(MAX)"),
        ("alternativas_snapshot", "NVARCHAR(MAX)"),
        ("resposta_json", "NVARCHAR(MAX)"),
        ("resposta_correta", "NVARCHAR(MAX)"),
        ("categoria", "NVARCHAR(120)"),
        ("peso", "DECIMAL(8,2)"),
        ("correta", "BIT"),
        ("nota", "DECIMAL(8,2)"),
        ("tempo_resposta_segundos", "INT"),
        ("respondida_em", "DATETIME"),
        ("atualizado_em", "DATETIME"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.respostas_provas', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.respostas_provas
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    cursor.execute(
        """
        IF OBJECT_ID('dbo.resultados_provas', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.resultados_provas (
                id_resultado INT IDENTITY(1,1) PRIMARY KEY,
                id_prova INT NOT NULL,
                id_teste NVARCHAR(120) NOT NULL,
                nota_objetiva DECIMAL(8,2) NULL,
                nota_redacao DECIMAL(8,2) NULL,
                nota_excel DECIMAL(8,2) NULL,
                nota_tecnica DECIMAL(8,2) NULL,
                nota_comunicacao DECIMAL(8,2) NULL,
                nota_lgpd DECIMAL(8,2) NULL,
                nota_final_prova DECIMAL(8,2) NULL,
                score_por_categoria_json NVARCHAR(MAX) NULL,
                resumo_etapas_json NVARCHAR(MAX) NULL,
                status_correcao NVARCHAR(80) NULL,
                pendente_avaliacao_manual BIT NULL,
                criado_em DATETIME NOT NULL DEFAULT GETDATE(),
                atualizado_em DATETIME NOT NULL DEFAULT GETDATE()
            )
        END
        """
    )
    for column_name, sql_type in (
        ("id_prova", "INT"),
        ("id_teste", "NVARCHAR(120)"),
        ("nota_objetiva", "DECIMAL(8,2)"),
        ("nota_redacao", "DECIMAL(8,2)"),
        ("nota_excel", "DECIMAL(8,2)"),
        ("nota_tecnica", "DECIMAL(8,2)"),
        ("nota_comunicacao", "DECIMAL(8,2)"),
        ("nota_lgpd", "DECIMAL(8,2)"),
        ("nota_final_prova", "DECIMAL(8,2)"),
        ("score_por_categoria_json", "NVARCHAR(MAX)"),
        ("resumo_etapas_json", "NVARCHAR(MAX)"),
        ("status_correcao", "NVARCHAR(80)"),
        ("pendente_avaliacao_manual", "BIT"),
        ("criado_em", "DATETIME"),
        ("atualizado_em", "DATETIME"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.resultados_provas', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.resultados_provas
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    cursor.execute(
        """
        IF OBJECT_ID('dbo.scores_conecta', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.scores_conecta (
                id_score INT IDENTITY(1,1) PRIMARY KEY,
                id_teste NVARCHAR(120) NOT NULL,
                id_prova INT NULL,
                id_processo NVARCHAR(60) NULL,
                id_processo_ref NVARCHAR(255) NULL,
                score_final DECIMAL(8,2) NULL,
                classificacao NVARCHAR(80) NULL,
                confiabilidade NVARCHAR(40) NULL,
                status_analise NVARCHAR(80) NULL,
                componentes_json NVARCHAR(MAX) NULL,
                pontos_fortes_json NVARCHAR(MAX) NULL,
                pontos_atencao_json NVARCHAR(MAX) NULL,
                alertas_criticos_json NVARCHAR(MAX) NULL,
                dados_ausentes_json NVARCHAR(MAX) NULL,
                justificativa NVARCHAR(MAX) NULL,
                calculado_em DATETIME NOT NULL DEFAULT GETDATE(),
                recalculado_por NVARCHAR(180) NULL,
                motivo_recalculo NVARCHAR(MAX) NULL
            )
        END
        """
    )
    for column_name, sql_type in (
        ("id_teste", "NVARCHAR(120)"),
        ("id_prova", "INT"),
        ("id_processo", "NVARCHAR(60)"),
        ("id_processo_ref", "NVARCHAR(255)"),
        ("score_final", "DECIMAL(8,2)"),
        ("classificacao", "NVARCHAR(80)"),
        ("confiabilidade", "NVARCHAR(40)"),
        ("status_analise", "NVARCHAR(80)"),
        ("componentes_json", "NVARCHAR(MAX)"),
        ("pontos_fortes_json", "NVARCHAR(MAX)"),
        ("pontos_atencao_json", "NVARCHAR(MAX)"),
        ("alertas_criticos_json", "NVARCHAR(MAX)"),
        ("dados_ausentes_json", "NVARCHAR(MAX)"),
        ("justificativa", "NVARCHAR(MAX)"),
        ("calculado_em", "DATETIME"),
        ("recalculado_por", "NVARCHAR(180)"),
        ("motivo_recalculo", "NVARCHAR(MAX)"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.scores_conecta', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.scores_conecta
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    cursor.execute(
        """
        IF OBJECT_ID('dbo.decisoes_rh', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.decisoes_rh (
                id_decisao INT IDENTITY(1,1) PRIMARY KEY,
                id_teste NVARCHAR(120) NOT NULL,
                id_processo NVARCHAR(60) NULL,
                id_processo_ref NVARCHAR(255) NULL,
                decisao NVARCHAR(80) NOT NULL,
                justificativa NVARCHAR(MAX) NULL,
                observacao NVARCHAR(MAX) NULL,
                usuario_responsavel NVARCHAR(180) NULL,
                data_decisao DATETIME NOT NULL DEFAULT GETDATE(),
                score_no_momento DECIMAL(8,2) NULL,
                classificacao_no_momento NVARCHAR(80) NULL,
                score_considerado BIT NULL
            )
        END
        """
    )
    for column_name, sql_type in (
        ("id_teste", "NVARCHAR(120)"),
        ("id_processo", "NVARCHAR(60)"),
        ("id_processo_ref", "NVARCHAR(255)"),
        ("decisao", "NVARCHAR(80)"),
        ("justificativa", "NVARCHAR(MAX)"),
        ("observacao", "NVARCHAR(MAX)"),
        ("usuario_responsavel", "NVARCHAR(180)"),
        ("data_decisao", "DATETIME"),
        ("score_no_momento", "DECIMAL(8,2)"),
        ("classificacao_no_momento", "NVARCHAR(80)"),
        ("score_considerado", "BIT"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.decisoes_rh', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.decisoes_rh
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    _conecta_exams_tables_ready = True


def ensure_interviews_table(cursor) -> None:
    cursor.execute(
        """
        IF OBJECT_ID('dbo.entrevistas_agendadas', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.entrevistas_agendadas (
                id_entrevista INT IDENTITY(1,1) PRIMARY KEY,
                id_processo NVARCHAR(60) NULL,
                id_processo_ref NVARCHAR(255) NULL,
                id_registro INT NULL,
                id_teste NVARCHAR(120) NULL,
                nome_candidato NVARCHAR(255) NULL,
                vaga NVARCHAR(255) NULL,
                data_entrevista DATETIME NULL,
                status_entrevista NVARCHAR(80) NULL,
                link_agendamento NVARCHAR(MAX) NULL,
                observacoes_rh NVARCHAR(MAX) NULL,
                mensagem_base NVARCHAR(MAX) NULL,
                id_slot INT NULL,
                mensagem_personalizada NVARCHAR(MAX) NULL,
                criado_em DATETIME NULL,
                atualizado_em DATETIME NULL
            )
        END
        """
    )

    for column_name, sql_type in (
        ("id_processo", "NVARCHAR(60)"),
        ("id_processo_ref", "NVARCHAR(255)"),
        ("id_registro", "INT"),
        ("id_teste", "NVARCHAR(120)"),
        ("nome_candidato", "NVARCHAR(255)"),
        ("vaga", "NVARCHAR(255)"),
        ("data_entrevista", "DATETIME"),
        ("status_entrevista", "NVARCHAR(80)"),
        ("link_agendamento", "NVARCHAR(MAX)"),
        ("observacoes_rh", "NVARCHAR(MAX)"),
        ("mensagem_base", "NVARCHAR(MAX)"),
        ("id_slot", "INT"),
        ("mensagem_personalizada", "NVARCHAR(MAX)"),
        ("criado_em", "DATETIME"),
        ("atualizado_em", "DATETIME"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.entrevistas_agendadas', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.entrevistas_agendadas
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    cursor.execute(
        """
        UPDATE dbo.entrevistas_agendadas
        SET criado_em = GETDATE()
        WHERE criado_em IS NULL
        """
    )

    cursor.execute(
        """
        UPDATE dbo.entrevistas_agendadas
        SET atualizado_em = GETDATE()
        WHERE atualizado_em IS NULL
        """
    )

def ensure_interview_slots_table(cursor) -> None:
    cursor.execute(
        """
        IF OBJECT_ID('dbo.entrevista_slots', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.entrevista_slots (
                id_slot INT IDENTITY(1,1) PRIMARY KEY,
                id_processo NVARCHAR(60) NULL,
                id_processo_ref NVARCHAR(255) NULL,
                vaga NVARCHAR(255) NULL,
                inicio DATETIME NULL,
                fim DATETIME NULL,
                capacidade_total INT NULL,
                status_slot NVARCHAR(30) NULL,
                id_entrevista INT NULL,
                observacoes_rh NVARCHAR(MAX) NULL,
                somente_dia BIT NULL,
                criado_em DATETIME NULL,
                atualizado_em DATETIME NULL
            )
        END
        """
    )

    for column_name, sql_type in (
        ("id_processo", "NVARCHAR(60)"),
        ("id_processo_ref", "NVARCHAR(255)"),
        ("vaga", "NVARCHAR(255)"),
        ("inicio", "DATETIME"),
        ("fim", "DATETIME"),
        ("capacidade_total", "INT"),
        ("status_slot", "NVARCHAR(30)"),
        ("id_entrevista", "INT"),
        ("observacoes_rh", "NVARCHAR(MAX)"),
        ("somente_dia", "BIT"),
        ("criado_em", "DATETIME"),
        ("atualizado_em", "DATETIME"),
    ):
        cursor.execute(
            f"""
            IF COL_LENGTH('dbo.entrevista_slots', '{column_name}') IS NULL
            BEGIN
                ALTER TABLE dbo.entrevista_slots
                ADD {column_name} {sql_type} NULL
            END
            """
        )

    cursor.execute(
        """
        UPDATE dbo.entrevista_slots
        SET capacidade_total = 1
        WHERE capacidade_total IS NULL OR capacidade_total < 1
        """
    )

    cursor.execute(
        """
        UPDATE dbo.entrevista_slots
        SET status_slot = 'Disponivel'
        WHERE status_slot IS NULL OR LTRIM(RTRIM(status_slot)) = ''
        """
    )

    cursor.execute(
        """
        UPDATE dbo.entrevista_slots
        SET somente_dia = 0
        WHERE somente_dia IS NULL
        """
    )

    cursor.execute(
        """
        UPDATE dbo.entrevista_slots
        SET criado_em = GETDATE()
        WHERE criado_em IS NULL
        """
    )

    cursor.execute(
        """
        UPDATE dbo.entrevista_slots
        SET atualizado_em = GETDATE()
        WHERE atualizado_em IS NULL
        """
    )

def _ensure_process_reference_column(cursor, table_name: str) -> None:
    safe_table = normalize_text(table_name)
    if not _SQL_IDENTIFIER_PATTERN.fullmatch(safe_table):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Não foi possível preparar a coluna de referência de processo.",
        )

    cursor.execute(
        f"""
        IF COL_LENGTH('dbo.{safe_table}', 'id_processo_ref') IS NULL
        BEGIN
            ALTER TABLE dbo.{safe_table}
            ADD id_processo_ref NVARCHAR(255) NULL
        END
        """
    )


def ensure_process_reference_columns(cursor) -> None:
    for table_name in (
        "historico_provas",
        "candidatos_processos",
        "entrevistas_agendadas",
        "cv_pre_analises",
        "banco_talentos",
    ):
        _ensure_process_reference_column(cursor, table_name)


def _get_column_type(cursor, table_name: str, column_name: str) -> str:
    safe_table = normalize_text(table_name)
    safe_column = normalize_text(column_name)

    for column in cursor.columns(table=safe_table, schema="dbo"):
        if normalize_compare_text(column.column_name) == normalize_compare_text(safe_column):
            return normalize_compare_text(column.type_name)

    return ""


def _ensure_nullable_decimal_column(cursor, table_name: str, column_name: str, *, precision: int, scale: int) -> None:
    safe_table = normalize_text(table_name)
    safe_column = normalize_text(column_name)

    if not _SQL_IDENTIFIER_PATTERN.fullmatch(safe_table) or not _SQL_IDENTIFIER_PATTERN.fullmatch(safe_column):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Não foi possível ajustar a tipagem numérica da tabela.",
        )

    current_type = _get_column_type(cursor, safe_table, safe_column)
    if current_type in {"decimal", "numeric", "float", "real"}:
        return

    if current_type not in {"int", "bigint", "smallint", "tinyint"}:
        return

    cursor.execute(
        f"""
        ALTER TABLE dbo.{safe_table}
        ALTER COLUMN {safe_column} DECIMAL({precision},{scale}) NULL
        """
    )


def ensure_decimal_process_columns(cursor) -> None:
    _ensure_nullable_decimal_column(
        cursor,
        "processos_seletivos",
        "nota_corte",
        precision=5,
        scale=1,
    )
    _ensure_nullable_decimal_column(
        cursor,
        "historico_provas",
        "pontuacao_final",
        precision=5,
        scale=1,
    )


def describe_database_error(error: Exception) -> str:
    parts = []

    for item in getattr(error, "args", ()):
        text = normalize_text(item)
        if text:
            parts.append(text)

    return " ".join(parts)


def is_deadlock_error(error: Exception) -> bool:
    safe_error = normalize_compare_text(describe_database_error(error))
    return "1205" in safe_error or "deadlock" in safe_error or "40001" in safe_error


def bootstrap_runtime_schema(settings: Settings, *, force: bool = False) -> bool:
    global _SCHEMA_BOOTSTRAPPED

    if _SCHEMA_BOOTSTRAPPED and not force:
        return False

    with _SCHEMA_BOOTSTRAP_LOCK:
        if _SCHEMA_BOOTSTRAPPED and not force:
            return False

        conn = get_connection(settings, autocommit=True)
        try:
            cursor = conn.cursor()
            ensure_security_tables(cursor, settings)
            ensure_reusable_config_tables(cursor)
            ensure_parametros_sistema_table(cursor)
            ensure_ambientes_sharepoint_table(cursor)
            ensure_operacoes_seed(cursor)
            ensure_user_operacoes_table(cursor)
            ensure_email_change_requests_table(cursor)
            ensure_process_columns(cursor)
            ensure_pipeline_columns(cursor)
            ensure_candidate_metadata_table(cursor)
            ensure_candidate_metadata_columns(cursor)
            ensure_candidate_attachments_table(cursor)
            ensure_curriculo_ia_table(cursor)
            ensure_talent_bank_table(cursor)
            ensure_email_inbox_items_table(cursor)
            ensure_cv_pre_analises_table(cursor)
            ensure_interviews_table(cursor)
            ensure_interview_slots_table(cursor)
            ensure_candidate_movements_table(cursor)
            ensure_process_dossier_notes_table(cursor)
            ensure_scorecards_table(cursor)
            ensure_conecta_exams_tables(cursor)
            ensure_exam_analytics_tables(cursor, create_if_missing=True)
            ensure_process_reference_columns(cursor)
            ensure_decimal_process_columns(cursor)
            ensure_policies_tables(cursor)
            ensure_celebratory_dates_table(cursor)
            ensure_notification_automation_table(cursor)
            ensure_onboarding_tables(cursor)
            ensure_candidate_training_link_column(cursor)
            ensure_process_trainings_table(cursor)
            ensure_document_templates_table(cursor)
            ensure_disc_tables(cursor)
            ensure_fit_cultural_tables(cursor)
            ensure_raciocinio_tables(cursor)
        finally:
            conn.close()

        _SCHEMA_BOOTSTRAPPED = True
        logger.info("Bootstrap de schema complementar do RH concluido com sucesso.")
        return True


def is_identity_column(cursor, table_name: str, column_name: str) -> bool:
    safe_table = normalize_text(table_name)
    safe_column = normalize_text(column_name)
    if not _SQL_IDENTIFIER_PATTERN.fullmatch(safe_table) or not _SQL_IDENTIFIER_PATTERN.fullmatch(safe_column):
        return False

    cursor.execute(
        """
        SELECT COLUMNPROPERTY(OBJECT_ID(?), ?, 'IsIdentity')
        """,
        (f"dbo.{safe_table}", safe_column),
    )
    row = cursor.fetchone()
    return bool(row and int(row[0] or 0) == 1)


def get_next_id_registro(cursor) -> int | None:
    if is_identity_column(cursor, "candidatos_processos", "id_registro"):
        return None
    return get_next_numeric_id(cursor, "candidatos_processos", "id_registro")


def insert_candidate_process_record(
    cursor,
    processo: dict | None = None,
    data: dict | None = None,
    *args,
    **kwargs,
) -> int:
    payload = {}
    for item in (data, *args):
        if isinstance(item, dict):
            payload.update(item)
    payload.update(kwargs)
    process_row = processo or payload.get("processo") or {}
    explicit_id = payload.get("id_registro")
    identity_id_registro = is_identity_column(cursor, "candidatos_processos", "id_registro")
    id_registro = None if identity_id_registro else int(explicit_id or get_next_id_registro(cursor) or 0)
    id_teste = normalize_text(payload.get("id_teste"))
    nome_candidato = normalize_text(payload.get("nome_candidato"))
    status_candidato = normalize_text(payload.get("status_candidato"))

    if not id_teste or not nome_candidato or not status_candidato:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Dados insuficientes para adicionar o candidato ao processo.",
        )

    ensure_candidate_approval_columns(cursor)
    indication_type = normalize_indication_type(payload.get("tipo_indicacao"))
    is_indication = bool(payload.get("eh_indicacao")) or bool(indication_type)
    if bool(payload.get("eh_indicacao")) and not indication_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selecione o tipo de indicação.",
        )

    columns = [
        "id_processo",
        "id_processo_ref",
        "id_teste",
        "nome_candidato",
        "vaga",
        "status_candidato",
        "pontuacao_final",
        "data_prova",
        "origem",
        "etapa_pipeline",
        "data_atualizacao_pipeline",
        "eh_indicacao",
        "tipo_indicacao",
        "indicacao_em",
        "indicado_por",
    ]
    values = [
        payload.get("id_processo") or process_row.get("id_processo"),
        payload.get("id_processo_ref") or process_row.get("id_processo_ref", ""),
        id_teste,
        nome_candidato,
        payload.get("vaga") or process_row.get("vaga") or "",
        status_candidato,
        payload.get("pontuacao_final"),
        payload.get("data_prova") or datetime.now().isoformat(),
        payload.get("origem") or "Pré-análise de CV",
        payload.get("etapa_pipeline") or "Prova",
        payload.get("data_atualizacao_pipeline") or datetime.now(),
        1 if is_indication else 0,
        indication_type,
        datetime.now() if is_indication else None,
        normalize_text(payload.get("indicado_por")),
    ]
    if not identity_id_registro:
        columns.insert(0, "id_registro")
        values.insert(0, id_registro)

    placeholders = ", ".join("?" for _ in columns)
    cursor.execute(
        f"""
        INSERT INTO candidatos_processos
        (
            {", ".join(columns)}
        )
        OUTPUT INSERTED.id_registro
        VALUES ({placeholders})
        """,
        tuple(values),
    )
    row = cursor.fetchone()
    return int(row[0] or id_registro or 0)


def get_next_numeric_id(cursor, table_name: str, column_name: str) -> int:
    safe_table = normalize_text(table_name)
    safe_column = normalize_text(column_name)

    if not _SQL_IDENTIFIER_PATTERN.fullmatch(safe_table) or not _SQL_IDENTIFIER_PATTERN.fullmatch(safe_column):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Não foi possível gerar o próximo identificador numérico solicitado.",
        )

    cursor.execute(f"SELECT ISNULL(MAX({safe_column}), 0) + 1 FROM {safe_table}")
    row = cursor.fetchone()
    return int(row[0] or 1)


def get_next_id_banco(cursor) -> int:
    return get_next_numeric_id(cursor, "banco_talentos", "id_banco")


def get_gabaritos_payload_column(cursor) -> str:
    columns = [col.column_name for col in cursor.columns(table="gabaritos", schema="dbo")]
    for name in ("payload_json", "playlaod_json"):
        if name in columns:
            return name

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"Coluna de payload não encontrada na tabela dbo.gabaritos. Colunas disponíveis: {columns}",
    )


def build_process_reference(id_processo: str | None, data_criacao: str | None) -> str:
    safe_process_id = normalize_text(id_processo)
    safe_created_at = normalize_text(data_criacao)

    if not safe_process_id:
        return ""
    if not safe_created_at:
        return safe_process_id

    return f"{safe_process_id}{PROCESS_REF_SEPARATOR}{safe_created_at}"


def split_process_reference(value: str | None) -> tuple[str, str]:
    safe_value = normalize_text(value)
    if not safe_value:
        return "", ""

    if PROCESS_REF_SEPARATOR not in safe_value:
        return safe_value, ""

    process_id, created_at = safe_value.split(PROCESS_REF_SEPARATOR, 1)
    return normalize_text(process_id), normalize_text(created_at)


def parse_process_datetime(value) -> datetime | None:
    if value in (None, ""):
        return None

    if isinstance(value, datetime):
        dt_value = value
    else:
        safe_value = normalize_text(value)
        if not safe_value:
            return None

        normalized = safe_value
        if normalized.endswith("Z"):
            normalized = f"{normalized[:-1]}+00:00"

        try:
            dt_value = datetime.fromisoformat(normalized)
        except ValueError:
            for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
                try:
                    dt_value = datetime.strptime(safe_value, fmt)
                    break
                except ValueError:
                    dt_value = None
            if dt_value is None:
                return None

    if dt_value.tzinfo is None:
        dt_value = dt_value.replace(tzinfo=LOCAL_TIMEZONE)

    return dt_value.astimezone(timezone.utc)


def decorate_process_row(row: dict | None) -> dict | None:
    if not row:
        return row

    decorated = dict(row)
    decorated["id_processo_ref"] = build_process_reference(
        decorated.get("id_processo"),
        decorated.get("data_criacao"),
    )
    return decorated


def sort_process_rows(rows: list[dict]) -> list[dict]:
    fallback = datetime.min.replace(tzinfo=timezone.utc)
    decorated = [decorate_process_row(row) for row in rows]
    return sorted(
        decorated,
        key=lambda item: (
            parse_process_datetime(item.get("data_criacao")) or fallback,
            normalize_text(item.get("id_processo")),
        ),
    )


def _select_process_row_from_rows(
    rows: list[dict],
    *,
    process_ref: str = "",
    timestamp_values: list | tuple | None = None,
) -> dict | None:
    if not rows:
        return None

    sorted_rows = sort_process_rows(rows)
    _, reference_created_at = split_process_reference(process_ref)

    if reference_created_at:
        for row in sorted_rows:
            if normalize_text(row.get("data_criacao")) == reference_created_at:
                return row

    timestamps = timestamp_values or []
    effective_timestamp = None
    for value in timestamps:
        effective_timestamp = parse_process_datetime(value)
        if effective_timestamp is not None:
            break

    if effective_timestamp is None or len(sorted_rows) == 1:
        return sorted_rows[-1]

    first_start = parse_process_datetime(sorted_rows[0].get("data_criacao"))
    if first_start is not None and effective_timestamp < first_start:
        return sorted_rows[0]

    for index, row in enumerate(sorted_rows):
        row_start = parse_process_datetime(row.get("data_criacao"))
        next_start = (
            parse_process_datetime(sorted_rows[index + 1].get("data_criacao"))
            if index + 1 < len(sorted_rows)
            else None
        )
        if row_start is None:
            continue
        if effective_timestamp >= row_start and (next_start is None or effective_timestamp < next_start):
            return row

    return sorted_rows[-1]


def _select_process_query() -> str:
    return """
        SELECT
            id_processo,
            vaga,
            quantidade_vagas,
            vagas_preenchidas,
            data_encerramento,
            operacao,
            trilha,
            usa_nota_corte,
            nota_corte,
            status,
            data_criacao,
            link_agendamento,
            link_publico_slug,
            link_publico_token,
            link_publico_ativo,
            link_publico_criado_em,
            link_publico_desativado_em,
            descricao_publica,
            requisitos_publicos,
            responsabilidades_publicas,
            observacoes_publicas_vaga,
            configuracao_prova_json,
            prova_configurada_em,
            urgente,
            urgente_marcado_em,
            urgente_marcado_por,
            ia_analise_desabilitada,
            detalhes_vaga_json
        FROM processos_seletivos
    """


def get_process_rows(cursor, id_processo_or_ref: str | None = None) -> list[dict]:
    safe_process_id, _ = split_process_reference(id_processo_or_ref)
    query = _select_process_query()
    params = []

    if safe_process_id:
        query += " WHERE id_processo = ?"
        params.append(safe_process_id)

    query += " ORDER BY data_criacao ASC, id_processo ASC"
    cursor.execute(query, tuple(params))
    rows = rows_to_dicts(cursor, cursor.fetchall())
    _auto_close_expired_processes(cursor, rows)
    return sort_process_rows(rows)


def _auto_close_expired_processes(cursor, rows: list[dict]) -> None:
    """Encerra automaticamente, ao ler os processos, qualquer processo aberto
    cuja data de encerramento já tenha passado (não altera status definidos
    manualmente como Pausado/Cancelado/Encerrado)."""
    updated = False
    for row in rows:
        current_status = row.get("status")
        effective_status = resolve_effective_process_status(current_status, row.get("data_encerramento"))
        if effective_status == PROCESS_STATUS_CLOSED and normalize_process_status(current_status) != PROCESS_STATUS_CLOSED:
            cursor.execute(
                "UPDATE processos_seletivos SET status = ? WHERE id_processo = ? AND data_criacao = ?",
                (PROCESS_STATUS_CLOSED, row.get("id_processo"), row.get("data_criacao")),
            )
            row["status"] = PROCESS_STATUS_CLOSED
            updated = True
    if updated:
        cursor.connection.commit()


def get_process_row(cursor, id_processo_or_ref: str):
    safe_process_id, safe_created_at = split_process_reference(id_processo_or_ref)
    if not safe_process_id:
        return None

    rows = get_process_rows(cursor, safe_process_id)
    if not rows:
        return None

    if safe_created_at:
        for row in rows:
            if normalize_text(row.get("data_criacao")) == safe_created_at:
                return row

    return rows[-1]


def resolve_process_row_for_related_record(
    cursor,
    *,
    id_processo: str,
    id_processo_ref: str = "",
    timestamp_values: list | tuple | None = None,
):
    safe_process_id = normalize_text(id_processo)
    if not safe_process_id:
        return None

    rows = get_process_rows(cursor, safe_process_id)
    return _select_process_row_from_rows(
        rows,
        process_ref=id_processo_ref,
        timestamp_values=timestamp_values,
    )


def build_process_where_clause(process_row_or_ref) -> tuple[str, tuple]:
    if isinstance(process_row_or_ref, dict):
        safe_process_id = normalize_text(process_row_or_ref.get("id_processo"))
        safe_created_at = normalize_text(process_row_or_ref.get("data_criacao"))
    else:
        safe_process_id, safe_created_at = split_process_reference(process_row_or_ref)

    if not safe_process_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Identificador do processo não informado.",
        )

    if safe_created_at:
        return "id_processo = ? AND data_criacao = ?", (safe_process_id, safe_created_at)

    return "id_processo = ?", (safe_process_id,)


def generate_unique_process_id(cursor, requested_process_id: str) -> str:
    base_process_id = normalize_text(requested_process_id)
    if not base_process_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Identificador base do processo não informado.",
        )

    cursor.execute(
        """
        SELECT id_processo
        FROM processos_seletivos
        WHERE id_processo = ? OR id_processo LIKE ?
        """,
        (base_process_id, f"{base_process_id}-%"),
    )
    existing_ids = {
        normalize_text(row[0])
        for row in cursor.fetchall()
        if normalize_text(row[0])
    }

    if base_process_id not in existing_ids:
        return base_process_id

    suffix = 2
    while True:
        candidate = f"{base_process_id}-{suffix:02d}"
        if candidate not in existing_ids:
            return candidate
        suffix += 1


def process_auto_close_if_full(cursor, process_row_or_ref) -> None:
    where_clause, params = build_process_where_clause(process_row_or_ref)
    cursor.execute(
        f"""
        SELECT quantidade_vagas, vagas_preenchidas, status
        FROM processos_seletivos
        WHERE {where_clause}
        """,
        params,
    )
    row = cursor.fetchone()
    if not row:
        return

    quantidade_vagas = int(row[0] or 0)
    vagas_preenchidas = int(row[1] or 0)
    status_processo = normalize_text(row[2])

    if (
        status_processo not in {PROCESS_STATUS_CLOSED, PROCESS_STATUS_TRAINING}
        and quantidade_vagas > 0
        and vagas_preenchidas >= quantidade_vagas
    ):
        # Pedido do RH: vagas preenchidas não encerram mais o processo — ele
        # vira "Em treinamento" (o link público ainda é desativado, já que
        # não há mais vagas para receber novas candidaturas).
        cursor.execute(
            f"""
            UPDATE processos_seletivos
            SET
                status = ?,
                link_publico_ativo = 0,
                link_publico_desativado_em = GETDATE()
            WHERE {where_clause}
            """,
            (PROCESS_STATUS_TRAINING, *params),
        )
