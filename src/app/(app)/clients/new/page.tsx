import Link from "next/link";
import { ClientForm } from "@/components/client-form";
import { createClient } from "../actions";
import { getDictionary } from "@/i18n";

export default async function NewClientPage() {
  const { dictionary } = await getDictionary();

  return (
    <section className="client-page">
      <div className="page-header-row">
        <div>
          <Link className="text-link" href="/clients">← {dictionary.clients.back}</Link>
          <h1 className="page-heading">{dictionary.clients.newClient}</h1>
        </div>
      </div>
      <div className="client-panel">
        <ClientForm action={createClient} copy={dictionary.clients} />
      </div>
    </section>
  );
}
