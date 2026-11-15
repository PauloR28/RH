from __future__ import annotations


class SecretEncryptionError(RuntimeError):
    pass


def _fernet_types():
    try:
        from cryptography.fernet import Fernet, InvalidToken
    except ImportError as exc:
        raise SecretEncryptionError(
            "A dependência 'cryptography' é obrigatória para ativar o MFA."
        ) from exc
    return Fernet, InvalidToken


def generate_encryption_key() -> str:
    Fernet, _ = _fernet_types()
    return Fernet.generate_key().decode("ascii")


def encrypt_secret(secret: str, key: str) -> str:
    if not key:
        raise SecretEncryptionError("RH_MFA_ENCRYPTION_KEY não foi configurada.")
    try:
        Fernet, _ = _fernet_types()
        return Fernet(key.encode("ascii")).encrypt(secret.encode("utf-8")).decode("ascii")
    except SecretEncryptionError:
        raise
    except (ValueError, TypeError) as exc:
        raise SecretEncryptionError("RH_MFA_ENCRYPTION_KEY é inválida.") from exc


def decrypt_secret(encrypted: str, key: str) -> str:
    if not key:
        raise SecretEncryptionError("RH_MFA_ENCRYPTION_KEY não foi configurada.")
    try:
        Fernet, InvalidToken = _fernet_types()
        return Fernet(key.encode("ascii")).decrypt(encrypted.encode("ascii")).decode("utf-8")
    except SecretEncryptionError:
        raise
    except (InvalidToken, ValueError, TypeError) as exc:
        raise SecretEncryptionError("Não foi possível descriptografar o segredo MFA.") from exc
