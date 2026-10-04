# Problem reports and account diagnostics

The shared report dialog is available in workspace and authentication headers,
route error screens, and a fallback action on pages without a header. It opens
without navigation or submitting a business form. Workspace refresh waits while
the dialog is open; account changes still clear private workspace views.

Opening the dialog freezes a UTC click time, browser timezone, canonical page
pattern, view and validated calendar anchor, device category, connection/sync
state and up to twenty recent safe error references. The artist writes the
description. No screenshot, form contents, record IDs, notes, artwork, cookies,
passwords, OAuth parameters, raw user agents, error messages or stacks are
automatically collected. The form asks artists to leave private details out of
their descriptions. Unsigned reports remain anonymous.

The server verifies the session and pins submissions to the account where they
were opened. A changed account returns 409 and requires explicit review. The
client preserves the description and original context on failed/offline sends;
an unchanged retry has the same request ID and returns the original reference.
Editing an attempted description starts a new request ID. Drafts live in browser
memory, not local storage, and are lost if the tab is closed or reloaded.

## Storage and access

Set `DIAGNOSTICS_DIR` to a private persistent directory. Local startup resolves
the default `.data/diagnostics` outside the build. Docker mounts `/data/diagnostics`
as its own named volume. The directory has mode 700 and files mode 600 on Linux.
Set `TINTA_RELEASE` to the deployed commit so events identify their release.

Daily `diagnostics-YYYY-MM-DD.jsonl` files contain safe sign-in outcomes,
appointment saves, upload outcomes, action/browser/page errors, sync failures
and recovery. Daily `reports-YYYY-MM-DD.jsonl` files contain artist-written
reports and their attached metadata. Only operators with filesystem access can
read either stream: the two web endpoints support intake by POST, never reading.

Files older than thirty calendar days are pruned on the next write. Diagnostics
are capped at 10 MiB per day; reports at 5 MiB/1000 reports per day. Intake has strict
origin/schema/size checks and transient network/account rate limits. Automatic
logging waits at most 500 ms and fails safely; a report is acknowledged only after
its append completes. Failed storage returns 503 and keeps the report for retry.

The file writer serializes writes inside the single deployed Node instance.
Report IDs are deduplicated per authenticated account, including after restart.
Do not run multiple writers against the same log volume. A future deployment
with multiple instances needs transactional storage or a separate log service.
Client timestamps and context are observations, not proof of server execution;
server events and `receivedAt` provide the authoritative account/time evidence.

Inspect a report and nearby account events:

```sh
node scripts/read-diagnostics.mjs --report REPORT_REFERENCE --directory PRIVATE_LOG_FOLDER
```

For the Docker app, use the reviewed Compose file and environment:

```sh
docker compose --env-file production.env exec -T app node scripts/read-diagnostics.mjs --report REPORT_REFERENCE
```

Use `--artist ACCOUNT_ID` instead for that account’s last 24 hours. Anonymous
reports only link their supplied error references; they do not merge every
anonymous visitor’s history. Reports trigger no email or external notification.

## Verification

`scripts/verify-diagnostics.mjs` covers context/secret rejection, safe error
classification, file limits and retention, unavailable storage, account-scoped
deduplication after restart, request size/origin and rate checks.
`tests/problem-reports.spec.ts` exercises real browser/API flows against a
guarded disposable database, including lost responses, account isolation,
offline retry, retained appointment drafts and saves during storage failure.
