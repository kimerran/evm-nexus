import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

export interface IconProps {
  /** Material Symbols Outlined glyph name, e.g. `content_copy`, `water_drop`. */
  name: string;
  /** Use the FILL 1 variation for active/emphasis states (BRAND §4). */
  filled?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Material Symbols Outlined glyph (BRAND §4). Decorative by default
 * (`aria-hidden`) — the accessible label belongs on the surrounding control
 * (see Button's `aria-label` for icon-only buttons).
 */
export function Icon({ name, filled = false, className, style }: IconProps) {
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn('material-symbols-outlined', filled && 'is-filled', className)}
    >
      {name}
    </span>
  );
}
