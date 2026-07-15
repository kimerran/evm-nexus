import { cn } from '@/lib/utils';
import { truncateAddress, type TruncateOptions } from '@/lib/format';
import { CopyButton } from './copy-button';

export interface MonoAddressProps {
  /** Full address / hash / tx id (rendered mono, BRAND §3.2). */
  value: string;
  /** Truncate to `0x71C…3A2` form; pass `false` to show the full value. */
  truncate?: boolean | TruncateOptions;
  /** Show the hover-reveal copy affordance (BRAND §3.2). */
  copy?: boolean;
  /** Emphasize as a link-coloured address (BRAND §7.5). */
  emphasis?: boolean;
  className?: string;
}

/**
 * Monospace address/hash with truncation + copy affordance (BRAND §3.2). Always
 * exposes the full value via `title` for accessibility while displaying the
 * truncated form. Copy icon reveals on `group-hover` inside table rows.
 */
export function MonoAddress({
  value,
  truncate = true,
  copy = true,
  emphasis = false,
  className,
}: MonoAddressProps) {
  const display =
    truncate === false
      ? value
      : truncateAddress(value, truncate === true ? undefined : truncate);

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        title={value}
        className={cn('code-sm', emphasis ? 'text-primary' : 'text-on-surface')}
      >
        {display}
      </span>
      {copy ? (
        <CopyButton value={value} className="opacity-0 transition-opacity group-hover:opacity-100" />
      ) : null}
    </span>
  );
}
