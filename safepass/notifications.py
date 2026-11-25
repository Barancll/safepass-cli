"""In-app notifications (topbar bell + /notifications page)

Two sources:
- Reminders follow the vault and are brought up to date by sync(): a stale
  password, a trashed card that is about to be deleted for good, or a newer
  SafePass. They go away by themselves once the reason is gone (password
  changed, card restored, SafePass updated).
- Events are recorded once when they happen: wrong master password tries,
  master password changed.

Deleting a notification only hides it (dismissed_at), so sync() doesn't make
the same reminder again. A password that gets old again later is a new
reminder (its key includes the card's last change).

The server sends kinds and numbers only; the browser words them in the
user's language.
"""

from datetime import timedelta

from django.utils import timezone

from . import updates, vault
from .models import Notification, PasswordCard

# Warn about a trashed card this long before it is deleted for good
TRASH_WARNING_HOURS = 24
# Most notifications sent to the browser at once
LIST_LIMIT = 200

REMINDER_KINDS = (Notification.KIND_STALE, Notification.KIND_TRASH_EXPIRING, Notification.KIND_UPDATE)


def visible(user):
    """Notifications the user hasn't deleted"""
    return Notification.objects.filter(user=user, dismissed_at__isnull=True)


def unread_count(user):
    return visible(user).filter(read_at__isnull=True).count()


def _stamp(moment):
    return int(moment.timestamp())


def sync(user):
    """Make the reminder notifications match the vault right now"""
    now = timezone.now()
    wanted = {}  # key -> Notification (unsaved)

    if user.password_max_age_days:
        age = timedelta(days=user.password_max_age_days)
        # Paused cards don't nag: the user isn't using that account for now
        for card in PasswordCard.objects.filter(user=user, is_active=True, updated_at__lt=now - age).only('id', 'updated_at'):
            key = f'stale:{card.id}:{_stamp(card.updated_at)}'
            wanted[key] = Notification(user=user, kind=Notification.KIND_STALE, key=key, card=card,
                                       created_at=card.updated_at + age)

    trash_life = timedelta(days=PasswordCard.TRASH_DAYS)
    warn_from = now - trash_life + timedelta(hours=TRASH_WARNING_HOURS)
    trashed = PasswordCard.all_objects.filter(user=user, deleted_at__isnull=False, deleted_at__lt=warn_from).only('id', 'deleted_at')
    for card in trashed:
        key = f'trash:{card.id}:{_stamp(card.deleted_at)}'
        wanted[key] = Notification(user=user, kind=Notification.KIND_TRASH_EXPIRING, key=key, card=card,
                                   created_at=card.deleted_at + trash_life - timedelta(hours=TRASH_WARNING_HOURS))

    if user.update_check_enabled:
        updates.check_if_due()
        latest = updates.latest_available()
        if latest:
            key = f'update:{latest}'  # one per version: closing it doesn't hide the next release
            wanted[key] = Notification(user=user, kind=Notification.KIND_UPDATE, key=key,
                                       params={'version': latest}, created_at=now)

    existing = set(Notification.objects.filter(user=user, kind__in=REMINDER_KINDS).values_list('key', flat=True))
    gone = existing - set(wanted)
    if gone:
        Notification.objects.filter(user=user, key__in=gone).delete()
    new = [n for key, n in wanted.items() if key not in existing]
    if new:
        Notification.objects.bulk_create(new, ignore_conflicts=True)  # another tab may have made them meanwhile


def record_failed_login(user):
    """A wrong master password for this account: one unread notice counts all tries until it is read"""
    now = timezone.now()
    notice = visible(user).filter(kind=Notification.KIND_FAILED_LOGIN, read_at__isnull=True).first()
    if notice:
        notice.params = {'count': int(notice.params.get('count', 0)) + 1}
        notice.created_at = now
        notice.save(update_fields=['params', 'created_at'])
    else:
        Notification.objects.create(user=user, kind=Notification.KIND_FAILED_LOGIN, key=f'failed:{now.timestamp()}',
                                    params={'count': 1}, created_at=now)


def record_master_changed(user):
    now = timezone.now()
    Notification.objects.create(user=user, kind=Notification.KIND_MASTER_CHANGED, key=f'master:{now.timestamp()}',
                                created_at=now)


def serialize(notice, now, key):
    data = {
        'id': notice.id,
        'kind': notice.kind,
        'read': notice.read_at is not None,
        'created_at': notice.created_at.isoformat(),
        'params': dict(notice.params or {}),
        'card': None,
    }
    card = notice.card
    if card is not None:
        data['card'] = {'id': card.id, 'name': vault.open_card(card, key).app_name}
        if notice.kind == Notification.KIND_STALE:
            data['params']['days'] = (now - card.updated_at).days
    return data


def listing(user, key):
    """Everything the bell and the page show; key: the session's data key, for card names"""
    now = timezone.now()
    items = [serialize(n, now, key) for n in visible(user).select_related('card')[:LIST_LIMIT]]
    return {'items': items, 'unread': unread_count(user), 'total': visible(user).count()}


def selected(user, data):
    """The user's notifications picked by a request: {"all": true} or {"ids": [1, 2]}; None if malformed"""
    if data.get('all') is True:
        return visible(user)
    ids = data.get('ids')
    # Plain ints in SQLite's range (a huge number would overflow the query)
    if not isinstance(ids, list) or not ids or len(ids) > LIST_LIMIT or not all(type(i) is int and 0 < i < 2 ** 63 for i in ids):
        return None
    return visible(user).filter(id__in=ids)
