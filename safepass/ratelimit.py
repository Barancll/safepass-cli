"""Request limits and sign-in lockout.

SafePass runs as one local process, so most counters live in a dedicated
local-memory cache (settings.CACHES['ratelimit']). Restarting the app
resets them, which is fine for a local password manager.

Three mechanisms:
- rate_limit(): a fixed-window request cap per signed-in user (or per
  endpoint for anonymous calls), for endpoints that decrypt or write a
  lot (export, import, reveal ...).
- escalating_limit(): a sliding-window cap whose wait grows each time it
  is hit (password generator). Kept in the database (RequestLimit), so a
  restart does not reset it.
- master password lockout: every wrong master password (sign-in,
  change password, delete account) counts against that account; after
  FREE_ATTEMPTS failures it is locked for a delay that doubles each time,
  up to MAX_LOCK_SECONDS. Unknown usernames are counted the same way so
  the lockout does not reveal which accounts exist. The owner's trusted
  browser is counted separately (see views.device_lock_key).
"""

import threading
import time
from functools import wraps

from django.core.cache import caches
from django.http import JsonResponse

FREE_ATTEMPTS = 5          # wrong passwords before the first lock
BASE_LOCK_SECONDS = 30     # first lock; doubles with every further failure
MAX_LOCK_SECONDS = 15 * 60
FAILURE_MEMORY = 60 * 60   # failures are forgotten after an hour without new ones


def _cache():
    return caches['ratelimit']


def _count(key, window):
    """Increment a fixed-window counter → (count, seconds until the window resets)"""
    now = int(time.time())
    bucket = now // window
    cache_key = f'rl:{key}:{bucket}'
    cache = _cache()
    cache.add(cache_key, 0, window + 1)
    try:
        count = cache.incr(cache_key)
    except ValueError:  # expired between add() and incr()
        cache.set(cache_key, 1, window + 1)
        count = 1
    return count, window - (now % window)


def _escalating(user_id, scope, limit, window, step, max_lock, strike_memory):
    """Sliding-window cap whose penalty grows: hitting `limit` calls within `window` locks the
    scope for step, 2*step, 3*step … up to max_lock seconds. Kept in the database (RequestLimit),
    so restarting SafePass doesn't clear it. Returns seconds to wait (0 = allowed, and counted)."""
    from django.db import transaction
    from .models import RequestLimit

    now = time.time()
    with transaction.atomic():
        state, _ = RequestLimit.objects.select_for_update().get_or_create(user_id=user_id, scope=scope)
        if state.locked_until > now:
            return state.locked_until - now
        if now - state.last_strike > strike_memory:
            state.strikes = 0  # behaved for a while: back to the first step
        stamps = [t for t in state.stamps if t > now - window]
        if len(stamps) >= limit:
            state.strikes += 1
            lock = min(step * state.strikes, max_lock)
            state.last_strike = now
            state.locked_until = now + lock
            state.stamps = []
            state.save()
            return lock
        state.stamps = stamps + [now]
        state.save(update_fields=['stamps', 'strikes'])
        return 0


def too_many_requests(seconds):
    seconds = max(1, int(seconds))
    response = JsonResponse({'error': f'Çok fazla istek. {seconds} saniye sonra tekrar deneyin',
                             'retry_after': seconds}, status=429)
    response['Retry-After'] = str(seconds)
    return response


def locked_out(seconds):
    seconds = max(1, int(seconds))
    response = JsonResponse({'error': f'Çok fazla hatalı deneme. {seconds} saniye sonra tekrar deneyin',
                             'retry_after': seconds}, status=429)
    response['Retry-After'] = str(seconds)
    return response


def rate_limit(scope, limit, window):
    """Allow at most `limit` calls per `window` seconds for this scope and user"""
    def decorator(view):
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            who = request.session.get('user_id') or 'anon'
            count, reset_in = _count(f'{scope}:{who}', window)
            if count > limit:
                return too_many_requests(reset_in)
            return view(request, *args, **kwargs)
        return wrapped
    return decorator


def escalating_limit(scope, limit, window, step=60, max_lock=10 * 60, strike_memory=30 * 60):
    """At most `limit` calls in any `window` seconds for a signed-in user; each time the limit is hit
    the wait grows by `step` (1, 2, 3 … minutes) up to `max_lock`. Strikes are forgotten after
    `strike_memory` seconds without one. Anonymous calls pass through (the view refuses them)."""
    def decorator(view):
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            user_id = request.session.get('user_id')
            if user_id:
                wait = _escalating(user_id, scope, limit, window, step, max_lock, strike_memory)
                if wait > 0:
                    return too_many_requests(wait + 0.999)
            return view(request, *args, **kwargs)
        return wrapped
    return decorator


# ── master password lockout ───────────────────────────────────
# Per account only. A cap over all accounts together used to sit on top; any local program could
# fill it with made-up names and keep every account out, while this lock already bounds guessing.
# The owner's own browser has a trusted device key (views.device_lock_key) with a counter of its own,
# so a lock someone else causes doesn't shut the owner out.

def _failure_key(account):
    return f'pwfail:{account}'


def _state(cache, account):
    """failures: wrong answers so far; pending: checks still running (counted as failures until they end)"""
    state = cache.get(_failure_key(account)) or {}
    return {'failures': state.get('failures', 0), 'pending': state.get('pending', 0),
            'locked_until': state.get('locked_until', 0)}


def _lock_seconds(counted):
    extra = counted - FREE_ATTEMPTS
    return 0 if extra < 0 else min(MAX_LOCK_SECONDS, BASE_LOCK_SECONDS * (2 ** extra))


def _store(cache, account, state):
    if not (state['failures'] or state['pending'] or state['locked_until'] > time.time()):
        cache.delete(_failure_key(account))
    else:
        cache.set(_failure_key(account), state, FAILURE_MEMORY + MAX_LOCK_SECONDS)


def lock_remaining(account):
    """Seconds this account is still locked for (0 if it may try now)"""
    state = _cache().get(_failure_key(account))
    if not state:
        return 0
    return max(0, int(state['locked_until'] - time.time() + 0.999))


# Requests run in parallel threads: every read-change-write of the counters happens under this lock
_lock = threading.Lock()


def begin_attempt(account):
    """Seconds the account is still locked for, or 0: then this attempt is counted, as pending,
    before the slow password check, in one step with the lock check. Guesses sent in parallel
    therefore can't all pass before the first one counts. End it with finish_attempt()."""
    cache = _cache()
    with _lock:
        state = _state(cache, account)
        now = time.time()
        if state['locked_until'] > now:
            return max(1, int(state['locked_until'] - now + 0.999))
        state['pending'] += 1
        lock = _lock_seconds(state['failures'] + state['pending'])
        if lock:
            state['locked_until'] = now + lock
        _store(cache, account, state)
        return 0


def finish_attempt(account, outcome):
    """outcome 'failed': a wrong answer, it stays counted. 'succeeded': the right password; earlier
    wrong answers are forgiven, but checks still running for this account keep their place, so a
    right answer can't open the door to a new batch. 'void': no answer (the server was busy)."""
    cache = _cache()
    with _lock:
        state = _state(cache, account)
        state['pending'] = max(0, state['pending'] - 1)
        if outcome == 'failed':
            state['failures'] += 1
        else:
            if outcome == 'succeeded':
                state['failures'] = 0
            if not _lock_seconds(state['failures'] + state['pending']):
                state['locked_until'] = 0
        _store(cache, account, state)


def attempt(account, verify):
    """Run verify() (the slow master-password or recovery-key check, truthy when right) as one counted
    attempt. Returns (wait, result); wait > 0 means the account is locked and verify did not run."""
    from .encryption import KeyDerivationBusy
    wait = begin_attempt(account)
    if wait:
        return wait, None
    outcome = 'failed'  # an unexpected error counts against the account, never for it
    try:
        result = verify()
        outcome = 'succeeded' if result else 'failed'
        return 0, result
    except KeyDerivationBusy:
        outcome = 'void'
        raise
    finally:
        finish_attempt(account, outcome)
