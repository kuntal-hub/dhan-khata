# Restore (spec §17.2)

There are two kinds of backup. Use the matching restore path.

| Backup | Made by | Restore with |
|---|---|---|
| **Nightly archive** `client-a-YYYY-MM-DD.archive.gz.age` | GitHub Actions `nightly-backup.yml` (`mongodump`, encrypted with `age`) | `mongorestore` (exact copy of the whole database) |
| **In-app full backup** `dhan-khata-backup-<all\|CODE>-YYYY-MM-DD.json` | Owner → Settings → Backup & export | `pnpm restore --file=…`, or Settings → Backup → Restore (empty database only) |

Always restore into a **new, empty** database first, check it, then point the app at it.

## A. From a nightly archive (preferred for disaster recovery)

1. Download the artifact: GitHub → Actions → *Nightly backup* → the run → Artifacts.
2. Decrypt with your private age key:
   `age -d -i ~/dhan-khata-backup.key -o dump.gz client-a-2026-11-24.archive.gz.age`
3. Restore into an empty database (new Atlas cluster, or a new database name):
   `mongorestore --uri="mongodb+srv://USER:PASS@NEW-CLUSTER/" --archive=dump.gz --gzip`
4. Set the Netlify env var `MONGODB_URI` (and `MONGODB_DB` if renamed) and redeploy.
5. On every phone: Settings → About → *Download everything again from the server*. This works only
   when nothing is waiting to sync on that phone; otherwise let it sync first.
6. Owner → Settings → Integrity check → *Compare with the server* for each godown. It must say
   “✅ সার্ভারের সাথে মিলেছে”.

## B. From an in-app JSON backup

The JSON holds godowns, masters, vouchers, reminders, day status and transfers. Ledger lines and
stock moves are **rebuilt** by re-posting every voucher, so the totals are identical to the source.

- CLI (any machine with the repo and Node 24): put the target `MONGODB_URI` in `.env.local`, then
  `pnpm restore --file=dhan-khata-backup-all-2026-11-24.json [--db=dhankhata]`
- In the app: seed the owner on the new deployment (`pnpm seed …`, no godown) and log in. The
  first-run screen offers *Start from an earlier backup*; Settings → Backup & export →
  *Restore from a backup* does the same.

Both refuse when the database already has a godown (`BAD_REQUEST: not-empty`). Users are **not**
part of the JSON backup: re-create staff in Settings → Users & devices after a restore.

## Test restore (Definition of Done §19.3)

Before go-live, and then monthly per client: restore last night's archive into a scratch database
(step A.3 with `--nsFrom="dhankhata.*" --nsTo="restoretest.*"`), point a local `pnpm dev` at it
(`MONGODB_DB=restoretest`), run the integrity check and compare a few party balances with the live
app, then drop the scratch database. The automated equivalent runs in CI
(`tests/sync/phase5.test.ts`, “backup → restore”).
