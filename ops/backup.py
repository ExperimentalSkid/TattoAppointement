#!/usr/bin/env python3
"""Private, same-host Tinta backup with an isolated restore check (Linux only)."""

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import time
import uuid

try:
    import fcntl
except ImportError:  # Unit tests can exercise pure validation on Windows.
    fcntl = None


PROJECT = "tinta"
SNAPSHOT = re.compile(r"tinta-\d{8}T\d{6}Z-[a-f0-9]{8}\Z")
FILES = {"database.dump", "designs.tar.gz", "manifest.json", "SHA256SUMS", "STATUS"}
INSPECT = ('{"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}},'
           '"image":{{json .Image}},"running":{{json .State.Running}}}')
REFERENCE_SQL = '''SELECT COALESCE(json_agg(json_build_object(
    'storageKey', "storageKey", 'previewKey', "previewKey", 'fileSize', "fileSize")), '[]')
    FROM "Design";'''
COUNT_SQL = '''SELECT json_build_object('accounts', (SELECT count(*) FROM "user"),
    'clients', (SELECT count(*) FROM "Client"), 'designs', (SELECT count(*) FROM "Design"),
    'appointments', (SELECT count(*) FROM "Appointment"),
    'payments', (SELECT count(*) FROM "Payment"));'''


class BackupError(Exception):
    """Only fixed, safe reason codes cross the logging/state boundary."""


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def owned_path(path, private=False, directory=False):
    """Reject links, non-root ownership and unsafe permissions, without repairing them."""
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path:
        raise BackupError("unsafe_path")
    info = path.lstat()
    wanted = stat.S_ISDIR if directory else stat.S_ISREG
    if not wanted(info.st_mode) or info.st_uid != 0 or info.st_mode & (0o077 if private else 0o022):
        raise BackupError("unsafe_ownership_or_permissions")
    return path


def private_dir(path):
    path = Path(path)
    if not path.exists() and not path.is_symlink():
        path.mkdir(mode=0o700)
    return owned_path(path, private=True, directory=True)


def write_json(path, value):
    """Atomically publish a root-private summary; never follow an existing link."""
    path = Path(path)
    if path.exists() or path.is_symlink():
        owned_path(path, private=True)
    temporary = path.parent / (".state-" + uuid.uuid4().hex)
    try:
        with temporary.open("x", encoding="utf-8") as handle:
            os.chmod(temporary, 0o600)
            json.dump(value, handle, sort_keys=True, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if temporary.exists():
            temporary.unlink()


def sync_directory(path):
    directory_fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def checksum(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def storage_key(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}/[A-Za-z0-9_.-]+", value):
        raise BackupError("invalid_artwork_reference")
    if any(part in (".", "..") for part in PurePosixPath(value).parts):
        raise BackupError("invalid_artwork_reference")
    return value


def verify_artwork(archive, references):
    """Read every regular member; reject links/traversal and check every DB reference."""
    members = {}
    total_bytes = 0
    try:
        with tarfile.open(archive, "r:gz") as tar:
            for entry in tar:
                name = entry.name
                while name.startswith("./"):
                    name = name[2:]
                if name in ("", ".") and entry.isdir():
                    continue
                if entry.isdir():
                    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}/?", name):
                        raise BackupError("invalid_artwork_archive")
                    continue
                key = storage_key(name)
                if not entry.isfile() or key in members or entry.size <= 0:
                    raise BackupError("invalid_artwork_archive")
                extracted = tar.extractfile(entry)
                if extracted is None:
                    raise BackupError("unreadable_artwork_archive")
                actual_size = 0
                with extracted:
                    for block in iter(lambda: extracted.read(1024 * 1024), b""):
                        actual_size += len(block)
                if actual_size != entry.size:
                    raise BackupError("unreadable_artwork_archive")
                members[key] = entry.size
                total_bytes += entry.size
        # tar readers can stop at the tar end marker; read the gzip trailer too.
        import gzip
        with gzip.open(archive, "rb") as compressed:
            for _ in iter(lambda: compressed.read(1024 * 1024), b""):
                pass
    except (tarfile.TarError, OSError, EOFError, ValueError):
        raise BackupError("unreadable_artwork_archive") from None
    if not isinstance(references, list):
        raise BackupError("invalid_restored_references")
    referenced = set()
    previews = 0
    for row in references:
        if not isinstance(row, dict):
            raise BackupError("invalid_restored_references")
        original = storage_key(row.get("storageKey"))
        if original not in members:
            raise BackupError("missing_referenced_artwork")
        expected_size = row.get("fileSize")
        if expected_size is not None and (type(expected_size) is not int or expected_size != members[original]):
            raise BackupError("artwork_size_mismatch")
        referenced.add(original)
        if row.get("previewKey") is not None:
            preview = storage_key(row["previewKey"])
            if preview not in members:
                raise BackupError("missing_referenced_artwork")
            referenced.add(preview)
            previews += 1
    return {"archiveFiles": len(members), "archiveBytes": total_bytes,
            "referencedFiles": len(referenced), "originals": len(references), "previews": previews}


class Docker:
    def __init__(self, project_dir, binary="/usr/bin/docker", timeout=90, copy_timeout=1800):
        self.binary = binary
        self.timeout = timeout
        self.copy_timeout = copy_timeout
        self.compose = ["compose", "--project-directory", str(project_dir), "--env-file",
                        str(project_dir / "production.env"), "-f", str(project_dir / "compose.yaml"), "-p", PROJECT]

    def call(self, args, *, input_file=None, output_file=None, long=False):
        try:
            result = subprocess.run([self.binary, "--host", "unix:///var/run/docker.sock", *args], stdin=input_file, stdout=output_file or subprocess.PIPE,
                                    stderr=subprocess.DEVNULL, check=False,
                                    timeout=self.copy_timeout if long else self.timeout,
                                    env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "HOME": "/root", "LANG": "C.UTF-8"})
        except subprocess.TimeoutExpired:
            raise BackupError("command_timeout") from None
        except OSError:
            raise BackupError("command_unavailable") from None
        if result.returncode:
            raise BackupError("docker_command_failed")
        return result.stdout.decode("utf-8") if result.stdout is not None else ""

    def inspect(self, container):
        try:
            return json.loads(self.call(["inspect", "--type", "container", "--format", INSPECT, container]))
        except (json.JSONDecodeError, TypeError):
            raise BackupError("invalid_container_inspection") from None

    def service(self, name, destination, volume):
        container = self.call([*self.compose, "ps", "--status", "running", "-q", name]).strip()
        if not re.fullmatch(r"[a-f0-9]{12,64}", container):
            raise BackupError("expected_one_running_container")
        info = self.inspect(container)
        labels = info.get("labels") or {}
        if labels.get("com.docker.compose.project") != PROJECT or labels.get("com.docker.compose.service") != name or info.get("running") is not True:
            raise BackupError("wrong_container_ownership")
        mounts = [mount for mount in info.get("mounts", []) if mount.get("Destination") == destination]
        if len(mounts) != 1 or mounts[0].get("Type") != "volume" or mounts[0].get("Name") != volume:
            raise BackupError("wrong_storage_volume")
        try:
            metadata = json.loads(self.call(["volume", "inspect", "--format", "{{json .Labels}}", volume])) or {}
        except json.JSONDecodeError:
            raise BackupError("invalid_volume_inspection") from None
        if metadata.get("com.docker.compose.project") != PROJECT or metadata.get("com.docker.compose.volume") != volume.removeprefix(PROJECT + "_"):
            raise BackupError("wrong_volume_ownership")
        return container, info

    def cleanup(self, name, token):
        # A timed-out run may have created a container. Its unique name alone is insufficient.
        try:
            info = self.inspect(name)
        except BackupError:
            # Distinguish absence from an inspect/daemon failure; never silently lose scratch storage.
            existing = self.call(["container", "ls", "-a", "--filter", "name=^/" + name + "$", "--format", "{{.Names}}"])
            if not existing.strip():
                return
            raise BackupError("restore_cleanup_failed") from None
        labels = info.get("labels") or {}
        if labels.get("io.tinta.backup.run") != token or labels.get("io.tinta.backup.role") != "restore-check":
            raise BackupError("restore_cleanup_ownership_refused")
        volumes = [mount for mount in info.get("mounts", []) if mount.get("Type") == "volume"]
        if len(volumes) != 1 or volumes[0].get("Destination") != "/var/lib/postgresql/data" or not re.fullmatch(r"[a-f0-9]{64}", volumes[0].get("Name", "")):
            raise BackupError("restore_cleanup_mount_refused")
        self.call(["rm", "--force", "--volumes", name])

    def restore_check(self, image, dump, archive):
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
            raise BackupError("invalid_postgres_image")
        token = uuid.uuid4().hex
        name = "tinta-backup-check-" + token
        try:
            self.call(["run", "--detach", "--pull", "never", "--name", name,
                       "--label", "io.tinta.backup.run=" + token,
                       "--label", "io.tinta.backup.role=restore-check", "--network", "none",
                       "--mount", "type=volume,target=/var/lib/postgresql/data",
                       "--memory", "512m", "--cpus", "1", "--pids-limit", "256",
                       "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", "POSTGRES_USER=tinta_backup",
                       "--env", "POSTGRES_DB=tinta_backup", image])
            ready_by = time.monotonic() + 120
            while True:
                try:
                    self.call(["exec", name, "pg_isready", "-U", "tinta_backup", "-d", "tinta_backup"])
                    break
                except BackupError:
                    if time.monotonic() >= ready_by:
                        raise BackupError("restore_database_not_ready") from None
                    time.sleep(2)
            with Path(dump).open("rb") as source:
                self.call(["exec", "-i", name, "pg_restore", "--exit-on-error", "--no-owner", "--no-acl",
                           "-U", "tinta_backup", "-d", "tinta_backup"], input_file=source, long=True)
            def query(sql):
                try:
                    return json.loads(self.call(["exec", name, "psql", "-X", "-v", "ON_ERROR_STOP=1",
                                                 "-U", "tinta_backup", "-d", "tinta_backup", "-At", "-c", sql]))
                except json.JSONDecodeError:
                    raise BackupError("invalid_restored_query") from None
            references = query(REFERENCE_SQL)
            counts = query(COUNT_SQL)
            if not isinstance(counts, dict) or set(counts) != {"accounts", "clients", "designs", "appointments", "payments"} or any(type(value) is not int or value < 0 for value in counts.values()):
                raise BackupError("invalid_restored_counts")
            artwork = verify_artwork(archive, references)
            if counts["designs"] != artwork["originals"]:
                raise BackupError("restored_design_count_mismatch")
            return {"database": counts, "artwork": artwork}
        finally:
            self.cleanup(name, token)


def remove_snapshot(path, backup_root):
    """Delete only the flat snapshot format, never recurse into an unknown path."""
    path = Path(path)
    if path.parent != backup_root or not SNAPSHOT.fullmatch(path.name):
        raise BackupError("snapshot_cleanup_refused")
    owned_path(path, private=True, directory=True)
    children = list(path.iterdir())
    if any(child.name not in FILES for child in children):
        raise BackupError("snapshot_cleanup_refused")
    for child in children:
        owned_path(child, private=True)
    for child in children:
        child.unlink()
    path.rmdir()


def retention_plan(backup_root, keep_days, newest=None):
    """Only verified snapshots qualify; malformed/unrecognised contents are retained."""
    valid = []
    for path in backup_root.iterdir():
        if not SNAPSHOT.fullmatch(path.name):
            continue
        try:
            owned_path(path, private=True, directory=True)
            if {child.name for child in path.iterdir()} != FILES:
                continue
            for child in path.iterdir():
                owned_path(child, private=True)
            manifest = json.loads((path / "manifest.json").read_text())
            if manifest.get("schemaVersion") != 1 or manifest.get("verification") != "restored" or (path / "STATUS").read_text() != "RESTORE_VERIFIED\n":
                continue
            hashes = manifest.get("sha256", {})
            if set(hashes) != {"database.dump", "designs.tar.gz"} or any(checksum(path / name) != value for name, value in hashes.items()):
                continue
            valid.append(path)
        except (BackupError, OSError, ValueError, TypeError):
            continue
    if newest is not None and newest not in valid:
        raise BackupError("new_snapshot_not_verified_for_retention")
    kept_days = set()
    keep = set()
    for path in sorted(valid, key=lambda item: (item.name[6:14], item == newest, item.name), reverse=True):
        day = path.name[6:14]
        if day not in kept_days and len(kept_days) < keep_days:
            kept_days.add(day)
            keep.add(path)
    return [path for path in valid if path not in keep]


def run_backup(project_dir=Path("/srv/tinta"), keep_days=7, min_free_bytes=1024 ** 3, docker=None):
    if fcntl is None or not hasattr(os, "geteuid") or os.geteuid() != 0:
        raise BackupError("linux_root_required")
    project_dir = owned_path(Path(project_dir), directory=True)
    owned_path(project_dir / "compose.yaml")
    owned_path(project_dir / "production.env", private=True)
    # Check ancestors as well: an untrusted parent can swap the dedicated directory.
    for ancestor in project_dir.parents:
        owned_path(ancestor, directory=True)
    ops = project_dir / "ops"
    if not ops.exists():
        ops.mkdir(mode=0o755)
    owned_path(ops, directory=True)
    state_dir = private_dir(ops / "state")
    backup_root = private_dir(project_dir / "backups")
    state_file = state_dir / "backup.json"
    lock_file = state_dir / "backup.lock"
    fd = os.open(lock_file, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        owned_path(lock_file, private=True)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return "already_running"
        previous = {}
        if state_file.exists() or state_file.is_symlink():
            owned_path(state_file, private=True)
            try:
                previous = json.loads(state_file.read_text())
            except (ValueError, OSError):
                raise BackupError("invalid_previous_backup_state") from None
            if not isinstance(previous, dict):
                raise BackupError("invalid_previous_backup_state")
        state = {"schemaVersion": 1, "status": "running", "startedAt": utc_now(), "finishedAt": None,
                 "lastSuccessfulAt": previous.get("lastSuccessfulAt"), "lastBackup": previous.get("lastBackup"),
                 "verification": "restored" if previous.get("verification") == "restored" else None,
                 "sameHost": True, "offsite": False}
        write_json(state_file, state)
        snapshot = None
        verified = False
        docker = docker or Docker(project_dir)
        try:
            if shutil.disk_usage(backup_root).free < min_free_bytes:
                raise BackupError("insufficient_free_space")
            db, db_info = docker.service("db", "/var/lib/postgresql/data", "tinta_database")
            app, _ = docker.service("app", "/data/designs", "tinta_designs")
            if not re.fullmatch(r"postgres \(PostgreSQL\) 17\.[^\n]+\n?", docker.call(["exec", db, "postgres", "--version"])):
                raise BackupError("postgres_17_required")
            name = "tinta-" + dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
            snapshot = backup_root / name
            snapshot.mkdir(mode=0o700)
            (snapshot / "STATUS").write_text("INCOMPLETE\n")
            # Only the container's configured database/user are expanded; no environment is read or logged.
            with (snapshot / "database.dump").open("xb") as dump:
                docker.call(["exec", db, "sh", "-eu", "-c",
                             'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl'],
                            output_file=dump, long=True)
            with (snapshot / "designs.tar.gz").open("xb") as archive:
                docker.call(["exec", app, "tar", "-C", "/data/designs", "-czf", "-", "."], output_file=archive, long=True)
            counts = docker.restore_check(db_info["image"], snapshot / "database.dump", snapshot / "designs.tar.gz")
            hashes = {name: checksum(snapshot / name) for name in ("database.dump", "designs.tar.gz")}
            finished = utc_now()
            manifest = {"schemaVersion": 1, "project": PROJECT, "startedAt": state["startedAt"], "finishedAt": finished,
                        "verification": "restored", "postgresMajor": 17, "sameHost": True, "offsite": False,
                        "atomicDatabaseArtworkPair": False, "restoreAccess": "blocked_pending_erasure_review",
                        "counts": counts, "sha256": hashes,
                        "bytes": {name: (snapshot / name).stat().st_size for name in hashes}, "retainedSuccessfulDays": keep_days}
            write_json(snapshot / "manifest.json", manifest)
            (snapshot / "SHA256SUMS").write_text("".join(f"{value}  {name}\n" for name, value in hashes.items()))
            (snapshot / "STATUS").write_text("RESTORE_VERIFIED\n")
            for item in snapshot.iterdir():
                os.chmod(item, 0o600)
                with item.open("rb") as handle:
                    os.fsync(handle.fileno())
            sync_directory(snapshot)
            sync_directory(backup_root)
            # Commit durable success before any older snapshot can be removed.
            # The conservative retention flag remains set if a later state write fails.
            state.update(status="ok", finishedAt=finished, lastSuccessfulAt=finished, lastBackup=snapshot.name,
                         verification="restored", counts=counts, retentionPruned=0, retentionError=True)
            write_json(state_file, state)
            verified = True
            # Failed backup/restore runs never enter retention. Corrupt/unknown directories are not deleted.
            pruned = 0
            retention_error = False
            try:
                for old in retention_plan(backup_root, keep_days, newest=snapshot):
                    remove_snapshot(old, backup_root)
                    pruned += 1
            except (BackupError, OSError):
                retention_error = True
            state.update(retentionPruned=pruned, retentionError=retention_error)
            try:
                write_json(state_file, state)
            except (BackupError, OSError):
                return "ok_retention_state_unavailable"
            return "ok"
        except BaseException as error:
            if verified:
                # Success is already durable; a later retention interruption is an attention flag.
                state.update(status="ok", retentionError=True)
                try:
                    write_json(state_file, state)
                except (BackupError, OSError):
                    pass
                return "ok_retention_incomplete"
            reason = str(error) if isinstance(error, BackupError) else "backup_failed"
            if snapshot is not None and not verified:
                try:
                    remove_snapshot(snapshot, backup_root)
                except (BackupError, OSError):
                    reason = "partial_snapshot_cleanup_failed"
            for key in ("counts", "retentionPruned", "retentionError"):
                state.pop(key, None)
            state.update(status="failed", finishedAt=utc_now(), failure=reason, verification=None,
                         lastSuccessfulAt=previous.get("lastSuccessfulAt"), lastBackup=previous.get("lastBackup"))
            write_json(state_file, state)
            raise BackupError(reason) from None
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-dir", type=Path, default=Path("/srv/tinta"))
    parser.add_argument("--keep-days", type=int, choices=range(1, 31), default=7)
    args = parser.parse_args()
    os.umask(0o077)
    def interrupted(_number, _frame):
        raise BackupError("interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        outcome = run_backup(args.project_dir, args.keep_days)
        print("Tinta backup: " + outcome + "; same-host=true; offsite=false")
        return 0
    except BackupError as error:
        print("Tinta backup: failed; reason=" + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
