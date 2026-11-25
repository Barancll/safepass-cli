"""Views for SafePass"""

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import threading
import urllib.parse
import time
from datetime import datetime, timedelta
from django.shortcuts import render, redirect
from django.http import JsonResponse, HttpResponse
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from .models import User, PasswordCard, PasswordHistory, Category, Service, TrustedDevice, purge_expired_trash, WHATS_NEW_VERSION
from .encryption import (
    KDF_CURRENT, generate_salt, derive_key, hash_derived_key, check_master_password,
    encrypt_data, decrypt_data, unlock_data_key, wrap_key,
    generate_recovery_key, wrap_with_recovery_key, unwrap_with_recovery_key,
    encrypt_backup, decrypt_backup, InvalidBackup, WrongBackupPassword, wipe
)
from django.db import IntegrityError
from .generator import generate_password, calculate_password_strength, calculate_pin_strength, is_pin
from .analytics import get_dashboard_stats
from . import definitions, keystore, launch, notifications, pictures, ratelimit, samples, vault
from .session_store import KEY_REF
from .icons import icon_catalog
from .ratelimit import rate_limit, escalating_limit


logger = logging.getLogger(__name__)


def text_field(data, key, default=''):
    """String value from parsed JSON; anything else (None, numbers, lists) becomes the default"""
    value = data.get(key, default) if isinstance(data, dict) else default
    return value if isinstance(value, str) else default


# Limits match the model fields (SQLite does not enforce max_length itself)
CARD_LIMITS = {'app_name': 100, 'username': 100, 'password': 1000, 'url': 200, 'notes': 5000,
               'category': 100, 'subcategory': 100}
_SCHEME = re.compile(r'^[a-z][a-z0-9+.-]*:', re.IGNORECASE)


def normalize_url(url):
    """Return a safe http(s) URL, '' for empty, or None if the scheme is not allowed.

    Only http/https are kept: other schemes (javascript:, data:) would run code
    when the link is clicked. "github.com" becomes "https://github.com".
    """
    url = (url or '').strip()
    if not url:
        return ''
    if _SCHEME.match(url):
        return url if url.lower().startswith(('http://', 'https://')) else None
    return 'https://' + url


def card_fields_error(fields):
    """Validation message for a password card, or None if the fields are acceptable"""
    if not fields['app_name'] or not fields['password']:
        return 'Uygulama adı ve şifre gerekli'
    if fields['url'] is None:
        return 'Web adresi http:// veya https:// ile başlamalı'
    names = {'app_name': 'Uygulama adı', 'username': 'Kullanıcı adı', 'password': 'Şifre', 'url': 'Web adresi',
             'notes': 'Notlar', 'category': 'Kategori', 'subcategory': 'Alt kategori'}
    for field, limit in CARD_LIMITS.items():
        if len(fields[field] or '') > limit:
            return f'{names[field]} en fazla {limit} karakter olabilir'
    return None


def clamp_imported(value, field):
    """Imports are lenient: overly long values from other managers are cut, not rejected"""
    return (value or '')[:CARD_LIMITS[field]]


def get_json_body(request):
    """Parse a JSON object body; anything else (invalid JSON, [], null, 123) counts as empty.

    Only `application/json` is read: other pages can send text/plain or form
    bodies without a CORS preflight, so those are never treated as data.
    """
    if request.content_type != 'application/json':
        return {}
    try:
        data = json.loads(request.body.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def master_password_error(master_password):
    """Validation message for a new master password, or None if it is acceptable"""
    if not master_password:
        return 'Ana şifre boş bırakılamaz'
    if len(master_password) < 8:
        return 'Ana şifre en az 8 karakter olmalı'
    if len(master_password) > 128:
        return 'Ana şifre en fazla 128 karakter olabilir'
    has_upper = any(c.isupper() for c in master_password)
    has_lower = any(c.islower() for c in master_password)
    has_digit = any(c.isdigit() for c in master_password)
    if not (has_upper and has_lower and has_digit):
        return 'Zayıf şifre! Büyük harf, küçük harf ve rakam içermelidir'
    return None


def master_key(user, master_password):
    """The key derived from the master password if it is right, else None"""
    return check_master_password(master_password, bytes(user.salt), user.kdf, user.master_password_hash)


MASTER_PASSWORD_FIELDS = ['salt', 'kdf', 'master_password_hash', 'encryption_key_encrypted']


def apply_master_password(user, master_password, data_key):
    """Put a master password on the (unsaved) user: new salt, current method, data key wrapped with it"""
    user.salt = generate_salt()
    user.kdf = KDF_CURRENT
    derived_key = derive_key(master_password, bytes(user.salt), user.kdf)
    user.master_password_hash = hash_derived_key(derived_key)
    user.encryption_key_encrypted = wrap_key(data_key, derived_key)
    wipe(derived_key)


def lock_key(user, username, prefix=''):
    """The lockout counter for an account (see ratelimit.py): the account's id when it exists, so
    no other name (not even one differing only in case) shares or clears it; else a digest of the
    typed name, so unknown names lock exactly like real ones, reveal nothing, and a huge name can't
    become a huge cache key."""
    if user:
        return f'{prefix}id:{user.pk}'
    return f"{prefix}name:{hashlib.sha256(username.lower().encode('utf-8', 'replace')).hexdigest()}"


# New accounts: at most 20 characters. Sign-in still looks up names up to 30, the limit of every earlier version
# (1.2.4 included), so no existing account is shut out; longer names are refused before any work.
USERNAME_MAX = 20
USERNAME_LOOKUP_MAX = 30


def master_password_check(user, master_password):
    """An error response if the master password is wrong or the account is locked, else None.
    Wrong answers count towards the lock (see ratelimit.py)."""
    wait, derived = ratelimit.attempt(lock_key(user, user.username),
                                      lambda: bool(master_password) and master_key(user, master_password))
    if wait:
        return ratelimit.locked_out(wait)
    if not derived:
        return JsonResponse({'error': 'Yanlış ana şifre'}, status=400)  # 401 means "signed out" to the client
    wipe(derived)  # only the answer was needed; the session already holds the data key
    return None


# ── Trusted devices ──────────────────────────────────────────
# A browser that signed in to an account gets a random device key, kept in its localStorage (only
# pages on SafePass's own address can read it, unlike cookies, which reach every local port) and sent
# with the next sign-in. A program that took the port while SafePass was stopped could read it too, so
# it counts only together with a valid launch mark (launch.py), which such a program can't get. Attempts that carry it are counted on the device's own lock, so a lock another program
# causes by guessing at the account never shuts the owner's browser out. The server keeps only a digest.

def _device_digest(token):
    return hashlib.sha256(token.encode('utf-8', 'replace')).hexdigest()


def trusted_device(user, token):
    """The account's TrustedDevice for this key, or None"""
    if not user or not isinstance(token, str) or not 20 <= len(token) <= 100:
        return None
    return TrustedDevice.objects.filter(user=user, token_hash=_device_digest(token)).first()


def attempt_lock_key(user, username, device, prefix=''):
    """The counter an attempt is charged to: the trusted device's own, or the account's"""
    return f'{prefix}device:{device.pk}' if device else lock_key(user, username, prefix)


def remember_device(user, device):
    """After a successful sign-in: a known device is touched and keeps its key (None is returned);
    otherwise a new key is made and returned for the browser to keep. The oldest go past the limit."""
    if device:
        device.save(update_fields=['last_used_at'])
        return None
    token = secrets.token_urlsafe(32)
    TrustedDevice.objects.create(user=user, token_hash=_device_digest(token))
    stale = TrustedDevice.objects.filter(user=user).order_by('-last_used_at', '-id').values_list('id', flat=True)[TrustedDevice.MAX_PER_USER:]
    TrustedDevice.objects.filter(id__in=list(stale)).delete()
    return token


def with_device(response, user, device=None):
    """Hand this browser its device key in a response header; app.js keeps it in localStorage per
    account name (URL-encoded, since names may be non-ASCII). Nothing is sent for a known device."""
    token = remember_device(user, device)
    if token:
        response['X-SafePass-Device'] = f"{urllib.parse.quote(user.username.lower(), safe='')} {token}"
    return response


def password_fingerprint(user):
    """Changes whenever the master password changes; ends sessions opened with the old one"""
    return user.master_password_hash[:16]


def get_session_timeout(request):
    """Inactivity limit for this session in seconds (per-user setting, set at login)"""
    return request.session.get('timeout_seconds') or getattr(settings, 'SESSION_TIMEOUT', 3600)


# "Keep me signed in" on the login page: inactivity can't end the session before this
KEEP_SIGNED_IN_SECONDS = 30 * 60


def session_deadline(request):
    """When the session ends: the inactivity limit, but never before 'keep signed in' runs out (0 = no session)"""
    last_activity = request.session.get('last_activity')
    if not last_activity:
        return 0
    return max(last_activity + get_session_timeout(request), request.session.get('keep_until') or 0)


def get_session_remaining(request):
    """Seconds left before the session expires (does not extend it)"""
    return max(0, int(session_deadline(request) - time.time()))


def check_session_timeout(request, touch=True):
    """Flush the session if it has timed out; otherwise optionally record activity"""
    deadline = session_deadline(request)
    if deadline and time.time() > deadline:
        request.session.flush()
        return True

    if touch:
        request.session['last_activity'] = time.time()
    return False


def start_session(request, user, encryption_key, keep_until=None):
    """Log the user in. Only the derived key is kept, never the master password.
    keep_until: end of 'keep me signed in' (epoch seconds), or None"""
    request.session.cycle_key()  # new session id on login
    if keep_until:
        request.session['keep_until'] = keep_until
    else:
        request.session.pop('keep_until', None)  # cycle_key keeps the old data; don't inherit it
    request.session['user_id'] = user.id
    # Required on every signed-in API call (see middleware.ApiKeyMiddleware); sent once, in a response header
    request.session['api_key'] = request.safepass_api_key = secrets.token_urlsafe(32)
    request.session['timeout_seconds'] = user.session_timeout_minutes * 60
    request.session['pw_fingerprint'] = password_fingerprint(user)
    request.session['last_activity'] = time.time()
    # The key itself stays out of the session data (keystore.py): the session holds a handle
    keystore.drop(request.session.get(KEY_REF))  # e.g. the old key after a master password change
    request.session[KEY_REF] = keystore.put(encryption_key, user.id, session_deadline(request))


def get_session_key(request):
    """This session's data key (a bytearray, zeroed when the session ends), or None if it is gone"""
    return keystore.get(request.session.get(KEY_REF))


def get_session_user(request, touch=True):
    """Get user from session. touch=False checks without counting as activity."""
    if check_session_timeout(request, touch=touch):
        return None
    
    user_id = request.session.get('user_id')
    if not user_id:
        return None
    if get_session_key(request) is None:
        request.session.flush()  # the key expired or was dropped (or a session from an older version)
        return None
    try:
        user = User.objects.get(id=user_id)
        if request.session.get('pw_fingerprint') != password_fingerprint(user):
            # Master password changed elsewhere: this session's key is stale
            request.session.flush()
            return None

        # SESSION_SAVE_EVERY_REQUEST = False olduğu için
        # Django'ya session'ın değiştiğini manuel söylememiz gerekiyor
        # Bu sayede last_activity güncellemesi kaydedilir
        if touch:
            request.session.modified = True
            keystore.extend(request.session.get(KEY_REF), session_deadline(request))

        return user
    except User.DoesNotExist:
        request.session.flush()
        return None


def require_auth(view_func):
    """Decorator to require authentication"""
    def wrapper(request, *args, **kwargs):
        user = get_session_user(request)
        if not user:
            return redirect('/auth/login')
        return view_func(request, *args, **kwargs)
    return wrapper


LAUNCH_REQUIRED = "SafePass'i terminalden açın: safepass start"


def launch_refusal(request):
    """Master-password forms work only in a browser `safepass start` opened (see launch.py)"""
    if launch.verified(request):
        return None
    return JsonResponse({'error': LAUNCH_REQUIRED, 'reason': 'launch_required'}, status=428)


def login_page(request):
    """Render login page"""
    user = get_session_user(request)
    if user:
        return redirect('/dashboard')
    request.session.flush()
    return render(request, 'auth/login.html')


def register_page(request):
    """Render register page"""
    if get_session_user(request):
        return redirect('/dashboard')
    return render(request, 'auth/register.html')


@require_auth
def dashboard_page(request):
    """Render dashboard page"""
    user = get_session_user(request)
    cards = PasswordCard.objects.filter(user=user)
    stats = get_dashboard_stats(user, cards, get_session_key(request))
    # Titles come from /api/vault/fields (vault_fields.js): pages carry no private card fields
    recent_cards = cards.order_by('-created_at')[:5]
    
    context = {
        'user': user,
        'stats': stats,
        'recent_cards': recent_cards
    }
    return render(request, 'dashboard.html', context)


@require_auth
def passwords_page(request):
    """Render passwords list page"""
    user = get_session_user(request)
    # No private fields in the HTML: titles, usernames, addresses and notes come from /api/vault/fields
    # (vault_fields.js) and a password only when it is revealed or copied. Paused cards go to the end.
    cards = list(PasswordCard.objects.filter(user=user).order_by('-is_active', '-updated_at'))
    lookup = definitions.lookup(user)
    fallback = lookup.get(definitions.FALLBACK)
    for card in cards:
        # Unknown slugs (e.g. imported) get Genel's colour and icon
        card.cat_def = lookup.get((card.category or definitions.FALLBACK).lower()) or fallback
        card.sub_def = lookup.get((card.subcategory or '').lower()) if card.subcategory else None
    context = {
        'user': user,
        'cards': cards,
        'category_tree': definitions.category_tree(user, with_counts=True),  # counts label the filter chips
    }
    return render(request, 'cards.html', context)


@require_auth
def generator_page(request):
    """Render password generator page"""
    user = get_session_user(request)
    context = {'user': user}
    return render(request, 'generator.html', context)


@require_auth
def siber_test_page(request):
    """Cyber test: an attack simulation played in the browser (static/js/modules/attack_sim.js).
    The server sends no password data here; the password is typed in the page or handed over by
    the generator page through the tab's sessionStorage, and never reaches the server."""
    context = {
        'user': get_session_user(request),
        'sim_tests': [1, 2, 3, 4, 5],
        'sim_scenarios': ['online', 'md5', 'bcrypt', 'pin'],
    }
    return render(request, 'siber_test.html', context)


@require_auth
def password_add_page(request):
    """Render add password page"""
    user = get_session_user(request)
    context = {
        'user': user,
        'category_tree': definitions.category_tree(user, active_only=True),
        'services': definitions.services(user, active_only=True),
    }
    return render(request, 'card_add.html', context)


@require_auth
def password_edit_page(request, password_id):
    """Render edit password page"""
    user = get_session_user(request)
    try:
        card = PasswordCard.objects.get(id=password_id, user=user)
        # Nothing private is put in the page: vault_fields.js fills the form, and the password is
        # fetched only when the user reveals it
        context = {
            'user': user,
            'card': card,
            'category_tree': definitions.category_tree(user, active_only=True, keep=(card.category, card.subcategory)),
        }
        return render(request, 'password_edit.html', context)
    except PasswordCard.DoesNotExist:
        return redirect('/passwords')


@require_auth
def profile_page(request):
    """Render profile page"""
    user = get_session_user(request)
    context = {'user': user}
    return render(request, 'profile.html', context)


@require_auth
def settings_page(request):
    """Render settings page"""
    user = get_session_user(request)
    context = {
        'user': user,
        'timeout_choices': User.SESSION_TIMEOUT_CHOICES,
        'clipboard_choices': User.CLIPBOARD_CLEAR_CHOICES,
        'max_age_choices': User.PASSWORD_MAX_AGE_CHOICES,
        'has_recovery_key': bool(user.recovery_key_wrapped),
    }
    return render(request, 'settings.html', context)


_REGISTER_LOCK = threading.Lock()


@require_http_methods(["POST"])
@rate_limit('register', limit=5, window=10 * 60)
def api_register(request):
    """Register a new user"""
    refusal = launch_refusal(request)
    if refusal:
        return refusal
    data = get_json_body(request)
    username = text_field(data, 'username').strip()
    master_password = text_field(data, 'master_password')
    
    # Validation with specific error messages
    if not username:
        return JsonResponse({'error': 'Kullanıcı adı boş bırakılamaz', 'field': 'username'}, status=400)
    
    if len(username) < 3:
        return JsonResponse({'error': 'Kullanıcı adı en az 3 karakter olmalı', 'field': 'username'}, status=400)
    
    if len(username) > USERNAME_MAX:
        return JsonResponse({'error': 'Kullanıcı adı en fazla 20 karakter olabilir', 'field': 'username'}, status=400)
    
    password_error = master_password_error(master_password)
    if password_error:
        return JsonResponse({'error': password_error, 'field': 'master_password'}, status=400)

    # Case-insensitive: "ALICE" next to "alice" would be confused with it by people (and was by the lockout)
    name_taken = JsonResponse({'error': 'Bu kullanıcı adı zaten kullanılıyor! Bu bilgisayarda daha önce aynı kullanıcı adıyla hesap oluşturmuş olabilirsiniz. Farklı bir kullanıcı adı deneyin veya mevcut hesabınızla giriş yapın', 'field': 'username'}, status=400)
    if User.objects.filter(username__iexact=username).exists():
        return name_taken

    encryption_key = os.urandom(32)  # the data key: random, wrapped with the master password
    recovery_key = generate_recovery_key()

    user = User(username=username, recovery_key_wrapped=wrap_with_recovery_key(encryption_key, recovery_key),
                key_generation=User.KEY_GENERATION,  # a random key from the start
                whats_new_seen=WHATS_NEW_VERSION)  # nothing is "new" to a new account
    apply_master_password(user, master_password, encryption_key)  # the slow part, outside the lock
    # Two sign-ups with the same name at once: the check above passed for both, so it is repeated
    # under a lock (the database only knows exact-case uniqueness), and the loser gets the same answer
    with _REGISTER_LOCK:
        if User.objects.filter(username__iexact=username).exists():
            wipe(encryption_key)
            return name_taken
        try:
            with transaction.atomic():
                user.save()
        except IntegrityError:
            wipe(encryption_key)
            return name_taken
    # A first look that isn't empty: built-in definitions and three sample cards
    definitions.ensure_defaults(user)
    samples.create_sample_cards(user, encryption_key, text_field(data, 'lang').strip())

    start_session(request, user, encryption_key)
    wipe(encryption_key)  # the session keeps its own copy (keystore.py)

    return with_device(JsonResponse({
        'success': True,
        'message': 'Kayıt başarılı',
        'user': {'id': user.id, 'username': user.username},
        'recovery_key': recovery_key,  # shown once by the browser, never stored
    }), user)


@require_http_methods(["POST"])
def api_login(request):
    """Login user"""
    refusal = launch_refusal(request)
    if refusal:
        return refusal
    data = get_json_body(request)
    username = text_field(data, 'username').strip()
    master_password = text_field(data, 'master_password')
    keep_signed_in = data.get('remember') is True
    
    # Validation
    if not username:
        return JsonResponse({'error': 'Kullanıcı adı boş bırakılamaz', 'field': 'username'}, status=400)
    if len(username) > USERNAME_LOOKUP_MAX:
        return JsonResponse({'error': 'Kullanıcı adı veya ana şifre hatalı'}, status=401)
    
    if not master_password:
        return JsonResponse({'error': 'Şifre boş bırakılamaz', 'field': 'master_password'}, status=400)
    
    if len(master_password) < 8:
        return JsonResponse({'error': 'Şifre en az 8 karakter olmalıdır', 'field': 'master_password'}, status=400)

    # Wrong passwords lock the account (or this trusted browser) for a growing delay (see ratelimit.py)
    user = User.objects.filter(username=username).first()
    device = trusted_device(user, data.get('device_token'))

    def check():
        # Same answer, and about the same time, for an unknown name and a wrong password:
        # nothing here tells which accounts exist
        if user:
            return master_key(user, master_password)
        derive_key(master_password, b'\0' * 32)  # the same work as a real check; never a match
        return None

    wait, derived_key = ratelimit.attempt(attempt_lock_key(user, username, device), check)
    if wait:
        return ratelimit.locked_out(wait)
    if not derived_key:
        if user:
            notifications.record_failed_login(user)  # shown after the next successful login
        return JsonResponse({'error': 'Kullanıcı adı veya ana şifre hatalı'}, status=401)

    data_key, _ = unlock_data_key(derived_key, user.encryption_key_encrypted)
    if data_key is not derived_key:
        wipe(derived_key)
    new_recovery_key = None
    if user.key_generation < User.KEY_GENERATION:
        # The data key may be the one from <= 1.2.4: PBKDF2 of the master password, stored in
        # plaintext there, so a 1.2.4 snapshot or any old copy of the database holds it. Builds
        # 2.42-2.47.141 kept that key and only wrapped it, so the storage format proves nothing;
        # the account's key generation decides. Everything moves to a new random key once.
        try:
            old_key = data_key
            data_key, new_recovery_key = rotate_legacy_key(user, old_key, master_password)
            wipe(old_key)  # nothing uses the old key any more
        except Exception:
            logger.exception('Legacy key rotation failed')
            return JsonResponse({'error': 'Giriş tamamlanamadı, verileriniz değişmedi. Tekrar deneyin.'}, status=500)
    elif user.kdf != KDF_CURRENT:
        # One-time upgrade of the master password's wrapping to Argon2id; the data key stays
        apply_master_password(user, master_password, data_key)
        user.save(update_fields=MASTER_PASSWORD_FIELDS)
    start_session(request, user, data_key, keep_until=time.time() + KEEP_SIGNED_IN_SECONDS if keep_signed_in else None)
    purge_expired_trash(user)
    vault.seal_existing(user, data_key)  # cards from older versions
    if data_key is not user.encryption_key_encrypted:  # a key in the account's own column stays
        wipe(data_key)  # the session keeps its own copy (keystore.py)

    result = {'success': True, 'message': 'Giriş başarılı', 'user': {'id': user.id, 'username': user.username},
              'has_picture': bool(user.security_picture)}  # without one, the page offers to choose it
    if new_recovery_key:
        result['recovery_key'] = new_recovery_key  # the old one stopped working with the key change: shown once
    return with_device(JsonResponse(result), user, device)


@require_http_methods(["POST"])
def api_logout(request):
    """Logout user. POST only: a link on another site must not be able to sign anyone out."""
    request.session.flush()
    return JsonResponse({'success': True, 'message': 'Çıkış yapıldı'})


@require_http_methods(["GET"])
def api_check_auth(request):
    """Check if user is authenticated"""
    user = get_session_user(request)
    if user:
        return JsonResponse({
            'authenticated': True,
            'user': {'id': user.id, 'username': user.username}
        })
    return JsonResponse({'authenticated': False})


def session_end_reason(request):
    """'timeout' when the inactivity limit ran out; otherwise 'ended' (app restarted -- sessions
    live only in memory -- signed out elsewhere, or master password changed)"""
    deadline = session_deadline(request)
    if deadline and time.time() > deadline:
        return 'timeout'
    return 'ended'


@require_http_methods(["GET"])
def api_session_status(request):
    """Remaining session time. Polling this must not count as activity."""
    reason = session_end_reason(request)  # read before get_session_user flushes the session
    user = get_session_user(request, touch=False)
    if not user:
        return JsonResponse({'authenticated': False, 'remaining': 0, 'reason': reason})
    return JsonResponse({
        'authenticated': True,
        'remaining': get_session_remaining(request),
        'timeout': get_session_timeout(request),
    })


@require_http_methods(["POST"])
def api_session_refresh(request):
    """Record user activity (sent by the client while the user is active, or 'stay signed in')"""
    reason = session_end_reason(request)
    user = get_session_user(request)
    if not user:
        return JsonResponse({'authenticated': False, 'remaining': 0, 'reason': reason}, status=401)
    return JsonResponse({
        'authenticated': True,
        'remaining': get_session_remaining(request),
        'timeout': get_session_timeout(request),
    })


def rotate_legacy_key(user, old_key, master_password):
    """Move an account to a new random data key (same master password).
    One transaction: everything moves or nothing changes. Returns (new_key, recovery_key):
    an existing recovery key wraps the old key and stops working, so a new one is issued
    and must be shown to the user once (None if the account had none)."""
    new_key = os.urandom(32)
    recovery_key = generate_recovery_key() if user.recovery_key_wrapped else None
    with transaction.atomic():
        vault.rotate_data_key(user, old_key, new_key)  # also seals the private fields of old cards
        apply_master_password(user, master_password, new_key)
        if recovery_key:
            user.recovery_key_wrapped = wrap_with_recovery_key(new_key, recovery_key)
        user.key_generation = User.KEY_GENERATION
        user.save(update_fields=[*MASTER_PASSWORD_FIELDS, 'recovery_key_wrapped', 'key_generation'])
    return new_key, recovery_key


def replace_master_password(user, old_key, new_password):
    """Move the account to a new master password, a new random data key and a new recovery key.

    Everything stored is re-encrypted inside one transaction, so either all of it moves
    to the new key or nothing changes. Returns (new_key, recovery_key, re_encrypted).
    """
    new_key = os.urandom(32)
    recovery_key = generate_recovery_key()
    with transaction.atomic():
        re_encrypted = vault.rotate_data_key(user, old_key, new_key)
        apply_master_password(user, new_password, new_key)
        user.recovery_key_wrapped = wrap_with_recovery_key(new_key, recovery_key)
        user.key_generation = User.KEY_GENERATION
        user.save(update_fields=[*MASTER_PASSWORD_FIELDS, 'recovery_key_wrapped', 'key_generation'])
        # Whoever changes the master password decides which browsers are trusted from now on
        TrustedDevice.objects.filter(user=user).delete()
    return new_key, recovery_key, re_encrypted


@require_http_methods(["POST"])
@rate_limit('recover', limit=20, window=60)
def api_recover_account(request):
    """Forgotten master password: the recovery key unlocks the account and sets a new master password"""
    refusal = launch_refusal(request)
    if refusal:
        return refusal
    data = get_json_body(request)
    username = text_field(data, 'username').strip()
    recovery_key = text_field(data, 'recovery_key')[:100]
    new_password = text_field(data, 'new_password')
    if len(username) > USERNAME_LOOKUP_MAX:
        return JsonResponse({'error': 'Kullanıcı adı veya kurtarma anahtarı hatalı'}, status=400)

    # Own counter: a typo here must not lock the normal sign-in, and the other way round
    user = User.objects.filter(username=username).first()
    account = attempt_lock_key(user, username, trusted_device(user, data.get('device_token')), 'recover:')
    wait = ratelimit.lock_remaining(account)
    if wait:
        return ratelimit.locked_out(wait)
    password_error = master_password_error(new_password)
    if password_error:
        return JsonResponse({'error': password_error, 'field': 'new_password'}, status=400)
    wait, data_key = ratelimit.attempt(
        account, lambda: unwrap_with_recovery_key(user.recovery_key_wrapped, recovery_key) if user else None)
    if wait:
        return ratelimit.locked_out(wait)
    if not data_key:
        return JsonResponse({'error': 'Kullanıcı adı veya kurtarma anahtarı hatalı'}, status=400)

    try:
        new_key, new_recovery_key, _ = replace_master_password(user, data_key, new_password)
    except Exception:
        # Nothing was written: the transaction rolled back
        return JsonResponse({'error': 'Şifre değiştirilemedi, verileriniz değişmedi. Tekrar deneyin.'}, status=500)
    start_session(request, user, new_key)
    keystore.drop_user(user.id, keep=request.session.get(KEY_REF))  # other sessions held the old key
    wipe(data_key, new_key)  # the session keeps its own copy
    notifications.record_master_changed(user)
    return with_device(JsonResponse({'success': True, 'recovery_key': new_recovery_key}), user)


@require_http_methods(["POST"])
@rate_limit('recovery_key', limit=10, window=60)
def api_recovery_key(request):
    """Create the recovery key, or replace it (the old one stops working). Asks for the master password."""
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    failure = master_password_check(user, text_field(get_json_body(request), 'master_password'))
    if failure:
        return failure
    recovery_key = generate_recovery_key()
    user.recovery_key_wrapped = wrap_with_recovery_key(get_session_key(request), recovery_key)
    user.save(update_fields=['recovery_key_wrapped'])
    return JsonResponse({'success': True, 'recovery_key': recovery_key})


@require_http_methods(["POST"])
def api_whats_new_seen(request):
    """The user finished or closed the "what's new" tour"""
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    user.whats_new_seen = WHATS_NEW_VERSION
    user.save(update_fields=['whats_new_seen'])
    return JsonResponse({'success': True})


@require_http_methods(["POST"])
@rate_limit('change_master', limit=10, window=60)
def api_change_master_password(request):
    """Change the master password and rotate the data key (see replace_master_password)"""
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)

    data = get_json_body(request)
    current_password = text_field(data, 'current_password')
    new_password = text_field(data, 'new_password')

    # The new password is checked first: a request that can't change anything never costs a key derivation
    password_error = master_password_error(new_password)
    if password_error:
        return JsonResponse({'error': password_error, 'field': 'new_password'}, status=400)
    if new_password == current_password:
        return JsonResponse({'error': 'Yeni ana şifre mevcut şifreyle aynı olamaz', 'field': 'new_password'}, status=400)

    wait, old_derived = ratelimit.attempt(lock_key(user, user.username),
                                          lambda: bool(current_password) and master_key(user, current_password))
    if wait:
        return ratelimit.locked_out(wait)
    if not old_derived:
        return JsonResponse({'error': 'Mevcut ana şifre yanlış', 'field': 'current_password'}, status=400)

    old_key, _ = unlock_data_key(old_derived, user.encryption_key_encrypted)

    try:
        new_key, recovery_key, re_encrypted = replace_master_password(user, old_key, new_password)
    except Exception:
        # Nothing was written: the transaction rolled back
        return JsonResponse({'error': 'Şifre değiştirilemedi, verileriniz değişmedi. Tekrar deneyin.'}, status=500)

    # Keep this browser signed in with the new key; other sessions end on their next request
    start_session(request, user, new_key, keep_until=request.session.get('keep_until'))
    keystore.drop_user(user.id, keep=request.session.get(KEY_REF))  # other sessions held the old key
    wipe(old_derived, old_key, new_key)  # the session keeps its own copy
    notifications.record_master_changed(user)
    return with_device(JsonResponse({'success': True, 're_encrypted': re_encrypted, 'recovery_key': recovery_key}), user)


@require_http_methods(["POST"])
def api_settings(request):
    """Update user settings. Only the fields present in the body are changed."""
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)

    data = get_json_body(request)
    fields = {
        # field: (allowed values, error message)
        'session_timeout_minutes': (User.SESSION_TIMEOUT_CHOICES, 'Geçersiz oturum süresi'),
        'clipboard_clear_seconds': (User.CLIPBOARD_CLEAR_CHOICES, 'Geçersiz pano temizleme süresi'),
        'password_max_age_days': (User.PASSWORD_MAX_AGE_CHOICES, 'Geçersiz hatırlatma süresi'),
        'update_check_enabled': ((0, 1), 'Geçersiz güncelleme ayarı'),
    }
    updates = {}
    for field, (choices, error) in fields.items():
        if field not in data:
            continue
        try:
            value = int(data[field])
        except (TypeError, ValueError):
            return JsonResponse({'error': error, 'field': field}, status=400)
        if value not in choices:
            return JsonResponse({'error': error, 'field': field}, status=400)
        updates[field] = value

    if 'security_picture' in data:
        if not pictures.valid(data['security_picture']):
            return JsonResponse({'error': 'Geçersiz görsel seçimi', 'field': 'security_picture'}, status=400)
        updates['security_picture'] = data['security_picture']

    if not updates:
        return JsonResponse({'error': 'Güncellenecek ayar yok'}, status=400)

    for field, value in updates.items():
        setattr(user, field, value)
    user.save(update_fields=list(updates))
    if 'session_timeout_minutes' in updates:
        # Apply to the current session right away
        request.session['timeout_seconds'] = updates['session_timeout_minutes'] * 60

    return JsonResponse({
        'success': True,
        'session_timeout_minutes': user.session_timeout_minutes,
        'clipboard_clear_seconds': user.clipboard_clear_seconds,
        'password_max_age_days': user.password_max_age_days,
        'update_check_enabled': bool(user.update_check_enabled),
        'security_picture': user.security_picture,
        'remaining': get_session_remaining(request),
        'timeout': get_session_timeout(request),
    })


@require_http_methods(["GET", "POST"])
def api_passwords(request):
    """List all passwords or create new password"""
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    
    if request.method == 'GET':
        # The list omits passwords; GET /api/passwords/<id> returns a single one
        cards = vault.open_cards(PasswordCard.objects.filter(user=user).order_by('-created_at'), get_session_key(request))

        cards_data = []
        for card in cards:
            cards_data.append({
                'id': card.id,
                'app_name': card.app_name,
                'username': card.username,
'url': card.url,
                'notes': card.notes,
                'category': card.category,
                'subcategory': card.subcategory or '',
                'active': card.is_active,
                'created_at': card.created_at.isoformat(),
                'updated_at': card.updated_at.isoformat()
            })
        
        return JsonResponse({'cards': cards_data})
    
    elif request.method == 'POST':
        data = get_json_body(request)
        app_name = text_field(data, 'app_name').strip()
        username = text_field(data, 'username').strip()
        password = text_field(data, 'password')
        url = normalize_url(text_field(data, 'url'))
        notes = text_field(data, 'notes')
        category = text_field(data, 'category')
        subcategory = text_field(data, 'subcategory')

        fields_error = card_fields_error({'app_name': app_name, 'username': username, 'password': password, 'url': url,
                                          'notes': notes, 'category': category, 'subcategory': subcategory})
        if fields_error:
            return JsonResponse({'error': fields_error}, status=400)

        encryption_key = get_session_key(request)
        password_encrypted = encrypt_data(password, encryption_key)
        
        card = vault.create_card(
            encryption_key,
            user=user,
            app_name=app_name,
            username=username,
            password_encrypted=password_encrypted,
            url=url,
            notes=notes,
            category=category,
            subcategory=subcategory
        )
        
        return JsonResponse({
            'success': True,
            'message': 'Şifre oluşturuldu',
            'card': {
                'id': card.id,
                'app_name': card.app_name,
                'username': card.username
            }
        })


@require_http_methods(["GET"])
def api_launch_check(request):
    """Proof for `safepass start` that this is the server it launched: HMAC of its random challenge
    with the per-launch secret only that server got (settings.LAUNCH_TOKEN, see __main__._launch_proof).
    Another program listening on the port can't answer it."""
    token = settings.LAUNCH_TOKEN
    challenge = request.GET.get('c', '')
    if not token or not 16 <= len(challenge) <= 64:
        return JsonResponse({'error': 'Bulunamadı'}, status=404)
    return JsonResponse({'proof': hmac.new(token.encode(), challenge.encode(), hashlib.sha256).hexdigest()})


@require_http_methods(["POST"])
@rate_limit('launch_claim', limit=20, window=60)
def api_launch_claim(request):
    """Trade the one-time link `safepass start` opened for this browser's mark (see launch.py)"""
    mark = launch.claim(get_json_body(request).get('link'))
    if not mark:
        return JsonResponse({'error': LAUNCH_REQUIRED, 'reason': 'launch_required'}, status=428)
    return JsonResponse({'success': True, 'mark': mark})


@require_http_methods(["GET"])
@rate_limit('launch_status', limit=120, window=60)
def api_launch_status(request):
    """Whether this browser may show the sign-in forms; with ?username=, that account's security
    picture (only ever to a browser `safepass start` opened, so no other program can learn it)"""
    if not launch.verified(request):
        return JsonResponse({'verified': False})
    username = request.GET.get('username', '').strip()
    picture = ''
    if username and len(username) <= USERNAME_LOOKUP_MAX:
        picture = User.objects.filter(username=username).values_list('security_picture', flat=True).first() or ''
    return JsonResponse({'verified': True, 'picture': picture})


VAULT_FIELDS_MAX_IDS = 200


@require_http_methods(["GET"])
@rate_limit('vault_fields', limit=120, window=60)
def api_vault_fields(request):
    """Private fields (no passwords) of the user's cards, trash included, for the page placeholders
    filled by vault_fields.js. ?ids=1,2,3. Behind the API key, unlike the page itself."""
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    parts = [part for part in request.GET.get('ids', '').split(',') if part]
    if len(parts) > VAULT_FIELDS_MAX_IDS or not all(part.isdigit() and len(part) < 19 for part in parts):
        return JsonResponse({'error': 'Geçersiz istek'}, status=400)
    cards = vault.open_cards(PasswordCard.all_objects.filter(user=user, id__in=[int(part) for part in parts]),
                             get_session_key(request))
    return JsonResponse({'fields': {str(card.id): {'app_name': card.app_name, 'username': card.username,
                                                   'url': card.url or '', 'notes': card.notes or ''} for card in cards}})


@require_http_methods(["GET", "PUT"])
@rate_limit('password_detail', limit=120, window=60)
def api_password_detail(request, password_id):
    """Get or update a specific password"""
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    
    try:
        card = vault.open_card(PasswordCard.objects.get(id=password_id, user=user), get_session_key(request))
    except PasswordCard.DoesNotExist:
        return JsonResponse({'error': 'Şifre bulunamadı'}, status=404)

    if request.method == 'GET':
        encryption_key = get_session_key(request)
        try:
            password = decrypt_data(bytes(card.password_encrypted), encryption_key)
        except:
            password = ''
        
        return JsonResponse({
            'card': {
                'id': card.id,
                'app_name': card.app_name,
                'username': card.username,
                'password': password,
                'notes': card.notes,
                'category': card.category,
                'subcategory': card.subcategory or '',
                'url': getattr(card, 'url', '')
            }
        })
    
    elif request.method == 'PUT':
        data = get_json_body(request)
        app_name = text_field(data, 'app_name').strip()
        username = text_field(data, 'username').strip()
        password = text_field(data, 'password')  # empty = keep the current password
        url = normalize_url(text_field(data, 'url'))
        notes = text_field(data, 'notes')
        category = text_field(data, 'category')
        subcategory = text_field(data, 'subcategory')

        fields_error = card_fields_error({'app_name': app_name, 'username': username, 'password': password or 'unchanged',
                                          'url': url, 'notes': notes, 'category': category, 'subcategory': subcategory})
        if fields_error:
            return JsonResponse({'error': fields_error}, status=400)

        encryption_key = get_session_key(request)
        if password:
            try:
                current_password = decrypt_data(bytes(card.password_encrypted), encryption_key)
            except Exception:
                current_password = None
            # Only a real change goes to the history
            if password != current_password:
                from .models import PasswordHistory
                if card.password_encrypted:
                    PasswordHistory.objects.create(card=card, password_encrypted=card.password_encrypted)
                card.password_encrypted = encrypt_data(password, encryption_key)
        
        card.app_name = app_name
        card.username = username
        card.url = url
        card.notes = notes
        card.category = category
        card.subcategory = subcategory
        vault.save_card(card, encryption_key)
        
        return JsonResponse({
            'success': True,
            'message': 'Şifre güncellendi',
            'card': {
                'id': card.id,
                'app_name': card.app_name,
                'username': card.username
            }
        })


@require_http_methods(["DELETE"])
def api_password_delete(request, password_id):
    """Delete a password"""
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    
    try:
        card = PasswordCard.objects.get(id=password_id, user=user)
    except PasswordCard.DoesNotExist:
        return JsonResponse({'error': 'Şifre bulunamadı'}, status=404)
    # Soft delete: the card waits in the trash for TRASH_DAYS
    card.deleted_at = timezone.now()
    card.save(update_fields=['deleted_at'])
    return JsonResponse({'success': True, 'trashed': True, 'trash_days': PasswordCard.TRASH_DAYS,
                         'trash_count': trash_count(user)})


@require_http_methods(["POST"])
@escalating_limit('generate', limit=10, window=60)  # 10 in any minute; waits 1, 2, 3 … 10 min, survives restarts
def api_generate_password(request):
    """Generate a random password"""
    if not get_session_user(request):
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    data = get_json_body(request)
    try:
        length = int(data.get('length', 16))
    except (TypeError, ValueError):
        length = 16
    length = min(max(length, 4), 128)
    flag = lambda name, default: data.get(name, default) if isinstance(data.get(name, default), bool) else default
    use_uppercase = flag('uppercase', True)
    use_lowercase = flag('lowercase', True)
    use_digits = flag('numbers', True)
    use_symbols = flag('symbols', True)
    exclude_similar = flag('exclude_similar', False)
    
    password = generate_password(
        length=length,
        use_uppercase=use_uppercase,
        use_lowercase=use_lowercase,
        use_digits=use_digits,
        use_symbols=use_symbols,
        exclude_similar=exclude_similar
    )
    
    # Digits only and short: judged as a PIN (repeats, sequences, dates …), not as a password
    strength = calculate_pin_strength(password) if is_pin(password) else calculate_password_strength(password)
    
    return JsonResponse({
        'success': True,
        'password': password,
        'strength': strength
    })


@require_http_methods(["GET"])
def api_dashboard_stats(request):
    """Get dashboard statistics"""
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    
    cards = PasswordCard.objects.filter(user=user)
    stats = get_dashboard_stats(user, cards, get_session_key(request))
    return JsonResponse(stats)


def import_rows(user, key, rows):
    """Add imported cards: a matching card only gets a new password (the old one goes to its history).
    Returns (imported, updated, skipped)."""
    identity = lambda app_name, username, url, category: (app_name, username, url or '', category)
    known = {}
    for card in vault.open_cards(PasswordCard.objects.filter(user=user), key):
        known.setdefault(identity(card.app_name, card.username, card.url, card.category), card)

    imported = updated = skipped = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            app_name = clamp_imported(text_field(row, 'app_name') or text_field(row, 'title') or 'Bilinmeyen', 'app_name')
            username = clamp_imported(text_field(row, 'username'), 'username')
            password = text_field(row, 'password')
            # Unsafe schemes are dropped
            url = clamp_imported(normalize_url(text_field(row, 'url') or text_field(row, 'website')) or '', 'url')
            category = clamp_imported(text_field(row, 'category') or 'genel', 'category')
            subcategory = clamp_imported(text_field(row, 'subcategory'), 'subcategory')
            if not password:
                skipped += 1
                continue

            existing = known.get(identity(app_name, username, url, category))
            if not existing:
                card = vault.create_card(key, user=user, app_name=app_name, username=username,
                                         password_encrypted=encrypt_data(password, key), url=url,
                                         notes=clamp_imported(text_field(row, 'notes'), 'notes'),
                                         category=category, subcategory=subcategory,
                                         is_active=row.get('active') is not False)
                known[identity(app_name, username, url, category)] = card
                imported += 1
            elif decrypt_data(bytes(existing.password_encrypted), key) == password:
                skipped += 1
            else:
                PasswordHistory.objects.create(card=existing, password_encrypted=existing.password_encrypted)
                existing.password_encrypted = encrypt_data(password, key)
                vault.save_card(existing, key)
                updated += 1
        except Exception:
            skipped += 1
    return imported, updated, skipped


@require_http_methods(["POST"])
@rate_limit('import', limit=10, window=60)
def api_import_data(request):
    """Import data from JSON file or JSON body"""
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    
    # Key derived at login and held only for this session
    session_key = get_session_key(request)
    if not session_key:
        return JsonResponse({'error': 'Oturum süresi dolmuş'}, status=401)
    
    # File size limit: 10MB
    MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB in bytes
    if 'file' in request.FILES:
        uploaded_file = request.FILES['file']
        if uploaded_file.size > MAX_FILE_SIZE:
            return JsonResponse({
                'error': f'Dosya boyutu çok büyük! Maksimum {MAX_FILE_SIZE // (1024 * 1024)}MB yüklenebilir'
            }, status=400)
    
    encryption_key = session_key
    
    try:
        # Check if data is coming from file upload or JSON body
        if 'file' in request.FILES:
            # File upload
            uploaded_file = request.FILES['file']
            try:
                file_content = uploaded_file.read().decode('utf-8-sig')
            except UnicodeDecodeError:
                return JsonResponse({'error': 'Dosya UTF-8 metin değil. SafePass dışa aktarma dosyası (.json) seçin.'}, status=400)
            import_data = json.loads(file_content)
        else:
            # JSON body
            data = get_json_body(request)
            
            # Check if passwords are provided directly
            if 'passwords' in data:
                import_data = data
            else:
                return JsonResponse({'error': 'Dosya yüklenmedi'}, status=400)
        
        # Validate format
        if 'passwords' not in import_data or not isinstance(import_data['passwords'], list):
            return JsonResponse({'error': 'Geçersiz dosya formatı'}, status=400)
        
        imported_count, updated_count, skipped_count = import_rows(user, encryption_key, import_data['passwords'])

        return JsonResponse({
            'success': True,
            'imported': imported_count,
            'updated': updated_count,
            'skipped': skipped_count,
            'total': len(import_data['passwords']),
            'message': f'{imported_count} yeni şifre eklendi, {updated_count} şifre güncellendi, {skipped_count} atlandı'
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Geçersiz JSON formatı'}, status=400)
    except Exception:
        logger.exception('Import failed')
        return JsonResponse({'error': 'İçe aktarma hatası. Tekrar deneyin.'}, status=500)


@require_http_methods(["DELETE", "POST"])
def api_delete_account(request):
    """Delete user account and all associated data"""
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    
    try:
        data = get_json_body(request)
        master_password = text_field(data, 'master_password')
        
        if not master_password:
            return JsonResponse({'error': 'Ana şifre gerekli'}, status=400)
        
        failure = master_password_check(user, master_password)
        if failure:
            return failure

        username = user.username
        keystore.drop_user(user.id)  # every session of the account, not only this one
        user.delete()

        request.session.flush()
        
        return JsonResponse({            'success': True,
            'message': f'{username} hesabı ve tüm verileri silindi'
        })
        
    except Exception:
        
        logger.exception('Could not delete account')
        
        return JsonResponse({'error': 'Hesap silinirken hata. Tekrar deneyin.'}, status=500)

@require_http_methods(["GET"])
@rate_limit('history', limit=60, window=60)
def api_password_history(request, password_id):
    """Get password history for a specific card"""
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    
    try:
        card = PasswordCard.objects.get(id=password_id, user=user)
        from .models import PasswordHistory
        history = PasswordHistory.objects.filter(card=card).order_by('-changed_at')[:10]  # Last 10 changes
        
        encryption_key = get_session_key(request)
        history_list = []
        
        for item in history:
            try:
                decrypted_password = decrypt_data(bytes(item.password_encrypted), encryption_key)
                history_list.append({
                    'id': item.id,
                    'password': decrypted_password,
                    'changed_at': item.changed_at.strftime('%d.%m.%Y %H:%M')
                })
            except:
                continue
        
        return JsonResponse({
            'success': True,
            'history': history_list
        })
    except PasswordCard.DoesNotExist:
        return JsonResponse({'error': 'Kart bulunamadı'}, status=404)


@require_auth
def import_export_page(request):
    """Import/Export page"""
    user = get_session_user(request)
    context = {'user': user}
    return render(request, 'import_export.html', context)


@require_http_methods(["POST"])
@rate_limit('import', limit=10, window=60)
def api_import_passwords(request):
    """Import passwords from KeePass CSV"""
    # Custom session-based authentication (tutarlılık için)
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    
    # Key derived at login and held only for this session
    session_key = get_session_key(request)
    if not session_key:
        return JsonResponse({'error': 'Oturum süresi dolmuş'}, status=401)
    
    # File size limit: 10MB
    MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB in bytes
    if request.body and len(request.body) > MAX_FILE_SIZE:
        return JsonResponse({
            'error': f'Dosya boyutu çok büyük! Maksimum {MAX_FILE_SIZE // (1024 * 1024)}MB yüklenebilir'
        }, status=400)
    
    try:
        data = get_json_body(request)
        
        passwords = data.get('passwords', [])
        if not passwords or not isinstance(passwords, list):
            return JsonResponse({'error': 'Şifre verisi sağlanmadı'}, status=400)

        imported, updated, skipped = import_rows(user, session_key, passwords)

        return JsonResponse({
            'success': True,
            'imported': imported,
            'updated': updated,
            'skipped': skipped,
            'total': len(passwords),
            'message': f'{imported} yeni şifre eklendi, {updated} şifre güncellendi, {skipped} atlandı'
        })
    
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Geçersiz JSON formatı'}, status=400)
    except Exception:
        logger.exception('Import failed')
        return JsonResponse({'error': 'İçe aktarma hatası. Tekrar deneyin.'}, status=500)


BACKUP_PASSWORD_MIN = 10


@require_http_methods(["POST"])
@rate_limit('import', limit=10, window=60)
def api_import_backup(request):
    """Import an encrypted backup (.safepass). Body: {backup, password}"""
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    session_key = get_session_key(request)
    if not session_key:
        return JsonResponse({'error': 'Oturum süresi dolmuş'}, status=401)

    data = get_json_body(request)
    try:
        content = json.loads(decrypt_backup(data.get('backup'), text_field(data, 'password')))
    except WrongBackupPassword:
        return JsonResponse({'error': 'Yedek parolası hatalı ya da dosya bozulmuş'}, status=400)
    except (InvalidBackup, ValueError):
        return JsonResponse({'error': 'Geçersiz dosya formatı'}, status=400)
    rows = content.get('passwords') if isinstance(content, dict) else None
    if not isinstance(rows, list):
        return JsonResponse({'error': 'Geçersiz dosya formatı'}, status=400)

    imported, updated, skipped = import_rows(user, session_key, rows)
    return JsonResponse({
        'success': True, 'imported': imported, 'updated': updated, 'skipped': skipped, 'total': len(rows),
        'message': f'{imported} yeni şifre eklendi, {updated} şifre güncellendi, {skipped} atlandı'
    })


@require_http_methods(["POST"])
@rate_limit('export', limit=5, window=60)
def api_export_passwords(request):
    """Export passwords to JSON"""
    # Custom session-based authentication (tutarlılık için)
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    
    # Key derived at login and held only for this session
    session_key = get_session_key(request)
    if not session_key:
        return JsonResponse({'error': 'Oturum süresi dolmuş'}, status=401)
    
    data = get_json_body(request)
    # The file holds every password in plain text: an unattended open session isn't enough
    master_password = text_field(data, 'master_password')
    failure = master_password_check(user, master_password)
    if failure:
        return failure

    # With a backup password the file is encrypted; without one it is plain text for moving to another app
    encrypted = 'backup_password' in data
    backup_password = text_field(data, 'backup_password')
    if encrypted and len(backup_password) < BACKUP_PASSWORD_MIN:
        return JsonResponse({'error': f'Yedek parolası en az {BACKUP_PASSWORD_MIN} karakter olmalı', 'field': 'backup_password'}, status=400)
    if encrypted and backup_password == master_password:
        return JsonResponse({'error': 'Yedek parolası ana şifreyle aynı olamaz', 'field': 'backup_password'}, status=400)

    try:
        include_metadata = encrypted or data.get('include_metadata', True)

        encryption_key = session_key

        # Get all password cards
        cards = vault.open_cards(PasswordCard.objects.filter(user=user).order_by('-created_at'), encryption_key)

        export_data = {
            'version': '1.2.3',
            'export_date': datetime.now().isoformat(),
            'total_passwords': len(cards),
            'passwords': []
        }
        
        for card in cards:
            try:
                # Decrypt password using correct function
                decrypted_password = decrypt_data(bytes(card.password_encrypted), encryption_key)
                
                # Model alanlarını düzelt: app_name ve url kullan
                password_data = {
                    'title': card.app_name,  # Export'ta 'title' olarak gönder (uyumluluk için)
                    'app_name': card.app_name,  # Her iki formatı da destekle
                    'username': card.username,
                    'password': decrypted_password,
                    'website': card.url,  # Export'ta 'website' olarak gönder (uyumluluk için)
                    'url': card.url,  # Her iki formatı da destekle
                    'category': card.category or 'genel',
                    'subcategory': card.subcategory or ''
                }
                
                if include_metadata:
                    password_data.update({
                        'notes': card.notes or '',
                        'active': card.is_active,
                        'created_at': card.created_at.isoformat(),
                        'updated_at': card.updated_at.isoformat()
                    })

                export_data['passwords'].append(password_data)
                
            except Exception as e:
                # Skip cards that fail to decrypt
                continue
        
        if encrypted:
            return JsonResponse(encrypt_backup(json.dumps(export_data, ensure_ascii=False), backup_password))
        return JsonResponse(export_data)

    except json.JSONDecodeError:
        return JsonResponse({'error': 'Geçersiz JSON formatı'}, status=400)
    except Exception:
        logger.exception('Export failed')
        return JsonResponse({'error': 'Dışa aktarma hatası. Tekrar deneyin.'}, status=500)



# ── Trash ────────────────────────────────────────────────────
def trash_count(user):
    return (PasswordCard.all_objects.filter(user=user, deleted_at__isnull=False).count()
            + len(definitions.trashed_definitions(user)))


def trashed_cards(user):
    return PasswordCard.all_objects.filter(user=user, deleted_at__isnull=False)


@require_auth
def notifications_page(request):
    """Every notification, with bulk read / delete (the list itself is drawn by notifications.js)"""
    return render(request, 'notifications.html', {'user': get_session_user(request)})


def notifications_user(request):
    """(user, error response) for the notification APIs"""
    user = get_session_user(request)
    if not user:
        return None, JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    return user, None


@require_http_methods(["GET"])
def api_notifications(request):
    """All notifications (reminders brought up to date first)"""
    user, error = notifications_user(request)
    if error:
        return error
    notifications.sync(user)
    return JsonResponse({'success': True, **notifications.listing(user, get_session_key(request))})


@require_http_methods(["POST"])
def api_notifications_read(request):
    """Mark notifications read (or unread with "read": false). Body: {"ids": [...]} or {"all": true}"""
    user, error = notifications_user(request)
    if error:
        return error
    data = get_json_body(request)
    chosen = notifications.selected(user, data)
    if chosen is None or not isinstance(data.get('read', True), bool):
        return JsonResponse({'error': 'Geçersiz istek'}, status=400)
    if data.get('read', True):
        chosen.filter(read_at__isnull=True).update(read_at=timezone.now())
    else:
        chosen.update(read_at=None)
    return JsonResponse({'success': True, **notifications.listing(user, get_session_key(request))})


@require_http_methods(["POST"])
def api_notifications_delete(request):
    """Delete notifications. Body: {"ids": [...]} or {"all": true}"""
    user, error = notifications_user(request)
    if error:
        return error
    chosen = notifications.selected(user, get_json_body(request))
    if chosen is None:
        return JsonResponse({'error': 'Geçersiz istek'}, status=400)
    chosen.update(dismissed_at=timezone.now())
    return JsonResponse({'success': True, **notifications.listing(user, get_session_key(request))})


@require_auth
def trash_page(request):
    """Cards deleted in the last TRASH_DAYS days"""
    import math
    user = get_session_user(request)
    purge_expired_trash(user)
    now = timezone.now()
    cards = list(trashed_cards(user).order_by('-deleted_at'))  # names come from /api/vault/fields
    for card in cards:
        expires_at = card.deleted_at + timedelta(days=PasswordCard.TRASH_DAYS)
        card.days_left = max(1, math.ceil((expires_at - now).total_seconds() / 86400))
    defs = definitions.trashed_definitions(user)
    for item in defs:
        expires_at = item['deleted_at'] + timedelta(days=PasswordCard.TRASH_DAYS)
        item['days_left'] = max(1, math.ceil((expires_at - now).total_seconds() / 86400))
    return render(request, 'trash.html', {'user': user, 'cards': cards, 'trashed_definitions': defs,
                                          'trash_days': PasswordCard.TRASH_DAYS})


def _trash_action(request, password_id=None):
    user = get_session_user(request)
    if not user:
        return None, None, JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    if password_id is None:
        return user, None, None
    card = trashed_cards(user).filter(id=password_id).first()
    if not card:
        return user, None, JsonResponse({'error': 'Şifre bulunamadı'}, status=404)
    return user, card, None


@require_http_methods(["POST"])
def api_trash_restore(request, password_id):
    user, card, error = _trash_action(request, password_id)
    if error:
        return error
    card.deleted_at = None
    card.save(update_fields=['deleted_at'])
    return JsonResponse({'success': True, 'trash_count': trash_count(user)})


@require_http_methods(["POST"])
def api_trash_delete(request, password_id):
    """Delete one card for good (its history goes with it)"""
    user, card, error = _trash_action(request, password_id)
    if error:
        return error
    card.delete()
    return JsonResponse({'success': True, 'trash_count': trash_count(user)})


@require_http_methods(["POST"])
def api_trash_empty(request):
    user, _, error = _trash_action(request)
    if error:
        return error
    deleted = trashed_cards(user).delete()[0]
    definitions.purge_expired(user, days=0)
    return JsonResponse({'success': True, 'deleted': deleted, 'trash_count': 0})


# ── Definitions: categories and services ─────────────────────

@require_auth
def definitions_page(request):
    user = get_session_user(request)
    context = {
        'user': user,
        'category_tree': definitions.category_tree(user, with_counts=True),
        'services': definitions.services(user),
        'swatches': definitions.COLOR_SWATCHES,
        'icon_catalog': icon_catalog(),
        'fallback': definitions.FALLBACK,
    }
    return render(request, 'definitions.html', context)


def _definitions_payload(user):
    return {'success': True, 'categories': definitions.category_tree(user, with_counts=True),
            'services': definitions.services(user), 'trash_count': trash_count(user)}


@require_http_methods(["GET"])
def api_definitions(request):
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    return JsonResponse(_definitions_payload(user))


@require_http_methods(["POST"])
@rate_limit('definitions', limit=60, window=60)
def api_category_save(request, category_id=None):
    """Create (no id) or edit a category. Body: {name, icon, color, parent (main slug, create only)}"""
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    definitions.ensure_defaults(user)
    data = get_json_body(request)
    name = definitions.clean_name(text_field(data, 'name'))
    if category_id is None:
        parent_slug = text_field(data, 'parent').strip()
        parent = None
        if parent_slug:
            parent = definitions.active_categories(user).filter(slug=parent_slug, parent__isnull=True).first()
            if not parent:
                return JsonResponse({'error': 'Kategori bulunamadı'}, status=404)
        if not name:
            return JsonResponse({'error': 'Ad boş bırakılamaz', 'field': 'name'}, status=400)
        position = definitions.active_categories(user).filter(parent=parent).count()
        Category.objects.create(
            user=user, parent=parent, slug=definitions.new_slug(user), name=name, position=position,
            icon=definitions.clean_icon(text_field(data, 'icon'), 'tag' if parent else 'folder'),
            color='' if parent else (definitions.clean_color(text_field(data, 'color')) or definitions.COLOR_SWATCHES[0]))
    else:
        category = definitions.active_categories(user).filter(id=category_id).first()
        if not category:
            return JsonResponse({'error': 'Kategori bulunamadı'}, status=404)
        # A built-in left nameless goes back to its translated name
        if not name and not category.builtin:
            return JsonResponse({'error': 'Ad boş bırakılamaz', 'field': 'name'}, status=400)
        category.name = name if name != definitions.DEFAULT_NAMES.get(category.slug) else ''
        category.icon = definitions.clean_icon(text_field(data, 'icon'), category.icon)
        if category.parent_id is None:
            category.color = definitions.clean_color(text_field(data, 'color')) or category.color
        category.save(update_fields=['name', 'icon', 'color'])
    return JsonResponse(_definitions_payload(user))


@require_http_methods(["POST"])
def api_category_delete(request, category_id):
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    category = definitions.active_categories(user).filter(id=category_id).first()
    if not category:
        return JsonResponse({'error': 'Kategori bulunamadı'}, status=404)
    try:
        moved = definitions.delete_category(category)
    except ValueError:
        return JsonResponse({'error': 'Genel kategorisi silinemez'}, status=400)
    return JsonResponse({**_definitions_payload(user), 'moved': moved})


@require_http_methods(["POST"])
@rate_limit('definitions', limit=60, window=60)
def api_service_save(request, service_id=None):
    """Create (no id) or edit a service. Body: {name, url, icon, subcategory (slug or '')}"""
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    definitions.ensure_defaults(user)
    data = get_json_body(request)
    name = definitions.clean_name(text_field(data, 'name'))
    if not name:
        return JsonResponse({'error': 'Ad boş bırakılamaz', 'field': 'name'}, status=400)
    url = text_field(data, 'url').strip()
    if url:
        url = normalize_url(url)
        if url is None:
            return JsonResponse({'error': 'Geçerli bir web adresi girin', 'field': 'url'}, status=400)
    url = url[:200]
    sub_slug = text_field(data, 'subcategory').strip()
    sub = None
    if sub_slug:
        sub = definitions.active_categories(user).filter(slug=sub_slug, parent__isnull=False).first()
    if service_id is None:
        position = Service.objects.filter(user=user, deleted_at__isnull=True).count()
        Service.objects.create(user=user, name=name, url=url, subcategory=sub, position=position,
                               icon=definitions.clean_icon(text_field(data, 'icon'), 'globe'))
    else:
        service = Service.objects.filter(user=user, id=service_id, deleted_at__isnull=True).first()
        if not service:
            return JsonResponse({'error': 'Servis bulunamadı'}, status=404)
        service.name, service.url, service.subcategory = name, url, sub
        service.icon = definitions.clean_icon(text_field(data, 'icon'), service.icon)
        service.save(update_fields=['name', 'url', 'subcategory', 'icon'])
    return JsonResponse(_definitions_payload(user))


@require_http_methods(["POST"])
def api_service_delete(request, service_id):
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    service = Service.objects.filter(user=user, id=service_id, deleted_at__isnull=True).first()
    if not service:
        return JsonResponse({'error': 'Servis bulunamadı'}, status=404)
    service.deleted_at = timezone.now()
    service.save(update_fields=['deleted_at'])
    return JsonResponse(_definitions_payload(user))


def _set_active(obj, data):
    """Pause / resume from {active: true|false}; False when the body has no boolean"""
    active = data.get('active') if isinstance(data, dict) else None
    if not isinstance(active, bool):
        return False
    obj.is_active = active
    obj.save(update_fields=['is_active'])
    return True


@require_http_methods(["POST"])
@rate_limit('definitions', limit=60, window=60)
def api_category_active(request, category_id):
    """Pause or resume a category / subcategory. Body: {active}"""
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    category = definitions.active_categories(user).filter(id=category_id).first()
    if not category:
        return JsonResponse({'error': 'Kategori bulunamadı'}, status=404)
    if not _set_active(category, get_json_body(request)):
        return JsonResponse({'error': 'Geçersiz istek'}, status=400)
    return JsonResponse(_definitions_payload(user))


@require_http_methods(["POST"])
@rate_limit('definitions', limit=60, window=60)
def api_service_active(request, service_id):
    """Pause or resume a quick-pick service. Body: {active}"""
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    service = Service.objects.filter(user=user, id=service_id, deleted_at__isnull=True).first()
    if not service:
        return JsonResponse({'error': 'Servis bulunamadı'}, status=404)
    if not _set_active(service, get_json_body(request)):
        return JsonResponse({'error': 'Geçersiz istek'}, status=400)
    return JsonResponse(_definitions_payload(user))


@require_http_methods(["POST"])
@rate_limit('password_detail', limit=120, window=60)
def api_password_active(request, password_id):
    """Pause or resume a card. Body: {active}"""
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    card = PasswordCard.objects.filter(user=user, id=password_id).first()
    if not card:
        return JsonResponse({'error': 'Şifre bulunamadı'}, status=404)
    if not _set_active(card, get_json_body(request)):
        return JsonResponse({'error': 'Geçersiz istek'}, status=400)
    notifications.sync(user)  # a paused card's age reminder goes, a resumed one's comes back
    return JsonResponse({'success': True, 'active': card.is_active})


def _trashed_definition(user, kind, item_id):
    if kind == 'category':
        return Category.objects.filter(user=user, id=item_id, deleted_at__isnull=False).first()
    if kind == 'service':
        return Service.objects.filter(user=user, id=item_id, deleted_at__isnull=False).first()
    return None


@require_http_methods(["POST"])
def api_trash_definition(request, kind, item_id, action):
    """Restore or delete for good a category / service from the trash"""
    user = get_session_user(request)
    if not user:
        return JsonResponse({'error': 'Oturum açmanız gerekiyor'}, status=401)
    item = _trashed_definition(user, kind, item_id)
    if not item or action not in ('restore', 'delete'):
        return JsonResponse({'error': 'Tanım bulunamadı'}, status=404)
    if action == 'delete':
        item.delete()
    elif kind == 'category':
        definitions.restore_category(item)
    else:
        if item.subcategory_id and item.subcategory.deleted_at is not None:
            item.subcategory = None
        item.deleted_at = None
        item.save(update_fields=['deleted_at', 'subcategory'])
    return JsonResponse({'success': True, 'trash_count': trash_count(user)})

# ── Error pages ──────────────────────────────────────────────
# API callers get JSON; people get the SafePass error page (never Django's
# debug pages, which expose code and variables).
def _error_response(request, status, message):
    if request.path.startswith('/api/'):
        return JsonResponse({'error': message}, status=status)
    try:
        # No context processors on purpose for 500s: they hit the DB, which may be the problem
        if status == 500:
            from django.template.loader import render_to_string
            html = render_to_string('error.html', {'code': status})
            return HttpResponse(html, status=status)
        return render(request, 'error.html', {'code': status}, status=status)
    except Exception:
        return HttpResponse(f'SafePass: {status}', status=status, content_type='text/plain; charset=utf-8')


def bad_request(request, exception=None):
    return _error_response(request, 400, 'Geçersiz istek')


def page_not_found(request, exception=None):
    return _error_response(request, 404, 'Bulunamadı')


def server_error(request):
    return _error_response(request, 500, 'Beklenmeyen bir hata oluştu')


def csrf_failure(request, reason=''):
    return _error_response(request, 403, 'Güvenlik doğrulaması başarısız. Sayfayı yenileyip tekrar deneyin.')
