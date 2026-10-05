import type { ReactNode } from "react";
import { requireAdminSession } from "@/lib/session";
import { getLocale } from "@/i18n";
import { AdminTabs } from "@/components/admin-tabs";
import "./admin.css";

export const metadata = { title: "Tinta admin", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminSession();
  const locale = await getLocale();
  return <section className="admin-page workspace-stack">
    <div className="page-intro"><p className="eyebrow">TINTA · {locale === "es" ? "BETA PRIVADA" : "PRIVATE BETA"}</p><h1 className="page-heading">{locale === "es" ? "Administración" : "Administration"}</h1><p className="muted-copy">{locale === "es" ? "Acceso, cuentas de artistas e informes enviados a Tinta." : "Access, artist accounts and reports sent to Tinta."}</p></div>
    <AdminTabs locale={locale} />
    {children}
  </section>;
}
