"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { applyDigits, type DigitStyle } from "@/domain/digits";
import { actions, useAppDispatch, useAppSelector } from "@/store";
import {
  formatCount,
  formatDate,
  formatMoney,
  formatPercent,
  formatRate,
  formatWeight,
  type WeightDisplay,
} from "./format";
import {
  isDictionaryLoaded,
  loadDictionary,
  translate,
  type Lang,
  type TKey,
  type TVars,
} from "./translate";

/** Device-level preference key. Phase 2 moves the source of truth to the synced user record. */
const STORAGE_KEY = "dk.locale.v1";

export interface I18nValue {
  lang: Lang;
  digits: DigitStyle;
  weight: WeightDisplay;
  t: (key: TKey, vars?: TVars) => string;
  money: (paise: bigint, symbol?: boolean) => string;
  weightOf: (grams: bigint) => string;
  rate: (ratePaisePerQtl: bigint) => string;
  percent: (bps: bigint) => string;
  count: (n: number | bigint) => string;
  date: (ymd: string, style?: "long" | "short") => string;
  setLang: (lang: Lang) => void;
  setDigits: (digits: DigitStyle) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const { lang: wanted, digits, weight, hydrated } = useAppSelector((s) => s.locale);
  const [enReady, setEnReady] = useState(() => isDictionaryLoaded("en"));
  // Keep showing Bengali until the English chunk is in (a few ms from the SW cache), so a
  // language switch never unmounts the screen or loses an unsaved form.
  const lang: Lang = wanted === "en" && !enReady ? "bn" : wanted;

  // English loads right away when chosen, otherwise when the device is idle (receipts, Excel
  // and WhatsApp texts can use either language at any time).
  useEffect(() => {
    if (enReady) return;
    let alive = true;
    const load = () =>
      void loadDictionary("en").then(
        () => alive && setEnReady(true),
        () => undefined,
      );
    if (wanted === "en") load();
    else if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(load, { timeout: 3000 });
      return () => {
        alive = false;
        window.cancelIdleCallback(id);
      };
    } else {
      const id = window.setTimeout(load, 1000);
      return () => {
        alive = false;
        window.clearTimeout(id);
      };
    }
    return () => {
      alive = false;
    };
  }, [wanted, enReady]);

  // Load the persisted preference once (instant, offline — no network involved).
  useEffect(() => {
    if (hydrated) return;
    let saved: Partial<{ lang: Lang; digits: DigitStyle; weight: WeightDisplay }> = {};
    try {
      saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    } catch {
      saved = {};
    }
    dispatch(actions.locale.localeHydrated(saved));
  }, [dispatch, hydrated]);

  // Persist + update <html lang> on every change (both languages are LTR).
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = "ltr";
    if (hydrated) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ lang: wanted, digits, weight }));
    }
  }, [lang, wanted, digits, weight, hydrated]);

  const setLang = useCallback((l: Lang) => dispatch(actions.locale.languageChanged(l)), [dispatch]);
  const setDigits = useCallback(
    (d: DigitStyle) => dispatch(actions.locale.digitsChanged(d)),
    [dispatch],
  );

  const value = useMemo<I18nValue>(() => {
    const prefs = { lang, digits, weight };
    return {
      lang,
      digits,
      weight,
      t: (key, vars) => {
        if (!vars) return translate(lang, key);
        // Every number placeholder is shown in the user's digit style ("১টি ট্রিপ", never
        // "1টি"); digits only, no grouping (a year stays "২০২৬"). `{count}` stays numeric for
        // plural selection and shows the grouped `countDisplay`.
        const shown: TVars = {};
        for (const [k, v] of Object.entries(vars)) {
          shown[k] =
            typeof v === "number" && k !== "count" ? applyDigits(String(v), prefs.digits) : v;
        }
        if (typeof vars.count === "number") shown.countDisplay = formatCount(vars.count, prefs);
        return translate(lang, key, shown);
      },
      money: (p, symbol = true) => formatMoney(p, prefs, symbol),
      weightOf: (g) => formatWeight(g, prefs),
      rate: (r) => formatRate(r, prefs),
      percent: (b) => formatPercent(b, prefs),
      count: (n) => formatCount(n, prefs),
      date: (ymd, style = "long") => formatDate(ymd, prefs, style),
      setLang,
      setDigits,
    };
  }, [lang, digits, weight, setLang, setDigits]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n must be used inside <I18nProvider>");
  return v;
}

export function useT(): I18nValue["t"] {
  return useI18n().t;
}
