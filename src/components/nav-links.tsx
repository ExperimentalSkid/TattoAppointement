"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavigationCopy = {
  calendar: string;
  clients: string;
  designs: string;
  newAppointment: string;
  settings: string;
};

const items = [
  ["/calendar", "calendar", "M3 5.5h18M5.5 3v5M18.5 3v5M4 9.5h16v11H4z"],
  ["/clients", "clients", "M16 20v-1.5a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4V20m8-13a3 3 0 1 1-6 0 3 3 0 0 1 6 0m4 2a3 3 0 1 0 0-6m1 8h1a4 4 0 0 1 4 4v1"],
  ["/designs", "designs", "M4 4h16v16H4zM8 15l3-3 2 2 3-4 3 5M9 8h.01"],
  ["/new-appointment", "newAppointment", "M12 5v14M5 12h14"],
  ["/settings", "settings", "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5 1.1 2.3 2.5.4 1.8-1.6 2.4 2.4-1.6 1.8.4 2.5 2.3 1.1v3.4l-2.3 1.1-.4 2.5 1.6 1.8-2.4 2.4-1.8-1.6-2.5.4L12 21l-1.1-2.3-2.5-.4-1.8 1.6-2.4-2.4 1.6-1.8-.4-2.5L3 12.1V8.7l2.3-1.1.4-2.5-1.6-1.8 2.4-2.4 1.8 1.6 2.5-.4L12 3.5Z"],
] as const;

export function NavLinks({
  copy,
  variant,
}: {
  copy: NavigationCopy;
  variant: "desktop" | "mobile";
}) {
  const pathname = usePathname();

  return (
    <nav className={variant === "desktop" ? "desktop-nav" : "mobile-nav"} aria-label={copy.calendar === "Calendar" ? "Main navigation" : "Navegación principal"}>
      {items.map(([href, key, icon]) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} data-active={active ? "true" : "false"} aria-current={active ? "page" : undefined}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d={icon} />
              </svg>
            </span>
            <span className="nav-label">{copy[key]}</span>
          </Link>
        );
      })}
    </nav>
  );
}
