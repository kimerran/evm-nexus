'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  Card,
  CopyButton,
  Input,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  useToast,
} from '@/components/ui';
import { csrfFetch } from '@/lib/csrf-client';

/** Masked, serializable view of an API key — NEVER carries the hash. */
export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

export function ApiKeysManager({ initialKeys }: { initialKeys: ApiKeyView[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // The raw token, held ONLY in memory and shown once until dismissed.
  const [freshToken, setFreshToken] = useState<string | null>(null);

  async function onIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length === 0) return;
    setCreating(true);
    try {
      const days = expiresInDays.trim() ? Number(expiresInDays) : undefined;
      const res = await csrfFetch('/api/api-keys', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          ...(days && Number.isInteger(days) ? { expiresInDays: days } : {}),
        }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (res.ok && data && typeof data === 'object' && 'data' in data) {
        const token = (data as { data: { token?: string } }).data.token ?? null;
        setFreshToken(token);
        setName('');
        setExpiresInDays('');
        toast({ message: 'API key created. Copy it now — shown once.', tone: 'success', icon: 'vpn_key' });
        router.refresh();
      } else {
        const message =
          data && typeof data === 'object' && 'error' in data
            ? String((data as { error?: { message?: string } }).error?.message ?? '')
            : '';
        toast({ message: message || 'Could not create key.', tone: 'error', icon: 'error' });
      }
    } catch {
      toast({ message: 'Something went wrong.', tone: 'error', icon: 'error' });
    } finally {
      setCreating(false);
    }
  }

  async function onRevoke(id: string) {
    setBusyId(id);
    try {
      const res = await csrfFetch(`/api/api-keys/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast({ message: 'Key revoked.', tone: 'success', icon: 'block' });
        router.refresh();
      } else {
        toast({ message: 'Could not revoke key.', tone: 'error', icon: 'error' });
      }
    } catch {
      toast({ message: 'Something went wrong.', tone: 'error', icon: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-lg">
      {freshToken ? (
        <Card className="border-primary/50 bg-primary-container/10">
          <div className="flex items-start justify-between gap-md">
            <div className="min-w-0 space-y-2">
              <p className="label-caps text-primary-fixed-dim">New API Key — copy it now</p>
              <p className="code-xs italic text-on-surface-variant">
                This is the only time the full key is shown. Store it securely; only its hash is kept.
              </p>
              <code className="block truncate rounded-lg border border-outline-variant bg-surface-container-low px-md py-2 code-sm text-primary">
                {freshToken}
              </code>
            </div>
            <div className="flex shrink-0 items-center gap-xs">
              <CopyButton value={freshToken} />
              <Button variant="ghost" icon="close" onClick={() => setFreshToken(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <Card className="max-w-2xl">
        <h2 className="headline-md mb-md text-on-surface">Issue a new key</h2>
        <form onSubmit={onIssue} className="flex flex-col gap-md sm:flex-row sm:items-end">
          <Input
            label="Key name"
            name="name"
            placeholder="ci-bot"
            leadingIcon="label"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="sm:w-64"
            required
          />
          <Input
            label="Expires (days)"
            name="expiresInDays"
            type="number"
            min={1}
            max={365}
            placeholder="never"
            leadingIcon="schedule"
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            className="sm:w-40"
          />
          <Button type="submit" variant="primary" icon="add" disabled={creating}>
            {creating ? 'Creating…' : 'Create Key'}
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="headline-md mb-md text-on-surface">Your keys</h2>
        {initialKeys.length === 0 ? (
          <p className="body-md text-on-surface-variant">No API keys yet.</p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Prefix</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Last used</TableHeaderCell>
                <TableHeaderCell>Expires</TableHeaderCell>
                <TableHeaderCell>Created</TableHeaderCell>
                <TableHeaderCell className="text-right">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {initialKeys.map((k) => {
                const revoked = k.revokedAt !== null;
                const expired = k.expiresAt !== null && new Date(k.expiresAt).getTime() <= Date.now();
                return (
                  <TableRow key={k.id}>
                    <TableCell className="body-md text-on-surface">{k.name}</TableCell>
                    <TableCell>
                      <code className="code-sm text-on-surface-variant">{k.prefix}…</code>
                    </TableCell>
                    <TableCell>
                      {revoked ? (
                        <Badge tone="error">Revoked</Badge>
                      ) : expired ? (
                        <Badge tone="neutral">Expired</Badge>
                      ) : (
                        <Badge tone="success">Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="code-sm text-on-surface-variant">{fmt(k.lastUsedAt)}</TableCell>
                    <TableCell className="code-sm text-on-surface-variant">{fmt(k.expiresAt)}</TableCell>
                    <TableCell className="code-sm text-on-surface-variant">{fmt(k.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      {revoked ? (
                        <span className="code-xs text-on-surface-variant">—</span>
                      ) : (
                        <Button
                          variant="destructive"
                          size="sm"
                          icon="block"
                          disabled={busyId === k.id}
                          onClick={() => onRevoke(k.id)}
                        >
                          {busyId === k.id ? 'Revoking…' : 'Revoke'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
