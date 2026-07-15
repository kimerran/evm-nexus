// GET /api/files/:key  — serve an attachment via a signed, time-limited URL.
// PUT /api/files/:key  — volume-driver upload target (token-authorized).
//
// SECURITY (AGENT.md §5, SPEC §8.10):
//   • Files live OUTSIDE the webroot; this route is the ONLY way to reach them.
//   • The guarded GET (no token) re-checks auth + ownership, then reads the bytes
//     and validates them by MAGIC NUMBER against the type declared at presign
//     (encoded in the key's extension). A mismatch → 415; the file is never served.
//   • It then 302-redirects to a fresh signed, time-limited download URL (S3
//     presigned, or a token-scoped volume URL) — never inlining or executing.
//   • The token-scoped GET/PUT paths (volume driver) verify an HMAC capability
//     token bound to the exact key + expiry + mode; bytes are served as an
//     attachment with `X-Content-Type-Options: nosniff`.
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { jsonError, toErrorResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/errors';
import { getStorage } from '@/lib/storage';
import { verifyStorageToken, type StorageTokenMode } from '@/lib/storage/token';
import { mimeFromKey } from '@/lib/storage/mime';
import { validateUploadedBytes, MAX_UPLOAD_BYTES } from '@/lib/storage/validate';

export const dynamic = 'force-dynamic';

const DOWNLOAD_URL_TTL_SEC = 300;

function keyFrom(parts: string[]): string {
  const key = parts.join('/');
  if (!key.startsWith('uploads/') || key.includes('..') || key.includes('\0')) {
    throw new ValidationError('Invalid file key.');
  }
  return key;
}

function tokenParams(req: NextRequest): { exp: number; sig: string; mode: StorageTokenMode } | null {
  const url = new URL(req.url);
  const sig = url.searchParams.get('sig');
  const expRaw = url.searchParams.get('exp');
  const mode = url.searchParams.get('mode');
  if (!sig || !expRaw || (mode !== 'get' && mode !== 'put')) return null;
  return { exp: Number(expRaw), sig, mode };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  try {
    const key = keyFrom((await ctx.params).key);

    // --- Token-scoped raw serve (volume driver's signed download URL) ---
    const tok = tokenParams(req);
    if (tok && tok.mode === 'get') {
      if (!verifyStorageToken(key, tok.exp, 'get', tok.sig)) {
        throw new ForbiddenError('Invalid or expired download token.');
      }
      const declaredMime = mimeFromKey(key);
      const bytes = await getStorage().getObject(key);
      if (!bytes || !declaredMime) throw new NotFoundError('File not found.');
      return new NextResponse(new Blob([bytes as BlobPart]), {
        status: 200,
        headers: {
          'Content-Type': declaredMime,
          'Content-Disposition': 'attachment',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, max-age=0, no-store',
        },
      });
    }

    // --- Guarded serve: auth + ownership + magic-byte validation, then redirect ---
    const principal = await requireAuth(req);
    if (!key.startsWith(`uploads/${principal.user.id}/`)) {
      // Never reveal another user's file — 404, not 403.
      throw new NotFoundError('File not found.');
    }
    const declaredMime = mimeFromKey(key);
    if (!declaredMime) throw new ValidationError('Unsupported file type.');

    const storage = getStorage();
    const bytes = await storage.getObject(key);
    if (!bytes) throw new NotFoundError('File not found.');

    const validation = validateUploadedBytes(bytes, declaredMime);
    if (!validation.ok) {
      // Magic-byte mismatch (or oversize): reject with 415 and never serve it.
      return jsonError(415, 'UNSUPPORTED_MEDIA', validation.message);
    }

    const url = await storage.createDownloadUrl(key, { expiresSec: DOWNLOAD_URL_TTL_SEC });
    return NextResponse.redirect(url, 302);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  try {
    const key = keyFrom((await ctx.params).key);
    const tok = tokenParams(req);
    if (!tok || tok.mode !== 'put' || !verifyStorageToken(key, tok.exp, 'put', tok.sig)) {
      throw new ForbiddenError('Invalid or expired upload token.');
    }
    const declaredMime = mimeFromKey(key);
    if (!declaredMime) throw new ValidationError('Unsupported file type.');

    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length === 0) throw new ValidationError('Empty upload.');
    if (buf.length > MAX_UPLOAD_BYTES) throw new ValidationError('File exceeds the size limit.');

    // SPEC §13: uploads must pass MIME + magic-byte + size validation. Sniff the
    // actual bytes at the WRITE boundary so mismatched/forged content is rejected
    // before it is ever persisted (defense-in-depth with the serve-time check).
    const bytes = new Uint8Array(buf);
    const validation = validateUploadedBytes(bytes, declaredMime);
    if (!validation.ok) {
      return jsonError(415, 'UNSUPPORTED_MEDIA', validation.message);
    }

    await getStorage().putObject(key, bytes, declaredMime);
    return NextResponse.json({ data: { key, size: buf.length } }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
