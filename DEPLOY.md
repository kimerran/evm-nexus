# Deploying EVM Nexus on Railway

EVM Nexus deploys as **two services from this one monorepo** plus three managed
resources, per SPEC §10/§14 and AGENT.md §9:

| Component | What | Provides |
|---|---|---|
| **web** service | Next.js 16 app (`Dockerfile.web`) | HTTP app + API; health check `/api/health` |
| **worker** service | BullMQ consumers (`Dockerfile.worker`, `tsx worker/index.ts`) | faucet-drip, deploy/tx watch, bombard, chat-commit, userop sponsor/bundler |
| **Postgres** plugin | Managed PostgreSQL 16/17 | `DATABASE_URL` |
| **Redis** plugin | Managed Redis | `REDIS_URL` |
| **Volume** | Persistent disk mounted at `STORAGE_VOLUME_PATH` | file storage for the `volume` driver |

Both services build from the same repo/commit; only the Dockerfile (and the env
they receive) differ. Config-as-code lives in `railway.web.json` and
`railway.worker.json` — set each service's **Config-as-code file path** to the
matching file in the Railway dashboard.

---

## 1. Services

### web (`railway.web.json` → `Dockerfile.web`)
- **Build** (in-image): `pnpm install --frozen-lockfile && pnpm prisma generate && pnpm build`.
- **Start**: `pnpm start` (Next production server).
- **Release / pre-deploy command**: `pnpm prisma migrate deploy && pnpm prisma db seed`
  — runs in an ephemeral instance of the new image **before** it goes live.
  Migrations are **forward-only** (`migrate deploy`, never `migrate dev`/`db push`);
  the seed is idempotent (upsert-only), so re-running every release is a no-op.
- **Health check**: `GET /api/health` — 200 only when Postgres, Redis, and the
  active-network RPC are all reachable; 503 otherwise. Railway holds traffic on
  the old deploy until this is green.

> `next.config.ts` also emits `output: 'standalone'` (a self-contained server at
> `apps/web/.next/standalone`). The shipped image runs `pnpm start` so the pinned
> Prisma CLI stays available for the release command; teams wanting an ultra-slim
> runtime image can instead serve `node apps/web/server.js` from the standalone
> tree (copy `.next/static` and `public` into it) and run migrations from a
> separate step.

### worker (`railway.worker.json` → `Dockerfile.worker`)
- **Build** (in-image): `pnpm install --frozen-lockfile && pnpm prisma generate`.
- **Start**: `pnpm worker` (`tsx worker/index.ts`). No HTTP port, no health check.
- This is the **only** process that loads the operator signer keys
  (`FAUCET_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY`, `PAYMASTER_SIGNER_PRIVATE_KEY`).
  Keep them as **Railway secrets on the worker service only** — never on web,
  never in the DB, never in the repo, never in logs (test-chain keys only).

---

## 2. Managed resources

1. **Postgres** — add the Railway Postgres plugin; reference its `DATABASE_URL`
   on **both** web and worker. If you enable a connection pooler, also set
   `DIRECT_DATABASE_URL` for migrations.
2. **Redis** — add the Railway Redis plugin; reference its `REDIS_URL` on both
   services (shared BullMQ queues + rate limiting).
3. **Volume** — attach a Volume to **web** (and worker if it needs to read
   uploads) mounted at the same path as `STORAGE_VOLUME_PATH` (e.g. `/data/uploads`).
   Set `STORAGE_DRIVER=volume` in production (S3/MinIO is dev-only).

---

## 3. Environment & secrets

Set these on each service (see `.env.example` for the full annotated list — it
covers every SPEC §11.2 variable). **Secrets** (bold) must be Railway secret
vars, not plaintext config.

**Both services**
- `NODE_ENV=production`
- `APP_URL=https://<your-app>.up.railway.app` — the canonical public origin.
  Drives the CSP origin (the policy is `'self'`-based, so it resolves to this
  origin automatically once `APP_URL` is correct) and the storage signed-URL host.
- **`SESSION_SECRET`**, **`ENCRYPTION_KEY`**, **`CSRF_SECRET`**
- **`DATABASE_URL`** (from the Postgres plugin), **`REDIS_URL`** (from the Redis plugin)
- `STORAGE_DRIVER=volume`, `STORAGE_VOLUME_PATH=/data/uploads`
- Network/limit defaults: `DEFAULT_NETWORK_NAME`, `DEFAULT_CHAIN_ID`,
  `DEFAULT_RPC_URL`, `DEFAULT_NATIVE_SYMBOL`, `FAUCET_DRIP_WEI`,
  `FAUCET_DAILY_CAP_WEI`, `BOMBARD_MAX_TPS`, `BOMBARD_MAX_TOTAL`
- Seed admin: `ADMIN_USERNAME`, **`ADMIN_PASSWORD`** (strong; rotate after first login)

**worker only**
- **`FAUCET_PRIVATE_KEY`**, **`RELAYER_PRIVATE_KEY`**, **`PAYMASTER_SIGNER_PRIVATE_KEY`**

### Cookies in production
Session/CSRF cookies are `Secure` + `SameSite=Strict` when `NODE_ENV=production`
(`Secure` is set automatically — this is why `next start` requires HTTPS, which
Railway terminates for you). Cookies are **host-only** (no `Domain` attribute),
which binds them to the exact `APP_URL` host — the most secure default. Only add
a `Domain` cookie attribute if you deliberately serve the app across subdomains
of a custom domain; for a single Railway host, leave it host-only.

---

## 4. Release / seed flow

On every deploy of **web**, Railway runs the pre-deploy command against the new
image before cutting traffic over:

```
pnpm prisma migrate deploy   # forward-only; applies pending migrations
pnpm prisma db seed          # idempotent upsert: admin user, default network, AppSetting ceilings
```

The seed is safe to run on every release because each step is create-if-absent
(a second run is a strict no-op). The admin password is read from
`ADMIN_PASSWORD` and stored only as an argon2id hash — never hardcoded.

If you prefer to seed exactly once, drop `&& pnpm prisma db seed` from
`railway.web.json` and run it manually the first time:
`railway run --service web pnpm prisma db seed`.

---

## 5. CI gate & auto-deploy

- Enable **auto-deploy from `main`** on both services.
- Require the GitHub Actions CI (`.github/workflows/ci.yml`) to pass first:
  install → prisma generate → typecheck → lint → unit tests → contract
  (`forge`) tests → build → audit, plus the integration + Playwright E2E job.
  Merge to `main` is blocked on CI, so only green commits ever deploy.
- Migrations remain **forward-only** in prod; never point `migrate dev` / `db push`
  at the production database.

---

## 6. Local validation of these artifacts

Everything above was validated locally against an isolated empty Postgres + Redis
+ anvil (no real Railway account needed):

- `pnpm prisma migrate deploy` → `pnpm prisma db seed` (run twice — 2nd is a no-op)
- `pnpm build` (production) → `pnpm start` → `curl /api/health` returns
  `{"status":"ok",...}` (HTTP 200) with `db`/`redis`/`rpc` all `ok`
- `pnpm worker` boots and registers all 7 queues
- `docker build` of **both** `Dockerfile.web` and `Dockerfile.worker`; the web
  container serves `/api/health` green and runs the release command
  (`migrate deploy && db seed`) successfully in-image; the worker container boots online
- `STORAGE_DRIVER=volume` presign → put → get → delete round-trip passes
- Secret scan: no secret values or sensitive env-var names in the client bundle
