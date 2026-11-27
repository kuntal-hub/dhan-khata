/**
 * Business-wide display settings (business profile). Pure; safe for the Home route.
 */
import type { Business } from "./schemas";

/**
 * Rice and other milled products (rice sales, rice / by-product returns, conversions, rice stock)
 * are shown unless the owner switched them off. Absent = shown (businesses saved before the
 * switch existed). Display only: hiding never changes or removes stored data.
 */
export function riceShown(business: Pick<Business, "settings"> | null | undefined): boolean {
  return business?.settings.riceEnabled !== false;
}
