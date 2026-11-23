# Phase 2: Offline Data, Auth, Sync & PWA Shell (spec P2 + P3 + P4)

## Goal
Make the domain layer persistent and multi-device. This phase delivers:
- the Dexie local DB with the single local write path,
- godowns and the active-godown switcher,
- server auth with per-godown access, devices and an offline PIN,
- the full push/pull sync engine with idempotency, conflicts and godown-filtered feeds,
- the installable PWA shell that cold-starts offline.

## Read from `requirement.md`
§1.4 (all rules) · §2 users/roles/devices · §3.1–3.4 · §5 · §8.4 system collections · §8.5 Mongo indexes · §8.6 Dexie schema · §12 offline & sync (all) · §13 PWA · §14 security · §15 performance (Mongo connection) · §18 deployment/env/seed · §19.1 sync + godown isolation tests

## Checklist

### A. Local DB (`src/client/db`)
- [ ] `dexie.ts`: schema v1 **exactly** as §8.6, with typed tables. `migrations.ts` holds an additive-only helper and a documented rule.
- [ ] Catch `VersionError`/`UpgradeError` and show a recovery screen with "export local data" before any reset.
- [ ] `meta` helpers: cursor, deviceId, deviceCode, lastSyncAt, activeGodownId, `voucherSeq:<godownId>:<type>`.

### B. Local write path (`src/client/repo`)
- [ ] `createVoucher(godownId, input)`, `editVoucher(godownId, id, input, reason?)`, `voidVoucher(godownId, id, reason)`. Each runs **one Dexie transaction**: Zod validate → `recomputeVoucher` → assign number → write voucher rev → replace ledgerLines + stockMoves → update `dailyAgg` → append outbox op (`opId` uuidv7, `baseRev`) → `auditLocal`. If anything throws, nothing is written.
- [ ] Group writes: a voucher group (e.g. PURCHASE + linked PAYMENT) is written in one tx with a shared `groupId`.
- [ ] Master-data upserts (party, variety, bank, vehicle, place, category) go through the same outbox path. Party `searchKey` is generated here.
- [ ] Same-godown reference checks run before writing (`assertSameGodown`). An edit can never change `godownId`.
- [ ] Edit rules: the day must be open (DayStatus/lockAfterDays) and the role must allow it. The `entry` role gets a 30-minute / not-yet-synced window.
- [ ] `dailyAgg` rebuild-from-scratch function.
- [ ] Query helpers (`src/client/queries/ledger.ts`, `stock.ts`): account balance, party balance, stock by variety. All take `godownId`.

### C. Godowns
- [ ] Redux `activeGodown` slice persisted in `meta`. The last active godown is restored per device.
- [ ] `GodownSwitcher` header component ("গোডাউন: রামপুর ▾"). It confirms if a form is dirty and only lists godowns the user can access.
- [ ] Server `godownService.create()` (owner, online): writes the godown doc, a unique code, seeded chart of accounts, TRANSIT location, seeded varieties and categories (§24), and default `GodownSettings`. Archive → read-only.

### D. Server foundation (`src/server`)
- [ ] `db.ts`: MongoClient cached on `globalThis`, `maxPoolSize: 5`, `serverSelectionTimeoutMS: 8000`. Money as `Long`. `ensureIndexes()` per §8.5.
- [ ] `.env.example` with every var from §18.2.
- [ ] `scripts/seed.ts`: `pnpm seed --owner-phone= --owner-name= [--godown-name= --godown-code=]`.
- [ ] `/api/health` (no DB, returns server time for the skew check).

### E. Auth & RBAC
- [ ] Password hashing (`@node-rs/argon2`, or `bcryptjs` cost ≥ 12 if native builds fail on the host).
- [ ] `/api/auth/login`: phone + password + device info. Registers the device and assigns its code (A…Z, AA…). Returns a 15-minute access JWT (`jose`) and sets the refresh cookie (90 days, rotating, httpOnly, Secure, SameSite=Strict, bound to deviceId). Rate-limited per phone + IP (Mongo TTL).
- [ ] `/api/auth/refresh` (rotation + reuse detection), `/api/auth/logout`.
- [ ] `rbac.ts`: `can(user, godownId, action)` per §2. The owner has every godown. Includes the `consolidated` flag.
- [ ] Revoked device → 401 `DEVICE_REVOKED`. The client locks but does **not** wipe data.
- [ ] Offline PIN (`src/client/auth/pin.ts`): PBKDF2-SHA256 with ≥ 200k iterations and a per-device salt (WebCrypto), stored in Dexie.
- [ ] Pages: `(auth)/login` (with a language picker) and `(auth)/unlock` (PIN). Session state lives in Redux.
- [ ] Logout is blocked while ops are pending (shows the count).

### F. Sync engine
- [ ] `/api/sync/push` → `src/server/apply/applyOp.ts`: batches of ≤ 50 ops, each in a Mongo transaction. Steps: idempotency (`appliedOps`), authZ per godown/role, archived-godown check, `DAY_LOCKED` (with the late-entry flag on DayStatus when the server accepts an offline-created voucher for a closed day), `CROSS_GODOWN_REFERENCE`, `GODOWN_IMMUTABLE`, Zod, recompute → `CALC_MISMATCH`, baseRev conflict, then write doc + ledgerLines + stockMoves + `$inc` serverSeq + changelog + appliedOps + audit. Responds with result codes per §12.3.
- [ ] Conflict policy §12.5: masters use field-level LWW with a `conflicts` collection. Vouchers never auto-merge, so they become conflict items. Void beats edit.
- [ ] `/api/sync/pull?since=&limit=500`: filtered to accessible godowns plus global docs, includes derived lines/moves, `nextSince`, `hasMore`, `accessChanged`.
- [ ] Client `src/client/sync`: `push.ts` (delete from the outbox only on applied/duplicate; pause dependent ops on error), `pull.ts` (skip entities with pending local ops; save the cursor after commit), `engine.ts` (exponential backoff 2s→5min with jitter, where network errors are not rejections), `triggers.ts` (§12.6), `locks.ts` (Web Locks + Dexie meta fallback), BroadcastChannel multi-tab, online detection via `/api/health`.
- [ ] Bootstrap: a paged initial pull with a progress bar. On `accessChanged`: pull newly granted godowns from the start, and purge revoked godowns **only after** their pending ops are pushed.
- [ ] Token expiry while online: pause sync, show a non-blocking re-login banner, keep the outbox intact.
- [ ] `(app)/sync` page lists every pending/error/conflict op in plain language with retry. The conflict view shows the two versions side by side (Keep server / Apply mine as new revision). A sync badge component appears in the header.

### G. PWA shell
- [ ] Serwist in **configurator mode** (≥ 9.4, current docs), precaching the app shell, **all routes**, fonts and icons. `NetworkOnly` for `/api/*`, `CacheFirst` for static assets, plus an offline fallback page.
- [ ] `app/manifest.ts` per §13 (bilingual shortcuts, icons 192/512/maskable + Apple touch icon).
- [ ] Install prompt (`beforeinstallprompt`) plus iOS instructions.
- [ ] Update flow: prompt "নতুন সংস্করণ এসেছে". Activate only on tap, and never while the outbox is sending or a form is dirty.
- [ ] `navigator.storage.persist()` after login, with a one-time explanation if denied.
- [ ] Device clock skew warning (> 5 min).
- [ ] Security headers/CSP in `next.config` (self + fonts, `X-Frame-Options: DENY`, Referrer-Policy).

### H. Tests
- [ ] Repo tests (fake-indexeddb): a create/edit/void tx writes everything or nothing; ledger is balanced; numbering per godown/device/type.
- [ ] Sync suite (§19.1) with `mongodb-memory-server` **replica set**: idempotent re-push; two offline devices → totals = sum; edit/edit → conflict, no silent overwrite; network error after apply → retry → `duplicate`, no double posting; pull with local pending edits preserves local; token expiry mid-queue resumes.
- [ ] Godown isolation tests (§19.1): A never changes B (G10 end to end through repo + sync); server rejects cross-godown refs; server rejects a `godownId` change; pull for a user with access to A only never returns B docs, lines or changelog; revoke purges B only after B's ops are pushed; "All godowns" totals == Σ.
- [ ] RBAC tests: a crafted push to a godown without access is rejected; a role without permission is rejected.
- [ ] Playwright setup (mobile viewport). **Cold-offline test:** log in online → close → network off → open start URL → visit every existing route via the UI **and** by direct URL → reload → still works.

## Key files
`src/client/db/*`, `src/client/repo/*`, `src/client/sync/*`, `src/client/auth/*`, `src/client/godown/*`, `src/server/{db,auth,rbac}.ts`, `src/server/apply/*`, `src/app/api/{auth,sync,health}/**`, `src/app/(auth)/**`, `src/app/(app)/sync/page.tsx`, `src/app/sw.ts`, `src/app/manifest.ts`, `scripts/seed.ts`, `.env.example`, `tests/sync/**`, `tests/e2e/offline.spec.ts`

## Exit criteria (all must pass)
```
pnpm typecheck && pnpm lint && pnpm check:no-float
pnpm test              # includes repo, sync, isolation and RBAC suites
pnpm build
pnpm test:e2e          # cold-offline acceptance on the (mostly empty) app
```
Also, in a scripted test, create, edit and void vouchers offline in two godowns. Dexie ledgers must be correct and isolated, and after sync the server totals must equal the device totals.

## Do NOT do in this phase
Feature screens (purchase, sale and so on), the dashboard, reports, reminders/push and the onboarding wizard belong to later phases. Simple debug/dev pages to exercise the repo are fine, but delete them or keep them behind a dev flag.
