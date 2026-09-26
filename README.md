# TattoAppointement

A practical tattoo-artist appointment management application for desktop and mobile.

## Current implementation

Pass 1 establishes the application foundation only:

- artist email/password authentication with persistent sessions
- PostgreSQL + Prisma data model
- artist ownership fields and server-side session helpers
- responsive desktop sidebar and mobile bottom navigation
- English and Spanish translation architecture
- persistent artist language preference
- route shells for Calendar, Clients, Designs, New Appointment and Settings
- CI validation against PostgreSQL, lint, TypeScript and production build

The functional Clients, Designs, Appointments, Calendar and Deposits modules are intentionally left for their corresponding implementation passes and are not represented as completed features.

## Stack

- Next.js 16
- React 19
- TypeScript
- PostgreSQL
- Prisma ORM 7
- Better Auth

## Local setup

1. Install Node.js 22 and PostgreSQL.
2. Copy `.env.example` to `.env` and replace the database URL and auth secret.
3. Install dependencies:

```bash
npm install
```

4. Apply the database migration and generate Prisma Client:

```bash
npm run db:deploy
npm run db:generate
```

5. Start development:

```bash
npm run dev
```

## Verification

```bash
npm run lint
npm run typecheck
npm run build
```

GitHub Actions runs the same verification with a clean PostgreSQL service.
