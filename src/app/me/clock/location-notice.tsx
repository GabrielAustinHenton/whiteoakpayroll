"use client";

import { useTransition } from "react";
import { acknowledgeLocationNotice } from "./actions";

/** Written notice of location checks, shown once before the first punch (CT and NY require notice of electronic monitoring). */
export function LocationNotice({ company }: { company: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Before your first punch</h2>
      <p>{company} uses White Oak&apos;s time clock with location checks, so punches only count from work.</p>
      <ul>
        <li>Your phone&apos;s location is read <b>only at the moment you tap a punch button</b> (in, out, and breaks).</li>
        <li>Nothing tracks you between punches, and nothing runs in the background.</li>
        <li>{company} sees each punch&apos;s time, place and how far it was from your work location.</li>
        <li>Your browser will ask to allow location. Choose <b>Allow</b>; you can turn it off any time in your browser settings.</li>
      </ul>
      <button type="button" disabled={pending} onClick={() => start(() => acknowledgeLocationNotice())}>
        {pending ? "Saving…" : "I understand"}
      </button>
    </div>
  );
}
