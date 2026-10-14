"""Histórico de Plantões (antiga "Auditoria de Plantões"): regras puras, sem acesso a banco.

- nomes legíveis das ações e cor da bolinha (primária = troca, verde = presente, vermelho = falta, cinza = demais);
- "antes/depois" em pares rótulo/valor, compatível com os registros antigos (JSON solto);
- paginação por cursor (criado_em, id) que nunca repete nem pula linha;
- filtros combinados (texto, operação, entidade, operador, supervisor e período);
- fuso: o banco guarda `criado_em` com GETDATE() (hora local do servidor); tela e arquivos mostram America/Sao_Paulo;
- exportação (XLSX/CSV/PDF) com todas as colunas da tabela e do painel de detalhes.

O log (`wfm_auditoria`) é imutável: nada aqui escreve nele, e registros antigos mostram "—" onde falta o dado novo.
"""

from __future__ import annotations

import base64
import csv
import io
import json
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone, tzinfo
from typing import Any, Iterable, Iterator
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status

FUSO_BRASIL = ZoneInfo("America/Sao_Paulo")

# Limites de exportação (documentados em docs/wfm/HISTORICO.md).
LIMITE_IDS = 1000          # máximo de registros no escopo "somente os selecionados"
LIMITE_LINHAS = 50_000     # máximo de linhas por arquivo XLSX/CSV
LIMITE_LINHAS_PDF = 5_000  # PDF é para imprimir/anexar: teto menor
TAMANHO_PRIMEIRA_PAGINA = 8
TAMANHO_PROXIMAS_PAGINAS = 20
TAMANHO_MAXIMO_PAGINA = 100


ROTULO_ACAO = {
    'editar_escala': 'Editou a escala',
    'corrigir_escala_fechada': 'Corrigiu escala fechada',
    'publicar_escala': 'Publicou a escala',
    'publicar_com_violacao': 'Publicou com violação',
    'fechar_periodo': 'Fechou o período',
    'lancar_presenca': 'Lançou presença',
    'registrar_atestado': 'Registrou atestado',
    'salvar_contrato': 'Salvou jornada',
    'excluir_contrato': 'Excluiu jornada',
    'excluir_turno': 'Excluiu turno',
    'lancar_hora_extra': 'Lançou hora extra',
    'salvar_turno': 'Salvou turno',
    'salvar_skill': 'Salvou skill',
    'salvar_calendario_especial': 'Salvou calendário especial',
    'enviar_aprovacao': 'Enviou para aprovação',
    'aprovar_escala': 'Aprovou a escala',
    'declinar_escala': 'Declinou a escala',
    'cancelar_envio_aprovacao': 'Cancelou o envio para aprovação',
    'criar_tipo_escala': 'Criou tipo de escala',
    'salvar_tipo_escala': 'Salvou tipo de escala',
    'excluir_tipo_escala': 'Excluiu tipo de escala',
    'solicitar_troca': 'Solicitou troca',
    'aceitar_troca': 'Colega aceitou a troca',
    'aprovar_troca': 'Aprovou troca',
    'reprovar_troca': 'Reprovou troca',
    'cancelar_troca': 'Cancelou troca',
    'desfazer_troca': 'Desfez troca',
    'exportar_escala': 'Exportou a escala',
    'duplicar_escala': 'Duplicou a escala',
    'configurar_escala': 'Configurou a escala',
    'vincular_contrato': 'Vinculou jornada',
    'definir_skills': 'Definiu skills',
    'lancar_presenca_lote': 'Lançou presença em lote',
    'programar_pausas': 'Programou pausas',
    'distribuir_pausas': 'Distribuiu pausas',
    'replicar_pausas': 'Replicou pausas',
    'desvincular_contrato': 'Desvinculou jornada',
    'personalizar_turno': 'Personalizou o turno',
    'remover_turno_personalizado': 'Removeu turno personalizado',
    'excluir_escala': 'Excluiu a escala',
    'exportar_relatorio': 'Exportou relatório',
}

ROTULO_CAMPO = {
    'id_contrato': 'Jornada (id)',
    'codigo': 'Código',
    'vigencia_ini': 'Vigência a partir de',
    'nome': 'Nome',
    'tipo': 'Tipo',
    'ativo': 'Ativo',
    'entrada': 'Entrada',
    'saida': 'Saída',
    'versao': 'Versão',
    'itens': 'Itens',
    'violacoes': 'Violações',
    'fechada': 'Fechada',
    'skills': 'Skills',
    'status': 'Status',
    'observacao': 'Observação',
    'categoria': 'Categoria',
    'data_ini': 'Início',
    'data_fim': 'Fim',
    'descricao': 'Descrição',
    'id_operador': 'Operador (id)',
    'id_turno': 'Turno (id)',
    'limites': 'Limites',
    'pausas_json': 'Pausas',
    'cor': 'Cor',
}


ACOES_TROCA = frozenset({
    "solicitar_troca", "aceitar_troca", "aprovar_troca", "reprovar_troca", "cancelar_troca", "desfazer_troca",
})


# ---------------------------------------------------------------------------
# Ações, rótulos e "antes/depois"
# ---------------------------------------------------------------------------
def nome_acao(codigo: str | None) -> str:
    """Nome legível da ação; sem mapeamento, devolve o código bruto (ex.: `exportar_relatorio` já tem nome, um código novo não)."""
    codigo = (codigo or "").strip()
    return ROTULO_ACAO.get(codigo, codigo)


def _formatar_valor(valor: Any) -> str:
    if valor is None or valor == "":
        return "—"
    if isinstance(valor, bool):
        return "Sim" if valor else "Não"
    if isinstance(valor, (list, tuple)):
        return ", ".join(_formatar_valor(v) for v in valor) if valor else "—"
    if isinstance(valor, dict):
        return " · ".join(f"{ROTULO_CAMPO.get(k, k)}: {_formatar_valor(v)}" for k, v in valor.items())
    texto = str(valor)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", texto):
        return "/".join(reversed(texto.split("-")))
    return texto


def pares_json(texto: str | None) -> list[dict[str, str]]:
    """Converte o JSON gravado na auditoria em pares {rotulo, valor}. Registro antigo/inválido vira um par sem rótulo."""
    if not texto:
        return []
    try:
        dados = json.loads(texto)
    except (TypeError, ValueError):
        return [{"rotulo": "", "valor": str(texto)}]
    if isinstance(dados, dict):
        return [{"rotulo": ROTULO_CAMPO.get(k, k), "valor": _formatar_valor(v)} for k, v in dados.items()]
    return [{"rotulo": "", "valor": _formatar_valor(dados)}]


def texto_pares(pares: Iterable[dict[str, str]], separador: str = " · ") -> str:
    partes = [f"{p['rotulo']}: {p['valor']}" if p.get("rotulo") else p["valor"] for p in pares]
    return separador.join(partes)


def _status_presenca(depois_json: str | None) -> str:
    try:
        dados = json.loads(depois_json or "")
    except (TypeError, ValueError):
        return ""
    return str(dados.get("status", "")).upper() if isinstance(dados, dict) else ""


def tom_acao(acao: str | None, depois_json: str | None = None) -> str:
    """Cor da bolinha: troca = primária; presença PRESENTE = verde; FALTA = vermelho; o resto = cinza."""
    if acao in ACOES_TROCA:
        return "troca"
    if acao == "lancar_presenca":
        situacao = _status_presenca(depois_json)
        if situacao == "PRESENTE":
            return "presente"
        if situacao == "FALTA":
            return "falta"
    return "neutro"


# ---------------------------------------------------------------------------
# Fuso horário (o banco guarda a hora local do servidor; a tela mostra Brasília)
# ---------------------------------------------------------------------------
def fuso_do_servidor() -> tzinfo:
    return datetime.now().astimezone().tzinfo or timezone.utc


def para_brasilia(valor: datetime | None, fuso_servidor: tzinfo | None = None) -> datetime | None:
    if valor is None:
        return None
    if valor.tzinfo is None:
        valor = valor.replace(tzinfo=fuso_servidor or fuso_do_servidor())
    return valor.astimezone(FUSO_BRASIL)


def fmt_data(valor: datetime | date | None) -> str:
    return valor.strftime("%d/%m/%Y") if valor else ""


def fmt_hora(valor: datetime | None, segundos: bool = False) -> str:
    return valor.strftime("%H:%M:%S" if segundos else "%H:%M") if valor else ""


def limites_periodo(ini: date | None, fim: date | None, fuso_servidor: tzinfo | None = None) -> tuple[datetime | None, datetime | None]:
    """Dia inicial/final em Brasília -> intervalo [ini, fim+1d) em hora local do servidor (como `criado_em` é gravado)."""
    fuso_servidor = fuso_servidor or fuso_do_servidor()

    def local(dia: date) -> datetime:
        return datetime(dia.year, dia.month, dia.day, tzinfo=FUSO_BRASIL).astimezone(fuso_servidor).replace(tzinfo=None)

    return (local(ini) if ini else None, local(fim + timedelta(days=1)) if fim else None)


# ---------------------------------------------------------------------------
# Cursor (paginação sem repetir nem pular linhas)
# ---------------------------------------------------------------------------
def codificar_cursor(criado_em: datetime, id_auditoria: int) -> str:
    bruto = json.dumps({"c": criado_em.isoformat(), "i": int(id_auditoria)}, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(bruto).decode().rstrip("=")


def decodificar_cursor(token: str | None) -> tuple[datetime, int] | None:
    if not token:
        return None
    try:
        bruto = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
        dados = json.loads(bruto)
        return datetime.fromisoformat(dados["c"]), int(dados["i"])
    except (ValueError, KeyError, TypeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cursor inválido.") from None


PREDICADO_CURSOR = "(a.criado_em < ? OR (a.criado_em = ? AND a.id_auditoria < ?))"
ORDEM = "a.criado_em DESC, a.id_auditoria DESC"


def parametros_cursor(cursor: tuple[datetime, int]) -> list[Any]:
    criado_em, id_auditoria = cursor
    return [criado_em, criado_em, id_auditoria]


# ---------------------------------------------------------------------------
# Filtros
# ---------------------------------------------------------------------------
@dataclass
class FiltroHistorico:
    texto: str = ""
    operacao: str = ""
    entidade: str = ""
    operador: str = ""
    supervisor: str = ""
    data_ini: date | None = None
    data_fim: date | None = None


def _like(texto: str) -> str:
    escapado = texto.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_").replace("[", "\\[")
    return f"%{escapado}%"


def montar_where(
    filtro: FiltroHistorico,
    *,
    permitidas: list[str] | None,
    ids: list[int] | None = None,
    fuso_servidor: tzinfo | None = None,
) -> tuple[str, list[Any]]:
    """Condições combinadas (AND). `permitidas=None` = sem restrição de operação (Administrador);
    lista vazia = nenhum acesso. Com `ids` (escopo "selecionados") valem só o escopo de operação e os ids."""
    partes: list[str] = []
    params: list[Any] = []
    if permitidas is not None:
        if not permitidas:
            return "1 = 0", []
        marcas = ",".join("?" for _ in permitidas)
        # inclui as chaves virtuais dos tipos de escala (`TI::SOBREAVISO`) das operações permitidas
        partes.append(f"(a.operacao IN ({marcas}) OR " + " OR ".join("a.operacao LIKE ?" for _ in permitidas) + ")")
        params += list(permitidas) + [f"{p}::%" for p in permitidas]
    if ids is not None:
        marcas = ",".join("?" for _ in ids)
        partes.append(f"a.id_auditoria IN ({marcas})" if ids else "1 = 0")
        params += [int(i) for i in ids]
        return " AND ".join(partes) or "1 = 1", params
    if filtro.operacao:
        partes.append("a.operacao = ?")
        params.append(filtro.operacao)
    if filtro.entidade:
        partes.append("a.entidade = ?")
        params.append(filtro.entidade)
    if filtro.operador:
        partes.append("a.usuario_nome = ?")
        params.append(filtro.operador)
    if filtro.supervisor:
        partes.append("s.nome = ?")
        params.append(filtro.supervisor)
    ini, fim = limites_periodo(filtro.data_ini, filtro.data_fim, fuso_servidor)
    if ini:
        partes.append("a.criado_em >= ?")
        params.append(ini)
    if fim:
        partes.append("a.criado_em < ?")
        params.append(fim)
    texto = filtro.texto.strip()
    if texto:
        partes.append(
            "(a.usuario_nome LIKE ? ESCAPE '\\' OR s.nome LIKE ? ESCAPE '\\' OR a.entidade LIKE ? ESCAPE '\\' "
            "OR a.entidade_id LIKE ? ESCAPE '\\' OR a.perfil LIKE ? ESCAPE '\\')"
        )
        params += [_like(texto)] * 5
    return (" AND ".join(partes) or "1 = 1"), params


# ---------------------------------------------------------------------------
# Item da lista (o que a tela e a exportação consomem)
# ---------------------------------------------------------------------------
def _evento(eventos: list[dict], nome: str) -> dict | None:
    for e in eventos:
        if e["evento"] == nome:
            return e
    return None


def _passo(evento: dict | None, fuso_servidor: tzinfo | None) -> dict | None:
    if not evento:
        return None
    em = para_brasilia(evento["criado_em"], fuso_servidor)
    return {"nome": evento.get("por_nome") or "", "data": fmt_data(em), "hora": fmt_hora(em), "em": em.isoformat()}


def passos_da_troca(eventos: list[dict], fuso_servidor: tzinfo | None = None) -> dict[str, dict | None]:
    """Quem solicitou, quem aceitou e o supervisor que efetivou a troca, lidos do histórico imutável da troca
    (`wfm_trocas_eventos`): SOLICITADA -> AGUARDANDO_APROVACAO (aceite do colega) -> APROVADA (supervisor)."""
    return {
        "solicitou": _passo(_evento(eventos, "SOLICITADA"), fuso_servidor),
        "aceitou": _passo(_evento(eventos, "AGUARDANDO_APROVACAO"), fuso_servidor),
        "efetivou": _passo(_evento(eventos, "APROVADA"), fuso_servidor),
    }


def montar_item(linha: dict, eventos_troca: list[dict] | None = None, fuso_servidor: tzinfo | None = None) -> dict:
    registrado = para_brasilia(linha["criado_em"], fuso_servidor)
    plantao = linha.get("dia_plantao")
    antes, depois = pares_json(linha.get("antes_json")), pares_json(linha.get("depois_json"))
    eh_troca = linha.get("entidade") == "troca"
    item = {
        "id": int(linha["id_auditoria"]),
        "data": fmt_data(plantao) if plantao else fmt_data(registrado),
        "hora_inicio": linha.get("hora_inicio") or "",
        "hora_fim": linha.get("hora_fim") or "",
        "operador": linha.get("usuario_nome") or "",
        "perfil": linha.get("perfil") or "",
        "supervisor": linha.get("supervisor_nome") or "",
        "operacao": linha.get("operacao") or "",
        "acao": linha.get("acao") or "",
        "acao_nome": nome_acao(linha.get("acao")),
        "acao_tom": tom_acao(linha.get("acao"), linha.get("depois_json")),
        "entidade": linha.get("entidade") or "",
        "entidade_id": linha.get("entidade_id") or "",
        "antes": antes,
        "depois": depois,
        "antes_texto": texto_pares(antes),
        "depois_texto": texto_pares(depois),
        "justificativa": linha.get("justificativa") or "",
        "registrado_em": f"{fmt_data(registrado)} · {fmt_hora(registrado, segundos=True)}",
        "registrado_data": fmt_data(registrado),
        "registrado_hora": fmt_hora(registrado, segundos=True),
        "eh_troca": eh_troca,
        "troca": passos_da_troca(eventos_troca or [], fuso_servidor) if eh_troca else None,
    }
    return item


# ---------------------------------------------------------------------------
# Exportação
# ---------------------------------------------------------------------------
COLUNAS_EXPORTACAO: list[tuple[str, str]] = [
    ("data", "Data"), ("hora_inicio", "Hora início"), ("hora_fim", "Hora final"),
    ("operador", "Operador"), ("perfil", "Perfil"), ("supervisor", "Supervisor"), ("operacao", "Operação"),
    ("acao_nome", "Ação"), ("entidade", "Entidade"), ("entidade_id", "Identificador"),
    ("antes_texto", "Antes"), ("depois_texto", "Depois"),
    ("registrado_data", "Registrado em (data)"), ("registrado_hora", "Registrado em (hora)"),
    ("solicitou_nome", "Quem solicitou"), ("solicitou_data", "Solicitou em (data)"), ("solicitou_hora", "Solicitou em (hora)"),
    ("aceitou_nome", "Quem aceitou"), ("aceitou_data", "Aceitou em (data)"), ("aceitou_hora", "Aceitou em (hora)"),
    ("efetivou_nome", "Supervisor que trocou"), ("efetivou_data", "Trocou em (data)"), ("efetivou_hora", "Trocou em (hora)"),
    ("justificativa", "Justificativa"),
]


def linha_exportacao(item: dict) -> list[str]:
    plano = dict(item)
    troca = item.get("troca") or {}
    for chave in ("solicitou", "aceitou", "efetivou"):
        passo = troca.get(chave) or {}
        plano[f"{chave}_nome"], plano[f"{chave}_data"], plano[f"{chave}_hora"] = passo.get("nome", ""), passo.get("data", ""), passo.get("hora", "")
    return [("—" if chave in ("hora_inicio", "hora_fim", "supervisor") and not plano.get(chave) else plano.get(chave) or "") for chave, _ in COLUNAS_EXPORTACAO]


def nome_arquivo(extensao: str, agora: datetime | None = None) -> str:
    momento = para_brasilia(agora) if agora else datetime.now(FUSO_BRASIL)
    return f"historico_{momento:%Y-%m-%d_%H%M}.{extensao}"


def _proteger(valor: Any) -> Any:
    # Planilhas interpretam "=", "+", "-", "@" no início como fórmula.
    if isinstance(valor, str) and valor[:1] in ("=", "+", "-", "@") and valor != "—":
        return "'" + valor
    return valor


def gerar_csv_fluxo(linhas: Iterable[list[str]], tamanho_bloco: int = 500) -> Iterator[bytes]:
    """CSV em fluxo (UTF-8 com BOM, separador `;` para abrir direto no Excel em português)."""
    saida = io.StringIO()
    escritor = csv.writer(saida, delimiter=";", lineterminator="\r\n")
    escritor.writerow([rotulo for _, rotulo in COLUNAS_EXPORTACAO])
    yield "﻿".encode("utf-8") + saida.getvalue().encode("utf-8")
    saida.seek(0), saida.truncate(0)
    for n, linha in enumerate(linhas, 1):
        escritor.writerow([_proteger(v) for v in linha])
        if n % tamanho_bloco == 0:
            yield saida.getvalue().encode("utf-8")
            saida.seek(0), saida.truncate(0)
    resto = saida.getvalue()
    if resto:
        yield resto.encode("utf-8")


def gerar_xlsx_fluxo(linhas: Iterable[list[str]]) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font

    livro = Workbook(write_only=True)
    folha = livro.create_sheet("Histórico")
    folha.freeze_panes = "A2"
    from openpyxl.cell import WriteOnlyCell

    cabecalho = []
    for _, rotulo in COLUNAS_EXPORTACAO:
        celula = WriteOnlyCell(folha, value=rotulo)
        celula.font = Font(bold=True)
        cabecalho.append(celula)
    folha.append(cabecalho)
    for linha in linhas:
        folha.append([_proteger(v) for v in linha])
    memoria = io.BytesIO()
    livro.save(memoria)
    return memoria.getvalue()


# --- PDF mínimo, sem dependência nova (Helvetica padrão, A3 paisagem, cabeçalho repetido em cada página) ---
_PDF_LARGURA, _PDF_ALTURA, _PDF_MARGEM, _PDF_FONTE = 1191, 842, 28, 6.0
_PESOS_PDF = {
    "data": 5, "hora_inicio": 4, "hora_fim": 4, "operador": 8, "perfil": 6, "supervisor": 8, "operacao": 7, "acao_nome": 8, "entidade": 6, "entidade_id": 7,
    "antes_texto": 14, "depois_texto": 14, "registrado_data": 5, "registrado_hora": 5, "solicitou_nome": 7, "solicitou_data": 5, "solicitou_hora": 4,
    "aceitou_nome": 7, "aceitou_data": 5, "aceitou_hora": 4, "efetivou_nome": 7, "efetivou_data": 5, "efetivou_hora": 4, "justificativa": 10,
}


def _pdf_texto(texto: str) -> bytes:
    return texto.encode("cp1252", "replace").replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def _quebrar(texto: str, largura_chars: int, maximo_linhas: int = 4) -> list[str]:
    palavras, linhas, atual = (texto or "").split(), [], ""
    for palavra in palavras:
        while len(palavra) > largura_chars:
            if atual:
                linhas.append(atual)
                atual = ""
            linhas.append(palavra[:largura_chars])
            palavra = palavra[largura_chars:]
        candidato = f"{atual} {palavra}".strip()
        if len(candidato) <= largura_chars:
            atual = candidato
        else:
            linhas.append(atual)
            atual = palavra
    if atual:
        linhas.append(atual)
    if len(linhas) > maximo_linhas:
        linhas = linhas[:maximo_linhas]
        linhas[-1] = linhas[-1][: max(0, largura_chars - 1)] + "…"
    return linhas or [""]


def gerar_pdf(linhas: Iterable[list[str]], titulo: str = "Histórico") -> bytes:
    colunas = [(c, r) for c, r in COLUNAS_EXPORTACAO]
    util = _PDF_LARGURA - 2 * _PDF_MARGEM
    soma = sum(_PESOS_PDF.get(c, 6) for c, _ in colunas)
    larguras = [util * _PESOS_PDF.get(c, 6) / soma for c, _ in colunas]
    chars = [max(3, int((w - 4) / (_PDF_FONTE * 0.52))) for w in larguras]
    altura_linha = _PDF_FONTE + 2.2
    paginas: list[list[bytes]] = []
    atual: list[bytes] = []
    y = 0.0

    def nova_pagina() -> None:
        nonlocal atual, y
        if atual:
            paginas.append(atual)
        atual = [b"BT /F2 9 Tf %d %d Td (" % (_PDF_MARGEM, _PDF_ALTURA - _PDF_MARGEM) + _pdf_texto(f"{titulo} — gerado em {datetime.now(FUSO_BRASIL):%d/%m/%Y %H:%M}") + b") Tj ET\n"]
        y = _PDF_ALTURA - _PDF_MARGEM - 20
        escrever([r for _, r in colunas], cabecalho=True)

    def escrever(textos: list[str], cabecalho: bool = False) -> None:
        nonlocal y
        quebradas = [_quebrar(t, chars[i]) for i, t in enumerate(textos)]
        altura = max(len(q) for q in quebradas) * altura_linha + 3
        if y - altura < _PDF_MARGEM and not cabecalho:
            nova_pagina()
        if cabecalho:
            atual.append(b"0.88 g %.1f %.1f %.1f %.1f re f 0 g\n" % (_PDF_MARGEM, y - altura + 2, util, altura))
        x = float(_PDF_MARGEM)
        fonte = b"/F2" if cabecalho else b"/F1"
        for i, q in enumerate(quebradas):
            for n, trecho in enumerate(q):
                atual.append(b"BT " + fonte + b" %.1f Tf %.1f %.1f Td (" % (_PDF_FONTE, x + 2, y - _PDF_FONTE - n * altura_linha) + _pdf_texto(trecho) + b") Tj ET\n")
            x += larguras[i]
        y -= altura
        atual.append(b"0.8 G %.1f %.1f m %.1f %.1f l S\n" % (_PDF_MARGEM, y + 1, _PDF_MARGEM + util, y + 1))

    nova_pagina()
    for linha in linhas:
        escrever(linha)
    paginas.append(atual)

    objetos: list[bytes] = []

    def adicionar(corpo: bytes) -> int:
        objetos.append(corpo)
        return len(objetos)

    adicionar(b"<< /Type /Catalog /Pages 2 0 R >>")
    adicionar(b"")  # /Pages preenchido depois
    fonte1 = adicionar(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    fonte2 = adicionar(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    ids_paginas = []
    for conteudo in paginas:
        fluxo = b"".join(conteudo)
        id_conteudo = adicionar(b"<< /Length %d >>\nstream\n" % len(fluxo) + fluxo + b"endstream")
        ids_paginas.append(adicionar(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Resources << /Font << /F1 %d 0 R /F2 %d 0 R >> >> /Contents %d 0 R >>"
            % (_PDF_LARGURA, _PDF_ALTURA, fonte1, fonte2, id_conteudo)))
    objetos[1] = b"<< /Type /Pages /Kids [" + b" ".join(b"%d 0 R" % i for i in ids_paginas) + b"] /Count %d >>" % len(ids_paginas)
    saida = bytearray(b"%PDF-1.4\n")
    posicoes = []
    for numero, corpo in enumerate(objetos, 1):
        posicoes.append(len(saida))
        saida += b"%d 0 obj\n" % numero + corpo + b"\nendobj\n"
    inicio_xref = len(saida)
    saida += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objetos) + 1)
    for p in posicoes:
        saida += b"%010d 00000 n \n" % p
    saida += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objetos) + 1, inicio_xref)
    return bytes(saida)


def validar_exportacao(formato: str, escopo: str, ids: list[int] | None) -> tuple[str, str, list[int] | None]:
    formato = (formato or "").lower()
    if formato not in ("xlsx", "csv", "pdf"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Formato inválido. Use xlsx, csv ou pdf.")
    escopo = (escopo or "filtro").lower()
    if escopo not in ("filtro", "selecionados"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Escopo inválido. Use filtro ou selecionados.")
    if escopo == "selecionados":
        unicos = sorted({int(i) for i in (ids or [])})
        if not unicos:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nenhum registro selecionado.")
        if len(unicos) > LIMITE_IDS:
            raise HTTPException(status_code=413, detail=f"Selecione no máximo {LIMITE_IDS} registros por exportação.")
        return formato, escopo, unicos
    return formato, escopo, None


def validar_limite_linhas(total: int, formato: str) -> None:
    limite = LIMITE_LINHAS_PDF if formato == "pdf" else LIMITE_LINHAS
    if total > limite:
        raise HTTPException(
            status_code=413,
            detail=f"A exportação em {formato.upper()} aceita até {limite:,} registros; o filtro retornou {total:,}. Reduza o período.".replace(",", "."),
        )
