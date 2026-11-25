"""Django settings for SafePass"""

import mimetypes
import os
from pathlib import Path
import secrets

# Python's type table doesn't always know this one (static/fonts)
mimetypes.add_type('font/woff2', '.woff2')

# Build paths
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get('SAFEPASS_DATA_DIR', str(Path.home() / ".safepass"))).expanduser()
# Only this user may read what SafePass creates (no effect on Windows, whose profile folder is private)
os.umask(0o077)
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Secret key
SECRET_KEY_FILE = DATA_DIR / "secret.key"
if SECRET_KEY_FILE.exists():
    SECRET_KEY = SECRET_KEY_FILE.read_text().strip()
else:
    SECRET_KEY = secrets.token_urlsafe(50)
    SECRET_KEY_FILE.write_text(SECRET_KEY)

# Debug mode is OFF by default: Django's debug pages show source code, URL
# patterns and local variables (which can include keys and passwords).
# Development only: set SAFEPASS_DEBUG=1.
DEBUG = os.environ.get('SAFEPASS_DEBUG', '0') == '1'

# Set by `safepass start` for the server it launches, so it can tell its own server from another
# program that took the port (views.api_launch_check). Removed from the environment right away.
LAUNCH_TOKEN = os.environ.pop('SAFEPASS_LAUNCH_TOKEN', '')

ALLOWED_HOSTS = ['localhost', '127.0.0.1']

# Application definition
INSTALLED_APPS = [
    'django.contrib.contenttypes',
    'django.contrib.auth',
    'django.contrib.sessions',
    'safepass',
]

MIDDLEWARE = [
    'safepass.middleware.WipeApiTrafficMiddleware',  # outermost: sees the final response
    'django.middleware.security.SecurityMiddleware',
    'safepass.middleware.LoopbackAddressMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'safepass.middleware.NoStoreMiddleware',
    'safepass.middleware.ContentSecurityPolicyMiddleware',
    'safepass.middleware.ServerMessageCodeMiddleware',
    'safepass.middleware.KeyDerivationBusyMiddleware',
    # Innermost, so its 401 still gets a translatable code from the one above
    'safepass.middleware.ApiKeyMiddleware',
]

ROOT_URLCONF = 'safepass.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'safepass.context_processors.version_context',
            ],
        },
    },
]

WSGI_APPLICATION = 'safepass.wsgi.application'

# Database
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': DATA_DIR / 'db.sqlite3',
        # Deleted rows are overwritten in the file instead of lingering until the next VACUUM
        'OPTIONS': {'init_command': 'PRAGMA secure_delete=ON;'},
    }
}

# Cache configuration for sessions
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'safepass-session-cache',
        'OPTIONS': {'MAX_ENTRIES': 2000},
    },
    # Request limits and sign-in lockout (safepass/ratelimit.py); kept apart so
    # their counters can never push sessions out of the cache
    'ratelimit': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'safepass-ratelimit',
        'OPTIONS': {'MAX_ENTRIES': 10000},
    },
}

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
        'OPTIONS': {'min_length': 8}
    },
]

# Internationalization
LANGUAGE_CODE = 'tr-tr'
TIME_ZONE = 'Europe/Istanbul'
USE_I18N = True
USE_TZ = True

# Largest request body: the 10 MB import limit in views.py, plus room for the JSON around it
DATA_UPLOAD_MAX_MEMORY_SIZE = 11 * 1024 * 1024

# Static files
STATIC_URL = '/static/'
STATICFILES_DIRS = [BASE_DIR / 'static']

# No CORS: the interface is served from the same origin as the API, so no
# other page (not even one on another localhost port) may read responses.

# CSRF: every state-changing request needs the token (sent by app.js).
# Same-origin requests pass Django's Origin check without a trusted list.
CSRF_FAILURE_VIEW = 'safepass.views.csrf_failure'

# Session settings
# Use cache backend so sessions are cleared on server restart
SESSION_ENGINE = 'safepass.session_store'  # the cache backend; a flush also wipes the data key (keystore.py)
SESSION_CACHE_ALIAS = 'default'
SESSION_COOKIE_AGE = 86400  # 24 hours
SESSION_SAVE_EVERY_REQUEST = False  # Performans için False - sadece değişiklik olduğunda kaydet
SESSION_TIMEOUT = 7 * 60  # default inactivity timeout (seconds); each user picks theirs on /settings
SESSION_EXPIRE_AT_BROWSER_CLOSE = True  # Session expires when browser closes
SESSION_COOKIE_SECURE = False  # Set to True in production with HTTPS
SESSION_COOKIE_HTTPONLY = True  # Prevent JavaScript access to session cookie
# Strict: also withheld when a page on another site navigates the browser to some local port
SESSION_COOKIE_SAMESITE = 'Strict'
# Own name: other local Django apps use "sessionid" on the same host
SESSION_COOKIE_NAME = 'safepass_session'

# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Custom user model
AUTH_USER_MODEL = 'safepass.User'
