import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth/session';
import { UsersTable } from './users-table';
import type { UserView } from './users-table';

export const metadata: Metadata = {
  title: 'Users — EVM Nexus',
};

export const dynamic = 'force-dynamic';

/**
 * /settings/users (SPEC §7) — ADMIN-only user management: activate/deactivate,
 * change role, reset password. Role is re-checked server-side here (a USER who
 * navigates straight to the URL is redirected), independent of the RBAC-aware
 * nav and proxy.ts. Mutations run through the ADMIN + CSRF /api/users endpoints.
 */
export default async function UsersPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.user.role !== 'ADMIN') redirect('/dashboard');

  const rows = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, username: true, role: true, isActive: true, createdAt: true },
  });

  const users: UserView[] = rows.map((u) => ({
    id: u.id,
    username: u.username,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-xl">
      <header className="space-y-1">
        <h1 className="display-lg text-on-surface">Users</h1>
        <p className="body-md text-on-surface-variant">
          Activate or deactivate accounts, change roles, and reset passwords. Every action is
          audited.
        </p>
      </header>

      <UsersTable initialUsers={users} currentUserId={session.user.id} />
    </div>
  );
}
