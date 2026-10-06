from __future__ import annotations

import os
import sys
from pathlib import Path


# Os testes exercitam o desenho completo do WFM (inclusive Operador/Técnico); a restrição da fase de teste tem teste próprio.
os.environ.setdefault("RH_WFM_LIBERAR_PARTICIPANTES", "1")
# Idem para as áreas inativas na fase de teste (Suporte TI e Treinamentos): a suíte cobre o desenho completo; o desligamento tem teste próprio.
os.environ.setdefault("RH_AREAS_INATIVAS", "")

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))
# Helpers compartilhados dos testes (ex.: _integracao_dev).
TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))
