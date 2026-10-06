"""Escala de pausas do WFM — regras PURAS (sem I/O).

Cada operador escalado tem 3 pausas por dia: 2 de 10 min (DESCANSO) e 1 de 20 min (REFEICAO), todas
contadas como jornada (NR-17). Pausas emergenciais (banheiro, feedback...) não entram aqui. A quantidade
de operadores em pausa AO MESMO TEMPO depende do tamanho da operação (ex.: 1 em operações pequenas, 4
recomendado em operações grandes): é um parâmetro por operação, e exceder é ALERTA (não há limite rígido).

Convenção de tempo: minutos desde 00:00 do dia em que o turno COMEÇA. Turno que atravessa a meia-noite
tem `saida` > 1440; horários de pausa depois da meia-noite são "desenrolados" (+1440) para comparação.
"""

from __future__ import annotations

from dataclasses import dataclass

# (ordem, tipo, duração em minutos)
PAUSAS_PADRAO: tuple[tuple[int, str, int], ...] = ((1, "DESCANSO", 10), (2, "REFEICAO", 20), (3, "DESCANSO", 10))
PASSO_MIN = 5


def hhmm_para_min(valor: str) -> int:
    h, m = valor.split(":")
    return int(h) * 60 + int(m)


def min_para_hhmm(minutos: int) -> str:
    minutos %= 1440
    return f"{minutos // 60:02d}:{minutos % 60:02d}"


def janela_do_turno(entrada: str, saida: str) -> tuple[int, int]:
    """(início, fim) em minutos; `fim` > 1440 quando o turno atravessa a meia-noite."""
    ini, fim = hhmm_para_min(entrada), hhmm_para_min(saida)
    return ini, fim + 1440 if fim <= ini else fim


def desenrolar(inicio: str, entrada_min: int) -> int:
    """Horário da pausa na linha do tempo do turno (depois da meia-noite soma 1440)."""
    t = hhmm_para_min(inicio)
    return t + 1440 if t < entrada_min else t


@dataclass(frozen=True)
class PausaProgramada:
    ordem: int
    tipo: str
    inicio_min: int  # desenrolado
    duracao_min: int

    @property
    def fim_min(self) -> int:
        return self.inicio_min + self.duracao_min


def ocupacao(programacao: dict[int, list[PausaProgramada]]) -> dict[int, int]:
    """minuto (passo de 5) -> quantos operadores estão em pausa naquele minuto."""
    mapa: dict[int, int] = {}
    for pausas in programacao.values():
        for p in pausas:
            for minuto in range(p.inicio_min - p.inicio_min % PASSO_MIN, p.fim_min, PASSO_MIN):
                if minuto + PASSO_MIN > p.inicio_min:
                    mapa[minuto] = mapa.get(minuto, 0) + 1
    return mapa


def excedentes(programacao: dict[int, list[PausaProgramada]], capacidade: int) -> list[dict]:
    """Faixas de horário em que há mais operadores em pausa do que a capacidade da operação."""
    faixas: list[dict] = []
    for minuto, qtd in sorted(ocupacao(programacao).items()):
        if qtd <= capacidade:
            continue
        if faixas and faixas[-1]["fim_min"] == minuto and faixas[-1]["qtd"] == qtd:
            faixas[-1]["fim_min"] = minuto + PASSO_MIN
        else:
            faixas.append({"inicio_min": minuto, "fim_min": minuto + PASSO_MIN, "qtd": qtd})
    return [
        {"inicio": min_para_hhmm(f["inicio_min"]), "fim": min_para_hhmm(f["fim_min"]), "qtd": f["qtd"], "capacidade": capacidade}
        for f in faixas
    ]


def validar_pausas_do_operador(pausas: list[PausaProgramada], entrada_min: int, saida_min: int) -> list[str]:
    erros: list[str] = []
    ordenadas = sorted(pausas, key=lambda p: p.inicio_min)
    for p in ordenadas:
        if p.inicio_min < entrada_min or p.fim_min > saida_min:
            erros.append(f"A pausa das {min_para_hhmm(p.inicio_min)} está fora do horário do turno.")
    for a, b in zip(ordenadas, ordenadas[1:]):
        if b.inicio_min < a.fim_min:
            erros.append(f"As pausas das {min_para_hhmm(a.inicio_min)} e das {min_para_hhmm(b.inicio_min)} se sobrepõem.")
    return erros


def horarios_ideais(entrada_min: int, saida_min: int) -> list[int]:
    """Horário desejado de cada uma das 3 pausas: 25%, 50% e 75% do turno (arredondado ao passo)."""
    duracao = saida_min - entrada_min
    return [entrada_min + round(duracao * f / PASSO_MIN) * PASSO_MIN for f in (0.25, 0.5, 0.75)]


def distribuir(operadores: list[dict], capacidade: int, ocupado_inicial: dict[int, int] | None = None) -> dict[int, list[PausaProgramada]]:
    """Distribui as 3 pausas de cada operador respeitando a capacidade simultânea, de forma
    determinística (guloso): pausa 1 de todos, depois a 2, depois a 3; cada uma no primeiro horário
    a partir do ideal com vaga. `operadores`: [{"id": int, "entrada_min": int, "saida_min": int}].
    Se não houver vaga dentro do turno, usa o horário ideal (o excedente aparece como alerta)."""
    capacidade = max(int(capacidade), 1)
    resultado: dict[int, list[PausaProgramada]] = {o["id"]: [] for o in operadores}
    ocupado: dict[int, int] = dict(ocupado_inicial or {})  # pausas já programadas de outros operadores
    for indice, (ordem, tipo, duracao) in enumerate(PAUSAS_PADRAO):
        for op in sorted(operadores, key=lambda o: (o["entrada_min"], o["id"])):
            ideal = horarios_ideais(op["entrada_min"], op["saida_min"])[indice]
            proprias = resultado[op["id"]]
            inicio = None
            tentativa = ideal
            while tentativa + duracao <= op["saida_min"]:
                livre = all(ocupado.get(m, 0) < capacidade for m in range(tentativa, tentativa + duracao, PASSO_MIN))
                sem_choque = all(tentativa >= p.fim_min or tentativa + duracao <= p.inicio_min for p in proprias)
                if livre and sem_choque:
                    inicio = tentativa
                    break
                tentativa += PASSO_MIN
            if inicio is None:
                inicio = min(ideal, op["saida_min"] - duracao)
            proprias.append(PausaProgramada(ordem, tipo, inicio, duracao))
            for m in range(inicio, inicio + duracao, PASSO_MIN):
                ocupado[m] = ocupado.get(m, 0) + 1
    for pausas in resultado.values():
        pausas.sort(key=lambda p: p.ordem)
    return resultado


def replicar(
    operadores: list[dict], capacidade: int, ocupado_inicial: dict[int, int] | None = None
) -> tuple[dict[int, list[PausaProgramada]], int, int]:
    """Aplica num dia os horários de pausa escolhidos pelo supervisor (o "modelo" de um dia de origem) respeitando o limite de
    operadores em pausa ao mesmo tempo. `operadores`: [{"id", "entrada_min", "saida_min", "modelo": [(ordem, tipo, "HH:MM", duracao)]}].

    Mantém o horário do modelo sempre que ele cabe no turno do dia, não bate com outra pausa do próprio operador e não passa
    do limite. Só a pausa que estouraria o limite (ou não cabe no turno) é deslocada para o horário livre mais próximo dentro
    do turno. Sem nenhum horário livre, mantém o horário (se couber no turno) ou o ideal, e conta como excedente (alerta).
    Devolve (pausas por operador, quantas pausas foram deslocadas, quantas ficaram acima do limite)."""
    capacidade = max(int(capacidade), 1)
    resultado: dict[int, list[PausaProgramada]] = {o["id"]: [] for o in operadores}
    ocupado: dict[int, int] = dict(ocupado_inicial or {})
    deslocadas = acima_do_limite = 0

    def livre(inicio: int, dur: int) -> bool:
        return all(ocupado.get(m, 0) < capacidade for m in range(inicio, inicio + dur, PASSO_MIN))

    for indice, ordem in enumerate(sorted({m[0] for o in operadores for m in o["modelo"]})):
        for op in sorted(operadores, key=lambda o: (o["entrada_min"], o["id"])):
            item = next((m for m in op["modelo"] if m[0] == ordem), None)
            if item is None:
                continue
            _, tipo, hhmm, dur = item
            ini_t, fim_t = op["entrada_min"], op["saida_min"]
            proprias = resultado[op["id"]]

            def cabe(inicio: int) -> bool:
                return (inicio >= ini_t and inicio + dur <= fim_t
                        and all(inicio >= p.fim_min or inicio + dur <= p.inicio_min for p in proprias))

            preferido = desenrolar(hhmm, ini_t)
            if preferido < ini_t or preferido + dur > fim_t:  # o horário do modelo não existe neste turno: parte do ideal do turno
                preferido = horarios_ideais(ini_t, fim_t)[min(indice, 2)]
            escolhido = None
            if cabe(preferido) and livre(preferido, dur):
                escolhido = preferido
            else:
                for passo in range(PASSO_MIN, (fim_t - ini_t) + PASSO_MIN, PASSO_MIN):  # procura em volta, dentro do turno
                    for cand in (preferido + passo, preferido - passo):  # depois primeiro: o dia segue em frente
                        if cabe(cand) and livre(cand, dur):
                            escolhido = cand
                            break
                    if escolhido is not None:
                        break
                if escolhido is not None:
                    deslocadas += 1
            if escolhido is None:
                # Sem horário livre: mantém o do modelo se couber no turno; senão o ideal (e o excesso vira alerta).
                ideal = horarios_ideais(ini_t, fim_t)[min(indice, 2)]
                escolhido = preferido if cabe(preferido) else min(max(ideal, ini_t), fim_t - dur)
                acima_do_limite += 1
            proprias.append(PausaProgramada(ordem, tipo, escolhido, dur))
            for m in range(escolhido, escolhido + dur, PASSO_MIN):
                ocupado[m] = ocupado.get(m, 0) + 1
    for pausas in resultado.values():
        pausas.sort(key=lambda p: p.ordem)
    return resultado, deslocadas, acima_do_limite
