'use client';

// /transfers client surface (SPEC §7/§8.6): the new-transfer form beside a live
// history table. Owns the transfer list + polls while any row is in-flight so
// status transitions (PENDING → CONFIRMING → SUCCESS) surface without a reload.
import { useCallback, useEffect, useState } from 'react';
import { Badge, Card } from '@/components/ui';
import { TransferForm } from '@/components/transfers/transfer-form';
import { TransfersHistory } from '@/components/transfers/transfers-history';
import type { KeypairDto } from '@/lib/keypairs/dto';
import type { TransferView } from '@/lib/transfers/dto';

export interface TransfersClientProps {
  networkId: string;
  nativeSymbol: string;
  explorerBaseUrl: string | null;
  initialKeypairs: KeypairDto[];
  initialTransfers: TransferView[];
}

export function TransfersClient({
  networkId,
  nativeSymbol,
  explorerBaseUrl,
  initialKeypairs,
  initialTransfers,
}: TransfersClientProps) {
  const [transfers, setTransfers] = useState<TransferView[]>(initialTransfers);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/transfers?limit=25', { credentials: 'same-origin' });
      if (!res.ok) return;
      const body: unknown = await res.json();
      if (body && typeof body === 'object' && 'data' in body) {
        const data = (body as { data: { transfers?: TransferView[] } }).data;
        if (Array.isArray(data.transfers)) setTransfers(data.transfers);
      }
    } catch {
      // transient; next poll retries
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
      <Card className="col-span-12 lg:col-span-5 space-y-lg">
        <h2 className="headline-md text-on-surface">New transfer</h2>
        <TransferForm
          networkId={networkId}
          nativeSymbol={nativeSymbol}
          keypairs={initialKeypairs}
          onBroadcast={refresh}
        />
      </Card>

      <Card className="col-span-12 lg:col-span-7 space-y-md">
        <div className="flex items-center justify-between">
          <h2 className="headline-md text-on-surface">History</h2>
          <Badge tone="count">{transfers.length}</Badge>
        </div>
        <TransfersHistory
          transfers={transfers}
          nativeSymbol={nativeSymbol}
          explorerBaseUrl={explorerBaseUrl}
        />
      </Card>
    </div>
  );
}
