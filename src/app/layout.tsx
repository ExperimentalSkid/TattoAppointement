import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./designs.css";
import "./appointments.css";
import "./calendar.css";
import "./money.css";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { getLocale } from "@/i18n";

export const metadata: Metadata = {
  title: {
    default: "Tattoo Appointment",
    template: "%s | Tattoo Appointment",
  },
  description: "Practical appointment management for tattoo artists.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#171717",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();

  return (
    <html lang={locale}>
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
