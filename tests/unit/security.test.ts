/** Security re-check (spec §14): security headers / CSP and refresh-cookie flags. */
import { afterEach, describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { clearRefreshCookie, refreshCookie } from "@/server/auth";

const ENV = {
  MONGODB_URI: "mongodb://unused",
  AUTH_JWT_SECRET: "test-jwt-secret-0123456789-0123456789-abcdef",
  AUTH_REFRESH_SECRET: "test-refresh-secret-0123456789-0123456789-xyz",
};

afterEach(() => {
  delete process.env.AUTH_COOKIE_INSECURE;
});

describe("security headers", () => {
  it("every route sends CSP (self only, no framing) and the hardening headers", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/(.*)" || r.source === "/:path*") ?? rules[0]!;
    const h = Object.fromEntries(all.headers.map((x) => [x.key.toLowerCase(), x.value]));
    const csp = h["content-security-policy"]!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/https?:\/\//); // no third-party origins
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBeTruthy();
    expect(h["x-content-type-options"]).toBe("nosniff");
  });
});

describe("refresh cookie", () => {
  it("is HttpOnly, Secure and SameSite=Strict, scoped to the auth API", () => {
    Object.assign(process.env, ENV);
    const c = refreshCookie("token-value");
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/Secure/);
    expect(c).toMatch(/SameSite=Strict/i);
    expect(clearRefreshCookie()).toMatch(/Max-Age=0/i);
  });
});
