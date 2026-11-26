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
  /** Its history entry exists (a push waits while a released entry's back() is in flight). */
  pushed: boolean;
}

const stack: Entry[] = [];
let nextId = 1;
let ignorePops = 0;
let installed = false;
const settled: Array<() => void> = [];

function flushSettled() {
  while (ignorePops === 0 && settled.length > 0) settled.shift()!();
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("popstate", () => {
    if (ignorePops > 0) {
      ignorePops--;
      flushSettled();
      return;
    }
    const top = stack.pop();
    top?.handler();
  });
}

/**
 * Register a back handler; returns its id. history.back() is asynchronous: a push made while a
 * released entry's back() is still in flight would be the entry that back() removes (a sheet
 * that re-opens at once, e.g. React's dev double effect, or a remount), leaving the stack one
 * entry ahead of the history — the next close then left the page. So the push waits until
 * every pending back() has landed.
 */
export function pushBack(handler: Handler): number {
  install();
  const id = nextId++;
  const entry: Entry = { id, handler, pushed: false };
  stack.push(entry);
  const doPush = () => {
    if (entry.pushed || !stack.includes(entry)) return;
    entry.pushed = true;
    window.history.pushState({ dkBack: id }, "");
  };
  if (ignorePops > 0) settled.push(doPush);
  else doPush();
  return id;
}

/** Remove a handler that was closed without the back button (keeps history in step). */
export function releaseBack(id: number): void {
  const i = stack.findIndex((e) => e.id === id);
  if (i === -1) return;
  const [entry] = stack.splice(i, 1);
  if (!entry!.pushed) return; // its push never happened: nothing to undo
  ignorePops++;
  window.history.back();
}

/** Replace the handler of an entry (e.g. its closure changed). */
export function updateBack(id: number, handler: Handler): void {
  const e = stack.find((x) => x.id === id);
  if (e) e.handler = handler;
}

/**
 * Run `fn` once every released entry's `history.back()` has landed. A sheet that closes AND
 * navigates must navigate after this, or the pending back would undo the navigation.
 */
export function whenBackSettled(fn: () => void): void {
  settled.push(fn);
  flushSettled();
}

/** Close a sheet, then navigate (after its history entry is released). */
export function closeThenNavigate(close: () => void, navigate: () => void): void {
  close();
  window.setTimeout(() => whenBackSettled(navigate), 0);
}
