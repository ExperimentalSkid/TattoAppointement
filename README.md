# TattoAppointement

A practical tattoo-artist appointment management application for desktop and mobile.

## Implemented product scope

- artist-only email/password accounts with persistent sessions
- artist-owned client records with search, editing, phone-contact picker support where available, and manual fallback
- private design library with image upload, search, full-screen viewing, metadata editing, preserved originals, and optimized previews
- artist-created appointments connecting client, schedule, duration, notes, status, multiple designs, and an optional final design
- day/week calendar with phone and desktop layouts, rescheduling, duration display, and overlap warnings
- deposit tracking with agreed price, required deposit, manual payments, payment history, deposit remaining, total balance, and payment/deposit states
- English and Spanish UI with persistent artist language preference
- responsive navigation and forms designed separately for phone and desktop use
- installable PWA shell with manifest, standalone display, application icon placeholder, service-worker registration, and conservative static-asset caching
- server-side artist ownership checks for client, design, appointment, payment, and private image access

The application intentionally does not include customer accounts, public booking, payment processing, invoicing/accounting, inventory, marketing, consent/medical workflows, or other features outside the defined artist appointment-management scope.

## Stack

- Next.js 16
- React 19
- TypeScript
- PostgreSQL
- Prisma ORM 7
- Better Auth
- Sharp
- Playwright

## Local setup

1. Install Node.js 22 and PostgreSQL.
2. Copy `.env.example` to `.env` and set the database URL, Better Auth secret/URL, and design storage directory as appropriate.
3. Install dependencies:

```bash
npm install
```

4. Apply migrations and generate Prisma Client:

```bash
npm run db:deploy
npm run db:generate
```

5. Start development:

```bash
npm run dev
```

Uploaded design originals/previews are stored under `DESIGN_STORAGE_DIR`; use persistent server storage for production deployments.

## Verification

```bash
npm run test:unit
npm run lint
npm run typecheck
npm run build
npm run test:integration
```

The integration suite exercises responsive layouts and the complete artist workflows against the production build in Chromium, including persistence, overlap warnings, deposits, language persistence, ownership isolation, private image access, and PWA registration.

For browser installation outside local development, serve the application over HTTPS.
