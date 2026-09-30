import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { getDictionary } from "@/i18n";
import { getSession } from "@/lib/session";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { isGoogleSignInConfigured } from "@/lib/studio-access";
import { prisma } from "@/lib/prisma";

export default async function SignUpPage() {
  const session = await getSession();
  if (session) {
    redirect("/calendar");
  }
  if (process.env.DISABLE_SIGN_UP === "true" || await prisma.user.count() > 0) {
    redirect("/sign-in");
  }

  const { locale, dictionary } = await getDictionary();

  return (
    <AuthShell locale={locale} languageLabel={dictionary.language}>
        <p className="eyebrow">{locale === "es" ? "UN NUEVO CAPÍTULO" : "A NEW CHAPTER"}</p>
        <h1>{locale === "es" ? "Tu cuenta de artista" : "Your artist account"}</h1>
        <p>{locale === "es" ? "Empieza con tu cuenta. Dale tu nombre al estudio en Ajustes." : "Start with your account. Make the studio yours in Settings."}</p>
        {isGoogleSignInConfigured() ? <><GoogleSignInButton locale={locale} /><div className="auth-method-divider">{locale === "es" ? "o con tu correo" : "or with your email"}</div></> : null}
        <AuthForm mode="sign-up" copy={dictionary.auth} locale={locale} />
        <div className="auth-switch">
          {dictionary.auth.hasAccount} <Link href="/sign-in">{dictionary.auth.signIn}</Link>
        </div>
    </AuthShell>
  );
}
