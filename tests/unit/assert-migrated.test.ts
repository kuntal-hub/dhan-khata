import { describe, expect, it } from "vitest";
import { assertMigrated } from "@/server/auth";

describe("assertMigrated", () => {
  it("refuses a v1 user without a business (503 DATA_NOT_MIGRATED)", () => {
    expect(() => assertMigrated({})).toThrow(
      expect.objectContaining({ status: 503, code: "DATA_NOT_MIGRATED" }),
    );
  });

  it("lets a migrated user through", () => {
    expect(() => assertMigrated({ businessId: "b1" })).not.toThrow();
  });
});
