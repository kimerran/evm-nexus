'use client';

import { useState } from 'react';
import { Slider, Toggle, Button, useToast } from '@/components/ui';

/**
 * Interactive slice of the dashboard demo (client): TPS slider, sponsored-tx
 * toggle, and a toast trigger — exercising the interactive primitives.
 */
export function ControlsDemo() {
  const [tps, setTps] = useState(250);
  const { toast } = useToast();

  return (
    <div className="space-y-lg">
      <Slider
        label="Target TPS"
        readout={`${tps} TPS`}
        min={1}
        max={1000}
        value={tps}
        onChange={(event) => setTps(Number(event.target.value))}
      />
      <div className="flex items-center justify-between">
        <span className="label-caps text-on-surface-variant">Sponsored transaction</span>
        <Toggle aria-label="Toggle sponsored transaction" defaultChecked />
      </div>
      <Button
        variant="primary"
        icon="bolt"
        onClick={() => toast({ message: 'Indexing Block #1,204,882', tone: 'pending', icon: 'sync' })}
      >
        Broadcast test toast
      </Button>
    </div>
  );
}
