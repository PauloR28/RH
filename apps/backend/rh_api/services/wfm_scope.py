"""Escopo de acesso do WFM (DENY por padrão). Funções puras, sem banco.

Toda rota do WFM passa por aqui no servidor; ocultar botão no front nunca é a
única barreira. Regras:
  * O QUE cada um pode fazer vem das chaves de Perfis e Permissões (`wfm.*`),
    conferidas em cada rota (decisão do Paulo, 09/11/2026: vale a chave, não o
    nome do perfil). Aqui fica só o ALCANCE (operações, equipe, conflito).
  * Administrador e Gestor: todas as operações.
  * Control Desk / Qualidade: somente operações vinculadas (sem vínculo = nada).
  * Supervisor: operações vinculadas E, para escala/presença, só operadores da
    própria equipe (`usuarios_supervisores`).
  * Operador: somente a própria escala.
  * Conflito de interesse (todos os perfis): ninguém edita a escala em que é a
    própria parte envolvida.
"""

from __future__ import annotations

from typing import Iterable

from ..auth import OperacaoEscolhida

from ..alcance import ALCANCES, EQUIPE, PROPRIO, TODOS, alcance, perfis_com  # noqa: E402

PERFIS_GLOBAIS = perfis_com(wfm=TODOS)  # Etapa 5: vem do alcance (antes: Admin e Gestor por nome)
# Perfis que gerem a escala de uma operação (Analista de TI = Gestor do setor de TI, limitado à operação TI).
PERFIS_GESTAO = tuple(p for p in ALCANCES if alcance(p).gere_escala)
SEPARADOR_TIPO = "::"
# Operações cuja escala principal não existe: só há as escalas criadas (tipos). Ex.: setor de TI.
OPERACOES_SO_TIPOS = frozenset({"TI"})


def operacao_base(operacao: str | None) -> str:
    """Chave da operação real. Cada tipo de escala do TI usa uma chave virtual `TI::PLANTAO-SABADO`."""
    return str(operacao or "").split(SEPARADOR_TIPO, 1)[0]


def eh_tipo_escala(operacao: str | None) -> bool:
    return SEPARADOR_TIPO in str(operacao or "")


def operacoes_permitidas(perfil: str, operacoes_usuario: Iterable[str]) -> frozenset[str] | None:
    """`None` = todas as operações; conjunto (possivelmente vazio) = restrito."""
    escolhida = operacoes_usuario if isinstance(operacoes_usuario, OperacaoEscolhida) else None
    vinculos = escolhida.originais if escolhida is not None else operacoes_usuario
    base = None if alcance(perfil).wfm == TODOS else frozenset(item for item in vinculos if item)
    if escolhida is not None:  # seletor de operação do topo: só a escolhida, dentro do que já via
        return frozenset(escolhida) if base is None else frozenset(escolhida) & base
    return base


def pode_ver_operacao(perfil: str, operacoes_usuario: Iterable[str], operacao: str | None) -> bool:
    permitidas = operacoes_permitidas(perfil, operacoes_usuario)
    if permitidas is None:
        return True
    return bool(operacao) and operacao_base(operacao) in permitidas


# ---------------------------------------------------------------- módulo aberto (Módulo › Unidade, 16/nov/2026)
# Decisão do Paulo: cada unidade pertence a UM módulo (V070) e só aparece no módulo dela. A escala do setor de TI
# (módulo Tecnologia) não aparece na Operação para ninguém, nem Administrador nem Gestor, inclusive nos relatórios.
# Só fecha: nunca abre uma unidade que o perfil não veria. Pedido sem módulo (cliente antigo) = como antes.


def _modulos_das_unidades() -> dict[str, str]:
    """Chave da unidade -> módulo dono (cache em memória da Central de Acessos). Falha = vazio (nenhum filtro)."""
    try:
        from . import acesso_cache

        return {chave: u.modulo for chave, u in acesso_cache.foto().unidades.items()}
    except Exception:  # noqa: BLE001 - sem cadastro de unidades, vale a regra de antes
        return {}


def unidade_no_modulo(operacao: str | None, modulo_aberto: str, donos: dict[str, str] | None = None) -> bool:
    """A unidade (ou o tipo de escala dela, `TI::PLANTAO`) aparece no módulo aberto? Unidade sem dono conhecido: sim."""
    if not modulo_aberto:
        return True
    donos = _modulos_das_unidades() if donos is None else donos
    dono = donos.get(operacao_base(operacao)) or donos.get(operacao_base(operacao).upper())
    return not dono or dono == modulo_aberto


def operacoes_do_usuario(user, donos: dict[str, str] | None = None) -> frozenset[str] | None:
    """`operacoes_permitidas` já cortada pelo módulo aberto. `None` = todas (só quando nenhum módulo corta nada)."""
    permitidas = operacoes_permitidas(user.perfil, user.operacoes)
    modulo = getattr(user, "modulo_aberto", "")
    if not modulo:
        return permitidas
    donos = _modulos_das_unidades() if donos is None else donos
    if permitidas is None:
        fora = {chave for chave, dono in donos.items() if dono and dono != modulo}
        if not fora:
            return None
        return frozenset(chave for chave in donos if chave not in fora)
    return frozenset(op for op in permitidas if unidade_no_modulo(op, modulo, donos))


def pode_ver(user, operacao: str | None, donos: dict[str, str] | None = None) -> bool:
    """`pode_ver_operacao` + módulo aberto. Use nas rotas: recebe o usuário inteiro."""
    return pode_ver_operacao(user.perfil, user.operacoes, operacao) and unidade_no_modulo(
        operacao, getattr(user, "modulo_aberto", ""), donos
    )


def conflito_de_interesse(id_usuario: int | None, id_operador: int, perfil: str = "") -> bool:
    """O Analista de TI (gestor único do setor) aprova/edita a própria escala por decisão do RH."""
    if alcance(perfil).aprova_propria_escala:
        return False
    return id_usuario is not None and id_usuario == id_operador


def pode_ver_escala_de(
    *,
    perfil: str,
    id_usuario: int | None,
    operacoes_usuario: Iterable[str],
    operacao: str,
    id_operador: int,
    equipe_supervisor: Iterable[int] = (),
) -> bool:
    """Leitura da escala de UM operador."""
    if alcance(perfil).wfm == PROPRIO:
        return id_usuario is not None and id_operador == id_usuario and pode_ver_operacao(perfil, operacoes_usuario, operacao)
    if not pode_ver_operacao(perfil, operacoes_usuario, operacao):
        return False
    if alcance(perfil).wfm == EQUIPE:
        return id_operador == id_usuario or id_operador in set(equipe_supervisor)
    return True


def pode_editar_escala_de(
    *,
    perfil: str,
    id_usuario: int | None,
    operacoes_usuario: Iterable[str],
    operacao: str,
    id_operador: int,
    equipe_supervisor: Iterable[int] = (),
) -> bool:
    """Edição da escala / lançamento de presença de UM operador (a chave wfm.* é conferida na rota)."""
    if alcance(perfil).wfm == PROPRIO:
        return False
    if conflito_de_interesse(id_usuario, id_operador, perfil):
        return False
    if not pode_ver_operacao(perfil, operacoes_usuario, operacao):
        return False
    if alcance(perfil).wfm == EQUIPE:
        return id_operador in set(equipe_supervisor)
    return True


def _gere(perfil: str) -> bool:
    """Quem pode gerir algo do WFM, se tiver a chave: todos menos os participantes (Operador e Técnicos), que só veem a si."""
    return alcance(perfil).wfm != PROPRIO


def pode_editar_cadastros(perfil: str) -> bool:
    """Turnos, skills, calendário e configuração da escala: vale a chave wfm.cadastros.editar."""
    return _gere(perfil)


def pode_editar_contratos(perfil: str) -> bool:
    """Contratos e limites do motor: vale a chave wfm.contratos.editar."""
    return _gere(perfil)


def pode_editar_tipos_escala(perfil: str) -> bool:
    """Tipos de escala do setor de TI (plantão de sábado, sobreaviso...): vale a chave wfm.tipos_escala.editar."""
    return _gere(perfil)


def pode_criar_escala(perfil: str) -> bool:
    """Criar, configurar, ativar/desativar, duplicar e excluir escalas: vale a chave wfm.escala.criar."""
    return _gere(perfil)


def pode_aprovar_escala(
    *, perfil: str, id_usuario: int | None, operacoes_usuario: Iterable[str], operacao: str, id_enviou: int | None, ids_na_escala: Iterable[int] = (),
    aprovadores: dict | None = None,
) -> tuple[bool, str]:
    """Aprovar/declinar a escala enviada: decide quem tem a chave wfm.escala.aprovar (conferida na rota e no
    repositório). Quem enviou PODE aprovar a escala que enviou (decisão do Paulo, 09/11/2026; o histórico guarda
    quem enviou e quem aprovou). Quem consta na escala como operador não aprova — exceto o Analista de TI, gestor
    único do setor. `id_enviou` fica na assinatura por compatibilidade."""
    if alcance(perfil).wfm == PROPRIO:
        return False, "Seu perfil não aprova escalas."
    if not pode_ver_operacao(perfil, operacoes_usuario, operacao):
        return False, "Esta operação está fora do seu escopo de acesso."
    # Quem aprova é configurável por escala (perfis e/ou usuários); sem configuração vale Supervisor ou Gestor.
    if aprovadores and (aprovadores.get("perfis") or aprovadores.get("usuarios")) and not alcance(perfil).aprova_propria_escala:
        if perfil not in set(aprovadores.get("perfis") or ()) and id_usuario not in set(aprovadores.get("usuarios") or ()):
            return False, "Você não está entre os aprovadores configurados para esta escala."
    if not alcance(perfil).aprova_propria_escala:
        if id_usuario is not None and id_usuario in set(ids_na_escala):
            return False, "Você consta nesta escala como operador e não pode aprová-la."
    return True, ""


def pode_decidir_troca(
    *,
    perfil: str,
    id_usuario: int | None,
    operacoes_usuario: Iterable[str],
    operacao: str,
    id_a: int,
    id_b: int,
    equipe_supervisor: Iterable[int] = (),
) -> bool:
    """Aprovar/reprovar/desfazer uma troca entre A e B. Nunca quem é parte da troca (conflito de
    interesse); decide quem tem a chave wfm.troca.aprovar; Supervisor só se A ou B for da sua equipe; Control
    Desk só nas operações vinculadas; Gestor/RH e Administrador em qualquer operação."""
    if alcance(perfil).wfm == PROPRIO:
        return False
    if id_usuario is not None and id_usuario in (id_a, id_b):
        return False
    if not pode_ver_operacao(perfil, operacoes_usuario, operacao):
        return False
    if alcance(perfil).wfm == EQUIPE:
        equipe = set(equipe_supervisor)
        return id_a in equipe or id_b in equipe
    return True


def pode_ver_troca(
    *,
    perfil: str,
    id_usuario: int | None,
    operacoes_usuario: Iterable[str],
    operacao: str,
    id_a: int,
    id_b: int,
    equipe_supervisor: Iterable[int] = (),
) -> bool:
    """Leitura de uma troca (inclui o motivo de bloqueio/alerta): só os dois operadores e os gestores
    (Supervisor da equipe, Control Desk, Gestor/RH). Qualquer outro perfil não vê."""
    if alcance(perfil).wfm == PROPRIO:
        return id_usuario in (id_a, id_b) and pode_ver_operacao(perfil, operacoes_usuario, operacao)
    if not pode_ver_operacao(perfil, operacoes_usuario, operacao):
        return False
    if alcance(perfil).wfm == EQUIPE:
        equipe = set(equipe_supervisor)
        return id_a in equipe or id_b in equipe
    return True
