"use client";

import { useEffect } from "react";

/**
 * Registers the offline shell (public/sw.js) in production builds. The dev server's hot reload
 * and unhashed bundles don't mix with caching, so development unregisters any earlier worker.
 * Set NEXT_PUBLIC_SERVICE_WORKER=off to disable it in production too.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const enabled = process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_SERVICE_WORKER !== "off";
    if (!enabled) {
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations
          .filter((registration) => registration.active?.scriptURL.endsWith("/sw.js"))
          .map((registration) => registration.unregister())));
      return;
    }
    void navigator.serviceWorker.register("/sw.js", { scope: "/" })
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        // Hand over the scripts and styles this page loaded before the worker controlled it.
        const urls = [
          ...performance.getEntriesByType("resource").map((entry) => entry.name),
          ...[...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>("script[src], link[rel=stylesheet][href]")]
            .map((element) => ("src" in element && element.src) || (element as HTMLLinkElement).href)
        ].filter((url) => url.startsWith(`${location.origin}/_next/static/`));
        registration.active?.postMessage({ type: "warm-static", urls: [...new Set(urls)] });
      })
      .catch(() => {
        // Offline support is an enhancement; the app works without it.
      });
  }, []);
  return null;
}
