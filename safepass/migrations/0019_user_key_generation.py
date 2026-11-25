from django.db import migrations, models


class Migration(migrations.Migration):
    """Every existing account starts at 0: its data key may still be the one from 1.2.4, even when
    a 2.x build already stored it wrapped. It gets a new random key at its next sign-in."""

    dependencies = [
        ('safepass', '0018_user_update_check_enabled'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='key_generation',
            field=models.PositiveSmallIntegerField(default=0),
        ),
    ]
