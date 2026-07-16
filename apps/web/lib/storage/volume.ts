// Filesystem (volume) storage driver (SPEC §8.10, AGENT.md §5).
//
// SERVER-ONLY. Stores objects under STORAGE_VOLUME_PATH — a directory OUTSIDE the
// Next.js webroot, so files are never statically served or executed. Upload and
// download URLs point back at the app's own `/api/files/<key>` route carrying a
// signed, time-limited token (lib/storage/token). Path traversal is neutralized
// by rejecting any key containing `..` or a leading slash.
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { getEnv } from '@nexus/config/env';
import { mintStorageToken } from './token';
import type { StorageService, UploadTarget } from './types';

function assertSafeKey(key: string): void {
  if (key.includes('..') || key.startsWith('/') || key.includes('\0')) {
    throw new Error('Invalid storage key.');
  }
}

export class VolumeStorage implements StorageService {
  readonly driver = 'volume' as const;

  constructor(
    private readonly basePath: string,
    private readonly appUrl: string,
  ) {}

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = normalize(join(this.basePath, key));
    if (!full.startsWith(normalize(this.basePath))) {
      throw new Error('Invalid storage key.');
    }
    return full;
  }

  private signedUrl(key: string, expiresSec: number, mode: 'get' | 'put'): string {
    const exp = Date.now() + expiresSec * 1000;
    const token = mintStorageToken(key, exp, mode);
    const params = new URLSearchParams({ exp: String(exp), sig: token, mode });
    return `${this.appUrl.replace(/\/$/, '')}/api/files/${key}?${params.toString()}`;
  }

  async createUploadUrl(
    key: string,
    opts: { contentType: string; expiresSec: number },
  ): Promise<UploadTarget> {
    return {
      url: this.signedUrl(key, opts.expiresSec, 'put'),
      method: 'PUT',
      headers: { 'Content-Type': opts.contentType },
    };
  }

  async createDownloadUrl(key: string, opts: { expiresSec: number }): Promise<string> {
    return this.signedUrl(key, opts.expiresSec, 'get');
  }

  async getObject(key: string): Promise<Uint8Array | null> {
    try {
      const buf = await readFile(this.resolve(key));
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  }

  async putObject(key: string, bytes: Uint8Array, _contentType: string): Promise<void> {
    const full = this.resolve(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }

  async deleteObject(key: string): Promise<void> {
    await unlink(this.resolve(key)).catch(() => undefined);
  }
}

/** Build a VolumeStorage from env (STORAGE_VOLUME_PATH + APP_URL). */
export function volumeStorageFromEnv(): VolumeStorage {
  const env = getEnv();
  return new VolumeStorage(env.STORAGE_VOLUME_PATH, env.APP_URL);
}
