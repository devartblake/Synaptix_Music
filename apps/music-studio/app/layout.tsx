import type { ReactNode } from "react";

import "./globals.css";

export const metadata = {
  title: "Synaptix Music Studio",
  description: "Adaptive game-audio creation and production workspace."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
