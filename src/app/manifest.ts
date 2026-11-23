import type { MetadataRoute } from "next";
import { translate } from "@/i18n/translate";

const both = (key: Parameters<typeof translate>[1]) =>
  `${translate("bn", key)} / ${translate("en", key)}`;

/**
 * Web App Manifest (spec §13). Shortcuts open in the last active godown (the app restores it).
 * Purchase and sale open their entry screens; expense opens Home until Phase 4 adds its screen.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dhan Khata – ধান খাতা",
    short_name: "ধান খাতা",
    description: "Dhan Khata – ধান খাতা",
    lang: "bn",
    dir: "ltr",
    display: "standalone",
    orientation: "portrait",
    start_url: "/?source=pwa",
    scope: "/",
    id: "/",
    theme_color: "#2F7D32",
    background_color: "#FFFFFF",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: both("pwa.shortcutPurchase"),
        url: "/purchase/new",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: both("pwa.shortcutSale"),
        url: "/sale/new",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: both("pwa.shortcutExpense"),
        url: "/?shortcut=expense",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
