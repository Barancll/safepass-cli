#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import socket
import sys


def _exclusive_port():
    """Windows lets a socket opened with SO_REUSEADDR (Django's default) bind a port another
    program already listens on, and lets others bind beside it. The SafePass server asks for the
    port exclusively instead: it fails to start when the port is taken, and nobody can join it later."""
    if sys.platform != 'win32' or not hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
        return
    from django.core.management.commands import runserver
    from django.core.servers.basehttp import WSGIServer

    class ExclusiveWSGIServer(WSGIServer):
        def __init__(self, *args, **kwargs):
            kwargs['allow_reuse_address'] = False
            super().__init__(*args, **kwargs)

        def server_bind(self):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            super().server_bind()

    runserver.Command.server_cls = ExclusiveWSGIServer


def main():
    """Run administrative tasks."""
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'safepass.settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    argv = sys.argv
    if 'runserver' in argv and not any(a for a in argv if a.startswith('runserver') and ':' in a):
        idx = argv.index('runserver')
        # runserver komutundan sonra port yoksa ekle
        if len(argv) == idx + 1 or not argv[idx + 1].isdigit():
            argv.insert(idx + 1, '2025')
    if 'runserver' in argv:
        _exclusive_port()
    execute_from_command_line(argv)


if __name__ == '__main__':
    main()
