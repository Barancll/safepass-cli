from django.db import migrations


class Migration(migrations.Migration):
    """The Ollama integration was dropped in favour of the built-in assistant"""

    dependencies = [
        ('safepass', '0009_user_ai_model'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='user',
            name='ai_model',
        ),
    ]
