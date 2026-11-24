/**
 * Excel workbook of ONE godown (spec §17.1): parties, vouchers, ledger, stock, party balances,
 * with headers and sheet names in the current UI language. Exact decimals (no float).
 */
import type { TKey } from "@/i18n/translate";
import { db } from "../db/dexie";
import { partyBalances } from "../queries/parties";
import { stockByVariety } from "../queries/stock";
import { amountOf } from "../ui/amount";
import type { SheetSpec } from "./excel";

export async function godownWorkbook(
  godownId: string,
  t: (k: TKey) => string,
  label: { variety: (id: string) => string },
): Promise<SheetSpec[]> {
  const d = db();
  const [parties, vouchers, lines, stock, balances] = await Promise.all([
    d.parties.where("godownId").equals(godownId).toArray(),
    d.vouchers.where("godownId").equals(godownId).toArray(),
    d.ledgerLines
      .where("[godownId+date]")
      .between([godownId, ""], [godownId, "￿"], true, true)
      .toArray(),
    stockByVariety(godownId),
    partyBalances(godownId),
  ]);
  const partyName = new Map(parties.map((p) => [p._id, p.name]));
  vouchers.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return [
    {
      name: t("backup.sheet.parties"),
      headers: [t("party.name"), t("party.phone"), t("party.village"), t("party.roles")],
      rows: parties.map((p) => [p.name, p.phone ?? "", p.village ?? "", p.roles.join(", ")]),
    },
    {
      name: t("backup.sheet.vouchers"),
      headers: [
        t("reports.col.date"),
        t("reports.col.number"),
        t("reports.col.type"),
        t("reports.col.party"),
        t("reports.col.amount"),
        t("filters.status"),
      ],
      rows: vouchers.map((v) => [
        v.date,
        v.number,
        t(`voucherType.${v.type}` as TKey),
        "partyId" in v ? (partyName.get(v.partyId as string) ?? "") : "",
        amountOf(v).toString(),
        v.status,
      ]),
      moneyCols: [4],
    },
    {
      name: t("backup.sheet.ledger"),
      headers: [
        t("reports.col.date"),
        t("reports.col.account"),
        t("reports.col.debit"),
        t("reports.col.credit"),
        t("reports.col.number"),
      ],
      rows: lines.map((l) => [l.date, l.account, l.debitPaise, l.creditPaise, l.voucherId]),
      moneyCols: [2, 3],
    },
    {
      name: t("backup.sheet.stock"),
      headers: [t("reports.col.variety"), t("stockPage.qty"), t("reports.col.value")],
      rows: stock
        .filter((s) => s.location === "STORE")
        .map((s) => [label.variety(s.varietyId), s.qtyG.toString(), s.valuePaise.toString()]),
      weightCols: [1],
      moneyCols: [2],
    },
    {
      name: t("backup.sheet.balances"),
      headers: [t("reports.col.party"), t("reports.col.balance")],
      rows: [...balances]
        .filter(([, b]) => b !== 0n)
        .map(([id, b]) => [partyName.get(id) ?? id, b.toString()]),
      moneyCols: [1],
    },
  ];
}
