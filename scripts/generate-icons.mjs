import sharp from "sharp";

// Raster counterparts ensure installation works across Chromium and iOS.
await Promise.all([192, 512, 180].map(size => sharp("public/icons/app-icon.svg").resize(size, size).png().toFile(`public/icons/${size === 180 ? "apple-touch-icon" : `app-icon-${size}`}.png`)));
