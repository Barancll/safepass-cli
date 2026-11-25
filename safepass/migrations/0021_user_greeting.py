from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('safepass', '0020_trusteddevice'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='greeting',
            field=models.CharField(blank=True, default='', max_length=60),
        ),
    ]
