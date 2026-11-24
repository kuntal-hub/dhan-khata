// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { useVirtualRows } from "@/components/lists/VirtualList";

// jsdom has no layout: give every row a real 44 px height (the virtualizer reads
// offsetHeight), as a browser would.
const realHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
beforeAll(() => {
  window.scrollTo = () => {}; // not implemented in jsdom
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this instanceof HTMLTableRowElement && this.dataset.index !== undefined
        ? 44
        : realHeight.get!.call(this);
    },
  });
});
afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", realHeight);
});

afterEach(cleanup);

function Table({ count, disabled }: { count: number; disabled?: boolean }) {
  const {
    attach: attachRows,
    measureRow,
    indices: rowIdx,
    padTop,
    padBottom,
  } = useVirtualRows(count, { disabled });
  return (
    <table>
      <tbody ref={attachRows}>
        {padTop > 0 ? <tr data-testid="pad-top" style={{ height: padTop }} /> : null}
        {rowIdx.map((i) => (
          <tr key={i} data-index={i} ref={measureRow} data-testid="row">
            <td>{i}</td>
          </tr>
        ))}
        {padBottom > 0 ? (
          <tr data-testid="pad-bottom" data-height={padBottom} style={{ height: padBottom }} />
        ) : null}
      </tbody>
    </table>
  );
}

describe("useVirtualRows (spec §15: 10k-row tables stay fast)", () => {
  it("renders only a window of a 10,000-row table, with a spacer for the rest", () => {
    render(<Table count={10_000} />);
    const rows = screen.getAllByTestId("row");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
    expect(rows[0]!.textContent).toBe("0");
    // The spacer stands in for the unrendered rows (≈ 44 px estimate each).
    expect(Number(screen.getByTestId("pad-bottom").dataset.height)).toBeGreaterThan(400_000);
  });

  it("renders every row of a short table", () => {
    render(<Table count={120} />);
    expect(screen.getAllByTestId("row")).toHaveLength(120);
    expect(screen.queryByTestId("pad-bottom")).toBeNull();
  });

  it("renders every row when disabled (print layout)", () => {
    render(<Table count={2_000} disabled />);
    expect(screen.getAllByTestId("row")).toHaveLength(2_000);
  });

  it("renders every row while the browser prints (Ctrl+P)", () => {
    render(<Table count={2_000} />);
    expect(screen.getAllByTestId("row").length).toBeLessThan(100);
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(screen.getAllByTestId("row")).toHaveLength(2_000);
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(screen.getAllByTestId("row").length).toBeLessThan(100);
  });
});
