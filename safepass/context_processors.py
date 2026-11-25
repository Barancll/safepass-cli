"""Context processors for SafePass"""

import time

from safepass import __version__
from . import definitions, notifications
from .models import User, PasswordCard, purge_expired_trash, WHATS_NEW_VERSION

# Expired trash is also purged while the app runs, at most once an hour per process
PURGE_INTERVAL_SECONDS = 3600
_last_purge = 0.0


def version_context(request):
    """Add version, the signed-in user, the trash count and unread notifications to all templates."""
    global _last_purge
    user = None
    trash_count = 0
    unread = 0
    user_id = request.session.get('user_id')
    if user_id:
        user = User.objects.filter(id=user_id).first()
    if user:
        now = time.monotonic()
        if now - _last_purge > PURGE_INTERVAL_SECONDS:
            _last_purge = now
            purge_expired_trash()
        trash_count = PasswordCard.all_objects.filter(user=user, deleted_at__isnull=False).count()
        trash_count += len(definitions.trashed_definitions(user))  # deleted categories / services too
        notifications.sync(user)  # reminders follow the vault (stale passwords, trash)
        unread = notifications.unread_count(user)

    return {
        'APP_VERSION': __version__,
        'SP_USER': user,
        'SP_TRASH_COUNT': trash_count,
        'SP_NOTIF_UNREAD': unread,
        'SP_SHOW_WHATS_NEW': bool(user) and user.whats_new_seen != WHATS_NEW_VERSION,
        'SP_HAS_RECOVERY_KEY': bool(user) and bool(user.recovery_key_wrapped),
    }
