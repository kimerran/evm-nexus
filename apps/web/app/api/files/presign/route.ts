// POST /api/files/presign — issue a signed, time-limited upload URL (SPEC §8.10).
//
// Auth + CSRF + rate-limit enforced. Validates the DECLARED content-type against
// the allow-list and the size against the hard cap BEFORE issuing an upload URL.
// The object key encodes the declared type as its extension, so the serve path
// (`GET /api/files/:key`) can require the file's MAGIC BYTES to match — a bad
// MIME is rejected here, a lie about the bytes is caught there. The key is scoped
// to the caller (`uploads/<userId>/…`), so no user can target another's space.
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { jsonOk, toErrorResponse, getClientIp } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { ValidationError, RateLimitError } from '@/lib/errors';
import { RATE_LIMITS, consumeRateLimit, rateLimitKey } from '@/lib/rate-limit';
import { filePresignSchema } from '@/lib/chat/schema';
import { validateDeclaredUpload } from '@/lib/storage/validate';
import { extForMime } from '@/lib/storage/mime';
import { getStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

const UPLOAD_URL_TTL_SEC = 300;

export async function POST(req: NextRequest) {
  try {
    const principal = await requireAuth(req);
    requireCsrfUnlessApiKey(req);

    const ip = getClientIp(req);
    const results = await Promise.all([
      consumeRateLimit(rateLimitKey('chat', 'user', principal.user.id), RATE_LIMITS.chat),
      consumeRateLimit(rateLimitKey('chat', 'ip', ip), RATE_LIMITS.chat),
    ]);
    const blocked = results.find((r) => !r.allowed);
    if (blocked) throw new RateLimitError(blocked.retryAfterSec, 'Too many upload requests.');

    const body: unknown = await req.json().catch(() => null);
    const parsed = filePresignSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
    }
    const { contentType, size } = parsed.data;

    const validation = validateDeclaredUpload(contentType, size);
    if (!validation.ok) throw new ValidationError(validation.message);

    const ext = extForMime(validation.mime);
    const key = `uploads/${principal.user.id}/${randomUUID()}.${ext}`;

    const storage = getStorage();
    const target = await storage.createUploadUrl(key, {
      contentType: validation.mime,
      expiresSec: UPLOAD_URL_TTL_SEC,
    });

    return jsonOk({
      key,
      contentType: validation.mime,
      upload: target,
      // The stable app path to fetch the file back (redirects to a signed URL).
      downloadPath: `/api/files/${key}`,
      expiresInSec: UPLOAD_URL_TTL_SEC,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
