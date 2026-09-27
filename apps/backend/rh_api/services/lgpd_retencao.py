"""Retenção LGPD de candidatos (regras aprovadas pelo RH em 27/set/2026).

Regras:
- Prazo contado da CANDIDATURA; para quem está no banco de talentos, contado da
  ENTRADA no banco. Padrão: 6 meses para os dois.
- Ficam de fora: candidatos aprovados/contratados e quem está em processo
  seletivo ainda aberto.
- Aviso prévio (padrão 7 dias): notificação ao Administrador e ao Gestor.
- Vencido o prazo, os dados são APAGADOS (não anonimizados).

Este módulo só decide (funções puras, testáveis sem banco); a execução fica em
repositories/lgpd_retencao.py. A rotina nasce DESLIGADA.
"""

from __future__ import annotations

import calendar
from datetime import datetime, timedelta
from typing import Any

MANTER = "manter"
AVISAR = "avisar"
EXCLUIR = "excluir"
PROTEGIDO = "protegido"

CONFIG_PADRAO: dict[str, Any] = {
    "ativo": False,
    "meses_candidatura": 6,
    "meses_banco_talentos": 6,
    "dias_aviso": 7,
    "excluir_cvs_nao_vinculados": True,
}


def somar_meses(data: datetime, meses: int) -> datetime:
    mes = data.month - 1 + int(meses)
    ano = data.year + mes // 12
    mes = mes % 12 + 1
    dia = min(data.day, calendar.monthrange(ano, mes)[1])
    return data.replace(year=ano, month=mes, day=dia)


def normalizar_config(bruto: dict | None) -> dict:
    config = dict(CONFIG_PADRAO)
    for chave, valor in (bruto or {}).items():
        if chave not in config or valor is None:
            continue
        if isinstance(CONFIG_PADRAO[chave], bool):
            config[chave] = bool(valor)
        else:
            config[chave] = int(valor)
    config["meses_candidatura"] = min(120, max(1, config["meses_candidatura"]))
    config["meses_banco_talentos"] = min(120, max(1, config["meses_banco_talentos"]))
    config["dias_aviso"] = min(60, max(0, config["dias_aviso"]))
    return config


def avaliar(
    *,
    data_candidatura: datetime | None,
    entrada_banco: datetime | None,
    contratado: bool,
    processo_aberto: bool,
    agora: datetime,
    config: dict,
) -> dict:
    """Situação de UMA candidatura: manter, avisar (prazo vence em breve),
    excluir (prazo vencido) ou protegido (contratado/processo aberto/sem data)."""
    if contratado:
        return {"situacao": PROTEGIDO, "motivo": "contratado"}
    if processo_aberto:
        return {"situacao": PROTEGIDO, "motivo": "processo_aberto"}
    if entrada_banco is not None:
        base, meses, origem = entrada_banco, config["meses_banco_talentos"], "banco_talentos"
    elif data_candidatura is not None:
        base, meses, origem = data_candidatura, config["meses_candidatura"], "candidatura"
    else:
        return {"situacao": PROTEGIDO, "motivo": "sem_data"}
    limite = somar_meses(base, meses)
    dias = max(0, (agora - base).days)
    if agora >= limite:
        situacao = EXCLUIR
    elif config["dias_aviso"] and agora >= limite - timedelta(days=config["dias_aviso"]):
        situacao = AVISAR
    else:
        situacao = MANTER
    return {"situacao": situacao, "origem": origem, "base": base, "limite": limite, "dias": dias}


def mensagem_aviso(nome: str, avaliacao: dict) -> str:
    """Texto pedido pelo RH para a notificação de aviso prévio."""
    onde = "no banco de talentos" if avaliacao.get("origem") == "banco_talentos" else "desde a candidatura"
    limite = avaliacao.get("limite")
    quando = f" em {limite:%d/%m/%Y}" if isinstance(limite, datetime) else ""
    return (
        f"Candidato {nome or 'sem nome'} está há {avaliacao.get('dias', 0)} dias {onde} e, por questões de LGPD, "
        f"seus dados serão permanentemente excluídos{quando}."
    )
