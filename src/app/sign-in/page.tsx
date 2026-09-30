import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { getDictionary } from "@/i18n";
import { getSession } from "@/lib/session";
import { isPasswordRecoveryConfigured } from "@/lib/email";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { isGoogleSignInConfigured } from "@/lib/studio-access";
import { prisma } from "@/lib/prisma";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const session = await getSession();
  if (session) {
    redirect("/calendar");
  }

  const { locale, dictionary } = await getDictionary();
  const [ownerCount, query] = await Promise.all([prisma.user.count(), searchParams]);
  const canCreateOwner = ownerCount === 0 && process.env.DISABLE_SIGN_UP !== "true";

  return (
    <AuthShell locale={locale} languageLabel={dictionary.language}>
        <p className="eyebrow">{locale === "es" ? "BIENVENIDO A TU ESTUDIO" : "WELCOME TO YOUR STUDIO"}</p>
        <h1>{dictionary.auth.signIn}</h1>
        <p>{locale === "es" ? "Todo listo para tu próxima sesión." : "Everything ready for your next session."}</p>
        {query.error ? <p className="form-error" role="alert">{locale === "es" ? "No se pudo iniciar sesión con Google. Usa la cuenta autorizada del artista o entra con tu contraseña." : "Google sign-in did not complete. Use the authorized artist account or sign in with your password."}</p> : null}
        {isGoogleSignInConfigured() ? <><GoogleSignInButton locale={locale} /><div className="auth-method-divider">{locale === "es" ? "o con tu correo" : "or with your email"}</div></> : null}
        <AuthForm mode="sign-in" copy={dictionary.auth} locale={locale} />
        {isPasswordRecoveryConfigured() ? <Link href="/forgot-password" className="auth-recovery-link">{locale === "es" ? "¿Olvidaste tu contraseña?" : "Forgot your password?"}</Link> : null}
        {canCreateOwner ? <div className="auth-switch">
          {dictionary.auth.noAccount} <Link href="/sign-up">{dictionary.auth.signUp}</Link>
        </div> : null}
    </AuthShell>
  );
}
