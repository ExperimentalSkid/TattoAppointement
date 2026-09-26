import Link from "next/link";
import { DesignUploadForm } from "@/components/design-upload-form";
import { getDictionary } from "@/i18n";

export default async function NewDesignPage() {
  const { dictionary } = await getDictionary();

  return (
    <section className="narrow-page">
      <div className="page-title-row">
        <h1 className="page-heading">{dictionary.designs.uploadDesign}</h1>
        <Link className="secondary-button button-link" href="/designs">
          {dictionary.designs.back}
        </Link>
      </div>
      <div className="form-card">
        <DesignUploadForm copy={dictionary.designs} />
      </div>
    </section>
  );
}
