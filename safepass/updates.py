"""Is a newer SafePass published? Asked at most once a day, in the background.

The only thing SafePass does on its own that leaves this computer: a request to PyPI for
the latest version number. It carries nothing from the vault and can be turned off in
Settings (User.update_check_enabled). A failed check is silent. The answer is kept in the
data folder, so restarts don't ask again and no page ever waits for the network.
"""

import json
import os
import re
import threading
import time
import urllib.request

from django.conf import settings

from . import __version__

PYPI_URL = 'https://pypi.org/pypi/safepass-cli/json'
CHECK_INTERVAL_SECONDS = 24 * 60 * 60
TIMEOUT_SECONDS = 3
MAX_RESPONSE_BYTES = 5 * 1024 * 1024
_VERSION = re.compile(r'^\d+(\.\d+){0,3}$')

_lock = threading.Lock()
_running = False


def _state_file():
    return settings.DATA_DIR / 'update-check.json'


def _read_state():
    try:
        state = json.loads(_state_file().read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}
    return state if isinstance(state, dict) else {}


def _write_state(state):
    target = _state_file()
    partial = target.with_name(target.name + '.partial')
    partial.write_text(json.dumps(state), encoding='utf-8')
    os.replace(partial, target)


def is_newer(candidate, current=__version__):
    """False for anything that isn't a plain version number, such as a pre-release"""
    if not (isinstance(candidate, str) and _VERSION.match(candidate) and _VERSION.match(current)):
        return False
    parts = lambda version: [int(part) for part in version.split('.')]
    return parts(candidate) > parts(current)


def latest_available():
    """The newer published version we know of, or None. Never touches the network."""
    latest = _read_state().get('latest')
    return latest if is_newer(latest) else None


def _ask_pypi():
    request = urllib.request.Request(PYPI_URL, headers={'User-Agent': f'safepass-cli/{__version__}'})
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return json.loads(response.read(MAX_RESPONSE_BYTES))['info']['version']


def _check():
    global _running
    state = _read_state()
    try:
        state['latest'] = _ask_pypi()
    except Exception:
        pass  # offline, or PyPI changed: keep what we knew and try again tomorrow
    state['checked_at'] = time.time()
    try:
        _write_state(state)
    except OSError:
        pass
    finally:
        with _lock:
            _running = False


def check_if_due():
    """Start a background check if the last one is a day old; returns at once"""
    global _running
    checked_at = _read_state().get('checked_at')
    if isinstance(checked_at, (int, float)) and time.time() - checked_at < CHECK_INTERVAL_SECONDS:
        return
    with _lock:
        if _running:
            return
        _running = True
    threading.Thread(target=_check, name='safepass-update-check', daemon=True).start()
