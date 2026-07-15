# Features log

Running log of shipped features. Append one entry per change (newest first),
per the auto-dev workflow.


## 2026-07-15 — Network config & viem client resolver (#7)

Admin-managed, RPC-secret-safe network configuration plus the single viem client
path every future on-chain read/write flows through.

- **Network resolver** (`apps/web/lib/chain/resolver.ts`): pure builders
  `toViemChain` / `buildPublicClient` / `buildWalletClient` turn a `NetworkClientConfig`
  into viem clients (`http()` default, `webSocket()` when `preferWebSocket` + `wsUrl`),
  and DB-bound `getActiveNetworkConfig` / `getPublicClient` / `getWalletClient` read the
  active (`isDefault`) `Network`, decrypting its RPC URL. Adds `viem@2.55.2`. Verified
  live against anvil: chainId 31337, latest block read (advanced 0→5 after mining).
- **RPC secret handling** (`apps/web/lib/chain/rpc-url.ts`): a URL carrying userinfo is
  AES-256-GCM encrypted at rest (`enc:v1.…` via `lib/crypto/at-rest`) and stored verbatim
  otherwise. Client responses never receive the stored value — only a redacted origin
  (`protocol//host`, dropping userinfo/path/query) plus a `rpcUrlHasSecret` flag
  (`network-dto.ts`). Proven: DB column shows `enc:v1.…` with no plaintext key.
- **API** (`app/api/networks/…`): `GET /` + `GET /:id` (any auth, secrets redacted),
  `POST /` + `PATCH /:id` + `DELETE /:id` + `POST /:id/default` (all `requireRole('ADMIN')`
  + CSRF + zod), and `GET /:id/health` (live `eth_*` metrics via the resolver). zod
  checksum-normalizes addresses (viem `getAddress`), validates chainId + http(s)/ws(s)
  schemes, rejects unknown keys, and keeps wei amounts as integer strings (AGENT §4).
  Single-active-default is enforced atomically; the delete guard (`network-service.ts`)
  blocks removing the default or a referenced network (→409). `TODO(#6)` markers left
  where audit-log writes will attach.
- **Admin UI** (`app/(app)/settings/networks`): ADMIN-gated CRUD table + form (RPC/WS/
  explorer URLs, native symbol/decimals, faucet drip/cap/cooldown, paymaster + entrypoint,
  isDefault, isArchival), set-active + delete actions, echoing the `nexus_csrf` token.
- Live-verified: admin create/patch/set-default, USER write → 403, CSRF-less write → 403,
  GET redaction, delete guard, and the resolver reading anvil's head. 22 new Vitest cases.

## 2026-07-15 — User & API-key management + audit log (#6)

Settings surfaces + endpoints for user administration, personal API keys, and the
audit trail, all on the #5 security spine.

- **Audit writer** (`apps/web/lib/audit.ts`): `writeAudit({ actorId, action, target?,
  metadata?, ip? })` — the single reusable writer every privileged action records
  through (user activate/deactivate/role-change/password-reset, api-key issue/revoke;
  #7's network mutations wire in after merge). Maps `target` → `targetType`/`targetId`,
  is best-effort (a failed write is logged, never thrown, so audit can't break the
  action), and NEVER puts secrets in metadata (caller contract, restated at every call
  site — only ids/names/prefixes/roles).
- **User management** (`/settings/users`, ADMIN): `GET /api/users` (list, never selects
  `passwordHash`), `PATCH /api/users/[id]` (activate/deactivate, role change — with a
  self-lockout guard), `POST /api/users/[id]/reset-password` (fresh argon2id via
  `lib/auth/password`, then revokes all the target's sessions). All `requireRole('ADMIN')`
  + CSRF; each applied change writes an audit row.
- **Personal API keys** (`/settings/api-keys`, USER): `GET /api/api-keys` (masked — only
  the display `prefix`, never the hash), `POST /api/api-keys` (issues via
  `lib/auth/api-key`; the raw `nxs_…` token is returned exactly ONCE and only its sha256
  hash is stored), `DELETE /api/api-keys/[id]` (soft-revoke; owner-only, foreign keys 404).
  `requireAuth` + CSRF; issue/revoke audited (name + prefix only).
- **Audit viewer** (`/settings/audit`, ADMIN): paginated UI over the existing
  `GET /api/audit` (extended to join the actor username; cursor pagination already present).
- **CSRF plumbing**: `lib/csrf-client.ts` (`csrfFetch` reads the readable `nexus_csrf`
  cookie → `x-csrf-token`) and `lib/auth/mutation-guard.ts` (`requireCsrfUnlessApiKey` —
  CSRF on the cookie path, exempt for non-ambient Bearer API-key callers).
- **Tests** (Vitest): api-key verification is one-way (lookup by sha256 hash; the raw
  token never appears in the query; revoked key → null); `writeAudit` maps fields, stores
  metadata verbatim with no injected secrets, and is best-effort; the `/api/users/[id]`
  handler writes an audit row on an admin action and returns 403 (no write, no audit) for
  a USER. Live-verified end to end: admin deactivate/reactivate + role change (CSRF; no-CSRF
  → 403), USER issues a key → authenticates `GET /api/me` (200) → revokes → same key 401,
  USER → `/api/users` & `/api/audit` 403, and the audit log shows every action with no
  secrets in metadata.

## 2026-07-15 — AuthZ, CSRF, rate-limiting & security headers (#5)

The security spine every downstream feature imports.

- **RBAC** (`apps/web/lib/auth/require-role.ts`, `principal.ts`): `requireRole(role, req?)`
  is the authoritative gate, called at the top of every route handler / server
  action — never hidden UI. It resolves a `Principal` from a session cookie OR a
  personal API key, then the pure `authorize()` decision throws `UnauthenticatedError`
  (→401) / `ForbiddenError` (→403). `roleSatisfies` keeps ADMIN ⊇ USER. Re-checked
  server-side in the handler, independent of `proxy.ts`.
- **Nonce-based CSP + strict headers** (`apps/web/proxy.ts`, `app/layout.tsx`): a
  per-request nonce is generated in `proxy.ts`, injected into the request headers so
  Next stamps it onto every framework/hydration script, and echoed in a
  `Content-Security-Policy` with **no `unsafe-inline` for scripts**
  (`script-src 'self' 'nonce-…' 'strict-dynamic'`; dev adds `'unsafe-eval'` only).
  Inline STYLES (next/font, Material Symbols) are allowed via `style-src 'unsafe-inline'`.
  Plus HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`. Root layout consumes the nonce
  (`headers().get('x-nonce')`). Verified: `/login` + `/dashboard` render and hydrate
  with 0 un-nonced inline scripts.
- **Sliding-window rate limiter** (`apps/web/lib/rate-limit.ts`, `redis.ts`): reusable,
  keyable per-user / per-IP / per-address (Redis sorted-set window), with named
  `RATE_LIMITS` for login/faucet/deploy/transfer/bombard/chat/userops. `consume` /
  `peek` / `record` / `reset` behind an injectable store (in-memory store + fake clock
  for deterministic tests); fails **open** on Redis errors. The #4 login limiter now
  delegates to it (`lib/auth/rate-limit.ts`).
- **CSRF** (`apps/web/lib/auth/csrf.ts`): double-submit token (readable `nexus_csrf`
  cookie echoed in `x-csrf-token`) + Origin/Referer check against `APP_URL`, constant-time
  compare. `proxy.ts` seeds the cookie on HTML navigations; login issues a fresh one.
  Wired into `logout` + `change-password` (login is pre-auth).
- **API-key auth** (`apps/web/lib/auth/api-key.ts` + new `ApiKey` model/migration):
  `Authorization: Bearer nxs_…` → sha256 lookup on `ApiKey.keyHash` (raw key never
  stored), checks revoked/expired/active, scope = issuing user's role. Model:
  `id, userId→User.apiKeys, name, keyHash @unique, prefix, lastUsedAt, expiresAt,
  createdAt, revokedAt`. Management UI/endpoints land in #6.
- **Logging** (`apps/web/lib/log.ts`): pino + pino-http with redaction of `password`,
  `authorization`, `cookie`, `privateKey`, `mnemonic`, `keystore`, `rawSignedTx`
  (bare + one-level-nested + header locations). Log tx hashes, never raw signed tx.
- **Error mapper** (`apps/web/lib/errors.ts` typed errors → `lib/http.ts`
  `toErrorResponse`): `{ error: { code, message } }` envelopes; unknown throws → generic
  500, logged (redacted) — no stack traces / secrets leak.
- **Demo/real guarded routes**: `GET /api/me` (any principal, session or key) and
  `GET /api/audit` (ADMIN, SPEC §8.11) prove the gate live.
- Vitest: rate-limiter window (block past threshold + recover after window + partial
  slide + peek/record/reset), CSRF reject/accept, RBAC deny (USER→ADMIN = 403),
  API-key format/hash/parse, log redaction. All gates green; live-verified RBAC 401/403
  (incl. spoofed CVE-2025-29927 header), CSP render/hydrate, rate-limit block+recovery,
  valid/revoked/invalid API key.

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
