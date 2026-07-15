// StorageService factory (SPEC §8.10, AGENT.md §5).
//
// SERVER-ONLY. Selects the driver from STORAGE_DRIVER — `s3` (MinIO in dev) or
// `volume` (fs). Memoized on globalThis so a driver (and its S3 config) is built
// once per process, surviving Next HMR reloads without leaking handles.
import { getEnv } from '@nexus/config/env';
import { S3Storage } from './s3';
import { volumeStorageFromEnv } from './volume';
import type { StorageService } from './types';

export type { StorageService, UploadTarget } from './types';

const globalForStorage = globalThis as unknown as { nexusStorage?: StorageService };

function build(): StorageService {
  const env = getEnv();
  if (env.STORAGE_DRIVER === 's3') {
    if (!env.S3_ENDPOINT || !env.S3_REGION || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
      throw new Error('STORAGE_DRIVER=s3 requires S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY.');
    }
    return new S3Storage({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }
  return volumeStorageFromEnv();
}

/** The process-wide StorageService for the active driver. */
export function getStorage(): StorageService {
  globalForStorage.nexusStorage ??= build();
  return globalForStorage.nexusStorage;
}
