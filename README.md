# Tinta · Tattoo artist workspace

An artist's private workspace for one tattoo studio: appointments, clients, artwork and manually recorded deposits. Built from the [TattoAppointement project](https://github.com/ExperimentalSkid/TattoAppointement).

Tinta is the application name. Artists choose their own studio name in Settings. The interface supports Spanish and English, with Spain defaults, euro amounts and appointment scheduling in Europe/Madrid.

The dark editorial interface uses six shared layout primitives, open sections and artwork-led detail pages. See [the design system](docs/design-system.md) for the audit, tokens and rules for extending it.

## Product scope

- One private artist account per installation, with email/password and optional Google sign-in.
- Optional password recovery by email through Resend, with single-use reset links and session revocation.
- Day, week and month calendars with client details, appointment status and overlap confirmation.
- Clients with search, contact details, notes and appointment history.
- Private artwork library with original files, optimized previews and reusable design selections.
- Client directory with real appointment artwork, next/last-completed booking context and labelled appointment history counts, with responsive editorial rows.
- Appointments with optional references, a final design, price, deposit and manual payment history. Date and time use the studio's Madrid timezone.
- Booking drafts survive adding a client or importing artwork. Field-specific errors preserve entered values; focused rescheduling identifies conflicts before an explicit override. Confirmed cancellation frees the calendar slot and preserves history.
- Studio profile, artist preferences and persistent language selection.
- Optional manual WhatsApp appointment reminders with a customizable template in Settings. Client, date, time and studio placeholders fill in appointment details; the artist reviews the message and presses Send in WhatsApp. No WhatsApp API account or messaging fees are required.
- A private download of the artist's client, appointment, design metadata and payment records.
- Responsive desktop workspace and mobile navigation; installable PWA metadata and static asset caching.
- Ownership checks on records and private image requests; authenticated responses are not publicly cached.

Payments are a manual record of money received. This project does not charge cards, generate invoices, offer customer accounts/public booking or handle medical/consent records. A database constraint permits one artist account, and registration closes after that owner exists. Password and Google credentials link to that same account.

## Stack

Next.js 16 · React 19 · TypeScript · PostgreSQL 17 · Prisma 7 · Better Auth · Sharp · Playwright. Use Node.js 22.18 or newer; the container and CI use Node.js 22.

## Run locally

1. Copy `.env.example` to `.env`. Generate a secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`, then replace `BETTER_AUTH_SECRET`. Set `STUDIO_OWNER_EMAIL` to the artist's actual email. Keep `.env` private.
2. Run PostgreSQL 17. With Docker installed, `docker compose -f compose.dev.yaml up -d --wait` creates an isolated development database at `localhost:5432` matching the example URL.
3. Install and prepare the database:

```sh
npm ci
npm run db:generate
npm run db:deploy
```

4. Run `npm run dev` and open [localhost:3000](http://localhost:3000). Create an artist account and configure the studio in Settings.

For an existing PostgreSQL installation, set `DATABASE_URL` to its own empty application database. Prisma's configuration is `prisma.config.ts`. `db:deploy` applies checked-in migrations; `db:migrate` is only for authoring migrations during development.

## Verification

```sh
npm run test:unit
npm run lint
npm run typecheck
npm run build
npm run test:integration
```

Install the browser once with `npx playwright install chromium`. Browser tests require a disposable migrated database whose name ends in `_e2e`, `ALLOW_TEST_DB_RESET=true`, `STUDIO_OWNER_EMAIL=owner@example.com`, and `BETTER_AUTH_URL=http://127.0.0.1:3000`. Each test resets the disposable database to represent a fresh single-artist installation. The reset fixture rejects normal studio databases. Never point QA at a real studio; restore your normal `.env` before resuming development. Leave Google/Resend credentials blank in QA to avoid external authentication or mail. See the launch guide for the complete QA procedure.

GitHub Actions installs the locked dependencies, audits advisories, migrates PostgreSQL, checks lint/types, builds the app, runs browser workflows and builds the application/migration container images. Failure traces are retained for seven days.

## Production

See [the launch guide](docs/launch.md) for Docker deployment, HTTPS, persistent artwork storage, registration closure, backups and release checks. A Node.js server and persistent disk are required. Static hosting cannot serve authentication, server actions or the database.

`GET /api/health` returns `200 {"status":"ready"}` when the database and migrated user table are available, or `503 {"status":"unavailable"}`. It does not expose records or connection information. Design images require a current artist session and use `private, no-store` caching.

Set `RESEND_API_KEY` and `EMAIL_FROM` to enable password recovery. Without a configured mail provider, the recovery link is hidden and the recovery page explains that email recovery is unavailable. Email unit checks use a mocked transport and never send messages.

For Google, configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and the owner's `STUDIO_OWNER_EMAIL`. A password-created owner connects Google in Settings after signing in. A Google-created owner can add a password in Settings. See the launch guide for Google Cloud callback configuration.

The dependency overrides for Prisma's `mysql2` and `deepmerge-ts` pin patched transitive versions. Revisit the overrides when Prisma updates its own dependency pins. Keep Node, container base images and the lockfile maintained.
