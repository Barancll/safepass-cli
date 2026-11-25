from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('safepass', '0007_session_timeout_7'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='password_max_age_days',
            field=models.PositiveSmallIntegerField(default=90),
        ),
    ]
