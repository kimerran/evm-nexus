'use client';

import { useEffect, useState } from 'react';
import { Card, Button, StatusDot, MonoAddress } from '@/components/ui';

/** Minimal EIP-1193 surface we use — enough to request accounts + chainId. */
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
}

function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === 'undefined') return null;
  const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  return injected ?? null;
}

type ConnState = 'idle' | 'connecting' | 'connected' | 'unavailable' | 'error';

/**
 * Connect-provider card (SPEC §7 dashboard). Detects an injected EIP-1193 wallet
 * and lets the operator connect it read-only (account + chainId). Signing stays
 * client-side and non-custodial — no key ever leaves the browser (AGENT.md §0).
 */
export function ConnectProvider() {
  const [state, setState] = useState<ConnState>('idle');
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  useEffect(() => {
    if (!getInjectedProvider()) setState('unavailable');
  }, []);

  const connect = async () => {
    const provider = getInjectedProvider();
    if (!provider) {
      setState('unavailable');
      return;
    }
    setState('connecting');
    try {
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
      const hexChain = (await provider.request({ method: 'eth_chainId' })) as string;
      setAddress(accounts[0] ?? null);
      setChainId(Number.parseInt(hexChain, 16));
      setState(accounts[0] ? 'connected' : 'error');
    } catch {
      setState('error');
    }
  };

  return (
    <Card className="col-span-12 lg:col-span-4">
      <div className="flex items-center justify-between">
        <h2 className="headline-md text-on-surface">Connect Provider</h2>
        <StatusDot
          tone={state === 'connected' ? 'online' : state === 'error' ? 'error' : 'idle'}
          pulse={state === 'connecting'}
          label={`Provider ${state}`}
        />
      </div>

      {state === 'connected' && address ? (
        <div className="mt-md space-y-xs">
          <p className="label-caps text-on-surface-variant">Connected account</p>
          <MonoAddress value={address} emphasis />
          <p className="code-xs text-on-surface-variant">Chain ID: {chainId ?? '—'}</p>
        </div>
      ) : (
        <div className="mt-md space-y-md">
          <p className="body-md text-on-surface-variant">
            {state === 'unavailable'
              ? 'No injected wallet detected. Install a browser wallet to connect a signer.'
              : 'Connect an injected browser wallet to sign transactions locally. Keys never leave your browser.'}
          </p>
          <Button
            variant="primary"
            icon="wallet"
            onClick={() => void connect()}
            disabled={state === 'unavailable' || state === 'connecting'}
          >
            {state === 'connecting' ? 'Connecting…' : 'Connect Wallet'}
          </Button>
          {state === 'error' ? (
            <p className="code-xs text-error">Connection was rejected or failed. Try again.</p>
          ) : null}
        </div>
      )}
    </Card>
  );
}
