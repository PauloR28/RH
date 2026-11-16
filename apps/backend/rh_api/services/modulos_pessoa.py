"""Módulos por pessoa e por perfil (16/nov/2026, amostra aprovada pelo Paulo).

Bloco "Módulos" do cadastro do usuário e de Perfis e Permissões. Cada módulo (RH, Operação, Tecnologia) tem um liga/desliga:
  * perfil: o padrão vem das permissões do perfil (o que já abre o módulo). Ligar/desligar diferente disso grava uma exceção
    do perfil `modulo.<chave>.abrir` (V071, conceder/retirar) — vale para todas as pessoas do perfil;
  * pessoa: o padrão vem do perfil dela (já com a exceção do perfil). Diferente disso grava a exceção da pessoa.
Exceção igual ao padrão é apagada (não guarda ruído). A liberação antiga (V060, tela Tecnologia > Módulos > Atribuição)
do mesmo alvo e módulo é apagada ao gravar aqui, para as duas telas não brigarem. Módulo desligado no Conecta vence tudo
(continua fora do seletor, `acesso.modulos_visiveis`). Ligar um módulo só o põe no seletor: as telas dentro dele seguem as
permissões do perfil. Não se tira a Tecnologia de quem a administra (`configuracoes.visualizar`): trancaria a pessoa fora.
"""

from __future__ import annotations

from fastapi import HTTPException, status

from ..config import get_settings
from ..db import get_connection
from ..modulos_catalogo import MODULO_CORE, MODULO_TECNOLOGIA, MODULOS_PADRAO
from . import acesso, acesso_cache

MODULOS_EDITAVEIS = tuple(chave for chave, *_ in MODULOS_PADRAO if chave != MODULO_CORE)


def _erro(codigo: int, texto: str) -> HTTPException:
    return HTTPException(status_code=codigo, detail=texto)


def _chave(modulo: str) -> str:
    return f"modulo.{modulo}.abrir"


def _nomes() -> dict[str, str]:
    est = acesso.estado()
    return {chave: est.nomes.get(chave, nome) for chave, nome, *_ in MODULOS_PADRAO}


def _ordem() -> list[str]:
    est = acesso.estado()
    return sorted(MODULOS_EDITAVEIS, key=lambda m: (est.ordem.get(m, 99), m))


def abertos_pelas_permissoes(perfil: str) -> set[str]:
    """Módulos que as permissões do perfil já abrem (sem olhar se o módulo está ligado no Conecta)."""
    perms = acesso_cache.foto().permissoes.get(perfil, frozenset())
    return {m for chave in perms if (m := acesso.modulo_aberto_por(chave)) and m != MODULO_CORE}


def _administra_tecnologia(perfil: str) -> bool:
    return "configuracoes.visualizar" in acesso_cache.foto().permissoes.get(perfil, frozenset())


def _valores_do_perfil(perfil: str) -> tuple[set[str], dict[str, bool]]:
    """(abertos pelas permissões, valor final de cada módulo no perfil)."""
    base = abertos_pelas_permissoes(perfil)
    decisao = acesso_cache.decisao_modulos(None, perfil)
    return base, {m: decisao.get(m, m in base) for m in MODULOS_EDITAVEIS}


def estado_perfil(perfil: str) -> dict:
    perfil = str(perfil or "").strip()
    foto = acesso_cache.foto()
    if perfil not in foto.permissoes:
        raise _erro(status.HTTP_404_NOT_FOUND, "Perfil não encontrado.")
    base, valores = _valores_do_perfil(perfil)
    pessoas = [i for i, p in foto.perfil_do_usuario.items() if p == perfil]
    excecoes_pessoas: dict[str, int] = {}
    ids = set(pessoas)
    for e in foto.excecoes:
        if e.alvo_tipo == "usuario" and e.id_usuario in ids and (m := acesso_cache.modulo_da_excecao(e)):
            excecoes_pessoas[m] = excecoes_pessoas.get(m, 0) + 1
    for i in ids:
        for m in foto.modulos_usuario.get(i, frozenset()):
            excecoes_pessoas[m] = excecoes_pessoas.get(m, 0) + 1
    nomes = _nomes()
    return {
        "perfil": perfil, "pessoas": len(pessoas),
        "modulos": [{
            "chave": m, "nome": nomes.get(m, m), "ativo": acesso.modulo_ativo(m), "pelas_permissoes": m in base,
            "valor": valores[m], "excecao": valores[m] != (m in base), "pessoas_com_excecao": excecoes_pessoas.get(m, 0),
            "travado": m == MODULO_TECNOLOGIA and _administra_tecnologia(perfil),
        } for m in _ordem()],
    }


def _perfil_do_usuario(cursor, id_usuario: int) -> str:
    cursor.execute("SELECT perfil_id FROM dbo.usuarios WHERE id_usuario = ?", (int(id_usuario),))
    linha = cursor.fetchone()
    if not linha:
        raise _erro(status.HTTP_404_NOT_FOUND, "Usuário não encontrado.")
    return str(linha[0] or "").strip()


def estado_usuario(id_usuario: int, perfil: str | None = None) -> dict:
    """`perfil` (opcional) = perfil escolhido no formulário ainda não salvo; sem ele, o perfil gravado."""
    if not perfil:
        conn = get_connection(get_settings(), autocommit=True)
        try:
            perfil = _perfil_do_usuario(conn.cursor(), id_usuario)
        finally:
            conn.close()
    _base, do_perfil = _valores_do_perfil(perfil)
    decisao = acesso_cache.decisao_modulos(int(id_usuario), perfil)
    nomes = _nomes()
    modulos = []
    for m in _ordem():
        valor = decisao.get(m, do_perfil[m])
        origem = "pessoa" if valor and not do_perfil[m] else ("tirado" if not valor and do_perfil[m] else ("perfil" if valor else ""))
        modulos.append({"chave": m, "nome": nomes.get(m, m), "ativo": acesso.modulo_ativo(m), "do_perfil": do_perfil[m],
                        "valor": valor, "origem": origem, "travado": m == MODULO_TECNOLOGIA and _administra_tecnologia(perfil)})
    return {"id_usuario": int(id_usuario), "perfil": perfil, "modulos": modulos}


def _validar(valores: dict[str, bool]) -> dict[str, bool]:
    limpos = {}
    for m, v in (valores or {}).items():
        m = str(m or "").strip()
        if m not in MODULOS_EDITAVEIS:
            raise _erro(status.HTTP_400_BAD_REQUEST, f"Módulo inválido: {m or '(vazio)'}.")
        limpos[m] = bool(v)
    return limpos


def salvar_usuario(id_usuario: int, valores: dict[str, bool], *, autor: str) -> dict:
    valores = _validar(valores)
    conn = get_connection(get_settings(), autocommit=False)
    try:
        cursor = conn.cursor()
        perfil = _perfil_do_usuario(cursor, id_usuario)
        antes = {x["chave"]: x["valor"] for x in estado_usuario(id_usuario, perfil)["modulos"]}
        _base, do_perfil = _valores_do_perfil(perfil)
        for m, valor in valores.items():
            if m == MODULO_TECNOLOGIA and not valor and _administra_tecnologia(perfil):
                raise _erro(status.HTTP_409_CONFLICT, "Este perfil administra a Tecnologia: o módulo não pode ser tirado da pessoa.")
            cursor.execute("DELETE FROM dbo.acesso_excecoes WHERE alvo_tipo = 'usuario' AND id_usuario = ? AND unidade IS NULL AND chave_permissao = ?",
                           (int(id_usuario), _chave(m)))
            cursor.execute("DELETE FROM dbo.modulos_acesso_usuario WHERE id_usuario = ? AND modulo = ?", (int(id_usuario), m))
            if valor != do_perfil[m]:
                cursor.execute(
                    "INSERT INTO dbo.acesso_excecoes (alvo_tipo, id_usuario, chave_permissao, efeito, motivo, criado_por) VALUES ('usuario', ?, ?, ?, ?, ?)",
                    (int(id_usuario), _chave(m), "conceder" if valor else "retirar", "Cadastro do usuário", autor[:180]))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    acesso.invalidar_cache()
    acesso_cache.invalidar()
    depois = estado_usuario(id_usuario, perfil)
    return {**depois, "anteriores": antes}


def salvar_perfil(perfil: str, valores: dict[str, bool], *, autor: str) -> dict:
    valores = _validar(valores)
    perfil = str(perfil or "").strip()
    atual = estado_perfil(perfil)  # 404 se não existe
    antes = {x["chave"]: x["valor"] for x in atual["modulos"]}
    base = abertos_pelas_permissoes(perfil)
    for m, valor in valores.items():
        if m == MODULO_TECNOLOGIA and not valor and _administra_tecnologia(perfil):
            raise _erro(status.HTTP_409_CONFLICT, "Este perfil administra a Tecnologia: o módulo não pode ser tirado dele.")
    conn = get_connection(get_settings(), autocommit=False)
    try:
        cursor = conn.cursor()
        for m, valor in valores.items():
            cursor.execute("DELETE FROM dbo.acesso_excecoes WHERE alvo_tipo = 'perfil' AND id_perfil = ? AND unidade IS NULL AND chave_permissao = ?",
                           (perfil, _chave(m)))
            cursor.execute("DELETE FROM dbo.modulos_acesso_perfil WHERE id_perfil = ? AND modulo = ?", (perfil, m))
            if valor != (m in base):
                cursor.execute(
                    "INSERT INTO dbo.acesso_excecoes (alvo_tipo, id_perfil, chave_permissao, efeito, motivo, criado_por) VALUES ('perfil', ?, ?, ?, ?, ?)",
                    (perfil, _chave(m), "conceder" if valor else "retirar", "Perfis e Permissões", autor[:180]))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    acesso.invalidar_cache()
    acesso_cache.invalidar()
    return {**estado_perfil(perfil), "anteriores": antes}
