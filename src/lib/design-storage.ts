import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const MAX_DESIGN_IMAGE_BYTES = 25 * 1024 * 1024;

const allowedFormats = new Set(["jpeg", "png", "webp", "heif", "avif", "tiff", "gif"]);

const extensionForFormat: Record<string, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  heif: "heif",
  avif: "avif",
  tiff: "tiff",
  gif: "gif",
};

const mimeForExtension: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heif: "image/heif",
  heic: "image/heic",
  avif: "image/avif",
  tiff: "image/tiff",
  tif: "image/tiff",
  gif: "image/gif",
};

function uploadRoot() {
  return path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), "data", "uploads"));
}

function safeArtistDirectory(artistId: string) {
  return artistId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function assertSafeStorageKey(key: string) {
  if (
    !/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9-]+(?:\.(?:preview|thumb))?\.(jpg|png|webp|heif|avif|tiff|gif)$/.test(
      key,
    )
  ) {
    throw new Error("Invalid design storage key");
  }
}

function absolutePath(key: string) {
  assertSafeStorageKey(key);
  const root = uploadRoot();
  const resolved = path.resolve(root, key);

  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid design storage path");
  }

  return resolved;
}

function variantKey(key: string, variant: "preview" | "thumb") {
  assertSafeStorageKey(key);
  return key.replace(/\.[^.]+$/, `.${variant}.webp`);
}

export async function storeDesignImage(artistId: string, bytes: Buffer) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DESIGN_IMAGE_BYTES) {
    throw new Error("image_size_invalid");
  }

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(bytes, { failOn: "error" }).metadata();
  } catch {
    throw new Error("image_invalid");
  }

  if (!metadata.format || !allowedFormats.has(metadata.format) || !metadata.width || !metadata.height) {
    throw new Error("image_invalid");
  }

  const extension = extensionForFormat[metadata.format];
  if (!extension) {
    throw new Error("image_invalid");
  }

  const directory = safeArtistDirectory(artistId);
  const baseName = randomUUID();
  const key = `${directory}/${baseName}.${extension}`;
  const originalPath = absolutePath(key);
  const previewPath = absolutePath(variantKey(key, "preview"));
  const thumbPath = absolutePath(variantKey(key, "thumb"));

  await mkdir(path.dirname(originalPath), { recursive: true });

  const preview = await sharp(bytes, { failOn: "error" })
    .rotate()
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer();

  const thumb = await sharp(bytes, { failOn: "error" })
    .rotate()
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  await Promise.all([
    writeFile(originalPath, bytes, { flag: "wx" }),
    writeFile(previewPath, preview, { flag: "wx" }),
    writeFile(thumbPath, thumb, { flag: "wx" }),
  ]);

  return { key, width: metadata.width, height: metadata.height };
}

export async function removeDesignImage(key: string) {
  const paths = [
    absolutePath(key),
    absolutePath(variantKey(key, "preview")),
    absolutePath(variantKey(key, "thumb")),
  ];

  await Promise.all(
    paths.map(async (filePath) => {
      try {
        await unlink(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }),
  );
}

export async function readDesignImage(
  key: string,
  variant: "original" | "preview" | "thumb",
) {
  const requestedKey = variant === "original" ? key : variantKey(key, variant);
  const bytes = await readFile(absolutePath(requestedKey));

  if (variant !== "original") {
    return { bytes, contentType: "image/webp" };
  }

  const extension = path.extname(key).slice(1).toLowerCase();
  return {
    bytes,
    contentType: mimeForExtension[extension] ?? "application/octet-stream",
  };
}
