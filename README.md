# TattoAppointement

A practical tattoo-artist appointment management application for desktop and mobile.

## Current implementation

### Pass 1 — Foundation

- artist email/password authentication with persistent sessions
- PostgreSQL + Prisma data model
- artist ownership boundaries enforced through server-side session-derived artist IDs
- responsive desktop sidebar and mobile bottom navigation
- English and Spanish translation architecture with persistent preference
- CI validation against PostgreSQL, lint, TypeScript and production build

### Pass 2 — Clients

- artist-scoped client creation, editing and search
- manual client entry everywhere
- native phone Contact Picker where the browser/device supports it
- normalized phone numbers and existing-client reuse protection
- client appointment history
- responsive phone and desktop client workspace

### Pass 3 — Design Library

- artist-scoped image library and search
- phone gallery/file uploads using the normal browser/device picker
- actual decoded-image validation and upload size limits
- original image preservation plus generated preview and thumbnail variants
- protected image delivery through authenticated routes
- full-screen design preview
- design title/notes editing
- existing appointment-design association architecture retained for appointment implementation

Appointments, Calendar and Deposits remain intentionally unimplemented until their corresponding passes.

## Stack

- Next.js 16
- React 19
- TypeScript
- PostgreSQL
- Prisma ORM 7
- Better Auth
- Sharp for server-side image validation and preview/thumbnail generation

## Local setup

1. Install Node.js 22 and PostgreSQL.
2. Copy `.env.example` to `.env` and replace the database URL and auth secret.
3. Ensure `UPLOAD_DIR` points to writable persistent storage. The default is `./data/uploads`.
4. Install dependencies:

```bash
npm install
```

5. Apply the database migration and generate Prisma Client:

```bash
npm run db:deploy
npm run db:generate
```

6. Start development:

```bash
npm run dev
```

## Image storage

Design image bytes are not stored in the database and are not exposed as public static files. `UPLOAD_DIR` contains the original uploads plus generated preview/thumbnail variants. Production deployments must mount this path on persistent storage so image files survive application restarts or container replacement.

## Verification

```bash
npm run lint
npm run typecheck
npm run build
```

GitHub Actions runs the same verification with a clean PostgreSQL service.
