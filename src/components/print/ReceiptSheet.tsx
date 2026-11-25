"use client";

/**
 * Printable receipt / bill (requirement_v2 §14): business header (logo, name, address, mobile),
 * Gola, title, number and date, rows, total + amount in words, signature line. A4 / phone-width;
 * the action bar is hidden on paper.
 */
import { useRouter } from "next/navigation";
import { useRef, type ReactNode } from "react";
import { ArrowLeft, Image as ImageIcon, Printer } from "lucide-react";
import { lazyToast } from "@/components/system/IdleToaster";
import { Button } from "@/components/ui/button";
import { WhatsAppButton } from "@/components/kit/WhatsApp";
import { useBusiness } from "@/client/hooks";
import { amountInWords } from "@/domain/amountInWords";
import type { Godown } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";

export function ReceiptSheet({
  godown,
  title,
  number,
  date,
  rows,
  totalLabel,
  totalPaise,
  children,
  phone,
  waText,
  testId = "receipt",
}: {
  godown: Godown;
  title: string;
  number: string;
  date: string;
  rows: Array<[string, ReactNode]>;
  totalLabel: string;
  totalPaise: bigint;
  children?: ReactNode;
  phone?: string;
  waText?: string;
  testId?: string;
}) {
  const { t, money, date: fmtDate, lang } = useI18n();
  const router = useRouter();
  const business = useBusiness();
  const sheet = useRef<HTMLElement>(null);
  /** Share the receipt as an image (Web Share API), or download it (§14.2). */
  const shareImage = async () => {
    if (!sheet.current) return;
    try {
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(sheet.current, { backgroundColor: "#ffffff", pixelRatio: 2 });
      if (!blob) return;
      const file = new File([blob], `${number}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") lazyToast(t("rep.shareFailed"), "error");
    }
  };
  return (
    <div className="bg-background min-h-dvh p-3 sm:p-8">
      <div className="no-print mx-auto mb-3 flex max-w-xl flex-wrap gap-2">
        <Button variant="outline" className="h-12" onClick={() => router.back()}>
          <ArrowLeft className="size-5" aria-hidden />
          {t("rcpt.back")}
        </Button>
        <Button className="h-12" onClick={() => window.print()} data-testid="receipt-print">
          <Printer className="size-5" aria-hidden />
          {t("rcpt.print")}
        </Button>
        <Button
          variant="outline"
          className="h-12"
          onClick={() => void shareImage()}
          data-testid="receipt-image"
        >
          <ImageIcon className="size-5" aria-hidden />
          {t("rep.image")}
        </Button>
        {waText ? <WhatsAppButton phone={phone} text={waText} className="h-12" /> : null}
      </div>
      <article
        ref={sheet}
        className="print-sheet bg-card shadow-card mx-auto max-w-xl rounded-2xl border p-5 text-[15px]"
        data-testid={testId}
      >
        <header className="flex items-start gap-3 border-b pb-3">
          {business?.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data URL from the device
            <img src={business.logoDataUrl} alt="" className="size-14 rounded-lg object-contain" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold">{business?.name ?? ""}</p>
            {business?.address ? (
              <p className="text-muted-foreground text-sm">{business.address}</p>
            ) : null}
            {business?.mobile ? (
              <p className="text-muted-foreground text-sm">{business.mobile}</p>
            ) : null}
            <p className="text-sm">{t("gola.switcher", { name: godown.name })}</p>
          </div>
        </header>
        <div className="flex items-baseline justify-between py-3">
          <h1 className="text-lg font-semibold">{title}</h1>
          <span className="text-muted-foreground text-sm">
            {t("rcpt.number", { number })} · {fmtDate(date, "short")}
          </span>
        </div>
        <dl className="flex flex-col divide-y border-y">
          {rows.map(([k, v], i) => (
            <div key={i} className="flex justify-between gap-4 py-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="tabular text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        {children}
        <div className="flex items-baseline justify-between pt-3">
          <span className="font-semibold">{totalLabel}</span>
          <span className="tabular text-2xl font-semibold" data-testid={`${testId}-total`}>
            {money(totalPaise)}
          </span>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("rcpt.inWords")}: {amountInWords(totalPaise < 0n ? -totalPaise : totalPaise, lang)}
        </p>
        <footer className="mt-10 flex items-end justify-between text-sm">
          <span className="text-muted-foreground text-xs">
            {t("rcpt.generated", { app: t("common.appName") })}
          </span>
          <span className="border-t px-6 pt-1">{t("rcpt.signature")}</span>
        </footer>
      </article>
    </div>
  );
}
