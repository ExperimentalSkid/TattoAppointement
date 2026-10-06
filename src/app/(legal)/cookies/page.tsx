import type { Metadata } from "next";
import { LegalPage, type LegalPageProps } from "@/components/legal-page";

export const metadata: Metadata = { title: "Cookies y almacenamiento / Cookies and storage" };

export default function CookiesPage(props: LegalPageProps) {
  return <LegalPage kind="cookies" {...props} />;
}
