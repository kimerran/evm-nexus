'use client';

// Faucet client surface (SPEC §7, §8.4). Address input + capped amount slider +
// request button + a live event log polled from /api/faucet/requests. Amounts
// are handled as bigint/wei via viem (never floats): the slider works in the
// native token for humans, but only the wei STRING crosses the wire.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatEther, isAddress, parseEther } from 'viem';
import {
  Button,
  Card,
  Input,
  Slider,
  Terminal,
  MonoAddress,
  Badge,
  type LogLine,
  type LogTag,
  useToast,
} from '@/components/ui';
import { csrfFetch } from '@/lib/csrf-client';
import type { FaucetRequestView } from '@/lib/faucet/dto';

export interface FaucetClientProps {
  networkId: string;
  nativeSymbol: string;
  /** Per-request ceiling in wei (the configured drip amount). */
  dripWei: string;
  cooldownSec: number;
  initialRequests: FaucetRequestView[];
}

function statusTag(status: string): LogTag {
  if (status === 'SUCCESS') return 'SUCCESS';
  if (status === 'FAILED' || status === 'REJECTED') return 'ERROR';
  return 'FAUCET';
}

function toLogLine(r: FaucetRequestView, symbol: string): LogLine {
  const eth = formatEther(BigInt(r.amount));
  const short = `${r.toAddress.slice(0, 6)}…${r.toAddress.slice(-4)}`;
  const suffix = r.txHash ? ` — tx ${r.txHash.slice(0, 8)}…` : '';
  return {
    time: new Date(r.createdAt).toLocaleTimeString(),
    tag: statusTag(r.status),
    message: `${r.status} · ${eth} ${symbol} → ${short}${suffix}`,
  };
}

export function FaucetClient({
  networkId,
  nativeSymbol,
  dripWei,
  cooldownSec,
  initialRequests,
}: FaucetClientProps) {
  const { toast } = useToast();
  const maxEth = useMemo(() => Number(formatEther(BigInt(dripWei))), [dripWei]);
  const step = useMemo(() => Math.max(0.01, Math.round((maxEth / 50) * 100) / 100), [maxEth]);

  const [address, setAddress] = useState('');
  const [amountEth, setAmountEth] = useState(() => maxEth);
  const [submitting, setSubmitting] = useState(false);
  const [requests, setRequests] = useState<FaucetRequestView[]>(initialRequests);

  const validAddress = isAddress(address.trim());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/faucet/requests?limit=25', { credentials: 'same-origin' });
      if (!res.ok) return;
      const body: unknown = await res.json();
      if (body && typeof body === 'object' && 'data' in body) {
        const data = (body as { data: { requests?: FaucetRequestView[] } }).data;
        if (Array.isArray(data.requests)) setRequests(data.requests);
      }
    } catch {
      // transient; the next poll retries
    }
  }, []);

  // Poll the history so in-flight drips (QUEUED → BROADCAST → SUCCESS) surface live.
  useEffect(() => {
    const id = setInterval(refresh, 3_000);
    return () => clearInterval(id);
  }, [refresh]);

  const logLines = useMemo<LogLine[]>(
    () => requests.map((r) => toLogLine(r, nativeSymbol)).reverse(),
    [requests, nativeSymbol],
  );

  async function onRequest() {
    const to = address.trim();
    if (!isAddress(to)) return;
    setSubmitting(true);
    try {
      const amountWei = parseEther(String(amountEth)).toString();
      const res = await csrfFetch('/api/faucet/request', {
        method: 'POST',
        body: JSON.stringify({ toAddress: to, amount: amountWei, networkId }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (res.ok) {
        toast({ message: 'Drip queued.', tone: 'success', icon: 'water_drop' });
        await refresh();
      } else {
        const message =
          body && typeof body === 'object' && 'error' in body
            ? String((body as { error?: { message?: string } }).error?.message ?? '')
            : '';
        toast({ message: message || 'Could not queue drip.', tone: 'error', icon: 'error' });
      }
    } catch {
      toast({ message: 'Something went wrong.', tone: 'error', icon: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  const cooldownHours = Math.round((cooldownSec / 3600) * 10) / 10;

  return (
    <div className="grid grid-cols-12 gap-gutter">
      <Card className="col-span-12 lg:col-span-5 space-y-lg">
        <div className="space-y-1">
          <h2 className="headline-md text-on-surface">Request a drip</h2>
          <p className="body-md text-on-surface-variant">
            Native {nativeSymbol} to any address, capped at {maxEth} {nativeSymbol} per request.
            One drip per address every {cooldownHours}h.
          </p>
        </div>

        <Input
          label="Destination address"
          name="toAddress"
          placeholder="0x…"
          leadingIcon="wallet"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        {address.trim().length > 0 && !validAddress ? (
          <p className="code-xs text-error">Not a valid EVM address.</p>
        ) : null}

        <Slider
          label={`Amount (${nativeSymbol})`}
          readout={`${amountEth} ${nativeSymbol}`}
          min={step}
          max={maxEth}
          step={step}
          value={amountEth}
          onChange={(e) => setAmountEth(Number(e.target.value))}
        />

        <Button
          variant="primary"
          icon="water_drop"
          disabled={!validAddress || submitting}
          onClick={onRequest}
        >
          {submitting ? 'Queuing…' : 'Request drip'}
        </Button>
      </Card>

      <Card className="col-span-12 lg:col-span-7 space-y-md">
        <div className="flex items-center justify-between">
          <h2 className="headline-md text-on-surface">Live event log</h2>
          <Badge tone="count">{requests.length} recent</Badge>
        </div>
        {logLines.length === 0 ? (
          <p className="body-md text-on-surface-variant">No faucet requests yet.</p>
        ) : (
          <Terminal lines={logLines} className="h-72" label="Faucet event log" />
        )}
      </Card>

      {/* Keypair manager placeholder — issue #9 owns the shared keypair table at
          /keypairs; the mock merges it here. Intentionally not reimplemented. */}
      <Card className="col-span-12 border-dashed">
        <div className="flex items-center justify-between gap-md">
          <div className="space-y-1">
            <h2 className="headline-md text-on-surface">Keypair Manager</h2>
            <p className="body-md text-on-surface-variant">
              Generate and manage ephemeral keypairs to drip into. Delivered by the Keypairs vault.
            </p>
          </div>
          <a href="/keypairs">
            <Button variant="secondary" icon="key">
              Open Keypairs
            </Button>
          </a>
        </div>
        <div className="mt-md">
          <MonoAddress value="0x0000000000000000000000000000000000000000" />
        </div>
      </Card>
    </div>
  );
}
