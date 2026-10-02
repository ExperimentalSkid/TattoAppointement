import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { getDictionary } from "@/i18n";
import { designDetailPath, normalizeDesignQuery } from "@/lib/design-navigation";
import { studioTimeZone } from "@/lib/studio-time";

export default async function DesignsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const artistId = await requireArtistId();
  const { locale, dictionary } = await getDictionary();
  const query = normalizeDesignQuery((await searchParams).q);

  const designs = await prisma.design.findMany({
    where: {
      artistId,
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: "insensitive" as const } },
              { notes: { contains: query, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      notes: true,
      createdAt: true,
    },
  });

  const dateFormatter = new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-GB", {
    dateStyle: "medium",
    timeZone: studioTimeZone,
  });

  return (
    <section>
      <div className="page-title-row">
        <div><p className="eyebrow">{locale === "es" ? "DEL BOCETO A LA PIEL" : "FROM SKETCH TO SKIN"}</p><h1 className="page-heading">{dictionary.pages.designsTitle}</h1><p className="page-subtitle">{locale === "es" ? "Tu archivo creativo, listo para la próxima sesión." : "Your creative archive, ready for the next session."}</p></div>
        <Link className="primary-button button-link" href="/designs/new">
          <span aria-hidden="true">＋</span>{dictionary.designs.uploadDesign}
        </Link>
      </div>

      <form className="search-bar" action="/designs">
        <input
          name="q"
          type="search"
          maxLength={500}
          defaultValue={query}
          placeholder={dictionary.designs.searchPlaceholder}
          aria-label={dictionary.designs.searchPlaceholder}
        />
        <button className="secondary-button" type="submit">
          {dictionary.designs.search}
        </button>
        {query ? (
          <Link className="secondary-button button-link" href="/designs">
            {dictionary.designs.clearSearch}
          </Link>
        ) : null}
      </form>

      {designs.length ? (
        <div className="design-grid">
          {designs.map((design) => (
            <Link className="design-card artwork-object" href={designDetailPath(design.id, query)} key={design.id}>
              <div className="design-card-image">
                {/* Authenticated image routes cannot use the public Next image optimizer. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/designs/${design.id}/image`} alt={design.title} loading="lazy" />
              </div>
              <div className="design-card-body">
                <strong>{design.title}</strong>
                <span><time dateTime={design.createdAt.toISOString()}>{dateFormatter.format(design.createdAt)}</time></span>
                {design.notes ? <p>{design.notes}</p> : null}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M4 3h16v18H4zM7 16l4-4 3 3 3-6M8 7h.01" /></svg>
          <h2>{query ? dictionary.designs.noResults : locale === "es" ? "Dale espacio a tus ideas" : "Make room for your ideas"}</h2>
          <p>{query ? (locale === "es" ? "Prueba otro título o una palabra de tus notas." : "Try another title or a word from your notes.") : locale === "es" ? "Importa un boceto o una referencia y vincúlalo a cualquier cita." : "Import a sketch or a reference and connect it to any appointment."}</p>
          <Link href={query ? "/designs" : "/designs/new"} className="secondary-button button-link">{query ? dictionary.designs.clearSearch : dictionary.designs.uploadDesign}</Link>
        </div>
      )}
    </section>
  );
}
