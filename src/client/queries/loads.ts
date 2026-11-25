/**
 * Daily Load Khata reads (requirement_v2 §12.5): the register by date / party / mill / vehicle with
 * daily totals, the "যুক্ত নয় / Not linked" flag (a link to a voided record counts as not linked),
 * and link candidates for a load (same date, vehicle, mill, variety first).
 */
import type { Doc, DocOf, Party, Variety } from "@/domain/schemas";
import { db } from "../db/dexie";

export type Load = DocOf<"LOAD">;

export interface LoadRow {
  doc: Load;
  from?: Party;
  mill?: Party;
  second?: Party;
  variety?: Variety;
  /** The active sale / dispatch this load is linked to. */
  linked?: Doc;
}

export interface LoadFilter {
  from?: string;
  to?: string;
  q?: string;
  unlinked?: boolean;
}

export async function loadRows(godownId: string, f: LoadFilter = {}): Promise<LoadRow[]> {
  const d = db();
  const docs = (await d.vouchers
    .where("[godownId+transactionDate]")
    .between([godownId, f.from ?? ""], [godownId, f.to ?? "￿"], true, true)
    .filter((x) => x.type === "LOAD")
    .toArray()) as Load[];
  const [parties, varieties] = await Promise.all([
    d.parties.where("godownId").equals(godownId).toArray(),
    d.varieties.where("godownId").equals(godownId).toArray(),
  ]);
  const p = new Map(parties.map((x) => [x._id, x] as const));
  const v = new Map(varieties.map((x) => [x._id, x] as const));
  const targets = await d.vouchers.bulkGet(
    docs.map((x) => x.link?.id).filter((x): x is string => !!x),
  );
  const t = new Map(
    targets.filter((x): x is Doc => !!x && x.status === "active").map((x) => [x._id, x] as const),
  );
  const s = f.q?.trim().toLowerCase() ?? "";
  const out: LoadRow[] = [];
  for (const doc of docs) {
    const row: LoadRow = {
      doc,
      ...(doc.fromPartyId && p.get(doc.fromPartyId) ? { from: p.get(doc.fromPartyId) } : {}),
      ...(doc.destinationMillId && p.get(doc.destinationMillId)
        ? { mill: p.get(doc.destinationMillId) }
        : {}),
      ...(doc.secondPartyId && p.get(doc.secondPartyId)
        ? { second: p.get(doc.secondPartyId) }
        : {}),
      ...(v.get(doc.varietyId) ? { variety: v.get(doc.varietyId) } : {}),
      ...(doc.link && t.get(doc.link.id) ? { linked: t.get(doc.link.id) } : {}),
    };
    if (f.unlinked && (doc.status !== "active" || row.linked)) continue;
    if (s) {
      const hay = [
        row.from?.name,
        row.from?.searchKey,
        row.mill?.name,
        row.mill?.searchKey,
        row.second?.name,
        row.variety?.name,
        row.variety?.systemKey,
        doc.vehicleNumber,
        doc.driverName,
        doc.number,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      // Vehicle numbers are stored without spaces ("WB12AB3456").
      if (!hay.includes(s) && !hay.includes(s.replace(/\s+/g, ""))) continue;
    }
    out.push(row);
  }
  return out.sort((a, b) =>
    a.doc.transactionDate === b.doc.transactionDate
      ? a.doc.createdAt < b.doc.createdAt
        ? 1
        : -1
      : a.doc.transactionDate < b.doc.transactionDate
        ? 1
        : -1,
  );
}

export type LoadGroupBy = "date" | "party" | "mill" | "vehicle";

export interface LoadGroup {
  key: string;
  rows: LoadRow[];
  totalG: bigint;
  totalPaise: bigint;
  unlinked: number;
}

/** Group active and void rows; totals count active loads only. */
export function groupLoads(rows: readonly LoadRow[], by: LoadGroupBy): LoadGroup[] {
  const m = new Map<string, LoadGroup>();
  for (const r of rows) {
    const key =
      by === "date"
        ? r.doc.transactionDate
        : by === "party"
          ? (r.doc.fromPartyId ?? "")
          : by === "mill"
            ? (r.doc.destinationMillId ?? "")
            : r.doc.vehicleNumber;
    const g = m.get(key) ?? { key, rows: [], totalG: 0n, totalPaise: 0n, unlinked: 0 };
    g.rows.push(r);
    if (r.doc.status === "active") {
      g.totalG += BigInt(r.doc.weight.netG);
      g.totalPaise += BigInt(r.doc.totalPaise);
      if (!r.linked) g.unlinked++;
    }
    m.set(key, g);
  }
  const list = [...m.values()];
  return by === "date"
    ? list.sort((a, b) => (a.key < b.key ? 1 : -1))
    : list.sort((a, b) => (a.totalG > b.totalG ? -1 : a.totalG < b.totalG ? 1 : 0));
}

export interface LinkCandidate {
  doc: DocOf<"SALE"> | DocOf<"MILL_DISPATCH">;
  party?: Party;
  score: number;
}

/**
 * Active sales / dispatches with no active linked load, best matches first (same date, vehicle,
 * mill / buyer, variety).
 */
export async function linkCandidates(
  godownId: string,
  load: Load,
  type: "SALE" | "MILL_DISPATCH",
): Promise<LinkCandidate[]> {
  const d = db();
  const docs = (await d.vouchers
    .where("[godownId+type]")
    .equals([godownId, type])
    .filter((x) => x.status === "active")
    .toArray()) as Array<DocOf<"SALE"> | DocOf<"MILL_DISPATCH">>;
  const loads = (await d.vouchers
    .where("[godownId+type]")
    .equals([godownId, "LOAD"])
    .filter((x) => x.type === "LOAD" && x.status === "active" && !!x.link)
    .toArray()) as Load[];
  const taken = new Set(loads.filter((l) => l._id !== load._id).map((l) => l.link!.id));
  const parties = new Map(
    (await d.parties.where("godownId").equals(godownId).toArray()).map((p) => [p._id, p] as const),
  );
  const out: LinkCandidate[] = [];
  for (const doc of docs) {
    if (taken.has(doc._id)) continue;
    const linked = doc.linkedLoadId;
    if (linked && linked !== load._id) {
      const other = loads.find((l) => l._id === linked);
      if (other) continue;
    }
    const date = doc.type === "SALE" ? doc.transactionDate : doc.dispatchDate;
    const partyId = doc.type === "SALE" ? doc.partyId : doc.millPartyId;
    let score = 0;
    if (date === load.transactionDate) score += 4;
    if (doc.vehicleNumber && doc.vehicleNumber === load.vehicleNumber) score += 4;
    if (load.destinationMillId && partyId === load.destinationMillId) score += 2;
    if (doc.varietyId === load.varietyId) score += 1;
    out.push({ doc, ...(parties.get(partyId) ? { party: parties.get(partyId) } : {}), score });
  }
  return out.sort((a, b) => b.score - a.score || (a.doc.createdAt < b.doc.createdAt ? 1 : -1));
}
