import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { ToastProvider } from '@/components/ui';
import { TopNav } from '@/components/shell/top-nav';
import { SideNav } from '@/components/shell/side-nav';
import { AmbientBackground } from '@/components/shell/ambient-background';

/**
 * Authenticated app shell (SPEC §7, BRAND §6): sticky TopNav + fixed SideNav +
 * ambient glow, with the main canvas offset by the sidebar width.
 *
 * Auth gate (AGENT.md §5, SPEC §12): this whole segment requires a valid
 * session, re-checked server-side here (proxy.ts is defense-in-depth only). An
 * unauthenticated request is redirected to /login before any app UI renders,
 * and the real session role drives the RBAC-aware navigation.
 */
export default async function AppShellLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  return (
    <ToastProvider>
      <AmbientBackground />
      <TopNav />
      <SideNav role={session.user.role} />
      <main className="custom-scrollbar min-h-[calc(100vh-4rem)] px-md py-lg md:ml-64 md:px-margin-desktop">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </ToastProvider>
  );
}
