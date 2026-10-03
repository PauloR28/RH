"""Reparo de mojibake (V058) e leitura UTF-8 das migrations (sqlcmd -f 65001)."""

from __future__ import annotations

import re
from pathlib import Path

from rh_api.repositories import acentos_migration as am

RAIZ = Path(__file__).resolve().parents[3]
MIGRATIONS = RAIZ / "infra" / "sql" / "migrations"


def test_v058_e_diagnostico_sao_gerados_do_mesmo_codigo_e_100_por_cento_ascii():
    sql = (MIGRATIONS / "V058__corrige_acentos_seeds.sql").read_text(encoding="utf-8")
    assert sql == am.render_migration_sql()
    assert (MIGRATIONS / "V058__corrige_acentos_seeds.rollback.sql").read_text(encoding="utf-8") == am.render_rollback_sql()
    diag = (RAIZ / "infra" / "sql" / "diagnostico_acentos.sql").read_text(encoding="utf-8")
    assert diag == am.render_diagnostico_sql()
    assert all(ord(c) < 128 for c in sql + diag), "migration e diagnóstico precisam ser ASCII (imunes à codificação do arquivo)"


def test_mojibake_gerado_e_o_que_o_sqlcmd_gravou():
    """Observado no banco: 'ã' (C3 A3) virou os caracteres U+00C3 U+00A3 ('Ã£'); 'ç' virou 'Ã§'; 'ê' virou 'Ãª'."""
    assert am.mojibake("não") == "nÃ£o"
    assert am.mojibake("Operação") == "OperaÃ§Ã£o"
    assert am.mojibake("aderência") == "aderÃªncia"


def test_o_reparo_cobre_todos_os_textos_acentuados_semeados_pelas_migrations_antigas():
    """Todo literal acentuado em DADOS (fora de comentário) das migrations antigas precisa estar na lista de reparo."""
    cobertos = {correto for _t, _c, correto in am.TEXTOS_SEMEADOS}
    encontrados: set[str] = set()
    for arquivo in sorted(MIGRATIONS.glob("V0*.sql")):
        if arquivo.name.endswith(".rollback.sql") or arquivo.name.startswith(("V055", "V056", "V057", "V058")):
            continue
        texto = re.sub(r"/\*.*?\*/", "", arquivo.read_text(encoding="utf-8"), flags=re.S)
        for linha in texto.splitlines():
            linha = re.sub(r"--.*$", "", linha)
            encontrados.update(m for m in re.findall(r"N?'([^']*[^\x00-\x7f][^']*)'", linha))
    faltando = sorted(encontrados - cobertos)
    assert not faltando, f"Textos acentuados em migrations sem reparo na V058: {faltando}"


def test_reparo_so_troca_igualdade_exata_em_colacao_binaria_e_nao_apaga_o_que_foi_usado():
    sql = am.render_migration_sql()
    assert sql.count("COLLATE Latin1_General_BIN2 =") == len(am.TEXTOS_SEMEADOS)
    assert "usado = 0" in sql and "o.id_item < m.id_item" in sql
    for chave in am.CHAVES_MOTIVOS:
        assert f"N'{chave}'" in sql
    assert "DROP " not in sql.upper() and "TRUNCATE" not in sql.upper()


def test_o_script_de_migrations_le_os_arquivos_como_utf8():
    ps1 = (RAIZ / "infra" / "scripts" / "powershell" / "aplicar-migrations.ps1").read_text(encoding="utf-8")
    chamadas = [linha for linha in ps1.splitlines() if "sqlcmd -S" in linha]
    assert len(chamadas) == 2 and all("-f 65001" in linha for linha in chamadas)


def test_migrations_novas_nao_dependem_da_codificacao_do_arquivo():
    for arquivo in MIGRATIONS.glob("V05[5-9]*.sql"):
        assert all(ord(c) < 128 for c in arquivo.read_text(encoding="utf-8")), arquivo.name
