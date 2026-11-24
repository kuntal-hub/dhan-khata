# Operations — per-client setup and running (spec §17–18)

One codebase, **one deployment per client**: its own Netlify site, its own Atlas project, its own
users and data. Deploy every client on each release (same git tag).

## 1. MongoDB Atlas (free M0, region Mumbai `ap-south-1`)
1. New Atlas **project** per client (e.g. `dhan-khata-client-a`) → create a free **M0** cluster in
   **Mumbai**.
2. Database Access → add user `dhan_khata_app` with **readWrite on `dhankhata` only** and a long
   generated password. Optionally a second user `dhan_khata_backup` with `read` for backups.
3. Network Access → `0.0.0.0/0` (serverless hosts have no fixed IP; the strong password compensates).
4. Copy the SRV connection string → `MONGODB_URI`.

## 2. Secrets for the app (Netlify → Site configuration → Environment variables)
Generate fresh values per client (never reuse between clients):
```
MONGODB_URI=mongodb+srv://dhan_khata_app:<password>@cluster0.xxxx.mongodb.net/
MONGODB_DB=dhankhata
AUTH_JWT_SECRET=<node -e "console.log(require('crypto').randomBytes(48).toString('base64'))">
AUTH_REFRESH_SECRET=<another one>
CRON_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY=<node -e "console.log(require('web-push').generateVAPIDKeys())">
VAPID_SUBJECT=mailto:<your email>
NEXT_PUBLIC_APP_NAME=ধান খাতা
NEXT_PUBLIC_CLIENT_SLUG=client-a
TZ=Asia/Kolkata
```
Changing `AUTH_*` logs everybody out (their offline data stays and syncs after the next login).
Changing VAPID keys means each phone must turn phone reminders on again.

## 3. Netlify site
1. New site from the private GitHub repo. Build settings come from `deploy/netlify.toml`
   (copy it to the repo root as `netlify.toml`, or point the site's config path at it).
2. Add the environment variables above. Node 24, `pnpm build`.
3. Optional custom domain. HTTPS is automatic.
4. Open `https://<site>/api/health` → `{"ok":true}`.

## 4. First owner (seed)
On your machine, with that client's `MONGODB_URI` in `.env.local`:
```
pnpm seed --owner-phone=98xxxxxxxx --owner-name="Owner name"            # prints a one-time password
# or also create the first godown:
pnpm seed --owner-phone=… --owner-name=… --godown-name=Rampur --godown-code=RP
```
Without `--godown-*`, the owner's first login opens the **first-run wizard** (language → name →
first godown with opening balances → invite staff). The wizard can also restore a backup.

## 5. GitHub Actions (repository → Settings → Secrets and variables → Actions)
Per client (suffix `CLIENT_A`, `CLIENT_B`, … — add a matrix entry in each workflow):

| Secret | Used by | Value |
|---|---|---|
| `MONGODB_URI_CLIENT_A` | nightly-backup | the client's URI (the read-only backup user is enough) |
| `APP_URL_CLIENT_A` | daily-cron, storage-check | `https://client-a.netlify.app` (no trailing slash) |
| `CRON_SECRET_CLIENT_A` | daily-cron, storage-check | same as the site's `CRON_SECRET` |
| `BACKUP_AGE_RECIPIENT` | nightly-backup | your `age` public key (`age-keygen -o dhan-khata-backup.key`) |

Workflows:
- `nightly-backup.yml` — 02:00 IST `mongodump --archive --gzip` → encrypted with `age` → artifact,
  kept 30 days. **Keep the private age key safe and offline**; without it backups can't be read.
- `daily-cron.yml` — every hour 06:00–22:00 IST `POST /api/cron/daily`: pings the DB (prevents the
  Atlas free cluster's 30-day pause), sends the reminder digest once a day at the owner's chosen
  hour (Settings → App settings, default 08:00), refreshes the integrity summary.
- `storage-check.yml` — Mondays: fails (→ GitHub emails you) when the database is above 400 MB of
  the 512 MB free tier.
- `ci.yml` — typecheck, lint, tests, build, e2e on every push / PR.

GitHub's free private-repo minutes (2,000/month) cover two clients: ~510 cron runs + ~30 backups
per client per month.

## 6. Release checklist
1. `pnpm typecheck && pnpm lint && pnpm check:no-float && pnpm test && pnpm build && pnpm test:e2e`
2. Bump `version` in `package.json` (shown in Settings → About), update `docs/CHANGELOG.md`, tag.
3. Deploy every client site (Netlify → Deploys → Trigger deploy, or push to the release branch).
4. Phones show “নতুন সংস্করণ” and update when the user taps it (never in the middle of a sync).
5. Check `/api/health` and one owner login per client.
Keep Next.js patched: check its security releases monthly and redeploy all clients.

## 7. Year close and archival (spec §17.4)
1. Owner → Settings → Backup & export → **Download full backup (All godowns)**; keep the file
   (and the nightly archive of the same day) somewhere safe.
2. Owner → Settings → App settings → **Year close — shrink old sync logs**: keeps only the latest
   change entry per document and removes processed-op records older than 30 days. Vouchers,
   ledger lines and balances are **not** touched; phones with any cursor still get every document.
3. If the database still nears 512 MB: create a second free project ("archive"), restore the
   closed year's backup there (docs/RESTORE.md, path B) as a read-only reference, then — only
   with the owner — upgrade the live cluster (Atlas Flex/M10) rather than deleting history.
   Moving old ledger lines out of the live database is **not** automated in v1.

## 8. Troubleshooting
- A phone shows “অন্য ফোনের তথ্য …” / stuck items: Sync screen lists every waiting item with retry;
  Settings → About → *Export unsynced data* saves them; *Import data from another phone* re-queues
  them on a working phone.
- Problem reports: owner → Settings → App settings → Problem reports (sent from the error screen).
- Integrity: owner → Settings → Integrity check (device checks + comparison with the server).
