from django.db import migrations, models


def drop_phrases(apps, schema_editor):
    """2.49.150 stored a typed phrase here; only "<shape>:<colour>" pictures are kept"""
    from safepass.pictures import valid
    User = apps.get_model('safepass', 'User')
    for user in User.objects.exclude(security_picture=''):
        if not valid(user.security_picture):
            user.security_picture = ''
            user.save(update_fields=['security_picture'])


class Migration(migrations.Migration):

    dependencies = [
        ('safepass', '0021_user_greeting'),
    ]

    operations = [
        migrations.RenameField(model_name='user', old_name='greeting', new_name='security_picture'),
        migrations.RunPython(drop_phrases, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='user',
            name='security_picture',
            field=models.CharField(blank=True, default='', max_length=30),
        ),
    ]
