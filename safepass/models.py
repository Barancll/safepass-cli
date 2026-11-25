"""Database models for SafePass"""

from django.db import models
from django.contrib.auth.models import AbstractUser


# Raise this when a release has something to tell people: everyone sees the stepped "what's new"
# tour once at their next visit (TOURS.whatsnew in tour.js). Bug-fix releases leave it alone.
WHATS_NEW_VERSION = '2.45'


class User(AbstractUser):
    """Extended user model with master password hash"""
    # Inactivity limits offered on the settings page (minutes)
    SESSION_TIMEOUT_CHOICES = (5, 7, 15, 30, 60, 120)
    # Seconds before a copied password is wiped from the clipboard; 0 = never
    CLIPBOARD_CLEAR_CHOICES = (10, 30, 60, 120, 0)
    # Days after which a password should be changed (reminder in the topbar); 0 = no reminder
    PASSWORD_MAX_AGE_CHOICES = (30, 60, 90, 180, 0)

    master_password_hash = models.CharField(max_length=256)
    # b'' (data key = derived from master password) or a wrapped key; see encryption.unlock_data_key
    encryption_key_encrypted = models.BinaryField()
    salt = models.BinaryField()
    # How the master password becomes a key ('' = old PBKDF2, until the next sign-in); see encryption.derive_key
    kdf = models.CharField(max_length=60, blank=True, default='')
    # The data key wrapped with the user's recovery key (b'' = none made yet); see encryption.py
    recovery_key_wrapped = models.BinaryField(default=b'', blank=True)
    # The WHATS_NEW_VERSION this user has already seen ('' = none: accounts from older versions)
    whats_new_seen = models.CharField(max_length=20, blank=True, default='')
    session_timeout_minutes = models.PositiveSmallIntegerField(default=7)
    clipboard_clear_seconds = models.PositiveSmallIntegerField(default=30)
    password_max_age_days = models.PositiveSmallIntegerField(default=90)
    # Ask PyPI about new versions (updates.py); on by default so security fixes reach people
    update_check_enabled = models.BooleanField(default=True)
    # Which data key the account has: 0 = possibly the <= 1.2.4 key (PBKDF2 of the master password,
    # stored in plaintext there), whatever its storage format; KEY_GENERATION = a random key made by
    # this version or later. Accounts below it move to a new key at their next sign-in (views.api_login).
    KEY_GENERATION = 1
    key_generation = models.PositiveSmallIntegerField(default=0)
    # "<shape>:<colour>" from pictures.py ('' = none): shown under the user name on the login page, only
    # in a browser `safepass start` opened (see launch.py), so a look-alike page on SafePass's port can't
    # know it. Not secret from this computer's own user.
    security_picture = models.CharField(max_length=30, blank=True, default='')

    class Meta:
        db_table = 'users'


class TrustedDevice(models.Model):
    """A browser the owner signed in from (see views.remember_device). It keeps the key itself in its
    localStorage; only a SHA-256 digest is stored. Sign-ins that carry it have their own lockout counter,
    so another program guessing at the account can't lock the owner out. All of an account's devices
    are forgotten when its master password is replaced."""
    MAX_PER_USER = 10

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='trusted_devices')
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'trusted_devices'

    def __str__(self):
        return f"{self.user_id} device {self.pk}"


class ActiveCardManager(models.Manager):
    """Cards that are not in the trash (the default for every normal query)"""

    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True)


class PasswordCard(models.Model):
    """Password card storing encrypted credentials"""
    # Deleted cards stay in the trash this long, then are removed for good
    TRASH_DAYS = 7
    # Stored encrypted in `sealed`, their own columns stay empty (see vault.py)
    PRIVATE_FIELDS = ('app_name', 'username', 'url', 'notes')

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='cards')
    app_name = models.CharField(max_length=100)
    username = models.CharField(max_length=100)
    password_encrypted = models.BinaryField()
    url = models.URLField(blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    # NULL only on cards from older versions, until their owner's next sign-in
    sealed = models.BinaryField(null=True, blank=True)
    category = models.CharField(max_length=100, blank=True, null=True)
    subcategory = models.CharField(max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # Set when the card is moved to the trash; NULL for active cards
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    # Paused by the user (an account not in use for a while): kept and listed, left out of the
    # dashboard figures and password-age reminders
    is_active = models.BooleanField(default=True)

    objects = ActiveCardManager()   # active cards only
    all_objects = models.Manager()  # including the trash (trash page, key rotation)
    
    class Meta:
        db_table = 'password_cards'

    def __str__(self):
        return f"card {self.pk}"

    def save(self, *args, **kwargs):
        # An opened card holds plaintext in these attributes; only vault.save_card may store it
        fields = kwargs.get('update_fields')
        if getattr(self, 'opened', False) and (fields is None or set(fields) & set(self.PRIVATE_FIELDS)):
            raise RuntimeError('Opened cards are saved with vault.save_card')
        super().save(*args, **kwargs)


class PasswordHistory(models.Model):
    """Password history for tracking changes"""
    card = models.ForeignKey(PasswordCard, on_delete=models.CASCADE, related_name='history')
    password_encrypted = models.BinaryField()
    changed_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'password_history'
        ordering = ['-changed_at']
    
    def __str__(self):
        return f"card {self.card_id} - {self.changed_at.strftime('%Y-%m-%d %H:%M')}"


def purge_expired_trash(user=None):
    """Permanently delete cards (and definitions) that have been in the trash longer than TRASH_DAYS"""
    from datetime import timedelta
    from django.utils import timezone
    from .definitions import purge_expired
    cutoff = timezone.now() - timedelta(days=PasswordCard.TRASH_DAYS)
    expired = PasswordCard.all_objects.filter(deleted_at__lt=cutoff)
    if user is not None:
        expired = expired.filter(user=user)
    purge_expired(user, PasswordCard.TRASH_DAYS)
    return expired.delete()[0]


class Notification(models.Model):
    """Something the user should know about (see notifications.py for the kinds and how they are made)"""
    KIND_STALE = 'stale'                  # a password older than the reminder setting
    KIND_FAILED_LOGIN = 'failed_login'    # wrong master password tried on this account
    KIND_MASTER_CHANGED = 'master_changed'
    KIND_TRASH_EXPIRING = 'trash_expiring'  # a trashed card is about to be deleted for good
    KIND_UPDATE = 'update'                # a newer SafePass is published

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications')
    kind = models.CharField(max_length=20)
    # One row per thing: a dismissed reminder must not come back until it is a new one
    key = models.CharField(max_length=100)
    card = models.ForeignKey(PasswordCard, on_delete=models.CASCADE, null=True, blank=True, related_name='+')
    params = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField()
    read_at = models.DateTimeField(null=True, blank=True)
    # Deleted by the user: hidden, but kept so it isn't made again
    dismissed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'notifications'
        ordering = ['-created_at', '-id']
        constraints = [models.UniqueConstraint(fields=['user', 'key'], name='notification_user_key')]
        indexes = [models.Index(fields=['user', 'dismissed_at'])]

    def __str__(self):
        return f"{self.user_id} {self.key}"


class RequestLimit(models.Model):
    """Escalating request limit kept in the database, so stopping and starting SafePass doesn't reset it
    (see ratelimit.escalating_limit). Times are Unix timestamps."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='request_limits')
    scope = models.CharField(max_length=30)
    stamps = models.JSONField(default=list, blank=True)   # recent allowed calls, inside the window
    strikes = models.PositiveIntegerField(default=0)      # times the limit was hit recently
    last_strike = models.FloatField(default=0)
    locked_until = models.FloatField(default=0)

    class Meta:
        db_table = 'request_limits'
        constraints = [models.UniqueConstraint(fields=['user', 'scope'], name='request_limit_user_scope')]

    def __str__(self):
        return f"{self.user_id} {self.scope}"


class Category(models.Model):
    """A main category (parent is None) or a subcategory, owned by one user (see definitions.py).
    Cards keep the slug in PasswordCard.category / .subcategory, so renaming never touches them.
    Built-in ones have no name of their own (shown through i18n cat.<slug> / sub.<slug>) until renamed."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='categories')
    parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name='children')
    slug = models.CharField(max_length=100)
    name = models.CharField(max_length=60, blank=True, default='')
    icon = models.CharField(max_length=40, default='folder')
    color = models.CharField(max_length=7, blank=True, default='')   # main categories only, #rrggbb
    builtin = models.BooleanField(default=False)
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    # In the trash: hidden everywhere; moved_cards remembers which cards fell back to Genel
    deleted_at = models.DateTimeField(null=True, blank=True)
    moved_cards = models.JSONField(default=dict, blank=True)  # {card_id: [category, subcategory]}
    # Paused: not offered when a card is added; cards already in it are untouched
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'categories'
        ordering = ['position', 'id']
        constraints = [models.UniqueConstraint(fields=['user', 'slug'], name='category_user_slug')]

    def __str__(self):
        return f"{self.user_id} {self.slug}"


class Service(models.Model):
    """A quick-pick service on the new-card page (fills the title, URL and optionally the category)"""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='services')
    name = models.CharField(max_length=60)
    url = models.CharField(max_length=200, blank=True, default='')
    icon = models.CharField(max_length=40, default='globe')
    subcategory = models.ForeignKey(Category, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    builtin_key = models.CharField(max_length=40, blank=True, default='')
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    # Paused: hidden from the quick picks on the new-card page
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'services'
        ordering = ['position', 'id']

    def __str__(self):
        return f"{self.user_id} {self.name}"
