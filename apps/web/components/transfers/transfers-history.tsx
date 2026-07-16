'use client';

// Reusable transfer-history table (SPEC §7/§8.6). Used by the /transfers page and
// the /lab Transfer Assets panel. Purely presentational — the parent owns the
// data + polling. Amounts are already decimal strings from the API (never floated
// here); a wei→display reduction uses bigint math only.
import {
  Badge,
  MonoAddress,
  StatusDot,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  type StatusTone,
} from '@/components/ui';
import type { TransferView } from '@/lib/transfers/dto';

function statusTone(status: string): StatusTone {
  if (status === 'SUCCESS') return 'online';
  if (status === 'FAILED' || status === 'REJECTED') return 'error';
  if (status === 'PENDING' || status === 'BROADCAST' || status === 'CONFIRMING') return 'pending';
  return 'idle';
}

/** Human summary of the transferred amount for one row. */
function amountLabel(t: TransferView, nativeSymbol: string): string {
  if (t.kind === 'ERC721') return `#${t.tokenId ?? '—'}`;
  if (t.amount === null) return '—';
  if (t.kind === 'ERC1155') return `${t.amount} × #${t.tokenId ?? '—'}`;
  // NATIVE + ERC20 use 18-decimal base units — show a gwei-scaled compact value
  // via bigint math (full precision stays in `amount`).
  const suffix = t.kind === 'NATIVE' ? ` ${nativeSymbol}` : '';
  // Reduce wei → whole tokens with bigint (18 decimals): reuse gwei formatter at
  // decimals=6 on the gwei value gives token units.
  try {
    const whole = BigInt(t.amount) / 10n ** 18n;
    const frac = (BigInt(t.amount) % 10n ** 18n).toString().padStart(18, '0').slice(0, 4);
    return `${whole.toString()}.${frac}${suffix}`;
  } catch {
    return `${t.amount}${suffix}`;
  }
}

export interface TransfersHistoryProps {
  transfers: TransferView[];
  nativeSymbol: string;
  explorerBaseUrl: string | null;
  /** Show fewer columns for the compact /lab panel. */
  compact?: boolean;
}

export function TransfersHistory({
  transfers,
  nativeSymbol,
  explorerBaseUrl,
  compact = false,
}: TransfersHistoryProps) {
  if (transfers.length === 0) {
    return <p className="body-md text-on-surface-variant">No transfers yet.</p>;
  }
  const txUrl = (hash: string) =>
    explorerBaseUrl ? `${explorerBaseUrl.replace(/\/$/, '')}/tx/${hash}` : null;

  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Kind</TableHeaderCell>
          <TableHeaderCell>To</TableHeaderCell>
          <TableHeaderCell>Amount</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          {!compact ? <TableHeaderCell>Tx</TableHeaderCell> : null}
        </TableRow>
      </TableHead>
      <TableBody>
        {transfers.map((t) => (
          <TableRow key={t.id}>
            <TableCell>
              <Badge tone="count">{t.kind}</Badge>
            </TableCell>
            <TableCell>
              <MonoAddress value={t.toAddress} />
            </TableCell>
            <TableCell>
              <span className="code-sm text-on-surface">{amountLabel(t, nativeSymbol)}</span>
            </TableCell>
            <TableCell>
              <span className="flex items-center gap-2">
                <StatusDot tone={statusTone(t.status)} />
                <span className="code-sm text-on-surface-variant">{t.status}</span>
              </span>
            </TableCell>
            {!compact ? (
              <TableCell>
                {t.txHash ? (
                  txUrl(t.txHash) ? (
                    <a
                      href={txUrl(t.txHash) as string}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-primary code-xs"
                    >
                      {t.txHash.slice(0, 10)}…
                    </a>
                  ) : (
                    <span className="code-xs text-on-surface-variant">{t.txHash.slice(0, 10)}…</span>
                  )
                ) : (
                  <span className="code-xs text-on-surface-variant">—</span>
                )}
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
