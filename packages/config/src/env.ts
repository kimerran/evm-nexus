import { z } from 'zod';

/**
 * Single source of truth for environment configuration (SPEC §11.2).
 *
 * AGENT.md §4: read env only through this validated module — never scatter
 * `process.env` reads. Secrets live only in env / the secret store; the client
 * bundle receives nothing from here (only `NEXT_PUBLIC_*` may cross that line).
 */
export const envSchema = z.object({
  // --- Core ---
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url(),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be a 32-byte (base64) string'),
  CSRF_SECRET: z.string().min(16, 'CSRF_SECRET must be at least 16 characters'),

  // --- Database ---
  DATABASE_URL: z.string().min(1),
  DIRECT_DATABASE_URL: z.string().min(1).optional(),

  // --- Redis ---
  REDIS_URL: z.string().min(1),

  // --- File storage ---
  STORAGE_DRIVER: z.enum(['volume', 's3']).default('volume'),
  STORAGE_VOLUME_PATH: z.string().default('/data/uploads'),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // --- Server-custodied signers (worker-only; validated where used) ---
  FAUCET_PRIVATE_KEY: z.string().optional(),
  RELAYER_PRIVATE_KEY: z.string().optional(),
  PAYMASTER_SIGNER_PRIVATE_KEY: z.string().optional(),

  // --- Seed admin ---
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().optional(),

  // --- Defaults for first network (seed) ---
  DEFAULT_NETWORK_NAME: z.string().default('Anvil-Local'),
  DEFAULT_CHAIN_ID: z.coerce.number().int().positive().default(31337),
  DEFAULT_RPC_URL: z.string().default('http://localhost:8545'),
  DEFAULT_EXPLORER_URL: z.string().optional(),
  DEFAULT_NATIVE_SYMBOL: z.string().default('ETH'),

  // --- Limits (stored as wei strings / integers) ---
  FAUCET_DRIP_WEI: z.string().default('5000000000000000000'),
  FAUCET_DAILY_CAP_WEI: z.string().default('500000000000000000000'),
  BOMBARD_MAX_TPS: z.coerce.number().int().positive().default(1000),
  BOMBARD_MAX_TOTAL: z.coerce.number().int().positive().default(1000000),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate an env source. Throws a single aggregated error listing
 * every offending variable — never leaks the values themselves.
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}

let cached: Env | undefined;

/** Lazily parse and memoize `process.env`. Call at runtime, not build time. */
export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}
