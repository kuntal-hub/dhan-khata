/** Gola colour chips (palette keys stored on the Gola) → Tailwind classes. */
const CLASSES: Record<string, string> = {
  green: "bg-emerald-700",
  gold: "bg-amber-500",
  teal: "bg-teal-600",
  rose: "bg-rose-600",
  indigo: "bg-indigo-600",
  amber: "bg-orange-600",
};

export function golaColourClass(colour: string | undefined): string {
  return CLASSES[colour ?? "green"] ?? CLASSES.green!;
}
