// Prisma client for the worker process (AGENT.md §2/§4).
//
// Reuses the SAME generated client the web app uses (single schema, single
// source of truth) via the driver adapter over pg. One instance per worker
// process. Imported from the web app's generated output — the worker shares the
// DB, so it must share the client.
import { PrismaClient } from '../../apps/web/lib/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { getEnv } from './config';

const adapter = new PrismaPg({ connectionString: getEnv().DATABASE_URL });

export const prisma = new PrismaClient({ adapter });

export type WorkerPrisma = typeof prisma;
