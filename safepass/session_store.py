"""Sessions in the memory cache, as before, but a flush also wipes the session's data key.

Every way a session ends in the views (sign-out, timeout, stale master password, the login
page) goes through flush(), so the key is zeroed right there (see keystore.py).
"""

from django.contrib.sessions.backends.cache import SessionStore as CacheSessionStore

from . import keystore

KEY_REF = 'key_ref'


class SessionStore(CacheSessionStore):
    def flush(self):
        keystore.drop(self.get(KEY_REF))
        super().flush()
