import { describe, expect, it } from "vitest";
import { ENTRY_PATHS, mayOpenPath, mayViewVoucher, visibleVouchers } from "@/client/access";

describe("entry role view policy (spec §2, [CONFIRM] #8)", () => {
  it("other roles open every screen", () => {
    for (const role of ["owner", "manager", "viewer", null] as const) {
      expect(mayOpenPath(role, "/reports")).toBe(true);
      expect(mayOpenPath(role, "/party/view?id=x")).toBe(true);
    }
  });

  it("entry opens its own entry screens, today's dashboard, settings and sync", () => {
    for (const p of [
      "/",
      "/purchase",
      "/purchase/new",
      "/purchase/edit?id=1",
      "/purchase/view?id=1",
      "/load/new",
      "/expense",
      "/expense/new",
      "/voucher/view?id=1",
      "/payment/view?id=1",
      "/print/voucher?id=1",
      "/settings",
      "/sync",
      "/more",
      "/load/",
    ]) {
      expect(mayOpenPath("entry", p), p).toBe(true);
    }
  });

  it("entry is kept out of godown-wide screens and entries it cannot make", () => {
    for (const p of [
      "/party",
      "/party/view?id=1",
      "/due",
      "/sale",
      "/sale/new",
      "/payment/new?type=PAYMENT",
      "/trip/new",
      "/cashbank",
      "/stock",
      "/stock/register?varietyId=1",
      "/reports",
      "/reports/view?r=dayBook",
      "/print/report?r=dayBook",
      "/print/statement?partyId=1",
      "/reminders",
      "/search",
      "/vehicle",
      "/day-close",
      "/settings/masters",
      "/settings/users",
      "/godowns",
      "/opening",
      "/transfer",
    ]) {
      expect(mayOpenPath("entry", p), p).toBe(false);
    }
    expect(ENTRY_PATHS.has("/reports")).toBe(false);
  });

  it("entry sees only vouchers it created", () => {
    const mine = { createdBy: "u1" };
    const theirs = { createdBy: "u2" };
    expect(mayViewVoucher("entry", "u1", mine)).toBe(true);
    expect(mayViewVoucher("entry", "u1", theirs)).toBe(false);
    expect(mayViewVoucher("entry", null, mine)).toBe(false);
    expect(mayViewVoucher("manager", "u1", theirs)).toBe(true);
    expect(visibleVouchers("entry", "u1", [mine, theirs, mine])).toEqual([mine, mine]);
    expect(visibleVouchers("owner", "u1", [mine, theirs])).toEqual([mine, theirs]);
  });
});
