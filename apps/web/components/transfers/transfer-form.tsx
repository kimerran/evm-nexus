'use client';

// Reusable new-transfer form (SPEC §7/§8.6). Used by BOTH the /transfers page and
// the /lab Transfer Assets panel. Tabs for native / ERC-20 / ERC-721 / ERC-1155,
// a sponsored toggle (Sprint-8 stub), keypair select + passphrase, and a live
// progress terminal.
//
// PRIME DIRECTIVE (AGENT.md §0): the selected keypair is decrypted and used to
// sign the transfer tx ONLY in this browser (lib/crypto + lib/transfers/sign-
// client). The server receives ONLY the raw SIGNED tx via /broadcast — never the
// private key. Amounts are handled as bigint/wei via viem (never floats).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseEther, isAddress } from 'viem';
import type { Hex } from 'viem';
import {
  Badge,
  Button,
  Input,
  Toggle,
  Terminal,
  type LogLine,
  type LogTag,
  useToast,
} from '@/components/ui';
import { csrfFetch } from '@/lib/csrf-client';
import { decryptKeystore, KeystoreError } from '@/lib/crypto/keystore';
import { signTransferTx, type UnsignedTransferTx } from '@/lib/transfers/sign-client';
import type { KeypairDto } from '@/lib/keypairs/dto';

export type TransferKind = 'NATIVE' | 'ERC20' | 'ERC721' | 'ERC1155';

type PrepareResponse =
  | {
      mode: 'client-signed';
      estimatedGas: string;
      baseFee: string;
      transferDraftId: string;
      unsignedTx: UnsignedTransferTx;
    }
  | { mode: 'sponsored-unavailable'; sprint: number; message: string };

const TABS: { id: TransferKind; label: string }[] = [
  { id: 'NATIVE', label: 'Native' },
  { id: 'ERC20', label: 'ERC-20' },
  { id: 'ERC721', label: 'ERC-721' },
  { id: 'ERC1155', label: 'ERC-1155' },
];

export interface TransferFormProps {
  networkId: string;
  nativeSymbol: string;
  keypairs: KeypairDto[];
  /** Called after a successful broadcast (e.g. to refresh a history table). */
  onBroadcast?: () => void;
  /** Compact layout for the /lab panel (hides the standalone progress terminal). */
  compact?: boolean;
}

export function TransferForm({
  networkId,
  nativeSymbol,
  keypairs,
  onBroadcast,
  compact = false,
}: TransferFormProps) {
  const { toast } = useToast();
  const [kind, setKind] = useState<TransferKind>('NATIVE');

  const signableKeypairs = useMemo(
    () => keypairs.filter((k) => k.encryptedKeystore !== null),
    [keypairs],
  );

  const [from, setFrom] = useState<string>(signableKeypairs[0]?.address ?? '');
  const [passphrase, setPassphrase] = useState('');
  const [to, setTo] = useState('');
  const [tokenAddress, setTokenAddress] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [amount, setAmount] = useState('');
  const [sponsored, setSponsored] = useState(false);

  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);

  const pushLog = useCallback((tag: LogTag, message: string) => {
    setLog((prev) => [...prev, { time: new Date().toLocaleTimeString(), tag, message }]);
  }, []);

  useEffect(() => {
    // Reset asset-specific inputs when switching kind.
    setTokenAddress('');
    setTokenId('');
    setAmount('');
  }, [kind]);

  const showToken = kind !== 'NATIVE';
  const showTokenId = kind === 'ERC721' || kind === 'ERC1155';
  const showAmount = kind !== 'ERC721';

  function buildPrepareBody(): Record<string, unknown> | null {
    if (!isAddress(from)) {
      toast({ message: 'Pick a signable keypair first.', tone: 'error', icon: 'key_off' });
      return null;
    }
    if (!isAddress(to)) {
      toast({ message: 'Enter a valid recipient address.', tone: 'error', icon: 'error' });
      return null;
    }
    if (showToken && !isAddress(tokenAddress)) {
      toast({ message: 'Enter a valid token contract address.', tone: 'error', icon: 'error' });
      return null;
    }
    const base = { networkId, from, to, sponsored };
    try {
      if (kind === 'NATIVE') {
        return { ...base, kind, amount: parseEther(amount || '0').toString() };
      }
      if (kind === 'ERC20') {
        return {
          ...base,
          kind,
          tokenAddress,
          amount: parseEther(amount || '0').toString(),
        };
      }
      if (kind === 'ERC721') {
        return { ...base, kind, tokenAddress, tokenId: tokenId.trim() };
      }
      // ERC1155 — amount is an integer token count (no decimals).
      return { ...base, kind, tokenAddress, tokenId: tokenId.trim(), amount: (amount || '0').trim() };
    } catch {
      toast({ message: 'Invalid amount.', tone: 'error', icon: 'error' });
      return null;
    }
  }

  async function readError(res: Response, fallback: string): Promise<string> {
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      return body.error?.message ?? fallback;
    } catch {
      return fallback;
    }
  }

  async function onSend() {
    const selected = signableKeypairs.find((k) => k.address === from);
    if (!selected || !selected.encryptedKeystore) {
      toast({ message: 'Select a signable keypair.', tone: 'error', icon: 'key_off' });
      return;
    }
    if (!passphrase) {
      toast({ message: 'Enter the keystore passphrase to unlock.', tone: 'error', icon: 'lock' });
      return;
    }
    const body = buildPrepareBody();
    if (!body) return;

    setBusy(true);
    try {
      pushLog('SYSTEM', `Preparing ${kind} transfer…`);
      const prepRes = await csrfFetch('/api/transfers/prepare', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!prepRes.ok) {
        toast({ message: await readError(prepRes, 'Prepare failed.'), tone: 'error', icon: 'error' });
        pushLog('ERROR', 'Prepare rejected.');
        return;
      }
      const prep = ((await prepRes.json()) as { data: PrepareResponse }).data;

      if (prep.mode === 'sponsored-unavailable') {
        pushLog('SYSTEM', prep.message);
        toast({ message: prep.message, tone: 'info', icon: 'schedule' });
        return;
      }

      pushLog('SYSTEM', `Unlocking ${selected.label} in-browser…`);
      let privateKey: Hex;
      try {
        const decrypted = await decryptKeystore(selected.encryptedKeystore, passphrase);
        privateKey = decrypted.privateKey;
      } catch (err) {
        const message =
          err instanceof KeystoreError ? 'Incorrect passphrase.' : 'Could not unlock keypair.';
        toast({ message, tone: 'error', icon: 'lock' });
        return;
      }

      pushLog('SYSTEM', 'Signing transfer tx in-browser…');
      const rawSignedTx = await signTransferTx(prep.unsignedTx, privateKey);
      privateKey = '0x' as Hex; // drop the key reference immediately after signing

      pushLog('SYSTEM', 'Broadcasting signed tx…');
      const bRes = await csrfFetch('/api/transfers/broadcast', {
        method: 'POST',
        body: JSON.stringify({ networkId, transferDraftId: prep.transferDraftId, rawSignedTx }),
      });
      if (!bRes.ok) {
        toast({ message: await readError(bRes, 'Broadcast failed.'), tone: 'error', icon: 'error' });
        pushLog('ERROR', 'Broadcast rejected.');
        return;
      }
      const out = (await bRes.json()) as { data: { txHash: string; transferId: string } };
      pushLog('SUCCESS', `Broadcast — tx ${out.data.txHash.slice(0, 10)}… watching receipt`);
      toast({ message: 'Transfer broadcast.', tone: 'success', icon: 'send' });
      setPassphrase('');
      setAmount('');
      onBroadcast?.();
    } catch {
      toast({ message: 'Something went wrong.', tone: 'error', icon: 'error' });
      pushLog('ERROR', 'Unexpected error during transfer.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-lg">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Transfer kind">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={kind === t.id}
            onClick={() => setKind(t.id)}
            className={
              kind === t.id
                ? 'rounded-md bg-primary-container px-3 py-1.5 label-caps text-on-primary-container'
                : 'rounded-md bg-surface-container-highest px-3 py-1.5 label-caps text-on-surface-variant'
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-md">
        <label className="flex flex-col gap-1.5">
          <span className="label-caps text-on-surface-variant">Sender keypair</span>
          {signableKeypairs.length === 0 ? (
            <span className="body-md text-on-surface-variant">
              No signable keypair. Create one in{' '}
              <a href="/keypairs" className="text-primary underline">
                Keypairs
              </a>{' '}
              (persist it so it can sign here).
            </span>
          ) : (
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border border-outline bg-surface-container px-3 py-2 code-sm text-on-surface"
            >
              {signableKeypairs.map((k) => (
                <option key={k.id} value={k.address}>
                  {k.label} — {k.address.slice(0, 8)}…{k.address.slice(-6)}
                </option>
              ))}
            </select>
          )}
        </label>

        <Input
          label="Keystore passphrase"
          type="password"
          name="passphrase"
          placeholder="Unlock to sign in-browser"
          leadingIcon="lock"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete="off"
        />

        <Input
          label="Recipient address"
          name="to"
          placeholder="0x…"
          leadingIcon="person"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />

        {showToken ? (
          <Input
            label="Token contract address"
            name="tokenAddress"
            placeholder="0x…"
            leadingIcon="token"
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
          />
        ) : null}

        {showTokenId ? (
          <Input
            label="Token ID"
            name="tokenId"
            placeholder="0"
            leadingIcon="tag"
            value={tokenId}
            onChange={(e) => setTokenId(e.target.value)}
          />
        ) : null}

        {showAmount ? (
          <Input
            label={
              kind === 'NATIVE'
                ? `Amount (${nativeSymbol})`
                : kind === 'ERC20'
                  ? 'Amount (tokens)'
                  : 'Amount (units)'
            }
            name="amount"
            placeholder={kind === 'ERC1155' ? '1' : '0.1'}
            leadingIcon="payments"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        ) : null}

        <label className="flex items-center justify-between gap-2 rounded-md bg-surface-container px-3 py-2">
          <span className="flex flex-col">
            <span className="body-md text-on-surface">Sponsored (gasless)</span>
            <span className="code-xs text-on-surface-variant">Paymaster — Sprint 8</span>
          </span>
          <Toggle
            aria-label="Sponsored transfer"
            checked={sponsored}
            onChange={() => setSponsored((v) => !v)}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          icon="send"
          disabled={busy || signableKeypairs.length === 0}
          onClick={() => void onSend()}
        >
          {busy ? 'Sending…' : 'Send transfer'}
        </Button>
        {sponsored ? <Badge tone="count">sponsored</Badge> : null}
      </div>

      {!compact && log.length > 0 ? (
        <Terminal lines={log} className="h-56" label="Transfer progress log" />
      ) : null}
      {compact && log.length > 0 ? (
        <Terminal lines={log.slice(-6)} className="h-40" label="Transfer progress log" />
      ) : null}
    </div>
  );
}
