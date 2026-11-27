import type { MetadataRoute } from "next";

/** Lets employees add the time clock to their home screen like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "White Oak Payroll",
    short_name: "White Oak",
    description: "Time clock, paystubs and W-2s.",
    start_url: "/me/clock",
    display: "standalone",
    background_color: "#fbfaf7",
    theme_color: "#2f5d3a",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
