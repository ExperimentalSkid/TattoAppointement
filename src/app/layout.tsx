import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./designs.css";
import { getLocale } from "@/i18n";

export const metadata: Metadata = {
  title: {
    default: "Tattoo Appointment",
    template: "%s | Tattoo Appointment",
  },
  description: "Practical appointment management for tattoo artists.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();

  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
