'use client';

// Bombard panel for the /lab shell (SPEC §7/§8.7). TPS slider, total-count input,
// estimated gas, queue status, initiate + kill controls, and live counters over
// the telemetry SSE `bombard` channel.
//
// PRIME DIRECTIVE (AGENT.md §0): the selected keypair is decrypted and used to
// BULK-sign the native transfers ONLY in this browser (lib/crypto + lib/bombard/
// sign-client). The server receives ONLY the raw SIGNED txs via /start — never
// the private key. Counts/amounts are handled as bigint/strings (never floats).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAddress } from 'viem';
import type { Hex } from 'viem';
import {
  Badge,
  Button,
  Input,
  Slider,
  StatusDot,
  Terminal,
  type LogLine,
  type LogTag,
  type StatusTone,
  useToast,
} from '@/components/ui';
import { csrfFetch } from '@/lib/csrf-client';
import { decryptKeystore, KeystoreError } from '@/lib/crypto/keystore';
import { signBombardTxs, type BombardTxTemplate } from '@/lib/bombard/sign-client';
import type { LabPanelContext } from '@/app/(app)/lab/panels';
import type { BombardRunView } from '@/lib/bombard/dto';
import type { BombardTelemetryEvent } from '@/lib/bombard/bombard-event';

/** Native transfer gas — mirrors the server's fixed 21000 for the estimate read-out. */
const GAS_PER_TX = 21_000n;
/** Slider ceiling for the UI; the server enforces the real BOMBARD_MAX_TPS. */
const TPS_SLIDER_MAX = 200;

interface PrepareResponse {
  runId: string;
  mode: string;
  nonceRange: { startNonce: number; count: number };
  template: BombardTxTemplate;
  estimatedGasPerTx: string;
  estimatedTotalGas: string;
  planToken: string;
}

function runTone(status: string): StatusTone {
  if (status === 'COMPLETED') return 'online';
  if (status === 'FAILED' || status === 'CANCELLED') return 'error';
  if (status === 'PAUSED') return 'pending';
  return 'pending';
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function BombardPanel({ keypairs }: LabPanelContext) {
  const { toast } = useToast();

  const signableKeypairs = useMemo(
    () => keypairs.filter((k) => k.encryptedKeystore !== null),
    [keypairs],
  );

  const [from, setFrom] = useState<string>(signableKeypairs[0]?.address ?? '');
  const [passphrase, setPassphrase] = useState('');
  const [to, setTo] = useState('');
  const [targetTps, setTargetTps] = useState(10);
  const [totalCount, setTotalCount] = useState(50);
  const [amountPerTx, setAmountPerTx] = useState('1');

  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<BombardRunView | null>(null);
  const [effectiveTps, setEffectiveTps] = useState<number | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);

  const runIdRef = useRef<string | null>(null);

  const pushLog = useCallback((tag: LogTag, message: string) => {
    setLog((prev) => [...prev, { time: new Date().toLocaleTimeString(), tag, message }].slice(-40));
  }, []);

  const estimatedTotalGas = useMemo(() => {
    const c = Number.isFinite(totalCount) && totalCount > 0 ? BigInt(Math.floor(totalCount)) : 0n;
    return (GAS_PER_TX * c).toString();
  }, [totalCount]);

  // Live counters over the telemetry SSE `bombard` channel (filtered to our run).
  useEffect(() => {
    let source: EventSource | null = null;
    try {
      source = new EventSource('/api/stream/telemetry', { withCredentials: true });
    } catch {
      return;
    }
    source.addEventListener('bombard', (ev: MessageEvent<string>) => {
      let data: BombardTelemetryEvent;
      try {
        data = JSON.parse(ev.data) as BombardTelemetryEvent;
      } catch {
        return;
      }
      if (data.runId !== runIdRef.current) return;
      setEffectiveTps(data.effectiveTps);
      setRun((prev) =>
        prev && prev.id === data.runId
          ? {
              ...prev,
              status: data.status,
              sentCount: data.sentCount,
              successCount: data.successCount,
              failCount: data.failCount,
            }
          : prev,
      );
    });
    return () => source?.close();
  }, []);

  // Fallback poll while a run is in flight (covers any dropped SSE frame).
  useEffect(() => {
    if (!run || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status)) return;
    const id = setInterval(async () => {
      const rid = runIdRef.current;
      if (!rid) return;
      try {
        const res = await fetch(`/api/bombard/${rid}`, { credentials: 'same-origin' });
        if (!res.ok) return;
        const body = (await res.json()) as { data: { run: BombardRunView } };
        setRun(body.data.run);
      } catch {
        // transient
      }
    }, 1_500);
    return () => clearInterval(id);
  }, [run]);

  const inFlight = run !== null && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status);

  async function onInitiate() {
    const selected = signableKeypairs.find((k) => k.address === from);
    if (!selected || !selected.encryptedKeystore) {
      toast({ message: 'Select a signable keypair.', tone: 'error', icon: 'key_off' });
      return;
    }
    if (!passphrase) {
      toast({ message: 'Enter the keystore passphrase to unlock.', tone: 'error', icon: 'lock' });
      return;
    }
    if (!isAddress(to)) {
      toast({ message: 'Enter a valid target address.', tone: 'error', icon: 'error' });
      return;
    }
    if (!/^[0-9]+$/.test(amountPerTx)) {
      toast({ message: 'Value per tx must be an integer (wei).', tone: 'error', icon: 'error' });
      return;
    }

    setBusy(true);
    setLog([]);
    setEffectiveTps(null);
    try {
      pushLog('SYSTEM', `Preparing run — ${totalCount} txs at ${targetTps} TPS…`);
      const prepRes = await csrfFetch('/api/bombard/prepare', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'CLIENT_SIGNED',
          from,
          to,
          targetTps,
          totalCount,
          amountPerTx,
        }),
      });
      if (!prepRes.ok) {
        toast({ message: await readError(prepRes, 'Prepare failed.'), tone: 'error', icon: 'error' });
        pushLog('ERROR', 'Prepare rejected (ceiling / kill-switch).');
        return;
      }
      const prep = ((await prepRes.json()) as { data: PrepareResponse }).data;
      pushLog('SYSTEM', `Run ${prep.runId.slice(0, 8)}… nonce range ${prep.nonceRange.startNonce}..${prep.nonceRange.startNonce + prep.nonceRange.count - 1}`);

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

      pushLog('SYSTEM', `Bulk-signing ${prep.nonceRange.count} txs in-browser…`);
      const rawSignedTxs = await signBombardTxs(prep.template, prep.nonceRange, privateKey, (n, t) => {
        if (n === t || n % 50 === 0) pushLog('SYSTEM', `Signed ${n}/${t}…`);
      });
      privateKey = '0x' as Hex; // drop the key reference immediately after signing

      pushLog('SYSTEM', 'Starting run — handing signed txs to the runner…');
      const startRes = await csrfFetch('/api/bombard/start', {
        method: 'POST',
        body: JSON.stringify({ runId: prep.runId, planToken: prep.planToken, rawSignedTxs }),
      });
      if (!startRes.ok) {
        toast({ message: await readError(startRes, 'Start failed.'), tone: 'error', icon: 'error' });
        pushLog('ERROR', 'Start rejected (single-run / kill-switch).');
        return;
      }
      const started = ((await startRes.json()) as { data: { run: BombardRunView } }).data.run;
      runIdRef.current = started.id;
      setRun(started);
      pushLog('SUCCESS', `Run RUNNING — ${started.totalCount} txs queued.`);
      toast({ message: 'Bombard run started.', tone: 'success', icon: 'bolt' });
      setPassphrase('');
    } catch {
      toast({ message: 'Something went wrong.', tone: 'error', icon: 'error' });
      pushLog('ERROR', 'Unexpected error during bombard.');
    } finally {
      setBusy(false);
    }
  }

  async function control(action: 'pause' | 'resume' | 'cancel') {
    const rid = runIdRef.current;
    if (!rid) return;
    try {
      const res = await csrfFetch(`/api/bombard/${rid}/${action}`, { method: 'POST' });
      if (!res.ok) {
        toast({ message: await readError(res, `${action} failed.`), tone: 'error', icon: 'error' });
        return;
      }
      const body = (await res.json()) as { data: { run: BombardRunView } };
      setRun(body.data.run);
      pushLog('SYSTEM', `Run ${action} → ${body.data.run.status}.`);
    } catch {
      toast({ message: `Could not ${action} the run.`, tone: 'error', icon: 'error' });
    }
  }

  const pct = run && run.totalCount > 0 ? Math.round((run.sentCount / run.totalCount) * 100) : 0;

  return (
    <div className="grid grid-cols-12 gap-gutter">
      <div className="col-span-12 xl:col-span-6 space-y-md">
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
          placeholder="Unlock to bulk-sign in-browser"
          leadingIcon="lock"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete="off"
        />

        <Input
          label="Target address"
          name="to"
          placeholder="0x…"
          leadingIcon="my_location"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />

        <Slider
          label="Target TPS"
          readout={`${targetTps} TPS`}
          min={1}
          max={TPS_SLIDER_MAX}
          step={1}
          value={targetTps}
          onChange={(e) => setTargetTps(Number(e.target.value))}
        />

        <div className="grid grid-cols-2 gap-md">
          <Input
            label="Total tx count"
            name="totalCount"
            type="number"
            min={1}
            leadingIcon="tag"
            value={String(totalCount)}
            onChange={(e) => setTotalCount(Math.max(1, Number(e.target.value) || 0))}
          />
          <Input
            label="Value / tx (wei)"
            name="amountPerTx"
            leadingIcon="payments"
            value={amountPerTx}
            onChange={(e) => setAmountPerTx(e.target.value.trim())}
          />
        </div>

        <div className="flex items-center justify-between rounded-md bg-surface-container px-3 py-2">
          <span className="label-caps text-on-surface-variant">Estimated total gas</span>
          <span className="code-sm font-bold text-primary">{estimatedTotalGas}</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            icon="bolt"
            disabled={busy || inFlight || signableKeypairs.length === 0}
            onClick={() => void onInitiate()}
          >
            {busy ? 'Preparing…' : 'Initiate bombard'}
          </Button>
          {inFlight && run?.status === 'RUNNING' ? (
            <Button variant="ghost" icon="pause" onClick={() => void control('pause')}>
              Pause
            </Button>
          ) : null}
          {run?.status === 'PAUSED' ? (
            <Button variant="ghost" icon="play_arrow" onClick={() => void control('resume')}>
              Resume
            </Button>
          ) : null}
          {inFlight ? (
            <Button variant="destructive" icon="dangerous" onClick={() => void control('cancel')}>
              Kill
            </Button>
          ) : null}
        </div>
      </div>

      <div className="col-span-12 xl:col-span-6 space-y-md">
        <div className="flex items-center justify-between">
          <h3 className="headline-md text-on-surface">Run status</h3>
          {run ? (
            <span className="flex items-center gap-2">
              <StatusDot tone={runTone(run.status)} />
              <Badge tone="count">{run.status}</Badge>
            </span>
          ) : (
            <Badge tone="pending">idle</Badge>
          )}
        </div>

        {run ? (
          <div className="space-y-md">
            <div className="grid grid-cols-3 gap-md">
              <Stat label="Sent" value={`${run.sentCount}/${run.totalCount}`} />
              <Stat label="Confirmed" value={String(run.successCount)} />
              <Stat label="Failed" value={String(run.failCount)} />
            </div>
            <div className="grid grid-cols-2 gap-md">
              <Stat label="Target TPS" value={String(run.targetTps)} />
              <Stat label="Effective TPS" value={effectiveTps === null ? '—' : String(effectiveTps)} />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between code-xs text-on-surface-variant">
                <span>progress</span>
                <span>{pct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-highest">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>
        ) : (
          <p className="body-md text-on-surface-variant">
            Configure a run and hit Initiate. Transactions are bulk-signed in your browser, then the
            runner paces them to the target TPS.
          </p>
        )}

        {log.length > 0 ? (
          <Terminal lines={log.slice(-8)} className="h-44" label="Bombard progress log" />
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-container px-3 py-2">
      <div className="label-caps text-on-surface-variant">{label}</div>
      <div className="headline-md text-on-surface tabular-nums">{value}</div>
    </div>
  );
}
