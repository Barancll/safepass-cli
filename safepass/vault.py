"""Private card fields: title, username, address and notes are stored encrypted.

They live in PasswordCard.sealed, encrypted with the same data key as the passwords, so
a copy of the database shows none of them without the master password. Their old
columns stay empty; views open a card, read the ordinary attributes and save it through
save_card. PasswordCard.save refuses to write an opened card any other way, so a
forgotten call fails loudly instead of putting plaintext back in the database.

Cards from older versions are sealed at the owner's next sign-in (seal_existing), the
first moment the key is available.
"""

import json

from .encryption import decrypt_data, encrypt_data
from .models import PasswordCard, PasswordHistory

PRIVATE_FIELDS = PasswordCard.PRIVATE_FIELDS
_EMPTY = {'app_name': '', 'username': '', 'url': None, 'notes': ''}


def _seal(card, key):
    values = {field: getattr(card, field) for field in PRIVATE_FIELDS}
    card.sealed = encrypt_data(json.dumps(values, ensure_ascii=False), key)
    for field, empty in _EMPTY.items():
        setattr(card, field, empty)
    return values


def open_card(card, key, strict=False):
    """Fill the card's private attributes from its sealed value (old unsealed cards already have them).
    A damaged value must not take the whole list down, so it reads as '?'; strict raises instead."""
    if card.sealed:
        try:
            values = json.loads(decrypt_data(bytes(card.sealed), key))
        except Exception:
            if strict:
                raise
            values = {'app_name': '?'}
        for field in PRIVATE_FIELDS:
            setattr(card, field, values.get(field, _EMPTY[field]))
    card.opened = True
    return card


def open_cards(cards, key):
    return [open_card(card, key) for card in cards]


def save_card(card, key):
    """Save a card with its private fields sealed; its attributes stay readable afterwards"""
    values = _seal(card, key)
    card.opened = False
    card.save()
    for field, value in values.items():
        setattr(card, field, value)
    card.opened = True
    return card


def create_card(key, **fields):
    return save_card(PasswordCard(**fields), key)


def seal_existing(user, key):
    """Encrypt the private fields of this user's cards from older versions; returns how many"""
    cards = list(PasswordCard.all_objects.filter(user=user, sealed__isnull=True))
    for card in cards:
        _seal(card, key)
    if cards:
        # bulk_update: sealing isn't a user edit, so updated_at (password age) must not move
        PasswordCard.all_objects.bulk_update(cards, ['sealed', *PRIVATE_FIELDS])
    return len(cards)


def rotate_data_key(user, old_key, new_key):
    """Re-encrypt everything of this user. Call inside a transaction; any failure must roll it all back."""
    # Trash included: a restored card must decrypt with the new key too
    cards = list(PasswordCard.all_objects.select_for_update().filter(user=user))
    for card in cards:
        open_card(card, old_key, strict=True)  # never re-seal a placeholder over real data
        _seal(card, new_key)
        card.opened = False
        card.password_encrypted = encrypt_data(decrypt_data(bytes(card.password_encrypted), old_key), new_key)
    PasswordCard.all_objects.bulk_update(cards, ['password_encrypted', 'sealed', *PRIVATE_FIELDS])

    history = list(PasswordHistory.objects.select_for_update().filter(card__user=user))
    for entry in history:
        entry.password_encrypted = encrypt_data(decrypt_data(bytes(entry.password_encrypted), old_key), new_key)
    PasswordHistory.objects.bulk_update(history, ['password_encrypted'])
    return len(cards) + len(history)
