import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Baseline security headers (defense-in-depth alongside proxy.ts). The full
// CSP + HSTS policy is tightened in the Auth & Security Spine sprint.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

// Monorepo root (two levels up from apps/web). Next traces this whole workspace
// when emitting the standalone bundle so the workspace packages (@nexus/*) and
// the generated Prisma client are copied into `.next/standalone` (SPEC §14).
const monorepoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server (`.next/standalone`) for a slim Railway/Docker
  // runtime image — no need to ship the full monorepo + pnpm store at runtime.
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  // Workspace packages ship TypeScript source and must be transpiled by Next.
  transpilePackages: ['@nexus/config', '@nexus/types'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
