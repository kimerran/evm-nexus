import { describe, it, expect } from 'vitest';
import {
  sniffMime,
  validateDeclaredUpload,
  validateUploadedBytes,
  MAX_UPLOAD_BYTES,
} from './validate';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function png(): Uint8Array {
  return new Uint8Array([...PNG_SIG, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
}
function jpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
}
function pdf(): Uint8Array {
  return new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
}
function text(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('sniffMime', () => {
  it('detects png/jpeg/pdf by magic number', () => {
    expect(sniffMime(png())).toBe('image/png');
    expect(sniffMime(jpeg())).toBe('image/jpeg');
    expect(sniffMime(pdf())).toBe('application/pdf');
  });

  it('detects utf-8 plain text as text/plain', () => {
    expect(sniffMime(text('hello world'))).toBe('text/plain');
  });

  it('returns null for binary that matches no signature', () => {
    expect(sniffMime(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });
});

describe('validateDeclaredUpload', () => {
  it('accepts an allowed MIME within size', () => {
    expect(validateDeclaredUpload('image/png', 1024)).toEqual({ ok: true, mime: 'image/png' });
  });

  it('rejects a disallowed MIME (bad MIME)', () => {
    const r = validateDeclaredUpload('application/x-msdownload', 1024);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('mime-not-allowed');
  });

  it('rejects an oversize upload', () => {
    const r = validateDeclaredUpload('image/png', MAX_UPLOAD_BYTES + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('too-large');
  });
});

describe('validateUploadedBytes (magic-byte check, not just extension)', () => {
  it('accepts bytes whose magic matches the declared type', () => {
    expect(validateUploadedBytes(png(), 'image/png')).toEqual({ ok: true, mime: 'image/png' });
  });

  it('REJECTS bytes that lie about their type (declared png, actually text)', () => {
    const r = validateUploadedBytes(text('not a real png'), 'image/png');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('magic-mismatch');
  });

  it('rejects a png declared as pdf', () => {
    const r = validateUploadedBytes(png(), 'application/pdf');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('magic-mismatch');
  });

  it('rejects oversize before sniffing', () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    const r = validateUploadedBytes(big, 'image/png');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('too-large');
  });
});
