# Production backups

`ops/backup.py` prepares private local copies of **Tinta only**. The daily timer
is an installation example; checked-in files do not mean a schedule is installed.
The runner requires Linux, Python 3.9+, root and the Docker/Compose CLI at
`/usr/bin/docker`. The installed source and `/srv/tinta` must be root-owned and
not writable by group/others. `production.env` must be a regular root-owned 0600
file. The runner never reads, prints or copies that file; Compose uses it solely
to locate the dedicated project. Do not loosen permissions to bypass a refusal.

There is currently **no off-server destination or notification channel**. These
are plaintext, root-private copies on the same server as the database and
artwork. They do not protect against loss of that server/disk, a privileged
attacker, or loss of administrator access. Encryption and off-server delivery
are not active. Choose a destination, access controls, retention and (if required)
an encryption recipient/key recovery process before adding either capability.

## What a successful run proves

The runner checks exactly one running `tinta/db` and `tinta/app` container and
the Compose ownership of `tinta_database` and `tinta_designs`, mounted at their
expected paths. It takes a PostgreSQL custom-format snapshot and, separately,
a live gzip tar copy of `/data/designs`. It uses the database container's own
configured user/database; the historical manual script's hardcoded database name
is not assumed. It does not stop, restart or recreate either production service.

Every new dump is restored using `pg_restore --exit-on-error` into a unique,
labeled PostgreSQL 17 container using the already-present production image ID,
`--pull never`, `--network none`, resource limits and anonymous transient storage.
The restored database supplies every `Design.storageKey`, `Design.previewKey`
and original `fileSize`. Every referenced original/preview must exist as a readable,
nonempty regular archive file; recorded original sizes must match. All archive
members are read and gzip integrity checked. Links, duplicate members and unsafe
paths are refused. The scratch container and anonymous storage are removed only
after checking their labels and mount ownership. If cleanup fails, the run fails;
investigate the private scratch resource rather than deleting unrelated containers.

Only then does a snapshot receive `STATUS=RESTORE_VERIFIED`, `manifest.json`
with safe counts/byte totals, SHA-256 hashes and `SHA256SUMS`. This tests a restore
and reference completeness. It does **not** prove an atomic database/artwork pair:
artists can continue writing between the separate copies. Concurrent deletion
can make a run fail; a retry can succeed. Unreferenced fresh files can be present.
It is not a full application recovery test and grants no permission to serve
restored personal data.

## Paths, scheduling and failures

Snapshots are under `/srv/tinta/backups/tinta-<UTC timestamp>-<random suffix>`.
Directories are 0700; files and lock/state are 0600. No diagnostic logs or server
configuration are copied. A nonblocking lock prevents overlapping runs. Docker
commands have 90-second timeouts, extended to 30 minutes for copying/restoring;
the sample service caps the whole run at one hour. At least 1 GiB of free space
is required before starting, which is a minimum guard rather than a capacity
estimate. Size the disk for seven snapshots plus one new copy and restore scratch
space. The scratch restore also consumes database storage temporarily.

The runner atomically publishes `/srv/tinta/ops/state/backup.json` with schema 1,
`status` (`running`, `ok`, `failed`), UTC timestamps, the previous
`lastSuccessfulAt`/`lastBackup`, `verification`, counts and explicit
`sameHost: true`, `offsite: false`. Previous success is retained on failure;
`verification: restored` is retained while running and cleared on failure.
`retentionError: true` means a new verified backup exists but cleanup needs review.
Console/journal output contains fixed outcomes/reason codes, not Docker errors,
file keys, account details or credentials. Preconditions can fail before state is
writable, so also inspect the service result. A stale/running/failed state needs
operator attention; journal/state visibility alone does not deliver an alert.

The default retention target is the latest verified copy for each of the last
**seven successful UTC backup days**, not a guaranteed seven-calendar-day expiry.
Same-day replacements become eligible for removal after a new success. Failed
backup/restore runs never prune previous copies. Corrupt, unfamiliar or unsafe
directories are not automatically deleted; these need an operator review. A
failed schedule can therefore extend the age of copies and must be monitored.
Any exceptional retention of damaged copies needs a documented expiry decision.

To install after reviewing the code and service paths, create the writable private
directories first, install the unit examples and enable the timer:

```sh
install -d -o root -g root -m 0700 /srv/tinta/backups /srv/tinta/ops/state
install -o root -g root -m 0644 /srv/tinta/ops/systemd/tinta-backup.service /etc/systemd/system/tinta-backup.service
install -o root -g root -m 0644 /srv/tinta/ops/systemd/tinta-backup.timer /etc/systemd/system/tinta-backup.timer
systemctl daemon-reload
systemctl start tinta-backup.service
systemctl enable --now tinta-backup.timer
systemctl list-timers tinta-backup.timer
systemctl status tinta-backup.service --no-pager
```

The timer runs at 03:15 UTC with up to ten minutes of jitter, and catches a missed
run on startup. First inspect a successful state, hashes, permissions and scratch
cleanup. Never expose the backup directory through the app/proxy. Disabling the
timer does not erase copies. Docker access is privileged even with service
hardening; the backup identity must remain restricted to trusted administrators.

## Erasure and production restore barrier

No production restore tool or automatic replacement is supplied. Each manifest
records `restoreAccess: blocked_pending_erasure_review`, and recovery must remain
isolated from users and external systems until a named operator completes review.

Historical backups can contain accounts, clients, credentials and artwork already
erased or restricted in the live application. The prepared application records
future accepted self-service account and client erasure instructions in
`/data/diagnostics/recovery-erasures` once this version is deployed. Each private
record contains only schema version, kind (`account` or `client`),
`SHA256(kind + ':' + subjectId)` and the first recorded timestamp. It records the
instruction before irreversible cleanup; an unavailable record blocks cleanup.
Retries preserve the first timestamp. An accepted instruction can remain even
if a subsequent database transaction rolls back, so it is evidence for reviewed
suppression rather than proof that erasure completed. These pseudonymous records
are retained outside the database/artwork snapshots and ordinary diagnostic-log
expiry. The application's temporary account hash marker serves a different purpose.

Assign an owner and keep an additional protected operator ledger for historical
erasures predating this version, manual actions, corrections and restrictions.
The new records do not reconstruct that history or automatically reapply any
instruction during a restore. For matching in an isolated restored database,
calculate the same kind-prefixed hash from restored account/client IDs; do not
publish the identifiers or hashes. Protect the independent evidence through
recovery and include its custody in any future off-server backup design.

No automatic erasure-evidence pruning is implemented. Set a reviewed retention
window after inventorying **all** existing snapshots, including old manual backups,
copies retained after failures and copies made elsewhere. Keep required suppression
identifiers until every eligible snapshot predating the instruction has expired;
the new seven-successful-day policy alone cannot establish that. Do not put erased
narrative/content into ledger evidence. Record owner, location, access, inventory
and expiry decision in `docs/privacy-operations.md`.

For a recovery, verify hashes, restore in isolation, compare the snapshot cutoff
with the independent evidence, and check every retained erasure instruction for
matching restored subjects. Apply suppression even when an instruction predates
the snapshot: cleanup may have been pending or its transaction uncommitted when
the database snapshot began. Also reapply later corrections and current
restrictions to the database and corresponding originals/previews. Revoke restored
sessions/recovery tokens, review credentials and outbound integrations, and test
that deleted/restricted records and files cannot be accessed. Record reviewer,
cutoff, instruction range, counts, result and release decision without erased
content. Only a reviewed, verified candidate may replace production through a
separately approved recovery procedure. If ledger completeness is uncertain, keep
the restored service closed and resolve it; a successful technical restore does
not clear this barrier. Expiry/suppression policy must be reviewed before making
public retention or compliance claims.

## Verification

```sh
python3 -m unittest discover -s ops -p test_backup.py -v
```

Temporary fixtures exercise actual runner sequencing through a fake Docker CLI:
successful restore, missing preview, failed dump restore, wrong project/volume,
scratch-label refusal, archive traversal/links/truncation/size mismatch, overlapping
run, safe retention, unchanged previous success and absence of environment secrets.
Root Linux runs also check actual file/link permission refusal. A production-like
Linux rehearsal using disposable Docker PostgreSQL/artwork remains required to
verify the real CLI, restored schema, resource permissions and cleanup. Record
that evidence separately; unit fixtures do not establish production readiness.
