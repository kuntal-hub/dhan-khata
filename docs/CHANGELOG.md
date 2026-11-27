# Changelog

## Due dates and part-payments (D54, 2026-11-27)
- A due date exists only on a purchase ("বাকি দেওয়ার তারিখ"), a sale and a mill dispatch ("টাকা পাওয়ার
  তারিখ"); optional; today or any future date (quick chips, ✕ clear), never before the deal; a
  past date only warns. Removed from expense, trip and second-party forms (old values kept,
  ignored). The payment date now reads "যেদিন টাকা দেওয়া/নেওয়া হল".
- "তারিখ বদলান" on the deal pages, on each open bill of the party ledger and on automatic
  reminders: changes only the date (no money / stock / revision change; works on closed days;
  last writer wins; audited). A full edit keeps the due date.
- Status Unpaid / Partly paid / Fully paid with "Overdue" as an extra badge; reminders move with the
  due date and close when paid; dashboard alerts cover the next 7 days with a pay / collect button.
- Payment sheet shows total / paid / remaining / due date and the new remaining after saving; the
  history shows the remaining after each payment; a deal's payment can't predate the deal.
- `pnpm fix:due-dates` copies dates changed on the old reminders tab onto their deals.

## v0.1.0 — v1 candidate (2026-11-24)
- Phase 1: domain core — exact money/weight maths, posting for every voucher type, bilingual i18n.
- Phase 2: offline data (Dexie), auth + PIN, sync engine (push/pull, conflicts), PWA shell.
- Phase 3: masters, parties, purchase / sale / load / payment / receipt, mill settlement, prints.
- Phase 4: expenses, cash & bank, day close, dashboard + All-godowns view, vehicles & trips, stock,
  inter-godown transfers, godown management, global search.
- Phase 5: reminder centre + web-push digest, 18 reports (print / Excel / image), settings
  (preferences, users & devices, app settings, storage, diagnostics, about), integrity check,
  first-run onboarding + bulk opening balances, backup / restore, cron jobs, deployment docs.
