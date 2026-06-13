import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@livekit/components-styles";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "TrueFace Calls",
    template: "%s | TrueFace Calls",
  },
  description: "Consent-first AI face controls for secure browser video calls.",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07111f",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
