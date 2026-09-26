import { FoundationPage } from "@/components/foundation-page";
import { getDictionary } from "@/i18n";

export default async function DesignsPage() {
  const { dictionary } = await getDictionary();
  return (
    <FoundationPage
      title={dictionary.pages.designsTitle}
      message={dictionary.pages.foundationMessage}
    />
  );
}
