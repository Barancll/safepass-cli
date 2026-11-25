"""Data keys of signed-in sessions, kept apart from the session store.

The data key used to sit base64-encoded in the session data. The cache keeps sessions
pickled, so every request left new copies of it (the pickled blob, the base64 text, the
decoded bytes) in freed memory, where they outlived sign-out and expiry. Now a session holds
only a random handle. The key lives here once, in a bytearray that is zeroed when the
session ends: sign-out or any flush (session_store.py), expiry (swept every SWEEP_SECONDS even
when no request comes), a master password change and account deletion (drop_user).

Everything is in this process's memory only, like the sessions themselves: a restart ends them all.
"""

import secrets
import threading
import time

from django.conf import settings

from .encryption import wipe

SWEEP_SECONDS = 30

_lock = threading.Lock()
_entries = {}  # handle -> _Entry
_sweeper = None


class _Entry:
    __slots__ = ('key', 'user_id', 'expires_at', 'hard_limit')


def _max_age():
    return getattr(settings, 'SESSION_COOKIE_AGE', 86400)


def put(key, user_id, expires_at):
    """Keep a copy of this key until expires_at (epoch seconds); returns its handle"""
    entry = _Entry()
    entry.key = bytearray(key)
    entry.user_id = user_id
    entry.hard_limit = time.time() + _max_age()  # never longer than the session cookie lives
    entry.expires_at = min(expires_at, entry.hard_limit)
    handle = secrets.token_urlsafe(24)
    with _lock:
        _entries[handle] = entry
    _start_sweeper()
    return handle


def get(handle):
    """The key (a bytearray: don't keep it beyond the request), or None if gone or expired"""
    if not isinstance(handle, str):
        return None
    with _lock:
        entry = _entries.get(handle)
    if entry is None:
        return None
    if time.time() > entry.expires_at:
        drop(handle)
        return None
    return entry.key


def extend(handle, expires_at):
    """The session was used: its key now lives until expires_at (which may also be sooner)"""
    with _lock:
        entry = _entries.get(handle) if isinstance(handle, str) else None
        if entry is not None:
            entry.expires_at = min(expires_at, entry.hard_limit)


def drop(handle):
    """Forget one session's key and zero its bytes"""
    if not isinstance(handle, str):
        return
    with _lock:
        entry = _entries.pop(handle, None)
    if entry is not None:
        wipe(entry.key)


def drop_user(user_id, keep=None):
    """Forget every key of this account except the session handle `keep`"""
    with _lock:
        handles = [h for h, e in _entries.items() if e.user_id == user_id and h != keep]
    for handle in handles:
        drop(handle)


def sweep(now=None):
    """Forget expired keys; returns how many"""
    now = time.time() if now is None else now
    with _lock:
        handles = [h for h, e in _entries.items() if now > e.expires_at]
    for handle in handles:
        drop(handle)
    return len(handles)


def count():
    with _lock:
        return len(_entries)


def _sweep_forever():
    while True:
        time.sleep(SWEEP_SECONDS)
        try:
            sweep()
        except Exception:  # the sweeper must never die; the next round tries again
            pass


def _start_sweeper():
    global _sweeper
    if _sweeper is not None:
        return
    with _lock:
        if _sweeper is None:
            _sweeper = threading.Thread(target=_sweep_forever, name='safepass-key-sweeper', daemon=True)
            _sweeper.start()
