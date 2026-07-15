// AuditLog writer — the single reusable helper for privileged-action logging
// (SPEC §5 AuditLog, §8.11, §13).
//
// SERVER-ONLY. Every privileged mutation (user activate/deactivate, role change,
// password reset, API-key issue/revoke, and — after #7 merges — network
// mutations) records exactly one row through here, so the audit trail has one
// authoritative shape and one place that enforces the security invariants:
//
//   • NEVER put secrets in `metadata`. No passwords, password hashes, raw API
//     keys, key hashes, tokens, or private keys. Callers pass only non-secret
//     context (ids, names, before/after role/isActive, prefixes). This helper
//     does not and cannot scrub secrets — keeping them out is the caller's
//     contract, restated at every call site.
//   • Best-effort: a failed audit write is logged (redacted) but never throws,
//     so telemetry can never break the privileged action it describes. The
//     happy path (proven live) records the row.
import type { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/log';

/** The resource a privileged action acted on (maps to targetType/targetId). */
export interface AuditTarget {
  /** Resource kind, e.g. `"user"`, `"apiKey"`. */
  type: string;
  /** Resource id. */
  id: string;
}

export interface WriteAuditInput {
  /** Id of the acting principal (null for unauthenticated/system events). */
  actorId?: string | null;
  /** Stable action verb, e.g. `"user.deactivate"`, `"apiKey.issue"`. */
  action: string;
  /** Optional resource the action targeted. */
  target?: AuditTarget;
  /** Non-secret structured context. NEVER secrets (see module note). */
  metadata?: Record<string, unknown>;
  /** Best-effort client IP (telemetry only; never trusted for authz). */
  ip?: string | null;
}

/**
 * Write one audit row for a privileged action. Best-effort: on a DB error it
 * logs (redacted) and resolves without throwing, so the caller's action is never
 * rolled back by an audit failure.
 */
export async function writeAudit(input: WriteAuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.actorId ?? null,
        action: input.action,
        targetType: input.target?.type ?? null,
        targetId: input.target?.id ?? null,
        ip: input.ip ?? null,
        ...(input.metadata !== undefined
          ? { metadata: input.metadata as Prisma.InputJsonValue }
          : {}),
      },
    });
  } catch (err) {
    // Redacted by lib/log; the raw error object never leaks a credential.
    logger.error({ err, action: input.action }, 'failed to write audit log');
  }
}
