import { LanguageSwitcher } from "@/components/language-switcher";
import { GoogleLinkButton } from "@/components/google-sign-in-button";
import { getDictionary } from "@/i18n";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { isGoogleSignInConfigured } from "@/lib/studio-access";
import { settingsCopy } from "./copy";
import { PasswordSettingsForm, ReminderSettingsForm, StudioSettingsForm } from "./settings-form";
import { getDefaultReminderTemplate } from "@/lib/whatsapp-reminder";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const artistId = await requireArtistId();
  const { locale } = await getDictionary();
  const copy = settingsCopy[locale];
  const artist = await prisma.user.findUniqueOrThrow({ where: { id: artistId }, select: { name: true, studioName: true, email: true, whatsappReminderTemplate: true } });
  const hasPassword = Boolean(await prisma.account.findFirst({ where: { userId: artistId, providerId: "credential", password: { not: null } }, select: { id: true } }));
  const googleLinked = Boolean(await prisma.account.findFirst({ where: { userId: artistId, providerId: "google" }, select: { id: true } }));
  const params = await searchParams;

  return (
    <section className="settings-page workspace-stack">
      <div className="page-intro"><p className="eyebrow">{copy.eyebrow}</p><h1 className="page-heading">{copy.title}</h1><p className="muted-copy">{copy.description}</p></div>
      <section className="settings-card workspace-section workspace-split" data-layout="labelled"><div className="settings-card-heading section-intro"><h2>{copy.profile}</h2><p className="muted-copy">{copy.profileNote}</p></div><StudioSettingsForm copy={copy} initial={artist} /></section>
      <section className="settings-card workspace-section workspace-split" data-layout="labelled"><div className="settings-card-heading section-intro"><h2>{copy.preferences}</h2><p className="muted-copy">{copy.preferencesNote}</p></div><div><div className="section-heading-row"><p className="settings-region">{copy.region}</p><LanguageSwitcher locale={locale} label={copy.language} /></div><p className="muted-copy">{copy.timezone}</p></div></section>
      <section className="settings-card workspace-section workspace-split" data-layout="labelled"><div className="settings-card-heading section-intro"><h2>{copy.reminders}</h2><p className="muted-copy">{copy.remindersNote}</p></div><ReminderSettingsForm key={locale} copy={copy} locale={locale} initialTemplate={artist.whatsappReminderTemplate ?? getDefaultReminderTemplate(locale)} studioName={artist.studioName || artist.name} /></section>
      <section className="settings-card workspace-section workspace-split" data-layout="labelled"><div className="settings-card-heading section-intro"><h2>{copy.security}</h2><p className="muted-copy">{copy.securityNote}</p></div><PasswordSettingsForm copy={copy} hasPassword={hasPassword} /></section>
      {isGoogleSignInConfigured() ? <section className="settings-card workspace-section workspace-split" data-layout="labelled"><div className="settings-card-heading section-intro"><h2>{copy.google}</h2><p className="muted-copy">{googleLinked ? copy.googleConnected : copy.googleNote}</p></div><div>{params.error === "oauth" ? <p className="form-error" role="alert">{copy.googleError}</p> : null}{!googleLinked ? <GoogleLinkButton locale={locale} /> : null}</div></section> : null}
      <section className="settings-card workspace-section workspace-split" data-layout="labelled"><div className="settings-card-heading section-intro"><h2>{copy.data}</h2><p className="muted-copy">{copy.dataNote}</p></div><div><a className="secondary-button button-link" href="/api/account/export" download>{copy.export} <span aria-hidden="true">↓</span></a><p className="muted-copy">{copy.privateNote}</p></div></section>
    </section>
  );
}
