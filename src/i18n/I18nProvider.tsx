"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { DigitStyle } from "@/domain/digits";
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
import { translate, type Lang, type TKey, type TVars } from "./translate";
import { installZodErrorMap } from "./zodErrorMap";

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

installZodErrorMap();

export function I18nProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const { lang, digits, weight, hydrated } = useAppSelector((s) => s.locale);

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
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ lang, digits, weight }));
    }
  }, [lang, digits, weight, hydrated]);

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
        // `{count}` is shown in the user's digit style; plural selection uses the number.
        if (vars && typeof vars.count === "number") {
          return translate(lang, key, { ...vars, countDisplay: formatCount(vars.count, prefs) });
        }
        return translate(lang, key, vars);
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
