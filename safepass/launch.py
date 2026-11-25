"""Which browsers may be asked for a master password.

A program that takes SafePass's port while SafePass is stopped can serve a look-alike page at the
bookmarked address. So the sign-in forms work only in a browser that `safepass start` opened:

1. `start` (which proved the server is genuine, see __main__._launch_proof) opens
   /auth/login#launch=<ts>.<nonce>.<mac>, where mac = HMAC(LAUNCH_TOKEN, "open:<ts>.<nonce>").
   The fragment never reaches a server; the page hands it over once (claim).
2. The server answers with a random browser mark, kept in localStorage (that one origin only) and sent
   as X-SafePass-Launch. Marks live in this process's memory, so a restart voids every one: a mark a
   look-alike page reads while SafePass is stopped is already worthless.
3. Sign-in, sign-up and recovery refuse requests without a valid mark, and the login page shows the
   account's security picture (pictures.py) only to them. A page without the picture, or one asking
   for the master password without having been opened by `start`, is not SafePass.
"""

import hashlib
import hmac
import secrets
import threading
import time
from collections import OrderedDict

from django.conf import settings

HEADER = 'X-SafePass-Launch'
LINK_MAX_AGE = 120  # seconds an opening link stays usable
MARKS_MAX = 50      # browsers remembered per run; the oldest go first

_lock = threading.Lock()
_marks = OrderedDict()  # digest of a mark -> True
_used = {}              # nonce of a claimed link -> time it was claimed


def required():
    """Marks are needed unless this is a development server started without `safepass start`"""
    return bool(settings.LAUNCH_TOKEN) or not settings.DEBUG


def _digest(value):
    return hashlib.sha256(value.encode('utf-8', 'replace')).hexdigest()


def link_mac(token, stamp, nonce):
    return hmac.new(token.encode(), f'open:{stamp}.{nonce}'.encode(), hashlib.sha256).hexdigest()


def claim(link):
    """A new browser mark for a genuine, fresh, unused opening link, else None"""
    token = settings.LAUNCH_TOKEN
    if not token or not isinstance(link, str) or len(link) > 200:
        return None
    parts = link.split('.')
    if len(parts) != 3 or not parts[0].isdigit() or not 16 <= len(parts[1]) <= 64:
        return None
    stamp, nonce, mac = parts
    if not hmac.compare_digest(mac.encode(), link_mac(token, stamp, nonce).encode()):
        return None
    now = time.time()
    if not -10 <= now - int(stamp) <= LINK_MAX_AGE:
        return None
    mark = secrets.token_urlsafe(32)
    with _lock:
        for old, at in list(_used.items()):
            if now - at > LINK_MAX_AGE + 10:
                del _used[old]
        if nonce in _used:
            return None  # each link opens one browser
        _used[nonce] = now
        _marks[_digest(mark)] = True
        while len(_marks) > MARKS_MAX:
            _marks.popitem(last=False)
    return mark


def verified(request):
    """True if this request comes from a browser `safepass start` opened during this run"""
    if not required():
        return True
    mark = request.headers.get(HEADER, '')
    if not 20 <= len(mark) <= 100:
        return False
    with _lock:
        return _digest(mark) in _marks
