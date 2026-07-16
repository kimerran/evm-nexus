import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui';
import { getSession } from '@/lib/auth/session';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Sign in — EVM Nexus',
  description: 'Operator console access.',
};

// Auth state is per-request; never statically cache the login page.
export const dynamic = 'force-dynamic';

/**
 * Public login screen (SPEC §8.1, BRAND §6/§7). Lives in the `(auth)` route
 * group — OUTSIDE the authenticated `(app)` shell — so it renders on the bare
 * root layout with no nav/session requirement. An already-authenticated visitor
 * is bounced straight to the dashboard.
 */
export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect('/dashboard');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-md py-lg">
      <div className="w-full max-w-[24rem]">
        <div className="mb-lg text-center">
          <div className="mb-sm inline-flex items-center gap-xs">
            <span className="display-lg text-2xl font-extrabold text-on-surface">EVM Nexus</span>
          </div>
          <p className="code-xs uppercase tracking-widest text-on-surface-variant">
            Operator Console
          </p>
        </div>

        <Card className="p-lg">
          <h1 className="mb-md text-lg font-bold text-on-surface">Sign in</h1>
          <LoginForm />
        </Card>

        <p className="mt-lg text-center code-xs text-on-surface-variant">
          Authorized operators only. All access is logged.
        </p>
      </div>
    </main>
  );
}
