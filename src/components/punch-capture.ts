"use client";

/** Browser helpers for a punch: one location fix and an optional selfie. Shared by the phone clock and the kiosk. */

export interface BrowserFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

/** One fresh high-accuracy fix, or the reason there isn't one. Never watches position. */
export function getFix(timeoutMs = 20_000): Promise<{ fix: BrowserFix | null; error: string | null }> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve({ fix: null, error: "this browser can't share location" });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ fix: { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp }, error: null }),
      (e) => resolve({ fix: null, error: e.code === e.PERMISSION_DENIED ? "location is turned off for this site" : e.code === e.TIMEOUT ? "location took too long" : "location unavailable" }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

/** Open the camera through a file input and return a small JPEG data URL (longest side 480px). */
export function takePhoto(input: HTMLInputElement): Promise<string | null> {
  return new Promise((resolve) => {
    input.value = "";
    const done = () => {
      input.removeEventListener("change", onChange);
      window.removeEventListener("focus", onFocus);
    };
    const onChange = async () => {
      done();
      const file = input.files?.[0];
      resolve(file ? await shrink(file) : null);
    };
    // If the camera is closed without a photo, no change event fires; give up when the page regains focus.
    const onFocus = () => setTimeout(() => { if (!input.files?.length) { done(); resolve(null); } }, 1500);
    input.addEventListener("change", onChange);
    window.addEventListener("focus", onFocus);
    input.click();
  });
}

export async function shrink(file: Blob, max = 480): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.6);
  } catch {
    return null;
  }
}
