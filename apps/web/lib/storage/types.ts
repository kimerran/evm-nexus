// StorageService abstraction (SPEC §8.10, AGENT.md §5).
//
// One interface, two drivers (`volume` fs + `s3`/MinIO), selected by
// STORAGE_DRIVER. Files live OUTSIDE the webroot and are only ever reached via
// time-limited, signed URLs; the app never executes or inlines an upload. The
// interface is deliberately small: issue an upload URL, issue a download URL, and
// read/write/delete bytes server-side (the read path powers magic-byte validation).

/** A presigned direct-upload target the client PUTs raw bytes to. */
export interface UploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface StorageService {
  readonly driver: 'volume' | 's3';
  /** Presigned, time-limited URL the client uses to upload the object. */
  createUploadUrl(
    key: string,
    opts: { contentType: string; expiresSec: number },
  ): Promise<UploadTarget>;
  /** Presigned, time-limited URL to download the object. */
  createDownloadUrl(key: string, opts: { expiresSec: number }): Promise<string>;
  /** Read the whole object server-side (for magic-byte validation). `null` if absent. */
  getObject(key: string): Promise<Uint8Array | null>;
  /** Write bytes server-side (used by tests / the volume upload handler). */
  putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Delete an object (best-effort cleanup of a rejected upload). */
  deleteObject(key: string): Promise<void>;
}
