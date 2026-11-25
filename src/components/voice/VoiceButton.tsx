"use client";

/**
 * Voice input (requirement_v2 §14.1), no AI and no paid API: the browser's SpeechRecognition with
 * `bn-IN` or `en-IN` (follows the UI language; a long press switches it for this field).
 *  - Text fields: the transcript is inserted (editable).
 *  - Number fields: spoken Bengali / English numbers are parsed locally (`parseSpokenNumber`) and
 *    the value is shown for confirmation before it is filled in.
 * States: listening (subtle pulse), "বুঝতে পারিনি, আবার বলুন", permission help. Unsupported or
 * offline: a disabled mic that explains "type instead". Typing always works.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Mic, X } from "lucide-react";
import { lazyToast } from "@/components/system/IdleToaster";
import { applyDigits } from "@/domain/digits";
import { parseSpokenNumber } from "@/domain/voiceNumber";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

function recognitionCtor(): (new () => Recognition) | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function VoiceButton({
  mode,
  onText,
  className,
  testId,
}: {
  mode: "text" | "number";
  onText: (text: string) => void;
  className?: string;
  testId?: string;
}) {
  const { t, lang, digits } = useI18n();
  const [listening, setListening] = useState(false);
  const [alt, setAlt] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const rec = useRef<Recognition | null>(null);
  const press = useRef<number | null>(null);
  const longPressed = useRef(false);
  const Ctor = recognitionCtor();

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      rec.current?.stop();
    };
  }, []);

  const speechLang = (lang === "bn") !== alt ? "bn-IN" : "en-IN";
  const supported = !!Ctor && online;

  const start = () => {
    if (!Ctor) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = speechLang;
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript?.trim() ?? "";
      if (!text) return lazyToast(t("voice.notCaught"), "error");
      if (mode === "text") return onText(text);
      const n = parseSpokenNumber(text);
      if (!n.ok) return lazyToast(t("voice.notCaught"), "error");
      setPending(n.value);
    };
    r.onerror = (e) => {
      setListening(false);
      if (e.error === "not-allowed" || e.error === "service-not-allowed")
        lazyToast(t("voice.permission"), "error");
      else if (e.error !== "aborted") lazyToast(t("voice.notCaught"), "error");
    };
    r.onend = () => setListening(false);
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  if (!supported) {
    return (
      <button
        type="button"
        aria-disabled
        title={t("voice.unsupported")}
        aria-label={t("voice.unsupported")}
        onClick={() => lazyToast(t("voice.unsupported"), "info")}
        className={cn(
          "text-muted-foreground/50 flex size-10 shrink-0 items-center justify-center rounded-full",
          className,
        )}
        data-testid={testId ? `${testId}-mic` : "voice-mic"}
        data-voice="off"
      >
        <Mic className="size-5" aria-hidden />
      </button>
    );
  }

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={listening ? t("voice.listening") : t("voice.speak", { lang: speechLang })}
        aria-pressed={listening}
        onPointerDown={() => {
          longPressed.current = false;
          press.current = window.setTimeout(() => {
            longPressed.current = true;
            setAlt((a) => !a);
            lazyToast(t("voice.langNow", { lang: (lang === "bn") === alt ? "English" : "বাংলা" }));
          }, 600);
        }}
        onPointerUp={() => press.current && window.clearTimeout(press.current)}
        onPointerLeave={() => press.current && window.clearTimeout(press.current)}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (longPressed.current) return;
          start();
        }}
        className={cn(
          "press text-primary hover:bg-muted flex size-10 items-center justify-center rounded-full",
          listening && "bg-red-50 text-red-600 motion-safe:animate-pulse",
          className,
        )}
        data-testid={testId ? `${testId}-mic` : "voice-mic"}
        data-voice="on"
      >
        <Mic className="size-5" aria-hidden />
      </button>
      {pending !== null ? (
        <span
          className="bg-card shadow-lift absolute top-11 right-0 z-30 flex items-center gap-1 rounded-xl border p-1.5 text-sm whitespace-nowrap"
          role="dialog"
          aria-label={t("voice.confirm")}
        >
          <span className="tabular px-1.5">
            {t("voice.heard", { value: applyDigits(pending, digits) })}
          </span>
          <button
            type="button"
            className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg"
            aria-label={t("voice.use")}
            onClick={() => {
              onText(pending);
              setPending(null);
            }}
          >
            <Check className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className="flex size-9 items-center justify-center rounded-lg border"
            aria-label={t("common.cancel")}
            onClick={() => setPending(null)}
          >
            <X className="size-4" aria-hidden />
          </button>
        </span>
      ) : null}
    </span>
  );
}
