# Security Review — SPEC §13 Audit & Hardening Pass (#18)

Date: 2026-07-15. Scope: the complete merged app (issues #1–#16). This is an
**audit** of the consolidated SPEC §13 checklist against the code as shipped,
with a small number of **targeted fixes** for real gaps. Every item below is
enforced in code (not just documented); evidence is a `file:line`, a test, a
build-output inspection, or a live run. No secrets appear in this document.

All paths are relative to the repo root. "Enforced" = already correct before this
pass; "Fixed" = a real gap this pass closed (minimal, invariant-cited change).

## Summary table

| # | SPEC §13 requirement | Status | Evidence |
|---|----------------------|--------|----------|
| 1 | No endpoint accepts/returns/stores/logs a plaintext private key or mnemonic (operator keys worker-only) | Enforced | Grep of `apps/web/app/api/**` for `privateKey`/`mnemonic`/`PRIVATE_KEY` → **no hits**. Operator keys only in `worker/lib/config.ts:20,37,55` (env) + `worker/lib/chain.ts:67,156,166`. Client keystore/vault is browser-only Web Crypto (`apps/web/lib/crypto/keystore.ts`, `vault.ts`). Built `.next/static` grep for operator env names / worker modules / raw 32-byte key hex → **all clean** (item 15). |
| 2 | All inputs zod-validated; unknown fields rejected (`.strict()`); addresses checksummed | Enforced | Every request-body schema is `.strict()` — e.g. `apps/web/lib/transfers/schema.ts`, `deployments/schema.ts`, `bombard/schema.ts`, `smart-wallets/schema.ts`, `faucet/schema.ts:34`, `chat/schema.ts`, `chain/network-schema.ts:62,83`, `keypairs/schema.ts:73,89`, plus inline route schemas (`auth/login/route.ts:28`, `auth/change-password/route.ts:29`, `api-keys/route.ts:37`, `users/[id]/route.ts:23`). Addresses normalized via `isAddress` refine → `getAddress` transform (`transfers/schema.ts:15`, `faucet/schema.ts:16`, `chat/schema.ts:12`, `keypairs/schema.ts:60`, `bombard/schema.ts:14`, `smart-wallets/schema.ts:14`, `deployments/schema.ts:15`, `network-schema.ts:21`). |
| 3 | CSRF on all cookie-authed mutations + Origin check | Enforced | `apps/web/lib/auth/csrf.ts` — double-submit token (constant-time) + Origin/Referer==APP_URL (`checkCsrf` :82). `mutation-guard.ts:13` exempts Bearer-API-key callers only. Applied on every cookie-reachable mutation (POST/PATCH/PUT/DELETE) — verified across all `apps/web/app/api/**` handlers; the only non-CSRF mutations are `auth/login` (pre-auth) and `files/[...key]` PUT (HMAC capability token). |
| 4 | Redis rate limits on login/faucet/deploy/transfer/bombard/chat/userops | Enforced | `apps/web/lib/rate-limit.ts` (sliding-window, fail-open). login `auth/rate-limit.ts` via `auth/login/route.ts:52`; faucet `faucet/request/route.ts:57`; deploy `deployments/{estimate,broadcast}/route.ts:40,44`; transfer `transfers/{prepare,broadcast}/route.ts:35,46`; bombard `bombard/{prepare,start}/route.ts:39,50`; chat `chat/route.ts:65`, `chat/[id]/commit/route.ts:45`; userops `userops/{send,sponsor}/route.ts:52`, `smart-accounts/*`. |
| 5 | chainId match + gas/value/maxFee ceilings before EVERY broadcast | **Fixed** | Deploy/transfer/chat enforce chainId(==draft && ==live), gas, value, maxFee in `lib/{deployments,transfers,chat}/verify.ts`. Faucet is server-signed and bounded by per-request + rolling daily wei caps (`faucet/policy.ts:49,63`). **GAP-1 fixed:** bombard client-signed batch never checked `maxFeePerGas` — added the plan-ceiling check in `lib/bombard/verify.ts` (+ regression test `lib/bombard/verify.test.ts`). Userops: chainId bound into the signed `userOpHash` + validated (`userops/send/route.ts`, worker `process-bundle.ts`); gas×fee bounded by the combined `maxOpCostWei` per-op + daily cap (`smart-wallets/budget.ts`). See "Documented residual" for the userop standalone value note. |
| 6 | argon2id; signed httpOnly SameSite=Strict sessions; revocation | Enforced | `apps/web/lib/auth/password.ts` (argon2id, 19 MiB/t=2, dummy-hash timing-equalization). `session.ts` — JWS-signed cookie (`httpOnly`, `secure` in prod, `SameSite=Strict`, `session.ts:49-58`); DB stores only `sha256(sid)`; `revokeSession`/`revokeOtherSessions`/`rotateSession` (`session.ts:138-165`). |
| 7 | Strict CSP + HSTS + headers; no `dangerouslySetInnerHTML` with unsanitized data | Enforced | `apps/web/proxy.ts` — nonce-based CSP (no `unsafe-inline` scripts, `strict-dynamic`), HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy` (`proxy.ts:33-75`); baseline headers also in `next.config.ts`. **Grep of `apps/web/**` for `dangerouslySetInnerHTML` → zero hits.** |
| 8 | Uploads: MIME + magic-byte + size; signed URLs; no execution | **Fixed** | `apps/web/lib/storage/validate.ts` — MIME allowlist (:11), magic-byte `sniffMime` (:60), 8 MiB cap (:23). Signed HMAC time-limited URLs (`storage/token.ts`), served as `attachment` + `nosniff`, redirect (never inline) (`files/[...key]/route.ts:62,89`). **Gap fixed:** the volume PUT path validated size but not magic bytes — added `validateUploadedBytes` at the write boundary (`files/[...key]/route.ts`) so forged content is rejected before it is persisted, not only on serve. |
| 9 | Secrets only in env; pino redaction (password/authorization/cookie/privateKey/mnemonic/keystore/rawSignedTx) | Enforced | `apps/web/lib/log.ts` `REDACT_KEYS` (:14) incl. `rawSignedTx`, plus `*.key` nesting + `req.headers.*`/`set-cookie`. **Live demo:** logging an object with all sensitive fields prints `[REDACTED]` for each while `safeField` survives. Operator secrets loaded only from validated env (`@nexus/config/env`). |
| 10 | RBAC re-checked in every server action / route handler | Enforced | `apps/web/lib/auth/require-role.ts` (`requireAuth`/`requireRole` re-checked in-handler; proxy is defense-in-depth only). Enumerated all 58 handlers across 51 `route.ts` files — **0 missing**. ADMIN-gated: `audit`, `users*`, `networks` POST/PATCH/DELETE, `networks/[id]/default`. Public-by-design: `health`, `auth/login`, `auth/session`, `auth/logout`. SSE streams (`stream/telemetry`, `bombard/[id]/events`) call `requireAuth`. |
| 11 | Bombard/faucet/paymaster budget caps + kill-switches; per-user concurrency | Enforced | Bombard: env hard caps that AppSetting can only tighten (`bombard/ceilings.ts:83`), `BOMBARD_ENABLED` kill-switch, per-user concurrency 1 enforced atomically at start (`bombard/start/route.ts:118-132`) and resume (`bombard/control.ts:77-90`), fast Redis cancel/pause signal. Faucet: kill-switch + per-request + cooldown + daily cap (`faucet/policy.ts`). Paymaster: per-op + rolling daily Redis budget, **fails closed** (`smart-wallets/budget.ts:118-160`). |
| 12 | Dependencies patched; `pnpm audit --audit-level=high` | Enforced (documented) | `pnpm audit` hits the retired npm legacy endpoint (HTTP 410 `ERR_PNPM_AUDIT_BAD_RESPONSE`); CI downgrades that infra error only. **Alternative check** via npm's bulk advisory endpoint (lockfile regenerated for registry deps): `--audit-level=high` → **exit 0**, `--audit-level=critical` → **exit 0**. **No high/critical advisories.** 2 *moderate* only: `postcss` XSS (GHSA-qx2v-qp2m-jg93, `<8.5.10`) reachable via a transitive `postcss@8.4.31` in the tree; the direct dependency is already patched (`postcss@8.5.19`). Below the `high` gate; no non-breaking upgrade path (would force a Next major downgrade). |
| 13 | Audit-log every privileged/on-chain action (no secrets in metadata) | **Fixed** | `apps/web/lib/audit.ts` `writeAudit` (best-effort, non-secret metadata only). Already audited: keypair persist/delete, apiKey issue/revoke, transfer/deploy/chat.commit/userop.send, bombard prepare/start/cancel/pause/resume, smart-account deploy, faucet.request, user activate/deactivate/role/reset. **Gaps fixed:** `network.create/update/delete/setDefault` were TODO stubs → now write audit rows (`networks/route.ts`, `networks/[id]/route.ts`, `networks/[id]/default/route.ts`); `auth.login`/`auth.login.failed` + `auth.password_change` now audited (`auth/login/route.ts`, `auth/change-password/route.ts`). All metadata verified non-secret (ids, names, chainId, field-names). |
| 14 | At-rest encryption for network RPC secrets + persisted keystore blobs | Enforced | `apps/web/lib/crypto/at-rest.ts` — AES-256-GCM authenticated envelope keyed from `ENCRYPTION_KEY` (`encryptAtRest`/`decryptAtRest`). Network RPC secrets stored encrypted (redacted in `network-dto.ts`); optional persisted keystore blobs are already client-encrypted opaque JSON the server cannot decrypt. |
| 15 | Client bundle contains NO server-only/operator-key code | Enforced | `lib/crypto/at-rest.ts` and `worker/**` are server-only; **no** client component imports them (grep of `apps/web/{app,components}` → none). **Inspection of the actual `.next/static` build output**: grep for `FAUCET/RELAYER/PAYMASTER_SIGNER_PRIVATE_KEY`, `get*PrivateKey`, `worker/lib/{config,chain}`, `process-{drip,sponsor,bundle}`, `encryptAtRest`/`ENCRYPTION_KEY`/`SESSION_SECRET`, and raw `0x[64-hex]` literals → **all clean**. |

## Gaps fixed this pass

1. **Bombard maxFeePerGas ceiling (item 5, GAP-1).** `lib/bombard/verify.ts`
   `assertMatchesPlan` validated chainId/to/value/data/nonce/gas/signer but not
   `maxFeePerGas`, so a client could bulk-sign a batch with an arbitrary fee that
   shipped unchecked. Added a check against the HMAC-pinned, prepare-vetted
   `plan.maxFeePerGasWei`. Regression test: `lib/bombard/verify.test.ts`.
2. **Uploads magic-byte at the write boundary (item 8).** The volume PUT target
   (`app/api/files/[...key]/route.ts`) persisted bytes after a size check only,
   deferring the magic-byte sniff to serve time. Added `validateUploadedBytes` on
   PUT → forged/mismatched content is rejected (415) before it is stored.
3. **Network mutation audit logging (item 13).** `network.create/update/delete/
   setDefault` were `TODO(#6)` stubs. Wired `writeAudit` into all four ADMIN
   handlers with non-secret metadata (never the RPC credential).
4. **Auth-event audit logging (item 13).** Added `auth.login`,
   `auth.login.failed`, and `auth.password_change` audit rows (no password
   material; the attempted username is the only added context, and it is not a
   secret).

## Documented residual (no code change — by design)

- **Userop standalone value ceiling (item 5).** Sponsored/sent UserOps have no
  independent `value` ceiling. The operator-fund exposure (paymaster gas) IS
  bounded — combined worst-case cost via `maxOpCostWei` per-op + rolling daily cap
  (`smart-wallets/budget.ts`), and chainId is bound into the signed `userOpHash`.
  The inner-call `value` moves the smart account's OWN funds, so it is user-scoped
  (self-spend), not an operator risk. Adding a value cap here would be a feature
  change with no defined policy source, so it is documented rather than hacked in.
- **Worker on-chain sends audited at enqueue, not at broadcast (item 13).** The
  web route records the audit row when the on-chain job is enqueued; the worker's
  actual send does not write a second row. Enqueue-time coverage is complete for
  the privileged-action trail; noted for completeness.
- **`pnpm audit` endpoint (item 12).** Retired upstream (HTTP 410). Verified via
  npm's bulk advisory endpoint instead — 0 high/critical (see table row 12).

## Gate results (DoD)

- `pnpm db:generate` → OK; `pnpm typecheck` → OK; `pnpm lint` → 0 errors;
  `pnpm test` → 41 files, 255 tests pass (incl. new bombard regression);
  `pnpm build` (CI dummy env) → OK; `pnpm contracts:test` (`forge test`) → 44 pass;
  `pnpm worker` → boots (`worker.online`, 7 queues).
- Built `.next/static` bundle grep → no operator key / worker operator module.
- Live pino run → all sensitive fields redacted.
