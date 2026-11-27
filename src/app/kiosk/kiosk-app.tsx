"use client";

import { useEffect, useRef, useState } from "react";
import { getFix } from "@/components/punch-capture";
import { kioskPunch, kioskStatus } from "./actions";

type Person = { id: string; name: string };
type Step =
  | { s: "pick" }
  | { s: "pin"; who: Person; pin: string; error?: string }
  | { s: "act"; who: Person; pin: string; state: "out" | "in" | "break"; since: string | null }
  | { s: "done"; ok: boolean; text: string };

const IDLE_MS = 30_000;

function since(iso: string | null, now: number) {
  if (!iso) return "";
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function KioskApp(props: { company: string; place: string; timeZone: string; requirePhoto: boolean; useLocation: boolean; people: Person[] }) {
  const [step, setStep] = useState<Step>({ s: "pick" });
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  // Go back to the name list after a short while, so nobody is left signed in at the tablet.
  useEffect(() => {
    if (step.s === "pick") return;
    const t = setTimeout(() => { setStep({ s: "pick" }); setFilter(""); }, step.s === "done" ? 4000 : IDLE_MS);
    return () => clearTimeout(t);
  }, [step]);
  // Camera only while someone is choosing a punch.
  useEffect(() => {
    if (!(props.requirePhoto && step.s === "act")) return;
    let live = true;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "user", width: 480 }, audio: false }).then((s) => {
      if (!live) return s.getTracks().forEach((t) => t.stop());
      stream.current = s;
      if (video.current) { video.current.srcObject = s; void video.current.play(); }
    }).catch(() => {});
    return () => { live = false; stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  }, [step.s, props.requirePhoto]);

  function snap(): string | null {
    const v = video.current;
    if (!v || !v.videoWidth) return null;
    const scale = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.6);
  }

  async function submitPin(who: Person, pin: string) {
    setBusy(true);
    try {
      const r = await kioskStatus(who.id, pin);
      setStep(r.ok ? { s: "act", who, pin, state: r.state, since: r.since } : { s: "pin", who, pin: "", error: r.error });
    } catch {
      setStep({ s: "pin", who, pin: "", error: "No connection. Try again." });
    } finally { setBusy(false); }
  }

  async function act(kind: string, breakKind?: string) {
    if (step.s !== "act") return;
    setBusy(true);
    try {
      const photo = props.requirePhoto ? snap() : null;
      const fix = props.useLocation ? (await getFix(10_000)).fix : null;
      const r = await kioskPunch(step.who.id, step.pin, kind, fix, photo, breakKind);
      setStep({ s: "done", ok: r.ok, text: r.ok ? `${r.message.replace(/\.$/, "")}, ${step.who.name.split(" ")[0]}.` : r.error });
    } catch {
      setStep({ s: "done", ok: false, text: "No connection. Nothing was recorded; try again." });
    } finally { setBusy(false); }
  }

  const clock = new Date(now).toLocaleTimeString("en-US", { timeZone: props.timeZone, hour: "numeric", minute: "2-digit" });
  const shown = props.people.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="kiosk-app">
      <header className="kiosk-head">
        <div><b>{props.company}</b><div className="small muted">{props.place}</div></div>
        <div className="kiosk-time">{clock}</div>
      </header>

      {step.s === "pick" && (
        <>
          <h1>Tap your name</h1>
          {props.people.length > 8 && <input className="kiosk-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search names" aria-label="Search names" />}
          {props.people.length === 0 ? <p className="muted">Nobody has a kiosk PIN yet. A manager sets PINs under Time Tracking &gt; Kiosks.</p> : (
            <div className="kiosk-names">
              {shown.map((p) => <button key={p.id} type="button" onClick={() => setStep({ s: "pin", who: p, pin: "" })}>{p.name}</button>)}
            </div>
          )}
        </>
      )}

      {step.s === "pin" && (
        <div className="kiosk-center">
          <h1>{step.who.name}</h1>
          <p>Enter your PIN</p>
          <div className="kiosk-dots" aria-label={`${step.pin.length} digits entered`}>{Array.from({ length: Math.max(4, step.pin.length) }, (_, i) => <span key={i} className={i < step.pin.length ? "on" : ""} />)}</div>
          {step.error && <p className="notice error" role="alert">{step.error}</p>}
          <div className="kiosk-pad">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "go"].map((k) => (
              <button
                key={k}
                type="button"
                disabled={busy || (k === "go" && step.pin.length < 4)}
                className={k === "go" ? "" : "secondary"}
                onClick={() => {
                  if (k === "go") return submitPin(step.who, step.pin);
                  if (k === "back") return setStep({ ...step, pin: step.pin.slice(0, -1), error: undefined });
                  if (step.pin.length < 6) setStep({ ...step, pin: step.pin + k, error: undefined });
                }}
              >{k === "back" ? "⌫" : k === "go" ? "OK" : k}</button>
            ))}
          </div>
          <button type="button" className="link" onClick={() => setStep({ s: "pick" })}>Not you? Back</button>
        </div>
      )}

      {step.s === "act" && (
        <div className="kiosk-center">
          <h1>Hi {step.who.name.split(" ")[0]}</h1>
          <p>{step.state === "out" ? "You're punched out." : step.state === "in" ? `Working for ${since(step.since, now)}` : `On break for ${since(step.since, now)}`}</p>
          {props.requirePhoto && <video ref={video} className="kiosk-video" muted playsInline aria-label="Camera: your photo is taken when you punch" />}
          <div className="punch-buttons">
            {step.state === "out" && <button type="button" className="punch-big" disabled={busy} onClick={() => act("in")}>Punch in</button>}
            {step.state === "in" && <>
              <button type="button" className="punch-big danger" disabled={busy} onClick={() => act("out")}>Punch out</button>
              <div className="punch-row">
                <button type="button" className="secondary" disabled={busy} onClick={() => act("break_start", "MEAL")}>Meal break</button>
                <button type="button" className="secondary" disabled={busy} onClick={() => act("break_start", "REST")}>Rest break</button>
              </div>
            </>}
            {step.state === "break" && <>
              <button type="button" className="punch-big" disabled={busy} onClick={() => act("break_end")}>End break</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => act("out")}>Punch out</button>
            </>}
          </div>
          <button type="button" className="link" onClick={() => setStep({ s: "pick" })}>Cancel</button>
        </div>
      )}

      {step.s === "done" && (
        <div className="kiosk-center">
          <p className={`kiosk-result ${step.ok ? "ok" : "error"}`} role="status">{step.ok ? "✓ " : ""}{step.text}</p>
          <button type="button" className="secondary" onClick={() => setStep({ s: "pick" })}>Done</button>
        </div>
      )}
    </div>
  );
}
