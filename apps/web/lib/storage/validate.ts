// Upload validation — MIME allow-list + MAGIC-BYTE sniffing + size (AGENT.md §5).
//
// PURE + dependency-free so it is trivially unit-tested with in-memory buffers and
// safe to run in any context. The security invariant (AGENT.md §5): NEVER trust a
// client-declared MIME or a filename extension. A file is accepted only when its
// leading bytes actually match the declared content-type's known signature, and
// only for a curated allow-list — so a `.png`-named executable, or a payload that
// lies about its `Content-Type`, is rejected before it is ever served.

/** The MIME types the chat attachment surface accepts. */
export const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
] as const;

export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

/** Hard upper bound on an attachment (bytes). 8 MiB — ample for a test tool. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** True when `mime` is in the accepted allow-list. */
export function isAllowedMime(mime: string): mime is AllowedMime {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

/** Detect whether `bytes` is valid UTF-8 text with no NUL/control bytes (for text/plain). */
function looksLikePlainText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  for (const b of sample) {
    // Reject NUL and C0 control chars except TAB(9), LF(10), CR(13).
    if (b === 0) return false;
    if (b < 0x09 || (b > 0x0d && b < 0x20)) return false;
  }
  try {
    // Strict UTF-8 decode — throws on invalid sequences.
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sniff the true content-type of `bytes` from its magic number. Returns the
 * detected allowed MIME, or `null` when nothing recognized matches. `text/plain`
 * is the fallback ONLY when the bytes are valid, control-free UTF-8.
 */
export function sniffMime(bytes: Uint8Array): AllowedMime | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'; // GIF8
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (looksLikePlainText(bytes)) return 'text/plain';
  return null;
}

export type UploadValidationError =
  | 'mime-not-allowed'
  | 'too-large'
  | 'empty'
  | 'magic-mismatch';

export type UploadValidationResult =
  | { ok: true; mime: AllowedMime }
  | { ok: false; error: UploadValidationError; message: string };

/** Validate a DECLARED upload before issuing an upload URL (size + MIME only). */
export function validateDeclaredUpload(
  declaredMime: string,
  size: number,
): UploadValidationResult {
  if (!Number.isInteger(size) || size <= 0) {
    return { ok: false, error: 'empty', message: 'File size must be a positive integer.' };
  }
  if (size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: 'too-large',
      message: `File exceeds the ${MAX_UPLOAD_BYTES}-byte limit.`,
    };
  }
  if (!isAllowedMime(declaredMime)) {
    return {
      ok: false,
      error: 'mime-not-allowed',
      message: `Content-type "${declaredMime}" is not an accepted attachment type.`,
    };
  }
  return { ok: true, mime: declaredMime };
}

/**
 * Validate STORED bytes against the declared MIME. Enforces size, allow-list, and
 * the magic-byte match — the authoritative check run before a file is ever served.
 */
export function validateUploadedBytes(
  bytes: Uint8Array,
  declaredMime: string,
): UploadValidationResult {
  const declared = validateDeclaredUpload(declaredMime, bytes.length);
  if (!declared.ok) return declared;

  const detected = sniffMime(bytes);
  if (detected === null || detected !== declared.mime) {
    return {
      ok: false,
      error: 'magic-mismatch',
      message: `File contents do not match the declared type "${declaredMime}" (detected: ${detected ?? 'unknown'}).`,
    };
  }
  return { ok: true, mime: declared.mime };
}
