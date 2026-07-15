/**
 * Role placeholder for the app shell's RBAC-aware navigation.
 *
 * TODO(Sprint 1 — Auth & Security Spine): replace `getCurrentRole()` with the
 * real session lookup (jose-signed cookie → user → role, re-checked server-side
 * per AGENT.md §5). Until then this returns a typed stub so admin-only nav items
 * can already be hidden for the USER role without any auth wiring.
 */
export type Role = 'ADMIN' | 'USER';

/** Stubbed current-user role. Defaults to USER so admin items stay hidden. */
export function getCurrentRole(): Role {
  return 'USER';
}
