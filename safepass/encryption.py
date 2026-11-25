"""Encryption utilities for SafePass"""

import base64
import ctypes
import os
import sys
import hashlib
import hmac
import re
import secrets
import threading
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.kdf.argon2 import Argon2id
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


def generate_salt():
    """Generate a random salt"""
    return os.urandom(32)


# ── Wiping secrets from memory ───────────────────────────────
# Python frees memory without clearing it, so a key or password stays readable in the process
# (a memory dump, a crash dump, hibernation) until something else overwrites it. wipe() zeroes
# the buffers SafePass itself made: a bytearray in place, and on CPython also a bytes object.
# Only pass values nothing else still uses: a wiped bytes object reads as zeros everywhere it is
# referenced. Text (str) is never touched; the README says what stays behind.
_BYTES_DATA_OFFSET = sys.getsizeof(b'') - 1  # where a bytes object's data starts (CPython)
_CAN_WIPE_BYTES = sys.implementation.name == 'cpython'


def wipe(*values):
    for value in values:
        if isinstance(value, bytearray):
            value[:] = bytes(len(value))
        elif type(value) is bytes and len(value) > 1 and _CAN_WIPE_BYTES:
            # Empty and one-byte bytes objects are shared singletons: never touch those
            ctypes.memset(id(value) + _BYTES_DATA_OFFSET, 0, len(value))


# How a password becomes a key. The method is stored with the salt, so it can change later.
# Argon2id makes every guess need memory as well as time, which is what graphics cards can't
# multiply cheaply. These are the RFC 9106 settings for 64 MiB of memory.
# '' = PBKDF2 with 100,000 rounds: accounts from older versions, until their next sign-in.
KDF_LEGACY = ''
KDF_CURRENT = 'argon2id$t=3$m=65536$p=4'
_KDF_FORMAT = re.compile(r'^argon2id\$t=(\d{1,2})\$m=(\d{1,8})\$p=(\d{1,2})$')
_KDF_MAX_MEMORY = 1024 * 1024  # KiB; a backup file names its own settings and must not exhaust memory


# Every derivation takes 64 MiB and noticeable CPU, and anyone who can reach the server can ask for
# one (sign-in). At most this many run at once, so the process can't be pushed out of memory; a
# request that can't get a slot soon is answered "busy" instead of queueing without end.
KDF_CONCURRENCY = 2
KDF_WAIT_SECONDS = 10
_kdf_slots = threading.BoundedSemaphore(KDF_CONCURRENCY)


class KeyDerivationBusy(RuntimeError):
    """Too many key derivations at once; the request should be retried in a moment"""


def _kdf_settings(kdf):
    match = _KDF_FORMAT.match(kdf)
    if not match:
        raise ValueError('Unknown key derivation method')
    iterations, memory, lanes = map(int, match.groups())
    if not (1 <= iterations <= 10 and 8 * lanes <= memory <= _KDF_MAX_MEMORY and 1 <= lanes <= 8):
        raise ValueError('Key derivation settings out of range')
    return iterations, memory, lanes


def derive_key(password: str, salt: bytes, kdf: str = KDF_CURRENT) -> bytes:
    """The 32-byte key for this password, salt and method. Raises KeyDerivationBusy when no slot frees up."""
    if kdf != KDF_LEGACY:
        iterations, memory, lanes = _kdf_settings(kdf)
    if not _kdf_slots.acquire(timeout=KDF_WAIT_SECONDS):
        raise KeyDerivationBusy()
    secret = password.encode()
    try:
        if kdf == KDF_LEGACY:
            return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=100000).derive(secret)
        return Argon2id(salt=salt, length=32, iterations=iterations, lanes=lanes, memory_cost=memory).derive(secret)
    finally:
        wipe(secret)  # the encoded copy of the password is ours alone
        _kdf_slots.release()


def hash_derived_key(derived_key: bytes) -> str:
    """What is stored to recognise the right master password"""
    return hashlib.sha256(derived_key).hexdigest()


def check_master_password(master_password: str, salt: bytes, kdf: str, stored_hash: str):
    """The derived key if the master password is right, else None (so one call does both jobs)"""
    derived_key = derive_key(master_password, salt, kdf)
    return derived_key if hmac.compare_digest(hash_derived_key(derived_key), stored_hash) else None


def encrypt_data(data: str, key: bytes) -> bytes:
    """Encrypt data using AES-256-GCM"""
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, data.encode(), None)
    return nonce + ciphertext


def decrypt_data(encrypted_data: bytes, key: bytes) -> str:
    """Decrypt data using AES-256-GCM"""
    aesgcm = AESGCM(key)
    nonce = encrypted_data[:12]
    ciphertext = encrypted_data[12:]
    plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    return plaintext.decode()


# ── Data key storage ─────────────────────────────────────────
# Passwords are encrypted with a 32-byte data key. Versions <= 1.2.4 stored that
# key in User.encryption_key_encrypted in plaintext (it was always
# PBKDF2(master password, salt)). Now the column holds either:
#   b''                      -> data key == key derived from the master password
#   WRAPPED_PREFIX + AES-GCM -> data key wrapped with the derived key
# so the database alone is no longer enough to decrypt anything.
WRAPPED_PREFIX = b'W1'
_WRAPPED_LENGTH = len(WRAPPED_PREFIX) + 12 + 32 + 16  # prefix + nonce + key + GCM tag


def wrap_key(data_key: bytes, derived_key: bytes) -> bytes:
    """Encrypt a data key with the key derived from the master password"""
    nonce = os.urandom(12)
    return WRAPPED_PREFIX + nonce + AESGCM(derived_key).encrypt(nonce, data_key, None)


def unlock_data_key(derived_key: bytes, stored: bytes):
    """Return (data_key, new_stored_value or None if the column needs no update).

    Must only be called after the master password has been verified.
    """
    stored = bytes(stored or b'')
    if not stored:
        return derived_key, None
    if stored.startswith(WRAPPED_PREFIX) and len(stored) == _WRAPPED_LENGTH:
        body = stored[len(WRAPPED_PREFIX):]
        return AESGCM(derived_key).decrypt(body[:12], body[12:], None), None
    if len(stored) == 32:
        # Legacy plaintext key: drop it if it is the derived key, otherwise wrap it
        if hmac.compare_digest(stored, derived_key):
            return derived_key, b''
        return stored, wrap_key(stored, derived_key)
    raise ValueError('Unrecognised data key format')


# ── Recovery key ─────────────────────────────────────────────
# A second way to unlock the data key when the master password is forgotten. It is shown
# to the user once and never stored; the database only holds the data key wrapped with it.
# 30 random symbols of a 32-letter alphabet are 150 bits, which no one can guess, so a fast
# derivation is enough (unlike a master password, which a person chooses).
RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'  # no 0/O or 1/I: it may be copied by hand
RECOVERY_PREFIX = b'R1'
_RECOVERY_SYMBOLS = 30
_RECOVERY_GROUP = 5


def generate_recovery_key() -> str:
    symbols = ''.join(secrets.choice(RECOVERY_ALPHABET) for _ in range(_RECOVERY_SYMBOLS))
    return '-'.join(symbols[i:i + _RECOVERY_GROUP] for i in range(0, _RECOVERY_SYMBOLS, _RECOVERY_GROUP))


def _recovery_cipher(recovery_key: str, salt: bytes) -> AESGCM:
    # Spaces, dashes and lower case don't matter when it is typed back
    normalized = ''.join(c for c in recovery_key.upper() if c.isalnum())
    derived = HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=b'safepass-recovery-v1').derive(normalized.encode())
    return AESGCM(derived)


def wrap_with_recovery_key(data_key: bytes, recovery_key: str) -> bytes:
    salt = os.urandom(16)
    nonce = os.urandom(12)
    return RECOVERY_PREFIX + salt + nonce + _recovery_cipher(recovery_key, salt).encrypt(nonce, data_key, None)


def unwrap_with_recovery_key(stored: bytes, recovery_key: str):
    """The data key, or None if this isn't the right recovery key"""
    stored = bytes(stored or b'')
    if not stored.startswith(RECOVERY_PREFIX):
        return None
    body = stored[len(RECOVERY_PREFIX):]
    try:
        return _recovery_cipher(recovery_key, body[:16]).decrypt(body[16:28], body[28:], None)
    except InvalidTag:
        return None


# ── Encrypted backup ─────────────────────────────────────────
# A JSON file (.safepass) anyone can move around: without the backup password it holds only
# this note and unreadable bytes. It has its own password because it outlives the master
# password, and the recovery key doesn't open it.
BACKUP_FORMAT = 'safepass-encrypted-backup'
BACKUP_VERSION = 1
_BACKUP_AAD = f'{BACKUP_FORMAT}/{BACKUP_VERSION}'.encode()
BACKUP_NOTE = ('This is an encrypted SafePass backup. To open it, use Import in SafePass and enter the backup password. / '
               'Bu dosya şifreli bir SafePass yedeğidir. Açmak için SafePass\'te İçe Aktar\'ı kullanın ve yedek parolasını girin.')


class InvalidBackup(ValueError):
    """Not a SafePass backup, or a damaged one that can be told apart without the password"""


class WrongBackupPassword(ValueError):
    """Wrong password, or the contents were changed (the two can't be told apart)"""


def encrypt_backup(content: str, password: str) -> dict:
    salt = os.urandom(32)
    nonce = os.urandom(12)
    key = derive_key(password, salt, KDF_CURRENT)
    encode = lambda raw: base64.b64encode(raw).decode('ascii')
    return {
        'format': BACKUP_FORMAT,
        'version': BACKUP_VERSION,
        'note': BACKUP_NOTE,
        'kdf': KDF_CURRENT,
        'salt': encode(salt),
        'nonce': encode(nonce),
        'data': encode(AESGCM(key).encrypt(nonce, content.encode('utf-8'), _BACKUP_AAD)),
    }


def decrypt_backup(backup, password: str) -> str:
    if not isinstance(backup, dict) or backup.get('format') != BACKUP_FORMAT or backup.get('version') != BACKUP_VERSION:
        raise InvalidBackup()
    try:
        salt, nonce, data = (base64.b64decode(backup[name], validate=True) for name in ('salt', 'nonce', 'data'))
        kdf = backup['kdf']
    except (KeyError, TypeError, ValueError) as error:
        raise InvalidBackup() from error
    if len(salt) < 16 or len(nonce) != 12 or not isinstance(kdf, str) or kdf == KDF_LEGACY:
        raise InvalidBackup()
    try:
        # The file names its own settings before anything is checked: never more work than SafePass
        # itself writes (KDF_CURRENT), so a crafted file can't make the server spend 1 GiB or minutes
        if any(given > limit for given, limit in zip(_kdf_settings(kdf), _kdf_settings(KDF_CURRENT))):
            raise ValueError('Backup key derivation settings above what SafePass writes')
        key = derive_key(password, salt, kdf)
    except ValueError as error:
        raise InvalidBackup() from error
    try:
        return AESGCM(key).decrypt(nonce, data, _BACKUP_AAD).decode('utf-8')
    except (InvalidTag, UnicodeDecodeError) as error:
        raise WrongBackupPassword() from error
