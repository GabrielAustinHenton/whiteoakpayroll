"use client";

import { useEffect } from "react";

/** Hours grid keyboard help: cursor starts in the first hours box, and a box's contents are selected on focus so typing replaces them. */
export function GridKeys() {
  useEffect(() => {
    const first = document.querySelector<HTMLInputElement>(".grid-hours");
    if (first && !location.hash) {
      first.focus();
      first.select();
    }
    const onFocus = (e: FocusEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement && t.closest("table") && t.type !== "checkbox") t.select();
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);
  return null;
}
