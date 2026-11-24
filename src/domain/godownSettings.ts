/** Default settings of a new godown (pure; no schema import). */
import { DEFAULT_SEASON_MAP } from "./dates";
import type { GodownSettings } from "./schemas/system";

export function defaultGodownSettings(godownId: string, now: string): GodownSettings {
  return {
    _id: godownId,
    godownId,
    defaults: { deductions: { tarePerBagG: "0", dhaltaMode: "PER_QUINTAL", dhaltaValueG: "0" } },
    rounding: { roundToRupee: true },
    dayCloseRequired: false,
    lockAfterDays: 7,
    seasonMap: {
      AMAN: [...DEFAULT_SEASON_MAP.AMAN],
      BORO: [...DEFAULT_SEASON_MAP.BORO],
      AUS: [...DEFAULT_SEASON_MAP.AUS],
    },
    rev: 1,
    updatedAt: now,
  };
}
