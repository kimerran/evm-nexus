import { StatusDot, Badge } from '@/components/ui';

export interface NetworkStatusProps {
  /** Active network name (from the selected `Network`). */
  network?: string;
  /** Round-trip latency label, e.g. "12ms". */
  latency?: string;
}

/**
 * Sidebar network status block (BRAND §7.10): pulsing live dot + network name +
 * latency read-out. Data is stubbed until the network resolver lands.
 */
export function NetworkStatus({ network = 'Mainnet-Alpha', latency = '12ms' }: NetworkStatusProps) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-low p-sm">
      <div className="flex items-center gap-xs">
        <StatusDot tone="live" pulse label={`${network} online`} />
        <span className="headline-md text-base text-primary">{network}</span>
        <Badge tone="success" className="ml-auto">
          Live
        </Badge>
      </div>
      <p className="label-caps mt-1.5 text-on-surface-variant">Latency: {latency}</p>
    </div>
  );
}
