/** Vehicle business queries (spec §9.7): per-vehicle P&L, khata and the fleet dashboard. */
import { vehiclePnl, type VehiclePnl } from "@/domain/calc/vehicle";
import { ordOf } from "@/domain/posting/derive";
import type { LedgerLine, Vehicle, Voucher, VoucherOf } from "@/domain/schemas";
import { db } from "../db/dexie";

function vouchersOf(godownId: string, type: Voucher["type"], from: string, to: string) {
  return db()
    .vouchers.where("[godownId+type+date]")
    .between([godownId, type, from], [godownId, type, to], true, true)
    .filter((v) => v.status === "active")
    .toArray();
}

export interface VehicleSummary {
  vehicle: Vehicle;
  pnl: VehiclePnl;
  trips: Array<VoucherOf<"TRIP">>;
}

/** P&L of every vehicle of the godown over [from, to] (own vehicles first). */
export async function vehicleSummaries(
  godownId: string,
  range: { from: string; to: string },
): Promise<VehicleSummary[]> {
  const [vehicles, trips, expenses] = await Promise.all([
    db().vehicles.where("godownId").equals(godownId).toArray(),
    vouchersOf(godownId, "TRIP", range.from, range.to),
    vouchersOf(godownId, "EXPENSE", range.from, range.to),
  ]);
  return vehicles
    .filter((v) => v.status === "active")
    .map((vehicle) => {
      const t = trips.filter(
        (x): x is VoucherOf<"TRIP"> => x.type === "TRIP" && x.vehicleId === vehicle._id,
      );
      const e = expenses.filter(
        (x): x is VoucherOf<"EXPENSE"> => x.type === "EXPENSE" && x.vehicleId === vehicle._id,
      );
      return {
        vehicle,
        pnl: vehiclePnl(t, e),
        trips: t.sort((a, b) => (a.date < b.date ? 1 : -1)),
      };
    })
    .sort((a, b) =>
      a.vehicle.ownership === b.vehicle.ownership
        ? a.vehicle.number.localeCompare(b.vehicle.number)
        : a.vehicle.ownership === "own"
          ? -1
          : 1,
    );
}

export async function vehicleSummary(
  godownId: string,
  vehicleId: string,
  range: { from: string; to: string },
): Promise<VehicleSummary | null> {
  return (await vehicleSummaries(godownId, range)).find((s) => s.vehicle._id === vehicleId) ?? null;
}

export interface KhataRow {
  voucher: Voucher | undefined;
  voucherId: string;
  date: string;
  incomePaise: bigint;
  expensePaise: bigint;
  /** Running net (income − expense). */
  netPaise: bigint;
}

/** Vehicle khata: every voucher that earned or spent for this vehicle, with running net. */
export async function vehicleKhata(godownId: string, vehicleId: string): Promise<KhataRow[]> {
  const d = db();
  const income = `VEH_INCOME:${vehicleId}`;
  const expPrefix = `VEH_EXP:${vehicleId}:`;
  const [inc, exp, tagged] = await Promise.all([
    d.ledgerLines
      .where("[godownId+account+date]")
      .between([godownId, income, ""], [godownId, income, "￿"], true, true)
      .toArray(),
    d.ledgerLines
      .where("[godownId+account+date]")
      .between([godownId, expPrefix, ""], [godownId, `${expPrefix}￿`, "￿"], true, true)
      .toArray(),
    // EXPENSE vouchers tagged with the vehicle post to EXP:<category> with a vehicleId tag.
    d.ledgerLines
      .where("[godownId+date]")
      .between([godownId, ""], [godownId, "￿"], true, true)
      .filter(
        (l) =>
          l.vehicleId === vehicleId && l.voucherType === "EXPENSE" && l.account.startsWith("EXP:"),
      )
      .toArray(),
  ]);
  const by = new Map<string, { date: string; inc: bigint; exp: bigint }>();
  const add = (l: LedgerLine, isIncome: boolean) => {
    const e = by.get(l.voucherId) ?? { date: l.date, inc: 0n, exp: 0n };
    const net = BigInt(l.debitPaise) - BigInt(l.creditPaise);
    if (isIncome) e.inc -= net;
    else e.exp += net;
    by.set(l.voucherId, e);
  };
  for (const l of inc) add(l, true);
  for (const l of exp) add(l, false);
  for (const l of tagged) add(l, false);
  const vs = await d.vouchers.bulkGet([...by.keys()]);
  const vById = new Map(vs.filter((v): v is Voucher => !!v).map((v) => [v._id, v]));
  const rows = [...by.entries()].sort((a, b) => {
    const x = vById.get(a[0]);
    const y = vById.get(b[0]);
    const ox = x ? ordOf(x) : a[1].date;
    const oy = y ? ordOf(y) : b[1].date;
    return ox < oy ? -1 : ox > oy ? 1 : 0;
  });
  let net = 0n;
  return rows.map(([voucherId, e]) => {
    net += e.inc - e.exp;
    return {
      voucherId,
      voucher: vById.get(voucherId),
      date: e.date,
      incomePaise: e.inc,
      expensePaise: e.exp,
      netPaise: net,
    };
  });
}
