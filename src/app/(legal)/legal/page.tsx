import type { Metadata } from "next";
import { LegalPage, type LegalPageProps } from "@/components/legal-page";

export const metadata: Metadata = { title: "Aviso legal / Legal notice" };

export default function NoticePage(props: LegalPageProps) {
  return <LegalPage kind="legal" {...props} />;
}
