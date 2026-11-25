"use client";

/**
 * WhatsApp click-to-chat (requirement_v2 §14.2): opens `https://wa.me/91XXXXXXXXXX?text=…` with a
 * prepared, editable message. It only opens WhatsApp — the app never claims a message was sent.
 */
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { normalizePhone } from "@/domain/phone";
import { useI18n } from "@/i18n/I18nProvider";

export function waLink(phone: string | undefined, text: string): string | null {
  const p = phone ? normalizePhone(phone) : null;
  if (!p) return null;
  const digits = p.replace(/\D/g, "").slice(-10);
  return `https://wa.me/91${digits}?text=${encodeURIComponent(text)}`;
}

export function WhatsAppButton({
  phone,
  text,
  className,
  testId = "whatsapp",
}: {
  phone: string | undefined;
  text: string;
  className?: string;
  testId?: string;
}) {
  const { t } = useI18n();
  const href = waLink(phone, text);
  if (!href) {
    return (
      <Button variant="outline" className={className ?? "h-11"} disabled title={t("wa.noPhone")}>
        <MessageCircle className="size-5" aria-hidden />
        {t("wa.open")}
      </Button>
    );
  }
  return (
    <Button
      asChild
      variant="outline"
      className={`${className ?? "h-11"} border-emerald-600/40 text-emerald-800`}
    >
      <a href={href} target="_blank" rel="noopener noreferrer" data-testid={testId}>
        <MessageCircle className="size-5" aria-hidden />
        {t("wa.open")}
      </a>
    </Button>
  );
}
