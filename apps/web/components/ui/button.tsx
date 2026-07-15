import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from './icon';

/** BRAND §7.2 button variants. */
export type ButtonVariant =
  | 'primary' // Primary CTA — bg-primary-container
  | 'primary-alt' // Alt primary — bg-primary
  | 'secondary' // Outline
  | 'ghost' // Text / low-emphasis
  | 'destructive'; // Destructive hover

export type ButtonSize = 'sm' | 'md';

const base =
  'inline-flex items-center justify-center gap-xs rounded-lg font-bold transition-all active:scale-95 ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-50 ' +
  'disabled:pointer-events-none whitespace-nowrap';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-primary-container text-on-primary-container hover:brightness-110',
  'primary-alt': 'bg-primary text-on-primary hover:brightness-110',
  secondary:
    'border border-outline-variant text-on-surface hover:bg-surface-container-high',
  ghost:
    'text-on-surface-variant hover:text-primary hover:bg-surface-container-high',
  destructive:
    'border border-outline-variant text-on-surface hover:bg-error-container hover:text-on-error-container',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'code-sm px-sm py-1.5',
  md: 'code-sm px-md py-2.5',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading Material Symbol glyph name. */
  icon?: string;
  /** Render the icon with FILL 1 (BRAND §4 active state). */
  iconFilled?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconFilled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    >
      {icon ? <Icon name={icon} filled={iconFilled} className="text-[1.125rem]" /> : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Material Symbol glyph name. */
  icon: string;
  iconFilled?: boolean;
  /** REQUIRED — icon-only buttons must be labelled (BRAND §9 accessibility). */
  'aria-label': string;
  variant?: Extract<ButtonVariant, 'ghost' | 'secondary' | 'destructive'>;
}

/**
 * Icon-only button. The `aria-label` prop is required by the type system so an
 * unlabeled icon button cannot be built (BRAND §9).
 */
export function IconButton({
  icon,
  iconFilled,
  variant = 'ghost',
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  const chrome =
    variant === 'ghost'
      ? 'text-on-surface-variant hover:text-primary hover:bg-surface-container-high'
      : variant === 'destructive'
        ? 'text-on-surface-variant hover:bg-error-container hover:text-on-error-container'
        : 'border border-outline-variant text-on-surface hover:bg-surface-container-high';
  return (
    <button
      type={type}
      title={props['aria-label']}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg transition-all active:scale-95',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary',
        chrome,
        className,
      )}
      {...props}
    >
      <Icon name={icon} filled={iconFilled} />
    </button>
  );
}
