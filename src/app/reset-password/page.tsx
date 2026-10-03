import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ResetPasswordForm } from "@/components/password-recovery-form";
import { AuthFeedback } from "@/components/auth-feedback";
import { getDictionary } from "@/i18n";
import { getPasswordRecoveryCopy } from "@/lib/password-recovery-copy";

export default async function ResetPasswordPage({ searchParams }: {
  searchParams: Promise<{ token?: string | string[]; error?: string | string[] }>;
}) {
  const [{ locale, dictionary }, query] = await Promise.all([getDictionary(), searchParams]);
  const copy = getPasswordRecoveryCopy(locale);
  const token = typeof query.token === "string" && /^[A-Za-z0-9_-]{12,128}$/.test(query.token) && !query.error ? query.token : null;
  return (
    <AuthShell locale={locale} languageLabel={dictionary.language}>
      <p className="eyebrow">{copy.eyebrow}</p>
      <h1>{copy.resetTitle}</h1>
      <p>{copy.resetDescription}</p>
      {token ? <ResetPasswordForm token={token} copy={copy} /> : <>
        <AuthFeedback>{copy.invalid}</AuthFeedback>
        <Link className="primary-button button-link" href="/forgot-password">{copy.retry}</Link>
      </>}
      <div className="auth-switch"><Link href="/sign-in">{copy.back}</Link></div>
    </AuthShell>
  );
}
