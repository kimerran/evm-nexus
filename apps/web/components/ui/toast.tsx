'use client';

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from './icon';
import { IconButton } from './button';

export type ToastTone = 'info' | 'success' | 'pending' | 'error';

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  /** Material Symbol glyph shown left of the message. */
  icon?: string;
  /** Auto-dismiss delay in ms (default 4000). */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

const toneStyles: Record<ToastTone, string> = {
  info: 'text-on-surface',
  success: 'text-primary-fixed-dim',
  pending: 'text-tertiary',
  error: 'text-error',
};

/** Presentational toast pill (BRAND §7.9). Bottom-right, mono, optional bounce. */
export function Toast({
  message,
  tone = 'info',
  icon,
  onDismiss,
}: {
  message: string;
  tone?: ToastTone;
  icon?: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-sm rounded-xl border border-outline-variant bg-surface-container-highest',
        'px-md py-3 shadow-xl',
      )}
    >
      {icon ? <Icon name={icon} className={cn('text-[1.125rem]', toneStyles[tone])} /> : null}
      <span className={cn('code-sm', toneStyles[tone])}>{message}</span>
      {onDismiss ? (
        <IconButton
          icon="close"
          aria-label="Dismiss notification"
          onClick={onDismiss}
          className="h-6 w-6"
        />
      ) : null}
    </div>
  );
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Toast host + imperative `useToast()` API. Mount `<ToastProvider>` near the app
 * shell root; call `toast({ message, tone })` from any client component.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = Date.now() + Math.random();
      setItems((current) => [...current, { id, ...options }]);
      setTimeout(() => dismiss(id), options.duration ?? 4000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-lg right-lg z-[100] flex flex-col gap-sm" aria-live="polite">
        {items.map((item) => (
          <Toast
            key={item.id}
            message={item.message}
            tone={item.tone}
            icon={item.icon}
            onDismiss={() => dismiss(item.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>');
  }
  return ctx;
}
