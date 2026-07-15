'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, Badge, StatusDot, Terminal, type LogLine, type StatusTone } from '@/components/ui';
import type { NetworkHealth } from '@/lib/chain/health';
import {
  formatBlockHeight,
  formatCount,
  formatSeconds,
  formatWeiToGwei,
  EM_DASH,
} from '@/lib/telemetry/format';

/** Live connection state driving the header badge and card affordances. */
type ConnState = 'connecting' | 'live' | 'polling' | 'error';

interface DashboardLiveProps {
  /** Active network id (backs the polling fallback endpoint). */
  networkId: string | null;
  networkName: string;
  /** Server-rendered first health snapshot, or null when the RPC was down. */
  initialHealth: NetworkHealth | null;
  /** True when the server's initial RPC read failed. */
  initialError: boolean;
}

const MAX_LOG_LINES = 40;

function nowClock(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

const CONN_META: Record<ConnState, { tone: StatusTone; label: string; badge: 'success' | 'pending' | 'error' }> = {
  connecting: { tone: 'pending', label: 'Connecting', badge: 'pending' },
  live: { tone: 'live', label: 'Live · SSE', badge: 'success' },
  polling: { tone: 'online', label: 'Live · Polling', badge: 'pending' },
  error: { tone: 'error', label: 'Offline', badge: 'error' },
};

/**
 * Client island that drives the dashboard's live telemetry. It subscribes to the
 * `/api/stream/telemetry` SSE endpoint and, if that connection fails, falls back
 * to polling `/api/networks/:id/health`. Health frames update the stat cards;
 * tx/faucet/bombard frames append to the live event log.
 */
export function DashboardLive({
  networkId,
  networkName,
  initialHealth,
  initialError,
}: DashboardLiveProps) {
  const [health, setHealth] = useState<NetworkHealth | null>(initialHealth);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [log, setLog] = useState<LogLine[]>([]);
  const [rpcError, setRpcError] = useState<boolean>(initialError);

  const appendLog = useCallback((tag: LogLine['tag'], message: string) => {
    setLog((prev) => {
      const next = [...prev, { time: nowClock(), tag, message }];
      return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
    });
  }, []);

  // Polling fallback — used only when SSE cannot be established.
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startPolling = useCallback(() => {
    if (!networkId || pollTimer.current) return;
    setConn('polling');
    const poll = async () => {
      try {
        const res = await fetch(`/api/networks/${networkId}/health`, {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body: { data: NetworkHealth } = await res.json();
        setHealth(body.data);
        setRpcError(false);
      } catch {
        setRpcError(true);
      }
    };
    void poll();
    pollTimer.current = setInterval(() => void poll(), 4000);
  }, [networkId]);

  useEffect(() => {
    let source: EventSource | null = null;
    let cancelled = false;

    // EventSource sends the session cookie (same-origin) automatically.
    try {
      source = new EventSource('/api/stream/telemetry');
    } catch {
      startPolling();
      return;
    }

    source.addEventListener('ready', () => {
      if (!cancelled) setConn('live');
    });
    source.addEventListener('health', (event) => {
      if (cancelled) return;
      try {
        const data = JSON.parse((event as MessageEvent).data) as NetworkHealth;
        setHealth(data);
        setRpcError(false);
        setConn('live');
      } catch {
        // Ignore a malformed frame.
      }
    });
    source.addEventListener('notice', (event) => {
      if (cancelled) return;
      try {
        const data = JSON.parse((event as MessageEvent).data) as { scope?: string; message?: string };
        if (data.scope === 'health') setRpcError(true);
        appendLog('SYSTEM', data.message ?? 'Notice');
      } catch {
        /* ignore */
      }
    });

    const feed = (tag: LogLine['tag']) => (event: Event) => {
      if (cancelled) return;
      const raw = (event as MessageEvent).data;
      let text = String(raw);
      try {
        const parsed = JSON.parse(raw);
        text = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
      } catch {
        /* keep raw */
      }
      appendLog(tag, text);
    };
    source.addEventListener('tx', feed('SUCCESS'));
    source.addEventListener('faucet', feed('FAUCET'));
    source.addEventListener('bombard', feed('SYSTEM'));

    source.onerror = () => {
      // Transport failed — close and fall back to polling for reliability.
      if (cancelled) return;
      source?.close();
      source = null;
      startPolling();
    };

    return () => {
      cancelled = true;
      source?.close();
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [appendLog, startPolling]);

  const meta = CONN_META[conn];
  const gas = health ? formatWeiToGwei(health.gasPriceWei) : EM_DASH;
  const height = health ? formatBlockHeight(health.blockNumber) : EM_DASH;
  const blockTime = health ? formatSeconds(health.blockTimeSec) : EM_DASH;
  const peers = health ? formatCount(health.peerCount) : EM_DASH;
  const txpoolPending = health?.txpool ? formatCount(health.txpool.pending) : null;

  return (
    <>
      <div className="col-span-12 flex items-center justify-between">
        <div className="flex items-center gap-xs">
          <StatusDot tone={meta.tone} pulse label={`Telemetry ${meta.label}`} />
          <span className="label-caps text-on-surface-variant">{networkName}</span>
        </div>
        <Badge tone={meta.badge}>{meta.label}</Badge>
      </div>

      <StatCard
        label="Gas Price"
        value={gas}
        unit="gwei"
        tone={rpcError ? 'error' : 'live'}
        loading={!health && !rpcError}
        error={rpcError}
      />
      <StatCard
        label="Block Height"
        value={height}
        unit=""
        tone={rpcError ? 'error' : 'live'}
        loading={!health && !rpcError}
        error={rpcError}
      />
      <StatCard
        label="Block Time"
        value={blockTime}
        unit="s"
        tone={rpcError ? 'error' : 'live'}
        loading={!health && !rpcError}
        error={rpcError}
      />
      <StatCard
        label="Peer Count"
        value={peers}
        unit={health && health.peerCount === null ? '' : 'peers'}
        hint={health && health.peerCount === null ? 'unsupported' : undefined}
        tone={rpcError ? 'error' : 'live'}
        loading={!health && !rpcError}
        error={rpcError}
      />
      <StatCard
        label="Txpool"
        value={txpoolPending ?? (health ? 'n/a' : EM_DASH)}
        unit={txpoolPending ? 'pending' : ''}
        hint={
          health?.txpool
            ? `${formatCount(health.txpool.queued)} queued`
            : health
              ? 'unsupported'
              : undefined
        }
        tone={rpcError ? 'error' : 'live'}
        loading={!health && !rpcError}
        error={rpcError}
      />

      {/* Live event log — fed by tx / faucet / bombard SSE frames. */}
      <Card className="col-span-12">
        <div className="mb-md flex items-center justify-between">
          <h2 className="headline-md text-on-surface">Live Event Feed</h2>
          <Badge tone="count">{log.length} events</Badge>
        </div>
        {log.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest">
            <p className="code-xs text-on-surface-variant">
              Awaiting telemetry events (transactions, faucet drips, bombard runs)…
            </p>
          </div>
        ) : (
          <Terminal lines={log} className="h-48" label="Live telemetry feed" />
        )}
      </Card>
    </>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  unit: string;
  tone: StatusTone;
  loading?: boolean;
  error?: boolean;
  hint?: string;
}

function StatCard({ label, value, unit, tone, loading, error, hint }: StatCardProps) {
  return (
    <Card hover className="col-span-6 md:col-span-4">
      <div className="flex items-center justify-between">
        <span className="label-caps text-on-surface-variant">{label}</span>
        <StatusDot tone={error ? 'error' : tone} pulse={!error} />
      </div>
      {loading ? (
        <div className="mt-3 h-7 w-24 animate-pulse rounded bg-surface-container-high" aria-hidden />
      ) : error ? (
        <p className="mt-2 code-sm text-2xl font-bold text-error">{EM_DASH}</p>
      ) : (
        <p className="mt-2 code-sm text-2xl font-bold text-primary">
          {value}
          {unit ? <span className="ml-1 text-sm text-on-surface-variant">{unit}</span> : null}
        </p>
      )}
      {hint ? <p className="code-xs mt-1 italic text-on-surface-variant">{hint}</p> : null}
    </Card>
  );
}
