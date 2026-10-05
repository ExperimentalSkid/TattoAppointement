import { AuthShell } from "@/components/auth-shell";
import { ActiveJoinRedirect, JoinActivation } from "@/components/join-activation";
import { BetaNotice } from "@/components/beta-notice";
import { getDictionary } from "@/i18n";
import { getIdentitySession } from "@/lib/session";
import { isGoogleSignInConfigured } from "@/lib/studio-access";

export const metadata = { title: "Join Tinta", referrer: "no-referrer" as const };

export default async function JoinPage() {
  const identity = await getIdentitySession();
  const { locale, dictionary } = await getDictionary();
  const es = locale === "es";
  if (identity?.user.activatedAt) return <AuthShell locale={locale} languageLabel={dictionary.language}><ActiveJoinRedirect locale={locale} /></AuthShell>;
  return <AuthShell locale={locale} languageLabel={dictionary.language}>
    <p className="eyebrow">{es ? "BETA PRIVADA · TINTA" : "PRIVATE BETA · TINTA"}</p>
    <h1>{es ? "Tu invitación al estudio" : "Your invitation to the studio"}</h1>
    <p>{es ? "Un espacio para tu arte, con acceso por invitación." : "A place for your art, with access by invitation."}</p>
    <BetaNotice locale={locale} />
    <JoinActivation locale={locale} identity={identity ? { id: identity.user.id, email: identity.user.email } : null} googleAvailable={isGoogleSignInConfigured()} canSignUp={process.env.DISABLE_SIGN_UP !== "true"} />
  </AuthShell>;
}
