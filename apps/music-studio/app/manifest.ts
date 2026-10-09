import type { MetadataRoute } from "next";

/** Installable app metadata; the Library is the home screen entry point. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Synaptix Music",
    short_name: "Synaptix",
    description: "Create, play and listen to your music, online or offline.",
    start_url: "/library",
    scope: "/",
    display: "standalone",
    background_color: "#07080c",
    theme_color: "#07080c",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }]
  };
}
