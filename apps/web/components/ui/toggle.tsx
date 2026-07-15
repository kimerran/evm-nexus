'use client';

import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface ToggleProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Accessible label — required (icon/switch controls must be labelled). */
  'aria-label': string;
}

/**
 * Toggle / switch (BRAND §7.6): track surface-container-highest (off) →
 * primary-container (on); white knob slides on `peer-checked`.
 */
export function Toggle({ className, ...props }: ToggleProps) {
  return (
    <label className={cn('relative inline-flex cursor-pointer items-center', className)}>
      <input type="checkbox" className="peer sr-only" {...props} />
      <span
        className={cn(
          'h-6 w-11 rounded-full bg-surface-container-highest transition-colors',
          'peer-checked:bg-primary-container peer-focus-visible:ring-1 peer-focus-visible:ring-primary',
          "after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-['']",
          'peer-checked:after:translate-x-full',
        )}
      />
    </label>
  );
}
