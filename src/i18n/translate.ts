/**
 * Framework-free translation core (usable in React, receipts, Excel, push texts).
 * Keys are typed dot-paths into the bn dictionary shape; plural entries are { one, other }.
 */
import { bn, type Dictionary } from "./bn";

export type Lang = "bn" | "en";
export const LANGS: readonly Lang[] = ["bn", "en"];

export type PluralEntry = { one: string; other: string };

type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends PluralEntry
      ? `${P}${K}`
      : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Every translatable key, e.g. "dashboard.openingCash" or "sync.pendingCount". */
export type TKey = Paths<Dictionary>;

export type TVars = Record<string, string | number>;

/**
 * Bengali (the canonical shape) is always present. English is registered on demand so the
 * Home route doesn't ship both dictionaries (spec §15): the client loads it with
 * `loadDictionary` (I18nProvider), and server code, print pages and tests import
 * `@/i18n/translateAll`, which registers it synchronously.
 */
const DICTS: Partial<Record<Lang, Dictionary>> = { bn };

export function registerDictionary(lang: Lang, dict: Dictionary): void {
  DICTS[lang] = dict;
}

export function isDictionaryLoaded(lang: Lang): boolean {
  return DICTS[lang] !== undefined;
}

/** Load a dictionary chunk (precached by the service worker, so this works offline). */
export async function loadDictionary(lang: Lang): Promise<void> {
  if (DICTS[lang]) return;
  if (lang === "en") registerDictionary("en", (await import("./en")).en);
}

/** The dictionary for `lang`, or Bengali while English is still loading. */
export function getDictionary(lang: Lang): Dictionary {
  return DICTS[lang] ?? bn;
}

function isPlural(node: unknown): node is PluralEntry {
  return (
    typeof node === "object" &&
    node !== null &&
    typeof (node as PluralEntry).one === "string" &&
    typeof (node as PluralEntry).other === "string"
  );
}

function lookup(dict: Dictionary, key: string): unknown {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

const pluralRules: Record<Lang, Intl.PluralRules> = {
  bn: new Intl.PluralRules("bn"),
  en: new Intl.PluralRules("en"),
};

/**
 * Replace `{name}` placeholders. `{count}` prefers `vars.countDisplay` (the count already
 * formatted in the user's digit style) while plural selection still uses the numeric `count`.
 */
export function interpolate(template: string, vars?: TVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => {
    if (name === "count" && vars.countDisplay !== undefined) return String(vars.countDisplay);
    return vars[name] !== undefined ? String(vars[name]) : m;
  });
}

/**
 * Translate `key` in `lang`. `vars.count` selects the plural form. Unknown keys return the key
 * itself (never throws in production) — the parity test guarantees both dictionaries are full.
 */
export function translate(lang: Lang, key: TKey | (string & {}), vars?: TVars): string {
  const node = lookup(getDictionary(lang), key);
  if (typeof node === "string") return interpolate(node, vars);
  if (isPlural(node)) {
    const count = typeof vars?.count === "number" ? vars.count : 0;
    const form = pluralRules[lang].select(count) === "one" ? node.one : node.other;
    return interpolate(form, vars);
  }
  return key;
}

/** All leaf key paths of a dictionary (used by the parity test). */
export function leafKeys(dict: unknown, prefix = ""): string[] {
  if (typeof dict === "string") return [prefix];
  if (isPlural(dict)) return [prefix];
  if (typeof dict !== "object" || dict === null) return [prefix];
  return Object.entries(dict).flatMap(([k, v]) => leafKeys(v, prefix ? `${prefix}.${k}` : k));
}
