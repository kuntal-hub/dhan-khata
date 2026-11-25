import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Noto_Sans_Bengali } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

// Self-hosted by next/font at build time (no runtime request to Google) → works offline.
const bengali = Noto_Sans_Bengali({
  variable: "--font-bengali",
  subsets: ["bengali", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const latin = Inter({
  variable: "--font-latin",
  subsets: ["latin"],
  display: "swap",
});

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Dhan Gola";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Dhan Gola – ধান গোলা · ধানের ব্যবসার সম্পূর্ণ হিসাব",
  applicationName: APP_NAME,
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#1E4D3A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * The server renders only a splash; the real UI mounts on the client from IndexedDB (see
 * providers.tsx). Next's dev-only instant-navigation validation cannot see through that gate and
 * reports "segment dropped from rendering", so opt every route out of it.
 */
export const instant = false;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="bn"
      dir="ltr"
      suppressHydrationWarning
      className={`${bengali.variable} ${latin.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
