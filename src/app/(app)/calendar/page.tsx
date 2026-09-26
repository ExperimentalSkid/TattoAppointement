import { FoundationPage } from "@/components/foundation-page";
import { getDictionary } from "@/i18n";

export default async function CalendarPage() {
  const { dictionary } = await getDictionary();
  return (
    <FoundationPage
      title={dictionary.pages.calendarTitle}
      message={dictionary.pages.foundationMessage}
    />
  );
}
