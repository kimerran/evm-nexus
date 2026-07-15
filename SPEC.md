# SPEC.md — EVM Nexus

**A web application + smart-contract toolkit for exercising and stress-testing a new EVM chain.**

This document is the buildable specification for a code-expert AI. It defines the architecture,
data model, smart contracts, every page and API endpoint, background workers, third-party services,
configuration, security model, and deployment. Pair it with `BRAND.md` (design) and `AGENT.md`
(engineering conventions).

---

## 1. Overview

EVM Nexus is an operator console for a **new / test EVM chain**. It lets an authenticated user:

1. **Faucet** — drip the native gas token (e.g. ETH) to any address, rate-limited.
2. **Create & manage keypairs offline** — generate EOA keypairs in the browser; private keys are encrypted client-side and never sent to or stored in plaintext on the server.
3. **Launch tokens** — deploy **ERC-20**, **ERC-721**, and **ERC-1155** contracts with configurable features.
4. **Transfer the native gas token** (e.g. ETH).
5. **Transfer assets** — send ERC-20 / ERC-721 / ERC-1155 tokens.
6. **Bombard transactions** — fire transactions in succession at a configurable rate (TPS) with a total target count, for throughput/stress testing.
7. **On-chain chat** — post messages whose `keccak256` hash is committed on-chain for tamper-evidence.
8. **Smart wallets / sponsored transactions** — deploy ERC-4337 smart accounts and submit gas-sponsored transactions via a paymaster/relayer.

**Configuration** is per-network and admin-managed: **RPC URL**, **faucet settings**, **block-explorer base URL** (plus chain ID, native symbol).

### 1.1 Non-goals / assumptions
- Targets EVM **test networks** the operator controls; the faucet and relayer hold funded keys for a low-value test chain. Not intended to custody mainnet value.
- Single-tenant operator tool with seeded admin auth (basic username/password only). Multi-tenant SaaS, KYC, and fiat on-ramps are out of scope.
- The server is a **broadcast relay + telemetry recorder**, not a custodial wallet. See §4.

---

## 2. Architecture

```
                         ┌─────────────────────────────────────────────┐
                         │                Browser (Next.js RSC + client)│
                         │  • Keypair vault (Web Crypto, in-memory)      │
                         │  • Client-side tx signing (viem)              │
                         │  • Dashboard / Faucet / Launchpad / Tx Lab    │
                         └───────────────┬───────────────┬──────────────┘
                                         │ HTTPS          │ (optional direct RPC read)
                                         ▼                │
         ┌───────────────────────────────────────────────┼──────────────┐
         │            Next.js server (App Router)         │              │
         │  Route Handlers / Server Actions               │              │
         │  • Auth (session, argon2id, jose)              │              │
         │  • Faucet API → queue                          │              │
         │  • Broadcast relay (raw signed tx → RPC)       │              │
         │  • Deployment orchestration + telemetry        │              │
         │  • Chat: store off-chain + commit hash on-chain│              │
         │  • ERC-4337 bundler/paymaster relay            │              │
         └───┬───────────────┬───────────────┬───────────┴──────┬───────┘
             │               │               │                  │
             ▼               ▼               ▼                  ▼
     ┌────────────┐   ┌────────────┐   ┌────────────┐    ┌──────────────┐
     │ PostgreSQL │   │   Redis    │   │  File store │   │ EVM RPC node │
     │ (Prisma 7) │   │ BullMQ +   │   │ (Railway    │   │ (target chain│
     │  Railway   │   │ rate-limit │   │  Volume/S3) │   │  under test) │
     └────────────┘   └─────┬──────┘   └────────────┘    └──────────────┘
                            │
                    ┌───────▼────────────────────────────┐
                    │ Background workers (Node, BullMQ)   │
                    │ • faucet-drip  • bombard-runner     │
                    │ • chat-hash-committer • deploy-watch │
                    │ • userop-bundler/paymaster          │
                    └─────────────────────────────────────┘
```

- **Frontend + backend**: one Next.js 16 app (App Router, RSC, Route Handlers, Server Actions). Deployed on Railway.
- **Workers**: a separate Node process (same repo) running BullMQ consumers for long-running / rate-sensitive jobs (faucet drips, bombardment, on-chain hash commits, deployment receipt polling, ERC-4337 bundling). Deployed as a second Railway service sharing the DB and Redis.
- **Chain access**: `viem` clients (public + wallet) built from the active `Network` config. Reads may go directly from the browser to the RPC; writes that require server keys (faucet, relayer, paymaster) go through the server.

---

## 3. Tech Stack (pinned to latest stable as of 2026-07)

> Use the latest stable within each line at build time; the versions below are the current floor.
> Verify with `pnpm outdated` / `npm show <pkg> version` before locking.

| Layer | Choice | Version (min) | Notes |
|---|---|---|---|
| Runtime | **Node.js** | 24 LTS (≥ 24.18) | Node 20+ required by Next 16; 24 is Active LTS. |
| Package manager | **pnpm** | 10.x | Workspace + strict deps. |
| Framework | **Next.js** | 16.2.x | App Router, RSC, Turbopack default, `proxy.ts` (renamed from `middleware.ts`), async `params`/`cookies`/`headers`. |
| UI runtime | **React / React DOM** | 19.2.x | — |
| Language | **TypeScript** | 5.7+ | `strict: true`. |
| Styling | **Tailwind CSS** | 4.3.x | CSS-first `@theme` (no `tailwind.config.js`); `@tailwindcss/postcss`. See `BRAND.md`. |
| ORM | **Prisma** | 7.4.x | `prisma-client` generator w/ output path, `prisma.config.ts`, driver adapter `@prisma/adapter-pg`. Prisma 7 does **not** auto-load `.env` — load via `dotenv`/`@dotenvx/dotenvx`. |
| DB | **PostgreSQL** | 16/17 | Railway Postgres in prod; Postgres in Docker for dev. |
| DB driver | **pg** + `@prisma/adapter-pg` | latest | — |
| Cache/queue | **Redis** + **ioredis** + **BullMQ** | latest | Rate limiting, job queues. Railway Redis in prod. |
| EVM SDK | **viem** | 2.55.x | Clients, signing, ABI encode/decode, contract deploy. |
| React web3 (optional) | **wagmi** | 2.x | Only if a browser-wallet connect flow is added; core flows use in-app keypairs. |
| Account abstraction | **permissionless** (or viem `eip5792`/`account-abstraction` actions) + OZ AA | latest | ERC-4337 UserOps, bundler/paymaster client. |
| Contracts | **Solidity** | 0.8.28+ | — |
| Contract libs | **OpenZeppelin Contracts** | 5.x | ERC20/721/1155, AccessControl, ERC-4337 account/paymaster utils. |
| Contract toolchain | **Foundry** (forge) | latest | Compile/test/generate ABIs + bytecode artifacts committed to `packages/contracts`. (Hardhat 3 acceptable alternative.) |
| Auth | custom session: **argon2** (`@node-rs/argon2`) + **jose** | latest | Signed httpOnly cookie sessions. Auth.js v5 Credentials is an acceptable alternative. |
| Validation | **zod** | 4.x | All input boundaries. |
| Logging | **pino** + `pino-http` | latest | Structured JSON logs; redact secrets. |
| File storage SDK | **@aws-sdk/client-s3** | v3 | S3/MinIO driver; plus an fs/volume driver for Railway Volumes. |
| Testing | **Vitest** + **Playwright** + **forge test** | latest | Unit/integration/e2e/contract. |
| Lint/format | **ESLint 9** (flat) + **Prettier** (or **Biome**) | latest | `next lint` was removed in Next 16 — run ESLint directly. |

---

## 4. Security & Key-Management Model (read before implementing)

This is the load-bearing design constraint. Get it wrong and the app is unsafe.

### 4.1 User keypairs are non-custodial and "offline"
- Keypairs are **generated in the browser** with `viem` (`generatePrivateKey()` → `privateKeyToAccount()`).
- The private key is **encrypted client-side** before it ever touches storage or network:
  - Derive a symmetric key from a user-supplied passphrase using **Argon2id** (WASM in-browser) or PBKDF2-SHA-512 (≥ 600k iters) as a fallback, per-key random salt.
  - Encrypt the private key with **AES-256-GCM** (Web Crypto `crypto.subtle`), random IV.
  - Output an encrypted keystore blob (Web3 Secret Storage / JSON-keystore-compatible shape).
- The server **never receives, stores, or logs a plaintext private key**. It may optionally persist the **opaque encrypted keystore blob** (which it cannot decrypt) so the user can re-import across devices, plus the derived **public address** and a label.
- Default posture ("manage offline"): keys live only in an **in-memory vault** (React state / a Web Worker) that is cleared on refresh/close; export/import via downloaded encrypted keystore JSON. Server-side persistence of the encrypted blob is opt-in per keypair.
- Signing happens **client-side**. The browser produces a **raw signed transaction** (`account.signTransaction` / `walletClient.sendRawTransaction` path) and the server only **broadcasts** the already-signed payload. The server cannot move user funds.

### 4.2 Server-custodied keys (faucet, relayer, paymaster)
- The faucet key, the ERC-4337 bundler/relayer key, and the paymaster signer key are **operator secrets** for a low-value test chain.
- Stored only in Railway secret env vars (or a KMS if available) — never in the DB, never in the repo, never in logs.
- Loaded once at worker boot; used exclusively inside workers, never exposed to the browser.
- Each has strict per-request/per-address rate limits and a max-spend budget.

### 4.3 Cross-cutting security requirements
- All input validated with **zod** at every route handler / server action boundary; reject unknown fields.
- **Auth**: argon2id password hashing; sessions are signed (JWS via `jose`) httpOnly, `Secure`, `SameSite=Strict` cookies; short TTL + rotation. Login is rate-limited and returns generic errors (no user enumeration).
- **CSRF**: double-submit token for all state-changing non-GET route handlers and server actions (or rely on `SameSite=Strict` + origin check; implement both).
- **RBAC**: `ADMIN` can manage networks, users, and global settings; `USER` can use features. Guard every mutation with a session + role check server-side (never trust the client).
- **Rate limiting**: Redis-backed sliding-window limits on faucet, bombard, deploy, chat, and login. Per-user, per-IP, and per-address where relevant.
- **RPC safety**: only broadcast transactions to the **admin-approved active network**. Validate `chainId` on signed txs matches the active network before broadcast. Cap `gasLimit`, `value`, and `maxFeePerGas` server-side.
- **Secrets**: never send private keys, faucet keys, or session secrets to the client or logs. `pino` redaction on `authorization`, `cookie`, `privateKey`, `mnemonic`, `keystore`, `password`.
- **Headers**: strict CSP (no inline scripts except hashed), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY` via `proxy.ts` + `next.config` headers.
- **Uploads** (chat attachments): validate MIME + magic bytes + size cap; store outside webroot in the file service; serve via signed, time-limited URLs; never execute.
- **Dependencies**: use latest patched versions; run `pnpm audit` / Dependabot; Next 16 users must stay current on security patches (2026 advisories affected middleware/proxy, RSC, image opt).
- **Bombard abuse guard**: hard ceilings on TPS and total count, per-user concurrency limit of 1 active run, kill-switch, and target-address allow-listing for relayer mode.

---

## 5. Data Model (Prisma 7)

`prisma/schema.prisma` (generator uses the new `prisma-client` provider with an output path; datasource via `prisma.config.ts`). Models:

```prisma
// ---------- Auth & tenancy ----------
model User {
  id            String    @id @default(cuid())
  username      String    @unique
  passwordHash  String                       // argon2id
  role          Role      @default(USER)
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  sessions      Session[]
  keypairs      Keypair[]
  deployments   Deployment[]
  transfers     Transfer[]
  bombardRuns   BombardRun[]
  chatMessages  ChatMessage[]
  faucetRequests FaucetRequest[]
  auditLogs     AuditLog[]
}

enum Role { ADMIN USER }

model Session {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  // store only a hash of the session token; the signed JWS lives in the cookie
  tokenHash    String   @unique
  userAgent    String?
  ip           String?
  expiresAt    DateTime
  createdAt    DateTime @default(now())
  revokedAt    DateTime?
  @@index([userId])
}

// ---------- Network configuration ----------
model Network {
  id               String   @id @default(cuid())
  name             String                       // "Mainnet-Alpha"
  chainId          Int
  rpcUrl           String                       // encrypted at rest if it carries a key
  wsUrl            String?
  explorerBaseUrl  String?                       // "https://etherscan.io/"
  nativeSymbol     String   @default("ETH")
  nativeDecimals   Int      @default(18)
  isDefault        Boolean  @default(false)
  isArchival       Boolean  @default(false)
  faucetEnabled    Boolean  @default(true)
  faucetDripAmount String   @default("5000000000000000000") // wei, string to avoid bigint loss
  faucetDailyCap   String   @default("500000000000000000000")
  faucetCooldownSec Int     @default(86400)
  // server-custodied signer refs (ids into a secret store; NOT the keys themselves)
  faucetSignerRef  String?
  relayerSignerRef String?
  paymasterAddress String?
  entryPointAddress String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  deployments      Deployment[]
  transfers        Transfer[]
  bombardRuns      BombardRun[]
  chatMessages     ChatMessage[]
  faucetRequests   FaucetRequest[]
  @@unique([chainId, name])
}

// ---------- Keypairs (non-custodial) ----------
model Keypair {
  id             String   @id @default(cuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  label          String                       // "Dev_Node_01"
  address        String                       // public 0x address ONLY
  // OPTIONAL, OPT-IN: opaque client-encrypted keystore the server cannot read.
  encryptedKeystore Json?                      // Web3 Secret Storage JSON (AES-GCM ciphertext)
  isEphemeral    Boolean  @default(true)       // true = never persisted server-side
  createdAt      DateTime @default(now())
  @@unique([userId, address])
  @@index([userId])
}

// ---------- Deployments ----------
model Deployment {
  id             String        @id @default(cuid())
  userId         String
  user           User          @relation(fields: [userId], references: [id])
  networkId      String
  network        Network       @relation(fields: [networkId], references: [id])
  standard       TokenStandard
  name           String
  symbol         String?
  features       Json          // { mintable, burnable, pausable, permit }
  initialSupply  String?       // wei/string for ERC20
  baseUri        String?       // ERC721/1155
  txHash         String?
  contractAddress String?
  blockNumber    BigInt?
  gasUsed        String?
  status         TxStatus      @default(PENDING)
  errorMessage   String?
  createdAt      DateTime      @default(now())
  @@index([userId]) @@index([networkId]) @@index([status])
}

enum TokenStandard { ERC20 ERC721 ERC1155 }

// ---------- Transfers (native + assets) ----------
model Transfer {
  id           String     @id @default(cuid())
  userId       String
  user         User       @relation(fields: [userId], references: [id])
  networkId    String
  network      Network    @relation(fields: [networkId], references: [id])
  kind         TransferKind
  fromAddress  String
  toAddress    String
  tokenAddress String?                          // null for native
  tokenId      String?                          // ERC721/1155
  amount       String?                          // wei / token units (string)
  sponsored    Boolean    @default(false)       // smart-wallet paymaster used
  txHash       String?
  status       TxStatus   @default(PENDING)
  errorMessage String?
  createdAt    DateTime   @default(now())
  @@index([userId]) @@index([networkId]) @@index([status])
}

enum TransferKind { NATIVE ERC20 ERC721 ERC1155 }

// ---------- Bombard (throughput stress test) ----------
model BombardRun {
  id            String      @id @default(cuid())
  userId        String
  user          User        @relation(fields: [userId], references: [id])
  networkId     String
  network       Network     @relation(fields: [networkId], references: [id])
  mode          BombardMode @default(CLIENT_SIGNED)
  targetTps     Int
  totalCount    Int
  sentCount     Int         @default(0)
  successCount  Int         @default(0)
  failCount     Int         @default(0)
  status        RunStatus   @default(QUEUED)
  fromAddress   String?
  toAddress     String?
  startedAt     DateTime?
  finishedAt    DateTime?
  createdAt     DateTime    @default(now())
  events        BombardEvent[]
  @@index([userId]) @@index([status])
}

enum BombardMode { CLIENT_SIGNED RELAYER }
enum RunStatus { QUEUED RUNNING PAUSED COMPLETED FAILED CANCELLED }

model BombardEvent {
  id          String     @id @default(cuid())
  runId       String
  run         BombardRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  txHash      String?
  nonce       Int?
  status      TxStatus
  latencyMs   Int?
  createdAt   DateTime   @default(now())
  @@index([runId])
}

// ---------- On-chain chat ----------
model ChatMessage {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id])
  networkId     String
  network       Network  @relation(fields: [networkId], references: [id])
  body          String                          // off-chain plaintext
  contentHash   String                          // 0x keccak256(body[+attachment])
  attachmentKey String?                         // file-store object key
  senderAddress String
  txHash        String?                         // hash commit tx
  status        TxStatus @default(PENDING)
  createdAt     DateTime @default(now())
  @@index([networkId]) @@index([userId])
}

// ---------- Faucet ----------
model FaucetRequest {
  id           String     @id @default(cuid())
  userId       String?
  user         User?      @relation(fields: [userId], references: [id])
  networkId    String
  network      Network    @relation(fields: [networkId], references: [id])
  toAddress    String
  amount       String                            // wei
  ip           String?
  txHash       String?
  status       TxStatus   @default(PENDING)
  createdAt    DateTime   @default(now())
  @@index([toAddress]) @@index([networkId]) @@index([createdAt])
}

// ---------- Smart wallets ----------
model SmartAccount {
  id             String   @id @default(cuid())
  userId         String
  ownerAddress   String                          // EOA that controls the account
  accountAddress String                          // deployed 4337 account
  networkId      String
  factory        String?
  isDeployed     Boolean  @default(false)
  createdAt      DateTime @default(now())
  @@unique([networkId, accountAddress])
  @@index([userId])
}

// ---------- Shared status + audit ----------
enum TxStatus { PENDING BROADCAST CONFIRMING SUCCESS FAILED REJECTED }

model AuditLog {
  id         String   @id @default(cuid())
  userId     String?
  user       User?    @relation(fields: [userId], references: [id])
  action     String                              // "faucet.request", "deploy.erc20", ...
  targetType String?
  targetId   String?
  metadata   Json?                               // NEVER secrets
  ip         String?
  createdAt  DateTime @default(now())
  @@index([userId]) @@index([action]) @@index([createdAt])
}

model AppSetting {
  key       String   @id
  value     Json
  updatedAt DateTime @updatedAt
}
```

**Notes**
- Amounts/balances are stored as **strings** (wei) to avoid float/bigint precision loss.
- `Keypair.encryptedKeystore` is opaque to the server; if `isEphemeral`, it is never written.
- `Network.rpcUrl` and any signer refs must be **encrypted at rest** if they embed credentials (use `pgcrypto` or app-layer AES with a KMS/env master key).

---

## 6. Smart Contracts (`packages/contracts`, Foundry + OpenZeppelin 5)

Compiled artifacts (ABI + bytecode) are committed and imported by the app for deployment via `viem` `deployContract`. Contracts are minimal, audited-pattern wrappers around OZ.

| Contract | Purpose | Basis |
|---|---|---|
| `NexusERC20` | Configurable fungible token | OZ `ERC20`, opt-in `ERC20Burnable`, `ERC20Pausable`, `ERC20Permit`, `AccessControl` (mint role if `mintable`). Constructor: `(name, symbol, initialSupply, owner, flags)`. |
| `NexusERC721` | Configurable NFT collection | OZ `ERC721`, `ERC721URIStorage`/base-URI, opt-in `ERC721Burnable`, `ERC721Pausable`, `AccessControl`. Constructor: `(name, symbol, baseURI, owner, flags)`. |
| `NexusERC1155` | Multi-token | OZ `ERC1155`, opt-in `ERC1155Burnable`, `ERC1155Pausable`, `ERC1155Supply`, `AccessControl`. Constructor: `(baseURI, owner, flags)`. |
| `ChatLog` | Commit message hashes on-chain | Emits `event MessageCommitted(address indexed sender, bytes32 indexed contentHash, uint256 timestamp, string ref)`. Function `commit(bytes32 contentHash, string calldata ref)`. Stateless log; cheap. Deployed once per network, address stored in `AppSetting`/`Network`. |
| `NexusFaucet` (optional) | On-chain faucet with cooldown | Holds native balance; `drip(address to)` with per-address cooldown + max amount; `AccessControl` for operator top-ups. Off-chain faucet worker is the default; this contract is an alternative. |
| ERC-4337 stack | Smart wallets + sponsorship | Reuse canonical **EntryPoint** (v0.7/0.8) already deployed on the chain if present; deploy **SimpleAccountFactory** and a **VerifyingPaymaster** (OZ/eth-infinitism reference). Paymaster validates an operator signature over the UserOp to sponsor gas. |

Deployment strategy: prefer **client-signed deploys** (user's in-app keypair signs the deploy tx; server broadcasts + records). For factory patterns (4337 accounts) a factory `createAccount(owner, salt)` is called. Feature flags select which OZ mixins are compiled in (use predeployed variants or a factory that picks a template to avoid per-request compilation).

> Deployment must **not** compile Solidity at request time. Ship a fixed set of precompiled template artifacts (one per feature combination, or a modular factory) and deploy bytecode with constructor args encoded by `viem`.

---

## 7. Pages / Routes (Next.js App Router)

All app pages sit under an authenticated shell (`app/(app)/…`) using the `BRAND.md` TopNav + SideNav layout. Auth pages are public.

| Route | Type | Auth | Purpose |
|---|---|---|---|
| `/login` | page | public | Username/password login (seeded admin). |
| `/` → `/dashboard` | page (RSC) | user | **Dashboard**: network health (gas price, block time, TPS, peer count, uptime, storage), active accounts summary, connect-provider card. Live telemetry via polling/WS. |
| `/faucet` | page | user | **Faucet + Keypair Manager**: destination address, amount slider (capped), request button; keypair table (generate, export, delete, copy), event log. |
| `/keypairs` | page | user | Full keypair vault: generate, import/export encrypted keystore, label, view address, ephemeral vs persisted toggle. (May be merged into `/faucet` per mock.) |
| `/launchpad` | page | user | **Asset Launchpad**: tabs ERC-20 / ERC-721 / ERC-1155; name/symbol/supply or base-URI; feature checkboxes (mintable/burnable/pausable/permit); estimated gas + congestion; deployment progress terminal; recent deployments table. |
| `/lab` | page | user | **Transaction Lab**: Bombard panel (TPS slider, total count, estimated gas, queue status, initiate/kill); Transfer Assets (native + token) with sponsored-tx toggle; On-chain Chat panel; live transaction feed. |
| `/chat` | page | user | Full **On-chain Chat** view (if separated from Lab): message list with hash + verify link, composer, attachment upload. |
| `/transfers` | page | user | Transfer history + new transfer (native/ERC20/721/1155), sponsored toggle. |
| `/smart-wallets` | page | user | Create/deploy ERC-4337 accounts; send sponsored UserOps; view accounts. |
| `/settings/networks` | page | **admin** | CRUD networks: RPC URL, chainId, explorer URL, native symbol, faucet params, paymaster/entrypoint addresses, set default, archival toggle, custom gas profile. |
| `/settings/users` | page | **admin** | Manage users (activate/deactivate, reset password, role). |
| `/settings/api-keys` | page | user | Issue/revoke personal API keys (for scripting the API). |
| `/settings/profile` | page | user | Change password. |
| `/explorer/tx/[hash]` | page | user | Local tx detail (from DB + RPC), link out to external block explorer. |

**Shell**: `app/(app)/layout.tsx` renders TopNavBar + SideNavBar (Faucet, Asset Launchpad, Transaction Lab, On-chain Chat + Support/API Keys/Network Settings), a network selector (active `Network`), and the ambient background. Admin-only nav items are hidden for `USER`.

---

## 8. API — Route Handlers & Server Actions

Base: `/api`. All mutating endpoints require a valid session cookie **or** a personal API key (`Authorization: Bearer nxs_…`), plus CSRF for cookie-based browser calls. All bodies validated with zod. Responses are JSON `{ data } | { error: { code, message } }`. Amounts are strings (wei).

### 8.1 Auth
| Method | Path | Auth | Body / Query | Returns |
|---|---|---|---|---|
| POST | `/api/auth/login` | public (rate-limited) | `{ username, password }` | Sets session cookie; `{ user }`. Generic error on failure. |
| POST | `/api/auth/logout` | user | — | Revokes session. |
| GET | `/api/auth/session` | user | — | `{ user }` or 401. |
| POST | `/api/auth/change-password` | user | `{ currentPassword, newPassword }` | 204. Revokes other sessions. |

### 8.2 Networks (config: RPC / faucet / explorer)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/networks` | user | List networks (secrets redacted). |
| GET | `/api/networks/:id` | user | Get one. |
| POST | `/api/networks` | admin | Create `{ name, chainId, rpcUrl, wsUrl?, explorerBaseUrl?, nativeSymbol?, faucet…, paymasterAddress?, entryPointAddress? }`. |
| PATCH | `/api/networks/:id` | admin | Update fields. |
| DELETE | `/api/networks/:id` | admin | Delete (block if referenced or soft-delete). |
| POST | `/api/networks/:id/default` | admin | Set active/default network. |
| GET | `/api/networks/:id/health` | user | Live metrics: `chainId`, latest block, gas price, block time, peer count (via RPC `eth_*`, `net_peerCount`, `txpool_*` where supported). Backs the dashboard. |

### 8.3 Keypairs (non-custodial)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/keypairs` | user | List **persisted** keypairs (address + label + encrypted blob only). |
| POST | `/api/keypairs` | user | Persist an **opt-in** keypair: `{ label, address, encryptedKeystore }`. Server rejects any payload containing a plaintext private key field. |
| DELETE | `/api/keypairs/:id` | user | Remove persisted keypair. |
| POST | `/api/keypairs/validate-address` | user | `{ address }` → checksum/validity. |

> Generation, decryption, and signing are **client-side only**. There is no endpoint that accepts or returns a private key.

### 8.4 Faucet
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/faucet/request` | user (rate-limited per address+IP+user, cooldown) | `{ networkId, toAddress, amount }` (amount ≤ per-request cap). Enqueues a `faucet-drip` job; returns `{ requestId, status: "QUEUED" }`. |
| GET | `/api/faucet/requests` | user | History + statuses. |
| GET | `/api/faucet/quota` | user | Remaining daily/global quota for address/network. |

### 8.5 Deployments (launch tokens)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/deployments/estimate` | user | `{ networkId, standard, name, symbol?, initialSupply?, baseUri?, features }` → `{ estimatedGas, baseFee, congestion, unsignedTx }`. Server returns the **unsigned** deploy tx (bytecode + encoded constructor args) for the client to sign. |
| POST | `/api/deployments/broadcast` | user | `{ networkId, deploymentDraftId, rawSignedTx }` → broadcast; create `Deployment` (PENDING). Worker polls receipt → contractAddress/status. |
| GET | `/api/deployments` | user | List (filter by standard/status/network). |
| GET | `/api/deployments/:id` | user | Detail + live status. |

### 8.6 Transfers (native + assets)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/transfers/prepare` | user | `{ networkId, kind, from, to, tokenAddress?, tokenId?, amount?, sponsored? }` → unsigned tx (or UserOp if `sponsored`). Server validates chainId/limits. |
| POST | `/api/transfers/broadcast` | user | `{ networkId, rawSignedTx }` or `{ userOp, signature }` (sponsored) → broadcast; create `Transfer`. |
| GET | `/api/transfers` | user | History. |
| GET | `/api/transfers/:id` | user | Detail. |
| GET | `/api/assets/:address/balances?owner=0x…` | user | Read token balances/holdings via RPC for the asset-transfer UI. |

### 8.7 Bombard (throughput stress test)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/bombard/prepare` | user | `{ networkId, mode, from, to, targetTps, totalCount }` → validates ceilings; for `CLIENT_SIGNED` returns the nonce range + tx template for the client to pre-sign in bulk. |
| POST | `/api/bombard/start` | user (1 active run/user) | `{ runId, rawSignedTxs[] }` (client-signed) **or** `{ runId }` (relayer) → enqueues `bombard-runner`; streams at `targetTps`. |
| POST | `/api/bombard/:id/pause` \| `/resume` \| `/cancel` | user | Control the run (kill-switch). |
| GET | `/api/bombard/:id` | user | Run status + counters. |
| GET | `/api/bombard/:id/events` | user | Paginated per-tx events (or via SSE, §8.10). |

### 8.8 On-chain chat
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/chat?networkId=…` | user | Message list (body + contentHash + txHash + status). |
| POST | `/api/chat` | user (rate-limited) | `{ networkId, body, attachmentKey?, senderAddress }` → compute `keccak256`, store off-chain, return `{ messageId, contentHash, unsignedCommitTx }` for client to sign; **or** relayer mode commits via server key. |
| POST | `/api/chat/:id/commit` | user | `{ rawSignedTx }` → broadcast the `ChatLog.commit` tx; worker confirms. |
| GET | `/api/chat/:id/verify` | user | Recompute hash from stored body/attachment and compare with on-chain event → `{ verified: boolean, onchainHash, txHash }`. |

### 8.9 Smart wallets (sponsored)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/smart-accounts` | user | List user smart accounts. |
| POST | `/api/smart-accounts/predict` | user | `{ networkId, ownerAddress, salt? }` → counterfactual address. |
| POST | `/api/smart-accounts/deploy` | user | Deploy via factory (client-signed or sponsored). |
| POST | `/api/userops/sponsor` | user (rate-limited, budget-capped) | `{ networkId, userOp }` → paymaster signs `paymasterAndData` (server key); returns sponsored UserOp for client to sign. |
| POST | `/api/userops/send` | user | `{ networkId, signedUserOp }` → submit to bundler/EntryPoint; record `Transfer.sponsored=true`. |

### 8.10 Files & realtime
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/files/presign` | user | `{ filename, contentType, size }` → presigned upload URL (S3/MinIO) or a direct-upload token (volume driver). Validates type/size. |
| GET | `/api/files/:key` | user | Signed, time-limited download URL. |
| GET | `/api/stream/telemetry` | user | **SSE**/WebSocket: live network health, live tx feed, bombard progress, faucet events. |

### 8.11 API keys, audit, health
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET/POST/DELETE | `/api/api-keys` | user | Issue/list/revoke personal API keys (store only a hash). |
| GET | `/api/audit` | admin | Audit log (paginated). |
| GET | `/api/health` | public | Liveness/readiness (DB, Redis, RPC reachability). |

---

## 9. Background Workers (BullMQ)

Separate Node process, shares DB + Redis. Queues:

| Queue | Trigger | Job | Guarantees |
|---|---|---|---|
| `faucet-drip` | faucet request | Sign with faucet key, broadcast, poll receipt, update `FaucetRequest`. | Per-address cooldown + daily cap enforced atomically (Redis lock + DB check). Idempotent by requestId. |
| `bombard-runner` | bombard start | Emit txs at `targetTps` (token-bucket pacing), track nonces, record `BombardEvent`, update counters. | Concurrency 1 per user; cancellable; backpressure on RPC 429/timeout; resumes from last nonce. |
| `deploy-watch` | deployment broadcast | Poll receipt → contractAddress, gasUsed, status. | Retry w/ backoff; timeout → FAILED. |
| `tx-watch` | transfer/chat commit broadcast | Poll receipt, update status. | Same. |
| `chat-commit` (relayer mode) | chat commit | Call `ChatLog.commit` with server key. | Budget-capped. |
| `userop-bundler` | userop send | Submit UserOp to EntryPoint/bundler, poll. | Paymaster budget-capped. |

Pacing for bombard uses a **token bucket** sized to `targetTps`; nonces are pre-assigned (client-signed mode) or managed by a per-signer nonce manager (relayer mode). RPC errors trigger exponential backoff and reduce effective throughput rather than failing the run.

---

## 10. Third-Party & Infrastructure Services

| Service | Provider | Role | Notes |
|---|---|---|---|
| **PostgreSQL** | **Railway** (prod), Docker (dev) | Primary datastore | Connection via `DATABASE_URL`; Prisma driver adapter `@prisma/adapter-pg`; pooled. |
| **Redis** | **Railway** (prod), Docker (dev) | BullMQ queues + rate limiting + telemetry cache | `REDIS_URL`. |
| **File storage** | **Railway Volume** (prod) or S3/MinIO | Chat attachments, exported artifacts, encrypted keystore backups | `StorageService` abstraction: `volume` driver (fs on mounted Railway Volume) for prod, `s3`/MinIO driver for dev + portability. |
| **EVM RPC node** | The chain under test | Reads + broadcast | Per-`Network.rpcUrl`; support HTTP + WS. `viem` `http()`/`webSocket()`. |
| **Block explorer** | Per-network (`explorerBaseUrl`) | Outbound tx/address links + optional verify | Configurable; used for "View in Explorer" links. |
| **Bundler** (optional) | Self-hosted or provider | ERC-4337 UserOp submission | If the chain lacks a public bundler, the worker submits directly to `EntryPoint`. |
| **Deployment/CI** | **Railway** | Host web + worker services | Build with pnpm + Nixpacks/Dockerfile; run migrations on deploy. |

No external analytics/marketing SDKs. No third-party wallet key custody.

---

## 11. Configuration & Environment

### 11.1 Runtime configuration model
- **Per-network** settings (RPC URL, faucet params, explorer URL, chainId, native symbol, paymaster/entrypoint) live in the `Network` table, editable by admins at `/settings/networks`. One network is `isDefault` / active.
- **Global** settings (feature flags, ceilings) live in `AppSetting`.
- **Secrets** (session secret, faucet/relayer/paymaster keys, DB/Redis creds, storage creds) live only in environment variables / Railway secrets.

### 11.2 Environment variables
```dotenv
# --- Core ---
NODE_ENV=production
APP_URL=https://evm-nexus.up.railway.app
SESSION_SECRET=            # 32+ byte random; JWS signing
ENCRYPTION_KEY=            # 32-byte base64; app-layer AES for at-rest network secrets
CSRF_SECRET=

# --- Database (Railway Postgres) ---
DATABASE_URL=postgresql://user:pass@host:5432/evm_nexus?schema=public
DIRECT_DATABASE_URL=       # for migrations if using a pooler

# --- Redis (Railway) ---
REDIS_URL=redis://default:pass@host:6379

# --- File storage ---
STORAGE_DRIVER=volume            # volume | s3
STORAGE_VOLUME_PATH=/data/uploads
# when STORAGE_DRIVER=s3 (dev/MinIO or external)
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=evm-nexus
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=true

# --- Server-custodied signers (test chain only) ---
FAUCET_PRIVATE_KEY=              # operator secret, worker-only
RELAYER_PRIVATE_KEY=
PAYMASTER_SIGNER_PRIVATE_KEY=

# --- Seed admin ---
ADMIN_USERNAME=admin
ADMIN_PASSWORD=                  # strong; rotate after first login

# --- Defaults for first network (used by seed) ---
DEFAULT_NETWORK_NAME=Mainnet-Alpha
DEFAULT_CHAIN_ID=1
DEFAULT_RPC_URL=http://localhost:8545
DEFAULT_EXPLORER_URL=
DEFAULT_NATIVE_SYMBOL=ETH

# --- Limits ---
FAUCET_DRIP_WEI=5000000000000000000
FAUCET_DAILY_CAP_WEI=500000000000000000000
BOMBARD_MAX_TPS=1000
BOMBARD_MAX_TOTAL=1000000
```
Provide `.env.example` (committed, no secrets) and `.env` (gitignored). Prisma 7 does not auto-load `.env`; load it in `prisma.config.ts` and app bootstrap via `dotenv`/`@dotenvx/dotenvx`.

---

## 12. Authentication & Authorization

- **Basic username/password only.** No OAuth, no email flows. Seeded admin (§16).
- Passwords hashed with **Argon2id** (`@node-rs/argon2`, sane memory/time cost).
- Session = signed **JWS** (`jose`) in an httpOnly, `Secure`, `SameSite=Strict` cookie; server stores only a **hash** of the token in `Session` for revocation. Short TTL with sliding refresh; rotate on privilege change / password change.
- Login rate-limited (per IP + username) with generic errors; optional lockout/backoff after repeated failures.
- **Authorization** enforced server-side on every action: `getSession()` → require role. `ADMIN` for network/user settings; `USER` for feature endpoints. Never rely on hidden UI for access control.
- Optional personal **API keys** (`nxs_…`, stored hashed) for scripting; scoped to the issuing user's role.
- `proxy.ts` (Next 16) guards authenticated route groups and applies security headers; but treat proxy/middleware as defense-in-depth, not the sole auth gate (2026 Next.js advisories showed proxy bypass risks — always re-check auth in the handler/action).

---

## 13. Security Requirements (consolidated checklist)

- [ ] No endpoint accepts, returns, stores, or logs a plaintext private key or mnemonic (except operator signer envs, worker-only).
- [ ] All inputs zod-validated; reject unknown fields; normalize/checksum addresses.
- [ ] CSRF protection on all cookie-authenticated mutations; origin check.
- [ ] Redis rate limits on login, faucet, deploy, transfer, bombard, chat, userops.
- [ ] Server enforces `chainId` match + gas/value ceilings before any broadcast.
- [ ] argon2id hashing; signed httpOnly SameSite=Strict sessions; revocation table.
- [ ] Strict CSP + HSTS + security headers; no dangerouslySetInnerHTML with unsanitized data.
- [ ] File uploads: MIME + magic-byte + size validation; signed URLs; no execution.
- [ ] Secrets only in env/secret store; `pino` redaction of sensitive fields.
- [ ] RBAC re-checked in every server action/route handler.
- [ ] Bombard/faucet/paymaster budget caps + kill-switches; per-user concurrency limits.
- [ ] Dependencies on latest patched versions; `pnpm audit` in CI; Dependabot on.
- [ ] Audit-log every privileged/on-chain action (no secrets in metadata).
- [ ] `at-rest` encryption for network RPC secrets and persisted keystore blobs.

---

## 14. Deployment (Railway)

Two Railway services from one repo/monorepo, plus managed Postgres and Redis, plus a Volume:

1. **web** — Next.js app. Build: `pnpm install --frozen-lockfile && pnpm prisma generate && pnpm build`. Start: `pnpm start`. Attach `DATABASE_URL`, `REDIS_URL`, storage + secrets. Run migrations on release: `pnpm prisma migrate deploy`.
2. **worker** — BullMQ consumers. Start: `pnpm worker` (`tsx worker/index.ts`). Shares DB/Redis; holds faucet/relayer/paymaster keys.
3. **Postgres** — Railway plugin → `DATABASE_URL`.
4. **Redis** — Railway plugin → `REDIS_URL`.
5. **Volume** — mounted at `STORAGE_VOLUME_PATH` on web (and worker if needed) for `volume` storage driver.

Provide `railway.json`/`railway.toml` (or Nixpacks config / Dockerfile per service). Seed runs once after first migrate: `pnpm prisma db seed`. Health checks hit `/api/health`. Set `APP_URL`, cookie domain, and CSP `APP_URL` origin accordingly. Enable auto-deploy from the main branch with required CI (typecheck, lint, unit, contract tests) passing.

---

## 15. Local Development

`docker-compose.yml` provides the backing services so only the Next app + worker run on the host:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: nexus
      POSTGRES_PASSWORD: nexus
      POSTGRES_DB: evm_nexus
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: nexus
      MINIO_ROOT_PASSWORD: nexus-secret
    ports: ["9000:9000", "9001:9001"]
    volumes: ["miniodata:/data"]
  # Optional local EVM chain for testing (anvil):
  anvil:
    image: ghcr.io/foundry-rs/foundry:latest
    command: ["anvil --host 0.0.0.0 --chain-id 31337"]
    ports: ["8545:8545"]
volumes: { pgdata: {}, miniodata: {} }
```

Dev flow:
```bash
pnpm install
docker compose up -d
cp .env.example .env         # fill secrets; STORAGE_DRIVER=s3, S3_ENDPOINT=http://localhost:9000
pnpm prisma migrate dev
pnpm prisma db seed          # creates admin + default network (points at anvil :8545)
pnpm dev                     # Next.js (Turbopack)
pnpm worker                  # BullMQ consumers (separate terminal)
# contracts:
pnpm --filter contracts build   # forge build → ABIs/bytecode consumed by the app
```

Provide `.env.example` (dev defaults, no real secrets) and document that `.env` is gitignored.

---

## 16. Seed Script (`prisma/seed.ts`)

Idempotent. Must:
1. Create the **admin** user from `ADMIN_USERNAME` / `ADMIN_PASSWORD` (argon2id hash), `role=ADMIN`, `isActive=true`. Upsert by username. **Never** hardcode the password; require it from env or generate + print once.
2. Create the default **Network** (`DEFAULT_*` env), `isDefault=true`.
3. Seed baseline `AppSetting` ceilings (`BOMBARD_MAX_TPS`, `BOMBARD_MAX_TOTAL`, faucet caps).
4. Optionally deploy/record the `ChatLog` address if a dev chain is reachable (skip on failure).
Run via `prisma.seed` config (`tsx prisma/seed.ts`) locally and once post-migrate in prod.

---

## 17. Feature → Implementation Map (acceptance)

| Feature | Pages | Endpoints | Contracts/Workers | Done when |
|---|---|---|---|---|
| Faucet | `/faucet` | `/api/faucet/*` | `faucet-drip` (+ optional `NexusFaucet`) | Rate-limited drip reaches address; tx confirmed; quota decremented; event logged. |
| Create keypair (offline) | `/keypairs`,`/faucet` | `/api/keypairs/*` | none (client crypto) | Keypair generated + encrypted client-side; no plaintext key server-side; export/import works. |
| Launch ERC-20/721/1155 | `/launchpad` | `/api/deployments/*` | `Nexus{ERC20,ERC721,ERC1155}` + `deploy-watch` | Client-signed deploy confirms; contractAddress stored; features honored. |
| Transfer native | `/transfers`,`/lab` | `/api/transfers/*` | `tx-watch` | Native value transfer confirmed. |
| Transfer assets | `/transfers`,`/lab` | `/api/transfers/*`,`/api/assets/*` | `tx-watch` | ERC-20/721/1155 transfer confirmed; balances update. |
| Bombard | `/lab` | `/api/bombard/*` | `bombard-runner` | N txs sent at configured TPS; counters + kill-switch work; ceilings enforced. |
| On-chain chat | `/chat`,`/lab` | `/api/chat/*` | `ChatLog` + `chat-commit` | Message stored off-chain; hash committed on-chain; verify passes. |
| Smart wallets / sponsored | `/smart-wallets`,`/lab` | `/api/smart-accounts/*`,`/api/userops/*` | ERC-4337 factory + paymaster + `userop-bundler` | Smart account deploys; sponsored tx lands with user paying no gas. |
| Config (RPC/faucet/explorer) | `/settings/networks` | `/api/networks/*` | none | Admin CRUD networks; active network drives all reads/writes; explorer links resolve. |
| Auth (admin) | `/login`,`/settings/users` | `/api/auth/*` | seed | Seeded admin logs in; RBAC enforced. |
```
