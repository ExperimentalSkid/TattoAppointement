import Link from "next/link";
import { DesignUploadForm } from "@/components/design-upload-form";
import { getDictionary } from "@/i18n";
import { validateAppointmentReturn } from "@/lib/appointment-return";

export default async function NewDesignPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { dictionary, locale } = await getDictionary();
  const returnTo = validateAppointmentReturn((await searchParams).returnTo);

  return (
    <section className="narrow-page">
      <div className="page-title-row">
        <h1 className="page-heading">{dictionary.designs.uploadDesign}</h1>
        <Link className="secondary-button button-link" href={returnTo ?? "/designs"}>
          {returnTo ? dictionary.appointments.backToBooking : dictionary.designs.back}
        </Link>
      </div>
      <div className="form-card">
        <DesignUploadForm copy={dictionary.designs} returnTo={returnTo} locale={locale} />
      </div>
    </section>
  );
}
