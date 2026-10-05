import type { Metadata } from "next";
import { LegalPage, type LegalPageProps } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacidad / Privacy" };

export default function PrivacyPage(props: LegalPageProps) {
  return <LegalPage kind="privacy" {...props} />;
}
