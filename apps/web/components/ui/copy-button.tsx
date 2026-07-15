'use client';

import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from './icon';

export interface CopyButtonProps {
  /** Text written to the clipboard. */
  value: string;
  /** Accessible label (BRAND §9 — icon-only button). */
  label?: string;
  className?: string;
}

/**
 * Copy affordance (BRAND §3.2) — `content_copy` glyph that flips to `check` for
 * ~1.2s on success. Pairs with truncated mono hashes/addresses.
 */
export function CopyButton({ value, label = 'Copy to clipboard', className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard may be unavailable (insecure context / denied permission).
      setCopied(false);
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-lg transition-all active:scale-95',
        'text-on-surface-variant hover:text-primary hover:bg-surface-container-high',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary',
        className,
      )}
    >
      <Icon
        name={copied ? 'check' : 'content_copy'}
        className={cn('text-[1rem]', copied && 'text-primary-fixed-dim')}
      />
    </button>
  );
}
