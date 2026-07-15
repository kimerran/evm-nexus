# Features log

Running log of shipped features. Append one entry per change (newest first),
per the auto-dev workflow.

## 2026-07-15 — Design system & app shell (#3)

- **BRAND tokens → Tailwind v4** (`apps/web/app/globals.css`): full BRAND §2 color
  system, §5 radius/spacing, §3 font families ported to a CSS-first `@theme` block
  (no `tailwind.config.js`). Type-scale utilities `display-lg`/`headline-md`/
  `body-md`/`label-caps`/`code-sm`/`code-xs`, custom scrollbar, `status-pulse`
  keyframe, and a `prefers-reduced-motion` guard (disables pulse/bounce/confetti).
- **Fonts**: Hanken Grotesk + JetBrains Mono via `next/font/google` (self-hosted
  at build time, no runtime fetch); Material Symbols Outlined via stylesheet link.
- **UI primitives** (`apps/web/components/ui`, tokens only, no hardcoded hex):
  Card/GlassPanel, Button + IconButton (all §7.2 variants), Input, Table set,
  Badge/Chip, StatusDot, Toggle, Slider, Terminal/log-stream, Toast (+provider),
  Icon, CopyButton, MonoAddress (address truncation `0x71C…3A2` + copy affordance).
- **App shell** (`apps/web/app/(app)/layout.tsx`): sticky TopNav (h-16), fixed
  SideNav (w-64) with network status block, ambient glow, bento-grid dashboard.
  Nav item states per §6.2; admin-only items hidden for USER via a typed role stub
  (`lib/auth/role.ts`, TODO Sprint 1). Icon-only buttons all carry `aria-label`.
- Unit test for the `truncateAddress` helper (`apps/web/lib/format.test.ts`).

## 2026-07-15 — Monorepo scaffold, tooling & CI (#1)

- pnpm workspace (`apps/web`, `worker`, `packages/{config,types,contracts}`).
- Shared config in `packages/config`: strict `tsconfig.base.json`, ESLint 9 flat
  config (`no-any`), and a zod **env schema** (`@nexus/config/env`) parsed at boot.
- `.env.example` committed (SPEC §11.2); `.env` gitignored.
- `docker-compose.yml`: postgres 17, redis 7, minio, anvil (SPEC §15).
- Vitest (unit) + Playwright (e2e) configured with smoke tests.
- Foundry project in `packages/contracts` with a dependency-free passing test.
- GitHub Actions CI: install → prisma generate → typecheck → lint → unit →
  forge test → build → `pnpm audit --audit-level=high`.
- Dependabot enabled (npm, github-actions, docker).
- Next.js 16 app shell stub (`/`, `/api/health`, `proxy.ts` security headers).
