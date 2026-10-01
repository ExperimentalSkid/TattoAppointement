import Link from "next/link";
import { ClientForm } from "@/components/client-form";
import { createClient, createClientForAppointment } from "../actions";
import { getDictionary } from "@/i18n";
import { validateAppointmentReturn } from "@/lib/appointment-return";

export default async function NewClientPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { dictionary } = await getDictionary();
  const returnTo = validateAppointmentReturn((await searchParams).returnTo);
  const action = returnTo ? createClientForAppointment.bind(null, returnTo) : createClient;

  return (
    <section className="client-page">
      <div className="page-header-row">
        <div>
          <Link className="text-link" href={returnTo ?? "/clients"}>← {returnTo ? dictionary.appointments.backToBooking : dictionary.clients.back}</Link>
          <h1 className="page-heading">{dictionary.clients.newClient}</h1>
        </div>
      </div>
      <div className="client-panel">
        <ClientForm action={action} copy={dictionary.clients} cancelHref={returnTo ?? "/clients"} />
      </div>
    </section>
  );
}
