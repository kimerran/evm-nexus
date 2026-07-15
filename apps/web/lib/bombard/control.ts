// Bombard run control — pause / resume / cancel (SPEC §8.7, AGENT.md §5).
// SERVER-ONLY. Shared by the three control route handlers.
//
// The kill-switch semantics: cancel/pause raise a FAST Redis control signal the
// running worker reacts to within a tick, AND set the authoritative DB status so
// GET reflects it immediately even if the worker is between ticks. Resume clears
// the signal, re-enforces per-user concurrency 1, flips PAUSED→RUNNING, and
// re-enqueues the runner (which resumes from the persisted sentCount / last nonce).
import { prisma } from '@/lib/db';
import { getRedis } from '@/lib/redis';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { canApplyAction, type BombardAction } from './policy';
import { bombardControlKey } from './keys';
import { publishBombardEvent } from './publish';
import { toBombardRunView, type BombardRunView } from './dto';
import { enqueueBombardRun } from '@/lib/queue/bombard-queue';
import type { BombardRun } from '@/lib/generated/prisma/client';

async function emit(run: BombardRun): Promise<void> {
  await publishBombardEvent({
    runId: run.id,
    status: run.status,
    sentCount: run.sentCount,
    successCount: run.successCount,
    failCount: run.failCount,
    totalCount: run.totalCount,
    targetTps: run.targetTps,
    effectiveTps: null,
    at: new Date().toISOString(),
  });
}

/**
 * Apply a control action to a run the caller owns. Returns the updated run view.
 * Throws 404 (foreign/unknown), 403 (not owner) or 409 (illegal transition /
 * concurrency conflict).
 */
export async function applyBombardControl(
  userId: string,
  runId: string,
  action: BombardAction,
  ip: string | null,
): Promise<BombardRunView> {
  const run = await prisma.bombardRun.findUnique({ where: { id: runId } });
  if (!run) throw new NotFoundError('Bombard run not found.');
  if (run.userId !== userId) throw new ForbiddenError('This bombard run belongs to another user.');
  if (!canApplyAction(run.status, action)) {
    throw new ConflictError(`Cannot ${action} a run in status ${run.status}.`);
  }

  const redis = getRedis();

  if (action === 'cancel') {
    await redis.set(bombardControlKey(runId), 'cancel', 'EX', 24 * 60 * 60);
    const updated = await prisma.bombardRun.update({
      where: { id: runId },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
    await emit(updated);
    await writeAudit({ actorId: userId, action: 'bombard.cancel', target: { type: 'BombardRun', id: runId }, ip });
    return toBombardRunView(updated);
  }

  if (action === 'pause') {
    await redis.set(bombardControlKey(runId), 'pause', 'EX', 24 * 60 * 60);
    const updated = await prisma.bombardRun.update({
      where: { id: runId },
      data: { status: 'PAUSED' },
    });
    await emit(updated);
    await writeAudit({ actorId: userId, action: 'bombard.pause', target: { type: 'BombardRun', id: runId }, ip });
    return toBombardRunView(updated);
  }

  // resume: re-enforce concurrency 1, clear the control signal, re-enqueue.
  const updated = await prisma.$transaction(async (tx) => {
    const otherActive = await tx.bombardRun.count({
      where: { userId, id: { not: runId }, status: { in: ['RUNNING', 'PAUSED'] } },
    });
    if (otherActive > 0) {
      throw new ConflictError('You already have another active bombard run (concurrency limit is 1).');
    }
    const flipped = await tx.bombardRun.updateMany({
      where: { id: runId, userId, status: 'PAUSED' },
      data: { status: 'RUNNING' },
    });
    if (flipped.count !== 1) throw new ConflictError('Run is no longer resumable.');
    return tx.bombardRun.findUniqueOrThrow({ where: { id: runId } });
  });
  await redis.del(bombardControlKey(runId));
  await enqueueBombardRun(runId, `resume-${Date.now()}`);
  await emit(updated);
  await writeAudit({ actorId: userId, action: 'bombard.resume', target: { type: 'BombardRun', id: runId }, ip });
  return toBombardRunView(updated);
}
