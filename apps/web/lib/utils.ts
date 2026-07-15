/** Class-name value that resolves to a string or is skipped. */
export type ClassValue = string | number | false | null | undefined;

/**
 * Tiny class merge helper — joins truthy class values with a single space.
 * Deliberately dependency-free (no clsx/tailwind-merge needed for our primitives,
 * which never emit conflicting utilities on the same element).
 */
export function cn(...classes: ClassValue[]): string {
  return classes.filter((value): value is string | number => Boolean(value)).join(' ');
}
