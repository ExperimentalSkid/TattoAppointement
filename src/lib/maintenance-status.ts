import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

type MaintenanceStatus = "ok" | "degraded" | "failed";

/** Private operational heartbeat: never contains account IDs or error details. */
export async function recordMaintenanceStatus(status: MaintenanceStatus) {
  const directory = path.resolve(/* turbopackIgnore: true */
    process.env.DIAGNOSTICS_DIR ?? path.join(process.cwd(), ".data", "diagnostics"),
  );
  const target = path.join(directory, "maintenance-status.json");
  const temporary = path.join(directory, `.maintenance-${randomUUID()}.tmp`);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    let lastSuccessfulAt: string | null = null;
    try {
      if ((await stat(target)).size <= 4096) {
        const previous = JSON.parse(await readFile(target, "utf8"));
        if (previous.schemaVersion === 1 && typeof previous.lastSuccessfulAt === "string"
          && Number.isFinite(Date.parse(previous.lastSuccessfulAt))) lastSuccessfulAt = previous.lastSuccessfulAt;
      }
    } catch { /* First run or invalid previous state; no success is inferred. */ }
    const finishedAt = new Date().toISOString();
    await writeFile(temporary, JSON.stringify({ schemaVersion: 1, status, finishedAt,
      lastSuccessfulAt: status === "ok" ? finishedAt : lastSuccessfulAt }), { flag: "wx", mode: 0o600 });
    await rename(temporary, target);
    return true;
  } catch {
    console.error("Tinta privacy maintenance: operational status could not be saved.");
    return false;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
