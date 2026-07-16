import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger, REDACT_KEYS } from './log';

// Capture serialized log lines by pointing pino at an in-memory stream.
function capture(): { stream: Writable; lines: () => string } {
  let buf = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  return { stream, lines: () => buf };
}

describe('logger redaction', () => {
  it('redacts every sensitive field at the top level', () => {
    const { stream, lines } = capture();
    const log = createLogger(stream);
    log.info(
      {
        password: 'hunter2',
        authorization: 'Bearer nxs_secretkey',
        cookie: 'nexus_session=abc',
        privateKey: '0xdeadbeef',
        mnemonic: 'test test test junk',
        keystore: '{"crypto":"..."}',
        rawSignedTx: '0x02f8...signed',
      },
      'sensitive',
    );

    const out = lines();
    // Not a single secret value survives.
    for (const secret of [
      'hunter2',
      'nxs_secretkey',
      'nexus_session=abc',
      '0xdeadbeef',
      'test test test junk',
      '0x02f8',
    ]) {
      expect(out).not.toContain(secret);
    }
    // Keys remain, censored.
    expect(out).toContain('[REDACTED]');
    for (const key of REDACT_KEYS) expect(out).toContain(key);
  });

  it('redacts one level of nesting (e.g. a request body object)', () => {
    const { stream, lines } = capture();
    const log = createLogger(stream);
    log.info({ body: { privateKey: '0xLEAK', rawSignedTx: '0xRAWLEAK' } }, 'nested');
    const out = lines();
    expect(out).not.toContain('0xLEAK');
    expect(out).not.toContain('0xRAWLEAK');
    expect(out).toContain('[REDACTED]');
  });
});
