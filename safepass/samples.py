"""Sample cards for a new account, so the dashboard and the password list aren't empty on first sign-in.

They are ordinary cards (the user can edit or delete them). Titles and notes are written in the language
the user registered in; the Wi-Fi one is weak on purpose so the dashboard shows what a warning looks like.
"""

from . import vault
from .encryption import encrypt_data
from .generator import generate_password

WEAK_SAMPLE_PASSWORD = '12345678'

# lang → texts; 'tr' is the fallback
TEXTS = {
    'tr': {
        'bank': 'Örnek Banka', 'wifi': 'Ev Wi-Fi',
        'note': 'Örnek kayıt: dilediğiniz gibi düzenleyebilir ya da silebilirsiniz.',
        'weak_note': 'Örnek kayıt. Bu şifre bilerek zayıf bırakıldı; gösterge panelindeki uyarıları görebilmeniz için.',
    },
    'en': {
        'bank': 'Sample Bank', 'wifi': 'Home Wi-Fi',
        'note': 'Sample entry: edit or delete it as you like.',
        'weak_note': 'Sample entry. This password is weak on purpose, so you can see the warnings on the dashboard.',
    },
    'es': {
        'bank': 'Banco de ejemplo', 'wifi': 'Wi-Fi de casa',
        'note': 'Registro de ejemplo: puedes editarlo o eliminarlo cuando quieras.',
        'weak_note': 'Registro de ejemplo. Esta contraseña es débil a propósito, para que veas las advertencias del panel.',
    },
    'de': {
        'bank': 'Beispielbank', 'wifi': 'WLAN zu Hause',
        'note': 'Beispieleintrag: Sie können ihn beliebig bearbeiten oder löschen.',
        'weak_note': 'Beispieleintrag. Dieses Passwort ist absichtlich schwach, damit Sie die Warnungen im Dashboard sehen.',
    },
    'ru': {
        'bank': 'Пример банка', 'wifi': 'Домашний Wi-Fi',
        'note': 'Пример записи: её можно изменить или удалить.',
        'weak_note': 'Пример записи. Пароль специально слабый, чтобы вы увидели предупреждения на панели.',
    },
}


def create_sample_cards(user, data_key, lang='tr'):
    """Add the three sample cards to a new account; returns how many were made"""
    texts = TEXTS.get((lang or '').lower()[:2], TEXTS['tr'])
    samples = [
        ('Gmail', 'ornek@gmail.com', generate_password(16), 'https://gmail.com', texts['note'],
         'genel', 'e-posta'),
        (texts['bank'], '12345678901', generate_password(16), 'https://bank.example.com', texts['note'],
         'finans', 'bankacilik'),
        (texts['wifi'], 'EvAgi_5G', WEAK_SAMPLE_PASSWORD, '', texts['weak_note'],
         'sistem-ag', 'wifi-sifreleri'),
    ]
    for app_name, username, password, url, notes, category, subcategory in samples:
        vault.create_card(
            data_key, user=user, app_name=app_name, username=username, password_encrypted=encrypt_data(password, data_key),
            url=url or None, notes=notes, category=category, subcategory=subcategory)
    return len(samples)
