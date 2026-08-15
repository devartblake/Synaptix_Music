import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import path from "node:path";

// Shared env files (.env, .env.local, ...) live at the monorepo root per
// docs/development/local-development.md, not inside this app directory.
loadEnvConfig(path.resolve(process.cwd(), "..", ".."));

const nextConfig: NextConfig = {
  transpilePackages: [
    "@synaptix/project-model",
    "@synaptix/daw-engine",
    "@synaptix/platform-contracts"
  ],
  async headers() {
    return [
      {
        source: "/studio/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" }
        ]
      }
    ];
  }
};

export default nextConfig;
