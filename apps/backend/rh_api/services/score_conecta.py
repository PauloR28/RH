from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from typing import Any

CLASSIFICACOES = (
    (85, "Forte indicação"),
    (70, "Indicado"),
    (55, "Indicado com restrições"),
    (40, "Reavaliar"),
    (0, "Contraindicado"),
)


@dataclass(frozen=True)
class PesoEtapa:
    chave: str
    rotulo: str
    peso: float
    obrigatoria: bool = False


PESOS_POR_PERFIL: dict[str, tuple[PesoEtapa, ...]] = {
    "estagio": (
        PesoEtapa("curriculo", "Currículo", 20),
        PesoEtapa("prova_objetiva", "Prova objetiva", 30, True),
        PesoEtapa("redacao", "Redação/comunicação", 25, True),
        PesoEtapa("entrevista", "Entrevista", 25),
    ),
    "operacao": (
        PesoEtapa("curriculo", "Currículo", 15),
        PesoEtapa("prova_objetiva", "Prova objetiva", 25, True),
        PesoEtapa("atendimento_comunicacao", "Atendimento/comunicação", 25),
        PesoEtapa("redacao", "Redação", 15),
        PesoEtapa("entrevista", "Entrevista", 20),
    ),
    "administrativo": (
        PesoEtapa("curriculo", "Currículo", 20),
        PesoEtapa("prova_objetiva", "Prova objetiva", 25, True),
        PesoEtapa("excel_raciocinio", "Excel/raciocínio", 25),
        PesoEtapa("redacao", "Redação/comunicação", 15),
        PesoEtapa("entrevista", "Entrevista", 15),
    ),
    "ti": (
        PesoEtapa("curriculo", "Currículo", 15),
        PesoEtapa("prova_tecnica", "Prova técnica", 40, True),
        PesoEtapa("raciocinio_logico", "Raciocínio lógico", 15),
        PesoEtapa("comunicacao", "Comunicação", 10),
        PesoEtapa("entrevista", "Entrevista", 20),
    ),
    "gestao": (
        PesoEtapa("curriculo", "Currículo", 20),
        PesoEtapa("prova_tecnica_analitica", "Prova técnica/analítica", 30, True),
        PesoEtapa("redacao", "Redação/comunicação", 20, True),
        PesoEtapa("entrevista", "Entrevista", 25),
        PesoEtapa("aderencia", "Aderência à vaga", 5),
    ),
}


def _normalizar(valor: Any) -> str:
    texto = str(valor or "").strip().lower()
    texto = unicodedata.normalize("NFD", texto)
    texto = "".join(char for char in texto if unicodedata.category(char) != "Mn")
    return texto


def _numero_0_100(valor: Any) -> float | None:
    if valor in (None, ""):
        return None

    if isinstance(valor, str):
        texto = valor.strip().replace("%", "").replace(" ", "")
        if "," in texto and "." not in texto:
            texto = texto.replace(",", ".")
        else:
            texto = texto.replace(",", "")
        try:
            numero = float(texto)
        except ValueError:
            return None
    else:
        try:
            numero = float(valor)
        except (TypeError, ValueError):
            return None

    if numero <= 10:
        numero *= 10
    return max(0, min(100, round(numero, 2)))


def selecionar_perfil_pesos(vaga: Any = "", trilha: Any = "", nivel: Any = "") -> str:
    texto = " ".join([_normalizar(vaga), _normalizar(trilha), _normalizar(nivel)])
    if "estagi" in texto or "aprendiz" in texto:
        return "estagio"
    if "suporte" in texto or "ti" in texto or "tecnico" in texto or "control desk" in texto:
        return "ti"
    if "gestao" in texto or "supervisor" in texto or "planejamento" in texto:
        return "gestao"
    if "finance" in texto or "adm" in texto or "administr" in texto or "analista" in texto:
        return "administrativo"
    return "operacao"


def _score_categoria(categorias: dict[str, Any], *nomes: str) -> float | None:
    for nome in nomes:
        for chave, valor in categorias.items():
            if _normalizar(chave) == _normalizar(nome):
                return _numero_0_100(valor)
    return None


def _montar_scores_base(
    candidato: dict[str, Any],
    prova: dict[str, Any],
    resultado: dict[str, Any],
) -> dict[str, float | None]:
    categorias = resultado.get("score_por_categoria") or resultado.get("notas_por_categoria") or {}
    if not isinstance(categorias, dict):
        categorias = {}

    score_objetiva = _numero_0_100(
        resultado.get("nota_objetiva")
        or resultado.get("nota_final_prova")
        or prova.get("nota_final_prova")
        or candidato.get("nota_prova")
        or candidato.get("pontuacao_final")
    )
    score_excel = _numero_0_100(resultado.get("nota_excel")) or _score_categoria(
        categorias,
        "Excel",
        "Excel/raciocínio",
        "Raciocínio lógico",
    )
    score_tecnica = _numero_0_100(resultado.get("nota_tecnica")) or _score_categoria(
        categorias,
        "Conhecimento técnico",
        "Técnica",
        "Sistemas",
        "TI",
    )
    score_comunicacao = _numero_0_100(resultado.get("nota_comunicacao")) or _score_categoria(
        categorias,
        "Comunicação",
        "Atendimento",
        "Interpretação de texto",
        "Português",
    )

    return {
        "curriculo": _numero_0_100(
            candidato.get("score_curriculo")
            or candidato.get("cv_score_final")
            or candidato.get("score_cv")
            or candidato.get("nota_curriculo")
        ),
        "prova_objetiva": score_objetiva,
        "redacao": _numero_0_100(resultado.get("nota_redacao")),
        "entrevista": _numero_0_100(
            resultado.get("nota_entrevista")
            or candidato.get("nota_entrevista")
            or prova.get("nota_entrevista")
        ),
        "aderencia": _numero_0_100(
            resultado.get("score_aderencia")
            or candidato.get("score_aderencia")
            or candidato.get("aderencia_curriculo")
        ),
        "atendimento_comunicacao": score_comunicacao,
        "excel_raciocinio": score_excel,
        "prova_tecnica": score_tecnica or score_objetiva,
        "raciocinio_logico": _score_categoria(categorias, "Raciocínio lógico") or score_excel,
        "comunicacao": score_comunicacao,
        "prova_tecnica_analitica": score_tecnica or score_excel or score_objetiva,
        "lgpd": _numero_0_100(resultado.get("nota_lgpd")) or _score_categoria(categorias, "LGPD"),
    }


def _classificar(score: float) -> str:
    for minimo, classificacao in CLASSIFICACOES:
        if score >= minimo:
            return classificacao
    return "Contraindicado"


def _limitar_classificacao(classificacao: str, limite: str) -> str:
    ordem = [
        "Forte indicação",
        "Indicado",
        "Indicado com restrições",
        "Reavaliar",
        "Contraindicado",
        "Pendente de avaliação",
    ]
    if classificacao not in ordem or limite not in ordem:
        return classificacao
    return ordem[max(ordem.index(classificacao), ordem.index(limite))]


def _tem_etapa(prova: dict[str, Any], *termos: str) -> bool:
    etapas = prova.get("etapas") or prova.get("etapas_prova") or []
    if isinstance(etapas, str):
        texto = _normalizar(etapas)
        return any(_normalizar(termo) in texto for termo in termos)
    if not isinstance(etapas, list):
        return False
    texto = " ".join(_normalizar(item.get("label") or item.get("stage") or item.get("key") or item) for item in etapas)
    return any(_normalizar(termo) in texto for termo in termos)


def calcular_score_conecta(
    candidato: dict[str, Any] | None,
    prova: dict[str, Any] | None,
    processo: dict[str, Any] | None,
    configuracao: dict[str, Any] | None,
) -> dict[str, Any]:
    candidato = candidato or {}
    prova = prova or {}
    processo = processo or {}
    configuracao = configuracao or {}
    resultado = prova.get("resultado") or {}

    perfil = selecionar_perfil_pesos(
        prova.get("vaga") or processo.get("vaga") or candidato.get("vaga"),
        prova.get("trilha") or processo.get("trilha"),
        prova.get("nivel") or configuracao.get("nivel"),
    )
    pesos = PESOS_POR_PERFIL[perfil]
    scores = _montar_scores_base(candidato, prova, resultado)

    exige_redacao = bool(
        configuracao.get("redacao_obrigatoria")
        or _tem_etapa(prova, "redacao", "comunicacao escrita", "professional_essay")
    )
    exige_entrevista = bool(configuracao.get("entrevista_obrigatoria"))

    componentes: dict[str, dict[str, Any]] = {}
    soma = 0.0
    soma_pesos = 0.0
    dados_ausentes: list[str] = []
    alertas: list[str] = []
    pontos_fortes: list[str] = []
    pontos_atencao: list[str] = []

    for item in pesos:
        score = scores.get(item.chave)
        obrigatoria = item.obrigatoria or (item.chave == "redacao" and exige_redacao) or (
            item.chave == "entrevista" and exige_entrevista
        )
        considerado = score is not None
        componentes[item.chave] = {
            "score": score,
            "peso": item.peso,
            "considerado": considerado,
            "obrigatoria": obrigatoria,
            "rotulo": item.rotulo,
        }
        if considerado:
            soma += float(score) * item.peso
            soma_pesos += item.peso
            if score >= 78:
                pontos_fortes.append(f"Bom desempenho em {item.rotulo.lower()}.")
            elif score < 55:
                pontos_atencao.append(f"Desempenho em {item.rotulo.lower()} abaixo do esperado.")
        elif obrigatoria:
            dados_ausentes.append(item.rotulo)
            alertas.append("Existem etapas obrigatórias sem avaliação.")
        else:
            pontos_atencao.append(f"Faltam dados de {item.rotulo.lower()} para uma leitura mais segura.")

    score_final = round(soma / soma_pesos, 2) if soma_pesos else 0.0
    classificacao = _classificar(score_final)
    status_analise = "Completa"

    if dados_ausentes:
        classificacao = "Pendente de avaliação"
        status_analise = "Incompleta"
    elif any("obrigatórias" in item for item in alertas):
        status_analise = "Incompleta"

    perfil_tecnico = perfil in {"ti", "gestao", "administrativo"}
    score_tecnico = scores.get("prova_tecnica") or scores.get("prova_tecnica_analitica") or scores.get("excel_raciocinio")
    if perfil_tecnico and score_tecnico is not None and score_tecnico < 50:
        classificacao = _limitar_classificacao(classificacao, "Indicado com restrições")
        alertas.append("Desempenho técnico abaixo do mínimo recomendado para a vaga.")
        if score_tecnico < 35:
            classificacao = _limitar_classificacao(classificacao, "Reavaliar")

    score_redacao = scores.get("redacao")
    if exige_redacao and score_redacao is None:
        status_analise = "Pendente de avaliação manual"
        classificacao = "Pendente de avaliação"
        dados_ausentes.append("Redação corrigida")
    elif exige_redacao and score_redacao is not None and score_redacao < 50:
        classificacao = _limitar_classificacao(classificacao, "Indicado com restrições")
        alertas.append("Comunicação escrita abaixo do esperado para a vaga.")

    score_entrevista = scores.get("entrevista")
    if exige_entrevista and score_entrevista is None:
        status_analise = "Incompleta"
        classificacao = "Pendente de avaliação"
        dados_ausentes.append("Entrevista")
    elif exige_entrevista and score_entrevista is not None and score_entrevista < 50:
        classificacao = _limitar_classificacao(classificacao, "Reavaliar")
        alertas.append("Entrevista abaixo do mínimo recomendado.")

    score_lgpd = scores.get("lgpd")
    if score_lgpd is not None and score_lgpd < 50:
        alertas.append("Baixo desempenho em LGPD para uma vaga com possível tratamento de dados pessoais.")
        if perfil in {"ti", "administrativo", "gestao"}:
            classificacao = _limitar_classificacao(classificacao, "Indicado com restrições")

    pares_inconsistentes = (
        ("prova_tecnica", "entrevista"),
        ("curriculo", "prova_objetiva"),
        ("prova_tecnica", "atendimento_comunicacao"),
    )
    for esquerda, direita in pares_inconsistentes:
        score_esquerda = scores.get(esquerda)
        score_direita = scores.get(direita)
        if score_esquerda is not None and score_direita is not None and abs(score_esquerda - score_direita) >= 35:
            alertas.append("Há divergência relevante entre etapas avaliadas.")
            break

    if status_analise == "Completa" and alertas:
        status_analise = "Com alerta crítico"

    if status_analise in {"Incompleta", "Pendente de avaliação manual"}:
        confiabilidade = "Incompleta"
    elif dados_ausentes:
        confiabilidade = "Baixa"
    elif alertas:
        confiabilidade = "Média"
    elif len([item for item in componentes.values() if item["considerado"]]) >= 3:
        confiabilidade = "Alta"
    else:
        confiabilidade = "Baixa"

    if not pontos_fortes:
        pontos_fortes.append("Nenhum ponto forte automático foi consolidado ainda.")
    if not pontos_atencao and dados_ausentes:
        pontos_atencao.append("Faltam dados para uma conclusão segura.")
    elif not pontos_atencao:
        pontos_atencao.append("Manter validação humana antes da decisão final.")

    justificativa = (
        f"Score calculado pelo perfil {perfil}, considerando apenas etapas válidas e avaliadas. "
        "A decisão final permanece manual do RH."
    )

    return {
        "score_final": score_final,
        "classificacao": classificacao,
        "status_analise": status_analise,
        "confiabilidade": confiabilidade,
        "perfil_pesos": perfil,
        "componentes": componentes,
        "pontos_fortes": list(dict.fromkeys(pontos_fortes)),
        "pontos_atencao": list(dict.fromkeys(pontos_atencao)),
        "alertas_criticos": list(dict.fromkeys(alertas)),
        "dados_ausentes": list(dict.fromkeys(dados_ausentes)),
        "justificativa": justificativa,
    }
