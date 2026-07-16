import type { Role } from '@/lib/auth/role';
import { NavItem } from './nav-item';
import { NetworkStatus } from './network-status';
import { primaryNav, secondaryNav, visibleFor } from './nav-config';

/**
 * SideNavBar (BRAND §6.1): w-64, fixed under the top bar, surface-container fill,
 * right hairline border. Network status on top, primary nav in the middle,
 * utility nav pinned to the bottom. Admin-only items are hidden for USER.
 */
export function SideNav({ role }: { role: Role }) {
  const primary = visibleFor(primaryNav, role);
  const secondary = visibleFor(secondaryNav, role);

  return (
    <aside className="fixed left-0 top-16 hidden h-[calc(100vh-4rem)] w-64 flex-col border-r border-outline-variant bg-surface-container md:flex">
      <div className="p-md">
        <NetworkStatus />
      </div>

      <nav aria-label="Primary" className="custom-scrollbar flex-1 space-y-1 overflow-y-auto px-md">
        {primary.map((entry) => (
          <NavItem key={entry.href} label={entry.label} href={entry.href} icon={entry.icon} />
        ))}
      </nav>

      <nav aria-label="Utilities" className="mt-auto space-y-1 border-t border-outline-variant p-md">
        {secondary.map((entry) => (
          <NavItem key={entry.href} label={entry.label} href={entry.href} icon={entry.icon} />
        ))}
      </nav>
    </aside>
  );
}
