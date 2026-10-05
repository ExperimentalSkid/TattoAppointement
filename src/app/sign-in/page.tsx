import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { getDictionary } from "@/i18n";
import { getSession } from "@/lib/session";
import { isPasswordRecoveryConfigured } from "@/lib/email";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { isGoogleSignInConfigured } from "@/lib/studio-access";
import { RememberLoginChoice } from "@/components/remember-login-choice";
import { BetaNotice } from "@/components/beta-notice";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const session = await getSession();
  if (session) {
    redirect("/calendar");
  }

  const { locale, dictionary } = await getDictionary();
  const query = await searchParams;
  const canCreateWorkspace = process.env.DISABLE_SIGN_UP !== "true";
  const googleConfigured = isGoogleSignInConfigured();

  return (
    <AuthShell locale={locale} languageLabel={dictionary.language}>
        <p className="eyebrow">{locale === "es" ? "BIENVENIDO A TU ESTUDIO" : "WELCOME TO YOUR STUDIO"}</p>
        <h1>{dictionary.auth.signIn}</h1>
        <p>{locale === "es" ? "Todo listo para tu próxima sesión." : "Everything ready for your next session."}</p>
        <BetaNotice locale={locale} />
        {query.error ? <p className="form-error" role="alert">{locale === "es" ? "No se pudo iniciar sesión con Google. Inténtalo de nuevo o entra con tu contraseña." : "Google sign-in did not complete. Try again or sign in with your password."}</p> : null}
        <RememberLoginChoice locale={locale}>
        <GoogleSignInButton locale={locale} available={googleConfigured} prominent />
        <details className="auth-email-option" open={!googleConfigured || Boolean(query.error)}>
          <summary>{locale === "es" ? "Inicia sesión con tu correo aquí" : "Sign in with email here"}</summary>
          <AuthForm mode="sign-in" copy={dictionary.auth} locale={locale} />
          {isPasswordRecoveryConfigured() ? <Link href="/forgot-password" className="auth-recovery-link">{locale === "es" ? "¿Olvidaste tu contraseña?" : "Forgot your password?"}</Link> : null}
        </details>
        </RememberLoginChoice>
        {canCreateWorkspace ? <div className="auth-switch">
          {dictionary.auth.noAccount} <Link href="/sign-up">{dictionary.auth.signUp}</Link>
        </div> : null}
    </AuthShell>
  );
}
