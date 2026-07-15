// Principal type + the pure authorization decision (SPEC §12).
//
// SERVER-ONLY but dependency-light (only role + typed errors) so the RBAC
// decision is trivially unit-testable without touching Prisma, cookies, or the
// network. `require-role.ts` layers session/API-key resolution on top.
import { roleSatisfies, type Role } from './role';
import { ForbiddenError, UnauthenticatedError } from '@/lib/errors';

/** An authenticated caller, however they authenticated. */
export interface Principal {
  user: { id: string; username: string; role: Role };
  /** How the caller authenticated. */
  via: 'session' | 'api-key';
  /** Session id (only for cookie sessions; enables rotation/revocation). */
  sid?: string;
}

/**
 * Pure authorization decision: enforce that `principal` exists and its role
 * satisfies `required` (ADMIN satisfies USER). Throws
 * {@link UnauthenticatedError} (→ 401) when absent, {@link ForbiddenError}
 * (→ 403) when under-privileged. Returns the principal on success.
 */
export function authorize(principal: Principal | null, required: Role): Principal {
  if (!principal) throw new UnauthenticatedError();
  if (!roleSatisfies(principal.user.role, required)) throw new ForbiddenError();
  return principal;
}
