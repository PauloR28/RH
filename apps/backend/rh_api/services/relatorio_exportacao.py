"""Exportação genérica dos relatórios da página "Relatórios e Históricos": XLSX, CSV e PDF a partir de colunas + linhas.

A página já tem os dados na tela (e o servidor já aplicou escopo e permissão ao entregá-los); aqui só se formata o arquivo.
PDF sem dependência nova: reaproveita o gerador mínimo de `wfm_historico` (Helvetica, A3 paisagem, cabeçalho em cada página).
"""

from __future__ import annotations

import csv
import io
import re
from datetime import datetime
from typing import Any, Sequence

from . import wfm_historico as _h

LIMITE_LINHAS = 100_000
LIMITE_LINHAS_PDF = 20_000
FORMATOS = ("xlsx", "csv", "pdf")
MIME = {
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "csv": "text/csv; charset=utf-8",
    "pdf": "application/pdf",
}


def nome_arquivo(relatorio: str, formato: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", relatorio.lower()).strip("-") or "relatorio"
    return f"{base}-{datetime.now(_h.FUSO_BRASIL):%Y%m%d-%H%M}.{formato}"


def _texto(valor: Any) -> str:
    if valor is None:
        return ""
    if isinstance(valor, bool):
        return "Sim" if valor else "Não"
    return str(valor)


def gerar_csv(colunas: Sequence[str], linhas: Sequence[Sequence[Any]]) -> bytes:
    saida = io.StringIO()
    escritor = csv.writer(saida, delimiter=";", lineterminator="\r\n")
    escritor.writerow([_h._proteger(c) for c in colunas])
    for linha in linhas:
        escritor.writerow([_h._proteger(_texto(v)) for v in linha])
    return b"\xef\xbb\xbf" + saida.getvalue().encode("utf-8")


def gerar_xlsx(titulo: str, filtros: Sequence[Sequence[str]], colunas: Sequence[str], linhas: Sequence[Sequence[Any]]) -> bytes:
    from openpyxl import Workbook
    from openpyxl.cell import WriteOnlyCell
    from openpyxl.styles import Font

    livro = Workbook(write_only=True)
    folha = livro.create_sheet((titulo or "Relatório")[:31] or "Relatório")
    for rotulo, valor in filtros:
        folha.append([_h._proteger(f"{rotulo}: {valor}")])
    if filtros:
        folha.append([])
    cabecalho = []
    for coluna in colunas:
        celula = WriteOnlyCell(folha, value=_h._proteger(coluna))
        celula.font = Font(bold=True)
        cabecalho.append(celula)
    folha.append(cabecalho)
    for linha in linhas:
        folha.append([_h._proteger(v if isinstance(v, (int, float)) and not isinstance(v, bool) else _texto(v)) for v in linha])
    memoria = io.BytesIO()
    livro.save(memoria)
    return memoria.getvalue()


def gerar_pdf(titulo: str, filtros: Sequence[Sequence[str]], colunas: Sequence[str], linhas: Sequence[Sequence[Any]]) -> bytes:
    largura, altura, margem, fonte = _h._PDF_LARGURA, _h._PDF_ALTURA, _h._PDF_MARGEM, 6.5
    util = largura - 2 * margem
    # Peso de cada coluna = maior texto (limitado) entre o cabeçalho e uma amostra das linhas.
    amostra = linhas[:200]
    pesos = [max(4, min(28, max([len(str(c))] + [len(_texto(l[i])) for l in amostra if i < len(l)]))) for i, c in enumerate(colunas)]
    soma = sum(pesos)
    larguras = [util * p / soma for p in pesos]
    chars = [max(3, int((w - 4) / (fonte * 0.52))) for w in larguras]
    altura_linha = fonte + 2.2
    paginas: list[list[bytes]] = []
    atual: list[bytes] = []
    y = 0.0
    resumo_filtros = " · ".join(f"{r}: {v}" for r, v in filtros if v)
    cabecalho_texto = f"{titulo} — gerado em {datetime.now(_h.FUSO_BRASIL):%d/%m/%Y %H:%M}"

    def escrever(textos: Sequence[str], cabecalho: bool = False) -> None:
        nonlocal y
        quebradas = [_h._quebrar(t, chars[i]) for i, t in enumerate(textos)]
        h = max(len(q) for q in quebradas) * altura_linha + 3
        if y - h < margem and not cabecalho:
            nova_pagina()
        if cabecalho:
            atual.append(b"0.88 g %.1f %.1f %.1f %.1f re f 0 g\n" % (margem, y - h + 2, util, h))
        x = float(margem)
        fonte_nome = b"/F2" if cabecalho else b"/F1"
        for i, q in enumerate(quebradas):
            for n, trecho in enumerate(q):
                atual.append(b"BT " + fonte_nome + b" %.1f Tf %.1f %.1f Td (" % (fonte, x + 2, y - fonte - n * altura_linha) + _h._pdf_texto(trecho) + b") Tj ET\n")
            x += larguras[i]
        y -= h
        atual.append(b"0.8 G %.1f %.1f m %.1f %.1f l S\n" % (margem, y + 1, margem + util, y + 1))

    def nova_pagina() -> None:
        nonlocal atual, y
        if atual:
            paginas.append(atual)
        atual = [b"BT /F2 9 Tf %d %d Td (" % (margem, altura - margem) + _h._pdf_texto(cabecalho_texto) + b") Tj ET\n"]
        y = altura - margem - 20
        if resumo_filtros:
            atual.append(b"BT /F1 7 Tf %d %d Td (" % (margem, altura - margem - 12) + _h._pdf_texto(resumo_filtros[:260]) + b") Tj ET\n")
        escrever([str(c) for c in colunas], cabecalho=True)

    nova_pagina()
    for linha in linhas:
        escrever([_texto(linha[i]) if i < len(linha) else "" for i in range(len(colunas))])
    paginas.append(atual)

    objetos: list[bytes] = []

    def adicionar(corpo: bytes) -> int:
        objetos.append(corpo)
        return len(objetos)

    adicionar(b"<< /Type /Catalog /Pages 2 0 R >>")
    adicionar(b"")
    f1 = adicionar(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    f2 = adicionar(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    ids = []
    for conteudo in paginas:
        fluxo = b"".join(conteudo)
        cid = adicionar(b"<< /Length %d >>\nstream\n" % len(fluxo) + fluxo + b"endstream")
        ids.append(adicionar(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Resources << /Font << /F1 %d 0 R /F2 %d 0 R >> >> /Contents %d 0 R >>" % (largura, altura, f1, f2, cid)))
    objetos[1] = b"<< /Type /Pages /Kids [" + b" ".join(b"%d 0 R" % i for i in ids) + b"] /Count %d >>" % len(ids)
    saida = bytearray(b"%PDF-1.4\n")
    posicoes = []
    for n, corpo in enumerate(objetos, 1):
        posicoes.append(len(saida))
        saida += b"%d 0 obj\n" % n + corpo + b"\nendobj\n"
    xref = len(saida)
    saida += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objetos) + 1)
    for p in posicoes:
        saida += b"%010d 00000 n \n" % p
    saida += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objetos) + 1, xref)
    return bytes(saida)
