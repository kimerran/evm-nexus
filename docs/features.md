# Features log

Running log of shipped features. Append one entry per change (newest first),
per the auto-dev workflow.

## 2026-07-16 — Railway deployment config: web + worker services (#19)

Deploy artifacts for the two-service Railway monorepo (SPEC §10/§14, AGENT.md §9)
— no product/runtime code changed beyond enabling Next standalone output.

- **Per-service Dockerfiles** (`Dockerfile.web`, `Dockerfile.worker`) +
  `.dockerignore`. Multi-stage, pinned `node:24.18.0` + pnpm 10.6.4 via corepack:
  install → `prisma generate` → (`next build` for web) → runtime. Build-time env
  is throwaway placeholders; real secrets are injected by Railway at runtime and
  never baked into an image. Both images run as the unprivileged `node` user.
- **`next.config.ts`**: `output: 'standalone'` + `outputFileTracingRoot` (monorepo
  root) so the build emits a self-contained server tree; verified it still builds
  and serves. The shipped web image runs `pnpm start` so the pinned Prisma CLI
  stays available for the release command (the standalone tree is documented as an
  ultra-slim alternative).
- **Railway config-as-code** (`railway.web.json`, `railway.worker.json`): Dockerfile
  builder, `web` health check `/api/health`, and the **release/pre-deploy command**
  `pnpm prisma migrate deploy && pnpm prisma db seed` (forward-only migrations +
  idempotent seed). `worker` starts `pnpm worker` and is the only service holding
  faucet/relayer/paymaster keys (Railway secrets).
- **`DEPLOY.md`**: services, env/secrets matrix (worker-only signer keys), Volume
  mount + `STORAGE_DRIVER=volume`, release/seed flow, health check, `main`-branch
  auto-deploy behind the CI gate, and prod `APP_URL` / host-only `Secure` cookies /
  `'self'`-based CSP origin.
- **Validated locally** against isolated empty Postgres + Redis + anvil: release
  sequence (`migrate deploy` → idempotent seed run twice) → prod `pnpm build` +
  `pnpm start` → `/api/health` 200 healthy → `pnpm worker` boots (7 queues);
  `docker build` of both images, web container serves health green and runs the
  in-image release command, worker container boots online; `volume` presign/put/get
  round-trip; secret scan clean (no secrets in client bundle or repo).

## 2026-07-16 — Full test coverage + Playwright E2E happy-path (#17)

Brought the test suite up to the AGENT.md §8 bar and added the headline
deliverable: a single Playwright E2E that drives the **whole product** through the
real browser vault on anvil, with the app + worker + chain all running.

- **Vitest projects** (`vitest.config.ts`): split into a fast `unit` project
  (`pnpm test`) and an `integration` project (`pnpm test:integration`,
  `*.integration.test.ts`). A shared `vitest.setup.ts` loads `.env` before any
  module evaluates so `getEnv()` never throws on import (fixes a `budget.test.ts`
  crash and unblocks integration specs). CI (throwaway job env) still wins over
  `.env` since dotenv never overrides a set variable.
- **Unit gap** filled: `lib/bombard/draft.test.ts` covers the HMAC-signed bombard
  plan — the nonce-range/"nonce manager" integrity — round-trip, tamper
  (bad-signature), malformed, and expiry. Existing suites already cover zod
  schemas, crypto round-trips, rate limiter, session/JWT, and wei formatting.
- **Integration** (`apps/web/test/integration/*.integration.test.ts`): real route
  handlers + workers against the **live test Postgres + Redis + anvil**, asserting
  BOTH DB state AND on-chain effects — faucet drip (row → SUCCESS + recipient
  balance grows), ERC-20 deploy (row → SUCCESS + bytecode on-chain), native
  transfer (row → SUCCESS + balance), chat commit + verify (on-chain
  `MessageCommitted` hash matches). Each carries one failure-path assertion
  (over-ceiling faucet, wrong-signer deploy/transfer, tampered chat → not
  verified).
- **Playwright E2E** (`e2e/journey.spec.ts` + `e2e/global-setup.ts`): the full
  journey — login → keypair vault (generate + persist, **client-side** crypto) →
  faucet drip → deploy ERC-20 → transfer → bombard (N=5) → chat commit + verify →
  sponsored ERC-4337 tx — all signed in-browser through the actual UI. Global
  setup deploys the 4337 stack + ChatLog, resets per-run feature rows, and spawns
  the worker (torn down after); `webServer` runs `next dev` (dev keeps the session
  cookie non-Secure so login works over http://localhost).
- **CI** (`.github/workflows/ci.yml`): new `integration-e2e` job with Postgres +
  Redis service containers and a local anvil runs migrate/seed → integration →
  Playwright browser install → E2E; the existing fast job keeps
  typecheck/lint/unit/forge/build/audit. Merge is gated on both.

Result: unit 262 · integration 8 · forge 44 · E2E 8/8 legs green.

## 2026-07-15 — Security audit & hardening pass (#18)

A verification pass over the complete merged app (issues #1–#16) confirming every
SPEC §13 requirement is **enforced in code**, not just documented, with a small
set of **targeted fixes** for the real gaps found. Full evidence table (all 15
items → enforced/fixed → `file:line`/test/bundle-inspection) in
`docs/security-review.md`. No feature rewrites — audit + minimal hardening only.

- **Bombard maxFeePerGas ceiling** (`apps/web/lib/bombard/verify.ts`): the
  client-signed batch verifier checked chainId/recipient/value/nonce/gas/signer
  but never the fee, so a bulk-signed batch could ship an arbitrary
  `maxFeePerGas`. Now enforced against the HMAC-pinned, prepare-vetted
  `plan.maxFeePerGasWei` — completing the SPEC §13 "gas/value/maxFee before every
  broadcast" invariant for bombard (regression test `lib/bombard/verify.test.ts`).
- **Upload magic-byte at the write boundary** (`app/api/files/[...key]/route.ts`):
  the volume PUT target persisted bytes after a size check only, deferring the
  magic-byte sniff to serve time. Now runs `validateUploadedBytes` on PUT, so
  forged/mismatched content is rejected (415) before it is ever stored.
- **Audit-log completeness** (SPEC §13): `network.create/update/delete/setDefault`
  were `TODO(#6)` stubs — now write `writeAudit` rows (non-secret metadata, never
  the RPC credential). Added `auth.login`, `auth.login.failed`, and
  `auth.password_change` audit events (no password material recorded).
- **Verified, no change needed**: argon2id + `SameSite=Strict` JWS sessions with
  revocation; nonce-based CSP + HSTS (no `dangerouslySetInnerHTML` anywhere);
  double-submit CSRF + Origin on every cookie mutation; Redis rate limits on all 7
  surfaces; RBAC re-checked in all 58 route handlers (0 missing); at-rest
  AES-256-GCM for RPC secrets; bombard/faucet/paymaster caps + kill-switches +
  per-user concurrency; pino redaction (incl. `rawSignedTx`) demonstrated live.
- **Client-bundle isolation**: inspected the actual `.next/static` output — no
  operator private-key env names, no `worker/` operator-key modules, no
  `encryptAtRest`/`ENCRYPTION_KEY`, and no raw 32-byte key hex literals.
- **Dependencies**: `pnpm audit` hits the retired npm endpoint (HTTP 410; CI
  downgrades that infra error). Cross-checked via npm's bulk advisory endpoint —
  **0 high/critical**; 2 moderate (`postcss` transitive, direct dep already on the
  patched `8.5.19`).

## 2026-07-15 — Smart wallets & sponsored tx (ERC-4337) (#16)

Gasless transactions via ERC-4337 v0.7 smart accounts: a user creates a
counterfactual smart account owned by their in-app keypair, and sends a
**sponsored** UserOp where a VerifyingPaymaster pays the gas and the owner EOA
pays **zero**. All signing stays IN-BROWSER (AGENT §0) — the owner signs only the
`userOpHash`; the server never sees the key. The two operator keys stay
**worker-only**: the paymaster signer never enters the web process (the `/sponsor`
route round-trips through a worker to sign), and the relayer submits `handleOps`.

- **4337 contracts** (`packages/contracts`): the eth-infinitism reference stack is
  vendored as a submodule (`forge install eth-infinitism/account-abstraction@v0.7.0`)
  and compiled unchanged via a `src/aa/AA4337.sol` anchor — `EntryPoint`,
  `SimpleAccountFactory`, `SimpleAccount`, `VerifyingPaymaster`. `forge test`
  (`test/AA4337.t.sol`) proves counterfactual-address == deployed, a sponsored
  `handleOps` that deploys + runs an inner call with the owner paying zero, and
  wrong-paymaster-signer rejection. Artifacts are exported (`export-artifacts.mjs`
  extended) to `packages/contracts/artifacts/` and mirrored into `@nexus/types`.
- **Setup path** (`apps/web/scripts/deploy-4337.ts`): deploys the stack on anvil
  (no canonical EntryPoint there), funds the paymaster's EntryPoint deposit +
  stake, and records the public addresses in `AppSetting`
  (`smartwallet.stack.<networkId>`) — no migration. A live proof
  (`apps/web/scripts/prove-4337.ts`) drives the real routes + worker end-to-end.
- **Smart-wallet lib** (`apps/web/lib/smart-wallets/`): PURE UserOp math
  (`userop.ts` — pack/hash via viem `account-abstraction`, `execute`/`createAccount`
  calldata, `paymasterAndData` layout), budget caps (`budget.ts` — pure decision +
  Redis reservation, fails closed), stack resolver, deploy draft (HMAC-pinned),
  DTO with on-read `isDeployed` reconciliation, and a browser-only `sign-client.ts`
  that signs the `userOpHash`.
- **Endpoints**: `GET /api/smart-accounts`, `POST /api/smart-accounts/predict`,
  `POST /api/smart-accounts/deploy` (+ `/deploy/broadcast`, client-signed factory
  call), `POST /api/userops/sponsor` (scaffolds the UserOp, enforces the
  rate-limit + **budget cap**, round-trips to the worker to sign the paymaster
  data, returns the sponsored UserOp + `userOpHash`), and `POST /api/userops/send`
  (independently re-verifies the owner signature, records `Transfer.sponsored=true`,
  enqueues the bundler).
- **Workers** (`worker/userops/`): `userop-sponsor` signs `paymasterAndData` with
  the PAYMASTER_SIGNER key (computes the hash via the paymaster's own on-chain
  `getHash`); `userop-bundler` submits `handleOps` with the RELAYER key, decodes
  the `UserOperationEvent`, finalizes the Transfer, flips `SmartAccount.isDeployed`,
  and re-enforces the per-op budget cap.
- **UI**: a `/smart-wallets` page (predict/deploy/list + sponsored send) and the
  transfers/Lab **sponsored toggle** completed (the Sprint-8 stub now runs a real
  sponsored native send through the keypair's smart account).
- **Security invariants**: paymaster + relayer keys are worker-only (grep-clean of
  web logs/source); sponsorship is rate-limited and budget-capped (per-op
  `userop.maxOpCostWei` + rolling daily `userop.dailyCapWei`, reserved atomically
  in Redis); the send route re-verifies the owner signature and pins the paymaster.

## 2026-07-15 — On-chain chat + file storage (#15)

Tamper-evident on-chain chat: messages live off-chain, a keccak256 hash of each
is committed on-chain via a stateless `ChatLog` event logger, and any stored
message can be verified against its on-chain commitment. Plus a driver-agnostic
file-storage abstraction (MinIO/S3 or fs volume) with signed, time-limited URLs
and magic-byte upload validation. The `/lab` `chat` slot is flipped to available;
a dedicated `/chat` page ships too. All signing is IN-BROWSER (AGENT §0) — the
server only ever receives a raw signed commit tx.

- **`ChatLog` contract** (`packages/contracts/src/ChatLog.sol`): needs no
  OpenZeppelin — `commit(bytes32 contentHash, string ref)` emits
  `MessageCommitted(address indexed sender, bytes32 indexed contentHash, uint256
  timestamp, string ref)`. `forge test` (`test/ChatLog.t.sol`) covers the emit,
  msg.sender/block.timestamp, and multiple/independent commits. The artifact is
  exported (`export-artifacts.mjs` extended) to `packages/contracts/artifacts/`
  and mirrored into `@nexus/types` (`packages/types/src/contracts/ChatLog.ts`).
  Deployed once per network by an admin/one-time path
  (`apps/web/scripts/deploy-chatlog.ts`); the address is stored in the existing
  `AppSetting` key-value model (`chat.chatLogAddress:<networkId>`) — no migration.
- **Chat lib** (`apps/web/lib/chat/`): `hash.ts` (PURE, shared with the worker)
  computes `keccak256` of the body (+ attachment key) and builds the `commit`
  calldata; `chatlog.ts` reads/writes the deployed address; `draft.ts` mints an
  opaque HMAC-signed commit draft pinning userId/network/chainId/messageId/
  contentHash/from/txTo(ChatLog)/txValue(0)/data/ceilings; `verify.ts`
  independently re-verifies a raw SIGNED commit (to==ChatLog, value==0,
  data==pinned, chainId, ceilings, signer==from) before broadcast; `onchain.ts`
  decodes the `MessageCommitted` event from the commit receipt; `ceilings.ts`,
  `context.ts`, `schema.ts`, `dto.ts`, `keys.ts` round out limits, active-network
  resolution, zod validation, serialization, and worker queue keys.
- **APIs**: `GET/POST /api/chat` (list; store off-chain + return `{ messageId,
  contentHash, unsignedCommitTx, commitDraftId }`), `POST /api/chat/:id/commit`
  (client-signed broadcast OR the budget-capped relayer alternative),
  `GET /api/chat/:id/verify` (recompute keccak256 of the stored body → compare to
  the on-chain hash → `{ verified, onchainHash, txHash }`). RBAC + CSRF +
  per-user/IP rate-limit (`lib/rate-limit` `chat` bucket) enforced; commits are
  audit-logged (`lib/audit`).
- **StorageService** (`apps/web/lib/storage/`): one interface, two drivers —
  `volume` (fs under `STORAGE_VOLUME_PATH`, signed local URLs via an HMAC token)
  and `s3`/MinIO (self-contained SigV4 presigner, no aws-sdk) — selected by
  `STORAGE_DRIVER`. `POST /api/files/presign` validates declared MIME + size and
  issues a signed upload URL; `GET /api/files/:key` re-checks auth + ownership,
  validates the bytes by MAGIC NUMBER against the type declared in the key
  (rejecting a lie about `Content-Type` with 415), then 302-redirects to a fresh
  signed, time-limited download URL. Files live outside the webroot and are never
  inlined or executed.
- **Worker**: `chat-commit` relayer processor (`worker/chat/process-commit.ts`,
  operator key worker-only, rolling per-day budget cap) and the shared `tx-watch`
  queue extended (`processChatCommitWatch`) to finalize a committed message's
  receipt; both registered in `worker/index.ts`.
- **UI**: `/chat` page + reusable `ChatPanel` (composer, in-browser sign, message
  list with each message's contentHash + a verify badge, attachment upload); the
  `/lab` `chat` registry slot flipped to available.
- **Tests** (Vitest): magic-byte upload validation (accept PNG, reject bad-MIME /
  oversize / magic mismatch); hash commit→verify round-trip incl. a tampered body
  and tampered-data/redirected-target/wrong-chain/value-moving commit rejections;
  draft encode/decode + tamper + expiry.
- **Security invariants**: tamper-evidence (recompute-and-compare against the
  on-chain hash); the server never sees a private key on the client path (raw
  signed commit only, independently re-verified); uploads validated by magic
  bytes not just extension; signed, time-limited serve URLs; files stored outside
  the webroot, never executed/inlined; relayer key worker-only + budget-capped.

## 2026-07-15 — Transaction bombardment (throughput stress) (#14)

High-throughput transaction stress testing at a target TPS, landing in the #13
`/lab` shell by flipping the reserved `bombard` registry slot (no shell rewrite).
Bulk txs are native transfers signed IN-BROWSER (CLIENT_SIGNED); the server gets
only raw signed txs and paces them from a worker — the private key never leaves
the client (AGENT §0/§5, SPEC §8.7/§9). Relayer mode (operator key, worker-only)
is wired behind a target allow-list. Abuse guards are enforced SERVER-SIDE.

- **Shared bombard lib** (`apps/web/lib/bombard/`): `policy.ts` (PURE) is the
  single authority for the hard ceilings (`evaluateBombardCeilings`: kill-switch,
  targetTps ≤ cap, totalCount ≤ cap, per-tx value cap, relayer allow-list) plus the
  run-status classification (`isActiveRunStatus` — the concurrency-1 guard) and
  control transitions (`canApplyAction`). `token-bucket.ts` (PURE) paces emission
  to `targetTps` (starts empty for tight convergence; burst reserved for catch-up).
  `backpressure.ts` (PURE) is an AIMD controller: RPC 429/timeout multiplicatively
  REDUCES the rate + backs off exponentially (never fails the run), success
  recovers it toward target; `isBackpressureError` classifies retry-vs-fail.
  `ceilings.ts` loads `bombard.*` AppSettings — env `BOMBARD_MAX_TPS`/`MAX_TOTAL`
  are the ABSOLUTE caps an AppSetting may only tighten (`Math.min`), never widen.
  `draft.ts` mints an opaque HMAC-signed PLAN token pinning userId/run/network/
  chainId/mode/from/to/valuePerTx/nonce-range/gas/fees. `verify.ts` samples the
  signed batch (count + first/last tx: chainId/to/value/nonce/signer) against the
  plan. `keys.ts`/`context.ts`/`dto.ts`/`sign-client.ts`/`bombard-event.ts` round
  out queue+Redis keys, active-network resolution, serialization, the browser bulk
  signer, and the telemetry shape. Money is bigint/wei-string throughout.
- **API** (`app/api/bombard/…`): `POST /prepare` (`requireAuth`+CSRF, zod, rate-
  limit) validates ceilings, verifies live chainId, reads the pending nonce, creates
  a QUEUED `BombardRun`, and returns the nonce range + tx template + signed plan for
  the client to bulk pre-sign. `POST /start` verifies the plan (owner/run/expiry),
  re-checks the kill-switch + active chain, samples the signed batch, then ATOMICALLY
  enforces per-user concurrency 1 (reject if another RUNNING/PAUSED run) while
  flipping QUEUED→RUNNING, stages the plan + raw txs in Redis, and enqueues
  `bombard-runner`. `POST /:id/pause|resume|cancel` raise a fast Redis control
  signal + set the authoritative status (resume re-enforces concurrency + re-enqueues).
  `GET /:id` and `GET /:id/events` (cursor-paginated) are user-scoped.
- **`bombard-runner` worker** (`worker/bombard/process-run.ts`, registered in
  `worker/index.ts` alongside faucet-drip/deploy-watch/tx-watch): token-bucket
  pacing to `targetTps`; concurrency 1 PER USER via a refreshed per-user Redis lock
  (global BullMQ concurrency lets distinct users run in parallel); CLIENT_SIGNED
  broadcasts the pre-signed txs from the Redis list (nonces baked in), RELAYER signs
  with the operator key using a locally-managed contiguous nonce; records a
  `BombardEvent` per tx (txHash/nonce/latency), flushes run counters + publishes
  `bombard` telemetry (~500 ms); backpressure REDUCES throughput on RPC 429/timeout;
  resumes from the persisted `sentCount`; cancel/pause observed within a tick.
- **`/lab` Bombard panel** (`components/bombard/bombard-panel.tsx`, registry entry
  flipped to `available`): TPS slider, total-count + value-per-tx inputs, estimated
  gas read-out, keypair unlock, initiate/pause/resume/kill, and live counters over
  the telemetry SSE `bombard` channel (with a fallback poll). Bulk-signs in-browser.
- **Abuse guards / chain safety**: hard TPS + total ceilings (env-capped), per-user
  concurrency 1, a global `bombard.enabled` kill-switch, relayer-mode target allow-
  listing, active-network-only + live-chainId verification before any broadcast, and
  the operator key confined to `worker/`. Tests (Vitest, PURE): ceiling rejection,
  single-active classification, token-bucket pacing ≈ target, backpressure reduces
  rate + error classification, control transitions. Proven live on anvil: N=50 @
  targetTps=10 → 50/50 sent+confirmed, on-chain nonce +50, block +50, measured ≈9.8
  TPS; ceiling / single-run(409) / cancel(stops early) / kill-switch all rejected.

## 2026-07-15 — Transfers (native + assets) & Tx Lab shell (#13)

Non-custodial asset transfers reusing the #12 prepare→sign→broadcast pattern: the
server builds the UNSIGNED transfer tx, the browser signs it with a vault keypair,
and the server broadcasts ONLY the raw signed tx — the private key never leaves the
client (AGENT §0/§4/§5, SPEC §8.6). Plus the Transaction Lab shell (`/lab`).

- **Shared transfer lib** (`apps/web/lib/transfers/`): `calldata.ts` resolves each
  kind's on-chain call via viem against the COMMITTED token ABIs (#11) — NATIVE
  value transfer, ERC-20 `transfer(to,amount)`, ERC-721 `safeTransferFrom(from,to,
  tokenId)`, ERC-1155 `safeTransferFrom(from,to,id,amount,"0x")`. `schema.ts` is a
  zod discriminated union on `kind` (checksummed addresses, positive wei/unit
  strings, strict keys). `draft.ts` mints an opaque HMAC-signed DRAFT token (keyed
  by `SESSION_SECRET`, 15-min expiry) pinning userId / network / chainId / the
  resolved tx `to`+`value`+`data` / sender / ceiling snapshot — no secrets.
  `verify.ts` parses the signed tx (`parseTransaction`+`recoverTransactionAddress`)
  and enforces every chain-safety invariant (to/value/data equality, chainId match
  vs pinned AND live, gas/value/fee ceilings, signer == sender). `ceilings.ts`
  reads `transfer.*` AppSettings (kill-switch + caps; native value has a non-zero
  cap). `balances.ts` reads ERC-20/721/1155 holdings via a mockable reader.
  `dto.ts`/`context.ts`/`keys.ts`/`sign-client.ts` round out serialization,
  active-network resolution, the shared `tx-watch` queue key, and the browser signer.
- **API** (`app/api/transfers/…`, `app/api/assets/…`): `POST /prepare`
  (`requireAuth`+CSRF, zod, transfer rate-limit) resolves the call, estimates gas
  (+20%) + fees, verifies live chainId, returns `{ mode:'client-signed', unsignedTx,
  transferDraftId }` — or `mode:'sponsored-unavailable'` (Sprint-8 paymaster stub)
  when `sponsored:true`. `POST /broadcast` decodes+verifies the draft, re-confirms
  the active network + live chainId, independently verifies the SIGNED tx against
  the pinned policy, broadcasts via `sendRawTransaction`, creates a `Transfer`
  (PENDING), enqueues `tx-watch`, publishes a live tx telemetry event, and audit-logs.
  `GET /transfers[/:id]` (user-scoped) and `GET /assets/:address/balances` (RPC read
  via the resolver) complete the surface. Money is bigint in memory, wei string at rest.
- **`tx-watch` worker** (`worker/tx/process-watch.ts`, registered in `worker/index.ts`
  alongside faucet-drip + deploy-watch): read-only receipt poller mirroring
  deploy-watch — idempotent by transferId, retry-with-backoff, timeout→FAILED,
  publishes `tx` telemetry on finalization. Designed to be shared with chat commits (#15).
- **Live telemetry** (`lib/telemetry/tx-event.ts` + `publish.ts`): both the broadcast
  route and the worker publish `tx` events onto the existing `nexus:telemetry:tx`
  Redis channel that `/api/stream/telemetry` (#8 SSE) fans out.
- **UI**: `/transfers` (new-transfer form + history table, reusable
  `components/transfers/*`). `/lab` — the **Transaction Lab shell**: a
  registry-driven tabbed workspace (`app/(app)/lab/panels.tsx`) with a **Transfer
  Assets** panel and a shared **live tx feed** (SSE). Bombard (#14) and Chat (#15)
  are reserved as `coming-soon` registry entries — they slot in by adding ONE entry
  + component, no shell rewrite (the extension contract the issue asks for).
- **Proven live on anvil (chainId 31337)**: deployed test ERC-20/721/1155 via #11
  artifacts, then prepare→sign→broadcast→tx-watch SUCCESS for all four kinds —
  native +1 ETH, ERC-20 0→100e18, ERC-721 ownerOf moved sender→recipient, ERC-1155
  0→10; balances endpoint reflected each change; a chainId-1 signature was rejected
  (400 "chainId mismatch: signed 1 != active 31337") before any broadcast.

## 2026-07-15 — Deployment flow: estimate → sign → broadcast (#12)

Non-custodial token launches: the server builds the UNSIGNED deploy tx, the
browser signs it with a vault keypair, and the server broadcasts ONLY the raw
signed tx — the private key never leaves the client (AGENT §0/§5/§7, SPEC §8.5).

- **Shared deploy lib** (`apps/web/lib/deployments/`): `artifacts.ts` encodes
  constructor args against the COMMITTED template bytecode (#11) via viem
  `encodeDeployData` (Solidity is never compiled at request time) — ERC-20
  `(name,symbol,initialSupply,owner,flags)`, ERC-721 `(name,symbol,baseURI,owner,
  flags)`, ERC-1155 `(baseURI,owner,flags)`. `schema.ts` is a zod discriminated
  union on `standard` (checksummed `ownerAddress`, wei-string `initialSupply`,
  per-standard feature flags, strict keys). `draft.ts` mints an opaque HMAC-signed
  DRAFT token (keyed by `SESSION_SECRET`, 15-min expiry) pinning userId / network /
  chainId / the exact creation `data` / owner / ceiling snapshot — no DB row, no
  secrets. `verify.ts` parses the signed tx (`parseTransaction` +
  `recoverTransactionAddress`) and enforces the chain-safety invariants.
  `ceilings.ts` reads `deploy.*` AppSettings (kill-switch + gas/value/fee caps) with
  safe defaults. `dto.ts`/`context.ts` round out serialization + active-network
  resolution.
- **API** (`app/api/deployments/…`): `POST /estimate` (`requireAuth` + CSRF, zod,
  deploy rate-limit) encodes ctor args, estimates gas (+20% buffer) + reads
  congestion, verifies the live chainId, and returns `{ estimatedGas, baseFee,
  congestion, unsignedTx, deploymentDraftId }`. `POST /broadcast` decodes+verifies
  the draft (HMAC/expiry/owner), re-confirms the active network + live chainId, then
  asserts the SIGNED tx is a contract creation whose chainId matches, whose calldata
  equals the pinned data, and whose gas/value/fee stay within ceilings — BEFORE
  `sendRawTransaction` — then persists a `Deployment` (PENDING), enqueues
  `deploy-watch`, and audits (ids/addresses/hashes only). `GET /` (filter by
  standard/status/network, owner-scoped) + `GET /:id` (detail, foreign id → 404).
- **`deploy-watch` worker** (`worker/deploy/process-watch.ts`): read-only (never
  signs) — polls `waitForTransactionReceipt` with per-attempt window + BullMQ
  backoff; on receipt records `contractAddress`/`gasUsed`/`blockNumber` + SUCCESS or
  FAILED (revert); on the final attempt marks FAILED (timeout). Idempotent by id.
  Registered alongside `faucet-drip` in the worker entrypoint.
- **`/launchpad`** (`app/(app)/launchpad`): RSC shell + client manager with
  ERC-20/721/1155 tabs, per-standard inputs, feature toggles, a gas/congestion
  estimate, a deployment-progress terminal, and a recent-deployments table. The
  selected keypair is decrypted + used to sign IN-BROWSER (`lib/crypto` +
  `lib/deployments/sign-client.ts`); only the raw signed tx is posted to
  `/broadcast`.
- **Build fix**: the `@nexus/types` contract barrels re-exported with `.js`
  specifiers, which Turbopack failed to resolve to the `.ts` sources on first
  app-route import — switched to extensionless relative specifiers (safe under
  `moduleResolution: Bundler`; the generator emits the same).
- **Tests** (Vitest, 15 new): ctor-arg encode→`decodeDeployData` round-trip for all
  three standards + flags-on≠flags-off; draft sign/verify + tamper/expiry/malformed;
  and `parseSignedDeploy`+`assertDeployWithinPolicy` over REAL signed txs — chainId
  mismatch, gas ceiling, value ceiling, data mismatch, wrong signer, kill-switch.
- **Live-verified on anvil (chainId 31337)** via a scripted client standing in for
  the browser vault (anvil key #1): ERC-20 `0x8464135c…318bC`, ERC-721
  `0x948B3c65…34F8F`, ERC-1155 `0xbCF26943…761508` all estimate→sign→broadcast→
  `deploy-watch` SUCCESS with real `contractAddress`/`gasUsed`/`blockNumber`.
  Feature assertions: ERC-20 pausable honored (paused false→true) + mintable OFF
  reverts `mint`; ERC-721 mintable honored (`ownerOf(0)`==owner); ERC-1155 supply
  honored (`totalSupply(7)` 0→100). Chain-safety: chainId 1 → 400 rejected; gas
  20M > 15M ceiling → 400 rejected. Logs carry only ids/statuses/addresses/tx
  hashes — no key, no raw signed tx.

## 2026-07-15 — Token contract templates ERC-20/721/1155 (#11)

Foundry token templates on OpenZeppelin 5.x (v5.6.1), Solidity 0.8.28, with
opt-in feature mixins gated at runtime and precompiled, committed artifacts — the
app deploys committed bytecode via viem, never compiling Solidity at request time
(AGENT.md §7, SPEC §6).

- **`NexusERC20`** (`packages/contracts/src/NexusERC20.sol`): OZ `ERC20` +
  `ERC20Burnable` + `ERC20Pausable` + `ERC20Permit` + `AccessControl`. Constructor
  `(name, symbol, initialSupply, owner, Flags{mintable,burnable,pausable,permit})`.
  Initial supply minted to `owner`; `MINTER_ROLE`/`PAUSER_ROLE` granted to `owner`
  only when the matching flag is set. `mint`/`pause`/`burn`/`permit` each revert
  `FeatureDisabled` when their flag is off, even if the role was later granted.
- **`NexusERC721`** (`src/NexusERC721.sol`): OZ `ERC721` + `ERC721URIStorage`
  (base-URI + optional per-token URI) + `ERC721Burnable` + `ERC721Pausable` +
  `AccessControl`. Constructor `(name, symbol, baseURI, owner, Flags{mintable,
  burnable,pausable})`; `safeMint(to, uri)` auto-increments token ids.
- **`NexusERC1155`** (`src/NexusERC1155.sol`): OZ `ERC1155` + `ERC1155Burnable` +
  `ERC1155Pausable` + `ERC1155Supply` + `AccessControl`. Constructor `(baseURI,
  owner, Flags{mintable,burnable,pausable,supply})`; `mint`/`mintBatch`/`setURI`.
- **Tests** (`packages/contracts/test/*.t.sol`, forge-std): 37 passing — mint /
  burn / pause / permit happy paths, AccessControl (only `MINTER_ROLE` mints, only
  `PAUSER_ROLE` pauses), and revert cases (paused transfer reverts, unauthorized
  mint/pause reverts, feature-flag-off reverts, supportsInterface, supply tracking).
- **Committed artifacts**: `packages/contracts/artifacts/*.json` (`{abi, bytecode,
  deployedBytecode}`) plus viem-friendly `as const` mirrors + a `contractArtifacts`
  registry in `packages/types/src/contracts/*` (re-exported from `@nexus/types`).
  Generated by `packages/contracts/script/export-artifacts.mjs` (`pnpm --filter
  @nexus/contracts export`). `out/`/`cache/` stay gitignored; artifacts do not.
- **Deps + CI**: OpenZeppelin + forge-std vendored as git submodules under
  `packages/contracts/lib` (pinned in `foundry.lock`, resolved via
  `remappings.txt`); CI checkout now uses `submodules: recursive` so `forge
  build`/`forge test` resolve imports.

## 2026-07-15 — Dashboard & live telemetry (#8)

Real network telemetry on the dashboard, backed by an enriched health API, a
live SSE stream, and a dependency-aware readiness probe.

- **Shared health reader** (`apps/web/lib/chain/health.ts`): `readNetworkHealth(client)`
  reads chainId, latest block height, gas price, a derived block time, peer count
  (`net_peerCount`) and txpool status (`txpool_status`) off a resolver-built viem client.
  Optional methods go through `safeRequest`, which maps a missing method / any error to
  `null` — a node that lacks them reports the field as unavailable, never a 500. Wei and
  heights stay strings; `averageBlockTimeSeconds` derives block time with bigint math.
  Verified live against anvil: `peerCount:null` (unsupported, graceful), `txpool:{…}` present.
- **`GET /api/networks/:id/health`** (`app/api/networks/[id]/health`): now returns the full
  telemetry object via the shared reader; a fully unreachable RPC still maps to a clean 502.
  Proven live: `blockNumber` advanced `5 → 10` after `anvil_mine`, gas/blockTime live.
- **`GET /api/stream/telemetry`** (`app/api/stream/telemetry`): authenticated SSE stream.
  Emits a `ready` frame, polls network `health` every 3s, and fans out Redis pub/sub
  `tx`/`bombard`/`faucet` events (channels in `lib/telemetry/sse.ts`) where publishers exist.
  A dedicated Redis subscriber connection and both timers are torn down on client
  disconnect (request abort signal) — no leaked connections. Verified: `ready` + live
  `health` frames, a published `faucet` event forwarded, unauth → 401, clean disconnect.
- **`GET /api/health`** (public, `app/api/health`): upgraded from a static `{status:ok}` to
  a real readiness probe of Postgres, Redis and the active-network RPC. Each runs under a
  timeout (`lib/health/readiness.ts`); `aggregateReadiness` returns 200 when all up, 503
  when any is down, with a per-dependency breakdown and coarse, secret-free error labels.
  Proven: 200 healthy → 503 with `rpc.ok:false` when RPC pointed at a dead port → 200 restored.
- **`/dashboard`** (`app/(app)/dashboard`): RSC shell (server-fetched first health snapshot +
  active-account counts) with client islands. `dashboard-live.tsx` subscribes to the SSE
  stream and falls back to polling `/api/networks/:id/health`, driving live stat cards (gas,
  block height, block time, peers, txpool) with loading/error states and a live event feed;
  `connect-provider.tsx` connects an injected EIP-1193 wallet read-only. Keeps the BRAND bento
  grid; `prefers-reduced-motion` respected via the shared `status-pulse` utility.
- Client-safe display formatters (`lib/telemetry/format.ts`) reduce wei→gwei with bigint math.
- 42 new Vitest cases (block-time derivation, hex/txpool parsing + graceful missing-method
  handling, readiness aggregation/timeout, SSE framing, formatters). All gates green.

## 2026-07-15 — Non-custodial keypair vault (#9)

Browser-only key generation, encryption, and management. The server never
receives, stores, or logs a plaintext private key — it may only hold the opaque
encrypted keystore blob a user opts to persist (AGENT §0/§6, SPEC §4.1/§8.3).

- **Client keystore crypto** (`apps/web/lib/crypto/keystore.ts`, `"use client"`,
  browser-only, no `process.env`/server import): `generateKeypair()` (viem
  `generatePrivateKey` → `privateKeyToAccount`), `encryptKeystore(pk, passphrase)`
  and `decryptKeystore(blob, passphrase)`. KDF/cipher: **PBKDF2-SHA-512 @ 600k
  iterations** (WebCrypto-native, no WASM dep) → **AES-256-GCM**, per-key random
  32-byte salt + 96-bit IV, output as a **Web3-Secret-Storage-v3**-shaped JSON
  envelope carrying only ciphertext + public KDF params + a keccak256 mac. Wrong
  passphrase / tampered blob fail cleanly as a typed `KeystoreError` (mac pre-check
  before the AES step, plus GCM's own auth tag). `keystore-schema.ts` is the shared
  zod envelope; a payload missing `crypto.ciphertext` is rejected.
- **In-memory vault** (`lib/crypto/vault.ts`, `"use client"`): decrypted keys live
  only in module memory and are wiped on `beforeunload`/`unload`/`pagehide` — never
  localStorage, disk, or network.
- **API** (`app/api/keypairs/…`): `GET /` + `POST /` + `DELETE /:id` +
  `POST /validate-address` (all `requireAuth` + CSRF on the cookie path). POST stores
  ONLY `{ label, address, encryptedKeystore }`; it **rejects any private-key-ish
  payload** (`privateKey`/`pk`/`mnemonic`/`seed`/…) with 400 via a recursive denylist
  scan (`assertNoPrivateKeyMaterial`, any depth) **plus** a strict zod schema that
  requires a real v3 ciphertext envelope. Audit records label + address only; the DTO
  exposes no plaintext-key field.
- **UI** (`app/(app)/keypairs`, `components/keypairs/keypair-table.tsx`): generate,
  import/export encrypted keystore JSON, label, ephemeral↔persisted toggle, copy, and
  delete — using `components/ui` primitives and the reusable presentational
  `KeypairTable` (holds no secret state, performs no crypto).
- Unit tests (Vitest, Node WebCrypto): encrypted blob never contains the plaintext key;
  encrypt→decrypt round-trips to the same address/key; wrong passphrase + tamper fail
  cleanly. Live-verified: `privateKey`/`seed`/`mnemonic` → 400, valid blob → 201, GET
  returns the blob with no plaintext, CSRF-less → 403, unauth → 401, DELETE → 200; DB row
  holds only ciphertext and the server log shows zero plaintext key.

## 2026-07-15 — Faucet API + drip worker (#10)

Rate-limited, capped native-token faucet: an authenticated request enqueues a
BullMQ job that the worker signs with the operator key and broadcasts, all
gated by kill-switch, per-request ceiling, per-address cooldown, and daily cap.

- **Decision core** (`apps/web/lib/faucet/`): `policy.ts` (`evaluateFaucetRequest`)
  is the single pure ceiling check (kill-switch → invalid → ceiling → cooldown →
  daily-cap, deterministic order) and `faucetProcessDecision` is the idempotency
  gate (only `PENDING|QUEUED` process). `usage.ts` (`summarizeFaucetUsage`) reduces
  an address's recent `FaucetRequest` rows into daily spend + cooldown state
  (FAILED/REJECTED never count). Both are dependency-free so the API boundary AND
  the worker reach an identical verdict. Amounts are bigint/wei throughout;
  `schema.ts` validates + checksums the address (viem `getAddress`) and keeps the
  amount a wei string (rejects floats/`1e18`, no `Number()`).
- **API** (`app/api/faucet/…`): `POST /request` (`requireAuth` + CSRF, zod, short-window
  Redis rate-limit per address+IP+user, policy pre-check on the ACTIVE network, then
  persists a `FaucetRequest` and enqueues `faucet-drip`, returns `{requestId,status:"QUEUED"}`,
  audited via `writeAudit` with no secrets); `GET /requests` (caller's history);
  `GET /quota` (active-network ceilings + address usage, all wei strings).
- **Queue** (`apps/web/lib/queue/`): a BullMQ producer (`enqueueFaucetDrip`) on a
  dedicated `maxRetriesPerRequest:null` connection; the job id is the request id so a
  duplicate enqueue is a Redis-level no-op. Adds `bullmq`.
- **Worker** (`worker/`): the `faucet-drip` consumer is the ATOMIC authority — under a
  per-address Redis lock it re-reads the row + network + global kill-switch, re-runs the
  pure policy against DB usage (excluding the row itself), verifies the live chainId
  equals the configured one BEFORE broadcast, signs a native transfer with
  `FAUCET_PRIVATE_KEY` (loaded ONLY here), polls the receipt, and advances
  `PENDING→BROADCAST→CONFIRMING→SUCCESS|FAILED` with the tx hash. Logs only ids /
  statuses / tx hashes — never the key or a raw signed tx. Adds `bullmq`, `ioredis`,
  `viem` to the worker.
- **UI** (`app/(app)/faucet`): address input, amount slider capped at the per-request
  drip, request button, and a live event log polled from `/api/faucet/requests`; the
  shared keypair table (#9) is placeheld, not reimplemented.
- Live-verified on anvil (chainId 31337): dest balance 0 → 2 ETH, tx confirmed,
  `FaucetRequest=SUCCESS`+txHash; immediate 2nd request → 429 cooldown; quota decremented
  (used 2 / 500 ETH); audit row written; the faucet key appears in no log or client
  bundle. 17 new Vitest cases (ceiling, cooldown, daily-cap, kill-switch, idempotency,
  usage windows, schema).

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
