// Prisma 7 configuration (AGENT.md §1, SPEC §5).
//
// Prisma 7 does NOT auto-load `.env` — we load it explicitly here (and again at
// app/worker/seed bootstrap) via dotenv before `env()` resolves DATABASE_URL.
// The datasource URL lives here (not in schema.prisma) in Prisma 7, and the
// `seed` command is wired so `prisma db seed` runs the idempotent TS seeder.
import { config as loadEnv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

loadEnv();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
