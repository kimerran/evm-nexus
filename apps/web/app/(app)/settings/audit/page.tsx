import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { AuditViewer } from './audit-viewer';

export const metadata: Metadata = {
  title: 'Audit Log — EVM Nexus',
};

/**
 * /settings/audit (SPEC §8.11) — ADMIN-only, paginated audit viewer over
 * GET /api/audit. Role is re-checked server-side here (a USER is redirected);
 * the endpoint independently enforces ADMIN (403 for a USER). Rows never contain
 * secrets — the writer (lib/audit) keeps them out of metadata.
 */
export default async function AuditPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.user.role !== 'ADMIN') redirect('/dashboard');

  return (
    <div className="space-y-xl">
      <header className="space-y-1">
        <h1 className="display-lg text-on-surface">Audit Log</h1>
        <p className="body-md text-on-surface-variant">
          Immutable record of privileged actions. Metadata never contains secrets.
        </p>
      </header>

      <AuditViewer />
    </div>
  );
}
