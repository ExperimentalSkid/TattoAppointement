import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./designs.css";
import "./appointments.css";
import "./calendar.css";
import "./money.css";
import "./qa-fixes.css";
import "./studio.css";
import "./studio-theme.css";
import "./workspace.css";
import "./appointment-workflows.css";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { getLocale } from "@/i18n";

export const metadata: Metadata = {
  title: {
    default: "Tinta · Tattoo Appointment",
    template: "%s | Tinta",
  },
  description: "Tu espacio de trabajo como artista: citas, clientes, diseños y señales en un solo lugar.",
  icons: { icon: "/icons/app-icon.svg", apple: "/icons/apple-touch-icon.png" },
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
