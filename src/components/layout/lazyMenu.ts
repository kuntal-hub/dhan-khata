"use client";

import { useCallback, useState } from "react";

/**
 * Open state for a header menu whose Radix code is loaded on first tap (spec §15: keep the
 * Home route's JS small). Until `armed`, the shell renders a plain trigger button; tapping it
 * arms the lazy module (precached by the service worker, so this works offline) already open.
 */
export function useLazyMenu() {
  const [armed, setArmed] = useState(false);
  const [open, setOpen] = useState(false);
  const arm = useCallback(() => {
    setArmed(true);
    setOpen(true);
  }, []);
  return { armed, open, setOpen, arm };
}

export interface LazyMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
