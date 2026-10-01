import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { getDictionary } from "@/i18n";
import { LocalDateTime } from "@/components/local-date-time";
import type { Prisma } from "@/generated/prisma/client";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const artistId = await requireArtistId();
  const { locale, dictionary } = await getDictionary();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const copy = dictionary.clients;
  // Booking context is evaluated for this authenticated request.
  // eslint-disable-next-line react-hooks/purity
  const now = new Date(Date.now());
  const appointmentSelection = {
    startsAt: true,
    designs: {
      where: { design: { artistId } },
      orderBy: [{ isFinal: "desc" }, { design: { createdAt: "desc" } }, { designId: "asc" }],
      take: 1,
      select: { isFinal: true, design: { select: { id: true, title: true } } },
    },
  } satisfies Prisma.AppointmentSelect;

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
      _count: { select: { appointments: { where: { artistId } } } },
      appointments: {
        where: { artistId, status: { in: ["PLANNED", "CONFIRMED"] }, startsAt: { gte: now } },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        take: 1,
        select: appointmentSelection,
      },
    },
  });

  // Batch bounded fallbacks instead of loading every client's full history.
  const withoutUpcoming = clients.filter(client => !client.appointments.length).map(client => client.id);
  const completedClients = withoutUpcoming.length ? await prisma.client.findMany({
    where: { artistId, id: { in: withoutUpcoming } },
    select: {
      id: true,
      appointments: {
        where: { artistId, status: "COMPLETED" },
        orderBy: [{ startsAt: "desc" }, { id: "asc" }],
        take: 1,
        select: appointmentSelection,
      },
    },
  }) : [];
  const completedByClient = new Map(completedClients.map(client => [client.id, client.appointments[0]]));
  const withoutContextArtwork = clients.filter(client => !(client.appointments[0] ?? completedByClient.get(client.id))?.designs.length).map(client => client.id);
  const artworkClients = withoutContextArtwork.length ? await prisma.client.findMany({
    where: { artistId, id: { in: withoutContextArtwork } },
    select: {
      id: true,
      appointments: {
        where: { artistId, designs: { some: { design: { artistId } } } },
        orderBy: [{ startsAt: "desc" }, { id: "asc" }],
        take: 1,
        select: appointmentSelection,
      },
    },
  }) : [];
  const artworkByClient = new Map(artworkClients.map(client => [client.id, client.appointments[0]?.designs[0]]));

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
          {clients.map((client) => {
            const upcoming = client.appointments[0];
            const context = upcoming ?? completedByClient.get(client.id);
            const artwork = context?.designs[0] ?? artworkByClient.get(client.id);
            const count = client._count.appointments;
            return (
            <Link className="client-list-item data-row" href={`/clients/${client.id}`} key={client.id}>
              {artwork ? <span className="client-artwork-preview">
                {/* Private artwork previews are already optimized by Sharp. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/designs/${artwork.design.id}/image?variant=preview`} alt={artwork.design.title} loading="lazy" />
              </span> : <span className="client-monogram" aria-hidden="true">{client.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span>}
              <div className="client-list-main">
                <strong>{client.name}</strong>
                {artwork ? <span className="client-artwork-caption"><span>{artwork.isFinal ? copy.finalArtwork : copy.referenceArtwork}</span>{" "}{artwork.design.title}</span> : null}
              </div>
              <div className="client-list-contact">
                <span>{client.phone}</span>
                {client.email ? <span>{client.email}</span> : null}
              </div>
              <div className="client-booking-context">
                {context ? <>
                  <span className="client-context-label">{upcoming ? copy.nextAppointment : copy.lastCompleted}</span>
                  <LocalDateTime iso={context.startsAt.toISOString()} locale={locale} />
                </> : <span className="client-context-empty">{count ? copy.noUpcoming : copy.notBooked}</span>}
                <span className="client-count">{count} {count === 1 ? copy.appointmentSingular : copy.appointmentPlural}</span>
              </div>
              <svg className="list-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
            </Link>
            );
          })}
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
