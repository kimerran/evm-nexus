# Features log

Running log of shipped features. Append one entry per change (newest first),
per the auto-dev workflow.

## 2026-07-15 — Authentication & sessions (#4)

- **Password hashing** (`apps/web/lib/auth/password.ts`): argon2id via
  `@node-rs/argon2` with a single OWASP-aligned cost set (19 MiB / t=2 / p=1),
  shared with the seed. `verifyPassword` returns `false` (never throws) and a
  reusable `DUMMY_PASSWORD_HASH` equalizes login timing so a missing user is
  indistinguishable from a wrong password.
- **Signed sessions** (`apps/web/lib/auth/session-token.ts`, `session.ts`):
  a random 256-bit `sid` is carried inside a **jose** HS256 JWS (keyed by
  `SESSION_SECRET`, short 30-min TTL with sliding refresh); only `sha256(sid)` is
  persisted in `Session.tokenHash` for revocation — the raw token/JWS is never
  stored. Cookie is **httpOnly + SameSite=Strict**, and `Secure` only when
  `NODE_ENV==='production'` (so local http login works). `getSession()` awaits the
  async Next 16 `cookies()`, verifies the JWS, then requires a live, non-revoked
  row and an active user.
- **Endpoints** (SPEC §8.1): `POST /api/auth/login` (rate-limited, generic errors,
  no user enumeration), `POST /api/auth/logout` (server-side revoke + clear
  cookie), `GET /api/auth/session` (`{ user }` or 401, applies sliding refresh),
  `POST /api/auth/change-password` (verifies current password, rotates the current
  session, **revokes all other sessions**). All zod-validated (`.strict()`),
  auth re-checked server-side in every handler.
- **Login rate limiting** (`apps/web/lib/auth/rate-limit.ts`): self-contained
  Redis-backed (`ioredis`) fixed-window **failure** counter, per-IP (20/60s) and
  per-username (5/60s); counts only failures, resets a username on success, fails
  open on Redis errors, returns `Retry-After`. TODO(#5) generalizes it.
- **RBAC** (`apps/web/lib/auth/role.ts`): real session→role replaces the Sprint 0
  stub; `(app)` shell layout now awaits `getSession()` and redirects to `/login`.
- **Login page** (`apps/web/app/(auth)/login`): public, outside the authenticated
  `(app)` shell, built from `components/ui` primitives (tokens only).
- **proxy.ts**: defense-in-depth cookie-presence redirect for non-public pages
  (never the sole gate — handlers/RSC re-check).
- Vitest unit tests: argon2 hash+verify + wrong-password; JWS sign/verify +
  reject tampered/expired/foreign-secret/bad-role; sid hashing; session
  revocation/validity + sliding-refresh threshold.

## 2026-07-15 — Data layer: Prisma 7 schema, migrations & seed (#2)

- Prisma 7 `prisma.config.ts` (explicit dotenv load — Prisma 7 does not auto-load
  `.env` — datasource URL, and `tsx prisma/seed.ts` seed command).
- `prisma/schema.prisma` (SPEC §5): all 13 models (User, Session, Network,
  Keypair, Deployment, Transfer, BombardRun, BombardEvent, ChatMessage,
  FaucetRequest, SmartAccount, AuditLog, AppSetting) and all 7 enums (Role,
  TokenStandard, TransferKind, BombardMode, RunStatus, TxStatus). New
  `prisma-client` generator → ESM client at `apps/web/lib/generated/prisma`
  (gitignored). Money is stored as **String (wei)**; no plaintext key columns.
- Initial migration `20260715055127_init`; forward-only `migrate deploy` for prod.
- `apps/web/lib/db.ts`: PrismaClient singleton over the `@prisma/adapter-pg`
  driver adapter (globalThis reuse in dev).
- `apps/web/lib/crypto/at-rest.ts`: server-only AES-256-GCM at-rest encryption
  (from `ENCRYPTION_KEY`) for `Network.rpcUrl` credentials + keystore blobs, with
  round-trip / tamper unit tests.
- `prisma/seed.ts` (SPEC §16): idempotent — admin (argon2id via `@node-rs/argon2`,
  password from `ADMIN_PASSWORD`, never hardcoded), default `Network`
  (`isDefault=true`), baseline `AppSetting` ceilings/kill-switches. Re-running is
  a no-op.
- `@nexus/config/env` hardened: empty-string env values (`KEY=`) normalize to
  unset so blank `.env` lines don't defeat `.optional()`/defaults.

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
