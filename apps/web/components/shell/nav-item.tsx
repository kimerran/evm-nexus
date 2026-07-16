'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui';

export interface NavItemProps {
  label: string;
  href: string;
  icon: string;
}

/**
 * Sidebar nav row (BRAND §6.2). Inactive: muted text + surface hover +
 * active:translate-x-1. Active: secondary-container fill + bold + filled icon.
 */
export function NavItem({ label, href, icon }: NavItemProps) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-sm rounded-lg px-sm py-2.5 transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary',
        active
          ? 'bg-secondary-container font-bold text-on-secondary-container'
          : 'text-on-surface-variant hover:bg-surface-container-high active:translate-x-1',
      )}
    >
      <Icon name={icon} filled={active} className="text-[1.25rem]" />
      <span className="body-md text-sm">{label}</span>
    </Link>
  );
}

/** Top-nav link (BRAND §6.2): active gets primary text + bottom border. */
export function TopNavLink({ label, href }: { label: string; href: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'code-sm border-b-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary',
        active
          ? 'border-primary font-bold text-primary'
          : 'border-transparent text-on-surface-variant hover:text-on-surface',
      )}
    >
      {label}
    </Link>
  );
}
