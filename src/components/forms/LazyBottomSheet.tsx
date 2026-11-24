"use client";

import dynamic from "next/dynamic";

/** The bottom sheet (vaul) loaded on first use, keeping it out of the Home route's JS. */
export const LazyBottomSheet = dynamic(() => import("./BottomSheet").then((m) => m.BottomSheet), {
  ssr: false,
});
