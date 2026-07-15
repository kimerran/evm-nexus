import type { Metadata } from 'next';
import {
  Card,
  Badge,
  StatusDot,
  MonoAddress,
  Terminal,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  type LogLine,
} from '@/components/ui';
import { ControlsDemo } from './controls-demo';

export const metadata: Metadata = {
  title: 'Dashboard — EVM Nexus',
};

const stats = [
  { label: 'Gas Price', value: '18.4', unit: 'gwei', tone: 'success' as const },
  { label: 'Block Time', value: '2.01', unit: 's', tone: 'success' as const },
  { label: 'TPS Rate', value: '1,420', unit: 'tx/s', tone: 'success' as const },
  { label: 'Peer Count', value: '312', unit: 'nodes', tone: 'success' as const },
  { label: 'Uptime', value: '99.8', unit: '%', tone: 'success' as const },
  { label: 'Congestion', value: 'Moderate', unit: '', tone: 'pending' as const },
];

const log: LogLine[] = [
  { time: '12:04:01', tag: 'SYSTEM', message: 'Node synced to head — block #1,204,882' },
  { time: '12:04:03', tag: 'AUTH', message: 'Operator session established' },
  { time: '12:04:07', tag: 'FAUCET', message: 'Drip queued → 0x71C7…976F (5 ETH)' },
  { time: '12:04:09', tag: 'SUCCESS', message: 'Tx 0xabc1…def9 confirmed in 2 blocks' },
];

const deployments = [
  { name: 'NexusToken', address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F', status: 'success' as const },
  { name: 'TestNFT', address: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0', status: 'pending' as const },
];

export default function DashboardPage() {
  return (
    <div className="space-y-xl">
      <header className="space-y-1">
        <h1 className="display-lg text-on-surface">Dashboard</h1>
        <p className="body-md text-on-surface-variant">
          Live network telemetry for the active test chain. Data is the hero.
        </p>
      </header>

      {/* Bento grid — 12 cols, gutter gap (BRAND §6.3). */}
      <div className="grid grid-cols-12 gap-gutter">
        {stats.map((stat) => (
          <Card key={stat.label} hover className="col-span-6 md:col-span-4">
            <div className="flex items-center justify-between">
              <span className="label-caps text-on-surface-variant">{stat.label}</span>
              <StatusDot tone={stat.tone === 'pending' ? 'pending' : 'live'} pulse />
            </div>
            <p className="mt-2 code-sm text-2xl font-bold text-primary">
              {stat.value}
              {stat.unit ? <span className="ml-1 text-sm text-on-surface-variant">{stat.unit}</span> : null}
            </p>
          </Card>
        ))}

        {/* Recent deployments table — spans full width. */}
        <Card className="col-span-12 lg:col-span-8">
          <div className="mb-md flex items-center justify-between">
            <h2 className="headline-md text-on-surface">Recent Deployments</h2>
            <Badge tone="count">2 Total</Badge>
          </div>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Contract</TableHeaderCell>
                <TableHeaderCell>Address</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {deployments.map((row) => (
                <TableRow key={row.address}>
                  <TableCell className="body-md text-on-surface">{row.name}</TableCell>
                  <TableCell>
                    <MonoAddress value={row.address} emphasis />
                  </TableCell>
                  <TableCell>
                    <Badge tone={row.status}>{row.status === 'success' ? 'Confirmed' : 'Pending'}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        {/* Controls (interactive primitives). */}
        <Card className="col-span-12 lg:col-span-4">
          <h2 className="headline-md mb-md text-on-surface">Bombard Controls</h2>
          <ControlsDemo />
        </Card>

        {/* Event log terminal — spans full width. */}
        <Card className="col-span-12">
          <h2 className="headline-md mb-md text-on-surface">Event Log</h2>
          <Terminal lines={log} className="h-48" />
        </Card>
      </div>
    </div>
  );
}
