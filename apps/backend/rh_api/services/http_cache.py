"""Cache HTTP (ETag + Cache-Control) para respostas GET só-leitura que mudam
pouco — catálogos, operações, equipes/turnos/canais da Monitoria etc.
(Correções.txt, 24/set/2026, itens 5/13). Cada usuário ainda recebe só os
dados do seu próprio escopo (`private`); o navegador é quem evita reconsultar
a API à toa quando nada mudou, respondendo 304 sem corpo.

Uso: no fim do handler, depois de montar `payload`, chame
`if aplicar_cache_http(request, response, payload): return Response(status_code=304)`.
"""

from __future__ import annotations

import hashlib
import json

from fastapi import Request, Response

DEFAULT_MAX_AGE = 300


def _etag_de(payload) -> str:
    corpo = json.dumps(payload, default=str, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return f'W/"{hashlib.sha1(corpo).hexdigest()}"'


def aplicar_cache_http(request: Request, response: Response, payload, *, max_age: int = DEFAULT_MAX_AGE) -> bool:
    """Define ETag/Cache-Control na resposta. Devolve True quando o
    If-None-Match do cliente já bate com o ETag atual — o chamador deve então
    devolver 304 sem corpo em vez do payload."""
    etag = _etag_de(payload)
    response.headers["Cache-Control"] = f"private, max-age={max_age}"
    response.headers["ETag"] = etag
    # Sem isto, o cache HTTP do navegador ignora o valor do Bearer token ao
    # decidir se pode reaproveitar uma resposta — em uma máquina compartilhada
    # (comum em operação de call center) um usuário poderia receber do cache
    # a resposta já carregada para OUTRO usuário que logou antes nela.
    response.headers["Vary"] = "Authorization"
    return request.headers.get("if-none-match", "") == etag
