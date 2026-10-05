# Tinta privacy preparation — 5 October 2026

Status: implemented and tested locally. **Not deployed.** The live Tinta site
was not restarted or modified during this pass. This is technical preparation,
not a declaration of complete GDPR compliance.

## Prepared controls

- Public Spanish/English privacy, cookies/storage and legal pages, linked before
  sign-in and throughout the workspace. Missing operator facts are explicitly
  pending; the studio name never substitutes for the legal operator.
- Optional browser diagnostics default off, with separate opt-in and withdrawal,
  consent time/version evidence and server enforcement. Enabling requires complete
  notice facts. Remote withdrawal stops collection even during a protected draft.
  Failed purges remain queued; previous events must be purged before re-enabling.
- Default browser-session sign-in and explicit unchecked 30-day remembered login,
  shared by Google and password access. OAuth tokens and unused avatars are
  discarded. Confirmed logout/account change clears only Tinta appointment drafts.
- Account export now includes profile, safe provider/session metadata and linked
  reports/logs. Individual client exports filter owned linked records. Passwords,
  bearer tokens and physical storage keys never enter either export.
- Account erasure requires recent sign-in, email confirmation and retention review.
  It revokes all sessions and remains pending until private files/logs and database
  cleanup succeed. A minimal pseudonymous late-write marker expires after 30 days.
- Client erasure requires current review/version, recent sign-in and explicit
  retention/artwork review. It preserves shared library artwork for separate review
  and refuses mixed-artist associations.
- Runtime cleanup runs on startup and every 15 minutes while enabled: expired
  auth records, old private logs, queued erasures/withdrawals, dormant Google
  credentials and unreferenced artwork older than 24 hours. Fresh/referenced files
  stay. Private artwork permissions are restricted. Original artwork bytes remain
  intact; upload guidance explains retained metadata and sensitive-data limits.

## Verification

All browser tests used disposable local accounts, an explicitly guarded UTF-8
`tinta_utf8_e2e` database and isolated `.tmp` files. No production user was erased,
exported or modified; no real email/Google request was sent.

- Production build, full TypeScript checking and repository lint: passed.
- Existing unit suite plus 527 focused checks: passed (73 private-store,
  141 auth minimisation, 101 login preference, 50 diagnostics consent,
  134 maintenance and 28 notice-configuration checks).
- Privacy/report browser suite: 22/22 passed.
- Affected login, appointment-draft, workspace-sync and whole-page layout suite:
  14 distinct cases passed across a 13-case run and the corrected sync-contract
  regression rerun. Whole-page coverage includes 360/390/1440px layouts.
- Publication fact check correctly refuses missing operator/contact/hosting/
  transfer information. Configuration checks validate presence, not legal accuracy.

The tests found and corrected raw-query serialization conflicts being reported
as unavailable instead of stale review. SQL fixture timestamps were aligned with
UTC production, and exact test guards for private log failures were preserved.

## Before publication

Supply and verify the legal operator, postal address, establishment country,
privacy contact, server/backup/access countries and actual transfer safeguards.
Complete applicable fiscal/registration/representative details, the artist
processor agreement and provider terms. Assign monitored rights/breach handling,
backup expiry/restoration suppression, proxy-log retention and maintenance alerts.
The operational guide and agreement review identify these decisions; they are
not invented or marked complete.

Run `npm run privacy:check` against verified deployment facts. Review
`docs/privacy-operations.md` and `docs/data-processing-agreement-review.md`.
Apply both new privacy migrations before replacing the app, enable maintenance
only at runtime, and verify production behavior after an approved release.

Backups, provider copies and legally restricted retention are separate procedures:
active-record erasure does not prove removal from every copy. No production
deployment, provider contract or legal review has been represented as complete.
