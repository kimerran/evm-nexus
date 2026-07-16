// Minimal AWS SigV4 query-string presigner for S3 / MinIO (AGENT.md §5).
//
// SERVER-ONLY. Generates time-limited presigned URLs (PUT / GET / DELETE) without
// pulling in the full aws-sdk — the object store is reached with plain `fetch`
// against the signed URL. Only `host` is signed (payload is UNSIGNED-PAYLOAD), so
// the presigned URL is a self-contained, expiring capability. Secrets (the S3
// secret key) are used only to derive the signing key here and never leave the
// process or appear in a URL.
import { createHash, createHmac } from 'node:crypto';

export interface S3PresignConfig {
  endpoint: string; // e.g. http://localhost:9000
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export type S3Method = 'GET' | 'PUT' | 'DELETE';

/** RFC 3986 strict encoding (AWS canonicalization). Optionally preserve '/'. */
function uriEncode(input: string, keepSlash: boolean): string {
  let out = '';
  for (const ch of Buffer.from(input, 'utf8')) {
    const c = String.fromCharCode(ch);
    if (
      (ch >= 0x41 && ch <= 0x5a) || // A-Z
      (ch >= 0x61 && ch <= 0x7a) || // a-z
      (ch >= 0x30 && ch <= 0x39) || // 0-9
      c === '-' ||
      c === '_' ||
      c === '.' ||
      c === '~'
    ) {
      out += c;
    } else if (c === '/' && keepSlash) {
      out += '/';
    } else {
      out += `%${ch.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(now: Date): { amz: string; date: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  // iso like 20240101T000000Z
  return { amz: iso, date: iso.slice(0, 8) };
}

/**
 * Build a presigned S3 URL. `key` is the object key WITHOUT the bucket. Returns a
 * fully-signed URL valid for `expiresSec` seconds.
 */
export function presignS3Url(
  config: S3PresignConfig,
  method: S3Method,
  key: string,
  expiresSec: number,
  now: Date = new Date(),
): string {
  const url = new URL(config.endpoint);
  const host = url.host;
  const service = 's3';
  const { amz, date } = amzDate(now);
  const scope = `${date}/${config.region}/${service}/aws4_request`;

  // Path-style: /<bucket>/<key> (or /<bucket> for a bucket-level op when key is
  // empty). Virtual-hosted style is not used with MinIO.
  const encodedKey = uriEncode(key, true);
  const encodedBucket = uriEncode(config.bucket, true);
  const canonicalUri = config.forcePathStyle
    ? key
      ? `/${encodedBucket}/${encodedKey}`
      : `/${encodedBucket}`
    : `/${encodedKey}`;

  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKeyId}/${scope}`,
    'X-Amz-Date': amz,
    'X-Amz-Expires': String(expiresSec),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k, false)}=${uriEncode(query[k] as string, false)}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amz,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${config.secretAccessKey}`, date);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const base = `${url.protocol}//${host}${canonicalUri}`;
  return `${base}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
