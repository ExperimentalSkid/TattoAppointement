import { FoundationPage } from "@/components/foundation-page";
import { getDictionary } from "@/i18n";

export default async function SettingsPage() {
  const { dictionary } = await getDictionary();
  return (
    <FoundationPage
      title={dictionary.pages.settingsTitle}
      message={dictionary.pages.foundationMessage}
    />
  );
}
