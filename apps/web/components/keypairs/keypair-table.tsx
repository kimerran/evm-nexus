'use client';

// Reusable, presentational keypair table (SPEC §5 Keypair, §7). Renders the
// non-custodial vault view — label, checksummed address, and status badges —
// plus per-row actions. It holds NO secret state and performs NO crypto: the
// plaintext key never reaches this component (AGENT.md §0/§6). Everything it
// receives is public metadata; every action is a callback into the manager.
import {
  Badge,
  Button,
  StatusDot,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  MonoAddress,
} from '@/components/ui';
import type { EncryptedKeystoreV3 } from '@/lib/crypto/keystore-schema';

/**
 * A single row in the vault view. Carries only PUBLIC data — never a private key.
 * `unlocked` means the plaintext key currently lives in the in-memory vault (so
 * export/sign is possible this session); it is never persisted or serialized.
 */
export interface KeypairRow {
  /** Server row id when persisted; `null` for an in-memory-only keypair. */
  id: string | null;
  label: string;
  address: string;
  /** Opaque encrypted keystore blob (safe to hold/export), or null. */
  keystore: EncryptedKeystoreV3 | null;
  /** true = never persisted server-side (in-memory only). */
  isEphemeral: boolean;
  /** true = plaintext key is in the in-memory vault this session. */
  unlocked: boolean;
  createdAt: string;
}

export interface KeypairTableProps {
  rows: KeypairRow[];
  busy?: boolean;
  onPersist: (row: KeypairRow) => void;
  onForget: (row: KeypairRow) => void;
  onDelete: (row: KeypairRow) => void;
  onExport: (row: KeypairRow) => void;
}

/** Stable key for a row (server id, else the address). */
function rowKey(row: KeypairRow): string {
  return row.id ?? row.address.toLowerCase();
}

export function KeypairTable({
  rows,
  busy = false,
  onPersist,
  onForget,
  onDelete,
  onExport,
}: KeypairTableProps) {
  if (rows.length === 0) {
    return (
      <p className="body-md px-md py-lg text-on-surface-variant">
        No keypairs yet. Generate one or import an encrypted keystore — keys are created and
        unlocked only in your browser and never sent to the server.
      </p>
    );
  }

  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Label</TableHeaderCell>
          <TableHeaderCell>Address</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell className="text-right">Actions</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={rowKey(row)}>
            <TableCell>
              <span className="body-md text-on-surface">{row.label}</span>
            </TableCell>
            <TableCell>
              <MonoAddress value={row.address} />
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap items-center gap-xs">
                <StatusDot
                  tone={row.isEphemeral ? 'idle' : 'live'}
                  pulse={!row.isEphemeral}
                />
                {row.isEphemeral ? (
                  <Badge tone="neutral">Ephemeral</Badge>
                ) : (
                  <Badge tone="success">Persisted</Badge>
                )}
                {row.unlocked ? <Badge tone="secure">Unlocked</Badge> : null}
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  icon="download"
                  disabled={busy || !row.keystore}
                  onClick={() => onExport(row)}
                >
                  Export
                </Button>
                {row.isEphemeral ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="cloud_upload"
                    disabled={busy || !row.keystore}
                    onClick={() => onPersist(row)}
                  >
                    Persist
                  </Button>
                ) : (
                  <Button
                    variant="destructive"
                    size="sm"
                    icon="cloud_off"
                    disabled={busy}
                    onClick={() => onDelete(row)}
                  >
                    Delete
                  </Button>
                )}
                {row.isEphemeral ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="close"
                    disabled={busy}
                    onClick={() => onForget(row)}
                  >
                    Forget
                  </Button>
                ) : null}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
