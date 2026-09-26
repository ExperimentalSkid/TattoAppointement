import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getDictionary } from "@/i18n";
import { getSession } from "@/lib/session";

export default async function SignInPage() {
  const session = await getSession();
  if (session) {
    redirect("/calendar");
  }

  const { locale, dictionary } = await getDictionary();

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <div className="language-row auth-language">
          <LanguageSwitcher locale={locale} label={dictionary.language} />
        </div>
        <h1>{dictionary.auth.signIn}</h1>
        <p>{dictionary.appName}</p>
        <AuthForm mode="sign-in" copy={dictionary.auth} locale={locale} />
        <div className="auth-switch">
          {dictionary.auth.noAccount} <Link href="/sign-up">{dictionary.auth.signUp}</Link>
        </div>
      </section>
    </div>
  );
}
