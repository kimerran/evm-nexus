// MIME <-> extension mapping for the attachment allow-list (AGENT.md §5).
//
// PURE. The object key deterministically encodes the DECLARED type as its
// extension, so the serve path can re-derive the declared type and require the
// file's magic bytes to match it — closing the "lie about Content-Type" gap
// without a separate metadata store.
import type { AllowedMime } from './validate';

const MIME_TO_EXT: Record<AllowedMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
};

const EXT_TO_MIME: Record<string, AllowedMime> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
};

/** Extension (no dot) for an allowed MIME. */
export function extForMime(mime: AllowedMime): string {
  return MIME_TO_EXT[mime];
}

/** Re-derive the declared MIME from a storage key's extension. `null` if unknown. */
export function mimeFromKey(key: string): AllowedMime | null {
  const dot = key.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = key.slice(dot + 1).toLowerCase();
  return EXT_TO_MIME[ext] ?? null;
}
