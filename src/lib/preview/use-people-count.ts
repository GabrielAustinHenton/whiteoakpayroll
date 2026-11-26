"use client";

import { useSyncExternalStore } from "react";
import { PEOPLE_DEFAULT, peopleFromInput, readPeopleText, subscribePeople, writePeopleText, cleanPeopleInput } from "./people-count";

/** The people count typed on the pricing or preview page, remembered in this browser across pages and visits. */
export function usePeopleCount() {
  const text = useSyncExternalStore(subscribePeople, readPeopleText, () => String(PEOPLE_DEFAULT));
  return {
    text,
    people: peopleFromInput(text),
    setText: (raw: string) => writePeopleText(cleanPeopleInput(raw)),
  };
}
