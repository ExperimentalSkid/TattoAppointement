import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tattoo Appointment",
    short_name: "Tattoo",
    description: "Practical appointment management for tattoo artists.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f3ef",
    theme_color: "#171717",
    icons: [
      {
        src: "/icons/app-icon.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/app-icon.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
