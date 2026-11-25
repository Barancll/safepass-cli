"""HTTP middleware for SafePass"""

import hmac

from django.conf import settings
from django.http import HttpResponseRedirect, JsonResponse
from django.utils.cache import add_never_cache_headers


class WipeApiTrafficMiddleware:
    """Zero the raw bytes of API requests and responses once they are done with.

    API bodies carry master passwords (sign-in, export, …) and responses carry card passwords.
    Python frees memory without clearing it, so these bytes used to stay readable in the server
    process long after sign-out. The request body is wiped when the view has answered, the
    response body after the server has sent it (Django calls the closers then). Copies Python
    makes as text (the parsed JSON) can't be wiped; the README says so. Outermost, so it sees the
    final response."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if not request.path.startswith('/api/'):
            return response
        from .encryption import wipe
        body = getattr(request, '_body', None)
        if type(body) is bytes:
            wipe(body)
        if isinstance(response, JsonResponse):  # always built fresh, never a shared constant
            container = getattr(response, '_container', None)
            closers = getattr(response, '_resource_closers', None)
            if isinstance(container, list) and isinstance(closers, list):
                closers.append(lambda: wipe(*container))
        return response


class KeyDerivationBusyMiddleware:
    """All key-derivation slots stayed taken (encryption.KDF_CONCURRENCY): answer "busy, try again"
    instead of a server error. Nothing was changed by the request."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_exception(self, request, exception):
        from .encryption import KeyDerivationBusy
        if not isinstance(exception, KeyDerivationBusy):
            return None
        response = JsonResponse({'error': 'SafePass şu anda meşgul. Birkaç saniye sonra tekrar deneyin.', 'retry_after': 3},
                                status=503)
        response['Retry-After'] = '3'
        return response


class LoopbackAddressMiddleware:
    """Send `localhost` visitors to 127.0.0.1.

    `localhost` can also resolve to [::1], where another program on this computer could
    listen on the same port and pose as SafePass. 127.0.0.1 is the address SafePass
    itself listens on, so the browser only ever talks to the real server.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        host = request.get_host().rsplit(':', 1)[0]
        if host == 'localhost' and request.method in ('GET', 'HEAD'):
            return HttpResponseRedirect(f'http://127.0.0.1:{request.get_port()}{request.get_full_path()}')
        return self.get_response(request)


class ApiKeyMiddleware:
    """Signed-in API calls must carry the session's API key, not only the cookie.

    Browsers send cookies to every port of the same host, so another program listening
    on 127.0.0.1 could receive the session cookie and replay it. The API key is handed
    out in a response header when the session starts and kept in localStorage, which
    only pages of this exact origin (port included) can read; app.js adds it to every
    request. A request with the cookie but without the key ends the session.
    """

    HEADER = 'X-SafePass-Key'
    # These start or end a session themselves
    EXEMPT = {'/api/auth/login', '/api/auth/register', '/api/auth/recover', '/api/auth/logout',
              '/api/launch/claim', '/api/launch/status'}

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith('/api/') and request.path not in self.EXEMPT and request.session.get('user_id'):
            expected = request.session.get('api_key') or ''
            sent = request.headers.get(self.HEADER, '')
            if not expected or not hmac.compare_digest(sent.encode(), expected.encode()):
                request.session.flush()
                return JsonResponse({'error': 'Oturum açmanız gerekiyor', 'reason': 'ended'}, status=401)
        response = self.get_response(request)
        new_key = getattr(request, 'safepass_api_key', None)
        if new_key:
            response[self.HEADER] = new_key
        return response


class NoStoreMiddleware:
    """Forbid browsers from caching pages and API responses.

    Pages and API responses can contain decrypted passwords. Without
    `Cache-Control: no-store` the browser may write them to its disk cache
    and show them again from history (Back button) after logout.
    Static files are left cacheable.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if not request.path.startswith(settings.STATIC_URL):
            add_never_cache_headers(response)  # no-cache, no-store, must-revalidate, private, max-age=0
            response['Pragma'] = 'no-cache'
        return response


class ContentSecurityPolicyMiddleware:
    """Scripts, fonts and requests may only come from SafePass itself.

    If a value ever slipped into a page as markup, the browser would still refuse to run
    it or to send anything to another site. Inline styles stay allowed: pages and scripts
    set them (bar widths, colours) and they can't run code.
    """

    POLICY = '; '.join((
        "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
        "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'",
        "frame-ancestors 'none'",
    ))

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.setdefault('Content-Security-Policy', self.POLICY)
        return response


class ServerMessageCodeMiddleware:
    """Tag JSON `error` / `message` texts with a code the browser can translate.

    Adds `error_code` / `error_params` (and `message_code` / `message_params`);
    the Turkish text stays as the fallback. See safepass/messages.py.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        import json
        from .messages import code_for

        response = self.get_response(request)
        if not response.get('Content-Type', '').startswith('application/json') or getattr(response, 'streaming', False):
            return response
        try:
            data = json.loads(response.content)
        except ValueError:
            return response
        if not isinstance(data, dict):
            return response

        changed = False
        for field in ('error', 'message'):
            text = data.get(field)
            if isinstance(text, str) and f'{field}_code' not in data:
                code, params = code_for(text)
                if code:
                    data[f'{field}_code'] = code
                    if params:
                        data[f'{field}_params'] = params
                    changed = True
        if changed:
            response.content = json.dumps(data)
            if response.has_header('Content-Length'):
                response['Content-Length'] = str(len(response.content))
        return response
