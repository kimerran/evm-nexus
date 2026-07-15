import type { Role } from '@/lib/auth/role';

export interface NavEntry {
  label: string;
  href: string;
  /** Material Symbol glyph (BRAND §4). */
  icon: string;
  /** Restrict to a role; omit for all authenticated users. */
  role?: Role;
}

/** Primary sidebar navigation (SPEC §7 shell). */
export const primaryNav: NavEntry[] = [
  { label: 'Dashboard', href: '/dashboard', icon: 'space_dashboard' },
  { label: 'Faucet', href: '/faucet', icon: 'water_drop' },
  { label: 'Keypairs', href: '/keypairs', icon: 'key' },
  { label: 'Asset Launchpad', href: '/launchpad', icon: 'rocket_launch' },
  { label: 'Transaction Lab', href: '/lab', icon: 'science' },
  { label: 'On-chain Chat', href: '/chat', icon: 'forum' },
  { label: 'Transfers', href: '/transfers', icon: 'swap_horiz' },
  { label: 'Smart Wallets', href: '/smart-wallets', icon: 'account_balance_wallet' },
];

/** Bottom-anchored utility navigation. Admin items are gated by role. */
export const secondaryNav: NavEntry[] = [
  { label: 'API Keys', href: '/settings/api-keys', icon: 'vpn_key' },
  { label: 'Network Settings', href: '/settings/networks', icon: 'dns', role: 'ADMIN' },
  { label: 'Users', href: '/settings/users', icon: 'group', role: 'ADMIN' },
  { label: 'Support', href: '/settings/profile', icon: 'help' },
];

/** Top-nav secondary links (SPEC §7 / BRAND §6.1). */
export const topNav: NavEntry[] = [
  { label: 'Explorer', href: '/explorer', icon: 'travel_explore' },
  { label: 'Docs', href: '/docs', icon: 'menu_book' },
  { label: 'Bridge', href: '/bridge', icon: 'compare_arrows' },
];

/** Filter nav entries by the current role (admin-only items hidden for USER). */
export function visibleFor(entries: NavEntry[], role: Role): NavEntry[] {
  return entries.filter((entry) => !entry.role || entry.role === role);
}
