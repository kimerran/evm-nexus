import { cn } from '@/lib/utils';

/** Log tag → colour (BRAND §7.8). */
export type LogTag = 'SYSTEM' | 'AUTH' | 'FAUCET' | 'SUCCESS' | 'ERROR';

export interface LogLine {
  /** `HH:MM:SS` timestamp. */
  time: string;
  tag: LogTag;
  message: string;
}

const tagStyles: Record<LogTag, string> = {
  SYSTEM: 'text-tertiary', // amber
  AUTH: 'text-primary',
  FAUCET: 'text-primary',
  SUCCESS: 'text-led-online', // green success line
  ERROR: 'text-error',
};

export interface TerminalProps {
  lines: LogLine[];
  className?: string;
  /** Accessible label for the log region. */
  label?: string;
}

/**
 * Terminal / log stream (BRAND §7.8): deep well, mono code-xs, dimmed timestamp,
 * coloured tag, message. Scrolls with the custom scrollbar.
 */
export function Terminal({ lines, className, label = 'Event log' }: TerminalProps) {
  return (
    <div
      role="log"
      aria-label={label}
      className={cn(
        'custom-scrollbar overflow-y-auto rounded-xl border border-outline-variant',
        'bg-surface-container-lowest p-md code-xs',
        className,
      )}
    >
      <div className="space-y-1">
        {lines.map((line, index) => (
          <div key={index} className="flex gap-2 whitespace-pre-wrap break-all">
            <span className="text-on-surface-variant opacity-50">[{line.time}]</span>
            <span className={cn('font-bold', tagStyles[line.tag])}>{line.tag}:</span>
            <span className="text-on-surface">{line.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
