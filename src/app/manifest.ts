import type { MetadataRoute } from "next";
import { translate } from "@/i18n/translateAll";

/**
 * Web App Manifest (requirement_v2 §18): "Dhan Gola – ধান গোলা", Deep Forest Green theme,
 * Warm Ivory background, logo icons (incl. maskable) and the four shortcuts.
 * Shortcuts open in the last active Gola (the app restores it).
 */
export default function manifest(): MetadataRoute.Manifest {
  const bn = (key: Parameters<typeof translate>[1]) => translate("bn", key);
  return {
    name: "Dhan Gola – ধান গোলা",
    short_name: "ধান গোলা",
    description: "ধানের ব্যবসার সম্পূর্ণ হিসাব · Complete accounts for the paddy business",
    lang: "bn",
    dir: "ltr",
    display: "standalone",
    orientation: "portrait",
    start_url: "/?source=pwa",
    scope: "/",
    id: "/",
    theme_color: "#1E4D3A",
    background_color: "#FAF6EC",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: bn("quick.purchase"),
        url: "/purchase/new",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: bn("quick.sale"),
        url: "/sales/new",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: bn("quick.expense"),
        url: "/expenses/new",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: bn("sections.dashboardTabs.cashbook"),
        url: "/?tab=cashbook",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
