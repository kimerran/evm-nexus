import { cn } from '@/lib/utils';

/** BRAND §2.7 / §7.10 status colours for the LED dot. */
export type StatusTone = 'live' | 'online' | 'pending' | 'error' | 'idle';

const tones: Record<StatusTone, string> = {
  live: 'bg-primary-container', // cyan — active/live
  online: 'bg-led-online', // literal green online LED (BRAND §2.7)
  pending: 'bg-tertiary-container',
  error: 'bg-error',
  idle: 'bg-outline',
};

export interface StatusDotProps {
  tone?: StatusTone;
  /** Pulse the dot (BRAND §8). Disabled automatically under prefers-reduced-motion. */
  pulse?: boolean;
  className?: string;
  /** Accessible status text; when omitted the dot is decorative (aria-hidden). */
  label?: string;
}

/**
 * Small status LED (BRAND §7.10). A genuine circle via `rounded-full`; optional
 * `status-pulse` keyframe that respects prefers-reduced-motion (see globals.css).
 */
export function StatusDot({ tone = 'live', pulse = false, className, label }: StatusDotProps) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        tones[tone],
        pulse && 'status-pulse',
        className,
      )}
    />
  );
}
