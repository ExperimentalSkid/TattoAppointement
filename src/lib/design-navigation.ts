// Carry only the search keyword; destinations are always built from fixed app paths.
export function normalizeDesignQuery(value: unknown): string {
  return typeof value === "string" && value.length <= 500 ? value.trim() : "";
}

export function designLibraryPath(libraryQuery?: string): string {
  const query = normalizeDesignQuery(libraryQuery);
  return query ? `/designs?${new URLSearchParams({ q: query })}` : "/designs";
}

export function designDetailPath(designId: string, libraryQuery?: string, edit = false): string {
  const path = `/designs/${encodeURIComponent(designId)}${edit ? "/edit" : ""}`;
  const query = normalizeDesignQuery(libraryQuery);
  return query ? `${path}?${new URLSearchParams({ libraryQuery: query })}` : path;
}
