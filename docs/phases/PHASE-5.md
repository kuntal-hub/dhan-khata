# Phase 5: Reminders, Reports, Export, Ops & Hardening (spec P9 + P10 + automatable P11)

## Goal
Finish v1: reminders + web push, every report, complete settings, integrity checks, the first-run onboarding wizard, backup/restore/cron ops, deployment config and docs, plus a final hardening pass (performance, accessibility, translation completeness, full e2e in both languages). Leave a UAT checklist for the human parallel-run week.

## Read from `requirement.md`
§9.13 Reminders · §9.14 Reports · §9.16 Settings · §10 Go-live / opening balances · §6.6 Integrity check · §16 Errors & observability · §17 Backup/export/retention · §18 Deployment · §19 Testing & acceptance (incl. 19.2, 19.3) · §15 Performance budgets · §11.4 "Tests" + "PWA" · §13 acceptance test · §14 security (re-verify)

## Checklist

### A. Reminders §9.13
- [ ] Reminder centre: Today / Overdue / Upcoming tabs, mark done, snooze (1 day / 3 days / pick date), manual reminders, cheque-date reminders.
- [ ] Auto-close a reminder when its related bill becomes Settled.
- [ ] In-app badge + a banner on open (works offline).
- [ ] Web Push: VAPID keys, `/api/push/subscribe` + `/unsubscribe`, a service worker push handler, bilingual digest text. The digest is sent from `/api/cron/daily` at the configured time (default 08:00 IST).

### B. Reports §9.14 (all for the active godown, lazy-loaded route chunks)
- [ ] Shared report frame: date presets (আজ, গতকাল, এই সপ্তাহ, এই মাস, এই সিজন, এই অর্থবছর, custom), filters, totals row, Print (HTML with godown letterhead), Excel (`exceljs`, i18n headers and sheet names), share as image for short reports.
- [ ] Day book · Cash book / Bank book · Party statement · Purchase register · Sales register · Load register · Stock register/summary · Outstanding & aging · Expense report · Vehicle P&L · Shortage report.
- [ ] Owner only: Profit & loss · Load profitability · Trial balance ("Advanced").
- [ ] Season summary.
- [ ] Owner/consolidated: Godown comparison · All-godowns stock (variety × godown) · All-godowns cash & bank.
- [ ] `recharts` only inside reports.
- [ ] Every report reconciles with ledger totals (tests).

### C. Settings completion §9.16
- [ ] My preferences: language, digits, weight display, theme, change password/PIN.
- [ ] App (owner): godowns, users with per-godown access and roles + `consolidated`, devices (revoke), default language for new users, reminder digest time.
- [ ] Storage usage gauge (per godown, from the server), Force full resync, Diagnostics (`clientErrors` uploaded on sync; a per-route error boundary with "রিপোর্ট পাঠান").
- [ ] About: version, last sync, pending ops count, **"Export unsynced data"** (outbox + affected docs as JSON) and re-import on another device.

### D. Integrity §6.6
- [ ] On-device check after every sync and on demand: trial balance, re-run postLedger/postStock per voucher, outbox age.
- [ ] `/api/admin/integrity` (owner) compares per-account totals with the device → "✅ সার্ভারের সাথে মিলেছে" or the exact accounts that differ.

### E. Onboarding §10
- [ ] First-run wizard (owner, online): language → owner profile → create the first godown (reuse the Phase 4 godown setup wizard) → invite users with per-godown access.
- [ ] Opening balances: bulk party-balance entry screen. If `OPENING_BAL` doesn't net to zero, show the difference as মূলধন (capital) with a confirm.

### F. Backup, export, ops §17–18
- [ ] Full backup JSON (active godown or all godowns, owner) and an Excel workbook per godown (parties, vouchers, ledger, stock, balances).
- [ ] Restore from backup JSON into an **empty** DB (setup wizard option) + `docs/RESTORE.md`.
- [ ] `/api/cron/daily` (protected by the `CRON_SECRET` header): pings the DB (prevents Atlas auto-pause), sends the push digest, recomputes the integrity summary.
- [ ] `.github/workflows/nightly-backup.yml` (02:00 IST: mongodump --archive --gzip → encrypt with age/gpg → artifact with 30-day retention, using a client matrix and per-client secrets), `daily-cron.yml` (07:55 IST), and a weekly storage check (alert at > 400 MB).
- [ ] Basic FY close ("বছর বন্ধ"): export the FY and compact changelog/appliedOps (TTL). Document the archive path.
- [ ] `deploy/netlify.toml` and host-adapter notes. A final `.env.example`. `docs/OPERATIONS.md` (per-client setup: Atlas project in Mumbai, Netlify site, env vars, seed, VAPID, GitHub secrets). `docs/CHANGELOG.md`.

### G. Hardening
- [ ] Performance: Home route JS < 250 KB gzipped (check with a bundle analyzer); reports, charts, exceljs and html-to-image are lazy-loaded; 10k-row lists are virtualized. Lighthouse mobile Performance ≥ 85 and installability passes.
- [ ] Accessibility: WCAG AA contrast, labels, focus states, icon sr-text, `prefers-reduced-motion`.
- [ ] i18n: every key has a non-empty bn + en value, no unused keys, no JSX literals. Playwright visual snapshots at 360 px in **both** languages for the main screens.
- [ ] Security re-check: crafted-request tests proving a user without godown access gets nothing from push, pull, reports, export or integrity. Rate limits, CSP and cookies verified.
- [ ] **Full daily-flow e2e in bn and en** (§19.1): opening → purchases → load → sale → mill receipt via driver cash → expenses → day close, asserting every dashboard number. Includes the complete §13 offline acceptance test (create purchase, payment, load and expense offline → reload → online → outbox drains → server ledger totals identical).
- [ ] Test restore: back up the mongodb-memory-server DB → restore into an empty one → identical ledger totals.
- [ ] `docs/UAT-CHECKLIST.md`: the steps for the one-week parallel run per godown, the cash and party reconciliation procedure, one English user and one Bengali user, testing on the client's real phones and on a cheap Android in a low-network area, the translation review by a native speaker, and the list of open items from `docs/CLIENT-DEFAULTS.md` to confirm with the client.

## Exit criteria (all must pass)
```
pnpm typecheck && pnpm lint && pnpm check:no-float
pnpm test         # incl. report reconciliation, integrity, restore round-trip, isolation crafted-requests
pnpm build
pnpm test:e2e     # full daily flow bn + en, offline acceptance §13, visual snapshots
```
Every **automatable** item of DoD §19.3 is met. Record the Lighthouse score and the Home JS size in the handoff entry.

## After this phase
v1 is ready to deploy. What remains is human work: deploying each client (per `docs/OPERATIONS.md`) and running the UAT week (per `docs/UAT-CHECKLIST.md`). Fix bugs found during UAT in follow-up sessions, e.g. "fix UAT issue: …".
