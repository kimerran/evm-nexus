// Roles & server-side authorization (SPEC §12, AGENT.md §5).
//
// Authorization is enforced in code on every server action / route handler —
// never via hidden UI. `getSession()` (session.ts) is the single source of
// truth; the helpers here turn a session into a role check. `role.ts` imports
// session.ts only lazily (dynamic import) so the shell components and the pure
// token module can import the `Role` TYPE without pulling in Prisma at module
// load.
export type Role = 'ADMIN' | 'USER';

/**
 * Current user's role from the live session, or `null` when unauthenticated.
 * Replaces the Sprint 0 stub with the real jose-cookie → Session → user lookup.
 */
export async function getCurrentRole(): Promise<Role | null> {
  const { getSession } = await import('./session');
  const session = await getSession();
  return session?.user.role ?? null;
}

/** True when `role` satisfies the `required` role (ADMIN also satisfies USER). */
export function roleSatisfies(role: Role, required: Role): boolean {
  if (required === 'USER') return role === 'USER' || role === 'ADMIN';
  return role === 'ADMIN';
}
