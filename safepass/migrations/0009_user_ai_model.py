from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('safepass', '0008_user_password_max_age'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='ai_model',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
    ]
