import type { NextConfig } from "next";

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
