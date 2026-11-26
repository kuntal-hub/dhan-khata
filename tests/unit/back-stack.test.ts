/**
 * Sheets and the browser history (spec §11.2): each open sheet owns one history entry, and
 * history.back() lands LATER (asynchronously), as in a real browser. A sheet that re-opens while
 * a release is in flight (React's dev double effect, a remount) must not leave the stack one entry
 * ahead of the history: closing the sheets afterwards must never leave the page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type BackStack = typeof import("@/client/ui/backStack");

/**
 * A minimal browser history: entries + index. Like Chrome, back() picks its target entry when it
 * is CALLED and lands (popstate) on a later task; going back past the page's entry leaves it.
 */
function fakeWindow() {
  const listeners: Array<(e: { state: unknown }) => void> = [];
  const h = {
    entries: [{ state: null as unknown }],
    index: 0,
    leftPage: false,
  };
  const history = {
    pushState(state: unknown) {
      h.entries = h.entries.slice(0, h.index + 1);
      h.entries.push({ state });
      h.index++;
    },
    back() {
      const target = h.index - 1;
      setTimeout(() => {
        if (target < 0) {
          h.leftPage = true;
          return;
        }
        h.index = target;
        listeners.forEach((l) => l({ state: h.entries[h.index]!.state }));
      }, 0);
    },
  };
  return {
    h,
    win: {
      history,
      addEventListener: (type: string, fn: (e: { state: unknown }) => void) => {
        if (type === "popstate") listeners.push(fn);
      },
      setTimeout,
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 5));

describe("backStack", () => {
  let bs: BackStack;
  let env: ReturnType<typeof fakeWindow>;

  beforeEach(async () => {
    vi.resetModules();
    env = fakeWindow();
    vi.stubGlobal("window", env.win);
    bs = await import("@/client/ui/backStack");
  });

  it("open + close a sheet returns to the page entry", async () => {
    const id = bs.pushBack(() => {});
    expect(env.h.index).toBe(1);
    bs.releaseBack(id);
    await flush();
    expect(env.h.index).toBe(0);
  });

  it("re-open during an in-flight release (dev double effect), nested picker, close all: still on the page", async () => {
    // Payment sheet mounts, its effect is torn down and re-run at once (StrictMode).
    const first = bs.pushBack(() => {});
    bs.releaseBack(first);
    const sheet = bs.pushBack(() => {});
    await flush();
    expect(env.h.index).toBe(1); // exactly one entry for the open sheet
    // A nested picker opens and closes programmatically.
    const picker = bs.pushBack(() => {});
    expect(env.h.index).toBe(2);
    bs.releaseBack(picker);
    await flush();
    expect(env.h.index).toBe(1);
    // The payment sheet closes: back on the page entry, not before it.
    bs.releaseBack(sheet);
    await flush();
    expect(env.h.index).toBe(0);
    expect(env.h.leftPage).toBe(false);
  });

  it("a push that never happened is released without a back()", async () => {
    const a = bs.pushBack(() => {});
    bs.releaseBack(a); // back() in flight
    const b = bs.pushBack(() => {}); // deferred
    bs.releaseBack(b); // released before its push: nothing to undo
    await flush();
    expect(env.h.index).toBe(0);
  });

  it("hardware back closes only the top sheet", async () => {
    const closed: string[] = [];
    bs.pushBack(() => closed.push("sheet"));
    bs.pushBack(() => closed.push("picker"));
    env.win.history.back(); // the user's back button
    await flush();
    expect(closed).toEqual(["picker"]);
    expect(env.h.index).toBe(1);
  });

  it("closeThenNavigate navigates after the release landed", async () => {
    const id = bs.pushBack(() => {});
    const order: string[] = [];
    bs.closeThenNavigate(
      () => bs.releaseBack(id),
      () => order.push(`navigate@${env.h.index}`),
    );
    await flush();
    expect(order).toEqual(["navigate@0"]);
  });
});
