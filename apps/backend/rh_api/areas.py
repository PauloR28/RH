"""Áreas do Conecta que podem ficar INATIVAS (sem apagar código nem dados).

Interruptor único: variável de ambiente ``RH_AREAS_INATIVAS`` (lista separada por vírgula).
  * não definida  -> todas as áreas abaixo ficam inativas (o Conecta sobe mais leve, só com o que está em uso);
  * vazia         -> nenhuma área inativa (tudo volta a funcionar após reiniciar o backend);
  * lista         -> só as áreas citadas ficam inativas.

Áreas conhecidas e o que cada uma desliga quando inativa:
  * ``suporte_ti``    rotas ``/chamados/*``, job de prazos, permissões ``chamados.*``.
  * ``treinamentos``  job de escalonamento de chamada; menu, telas e notificações da Central de Treinamentos.
  * ``processos``     processos seletivos: processos, candidatos, pipeline, entrevistas, candidatura pública, relatórios e
                      dashboard de funil; job de lembretes de inatividade; permissões vagas/processos/entrevistas.
  * ``provas``        Conecta Provas: provas geradas, histórico, DISC, Fit Cultural, Raciocínio Lógico e resultados analíticos
                      (inclusive os links públicos de prova); permissões provas/fit_cultural.
  * ``curriculos``    CX de Currículos: caixa de e-mail de recrutamento, banco de talentos e análise de currículo por IA.

Com ``processos`` e ``treinamentos`` inativos, as rotas de onboarding também deixam de ser montadas (só existiam para ligar
o processo seletivo ao treinamento). Os DADOS nunca são tocados e o código continua no repositório: reativar é só ajustar a
variável e reiniciar o backend. O frontend recebe a lista em ``GET /core/acesso`` (``areas_inativas``) e não carrega, não
exibe e não consulta nada das áreas inativas.
"""

from __future__ import annotations

import os

SUPORTE_TI = "suporte_ti"
TREINAMENTOS = "treinamentos"
PROCESSOS = "processos"
PROVAS = "provas"
CURRICULOS = "curriculos"
AREAS_CONHECIDAS = frozenset({SUPORTE_TI, TREINAMENTOS, PROCESSOS, PROVAS, CURRICULOS})
VARIAVEL = "RH_AREAS_INATIVAS"
PADRAO = ",".join((SUPORTE_TI, TREINAMENTOS, PROCESSOS, PROVAS, CURRICULOS))

# Função do menu de módulos (V062) -> área que a sustenta. Função de área inativa aparece em Módulos como desativada
# e NÃO pode ser ligada enquanto a área estiver inativa.
AREA_DA_FUNCAO = {
    "suporte": SUPORTE_TI,
    "processos": PROCESSOS,
    "provas": PROVAS,
    "cx-curriculos": CURRICULOS,
}


def areas_inativas() -> frozenset[str]:
    bruto = os.environ.get(VARIAVEL)
    texto = PADRAO if bruto is None else bruto
    return frozenset(p.strip().lower() for p in texto.split(",") if p.strip().lower() in AREAS_CONHECIDAS)


def area_ativa(area: str) -> bool:
    return area not in areas_inativas()


def funcao_disponivel(funcao: str) -> bool:
    """A função do menu de módulos está disponível (sua área não está inativa)?"""
    area = AREA_DA_FUNCAO.get(funcao)
    return area is None or area_ativa(area)


def onboarding_ativo() -> bool:
    """Onboarding só é montado se Treinamentos ou Processos seletivos estiverem ativos (um depende do outro)."""
    return area_ativa(TREINAMENTOS) or area_ativa(PROCESSOS)
