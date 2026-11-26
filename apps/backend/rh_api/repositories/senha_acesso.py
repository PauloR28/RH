"""Fluxo de senha do acesso por Login (aprovado pelo Paulo em 26/nov/2026).

Doc: CONECTA_REBRANDING/27_SENHA_E_ACESSO/Fluxo_de_Senha.md. Aqui ficam as partes que o login, o "Esqueci a senha" e a
redefinição pelo admin dividem:

  * bloqueio por 5 senhas erradas seguidas (15 min) e aviso ao TI;
  * senha provisória do operador (vai ao supervisor; vale 24 h e uma vez, só para criar a senha nova);
  * código por e-mail de quem não é operador (15 min, uma vez, 5 erros cancela);
  * uma conta, um computador por vez (número de sessão em `usuarios.sessao_web_id`);
  * tudo registrado na Auditoria (modulo "Autenticação") e avisado ao TI conforme Notificações › Avançada.

Só o hash da senha provisória e do código fica guardado. O e-mail do TI nunca leva senha nem código.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from fastapi import HTTPException, status

from ..passwords import hash_password, verify_password
from ..services import notificacao_ti, senha_politica, sessao_unica
from ..services.helpers import normalize_text, rows_to_dicts
from .senha_acesso_schema import ensure_senha_acesso_schema

logger = logging.getLogger(__name__)

MODULO = "Autenticação"
PERFIL_OPERADOR = "operador"

MSG_NAO_ENCONTRADO = "Não encontramos esse e-mail ou login. Confira se digitou certo. Se continuar, fale com o TI."
MSG_MICROSOFT = (
    "Não foi possível fazer a redefinição da sua senha. Sua conta usa autenticação pela conta Microsoft. "
    "Acione o TI da sua empresa para auxiliá-lo."
)
MSG_INATIVA = "Seu acesso ao Conecta está desativado. Fale com o TI."
MSG_CODIGO_VENCIDO = "Esse código venceu ou já foi usado. Peça um código novo."
MSG_TEMPORARIA_VENCIDA = (
    "Sua senha temporária venceu. Peça uma nova ao administrador ou use \"Esqueci a senha\"."
)


def _agora() -> datetime:
    return datetime.now()


def _hora(quando: datetime | None) -> str:
    return quando.strftime("%d/%m às %H:%M") if quando else ""


def _nome_completo(linha: dict) -> str:
    return " ".join(p for p in (normalize_text(linha.get("nome")), normalize_text(linha.get("sobrenome"))) if p)


class SenhaAcessoRepositoryMixin:
    """Usado por SecurityRepositoryMixin (login) e pelas rotas /auth/recuperar/* e /settings/users/*/password."""

    # ---------------------------------------------------------------- estado da conta
    def _sa_estado(self, cursor, id_usuario: int) -> dict:
        ensure_senha_acesso_schema(cursor)
        cursor.execute(
            "SELECT ISNULL(falhas_login, 0), bloqueado_ate, senha_temporaria_expira_em, sessao_web_id, ultimo_acesso_em "
            "FROM dbo.usuarios WHERE id_usuario = ?",
            (int(id_usuario),),
        )
        row = cursor.fetchone()
        if not row:
            return {"falhas_login": 0, "bloqueado_ate": None, "senha_temporaria_expira_em": None,
                    "sessao_web_id": None, "ultimo_acesso_em": None}
        return {"falhas_login": int(row[0] or 0), "bloqueado_ate": row[1], "senha_temporaria_expira_em": row[2],
                "sessao_web_id": row[3], "ultimo_acesso_em": row[4]}

    def _sa_dados_aviso(self, cursor, linha: dict, *, feito_por: str = "", motivo: str = "", ip: str = "") -> dict:
        operacao = ""
        try:
            cursor.execute(
                "SELECT TOP 1 operacao FROM dbo.usuarios_operacoes WHERE id_usuario = ? ORDER BY operacao",
                (int(linha.get("id_usuario") or 0),),
            )
            r = cursor.fetchone() if cursor.description else None
            operacao = normalize_text(r[0]) if r else ""
        except Exception:  # noqa: BLE001 - só informativo
            operacao = ""
        return {
            "conta_nome": _nome_completo(linha) or normalize_text(linha.get("login")),
            "conta_login": normalize_text(linha.get("login")) or normalize_text(linha.get("email")),
            "perfil": normalize_text(linha.get("perfil_nome")) or normalize_text(linha.get("perfil_id")),
            "operacao": operacao or "—",
            "feito_por": feito_por or "A própria pessoa",
            "motivo": motivo or "—",
            "data_hora": _agora().strftime("%d/%m/%Y às %H:%M"),
            "ip": ip or "—",
        }

    def _sa_auditar(self, cursor, *, linha: dict | None, acao: str, justificativa: str = "", origem: str = "",
                    sucesso: bool = True, ator=None, entidade_id: str = "") -> None:
        linha = linha or {}
        self._insert_audit_log(
            cursor,
            user=ator or {"id_usuario": linha.get("id_usuario"), "nome": _nome_completo(linha) or linha.get("login"),
                          "email": linha.get("email") or linha.get("login")},
            modulo=MODULO,
            acao=acao,
            entidade="usuario",
            entidade_id=entidade_id or str(linha.get("id_usuario") or ""),
            justificativa=justificativa,
            origem=origem,
            sucesso=sucesso,
        )

    # ---------------------------------------------------------------- login
    def _sa_bloqueio(self, cursor, linha: dict, estado: dict, *, origem: str) -> HTTPException | None:
        """Conta bloqueada por senhas erradas? Registra e devolve o erro (quem chama grava e levanta)."""
        bloqueado_ate = estado.get("bloqueado_ate")
        if bloqueado_ate and bloqueado_ate > _agora():
            self._sa_auditar(cursor, linha=linha, acao="login_negado", justificativa="Conta bloqueada por senhas erradas.",
                             origem=origem, sucesso=False)
            return HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Conta bloqueada por senhas erradas. Tente de novo às {bloqueado_ate:%H:%M} ou fale com o TI.",
            )
        return None

    def _sa_usar_provisoria(self, cursor, linha: dict, senha: str, *, origem: str) -> bool:
        """Senha errada? Pode ser a provisória que o supervisor recebeu. Se for, vira a senha da conta (troca obrigatória)."""
        cursor.execute(
            "SELECT id_recuperacao, segredo_hash FROM dbo.senha_recuperacoes "
            "WHERE id_usuario = ? AND tipo = 'provisoria' AND usado_em IS NULL AND cancelado_em IS NULL AND expira_em > GETDATE()",
            (int(linha["id_usuario"]),),
        )
        for id_recuperacao, segredo_hash in cursor.fetchall():
            if verify_password(senha, segredo_hash):
                cursor.execute("UPDATE dbo.senha_recuperacoes SET usado_em = GETDATE() WHERE id_recuperacao = ?",
                               (int(id_recuperacao),))
                cursor.execute(
                    "UPDATE dbo.usuarios SET senha_hash = ?, deve_trocar_senha = 1, senha_temporaria_expira_em = NULL, "
                    "atualizado_em = GETDATE() WHERE id_usuario = ?",
                    (segredo_hash, int(linha["id_usuario"])),
                )
                linha["deve_trocar_senha"] = True
                self._sa_auditar(cursor, linha=linha, acao="login_senha_provisoria",
                                 justificativa="Entrou com a senha provisória enviada ao supervisor.", origem=origem)
                return True
        return False

    def _sa_registrar_erro(self, cursor, linha: dict, estado: dict, *, origem: str) -> None:
        falhas = int(estado.get("falhas_login") or 0) + 1
        if falhas >= senha_politica.ERROS_PARA_BLOQUEIO:
            ate = _agora() + timedelta(minutes=senha_politica.BLOQUEIO_MINUTOS)
            cursor.execute("UPDATE dbo.usuarios SET falhas_login = 0, bloqueado_ate = ? WHERE id_usuario = ?",
                           (ate, int(linha["id_usuario"])))
            self._sa_auditar(cursor, linha=linha, acao="conta_bloqueada",
                             justificativa=f"{falhas} senhas erradas seguidas. Bloqueada até {ate:%H:%M}.",
                             origem=origem, sucesso=False)
            notificacao_ti.disparar(self, cursor, "conta_bloqueada", self._sa_dados_aviso(cursor, linha, ip=origem))
        else:
            cursor.execute("UPDATE dbo.usuarios SET falhas_login = ? WHERE id_usuario = ?", (falhas, int(linha["id_usuario"])))

    def _sa_temporaria_vencida(self, cursor, linha: dict, estado: dict, *, origem: str) -> HTTPException | None:
        expira = estado.get("senha_temporaria_expira_em")
        if linha.get("deve_trocar_senha") and expira and expira < _agora():
            self._sa_auditar(cursor, linha=linha, acao="login_negado", justificativa="Senha temporária vencida.",
                             origem=origem, sucesso=False)
            return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=MSG_TEMPORARIA_VENCIDA)
        return None

    def _sa_abrir_sessao(self, cursor, linha: dict, estado: dict, *, origem: str) -> str:
        """Login aceito: zera os erros e abre a sessão web nova (a anterior, em outro computador, cai)."""
        sid = sessao_unica.novo_id()
        anterior = normalize_text(estado.get("sessao_web_id"))
        cursor.execute(
            "UPDATE dbo.usuarios SET falhas_login = 0, bloqueado_ate = NULL, sessao_web_id = ? WHERE id_usuario = ?",
            (sid, int(linha["id_usuario"])),
        )
        if anterior and not anterior.startswith(sessao_unica.PREFIXO_ENCERRADA) and self._sa_sessao_ainda_aberta(estado):
            self._sa_auditar(cursor, linha=linha, acao="sessao_substituida",
                             justificativa="A conta foi aberta em outro computador; a sessão anterior foi encerrada.",
                             origem=origem)
            notificacao_ti.disparar(self, cursor, "sessao_substituida", self._sa_dados_aviso(cursor, linha, ip=origem))
        return sid

    def _sa_sessao_ainda_aberta(self, estado: dict) -> bool:
        ultimo = estado.get("ultimo_acesso_em")
        if not ultimo:
            return False
        try:
            from ..services.seguranca_config import sessao_maxima_minutos

            minutos = sessao_maxima_minutos(self.settings.auth_token_ttl_minutes)
        except Exception:  # noqa: BLE001
            minutos = 720
        return ultimo > _agora() - timedelta(minutes=int(minutos))

    def abrir_sessao_web(self, id_usuario: int | None, *, origem: str = "") -> str:
        """Login pela Microsoft (o login por senha abre dentro de authenticate_system_user)."""
        if not id_usuario:
            return ""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            estado = self._sa_estado(cursor, int(id_usuario))
            linha = self._sa_linha_por_id(cursor, int(id_usuario)) or {"id_usuario": int(id_usuario)}
            sid = self._sa_abrir_sessao(cursor, linha, estado, origem=origem)
            conn.commit()
        finally:
            conn.close()
        sessao_unica.registrar(id_usuario, sid)
        return sid

    def _sa_encerrar_sessoes(self, cursor, id_usuario: int, *, manter: str = "") -> str:
        """Troca de senha: fecha a sessão aberta. `manter` = sessão de quem trocou a própria senha (continua dentro)."""
        sid = manter or sessao_unica.id_encerrada()
        ensure_senha_acesso_schema(cursor)
        cursor.execute(
            "UPDATE dbo.usuarios SET sessao_web_id = ?, falhas_login = 0, bloqueado_ate = NULL WHERE id_usuario = ?",
            (sid, int(id_usuario)),
        )
        return sid

    # ---------------------------------------------------------------- busca
    _SA_CAMPOS = (
        "u.id_usuario, u.login, u.nome, u.sobrenome, u.email, u.perfil_id, p.nome AS perfil_nome, u.status, "
        "u.provedor_autenticacao, u.id_equipe"
    )

    def _sa_linha_por_id(self, cursor, id_usuario: int) -> dict | None:
        cursor.execute(
            f"SELECT TOP 1 {self._SA_CAMPOS} FROM dbo.usuarios u LEFT JOIN dbo.perfis p ON p.id_perfil = u.perfil_id "  # nosec B608
            "WHERE u.id_usuario = ?",
            (int(id_usuario),),
        )
        row = cursor.fetchone()
        return rows_to_dicts(cursor, [row])[0] if row else None

    def _sa_linha_por_identificador(self, cursor, identificador: str) -> dict | None:
        cursor.execute(
            f"SELECT TOP 1 {self._SA_CAMPOS} FROM dbo.usuarios u LEFT JOIN dbo.perfis p ON p.id_perfil = u.perfil_id "  # nosec B608
            "WHERE LOWER(u.login) = LOWER(?) OR LOWER(u.email) = LOWER(?) ORDER BY u.id_usuario",
            (identificador, identificador),
        )
        row = cursor.fetchone()
        return rows_to_dicts(cursor, [row])[0] if row else None

    def _sa_supervisor(self, cursor, linha: dict) -> dict | None:
        """Supervisor responsável pela equipe do operador; sem equipe, o vínculo antigo usuarios_supervisores."""
        consultas = []
        if linha.get("id_equipe"):
            consultas.append((
                "SELECT TOP 1 s.id_usuario, s.nome, s.sobrenome, s.email, e.nome, e.operacao FROM dbo.equipes_operacao e "
                "JOIN dbo.usuarios s ON s.id_usuario = e.id_supervisor WHERE e.id_equipe = ? AND s.status = 'Ativo'",
                (int(linha["id_equipe"]),),
            ))
        consultas.append((
            "SELECT TOP 1 s.id_usuario, s.nome, s.sobrenome, s.email, NULL, NULL FROM dbo.usuarios_supervisores us "
            "JOIN dbo.usuarios s ON s.id_usuario = us.id_supervisor WHERE us.id_operador = ? AND s.status = 'Ativo'",
            (int(linha["id_usuario"]),),
        ))
        for sql, params in consultas:
            try:
                cursor.execute(sql, params)
                r = cursor.fetchone()
            except Exception:  # noqa: BLE001 - tabela ausente em base antiga
                r = None
            if r and normalize_text(r[3]):
                return {"id_usuario": int(r[0]), "nome": _nome_completo({"nome": r[1], "sobrenome": r[2]}),
                        "email": normalize_text(r[3]), "equipe": normalize_text(r[4]), "operacao": normalize_text(r[5])}
        return None

    # ---------------------------------------------------------------- Esqueci a senha
    def iniciar_recuperacao_senha(self, identificador: str, *, origem: str = "") -> dict:
        """1º passo do "Esqueci a senha". Operador: senha provisória ao supervisor. Os demais: código por e-mail."""
        from ..services import emails_senha

        alvo = normalize_text(identificador)
        if not alvo:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Digite seu e-mail ou login.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_senha_acesso_schema(cursor)
            linha = self._sa_linha_por_identificador(cursor, alvo)
            if not linha:
                self._sa_auditar(cursor, linha={"login": alvo, "email": alvo}, acao="senha_esqueci_negado",
                                 justificativa="E-mail ou login não cadastrado.", origem=origem, sucesso=False,
                                 entidade_id=alvo[:120])
                conn.commit()
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=MSG_NAO_ENCONTRADO)
            if normalize_text(linha.get("status")).lower() != "ativo":
                self._sa_auditar(cursor, linha=linha, acao="senha_esqueci_negado", justificativa="Conta desativada.",
                                 origem=origem, sucesso=False)
                notificacao_ti.disparar(self, cursor, "login_conta_parada", self._sa_dados_aviso(cursor, linha, ip=origem))
                conn.commit()
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=MSG_INATIVA)
            provedor = normalize_text(linha.get("provedor_autenticacao")).lower()
            if provedor == "microsoft":
                self._sa_auditar(cursor, linha=linha, acao="senha_esqueci_negado",
                                 justificativa="Conta entra pela Microsoft.", origem=origem, sucesso=False)
                conn.commit()
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=MSG_MICROSOFT)

            # Pedido novo cancela os anteriores (só o último vale).
            cursor.execute(
                "UPDATE dbo.senha_recuperacoes SET cancelado_em = GETDATE() "
                "WHERE id_usuario = ? AND usado_em IS NULL AND cancelado_em IS NULL",
                (int(linha["id_usuario"]),),
            )
            agora = _agora()
            operador = normalize_text(linha.get("perfil_id")).lower() == PERFIL_OPERADOR
            if operador:
                resposta = self._sa_pedido_operador(cursor, linha, agora, origem=origem)
            else:
                email = normalize_text(linha.get("email"))
                if not email:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Sua conta não tem e-mail cadastrado. Fale com o TI.",
                    )
                codigo = senha_politica.gerar_codigo()
                expira = agora + timedelta(minutes=senha_politica.CODIGO_MINUTOS)
                cursor.execute(
                    "INSERT INTO dbo.senha_recuperacoes (id_usuario, tipo, segredo_hash, enviado_para, expira_em, origem) "
                    "VALUES (?, 'codigo', ?, ?, ?, ?)",
                    (int(linha["id_usuario"]), hash_password(codigo), email, expira, origem[:64] or None),
                )
                emails_senha.enviar(
                    self.settings, "codigo_recuperacao", [email],
                    {"nome": normalize_text(linha.get("nome")) or "", "codigo": codigo,
                     "data_hora": agora.strftime("%d/%m/%Y às %H:%M")},
                    esperar=True,
                )
                resposta = {"tipo": "codigo", "email_mascarado": senha_politica.mascarar_email(email),
                            "validade_minutos": senha_politica.CODIGO_MINUTOS}
                self._sa_auditar(cursor, linha=linha, acao="senha_esqueci_pedido",
                                 justificativa=f"Código enviado para {resposta['email_mascarado']}.", origem=origem)
            notificacao_ti.disparar(self, cursor, "esqueci_senha", self._sa_dados_aviso(
                cursor, linha, ip=origem,
                motivo="Senha provisória enviada ao supervisor." if operador else "Código enviado ao e-mail da pessoa.",
            ))
            conn.commit()
            return resposta
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Falha no pedido de \"Esqueci a senha\".")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Não foi possível enviar agora. Tente de novo em alguns minutos.",
            ) from exc
        finally:
            conn.close()

    def registrar_limite_recuperacao(self, identificador: str, *, origem: str = "") -> None:
        """Passou do limite de pedidos do "Esqueci a senha": registra e avisa o TI (S4)."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            linha = self._sa_linha_por_identificador(cursor, identificador) if identificador else None
            linha = linha or {"login": identificador, "email": identificador}
            self._sa_auditar(cursor, linha=linha, acao="senha_pedidos_limite", origem=origem, sucesso=False,
                             justificativa="Limite de pedidos de \"Esqueci a senha\" atingido.",
                             entidade_id=str(linha.get("id_usuario") or identificador)[:120])
            notificacao_ti.disparar(self, cursor, "pedidos_limite", self._sa_dados_aviso(cursor, linha, ip=origem))
            conn.commit()
        finally:
            conn.close()

    def _sa_pedido_operador(self, cursor, linha: dict, agora: datetime, *, origem: str) -> dict:
        from ..services import emails_senha

        supervisor = self._sa_supervisor(cursor, linha)
        provisoria = senha_politica.gerar_senha()
        expira = agora + timedelta(hours=senha_politica.PROVISORIA_HORAS)
        if supervisor:
            para = [supervisor["email"]]
            tipo = "supervisor"
        else:
            # Operador sem supervisor com e-mail: a senha provisória vai a quem recebe os avisos de Senhas no TI.
            config = notificacao_ti.ler()
            para = [d["email"] for d in config["destinatarios"] if d["testado"] and d["grupos"].get("senhas")]
            tipo = "ti"
            if not para:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Não encontramos o seu supervisor no Conecta. Fale com o TI.",
                )
        cursor.execute(
            "INSERT INTO dbo.senha_recuperacoes (id_usuario, tipo, segredo_hash, enviado_para, id_destinatario, expira_em, origem) "
            "VALUES (?, 'provisoria', ?, ?, ?, ?, ?)",
            (int(linha["id_usuario"]), hash_password(provisoria), ", ".join(para)[:255],
             supervisor["id_usuario"] if supervisor else None, expira, origem[:64] or None),
        )
        emails_senha.enviar(
            self.settings, "senha_provisoria_supervisor", para,
            {
                "supervisor_nome": (supervisor or {}).get("nome") or "equipe de TI",
                "operador_nome": _nome_completo(linha) or normalize_text(linha.get("login")),
                "operador_login": normalize_text(linha.get("login")),
                "equipe": (supervisor or {}).get("equipe") or "—",
                "operacao": (supervisor or {}).get("operacao") or "—",
                "senha_provisoria": provisoria,
                "validade": expira.strftime("%d/%m às %H:%M"),
                "data_hora": agora.strftime("%d/%m/%Y às %H:%M"),
            },
            esperar=True,
        )
        self._sa_auditar(
            cursor, linha=linha, acao="senha_esqueci_pedido", origem=origem,
            justificativa=("Senha provisória enviada ao supervisor " + supervisor["nome"]) if supervisor
            else "Senha provisória enviada ao TI (operador sem supervisor com e-mail).",
        )
        # A tela do operador não mostra o e-mail do supervisor (S8).
        return {"tipo": tipo, "validade": expira.strftime("%d/%m às %H:%M")}

    def concluir_recuperacao_senha(self, identificador: str, codigo: str, nova_senha: str, *, origem: str = "") -> dict:
        """2º passo de quem não é operador: código do e-mail + senha nova."""

        alvo = normalize_text(identificador)
        senha_politica.validar(nova_senha)  # senha fraca não gasta tentativa do código
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_senha_acesso_schema(cursor)
            linha = self._sa_linha_por_identificador(cursor, alvo) if alvo else None
            if not linha:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=MSG_CODIGO_VENCIDO)
            cursor.execute(
                "SELECT TOP 1 id_recuperacao, segredo_hash, tentativas FROM dbo.senha_recuperacoes "
                "WHERE id_usuario = ? AND tipo = 'codigo' AND usado_em IS NULL AND cancelado_em IS NULL "
                "AND expira_em > GETDATE() ORDER BY criado_em DESC",
                (int(linha["id_usuario"]),),
            )
            pedido = cursor.fetchone()
            if not pedido:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=MSG_CODIGO_VENCIDO)
            id_recuperacao, segredo_hash, tentativas = int(pedido[0]), pedido[1], int(pedido[2] or 0)
            if not verify_password(normalize_text(codigo), segredo_hash):
                tentativas += 1
                if tentativas >= senha_politica.TENTATIVAS_CODIGO:
                    cursor.execute(
                        "UPDATE dbo.senha_recuperacoes SET tentativas = ?, cancelado_em = GETDATE() WHERE id_recuperacao = ?",
                        (tentativas, id_recuperacao),
                    )
                    self._sa_auditar(cursor, linha=linha, acao="senha_codigo_cancelado",
                                     justificativa="Código errado 5 vezes; código cancelado.", origem=origem, sucesso=False)
                    notificacao_ti.disparar(self, cursor, "codigo_errado", self._sa_dados_aviso(cursor, linha, ip=origem))
                    conn.commit()
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                        detail="Código errado 5 vezes. Peça um código novo.")
                cursor.execute("UPDATE dbo.senha_recuperacoes SET tentativas = ? WHERE id_recuperacao = ?",
                               (tentativas, id_recuperacao))
                conn.commit()
                restam = senha_politica.TENTATIVAS_CODIGO - tentativas
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Código errado. Você ainda tem {restam} tentativa{'s' if restam != 1 else ''}.",
                )
            cursor.execute("UPDATE dbo.senha_recuperacoes SET usado_em = GETDATE() WHERE id_recuperacao = ?", (id_recuperacao,))
            cursor.execute(
                "UPDATE dbo.usuarios SET senha_hash = ?, deve_trocar_senha = 0, senha_temporaria_expira_em = NULL, "
                "atualizado_em = GETDATE() WHERE id_usuario = ?",
                (hash_password(nova_senha), int(linha["id_usuario"])),
            )
            sid = self._sa_encerrar_sessoes(cursor, int(linha["id_usuario"]))
            self._sa_auditar(cursor, linha=linha, acao="senha_recuperada_codigo",
                             justificativa="Senha nova criada com o código do e-mail.", origem=origem)
            notificacao_ti.disparar(self, cursor, "senha_trocada", self._sa_dados_aviso(
                cursor, linha, ip=origem, motivo="Com o código do e-mail (Esqueci a senha)."))
            conn.commit()
        finally:
            conn.close()
        sessao_unica.registrar(linha["id_usuario"], sid)
        self._sa_avisar_pessoa(linha)
        return {"success": True, "message": "Senha criada. Entre com a senha nova."}

    def _sa_avisar_pessoa(self, linha: dict) -> None:
        """S10: e-mail "senha alterada" só para quem não é operador (operador não tem caixa de e-mail)."""
        from ..services import emails_senha

        if normalize_text(linha.get("perfil_id")).lower() == PERFIL_OPERADOR or not normalize_text(linha.get("email")):
            return
        try:
            emails_senha.enviar(self.settings, "aviso_senha_alterada", [linha["email"]], {
                "nome": normalize_text(linha.get("nome")), "data_hora": _agora().strftime("%d/%m/%Y às %H:%M"),
            })
        except Exception:  # noqa: BLE001
            logger.exception("Falha ao avisar a pessoa da troca de senha.")

    # ---------------------------------------------------------------- troca e redefinição
    def _sa_marcar_temporaria(self, cursor, id_usuario: int) -> None:
        """Senha definida pelo admin (criação ou Redefinir senha): troca obrigatória e validade de 7 dias."""
        ensure_senha_acesso_schema(cursor)
        cursor.execute(
            "UPDATE dbo.usuarios SET deve_trocar_senha = 1, senha_temporaria_expira_em = ?, falhas_login = 0, "
            "bloqueado_ate = NULL WHERE id_usuario = ?",
            (_agora() + timedelta(days=senha_politica.TEMPORARIA_DIAS), int(id_usuario)),
        )

    def _sa_depois_da_troca(self, cursor, id_usuario: int, *, acao: str, evento: str, manter_sessao: str = "",
                            ator=None, motivo: str = "", origem: str = "") -> tuple[str, dict]:
        sid = self._sa_encerrar_sessoes(cursor, id_usuario, manter=manter_sessao)
        linha = self._sa_linha_por_id(cursor, id_usuario) or {"id_usuario": id_usuario}
        feito_por = ""
        if ator is not None:
            feito_por = normalize_text(getattr(ator, "nome", "") or (ator.get("nome") if isinstance(ator, dict) else ""))
        notificacao_ti.disparar(self, cursor, evento, self._sa_dados_aviso(cursor, linha, feito_por=feito_por,
                                                                          motivo=motivo, ip=origem))
        return sid, linha

    # ---------------------------------------------------------------- Auditoria › Senhas e acessos
    def listar_senhas_acessos(self, *, tipo: str = "", periodo: str = "7d", resultado: str = "", busca: str = "",
                              pagina: int = 1, tamanho: int = 20) -> dict:
        """Tecnologia › Auditoria › Senhas e acessos: só os eventos de login, senha e sessão, filtrados no banco."""
        acoes = ACOES_POR_GRUPO.get(tipo) or tuple(a for g in ACOES_POR_GRUPO.values() for a in g)
        dias = {"hoje": 0, "7d": 7, "30d": 30, "90d": 90}.get(periodo, 7)
        inicio = datetime.combine(_agora().date() - timedelta(days=dias), datetime.min.time())
        pagina = max(int(pagina or 1), 1)
        tamanho = min(max(int(tamanho or 20), 5), 100)
        marcas = ", ".join("?" for _ in acoes)
        filtros = [f"l.acao IN ({marcas})", "l.data_hora >= ?"]
        params: list = [*acoes, inicio]
        if resultado in ("sucesso", "falha"):
            filtros.append("l.sucesso = ?")
            params.append(1 if resultado == "sucesso" else 0)
        termo = normalize_text(busca)
        if termo:
            filtros.append("(l.nome_usuario LIKE ? OR l.email_usuario LIKE ? OR l.entidade_id LIKE ? OR u.nome LIKE ? "
                           "OR u.login LIKE ?)")
            params += [f"%{termo}%"] * 5
        onde = " AND ".join(filtros)
        juncao = ("LEFT JOIN dbo.usuarios u ON l.entidade = 'usuario' "
                  "AND CAST(u.id_usuario AS NVARCHAR(64)) = l.entidade_id")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(f"SELECT COUNT(1) FROM dbo.logs_auditoria l {juncao} WHERE {onde}", tuple(params))  # nosec B608
            total = int(cursor.fetchone()[0] or 0)
            cursor.execute(
                f"""
                SELECT l.id_log, l.data_hora, l.acao, l.nome_usuario, l.email_usuario, l.entidade_id, l.justificativa,
                       l.origem, l.sucesso, u.nome AS conta_nome, u.sobrenome AS conta_sobrenome, u.login AS conta_login,
                       u.id_usuario AS conta_id
                FROM dbo.logs_auditoria l {juncao}
                WHERE {onde}
                ORDER BY l.data_hora DESC, l.id_log DESC
                OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
                """,  # nosec B608
                (*params, (pagina - 1) * tamanho, tamanho),
            )
            linhas = rows_to_dicts(cursor, cursor.fetchall())
        finally:
            conn.close()
        itens = []
        for r in linhas:
            conta = _nome_completo({"nome": r.get("conta_nome"), "sobrenome": r.get("conta_sobrenome")})
            feito = normalize_text(r.get("nome_usuario"))
            proprio = r.get("conta_id") is not None and feito in (conta, normalize_text(r.get("conta_nome")))
            itens.append({
                "id": r.get("id_log"),
                "quando": r["data_hora"].isoformat() if r.get("data_hora") else "",
                "acao": r.get("acao"),
                "evento": ROTULOS_ACAO.get(normalize_text(r.get("acao")), normalize_text(r.get("acao"))),
                "conta": conta or normalize_text(r.get("entidade_id")),
                "conta_login": normalize_text(r.get("conta_login")),
                "feito_por": "A própria pessoa" if (proprio or not feito) else feito,
                "detalhe": normalize_text(r.get("justificativa")),
                "rede": normalize_text(r.get("origem")),
                "sucesso": bool(r.get("sucesso")),
            })
        return {"itens": itens, "total": total, "pagina": pagina, "tamanho": tamanho,
                "paginas": max((total + tamanho - 1) // tamanho, 1)}

    def exportar_senhas_acessos_csv(self, **filtros) -> tuple[str, str]:
        import csv
        import io

        saida = io.StringIO()
        escritor = csv.writer(saida, delimiter=";")
        escritor.writerow(["Quando", "Evento", "Conta", "Login", "Feito por", "Rede", "Resultado", "Detalhe"])
        pagina = 1
        while True:
            dados = self.listar_senhas_acessos(**filtros, pagina=pagina, tamanho=100)
            for i in dados["itens"]:
                escritor.writerow([i["quando"], i["evento"], i["conta"], i["conta_login"], i["feito_por"], i["rede"],
                                   "Deu certo" if i["sucesso"] else "Negado", i["detalhe"]])
            if pagina >= dados["paginas"] or pagina >= 50:
                break
            pagina += 1
        return f"senhas_e_acessos_{_agora():%Y%m%d_%H%M}.csv", "﻿" + saida.getvalue()

    def resumo_senhas_acessos(self, dia: datetime) -> list[tuple[str, int, int]]:
        """Resumo do dia (para o e-mail ao TI): [(evento, deu certo, negado)] dos eventos marcados como "Resumo do dia"."""
        config = notificacao_ti.ler()
        acoes = [a for chave, ev in notificacao_ti.EVENTOS.items()
                 if config["eventos"][chave]["quando"] == "resumo" for a in ev[5]]
        if not acoes:
            return []
        inicio = datetime.combine(dia.date(), datetime.min.time())
        marcas = ", ".join("?" for _ in acoes)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                f"SELECT acao, SUM(CASE WHEN sucesso = 1 THEN 1 ELSE 0 END), SUM(CASE WHEN sucesso = 1 THEN 0 ELSE 1 END) "  # nosec B608
                f"FROM dbo.logs_auditoria WHERE acao IN ({marcas}) AND data_hora >= ? AND data_hora < ? GROUP BY acao",
                (*acoes, inicio, inicio + timedelta(days=1)),
            )
            linhas = cursor.fetchall()
        finally:
            conn.close()
        return [(ROTULOS_ACAO.get(r[0], r[0]), int(r[1] or 0), int(r[2] or 0)) for r in linhas]


ACOES_POR_GRUPO: dict[str, tuple[str, ...]] = {
    "logins": ("login", "login_microsoft", "login_app", "login_negado", "login_conta_parada", "conta_bloqueada",
               "mfa_falha", "login_microsoft_negado", "login_senha_provisoria"),
    "senhas": ("senha_esqueci_pedido", "senha_esqueci_negado", "senha_codigo_cancelado", "senha_recuperada_codigo",
               "trocar_senha_primeiro_acesso", "alterar_propria_senha", "redefinir_senha"),
    "sessoes": ("sessao_substituida", "senha_pedidos_limite", "logout"),
}

ROTULOS_ACAO: dict[str, str] = {
    "login": "Login",
    "login_microsoft": "Login pela Microsoft",
    "login_app": "Login no app",
    "login_negado": "Login negado",
    "login_conta_parada": "Login de conta desativada",
    "conta_bloqueada": "Conta bloqueada",
    "mfa_falha": "Código MFA errado",
    "login_microsoft_negado": "Login Microsoft negado",
    "login_senha_provisoria": "Entrou com senha provisória",
    "senha_esqueci_pedido": "Pedido de \"Esqueci a senha\"",
    "senha_esqueci_negado": "\"Esqueci a senha\" negado",
    "senha_codigo_cancelado": "Código errado 5 vezes",
    "senha_recuperada_codigo": "Senha nova com código",
    "trocar_senha_primeiro_acesso": "Senha criada no 1º acesso",
    "alterar_propria_senha": "Senha trocada pela pessoa",
    "redefinir_senha": "Senha redefinida pelo admin",
    "sessao_substituida": "Conta aberta em outro computador",
    "senha_pedidos_limite": "Muitos pedidos seguidos",
    "logout": "Saiu do Conecta",
}
