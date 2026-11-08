"""Regras puras do Diário de bordo (sem banco): cálculos do turno e do dia, ABS, avisos e importação do protótipo.

Mesmas regras do protótipo (diario-de-bordo-standalone.html), com uma diferença de propósito: VAZIO NUNCA VIRA 0.
O protótipo trocava campo vazio por 0; aqui `None` atravessa todas as contas e aparece como "—" / "não informado".
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import date, datetime, time
from typing import Any

TURNOS: tuple[str, ...] = ("abertura", "intermediario", "fechamento")
ROTULO_TURNO = {"abertura": "Abertura", "intermediario": "Intermediário", "fechamento": "Fechamento"}
STATUS_TURNO = ("rascunho", "concluido")
ENCERRAMENTOS = ("sem_pendencias", "com_pendencias", "outro")
ROTULO_ENCERRAMENTO = {"sem_pendencias": "Sem pendências", "com_pendencias": "Com pendências para o próximo dia", "outro": "Outro"}
CANAIS_INTERCORRENCIA = ("digital", "voz", "ambos", "interno")
ROTULO_CANAL = {"digital": "Digital", "voz": "Voz", "ambos": "Os dois", "interno": "Só interno"}
TIPOS_CADASTRO = ("demanda", "canal_ns", "canal_parcial", "ferramenta")

# Turno pela hora de início (intercorrência) e "turno da hora atual" (tela abre nele). O protótipo não tinha horário:
# a pessoa escolhia. Limites iguais aos da amostra aprovada (Abertura até 11:59, Intermediário 12:00-16:59, Fechamento 17:00+).
HORA_INTERMEDIARIO = time(12, 0)
HORA_FECHAMENTO = time(17, 0)
FIM_FECHAMENTO = time(19, 0)  # prazo mostrado no "Precisa de você" do Início

# Presença do WFM -> ABS (D3). Siglas: P+SE presentes; F falta; FJ+AT justificada; FL+DO+FB folga; FE férias.
PRESENCA_PRESENTE = ("PRESENTE", "SERVICO_EXTERNO")
PRESENCA_FALTA = ("FALTA",)
PRESENCA_JUSTIFICADA = ("FALTA_JUSTIFICADA", "ATESTADO")
PRESENCA_FOLGA = ("FOLGA", "DAY_OFF", "FOLGA_COMP_BH")
PRESENCA_FERIAS = ("FERIAS",)
CAMPOS_ABS = ("presentes", "faltas", "justificadas", "folgas", "ferias")


# ------------------------------------------------------------------ números
def numero_ou_vazio(valor: Any) -> int | None:
    """Converte o que veio da tela/arquivo em inteiro >= 0; vazio (None, "", espaços) continua None. Nunca inventa 0."""
    if valor is None or isinstance(valor, bool):
        return None
    if isinstance(valor, (int, float)):
        return max(0, int(valor))
    texto = str(valor).strip()
    if not texto:
        return None
    try:
        return max(0, int(float(texto.replace(",", "."))))
    except ValueError:
        return None


def percentual_ou_vazio(valor: Any) -> float | None:
    """NS em %: 0 a 100 com até 2 casas; vazio continua None."""
    if valor is None or isinstance(valor, bool):
        return None
    texto = str(valor).strip().replace("%", "").replace(",", ".")
    if not texto:
        return None
    try:
        numero = float(texto)
    except ValueError:
        return None
    if numero < 0 or numero > 100:
        raise ValueError("O nível de serviço vai de 0 a 100%.")
    return round(numero, 2)


def tratadas(inicio: int | None, fim: int | None) -> int | None:
    """Tratadas = máx(0, início − fim). Se um dos dois está vazio, o resultado é vazio (não 0)."""
    if inicio is None or fim is None:
        return None
    return max(0, inicio - fim)


def soma_ou_vazio(valores: Iterable[int | None]) -> int | None:
    lista = [v for v in valores if v is not None]
    return sum(lista) if lista else None


# ------------------------------------------------------------------ turno
def avisos_do_turno(demandas: Iterable[Mapping[str, Any]]) -> list[dict]:
    """Avisos que deixam salvar o rascunho mas pedem observação para concluir.

    `demandas`: [{id_item, nome, inicio, fim}]. Aviso por linha: fim maior que o início (entraram demandas novas?) e
    campo vazio (início ou fim não informado)."""
    avisos = []
    for d in demandas:
        ini, fim = d.get("inicio"), d.get("fim")
        if ini is not None and fim is not None and fim > ini:
            avisos.append({"id_item": d.get("id_item"), "nome": d.get("nome"), "tipo": "fim_maior", "texto": "Fim maior que o início"})
        elif ini is None and fim is None:
            avisos.append({"id_item": d.get("id_item"), "nome": d.get("nome"), "tipo": "vazio", "texto": "Início e fim vazios"})
        elif ini is None:
            avisos.append({"id_item": d.get("id_item"), "nome": d.get("nome"), "tipo": "vazio", "texto": "Início vazio"})
        elif fim is None:
            avisos.append({"id_item": d.get("id_item"), "nome": d.get("nome"), "tipo": "vazio", "texto": "Fim vazio"})
    return avisos


def pode_concluir_turno(avisos: list[dict], observacoes: str | None) -> tuple[bool, str]:
    if avisos and not str(observacoes or "").strip():
        nomes = ", ".join(dict.fromkeys(str(a.get("nome") or "") for a in avisos))
        return False, f"Há {len(avisos)} aviso(s) ({nomes}). Para concluir, preencha os campos ou explique em Observações do turno."
    return True, ""


def turno_pela_hora(momento: datetime | time) -> str:
    hora = momento.time() if isinstance(momento, datetime) else momento
    if hora >= HORA_FECHAMENTO:
        return "fechamento"
    if hora >= HORA_INTERMEDIARIO:
        return "intermediario"
    return "abertura"


# ------------------------------------------------------------------ dia
def consolidar_dia(turnos: Mapping[str, Mapping[str, Any]], ids_demanda: Iterable[int], ids_ns: Iterable[int]) -> dict:
    """Consolidado do dia (mesma regra do protótipo, com vazio != 0).

    `turnos`: {turno: {"demandas": {id_item: (inicio, fim)}, "ns": {id_item: valor}}} (turno ausente = não começou).
      * Início do dia = início do 1º turno que tem o início daquele tipo.
      * Tratadas = soma das tratadas dos turnos (turno com início ou fim vazio não entra; tudo vazio = vazio).
      * Pendente = fim do último turno que tem o fim daquele tipo (`pend_de` diz de qual turno veio).
      * NS do dia = valor do último turno preenchido em cada canal (não é a média); `ns_de` diz de qual turno veio.
    """
    linhas = []
    for id_item in ids_demanda:
        ini = ini_de = None
        pend = pend_de = None
        tratadas_turnos = []
        for t in TURNOS:
            par = (turnos.get(t) or {}).get("demandas", {}).get(id_item)
            if not par:
                continue
            a, b = par
            if ini is None and a is not None:
                ini, ini_de = a, t
            if b is not None:
                pend, pend_de = b, t
            tratadas_turnos.append(tratadas(a, b))
        linhas.append({"id_item": id_item, "inicio": ini, "inicio_de": ini_de, "tratadas": soma_ou_vazio(tratadas_turnos), "pendente": pend, "pendente_de": pend_de})
    ns = []
    for id_item in ids_ns:
        valor = de = None
        for t in TURNOS:
            v = (turnos.get(t) or {}).get("ns", {}).get(id_item)
            if v is not None:
                valor, de = v, t
        ns.append({"id_item": id_item, "valor": valor, "de": de})
    return {
        "demandas": linhas,
        "totais": {
            "inicio": soma_ou_vazio(l["inicio"] for l in linhas),
            "tratadas": soma_ou_vazio(l["tratadas"] for l in linhas),
            "pendente": soma_ou_vazio(l["pendente"] for l in linhas),
        },
        "ns": ns,
    }


def pode_encerrar_dia(status_turnos: Mapping[str, str]) -> tuple[bool, str]:
    faltam = [ROTULO_TURNO[t] for t in TURNOS if status_turnos.get(t) != "concluido"]
    if faltam:
        return False, f"Para encerrar o dia, os 3 turnos precisam estar concluídos. Falta: {', '.join(faltam)}."
    return True, ""


# ------------------------------------------------------------------ ABS
def _pct(parte: int, total: int) -> float | None:
    return round(parte * 100.0 / total, 1) if total else None


def abs_de_contagem(contagem: Mapping[str, Any]) -> dict:
    """ABS a partir de presentes/faltas/justificadas/folgas/férias. Escalados = presentes + faltas + justificadas
    (folga e férias são ausências planejadas e não contam). ABS = (faltas + justificadas) ÷ escalados."""
    v = {c: numero_ou_vazio(contagem.get(c)) or 0 for c in CAMPOS_ABS}
    escalados = v["presentes"] + v["faltas"] + v["justificadas"]
    return {
        **v,
        "escalados": escalados,
        "abs": _pct(v["faltas"] + v["justificadas"], escalados),
        "abs_faltas": _pct(v["faltas"], escalados),
        "abs_justificadas": _pct(v["justificadas"], escalados),
    }


def abs_da_presenca(status_do_dia: Iterable[str]) -> dict:
    """Conta os lançamentos de presença do dia (um por operador) e calcula o ABS. Sem lançamento não entra na conta."""
    contagem = dict.fromkeys(CAMPOS_ABS, 0)
    grupos = (
        ("presentes", PRESENCA_PRESENTE), ("faltas", PRESENCA_FALTA), ("justificadas", PRESENCA_JUSTIFICADA),
        ("folgas", PRESENCA_FOLGA), ("ferias", PRESENCA_FERIAS),
    )
    for status in status_do_dia:
        s = str(status or "").strip().upper()
        for campo, codigos in grupos:
            if s in codigos:
                contagem[campo] += 1
                break
    return abs_de_contagem(contagem)


def abs_vigente(presenca: dict, correcao: Mapping[str, Any] | None) -> dict:
    """O que vale para o dia, a imagem e o texto: a correção (se houver), senão a Presença."""
    if correcao:
        return {**abs_de_contagem(correcao), "origem": "correcao"}
    return {**presenca, "origem": "presenca"}


# ------------------------------------------------------------------ importação do protótipo (D7)
def _data_iso(texto: Any) -> str | None:
    try:
        return date.fromisoformat(str(texto).strip()[:10]).isoformat()
    except ValueError:
        return None


def _hora(texto: Any) -> str | None:
    t = str(texto or "").strip()
    if len(t) >= 4 and ":" in t:
        hh, mm = t.split(":", 1)[0], t.split(":", 1)[1][:2]
        if hh.isdigit() and mm.isdigit() and 0 <= int(hh) < 24 and 0 <= int(mm) < 60:
            return f"{int(hh):02d}:{int(mm):02d}"
    return None


def registros_do_arquivo(conteudo: Any) -> dict:
    """Aceita o export do protótipo ({tipo, versao, dados}) ou o objeto cru de `diarioBordo_registros_v4` (data -> dia)."""
    if isinstance(conteudo, Mapping) and isinstance(conteudo.get("dados"), Mapping):
        conteudo = conteudo["dados"]
    if not isinstance(conteudo, Mapping):
        raise ValueError("Arquivo sem registros do Diário de bordo.")  # noqa: TRY004 (vira 422 com esta mensagem)
    return {k: v for k, v in conteudo.items() if _data_iso(k) and isinstance(v, Mapping)}


def normalizar_dia_prototipo(data_iso: str, dia: Mapping[str, Any], chaves: Mapping[str, Mapping[str, int]]) -> dict:
    """Converte 1 dia do protótipo para a estrutura do Conecta. `chaves`: {tipo: {chave_prototipo: id_item}}.
    Devolve também o que não foi reconhecido (para a prévia), sem inventar nada."""
    desconhecidos: set[str] = set()
    turnos = {}
    for t in TURNOS:
        reg = dia.get(t)
        if not isinstance(reg, Mapping) or reg.get("excluido"):
            continue
        demandas = {}
        for chave, par in (reg.get("demandas") or {}).items():
            id_item = chaves.get("demanda", {}).get(chave)
            if id_item is None:
                desconhecidos.add(f"demanda:{chave}")
                continue
            par = par if isinstance(par, Mapping) else {}
            demandas[id_item] = (numero_ou_vazio(par.get("inicio")), numero_ou_vazio(par.get("fim")))
        ns = {}
        for chave, valor in (reg.get("sla") or {}).items():
            id_item = chaves.get("canal_ns", {}).get(chave)
            if id_item is None:
                desconhecidos.add(f"canal:{chave}")
                continue
            try:
                ns[id_item] = percentual_ou_vazio(valor)
            except ValueError:
                ns[id_item] = None
        turnos[t] = {"demandas": demandas, "ns": ns, "autor": str(reg.get("atualizadoPor") or reg.get("autor") or "").strip()}
    intercorrencias = []
    for f in dia.get("falhas") or []:
        if not isinstance(f, Mapping) or f.get("excluido"):
            continue
        hora = _hora(f.get("hora")) or "00:00"
        dia_ini = _data_iso(f.get("data")) or data_iso
        dia_fim = _data_iso(f.get("dataEncerramento")) or (dia_ini if _hora(f.get("horaEncerramento")) else None)
        hora_fim = _hora(f.get("horaEncerramento"))
        turno = f.get("turno") if f.get("turno") in TURNOS else turno_pela_hora(time.fromisoformat(hora))
        intercorrencias.append({
            "turno": turno,
            "ferramenta": str(f.get("ferramenta") or "Não informada").strip()[:120] or "Não informada",
            "inicio": f"{dia_ini}T{hora}",
            "fim": f"{dia_fim}T{hora_fim}" if dia_fim and hora_fim else None,
            "descricao": str(f.get("texto") or "").strip()[:1000] or "(sem descrição no registro antigo)",
            "autor": str(f.get("autor") or "").strip(),
        })
    parciais = []
    for p in dia.get("parciais") or []:
        if not isinstance(p, Mapping) or p.get("excluido"):
            continue
        hora = _hora(p.get("horario"))
        if not hora:
            continue
        valores = {}
        for chave, id_item in chaves.get("canal_parcial", {}).items():
            if chave in p:
                valores[str(id_item)] = numero_ou_vazio(p.get(chave))
        parciais.append({"hora": hora, "valores": valores})
    abs_antigo = None
    a = dia.get("absenteismo")
    if isinstance(a, Mapping):
        abs_antigo = {
            "presentes": numero_ou_vazio(a.get("presentes")), "faltas": numero_ou_vazio(a.get("faltasInjustificadas")),
            "justificadas": numero_ou_vazio(a.get("faltasJustificadas")), "folgas": numero_ou_vazio(a.get("folgas")),
            "ferias": numero_ou_vazio(a.get("ferias")),
        }
    encerramento = None
    e = dia.get("encerramento")
    if isinstance(e, Mapping) and e.get("status") in ENCERRAMENTOS:
        encerramento = {"tipo": e["status"], "passagem": str(e.get("observacoes") or "").strip()[:2000]}
    return {
        "data": data_iso, "turnos": turnos, "intercorrencias": intercorrencias, "parciais": parciais,
        "abs": abs_antigo, "encerramento": encerramento, "desconhecidos": sorted(desconhecidos),
    }


def _quando(reg: Any) -> float:
    try:
        return float(reg.get("atualizadoEm") or 0) if isinstance(reg, Mapping) else 0.0
    except (TypeError, ValueError):
        return 0.0


def mesclar_arquivos(lista: list[Mapping[str, Any]]) -> dict:
    """Junta vários .json do protótipo (cada PC exportava o seu). Mesma regra do `mesclarRegistros` do protótipo:
    por dia e por turno vale o registro mais recente (`atualizadoEm`); falhas e parciais se somam pelo `id`.
    Devolve {"dias": {data: dia}, "repetidos": {datas que vieram em mais de um arquivo}}."""
    dias: dict[str, dict] = {}
    vistos: dict[str, int] = {}
    for registros in lista:
        for data_txt, dia in registros.items():
            data_iso = _data_iso(data_txt)
            vistos[data_iso] = vistos.get(data_iso, 0) + 1
            alvo = dias.setdefault(data_iso, {})
            for chave in (*TURNOS, "absenteismo", "encerramento"):
                novo = dia.get(chave)
                if isinstance(novo, Mapping) and (chave not in alvo or _quando(novo) >= _quando(alvo[chave])):
                    alvo[chave] = novo
            for lista_nome in ("falhas", "parciais"):
                por_id = {str(x.get("id") or i): x for i, x in enumerate(alvo.get(lista_nome) or []) if isinstance(x, Mapping)}
                for i, x in enumerate(dia.get(lista_nome) or []):
                    if not isinstance(x, Mapping):
                        continue
                    chave_item = str(x.get("id") or f"{data_iso}-{lista_nome}-{i}")
                    if chave_item not in por_id or _quando(x) >= _quando(por_id[chave_item]):
                        por_id[chave_item] = x
                alvo[lista_nome] = list(por_id.values())
    return {"dias": dias, "repetidos": {d for d, n in vistos.items() if n > 1}}
