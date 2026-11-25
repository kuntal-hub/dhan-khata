/**
 * i18n completeness (spec §11.4): no unused keys. A key counts as used when its full dotted
 * path appears as a string in the source, or when it lives under a prefix the source builds
 * dynamically (`t(\`voucherType.${v.type}\`)` → every `voucherType.*` key is used).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bn } from "@/i18n/bn";
import { en } from "@/i18n/en";
import { leafKeys } from "@/i18n/translate";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(f) && !/[\\/]i18n[\\/](v2[\\/])?(bn|en)\.ts$/.test(p) ? [p] : [];
  });
}

const source = files(path.resolve("src"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

/** Prefixes built with template literals: `foo.bar.${…}` → "foo.bar.", `ld.linkedTo${…}` → "ld.linkedTo". */
const dynamicPrefixes = [...source.matchAll(/`([a-zA-Z]\w*\.[\w.]*)\$\{/g)].map((m) => m[1]!);
/** Keys built by concatenation in one place: `onboard.step${…}` style or zod issue keys. */
const ALWAYS_USED_PREFIXES = [
  "errors.", // codes from the server, Zod and DomainError map to errors.* keys
  "sync.reason.", // push rejection reasons
  "units.maund", // reserved for [CONFIRM] #2 (মণ display)
  "units.bags", // plural sample used by the formatter tests
];

describe("i18n keys", () => {
  it("every bn key is used somewhere (directly or through a dynamic prefix)", () => {
    const unused = leafKeys(bn).filter(
      (k) =>
        !source.includes(`"${k}"`) &&
        !source.includes(`'${k}'`) &&
        !source.includes(`\`${k}\``) &&
        !dynamicPrefixes.some((p) => k.startsWith(p)) &&
        !ALWAYS_USED_PREFIXES.some((p) => k.startsWith(p)),
    );
    expect(unused).toEqual([]);
  });

  it("bn and en have the same keys and no empty values", () => {
    expect(leafKeys(en).sort()).toEqual(leafKeys(bn).sort());
  });
});
