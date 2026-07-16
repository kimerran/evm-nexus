'use client';

// Transaction Lab live tx feed (SPEC §7/§8.10). Subscribes to the SAME telemetry
// SSE stream the dashboard uses (#8) and renders the `tx` events transfers (and
// later bombard/chat commits) publish onto the `nexus:telemetry:tx` channel. If
// SSE can't connect it simply stays quiet — the history tables remain the source
// of truth. Reused by any lab panel; not transfer-specific.
import { useEffect, useRef, useState } from 'react';
import { Badge, StatusDot, type StatusTone } from '@/components/ui';
import type { TxTelemetryEvent } from '@/lib/telemetry/tx-event';

const MAX_ROWS = 30;

function statusTone(status: string): StatusTone {
  if (status === 'SUCCESS') return 'online';
  if (status === 'FAILED' || status === 'REJECTED') return 'error';
  return 'pending';
}

interface FeedRow extends TxTelemetryEvent {
  /** Local receipt time for display + a stable-ish key. */
  seenAt: string;
  key: string;
}

export function LiveFeed() {
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [connected, setConnected] = useState(false);
  const counter = useRef(0);

  useEffect(() => {
    let source: EventSource | null = null;
    let cancelled = false;

    try {
      source = new EventSource('/api/stream/telemetry', { withCredentials: true });
    } catch {
      return;
    }

    source.addEventListener('ready', () => {
      if (!cancelled) setConnected(true);
    });
    source.addEventListener('tx', (ev: MessageEvent<string>) => {
      if (cancelled) return;
      let data: TxTelemetryEvent;
      try {
        data = JSON.parse(ev.data) as TxTelemetryEvent;
      } catch {
        return;
      }
      counter.current += 1;
      const row: FeedRow = {
        ...data,
        seenAt: new Date().toLocaleTimeString(),
        key: `${data.id}-${data.status}-${counter.current}`,
      };
      setRows((prev) => [row, ...prev].slice(0, MAX_ROWS));
    });
    source.onerror = () => {
      if (!cancelled) setConnected(false);
    };

    return () => {
      cancelled = true;
      source?.close();
    };
  }, []);

  return (
    <div className="space-y-md">
      <div className="flex items-center justify-between">
        <h2 className="headline-md text-on-surface">Live tx feed</h2>
        <Badge tone={connected ? 'success' : 'pending'}>{connected ? 'SSE · live' : 'connecting'}</Badge>
      </div>
      {rows.length === 0 ? (
        <p className="body-md text-on-surface-variant">
          Broadcast a transfer to watch it appear here in real time.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li
              key={r.key}
              className="flex items-center gap-3 rounded-md bg-surface-container px-3 py-2"
            >
              <StatusDot tone={statusTone(r.status)} />
              <Badge tone="count">{r.kind}</Badge>
              <span className="code-xs text-on-surface-variant">{r.status}</span>
              <span className="code-xs text-on-surface-variant flex-1 truncate">
                {r.txHash ? `${r.txHash.slice(0, 12)}…` : '—'}
              </span>
              <span className="code-xs text-on-surface-variant">{r.seenAt}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
