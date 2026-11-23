"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Printer, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/forms/fields";
import { useI18n } from "@/i18n/I18nProvider";

export type ReceiptLang = "bn" | "en" | "both";

/**
 * Print / share frame (spec §3.5): HTML print view (browser shaping handles Bengali conjuncts)
 * → window.print(); "share as image" = PNG via html-to-image (lazy) + Web Share API, with a
 * download fallback.
 */
export function PrintFrame({
  title,
  filename,
  receiptLang,
  onReceiptLang,
  children,
}: {
  title: string;
  filename: string;
  receiptLang: ReceiptLang;
  onReceiptLang: (l: ReceiptLang) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const share = async () => {
    if (!ref.current) return;
    setBusy(true);
    try {
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(ref.current, { pixelRatio: 2, backgroundColor: "#ffffff" });
      if (!blob) throw new Error("no image");
      const file = new File([blob], `${filename}.png`, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) toast.error(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={() => router.back()}
          aria-label={t("common.back")}
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
        <Button
          variant="outline"
          className="h-11"
          onClick={() => window.print()}
          data-testid="print-button"
        >
          <Printer className="size-4" aria-hidden />
          {t("common.print")}
        </Button>
        <Button
          className="h-11"
          onClick={() => void share()}
          disabled={busy}
          data-testid="share-image"
        >
          <Share2 className="size-4" aria-hidden />
          {t("common.shareReceipt")}
        </Button>
      </div>
      <div className="print:hidden">
        <Choice
          label={t("receipt.language")}
          value={receiptLang}
          onChange={onReceiptLang}
          options={[
            { value: "bn", label: t("lang.bn") },
            { value: "en", label: t("lang.en") },
            { value: "both", label: t("receipt.both") },
          ]}
        />
      </div>
      <div ref={ref} className="bg-white p-4 text-black" data-testid="print-area">
        {children}
      </div>
    </div>
  );
}
