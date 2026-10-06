import type { ReactNode } from "react";
import "@/components/legal.css";

// Public sibling of the authenticated (app) group: no session gate here.
export default function LegalLayout({ children }: { children: ReactNode }) {
  return <div className="legal-shell">{children}</div>;
}
