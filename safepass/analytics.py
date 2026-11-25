"""Vault analysis for the dashboard.

Nothing returned here contains a password: duplicates are grouped by a hash
computed in this module, and only card ids, app names and derived facts
(strength level, age, category) leave it.
"""

import hashlib
from datetime import timedelta

from django.utils import timezone

from . import vault
from .encryption import decrypt_data
from .generator import calculate_password_strength

MAIN_CATEGORIES = ('genel', 'finans', 'is-gelistirici', 'sistem-ag', 'kisisel')
DEFAULT_STALE_DAYS = 90   # used when the user has no setting (see User.password_max_age_days)
ATTENTION_LIMIT = 6    # rows in the "needs attention" list


def analyze_cards(user, cards, encryption_key):
    """One fact row per card, plus the duplicate groups.

    facts: [{'id', 'app_name', 'category', 'level', 'length', 'age_days', 'stale', 'group'}]
      level  'strong' | 'medium' | 'weak' | 'unreadable'
      group  index into groups when the password is shared, else None
    """
    now = timezone.now()
    # The user's reminder setting decides when a password is "ageing"; 0 turns it off
    stale_days = getattr(user, 'password_max_age_days', DEFAULT_STALE_DAYS)
    by_hash = {}
    facts = []
    for card in cards:
        category = (card.category or 'genel').lower()
        fact = {
            'id': card.id,
            'app_name': card.app_name,
            'category': category if category in MAIN_CATEGORIES else 'genel',
            'level': 'unreadable',
            'length': 0,
            'age_days': (now - card.updated_at).days if card.updated_at else 0,
            'stale': bool(stale_days and card.updated_at and card.updated_at < now - timedelta(days=stale_days)),
            'group': None,
        }
        try:
            password = decrypt_data(bytes(card.password_encrypted), encryption_key)
        except Exception:
            facts.append(fact)
            continue
        fact['level'] = calculate_password_strength(password)['strength']
        fact['length'] = len(password)
        by_hash.setdefault(hashlib.sha256(password.encode('utf-8')).hexdigest(), []).append(fact)
        facts.append(fact)

    groups = []
    for members in by_hash.values():
        if len(members) > 1:
            for fact in members:
                fact['group'] = len(groups)
            groups.append([fact['id'] for fact in members])
    return facts, groups, stale_days


def security_score(facts, groups):
    """Weighted quality (strong 100 / medium 60 / weak 20) minus penalties for reuse and weak passwords"""
    if not facts:
        return 100
    weights = {'strong': 100, 'medium': 60, 'weak': 20}
    readable = [f for f in facts if f['level'] in weights]
    base = sum(weights[f['level']] for f in readable) / len(readable) if readable else 0
    weak = sum(1 for f in readable if f['level'] == 'weak')
    return int(max(0, min(100, base - len(groups) * 10 - weak * 5)))


def get_dashboard_stats(user, cards, encryption_key):
    """Calculate dashboard statistics"""
    from .models import PasswordCard

    cards = vault.open_cards(cards, encryption_key)
    # Paused cards are listed on their own and left out of every figure below
    paused = sorted((c for c in cards if not c.is_active), key=lambda c: c.app_name.lower())
    facts, groups, stale_days = analyze_cards(user, [c for c in cards if c.is_active], encryption_key)
    total_cards = len(facts)
    trash_count = PasswordCard.all_objects.filter(user=user, deleted_at__isnull=False).count()
    count = lambda level: sum(1 for f in facts if f['level'] == level)
    strong, medium, weak, unreadable = count('strong'), count('medium'), count('weak'), count('unreadable')
    pct = lambda n: round(n * 100 / total_cards) if total_cards else 0

    categories = {key: 0 for key in MAIN_CATEGORIES}
    for fact in facts:
        categories[fact['category']] += 1

    # Cards to look at first: weak > reused > old
    attention = []
    for fact in facts:
        reasons = [name for name, hit in (('weak', fact['level'] == 'weak'), ('duplicate', fact['group'] is not None),
                                          ('stale', fact['stale'])) if hit]
        if reasons:
            attention.append({'id': fact['id'], 'app_name': fact['app_name'], 'reasons': reasons})
    order = {'weak': 0, 'duplicate': 1, 'stale': 2}
    attention.sort(key=lambda item: (order[item['reasons'][0]], -len(item['reasons']), item['app_name'].lower()))

    lengths = [f['length'] for f in facts if f['level'] != 'unreadable']
    names = {f['id']: f['app_name'] for f in facts}
    return {
        'total_cards': total_cards,
        'strong_count': strong,
        'medium_count': medium,
        'weak_count': weak,
        'unreadable_count': unreadable,
        # Shares of all cards, for the health bar and the tile captions
        'strong_pct': pct(strong),
        'medium_pct': pct(medium),
        'weak_pct': pct(weak),
        'duplicate_count': len(groups),
        'duplicate_card_count': sum(len(g) for g in groups),
        'duplicate_passwords': [{'apps': [names[i] for i in group], 'ids': group} for group in groups],
        'stale_count': sum(1 for f in facts if f['stale']),
        'stale_days': stale_days,
        'average_length': round(sum(lengths) / len(lengths), 1) if lengths else 0,
        # Largest first; pct = share of all cards (the water level of each tube)
        'categories': [{'key': key, 'count': n, 'pct': pct(n)}
                       for key, n in sorted(categories.items(), key=lambda kv: (-kv[1], MAIN_CATEGORIES.index(kv[0])))],
        'trash_count': trash_count,
        'attention': attention[:ATTENTION_LIMIT],
        'attention_total': len(attention),
        'attention_more': max(0, len(attention) - ATTENTION_LIMIT),
        'security_score': security_score(facts, groups),
        'paused_count': len(paused),
        'paused': [{'id': c.id, 'app_name': c.app_name} for c in paused[:ATTENTION_LIMIT]],
        'paused_more': max(0, len(paused) - ATTENTION_LIMIT),
    }
