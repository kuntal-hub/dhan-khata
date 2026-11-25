"use client";

/** recharts-based charts, each loaded on first use (never part of the start-up JS). */
import dynamic from "next/dynamic";

const ChartSkeleton = ({ h = 220 }: { h?: number }) => (
  <div className="skeleton w-full rounded-xl" style={{ height: h }} aria-hidden />
);

export const LazyTrendChart = dynamic(() => import("./TrendChart"), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

export const LazyBarsChart = dynamic(() => import("./BarsChart"), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});
