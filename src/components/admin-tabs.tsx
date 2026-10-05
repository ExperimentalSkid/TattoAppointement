"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Locale } from "@/i18n";

export function AdminTabs({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const es = locale === "es";
  const items = [["/admin", es ? "Invitaciones" : "Invitations"], ["/admin/artists", es ? "Artistas" : "Artists"], ["/admin/reports", es ? "Informes de problemas" : "Problem reports"]];
  return <nav className="admin-tabs" aria-label={es ? "Administración de Tinta" : "Tinta administration"}>{items.map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>{label}</Link>)}</nav>;
}
