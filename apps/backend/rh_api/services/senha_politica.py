"""Regras da senha do acesso por Login (fluxo de senha aprovado pelo Paulo em 26/nov/2026).

Doc: CONECTA_REBRANDING/27_SENHA_E_ACESSO/Fluxo_de_Senha.md. Vale na criação, no 1º acesso, no "Esqueci a senha",
no Meu perfil e na redefinição pelo administrador. Conferida sempre no servidor (a tela só mostra a lista ao vivo).

  * 8 caracteres ou mais (o mínimo de Configurações › Segurança, nunca menos de 8);
  * pelo menos 1 maiúscula, 1 minúscula, 1 número e 1 caractere especial;
  * não pode ser igual à senha temporária ou à atual (quem chama passa a senha a comparar).

Prazos (S1–S3 do plano): código do e-mail 15 min, senha provisória do supervisor 24 h, senha temporária do admin 7 dias.
"""

from __future__ import annotations

import secrets
import string

from fastapi import HTTPException, status

ESPECIAIS = "!@#$%&*?-_+=.,;:/\\|()[]{}<>^~"
CODIGO_MINUTOS = 15
PROVISORIA_HORAS = 24
TEMPORARIA_DIAS = 7
TENTATIVAS_CODIGO = 5
ERROS_PARA_BLOQUEIO = 5
BLOQUEIO_MINUTOS = 15

# Sem letras/números que se confundem ao ditar ou ler no papel (0/O, 1/l/I).
_MAIUSCULAS = "ABCDEFGHJKLMNPQRSTUVWXYZ"
_MINUSCULAS = "abcdefghijkmnopqrstuvwxyz"
_NUMEROS = "23456789"
_ESPECIAIS_GERADOS = "#@$%&*?!"


def _tamanho_minimo() -> int:
    try:
        from .seguranca_config import tamanho_minimo_senha

        return max(8, int(tamanho_minimo_senha()))
    except Exception:  # noqa: BLE001 - sem configuração: o mínimo da política
        return 8


def tamanho_minimo() -> int:
    return _tamanho_minimo()


def problemas(senha: str) -> list[str]:
    """O que falta na senha, em português simples. Lista vazia = senha aceita."""
    valor = str(senha or "")
    faltam: list[str] = []
    minimo = _tamanho_minimo()
    if len(valor) < minimo:
        faltam.append(f"{minimo} caracteres ou mais")
    if not any(c.isupper() for c in valor):
        faltam.append("uma letra maiúscula")
    if not any(c.islower() for c in valor):
        faltam.append("uma letra minúscula")
    if not any(c.isdigit() for c in valor):
        faltam.append("um número")
    if not any((not c.isalnum()) and not c.isspace() for c in valor):
        faltam.append("um caractere especial")
    return faltam


def mensagem(faltam: list[str]) -> str:
    if not faltam:
        return ""
    if len(faltam) == 1:
        return f"A senha precisa ter {faltam[0]}."
    return "A senha precisa ter " + ", ".join(faltam[:-1]) + f" e {faltam[-1]}."


def validar(senha: str, *, diferente_de: tuple[str, ...] = ()) -> str:
    """Devolve a senha se aceita; senão levanta 422 com o que falta."""
    valor = str(senha or "")
    faltam = problemas(valor)
    if faltam:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=mensagem(faltam))
    if any(valor == str(outra or "") for outra in diferente_de if outra):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A nova senha precisa ser diferente da senha atual ou temporária.",
        )
    return valor


def gerar_senha(tamanho: int = 10) -> str:
    """Senha forte aleatória (temporária do admin, provisória do supervisor). Sempre cumpre a política."""
    tamanho = max(_tamanho_minimo(), int(tamanho))
    partes = [secrets.choice(_MAIUSCULAS), secrets.choice(_MINUSCULAS), secrets.choice(_NUMEROS), secrets.choice(_ESPECIAIS_GERADOS)]
    todos = _MAIUSCULAS + _MINUSCULAS + _NUMEROS + _ESPECIAIS_GERADOS
    partes += [secrets.choice(todos) for _ in range(tamanho - len(partes))]
    secrets.SystemRandom().shuffle(partes)
    return "".join(partes)


def gerar_codigo() -> str:
    """Código de 6 números para o "Esqueci a senha" de quem não é operador."""
    return "".join(secrets.choice(string.digits) for _ in range(6))


def mascarar_email(email: str) -> str:
    """ma*****@empresa.com.br — mostra só o começo (S8)."""
    valor = str(email or "").strip()
    if "@" not in valor:
        return ""
    nome, dominio = valor.split("@", 1)
    visivel = nome[:2] if len(nome) > 2 else nome[:1]
    return f"{visivel}{'*' * 5}@{dominio}"
