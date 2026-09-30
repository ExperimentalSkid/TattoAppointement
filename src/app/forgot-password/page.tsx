import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ForgotPasswordForm } from "@/components/password-recovery-form";
import { getDictionary } from "@/i18n";
import { isPasswordRecoveryConfigured } from "@/lib/email";
import { getPasswordRecoveryCopy } from "@/lib/password-recovery-copy";

export default async function ForgotPasswordPage() {
  const { locale, dictionary } = await getDictionary();
  const copy = getPasswordRecoveryCopy(locale);
  return (
    <AuthShell locale={locale} languageLabel={dictionary.language}>
      <p className="eyebrow">{copy.eyebrow}</p>
      <h1>{copy.forgotTitle}</h1>
      <p>{copy.forgotDescription}</p>
      {isPasswordRecoveryConfigured() ? <ForgotPasswordForm copy={copy} /> : <p className="form-error" role="status">{copy.unavailable}</p>}
      <div className="auth-switch"><Link href="/sign-in">{copy.back}</Link></div>
    </AuthShell>
  );
}
