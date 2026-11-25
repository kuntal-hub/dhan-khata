import type { NextConfig } from "next";
import pkg from "./package.json" with { type: "json" };

const isDev = process.env.NODE_ENV === "development";

/**
 * Content Security Policy (spec §14): self + self-hosted fonts, no third parties.
 * Pages are fully static (prerendered splash + client app), so per-request nonces are not
 * available; Next's inline bootstrap scripts need 'unsafe-inline'. Dev adds eval/websockets
 * for React Refresh.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  cacheComponents: true,
  partialPrefetching: true,
  // Every page renders on the device (providers.tsx gates the app to the client), so the
  // server-side instant-navigation check sees nothing and errors on every route in dev.
  // Validate only segments that opt in with `export const instant`.
  experimental: { instantInsights: { validationLevel: "manual-warning" } },
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        ],
      },
      {
        // The service worker must always be revalidated so updates are noticed.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
