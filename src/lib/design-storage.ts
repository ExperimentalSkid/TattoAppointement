import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const MAX_DESIGN_FILE_SIZE = 25 * 1024 * 1024;
export const MAX_DESIGN_PIXELS = 40_000_000;

// Private runtime storage is mounted separately; it must not enter build traces.
const STORAGE_ROOT = path.resolve(/* turbopackIgnore: true */
  process.env.DESIGN_STORAGE_DIR ?? path.join(process.cwd(), "storage", "designs"),
);

const formats = {
  jpeg: { extension: "jpg", mimeType: "image/jpeg" },
  png: { extension: "png", mimeType: "image/png" },
  webp: { extension: "webp", mimeType: "image/webp" },
  gif: { extension: "gif", mimeType: "image/gif" },
  avif: { extension: "avif", mimeType: "image/avif" },
  heif: { extension: "heic", mimeType: "image/heic" },
  tiff: { extension: "tif", mimeType: "image/tiff" },
} as const;

type SupportedFormat = keyof typeof formats;

export class DesignImageError extends Error {
  readonly code: "missing" | "too_large" | "unsupported";
  constructor(code: "missing" | "too_large" | "unsupported") {
    super(code);
    this.code = code;
  }
}

export type StoredDesignImage = {
  storageKey: string;
  previewKey: string;
  mimeType: string;
  originalName: string | null;
  fileSize: number;
};

function resolveStoragePath(key: string) {
  const resolved = path.resolve(/* turbopackIgnore: true */ STORAGE_ROOT, key);
  const rootPrefix = `${STORAGE_ROOT}${path.sep}`;

  if (!resolved.startsWith(rootPrefix)) {
    throw new Error("Invalid storage key");
  }

  return resolved;
}

export async function saveDesignImage(file: File, artistId: string): Promise<StoredDesignImage> {
  if (!file.size) {
    throw new DesignImageError("missing");
  }

  if (file.size > MAX_DESIGN_FILE_SIZE) {
    throw new DesignImageError("too_large");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let detectedFormat: string | undefined;

  try {
    const metadata = await sharp(buffer, { limitInputPixels: MAX_DESIGN_PIXELS }).metadata();
    detectedFormat = metadata.format === "heif" && metadata.compression === "av1" ? "avif" : metadata.format;
  } catch {
    throw new DesignImageError("unsupported");
  }

  const format = detectedFormat as SupportedFormat | undefined;
  if (!format || !(format in formats)) {
    throw new DesignImageError("unsupported");
  }

  const formatInfo = formats[format];
  const stem = randomUUID();
  const artistDirectory = artistId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const storageKey = `${artistDirectory}/${stem}.${formatInfo.extension}`;
  const previewKey = `${artistDirectory}/${stem}.preview.webp`;
  const originalPath = resolveStoragePath(storageKey);
  const previewPath = resolveStoragePath(previewKey);

  let preview: Buffer;
  try {
    preview = await sharp(buffer, { limitInputPixels: MAX_DESIGN_PIXELS })
      .rotate()
      .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84 })
      .toBuffer();
  } catch {
    throw new DesignImageError("unsupported");
  }

  await mkdir(path.dirname(originalPath), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(originalPath), 0o700);

  try {
    await writeFile(originalPath, buffer, { flag: "wx", mode: 0o600 });
    await writeFile(previewPath, preview, { flag: "wx", mode: 0o600 });
  } catch (error) {
    await Promise.allSettled([
      rm(originalPath, { force: true }),
      rm(previewPath, { force: true }),
    ]);
    throw error;
  }

  return {
    storageKey,
    previewKey,
    mimeType: formatInfo.mimeType,
    originalName: file.name?.trim().slice(0, 255) || null,
    fileSize: file.size,
  };
}

export async function readDesignFile(key: string) {
  return readFile(/* turbopackIgnore: true */ resolveStoragePath(key));
}

export async function removeDesignFiles(keys: Array<string | null | undefined>) {
  await Promise.allSettled(
    keys.filter((key): key is string => Boolean(key)).map((key) => rm(resolveStoragePath(key), { force: true })),
  );
}

/** Account erasure includes originals, previews and any abandoned upload files. */
export async function removeArtistDesignFiles(artistId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(artistId)) throw new Error("Invalid artist directory");
  const directory = resolveStoragePath(artistId);
  if (path.dirname(directory) !== STORAGE_ROOT) throw new Error("Invalid artist directory");
  // Removing a symlink removes the link; rm does not follow it recursively.
  await rm(directory, { recursive: true, force: true });
}

/** Catch interrupted uploads/deletes. Fresh uploads get a full day to finish. */
export async function pruneUnreferencedDesignFiles(referenced: (keys: string[]) => Promise<Set<string>>) {
  let directories;
  try { directories = await readdir(STORAGE_ROOT, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  await chmod(STORAGE_ROOT, 0o700);
  const cutoff = Date.now() - 24 * 60 * 60_000;
  for (const directory of directories) {
    if (!directory.isDirectory() || !/^[A-Za-z0-9_-]{1,128}$/.test(directory.name)) continue;
    await chmod(resolveStoragePath(directory.name), 0o700);
    const keys: string[] = [];
    for (const file of await readdir(resolveStoragePath(directory.name), { withFileTypes: true })) {
      if (!file.isFile() || !/^[A-Za-z0-9_.-]+$/.test(file.name)) continue;
      const key = `${directory.name}/${file.name}`;
      await chmod(resolveStoragePath(key), 0o600);
      if ((await stat(resolveStoragePath(key))).mtimeMs < cutoff) keys.push(key);
    }
    for (let start = 0; start < keys.length; start += 100) {
      const batch = keys.slice(start, start + 100);
      const retained = await referenced(batch);
      for (const key of batch) if (!retained.has(key)) await rm(resolveStoragePath(key), { force: true });
    }
  }
}
