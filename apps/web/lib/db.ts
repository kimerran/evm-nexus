// Prisma Client singleton (AGENT.md §2/§4, SPEC §5).
//
// SERVER-ONLY. All database access flows through this single instance. Prisma 7
// has no Rust engine; it connects through the `@prisma/adapter-pg` driver
// adapter over the `pg` pool. A single client per process reuses one connection
// pool; in dev we stash it on globalThis so Next.js/HMR module reloads don't
// spawn a new pool (and exhaust Postgres connections) on every edit.
import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { getEnv } from '@nexus/config/env';

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: getEnv().DATABASE_URL });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (getEnv().NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
