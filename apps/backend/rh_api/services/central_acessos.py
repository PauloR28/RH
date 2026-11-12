"""Central de Acessos (Etapa 6): a tela única lê e grava por aqui.

Escopo ("Vale para"):
  * 'padrao'            -> padrão do perfil (`perfil_permissoes`, global) e funções ligadas no MÓDULO;
  * 'unidade:<chave>'   -> exceção do PERFIL só naquela unidade (`acesso_excecoes`) e função ligada/desligada só nela
                           (`operacoes_modulos`). A unidade precisa ser do módulo aberto;
  * 'pessoa:<id>'       -> exceção da PESSOA (`acesso_excecoes`), só na coluna do perfil dela.
Exceção igual ao padrão é apagada (não guarda ruído). Base da Tecnologia nunca desliga. Tudo numa transação, auditado
pelo router. Depois de gravar, os caches de acesso são limpos (vale no próximo clique, sem relogin).

Ligar/desligar função: com `motor` (função que o motor de acesso já conhece), usa as mesmas tabelas da tela Módulos e
do item 16, e passa a fechar a porta na regra única. Sem motor, grava `cat.<id>` nas mesmas tabelas: vale para a tela e o
menu; a regra única passa a usar quando a função ganhar motor.
"""

from __future__ import annotations

from fastapi import HTTPException, status

from ..acesso_catalogo import FUNCOES_CATALOGO, POR_ID, Funcao, permissoes_da_funcao
from ..config import get_settings
from ..db import get_connection
from ..modulos_catalogo import FUNCOES_POR_MODULO, FUNCOES_POR_OPERACAO, MODULO_CORE, MODULO_TECNOLOGIA, MODULOS_VALIDOS
from . import acesso, acesso_cache


def _erro(codigo: int, texto: str) -> HTTPException:
    return HTTPException(status_code=codigo, detail=texto)


def _modulo_valido(modulo: str) -> str:
    modulo = str(modulo or "").strip()
    if modulo not in MODULOS_VALIDOS or modulo == MODULO_CORE:
        raise _erro(status.HTTP_404_NOT_FOUND, "Módulo não encontrado.")
    return modulo


def _ler_escopo(escopo: str, modulo: str) -> tuple[str, str | int | None]:
    escopo = str(escopo or "padrao").strip()
    if escopo == "padrao":
        return "padrao", None
    tipo, _, valor = escopo.partition(":")
    if tipo == "unidade" and valor:
        if acesso_cache.modulo_da_unidade(valor) != modulo:
            raise _erro(status.HTTP_400_BAD_REQUEST, "Esta unidade não pertence ao módulo aberto.")
        return "unidade", valor
    if tipo == "pessoa" and valor.isdigit():
        return "pessoa", int(valor)
    raise _erro(status.HTTP_400_BAD_REQUEST, "Escopo inválido.")


def _chave_tabela(funcao: Funcao, modulo: str | None = None, unidade: bool = False) -> str:
    if funcao.motor and ((unidade and funcao.motor in FUNCOES_POR_OPERACAO) or (modulo and funcao.motor in FUNCOES_POR_MODULO.get(modulo, ()))):
        return funcao.motor
    return f"cat.{funcao.id}"


def _ler(cursor, sql: str, params=()) -> list:
    try:
        cursor.execute(sql, params)
        return cursor.fetchall()
    except Exception:  # noqa: BLE001 - tabela opcional ausente = vazio
        return []


def _estado_funcoes(cursor, modulo: str) -> tuple[dict[str, bool], dict[tuple[str, str], bool]]:
    """(ligada no módulo por id do catálogo, ligada por (unidade, id)) — só o que está gravado; o resto é o padrão."""
    no_modulo: dict[str, bool] = {}
    motores = acesso.estado().funcoes.get(modulo, frozenset())
    cat_rows = {str(f): bool(a) for f, a in _ler(cursor, "SELECT funcao, ativo FROM dbo.modulos_funcoes WHERE modulo = ? AND funcao LIKE 'cat.%'", (modulo,))}
    for f in FUNCOES_CATALOGO:
        chave = _chave_tabela(f, modulo=modulo)
        if chave == f.motor:
            no_modulo[f.id] = f.motor in motores
        else:
            no_modulo[f.id] = cat_rows.get(chave, f.modulo == modulo)
    por_unidade: dict[tuple[str, str], bool] = {}
    ids_por_chave = {}
    for f in FUNCOES_CATALOGO:
        ids_por_chave.setdefault(_chave_tabela(f, unidade=True), []).append(f.id)
    for operacao, funcao, ativo in _ler(cursor, "SELECT operacao, funcao, ativo FROM dbo.operacoes_modulos"):
        for fid in ids_por_chave.get(str(funcao), []):
            por_unidade[(str(operacao).strip(), fid)] = bool(ativo)
    return no_modulo, por_unidade


def escopos(modulo: str) -> dict:
    """Opções do "Vale para": unidades do módulo e as pessoas ligadas a elas."""
    modulo = _modulo_valido(modulo)
    unidades = acesso_cache.unidades_do_modulo(modulo)
    chaves = [u.chave for u in unidades]
    pessoas = []
    if chaves:
        conn = get_connection(get_settings(), autocommit=True)
        try:
            cursor = conn.cursor()
            marcas = ",".join("?" for _ in chaves)
            linhas = _ler(cursor,
                "SELECT DISTINCT u.id_usuario, LTRIM(RTRIM(ISNULL(u.nome,'') + ' ' + ISNULL(u.sobrenome,''))), u.perfil_id "
                f"FROM dbo.usuarios_operacoes uo JOIN dbo.usuarios u ON u.id_usuario = uo.id_usuario "
                f"WHERE uo.operacao IN ({marcas}) AND u.status = 'Ativo' ORDER BY 2", tuple(chaves))
        finally:
            conn.close()
        pessoas = [{"id": int(i), "nome": str(n or ""), "perfil": str(p or "")} for i, n, p in linhas]
    return {
        "modulo": modulo,
        "unidades": [{"chave": u.chave, "nome": u.nome, "tipo": u.tipo} for u in unidades],
        "pessoas": pessoas,
    }


def matriz(modulo: str, escopo: str = "padrao") -> dict:
    from ..rbac import PERMISSION_DEFINITIONS

    modulo = _modulo_valido(modulo)
    tipo, alvo = _ler_escopo(escopo, modulo)
    foto = acesso_cache.foto()
    conn = get_connection(get_settings(), autocommit=True)
    try:
        cursor = conn.cursor()
        perfis = [{"id": str(i), "nome": str(n)} for i, n in _ler(cursor, "SELECT id_perfil, nome FROM dbo.perfis WHERE ativo = 1 ORDER BY nome")]
        no_modulo, por_unidade = _estado_funcoes(cursor, modulo)
        perfil_pessoa = None
        if tipo == "pessoa":
            linha = _ler(cursor, "SELECT perfil_id FROM dbo.usuarios WHERE id_usuario = ?", (alvo,))
            if not linha:
                raise _erro(status.HTTP_404_NOT_FOUND, "Pessoa não encontrada.")
            perfil_pessoa = str(linha[0][0] or "")
    finally:
        conn.close()

    excecoes = foto.excecoes
    if tipo == "unidade":
        exc = {(e.id_perfil, e.chave): e.efeito == "conceder" for e in excecoes if e.alvo_tipo == "perfil" and e.unidade == alvo}
    elif tipo == "pessoa":
        exc = {(perfil_pessoa, e.chave): e.efeito == "conceder" for e in excecoes if e.alvo_tipo == "usuario" and e.id_usuario == alvo and e.unidade is None}
    else:
        exc = {}
    funcoes = []
    for f in FUNCOES_CATALOGO:
        ligada_modulo = no_modulo[f.id]
        ligada = ligada_modulo and (por_unidade.get((alvo, f.id), True) if tipo == "unidade" else True)
        acoes = []
        for chave in permissoes_da_funcao(f):
            padrao = {p["id"]: chave in foto.permissoes.get(p["id"], frozenset()) for p in perfis}
            valores = {pid: exc.get((pid, chave), v) for pid, v in padrao.items()}
            acoes.append({"chave": chave, "nome": PERMISSION_DEFINITIONS[chave].description, "padrao": padrao, "valores": valores})
        funcoes.append({
            "id": f.id, "n": f.n, "nome": f.nome, "base": f.base and modulo == MODULO_TECNOLOGIA, "futura": f.futura,
            "motor": bool(f.motor), "ligada": ligada, "ligada_no_modulo": ligada_modulo, "acoes": acoes,
        })
    return {"modulo": modulo, "escopo": escopo, "tipo": tipo, "perfil_da_pessoa": perfil_pessoa,
            "perfis": perfis, "funcoes": funcoes, "excecoes": len(exc)}


def salvar_lote(modulo: str, escopo: str, mudancas: list[dict], *, autor: str) -> dict:
    """Grava tudo numa transação. `mudancas`: {tipo:'perm', chave, perfil, valor} ou {tipo:'funcao', funcao, ligada}."""
    from ..rbac import PERMISSION_DEFINITIONS

    modulo = _modulo_valido(modulo)
    tipo, alvo = _ler_escopo(escopo, modulo)
    if not mudancas:
        return {"aplicadas": []}
    foto = acesso_cache.foto()
    aplicadas = []
    conn = get_connection(get_settings(), autocommit=False)
    try:
        cursor = conn.cursor()
        for m in mudancas:
            if m.get("tipo") == "funcao":
                f = POR_ID.get(str(m.get("funcao")))
                if not f:
                    raise _erro(status.HTTP_404_NOT_FOUND, "Função não encontrada.")
                ligada = bool(m.get("ligada"))
                if tipo == "pessoa":
                    raise _erro(status.HTTP_400_BAD_REQUEST, "Ligar e desligar função é por módulo ou por unidade.")
                if f.base and modulo == MODULO_TECNOLOGIA and not ligada:
                    raise _erro(status.HTTP_409_CONFLICT, f"{f.nome} é base da Tecnologia e não pode ser desligada.")
                if tipo == "padrao":
                    chave = _chave_tabela(f, modulo=modulo)
                    cursor.execute(
                        "MERGE dbo.modulos_funcoes AS t USING (SELECT ? AS modulo, ? AS funcao) AS s ON t.modulo = s.modulo AND t.funcao = s.funcao "
                        "WHEN MATCHED THEN UPDATE SET ativo = ?, atualizado_em = GETDATE(), atualizado_por = ? "
                        "WHEN NOT MATCHED THEN INSERT (modulo, funcao, ativo, atualizado_por) VALUES (s.modulo, s.funcao, ?, ?);",
                        (modulo, chave, int(ligada), autor[:180], int(ligada), autor[:180]))
                else:
                    chave = _chave_tabela(f, unidade=True)
                    cursor.execute(
                        "MERGE dbo.operacoes_modulos AS t USING (SELECT ? AS operacao, ? AS funcao) AS s ON t.operacao = s.operacao AND t.funcao = s.funcao "
                        "WHEN MATCHED THEN UPDATE SET ativo = ?, atualizado_em = GETDATE(), atualizado_por = ? "
                        "WHEN NOT MATCHED THEN INSERT (operacao, funcao, ativo, atualizado_por) VALUES (s.operacao, s.funcao, ?, ?);",
                        (alvo, chave, int(ligada), autor[:180], int(ligada), autor[:180]))
                aplicadas.append({"tipo": "funcao", "funcao": f.id, "ligada": ligada})
                continue
            chave = str(m.get("chave") or "")
            perfil = str(m.get("perfil") or "")
            valor = bool(m.get("valor"))
            if chave not in PERMISSION_DEFINITIONS or not perfil:
                raise _erro(status.HTTP_400_BAD_REQUEST, "Permissão ou perfil inválido.")
            padrao = chave in foto.permissoes.get(perfil, frozenset())
            if tipo == "padrao":
                cursor.execute(
                    "MERGE dbo.perfil_permissoes AS t USING (SELECT ? AS id_perfil, ? AS chave) AS s "
                    "ON t.id_perfil = s.id_perfil AND t.chave_permissao = s.chave "
                    "WHEN MATCHED THEN UPDATE SET permitido = ?, atualizado_em = GETDATE() "
                    "WHEN NOT MATCHED THEN INSERT (id_perfil, chave_permissao, permitido, criado_em, atualizado_em) VALUES (s.id_perfil, s.chave, ?, GETDATE(), GETDATE());",
                    (perfil, chave, int(valor), int(valor)))
            else:
                if tipo == "unidade":
                    filtro, params = "alvo_tipo = 'perfil' AND id_perfil = ? AND unidade = ? AND chave_permissao = ?", (perfil, alvo, chave)
                else:
                    filtro, params = "alvo_tipo = 'usuario' AND id_usuario = ? AND unidade IS NULL AND chave_permissao = ?", (alvo, chave)
                cursor.execute(f"DELETE FROM dbo.acesso_excecoes WHERE {filtro}", params)
                if valor != padrao:  # igual ao padrão não vira exceção
                    if tipo == "unidade":
                        cursor.execute(
                            "INSERT INTO dbo.acesso_excecoes (alvo_tipo, id_perfil, unidade, chave_permissao, efeito, motivo, criado_por) "
                            "VALUES ('perfil', ?, ?, ?, ?, ?, ?)",
                            (perfil, alvo, chave, "conceder" if valor else "retirar", "Central de Acessos", autor[:180]))
                    else:
                        cursor.execute(
                            "INSERT INTO dbo.acesso_excecoes (alvo_tipo, id_usuario, chave_permissao, efeito, motivo, criado_por) "
                            "VALUES ('usuario', ?, ?, ?, ?, ?)",
                            (alvo, chave, "conceder" if valor else "retirar", "Central de Acessos", autor[:180]))
            aplicadas.append({"tipo": "perm", "chave": chave, "perfil": perfil, "valor": valor, "padrao": padrao})
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    acesso.invalidar_cache()
    acesso_cache.invalidar()
    return {"aplicadas": aplicadas}


def padronizar(modulo: str, escopo: str = "padrao", *, autor: str) -> dict:
    """Apaga as exceções do escopo (unidade, pessoa, ou todas as das unidades/pessoas do módulo) e volta ao padrão."""
    modulo = _modulo_valido(modulo)
    tipo, alvo = _ler_escopo(escopo, modulo)
    conn = get_connection(get_settings(), autocommit=False)
    try:
        cursor = conn.cursor()
        if tipo == "unidade":
            cursor.execute("DELETE FROM dbo.acesso_excecoes WHERE unidade = ?", (alvo,))
        elif tipo == "pessoa":
            cursor.execute("DELETE FROM dbo.acesso_excecoes WHERE alvo_tipo = 'usuario' AND id_usuario = ?", (alvo,))
        else:
            chaves = [u.chave for u in acesso_cache.unidades_do_modulo(modulo, so_ativas=False)]
            if not chaves:
                conn.rollback()
                return {"apagadas": 0}
            marcas = ",".join("?" for _ in chaves)
            cursor.execute(
                f"DELETE FROM dbo.acesso_excecoes WHERE unidade IN ({marcas}) OR (alvo_tipo = 'usuario' AND id_usuario IN "
                f"(SELECT id_usuario FROM dbo.usuarios_operacoes WHERE operacao IN ({marcas})))", tuple(chaves) * 2)
        apagadas = cursor.rowcount
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    acesso_cache.invalidar()
    return {"apagadas": int(apagadas or 0), "autor": autor}
