// GET /api/health — PUBLIC liveness/readiness probe (SPEC §8.11, §14).
//
// Reflects the REAL status of the app's runtime dependencies: Postgres, Redis
// and the active-network RPC. Each is probed under a timeout and reduced to a
// single verdict — 200 when all are up, 503 when any is down — with a
// per-dependency breakdown so an orchestrator (and humans) can see WHICH
// dependency failed. No auth: this is the container health target. Failure
// detail is a coarse, secret-free label (see lib/health/readiness) — never a
// connection string or stack.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getRedis } from '@/lib/redis';
import { getPublicClient } from '@/lib/chain/resolver';
import { aggregateReadiness, runCheck, type ReadinessChecks } from '@/lib/health/readiness';

// Nothing here may be evaluated at build time (it dials live dependencies).
export const dynamic = 'force-dynamic';

/** Probe Postgres with a trivial round-trip. */
async function checkDb(): Promise<unknown> {
  return prisma.$queryRaw`SELECT 1`;
}

/** Probe Redis with PING. */
async function checkRedis(): Promise<unknown> {
  return getRedis().ping();
}

/** Probe the active-network RPC with a cheap chainId read. */
async function checkRpc(): Promise<unknown> {
  const client = await getPublicClient();
  return client.getChainId();
}

export async function GET(): Promise<NextResponse> {
  const [db, redis, rpc] = await Promise.all([
    runCheck(checkDb),
    runCheck(checkRedis),
    runCheck(checkRpc),
  ]);

  const checks: ReadinessChecks = { db, redis, rpc };
  const report = aggregateReadiness(checks);

  return NextResponse.json(
    {
      status: report.status,
      service: 'web',
      checks: report.checks,
      timestamp: new Date().toISOString(),
    },
    { status: report.httpStatus },
  );
}
