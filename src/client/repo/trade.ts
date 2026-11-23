/**
 * Screen-level saves (spec §9.2, §9.3, §9.5, §9.8): each builds its linked vouchers from the
 * finalized primary with the shared domain builders and writes everything in ONE transaction.
 */
import { loadLinkedDrafts } from "@/domain/calc/load";
import { paidNowPaymentDraft } from "@/domain/calc/purchase";
import { saleLinkedDrafts, saleSummary } from "@/domain/calc/sale";
import type { DeductionDefaults, Voucher, VoucherOf } from "@/domain/schemas";
import { META, getMeta, setMeta } from "../db/meta";
import type { WriteCtx } from "./context";
import { reminderId, type ReminderInput } from "./reminders";
import { saveVoucherWithLinked, type SavedGroup, type VoucherDraft } from "./vouchers";

export interface SaveOpts {
  /** Existing primary voucher id (edit). */
  id?: string;
  /** Edit reason (required by the UI after the voucher has synced). */
  reason?: string;
}

// ── Last-used suggestions per party (spec §9 "remember last-used … per party") ──

export interface LastUsed {
  varietyId?: string;
  ratePaisePerQtl?: string;
  deductions?: DeductionDefaults;
  at: string;
}

export function lastUsedKey(godownId: string, partyId: string): string {
  return `lastUsed:${godownId}:${partyId}`;
}

export function getLastUsed(godownId: string, partyId: string): Promise<LastUsed | undefined> {
  return getMeta<LastUsed>(lastUsedKey(godownId, partyId));
}

async function rememberTrade(v: Voucher, ctx: WriteCtx): Promise<void> {
  if (v.type !== "PURCHASE" && v.type !== "SALE") return;
  const l = v.lines[0];
  if (!l) return;
  await setMeta(lastUsedKey(ctx.godown._id, v.partyId), {
    varietyId: l.varietyId,
    ratePaisePerQtl: l.ratePaisePerQtl,
    deductions: {
      ...(l.tarePerBagG ? { tarePerBagG: l.tarePerBagG } : {}),
      ...(l.dhaltaMode ? { dhaltaMode: l.dhaltaMode } : {}),
      ...(l.dhaltaValueG ? { dhaltaValueG: l.dhaltaValueG } : {}),
      ...(l.moistureBps !== undefined ? { moistureBps: l.moistureBps } : {}),
    },
    at: ctx.nowIso,
  } satisfies LastUsed);
  await setMeta(`${META.prefs}:lastVariety:${ctx.godown._id}`, l.varietyId);
}

// ── Purchase ─────────────────────────────────────────────────────────────────

/** Purchase + paid-now PAYMENT (same group) + due-date reminder. */
export function savePurchase(
  godownId: string,
  draft: VoucherDraft,
  opts: SaveOpts = {},
): Promise<SavedGroup> {
  return saveVoucherWithLinked(
    godownId,
    {
      primary: draft,
      linked: (p) => [paidNowPaymentDraft(p as VoucherOf<"PURCHASE">)],
      reminders: (p) => {
        const v = p as VoucherOf<"PURCHASE">;
        const due = BigInt(v.totalPaise) - BigInt(v.paidNow?.amountPaise ?? "0");
        const r: ReminderInput = {
          _id: reminderId(v._id, "PAY_DUE"),
          kind: "PAY_DUE",
          partyId: v.partyId,
          voucherId: v._id,
          dueDate: due > 0n ? v.dueDate : undefined,
          amountPaise: (due > 0n ? due : 0n).toString(),
          title: "",
        };
        return [r];
      },
      after: rememberTrade,
    },
    opts,
  );
}

// ── Sale ─────────────────────────────────────────────────────────────────────

/** Sale + advance RECEIPT + vehicle-advance PAYMENT + loading EXPENSE + payment reminder. */
export function saveSale(
  godownId: string,
  draft: VoucherDraft,
  opts: SaveOpts = {},
): Promise<SavedGroup> {
  return saveVoucherWithLinked(
    godownId,
    {
      primary: draft,
      linked: (s) => {
        const l = saleLinkedDrafts(s as VoucherOf<"SALE">);
        return [
          l.advanceReceipt,
          l.vehicleAdvancePayment,
          l.loadingExpense,
        ] as Array<VoucherDraft | null>;
      },
      reminders: (s) => {
        const v = s as VoucherOf<"SALE">;
        const due = saleSummary(v).netReceivable;
        return [
          {
            _id: reminderId(v._id, "COLLECT_DUE"),
            kind: "COLLECT_DUE",
            partyId: v.partyId,
            voucherId: v._id,
            dueDate: due > 0n ? v.expectedPaymentDate : undefined,
            amountPaise: (due > 0n ? due : 0n).toString(),
            title: "",
          },
        ];
      },
      after: rememberTrade,
    },
    opts,
  );
}

// ── Load ─────────────────────────────────────────────────────────────────────

/** LOAD (+ PURCHASE into TRANSIT when from a party) + exactly ONE SALE, in one group. */
export function saveLoad(
  godownId: string,
  draft: VoucherDraft,
  opts: SaveOpts = {},
): Promise<SavedGroup> {
  return saveVoucherWithLinked(
    godownId,
    {
      primary: draft,
      linked: (l, ctx) => {
        const v = l as VoucherOf<"LOAD">;
        const { purchase, sale } = loadLinkedDrafts(v, ctx.settings.rounding.roundToRupee);
        return [purchase, sale] as Array<VoucherDraft | null>;
      },
    },
    opts,
  );
}

// ── Payment / Receipt ────────────────────────────────────────────────────────

/** PAYMENT/RECEIPT with its reminder (advance adjustment date, cheque date). */
export function saveMoney(
  godownId: string,
  draft: VoucherDraft,
  opts: SaveOpts = {},
): Promise<SavedGroup> {
  return saveVoucherWithLinked(
    godownId,
    {
      primary: draft,
      reminders: (m) => {
        if (m.type !== "PAYMENT" && m.type !== "RECEIPT") return [];
        const out: ReminderInput[] = [];
        // Advance given → we expect goods/adjustment (collect); advance taken → we owe (pay).
        const advKind = m.type === "PAYMENT" ? "COLLECT_DUE" : "PAY_DUE";
        out.push({
          _id: reminderId(m._id, advKind),
          kind: advKind,
          partyId: m.partyId,
          voucherId: m._id,
          dueDate: m.purpose === "ADVANCE" ? m.dueDate : undefined,
          amountPaise: m.amountPaise,
          title: "",
        });
        if (m.type === "RECEIPT") {
          out.push({
            _id: reminderId(m._id, "CHEQUE"),
            kind: "CHEQUE",
            partyId: m.partyId,
            voucherId: m._id,
            dueDate: m.mode === "CHEQUE" || m.mode === "DD" ? m.chequeDate : undefined,
            amountPaise: m.amountPaise,
            title: "",
          });
        }
        return out;
      },
    },
    opts,
  );
}
