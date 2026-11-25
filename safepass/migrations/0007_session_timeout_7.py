from django.db import migrations, models


def to_seven_minutes(apps, schema_editor):
    # 60 was only ever the default (the setting is new in 2.x), so move those accounts to the new default
    User = apps.get_model('safepass', 'User')
    User.objects.filter(session_timeout_minutes=60).update(session_timeout_minutes=7)


class Migration(migrations.Migration):

    dependencies = [
        ('safepass', '0006_passwordcard_trash'),
    ]

    operations = [
        migrations.AlterField(
            model_name='user',
            name='session_timeout_minutes',
            field=models.PositiveSmallIntegerField(default=7),
        ),
        migrations.RunPython(to_seven_minutes, migrations.RunPython.noop),
    ]
