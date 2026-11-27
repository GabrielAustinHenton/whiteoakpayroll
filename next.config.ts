import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output lets the same app run in a plain Docker container
  // (AWS, Fly, Render, etc.), so we are not tied to any one host.
  output: "standalone",
  // Time clock exports are uploaded through a server action.
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
};

export default nextConfig;
