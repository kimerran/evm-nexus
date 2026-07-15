# Database & migration conventions

Read before any schema change (referenced by the auto-dev workflow).

## Tooling

- Prisma 7 with the `prisma-client` generator and the `@prisma/adapter-pg`
  driver adapter. Datasource + explicit `.env` loading are configured in
  `prisma.config.ts` (Prisma 7 does **not** auto-load `.env`).

## Local vs. production

- **Local**: `pnpm prisma migrate dev` to create/apply migrations, then
  `pnpm prisma db seed`.
- **Production**: migrations are **forward-only** — `pnpm prisma migrate deploy`
  on release. Never run `migrate dev` or `db push` against production.

## Conventions

- Migrations are committed under `prisma/migrations/` and are immutable once
  merged; fix a bad migration with a new forward migration, never by editing.
- **Money/units**: amounts are stored as **string (wei)** — never float or
  numeric-money columns (AGENT.md §4).
- **Timestamps**: `createdAt @default(now())` and `updatedAt @updatedAt` on
  mutable rows; store UTC.
- **At-rest encryption**: `Network.rpcUrl` credentials and persisted keystore
  blobs are encrypted app-layer (AES via `ENCRYPTION_KEY`) or with pgcrypto.
- The seed (`prisma/seed.ts`) is idempotent (upserts) and safe to re-run.
