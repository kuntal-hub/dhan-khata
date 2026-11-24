# Migration v1 (Dhan Khata) → v2 (Dhan Gola)

Applies to every client deployment that ran v1. Each client has its own deployment and its own database, so do these steps once per client.

## What changes in the data

| v1 | v2 |
|---|---|
| `vouchers` (PURCHASE, SALE, LOAD, PAYMENT, RECEIPT, EXPENSE, TRIP, CONTRA, STOCK_ADJUST, MILL_SETTLEMENT, DAY_CLOSE, OPENING) with one `date` | v2 documents in the same `vouchers` collection (DECISIONS D1), each with its own dates (`transactionDate`, `expenseDate`, `paymentDate`, …) and `entryDate` |
| paid-now / advance / vehicle advance as linked PAYMENT / RECEIPT vouchers | `Payment` documents with `source {type, id}` and `isInitial: true` |
| PAYMENT / RECEIPT with allocations | one `Payment` per allocated bill (shared `groupId`); the rest is a `PARTY_ADVANCE` payment |
| PAYMENT / RECEIPT "BILL" without allocations | allocated **FIFO** (oldest bill first) at migration time; the rest is an advance |
| EXPENSE paid immediately | `Expense` + `Payment(EXPENSE)` dated the old date (`<id>~pay`) |
| EXPENSE on credit | `Expense` owed to the payee party |
| SALE freight paid by us | `Expense(TRANSPORT)` owed to the transporter (`<id>~frt`) |
| SALE freight paid by the mill (deducted from our bill) | `Expense(TRANSPORT)` owed to (deducted by) the buyer |
| MILL_SETTLEMENT difference | `SecondParty` entry with the buyer (party balance unchanged) |
| LOAD (own trade) → generated PURCHASE + SALE | `Load` register entry linked to its sale; the purchase and sale are kept as they were (no duplicates) |
| LOAD (agent) commission | `SecondParty` "they owe" entry with the payer (`<id>~com`) |
| TRIP expenses paid / on credit, advance | trip costs (driver / diesel / other) + `Payment(VEHICLE_COST)` for paid ones; advance → `Payment(VEHICLE_TRIP)` |
| cheque receipt, cleared | `Payment(BANK)` on the **clearing date**; the CHEQUE_CLEAR contra is absorbed |
| cheque receipt, bounced | the receipt `Payment` is voided (reason `CHEQUE_BOUNCED`); the bounce contra is absorbed |
| cheque receipt, still in hand | `Payment(BANK)` on the receipt date (**intentional change**: v2 has no cheque-in-hand stage) |
| party roles `farmer/party/mill/…` | `FARMER`, `CUSTOMER + SECOND_PARTY`, `MILL`, `DRIVER`, `LABOUR`, `SUPPLIER` (pump), `OTHER` (transporter/other), `GOLA` (godown) |
| — | `businesses` collection (one business, from the owner and the first Gola's firm name); `businessId` on users, Golas and every record |
| stock moves `STORE`/`TRANSIT` | `PADDY` × `WAREHOUSE`/`TRANSIT` (re-posted from the documents) |
| automatic reminders | dropped: v2 derives them from due dates; manual reminders are kept |
| pending inter-godown receipts (`transfers`) | cleared (v2 inter-Gola transfers are written as a pair) |

### Intentional semantic changes (allowed in the reconciliation)
1. **Cheques in hand** move into the bank balance (v1 `CHEQUE_IN_HAND` → `BANK:<account>`).
2. Profit-and-loss accounts that v2 does not have: settlement differences and agent commissions post to `SP_CLEARING` instead of `SALES_DEDUCTION` / `SALES` / `COMMISSION_INCOME`. Trip costs `TOLL`, `LOADING`, `UNLOADING` and `REPAIR` become `OTHER` (the original kind is kept in the cost's note).
3. A cleared cheque is dated on its clearing date (v1 credited the party on the receipt date).
4. Payment due dates (v1 advances) are dropped; manual reminders cover them.

Every **party balance, cash, each bank account and paddy stock (quantity and value) per variety and location** is checked to be identical before and after, except for change 1.

## Steps (per client)

1. **Deploy nothing yet.** Make a fresh backup: the nightly `mongodump` artifact, or `GET /api/admin/backup` as the owner.
2. **Rehearse on a copy** (reads the live database only; it writes into a throw-away in-memory MongoDB):
   ```
   pnpm migrate:v2 --copy-to-memory
   ```
   The output must end with `reconciliation: OK` and `verify: stored == re-posted: yes; every Gola balanced: yes`. Read the `allowed` lines: each must be an expected cheque-in-hand amount.
3. **Dry run on the real database** (writes nothing):
   ```
   pnpm migrate:v2
   ```
4. Ask every device to **sync** (Sync screen → "এখনই সিঙ্ক"). Unsynced v1 entries are not lost if this is missed (see "Devices" below), but synced data is simpler.
5. **Apply** (one transaction, idempotent: a `migrations` marker stops a second run):
   ```
   pnpm migrate:v2 --apply
   ```
6. **Deploy v2** (Netlify: push the branch / promote the deploy).
7. Open the app on each device. On first start the Dexie **v4** upgrade runs (below).

Rollback: restore the step-1 backup into an empty database (`docs/RESTORE.md`) and redeploy the v1 build.

## Devices (Dexie v3 → v4)
- The upgrade **never drops unsynced work**. Every pending v1 outbox op, together with all local v1 documents (the converter needs them as context), is moved to the `legacyV1` meta record. Then the business tables are cleared and the cursor reset, so the device downloads the migrated server data in full.
- After the first v2 pull (when the business id is known), `replayLegacyV1` converts the held ops with the same converter as the server, so the ids and revisions match. It queues them again as v2 operations in one op group. Pending reminder and settings ops are not replayed; they are re-entered in v2.
- The device id, PIN, session and voucher-number sequences are kept.

## Verified on
- 2026-11-25, demo database (2 Golas, 233 v1 vouchers): the `--copy-to-memory` rehearsal reconciled 39 figures. The only `allowed` difference was a ₹75,922 cheque in hand moving to the bank. After applying, the stored lines equal a fresh re-post and both Golas balance. **The live database was not modified.**
