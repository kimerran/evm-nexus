import type { ReactNode } from 'react';
import { getCurrentRole } from '@/lib/auth/role';
import { ToastProvider } from '@/components/ui';
import { TopNav } from '@/components/shell/top-nav';
import { SideNav } from '@/components/shell/side-nav';
import { AmbientBackground } from '@/components/shell/ambient-background';

/**
 * Authenticated app shell (SPEC §7, BRAND §6): sticky TopNav + fixed SideNav +
 * ambient glow, with the main canvas offset by the sidebar width.
 *
 * TODO(Sprint 1 — Auth): `getCurrentRole()` is a typed stub. Replace with the
 * real session role and gate this whole segment behind an auth check in proxy.ts
 * + a server-side re-check (AGENT.md §5).
 */
export default function AppShellLayout({ children }: { children: ReactNode }) {
  const role = getCurrentRole();

  return (
    <ToastProvider>
      <AmbientBackground />
      <TopNav />
      <SideNav role={role} />
      <main className="custom-scrollbar min-h-[calc(100vh-4rem)] px-md py-lg md:ml-64 md:px-margin-desktop">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </ToastProvider>
  );
}
