import { notFound } from "next/navigation";
import { DesignMetadataForm } from "@/components/design-metadata-form";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { getDictionary } from "@/i18n";
import { deleteDesign, updateDesign } from "@/app/(app)/designs/actions";

export default async function EditDesignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const artistId = await requireArtistId();
  const { id } = await params;
  const { dictionary } = await getDictionary();

  const design = await prisma.design.findFirst({
    where: { id, artistId },
    select: { id: true, title: true, notes: true },
  });

  if (!design) notFound();

  return (
    <section className="narrow-page">
      <h1 className="page-heading">{dictionary.designs.editDesign}</h1>
      <div className="form-card design-form">
        <DesignMetadataForm
          action={updateDesign.bind(null, design.id)}
          copy={dictionary.designs}
          design={design}
        />
        <form action={deleteDesign.bind(null, design.id)} className="form-actions">
          <ConfirmSubmitButton className="danger-button" message={dictionary.designs.deleteConfirmation}>
            {dictionary.designs.deleteDesign}
          </ConfirmSubmitButton>
        </form>
      </div>
    </section>
  );
}
