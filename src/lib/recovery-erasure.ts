import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

type ErasureKind = "account" | "client";

/** Keep accepted erasure instructions outside database snapshots for restore review. */
export async function recordRecoveryErasure(kind: ErasureKind, subjectId: string) {
  if (!["account", "client"].includes(kind) || !/^[A-Za-z0-9_-]{1,128}$/.test(subjectId)) {
    throw new Error("invalid_recovery_instruction");
  }
  const root = path.resolve(/* turbopackIgnore: true */
    process.env.DIAGNOSTICS_DIR ?? path.join(process.cwd(), ".data", "diagnostics"),
  );
  const directory = path.join(root, "recovery-erasures");
  const subjectHash = createHash("sha256").update(`${kind}:${subjectId}`).digest("hex");
  const target = path.join(directory, `${kind}-${subjectHash}.json`);
  const temporary = path.join(directory, `.instruction-${randomUUID()}.tmp`);
  const syncDirectory = async (location: string) => {
    if (process.platform === "win32") return;
    const folder = await open(location, "r");
    try { await folder.sync(); } finally { await folder.close(); }
  };
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!(await lstat(directory)).isDirectory()) throw new Error("invalid_recovery_instruction");
    await chmod(directory, 0o700);
    await syncDirectory(root);
    try {
      const metadata = await lstat(target);
      if (!metadata.isFile() || metadata.size > 4096) throw new Error("invalid_recovery_instruction");
      const previous = JSON.parse(await readFile(target, "utf8"));
      if (previous.schemaVersion !== 1 || previous.kind !== kind || previous.subjectHash !== subjectHash
        || !Number.isFinite(Date.parse(previous.recordedAt))) throw new Error("invalid_recovery_instruction");
      await chmod(target, 0o600);
      await syncDirectory(directory);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify({ schemaVersion: 1, kind, subjectHash,
        recordedAt: new Date().toISOString() }));
      await file.sync();
    } finally { await file.close(); }
    await rename(temporary, target);
    await syncDirectory(directory);
  } catch {
    throw new Error("recovery_instruction_unavailable");
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
