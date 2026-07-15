// Structured logging with secret redaction (SPEC §13, AGENT.md §5).
//
// SERVER-ONLY. A single pino instance for the app, plus a pino-http logger for
// any Node-adapter request logging. Both REDACT the sensitive fields the spec
// enumerates — `password`, `authorization`, `cookie`, `privateKey`, `mnemonic`,
// `keystore`, `rawSignedTx` — at every level, so a stray `logger.info({ req })`
// or `logger.error({ err, body })` can never leak a credential or a raw signed
// transaction. Log tx HASHES, never the raw signed tx.
import pino from 'pino';
import type { LoggerOptions } from 'pino';
import { pinoHttp } from 'pino-http';

/** Field names that must never appear in logs (SPEC §13). */
export const REDACT_KEYS = [
  'password',
  'authorization',
  'cookie',
  'privateKey',
  'mnemonic',
  'keystore',
  'rawSignedTx',
] as const;

// Redact the bare key and one level of nesting (`*.key`), plus the common HTTP
// request/response header locations pino-http populates.
const redactPaths: string[] = [
  ...REDACT_KEYS,
  ...REDACT_KEYS.map((k) => `*.${k}`),
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

/** Shared redaction config (censor with a placeholder, don't remove the key). */
export const redactOptions: LoggerOptions['redact'] = {
  paths: redactPaths,
  censor: '[REDACTED]',
};

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: redactOptions,
};

/**
 * Build a logger, optionally writing to a custom destination (used by tests to
 * capture and assert on serialized output). Redaction is always applied.
 */
export function createLogger(destination?: pino.DestinationStream): pino.Logger {
  return destination ? pino(baseOptions, destination) : pino(baseOptions);
}

/** The app-wide logger. */
export const logger: pino.Logger = createLogger();

/** pino-http request logger (shares the same redaction) for Node-adapter use. */
export const httpLogger = pinoHttp({ logger, redact: redactOptions });
