export type DesignMetadata = {
  title: string;
  notes: string | null;
};

export type DesignMetadataError = "title_required" | "title_too_long" | "notes_too_long";

function optionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function titleFromFilename(filename: string) {
  const withoutExtension = filename.replace(/\.[^.]+$/, "").trim();
  return withoutExtension || "Untitled design";
}

export function parseDesignMetadata(
  input: Record<string, unknown>,
  fallbackTitle?: string,
): { ok: true; data: DesignMetadata } | { ok: false; error: DesignMetadataError } {
  const suppliedTitle = typeof input.title === "string" ? input.title.trim() : "";
  const title = suppliedTitle || fallbackTitle?.trim() || "";
  const notes = optionalText(input.notes);

  if (!title) return { ok: false, error: "title_required" };
  if (title.length > 140) return { ok: false, error: "title_too_long" };
  if (notes && notes.length > 5000) return { ok: false, error: "notes_too_long" };

  return {
    ok: true,
    data: { title, notes },
  };
}
