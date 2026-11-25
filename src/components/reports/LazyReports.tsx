"use client";

/** The রিপোর্ট tab, loaded on demand (keeps every section's start-up JS small). */
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/kit/Kit";

export const LazyReports = dynamic(() => import("./ReportView").then((m) => m.ReportsTab), {
  ssr: false,
  loading: () => <Skeleton rows={5} />,
});
