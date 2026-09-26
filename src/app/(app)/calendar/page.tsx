import { CalendarView } from "@/components/calendar-view";
import { getDictionary } from "@/i18n";
import { calendarCopy } from "@/i18n/calendar-copy";

export default async function CalendarPage() {
  const { locale } = await getDictionary();
  return (
    <CalendarView
      copy={calendarCopy[locale]}
      locale={locale}
      initialDate={new Date().toISOString()}
    />
  );
}
