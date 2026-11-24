"""Foto de "quem vê o quê" por perfil (reestruturação da configuração, Etapa 2). SOMENTE LEITURA.

Lê o banco do .env (RH_SQL_DATABASE) com a mesma regra que decide os acessos no Conecta e mostra, por perfil:
módulos do seletor, módulo de entrada, funções e permissões. Sem banco, usa os padrões do código.

Uso:
    python tools/foto_acessos.py tirar  <saida.json>          # grava a foto e a tabela <saida.md>
    python tools/foto_acessos.py comparar <antes.json> <depois.json>
"""
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "apps" / "backend"))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(RAIZ / ".env")
from rh_api.services import foto_acessos  # noqa: E402


def _ler(caminho: str) -> dict:
    return json.loads(Path(caminho).read_text(encoding="utf-8"))


def main(args: list[str]) -> int:
    if len(args) == 2 and args[0] == "tirar":
        foto = foto_acessos.montar_foto()
        destino = Path(args[1])
        destino.write_text(json.dumps(foto, indent=1, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
        destino.with_suffix(".md").write_text(foto_acessos.tabela_markdown(foto), encoding="utf-8")
        origens = {p["origem"] for p in foto["perfis"].values()}
        print(f"Foto gravada em {destino} ({len(foto['perfis'])} perfis; origem: {', '.join(sorted(origens))}).")
        return 0
    if len(args) == 3 and args[0] == "comparar":
        difs = foto_acessos.comparar(_ler(args[1]), _ler(args[2]))
        print("\n".join(difs) if difs else "Nenhuma diferença: ninguém ganhou nem perdeu acesso.")
        return 1 if difs else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
