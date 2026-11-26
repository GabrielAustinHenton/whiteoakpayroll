"use client";

import { usePeopleCount } from "@/lib/preview/use-people-count";

export function PeopleInput() {
  const { text, setText } = usePeopleCount();
  return (
    <label>
      People paid this month{" "}
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={text}
        placeholder="0"
        onChange={(e) => setText(e.target.value)}
      />
    </label>
  );
}
