import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Money/weight safety (spec §6.2): inside src/domain, no floating-point helpers or float literals.
 * (Integer-only arithmetic goes through bigint helpers in src/domain/rounding.ts.)
 * `scripts/check-no-float.mjs` adds a grep-level check (incl. `Number(`) in CI.
 */
const noFloatRules = {
  "no-restricted-globals": [
    "error",
    {
      name: "parseFloat",
      message: "No float parsing in domain code — use parseScaled()/parseRupees().",
    },
  ],
  "no-restricted-properties": [
    "error",
    { object: "Number", property: "parseFloat", message: "No float parsing in domain code." },
    { object: "Math", property: "round", message: "Use divRoundHalfUp() on bigint." },
    { object: "Math", property: "floor", message: "Use bigint division." },
    { object: "Math", property: "ceil", message: "Use bigint division." },
    { object: "Math", property: "trunc", message: "Use bigint division." },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector: "CallExpression[callee.property.name='toFixed']",
      message: "toFixed() rounds floats — use formatPaise()/formatScaled().",
    },
    {
      selector: "CallExpression[callee.property.name='toPrecision']",
      message: "No float formatting in domain code.",
    },
    {
      selector: "Literal[raw=/^\\d*\\.\\d+(e[+-]?\\d+)?$/i]",
      message: "No floating-point literals in domain code.",
    },
  ],
};

/**
 * No hard-coded user-facing strings in JSX (spec §11.4). Symbols in the allowlist are fine.
 */
const noJsxLiterals = {
  "react/jsx-no-literals": [
    "error",
    {
      noStrings: true,
      ignoreProps: true,
      noAttributeStrings: false,
      allowedStrings: [
        "₹",
        "%",
        "/",
        "×",
        "−",
        "-",
        "+",
        ":",
        "·",
        "▾",
        "◀",
        "▶",
        "(",
        ")",
        "=",
        "…",
        "|",
        "✓",
        "⏳",
        "⚠",
      ],
    },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/domain/**/*.ts"],
    rules: noFloatRules,
  },
  {
    files: ["src/app/**/*.tsx", "src/components/**/*.tsx"],
    ignores: ["src/components/ui/**"],
    rules: noJsxLiterals,
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
