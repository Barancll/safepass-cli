"""User-editable definitions: main categories, subcategories and quick-pick services.

Every account starts with the built-in set below (created on first use). Cards store the
category / subcategory slug, so renaming a definition never touches them. Deleting one sends
it to the trash: its cards fall back to Genel and are put back if it is restored.
"""

import secrets

from django.db import transaction
from django.db.models import Count
from django.utils import timezone

from .icons import icon_exists
from .models import Category, PasswordCard, Service

FALLBACK = 'genel'   # where cards go when their category is deleted; it cannot be deleted itself
NAME_MAX = 60
COLOR_RE_LEN = 7

# (slug, Turkish name for the HTML fallback, icon, colour, [(sub slug, Turkish name, icon), ...])
DEFAULT_CATEGORIES = [
    ('genel', 'Genel', 'folder', '#a855f7', [
        ('e-posta', 'E-Posta', 'mail'),
        ('sosyal-medya', 'Sosyal Medya', 'users'),
        ('alisveris', 'Alışveriş', 'cart'),
        ('forumlar-uyelikler', 'Forumlar & Üyelikler', 'message'),
    ]),
    ('finans', 'Finans', 'bank', '#f59e0b', [
        ('bankacilik', 'Bankacılık', 'bank'),
        ('kredi-kartlari', 'Kredi Kartları', 'card'),
        ('kripto-paralar', 'Kripto Paralar', 'coins'),
        ('faturalar', 'Faturalar', 'receipt'),
    ]),
    ('is-gelistirici', 'İş & Geliştirici', 'briefcase', '#3b82f6', [
        ('sirket-hesaplari', 'Şirket Hesapları', 'building'),
        ('sunucular-ssh', 'Sunucular & SSH', 'server'),
        ('veritabanlari', 'Veritabanları', 'database'),
        ('git-repolar', 'Git & Repolar', 'git'),
        ('api-lisanslar', 'API & Lisanslar', 'code'),
    ]),
    ('sistem-ag', 'Sistem & Ağ', 'wifi', '#ec4899', [
        ('wifi-sifreleri', 'Wi-Fi Şifreleri', 'wifi'),
        ('cihaz-pinleri', 'Cihaz Pinleri', 'phone'),
        ('modem-arayuzleri', 'Modem Arayüzleri', 'router'),
        ('yazilim-lisanslari', 'Yazılım Lisansları', 'award'),
    ]),
    ('kisisel', 'Kişisel', 'user', '#8b5cf6', [
        ('e-devlet-resmi-kurum', 'E-Devlet & Resmi Kurum', 'shield'),
        ('saglik', 'Sağlık', 'heart'),
        ('notlar-guvenli-dosyalar', 'Notlar & Güvenli Dosyalar', 'file-lock'),
    ]),
]
DEFAULT_NAMES = {slug: name for slug, name, *_rest in DEFAULT_CATEGORIES}
DEFAULT_NAMES.update({sub: name for *_head, subs in DEFAULT_CATEGORIES for sub, name, _icon in subs})

# (name, url, icon, subcategory slug)
DEFAULT_SERVICES = [
    ('Gmail', 'https://gmail.com', 'brand-gmail', 'e-posta'),
    ('Twitter', 'https://twitter.com', 'brand-twitter', 'sosyal-medya'),
    ('Facebook', 'https://facebook.com', 'brand-facebook', 'sosyal-medya'),
    ('Instagram', 'https://instagram.com', 'brand-instagram', 'sosyal-medya'),
    ('Netflix', 'https://netflix.com', 'brand-netflix', ''),
    ('GitHub', 'https://github.com', 'brand-github', 'git-repolar'),
    ('LinkedIn', 'https://linkedin.com', 'brand-linkedin', 'sosyal-medya'),
    ('Amazon', 'https://amazon.com', 'brand-amazon', 'alisveris'),
]

# Picker swatches for main categories (theme palette + a few more)
COLOR_SWATCHES = ['#a855f7', '#8b5cf6', '#3b82f6', '#0ea5e9', '#ec4899', '#ef4444', '#f97316', '#f59e0b', '#64748b']


# ── Seeding ────────────────────────────────────────────────────────────────

def ensure_defaults(user):
    """Give the account the built-in definitions the first time they are needed"""
    if Category.objects.filter(user=user).exists():
        return
    with transaction.atomic():
        subs_by_slug = {}
        for position, (slug, _name, icon, color, subs) in enumerate(DEFAULT_CATEGORIES):
            main = Category.objects.create(user=user, slug=slug, icon=icon, color=color, builtin=True, position=position)
            for sub_position, (sub_slug, _sub_name, sub_icon) in enumerate(subs):
                subs_by_slug[sub_slug] = Category.objects.create(
                    user=user, parent=main, slug=sub_slug, icon=sub_icon, builtin=True, position=sub_position)
        for position, (name, url, icon, sub_slug) in enumerate(DEFAULT_SERVICES):
            Service.objects.create(user=user, name=name, url=url, icon=icon, subcategory=subs_by_slug.get(sub_slug),
                                   builtin_key=icon, position=position)


# ── Reading ────────────────────────────────────────────────────────────────

def active_categories(user):
    return Category.objects.filter(user=user, deleted_at__isnull=True)


def label_key(category):
    """i18n key for a built-in definition that was never renamed ('' when it has its own name)"""
    if category.name or not category.builtin:
        return ''
    return ('sub.' if category.parent_id else 'cat.') + category.slug


def display_name(category):
    """Name for the HTML (Turkish for untouched built-ins; the browser swaps in the UI language)"""
    return category.name or DEFAULT_NAMES.get(category.slug, category.slug)


def _card_counts(user):
    by_main, by_sub = {}, {}
    rows = (PasswordCard.objects.filter(user=user).values('category', 'subcategory').annotate(n=Count('id')))
    for row in rows:
        main = (row['category'] or FALLBACK).lower()
        by_main[main] = by_main.get(main, 0) + row['n']
        if row['subcategory']:
            sub = row['subcategory'].lower()
            by_sub[sub] = by_sub.get(sub, 0) + row['n']
    return by_main, by_sub


def category_tree(user, with_counts=False, active_only=False, keep=()):
    """[{id, slug, name, label_key, icon, color, builtin, active, count, children: [...]}] for definitions not in
    the trash. active_only leaves out paused ones (and the subs of a paused main) for the card forms, except
    the slugs in keep (the card being edited may sit in a paused category)."""
    ensure_defaults(user)
    categories = list(active_categories(user))
    if active_only:
        keep = {str(k).lower() for k in keep if k}
        paused_mains = {c.id for c in categories if c.parent_id is None and not c.is_active and c.slug not in keep}
        categories = [c for c in categories if c.slug in keep or (c.is_active and c.parent_id not in paused_mains)]
    by_main, by_sub = _card_counts(user) if with_counts else ({}, {})
    mains = [c for c in categories if c.parent_id is None]
    children = {}
    for c in categories:
        if c.parent_id:
            children.setdefault(c.parent_id, []).append(c)

    def node(c, count):
        return {'id': c.id, 'slug': c.slug, 'name': display_name(c), 'label_key': label_key(c), 'icon': c.icon,
                'color': c.color, 'builtin': c.builtin, 'active': c.is_active, 'count': count}

    tree = []
    for main in mains:
        item = node(main, by_main.get(main.slug, 0))
        item['children'] = [node(sub, by_sub.get(sub.slug, 0)) for sub in children.get(main.id, [])]
        item['deletable'] = main.slug != FALLBACK
        tree.append(item)
    return tree


def services(user, active_only=False):
    """Quick-pick services; active_only for the new-card page (paused ones stay on the Definitions page)"""
    ensure_defaults(user)
    rows = Service.objects.filter(user=user, deleted_at__isnull=True).select_related('subcategory', 'subcategory__parent')
    if active_only:
        rows = rows.filter(is_active=True)
    out = []
    for s in rows:
        sub = s.subcategory if s.subcategory and s.subcategory.deleted_at is None else None
        out.append({'id': s.id, 'name': s.name, 'url': s.url, 'icon': s.icon, 'active': s.is_active, 'active': s.is_active,
                    'subcategory': sub.slug if sub else '', 'category': sub.parent.slug if sub and sub.parent else ''})
    return out


def lookup(user):
    """{slug: {...}} for every active main and sub, with the main's colour on subs too; used to draw cards"""
    table = {}
    for main in category_tree(user):
        entry = {k: main[k] for k in ('slug', 'name', 'label_key', 'icon', 'color')}
        table[main['slug']] = entry
        for sub in main['children']:
            table[sub['slug']] = {**{k: sub[k] for k in ('slug', 'name', 'label_key', 'icon')},
                                  'color': main['color'], 'main': main['slug']}
    return table


def main_slugs(user):
    return [c['slug'] for c in category_tree(user)]


# ── Validation ─────────────────────────────────────────────────────────────

def clean_name(value):
    name = ' '.join(str(value or '').split())
    return name[:NAME_MAX]


def clean_color(value):
    value = str(value or '').strip().lower()
    if len(value) == COLOR_RE_LEN and value[0] == '#' and all(ch in '0123456789abcdef' for ch in value[1:]):
        return value
    return ''


def clean_icon(value, default):
    value = str(value or '').strip()
    return value if icon_exists(value) else default


def new_slug(user):
    while True:
        slug = 'k-' + secrets.token_hex(3)
        if not Category.objects.filter(user=user, slug=slug).exists():
            return slug


# ── Changes ────────────────────────────────────────────────────────────────

def delete_category(category):
    """Send a definition to the trash; its cards fall back to Genel (remembered for a restore).
    Returns how many cards moved."""
    if category.parent_id is None and category.slug == FALLBACK:
        raise ValueError('fallback')
    now = timezone.now()
    with transaction.atomic():
        cards = PasswordCard.objects.filter(user=category.user)
        if category.parent_id is None:
            cards = cards.filter(category__iexact=category.slug)
        else:
            cards = cards.filter(subcategory__iexact=category.slug)
        moved = {str(card.id): [card.category or '', card.subcategory or ''] for card in cards}
        cards.update(category=FALLBACK, subcategory='')
        category.deleted_at = now
        category.moved_cards = moved
        category.save(update_fields=['deleted_at', 'moved_cards'])
        if category.parent_id is None:
            # Its subcategories go with it (and come back with it)
            category.children.filter(deleted_at__isnull=True).update(deleted_at=now)
    return len(moved)


def restore_category(category):
    """Bring a definition back; cards it moved return if they are still sitting in Genel untouched"""
    with transaction.atomic():
        if category.parent_id and category.parent.deleted_at is not None:
            restore_category(category.parent)
        deleted_at = category.deleted_at
        category.deleted_at = None
        moved = category.moved_cards or {}
        category.moved_cards = {}
        category.save(update_fields=['deleted_at', 'moved_cards'])
        if category.parent_id is None and deleted_at:
            category.children.filter(deleted_at=deleted_at).update(deleted_at=None)
        if moved:
            for card in PasswordCard.objects.filter(user=category.user, id__in=[int(i) for i in moved]):
                if (card.category or '') == FALLBACK and not card.subcategory:
                    card.category, card.subcategory = moved[str(card.id)]
                    card.save(update_fields=['category', 'subcategory'])


def trashed_definitions(user):
    """Deleted mains, and deleted subs whose main is still active (a deleted main lists its own subs)"""
    cats = (Category.objects.filter(user=user, deleted_at__isnull=False).select_related('parent')
            .order_by('-deleted_at'))
    items = []
    for c in cats:
        if c.parent_id and c.parent.deleted_at is not None:
            continue
        items.append({'kind': 'category', 'obj': c, 'name': display_name(c), 'label_key': label_key(c),
                      'icon': c.icon, 'color': c.color or (c.parent.color if c.parent else ''),
                      'is_sub': bool(c.parent_id), 'parent_name': display_name(c.parent) if c.parent_id else '',
                      'parent_label_key': label_key(c.parent) if c.parent_id else '',
                      'moved': len(c.moved_cards or {}), 'deleted_at': c.deleted_at})
    for s in Service.objects.filter(user=user, deleted_at__isnull=False).order_by('-deleted_at'):
        items.append({'kind': 'service', 'obj': s, 'name': s.name, 'label_key': '', 'icon': s.icon, 'color': '',
                      'is_sub': False, 'parent_name': '', 'parent_label_key': '', 'moved': 0, 'deleted_at': s.deleted_at})
    items.sort(key=lambda item: item['deleted_at'], reverse=True)
    return items


def purge_expired(user=None, days=7):
    """Definitions in the trash longer than `days` are removed for good"""
    from datetime import timedelta
    cutoff = timezone.now() - timedelta(days=days)
    cats = Category.objects.filter(deleted_at__lt=cutoff)
    servs = Service.objects.filter(deleted_at__lt=cutoff)
    if user is not None:
        cats, servs = cats.filter(user=user), servs.filter(user=user)
    servs.delete()
    # Subcategories first: deleting a main cascades, and a sub may outlive its main's record otherwise
    cats.exclude(parent__isnull=True).delete()
    cats.filter(parent__isnull=True).delete()
