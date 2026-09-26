import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientForm } from "@/components/client-form";
import { updateClient } from "../../actions";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { getDictionary } from "@/i18n";

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const artistId = await requireArtistId();
  const { dictionary } = await getDictionary();
  const { id } = await params;

  const client = await prisma.client.findFirst({
    where: { id, artistId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      notes: true,
    },
  });

  if (!client) notFound();

  const action = updateClient.bind(null, client.id);

  return (
    <section className="client-page">
      <div className="page-header-row">
        <div>
          <Link className="text-link" href={`/clients/${client.id}`}>← {dictionary.clients.details}</Link>
          <h1 className="page-heading">{dictionary.clients.editClient}</h1>
        </div>
      </div>
      <div className="client-panel">
        <ClientForm
          action={action}
          copy={dictionary.clients}
          initial={client}
          cancelHref={`/clients/${client.id}`}
        />
      </div>
    </section>
  );
}
