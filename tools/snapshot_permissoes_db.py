"""Fotografia SOMENTE LEITURA das permissões efetivas por perfil como o login as entrega (perfil_permissoes + filtro WFM).

Complementa o snapshot de código da Etapa 2 da modularização: o login real lê do banco, que pode ter sido editado
pelo Administrador. Uso: python tools/snapshot_permissoes_db.py <saida.json>  (banco = RH_SQL_DATABASE do .env/ambiente)
"""
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "apps" / "backend"))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(RAIZ / ".env")
from rh_api.config import get_settings  # noqa: E402
from rh_api.rbac import ROLE_DEFINITIONS  # noqa: E402
from rh_api.repositories import DatabaseRepository  # noqa: E402

repo = DatabaseRepository(get_settings())
conn = repo._connect()
try:
    cur = conn.cursor()
    saida = {rid: sorted(repo._get_role_permissions_from_db(cur, rid)) for rid in ROLE_DEFINITIONS}
finally:
    conn.close()
destino = Path(sys.argv[1])
destino.write_text(json.dumps(saida, indent=1, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
print({k: len(v) for k, v in saida.items()})
