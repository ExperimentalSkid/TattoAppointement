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
  ["/calendar", "calendar"],
  ["/clients", "clients"],
  ["/designs", "designs"],
  ["/new-appointment", "newAppointment"],
  ["/settings", "settings"],
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
    <nav className={variant === "desktop" ? "desktop-nav" : "mobile-nav"}>
      {items.map(([href, key]) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} data-active={active ? "true" : "false"}>
            {copy[key]}
          </Link>
        );
      })}
    </nav>
  );
}
