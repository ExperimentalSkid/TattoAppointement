import { FoundationPage } from "@/components/foundation-page";
import { getDictionary } from "@/i18n";

export default async function ClientsPage() {
  const { dictionary } = await getDictionary();
  return (
    <FoundationPage
      title={dictionary.pages.clientsTitle}
      message={dictionary.pages.foundationMessage}
    />
  );
}
