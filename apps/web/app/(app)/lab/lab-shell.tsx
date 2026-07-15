'use client';

// Transaction Lab shell (SPEC §7). A tabbed workspace driven entirely by the
// LAB_PANELS registry (panels.tsx) beside a shared live tx feed. The shell knows
// nothing transfer-specific: it renders whatever panels are registered and shows
// a placeholder for `coming-soon` ones (#14 Bombard, #15 Chat) — those slot in by
// editing the registry alone. This is the extension contract the issue asks for.
import { useState } from 'react';
import { Card, Icon } from '@/components/ui';
import { LAB_PANELS, type LabPanelContext, type LabPanelDef } from './panels';
import { LiveFeed } from './live-feed';

/** Placeholder for a registered-but-not-yet-built panel (extension slot). */
function ComingSoon({ def }: { def: LabPanelDef }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-outline-variant p-12 text-center">
      <Icon name={def.icon} className="text-[2rem] text-on-surface-variant" />
      <div className="space-y-1">
        <p className="headline-md text-on-surface">{def.label}</p>
        <p className="body-md text-on-surface-variant">{def.description}</p>
      </div>
      <span className="label-caps text-on-surface-variant">
        Coming soon{def.issue ? ` · #${def.issue}` : ''}
      </span>
    </div>
  );
}

export type LabShellProps = LabPanelContext;

export function LabShell(props: LabShellProps) {
  const [activeId, setActiveId] = useState<string>(LAB_PANELS[0]?.id ?? 'transfer');
  const active = LAB_PANELS.find((p) => p.id === activeId) ?? LAB_PANELS[0];

  return (
    <div className="grid grid-cols-12 gap-gutter">
      <div className="col-span-12 xl:col-span-8 space-y-lg">
        <Card className="space-y-lg">
          {/* Tab bar — one entry per registered panel. */}
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Lab tools">
            {LAB_PANELS.map((p) => (
              <button
                key={p.id}
                role="tab"
                aria-selected={active?.id === p.id}
                onClick={() => setActiveId(p.id)}
                className={
                  active?.id === p.id
                    ? 'flex items-center gap-1.5 rounded-md bg-primary-container px-3 py-1.5 label-caps text-on-primary-container'
                    : 'flex items-center gap-1.5 rounded-md bg-surface-container-highest px-3 py-1.5 label-caps text-on-surface-variant'
                }
              >
                <Icon name={p.icon} className="text-[1rem]" />
                {p.label}
                {p.status === 'coming-soon' ? (
                  <span className="ml-1 rounded-sm bg-surface-container px-1 code-xs">soon</span>
                ) : null}
              </button>
            ))}
          </div>

          {/* Active panel — a component for `available`, a placeholder otherwise. */}
          {active && active.status === 'available' && active.Component ? (
            <active.Component {...props} />
          ) : active ? (
            <ComingSoon def={active} />
          ) : null}
        </Card>
      </div>

      <div className="col-span-12 xl:col-span-4">
        <Card className="space-y-md">
          <LiveFeed />
        </Card>
      </div>
    </div>
  );
}
