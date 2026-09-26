export function withArtistScope<T extends Record<string, unknown>>(
  artistId: string,
  where: T,
): T & { artistId: string } {
  return {
    ...where,
    artistId,
  };
}

export function artistScope(artistId: string) {
  return { artistId } as const;
}
