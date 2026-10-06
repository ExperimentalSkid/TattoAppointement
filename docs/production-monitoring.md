# Tinta monitoring

`ops/monitor.py` checks only the dedicated `/srv/tinta` deployment. It never
restarts services, changes configuration or repairs data. Run every five minutes
using the supplied `tinta-monitor` systemd units. Install reviewed files as root,
create `/srv/tinta/ops/state` with mode 0700, and use `systemd-analyze verify`
before enabling timers. Keep the files outside the application source deployment
so replacing an application image cannot remove monitoring.

Checks cover:

- Compose project/service ownership, expected named volumes, and healthy app/DB.
- Loopback and public HTTPS readiness without redirects, cookies or credentials.
- Free bytes and inodes on the application and private storage filesystems.
- Latest restore-verified backup age, failed jobs, stuck jobs and retention errors.
- A private heartbeat written after each runtime privacy-maintenance pass. Failed
  or unfinished cleanup cannot advance its last successful timestamp.

The default low-storage thresholds are 2 GiB or 10% available space, and 10%
available inodes. Backups become stale after 30 hours. Privacy maintenance becomes
stale after 45 minutes. These are operational defaults for the pilot.

Every run atomically saves a small, root-only `/srv/tinta/ops/state/monitor.json`.
The summary contains fixed failure categories and timestamps, never account IDs,
client data, Google credentials, raw exceptions or log contents. Status changes
also enter the systemd journal. An unhealthy check exits unsuccessfully so the
service status is visible to the operator; a later healthy run can clear it.

Read current status:

```sh
python3 /srv/tinta/ops/monitor.py --status
systemctl status tinta-monitor.timer tinta-backup.timer
journalctl -u tinta-monitor.service --since today
```

No external notification recipient or off-server backup destination has been
provided. The summary explicitly reports `notificationDelivery: unconfigured`
and `offsiteBackup: false`. Journal entries are not delivered alerts. This monitor
runs on the same server as Tinta: a complete server/network outage prevents the
monitor from running. Add an independent external uptime checker and a reviewed
alert destination before treating whole-server outages as covered. Do not expose
private status files through Nginx or an unauthenticated application endpoint.

The privacy heartbeat is operational metadata, separate from optional artist
diagnostics. It contains only status and timestamps, and is not publicly served.
If that file cannot be written, the application emits a generic error and the
monitor detects a stale or missing heartbeat.
