/** Vehicle number helpers (pure; no schema import so light screens can use them). */

/** "wb 12 ab 3456" → "WB12AB3456" */
export function normalizeVehicleNumber(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** "WB12AB3456" → "WB 12 AB 3456" (best-effort Indian format for display). */
export function formatVehicleNumber(normalized: string): string {
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(normalized);
  if (!m) return normalized;
  return [m[1], m[2], m[3], m[4]].filter((p) => p && p.length > 0).join(" ");
}

/** For display: "WB41B5678" or "wb 41 b 5678" → "WB 41 B 5678"; anything else as typed. */
export function displayVehicleNumber(value: string): string {
  const n = normalizeVehicleNumber(value);
  const f = formatVehicleNumber(n);
  return f === n ? value : f;
}
