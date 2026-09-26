import { DesignManager } from "@/components/design-manager";
import { getDictionary } from "@/i18n";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";

export default async function DesignsPage() {
  const artistId = await requireArtistId();
  const { dictionary, locale } = await getDictionary();

  const designs = await prisma.design.findMany({
    where: { artistId },
    orderBy: { createdAt: "desc" },
    take: 120,
    select: {
      id: true,
      title: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { appointments: true } },
    },
  });

  return (
    <DesignManager
      locale={locale}
      copy={dictionary.designs}
      initialDesigns={designs.map(({ _count, createdAt, updatedAt, ...design }) => ({
        ...design,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        appointmentCount: _count.appointments,
        thumbUrl: `/api/designs/${design.id}/image?variant=thumb`,
        previewUrl: `/api/designs/${design.id}/image?variant=preview`,
        originalUrl: `/api/designs/${design.id}/image?variant=original`,
      }))}
    />
  );
}
