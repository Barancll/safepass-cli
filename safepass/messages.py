"""Codes for the Turkish messages the server returns.

Views keep returning Turkish text; ServerMessageCodeMiddleware tags each JSON
`error` / `message` with a stable code (plus parameters for messages that
carry values) so the browser can show it in the user's language and re-render
it when the language changes. Translations live in static/js/modules/i18n.js
under `srv.<code>`.
"""

import re

# Exact Turkish text → code
EXACT = {
    'Oturum açmanız gerekiyor': 'login_required',
    'SafePass şu anda meşgul. Birkaç saniye sonra tekrar deneyin.': 'server_busy',
    'Oturum süresi dolmuş': 'session_expired',
    'Kullanıcı adı boş bırakılamaz': 'username_required',
    'Kullanıcı adı en az 3 karakter olmalı': 'username_min',
    'Kullanıcı adı en fazla 20 karakter olabilir': 'username_max',
    "SafePass'i terminalden açın: safepass start": 'launch_required',
    'Geçersiz görsel seçimi': 'picture_invalid',
    'Bu kullanıcı adı zaten kullanılıyor! Bu bilgisayarda daha önce aynı kullanıcı adıyla hesap oluşturmuş olabilirsiniz. Farklı bir kullanıcı adı deneyin veya mevcut hesabınızla giriş yapın': 'username_taken',
    'Kullanıcı adı veya ana şifre hatalı': 'bad_credentials',
    'Kullanıcı adı veya kurtarma anahtarı hatalı': 'recovery_failed',
    'Yedek parolası hatalı ya da dosya bozulmuş': 'backup_failed',
    'Yedek parolası ana şifreyle aynı olamaz': 'backup_password_same',
    'Şifre boş bırakılamaz': 'password_required',
    'Şifre en az 8 karakter olmalıdır': 'password_min',
    'Ana şifre boş bırakılamaz': 'master_required',
    'Ana şifre gerekli': 'master_needed',
    'Ana şifre en az 8 karakter olmalı': 'master_min',
    'Ana şifre en fazla 128 karakter olabilir': 'master_max',
    'Zayıf şifre! Büyük harf, küçük harf ve rakam içermelidir': 'master_weak',
    'Mevcut ana şifre yanlış': 'current_password_wrong',
    'Yanlış ana şifre': 'master_wrong',
    'Yeni ana şifre mevcut şifreyle aynı olamaz': 'new_password_same',
    'Şifre değiştirilemedi, verileriniz değişmedi. Tekrar deneyin.': 'change_password_failed',
    'Giriş başarılı': 'login_ok',
    'Kayıt başarılı': 'register_ok',
    'Çıkış yapıldı': 'logout_ok',
    'Şifre oluşturuldu': 'card_created',
    'Şifre güncellendi': 'card_updated',
    'Şifre bulunamadı': 'card_not_found',
    'Kart bulunamadı': 'card_not_found',
    'Uygulama adı ve şifre gerekli': 'card_required',
    'Web adresi http:// veya https:// ile başlamalı': 'url_scheme',
    'Geçersiz oturum süresi': 'invalid_session_timeout',
    'Geçersiz pano temizleme süresi': 'invalid_clipboard_clear',
    'Geçersiz hatırlatma süresi': 'invalid_max_age',
    'Geçersiz güncelleme ayarı': 'invalid_update_check',
    'Güncellenecek ayar yok': 'no_settings',
    'Dosya yüklenmedi': 'no_file',
    'Geçersiz JSON formatı': 'invalid_json',
    'Geçersiz dosya formatı': 'invalid_file_format',
    'Dosya UTF-8 metin değil. SafePass dışa aktarma dosyası (.json) seçin.': 'file_not_text',
    'Şifre verisi sağlanmadı': 'no_password_data',
    'İçe aktarma hatası. Tekrar deneyin.': 'import_failed',
    'Dışa aktarma hatası. Tekrar deneyin.': 'export_failed',
    'Hesap silinirken hata. Tekrar deneyin.': 'delete_account_failed',
    'Beklenmeyen bir hata oluştu': 'server_error',
    'Bulunamadı': 'not_found',
    'Geçersiz istek': 'bad_request',
    'Güvenlik doğrulaması başarısız. Sayfayı yenileyip tekrar deneyin.': 'csrf_failed',
    'Ad boş bırakılamaz': 'name_required',
    'Genel kategorisi silinemez': 'fallback_category',
    'Geçerli bir web adresi girin': 'invalid_url',
    'Kategori bulunamadı': 'category_not_found',
    'Servis bulunamadı': 'service_not_found',
}

# Field labels used in card_fields_error → stable field codes
FIELDS = {
    'Uygulama adı': 'app_name', 'Kullanıcı adı': 'username', 'Şifre': 'password', 'Web adresi': 'url',
    'Notlar': 'notes', 'Kategori': 'category', 'Alt kategori': 'subcategory',
}

# Messages that carry values → (pattern, code)
PATTERNS = [
    (re.compile(r'^(?P<field>' + '|'.join(map(re.escape, FIELDS)) + r') en fazla (?P<limit>\d+) karakter olabilir$'), 'field_too_long'),
    (re.compile(r'^Yedek parolası en az (?P<min>\d+) karakter olmalı$'), 'backup_password_short'),
    (re.compile(r'^Dosya boyutu çok büyük! Maksimum (?P<mb>\d+)MB yüklenebilir$'), 'file_too_large'),
    (re.compile(r'^(?P<imported>\d+) yeni şifre eklendi, (?P<updated>\d+) şifre güncellendi, (?P<skipped>\d+) atlandı$'), 'import_summary'),
    (re.compile(r'^(?P<username>.+) hesabı ve tüm verileri silindi$'), 'account_deleted'),
    (re.compile(r'^Çok fazla istek\. (?P<seconds>\d+) saniye sonra tekrar deneyin$'), 'rate_limited'),
    (re.compile(r'^Çok fazla hatalı deneme\. (?P<seconds>\d+) saniye sonra tekrar deneyin$'), 'too_many_attempts'),
]


def code_for(text):
    """(code, params) for a server message, or (None, None) if it is not catalogued"""
    if text in EXACT:
        return EXACT[text], {}
    for pattern, code in PATTERNS:
        match = pattern.match(text)
        if match:
            params = match.groupdict()
            if 'field' in params:
                params['field'] = FIELDS[params['field']]
            return code, params
    return None, None
