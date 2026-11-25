"use client";

/**
 * Shared pieces of the sign-in screens (requirement_v2 §2.2): brand header with the language
 * toggle, password field with show/hide, labelled field, form error.
 */
import { useState, type ComponentProps, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/I18nProvider";

export function AuthHeader() {
  const { t, lang, setLang, setDigits } = useI18n();
  return (
    <div className="flex items-start justify-between gap-3">
      <Logo name={t("common.appName")} tagline={t("acct.tagline")} size="lg" />
      <div className="flex shrink-0 gap-1" role="group" aria-label={t("common.language")}>
        {(["bn", "en"] as const).map((l) => (
          <Button
            key={l}
            type="button"
            variant={lang === l ? "default" : "outline"}
            className="h-11 px-3"
            aria-pressed={lang === l}
            onClick={() => {
              setLang(l);
              setDigits(l);
            }}
            data-testid={`lang-${l}`}
          >
            {t(l === "bn" ? "lang.bn" : "lang.en")}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-base">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-muted-foreground text-sm">{hint}</p> : null}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput(props: ComponentProps<typeof Input>) {
  return <Input {...props} className={`h-12 text-base ${props.className ?? ""}`} />;
}

export function PasswordInput(props: Omit<ComponentProps<typeof Input>, "type">) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={shown ? "text" : "password"} className="h-12 pr-14 text-base" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-0 right-0 size-12"
        aria-label={shown ? t("acct.hidePassword") : t("acct.showPassword")}
        aria-pressed={shown}
        onClick={() => setShown((s) => !s)}
        data-testid={`${props.id ?? "password"}-toggle`}
      >
        {shown ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
      </Button>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm"
    >
      {message}
    </p>
  );
}
