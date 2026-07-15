# EVM Nexus

**An operator console + smart-contract toolkit for exercising and stress-testing a new / test EVM chain.**

EVM Nexus is a single-tenant web app that lets an authenticated operator drive a test EVM network end-to-end: fund addresses, manage keypairs offline, launch tokens, move assets, bombard the chain with transactions for throughput testing, post tamper-evident on-chain chat, and send gas-sponsored transactions via ERC-4337 smart accounts.

> ⚠️ **Test chains only.** The faucet, relayer, and paymaster hold funded keys for a low-value test chain. This is **not** a custodial wallet and is not intended to hold mainnet value.

---

## Features

| Feature | What it does |
|---|---|
| **Faucet** | Rate-limited drip of the native gas token to any address. |
| **Keypair vault** | Generate EOA keypairs **in the browser**; private keys are encrypted client-side and never sent to or stored in plaintext on the server. |
| **Asset Launchpad** | Deploy configurable **ERC-20 / ERC-721 / ERC-1155** contracts (mintable / burnable / pausable / permit). |
| **Transfers** | Send the native token and ERC-20/721/1155 assets. |
| **Bombard** | Fire transactions at a configurable TPS up to a target count, for throughput/stress testing. |
| **On-chain chat** | Post messages whose `keccak256` hash is committed on-chain for tamper-evidence, with a verify path. |
| **Smart wallets** | Deploy ERC-4337 smart accounts and submit gas-sponsored transactions via a paymaster/relayer. |
| **Network config** | Admin-managed per-network settings: RPC URL, chain ID, explorer URL, native symbol, faucet params. |

---

## Security model (read first)

This is the load-bearing design constraint — see [`SPEC.md §4`](./SPEC.md) and [`AGENT.md §0`](./AGENT.md).

- **Never custody user keys.** Keypairs are generated, encrypted (Argon2id → AES-256-GCM), decrypted, and used to **sign only in the browser**. The server only **broadcasts** already-signed transactions. No endpoint, log, or DB column ever holds a plaintext private key or mnemonic.
- **Server-held keys** (faucet / relayer / paymaster) are operator secrets for a low-value test chain, live only in environment variables, and are used **only inside the worker process**.
- **Fail safe.** Every broadcast is gated on a chain-ID check and gas/value ceilings. Faucet, bombard, and paymaster have rate limits, budget caps, and kill-switches.
- **Validate at the boundary.** Every route handler / server action parses input with zod and re-checks auth + RBAC server-side.

---

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 24 LTS |
| Package manager | pnpm 10 (workspace monorepo) |
| Framework | Next.js 16 (App Router, RSC, Turbopack, `proxy.ts`) |
| UI | React 19 · Tailwind CSS 4 (CSS-first `@theme`) |
| Language | TypeScript 5.7+ (`strict`) |
| ORM / DB | Prisma 7 (`@prisma/adapter-pg`) · PostgreSQL 16/17 |
| Cache / queue | Redis · ioredis · BullMQ |
| EVM SDK | viem 2.55 (+ `permissionless` for ERC-4337) |
| Contracts | Solidity 0.8.28+ · OpenZeppelin 5 · Foundry |
| Auth | `@node-rs/argon2` + `jose` (signed httpOnly cookie sessions) |
| Validation / logs | zod 4 · pino |
| Testing | Vitest · Playwright · `forge test` |
| Deploy | Railway (web + worker services) |

See [`SPEC.md §3`](./SPEC.md) and [`AGENT.md §1`](./AGENT.md) for pinned version floors and per-version gotchas.

---

## Repository layout

```
evm-nexus/
├─ apps/web/            # Next.js 16 app (frontend + API + server actions)
│  ├─ app/             # (auth)/login, (app)/dashboard|faucet|launchpad|lab|…, api/
│  ├─ proxy.ts         # Next 16 middleware — security headers + auth gate
│  ├─ components/      # UI primitives (BRAND.md)
│  └─ lib/             # auth, chain (viem), crypto (browser-only), storage, queue, db, validation
├─ worker/             # BullMQ consumers (faucet-drip, bombard-runner, watchers, bundler)
├─ packages/
│  ├─ contracts/       # Foundry: src/*.sol, test/*.t.sol, out/ (ABIs + bytecode)
│  ├─ config/          # shared tsconfig, eslint, zod env schema
│  └─ types/           # shared TS types
├─ prisma/             # schema.prisma, seed.ts, migrations/
├─ docker-compose.yml  # postgres, redis, minio, anvil
└─ prisma.config.ts
```

---

## Getting started

### Prerequisites
- Node.js 24 LTS, `corepack` (for pnpm), Docker, and [Foundry](https://getfoundry.sh) (`forge`).

### Local development

```bash
# 1. install
corepack enable && corepack prepare pnpm@latest --activate
pnpm install --frozen-lockfile

# 2. backing services (postgres, redis, minio, anvil)
docker compose up -d

# 3. environment
cp .env.example .env          # fill SESSION_SECRET, ADMIN_PASSWORD, keys, etc.

# 4. database
pnpm prisma generate
pnpm prisma migrate dev
pnpm prisma db seed           # creates admin + default network (points at anvil :8545)

# 5. contracts
pnpm --filter contracts build # forge build → ABIs/bytecode consumed by the app

# 6. run (two terminals)
pnpm --filter web dev         # Next.js (Turbopack)
pnpm worker                   # BullMQ consumers
```

The app is then available at `http://localhost:3000`. Log in with the seeded `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

### Environment

Copy `.env.example` → `.env` and fill it in. Key variables (full list in [`SPEC.md §11.2`](./SPEC.md)):

- **Core** — `SESSION_SECRET`, `ENCRYPTION_KEY`, `CSRF_SECRET`, `APP_URL`
- **Database / cache** — `DATABASE_URL`, `REDIS_URL`
- **Storage** — `STORAGE_DRIVER` (`volume` | `s3`) + driver settings
- **Operator signers (worker-only)** — `FAUCET_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY`, `PAYMASTER_SIGNER_PRIVATE_KEY`
- **Seed admin** — `ADMIN_USERNAME`, `ADMIN_PASSWORD`
- **Limits** — `BOMBARD_MAX_TPS`, `BOMBARD_MAX_TOTAL`, faucet caps

> Prisma 7 does **not** auto-load `.env` — it is loaded via `dotenv` in `prisma.config.ts` and at app bootstrap. `.env` is gitignored; `.env.example` is committed with no secrets.

---

## Quality gates

All must pass before commit / PR (also enforced in CI):

```bash
pnpm typecheck                  # tsc --noEmit across the workspace
pnpm lint                       # eslint .  (NOT `next lint` — removed in Next 16)
pnpm test                       # vitest (unit + integration)
pnpm test:e2e                   # playwright
pnpm --filter contracts test    # forge test
pnpm audit --audit-level=high
```

---

## Deployment

Deployed on **Railway** as two services from this repo — **web** (Next.js) and **worker** (BullMQ consumers) — plus managed Postgres, Redis, and a Volume. Migrations run forward-only on release (`pnpm prisma migrate deploy`); the seed runs once post-first-migrate; health checks hit `/api/health`. See [`SPEC.md §14`](./SPEC.md) and [`AGENT.md §9`](./AGENT.md).

---

## Documentation

| File | Purpose |
|---|---|
| [`SPEC.md`](./SPEC.md) | The **what** — architecture, data model, contracts, pages, API, workers, config, deployment. |
| [`BRAND.md`](./BRAND.md) | The **look** — design tokens, typography, components, and motion (dark "cockpit" theme). |
| [`AGENT.md`](./AGENT.md) | The **how** — engineering conventions, security rules, and the definition of done. |

Work is tracked as sprint milestones and epic issues on [GitHub Issues](https://github.com/kimerran/evm-nexus/issues).
