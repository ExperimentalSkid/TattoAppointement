import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { getDictionary } from "@/i18n";

export default async function DesignsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const artistId = await requireArtistId();
  const { locale, dictionary } = await getDictionary();
  const query = String((await searchParams).q ?? "").trim();

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
  });

  return (
    <section>
      <div className="page-title-row">
        <h1 className="page-heading">{dictionary.pages.designsTitle}</h1>
        <Link className="primary-button button-link" href="/designs/new">
          {dictionary.designs.uploadDesign}
        </Link>
      </div>

      <form className="search-bar" action="/designs">
        <input
          name="q"
          type="search"
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
            <Link className="design-card" href={`/designs/${design.id}`} key={design.id}>
              <div className="design-card-image">
                {/* Authenticated image routes cannot use the public Next image optimizer. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/designs/${design.id}/image`} alt={design.title} loading="lazy" />
              </div>
              <div className="design-card-body">
                <strong>{design.title}</strong>
                <span>{dateFormatter.format(design.createdAt)}</span>
                {design.notes ? <p>{design.notes}</p> : null}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>{query ? dictionary.designs.noResults : dictionary.designs.empty}</p>
        </div>
      )}
    </section>
  );
}
