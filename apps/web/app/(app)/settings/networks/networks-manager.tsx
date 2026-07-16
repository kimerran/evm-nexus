'use client';

import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Button,
  Card,
  Input,
  Badge,
  StatusDot,
  Toggle,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  useToast,
} from '@/components/ui';
import type { NetworkDto } from '@/lib/chain/network-dto';

// CSRF wire names — must match lib/auth/csrf (that module is server-only: it
// pulls node:crypto, so we can't import it into this client bundle).
const CSRF_COOKIE_NAME = 'nexus_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';

/** Read the readable CSRF token seeded by proxy.ts so mutations can echo it. */
function readCsrfToken(): string {
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${CSRF_COOKIE_NAME}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE_NAME.length + 1)) : '';
}

interface FormState {
  name: string;
  chainId: string;
  rpcUrl: string;
  wsUrl: string;
  explorerBaseUrl: string;
  nativeSymbol: string;
  nativeDecimals: string;
  faucetDripAmount: string;
  faucetDailyCap: string;
  faucetCooldownSec: string;
  paymasterAddress: string;
  entryPointAddress: string;
  isDefault: boolean;
  isArchival: boolean;
  faucetEnabled: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  chainId: '',
  rpcUrl: '',
  wsUrl: '',
  explorerBaseUrl: '',
  nativeSymbol: 'ETH',
  nativeDecimals: '18',
  faucetDripAmount: '5000000000000000000',
  faucetDailyCap: '500000000000000000000',
  faucetCooldownSec: '86400',
  paymasterAddress: '',
  entryPointAddress: '',
  isDefault: false,
  isArchival: false,
  faucetEnabled: true,
};

function formFromNetwork(net: NetworkDto): FormState {
  return {
    name: net.name,
    chainId: String(net.chainId),
    rpcUrl: '', // never prefilled — the real credentialed URL is server-only.
    wsUrl: '',
    explorerBaseUrl: net.explorerBaseUrl ?? '',
    nativeSymbol: net.nativeSymbol,
    nativeDecimals: String(net.nativeDecimals),
    faucetDripAmount: net.faucetDripAmount,
    faucetDailyCap: net.faucetDailyCap,
    faucetCooldownSec: String(net.faucetCooldownSec),
    paymasterAddress: net.paymasterAddress ?? '',
    entryPointAddress: net.entryPointAddress ?? '',
    isDefault: net.isDefault,
    isArchival: net.isArchival,
    faucetEnabled: net.faucetEnabled,
  };
}

interface ErrorBody {
  error?: { message?: string };
}

export function NetworksManager({ initialNetworks }: { initialNetworks: NetworkDto[] }) {
  const { toast } = useToast();
  const [networks, setNetworks] = useState<NetworkDto[]>(initialNetworks);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const isEditing = editingId !== null;
  const editingNetwork = useMemo(
    () => networks.find((n) => n.id === editingId) ?? null,
    [networks, editingId],
  );

  const refresh = useCallback(async () => {
    const res = await fetch('/api/networks', { headers: { accept: 'application/json' } });
    if (!res.ok) return;
    const body = (await res.json()) as { data?: { networks?: NetworkDto[] } };
    if (body.data?.networks) setNetworks(body.data.networks);
  }, []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function startEdit(net: NetworkDto) {
    setEditingId(net.id);
    setForm(formFromNetwork(net));
    setShowForm(true);
  }

  function cancel() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function errorMessage(res: Response, fallback: string): Promise<string> {
    try {
      const body = (await res.json()) as ErrorBody;
      return body.error?.message ?? fallback;
    } catch {
      return fallback;
    }
  }

  function buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      chainId: Number(form.chainId),
      nativeSymbol: form.nativeSymbol.trim(),
      nativeDecimals: Number(form.nativeDecimals),
      faucetEnabled: form.faucetEnabled,
      faucetDripAmount: form.faucetDripAmount.trim(),
      faucetDailyCap: form.faucetDailyCap.trim(),
      faucetCooldownSec: Number(form.faucetCooldownSec),
      isArchival: form.isArchival,
    };
    // Optional strings: send when present; on create, isDefault is included.
    if (form.rpcUrl.trim()) payload.rpcUrl = form.rpcUrl.trim();
    if (form.wsUrl.trim()) payload.wsUrl = form.wsUrl.trim();
    if (form.explorerBaseUrl.trim()) payload.explorerBaseUrl = form.explorerBaseUrl.trim();
    if (form.paymasterAddress.trim()) payload.paymasterAddress = form.paymasterAddress.trim();
    if (form.entryPointAddress.trim()) payload.entryPointAddress = form.entryPointAddress.trim();
    if (!isEditing) payload.isDefault = form.isDefault;
    return payload;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = buildPayload();
      if (!isEditing && !payload.rpcUrl) {
        toast({ message: 'RPC URL is required.', tone: 'error', icon: 'error' });
        return;
      }
      const url = isEditing ? `/api/networks/${editingId}` : '/api/networks';
      const res = await fetch(url, {
        method: isEditing ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          [CSRF_HEADER_NAME]: readCsrfToken(),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        toast({
          message: await errorMessage(res, 'Failed to save network.'),
          tone: 'error',
          icon: 'error',
        });
        return;
      }
      toast({
        message: isEditing ? 'Network updated.' : 'Network created.',
        tone: 'success',
        icon: 'check_circle',
      });
      cancel();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(net: NetworkDto) {
    if (net.isDefault) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/networks/${net.id}/default`, {
        method: 'POST',
        headers: { [CSRF_HEADER_NAME]: readCsrfToken() },
      });
      if (!res.ok) {
        toast({
          message: await errorMessage(res, 'Failed to set active network.'),
          tone: 'error',
          icon: 'error',
        });
        return;
      }
      toast({ message: `${net.name} is now active.`, tone: 'success', icon: 'hub' });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(net: NetworkDto) {
    if (!window.confirm(`Delete network "${net.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/networks/${net.id}`, {
        method: 'DELETE',
        headers: { [CSRF_HEADER_NAME]: readCsrfToken() },
      });
      if (!res.ok) {
        toast({
          message: await errorMessage(res, 'Failed to delete network.'),
          tone: 'error',
          icon: 'error',
        });
        return;
      }
      toast({ message: `${net.name} deleted.`, tone: 'success', icon: 'delete' });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-sm">
          <h2 className="headline-md text-on-surface">Networks</h2>
          <Badge tone="count">{networks.length} Total</Badge>
        </div>
        {!showForm ? (
          <Button variant="primary" icon="add" onClick={startCreate}>
            Add network
          </Button>
        ) : null}
      </div>

      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Network</TableHeaderCell>
              <TableHeaderCell>Chain ID</TableHeaderCell>
              <TableHeaderCell>RPC Origin</TableHeaderCell>
              <TableHeaderCell>Flags</TableHeaderCell>
              <TableHeaderCell className="text-right">Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {networks.map((net) => (
              <TableRow key={net.id}>
                <TableCell>
                  <div className="flex items-center gap-xs">
                    <StatusDot tone={net.isDefault ? 'live' : 'idle'} pulse={net.isDefault} />
                    <span className="body-md text-on-surface">{net.name}</span>
                    <span className="code-xs text-on-surface-variant">{net.nativeSymbol}</span>
                  </div>
                </TableCell>
                <TableCell className="code-sm text-on-surface-variant">{net.chainId}</TableCell>
                <TableCell>
                  <span className="code-xs text-on-surface-variant">{net.rpcUrl ?? '—'}</span>
                  {net.rpcUrlHasSecret ? (
                    <Badge tone="secure" className="ml-2">
                      Encrypted
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {net.isDefault ? <Badge tone="success">Active</Badge> : null}
                    {net.isArchival ? <Badge tone="neutral">Archival</Badge> : null}
                    {net.faucetEnabled ? <Badge tone="neutral">Faucet</Badge> : null}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="hub"
                      disabled={busy || net.isDefault}
                      onClick={() => setDefault(net)}
                    >
                      Set active
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="edit"
                      disabled={busy}
                      onClick={() => startEdit(net)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      icon="delete"
                      disabled={busy || net.isDefault}
                      onClick={() => remove(net)}
                    >
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {showForm ? (
        <Card>
          <h3 className="headline-md mb-md text-on-surface">
            {isEditing ? `Edit ${editingNetwork?.name ?? 'network'}` : 'Add a network'}
          </h3>
          <form onSubmit={onSubmit} className="space-y-lg" noValidate>
            <div className="grid grid-cols-1 gap-md md:grid-cols-2">
              <Input
                label="Name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                required
              />
              <Input
                label="Chain ID"
                type="number"
                mono
                value={form.chainId}
                onChange={(e) => set('chainId', e.target.value)}
                required
              />
              <Input
                label="RPC URL"
                mono
                placeholder={
                  isEditing
                    ? `Leave blank to keep (${editingNetwork?.rpcUrl ?? 'current'})`
                    : 'https://… or http://localhost:8545'
                }
                helper="Credentials in the URL are encrypted at rest and never returned to the browser."
                value={form.rpcUrl}
                onChange={(e) => set('rpcUrl', e.target.value)}
              />
              <Input
                label="WebSocket URL (optional)"
                mono
                placeholder={isEditing ? 'Leave blank to keep' : 'wss://…'}
                value={form.wsUrl}
                onChange={(e) => set('wsUrl', e.target.value)}
              />
              <Input
                label="Explorer Base URL (optional)"
                mono
                value={form.explorerBaseUrl}
                onChange={(e) => set('explorerBaseUrl', e.target.value)}
              />
              <div className="grid grid-cols-2 gap-md">
                <Input
                  label="Native Symbol"
                  value={form.nativeSymbol}
                  onChange={(e) => set('nativeSymbol', e.target.value)}
                />
                <Input
                  label="Decimals"
                  type="number"
                  mono
                  value={form.nativeDecimals}
                  onChange={(e) => set('nativeDecimals', e.target.value)}
                />
              </div>
            </div>

            <fieldset className="space-y-md rounded-xl border border-outline-variant p-md">
              <legend className="label-caps px-2 text-on-surface-variant">Faucet</legend>
              <div className="grid grid-cols-1 gap-md md:grid-cols-3">
                <Input
                  label="Drip (wei)"
                  mono
                  value={form.faucetDripAmount}
                  onChange={(e) => set('faucetDripAmount', e.target.value)}
                />
                <Input
                  label="Daily Cap (wei)"
                  mono
                  value={form.faucetDailyCap}
                  onChange={(e) => set('faucetDailyCap', e.target.value)}
                />
                <Input
                  label="Cooldown (sec)"
                  type="number"
                  mono
                  value={form.faucetCooldownSec}
                  onChange={(e) => set('faucetCooldownSec', e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="label-caps text-on-surface-variant">Faucet enabled</span>
                <Toggle
                  aria-label="Faucet enabled"
                  checked={form.faucetEnabled}
                  onChange={(e) => set('faucetEnabled', e.target.checked)}
                />
              </div>
            </fieldset>

            <fieldset className="space-y-md rounded-xl border border-outline-variant p-md">
              <legend className="label-caps px-2 text-on-surface-variant">
                Account Abstraction (optional)
              </legend>
              <div className="grid grid-cols-1 gap-md md:grid-cols-2">
                <Input
                  label="Paymaster Address"
                  mono
                  placeholder="0x…"
                  value={form.paymasterAddress}
                  onChange={(e) => set('paymasterAddress', e.target.value)}
                />
                <Input
                  label="EntryPoint Address"
                  mono
                  placeholder="0x…"
                  value={form.entryPointAddress}
                  onChange={(e) => set('entryPointAddress', e.target.value)}
                />
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-lg">
              {!isEditing ? (
                <div className="flex items-center gap-sm">
                  <span className="label-caps text-on-surface-variant">Set as active network</span>
                  <Toggle
                    aria-label="Set as active network"
                    checked={form.isDefault}
                    onChange={(e) => set('isDefault', e.target.checked)}
                  />
                </div>
              ) : null}
              <div className="flex items-center gap-sm">
                <span className="label-caps text-on-surface-variant">Archival node</span>
                <Toggle
                  aria-label="Archival node"
                  checked={form.isArchival}
                  onChange={(e) => set('isArchival', e.target.checked)}
                />
              </div>
            </div>

            <div className="flex items-center gap-sm">
              <Button type="submit" variant="primary" icon="save" disabled={busy}>
                {busy ? 'Saving…' : isEditing ? 'Save changes' : 'Create network'}
              </Button>
              <Button type="button" variant="ghost" onClick={cancel} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
