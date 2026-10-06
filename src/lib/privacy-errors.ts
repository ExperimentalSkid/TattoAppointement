/** Prisma's PG adapter may wrap a raw-query serialization error as P2010. */
export function isPrivacyWriteConflict(error: unknown) {
  try {
    if (!error || typeof error !== "object" || !("code" in error)) return false;
    if (error.code === "P2034") return true;
    if (error.code !== "P2010" || !("meta" in error) || !error.meta || typeof error.meta !== "object") return false;
    const meta = error.meta as { code?: unknown; driverAdapterError?: { cause?: { kind?: unknown } } };
    return meta.code === "40001" || meta.code === "40P01" || meta.driverAdapterError?.cause?.kind === "TransactionWriteConflict";
  } catch { return false; }
}
