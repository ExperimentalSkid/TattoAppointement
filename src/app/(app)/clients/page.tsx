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
  const { locale, dictionary } = await getDictionary();
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
        <div><p className="eyebrow">{locale === "es" ? "CADA PERSONA, UNA HISTORIA" : "EVERY CLIENT, A STORY"}</p><h1 className="page-heading">{dictionary.pages.clientsTitle}</h1><p className="page-subtitle">{locale === "es" ? "Contactos, notas y sesiones. Todo conectado." : "Contacts, notes and sessions. All connected."}</p></div>
        <Link className="primary-button button-link" href="/clients/new">
          <span aria-hidden="true">＋</span>{dictionary.clients.newClient}
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
            <Link className="client-list-item data-row" href={`/clients/${client.id}`} key={client.id}>
              <span className="client-avatar" aria-hidden="true">{client.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span>
              <div className="client-list-main">
                <strong>{client.name}</strong>
                <span>{client.phone}</span>
                {client.email ? <span>{client.email}</span> : null}
              </div>
              <span className="client-count" aria-label={`${client._count.appointments} ${dictionary.clients.appointments.toLowerCase()}`}>{client._count.appointments}</span>
              <svg className="list-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
            </Link>
          ))}
        </div>
      ) : (
        <div className="client-empty">
          <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg>
          <h2>{query ? dictionary.clients.noResults : locale === "es" ? "Tu próximo cliente empieza aquí" : "Your next client starts here"}</h2>
          <p>{query ? (locale === "es" ? "Prueba otro nombre, teléfono o correo electrónico." : "Try another name, phone number or email.") : locale === "es" ? "Guarda sus datos una vez. Sus citas y notas estarán siempre a mano." : "Save their details once. Their sessions and notes will always be close at hand."}</p>
          <Link href={query ? "/clients" : "/clients/new"} className="secondary-button button-link">{query ? dictionary.clients.clearSearch : dictionary.clients.newClient}</Link>
        </div>
      )}
    </section>
  );
}
