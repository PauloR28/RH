"""Áreas do Conecta que podem ficar INATIVAS na fase de teste (sem apagar código nem dados).

Interruptor único: variável de ambiente ``RH_AREAS_INATIVAS`` (lista separada por vírgula).
  * não definida  -> ``suporte_ti,treinamentos`` (as duas áreas ficam fora, para o Conecta carregar mais leve);
  * vazia         -> nenhuma área inativa (tudo volta a funcionar após reiniciar o backend);
  * ``suporte_ti`` ou ``treinamentos`` -> só aquela fica inativa.

Efeito de ``suporte_ti`` inativo: rotas ``/chamados/*`` não são montadas, o job de prazos não é agendado e as permissões
``chamados.*`` deixam de valer (o módulo Tecnologia continua com Usuários, Perfis, Módulos etc.).
Efeito de ``treinamentos`` inativo: o job de escalonamento de chamada não é agendado e o frontend esconde menu, telas e
notificações da Central de Treinamentos. As rotas de onboarding continuam montadas porque o fluxo do processo seletivo
(candidato aprovado -> treinamento) depende delas. Os dados nunca são tocados.
"""

from __future__ import annotations

import os

SUPORTE_TI = "suporte_ti"
TREINAMENTOS = "treinamentos"
AREAS_CONHECIDAS = frozenset({SUPORTE_TI, TREINAMENTOS})
VARIAVEL = "RH_AREAS_INATIVAS"
PADRAO = f"{SUPORTE_TI},{TREINAMENTOS}"


def areas_inativas() -> frozenset[str]:
    bruto = os.environ.get(VARIAVEL)
    texto = PADRAO if bruto is None else bruto
    return frozenset(p.strip().lower() for p in texto.split(",") if p.strip().lower() in AREAS_CONHECIDAS)


def area_ativa(area: str) -> bool:
    return area not in areas_inativas()
