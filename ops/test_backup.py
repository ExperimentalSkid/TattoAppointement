"""Backup checks use temporary artwork/state and a Docker command fixture, never production."""

import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("tinta_backup", Path(__file__).with_name("backup.py"))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


def artwork(path, missing=False, unsafe=False):
    with tarfile.open(path, "w:gz") as archive:
        entries = [("./artist/original.png", b"image")]
        if not missing:
            entries.append(("./artist/original.preview.webp", b"preview"))
        if unsafe:
            entries.append(("../escaped", b"bad"))
        for name, content in entries:
            info = tarfile.TarInfo(name)
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))


REFERENCES = [{"storageKey": "artist/original.png", "previewKey": "artist/original.preview.webp", "fileSize": 5}]
COUNTS = {"accounts": 1, "clients": 0, "designs": 1, "appointments": 0, "payments": 0}


class FakeDocker(backup.Docker):
    def __init__(self, project, archive):
        super().__init__(project)
        self.archive = archive
        self.calls = []
        self.restore_failure = False
        self.wrong_project = False
        self.wrong_volume = False
        self.wrong_scratch = False
        self.scratch = None
        self.token = None

    def call(self, args, **kwargs):
        self.calls.append(args)
        if args[0] == "compose":
            return ("a" if args[-1] == "db" else "b") * 64 + "\n"
        if args[:2] == ["volume", "inspect"]:
            return json.dumps({"com.docker.compose.project": "other" if self.wrong_volume else "tinta",
                               "com.docker.compose.volume": args[-1].removeprefix("tinta_")})
        if args[0] == "inspect":
            name = args[-1]
            if name == self.scratch:
                return json.dumps({"labels": {"io.tinta.backup.role": "restore-check",
                                              "io.tinta.backup.run": "wrong" if self.wrong_scratch else self.token},
                                   "mounts": [{"Type": "volume", "Destination": "/var/lib/postgresql/data", "Name": "c" * 64}]})
            service = "db" if name.startswith("a") else "app"
            return json.dumps({"labels": {"com.docker.compose.project": "other" if self.wrong_project else "tinta",
                                          "com.docker.compose.service": service}, "running": True,
                               "mounts": [{"Type": "volume", "Name": "tinta_database" if service == "db" else "tinta_designs",
                                           "Destination": "/var/lib/postgresql/data" if service == "db" else "/data/designs"}],
                               "image": "sha256:" + "e" * 64})
        if args[0] == "run":
            self.scratch = args[args.index("--name") + 1]
            self.token = next(value.split("=", 1)[1] for value in args if value.startswith("io.tinta.backup.run="))
            return "d" * 64 + "\n"
        if args[0] == "rm":
            return self.scratch + "\n"
        if args[0] == "exec":
            if "postgres" in args:
                return "postgres (PostgreSQL) 17.9\n"
            if "sh" in args:
                kwargs["output_file"].write(b"custom-dump")
                return ""
            if "tar" in args:
                kwargs["output_file"].write(self.archive.read_bytes())
                return ""
            if "pg_isready" in args:
                return "ready\n"
            if "pg_restore" in args:
                if self.restore_failure:
                    raise backup.BackupError("docker_command_failed")
                if kwargs["input_file"].read() != b"custom-dump":
                    raise AssertionError("Restore must receive the actual captured dump")
                return ""
            if "psql" in args:
                return json.dumps(REFERENCES if args[-1] == backup.REFERENCE_SQL else COUNTS)
        raise AssertionError("Unexpected Docker operation: " + repr(args))


class FakeLock:
    LOCK_EX = 1
    LOCK_NB = 2
    blocked = False

    def flock(self, *_args):
        if self.blocked:
            raise BlockingIOError()


def fixture_owned(path, private=False, directory=False):
    # Run orchestration on Windows/non-root CI too; separate tests exercise Linux permission checks.
    path = Path(path)
    if path.is_symlink() or (not path.is_dir() if directory else not path.is_file()):
        raise backup.BackupError("unsafe_path")
    return path


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.project = self.root / "tinta"
        self.project.mkdir()
        (self.project / "compose.yaml").write_text("services: {}\n")
        (self.project / "production.env").write_text("POSTGRES_PASSWORD=NEVER_COPY_THIS_SECRET\n")
        self.archive = self.root / "fixture.tar.gz"
        artwork(self.archive)
        self.docker = FakeDocker(self.project, self.archive)
        self.lock = FakeLock()
        self.patches = [mock.patch.object(backup, "owned_path", side_effect=fixture_owned),
                        mock.patch.object(backup, "fcntl", self.lock),
                        mock.patch.object(backup.os, "geteuid", return_value=0, create=True),
                        mock.patch.object(backup.os, "O_NOFOLLOW", 0, create=True)]
        if os.name == "nt":
            # Linux fsync semantics differ; do not weaken the production writer.
            self.patches.append(mock.patch.object(backup, "sync_directory"))
            self.patches.append(mock.patch.object(backup.os, "fsync"))
        for patch in self.patches:
            patch.start()
        self.addCleanup(self.temp.cleanup)
        for patch in self.patches:
            self.addCleanup(patch.stop)

    def run_backup(self, **kwargs):
        previous_umask = os.umask(0o077)
        try:
            return backup.run_backup(self.project, docker=self.docker, min_free_bytes=0, **kwargs)
        finally:
            os.umask(previous_umask)

    def state(self):
        return json.loads((self.project / "ops/state/backup.json").read_text())

    def snapshots(self):
        return list((self.project / "backups").glob("tinta-*"))

    def test_success_actually_restores_and_checks_references(self):
        self.assertEqual(self.run_backup(), "ok")
        state = self.state()
        self.assertEqual(state["verification"], "restored")
        self.assertTrue(state["sameHost"])
        self.assertFalse(state["offsite"])
        self.assertEqual(state["counts"]["artwork"]["referencedFiles"], 2)
        snapshot = self.snapshots()[0]
        manifest = json.loads((snapshot / "manifest.json").read_text())
        self.assertFalse(manifest["atomicDatabaseArtworkPair"])
        self.assertEqual(manifest["restoreAccess"], "blocked_pending_erasure_review")
        self.assertEqual(manifest["sha256"]["database.dump"], backup.checksum(snapshot / "database.dump"))
        for path in snapshot.iterdir():
            self.assertNotIn(b"NEVER_COPY_THIS_SECRET", path.read_bytes())
        run = next(args for args in self.docker.calls if args[0] == "run")
        self.assertEqual(run[run.index("--network") + 1], "none")
        self.assertEqual(run[run.index("--pull") + 1], "never")
        self.assertIn(["rm", "--force", "--volumes", self.docker.scratch], self.docker.calls)
        self.assertFalse(any(args[0] in ("stop", "restart") for args in self.docker.calls))

    def test_missing_preview_cannot_replace_previous_success_or_prune(self):
        self.run_backup()
        previous = self.state()
        existing = self.snapshots()[0]
        digest = backup.checksum(existing / "database.dump")
        artwork(self.archive, missing=True)
        with mock.patch.object(backup, "retention_plan", side_effect=AssertionError("Failure must never prune")):
            with self.assertRaisesRegex(backup.BackupError, "missing_referenced_artwork"):
                self.run_backup()
        state = self.state()
        self.assertEqual(state["status"], "failed")
        self.assertEqual(state["lastSuccessfulAt"], previous["lastSuccessfulAt"])
        self.assertEqual(state["lastBackup"], previous["lastBackup"])
        self.assertIsNone(state["verification"])
        self.assertEqual(self.snapshots(), [existing])
        self.assertEqual(backup.checksum(existing / "database.dump"), digest)
        self.assertIn(["rm", "--force", "--volumes", self.docker.scratch], self.docker.calls)

    def test_same_day_replacement_always_keeps_the_new_success(self):
        self.run_backup()
        self.run_backup()
        self.assertEqual(len(self.snapshots()), 1)
        self.assertEqual(self.snapshots()[0].name, self.state()["lastBackup"])

    def test_success_state_write_failure_cannot_prune(self):
        self.run_backup()
        previous = self.snapshots()[0]
        writer = backup.write_json
        def fail_success_state(path, value):
            if Path(path).name == "backup.json" and value["status"] == "ok":
                raise OSError("fixture publication failure")
            return writer(path, value)
        with mock.patch.object(backup, "write_json", side_effect=fail_success_state):
            with mock.patch.object(backup, "retention_plan", side_effect=AssertionError("Unpublished success must never prune")):
                with self.assertRaisesRegex(backup.BackupError, "backup_failed"):
                    self.run_backup()
        self.assertEqual(self.snapshots(), [previous])
        self.assertEqual(self.state()["lastBackup"], previous.name)

    def test_dump_restore_failure_preserves_previous_snapshot(self):
        self.run_backup()
        existing = self.snapshots()[0]
        self.docker.restore_failure = True
        with self.assertRaisesRegex(backup.BackupError, "docker_command_failed"):
            self.run_backup()
        self.assertEqual(self.snapshots(), [existing])
        self.assertEqual(self.state()["status"], "failed")

    def test_wrong_project_or_volume_fails_before_copy(self):
        for setting in ("wrong_project", "wrong_volume"):
            setattr(self.docker, setting, True)
            with self.assertRaises(backup.BackupError):
                self.run_backup()
            self.assertEqual(self.snapshots(), [])
            setattr(self.docker, setting, False)
        self.assertFalse(any("pg_dump" in " ".join(args) for args in self.docker.calls))

    def test_lock_does_not_change_active_state(self):
        self.run_backup()
        before = (self.project / "ops/state/backup.json").read_bytes()
        self.lock.blocked = True
        self.assertEqual(self.run_backup(), "already_running")
        self.assertEqual((self.project / "ops/state/backup.json").read_bytes(), before)

    def test_retention_keeps_latest_seven_successful_days_and_corrupt_copy(self):
        self.run_backup()
        initial = self.snapshots()[0]
        copies = []
        for day in range(1, 10):
            copy = initial.parent / f"tinta-202001{day:02}T031500Z-{day:08x}"
            shutil.copytree(initial, copy)
            copies.append(copy)
        (copies[0] / "database.dump").write_bytes(b"corrupt")
        plan = backup.retention_plan(initial.parent, 7)
        self.assertNotIn(copies[0], plan)
        self.assertEqual(set(plan), {copies[1], copies[2]})
        for path in plan:
            backup.remove_snapshot(path, initial.parent)
        self.assertEqual(len(self.snapshots()), 8)  # Seven valid days plus the excluded corrupt copy.

    def test_unknown_snapshot_contents_are_never_deleted(self):
        self.run_backup()
        snapshot = self.snapshots()[0]
        (snapshot / "keep-me").write_text("operator evidence")
        with self.assertRaisesRegex(backup.BackupError, "snapshot_cleanup_refused"):
            backup.remove_snapshot(snapshot, snapshot.parent)
        self.assertTrue((snapshot / "database.dump").exists())

    def test_wrong_restore_label_refuses_scratch_deletion(self):
        self.docker.wrong_scratch = True
        with self.assertRaisesRegex(backup.BackupError, "restore_cleanup_ownership_refused"):
            self.run_backup()
        self.assertFalse(any(args[0] == "rm" for args in self.docker.calls))
        self.assertEqual(self.state()["status"], "failed")

    def test_archive_rejects_links_traversal_truncation_and_wrong_size(self):
        artwork(self.archive, unsafe=True)
        with self.assertRaises(backup.BackupError):
            backup.verify_artwork(self.archive, REFERENCES)
        with tarfile.open(self.archive, "w:gz") as archive:
            link = tarfile.TarInfo("artist/original.png")
            link.type = tarfile.SYMTYPE
            link.linkname = "/etc/passwd"
            archive.addfile(link)
        with self.assertRaises(backup.BackupError):
            backup.verify_artwork(self.archive, REFERENCES)
        artwork(self.archive)
        with self.assertRaisesRegex(backup.BackupError, "artwork_size_mismatch"):
            backup.verify_artwork(self.archive, [{**REFERENCES[0], "fileSize": 99}])
        self.archive.write_bytes(self.archive.read_bytes()[:-6])
        with self.assertRaisesRegex(backup.BackupError, "unreadable_artwork_archive"):
            backup.verify_artwork(self.archive, REFERENCES)

    def test_commands_have_timeout_and_do_not_emit_raw_stderr(self):
        with mock.patch.object(backup.subprocess, "run", side_effect=subprocess.TimeoutExpired("docker", 90)) as call:
            with self.assertRaisesRegex(backup.BackupError, "command_timeout"):
                backup.Docker(self.project).call(["inspect", "fixture"])
            self.assertEqual(call.call_args.kwargs["timeout"], 90)
            self.assertIs(call.call_args.kwargs["stderr"], subprocess.DEVNULL)


class LinuxPermissionTests(unittest.TestCase):
    @unittest.skipUnless(hasattr(os, "geteuid") and os.geteuid() == 0, "Root Linux permission rehearsal")
    def test_real_permissions_and_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            private = root / "private"
            private.write_text("private")
            private.chmod(0o600)
            self.assertEqual(backup.owned_path(private, private=True), private)
            private.chmod(0o644)
            with self.assertRaises(backup.BackupError):
                backup.owned_path(private, private=True)
            link = root / "link"
            link.symlink_to(private)
            with self.assertRaises(backup.BackupError):
                backup.owned_path(link)


if __name__ == "__main__":
    unittest.main()
