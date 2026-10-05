import datetime as dt
import http.server
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import types
import unittest

spec = importlib.util.spec_from_file_location('tinta_monitor', Path(__file__).parents[1] / 'monitor.py')
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)
NOW = dt.datetime(2026, 10, 5, 20, tzinfo=dt.timezone.utc)


class MonitoringChecks(unittest.TestCase):
    def setUp(self):
        self.backup = {'schemaVersion': 1, 'status': 'ok', 'lastSuccessfulAt': NOW.isoformat(),
                       'verification': 'restored', 'startedAt': NOW.isoformat(), 'retentionError': False}
        self.privacy = {'schemaVersion': 1, 'status': 'ok', 'lastSuccessfulAt': NOW.isoformat()}
        self.bad_service = None
        self.wrong_volume = False
        self.fetch = lambda url: True
        self.disk = types.SimpleNamespace(f_bavail=10_000_000, f_frsize=4096,
                                         f_blocks=20_000_000, f_files=1000, f_favail=500)

    def command(self, args):
        if args[:2] == ['docker', 'compose']:
            self.assertIn('--env-file', args)
            self.assertEqual(args[args.index('-p') + 1], 'tinta')
            return 'a' * 64 if args[-1] == 'app' else 'b' * 64
        if args[:2] == ['docker', 'exec']:
            self.assertEqual(args[-2:], ['cat', '/data/diagnostics/maintenance-status.json'])
            return json.dumps(self.privacy)
        template = args[args.index('--format') + 1]
        if args[:3] == ['docker', 'volume', 'inspect']:
            volume = args[-1]
            return 'tinta|' + str(Path('/var/lib/docker/volumes') / volume / '_data')
        if '.State.Running' in template:
            service = 'app' if args[-1].startswith('a') else 'db'
            return f'tinta|{service}|true|' + ('unhealthy' if self.bad_service == service else 'healthy')
        if self.wrong_volume:
            return 'foreign_designs'
        if '/data/designs' in template:
            return 'tinta_designs'
        if '/data/diagnostics' in template:
            return 'tinta_diagnostics'
        return 'tinta_database'

    def evaluate(self):
        return monitor.checks(runner=self.command, fetch=self.fetch, now=NOW,
                              read_json=lambda path: self.backup, disk=lambda path: self.disk)

    def test_healthy(self):
        self.assertEqual(self.evaluate(), [])

    def test_unhealthy_containers(self):
        for service in ['app', 'db']:
            self.bad_service = service
            self.assertIn(service + '_container', self.evaluate())

    def test_foreign_mount_refused(self):
        self.wrong_volume = True
        self.assertIn('app_container', self.evaluate())

    def test_health_failures_are_independent(self):
        self.fetch = lambda url: url == monitor.LOCAL_HEALTH
        self.assertEqual(self.evaluate(), ['public_health'])

    def test_http_errors_do_not_leak_exception_details(self):
        def fail(url):
            raise RuntimeError('private-secret-not-for-output')
        self.fetch = fail
        self.assertEqual(self.evaluate(), ['local_health', 'public_health'])

    def test_low_disk_and_inodes(self):
        self.disk.f_bavail = 10
        self.disk.f_favail = 1
        self.assertEqual(self.evaluate(), ['inodes_low', 'storage_low'])

    def test_failed_and_unverified_backup(self):
        self.backup.update(status='failed', verification=None)
        self.assertEqual(self.evaluate(), ['backup_failed', 'backup_unverified'])

    def test_stale_backup(self):
        self.backup['lastSuccessfulAt'] = (NOW - dt.timedelta(hours=31)).isoformat()
        self.assertEqual(self.evaluate(), ['backup_stale'])

    def test_running_backup_retains_previous_success(self):
        self.backup['status'] = 'running'
        self.assertEqual(self.evaluate(), [])
        self.backup['startedAt'] = (NOW - dt.timedelta(hours=1)).isoformat()
        self.assertEqual(self.evaluate(), ['backup_stuck'])

    def test_retention_failure_visible(self):
        self.backup['retentionError'] = True
        self.assertEqual(self.evaluate(), ['backup_retention_failed'])

    def test_no_success_or_invalid_timestamp(self):
        for value in [None, 'invalid', NOW.replace(tzinfo=None).isoformat(),
                      (NOW + dt.timedelta(hours=1)).isoformat()]:
            self.backup['lastSuccessfulAt'] = value
            self.assertIn('backup_state_unavailable', self.evaluate())

    def test_cleanup_failure_and_age(self):
        self.privacy['status'] = 'degraded'
        self.assertEqual(self.evaluate(), ['privacy_cleanup_failed'])
        self.privacy.update(status='ok', lastSuccessfulAt=(NOW - dt.timedelta(hours=1)).isoformat())
        self.assertEqual(self.evaluate(), ['privacy_cleanup_stale'])

    def test_private_state_atomic_and_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'state/monitor.json'
            value = {'schemaVersion': 1, 'status': 'ok'}
            monitor.atomic_state(target, value)
            self.assertEqual(monitor.private_json(target), value)
            self.assertEqual(list(target.parent.iterdir()), [target])
            if os.name != 'nt':
                self.assertEqual(target.stat().st_mode & 0o777, 0o600)
                self.assertEqual(target.parent.stat().st_mode & 0o777, 0o700)
            target.write_text('x' * 16385)
            with self.assertRaises(ValueError):
                monitor.private_json(target)


class HTTPChecks(unittest.TestCase):
    def test_redirect_and_wrong_readiness_are_rejected(self):
        requests = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                if self.path == '/redirect':
                    self.send_response(302)
                    self.send_header('Location', '/ready')
                    self.end_headers()
                    return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'ready' if self.path == '/ready' else 'unavailable'}).encode())
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            origin = f'http://127.0.0.1:{server.server_port}'
            self.assertTrue(monitor.health(origin + '/ready'))
            self.assertFalse(monitor.health(origin + '/unavailable'))
            with self.assertRaises(Exception):
                monitor.health(origin + '/redirect')
            self.assertEqual(requests, ['/ready', '/unavailable', '/redirect'])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
