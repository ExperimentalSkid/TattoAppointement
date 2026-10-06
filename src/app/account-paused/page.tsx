import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { PausedAccount } from "@/components/paused-account";
import { getDictionary } from "@/i18n";
import { getIdentitySession } from "@/lib/session";

export const metadata = { title: "Workspace access", referrer: "no-referrer" as const, robots: { index: false, follow: false } };

export default async function AccountPausedPage() {
  const identity = await getIdentitySession();
  if (!identity) redirect("/sign-in");
  if (!identity.user.deactivatedAt) redirect(identity.user.activatedAt ? "/calendar" : "/join");
  const { locale, dictionary } = await getDictionary();
  const es = locale === "es";
  return <AuthShell locale={locale} languageLabel={dictionary.language}>
    <p className="eyebrow">TINTA · {es ? "TU CUENTA" : "YOUR ACCOUNT"}</p>
    <h1>{es ? "Tu estudio está en pausa" : "Your workspace is paused"}</h1>
    <p>{es ? "El acceso a tu estudio está pausado. Tus registros se conservan." : "Access to your workspace is paused. Your records are kept."}</p>
    <PausedAccount identity={{ id: identity.user.id, email: identity.user.email }} locale={locale} />
  </AuthShell>;
}
