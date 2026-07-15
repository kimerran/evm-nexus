import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from './icon';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Uppercase field label rendered above (BRAND §7.3 label-caps). */
  label?: string;
  /** Italic helper text below the field. */
  helper?: string;
  /** Leading Material Symbol glyph (e.g. `search`, `wallet`). */
  leadingIcon?: string;
  /** Trailing node (e.g. a copy button) positioned inside the field. */
  trailing?: ReactNode;
  /** Use JetBrains Mono for address/hash/numeric entry (BRAND §7.3). */
  mono?: boolean;
}

/**
 * Text input primitive (BRAND §7.3): surface-container-low fill, outline-variant
 * border, cyan focus ring, optional leading icon + trailing action + label +
 * helper text. Renders as a `<label>` wrapper so it stays a Server Component
 * (no id/hook needed) while keeping label→field association.
 */
export function Input({
  label,
  helper,
  leadingIcon,
  trailing,
  mono = false,
  className,
  ...props
}: InputProps) {
  return (
    <label className="flex flex-col gap-1.5">
      {label ? <span className="label-caps text-on-surface-variant">{label}</span> : null}
      <span className="relative flex items-center">
        {leadingIcon ? (
          <Icon
            name={leadingIcon}
            className="pointer-events-none absolute left-3 text-outline text-[1.125rem]"
          />
        ) : null}
        <input
          className={cn(
            'w-full rounded-xl border border-outline-variant bg-surface-container-low px-md py-3 text-on-surface',
            'outline-none transition-all placeholder:text-outline',
            'focus:border-primary focus:ring-1 focus:ring-primary',
            mono ? 'code-sm' : 'body-md',
            leadingIcon && 'pl-10',
            trailing ? 'pr-11' : undefined,
            className,
          )}
          {...props}
        />
        {trailing ? <span className="absolute right-2 flex items-center">{trailing}</span> : null}
      </span>
      {helper ? <span className="code-xs italic text-on-surface-variant">{helper}</span> : null}
    </label>
  );
}
