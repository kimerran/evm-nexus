import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui';
import { getSession } from '@/lib/auth/session';
import { ChangePasswordForm } from './change-password-form';

export const metadata: Metadata = {
  title: 'Profile — EVM Nexus',
};

/**
 * /settings/profile (SPEC §7) — any authenticated user changes their own
 * password. The mutation itself reuses #4's POST /api/auth/change-password
 * (which rotates the current session and revokes all others); this page only
 * renders the form. Session is re-checked server-side (defense-in-depth over
 * proxy.ts + the app-shell gate).
 */
export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className="space-y-xl">
      <header className="space-y-1">
        <h1 className="display-lg text-on-surface">Profile</h1>
        <p className="body-md text-on-surface-variant">
          Signed in as{' '}
          <span className="code-sm text-primary-fixed-dim">{session.user.username}</span> (
          {session.user.role}). Change your account password below.
        </p>
      </header>

      <Card className="max-w-xl">
        <h2 className="headline-md mb-md text-on-surface">Change Password</h2>
        <ChangePasswordForm />
      </Card>
    </div>
  );
}
