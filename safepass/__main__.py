"""CLI entry point for SafePass"""

import sys
import os
import argparse
import re
import shutil
import sqlite3
import subprocess
import time
from pathlib import Path


def get_data_dir():
    """Get SafePass data directory (same rule as settings.DATA_DIR)"""
    data_dir = Path(os.environ.get('SAFEPASS_DATA_DIR', str(Path.home() / ".safepass"))).expanduser().resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def _windows_tool(*parts):
    """Full path of a Windows system program. A bare name ('netstat') is also looked up in the
    current folder, so a file planted in the folder the user runs safepass from would run instead."""
    return os.path.join(os.environ.get('SystemRoot', r'C:\Windows'), 'System32', *parts)


def _child_cwd():
    """Folder for the Python processes SafePass starts. `python -m` puts the current folder first on
    the module path, so starting them from wherever the user typed the command would let a planted
    json.py or django/ run inside the server that holds the vault keys. The data folder holds only
    SafePass's own files."""
    return str(get_data_dir())


def _child_env(**extra):
    """Environment for those processes: they find SafePass where this process loaded it from (in a
    pip install that is site-packages anyway; in a source checkout it is the checkout), never
    through the current folder."""
    package_root = str(Path(__file__).resolve().parent.parent)
    paths = [package_root] + [p for p in os.environ.get('PYTHONPATH', '').split(os.pathsep) if p]
    env = dict(os.environ, PYTHONPATH=os.pathsep.join(paths), **extra)
    # The children run inside the data folder (_child_cwd), so a relative SAFEPASS_DATA_DIR would
    # point them at a new, empty folder inside it: hand them the absolute path
    if 'SAFEPASS_DATA_DIR' in os.environ:
        env['SAFEPASS_DATA_DIR'] = str(get_data_dir())
    return env


def init_database(quiet=False):
    """Create the database or apply pending migrations (safe to run every start)"""
    _purge_old_snapshots()
    _strip_existing_snapshots()
    _snapshot_before_version_change()
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'safepass.settings')
    import django
    django.setup()
    
    from django.core.management import call_command
    
    if not quiet:
        print("🔧 Setting up the SafePass database...")
    call_command('migrate', '--run-syncdb', verbosity=0)

    # Cards left in the trash past the limit are removed before the app starts
    from safepass.models import purge_expired_trash
    purge_expired_trash()

    # Rewrite the file so freed pages (e.g. legacy plaintext keys cleared at
    # login) don't linger on disk
    from django.db import connection
    with connection.cursor() as cursor:
        cursor.execute('VACUUM')
    _write_data_version(_current_version())
    _make_private()
    if not quiet:
        print("✅ Database ready.")
        print(f"📁 Data folder: {get_data_dir()}")


# Everything SafePass itself puts in the data folder. Only these are ever deleted: the folder
# comes from SAFEPASS_DATA_DIR and could point anywhere.
DATA_FILES = ('db.sqlite3', 'db.sqlite3-journal', 'db.sqlite3-wal', 'db.sqlite3-shm', 'secret.key', 'safepass.pid', 'launch.key', 'safepass.log',
              'safepass.version', 'update-check.json', 'update-check.json.partial', 'port')
CONFIRM_WORD = 'delete'
ROLLBACK_WORD = 'rollback'

# ── Version snapshots ────────────────────────────────────────
# A newer version changes the database in ways older ones can't read, so a copy is taken right
# before that happens: backups/<version it belonged to>/db.sqlite3. `safepass rollback <version>`
# restores it. Versions <= 1.2.4 store each account's data key in plaintext; a copy never keeps
# it (_strip_legacy_keys), and `rollback` rebuilds it from the master password (_restore_legacy_keys).
# Those copies still hold that version's weakly protected data, which is why none is kept for long.
SNAPSHOT_DAYS = 30
_VERSION_FORMAT = re.compile(r'^\d+(\.\d+){1,3}$')


def _current_version():
    from safepass import __version__
    return __version__


def _backups_dir():
    return get_data_dir() / 'backups'


def _snapshot_path(version):
    return _backups_dir() / version / 'db.sqlite3'


def _write_data_version(version):
    (get_data_dir() / 'safepass.version').write_text(version)


def _previous_version():
    """The version that last used this database. Versions up to 1.2.4 left no note: their
    database is recognised by its migrations. None if it can't be anyone's rollback target."""
    try:
        return (get_data_dir() / 'safepass.version').read_text().strip() or None
    except OSError:
        pass
    connection = sqlite3.connect(get_data_dir() / 'db.sqlite3')
    try:
        names = [row[0] for row in connection.execute("select name from django_migrations where app='safepass'")]
    except sqlite3.Error:
        return None
    finally:
        connection.close()
    # 0004 and later were never published without this note: only development copies
    return '1.2.4' if names and max(names) <= '0003_z' else None


def _copy_database(source, target, strip_keys=False):
    """A consistent copy through SQLite itself, put in place only once it is complete.
    strip_keys: plaintext data keys are removed before the copy is put in place"""
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + '.partial')
    partial.unlink(missing_ok=True)
    origin = sqlite3.connect(source)
    copy = sqlite3.connect(partial)
    try:
        origin.backup(copy)
    finally:
        copy.close()
        origin.close()
    if strip_keys:
        try:
            _strip_legacy_keys(partial)
        except (OSError, sqlite3.Error):
            partial.unlink(missing_ok=True)
            raise
    os.replace(partial, target)


# Versions <= 1.2.4 keep each account's data key in plaintext in this column (32 bytes); newer ones
# keep it wrapped with the master password, or empty
_LEGACY_KEY_LENGTH = 32


def _strip_legacy_keys(database):
    """Empty every plaintext data key in this database file and rewrite the file, so the key bytes
    don't stay behind in free pages. Returns how many were removed. In 1.2.4 the key is always
    PBKDF2(master password, salt), so it can be rebuilt (_restore_legacy_keys) and nothing is lost."""
    connection = sqlite3.connect(database)
    try:
        try:
            count = connection.execute('select count(*) from users where length(encryption_key_encrypted) = ?',
                                       (_LEGACY_KEY_LENGTH,)).fetchone()[0]
        except sqlite3.OperationalError:  # no users table: nothing to remove
            return 0
        if count:
            connection.execute('PRAGMA secure_delete=ON')
            connection.execute('PRAGMA journal_mode=MEMORY')  # no journal file with the old pages on disk
            connection.execute("update users set encryption_key_encrypted = x'' where length(encryption_key_encrypted) = ?",
                               (_LEGACY_KEY_LENGTH,))
            connection.commit()
            connection.execute('VACUUM')
        return count
    finally:
        connection.close()


def _strip_existing_snapshots():
    """Copies made by earlier versions may still hold plaintext keys. Their date is kept, so the
    30-day expiry doesn't move."""
    if not _backups_dir().is_dir():
        return
    for snapshot in _backups_dir().glob('*/db.sqlite3'):
        stat = snapshot.stat()
        try:
            if _strip_legacy_keys(snapshot):
                os.utime(snapshot, (stat.st_atime, stat.st_mtime))
        except (OSError, sqlite3.Error) as error:
            print(f"⚠️  Could not clean the copy {snapshot}: {error}")


def _restore_legacy_keys(database, ask=None):
    """A restored <= 1.2.4 database reads the plaintext key the copy no longer has: rebuild it from
    each account's master password (checked against the stored hash, as 1.2.4 does). An account
    left out can't be opened in that version. Returns the names of the accounts left out."""
    import getpass
    import hashlib
    ask = ask or (lambda prompt: getpass.getpass(prompt))
    connection = sqlite3.connect(database)
    try:
        columns = {row[1] for row in connection.execute('PRAGMA table_info(users)')}
        if not columns or 'kdf' in columns:
            return []  # a newer version: it rebuilds an empty key from the master password itself
        rows = connection.execute("select id, username, salt, master_password_hash from users "
                                  "where length(encryption_key_encrypted) = 0").fetchall()
        if rows:
            print("🔑 This version needs each account's master password once, to open its data.")
            print("   Press Enter to skip an account (it can't be opened in that version).")
        skipped = []
        for user_id, username, salt, stored_hash in rows:
            unlocked = False
            for _ in range(3):
                password = ask(f"   Master password for '{username}': ")
                if not password:
                    break
                key = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes(salt), 100000, _LEGACY_KEY_LENGTH)
                if hashlib.sha256(key).hexdigest() == stored_hash:
                    connection.execute('update users set encryption_key_encrypted = ? where id = ?', (key, user_id))
                    connection.commit()
                    print("   ✅ Unlocked.")
                    unlocked = True
                    break
                print("   ❌ Wrong master password.")
            if not unlocked:
                skipped.append(username)
        return skipped
    finally:
        connection.close()


def _snapshot_before_version_change():
    database = get_data_dir() / 'db.sqlite3'
    if not database.exists():
        return
    previous = _previous_version()
    if previous is None or previous == _current_version():
        return
    try:
        _copy_database(database, _snapshot_path(previous), strip_keys=True)
    except (OSError, sqlite3.Error) as error:
        # Without the copy there is no way back, so nothing may change yet
        print(f"❌ Could not copy your data before updating: {error}")
        print("   Your data was not changed. Make sure there is free disk space and try again.")
        sys.exit(1)
    print(f"📦 Data from version {previous} is kept for {SNAPSHOT_DAYS} days. To go back: safepass rollback {previous}")


def _snapshots():
    """{version: file} for the copies that can be restored"""
    if not _backups_dir().is_dir():
        return {}
    found = {}
    for folder in _backups_dir().iterdir():
        if _VERSION_FORMAT.match(folder.name) and (folder / 'db.sqlite3').is_file():
            found[folder.name] = folder / 'db.sqlite3'
    return found


def _purge_old_snapshots():
    """Copies expire: they may hold old, weakly protected data"""
    if not _backups_dir().is_dir():
        return
    limit = time.time() - SNAPSHOT_DAYS * 86400
    for snapshot in _backups_dir().glob('*/db.sqlite3'):
        if snapshot.stat().st_mtime < limit:
            _remove_snapshot_folder(snapshot.parent)


def _remove_snapshot_folder(folder):
    """Only the file SafePass put there; a folder with anything else in it stays"""
    (folder / 'db.sqlite3').unlink(missing_ok=True)
    (folder / 'db.sqlite3.partial').unlink(missing_ok=True)
    try:
        folder.rmdir()
    except OSError:
        pass


def _delete_snapshots():
    if not _backups_dir().is_dir():
        return
    for folder in list(_backups_dir().iterdir()):
        if folder.is_dir():
            _remove_snapshot_folder(folder)
    try:
        _backups_dir().rmdir()
    except OSError:
        pass


def _days_left(snapshot):
    return max(1, SNAPSHOT_DAYS - int((time.time() - snapshot.stat().st_mtime) / 86400))


def _list_snapshots(snapshots):
    if not snapshots:
        print("ℹ️  No version to go back to. A copy of a version is made when you update from it and")
        print(f"   kept for {SNAPSHOT_DAYS} days.")
        return
    print("Versions you can go back to:")
    for version, snapshot in sorted(snapshots.items()):
        print(f"   {version}  ({_days_left(snapshot)} days left)")
    print("Usage: safepass rollback <version>")


def rollback(version):
    """Go back to a version this computer has used. Installs it first: if that fails, no data has changed."""
    _purge_old_snapshots()
    snapshots = _snapshots()
    if not version:
        _list_snapshots(snapshots)
        return True
    if version not in snapshots:
        print(f"❌ No copy of version {version}.")
        _list_snapshots(snapshots)
        return False

    current = _current_version()
    data_dir = get_data_dir()
    database = data_dir / 'db.sqlite3'
    snapshot = snapshots[version]
    # Going to the running version only restores data, e.g. what was set aside by an earlier rollback
    aside = _backups_dir() / (f'{current}-once' if version == current else current) / 'db.sqlite3'

    print(f"⚠️  SafePass {current} → {version}")
    print(f"📁 Folder: {data_dir}")
    print(f"   Copy made on: {time.strftime('%Y-%m-%d %H:%M', time.localtime(snapshot.stat().st_mtime))}")
    print("   Entries you added or changed after that date will not appear in that version.")
    if database.exists():
        print(f"   Your current data is not deleted; it is kept for {SNAPSHOT_DAYS} days at: {aside}")
    if input(f"Type '{ROLLBACK_WORD}' to confirm: ").strip().lower() != ROLLBACK_WORD:
        print("❌ Cancelled.")
        return False

    _stop_own_server()
    if version != current:
        print(f"📦 Installing SafePass {version}...")
        try:
            subprocess.check_call([sys.executable, '-m', 'pip', 'install', f'safepass-cli=={version}'], cwd=_child_cwd())
        except (subprocess.CalledProcessError, OSError):
            print(f"❌ Could not install {version} (check your internet connection). Your data was not changed.")
            return False

    try:
        if database.exists():
            _copy_database(database, aside)
        _copy_database(snapshot, database)
    except (OSError, sqlite3.Error) as error:
        print(f"❌ Could not restore your data: {error}")
        print(f"   The copy is still at: {snapshot}")
        print("   If SafePass is open somewhere else, close it and run the same command again.")
        return False
    for leftover in ('db.sqlite3-journal', 'db.sqlite3-wal', 'db.sqlite3-shm'):
        (data_dir / leftover).unlink(missing_ok=True)
    try:
        skipped = _restore_legacy_keys(database)
    except sqlite3.Error as error:
        print(f"❌ Could not prepare your accounts for {version}: {error}")
        skipped = []
    if skipped:
        print(f"⚠️  Not unlocked: {', '.join(skipped)}. To use these accounts, go back with: safepass update")
    _write_data_version(version)

    # The restored version prepares its own database: an older one may need a step
    subprocess.run([sys.executable, '-m', 'safepass', 'init'], cwd=data_dir, env=_child_env(), stdout=subprocess.DEVNULL, check=False)
    print(f"✅ Back on SafePass {version}. To start it: safepass start")
    if database.exists() and version != current:
        print(f"   To undo this: safepass update, then safepass rollback {current}")
    return True


def _make_private():
    """Data from older versions may be readable by other users (no effect on Windows)"""
    data_dir = get_data_dir()
    for path, mode in [(data_dir, 0o700)] + [(data_dir / name, 0o600) for name in DATA_FILES]:
        try:
            os.chmod(path, mode)
        except OSError:
            pass


# Versions up to 2.50.152 always used this port. Any program on the computer could take it while
# SafePass was stopped and show a fake sign-in page at the very address the user had bookmarked.
LEGACY_PORT = 2025
# Each installation now picks its own port once, at random, and keeps it in the data folder: a
# program that wants to pose as SafePass has to know this computer's port first. The range stays
# below the ports systems hand out on their own (Windows from 49152, Linux from 32768).
PORT_RANGE = (20000, 32000)


def _port_file():
    return get_data_dir() / "port"


def _read_install_port():
    try:
        port = int(_port_file().read_text().strip())
    except (OSError, ValueError):
        return None
    return port if 1024 <= port <= 65535 else None


def install_port():
    """This installation's port: read from the data folder, or chosen now (a free one) and saved"""
    port = _read_install_port()
    if port:
        return port
    import secrets
    candidates = [PORT_RANGE[0] + secrets.randbelow(PORT_RANGE[1] - PORT_RANGE[0]) for _ in range(50)]
    port = next((p for p in candidates if not _port_open(p)), candidates[0])
    data_dir = get_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    _port_file().write_text(f'{port}\n')
    _make_private()
    return port


def _pid_file():
    return get_data_dir() / "safepass.pid"


def _log_file():
    return get_data_dir() / "safepass.log"


def _read_pid_file():
    """(pid, port) from the pid file; older versions stored only the pid"""
    try:
        text = _pid_file().read_text().strip()
    except OSError:
        return None, None
    import json
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return int(data['pid']), int(data.get('port', LEGACY_PORT))
        return int(data), None
    except (ValueError, KeyError, TypeError):
        return None, None


def _write_pid_file(pid, port):
    import json
    _pid_file().write_text(json.dumps({'pid': pid, 'port': port}))


def _remove_pid_file():
    for path in (_pid_file(), _launch_key_file()):
        try:
            path.unlink()
        except OSError:
            pass


def _launch_key_file():
    # The running server's launch secret, so a later `start` can prove it and open a sign-in link
    return get_data_dir() / "launch.key"


def _save_launch_key(token):
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, 'O_BINARY', 0)
    with os.fdopen(os.open(_launch_key_file(), flags, 0o600), 'w') as handle:
        handle.write(token)


def _read_launch_key():
    try:
        return _launch_key_file().read_text().strip() or None
    except OSError:
        return None


def _command_line(pid):
    """Command line of a running process, or None if it is not running"""
    import subprocess
    if sys.platform == 'win32':
        result = subprocess.run(
            [_windows_tool('WindowsPowerShell', 'v1.0', 'powershell.exe'), '-NoProfile', '-NonInteractive', '-Command',
             f'(Get-CimInstance Win32_Process -Filter "ProcessId={int(pid)}").CommandLine'],
            capture_output=True, text=True, errors='replace')
        return result.stdout.strip() or None
    try:
        with open(f'/proc/{int(pid)}/cmdline', 'rb') as f:
            return f.read().replace(b'\0', b' ').decode(errors='replace').strip() or None
    except OSError:
        result = subprocess.run(['ps', '-o', 'args=', '-p', str(int(pid))], capture_output=True, text=True)
        return result.stdout.strip() or None


def _is_safepass_server(pid):
    """True only for a SafePass web server, so `stop` never kills an unrelated process"""
    command = _command_line(pid) if pid else None
    return bool(command) and 'safepass' in command.lower() and 'runserver' in command


def _listening_pid(port):
    """PID of the process listening on 127.0.0.1:<port>, if any"""
    import subprocess
    if sys.platform == 'win32':
        result = subprocess.run([_windows_tool('netstat.exe'), '-ano', '-p', 'TCP'], capture_output=True, text=True, errors='replace')
        for line in result.stdout.splitlines():
            parts = line.split()
            # Proto, Local, Foreign, State (localised, e.g. LISTENING / DİNLİYOR), PID
            if len(parts) == 5 and parts[1].endswith(f':{port}') and parts[2].endswith(':0'):
                return int(parts[4])
        return None
    try:
        result = subprocess.run(['lsof', '-t', f'-iTCP:{port}', '-sTCP:LISTEN'], capture_output=True, text=True)
    except FileNotFoundError:
        return None
    pids = [int(p) for p in result.stdout.split() if p.isdigit()]
    return pids[0] if pids else None


def _port_open(port):
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(('127.0.0.1', port)) == 0


def find_running_server(port=None):
    """(pid, port) of the running SafePass server, found from the pid file or, failing that, the port"""
    pid, saved_port = _read_pid_file()
    if pid:
        if not _is_safepass_server(pid):
            _remove_pid_file()  # stale: that process is gone (or the PID now belongs to something else)
        elif not port or not saved_port or saved_port == port:
            return pid, saved_port or port or LEGACY_PORT  # a pid without a port: an old version, on 2025
    # An explicit port means only that port; otherwise the last known one, then this installation's.
    # Never 2025 on a guess: a server of this folder from an old version is found by its pid file
    # above, and anything else there belongs to another SafePass (another folder or user).
    candidates = (port,) if port else (saved_port, _read_install_port())
    for candidate in dict.fromkeys(p for p in candidates if p):
        found = _listening_pid(candidate)
        if found and _is_safepass_server(found):
            return found, candidate
    return None, None


def _kill(pid):
    import subprocess
    if sys.platform == 'win32':
        # /T also ends child processes (older versions ran Django's auto-reloader)
        subprocess.run([_windows_tool('taskkill.exe'), '/F', '/T', '/PID', str(pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        import signal
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


def _server_command(port):
    # --noreload: one process, so the PID we record is the server itself
    return [sys.executable, '-m', 'safepass.manage', 'runserver', str(port), '--noreload']


LAUNCH_TOKEN_ENV = 'SAFEPASS_LAUNCH_TOKEN'


def _launch_proof(port, token):
    """True only when the server on 127.0.0.1:<port> is the one started with this token: it must answer
    a fresh random challenge with HMAC(token, challenge). Any other program that took the port can't,
    so `start` never sends the user to it. Plain http.client: no proxy settings are applied."""
    import hashlib
    import hmac
    import http.client
    import json
    import secrets
    challenge = secrets.token_hex(16)
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
    try:
        connection.request('GET', f'/api/launch-check?c={challenge}')
        response = connection.getresponse()
        proof = json.loads(response.read(4096)).get('proof') if response.status == 200 else None
    except (OSError, ValueError, http.client.HTTPException, AttributeError):
        return False
    finally:
        connection.close()
    expected = hmac.new(token.encode(), challenge.encode(), hashlib.sha256).hexdigest()
    return isinstance(proof, str) and hmac.compare_digest(proof, expected)


def _wait_until_ready(process, port, token, seconds=30):
    """'ready' (our server answers with the launch proof), 'exited' (the server stopped),
    'impostor' (something else answers on the port) or 'slow' (nothing answered in time)"""
    import time
    deadline = time.time() + seconds
    answered = False
    while time.time() < deadline:
        if process.poll() is not None:
            return 'exited'
        if _port_open(port):
            if _launch_proof(port, token):
                return 'ready'
            answered = True
        time.sleep(0.25)
    return 'impostor' if answered else 'slow'


def _sign_in_link(port, token):
    """A one-time address that lets this browser show the sign-in forms (see safepass/launch.py)"""
    import hashlib
    import hmac
    import secrets
    import time
    stamp, nonce = str(int(time.time())), secrets.token_hex(16)
    mac = hmac.new(token.encode(), f'open:{stamp}.{nonce}'.encode(), hashlib.sha256).hexdigest()
    return f'http://127.0.0.1:{port}/auth/login#launch={stamp}.{nonce}.{mac}'


def _open_sign_in(port, token, browser=True):
    """Open the browser on a fresh sign-in link; the link is printed too, for when no browser opens"""
    link = _sign_in_link(port, token)
    opened = False
    if browser:
        import webbrowser
        try:
            opened = webbrowser.open(link)
        except Exception:
            opened = False
    if opened:
        print("🌐 Your browser was opened to sign in.")
    print(f"🔗 Sign-in link (works once, for 2 minutes): {link}")
    print("   SafePass asks for your master password only in a window opened this way.")
    print(f"   Later, in the same run, http://127.0.0.1:{port} works in that browser too.")


def _report_port_taken(port):
    print(f"❌ Another program is listening on port {port}, so SafePass was not started there.")
    print("   Don't enter your master password on that address.")
    print(f"   Try another port: safepass start --port {port + 1}")


def start_server(port=None, foreground=False, browser=True):
    """Start the web server in the background and give the terminal back.
    port None = this installation's own port (install_port)."""
    import subprocess
    import time

    # An old server still running (started before installation ports) is found on its own port first
    pid, running_port = find_running_server(port)
    if not pid and port is None:
        port = install_port()
    port = port or running_port
    if pid:
        print(f"ℹ️  SafePass is already running (PID: {pid})")
        token = _read_launch_key()
        if token and _launch_proof(running_port, token):
            _open_sign_in(running_port, token, browser)
            return True
        print("❌ The running server can't be verified (it was started by an older version, or its files were changed).")
        print("   Restart it: safepass stop, then safepass start")
        return False
    if _port_open(port):
        print(f"❌ Port {port} is used by another application, so SafePass was not started.")
        print("   Don't enter your master password on that address.")
        print(f"   Try another port: safepass start --port {port + 1}")
        return False

    # Create the DB on first run; afterwards apply migrations shipped by updates
    db_file = get_data_dir() / "db.sqlite3"
    init_database(quiet=db_file.exists())

    import secrets
    token = secrets.token_urlsafe(32)  # only the server started here gets it (see _launch_proof)

    if foreground:
        process = subprocess.Popen(_server_command(port), cwd=_child_cwd(), env=_child_env(**{LAUNCH_TOKEN_ENV: token}))
        _write_pid_file(process.pid, port)
        _save_launch_key(token)
        try:
            state = _wait_until_ready(process, port, token)
            if state != 'ready':
                _kill(process.pid)
                if state == 'impostor' or (state == 'exited' and _port_open(port)):
                    _report_port_taken(port)
                else:
                    print("❌ SafePass could not start.")
                return False
            print("🚀 SafePass started.")
            _open_sign_in(port, token, browser)
            print("⏹️  To stop: Ctrl+C\n")
            process.wait()
        except KeyboardInterrupt:
            _kill(process.pid)
            print("\n👋 SafePass stopped.")
        finally:
            _remove_pid_file()
        return True

    print("🚀 Starting SafePass...")
    log = open(_log_file(), 'w', encoding='utf-8', errors='replace')
    options = {}
    if sys.platform == 'win32':
        # Own process group, no console: keeps running after this terminal closes
        options['creationflags'] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    else:
        options['start_new_session'] = True
    env = _child_env(PYTHONIOENCODING='utf-8', PYTHONUNBUFFERED='1', **{LAUNCH_TOKEN_ENV: token})
    process = subprocess.Popen(_server_command(port), stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                               env=env, close_fds=True, cwd=_child_cwd(), **options)
    log.close()
    _write_pid_file(process.pid, port)
    _save_launch_key(token)

    # Ready only when the listener proves it is the server started here, not just anything on the port
    state = _wait_until_ready(process, port, token)
    if state == 'ready':
        # Record the process that actually listens (a venv's python.exe is only a launcher)
        listener = _listening_pid(port)
        if listener and listener != process.pid and _is_safepass_server(listener):
            _write_pid_file(listener, port)
        print("✅ SafePass is running.")
        _open_sign_in(port, token, browser)
        print("⏹️  To stop: safepass stop")
        return True
    if state == 'impostor' or (state == 'exited' and _port_open(port)):
        _kill(process.pid)
        _remove_pid_file()
        _report_port_taken(port)
        return False
    if state == 'exited':
        _remove_pid_file()
        print("❌ SafePass could not start. Details:")
        try:
            print("   " + "\n   ".join(_log_file().read_text(encoding='utf-8', errors='replace').strip().splitlines()[-8:]))
        except OSError:
            pass
        return False
    print("⚠️  SafePass started but is not responding yet. Run safepass start again in a few seconds to sign in.")
    print(f"   If the problem continues, check the log file: {_log_file()}")
    return True


def stop_server(port=None):
    """Stop the running SafePass server, whichever terminal started it"""
    import time

    pid, running_port = find_running_server(port)
    if not pid:
        print("ℹ️  SafePass is not running.")
        return False

    _kill(pid)
    deadline = time.time() + 10
    while time.time() < deadline and (_command_line(pid) or _port_open(running_port)):
        time.sleep(0.25)
    _remove_pid_file()
    if _port_open(running_port) and _is_safepass_server(_listening_pid(running_port)):
        print(f"❌ Could not stop SafePass (PID: {pid}).")
        return False
    print("✅ SafePass stopped.")
    return True


def update_server():
    """Update SafePass to the latest version"""
    import subprocess
    
    print("🔄 Updating SafePass...")
    try:
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--upgrade', 'safepass-cli'], cwd=_child_cwd())
        print("✅ SafePass updated.")
    except subprocess.CalledProcessError as e:
        print(f"❌ Update failed: {e}")


def _confirm_delete(data_dir, warning):
    """Show exactly what will go and ask for the full word; a stray 'y' must not erase a vault"""
    found = [name for name in DATA_FILES if (data_dir / name).exists()]
    if not found:
        print(f"ℹ️  No data found to delete: {data_dir}")
        return None
    print(f"⚠️  WARNING: {warning}")
    print(f"📁 Folder: {data_dir}")
    for name in found:
        print(f"   - {name}")
    if _backups_dir().is_dir():
        print("   - backups (copies from earlier versions)")
    if input(f"Type '{CONFIRM_WORD}' to confirm: ").strip().lower() != CONFIRM_WORD:
        print("❌ Cancelled.")
        return None
    return found


def _stop_own_server():
    """Stop the server using this data folder (only via its own pid file, so another SafePass
    on this computer isn't touched); on Windows it would keep the files open"""
    import time
    pid, _ = _read_pid_file()
    if pid and _is_safepass_server(pid):
        print("⏹️  Stopping the running server...")
        _kill(pid)
        deadline = time.time() + 10
        while time.time() < deadline and _command_line(pid):
            time.sleep(0.25)


def _delete_files(data_dir, names):
    """True if every file went; a file still in use is reported, not silently left"""
    failed = []
    for name in names:
        try:
            (data_dir / name).unlink(missing_ok=True)
        except OSError:
            failed.append(name)
    if failed:
        print(f"❌ Could not delete: {', '.join(failed)}. If SafePass is open somewhere else, close it and try again.")
    return not failed


def reset_data():
    """Delete the vault and start with an empty one (the secret key stays)"""
    data_dir = get_data_dir()
    found = _confirm_delete(data_dir, "ALL YOUR PASSWORDS WILL BE DELETED and an empty vault created. This cannot be undone!")
    if not found:
        return
    _stop_own_server()
    if _delete_files(data_dir, [name for name in found if name.startswith('db.sqlite3')]):
        _delete_snapshots()  # copies of what was just erased must not outlive it
        print("✅ All data deleted.")
        init_database()


def clean_data():
    """Remove everything SafePass stored; anything else in the folder is left alone"""
    data_dir = get_data_dir()
    found = _confirm_delete(data_dir, "ALL YOUR PASSWORDS AND SAFEPASS FILES WILL BE DELETED. This cannot be undone!")
    if not found:
        return
    _stop_own_server()
    if not _delete_files(data_dir, found):
        return
    _delete_snapshots()
    try:
        data_dir.rmdir()
    except OSError:
        print(f"ℹ️  The folder was left in place because it holds other files: {data_dir}")
    print("✅ SafePass data deleted.")


def main():
    """Main CLI handler"""
    os.umask(0o077)  # the log and pid files too (no effect on Windows)
    # Consoles without UTF-8 (e.g. cp1254) would crash on the emoji in messages
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors='replace')
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(
        description='SafePass - Offline Password Manager',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
  init      Set up the database
  start     Start the web server in the background and open the sign-in page (on this installation's
            own port, chosen at random on first start and kept in the data folder);
            when it is already running, opens a new sign-in page
  stop      Stop the running server (from any terminal)
  reset     Delete all data and start empty (WARNING: cannot be undone!)
  clean     Remove all user data and the database
  update    Update to the latest version
  rollback  Go back to a version used before (copies are kept for 30 days)

Examples:
  safepass init
  safepass start
  safepass start --port 8080
  safepass start --foreground   (stays in this terminal, Ctrl+C stops it)
  safepass start --no-browser   (only prints the sign-in link)
  safepass stop
  safepass reset
  safepass clean
  safepass rollback            (lists the versions you can go back to)
  safepass rollback 1.2.4
        """
    )
    
    parser.add_argument('command', 
                       choices=['init', 'start', 'stop', 'reset', 'clean', 'update', 'rollback'],
                       help='Command to run')
    parser.add_argument('version', nargs='?', default=None,
                        help='rollback: the version to go back to')
    parser.add_argument('--port', type=int, default=None,
                        help="Server port (default: this installation's own port)")
    parser.add_argument('--foreground', action='store_true',
                        help='start: run the server in this terminal (Ctrl+C stops it)')
    parser.add_argument('--no-browser', action='store_true',
                        help="start: print the sign-in link instead of opening the browser")
    
    args = parser.parse_args()
    
    if args.command == 'init':
        init_database()
    elif args.command == 'start':
        if not start_server(args.port, foreground=args.foreground, browser=not args.no_browser):
            sys.exit(1)
    elif args.command == 'stop':
        stop_server(args.port)
    elif args.command == 'reset':
        reset_data()
    elif args.command == 'clean':
        clean_data()
    elif args.command == 'update':
        update_server()
    elif args.command == 'rollback':
        if not rollback(args.version):
            sys.exit(1)

if __name__ == '__main__':
    main()
