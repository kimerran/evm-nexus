import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth/session';
import { ApiKeysManager } from './api-keys-manager';
import type { ApiKeyView } from './api-keys-manager';

export const metadata: Metadata = {
  title: 'API Keys — EVM Nexus',
};

export const dynamic = 'force-dynamic';

/**
 * /settings/api-keys (SPEC §7, §8.11) — issue / list / revoke personal
 * `nxs_…` keys. The list is fetched server-side and NEVER includes the key hash
 * (only the display prefix). Issue + revoke run through the client manager
 * against /api/api-keys. A key inherits the issuer's live role at auth time.
 */
export default async function ApiKeysPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const rows = await prisma.apiKey.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
      revokedAt: true,
    },
  });

  const keys: ApiKeyView[] = rows.map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    expiresAt: k.expiresAt?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
    revokedAt: k.revokedAt?.toISOString() ?? null,
  }));

  return (
    <div className="space-y-xl">
      <header className="space-y-1">
        <h1 className="display-lg text-on-surface">API Keys</h1>
        <p className="body-md text-on-surface-variant">
          Personal <span className="code-sm text-primary-fixed-dim">nxs_…</span> keys for scripting
          the API. Scoped to your role ({session.user.role}). The raw key is shown once at creation —
          only its hash is stored.
        </p>
      </header>

      <ApiKeysManager initialKeys={keys} />
    </div>
  );
}
