import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** BRAND §2.7 + §7.4 status → color mapping. */
export type BadgeTone =
  | 'success' // confirmed / live
  | 'pending' // confirming / moderate (tertiary/amber)
  | 'error' // failed / rejected
  | 'stress' // STRESS TEST MODE (error-container fill)
  | 'secure' // encrypted / secure (secondary)
  | 'count' // count badge ("3 Total")
  | 'neutral';

const tones: Record<BadgeTone, string> = {
  success: 'bg-primary/10 text-primary-fixed-dim',
  pending: 'bg-tertiary/10 text-tertiary',
  error: 'bg-error/10 text-error',
  stress: 'bg-error-container text-on-error-container',
  secure: 'bg-secondary-container/40 text-secondary',
  count: 'bg-secondary-container text-on-secondary-container',
  neutral: 'bg-surface-container-high text-on-surface-variant',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children?: ReactNode;
}

/**
 * Status chip / count badge (BRAND §7.4). Uppercase, tracked, tiny.
 */
export function Badge({ tone = 'neutral', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
        'font-mono',
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
