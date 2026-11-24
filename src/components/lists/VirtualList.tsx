"use client";

import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useState, type ReactNode } from "react";

// Own module so the virtualizer stays out of routes that only need `lists/common` (Home).
/** Window-scrolled virtual list (10k rows at 60 fps, spec §15). */
export function VirtualList<T>({
  items,
  estimate = 72,
  render,
  getKey,
  testId,
}: {
  items: readonly T[];
  estimate?: number;
  render: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => string;
  testId?: string;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const v = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => estimate,
    overscan: 8,
    scrollMargin: el?.offsetTop ?? 0,
  });
  return (
    <div ref={setEl} data-testid={testId}>
      <div style={{ height: v.getTotalSize(), position: "relative", width: "100%" }}>
        {v.getVirtualItems().map((row) => (
          <div
            key={getKey(items[row.index]!, row.index)}
            data-index={row.index}
            ref={v.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${row.start - v.options.scrollMargin}px)`,
            }}
          >
            {render(items[row.index]!, row.index)}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Window-virtualized table rows (spec §15: 10k rows at 60 fps). Render
 * `<tbody ref={v.attach}>`, a spacer `<tr>` of height `v.padTop`, the rows of `v.indices`
 * (each with `data-index` and `ref={v.measureRow}`), then a spacer of `v.padBottom`.
 * Spacer rows keep the table's column widths shared by all rows. Tables up to `threshold`
 * rows, `disabled` tables (print layouts) and the browser's print (Ctrl+P) render every row.
 */
export function useVirtualRows(
  count: number,
  { estimate = 44, threshold = 150, disabled = false } = {},
) {
  const [el, setEl] = useState<HTMLTableSectionElement | null>(null);
  const [printing, setPrinting] = useState(false);
  const on = count > threshold && !disabled && !printing;

  useEffect(() => {
    const before = () => setPrinting(true);
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  // Distance of the rows from the top of the document, re-read on every render (the
  // virtualizer re-renders on scroll, so a change of the content above is picked up).
  const margin = el && on ? Math.round(el.getBoundingClientRect().top + window.scrollY) : 0;

  const v = useWindowVirtualizer({
    count,
    estimateSize: () => estimate,
    overscan: 10,
    scrollMargin: margin,
    enabled: on,
  });

  if (!on) {
    return {
      attach: setEl,
      measureRow: undefined,
      indices: Array.from({ length: count }, (_, i) => i),
      padTop: 0,
      padBottom: 0,
    };
  }
  const items = v.getVirtualItems();
  const first = items[0];
  const last = items[items.length - 1];
  return {
    attach: setEl,
    measureRow: v.measureElement,
    indices: items.map((i) => i.index),
    padTop: first ? first.start - margin : 0,
    padBottom: last ? v.getTotalSize() - (last.end - margin) : 0,
  };
}
