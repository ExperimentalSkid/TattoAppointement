import sharp from "sharp";

const pixels = Buffer.alloc(8 * 8 * 4, 255);
const preview = await sharp(pixels, {
  raw: { width: 8, height: 8, channels: 4 },
})
  .webp({ quality: 84 })
  .toBuffer();

const metadata = await sharp(preview).metadata();

if (metadata.format !== "webp" || metadata.width !== 8 || metadata.height !== 8) {
  throw new Error("Sharp image processing smoke check failed");
}

console.log("Image processing smoke check passed");
