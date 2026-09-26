import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const MAX_DESIGN_FILE_SIZE = 25 * 1024 * 1024;

const STORAGE_ROOT = path.resolve(
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
  constructor(public readonly code: "missing" | "too_large" | "unsupported") {
    super(code);
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
  const resolved = path.resolve(STORAGE_ROOT, key);
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
  let metadata: sharp.Metadata;

  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    throw new DesignImageError("unsupported");
  }

  const format = metadata.format as SupportedFormat | undefined;
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

  await mkdir(path.dirname(originalPath), { recursive: true });

  try {
    await writeFile(originalPath, buffer, { flag: "wx" });
    await sharp(buffer)
      .rotate()
      .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84 })
      .toFile(previewPath);
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
    originalName: file.name?.trim() || null,
    fileSize: file.size,
  };
}

export async function readDesignFile(key: string) {
  return readFile(resolveStoragePath(key));
}

export async function removeDesignFiles(keys: Array<string | null | undefined>) {
  await Promise.allSettled(
    keys.filter((key): key is string => Boolean(key)).map((key) => rm(resolveStoragePath(key), { force: true })),
  );
}
