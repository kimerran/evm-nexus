import Link from 'next/link';
import { Button, IconButton, Input } from '@/components/ui';
import { TopNavLink } from './nav-item';
import { topNav } from './nav-config';

/**
 * TopNavBar (BRAND §6.1): h-16 sticky, surface-container-lowest, bottom hairline.
 * Left = logotype + secondary links; right = search, icon actions, Connect
 * Wallet CTA, avatar. Links hide under md, search under lg (BRAND §6.1).
 */
export function TopNav() {
  return (
    <header className="sticky top-0 z-50 flex h-16 items-center gap-lg border-b border-outline-variant bg-surface-container-lowest px-md md:px-margin-desktop">
      <div className="flex items-center gap-lg">
        <Link href="/dashboard" className="headline-md text-primary-fixed-dim">
          EVM Nexus
        </Link>
        <nav aria-label="Secondary" className="hidden items-center gap-md md:flex">
          {topNav.map((entry) => (
            <TopNavLink key={entry.href} label={entry.label} href={entry.href} />
          ))}
        </nav>
      </div>

      <div className="ml-auto flex items-center gap-sm">
        <div className="hidden lg:block">
          <Input
            type="search"
            leadingIcon="search"
            placeholder="Search tx, address, block…"
            aria-label="Search"
            className="w-64 py-2"
          />
        </div>
        <IconButton icon="settings" aria-label="Settings" />
        <IconButton icon="notifications" aria-label="Notifications" />
        <Button variant="primary" icon="account_balance_wallet" className="hidden sm:inline-flex">
          Connect Wallet
        </Button>
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container code-sm font-bold"
        >
          OP
        </span>
      </div>
    </header>
  );
}
