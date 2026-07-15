// Map a faucet policy rejection to the HTTP error envelope (SPEC §8/§8.4).
//
// SERVER-ONLY. Keeps the code→status mapping in one place so the API boundary
// and any future caller answer identically. Kill-switch and ceiling are client
// errors (nothing to retry now); cooldown and daily-cap are 429s that carry a
// retry hint.
import { AppError, RateLimitError, ValidationError } from '@/lib/errors';
import type { FaucetRejectCode } from './policy';

/** 403 for an intentionally-disabled faucet (kill-switch). */
class FaucetDisabledError extends AppError {
  constructor(message: string) {
    super(403, 'FAUCET_DISABLED', message);
  }
}

/** Translate a {@link FaucetRejectCode} into the right thrown AppError. */
export function faucetRejectToError(
  code: FaucetRejectCode,
  message: string,
  retryAfterSec = 60,
): AppError {
  switch (code) {
    case 'KILL_SWITCH':
      return new FaucetDisabledError(message);
    case 'INVALID_AMOUNT':
    case 'CEILING':
      return new ValidationError(message);
    case 'COOLDOWN':
    case 'DAILY_CAP':
      return new RateLimitError(retryAfterSec, message);
  }
}
