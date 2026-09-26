import { FoundationPage } from "@/components/foundation-page";
import { getDictionary } from "@/i18n";

export default async function NewAppointmentPage() {
  const { dictionary } = await getDictionary();
  return (
    <FoundationPage
      title={dictionary.pages.newAppointmentTitle}
      message={dictionary.pages.foundationMessage}
    />
  );
}
