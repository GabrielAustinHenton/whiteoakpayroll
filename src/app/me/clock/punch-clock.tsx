"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { punchFromPhone } from "./actions";
import { getFix, takePhoto } from "@/components/punch-capture";

type State = "out" | "in" | "break";

const FLAG_NOTE: Record<string, string> = {
  LOW_ACCURACY: "Your GPS signal was weak, so your manager may check this punch.",
  OUTSIDE_FENCE: "This punch was away from your work location, so your manager will review it.",
  NO_LOCATION: "No location was shared, so your manager may check this punch.",
};

function elapsed(fromIso: string | null, now: number): string {
  if (!fromIso) return "";
  const m = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60_000));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function PunchClock(props: { state: State; since: string | null; breakKind: string | null; minutesToday: number; requirePhoto: boolean; usesLocation: boolean; timeZone: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  async function go(kind: string, label: string, breakKind?: string) {
    setMsg(null);
    try {
      let photo: string | null = null;
      if (props.requirePhoto && (kind === "in" || kind === "out")) {
        setBusy("Take a photo…");
        photo = await takePhoto(fileRef.current!);
        if (!photo) { setBusy(null); setMsg({ ok: false, text: "A photo is needed to punch. Tap the button again." }); return; }
      }
      setBusy(props.usesLocation ? "Checking your location…" : `${label}…`);
      const fix = props.usesLocation ? await getFix() : { fix: null, error: null };
      setBusy(`${label}…`);
      const r = await punchFromPhone(kind, fix.fix ?? null, photo, breakKind);
      if (r.ok) {
        const notes = r.flags.map((f) => FLAG_NOTE[f]).filter(Boolean);
        setMsg({ ok: true, text: [r.message, ...notes].join(" ") });
        if ("vibrate" in navigator) navigator.vibrate?.(80);
        router.refresh();
      } else {
        setMsg({ ok: false, text: fix.error && /location/i.test(r.error) ? `${r.error} (${fix.error})` : r.error });
      }
    } catch {
      setMsg({ ok: false, text: "Couldn't reach White Oak. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  const status =
    props.state === "out" ? "You're punched out." :
    props.state === "in" ? `Working for ${elapsed(props.since, now)}` :
    `On ${props.breakKind === "REST" ? "a rest" : "a meal"} break for ${elapsed(props.since, now)}`;

  return (
    <div className={`punch-card state-${props.state}`}>
      <p className="punch-status" aria-live="polite">{status}</p>
      <p className="punch-clock">{new Date(now).toLocaleTimeString("en-US", { timeZone: props.timeZone, hour: "numeric", minute: "2-digit" })}</p>
      <div className="punch-buttons">
        {props.state === "out" && <button type="button" className="punch-big" disabled={!!busy} onClick={() => go("in", "Punching in")}>Punch in</button>}
        {props.state === "in" && <>
          <button type="button" className="punch-big danger" disabled={!!busy} onClick={() => go("out", "Punching out")}>Punch out</button>
          <div className="punch-row">
            <button type="button" className="secondary" disabled={!!busy} onClick={() => go("break_start", "Starting break", "MEAL")}>Meal break</button>
            <button type="button" className="secondary" disabled={!!busy} onClick={() => go("break_start", "Starting break", "REST")}>Rest break</button>
          </div>
        </>}
        {props.state === "break" && <>
          <button type="button" className="punch-big" disabled={!!busy} onClick={() => go("break_end", "Ending break")}>End break</button>
          <button type="button" className="secondary" disabled={!!busy} onClick={() => go("out", "Punching out")}>Punch out</button>
        </>}
      </div>
      {busy && <p className="small" role="status">{busy}</p>}
      {msg && <p className={`notice ${msg.ok ? "ok" : "error"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
      <input ref={fileRef} type="file" accept="image/*" capture="user" hidden />
    </div>
  );
}
