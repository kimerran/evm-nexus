'use client';

import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface SliderProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Uppercase label shown left of the read-out (BRAND §7.7). */
  label?: string;
  /** Live value read-out (e.g. "250 TPS"), rendered mono/primary/bold. */
  readout?: string;
  'aria-label'?: string;
}

/**
 * Range slider (BRAND §7.7): flat track + glowing cyan thumb (see `.nexus-slider`
 * in globals.css) with an optional live mono read-out beside the label.
 */
export function Slider({ label, readout, className, ...props }: SliderProps) {
  return (
    <div className="flex flex-col gap-xs">
      {(label || readout) && (
        <div className="flex items-center justify-between">
          {label ? <span className="label-caps text-on-surface-variant">{label}</span> : <span />}
          {readout ? <span className="code-sm font-bold text-primary">{readout}</span> : null}
        </div>
      )}
      <input
        type="range"
        aria-label={props['aria-label'] ?? label}
        className={cn('nexus-slider', className)}
        {...props}
      />
    </div>
  );
}
