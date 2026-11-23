import { SyncEngine } from "./engine";

let engine: SyncEngine | null = null;

/** The page's single sync engine (one per tab; Web Locks keep it to one per device). */
export function getSyncEngine(): SyncEngine {
  engine ??= new SyncEngine();
  return engine;
}
