# Launch and operations

This guide deploys one studio's private artist workspace. Hosting credentials, the final domain, production secrets and a backup destination must be supplied by the studio operator. Payment recording is manual; password recovery has an optional Resend integration that requires the studio's own email service configuration.

## Prepare the server

Use a Linux host with Docker Engine and Compose v2, a domain you control, HTTPS termination and durable storage. Keep database and application containers on a private network. The supplied Compose file publishes the app on loopback port 3000 only; PostgreSQL is not published to the host.

Copy `.env.example` to `.env` and configure:

| Variable | Production value |
| --- | --- |
| `BETTER_AUTH_URL` | The exact HTTPS origin, for example `https://studio.example.com` |
| `BETTER_AUTH_SECRET` | A unique, random secret of at least 32 characters; keep it across releases |
| `POSTGRES_PASSWORD` | A separate random hex password; hexadecimal avoids URL-encoding ambiguity |
| `STUDIO_OWNER_EMAIL` | Required: the single artist's email; Google must verify the same address |
| `DISABLE_SIGN_UP` | `false` to permit the first password account; registration closes automatically once the owner exists |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional Google Web application OAuth credentials; both are required to show Google sign-in |
| `RESEND_API_KEY` | A Resend API key permitted to send recovery messages; optional until email recovery is enabled |
| `EMAIL_FROM` | A sender on a verified domain, such as `Tinta <accounts@studio.example.com>` |

Generate each secret independently with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Do not commit real environment files. The `DATABASE_URL` and `DESIGN_STORAGE_DIR` in Compose are set for the containers; the local example values are not used there.

## Start and update

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 migrate app
```

Compose waits for the database health check, runs `prisma migrate deploy`, and starts the app only after migrations succeed. See [Docker's startup ordering documentation](https://docs.docker.com/compose/how-tos/startup-order/). The application and migration images are separate targets in the Dockerfile. The application uses Next's standalone output and runs as a non-root user. Migration failure leaves the application unstarted: inspect the migration logs and resolve the cause before retrying.

On the host, `curl --fail http://127.0.0.1:3000/api/health` should return `{"status":"ready"}`. This check verifies database/schema availability; also upload and view an artwork file to verify storage. Container health status is an operational signal; Compose does not automatically repair an unhealthy application.

Before a release, take a database and artwork backup, verify changes in staging, and run `docker compose up -d --build`. Database schema changes require a migration-aware recovery plan; an older application image is not a database rollback.

## HTTPS and proxy

Configure your HTTPS proxy to forward to `http://127.0.0.1:3000`, preserve the external `Host` header, and send the correct forwarded host/protocol. `BETTER_AUTH_URL` must match the artist-facing origin. Restrict the proxy upload body to 26 MiB and set an appropriate timeout for image uploads. The app accepts original artwork up to 25 MiB with up to 40 million decoded pixels; previews are at most 1400×1400 pixels. Unsupported or corrupt images return a form error.

Set HTTP Strict Transport Security at the HTTPS proxy once the domain serves HTTPS reliably. Do not place authenticated HTML, API responses or private image routes behind a public cache. Immutable Next static files may be cached. The PWA service worker caches static files and icons; appointment/client data and artwork remain online-only.

## Persistent storage

Compose creates two named volumes: `database` for PostgreSQL and `designs` for private originals and previews. Do not run `docker compose down -v` on a live deployment: that removes these volumes.

`DESIGN_STORAGE_DIR` must be writable by the server process and persist across container replacement. Keep it outside the public web directory. An ephemeral serverless filesystem will lose artwork, even if PostgreSQL survives. The filesystem adapter supports a single app instance with persistent disk; multiple app instances require shared private storage and coordinated operation before scaling.

## Studio setup and access

1. Set `STUDIO_OWNER_EMAIL` before opening the site. Create that artist's account, then choose the studio name and preferred language in Settings.
2. Check a client, upload a design, create a Madrid-time appointment and record a deposit. Sign out and sign back in to confirm persistence.
3. Confirm additional account creation is rejected and `/sign-up` returns to sign-in. The database enforces a single owner even for simultaneous registration attempts. You may additionally set `DISABLE_SIGN_UP=true` and recreate the app with `docker compose up -d app`.
4. Use a password manager and retain a documented support route for artist account recovery. Configure and verify email recovery before relying on it for account access.

## Google sign-in

Google login is optional and belongs to the same owner account. Set the exact owner's email in `STUDIO_OWNER_EMAIL`; other Google accounts and unverified identities are rejected. The Google button is hidden unless both credentials and the owner email are configured.

1. Create/select a project in [Google Cloud Console](https://console.cloud.google.com/). Configure Google Auth Platform's branding and audience. For a personal Gmail owner, use an External audience and add the artist as a test user while the project is in Testing. Follow the console's production/verification requirements before changing the publishing state.
2. Create an OAuth client with application type **Web application**. Register the exact authorized redirect URI `https://studio.example.com/api/auth/callback/google`. For local testing, separately register the origin you actually use, such as `http://127.0.0.1:3000/api/auth/callback/google` or `http://localhost:3000/api/auth/callback/google`; these hosts are distinct.
3. Put its client ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Keep the secret server-side. `BETTER_AUTH_URL` must match the registered artist-facing origin. Recreate the app container after changing these values.
4. If the owner first registered with a password, sign in with that password, then use **Connect with Google** in Settings. This authenticated connection preserves the account and its records without trusting an unverified local email for automatic linking. If the owner first registered with Google, add a password in Settings if desired; it adds a credential to the existing account.
5. Test Google login, logout/login persistence, cancellation/error feedback and rejection of a different Google account. This live verification requires the artist's OAuth credentials and consent and is not simulated by local browser tests.

The application requests identity access, not Gmail, Drive or calendar access. Google's [Web application OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server) describes client setup and exact redirect matching; [Better Auth's Google guide](https://better-auth.com/docs/authentication/google) describes the callback and provider integration. The local button uses official Google branding assets and a small Google Sans font subset.

The single-owner migration refuses databases containing multiple existing users. For an older multi-account deployment, identify the intended owner and migrate their data deliberately; do not delete accounts or studio records as a shortcut to running the migration.

## Disposable browser QA

Create a separate PostgreSQL database named `tinta_e2e`. In the QA environment set its `DATABASE_URL`, `ALLOW_TEST_DB_RESET=true`, `STUDIO_OWNER_EMAIL=owner@example.com`, `BETTER_AUTH_URL=http://127.0.0.1:3000`, and a test-only auth secret. Leave external Google/Resend credentials empty. Apply `npm run db:deploy`, build, and run `npm run test:integration`.

The shared Playwright fixture truncates the disposable user/verification tables and their related records before each test. It refuses to run unless the explicit reset flag is present and the database name ends in `_e2e`. QA covers one-account enforcement, concurrent rejected registrations, anonymous private-resource denial, unknown-record handling and the original appointment/payment workflows. Keep the real studio database on its own name and credentials. Restore the normal environment before starting the studio app again.

## Password recovery email

Verify a sending domain in Resend, set `RESEND_API_KEY` and `EMAIL_FROM`, then recreate the application container. See [Resend's send-email API reference](https://resend.com/docs/api-reference/emails/send-email). The sign-in screen displays the recovery link only when both values are configured. A missing configuration produces an explicit unavailable page and does not pretend to send mail.

On `/forgot-password`, the artist enters their account email. Better Auth creates a one-hour reset token and invokes the Resend integration. The same confirmation is shown for an existing or unknown account. A valid emailed link opens `/reset-password`; the artist enters and confirms a new password. The token is single-use, and a successful reset revokes existing sessions. Expired/invalid links offer a new recovery request. See [Better Auth's password recovery documentation](https://better-auth.com/docs/authentication/email-password).

With a studio-controlled test account, verify delivery and spam-folder behavior, successful reset, sign-in with the new password, rejection of the old password and rejection of a reused link before launch. This delivery check requires the studio's real provider credentials and authorization to send test mail; it is not performed by local tests. Monitor the generic `Password recovery email delivery failed` server event and provider delivery status. Application logs omit the email address and reset token.

A studio operator should define retention, staff access and the client privacy notice before entering real client data. Do not place medical details or consent documents in appointment notes. Consult the [Spanish data protection authority's guidance](https://www.aepd.es/guias/guia-privacidad-y-seguridad-en-internet.pdf) for privacy and security practices; technical checks do not establish legal compliance.

## Backup and restore

Back up PostgreSQL and design files together. For a consistent pair, stop artist writes briefly by stopping `app`, create the dump, copy the design directory, and restart `app`:

```sh
docker compose stop app
docker compose exec -T db pg_dump -U tinta -d tatto_appointement -Fc -f /tmp/studio.dump
docker compose cp db:/tmp/studio.dump ./studio.dump
docker compose cp app:/data/designs ./designs-backup
docker compose start app
```

Use a dated backup directory so every backup preserves a matched database/artwork pair. Store encrypted copies off the host with restricted access. Schedule backups through your hosting provider or server operations system and monitor failures. Keep the auth secret and database credentials in a separate secure recovery record.

Restore into a separate staging deployment before trusting a backup. Copy the dump into its database container, restore into an empty database with `pg_restore -U tinta -d tatto_appointement --no-owner --exit-on-error /tmp/studio.dump`, then restore the matching design directory with correct server permissions. Verify sign-in, client history, deposits, original and preview image access before switching traffic. PostgreSQL's [backup documentation](https://www.postgresql.org/docs/17/backup-dump.html) describes dump/restore behavior; Docker's [Compose copy reference](https://docs.docker.com/reference/cli/docker/compose/cp/) covers copying from stopped containers.

## Release checks

- Lockfile install, dependency audit, unit checks, lint, type check, production build and browser workflows pass.
- HTTPS works on phone and desktop; both languages and the studio name persist after sign-in.
- Private routes and artwork reject an anonymous session and another artist's account.
- Migrations apply from an empty database and the readiness endpoint responds.
- Artwork persists after replacing the app; a matched backup restores into staging.
- Registration is closed after the intended artist account exists; production secrets are unique and excluded from source control.

Docker image builds run in CI. If Docker is unavailable on the development computer, container behavior still needs that CI run or a staging deployment before launch.
