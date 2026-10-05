import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { getDictionary } from "@/i18n";
import { getIdentitySession } from "@/lib/session";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { isGoogleSignInConfigured } from "@/lib/studio-access";
import { RememberLoginChoice } from "@/components/remember-login-choice";
import { BetaNotice } from "@/components/beta-notice";
import { invitationsRequired } from "@/lib/beta-access";

export default async function SignUpPage() {
  const session = await getIdentitySession();
  if (session) {
    redirect(session.user.activatedAt ? "/calendar" : "/join");
  }
  if (process.env.DISABLE_SIGN_UP === "true") {
    redirect("/sign-in");
  }

  const { locale, dictionary } = await getDictionary();
  const googleAvailable = isGoogleSignInConfigured();

  return (
    <AuthShell locale={locale} languageLabel={dictionary.language}>
        <p className="eyebrow">{locale === "es" ? "UN NUEVO CAPÍTULO" : "A NEW CHAPTER"}</p>
        <h1>{locale === "es" ? "Tu cuenta de artista" : "Your artist account"}</h1>
        <p>{locale === "es" ? "Empieza con tu cuenta. Dale tu nombre al estudio en Ajustes." : "Start with your account. Make the studio yours in Settings."}</p>
        {invitationsRequired() ? <p>{locale === "es" ? "Necesitarás una invitación de Tinta para activar tu estudio." : "You will need a Tinta invitation to activate your workspace."}</p> : null}
        <BetaNotice locale={locale} />
        <RememberLoginChoice locale={locale}>
        <GoogleSignInButton locale={locale} available={googleAvailable} prominent activation />
        <details className="auth-email-option" open={!googleAvailable}>
          <summary>{locale === "es" ? "Crea una cuenta con tu correo" : "Create an account with email"}</summary>
          <AuthForm mode="sign-up" copy={dictionary.auth} locale={locale} />
        </details>
        </RememberLoginChoice>
        <div className="auth-switch">
          {dictionary.auth.hasAccount} <Link href="/sign-in">{dictionary.auth.signIn}</Link>
        </div>
    </AuthShell>
  );
}
