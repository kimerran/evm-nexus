'use client';

// Smart Wallets client surface (SPEC §7, §8.9). Three actions on one screen:
// predict a counterfactual account, deploy it (client-signed factory call), and
// send a SPONSORED (gasless) native UserOp where the paymaster pays gas.
//
// PRIME DIRECTIVE (AGENT.md §0): the owner keypair is decrypted and used to sign
// ONLY in the browser — the deploy tx via lib/transfers/sign-client, the userOp
// via lib/smart-wallets/sign-client. The server never sees the private key: it
// receives a raw signed tx (/deploy/broadcast) or a signed UserOp (/userops/send).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseEther, isAddress } from 'viem';
import type { Hex } from 'viem';
import {
  Badge,
  Button,
  Card,
  Input,
  MonoAddress,
  StatusDot,
  Terminal,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  type LogLine,
  type LogTag,
  type StatusTone,
  useToast,
} from '@/components/ui';
import { csrfFetch } from '@/lib/csrf-client';
import { decryptKeystore, KeystoreError } from '@/lib/crypto/keystore';
import { signTransferTx, type UnsignedTransferTx } from '@/lib/transfers/sign-client';
import { signUserOpHash } from '@/lib/smart-wallets/sign-client';
import type { KeypairDto } from '@/lib/keypairs/dto';
import type { SmartAccountView } from '@/lib/smart-wallets/dto';

export interface SmartWalletsClientProps {
  networkId: string;
  nativeSymbol: string;
  explorerBaseUrl: string | null;
  entryPoint: string;
  paymaster: string;
  initialKeypairs: KeypairDto[];
  initialAccounts: SmartAccountView[];
}

function accountTone(isDeployed: boolean): StatusTone {
  return isDeployed ? 'online' : 'idle';
}

export function SmartWalletsClient({
  networkId,
  nativeSymbol,
  explorerBaseUrl,
  entryPoint,
  paymaster,
  initialKeypairs,
  initialAccounts,
}: SmartWalletsClientProps) {
  const { toast } = useToast();

  const signableKeypairs = useMemo(
    () => initialKeypairs.filter((k) => k.encryptedKeystore !== null),
    [initialKeypairs],
  );

  const [ownerAddress, setOwnerAddress] = useState<string>(signableKeypairs[0]?.address ?? '');
  const [salt, setSalt] = useState('0');
  const [passphrase, setPassphrase] = useState('');
  const [predicted, setPredicted] = useState<string | null>(null);

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('0.01');

  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [accounts, setAccounts] = useState<SmartAccountView[]>(initialAccounts);

  const pushLog = useCallback((tag: LogTag, message: string) => {
    setLog((prev) => [...prev, { time: new Date().toLocaleTimeString(), tag, message }]);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/smart-accounts', { credentials: 'same-origin' });
      if (!res.ok) return;
      const body = (await res.json()) as { data?: { smartAccounts?: SmartAccountView[] } };
      if (Array.isArray(body.data?.smartAccounts)) setAccounts(body.data.smartAccounts);
    } catch {
      // transient; next action refreshes
    }
  }, []);

  // Poll while any account is still counterfactual (a sponsored send may deploy it).
  useEffect(() => {
    if (!accounts.some((a) => !a.isDeployed)) return;
    const id = setInterval(refresh, 3_000);
    return () => clearInterval(id);
  }, [accounts, refresh]);

  async function readError(res: Response, fallback: string): Promise<string> {
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      return body.error?.message ?? fallback;
    } catch {
      return fallback;
    }
  }

  function requireOwner(): KeypairDto | null {
    if (!isAddress(ownerAddress)) {
      toast({ message: 'Pick a signable owner keypair.', tone: 'error', icon: 'key_off' });
      return null;
    }
    const kp = signableKeypairs.find((k) => k.address === ownerAddress);
    if (!kp || !kp.encryptedKeystore) {
      toast({ message: 'Select a signable keypair.', tone: 'error', icon: 'key_off' });
      return null;
    }
    return kp;
  }

  async function onPredict() {
    if (!requireOwner()) return;
    setBusy(true);
    try {
      const res = await csrfFetch('/api/smart-accounts/predict', {
        method: 'POST',
        body: JSON.stringify({ networkId, ownerAddress, salt: salt.trim() || '0' }),
      });
      if (!res.ok) {
        toast({ message: await readError(res, 'Predict failed.'), tone: 'error', icon: 'error' });
        return;
      }
      const data = (
        (await res.json()) as { data: { accountAddress: string; isDeployed: boolean } }
      ).data;
      setPredicted(data.accountAddress);
      pushLog(
        'SYSTEM',
        `Predicted account ${data.accountAddress} (${data.isDeployed ? 'deployed' : 'counterfactual'}).`,
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function unlock(kp: KeypairDto): Promise<Hex | null> {
    if (!passphrase) {
      toast({ message: 'Enter the keystore passphrase to unlock.', tone: 'error', icon: 'lock' });
      return null;
    }
    try {
      return (await decryptKeystore(kp.encryptedKeystore, passphrase)).privateKey;
    } catch (err) {
      const message =
        err instanceof KeystoreError ? 'Incorrect passphrase.' : 'Could not unlock keypair.';
      toast({ message, tone: 'error', icon: 'lock' });
      return null;
    }
  }

  async function onDeploy() {
    const kp = requireOwner();
    if (!kp) return;
    setBusy(true);
    try {
      pushLog('SYSTEM', 'Preparing factory createAccount tx…');
      const prepRes = await csrfFetch('/api/smart-accounts/deploy', {
        method: 'POST',
        body: JSON.stringify({ networkId, ownerAddress, salt: salt.trim() || '0' }),
      });
      if (!prepRes.ok) {
        toast({ message: await readError(prepRes, 'Prepare failed.'), tone: 'error', icon: 'error' });
        return;
      }
      const prep = (
        (await prepRes.json()) as {
          data: { accountAddress: string; deployDraftId: string; unsignedTx: UnsignedTransferTx };
        }
      ).data;

      pushLog('SYSTEM', 'Unlocking owner keypair in-browser…');
      let privateKey = await unlock(kp);
      if (!privateKey) return;

      pushLog('SYSTEM', 'Signing deploy tx in-browser…');
      const rawSignedTx = await signTransferTx(prep.unsignedTx, privateKey);
      privateKey = '0x' as Hex;

      pushLog('SYSTEM', 'Broadcasting signed deploy tx…');
      const bRes = await csrfFetch('/api/smart-accounts/deploy/broadcast', {
        method: 'POST',
        body: JSON.stringify({ networkId, deployDraftId: prep.deployDraftId, rawSignedTx }),
      });
      if (!bRes.ok) {
        toast({ message: await readError(bRes, 'Broadcast failed.'), tone: 'error', icon: 'error' });
        pushLog('ERROR', 'Deploy broadcast rejected.');
        return;
      }
      pushLog('SUCCESS', `Deploy broadcast for ${prep.accountAddress}. Watching for code…`);
      toast({ message: 'Smart account deploy broadcast.', tone: 'success', icon: 'rocket_launch' });
      setPassphrase('');
      await refresh();
    } catch {
      toast({ message: 'Something went wrong.', tone: 'error', icon: 'error' });
      pushLog('ERROR', 'Unexpected error during deploy.');
    } finally {
      setBusy(false);
    }
  }

  async function onSponsoredSend() {
    const kp = requireOwner();
    if (!kp) return;
    if (!isAddress(recipient)) {
      toast({ message: 'Enter a valid recipient address.', tone: 'error', icon: 'error' });
      return;
    }
    setBusy(true);
    try {
      pushLog('SYSTEM', 'Requesting paymaster sponsorship…');
      const sponsorRes = await csrfFetch('/api/userops/sponsor', {
        method: 'POST',
        body: JSON.stringify({
          networkId,
          ownerAddress,
          salt: salt.trim() || '0',
          call: { to: recipient, value: parseEther(amount || '0').toString(), data: '0x' },
        }),
      });
      if (!sponsorRes.ok) {
        toast({ message: await readError(sponsorRes, 'Sponsor failed.'), tone: 'error', icon: 'error' });
        pushLog('ERROR', 'Sponsorship rejected.');
        return;
      }
      const sponsor = (
        (await sponsorRes.json()) as {
          data: { sender: string; userOp: Record<string, unknown>; userOpHash: Hex };
        }
      ).data;
      pushLog('SYSTEM', `Paymaster signed. Smart account ${sponsor.sender.slice(0, 10)}…`);

      pushLog('SYSTEM', 'Unlocking owner keypair in-browser…');
      let privateKey = await unlock(kp);
      if (!privateKey) return;

      pushLog('SYSTEM', 'Signing userOpHash in-browser…');
      const signature = await signUserOpHash(sponsor.userOpHash, privateKey);
      privateKey = '0x' as Hex;

      pushLog('SYSTEM', 'Submitting sponsored UserOp to the bundler…');
      const sendRes = await csrfFetch('/api/userops/send', {
        method: 'POST',
        body: JSON.stringify({ networkId, userOp: { ...sponsor.userOp, signature } }),
      });
      if (!sendRes.ok) {
        toast({ message: await readError(sendRes, 'Send failed.'), tone: 'error', icon: 'error' });
        pushLog('ERROR', 'Bundler submission rejected.');
        return;
      }
      pushLog('SUCCESS', 'Sponsored UserOp queued — owner pays ZERO gas. Watching receipt.');
      toast({ message: 'Sponsored UserOp submitted.', tone: 'success', icon: 'bolt' });
      setPassphrase('');
      await refresh();
    } catch {
      toast({ message: 'Something went wrong.', tone: 'error', icon: 'error' });
      pushLog('ERROR', 'Unexpected error during sponsored send.');
    } finally {
      setBusy(false);
    }
  }

  const explorerAddr = (addr: string) =>
    explorerBaseUrl ? `${explorerBaseUrl.replace(/\/$/, '')}/address/${addr}` : null;

  return (
    <div className="grid grid-cols-12 gap-gutter">
      {/* Owner + account */}
      <Card className="col-span-12 lg:col-span-5 space-y-lg">
        <div className="space-y-1">
          <h2 className="headline-md text-on-surface">Account</h2>
          <p className="code-xs text-on-surface-variant">
            EntryPoint <MonoAddress value={entryPoint} /> · Paymaster <MonoAddress value={paymaster} />
          </p>
        </div>

        <div className="space-y-md">
          <label className="flex flex-col gap-1.5">
            <span className="label-caps text-on-surface-variant">Owner keypair</span>
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
                value={ownerAddress}
                onChange={(e) => {
                  setOwnerAddress(e.target.value);
                  setPredicted(null);
                }}
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

          <div className="grid grid-cols-2 gap-md">
            <Input
              label="Salt"
              name="salt"
              placeholder="0"
              leadingIcon="tag"
              value={salt}
              onChange={(e) => {
                setSalt(e.target.value);
                setPredicted(null);
              }}
            />
            <div className="flex items-end">
              <Button variant="secondary" icon="calculate" disabled={busy} onClick={() => void onPredict()}>
                Predict
              </Button>
            </div>
          </div>

          {predicted ? (
            <div className="rounded-md bg-surface-container p-3 space-y-1">
              <span className="label-caps text-on-surface-variant">Counterfactual address</span>
              <div className="code-sm text-on-surface">
                <MonoAddress value={predicted} />
              </div>
            </div>
          ) : null}

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

          <Button
            variant="secondary"
            icon="rocket_launch"
            disabled={busy || signableKeypairs.length === 0}
            onClick={() => void onDeploy()}
          >
            Deploy account (client-signed)
          </Button>
        </div>
      </Card>

      {/* Sponsored send */}
      <Card className="col-span-12 lg:col-span-7 space-y-lg">
        <div className="space-y-1">
          <h2 className="headline-md text-on-surface">Sponsored send (gasless)</h2>
          <p className="body-md text-on-surface-variant">
            Send native {nativeSymbol} from your smart account. The paymaster pays gas — your owner
            EOA pays nothing. The smart account must hold the funds it sends; deployment happens
            automatically on the first UserOp.
          </p>
        </div>

        <div className="space-y-md">
          <Input
            label="Recipient address"
            name="recipient"
            placeholder="0x…"
            leadingIcon="person"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
          <Input
            label={`Amount (${nativeSymbol})`}
            name="amount"
            placeholder="0.01"
            leadingIcon="payments"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              icon="bolt"
              disabled={busy || signableKeypairs.length === 0}
              onClick={() => void onSponsoredSend()}
            >
              {busy ? 'Working…' : 'Send sponsored'}
            </Button>
            <Badge tone="secure">paymaster pays gas</Badge>
          </div>
        </div>

        {log.length > 0 ? (
          <Terminal lines={log} className="h-56" label="Smart wallet activity log" />
        ) : null}
      </Card>

      {/* Accounts */}
      <Card className="col-span-12 space-y-md">
        <div className="flex items-center justify-between">
          <h2 className="headline-md text-on-surface">Your smart accounts</h2>
          <Badge tone="count">{accounts.length}</Badge>
        </div>
        {accounts.length === 0 ? (
          <p className="body-md text-on-surface-variant">
            No smart accounts yet. Predict one above to get started.
          </p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Account</TableHeaderCell>
                <TableHeaderCell>Owner</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {accounts.map((a) => {
                const href = explorerAddr(a.accountAddress);
                return (
                  <TableRow key={a.id}>
                    <TableCell>
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary">
                          <MonoAddress value={a.accountAddress} />
                        </a>
                      ) : (
                        <MonoAddress value={a.accountAddress} />
                      )}
                    </TableCell>
                    <TableCell>
                      <MonoAddress value={a.ownerAddress} />
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <StatusDot tone={accountTone(a.isDeployed)} />
                        <span className="code-sm text-on-surface-variant">
                          {a.isDeployed ? 'DEPLOYED' : 'COUNTERFACTUAL'}
                        </span>
                      </span>
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
