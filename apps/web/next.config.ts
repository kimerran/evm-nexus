import type { NextConfig } from 'next';

// Baseline security headers (defense-in-depth alongside proxy.ts). The full
// CSP + HSTS policy is tightened in the Auth & Security Spine sprint.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source and must be transpiled by Next.
  transpilePackages: ['@nexus/config', '@nexus/types'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
