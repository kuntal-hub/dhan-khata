/**
 * Android hardware back closes the top-most sheet first (spec §11.2). Each open sheet (and each
 * guarded form) registers a handler and pushes one history entry; `popstate` calls ONLY the
 * top handler. Closing a sheet programmatically releases its entry (history.back() whose
 * popstate is ignored).
 */
type Handler = () => void;

interface Entry {
  id: number;
  handler: Handler;
}

const stack: Entry[] = [];
let nextId = 1;
let ignorePops = 0;
let installed = false;

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("popstate", () => {
    if (ignorePops > 0) {
      ignorePops--;
      return;
    }
    const top = stack.pop();
    top?.handler();
  });
}

/** Register a back handler; returns its id. */
export function pushBack(handler: Handler): number {
  install();
  const id = nextId++;
  stack.push({ id, handler });
  window.history.pushState({ dkBack: id }, "");
  return id;
}

/** Remove a handler that was closed without the back button (keeps history in step). */
export function releaseBack(id: number): void {
  const i = stack.findIndex((e) => e.id === id);
  if (i === -1) return;
  stack.splice(i, 1);
  ignorePops++;
  window.history.back();
}

/** Replace the handler of an entry (e.g. its closure changed). */
export function updateBack(id: number, handler: Handler): void {
  const e = stack.find((x) => x.id === id);
  if (e) e.handler = handler;
}
