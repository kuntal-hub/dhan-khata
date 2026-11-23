/**
 * "Unlocked in this tab" flag (sessionStorage): the PIN is asked on a cold start (new tab / app
 * launch), not again when an offline client navigation falls back to a full page load.
 * Cleared on logout and on device revocation; a new tab/app start always needs the PIN.
 */
const KEY = "dk.unlocked";

export function markUnlocked(userId: string): void {
  try {
    window.sessionStorage.setItem(KEY, userId);
  } catch {
    // Private mode / storage disabled: the PIN is simply asked again.
  }
}

export function isUnlockedThisTab(userId: string): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === userId;
  } catch {
    return false;
  }
}

export function clearUnlocked(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
