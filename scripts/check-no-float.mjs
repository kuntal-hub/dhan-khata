#!/usr/bin/env node
/**
 * CI guard (spec §6.2): no floating-point arithmetic on money/weight in src/domain.
 * Flags parseFloat, toFixed, toPrecision, Number(…) and Math.round/floor/ceil/trunc.
 * A line may opt out ONLY for non-money integer indices with a trailing `// float-ok: <reason>`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..", "src", "domain");
const PATTERNS = [
  { re: /\bparseFloat\s*\(/, why: "parseFloat" },
  { re: /\.toFixed\s*\(/, why: "toFixed" },
  { re: /\.toPrecision\s*\(/, why: "toPrecision" },
  { re: /(?<![\w.])Number\s*\(/, why: "Number(…)" },
  { re: /\bMath\.(round|floor|ceil|trunc)\s*\(/, why: "Math rounding" },
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

const problems = [];
for (const file of walk(ROOT)) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    if (/\/\/\s*float-ok:\s*\S/.test(line)) return;
    for (const { re, why } of PATTERNS) {
      if (re.test(line))
        problems.push(`${relative(process.cwd(), file)}:${i + 1}  ${why}  →  ${trimmed}`);
    }
  });
}

if (problems.length > 0) {
  console.error("✗ Floating-point usage found in src/domain:\n" + problems.join("\n"));
  process.exit(1);
}
console.log("✓ check-no-float: src/domain is integer-only");
