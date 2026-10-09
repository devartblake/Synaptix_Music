import type { ReactNode } from "react";

import { ServiceWorkerRegistration } from "../components/ServiceWorkerRegistration";
import "./globals.css";

export const metadata = {
  title: "Synaptix Music Studio",
  description: "Adaptive game-audio creation and production workspace.",
  appleWebApp: { capable: true, title: "Synaptix", statusBarStyle: "black-translucent" as const }
};

export const viewport = { themeColor: "#07080c" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}<ServiceWorkerRegistration /></body></html>;
}
