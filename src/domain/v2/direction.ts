/**
 * Which way money moves for each payment source (requirement_v2.1 §7.2). The ONE map used by the
 * local write path and the server; a payment whose direction disagrees is refused with
 * `PAYMENT_DIRECTION_MISMATCH`. The UI never decides a direction on its own.
 *
 *   OUT  = we paid,  IN = we received.
 *   CHOICE = the user says দিলাম (OUT) or পেলাম (IN) explicitly.
 *   NONE = no payment may point at this source (a mill return is a credit, not cash).
 */
import { DomainError } from "../errors";
import type { PaymentSourceType } from "./schemas";

export type DirectionRule = "IN" | "OUT" | "CHOICE" | "NONE";

export const PAYMENT_DIRECTION: Readonly<Record<PaymentSourceType, DirectionRule>> = {
  PURCHASE: "OUT",
  SALE: "IN",
  // The mill pays us for the paddy it receives.
  MILL_DISPATCH: "IN",
  // We give money back to a mill only when it paid more than it owed.
  MILL_REFUND: "OUT",
  EXPENSE: "OUT",
  VEHICLE_COST: "OUT",
  VEHICLE_TRIP: "IN",
  MILL_RETURN: "NONE",
  SECOND_PARTY: "CHOICE",
  PARTY_ADVANCE: "CHOICE",
  OPENING_DUE: "CHOICE",
};

/** The fixed direction of a source, or undefined when the user chooses (or none is allowed). */
export function directionFor(type: PaymentSourceType): "IN" | "OUT" | undefined {
  const r = PAYMENT_DIRECTION[type];
  return r === "IN" || r === "OUT" ? r : undefined;
}

/** Throws PAYMENT_DIRECTION_MISMATCH when `direction` is not allowed for `type`. */
export function assertPaymentDirection(type: PaymentSourceType, direction: "IN" | "OUT"): void {
  const r = PAYMENT_DIRECTION[type];
  if (r === "CHOICE") return;
  if (r === "NONE" || r !== direction) {
    throw new DomainError("PAYMENT_DIRECTION_MISMATCH", `${type}:${direction}`);
  }
}
