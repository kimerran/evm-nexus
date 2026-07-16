'use client';

// Asset Launchpad client surface (SPEC §7, §8.5). Tabs for ERC-20/721/1155 with
// per-standard inputs + feature toggles, a gas/congestion estimate, a live
// deployment-progress terminal, and a recent-deployments table.
//
// PRIME DIRECTIVE (AGENT.md §0): the selected keypair is decrypted and used to
// sign the deploy tx ONLY in this browser (lib/crypto + lib/deployments/sign-
// client). The server receives ONLY the raw SIGNED tx via /broadcast — never the
// private key. Amounts are handled as bigint/wei via viem (never floats).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseEther, isAddress } from 'viem';
import type { Hex } from 'viem';
import {
  Badge,
  Button,
  Card,
  Input,
  Toggle,
  Terminal,
  MonoAddress,
  StatusDot,
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
import { signDeployTx, type UnsignedDeployTx } from '@/lib/deployments/sign-client';
import type { KeypairDto } from '@/lib/keypairs/dto';
import type { DeploymentView } from '@/lib/deployments/dto';

type Standard = 'ERC20' | 'ERC721' | 'ERC1155';

interface EstimateResponse {
  estimatedGas: string;
  baseFee: string;
  congestion: 'low' | 'medium' | 'high';
  deploymentDraftId: string;
  unsignedTx: UnsignedDeployTx;
}

const TABS: { id: Standard; label: string }[] = [
  { id: 'ERC20', label: 'ERC-20' },
  { id: 'ERC721', label: 'ERC-721' },
  { id: 'ERC1155', label: 'ERC-1155' },
];

const FEATURES: Record<Standard, { key: string; label: string }[]> = {
  ERC20: [
    { key: 'mintable', label: 'Mintable' },
    { key: 'burnable', label: 'Burnable' },
    { key: 'pausable', label: 'Pausable' },
    { key: 'permit', label: 'Permit (EIP-2612)' },
  ],
  ERC721: [
    { key: 'mintable', label: 'Mintable' },
    { key: 'burnable', label: 'Burnable' },
    { key: 'pausable', label: 'Pausable' },
  ],
  ERC1155: [
    { key: 'mintable', label: 'Mintable' },
    { key: 'burnable', label: 'Burnable' },
    { key: 'pausable', label: 'Pausable' },
    { key: 'supply', label: 'Supply tracking' },
  ],
};

function statusTone(status: string): StatusTone {
  if (status === 'SUCCESS') return 'online';
  if (status === 'FAILED' || status === 'REJECTED') return 'error';
  if (status === 'PENDING' || status === 'BROADCAST' || status === 'CONFIRMING') return 'pending';
  return 'idle';
}

export interface LaunchpadClientProps {
  networkId: string;
  nativeSymbol: string;
  explorerBaseUrl: string | null;
  initialKeypairs: KeypairDto[];
  initialDeployments: DeploymentView[];
}

export function LaunchpadClient({
  networkId,
  nativeSymbol,
  explorerBaseUrl,
  initialKeypairs,
  initialDeployments,
}: LaunchpadClientProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<Standard>('ERC20');

  // Only keypairs with a persisted encrypted keystore can sign here.
  const signableKeypairs = useMemo(
    () => initialKeypairs.filter((k) => k.encryptedKeystore !== null),
    [initialKeypairs],
  );

  const [ownerAddress, setOwnerAddress] = useState<string>(signableKeypairs[0]?.address ?? '');
  const [passphrase, setPassphrase] = useState('');

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [initialSupply, setInitialSupply] = useState('1000');
  const [baseUri, setBaseUri] = useState('');
  const [features, setFeatures] = useState<Record<string, boolean>>({});

  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [deployments, setDeployments] = useState<DeploymentView[]>(initialDeployments);

  const now = () => new Date().toLocaleTimeString();
  const pushLog = useCallback((tag: LogTag, message: string) => {
    setLog((prev) => [...prev, { time: now(), tag, message }]);
  }, []);

  const toggleFeature = (key: string) =>
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }));

  // Reset the estimate whenever the request inputs change (it is no longer valid).
  useEffect(() => {
    setEstimate(null);
  }, [tab, name, symbol, initialSupply, baseUri, features, ownerAddress]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/deployments?limit=25', { credentials: 'same-origin' });
      if (!res.ok) return;
      const body: unknown = await res.json();
      if (body && typeof body === 'object' && 'data' in body) {
        const data = (body as { data: { deployments?: DeploymentView[] } }).data;
        if (Array.isArray(data.deployments)) setDeployments(data.deployments);
      }
    } catch {
      // transient; next poll retries
    }
  }, []);

  // Poll while any deployment is in-flight so status transitions surface live.
  useEffect(() => {
    const inFlight = deployments.some((d) =>
      ['PENDING', 'BROADCAST', 'CONFIRMING'].includes(d.status),
    );
    if (!inFlight) return;
    const id = setInterval(refresh, 3_000);
    return () => clearInterval(id);
  }, [deployments, refresh]);

  function buildEstimateBody(): Record<string, unknown> | null {
    if (!isAddress(ownerAddress)) {
      toast({ message: 'Pick a signable keypair first.', tone: 'error', icon: 'key_off' });
      return null;
    }
    const featureFlags = Object.fromEntries(
      FEATURES[tab].map((f) => [f.key, Boolean(features[f.key])]),
    );
    if (tab === 'ERC20') {
      if (!name.trim() || !symbol.trim()) {
        toast({ message: 'Name and symbol are required.', tone: 'error', icon: 'error' });
        return null;
      }
      return {
        standard: 'ERC20',
        networkId,
        ownerAddress,
        name: name.trim(),
        symbol: symbol.trim(),
        initialSupply: parseEther(initialSupply || '0').toString(),
        features: featureFlags,
      };
    }
    if (tab === 'ERC721') {
      if (!name.trim() || !symbol.trim()) {
        toast({ message: 'Name and symbol are required.', tone: 'error', icon: 'error' });
        return null;
      }
      return {
        standard: 'ERC721',
        networkId,
        ownerAddress,
        name: name.trim(),
        symbol: symbol.trim(),
        baseUri: baseUri.trim() || undefined,
        features: featureFlags,
      };
    }
    return {
      standard: 'ERC1155',
      networkId,
      ownerAddress,
      baseUri: baseUri.trim() || undefined,
      features: featureFlags,
    };
  }

  async function readError(res: Response, fallback: string): Promise<string> {
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      return body.error?.message ?? fallback;
    } catch {
      return fallback;
    }
  }

  async function onEstimate(): Promise<EstimateResponse | null> {
    const body = buildEstimateBody();
    if (!body) return null;
    const res = await csrfFetch('/api/deployments/estimate', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      toast({ message: await readError(res, 'Estimate failed.'), tone: 'error', icon: 'error' });
      return null;
    }
    const parsed = (await res.json()) as { data: EstimateResponse };
    setEstimate(parsed.data);
    pushLog(
      'SYSTEM',
      `Estimated gas ${parsed.data.estimatedGas} · congestion ${parsed.data.congestion}`,
    );
    return parsed.data;
  }

  async function onDeploy() {
    const selected = signableKeypairs.find((k) => k.address === ownerAddress);
    if (!selected || !selected.encryptedKeystore) {
      toast({ message: 'Select a signable keypair.', tone: 'error', icon: 'key_off' });
      return;
    }
    if (!passphrase) {
      toast({ message: 'Enter the keystore passphrase to unlock.', tone: 'error', icon: 'lock' });
      return;
    }

    setBusy(true);
    try {
      const est = estimate ?? (await onEstimate());
      if (!est) return;

      // Decrypt IN-BROWSER — the private key never leaves this scope.
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

      pushLog('SYSTEM', 'Signing deploy tx in-browser…');
      const rawSignedTx = await signDeployTx(est.unsignedTx, privateKey);
      // Drop the key reference immediately after signing.
      privateKey = '0x' as Hex;

      pushLog('SYSTEM', 'Broadcasting signed tx…');
      const res = await csrfFetch('/api/deployments/broadcast', {
        method: 'POST',
        body: JSON.stringify({ networkId, deploymentDraftId: est.deploymentDraftId, rawSignedTx }),
      });
      if (!res.ok) {
        toast({ message: await readError(res, 'Broadcast failed.'), tone: 'error', icon: 'error' });
        pushLog('ERROR', 'Broadcast rejected.');
        return;
      }
      const parsed = (await res.json()) as { data: { txHash: string; deploymentId: string } };
      pushLog('SUCCESS', `Broadcast — tx ${parsed.data.txHash.slice(0, 10)}… watching receipt`);
      toast({ message: 'Deployment broadcast.', tone: 'success', icon: 'rocket_launch' });
      setEstimate(null);
      setPassphrase('');
      await refresh();
    } catch {
      toast({ message: 'Something went wrong.', tone: 'error', icon: 'error' });
      pushLog('ERROR', 'Unexpected error during deploy.');
    } finally {
      setBusy(false);
    }
  }

  const showNameSymbol = tab !== 'ERC1155';
  const showBaseUri = tab !== 'ERC20';
  const showSupply = tab === 'ERC20';

  return (
    <div className="grid grid-cols-12 gap-gutter">
      {/* Configure + deploy */}
      <Card className="col-span-12 lg:col-span-6 space-y-lg">
        <div className="flex gap-2" role="tablist" aria-label="Token standard">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setFeatures({});
              }}
              className={
                tab === t.id
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
            <span className="label-caps text-on-surface-variant">Deployer keypair</span>
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
                onChange={(e) => setOwnerAddress(e.target.value)}
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

          {showNameSymbol ? (
            <div className="grid grid-cols-2 gap-md">
              <Input
                label="Name"
                name="name"
                placeholder="Nexus Gold"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Input
                label="Symbol"
                name="symbol"
                placeholder="NXG"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
              />
            </div>
          ) : null}

          {showSupply ? (
            <Input
              label={`Initial supply (${nativeSymbol === '' ? 'tokens' : 'tokens'})`}
              name="initialSupply"
              placeholder="1000"
              leadingIcon="tag"
              value={initialSupply}
              onChange={(e) => setInitialSupply(e.target.value)}
            />
          ) : null}

          {showBaseUri ? (
            <Input
              label="Base URI"
              name="baseUri"
              placeholder={tab === 'ERC1155' ? 'ipfs://…/{id}.json' : 'ipfs://…/'}
              leadingIcon="link"
              value={baseUri}
              onChange={(e) => setBaseUri(e.target.value)}
            />
          ) : null}

          <div className="space-y-2">
            <span className="label-caps text-on-surface-variant">Features</span>
            <div className="grid grid-cols-2 gap-2">
              {FEATURES[tab].map((f) => (
                <label
                  key={f.key}
                  className="flex items-center justify-between gap-2 rounded-md bg-surface-container px-3 py-2"
                >
                  <span className="body-md text-on-surface">{f.label}</span>
                  <Toggle
                    aria-label={f.label}
                    checked={Boolean(features[f.key])}
                    onChange={() => toggleFeature(f.key)}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" icon="calculate" disabled={busy} onClick={() => void onEstimate()}>
            Estimate
          </Button>
          <Button
            variant="primary"
            icon="rocket_launch"
            disabled={busy || signableKeypairs.length === 0}
            onClick={() => void onDeploy()}
          >
            {busy ? 'Deploying…' : 'Deploy'}
          </Button>
        </div>

        {estimate ? (
          <div className="flex flex-wrap gap-3 rounded-md bg-surface-container p-3">
            <Badge tone="count">gas ~{estimate.estimatedGas}</Badge>
            <Badge tone="count">baseFee {estimate.baseFee} wei</Badge>
            <Badge tone={estimate.congestion === 'high' ? 'error' : 'count'}>
              congestion {estimate.congestion}
            </Badge>
          </div>
        ) : null}
      </Card>

      {/* Progress terminal */}
      <Card className="col-span-12 lg:col-span-6 space-y-md">
        <h2 className="headline-md text-on-surface">Deployment progress</h2>
        {log.length === 0 ? (
          <p className="body-md text-on-surface-variant">
            Configure a token, estimate gas, then deploy. Signing happens in your browser.
          </p>
        ) : (
          <Terminal lines={log} className="h-72" label="Deployment progress log" />
        )}
      </Card>

      {/* Recent deployments */}
      <Card className="col-span-12 space-y-md">
        <div className="flex items-center justify-between">
          <h2 className="headline-md text-on-surface">Recent deployments</h2>
          <Badge tone="count">{deployments.length}</Badge>
        </div>
        {deployments.length === 0 ? (
          <p className="body-md text-on-surface-variant">No deployments yet.</p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Token</TableHeaderCell>
                <TableHeaderCell>Standard</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Contract</TableHeaderCell>
                <TableHeaderCell>Gas used</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {deployments.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <span className="body-md text-on-surface">{d.name}</span>
                    {d.symbol ? (
                      <span className="code-xs text-on-surface-variant"> {d.symbol}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <span className="code-sm text-on-surface-variant">{d.standard}</span>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <StatusDot tone={statusTone(d.status)} />
                      <span className="code-sm text-on-surface-variant">{d.status}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    {d.contractAddress ? (
                      explorerBaseUrl ? (
                        <a
                          href={`${explorerBaseUrl.replace(/\/$/, '')}/address/${d.contractAddress}`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-primary"
                        >
                          <MonoAddress value={d.contractAddress} />
                        </a>
                      ) : (
                        <MonoAddress value={d.contractAddress} />
                      )
                    ) : (
                      <span className="code-xs text-on-surface-variant">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="code-sm text-on-surface-variant">{d.gasUsed ?? '—'}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
