// S3 / MinIO storage driver (SPEC §8.10, AGENT.md §5).
//
// SERVER-ONLY. Reaches the object store purely through presigned SigV4 URLs +
// `fetch` (no aws-sdk). Upload/download URLs are handed to the client directly so
// bytes never proxy through the app for the happy path; the app still reads bytes
// server-side (via its own presigned GET) to run magic-byte validation before a
// file is ever served.
import { presignS3Url, type S3PresignConfig } from './sigv4';
import type { StorageService, UploadTarget } from './types';

export class S3Storage implements StorageService {
  readonly driver = 's3' as const;

  constructor(private readonly config: S3PresignConfig) {}

  async createUploadUrl(
    key: string,
    opts: { contentType: string; expiresSec: number },
  ): Promise<UploadTarget> {
    const url = presignS3Url(this.config, 'PUT', key, opts.expiresSec);
    // Content-Type is not a signed header (host-only), so the client may set it
    // freely; we authoritatively re-derive the true type from magic bytes later.
    return { url, method: 'PUT', headers: { 'Content-Type': opts.contentType } };
  }

  async createDownloadUrl(key: string, opts: { expiresSec: number }): Promise<string> {
    return presignS3Url(this.config, 'GET', key, opts.expiresSec);
  }

  async getObject(key: string): Promise<Uint8Array | null> {
    const url = presignS3Url(this.config, 'GET', key, 60);
    const res = await fetch(url);
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw new Error(`S3 getObject failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const url = presignS3Url(this.config, 'PUT', key, 60);
    const res = await fetch(url, {
      method: 'PUT',
      body: new Blob([bytes as BlobPart]),
      headers: { 'Content-Type': contentType },
    });
    if (!res.ok) throw new Error(`S3 putObject failed (${res.status})`);
  }

  async deleteObject(key: string): Promise<void> {
    const url = presignS3Url(this.config, 'DELETE', key, 60);
    await fetch(url, { method: 'DELETE' }).catch(() => undefined);
  }

  /**
   * Best-effort bucket creation (idempotent). MinIO deployments provision the
   * bucket out-of-band in prod; this is a convenience for local/dev bootstrap.
   */
  async ensureBucket(): Promise<void> {
    const url = presignS3Url(this.config, 'PUT', '', 60);
    const res = await fetch(url, { method: 'PUT' });
    // 200 = created; 409 = already owned by us — both are success.
    if (!res.ok && res.status !== 409) {
      const text = await res.text().catch(() => '');
      if (!text.includes('BucketAlreadyOwnedByYou') && !text.includes('BucketAlreadyExists')) {
        throw new Error(`ensureBucket failed (${res.status})`);
      }
    }
  }
}
