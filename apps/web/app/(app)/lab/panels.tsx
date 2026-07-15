'use client';

// Transaction Lab panel registry — the EXTENSION POINT for the /lab shell
// (SPEC §7). The shell renders whatever is listed here; a new lab tool is added
// by appending ONE entry (and its component) to `LAB_PANELS` — the shell, tab
// bar, and routing pick it up automatically with no other change.
//
// This is deliberately open for #14 (Bombard) and #15 (Chat): both already have
// registry entries flagged `coming-soon` so they slot in by flipping `status` to
// 'available' and supplying a `Component`. Nothing in the shell is hardcoded to
// transfers.
import { useCallback, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { Badge } from '@/components/ui';
import { TransferForm } from '@/components/transfers/transfer-form';
import { TransfersHistory } from '@/components/transfers/transfers-history';
import type { KeypairDto } from '@/lib/keypairs/dto';
import type { TransferView } from '@/lib/transfers/dto';

/** Data every lab panel receives from the shell (server-loaded, then live). */
export interface LabPanelContext {
  networkId: string;
  nativeSymbol: string;
  explorerBaseUrl: string | null;
  keypairs: KeypairDto[];
  initialTransfers: TransferView[];
}

/** A registered lab tool. `Component` is required only for `available` panels. */
export interface LabPanelDef {
  id: string;
  label: string;
  /** Material Symbol glyph (BRAND §4). */
  icon: string;
  description: string;
  status: 'available' | 'coming-soon';
  /** GitHub issue that lands a `coming-soon` panel (shown in the placeholder). */
  issue?: number;
  Component?: ComponentType<LabPanelContext>;
}

/** The Transfer Assets panel — a compact transfer form + its recent history. */
function TransferPanel({
  networkId,
  nativeSymbol,
  explorerBaseUrl,
  keypairs,
  initialTransfers,
}: LabPanelContext) {
  const [transfers, setTransfers] = useState<TransferView[]>(initialTransfers);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/transfers?limit=10', { credentials: 'same-origin' });
      if (!res.ok) return;
      const body: unknown = await res.json();
      if (body && typeof body === 'object' && 'data' in body) {
        const data = (body as { data: { transfers?: TransferView[] } }).data;
        if (Array.isArray(data.transfers)) setTransfers(data.transfers);
      }
    } catch {
      // transient; the live feed still reflects status
    }
  }, []);

  useEffect(() => {
    const inFlight = transfers.some((t) =>
      ['PENDING', 'BROADCAST', 'CONFIRMING'].includes(t.status),
    );
    if (!inFlight) return;
    const id = setInterval(refresh, 3_000);
    return () => clearInterval(id);
  }, [transfers, refresh]);

  return (
    <div className="grid grid-cols-12 gap-gutter">
      <div className="col-span-12 xl:col-span-6">
        <TransferForm
          networkId={networkId}
          nativeSymbol={nativeSymbol}
          keypairs={keypairs}
          onBroadcast={refresh}
          compact
        />
      </div>
      <div className="col-span-12 xl:col-span-6 space-y-md">
        <div className="flex items-center justify-between">
          <h3 className="headline-md text-on-surface">Recent</h3>
          <Badge tone="count">{transfers.length}</Badge>
        </div>
        <TransfersHistory
          transfers={transfers}
          nativeSymbol={nativeSymbol}
          explorerBaseUrl={explorerBaseUrl}
          compact
        />
      </div>
    </div>
  );
}

/**
 * The registry. Order = tab order. Append here to extend the lab. The two
 * `coming-soon` entries reserve #14/#15's slots so their PRs are a one-entry
 * change rather than a shell rewrite.
 */
export const LAB_PANELS: LabPanelDef[] = [
  {
    id: 'transfer',
    label: 'Transfer Assets',
    icon: 'swap_horiz',
    description: 'Send native coins and ERC-20/721/1155 assets. Signs in-browser.',
    status: 'available',
    Component: TransferPanel,
  },
  {
    id: 'bombard',
    label: 'Bombard',
    icon: 'bolt',
    description: 'High-throughput transaction stress testing at a target TPS.',
    status: 'coming-soon',
    issue: 14,
  },
  {
    id: 'chat',
    label: 'On-chain Chat',
    icon: 'forum',
    description: 'Commit chat messages on-chain and watch them confirm.',
    status: 'coming-soon',
    issue: 15,
  },
];
