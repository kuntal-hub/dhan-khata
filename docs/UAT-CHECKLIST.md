# UAT checklist — one-week parallel run (spec §19.2, §19.3)

Goal: for **every godown**, run Dhan Khata next to the paper khata for one real week and make
every day's cash and every party balance agree **to the rupee**. Nothing goes live until this
sheet is fully ticked and signed by the owner.

## 0. Before day 1 (developer + owner, ~2 hours, online)
- [ ] Deployment per `docs/OPERATIONS.md`: Atlas (Mumbai), Netlify, env vars, GitHub secrets,
      nightly backup ran once and **a test restore succeeded** (`docs/RESTORE.md`).
- [ ] Owner seeded; first-run wizard done: language, owner name, first godown (profile, code,
      varieties, bank accounts with opening balances, opening cash, opening stock).
- [ ] Opening party balances entered (Settings → এই গোডাউন → শুরুর বাকি / অগ্রিম) from the
      paper khata; the capital difference confirmed with the owner.
- [ ] Every other godown added (More → গোডাউন → + নতুন গোডাউন) with its own opening balances.
- [ ] Staff added (Settings → Users & devices) with the right role per godown. **At least one user
      works in English and one in Bengali** for the whole week.
- [ ] App installed on every phone (Home → “অ্যাপ ইনস্টল করুন”), PIN set, phone reminders on.
- [ ] Owner → Settings → Integrity check → *Compare with the server* = ✅ for each godown.

## 1. Every day of the week (each godown)
Morning
- [ ] Dashboard “আজ শুরুর ক্যাশ” = paper khata opening cash.
- [ ] Reminders due today match what the owner expects (তাগাদা list).

During the day — enter **everything** in the app as it happens, also on paper:
- [ ] Purchases (with paid-now), payments, advances (দাদন).
- [ ] Loads (one entry creates the purchase + sale), store sales, mill receipts (incl. cash sent
      with the driver), mill settlements when the mill weight arrives.
- [ ] Expenses (labour, transport, others), vehicle trips, cash deposits/withdrawals.
- [ ] At least once in the week: an entry made **offline** (aeroplane mode), synced later.

Evening — **reconciliation**
- [ ] Count the cash box. Day close (দিন শেষ করুন): counted vs expected. Any difference ≠ 0
      must be explained in the note and matched against the paper khata.
- [ ] Day book report (Reports → দৈনিক খাতা) total cash column = paper day total.
- [ ] 3 random parties: app khata balance = paper balance (Parties → party → খাতা).
- [ ] Sync badge green (সব সিঙ্ক) on every phone; nothing stuck on the Sync screen.

## 2. End of the week (each godown)
- [ ] **Every** party balance: Reports → বাকি ও কতদিনের বাকি vs the paper khata, to the rupee.
      Differences found → fix the entry (edit with reason), never by a manual adjustment.
- [ ] Stock: Stock page per variety vs the physical/paper stock; record a physical count
      (স্টক → গুনে মেলান) for any real shortage (drying, rodents, wet).
- [ ] Bank books vs the bank passbook/statement; cheques in hand vs the cheques physically held.
- [ ] Trial balance (owner, Reports → Advanced) says “ডেবিট = ক্রেডিট”.
- [ ] Integrity check → *Compare with the server* = ✅ “সার্ভারের সাথে মিলেছে” for each godown.
- [ ] Two-godown check: an entry in godown A never shows in godown B; the owner’s “সব গোডাউন”
      totals equal the sum of the godowns.
- [ ] Download a full backup (Settings → Backup & export) and one Excel workbook per godown;
      open them on a computer.

## 3. Devices and network
- [ ] On the client's **actual phones** and on **one cheap Android** (2–3 GB RAM): cold start with
      mobile data off opens the app and every screen; entries work; data syncs when back online.
- [ ] In a **low-network area** (the godown / village): a full day of entries with flaky data,
      then the outbox drains without duplicates (Sync screen empty, integrity ✅).
- [ ] Home opens in under ~1.5 s after the first install; lists scroll smoothly.
- [ ] Printing / sharing a purchase receipt and a party khata as an image on WhatsApp.
- [ ] Bengali conjuncts (ক্ষ, ন্দ্র, স্ব, ত্ত) render correctly on screen, on receipts and in
      shared images on those phones.

## 4. Language review
- [ ] A **native Bengali speaker** (ideally the owner or the munshi) reads every screen, report,
      receipt, notification and WhatsApp message in বাংলা and marks anything unnatural or unclear
      (terms must match the glossary in `requirement.md` §1.2).
- [ ] The English user does the same for English.
- [ ] Numbers with বাংলা digits and with English digits both read correctly; amounts in words on
      receipts are right in both languages.

## 5. Open questions to confirm with the client (`docs/CLIENT-DEFAULTS.md`)
Confirm or change each default; note the answer and the date.
- [ ] #1 ধলতা per quintal / per bag / fixed; moisture cut for farmers?
- [ ] #2 Quote prices in মণ (40 kg)?
- [ ] #3 Round bills to the rupee?
- [ ] #4 Agent (commission-only) loads used?
- [ ] #5 Mill payment bank: ours, the mill's, or both?
- [ ] #6 Who pays freight; does the mill pay the driver and deduct?
- [ ] #7 Own vehicle with own load: costs only, or internal freight?
- [ ] #8 Staff count; should entry staff see amounts/rates? (UI restriction not yet built)
- [ ] #9 Restart voucher numbers every financial year?
- [ ] #10 Profit on the dashboard: owner only, hidden by default?
- [ ] #11 Stay on Netlify Free (vs Vercel Pro)?
- [ ] #12 Paddy/money transfers between godowns used? Pending-receipt flow OK?
- [ ] #13 Bank accounts and vehicles registered per godown?
- [ ] #14 Who else may see “সব গোডাউন”?
- [ ] #15 Separate stock per shed needed (v2)?
- [ ] #16 Language per staff member; receipts Bengali-only or both?
- [ ] #17 Entry-role 30-minute edit window OK?
- [ ] #18 Mill TDS recorded only?
- [ ] #19 All-godowns view: inter-godown balances shown separately (no elimination)?
- [ ] Phase 4/5 choices: unlocking a closed day cancels its close (re-close needed); reminder
      digest time (default 08:00).

## Sign-off
| Godown | Week (from – to) | Cash matched every day | All party balances matched | Owner signature |
|---|---|---|---|---|
| | | ☐ | ☐ | |
| | | ☐ | ☐ | |
