/**
 * Where a document opens (detail screen). Pure and tiny: safe on the Home path. A payment opens
 * the bill it settles; a payment without a bill opens its receipt. Types whose screens come in
 * later phases return undefined (shown without a link).
 */
import type { Doc } from "@/domain/schemas";

const VIEW: Partial<Record<Doc["type"], string>> = {
  PURCHASE: "/purchase/view",
  SALE: "/sales/view",
  EXPENSE: "/expenses/view",
  MILL_DISPATCH: "/mill/dispatch/view",
  MILL_RETURN: "/mill/return/view",
  CONVERSION: "/mill/conversion/view",
  SECOND_PARTY: "/mill/entry/view",
  LOAD: "/loads/view",
  TRIP: "/vehicles/trip/view",
};

const SOURCE_VIEW: Partial<Record<string, string>> = {
  PURCHASE: "/purchase/view",
  SALE: "/sales/view",
  EXPENSE: "/expenses/view",
  MILL_DISPATCH: "/mill/dispatch/view",
  MILL_RETURN: "/mill/return/view",
  SECOND_PARTY: "/mill/entry/view",
  VEHICLE_TRIP: "/vehicles/trip/view",
  VEHICLE_COST: "/vehicles/trip/view",
  MILL_REFUND: "/mill/dispatch/view",
};

export function docPath(d: Doc): string | undefined {
  // A final settlement is part of its dispatch (shown on the dispatch page).
  if (d.type === "MILL_SETTLEMENT") return `/mill/dispatch/view?id=${d.dispatchId}`;
  if (d.type === "PAYMENT") {
    const view = d.source.id ? SOURCE_VIEW[d.source.type] : undefined;
    return view ? `${view}?id=${d.source.id!.split(":")[0]}` : `/print/payment?id=${d._id}`;
  }
  const view = VIEW[d.type];
  return view ? `${view}?id=${d._id}` : undefined;
}
