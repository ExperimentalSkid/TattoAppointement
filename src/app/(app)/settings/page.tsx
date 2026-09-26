import { LanguageSwitcher } from "@/components/language-switcher";
import { getDictionary } from "@/i18n";

export default async function SettingsPage() {
  const { locale, dictionary } = await getDictionary();

  return (
    <section className="narrow-page">
      <h1 className="page-heading">{dictionary.pages.settingsTitle}</h1>
      <div className="form-card">
        <div className="section-heading-row">
          <div>
            <h2>{dictionary.language}</h2>
            <p className="muted-copy">EN / ES</p>
          </div>
          <LanguageSwitcher locale={locale} label={dictionary.language} />
        </div>
      </div>
    </section>
  );
}
