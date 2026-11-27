"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { Circle, Map as LeafletMap, Marker } from "leaflet";

/**
 * Map for a work location: search an address, tap the map or drag the pin, and set the radius.
 * Map tiles and address search come from OpenStreetMap. Writes latitude, longitude and
 * radiusMeters inputs for the surrounding form.
 */
export function LocationPicker(props: { latitude?: number; longitude?: number; radiusMeters?: number; address?: string; center?: [number, number] }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<{ map: LeafletMap; marker: Marker; circle: Circle } | null>(null);
  const [lat, setLat] = useState(props.latitude ?? 0);
  const [lng, setLng] = useState(props.longitude ?? 0);
  const [radius, setRadius] = useState(props.radiusMeters ?? 150);
  const [query, setQuery] = useState(props.address ?? "");
  const [note, setNote] = useState("");
  const placed = !(lat === 0 && lng === 0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current || map.current) return;
      const start: [number, number] = placed ? [lat, lng] : props.center ?? [41.6, -72.7];
      const m = L.map(el.current).setView(start, placed ? 17 : 8);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(m);
      const icon = L.divIcon({ className: "", html: '<div style="width:18px;height:18px;border-radius:50%;background:#2f5d3a;border:3px solid #fff;box-shadow:0 0 0 1px #2f5d3a"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
      const marker = L.marker(start, { draggable: true, icon, opacity: placed ? 1 : 0 }).addTo(m);
      const circle = L.circle(start, { radius, color: "#2f5d3a", weight: 2, fillOpacity: placed ? 0.15 : 0, opacity: placed ? 1 : 0 }).addTo(m);
      const move = (p: { lat: number; lng: number }) => {
        marker.setLatLng(p).setOpacity(1);
        circle.setLatLng(p).setStyle({ opacity: 1, fillOpacity: 0.15 });
        setLat(Number(p.lat.toFixed(6)));
        setLng(Number(p.lng.toFixed(6)));
      };
      m.on("click", (e) => move(e.latlng));
      marker.on("dragend", () => move(marker.getLatLng()));
      map.current = { map: m, marker, circle };
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { map.current?.circle.setRadius(radius); }, [radius]);

  const place = (la: number, ln: number, zoom = 17) => {
    const m = map.current;
    if (!m) return;
    m.map.setView([la, ln], zoom);
    m.marker.setLatLng([la, ln]).setOpacity(1);
    m.circle.setLatLng([la, ln]).setStyle({ opacity: 1, fillOpacity: 0.15 });
    setLat(Number(la.toFixed(6)));
    setLng(Number(ln.toFixed(6)));
  };

  async function search() {
    if (!query.trim()) return;
    setNote("Searching…");
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(query)}`, { headers: { Accept: "application/json" } });
      const hits = (await r.json()) as { lat: string; lon: string; display_name: string }[];
      if (!hits.length) return setNote("Address not found. Try the street and town, or tap the map.");
      place(Number(hits[0].lat), Number(hits[0].lon));
      setNote(`Found: ${hits[0].display_name}. Drag the pin onto the building if it's off.`);
    } catch {
      setNote("Address search is unavailable. Tap the map to place the pin.");
    }
  }

  function here() {
    setNote("Getting your location…");
    navigator.geolocation?.getCurrentPosition(
      (p) => { place(p.coords.latitude, p.coords.longitude); setNote(`Placed at your location (within about ${Math.round(p.coords.accuracy)} m).`); },
      () => setNote("Couldn't get your location. Search the address or tap the map."),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  const feet = Math.round((radius * 3.28084) / 10) * 10;
  return (
    <div>
      <div className="actions">
        <input name="address" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }} placeholder="Street address, town, state" aria-label="Address" style={{ flex: "1 1 16rem" }} />
        <button type="button" className="secondary" onClick={search}>Find address</button>
        <button type="button" className="secondary" onClick={here}>Use where I am</button>
      </div>
      {note && <p className="small muted">{note}</p>}
      <div ref={el} className="geo-map" role="application" aria-label="Map: tap to place the work location" />
      <label className="field">
        <span>Radius: {radius} meters (about {feet.toLocaleString()} feet)</span>
        <input type="range" min={30} max={1000} step={10} value={Math.min(radius, 1000)} onChange={(e) => setRadius(Number(e.target.value))} style={{ width: "100%" }} />
      </label>
      <p className="small muted">
        Cover the building and parking lot. Phone GPS indoors is often off by 20 to 60 meters, so very small circles block honest punches.
      </p>
      <input type="hidden" name="latitude" value={placed ? lat : ""} />
      <input type="hidden" name="longitude" value={placed ? lng : ""} />
      <input type="hidden" name="radiusMeters" value={radius} />
      {placed && <p className="small muted">Pin: {lat}, {lng}</p>}
    </div>
  );
}
