// Vitest global setup — loads the local `.env` into `process.env` before any
// test module evaluates. Several server modules (e.g. `lib/db.ts`) call
// `getEnv()` at import time (Prisma 7 does NOT auto-load `.env`), so unit tests
// that transitively import them — and every `*.integration.test.ts` that talks
// to the real Postgres/Redis/anvil — need the env present up front.
//
// dotenv does NOT override variables already set in `process.env`, so CI (which
// injects throwaway values at the job level) always wins over the committed
// `.env`. `quiet` keeps the loader banner out of the test output.
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('./.env', import.meta.url)), quiet: true });
