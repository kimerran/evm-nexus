# AGENT.md — Engineering Guide for EVM Nexus

Instructions for the coding agent building and maintaining **EVM Nexus** (see `SPEC.md` for
the what, `BRAND.md` for the look). This file governs **how** to build it: stack, structure,
conventions, and the non-negotiable security rules. Read all three files before writing code.

---

## 0. Prime directives

1. **Never custody user private keys.** Keypairs are generated, encrypted, decrypted, and used to sign **only in the browser**. No endpoint, log, DB column, or telemetry event may contain a plaintext private key or mnemonic. The only server-held keys are the operator faucet/relayer/paymaster keys, which live in env vars and are used **only inside the worker process**. If a task seems to require sending a user key to the server, stop — the design is wrong.
2. **Use the latest stable versions.** Before adding or pinning a dependency, check its current version (`pnpm outdated`, `npm show <pkg> version`) and use the newest stable. Never copy old version numbers from tutorials.
3. **Validate everything at the boundary.** Every route handler and server action parses input with **zod** and re-checks auth + RBAC server-side. The client is untrusted.
4. **Fail safe.** Enforce chain-id checks, gas/value ceilings, rate limits, and budget caps before any broadcast. Provide kill-switches for faucet, bombard, and paymaster.
5. **Small, verifiable slices.** Build one feature end-to-end (page → action → worker → chain → DB) and confirm it on a local `anvil` chain before starting the next.

---

## 1. Tech stack (pinned floors — verify latest at build time)

| Area | Tool | Version |
|---|---|---|
| Runtime | Node.js | **24 LTS** (≥ 24.18) |
| Package manager | pnpm | **10.x** |
| Framework | Next.js | **16.2.x** (App Router, RSC, Turbopack default, `proxy.ts`) |
| UI | React / React DOM | **19.2.x** |
| Language | TypeScript | **5.7+**, `strict: true` |
| Styling | Tailwind CSS | **4.3.x** (CSS-first `@theme`) |
| ORM | Prisma | **7.4.x** (`prisma-client` generator, `prisma.config.ts`, `@prisma/adapter-pg`) |
| DB | PostgreSQL | **16/17** (Railway) |
| Cache/queue | Redis + ioredis + BullMQ | latest |
| EVM | viem | **2.55.x** (+ wagmi 2 only if browser-wallet connect is added) |
| Account abstraction | permissionless / viem AA actions + OZ | latest |
| Contracts | Solidity 0.8.28+, OpenZeppelin 5.x, Foundry | latest |
| Auth | @node-rs/argon2 + jose | latest |
| Validation | zod 4 | latest |
| Logging | pino + pino-http | latest |
| Storage | @aws-sdk/client-s3 (S3/MinIO) + fs volume driver | latest |
| Testing | Vitest, Playwright, forge test | latest |
| Lint/format | ESLint 9 flat config + Prettier (or Biome) | latest |

**Version-specific gotchas the agent must respect:**
- **Next 16**: middleware file is now **`proxy.ts`**, not `middleware.ts`. `params`, `cookies()`, `headers()`, `searchParams` are **async** — always `await`. `next lint` is removed → run ESLint directly (`eslint .`). Turbopack is the default bundler. Stay current on security patches.
- **Prisma 7**: query compiler is TS/WASM (no Rust engine); configure the datasource in **`prisma.config.ts`**; the `prisma-client` generator needs an `output` path; Prisma **does not auto-load `.env`** — load it (`dotenv`/`@dotenvx/dotenvx`) in `prisma.config.ts` and app bootstrap. Use the **driver adapter** `@prisma/adapter-pg`.
- **Tailwind 4**: no `tailwind.config.js`. Define tokens in a `@theme` block in the CSS entry (`@import "tailwindcss";`), wire `@tailwindcss/postcss`. Port all `BRAND.md` tokens there.
- **viem**: store amounts as `bigint`/wei; never use JS floats for token math. Lock the patch version (types can shift between minors).

---

## 2. Repository layout (pnpm monorepo)

```
evm-nexus/
├─ apps/
│  └─ web/                     # Next.js 16 app (frontend + API + server actions)
│     ├─ app/
│     │  ├─ (auth)/login/
│     │  ├─ (app)/             # authenticated shell (TopNav + SideNav)
│     │  │  ├─ dashboard/  faucet/  keypairs/  launchpad/  lab/
│     │  │  ├─ chat/  transfers/  smart-wallets/
│     │  │  └─ settings/{networks,users,api-keys,profile}/
│     │  ├─ api/               # route handlers (see SPEC §8)
│     │  ├─ globals.css        # @import "tailwindcss"; @theme { ... }  (BRAND tokens)
│     │  └─ layout.tsx
│     ├─ proxy.ts              # Next 16 middleware replacement (headers + auth gate)
│     ├─ components/           # UI per BRAND.md (Card, Button, Input, Table, Terminal…)
│     ├─ lib/
│     │  ├─ auth/              # session (jose), argon2, rbac, csrf, rate-limit
│     │  ├─ chain/             # viem clients, network resolver, tx helpers, abi
│     │  ├─ crypto/            # client-side keystore (Web Crypto) — browser only
│     │  ├─ storage/           # StorageService (volume | s3 drivers)
│     │  ├─ queue/             # BullMQ queue definitions + producers
│     │  ├─ db.ts              # PrismaClient singleton (adapter-pg)
│     │  └─ validation/        # zod schemas (shared with API)
│     └─ ...
├─ worker/                     # BullMQ consumers (faucet-drip, bombard, watchers, bundler)
│  └─ index.ts
├─ packages/
│  ├─ contracts/               # Foundry: src/*.sol, test/*.t.sol, out/ (ABIs+bytecode)
│  ├─ config/                  # shared tsconfig, eslint, zod env schema
│  └─ types/                   # shared TS types (contract types, DTOs)
├─ prisma/
│  ├─ schema.prisma
│  ├─ seed.ts
│  └─ migrations/
├─ prisma.config.ts
├─ docker-compose.yml
├─ railway.json                # (or per-service config)
├─ .env.example                # committed, no secrets
├─ pnpm-workspace.yaml
└─ package.json
```

Keep **client-only crypto** (`lib/crypto`) free of any server import; guard with `"use client"` and never reference `process.env` secrets there. Keep **operator-key code** (faucet/relayer/paymaster) only under `worker/` — never importable from client components.

---

## 3. Setup & common commands

```bash
# install
corepack enable && corepack prepare pnpm@latest --activate
pnpm install --frozen-lockfile

# backing services
docker compose up -d                 # postgres, redis, minio, anvil

# env
cp .env.example .env                 # fill SESSION_SECRET, ADMIN_PASSWORD, keys, etc.

# database
pnpm prisma generate
pnpm prisma migrate dev
pnpm prisma db seed                  # admin + default network

# contracts
pnpm --filter contracts build        # forge build -> out/ (ABIs + bytecode)
pnpm --filter contracts test         # forge test

# run
pnpm --filter web dev                # Next.js (Turbopack)
pnpm worker                          # BullMQ consumers

# quality gates (must pass before commit/PR)
pnpm typecheck                       # tsc --noEmit across workspace
pnpm lint                            # eslint . (NOT `next lint`)
pnpm test                            # vitest
pnpm test:e2e                        # playwright
pnpm audit --audit-level=high
```

---

## 4. Coding conventions

- **TypeScript strict** everywhere; no `any` (use `unknown` + narrowing). Export types from `packages/types`.
- **Server-first**: default to RSC + **Server Actions** for mutations; add Route Handlers when an HTTP API is genuinely needed (API-key scripting, SSE, webhooks). Both must auth + validate.
- **Data access** only through `lib/db.ts` (Prisma singleton). No raw SQL unless necessary; if raw, parameterize.
- **Money/units**: `bigint` in memory, **string (wei)** at rest and over the wire. Format for display only at the edge. Never `Number()` a token amount.
- **Addresses**: checksum with viem `getAddress()`; validate with zod refinement; store lowercased or checksummed consistently (pick one; document it).
- **Errors**: throw typed errors; map to `{ error: { code, message } }`; never leak stack traces or secrets to clients.
- **Naming**: files kebab-case; React components PascalCase; hooks `useX`; server actions `verbNoun` (e.g. `requestFaucetDrip`).
- **Styling**: Tailwind utilities using `BRAND.md` tokens only; no hardcoded hex; shared primitives in `components/ui`. Respect `prefers-reduced-motion`.
- **Comments**: explain *why*, not *what*. Document every place a security invariant is enforced.
- **Env access**: read env only through a validated `env` module (zod-parsed at boot); never scatter `process.env` reads. Client bundles get only `NEXT_PUBLIC_*`.

---

## 5. Security best practices (enforce in code, not just docs)

**Auth & sessions**
- Hash passwords with **argon2id** (`@node-rs/argon2`), reasonable memory/time cost.
- Sessions = **jose**-signed JWS in an **httpOnly, Secure, SameSite=Strict** cookie; persist only a **hash** of the token in `Session` for revocation; short TTL + rotation on privilege/password change.
- Rate-limit login (per IP + username), generic error messages, no user enumeration.
- Re-check session + role in **every** server action / route handler. `proxy.ts` is defense-in-depth only (Next 16 has had proxy-bypass advisories) — never the sole gate.

**Input & transport**
- zod-validate every input; reject unknown keys; normalize addresses/amounts.
- CSRF double-submit token on cookie-authed mutations + origin check.
- Strict security headers via `proxy.ts` + `next.config`: CSP (no unsafe-inline scripts), HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.

**Chain safety**
- Before any broadcast: confirm the signed tx's `chainId` equals the **active** network; enforce max `gasLimit`, `value`, `maxFeePerGas`.
- Only broadcast to admin-approved networks. Never proxy arbitrary user-supplied RPC URLs from the browser.
- Rate-limit + budget-cap faucet, bombard, paymaster; single active bombard run per user; global kill-switch in `AppSetting`.

**Secrets & data**
- Operator keys (`FAUCET_/RELAYER_/PAYMASTER_PRIVATE_KEY`) only in env, only in `worker/`. Never in DB, repo, client, or logs.
- Encrypt at rest: `Network.rpcUrl` credentials + any persisted keystore blobs (app-layer AES with `ENCRYPTION_KEY`, or `pgcrypto`).
- `pino` redaction for `password`, `authorization`, `cookie`, `privateKey`, `mnemonic`, `keystore`, `rawSignedTx` (log only tx hashes).
- File uploads: validate MIME + magic bytes + size; store via `StorageService`; serve via signed, time-limited URLs; never execute or inline.

**Dependencies**
- Latest patched versions; `pnpm audit` in CI; Dependabot/renovate enabled; pin exact versions in the lockfile; review transitive advisories (esp. Next.js/React RSC).

---

## 6. Client-side keystore (the crypto that must stay in the browser)

Implement in `lib/crypto` as a `"use client"` module + optional Web Worker:
- `generateKeypair()` → viem `generatePrivateKey()` + `privateKeyToAccount()`; return address, keep key in memory.
- `encryptKeystore(privateKey, passphrase)` → derive key (Argon2id WASM, per-key salt) → AES-256-GCM (`crypto.subtle`) → Web3-Secret-Storage-shaped JSON. **Never** send the plaintext key anywhere.
- `decryptKeystore(blob, passphrase)` → in-memory account for signing.
- Vault holds accounts in memory (cleared on unload); "persist" only stores the **encrypted** blob via `POST /api/keypairs` (server rejects any payload with a private-key field).
- Signing (`signTransaction`, deploy, transfer, bombard pre-sign, UserOp) happens here; the app sends only **raw signed** payloads to the server for broadcast.

Unit-test that: (a) the encrypted blob never contains the plaintext key; (b) round-trip encrypt/decrypt works; (c) wrong passphrase fails cleanly.

---

## 7. Contracts workflow

- Solidity 0.8.28+, OpenZeppelin 5.x, built with **Foundry** (`forge build`/`forge test`).
- Ship **precompiled** template artifacts for each token standard + feature combination (or a modular factory). **Do not compile Solidity at request time.**
- The app imports ABIs + bytecode from `packages/contracts/out`; `viem` `deployContract` encodes constructor args and returns the deploy tx for **client signing**.
- `ChatLog` deployed once per network; address stored in `Network`/`AppSetting`.
- ERC-4337: reuse the chain's canonical `EntryPoint` if deployed; else deploy factory + `VerifyingPaymaster`. Paymaster signer is an operator key (worker-only).
- Test every contract with `forge test` (mint/burn/pause/permit paths, access control) before wiring the UI.

---

## 8. Testing & verification

- **Contracts**: `forge test` — feature flags, access control, revert cases.
- **Unit** (Vitest): zod schemas, crypto round-trips, rate limiters, nonce manager, session/jwt, wei formatting.
- **Integration**: API handlers against a test Postgres + Redis + `anvil`; assert DB state + on-chain effects.
- **E2E** (Playwright): login → faucet drip → deploy ERC-20 → transfer → bombard (small N) → chat commit+verify → sponsored tx, on a local anvil chain.
- **Manual verification per slice**: run it end-to-end on `anvil`, confirm the tx receipt and the DB row, before moving on. "It compiles" is not "it works" — check on-chain effects and returned values.
- CI gates (all must pass): `typecheck`, `lint`, `test`, contract tests, `pnpm audit --audit-level=high`, build.

---

## 9. Git & CI/CD

- Conventional Commits; small PRs scoped to one feature slice; PR description lists the security invariants touched.
- CI (GitHub Actions): install → generate Prisma → typecheck → lint → unit/integration → forge test → build → audit. Block merge on failure.
- **Railway**: two services (`web`, `worker`) + Postgres + Redis + a Volume. On release: `pnpm prisma migrate deploy`; seed once post-first-migrate. Health check `/api/health`. Secrets in Railway env, never in the repo. Auto-deploy `main` only after CI passes.
- Migrations are **forward-only** in prod (`migrate deploy`); never `migrate dev`/`db push` against production.

---

## 10. Definition of Done (per feature)

A feature is done when:
1. It works end-to-end on a local `anvil` chain (page → action/API → worker → chain → DB), verified by an executed test, not just a compile.
2. Inputs are zod-validated; auth + RBAC enforced server-side; rate limits/ceilings applied.
3. No secret or private key can leak (checked: code, logs, responses, client bundle).
4. Types pass, lint passes, unit + e2e cover the happy path and one failure path.
5. UI matches `BRAND.md` tokens/patterns and handles loading/empty/error states.
6. The `SPEC.md` §17 acceptance row for the feature is satisfied.

If any item fails, it is not done — fix before moving on.
