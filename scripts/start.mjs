import { cp, access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

try { process.loadEnvFile(".env"); } catch (error) { if (error.code !== "ENOENT") throw error; }
const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
try { await access(path.join(standalone, "server.js")); } catch { throw new Error("Production build missing. Run npm run build first."); }
await cp(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
await cp(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
process.env.HOSTNAME ||= "127.0.0.1";
process.env.PORT ||= "3000";
// The generated server changes cwd to .next/standalone. Keep artwork outside
// the build directory so rebuilding cannot remove an installation's uploads.
process.env.DESIGN_STORAGE_DIR = path.resolve(root, process.env.DESIGN_STORAGE_DIR || "storage/designs");
await import(pathToFileURL(path.join(standalone, "server.js")).href);
