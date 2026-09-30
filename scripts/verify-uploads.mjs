import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { readUploadFormData, UploadBodyError } from "../src/lib/uploads.ts";

const multipart = new FormData();
multipart.set("title", "Original artwork");
multipart.set("image", new File(["test"], "art.png", { type: "image/png" }));
const encoded = new Request("http://localhost/upload", { method: "POST", body: multipart });
const multipartBytes = new Uint8Array(await encoded.arrayBuffer());
const multipartHeaders = { "Content-Type": encoded.headers.get("content-type") };
const makeRequest = (headers = {}) => new Request("http://localhost/upload", {
  method: "POST", body: multipartBytes, headers: { ...multipartHeaders, ...headers },
});
const parsed = await readUploadFormData(makeRequest(), 1024);
assert.equal(parsed.get("title"), "Original artwork");
assert.equal(parsed.get("image").size, 4);
await assert.rejects(
  readUploadFormData(new Request("http://localhost/upload", { method: "POST", body: "text" }), 1024),
  (error) => error instanceof UploadBodyError && error.code === "invalid_body",
);
await assert.rejects(
  readUploadFormData(makeRequest({ "Content-Length": "2048" }), 1024),
  (error) => error instanceof UploadBodyError && error.code === "too_large",
);
await assert.rejects(
  readUploadFormData(makeRequest(), 50),
  (error) => error instanceof UploadBodyError && error.code === "too_large",
  "body limits must also apply when no content length is provided",
);
await assert.rejects(
  readUploadFormData(new Request("http://localhost/upload", {
    method: "POST", body: "invalid multipart", headers: { "Content-Type": "multipart/form-data; boundary=test" },
  }), 1024),
  (error) => error instanceof UploadBodyError && error.code === "invalid_body",
);

// Run the real upload pipeline against a private temporary directory.
const { mkdir } = await import("node:fs/promises");
await mkdir(".tmp", { recursive: true });
const storage = await mkdtemp(path.resolve(".tmp", "verify-uploads-"));
process.env.DESIGN_STORAGE_DIR = storage;
const { saveDesignImage, readDesignFile, removeDesignFiles, DesignImageError } = await import("../src/lib/design-storage.ts");
try {
  const original = await sharp({ create: { width: 1600, height: 100, channels: 3, background: "white" } }).png().toBuffer();
  const stored = await saveDesignImage(new File([original], "drawing.png", { type: "image/png" }), "artist-1");
  assert.deepEqual(await readDesignFile(stored.storageKey), original, "preserve original image bytes");
  const preview = await sharp(await readDesignFile(stored.previewKey)).metadata();
  assert.equal(preview.format, "webp");
  assert.equal(preview.width, 1400);
  assert.equal(stored.mimeType, "image/png");
  await removeDesignFiles([stored.storageKey, stored.previewKey]);
  await assert.rejects(readDesignFile(stored.storageKey));
  await assert.rejects(saveDesignImage(new File(["not an image"], "wrong.png"), "artist-1"),
    (error) => error instanceof DesignImageError && error.code === "unsupported");
  await assert.rejects(saveDesignImage(new File([], "empty.png"), "artist-1"),
    (error) => error instanceof DesignImageError && error.code === "missing");
} finally {
  await rm(storage, { recursive: true, force: true });
}
console.log("Upload validation, image preservation and preview checks passed");
