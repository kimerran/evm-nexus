import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Enable the BRAND §6.3 hover affordance (border → primary/50). */
  hover?: boolean;
  children?: ReactNode;
}

/**
 * Card / panel primitive (BRAND §7.1): surface-container fill, xl radius,
 * hairline outline-variant border, optional cyan hover border.
 */
export function Card({ hover = false, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-outline-variant bg-surface-container p-lg',
        hover && 'transition-colors hover:border-primary/50',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Glass panel variant (BRAND §7.1) — translucent fill + backdrop blur for
 * overlays, launchpad forms, and right-rail tips.
 */
export function GlassPanel({ className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-outline-variant p-lg backdrop-blur-md',
        'bg-surface-container/40',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
