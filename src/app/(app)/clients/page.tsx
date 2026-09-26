import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { getDictionary } from "@/i18n";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const artistId = await requireArtistId();
  const { dictionary } = await getDictionary();
  const params = await searchParams;
  const query = (params.q ?? "").trim();

  const clients = await prisma.client.findMany({
    where: {
      artistId,
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { phone: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      _count: { select: { appointments: true } },
    },
  });

  return (
    <section className="client-page">
      <div className="page-header-row">
        <h1 className="page-heading">{dictionary.pages.clientsTitle}</h1>
        <Link className="primary-button button-link" href="/clients/new">
          {dictionary.clients.newClient}
        </Link>
      </div>

      <form className="client-search" action="/clients" method="get">
        <input
          name="q"
          type="search"
          defaultValue={query}
          placeholder={dictionary.clients.searchPlaceholder}
          aria-label={dictionary.clients.searchPlaceholder}
        />
        <button className="secondary-button" type="submit">
          {dictionary.clients.search}
        </button>
        {query ? (
          <Link className="secondary-button button-link" href="/clients">
            {dictionary.clients.clearSearch}
          </Link>
        ) : null}
      </form>

      {clients.length ? (
        <div className="client-list">
          {clients.map((client) => (
            <Link className="client-list-item" href={`/clients/${client.id}`} key={client.id}>
              <div className="client-list-main">
                <strong>{client.name}</strong>
                <span>{client.phone}</span>
                {client.email ? <span>{client.email}</span> : null}
              </div>
              <span className="client-count">{client._count.appointments}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="client-empty">
          <p>{query ? dictionary.clients.noResults : dictionary.clients.empty}</p>
        </div>
      )}
    </section>
  );
}
