#!/usr/bin/env python3
"""Read-only checks for the dedicated Tinta deployment. No automatic repairs."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.request

ROOT = Path('/srv/tinta')
STATE = ROOT / 'ops/state'
PUBLIC_HEALTH = 'https://tinta.bladesbeats.com/api/health'
LOCAL_HEALTH = 'http://127.0.0.1:3100/api/health'


def timestamp():
    return dt.datetime.now(dt.timezone.utc)


def age_hours(value, now):
    if not isinstance(value, str):
        raise ValueError('invalid_timestamp')
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('invalid_timestamp')
    age = (now - parsed).total_seconds() / 3600
    if age < -5 / 60:
        raise ValueError('future_timestamp')
    return max(age, 0)


def run(command):
    if command[0] != 'docker':
        raise ValueError('unexpected_command')
    return subprocess.run(['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock', *command[1:]],
                          check=True, capture_output=True, text=True, timeout=15,
                          env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root',
                               'LANG': 'C.UTF-8'}).stdout.strip()


def private_json(path):
    if path.is_symlink() or path.stat().st_size > 16384:
        raise ValueError('invalid_state')
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict) or value.get('schemaVersion') != 1:
        raise ValueError('invalid_state')
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def health(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(url, headers={'User-Agent': 'Tinta-Operations/1',
                                                 'Accept': 'application/json'})
    with opener.open(request, timeout=8) as response:
        body = response.read(4097)
        return (response.status == 200 and response.url == url and len(body) <= 4096
                and json.loads(body).get('status') == 'ready')


def atomic_state(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.parent.is_symlink() or path.is_symlink():
        raise ValueError('unsafe_state_path')
    os.chmod(path.parent, 0o700)
    descriptor, temporary = tempfile.mkstemp(prefix='.monitor-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
            json.dump(value, output, separators=(',', ':'))
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def checks(runner=run, fetch=health, now=None, read_json=private_json, disk=None):
    now = now or timestamp()
    disk = disk or os.statvfs
    failures = []
    volume_paths = []
    containers = {}
    for service, mounts in [('app', {'/data/designs': 'tinta_designs',
                                   '/data/diagnostics': 'tinta_diagnostics'}),
                            ('db', {'/var/lib/postgresql/data': 'tinta_database'})]:
        try:
            container = runner(['docker', 'compose', '--project-directory', str(ROOT),
                                '--env-file', str(ROOT / 'production.env'), '-f',
                                str(ROOT / 'compose.yaml'), '-p', 'tinta', 'ps', '-q', service])
            if not container or '\n' in container or not all(c in '0123456789abcdef' for c in container):
                raise ValueError('missing_container')
            template = ('{{index .Config.Labels "com.docker.compose.project"}}|'
                        '{{index .Config.Labels "com.docker.compose.service"}}|'
                        '{{.State.Running}}|{{.State.Health.Status}}')
            if runner(['docker', 'inspect', '--format', template, container]) != f'tinta|{service}|true|healthy':
                raise ValueError('unhealthy_container')
            for destination, volume in mounts.items():
                template = '{{range .Mounts}}{{if eq .Destination "' + destination + '"}}{{.Name}}{{end}}{{end}}'
                if runner(['docker', 'inspect', '--format', template, container]) != volume:
                    raise ValueError('unexpected_mount')
                location = runner(['docker', 'volume', 'inspect', '--format',
                                   '{{index .Labels "com.docker.compose.project"}}|{{.Mountpoint}}', volume])
                owner, mountpoint = location.split('|', 1)
                expected = (Path('/var/lib/docker/volumes') / volume / '_data').resolve()
                if owner != 'tinta' or Path(mountpoint).resolve() != expected:
                    raise ValueError('unexpected_volume')
                volume_paths.append(expected)
            containers[service] = container
        except Exception:
            failures.append(f'{service}_container')
    for label, url in [('local_health', LOCAL_HEALTH), ('public_health', PUBLIC_HEALTH)]:
        try:
            if not fetch(url):
                failures.append(label)
        except Exception:
            failures.append(label)
    try:
        for location in [ROOT, *volume_paths]:
            usage = disk(location)
            if usage.f_bavail * usage.f_frsize < 2 * 1024 ** 3 or usage.f_bavail / max(usage.f_blocks, 1) < .1:
                failures.append('storage_low')
            if usage.f_files and usage.f_favail / usage.f_files < .1:
                failures.append('inodes_low')
    except Exception:
        failures.append('storage_unavailable')
    try:
        backup = read_json(STATE / 'backup.json')
        if backup.get('status') not in ('ok', 'running'):
            failures.append('backup_failed')
        if backup.get('retentionError'):
            failures.append('backup_retention_failed')
        if age_hours(backup.get('lastSuccessfulAt'), now) > 30:
            failures.append('backup_stale')
        if backup.get('verification') != 'restored':
            failures.append('backup_unverified')
        if backup.get('status') == 'running' and age_hours(backup.get('startedAt'), now) > .75:
            failures.append('backup_stuck')
    except Exception:
        failures.append('backup_state_unavailable')
    try:
        app = containers.get('app')
        if not app:
            raise ValueError('no_app')
        value = json.loads(runner(['docker', 'exec', app, 'cat', '/data/diagnostics/maintenance-status.json']))
        if value.get('schemaVersion') != 1 or value.get('status') != 'ok':
            failures.append('privacy_cleanup_failed')
        if age_hours(value.get('lastSuccessfulAt'), now) > .75:
            failures.append('privacy_cleanup_stale')
    except Exception:
        failures.append('privacy_state_unavailable')
    return sorted(set(failures))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--status', action='store_true', help='Read the last private summary without running checks')
    args = parser.parse_args()
    os.umask(0o077)
    if ROOT.resolve() != ROOT or not (ROOT / 'production.env').is_file():
        print('Tinta monitor refused: dedicated deployment missing.', file=sys.stderr)
        return 2
    if args.status:
        try:
            state = private_json(STATE / 'monitor.json')
            print(json.dumps({key: state.get(key) for key in ['status', 'checkedAt', 'failures',
                  'notificationDelivery', 'offsiteBackup']}))
            return 0
        except Exception:
            print('Tinta monitoring status unavailable.', file=sys.stderr)
            return 2
    now = timestamp()
    failures = checks(now=now)
    previous = None
    try:
        previous = private_json(STATE / 'monitor.json')
    except Exception:
        pass
    state = {'schemaVersion': 1, 'status': 'failed' if failures else 'ok',
             'checkedAt': now.isoformat(), 'failures': failures,
             'notificationDelivery': 'unconfigured', 'offsiteBackup': False}
    atomic_state(STATE / 'monitor.json', state)
    if previous is None or previous.get('failures') != failures:
        print('Tinta monitoring: ' + (', '.join(failures) if failures else 'all configured checks healthy')
              + '; external notifications and off-server backups remain unconfigured.')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
