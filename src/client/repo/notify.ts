/**
 * Local-write notifications: after a repo transaction COMMITS, listeners in this tab are called
 * and other tabs are told over BroadcastChannel (spec §12.10). The sync engine uses this for the
 * 2-second debounce trigger; Dexie liveQuery handles re-rendering on its own.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
const CHANNEL = "dk-writes";
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === "undefined") return null;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = () => listeners.forEach((l) => l());
  // Node (tests) keeps the process alive for an open channel; browsers have no unref.
  (channel as BroadcastChannel & { unref?: () => void }).unref?.();
  return channel;
}

export function onLocalWrite(listener: Listener): () => void {
  listeners.add(listener);
  getChannel();
  return () => listeners.delete(listener);
}

export function emitLocalWrite(): void {
  listeners.forEach((l) => l());
  try {
    getChannel()?.postMessage({ at: Date.now() });
  } catch {
    // A closed channel must never break a completed write.
  }
}
