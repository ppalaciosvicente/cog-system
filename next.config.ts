import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit"],
  turbopack: {
    root: __dirname, // force /Users/home/cog-system/emc as the Turbopack root
  },
};

export default nextConfig;
