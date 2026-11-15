try:
    from .rh_api.main import app  # noqa: F401  (ponto de entrada: `app:app`)
except ImportError:
    from rh_api.main import app  # noqa: F401  (ponto de entrada: `app:app`)
